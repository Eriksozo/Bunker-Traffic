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
/**
 * Identity of an edit's author as Malva gives it (Modo Gestor, W3): the stable `key` (`malva:<member>`, 'fora',
 * `automacao:<id>`, 'sistema'), its `kind` (malva / outside / automation / system), the display `name` (historyActor),
 * the Meta `profile` of an outside edit and the `app` it came through. Additive: historyActor keeps returning the name.
 * Kept only in the executor's own storage (attr:*), never in the repository or a public read.
 */
export function historyActorInfo(actor,automatic=false,app=null){
 const s=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,120):null,a=actor&&typeof actor==='object'?actor:{};
 return {key:s(a.key),kind:s(a.kind),name:historyActor(actor,automatic),profile:s(a.profile),app:s(app)};
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
/** Validated newest-first page of campaign budget/status edits (also used by the fast change watch). */
export function readHistoryPage(raw,project,now,expected=null){
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
  // The tool an edit came through (`app`) is not kept by the shared item validator: added here, as given (≤80 chars).
  const normalized=normalizeActivityHistory(item);return normalized?[{...normalized,app:typeof rawItem.app==='string'&&rawItem.app.trim()?rawItem.app.trim().slice(0,80):null}]:[];
 });
 return {items,period,nextCursor:raw.nextCursor||null};
}
/** Always refresh the newest page, then resume a bounded backfill; a cursor never disappears silently. */
export async function collectActivityHistory(source,project,previous=null,{now=Date.now}={}){
 const start=now(),request={projectId:project.id,provider:['meta'],who:'all',level:['campaign'],category:['budget','status'],limit:100,preset:'custom',from:day(start-(activityHistoryPolicy.lookbackDays-1)*86400000,project.timezone),to:day(start,project.timezone)};
 const head=readHistoryPage(await source.read('tracking_ad_changes',request),project,now());
 if(day(time(head.period.from),project.timezone)!==request.from||day(time(head.period.to)-1,project.timezone)!==request.to)fail('ACTIVITY_HISTORY_PERIOD');
 const pending=previous?.pending;
 if(pending&&(pending.project!==project.id||pending.timezone!==project.timezone))fail('ACTIVITY_HISTORY_IDENTITY');
 const work=pending||{project:project.id,timezone:project.timezone,request,period:head.period,cursor:head.nextCursor,cursors:[]};
 let calls=1,tail=null;
 if(work.cursor){
  if(arr(work.cursors).includes(work.cursor))fail('ACTIVITY_HISTORY_CURSOR');
  tail=readHistoryPage(await source.read('tracking_ad_changes',{...work.request,cursor:work.cursor}),project,now(),work.period);calls++;
 }
 const backfill=tail?{...work,cursor:tail.nextCursor,cursors:[...arr(work.cursors),work.cursor]}:work;
 const next=backfill.cursor?backfill:pending&&head.nextCursor?{project:project.id,timezone:project.timezone,request,period:head.period,cursor:head.nextCursor,cursors:[]}:null;
 const checkedAt=new Date(now()).toISOString(),events=new Map();
 for(const item of [...head.items,...(tail?.items||[])]){
  const key=project.id+':'+item.id;
  events.set(key,activityEvent(project,item,checkedAt));
 }
 return {project:project.id,checkedAt,calls,events:[...events.values()],pending:next,complete:!next,returnedCount:events.size};
}
/** One stored edit with its author, keyed like the history feed so the watch and the feed never duplicate. */
export function activityEvent(project,item,checkedAt){
 const key=project.id+':'+item.id,actor=historyActor(item.actor,item.automatic);
 return {key:'history:'+key,project:project.id,adAccountId:item.account.id,objectId:item.object.externalId,name:item.object.name||null,accountName:item.account.label||null,field:item.values.field,before:item.values.from,after:item.values.to,currency:item.account.currency,at:item.at,checkedAt,actor,automatic:item.automatic===true,eventId:item.id,source:item.source||'Malva',matched:true,feedVersion:activityHistoryPolicy.version,actorInfo:historyActorInfo(item.actor,item.automatic,item.app??null)};
}

export const teamBackfillPolicy=Object.freeze({version:1,days:30,pagesPerCall:2,maxCursors:60});
/**
 * One bounded step of the 30-day read-only backfill of people's campaign budget/status edits (Modo Gestor, owner answer
 * Q11 "sim"): at most `pages` reads of Malva `tracking_ad_changes` (`who:'people'`, campaign level), resuming from the
 * stored cursor. The window is the `days` closed local days ending yesterday, frozen on the first page. `stillEnabled`
 * is checked before each read. Only reads; the caller stores the events and the new state (cursor) after its own write.
 * @param {{read:(tool:string,args:any)=>Promise<any>}} source @param {{id:string,name?:string,timezone:string}} project
 * @param {any} previous stored state (`pb:backfill:<p>`) or null
 * @param {{now?:()=>number,days?:number,pages?:number,stillEnabled?:()=>Promise<boolean>|boolean}} [options]
 */
export async function backfillTeamHistory(source,project,previous=null,{now=Date.now,days=teamBackfillPolicy.days,pages=teamBackfillPolicy.pagesPerCall,stillEnabled=()=>true}={}){
 if(!project?.id||!project.timezone)fail('ACTIVITY_HISTORY_IDENTITY');
 if(previous?.complete===true)return {project:project.id,calls:0,events:[],state:previous,complete:true};
 if(previous&&(previous.project!==project.id||previous.timezone!==project.timezone))fail('ACTIVITY_HISTORY_IDENTITY');
 const start=now(),yesterday=day(start-86400000,project.timezone),from=new Date(Date.parse(yesterday+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
 const request=previous?.request||{projectId:project.id,provider:['meta'],who:'people',level:['campaign'],category:['budget','status'],limit:100,preset:'custom',from,to:yesterday};
 let work={v:teamBackfillPolicy.version,project:project.id,timezone:project.timezone,complete:false,from:request.from,to:request.to,request,period:previous?.period||null,cursor:previous?.cursor??null,cursors:arr(previous?.cursors),pages:previous?.pages||0,moves:previous?.moves||0,at:previous?.at||null};
 const checkedAt=new Date(start).toISOString(),events=new Map();let calls=0;
 while(calls<Math.max(0,Math.min(pages,teamBackfillPolicy.pagesPerCall))&&!work.complete){
  if(!(await stillEnabled()))break;
  if(work.period&&!work.cursor){work={...work,complete:true};break;}
  if(work.cursor&&work.cursors.includes(work.cursor))fail('ACTIVITY_HISTORY_CURSOR');
  const page=readHistoryPage(await source.read('tracking_ad_changes',work.cursor?{...request,cursor:work.cursor}:request),project,now(),work.period);calls++;
  if(!work.period&&(day(time(page.period.from),project.timezone)!==request.from||day(time(page.period.to)-1,project.timezone)!==request.to))fail('ACTIVITY_HISTORY_PERIOD');
  for(const item of page.items)events.set(item.id,activityEvent(project,item,checkedAt));
  work={...work,period:work.period||page.period,cursors:work.cursor?[...work.cursors,work.cursor].slice(-teamBackfillPolicy.maxCursors):work.cursors,cursor:page.nextCursor,pages:work.pages+1,complete:!page.nextCursor};
 }
 const list=[...events.values()];
 return {project:project.id,calls,events:list,state:{...work,moves:work.moves+list.length,at:checkedAt},complete:work.complete};
}
