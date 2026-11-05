import {dailyDataAction} from './campaign-daily-data.mjs';
import {dailySnapshot,dailyPublicError} from '../scripts/local-daily-sync.mjs';

/** Opening a detail requests only its exact, display-only daily series. The
 * existing server MCP connection works without a desktop relay or AI round. */
export async function requestCloudDaily({db,readState,source,target,now=Date.now}){
 const state=await readState(),requested=await dailyDataAction(db,state,{action:'request',...target},now());
 if(!requested.item.refreshPending)return requested;
 const item=requested.item;
 const reread=async()=>dailyDataAction(db,await readState(),{action:'read',...target},now());
 let payload;
 try{
  const [who,listed]=await Promise.all([source.read('workspace_whoami',{}),source.read('tracking_list_projects',{})]);
  const project=listed.items?.find(p=>p.id===item.target.projectId);
  if(!who.workspace?.id||!who.platforms?.some(p=>p.platform==='tracking'&&p.read)||!project||project.archivedAt||project.name!==item.target.projectName||project.timezone!==item.target.timezone)throw Object.assign(new Error('SOURCE_IDENTITY'),{code:'SOURCE_IDENTITY'});
  const detail=await source.read('tracking_ad_detail',{projectId:target.projectId,objectId:item.target.internalObjectId,sales:'traffic',preset:'custom',from:item.range.from,to:item.range.to});
  payload=dailySnapshot(detail,item,project,now()).snapshot;
 }catch(error){
  const latest=await reread();
  if(latest.paused||latest.item.revision!==item.revision||JSON.stringify(latest.item.target)!==JSON.stringify(item.target)||JSON.stringify(latest.item.range)!==JSON.stringify(item.range))return latest;
  try{return await dailyDataAction(db,await readState(),{action:'failure',...target,expectedRevision:item.revision,error:dailyPublicError(error)},now());}
  catch{return reread();}
 }
 const latest=await reread();
 if(latest.paused||latest.item.revision!==item.revision||JSON.stringify(latest.item.target)!==JSON.stringify(item.target)||JSON.stringify(latest.item.range)!==JSON.stringify(item.range))return latest;
 // An uncertain save is never resent or replaced by a failure. Reconcile the
 // persisted cache; another reader or a new local day may already own it.
 try{return await dailyDataAction(db,await readState(),{action:'import',...target,expectedRevision:item.revision,snapshot:payload},now());}
 catch{return reread();}
}
