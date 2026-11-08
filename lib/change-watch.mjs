/** Near real-time edit watch (owner request of 2026-11-07: "o momento em que tiver algum ajuste direto no
 * Malva acione imediatamente no Bunker web e Bunk"). Malva has no push for ad edits, so the executor asks each
 * configured project for its newest few budget/status edits every few seconds (a ~2 KB read). A new edit is
 * stored with its author at once, the project jumps to the front of the live reads, and a pulse counter lets
 * the web and the notch refresh without waiting for the minute pulse. Read-only: never proposes or executes. */
import {readHistoryPage,activityEvent} from './activity-history.mjs';

export const changeWatchPolicy=Object.freeze({tickMs:15000,heavyMs:60000,limit:10,targetsMs:10*60000,maxLiveReads:2});

export function changeWatchRequest(project){
 return {projectId:project.id,provider:['meta'],who:'people',level:['campaign'],category:['budget','status'],limit:changeWatchPolicy.limit,preset:'today'};
}

/** Edits newer than the stored head (newest first). The first look only records the head: nothing old replays. */
export function newChanges(head,items){
 if(!Array.isArray(items)||!items.length)return {fresh:[],head:head||null};
 const top={id:items[0].id,at:items[0].at};
 if(!head?.id)return {fresh:[],head:top};
 const i=items.findIndex(x=>x.id===head.id);
 const fresh=i>=0?items.slice(0,i):items.filter(x=>Date.parse(x.at)>Date.parse(head.at||''));
 return {fresh,head:fresh.length?top:head};
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

/** Live reads for this pulse: projects with fresh edits first, then the usual oldest-first order.
 * @param {any[]} projects @param {{first?:string[],urgent?:string[],lastSuccess?:Record<string,string>}} [order] */
export function liveOrder(projects,{first=[],urgent=[],lastSuccess={}}={}){
 const rank=id=>{const f=first.indexOf(id);if(f>=0)return f;const u=urgent.indexOf(id);return u>=0?50+u:99;};
 return projects.slice().sort((a,b)=>rank(a.projectId)-rank(b.projectId)||Date.parse(lastSuccess[a.projectId]||'1970-01-01')-Date.parse(lastSuccess[b.projectId]||'1970-01-01')).slice(0,changeWatchPolicy.maxLiveReads);
}
