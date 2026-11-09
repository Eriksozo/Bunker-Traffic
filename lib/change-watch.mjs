/** Near real-time edit watch (owner request of 2026-11-07: "o momento em que tiver algum ajuste direto no
 * Malva acione imediatamente no Bunker web e Bunk"). Malva has no push for ad edits, so the executor asks each
 * configured project for its newest few budget/status edits every few seconds (a ~2 KB read). A new edit is
 * stored with its author at once, the project jumps to the front of the live reads, and a pulse counter lets
 * the web and the notch refresh without waiting for the minute pulse. Read-only: never proposes or executes. */
import {readHistoryPage,activityEvent} from './activity-history.mjs';

/** fastUnits: executor units the fast lane may run per wake; laneMs: fast-lane timer during the heavy pulse; liveStaleMs: a live project older than this is reread by the
 * fast lane when nothing else is new (one project per look). */
export const changeWatchPolicy=Object.freeze({tickMs:15000,heavyMs:60000,limit:10,targetsMs:10*60000,maxLiveReads:2,fastUnits:3,liveStaleMs:3*60000,laneMs:5000});
/** Work the fast lane may run between heavy units: sending/confirming owner-approved orders and their follow-up. Never a model call. */
export const fastLaneKinds=Object.freeze(['verify','followUp','execution']);

export function changeWatchRequest(project){
 return {projectId:project.id,provider:['meta'],who:'people',level:['campaign'],category:['budget','status'],limit:changeWatchPolicy.limit,preset:'today'};
}

/** Edits newer than the stored head (newest first). The first look only records the head: nothing old replays.
 * The head keeps the ids already seen in its second (`ids`, only when several share it): Malva gives no order to
 * same-second edits, so position alone would replay or miss one of them. */
export function newChanges(head,list){
 if(!Array.isArray(list)||!list.length)return {fresh:[],head:head||null};
 // Newest first regardless of the order the source used (ties keep their order): the head is always the newest edit.
 const t=x=>{const n=Date.parse(x?.at||'');return Number.isFinite(n)?n:-Infinity;};
 const items=list.map((x,i)=>[x,i]).sort((a,b)=>t(b[0])-t(a[0])||a[1]-b[1]).map(([x])=>x);
 const at=head?.id?Date.parse(head.at||''):NaN,seen=new Set(Array.isArray(head?.ids)?head.ids:head?.id?[head.id]:[]);
 const fresh=!head?.id?[]:Number.isFinite(at)?items.filter(x=>t(x)>at||t(x)===at&&!seen.has(x.id)):(i=>i>=0?items.slice(0,i):[])(items.findIndex(x=>x.id===head.id));
 if(head?.id&&!fresh.length)return {fresh,head};
 const top=t(items[0]),ids=[...new Set([...(top===at?seen:[]),...items.filter(x=>t(x)===top).map(x=>x.id)])].slice(-100);
 return {fresh,head:{id:items[0].id,at:items[0].at,...(ids.length>1?{ids}:{})}};
}

/** One project: read, validate, and turn new edits into stored history events (same keys as the feed). */
export async function watchProject(source,project,head,now=Date.now()){
 const raw=await source.read('tracking_ad_changes',changeWatchRequest(project));
 const page=readHistoryPage(raw,project,now);
 const {fresh,head:next}=newChanges(head,page.items);
 const checkedAt=new Date(now).toISOString();
 return {project:project.id,fresh,head:next,events:fresh.map(item=>activityEvent(project,item,checkedAt))};
}

/** Pulse the clients watch: a counter, when, and the newest edit in plain words (no secret, no value beyond the edit). */
export function nextPulse(previous,changes,now=Date.now()){
 const all=changes.flatMap(c=>c.events);if(!all.length)return previous||{version:0,at:null,last:null};
 const newest=all.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 return {version:(previous?.version||0)+1,at:new Date(now).toISOString(),projects:[...new Set(changes.filter(c=>c.events.length).map(c=>c.project))],
  last:{project:newest.project,campaign:newest.name,account:newest.accountName,field:newest.field,before:newest.before,after:newest.after,currency:newest.currency,actor:newest.actor,at:newest.at}};
}

/** Web toast for a pulse: an edit names its author and change; an owner order names its stage; a sale is not an edit. */
export function pulseToast(last){
 if(!last?.campaign)return '';
 if(last.kind==='order')return `Sua ordem: ${last.label||'atualizada'} · ${last.campaign}`;
 if(last.kind==='sale')return `Venda registrada · ${last.campaign}`;
 if(last.kind)return '';
 return `${last.actor||'Alguém'} ${last.field==='status'?(String(last.after).toUpperCase()==='PAUSED'?'pausou':'ativou'):'mudou o orçamento de'} ${last.campaign}`;
}

/** Live reads for this pulse: projects with fresh edits first, then the usual oldest-first order.
 * @param {any[]} projects @param {{first?:string[],urgent?:string[],lastSuccess?:Record<string,string>}} [order] */
export function liveOrder(projects,{first=[],urgent=[],lastSuccess={}}={}){
 const rank=id=>{const f=first.indexOf(id);if(f>=0)return f;const u=urgent.indexOf(id);return u>=0?50+u:99;};
 return projects.slice().sort((a,b)=>rank(a.projectId)-rank(b.projectId)||Date.parse(lastSuccess[a.projectId]||'1970-01-01')-Date.parse(lastSuccess[b.projectId]||'1970-01-01')).slice(0,changeWatchPolicy.maxLiveReads);
}

/** Owner order receipts changed stage (queued → checking → sent → confirmed, or verify/failed): move the pulse so
 * the notch shows the receipt at once. `sig` is the stored stage signature from the previous look. Only a new receipt
 * or a stage change moves it (a receipt leaving the 24h window does not), and `last` is the receipt that changed. */
export function orderPulse(previous,receipts,sig,now=Date.now()){
 const next=(receipts||[]).map(r=>r.id+':'+r.stage).join('|');
 const prior=new Map(String(sig||'').split('|').filter(Boolean).map(x=>{const k=x.lastIndexOf(':');return [x.slice(0,k),x.slice(k+1)];}));
 const r=(receipts||[]).find(x=>prior.get(String(x.id))!==String(x.stage));
 if(!r)return {pulse:null,sig:next};
 return {sig:next,pulse:{...(previous||{}),version:(previous?.version||0)+1,at:new Date(now).toISOString(),
  last:{kind:'order',project:r.project,campaign:r.campaign,account:r.account,stage:r.stage,label:r.label,at:r.confirmedAt||r.sentAt||r.at}}};
}

/** Live items this object keeps for the notch: this read's items (fresh imports first), except where the held item is
 * newer — the fast lane and the heavy pulse may read at the same time, and the one that started earlier must not put
 * back an older reading (e.g. the row before a notch pause). Newest by snapshot.fetchedAt, else lastSuccessAt.
 * @param {any[]} held @param {any[]} items @param {Record<string,any>} fresh */
export function newestLiveItems(held,items,fresh={}){
 const at=i=>{const t=Date.parse(i?.snapshot?.fetchedAt||i?.lastSuccessAt||'');return Number.isFinite(t)?t:0;};
 const prior=new Map((held||[]).map(i=>[i.projectId,i]));
 return (items||[]).map(i=>{const next=fresh[i.projectId]||i,old=prior.get(i.projectId);return old&&at(old)>at(next)?old:next;});
}
