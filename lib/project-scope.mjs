import {sum} from './analysis.mjs';
import {currentLiveSnapshot,liveDisplayStatus} from './live-display.mjs';
import {dataFreshness} from './data-freshness.mjs';

export const ALL_PROJECTS='all';
const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):-Infinity;
const financial=['revenue','revenueNet','productCost','saleTax','frontOrders','orders','refundedRevenue'];
const rangeKey=s=>JSON.stringify([time(s.from),time(s.to),s.timezone]);
const latest=rows=>rows.slice().sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt))[0];

/** Read-only scope: never use the synthetic project in an execution payload.
 * @param {any} state
 * @param {string} project
 * @param {string} period
 * @param {{items?:any[],now?:number,live?:boolean}} options
 */
export function projectScope(state,project,period,{items=[],now=Date.now(),live=false}={}){
 const ids=project===ALL_PROJECTS?Object.keys(state.config||{}):project?[project]:[];
 const entries=ids.map(id=>{
  const analysis=latest((state.snapshots||[]).filter(s=>s.projectId===id&&s.period===period&&s.level==='campaign'));
  const item=items.find(i=>i.projectId===id);
  const monitoring=live&&period==='today'?currentLiveSnapshot(item,id,analysis,now):null;
  return {id,name:state.config?.[id]?.projectName||id,analysis,snapshot:monitoring||analysis,live:!!monitoring};
 });
 // Only comparable calendar windows may contribute to one total. A missing
 // project or incompatible window stays visible in the coverage, never as zero.
 const groups=new Map();
 for(const entry of entries){const s=entry.snapshot;if(!s||live&&period==='today'&&(time(s.from)>now||time(s.to)<=now)||!Number.isFinite(time(s.from))||!Number.isFinite(time(s.to))||time(s.from)>=time(s.to)||!s.timezone)continue;const key=rangeKey(s);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
 const selected=[...groups.values()].sort((a,b)=>b.length-a.length||time(latest(b.map(e=>e.snapshot)).fetchedAt)-time(latest(a.map(e=>e.snapshot)).fetchedAt))[0]||[];
 const included=new Set(selected.map(e=>e.id));
 const raw=selected.flatMap(e=>(e.snapshot.rows||[]).map(r=>({...r,projectId:e.id,projectName:e.name,sourceAt:e.snapshot.lastSyncAt||e.snapshot.fetchedAt,scopeFetchedAt:e.snapshot.fetchedAt})));
 const deduped=project===ALL_PROJECTS?consolidateCampaigns(raw):{rows:raw,duplicates:0,ambiguous:0};
 const oldest=field=>selected.length===ids.length&&selected.every(e=>Number.isFinite(time(e.snapshot[field])))?selected.map(e=>e.snapshot[field]).sort((a,b)=>time(a)-time(b))[0]:null;
 const snapshot=selected.length?{...selected[0].snapshot,projectId:project,projectName:project===ALL_PROJECTS?'Todos os projetos':entries[0]?.name,rows:deduped.rows,fetchedAt:oldest('fetchedAt'),lastSyncAt:oldest('lastSyncAt'),complete:selected.length===ids.length&&selected.every(e=>e.snapshot.complete===true)}:null;
 return {entries:entries.map(e=>({...e,included:included.has(e.id)})),snapshot,rows:deduped.rows,metrics:sum(deduped.rows),expected:ids.length,included:selected.length,complete:!!snapshot?.complete,usesLive:selected.some(e=>e.live),stale:entries.some(e=>!included.has(e.id)||dataFreshness(e.snapshot,now).stale),duplicates:deduped.duplicates,ambiguous:deduped.ambiguous};
}

/** The same physical campaign's media is counted once, without fuzzy names.
 * Multiple checkout attributions cannot be reconciled without order identity.
 * Leave them unknown instead of inventing financial deduplication.
 */
export function consolidateCampaigns(rows){
 const groups=new Map();
 rows.forEach((row,index)=>{
  const key=row.provider&&row.adAccountId&&row.externalId?JSON.stringify([String(row.provider).toLowerCase(),row.adAccountId,row.level||'campaign',row.externalId]):`unconfirmed:${index}`;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 });
 let duplicates=0,ambiguous=0;
 const result=[...groups.values()].map(group=>{
  group.sort((a,b)=>time(b.scopeFetchedAt||b.sourceAt)-time(a.scopeFetchedAt||a.sourceAt));
  const row={...group[0],scopeProjects:[...new Set(group.map(r=>r.projectName||r.projectId))]};
  if(group.length===1)return row;
  duplicates+=group.length-1;
  const attributed=group.filter(r=>financial.some(k=>Number.isFinite(r[k])&&r[k]!==0));
  const unknown=group.some(r=>financial.some(k=>!Number.isFinite(r[k])));
  if(attributed.length>1||unknown){ambiguous++;for(const k of financial)row[k]=null;}
  else if(attributed.length===1)for(const k of financial)row[k]=attributed[0][k];
  return row;
 });
 return {rows:result,duplicates,ambiguous};
}

export function scopeLiveStatus(ids,feed,{error='',now=Date.now()}={}){
 const statuses=ids.map(id=>({id,...liveDisplayStatus(feed?.items?.find(i=>i.projectId===id),id,{error,paused:feed?.paused,now})}));
 const recent=statuses.filter(s=>s.recent).length;
 return {recent:ids.length>0&&recent===ids.length,count:recent,total:ids.length,label:feed?.paused?'Acompanhamento pausado':`${recent} de ${ids.length} projetos com dados recentes`,statuses};
}
