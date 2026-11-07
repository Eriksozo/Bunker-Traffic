/** Who changed a campaign: read-only matching of observed budget/status changes against the Malva edit history.
 * Results live in the executor's own storage (not the central), expire, and never authorize or trigger anything. */
import {financialHistoryItem} from './cloud-history-learning.mjs';

export const attributionPolicy=Object.freeze({version:1,intervalMs:3*60000,lookbackHours:72,campaignsPerPulse:6,recheckHours:6,retentionDays:7,maxEntries:3000,toleranceMs:20*60000,providerWrites:false});
const arr=value=>Array.isArray(value)?value:[];
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const iso=value=>new Date(value).toISOString();
const statusFields=['status','effectiveStatus'];
const upper=value=>String(value??'').toUpperCase();
const localDay=(instant,timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));

export const attributionKey=(changeId,field)=>changeId+':'+field;
const sameValues=(field,a,b)=>statusFields.includes(field)?upper(a)===upper(b):a===b;

/** A history import already naming the actor of this exact transition makes another lookup useless. */
function alreadyKnown(state,change,c){
 const from=time(change.previousObservedAt)-attributionPolicy.toleranceMs,to=time(change.observedAt)+attributionPolicy.toleranceMs,field=statusFields.includes(c.field)?'status':c.field;
 return arr(state.decisionHistory).some(r=>r.objectId===change.objectId&&r.adAccountId===change.adAccountId&&(r.field===field||statusFields.includes(r.field)&&field==='status')&&sameValues(field,r.before,c.before)&&sameValues(field,r.after,c.after)&&time(r.occurredAt)>=from&&time(r.occurredAt)<=to&&r.actor);
}

/** Campaigns to look up now, newest first: one Malva read per campaign covers all its pending changes. */
export function pendingAttributions(state,known=new Map(),now=Date.now(),limit=attributionPolicy.campaignsPerPulse){
 if(state?.paused)return [];
 const since=now-attributionPolicy.lookbackHours*3600000,groups=new Map();
 const changes=arr(state?.campaignChanges).filter(r=>time(r.observedAt)>=since&&time(r.observedAt)<=now&&Number.isFinite(time(r.previousObservedAt))&&Object.hasOwn(state.config||{},r.project)).sort((a,b)=>time(b.observedAt)-time(a.observedAt));
 for(const r of changes){
  const fields=arr(r.changes).map(c=>c.field);
  for(const c of arr(r.changes)){
   if(!['status','effectiveStatus','dailyBudget'].includes(c.field)||c.field==='effectiveStatus'&&fields.includes('status'))continue;
   const key=attributionKey(r.id,c.field),entry=known.get(key);
   if(entry?.actor||entry&&now-time(entry.checkedAt)<attributionPolicy.recheckHours*3600000)continue;
   if(alreadyKnown(state,r,c))continue;
   const id=JSON.stringify([r.project,r.adAccountId,r.objectId]);
   if(!groups.has(id)){if(groups.size>=limit)continue;groups.set(id,{project:r.project,adAccountId:r.adAccountId,objectId:r.objectId,currency:r.after?.budgetCurrency||r.before?.budgetCurrency||null,windowFrom:time(r.previousObservedAt),windowTo:time(r.observedAt),changes:[]});}
   const g=groups.get(id);g.windowFrom=Math.min(g.windowFrom,time(r.previousObservedAt));g.windowTo=Math.max(g.windowTo,time(r.observedAt));
   g.changes.push({key,changeId:r.id,field:c.field,before:c.before,after:c.after,from:r.previousObservedAt,to:r.observedAt});
  }
 }
 return [...groups.values()];
}

/** Same request shape the executor already uses for this tool, limited to the days around the observation. */
export function attributionRequest(group,timezone,now=Date.now()){
 return {projectId:group.project,objectId:group.objectId,provider:['meta'],who:'all',limit:100,preset:'custom',from:localDay(group.windowFrom-86400000,timezone),to:localDay(now,timezone)};
}

function actorName(item){
 const a=item.actor;
 for(const key of ['name','profile','key','id'])if(a&&typeof a[key]==='string'&&a[key].trim())return a[key].trim();
 return item.automatic===true?'Regra automática':null;
}

/** Match each pending change with the closest validated history item of the same transition and time window. */
export function matchAttributions(group,page,now=Date.now()){
 const items=arr(page?.items).map(financialHistoryItem).filter(Boolean);
 return group.changes.map(c=>{
  const field=statusFields.includes(c.field)?'status':'dailyBudget',from=time(c.from)-attributionPolicy.toleranceMs,to=time(c.to)+attributionPolicy.toleranceMs;
  const hits=items.filter(i=>(field==='status'?i.category==='status':i.category==='budget')&&sameValues(field,i.values.from,c.before)&&sameValues(field,i.values.to,c.after)&&time(i.at)>=from&&time(i.at)<=to).sort((a,b)=>time(b.at)-time(a.at));
  const base={key:c.key,changeId:c.changeId,project:group.project,adAccountId:group.adAccountId,objectId:group.objectId,field:c.field,before:c.before,after:c.after,currency:group.currency,checkedAt:iso(now)};
  const hit=hits[0];
  return hit?{...base,at:hit.at,actor:actorName(hit),automatic:hit.automatic===true,eventId:hit.id,source:hit.source||'Malva',matched:true}:{...base,at:null,actor:null,matched:false};
 });
}

export function expiredAttribution(entry,now=Date.now()){return !Number.isFinite(time(entry?.checkedAt))||now-time(entry.checkedAt)>attributionPolicy.retentionDays*86400000;}

/** Entries the screens can use: matched, with an actor, not expired. */
export function usableAttributions(entries,now=Date.now()){return arr(entries).filter(e=>e?.matched&&e.actor&&!expiredAttribution(e,now));}
