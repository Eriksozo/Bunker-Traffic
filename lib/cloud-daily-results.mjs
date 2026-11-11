import {dailyDataAction} from './campaign-daily-data.mjs';
import {dailySnapshot,dailyPublicError,dailyRange} from '../scripts/local-daily-sync.mjs';

/** IC (checkouts iniciados) of the exact campaign, one Malva read per day: the day series of tracking_ad_detail does
 * not carry it. Any day that does not confirm the same campaign, period and a whole count stays N/D (null). */
export async function campaignDayCheckouts(source,target,days,timezone){
 const one=async day=>{
  try{
   const out=await source.read('tracking_campaigns',{projectId:target.projectId,level:'campaign',provider:['meta'],sales:'traffic',preset:'custom',from:day,to:day,status:'all',accountStatus:'all',accountIds:[target.adAccountId],campaignIds:[target.objectId],limit:5});
   if(out?.period?.timezone!==timezone||!Array.isArray(out?.period?.days)||out.period.days.length!==1||out.period.days[0]!==day)return null;
   const rows=(Array.isArray(out.rows)?out.rows:[]).filter(r=>r?.id===target.internalObjectId&&r.adAccountId===target.adAccountId&&r.externalId===target.objectId&&r.level==='campaign'&&r.provider==='meta');
   const value=rows.length===1?rows[0].checkouts:null;
   return Number.isInteger(value)&&value>=0?value:null;
  }catch{return null;}
 };
 const values=await Promise.all(days.map(one));
 return new Map(days.map((day,i)=>[day,values[i]]));
}

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
  const [detail,checkouts]=await Promise.all([
   source.read('tracking_ad_detail',{projectId:target.projectId,objectId:item.target.internalObjectId,sales:'traffic',preset:'custom',from:item.range.from,to:item.range.to}),
   campaignDayCheckouts(source,{...item.target},dailyRange(now(),item.target.timezone).days,item.target.timezone),
  ]);
  payload=dailySnapshot(detail,item,project,now(),{checkouts}).snapshot;
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
