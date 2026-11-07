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

type Runtime={enabled:boolean;lastPulseAt?:string;lastUnitAt?:string;lastError?:string|null;lastErrorDetail?:string|null;lastResult?:any;check?:any;history?:any[]};
export class BunkerCloudExecutor extends DurableObject<any>{
 private running=false;
 private centralView:any=null;
 private async setting():Promise<Runtime>{return await this.ctx.storage.get<Runtime>('runtime')||{enabled:false,history:[]};}
 private db(){return new SupabaseStorage({url:this.env.SUPABASE_URL,key:this.env.SUPABASE_SERVICE_ROLE_KEY});}
 private async read(){const current=await readPersistedState(this.db(),empty);this.centralView={paused:current.state.paused,cadence:current.state.cadence,at:new Date().toISOString()};return current;}
 private async write(fn:(s:any,revision:number)=>any){
  const current=await this.read();const result=await fn(current.state,current.revision);await commitPersistedState(this.db(),current.state,current.revision);return result;
 }
 private async syncLive():Promise<any>{
  const current=await this.read();if(current.state.paused)return null;const source=cloudMalvaClient(this.db()),listed=await source.read('tracking_list_projects',{});const live=await readLiveData(this.db(),current.state);
  const projects=live.projects.sort((a:any,b:any)=>Date.parse(live.items.find((i:any)=>i.projectId===a.projectId)?.lastSuccessAt||'1970-01-01')-Date.parse(live.items.find((i:any)=>i.projectId===b.projectId)?.lastSuccessAt||'1970-01-01')).slice(0,2);
  for(const p of projects){const project=listed.items?.find((x:any)=>x.id===p.projectId&&x.name===p.projectName);if(!project)continue;try{const cut=await collectCloudProject(source,project,{purpose:'live',levels:['campaign'],periodsWanted:['today'],tracked:trackedCloudCampaigns(current.state,p.projectId)});const latest=await this.read();if(latest.state.paused)break;const before=await readLiveData(this.db(),latest.state,p.projectId);await liveDataAction(this.db(),latest.state,{action:'import',projectId:p.projectId,snapshot:cut.snapshots[0],expectedRevision:before.items[0].revision},Date.now(),'cloudflare');}catch(e:any){const latest=await this.read();if(latest.state.paused||!(await this.setting()).enabled)break;const before=await readLiveData(this.db(),latest.state,p.projectId);const code=/^[A-Z][A-Z0-9_]{0,59}$/.test(e.code||'')?e.code:'CLOUD_LIVE_FAILED';await liveDataAction(this.db(),latest.state,{action:'failure',projectId:p.projectId,expectedRevision:before.items[0].revision,error:{code,message:'A consulta na nuvem não confirmou uma nova leitura. Última fonte válida preservada.'}},Date.now(),'cloudflare');}}
  return current.state;
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
 private async storeCompanion(state:any){
  if(!state)return;
  const list=await this.ctx.storage.list<any>({prefix:'attr:'}),attributions=usableAttributions([...list.values()]),runtime=await this.setting();
  const executor={...runtime,paused:!!state.paused},withAuthors={...state,changeAttributions:attributions},now=Date.now(),out:Record<string,any>={},board=projectBoard(withAuthors,now);
  for(const project of ['all',...Object.keys(state.config||{})])out['companion:'+project]=companionSummary(withAuthors,{project,now,executor:executor as any,board:board as any});
  await this.ctx.storage.put(out);
 }
 private async assertEnabled(){if(!(await this.setting()).enabled){const error:any=new Error('CLOUD_EXECUTOR_PAUSED');error.code='CLOUD_EXECUTOR_PAUSED';throw error;}}
 private engine(){const source=cloudMalvaClient(this.db());return createCloudEngine({read:()=>this.read(),write:(fn:any)=>this.write(fn),source:{read:source.read,dispatch:async(command:any,execution:any)=>{await this.assertEnabled();return source.dispatch(command,execution);}},ai:this.env.AI,modelPolicy:cloudProductionModelPolicy,prepareGuard:async(s:any,args:any)=>{await this.assertEnabled();return assertCurrentExecutionContingency(s,args);},ops:{creativeItems:async(s:any,projectId:string)=>syncCloudCreatives({db:this.db(),state:s,projectId,source:cloudOrbitaClient(this.db()),malva:source,expectedEmail:this.env.BUNKER_OWNER_EMAIL,expectedWorkspace:(await this.setting()).check?.workspaceId,readCurrent:async()=>{const current=(await this.read()).state;await this.assertEnabled();return current;}}),liveItems:async(s:any)=>(await readLiveData(this.db(),s)).items,claimBatch,updateRun,importBundle:(s:any,b:any)=>apply(s,{op:'import',bundle:b}),answer:(s:any,id:string,text:string)=>{const m=s.messages.find((m:any)=>m.id===id);if(!m)throw Error('CLOUD_QUESTION_MISSING');return answerOfficeMessage(m,text,new Date().toISOString());}}});}
 async fetch(request:Request){
  let input:any;try{input=await request.json();}catch{return Response.json({error:'Pedido inválido.'},{status:400});}
  const runtime=await this.setting();
  if(input.action==='companion'){const key='companion:'+(typeof input.project==='string'&&input.project?input.project:'all');const summary=await this.ctx.storage.get(key);return Response.json(summary?{summary}:{summary:null});}
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
   await this.ctx.storage.put('runtime',{...setting,lastPulseAt:new Date().toISOString()});const engine=this.engine();
   // Bounded work prevents one large project from owning a whole alarm forever.
   const started=Date.now();for(let n=0;n<4&&Date.now()-started<90000;n++){
    setting=await this.setting();if(!setting.enabled)break;
    const result=await engine.step(),at=new Date().toISOString();const latest=await this.setting();await this.ctx.storage.put('runtime',{...latest,lastUnitAt:at,lastResult:result,lastError:null,lastErrorDetail:null,history:[{at,...result},...(latest.history||[])].slice(0,30)});
    if(['idle','blocked'].includes(result.kind))break;
   }
   const liveState=(await this.setting()).enabled?await this.syncLive():null;
   // Optional attribution never turns into an executor failure.
   if(liveState&&(await this.setting()).enabled)await this.syncAttribution(liveState).catch(async()=>{await this.ctx.storage.put('attributionStatus',{at:new Date().toISOString(),failed:true});});
   if(liveState)await this.storeCompanion(liveState).catch(()=>{});
  }catch(e:any){const latest=await this.setting();await this.ctx.storage.put('runtime',runtimeFailure(latest,e));}
  finally{this.running=false;const latest=await this.setting();if(latest.enabled)await this.ctx.storage.setAlarm(Date.now()+60000);}
 }
}
