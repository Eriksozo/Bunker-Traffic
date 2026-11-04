import {DurableObject} from 'cloudflare:workers';
import {SupabaseStorage} from '../lib/supabase-storage.mjs';
import {readPersistedState,commitPersistedState} from '../lib/persistence.mjs';
import {empty,apply} from '../lib/state';
import {claimBatch,updateRun} from '../lib/agent-state';
import {answerOfficeMessage} from '../lib/office.mjs';
import {assertCurrentExecutionContingency} from '../lib/live-state';
import {cloudMalvaClient} from '../lib/cloud-malva.mjs';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {readLiveData,liveDataAction} from '../lib/live-data.mjs';
import {collectCloudProject} from '../lib/cloud-collector.mjs';
import {CLOUD_MODEL} from '../lib/cloud-analysis.mjs';

type Runtime={enabled:boolean;lastPulseAt?:string;lastUnitAt?:string;lastError?:string|null;lastResult?:any;check?:any;history?:any[]};
export class BunkerCloudExecutor extends DurableObject<any>{
 private running=false;
 private async setting():Promise<Runtime>{return await this.ctx.storage.get<Runtime>('runtime')||{enabled:false,history:[]};}
 private db(){return new SupabaseStorage({url:this.env.SUPABASE_URL,key:this.env.SUPABASE_SERVICE_ROLE_KEY});}
 private async read(){return readPersistedState(this.db(),empty);}
 private async write(fn:(s:any,revision:number)=>any){
  const current=await this.read();const result=await fn(current.state,current.revision);await commitPersistedState(this.db(),current.state,current.revision);return result;
 }
 private async syncLive(){
  const current=await this.read();if(current.state.paused)return;const source=cloudMalvaClient(this.db()),listed=await source.read('tracking_list_projects',{});const live=await readLiveData(this.db(),current.state);
  const projects=live.projects.sort((a:any,b:any)=>Date.parse(live.items.find((i:any)=>i.projectId===a.projectId)?.lastSuccessAt||'1970-01-01')-Date.parse(live.items.find((i:any)=>i.projectId===b.projectId)?.lastSuccessAt||'1970-01-01')).slice(0,2);
  for(const p of projects){const project=listed.items?.find((x:any)=>x.id===p.projectId&&x.name===p.projectName);if(!project)continue;try{const cut=await collectCloudProject(source,project,{levels:['campaign'],periodsWanted:['today']});const latest=await this.read();if(latest.state.paused)break;const before=await readLiveData(this.db(),latest.state,p.projectId);await liveDataAction(this.db(),latest.state,{action:'import',projectId:p.projectId,snapshot:cut.snapshots[0],expectedRevision:before.items[0].revision});}catch(e:any){const latest=await this.read();if(latest.state.paused||!(await this.setting()).enabled)break;const before=await readLiveData(this.db(),latest.state,p.projectId);const code=/^[A-Z][A-Z0-9_]{0,59}$/.test(e.code||'')?e.code:'CLOUD_LIVE_FAILED';await liveDataAction(this.db(),latest.state,{action:'failure',projectId:p.projectId,expectedRevision:before.items[0].revision,error:{code,message:'A consulta na nuvem não confirmou uma nova leitura. Última fonte válida preservada.'}});}}
 }
 private async assertEnabled(){if(!(await this.setting()).enabled){const error:any=new Error('CLOUD_EXECUTOR_PAUSED');error.code='CLOUD_EXECUTOR_PAUSED';throw error;}}
 private engine(){const source=cloudMalvaClient(this.db());return createCloudEngine({read:()=>this.read(),write:(fn:any)=>this.write(fn),source:{read:source.read,dispatch:async(command:any,execution:any)=>{await this.assertEnabled();return source.dispatch(command,execution);}},ai:this.env.AI,prepareGuard:async(s:any,args:any)=>{await this.assertEnabled();return assertCurrentExecutionContingency(s,args);},ops:{liveItems:async(s:any)=>(await readLiveData(this.db(),s)).items,claimBatch,updateRun,importBundle:(s:any,b:any)=>apply(s,{op:'import',bundle:b}),answer:(s:any,id:string,text:string)=>{const m=s.messages.find((m:any)=>m.id===id);if(!m)throw Error('CLOUD_QUESTION_MISSING');return answerOfficeMessage(m,text,new Date().toISOString());}}});}
 async fetch(request:Request){
  let input:any;try{input=await request.json();}catch{return Response.json({error:'Pedido inválido.'},{status:400});}
  const runtime=await this.setting();
  if(input.action==='status'){const current=await this.read();return Response.json({...runtime,running:this.running,host:'cloudflare',model:CLOUD_MODEL,paused:current.state.paused,cadence:current.state.cadence,independentOfDesktop:true});}
  if(input.action==='check'){
   let malva=false,ai=false;try{const started=Date.now(),ids=await this.engine().identity();malva=true;const smoke=await this.env.AI.run(CLOUD_MODEL,{messages:[{role:'user',content:'Responda somente OK.'}],max_tokens:8});if(typeof smoke?.response!=='string'||!smoke.response.trim())throw Error('CLOUD_AI_UNAVAILABLE');ai=true;
    const check={at:new Date().toISOString(),malva:true,ai:true,ads:ids.who.platforms.some((p:any)=>p.platform==='tracking'&&p.ads),workspaceId:ids.who.workspace.id,projects:ids.projects.map((p:any)=>({id:p.id,name:p.name})),durationMs:Date.now()-started};await this.ctx.storage.put('runtime',{...runtime,check,lastError:null});return Response.json({ok:true,check});
   }catch(e:any){const code=/^[A-Z_]{3,80}$/.test(e.code||'')?e.code:'CLOUD_CHECK_FAILED';await this.ctx.storage.put('runtime',{...runtime,lastError:code,check:{at:new Date().toISOString(),malva,ai,error:code}});return Response.json({error:code},{status:503});}
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
    const result=await engine.step(),at=new Date().toISOString();const latest=await this.setting();await this.ctx.storage.put('runtime',{...latest,lastUnitAt:at,lastResult:result,lastError:null,history:[{at,...result},...(latest.history||[])].slice(0,30)});
    if(['idle','blocked'].includes(result.kind))break;
   }
   if((await this.setting()).enabled)await this.syncLive();
  }catch(e:any){const latest=await this.setting(),code=/^[A-Z_]{3,80}$/.test(e.code||'')?e.code:e.message==='CONFLICT'?'CLOUD_REVISION_CONFLICT':'CLOUD_STEP_FAILED';await this.ctx.storage.put('runtime',{...latest,lastError:code,lastUnitAt:new Date().toISOString()});}
  finally{this.running=false;const latest=await this.setting();if(latest.enabled)await this.ctx.storage.setAlarm(Date.now()+60000);}
 }
}
