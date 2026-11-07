/** Read-only recent campaign edit feed. Separate from financial decisions and analysis sources. */
import {historyItemOf,financialHistoryItem} from './cloud-history-learning.mjs';
export const activityHistoryPolicy=Object.freeze({version:2,intervalMs:60000,projectsPerPulse:2,pagesPerProject:2,lookbackDays:7,maxEntries:3000});
const time=x=>Date.parse(x||''),arr=x=>Array.isArray(x)?x:[];
const day=(n,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(n);
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function historyActor(actor,automatic=false){
 if(typeof actor==='string'&&actor.trim())return actor.trim();
 if(typeof actor?.name==='string'&&actor.name.trim())return actor.name.trim();
 // Technical IDs/profile labels do not identify a manager.
 return automatic===true?'Regra automática':null;
}
export function normalizeActivityHistory(item){
 if(!item?.object||!item.values||!financialHistoryItem(item))return null;
 const field=item.category==='status'?'status':'dailyBudget';
 return {...item,values:{...item.values,field,from:field==='status'?item.values.from.toUpperCase():item.values.from,to:field==='status'?item.values.to.toUpperCase():item.values.to}};
}
export function activityHistoryProjects(state,statuses=[],now=Date.now()){
 if(state?.paused)return [];
 const byProject=new Map(arr(statuses).map(s=>[s.project,s]));
 return Object.entries(state?.config||{}).filter(([id])=>!Number.isFinite(time(byProject.get(id)?.checkedAt))||now-time(byProject.get(id).checkedAt)>=activityHistoryPolicy.intervalMs)
 .sort(([a],[b])=>(time(byProject.get(a)?.checkedAt)||0)-(time(byProject.get(b)?.checkedAt)||0)||a.localeCompare(b))
 .slice(0,activityHistoryPolicy.projectsPerPulse).map(([id,c])=>({id,name:c.projectName}));
}
function pageOf(raw,project,now,expected=null){
 if(!Array.isArray(raw?.items)||raw.items.length>100||raw.timezone!==project.timezone||raw.period?.timezone!==project.timezone||!Number.isFinite(time(raw.period.from))||!Number.isFinite(time(raw.period.to))||time(raw.period.from)>=time(raw.period.to)||(raw.nextCursor!=null&&typeof raw.nextCursor!=='string'))fail('ACTIVITY_HISTORY_IDENTITY');
 const period={from:raw.period.from,to:raw.period.to};
 if(expected&&JSON.stringify(period)!==JSON.stringify(expected))fail('ACTIVITY_HISTORY_PERIOD_CHANGED');
 let last=Infinity;
 const items=raw.items.flatMap(rawItem=>{
  if(time(rawItem.at)>last)fail('ACTIVITY_HISTORY_ORDER');last=time(rawItem.at);
  if(time(rawItem.at)<time(period.from)||time(rawItem.at)>=time(period.to))fail('ACTIVITY_HISTORY_PERIOD');
  const account=rawItem.account,object=rawItem.object;
  if(!account?.id||!account.currency||!object?.externalId||object.level!=='campaign')fail('ACTIVITY_HISTORY_IDENTITY');
  const item=historyItemOf(rawItem,{adAccountId:account.id,externalId:object.externalId,budgetCurrency:account.currency},now+1,now);
  const normalized=normalizeActivityHistory(item);return normalized?[normalized]:[];
 });
 return {items,period,nextCursor:raw.nextCursor||null};
}
/** Always refresh the newest page, then resume a bounded backfill; a cursor never disappears silently. */
export async function collectActivityHistory(source,project,previous=null,{now=Date.now}={}){
 const start=now(),request={projectId:project.id,provider:['meta'],who:'all',level:['campaign'],category:['budget','status'],limit:100,preset:'custom',from:day(start-(activityHistoryPolicy.lookbackDays-1)*86400000,project.timezone),to:day(start,project.timezone)};
 const head=pageOf(await source.read('tracking_ad_changes',request),project,now());
 if(day(time(head.period.from),project.timezone)!==request.from||day(time(head.period.to)-1,project.timezone)!==request.to)fail('ACTIVITY_HISTORY_PERIOD');
 const pending=previous?.pending;
 if(pending&&(pending.project!==project.id||pending.timezone!==project.timezone))fail('ACTIVITY_HISTORY_IDENTITY');
 const work=pending||{project:project.id,timezone:project.timezone,request,period:head.period,cursor:head.nextCursor,cursors:[]};
 let calls=1,tail=null;
 if(work.cursor){
  if(arr(work.cursors).includes(work.cursor))fail('ACTIVITY_HISTORY_CURSOR');
  tail=pageOf(await source.read('tracking_ad_changes',{...work.request,cursor:work.cursor}),project,now(),work.period);calls++;
 }
 const backfill=tail?{...work,cursor:tail.nextCursor,cursors:[...arr(work.cursors),work.cursor]}:work;
 const next=backfill.cursor?backfill:pending&&head.nextCursor?{project:project.id,timezone:project.timezone,request,period:head.period,cursor:head.nextCursor,cursors:[]}:null;
 const checkedAt=new Date(now()).toISOString(),events=new Map();
 for(const item of [...head.items,...(tail?.items||[])]){
  const key=project.id+':'+item.id,actor=historyActor(item.actor,item.automatic);
  events.set(key,{key:'history:'+key,project:project.id,adAccountId:item.account.id,objectId:item.object.externalId,name:item.object.name||null,accountName:item.account.label||null,field:item.values.field,before:item.values.from,after:item.values.to,currency:item.account.currency,at:item.at,checkedAt,actor,automatic:item.automatic===true,eventId:item.id,source:item.source||'Malva',matched:true,feedVersion:activityHistoryPolicy.version});
 }
 return {project:project.id,checkedAt,calls,events:[...events.values()],pending:next,complete:!next,returnedCount:events.size};
}
