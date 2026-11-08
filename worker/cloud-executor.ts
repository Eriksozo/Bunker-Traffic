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
import {evaluateShadow,mergeShadow,shadowOutcomes,shadowSummary,shadowPolicy} from '../lib/autonomy-shadow.mjs';
import {activityLog} from '../lib/campaign-activity.mjs';
import {buildAccountPanel,readMetaAccounts,accountPanelPolicy,runningAccounts} from '../lib/account-limits.mjs';
import {pendingLiveRefresh} from '../lib/owner-applied.mjs';
import {changeWatchPolicy,watchProject,nextPulse,liveOrder} from '../lib/change-watch.mjs';

type Runtime={enabled:boolean;lastPulseAt?:string;lastUnitAt?:string;lastError?:string|null;lastErrorDetail?:string|null;lastResult?:any;check?:any;history?:any[]};
export class BunkerCloudExecutor extends DurableObject<any>{
 private running=false;
 private centralView:any=null;
 private liveItems:any[]=[];
 private async setting():Promise<Runtime>{return await this.ctx.storage.get<Runtime>('runtime')||{enabled:false,history:[]};}
 private db(){return new SupabaseStorage({url:this.env.SUPABASE_URL,key:this.env.SUPABASE_SERVICE_ROLE_KEY});}
 private async read(){const current=await readPersistedState(this.db(),empty);this.centralView={paused:current.state.paused,cadence:current.state.cadence,at:new Date().toISOString()};return current;}
 private async write(fn:(s:any,revision:number)=>any){
  const current=await this.read();const result=await fn(current.state,current.revision);await commitPersistedState(this.db(),current.state,current.revision);return result;
 }
 private async syncLive(first:string[]=[]):Promise<any>{
  const current=await this.read();if(current.state.paused)return null;const source=cloudMalvaClient(this.db()),listed=await source.read('tracking_list_projects',{});const live=await readLiveData(this.db(),current.state);
  // The shadow reuses this pulse's live reads: no extra central or Supabase read.
  const fresh:Record<string,any>={};
  // Owner "Já fiz" reports jump the queue: their project is read first, then the oldest reads as before.
  const lastSuccess=Object.fromEntries((live.items||[]).map((i:any)=>[i.projectId,i.lastSuccessAt]));
  const urgent=pendingLiveRefresh(current.state,lastSuccess);
  const projects=liveOrder(live.projects,{first,urgent,lastSuccess});
  for(const p of projects){const project=listed.items?.find((x:any)=>x.id===p.projectId&&x.name===p.projectName);if(!project)continue;try{const cut=await collectCloudProject(source,project,{purpose:'live',levels:['campaign'],periodsWanted:['today'],tracked:trackedCloudCampaigns(current.state,p.projectId)});const latest=await this.read();if(latest.state.paused)break;const before=await readLiveData(this.db(),latest.state,p.projectId);await liveDataAction(this.db(),latest.state,{action:'import',projectId:p.projectId,snapshot:cut.snapshots[0],expectedRevision:before.items[0].revision},Date.now(),'cloudflare');if(p.projectId)fresh[p.projectId]={projectId:p.projectId,snapshot:cut.snapshots[0]};}catch(e:any){const latest=await this.read();if(latest.state.paused||!(await this.setting()).enabled)break;const before=await readLiveData(this.db(),latest.state,p.projectId);const code=/^[A-Z][A-Z0-9_]{0,59}$/.test(e.code||'')?e.code:'CLOUD_LIVE_FAILED';await liveDataAction(this.db(),latest.state,{action:'failure',projectId:p.projectId,expectedRevision:before.items[0].revision,error:{code,message:'A consulta na nuvem não confirmou uma nova leitura. Última fonte válida preservada.'}},Date.now(),'cloudflare');}}
  this.liveItems=(live.items||[]).map((i:any)=>fresh[i.projectId]||i);
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
  const prior=[...(await this.ctx.storage.list<any>({prefix:'shadow:'})).values()];
  let decisions:any[]=[],day:string|null=null;const skipped:Record<string,string>={};
  for(const project of Object.keys(state.config||{})){
   const params=policy?.projects?.[project];if(!params||params.enabled===false)continue;
   const out=evaluateShadow(state,{project,liveItem:(this.liveItems||[]).find((i:any)=>i.projectId===project)||null,events,params,now});
   if(out.skipped)skipped[project]=out.skipped;decisions=decisions.concat(out.decisions);day=day||out.day||null;
  }
  const merged=shadowOutcomes(mergeShadow(prior,decisions,{now,day:day||new Date(now).toISOString().slice(0,10)}),events);
  const keep=new Set(merged.map((e:any)=>'shadow:'+e.id)),stale=prior.map((e:any)=>'shadow:'+e.id).filter((k:string)=>!keep.has(k));
  const before=new Map(prior.map((e:any)=>[e.id,JSON.stringify(e)]));
  const entries=merged.filter((e:any)=>before.get(e.id)!==JSON.stringify(e)).map((e:any)=>['shadow:'+e.id,e] as [string,any]);
  for(let i=0;i<entries.length;i+=100)await this.ctx.storage.put(Object.fromEntries(entries.slice(i,i+100)));
  for(let i=0;i<stale.length;i+=128)await this.ctx.storage.delete(stale.slice(i,i+128));
  await this.ctx.storage.put('shadowStatus',{at:new Date(now).toISOString(),version:shadowPolicy.version,day,projects:Object.keys(policy?.projects||{}),evaluated:decisions.length,stored:merged.length,skipped});
  return merged;
 }
 /**
  * Ad-account panel (docs/connections.md): Malva accounts per configured project plus the daily spending
  * limit Meta reports, read with a dedicated read-only token. Every 30 minutes; stored here, not in the central.
  */
 private async syncAccounts(state:any){
  if(!state||state.paused)return;
  const prior=await this.ctx.storage.get<any>('accountsPanel');
  if(prior?.version===accountPanelPolicy.version&&Date.now()-Date.parse(prior.generatedAt)<accountPanelPolicy.refreshMs)return;
  const source=cloudMalvaClient(this.db()),projects:any[]=[],projectErrors:Record<string,string>={};
  for(const [id,c] of Object.entries<any>(state.config||{})){
   try{const r:any=await source.read('tracking_ad_accounts',{projectId:id});projects.push({id,name:c?.projectName||id,items:Array.isArray(r?.items)?r.items:[]});}
   catch(e:any){projectErrors[c?.projectName||id]=/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'MALVA_ACCOUNTS_FAILED';}
  }
  let meta:any[]|null=null,metaError:string|null=null;
  try{meta=await readMetaAccounts(fetch,this.env.META_ACCOUNTS_TOKEN||'',{version:this.env.META_GRAPH_VERSION||accountPanelPolicy.graphVersion});}
  catch(e:any){metaError=/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'META_FAILED';}
  await this.ctx.storage.put('accountsPanel',{...buildAccountPanel({projects,running:runningAccounts(state),meta,metaError}),projectErrors});
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
  const shadowDay=(await this.ctx.storage.get<any>('shadowStatus'))?.day||undefined,accountsPanel=await this.ctx.storage.get<any>('accountsPanel');
  const accounts=accountsPanel?{generatedAt:accountsPanel.generatedAt,metaConnected:accountsPanel.metaConnected,metaError:accountsPanel.metaError,counts:accountsPanel.counts,
   rows:(accountsPanel.rows||[]).filter((r:any)=>r.status==='active'||r.alerts?.length).slice(0,80).map((r:any)=>({accountId:r.accountId,name:r.name,group:r.group,status:r.status,statusLabel:r.statusLabel,runningLabel:r.runningLabel,projects:r.projects,currency:r.currency,dailyLimit:r.dailyLimit,todaySpend:r.todaySpend,usedPct:r.usedPct,balance:r.balance,alerts:r.alerts}))}:null;
  const list=await this.ctx.storage.list<any>({prefix:'attr:'}),attributions=usableAttributions([...list.values()]),runtime=await this.setting();
  const executor={...runtime,paused:!!state.paused},withAuthors={...state,changeAttributions:attributions},now=Date.now(),out:Record<string,any>={},board=projectBoard(withAuthors,now);
  for(const project of ['all',...Object.keys(state.config||{})])out['companion:'+project]={...companionSummary(withAuthors,{project,now,executor:executor as any,board:board as any}),shadow:shadowSummary(shadow,{project,day:shadowDay}),accounts:project==='all'?accounts:accounts&&{...accounts,rows:accounts.rows.filter((r:any)=>r.projects.includes(state.config[project]?.projectName))}};
  await this.ctx.storage.put(out);
 }
 private async assertEnabled(){if(!(await this.setting()).enabled){const error:any=new Error('CLOUD_EXECUTOR_PAUSED');error.code='CLOUD_EXECUTOR_PAUSED';throw error;}}
 private engine(){const source=cloudMalvaClient(this.db());return createCloudEngine({read:()=>this.read(),write:(fn:any)=>this.write(fn),source:{read:source.read,dispatch:async(command:any,execution:any)=>{await this.assertEnabled();return source.dispatch(command,execution);}},ai:this.env.AI,modelPolicy:cloudProductionModelPolicy,prepareGuard:async(s:any,args:any)=>{await this.assertEnabled();return assertCurrentExecutionContingency(s,args);},ops:{creativeItems:async(s:any,projectId:string)=>syncCloudCreatives({db:this.db(),state:s,projectId,source:cloudOrbitaClient(this.db()),malva:source,expectedEmail:this.env.BUNKER_OWNER_EMAIL,expectedWorkspace:(await this.setting()).check?.workspaceId,readCurrent:async()=>{const current=(await this.read()).state;await this.assertEnabled();return current;}}),liveItems:async(s:any)=>(await readLiveData(this.db(),s)).items,claimBatch,updateRun,importBundle:(s:any,b:any)=>apply(s,{op:'import',bundle:b}),answer:(s:any,id:string,text:string)=>{const m=s.messages.find((m:any)=>m.id===id);if(!m)throw Error('CLOUD_QUESTION_MISSING');return answerOfficeMessage(m,text,new Date().toISOString());}}});}
 async fetch(request:Request){
  let input:any;try{input=await request.json();}catch{return Response.json({error:'Pedido inválido.'},{status:400});}
  const runtime=await this.setting();
  if(input.action==='pulse'){const pulse=await this.ctx.storage.get<any>('syncPulse'),watch=await this.ctx.storage.get<any>('watchStatus');return Response.json({pulse:pulse||{version:0,at:null,last:null},watchedAt:watch?.at||null});}
  if(input.action==='companion'){const key='companion:'+(typeof input.project==='string'&&input.project?input.project:'all');const summary=await this.ctx.storage.get(key);return Response.json(summary?{summary}:{summary:null});}
  if(input.action==='accounts'){const panel=await this.ctx.storage.get<any>('accountsPanel');return Response.json(panel?{panel}:{panel:null});}
  if(input.action==='shadow'){
   const status=await this.ctx.storage.get<any>('shadowStatus'),all=[...(await this.ctx.storage.list<any>({prefix:'shadow:'})).values()];
   const day=typeof input.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.day)?input.day:status?.day;
   const entries=all.filter((e:any)=>!day||e.day===day).sort((a:any,b:any)=>Date.parse(a.firstAt)-Date.parse(b.firstAt)).slice(0,300).map((e:any)=>({rule:e.rule,project:e.projectName,account:e.accountName,adAccountId:e.adAccountId,objectId:e.objectId,campaign:e.name,action:e.action,before:e.before,after:e.after,reason:e.reason,launchDay:e.launchDay,metrics:e.metrics,firstAt:e.firstAt,firstWouldExecuteAt:e.firstWouldExecuteAt,lastAt:e.lastAt,blockedBy:e.blockedBy,manager:e.manager}));
   return Response.json({status:status||null,summary:shadowSummary(all,{day}),entries});
  }
  if(input.action==='attribution'){const list=await this.ctx.storage.list<any>({prefix:'attr:'}),status=await this.ctx.storage.get('attributionStatus');return Response.json({items:usableAttributions([...list.values()]),pending:[...list.values()].filter((v:any)=>!v.matched).length,status:status||null});}
  if(input.action==='status'){const attribution=await this.ctx.storage.get('attributionStatus');return Response.json({...runtime,attribution:attribution||null,running:this.running,host:'cloudflare',model:CLOUD_MODEL,modelLabel:cloudModelPolicy(cloudProductionModelPolicy).label,paused:this.centralView?.paused??null,cadence:this.centralView?.cadence??null,controlReadAt:this.centralView?.at||null,independentOfDesktop:true});}
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
  if(input.action==='tick'){
   if(runtime.enabled&&!this.running){await this.ctx.storage.setAlarm(Date.now()+1000);return Response.json({ok:true,queued:true});}return Response.json({ok:true,queued:false,enabled:runtime.enabled});
  }
  return Response.json({error:'Ação inválida.'},{status:400});
 }
 async alarm(){
  if(this.running)return;let setting=await this.setting();if(!setting.enabled)return;this.running=true;
  try{
   // Every tick: the cheap edit watch. A failure never blocks the minute pulse.
   const changed=await this.watchChanges().catch(()=>[] as string[]);
   const lastHeavy=await this.ctx.storage.get<number>('lastHeavyAt')||0;
   if(Date.now()-lastHeavy<changeWatchPolicy.heavyMs){
    // Between minute pulses: only when an edit appeared. Notch first (authors already stored), then the live read.
    if(changed.length){
     const central=await this.read();if(!central.state.paused){await this.storeCompanion(central.state,await this.storedShadow()).catch(()=>{});await this.bumpPulse();
      const liveState=await this.syncLive(changed).catch(()=>null);if(liveState){await this.storeCompanion(liveState,await this.storedShadow()).catch(()=>{});await this.bumpPulse();}}
    }
    return;
   }
   await this.ctx.storage.put('lastHeavyAt',Date.now());
   await this.ctx.storage.put('runtime',{...setting,lastPulseAt:new Date().toISOString()});const engine=this.engine();
   // Bounded work prevents one large project from owning a whole alarm forever.
   try{
   const started=Date.now();for(let n=0;n<4&&Date.now()-started<90000;n++){
    setting=await this.setting();if(!setting.enabled)break;
    const result=await engine.step(),at=new Date().toISOString();const latest=await this.setting();await this.ctx.storage.put('runtime',{...latest,lastUnitAt:at,lastResult:result,lastError:null,lastErrorDetail:null,history:[{at,...result},...(latest.history||[])].slice(0,30)});
    if(['idle','blocked'].includes(result.kind))break;
   }
   }catch(e:any){const latest=await this.setting();await this.ctx.storage.put('runtime',runtimeFailure(latest,e));}
   // A rejected model opinion must not starve live reads, edit authors or the notch.
   const liveState=(await this.setting()).enabled?await this.syncLive(changed):null;
   if(liveState)await this.ctx.storage.put('watchConfig',Object.keys(liveState.config||{}));
   // Optional attribution never turns into an executor failure.
   if(liveState&&(await this.setting()).enabled)await this.syncAttribution(liveState).catch(async()=>{await this.ctx.storage.put('attributionStatus',{at:new Date().toISOString(),failed:true});});
   // The account panel is optional: a failure keeps the last panel and never affects the executor.
   if(liveState&&(await this.setting()).enabled)await this.syncAccounts(liveState).catch(()=>{});
   // Shadow mode is observation only: a failure is recorded and never affects the executor or the notch.
   const shadow=liveState?await this.storeShadow(liveState).catch(async(e:any)=>{await this.ctx.storage.put('shadowStatus',{at:new Date().toISOString(),failed:true,code:/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'SHADOW_FAILED'});return [];}):[];
   if(liveState)await this.storeCompanion(liveState,shadow).catch(()=>{});
   await this.bumpPulse();
  }catch(e:any){const latest=await this.setting();await this.ctx.storage.put('runtime',runtimeFailure(latest,e));}
  finally{this.running=false;const latest=await this.setting();if(latest.enabled)await this.ctx.storage.setAlarm(Date.now()+changeWatchPolicy.tickMs);}
 }
}
