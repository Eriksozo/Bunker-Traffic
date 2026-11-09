import {runtimeFailure} from '../lib/cloud-failure-diagnostics.mjs';
import {DurableObject} from 'cloudflare:workers';
import {SupabaseStorage} from '../lib/supabase-storage.mjs';
import {readPersistedState,commitPersistedState} from '../lib/persistence.mjs';
import {empty,apply} from '../lib/state';
import {claimBatch,updateRun} from '../lib/agent-state';
import {answerOfficeMessage} from '../lib/office.mjs';
import {assertCurrentExecutionContingency} from '../lib/live-state';
import {cloudMalvaClient} from '../lib/cloud-malva.mjs';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {readCreativeData} from '../lib/creative-data.mjs';
import {cloudOrbitaClient} from '../lib/cloud-orbita.mjs';
import {syncCloudCreatives} from '../lib/cloud-creative-sync.mjs';
import {readLiveData,liveDataAction} from '../lib/live-data.mjs';
import {collectCloudProject,trackedCloudCampaigns} from '../lib/cloud-collector.mjs';
import {CLOUD_MODEL} from '../lib/cloud-analysis.mjs';
import {cloudModelPolicy,cloudProductionModelPolicy} from '../lib/cloud-model-policy.mjs';
import {checkCloudModel} from '../lib/cloud-model-check.mjs';
import {companionSummary,projectBoard} from '../lib/companion-summary.mjs';
import {expiredAttribution,usableAttributions} from '../lib/change-attribution.mjs';
import {activityHistoryProjects,collectActivityHistory,activityHistoryPolicy} from '../lib/activity-history.mjs';
import {evaluateShadow,mergeShadow,shadowOutcomes,shadowGrades,shadowSummary,shadowPolicy,first24hWatch,first24hSummary,ruleAccuracy,scoreGatedRules} from '../lib/autonomy-shadow.mjs';
import {metaLiveCandidates,groupMetaAccounts} from '../lib/first-24h.mjs';
import {metaLivePolicy} from '../lib/meta-live.mjs';
import {metaLiveTargets,overlayMetaItems,liveTodayState,liveRowIndex,freshMeta} from '../lib/meta-display.mjs';
import {activityLog} from '../lib/campaign-activity.mjs';
import {buildAccountPanel,readMetaAccounts,accountPanelPolicy,runningAccounts} from '../lib/account-limits.mjs';
import {pendingLiveRefresh} from '../lib/owner-applied.mjs';
import {changeWatchPolicy,fastLaneKinds,watchProject,nextPulse,liveOrder,orderPulse,newestLiveItems} from '../lib/change-watch.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import {addSale,salesView} from '../lib/sales-feed.mjs';
import {deliverPhoneAlerts} from '../lib/phone-alerts.mjs';

/** Local day of the shadow's default timezone: the "hoje" of a pulse that evaluated no project keeps being today. */
const shadowLocalDay=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
type Runtime={enabled:boolean;lastPulseAt?:string;lastUnitAt?:string;lastError?:string|null;lastErrorDetail?:string|null;lastResult?:any;check?:any;history?:any[]};
export class BunkerCloudExecutor extends DurableObject<any>{
 private running=false;
 private centralView:any=null;
 private liveItems:any[]=[];
 private async setting():Promise<Runtime>{return await this.ctx.storage.get<Runtime>('runtime')||{enabled:false,history:[]};}
 private db(){return new SupabaseStorage({url:this.env.SUPABASE_URL,key:this.env.SUPABASE_SERVICE_ROLE_KEY});}
 private async read(){const current=await readPersistedState(this.db(),empty);this.centralView={paused:current.state.paused,cadence:current.state.cadence,at:new Date().toISOString()};this.storagePressure=(current as any).storage?.pressure??null;return current;}
 // Storage alarm for the notch (lib/history-storage.mjs storagePressure): warns at 85% of the central or ledger limit.
 private storagePressure:any=null;
 /** Central writes of this object run one at a time: the fast lane may write while a long heavy unit waits for the
  * model, and each write still rereads the central first, so neither loses the other's change (the CAS stays). */
 private writeChain:Promise<unknown>=Promise.resolve();
 private write(fn:(s:any,revision:number)=>any):Promise<any>{
  const run=this.writeChain.then(async()=>{const current=await this.read();const result=await fn(current.state,current.revision);await commitPersistedState(this.db(),current.state,current.revision);return result;});
  this.writeChain=run.catch(()=>{});return run;
 }
 /** Last successful live read per project, kept in memory for the fast lane's rotation (never a source of data). */
 private liveReadAt:Record<string,number>={};
 /** Projects with a live read in flight (heavy pulse or fast lane): the other one skips them, never two imports at once. */
 private liveReading=new Set<string>();
 /** `only`: read just the `first` projects (fast lane), never the usual oldest-first rotation. */
 private async syncLive(first:string[]=[],only=false):Promise<any>{
  if(only&&!first.length)return null;
  const current=await this.read();if(current.state.paused)return null;const source=cloudMalvaClient(this.db()),listed=await source.read('tracking_list_projects',{});const live=await readLiveData(this.db(),current.state);
  // The shadow reuses this pulse's live reads: no extra central or Supabase read.
  const fresh:Record<string,any>={};
  // Owner "Já fiz" reports jump the queue: their project is read first, then the oldest reads as before.
  const lastSuccess=Object.fromEntries((live.items||[]).map((i:any)=>[i.projectId,i.lastSuccessAt]));
  const urgent=pendingLiveRefresh(current.state,lastSuccess);
  for(const [id,at] of Object.entries(lastSuccess)){const t=Date.parse(String(at||''));if(Number.isFinite(t))this.liveReadAt[id]=Math.max(this.liveReadAt[id]||0,t);}
  const projects=only?live.projects.filter((p:any)=>first.includes(p.projectId)).slice(0,changeWatchPolicy.maxLiveReads+1):liveOrder(live.projects,{first,urgent,lastSuccess});
  for(const p of projects){const project=listed.items?.find((x:any)=>x.id===p.projectId&&x.name===p.projectName);if(!project||this.liveReading.has(p.projectId))continue;this.liveReading.add(p.projectId);try{const cut=await collectCloudProject(source,project,{purpose:'live',levels:['campaign'],periodsWanted:['today'],tracked:trackedCloudCampaigns(current.state,p.projectId)});const latest=await this.read();if(latest.state.paused)break;const before=await readLiveData(this.db(),latest.state,p.projectId);await liveDataAction(this.db(),latest.state,{action:'import',projectId:p.projectId,snapshot:cut.snapshots[0],expectedRevision:before.items[0].revision},Date.now(),'cloudflare');if(p.projectId){fresh[p.projectId]={projectId:p.projectId,snapshot:cut.snapshots[0]};this.liveReadAt[p.projectId]=Date.now();}}catch(e:any){const latest=await this.read();if(latest.state.paused||!(await this.setting()).enabled)break;const before=await readLiveData(this.db(),latest.state,p.projectId);const code=/^[A-Z][A-Z0-9_]{0,59}$/.test(e.code||'')?e.code:'CLOUD_LIVE_FAILED';await liveDataAction(this.db(),latest.state,{action:'failure',projectId:p.projectId,expectedRevision:before.items[0].revision,error:{code,message:'A consulta na nuvem não confirmou uma nova leitura. Última fonte válida preservada.'}},Date.now(),'cloudflare');}finally{this.liveReading.delete(p.projectId);}}
  // The fast lane and the heavy pulse may read live at the same time: per project, the newest reading wins, so a pulse
  // that started earlier never puts back the pre-pause row a fast-lane reread just replaced (owner report of 08/11:
  // a campaign paused from the notch stayed in the list).
  this.liveItems=newestLiveItems(this.liveItems,live.items||[],fresh);
  return current.state;
 }
 /** Fast edit watch (lib/change-watch.mjs): a small read per configured project; new edits are stored with
  * their author at once and bump the pulse the web and the notch follow. Never reads the central. */
 private freshChanges:any[]=[];
 /** Moves the pulse only after the summaries were rewritten, so a client reading it never gets the old view. */
 private async bumpPulse(){if(!this.freshChanges.length)return;await this.ctx.storage.put('syncPulse',nextPulse(await this.ctx.storage.get<any>('syncPulse'),this.freshChanges,Date.now()));}
 private async watchChanges():Promise<string[]>{
  this.freshChanges=[];
  const config=await this.ctx.storage.get<string[]>('watchConfig');if(!Array.isArray(config)||!config.length)return [];
  const source=cloudMalvaClient(this.db());
  let targets=await this.ctx.storage.get<any>('watchTargets');
  if(!targets||Date.now()-Date.parse(targets.at)>changeWatchPolicy.targetsMs){
   const listed=await source.read('tracking_list_projects',{});
   targets={at:new Date().toISOString(),items:(listed.items||[]).filter((x:any)=>config.includes(x.id)).map((x:any)=>({id:x.id,name:x.name,timezone:x.timezone}))};
   await this.ctx.storage.put('watchTargets',targets);
  }
  const heads=await this.ctx.storage.get<any>((targets.items as any[]).map((t:any)=>'watch-head:'+t.id));
  const results=await Promise.all((targets.items as any[]).map(async(project:any)=>{try{return await watchProject(source,project,heads.get('watch-head:'+project.id)||null,Date.now());}catch{return null;}}));
  const changes=results.filter(Boolean) as any[];
  const writes:Record<string,any>={};
  for(const c of changes){writes['watch-head:'+c.project]=c.head;for(const e of c.events)writes['attr:'+e.key]=e;}
  const fresh=changes.filter(c=>c.events.length);this.freshChanges=fresh;
  if(Object.keys(writes).length)await this.ctx.storage.put(writes);
  await this.ctx.storage.put('watchStatus',{at:new Date().toISOString(),projects:changes.length,failed:results.length-changes.length,fresh:fresh.map(c=>c.project)});
  return fresh.map(c=>c.project);
 }
 private async storedShadow(){return [...(await this.ctx.storage.list<any>({prefix:'shadow:'})).values()];}
 /**
  * Shadow mode (docs/autonomy-policy.md): records what each owner-chosen rule would do now and what a
  * manager did afterwards. Never proposes, approves or dispatches. Stored in this object, not in the central.
  */
 private async storeShadow(state:any){
  if(!state||state.paused)return [];
  let policy:any={};try{policy=JSON.parse(this.env.AUTONOMY_SHADOW_POLICY||'{}');}catch{policy={};}
  const now=Date.now(),list=await this.ctx.storage.list<any>({prefix:'attr:'}),withAuthors={...state,changeAttributions:usableAttributions([...list.values()])};
  const events=activityLog(withAuthors,{since:now-26*3600000,now});
  const prior=[...(await this.ctx.storage.list<any>({prefix:'shadow:'})).values()],meta=await this.ctx.storage.get<any>('metaLive');
  // Owner decisions 08/11/2026: budget rules only become executable after their own graded accuracy proves itself.
  const accuracy=Object.fromEntries(scoreGatedRules.map(rule=>[rule,ruleAccuracy(prior,rule)]));
  let decisions:any[]=[],day:string|null=null;const skipped:Record<string,string>={},days:Record<string,string>={},batches:any[]=[];
  // Same as shadowLocalDay: the day of a pulse where every project was skipped (stale source), so "hoje" stays today.
  const fallbackDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  for(const project of Object.keys(state.config||{})){
   const params=policy?.projects?.[project];if(!params||params.enabled===false)continue;
   const out=evaluateShadow(state,{project,liveItem:(this.liveItems||[]).find((i:any)=>i.projectId===project)||null,events,params,now,meta,accuracy:accuracy as any});
   if(out.skipped)skipped[project]=out.skipped;decisions=decisions.concat(out.decisions);day=day||out.day||null;if(out.day)days[project]=out.day;batches.push([out.decisions,out.day||fallbackDay]);
  }
  // Each project's decisions keep that project's own local day (id and grading window), never the first project's.
  // Each decision is graded by the real next day once the closed windows cover it (assertiveness, read-only).
  const merged=shadowGrades(shadowOutcomes(batches.reduce((m,[list,d])=>mergeShadow(m,list,{now,day:d}),mergeShadow(prior,[],{now,day:fallbackDay})),events),state.snapshots);
  const keep=new Set(merged.map((e:any)=>'shadow:'+e.id)),stale=prior.map((e:any)=>'shadow:'+e.id).filter((k:string)=>!keep.has(k));
  const before=new Map(prior.map((e:any)=>[e.id,JSON.stringify(e)]));
  const entries=merged.filter((e:any)=>before.get(e.id)!==JSON.stringify(e)).map((e:any)=>['shadow:'+e.id,e] as [string,any]);
  for(let i=0;i<entries.length;i+=100)await this.ctx.storage.put(Object.fromEntries(entries.slice(i,i+100)));
  for(let i=0;i<stale.length;i+=128)await this.ctx.storage.delete(stale.slice(i,i+128));
  await this.ctx.storage.put('shadowStatus',{at:new Date(now).toISOString(),version:shadowPolicy.version,day:day||fallbackDay,days,projects:Object.keys(policy?.projects||{}),evaluated:decisions.length,stored:merged.length,skipped});
  return merged;
 }
 /**
  * "Primeiras 24h" board (docs/first-24h-protocol.md): scheduled and new campaigns of every configured project and
  * where each stands against the owner's ceiling. Reuses this pulse's reads; stored here, never in the central.
  */
 private async storeFirst24h(state:any){
  if(!state||state.paused)return;
  let policy:any={};try{policy=JSON.parse(this.env.AUTONOMY_SHADOW_POLICY||'{}');}catch{policy={};}
  const meta=await this.ctx.storage.get<any>('metaLive');
  const now=Date.now(),boards=Object.keys(state.config||{}).map(project=>first24hWatch(state,{project,liveItem:(this.liveItems||[]).find((i:any)=>i.projectId===project)||null,params:policy?.projects?.[project]||{},now,meta})).filter(Boolean);
  await this.ctx.storage.put('first24h',{at:new Date(now).toISOString(),boards});
 }
 /**
  * Live Meta read (docs/connections.md, owner decisions of 08/11 and 09/11/2026): status, daily budget and today's
  * delivery of every active Meta campaign of the configured projects (new and scheduled ones first), read-only,
  * through the `meta-read` Edge Function (the token never leaves Supabase). Every minute from the fast lane, and right
  * after an owner order (`force`); stored here only, shown joined to the Malva rows (lib/meta-display.mjs).
  * A failure keeps the last read, which stops being shown after 10 minutes; a rate-limit answer waits 10 minutes.
  * Returns true when a new read was stored.
  */
 private metaReading=false;
 private async syncMetaLive(state:any,{force=false}:{force?:boolean}={}):Promise<boolean>{
  if(!state||state.paused||this.metaReading)return false;
  const now=Date.now(),prior=await this.ctx.storage.get<any>('metaLive'),last=Math.max(Date.parse(prior?.at||'')||0,Date.parse(prior?.failedAt||'')||0);
  if(now<(Date.parse(prior?.backoffUntil||'')||0))return false;
  if(now-last<(force?10000:metaLivePolicy.refreshMs))return false;
  this.metaReading=true;
  try{
   // Ad accounts Meta refused for this token (another business, no access) are skipped for 6 hours.
   const skip=Object.fromEntries(Object.entries<any>(prior?.skip||{}).filter(([,at])=>now-Date.parse(at)<metaLivePolicy.skipMs));
   const links=(await this.ctx.storage.get<any>('metaAccountLinks'))?.links||{};
   const picks=metaLiveTargets(this.liveItems||[],{now,limit:metaLivePolicy.maxIds});
   const accounts=groupMetaAccounts(picks,links,{skip:new Set(Object.keys(skip)),maxAccounts:metaLivePolicy.maxAccounts});
   const ids=accounts.flatMap((a:any)=>a.ids);
   if(!ids.length){await this.ctx.storage.put('metaLive',{version:metaLivePolicy.version,at:new Date(now).toISOString(),items:{},requested:0,read:0,unlinked:picks.length,skip,errors:[]});return true;}
   try{
    const r:any=await this.db().rpc('metaRead',{accounts});
    const items=Object.fromEntries((Array.isArray(r?.items)?r.items:[]).filter((i:any)=>typeof i?.id==='string').map((i:any)=>[i.id,i]));
    for(const acc of Array.isArray(r?.skippedAccounts)?r.skippedAccounts:[])if(typeof acc==='string')skip[acc]=new Date(now).toISOString();
    await this.ctx.storage.put('metaLive',{version:metaLivePolicy.version,at:typeof r?.at==='string'?r.at:new Date(now).toISOString(),items,requested:ids.length,accounts:accounts.length,unlinked:picks.length-ids.length,read:Object.keys(items).length,requests:r?.requests??null,direct:r?.direct??null,ms:Date.now()-now,forced:force,
     backoffUntil:r?.rateLimited===true?new Date(now+metaLivePolicy.backoffMs).toISOString():null,
     fields:typeof r?.fields==='string'?r.fields:null,diagnostic:r?.diagnostic&&typeof r.diagnostic==='object'?{code:r.diagnostic.code??null,subcode:r.diagnostic.subcode??null,type:typeof r.diagnostic.type==='string'?r.diagnostic.type.slice(0,40):null,message:typeof r.diagnostic.message==='string'?r.diagnostic.message.slice(0,180):null}:null,skip,errors:Array.isArray(r?.errors)?r.errors.slice(0,10):[]});
    return true;
   }catch(e:any){
    const code=/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'META_READ_FAILED';
    await this.ctx.storage.put('metaLive',{...(prior||{version:metaLivePolicy.version,items:{}}),failedAt:new Date(now).toISOString(),error:code});
    return false;
   }
  }finally{this.metaReading=false;}
 }
 /** A new Meta read reaches the notch and the web at once: summaries rebuilt from a fresh central read, then the pulse. */
 private async metaTick(force=false){
  if(!(await this.setting()).enabled||!this.liveItems?.length||this.metaReading)return;
  // Cheap check first: the central is read only when a Meta read is due.
  const prior=await this.ctx.storage.get<any>('metaLive'),now=Date.now(),last=Math.max(Date.parse(prior?.at||'')||0,Date.parse(prior?.failedAt||'')||0);
  if(now<(Date.parse(prior?.backoffUntil||'')||0)||now-last<(force?10000:metaLivePolicy.refreshMs))return;
  const central=await this.read();if(central.state.paused)return;
  if(!(await this.syncMetaLive(central.state,{force}).catch(()=>false)))return;
  const latest=await this.read();if(latest.state.paused)return;
  await this.storeFirst24h(latest.state).catch(()=>{});
  await this.storeCompanion(latest.state,await this.storedShadow()).catch(()=>{});
  await this.bumpLive([]);
 }
 /**
  * Ad-account panel (docs/connections.md): Malva accounts per configured project plus the daily spending
  * limit Meta reports, read with a dedicated read-only token. Every 30 minutes; stored here, not in the central.
  */
 private async syncAccounts(state:any){
  if(!state||state.paused)return;
  const prior=await this.ctx.storage.get<any>('accountsPanel');
  const linked=await this.ctx.storage.get<any>('metaAccountLinks');
  if(prior?.version===accountPanelPolicy.version&&Date.now()-Date.parse(prior.generatedAt)<accountPanelPolicy.refreshMs&&linked)return;
  const source=cloudMalvaClient(this.db()),projects:any[]=[],projectErrors:Record<string,string>={};
  for(const [id,c] of Object.entries<any>(state.config||{})){
   try{const r:any=await source.read('tracking_ad_accounts',{projectId:id});projects.push({id,name:c?.projectName||id,items:Array.isArray(r?.items)?r.items:[]});}
   catch(e:any){projectErrors[c?.projectName||id]=/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'MALVA_ACCOUNTS_FAILED';}
  }
  let meta:any[]|null=null,metaError:string|null=null;
  let metaDiagnostic:any=null;
  // The Worker secret wins when present; otherwise the owner's Supabase secret through the read-only `meta-read` function.
  try{if(this.env.META_ACCOUNTS_TOKEN)meta=await readMetaAccounts(fetch,this.env.META_ACCOUNTS_TOKEN,{version:this.env.META_GRAPH_VERSION||accountPanelPolicy.graphVersion});
   else{const r:any=await this.db().rpc('metaRead',{action:'accounts'});if(!Array.isArray(r?.accounts))throw Object.assign(new Error('META_READ_FAILED'),{code:typeof r?.error==='string'?r.error:'META_READ_FAILED',diagnostic:r?.diagnostic||null});meta=r.accounts;
    // Fields Meta retired (adtrust_dsl in v26): the limit stays N/D and the reason is kept for the panel.
    if(Array.isArray(r?.dropped)&&r.dropped.length){
     const gone=r.dropped.filter((f:any)=>typeof f==='string').slice(0,3).join(', ');
     const tried=Array.isArray(r?.limitTried)?r.limitTried.filter((t:any)=>/^v\d{1,2}\.\d$/.test(t?.version||'')).map((t:any)=>t.version+' '+(/^META_[A-Z0-9_]{1,40}$/.test(t?.code||'')?t.code:'recusou')).slice(0,4).join(', '):'';
     const via=typeof r?.limitVersion==='string'&&/^v\d{1,2}\.\d$/.test(r.limitVersion)?r.limitVersion:null;
     metaDiagnostic={code:null,subcode:null,limitVersion:via,message:via?`Limite diário lido pela versão ${via} da Meta (a atual não oferece mais: ${gone}).`:`Campos que a Meta não oferece mais: ${gone}${tried?'. Versões anteriores: '+tried:''}.`};}}}
  catch(e:any){metaError=/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'META_FAILED';metaDiagnostic=e?.diagnostic&&typeof e.diagnostic==='object'?{code:e.diagnostic.code??null,subcode:e.diagnostic.subcode??null,message:typeof e.diagnostic.message==='string'?e.diagnostic.message.slice(0,180):null}:null;}
  const built:any=buildAccountPanel({projects,running:runningAccounts(state),meta,metaError}),fromMalva=built.counts?.limitFromMalva||0;
  if(fromMalva&&metaDiagnostic?.message&&!metaDiagnostic.limitVersion)metaDiagnostic={...metaDiagnostic,message:`Limite diário vindo do Malva em ${fromMalva} ${fromMalva===1?'conta':'contas'}; a API da Meta não entrega mais esse campo.`};
  await this.ctx.storage.put('accountsPanel',{...built,projectErrors,metaDiagnostic});
  // Malva account id → Meta ad account number, for the live Meta read of new campaigns (no other use).
  const links:Record<string,string>={};for(const p of projects)for(const a of p.items)if(a?.provider==='meta'&&typeof a.id==='string'&&/^(act_)?\d{5,25}$/.test(String(a.accountId??'')))links[a.id]=String(a.accountId).replace(/^act_/,'');
  if(Object.keys(links).length)await this.ctx.storage.put('metaAccountLinks',{at:new Date().toISOString(),links});
 }
 /** Recent Malva campaign edits, including edits between reads and campaigns not in the analysis queue. */
 private async syncAttribution(state:any){
  if(!state||state.paused)return;
  const now=Date.now(),stored=await this.ctx.storage.list<any>({prefix:'attr:'});
  const expired=[...stored].filter(([,v])=>expiredAttribution(v,now)).map(([k])=>k);
  for(let i=0;i<expired.length;i+=128)await this.ctx.storage.delete(expired.slice(i,i+128));
  const statuses=await this.ctx.storage.list<any>({prefix:'activity-project:'});
  const selected=activityHistoryProjects(state,[...statuses.values()],now);if(!selected.length)return;
  const source=cloudMalvaClient(this.db()),listed=await source.read('tracking_list_projects',{});
  let checked=0,matched=0,failed=0,itemsSeen=0;const codes:Record<string,number>={};
  for(const selectedProject of selected){
   if(!(await this.setting()).enabled)break;
   const prior:any=statuses.get('activity-project:'+selectedProject.id);
   const project=listed.items?.find((x:any)=>x.id===selectedProject.id&&x.name===selectedProject.name);
   try{
    if(!project)throw Object.assign(Error('ACTIVITY_PROJECT_IDENTITY'),{code:'ACTIVITY_PROJECT_IDENTITY'});
    const result=await collectActivityHistory(source,project,prior);
    if(!(await this.setting()).enabled)break;
    for(let i=0;i<result.events.length;i+=128)await this.ctx.storage.put(Object.fromEntries(result.events.slice(i,i+128).map((e:any)=>['attr:'+e.key,e])));
    const {events,...status}=result;await this.ctx.storage.put('activity-project:'+project.id,status);
    checked++;itemsSeen+=events.length;matched+=events.filter((e:any)=>!!e.actor).length;
   }catch(error:any){
    failed++;const code=/^[A-Z_]+$/.test(error?.code||'')?error.code:'ACTIVITY_HISTORY_READ_FAILED';codes[code]=(codes[code]||0)+1;
    // Preserve the last good events and cursor on failure; no six-hour negative cache.
    await this.ctx.storage.put('activity-project:'+selectedProject.id,{...prior,project:selectedProject.id,checkedAt:new Date().toISOString(),error:code});
   }
  }
  const all=await this.ctx.storage.list<any>({prefix:'attr:'});
  const overflow=[...all].sort(([,a],[,b])=>Date.parse(b.at||b.checkedAt)-Date.parse(a.at||a.checkedAt)).slice(activityHistoryPolicy.maxEntries).map(([k])=>k);
  for(let i=0;i<overflow.length;i+=128)await this.ctx.storage.delete(overflow.slice(i,i+128));
  const progress=await this.ctx.storage.list<any>({prefix:'activity-project:'});
  await this.ctx.storage.put('attributionStatus',{at:new Date().toISOString(),version:activityHistoryPolicy.version,projects:checked,checked,matched,failed,itemsSeen,codes,limited:overflow.length>0,known:all.size-overflow.length,coverage:[...progress.values()]});
 }
 /** Mac companion summaries built from the central state this pulse already read; served from this object, never re-reading the central. */
 private async storeCompanion(state:any,shadow:any[]=[]){
  if(!state)return;
  const shadowStatus=await this.ctx.storage.get<any>('shadowStatus'),shadowDay=shadowStatus?.day||shadowLocalDay(Date.now()),accountsPanel=await this.ctx.storage.get<any>('accountsPanel'),first24h=(await this.ctx.storage.get<any>('first24h'))?.boards||[];
  const accounts=accountsPanel?{generatedAt:accountsPanel.generatedAt,metaConnected:accountsPanel.metaConnected,metaError:accountsPanel.metaError,counts:accountsPanel.counts,
   rows:(accountsPanel.rows||[]).filter((r:any)=>r.status==='active'||r.alerts?.length).slice(0,80).map((r:any)=>({accountId:r.accountId,name:r.name,group:r.group,status:r.status,statusLabel:r.statusLabel,runningLabel:r.runningLabel,projects:r.projects,currency:r.currency,dailyLimit:r.dailyLimit,limitSource:r.limitSource,todaySpend:r.todaySpend,usedPct:r.usedPct,balance:r.balance,alerts:r.alerts}))}:null;
  const list=await this.ctx.storage.list<any>({prefix:'attr:'}),attributions=usableAttributions([...list.values()]),runtime=await this.setting();
  const executor={...runtime,paused:!!state.paused},withAuthors={...state,changeAttributions:attributions},now=Date.now(),out:Record<string,any>={};
  // Display only (lib/meta-display.mjs): the Malva live rows with the Meta read on top; today's numbers and the details
  // of the notch follow them, the queue and every decision keep the analysis.
  const live:any=overlayMetaItems(this.liveItems||[],await this.ctx.storage.get<any>('metaLive'),{now}),todayState=liveTodayState(withAuthors,live,{now}),liveRows=liveRowIndex(live,{now}),board=projectBoard(withAuthors,now,{live:live as never[],todayState});
  for(const project of ['all',...Object.keys(state.config||{})])out['companion:'+project]={...companionSummary(withAuthors,{project,now,executor:executor as any,board:board as any,live:live as never[],todayState,liveRows}),storage:this.storagePressure,shadow:shadowSummary(shadow,{project,day:project==='all'?shadowDay:shadowStatus?.days?.[project]||shadowDay,days:project==='all'?shadowStatus?.days||null:null,pulseAt:shadowStatus?.failed?null:shadowStatus?.at||null}),first24h:first24hSummary(first24h,{project}),accounts:project==='all'?accounts:accounts&&{...accounts,rows:accounts.rows.filter((r:any)=>r.projects.includes(state.config[project]?.projectName))}};
  await this.ctx.storage.put(out);
  await this.phoneAlerts(out['companion:all']).catch(()=>{});
 }
 /** iPhone alerts (lib/phone-alerts.mjs): off without both Pushover secrets; one run at a time so nothing rings twice. */
 private phoneBusy=false;
 private async phoneAlerts(summary:any){
  const token=this.env.PUSHOVER_TOKEN,user=this.env.PUSHOVER_USER;
  if(!summary||!token||!user||this.phoneBusy)return;
  this.phoneBusy=true;
  try{const r=await deliverPhoneAlerts({summary,ledger:await this.ctx.storage.get<any>('phoneAlerts'),credentials:{token,user}});await this.ctx.storage.put('phoneAlerts',r.ledger);}
  finally{this.phoneBusy=false;}
 }
 private async assertEnabled(){if(!(await this.setting()).enabled){const error:any=new Error('CLOUD_EXECUTOR_PAUSED');error.code='CLOUD_EXECUTOR_PAUSED';throw error;}}
 private engine(){const source=cloudMalvaClient(this.db());return createCloudEngine({read:()=>this.read(),write:(fn:any)=>this.write(fn),source:{read:source.read,dispatch:async(command:any,execution:any)=>{await this.assertEnabled();return source.dispatch(command,execution);}},ai:this.env.AI,modelPolicy:cloudProductionModelPolicy,prepareGuard:async(s:any,args:any)=>{await this.assertEnabled();return assertCurrentExecutionContingency(s,args);},ops:{creativeItems:async(s:any,projectId:string)=>syncCloudCreatives({db:this.db(),state:s,projectId,source:cloudOrbitaClient(this.db()),malva:source,expectedEmail:this.env.BUNKER_OWNER_EMAIL,expectedWorkspace:(await this.setting()).check?.workspaceId,readCurrent:async()=>{const current=(await this.read()).state;await this.assertEnabled();return current;}}),liveItems:async(s:any)=>(await readLiveData(this.db(),s)).items,claimBatch,updateRun,importBundle:(s:any,b:any)=>apply(s,{op:'import',bundle:b}),answer:(s:any,id:string,text:string)=>{const m=s.messages.find((m:any)=>m.id===id);if(!m)throw Error('CLOUD_QUESTION_MISSING');return answerOfficeMessage(m,text,new Date().toISOString());}}});}
 /** One executor unit into the runtime history (heavy pulse and fast lane alike). */
 private async recordUnit(result:any){const at=new Date().toISOString(),latest=await this.setting();await this.ctx.storage.put('runtime',{...latest,lastUnitAt:at,lastResult:result,lastError:null,lastErrorDetail:null,history:[{at,...result},...(latest.history||[])].slice(0,30)});}
 /** A receipt that changed stage (order queued, sent, confirmed or failed) reaches the notch without waiting. */
 private async publishOrders(state:any){const o=orderPulse(await this.ctx.storage.get<any>('syncPulse'),ownerOrderReceipts(state,{now:Date.now()}),await this.ctx.storage.get<string>('ordersSig'));await this.ctx.storage.put(o.pulse?{ordersSig:o.sig,syncPulse:o.pulse}:{ordersSig:o.sig});}
 /** A fresh live read changed what the notch shows (status, budget): move the pulse without a toast (no campaign). */
 private async bumpLive(projects:string[]){const prev=await this.ctx.storage.get<any>('syncPulse');await this.ctx.storage.put('syncPulse',{...(prev||{}),version:(prev?.version||0)+1,at:new Date().toISOString(),projects,last:{kind:'live',projects,at:new Date().toISOString()}});}
 private lastWatchAt=0;
 private lastOrderSweepAt=0;
 /** Single flight: the timer during a long heavy unit and the unit boundaries share one running fast lane. */
 private laneRun:Promise<void>|null=null;
 private runLane():Promise<void>{
  if(!this.laneRun)this.laneRun=this.fastLane().catch(()=>{}).finally(()=>{this.laneRun=null;});
  return this.laneRun;
 }
 /** Set when the fast lane ran an order unit: the heavy pulse then rebuilds the notch from a fresh central read. */
 private laneExecuted=false;
 /**
  * Fast lane (owner request of 2026-11-08: "quando eu executo a ação no notch demora muito" / "demora pra reconhecer a
  * mudança de status"). Runs at the start of every alarm and between the heavy pulse's units, so a long pulse (model
  * stages, six live reads) no longer freezes it: the 15 s edit watch; an owner order the route woke us for, through the
  * same engine step as the heavy pulse (claim → prepare → submit once → confirm; only verify/followUp/execution work,
  * never a model call, never a second executor); then a live reread of only the touched projects, or of the stalest one.
  */
 private async fastLane(){
  this.laneOrderRan=false;
  try{await this.fastLaneWork();}
  // The Meta read runs after the lane's own work, every minute, and at once after an owner order went through it.
  finally{await this.metaTick(this.laneOrderRan).catch(()=>{});}
 }
 private laneOrderRan=false;
 private async fastLaneWork(){
  if(!(await this.setting()).enabled)return;
  const wake=await this.ctx.storage.get<any>('wake'),watchDue=Date.now()-this.lastWatchAt>=changeWatchPolicy.tickMs;
  // Order work belongs to the fast lane only (the heavy pulse skips it): a wake, or a sweep each minute for orders
  // approved elsewhere (web) and for follow-ups.
  const orderDue=!!wake?.order||Date.now()-this.lastOrderSweepAt>=changeWatchPolicy.heavyMs;
  if(!wake&&!watchDue&&!orderDue)return;
  const touched=new Set<string>();
  if(watchDue){this.lastWatchAt=Date.now();for(const p of await this.watchChanges().catch(()=>[] as string[]))touched.add(p);}
  let ran=false;
  if(wake){await this.ctx.storage.delete('wake');for(const p of Array.isArray(wake.projects)?wake.projects:[])touched.add(p);}
  if(orderDue){
   this.lastOrderSweepAt=Date.now();
   for(let n=0;n<changeWatchPolicy.fastUnits;n++){
    if(!(await this.setting()).enabled)break;
    let result:any;try{result=await this.engine().step({only:fastLaneKinds});}catch(e:any){await this.ctx.storage.put('runtime',runtimeFailure(await this.setting(),e));break;}
    if(['idle','blocked'].includes(result.kind))break;
    ran=true;this.laneExecuted=true;this.laneOrderRan=true;await this.recordUnit({...result,lane:'fast'});if(result.project)touched.add(result.project);
   }
  }
  // The stalest live project always joins the reads once it is older than liveStaleMs, also when edits keep arriving
  // elsewhere: measured on 08/11, busy projects were reread again and again while two quiet ones waited ~9 min.
  const stale=Object.entries(this.liveReadAt).filter(([id])=>!touched.has(id)).sort((a,b)=>a[1]-b[1])[0];
  const extra=stale&&Date.now()-stale[1]>=changeWatchPolicy.liveStaleMs?stale[0]:null;
  if(extra)this.liveReadAt[extra]=Date.now();   // one try per stale window, even when the read fails
  const reads=[...[...touched].slice(0,changeWatchPolicy.maxLiveReads),...(extra?[extra]:[])];
  if(!reads.length)return;
  if(touched.size){
   const central=await this.read();if(central.state.paused)return;
   if(this.freshChanges.length||ran){await this.storeCompanion(central.state,await this.storedShadow()).catch(()=>{});await this.bumpPulse();this.freshChanges=[];await this.publishOrders(central.state);}
  }
  const liveState=await this.syncLive(reads,true).catch(()=>null);
  // The "Primeiras 24h" board is rebuilt from this read before the notch summary that embeds it (owner report of 08/11:
  // test campaigns paused from the notch stayed on that board until the next heavy pulse). Pure: no model, no provider.
  if(liveState){await this.storeFirst24h(liveState).catch(()=>{});await this.storeCompanion(liveState,await this.storedShadow()).catch(()=>{});await this.publishOrders(liveState);await this.bumpLive(reads);}
 }
 async fetch(request:Request){
  let input:any;try{input=await request.json();}catch{return Response.json({error:'Pedido inválido.'},{status:400});}
  const runtime=await this.setting();
  if(input.action==='pulse'){const pulse=await this.ctx.storage.get<any>('syncPulse'),watch=await this.ctx.storage.get<any>('watchStatus');return Response.json({pulse:pulse||{version:0,at:null,last:null},watchedAt:watch?.at||null});}
  // Read-only: the last Meta read while it is still fresh enough to show (lib/meta-display.mjs), for the web's live rows.
  if(input.action==='metaLive'){const meta=freshMeta(await this.ctx.storage.get<any>('metaLive'));return Response.json({meta:meta?{at:new Date(meta.at).toISOString(),items:meta.items}:null});}
  if(input.action==='companion'){const project=typeof input.project==='string'&&input.project?input.project:'all',key='companion:'+project;const summary:any=await this.ctx.storage.get(key);
   // Sales arrive between pulses (webhook): merged at read time so the notch sees them at once.
   return Response.json(summary?{summary:{...summary,sales:salesView(await this.ctx.storage.get<any[]>('salesFeed'),{project,now:Date.now()})}}:{summary:null});}
  if(input.action==='sale'){
   const v=input.sale,ok=v&&typeof v==='object'&&typeof v.amount==='number'&&Number.isFinite(v.amount)&&v.amount>0&&v.amount<=1e7&&typeof v.at==='string'&&Number.isFinite(Date.parse(v.at));
   if(!ok)return Response.json({error:'Venda inválida.'},{status:400});
   const t=(x:any,n:number)=>typeof x==='string'?x.slice(0,n):null;
   const sale={amount:v.amount,currency:t(v.currency,3),product:t(v.product,120),campaign:t(v.campaign,120),project:t(v.project,80),at:new Date(Date.parse(v.at)).toISOString(),orderRef:t(v.orderRef,32)};
   // Only a configured Bunker project (the Meta projects of the last heavy pulse) receives sales; an unknown or missing
   // project, or a sale that cannot be deduplicated, is refused instead of shown everywhere.
   const configured=await this.ctx.storage.get<string[]>('watchConfig');
   if(!sale.project||!Array.isArray(configured)||!configured.includes(sale.project))return Response.json({ok:false,refused:'projeto não configurado no Bunker'});
   if(!sale.orderRef)return Response.json({ok:false,refused:'pedido sem identificação'});
   const out=addSale(await this.ctx.storage.get<any[]>('salesFeed'),sale);
   if(out.added){const prev=await this.ctx.storage.get<any>('syncPulse');await this.ctx.storage.put({salesFeed:out.list,syncPulse:{...(prev||{}),version:(prev?.version||0)+1,at:new Date().toISOString(),last:{kind:'sale',project:sale.project,campaign:sale.campaign,product:sale.product,amount:sale.amount,currency:sale.currency,at:sale.at}}});}
   return Response.json({ok:true,added:out.added});
  }
  if(input.action==='accounts'){const panel=await this.ctx.storage.get<any>('accountsPanel');return Response.json(panel?{panel}:{panel:null});}
  if(input.action==='shadow'){
   const status=await this.ctx.storage.get<any>('shadowStatus'),all=[...(await this.ctx.storage.list<any>({prefix:'shadow:'})).values()];
   const asked=typeof input.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.day)?input.day:null,day=asked||status?.day;
   // Without an explicit day, each project's "hoje" is its own local day (shadowStatus.days).
   const dayOf=(e:any)=>asked||(typeof status?.days?.[e.project]==='string'?status.days[e.project]:day);
   const entries=all.filter((e:any)=>!dayOf(e)||e.day===dayOf(e)).sort((a:any,b:any)=>Date.parse(a.firstAt)-Date.parse(b.firstAt)).slice(0,300).map((e:any)=>({rule:e.rule,project:e.projectName,account:e.accountName,adAccountId:e.adAccountId,objectId:e.objectId,campaign:e.name,action:e.action,before:e.before,after:e.after,reason:e.reason,launchDay:e.launchDay,newCampaign:e.newCampaign||null,metrics:e.metrics,firstAt:e.firstAt,firstWouldExecuteAt:e.firstWouldExecuteAt,lastAt:e.lastAt,blockedBy:e.blockedBy,manager:e.manager,
    // Same fields as the notch's recent list: an owner action, the next-day grade and the rule label stay visible here.
    ruleLabel:e.ruleLabel||null,limitations:e.limitations??null,owner:e.owner||null,grade:e.grade||null}));
   const first24h=await this.ctx.storage.get<any>('first24h'),meta=await this.ctx.storage.get<any>('metaLive');
   return Response.json({status:status||null,summary:shadowSummary(all,{day}),entries,first24h:first24h?{at:first24h.at,boards:first24h.boards}:null,metaLive:meta?{at:meta.at||null,requested:meta.requested??null,read:meta.read??null,requests:meta.requests??null,accounts:meta.accounts??null,unlinked:meta.unlinked??null,fields:meta.fields||null,diagnostic:meta.diagnostic||null,skipped:Object.keys(meta.skip||{}).length,errors:meta.errors||[],error:meta.error||null,failedAt:meta.failedAt||null}:null});
  }
  if(input.action==='attribution'){const list=await this.ctx.storage.list<any>({prefix:'attr:'}),status=await this.ctx.storage.get('attributionStatus');return Response.json({items:usableAttributions([...list.values()]),pending:[...list.values()].filter((v:any)=>!v.matched).length,status:status||null});}
  if(input.action==='status'){const attribution=await this.ctx.storage.get('attributionStatus'),watch=await this.ctx.storage.get<any>('watchStatus'),pulse=await this.ctx.storage.get<any>('syncPulse'),phone=await this.ctx.storage.get<any>('phoneAlerts');return Response.json({...runtime,phone:{configured:!!(this.env.PUSHOVER_TOKEN&&this.env.PUSHOVER_USER),primed:!!phone?.primed,sent:phone?.sent||0,lastSentAt:phone?.lastSentAt||null,lastError:phone?.lastError||null,lastErrorAt:phone?.lastErrorAt||null},attribution:attribution||null,watch:watch?{...watch,pulseVersion:pulse?.version??0,pulseAt:pulse?.at??null}:null,running:this.running,host:'cloudflare',model:CLOUD_MODEL,modelLabel:cloudModelPolicy(cloudProductionModelPolicy).label,paused:this.centralView?.paused??null,cadence:this.centralView?.cadence??null,controlReadAt:this.centralView?.at||null,independentOfDesktop:true});}
  if(input.action==='check'){
   const started=Date.now();const results=await Promise.allSettled([this.engine().identity(),checkCloudModel(this.env.AI)]);
   const identity=results[0],model=results[1],malva=identity.status==='fulfilled',ai=model.status==='fulfilled'&&model.value===true;
   const who=malva?identity.value.who:null;const error=!malva&&identity.status==='rejected'&&/^[A-Z_]{3,80}$/.test(identity.reason?.code||'')?identity.reason.code:!malva?'CLOUD_MALVA_UNAVAILABLE':!ai?'CLOUD_AI_UNAVAILABLE':null;
   const check={at:new Date().toISOString(),malva,ai,ads:!!who?.platforms.some((p:any)=>p.platform==='tracking'&&p.ads),workspaceId:who?.workspace.id||null,projects:malva?identity.value.projects.map((p:any)=>({id:p.id,name:p.name})):[],durationMs:Date.now()-started,...(error?{error}:{})};
   const latest=await this.setting();await this.ctx.storage.put('runtime',{...latest,check,lastError:error});return Response.json(error?{error,check}:{ok:true,check},{status:error?503:200});
  }
  if(input.action==='enable'){
   if(!runtime.check?.malva||!runtime.check?.ai||Date.now()-Date.parse(runtime.check.at)>300000)return Response.json({error:'Confira a conexão antes de ativar.'},{status:409});
   await this.ctx.storage.put('runtime',{...runtime,enabled:true,lastError:null});await this.ctx.storage.setAlarm(Date.now()+1000);return Response.json({ok:true,enabled:true});
  }
  if(input.action==='pause'){await this.ctx.storage.put('runtime',{...runtime,enabled:false});await this.ctx.storage.deleteAlarm();return Response.json({ok:true,enabled:false});}
  if(input.action==='wake'){
   // Owner route after a signed order/decision: only a flag and an early alarm in this same object (no new executor).
   const projects=(Array.isArray(input.projects)?input.projects:[]).filter((p:any)=>typeof p==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(p)).slice(0,6);
   const prev=await this.ctx.storage.get<any>('wake');
   await this.ctx.storage.put('wake',{order:input.order===true||prev?.order===true,projects:[...new Set([...(prev?.projects||[]),...projects])].slice(0,6),at:new Date().toISOString()});
   if(runtime.enabled&&!this.running)await this.ctx.storage.setAlarm(Date.now()+300);
   return Response.json({ok:true,queued:runtime.enabled,running:this.running});
  }
  if(input.action==='tick'){
   if(runtime.enabled&&!this.running){await this.ctx.storage.setAlarm(Date.now()+1000);return Response.json({ok:true,queued:true});}return Response.json({ok:true,queued:false,enabled:runtime.enabled});
  }
  return Response.json({error:'Ação inválida.'},{status:400});
 }
 async alarm(){
  if(this.running)return;let setting=await this.setting();if(!setting.enabled)return;this.running=true;
  let laneTimer:any=null;
  try{
   // Every alarm: the fast lane (edit watch, woken owner orders, touched/stale live reads). A failure never blocks the pulse.
   await this.runLane();
   // The lane does network I/O: an owner pause sent meanwhile must win over the copy read before it.
   setting=await this.setting();if(!setting.enabled)return;
   const lastHeavy=await this.ctx.storage.get<number>('lastHeavyAt')||0;
   if(Date.now()-lastHeavy<changeWatchPolicy.heavyMs)return;
   const lane=()=>this.runLane();
   // During the heavy pulse the fast lane also runs on a timer, so a long model unit no longer holds back an owner
   // order or a status read. Same object and alarm; writes are serialized; the timer stops before the alarm ends.
   laneTimer=setInterval(()=>{void this.runLane();},changeWatchPolicy.laneMs);
   await this.ctx.storage.put('lastHeavyAt',Date.now());
   // A fresh read: the lane's history entries and a concurrent check result are kept, never overwritten.
   await this.ctx.storage.put('runtime',{...(await this.setting()),lastPulseAt:new Date().toISOString()});const engine=this.engine();
   // Bounded work prevents one large project from owning a whole alarm forever.
   try{
   const started=Date.now();for(let n=0;n<4&&Date.now()-started<90000;n++){
    setting=await this.setting();if(!setting.enabled)break;
    let result:any;
    try{result=await engine.step({skip:fastLaneKinds});}
    catch(e:any){
     // A rejected model format was already recorded as one attempt of that stage (cap 3, with correction feedback):
     // retry it in this pulse instead of waiting for the next one. Anything else still ends the pulse.
     if(e?.code==='CLOUD_AI_INVALID'&&e?.attemptRecorded===true){await this.ctx.storage.put('runtime',runtimeFailure(await this.setting(),e));continue;}
     throw e;
    }
    await this.recordUnit(result);
    if(['idle','blocked'].includes(result.kind))break;
    await lane();
   }
   }catch(e:any){const latest=await this.setting();await this.ctx.storage.put('runtime',runtimeFailure(latest,e));}
   // A rejected model opinion must not starve live reads, edit authors or the notch.
   await lane();this.laneExecuted=false;
   const liveState=(await this.setting()).enabled?await this.syncLive():null;
   await lane();
   if(liveState)await this.ctx.storage.put('watchConfig',Object.keys(liveState.config||{}));
   // Optional attribution never turns into an executor failure.
   if(liveState&&(await this.setting()).enabled)await this.syncAttribution(liveState).catch(async()=>{await this.ctx.storage.put('attributionStatus',{at:new Date().toISOString(),failed:true});});
   // The account panel is optional: a failure keeps the last panel and never affects the executor.
   await lane();
   if(liveState&&(await this.setting()).enabled)await this.syncAccounts(liveState).catch(()=>{});
   await lane();
   // The live Meta read is optional: a failure keeps the last read and never affects the executor.
   if(liveState&&(await this.setting()).enabled)await this.syncMetaLive(liveState).catch(()=>{});
   // Shadow mode is observation only: a failure is recorded and never affects the executor or the notch.
   const shadow=liveState?await this.storeShadow(liveState).catch(async(e:any)=>{await this.ctx.storage.put('shadowStatus',{at:new Date().toISOString(),day:shadowLocalDay(Date.now()),failed:true,code:/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'SHADOW_FAILED'});return [];}):[];
   // The first-24h board is a reading aid: a failure keeps the last board and never affects the executor.
   if(liveState)await this.storeFirst24h(liveState).catch(()=>{});
   // An order the fast lane sent after this pulse's read must not be shown at its older stage.
   const view=liveState&&this.laneExecuted?(await this.read()).state:liveState;
   if(view)await this.storeCompanion(view,shadow).catch(()=>{});
   await this.bumpPulse();this.freshChanges=[];
   // This pulse's own live reads may have changed a status or budget the notch shows.
   if(view)await this.bumpLive([]);
   if(view)await this.publishOrders(view);
  }catch(e:any){const latest=await this.setting();await this.ctx.storage.put('runtime',runtimeFailure(latest,e));}
  finally{if(laneTimer)clearInterval(laneTimer);await this.laneRun;this.running=false;const latest=await this.setting();if(latest.enabled)await this.ctx.storage.setAlarm(Date.now()+changeWatchPolicy.tickMs);}
 }
}
