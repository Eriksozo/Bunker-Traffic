/**
 * Cold archive of preserved measurements (curadoria of 14/11/2026).
 *
 * Live cause: `knowledgeMeasurements` lived whole inside the central record under a global ceiling of 1,200; once reached,
 * every collection failed at the storage commit. Raising the ceiling only moves the wall, and loading every measurement on
 * every read is not bounded either. So the loaded ("hot") list is bounded and the rest is stored, unchanged, in
 * content-addressed records written in the same transaction as the central compare-and-swap (the sealed format of
 * lib/history-storage.mjs), listed in `knowledgeMeasurementArchive.segments` and NOT loaded on read.
 *
 * Stays hot (pinned, never archived), so every synchronous reader keeps finding what it needs:
 * - a measurement of a window still present in the snapshots (retention dedupes and appends repeat reads only there);
 * - a measurement cited by a recorded result, knowledge entry or learning attempt (`measurement:<id>` / measurementId),
 *   so `outcomeWindow` revalidates those results;
 * - a daily measurement within 7 days of an application confirmed in the last 30 days (`autonomousLearningPlan`);
 * - a measurement of a window cited by an external result's request (`decision-history-outcomes` recall).
 * Beyond the pins, a project keeps at most `hotMeasurementsPerProject` loaded, and nothing older than
 * `hotMeasurementDays` (oldest read first). The index keeps, per segment, the project, the time span, the objects and the
 * external-action cuts, so the one-cut-per-side rule of retention also counts archived cuts.
 *
 * Nothing is deleted or rewritten: ids, keys, fetches, repeat reads, metrics and references travel as they are. A missing
 * or altered record fails closed (STORAGE_INTEGRITY). Older readers ignore the unknown field and records (no reader-first
 * step); they cannot recreate an archived measurement because its window is no longer in the snapshots.
 */
import {sealRecord,openRecord} from './history-storage.mjs';
import {knowledgeLimits,measurementLastRead,measurementReadAt} from './knowledge.mjs';

export const measurementArchivePolicy=Object.freeze({version:1,prefix:'history-measurements:',maxItemsPerSegment:150,maxSegmentBytes:900000,learningDays:30,learningWindowDays:7,maxKeysPerRead:400});
const day=86400000,arr=v=>Array.isArray(v)?v:[],t=v=>Date.parse(v);
const bytes=v=>new TextEncoder().encode(v).byteLength;
const win=(project,from,to)=>project+'|'+t(from)+'|'+t(to);

/** The ids and windows that must stay loaded (see the module comment). */
export function pinnedMeasurements(state,now=Date.now()){
 const windows=new Set(),ids=new Set(),learning=[];
 for(const s of arr(state.snapshots))if(Number.isFinite(t(s?.from))&&Number.isFinite(t(s?.to)))windows.add(win(s.projectId,s.from,s.to));
 const cited=JSON.stringify([state.knowledgeOutcomes,state.knowledge,state.learningAttempts]??[]);
 for(const m of cited.matchAll(/measurement:([A-Za-z0-9_-]{1,80})/g))ids.add(m[1]);
 for(const m of cited.matchAll(/"measurementId":"([A-Za-z0-9_-]{1,80})"/g))ids.add(m[1]);
 for(const o of arr(state.decisionHistoryOutcomes)){
  let entry=null;try{entry=typeof o?.request==='string'?JSON.parse(o.request):o?.request;}catch{entry=null;}
  for(const side of [entry?.before,entry?.after])if(side&&Number.isFinite(t(side.from))&&Number.isFinite(t(side.to)))windows.add(win(entry.project??side.projectId,side.from,side.to));
 }
 const confirmed=new Map();
 for(const e of arr(state.executions))if(e?.status==='Confirmada'&&Number.isFinite(t(e.confirmedAt))&&now-t(e.confirmedAt)<=measurementArchivePolicy.learningDays*day)confirmed.set(e.proposalId,t(e.confirmedAt));
 for(const p of arr(state.proposals))if(p?.execution?.status==='Confirmada'&&Number.isFinite(t(p.execution.confirmedAt))&&now-t(p.execution.confirmedAt)<=measurementArchivePolicy.learningDays*day)confirmed.set(p.id,t(p.execution.confirmedAt));
 for(const [id,at] of confirmed)learning.push({id,at});
 return {windows,ids,learning};
}
function pinned(m,pins){
 if(pins.ids.has(m.id)||pins.windows.has(win(m.project,m.from,m.to)))return true;
 const span=measurementArchivePolicy.learningWindowDays*day;
 return t(m.to)-t(m.from)===day&&pins.learning.some(l=>arr(m.proposalIds).includes(l.id)&&t(m.from)>=l.at-span&&t(m.to)<=l.at+span);
}

/** Index entry of one segment: what retention and the loader need without opening it. */
function indexEntry(key,project,items){
 const objects=[...new Set(items.map(m=>m.adAccountId+'|'+m.externalId))].sort();
 const history=items.flatMap(m=>arr(m.proposalIds).filter(p=>typeof p==='string'&&p.startsWith('history:')).map(p=>[p,m.from,m.to,m.adAccountId,m.externalId]));
 // Span over the readable windows only; null (unknown) keeps the segment in every window lookup.
 const starts=items.map(m=>t(m.from)).filter(Number.isFinite),ends=items.map(m=>t(m.to)).filter(Number.isFinite);
 const from=starts.length===items.length?new Date(Math.min(...starts)).toISOString():null,to=ends.length===items.length?new Date(Math.max(...ends)).toISOString():null;
 return {key,project,count:items.length,from,to,objects,...(history.length?{history}:{})};
}

/**
 * Moves the measurements that need not stay loaded to sealed records. Mutates `state.knowledgeMeasurements` (hot list)
 * and `state.knowledgeMeasurementArchive` (index). Returns the records to write in the same commit.
 * @returns {Promise<{records:Array<{key:string,payload:object}>,archived:number}>}
 */
export async function archiveColdMeasurements(state,now=Date.now()){
 const list=state?.knowledgeMeasurements;if(!Array.isArray(list)||!list.length)return {records:[],archived:0};
 const pins=pinnedMeasurements(state,now),cold=new Set(),byProject=new Map();
 for(const m of list){if(!byProject.has(m.project))byProject.set(m.project,[]);byProject.get(m.project).push(m);}
 for(const items of byProject.values()){
  const free=items.filter(m=>!pinned(m,pins)).sort((a,b)=>t(measurementLastRead(a))-t(measurementLastRead(b))||String(a.id).localeCompare(String(b.id)));
  let hot=items.length;
  for(const m of free){
   const old=now-t(measurementLastRead(m))>knowledgeLimits.hotMeasurementDays*day;
   if(!old&&hot<=knowledgeLimits.hotMeasurementsPerProject)break;
   cold.add(m);hot--;
  }
 }
 if(!cold.size)return {records:[],archived:0};
 const records=[],segments=[];
 for(const [project,items] of byProject){
  const leaving=items.filter(m=>cold.has(m));let chunk=[];
  const flush=async()=>{if(!chunk.length)return;const doc={kind:'bunker-measurement-archive',version:measurementArchivePolicy.version,project,items:chunk};const sealed=await sealRecord(doc),key=measurementArchivePolicy.prefix+sealed.hash;records.push({key,payload:sealed.payload});segments.push(indexEntry(key,project,chunk));chunk=[];};
  let size=0;
  for(const m of leaving){const b=bytes(JSON.stringify(m));if(chunk.length&&(chunk.length>=measurementArchivePolicy.maxItemsPerSegment||size+b>measurementArchivePolicy.maxSegmentBytes)){await flush();size=0;}chunk.push(m);size+=b;}
  await flush();
 }
 const prior=state.knowledgeMeasurementArchive;
 state.knowledgeMeasurementArchive={version:measurementArchivePolicy.version,segments:[...arr(prior?.segments),...segments]};
 state.knowledgeMeasurements=list.filter(m=>!cold.has(m));
 return {records,archived:cold.size};
}

function integrity(reason){const e=new Error('Arquivo de medições ausente ou inconsistente ('+reason+'). Nenhum dado foi substituído.');e.code='STORAGE_INTEGRITY';return e;}
/**
 * Exact archived measurements on demand. `fetch(keys)` → rows {key,payload}. `filter` narrows by project, object and
 * window (any field may be omitted). Every record read is verified (address, kind, project, count); a missing one fails.
 */
export async function loadArchivedMeasurements(index,fetch,{project,adAccountId,externalId,from,to}={}){
 const segments=arr(index?.segments).filter(s=>(!project||s.project===project)&&(!externalId||arr(s.objects).some(o=>o.endsWith('|'+externalId)&&(!adAccountId||o===adAccountId+'|'+externalId)))&&(!from||s.to===null||t(s.to)>=t(from))&&(!to||s.from===null||t(s.from)<=t(to)));
 for(const s of segments)if(typeof s?.key!=='string'||!new RegExp('^'+measurementArchivePolicy.prefix+'[0-9a-f]{64}$').test(s.key))throw integrity('chave');
 const keys=[...new Set(segments.map(s=>s.key))],rows=new Map();
 for(let i=0;i<keys.length;i+=measurementArchivePolicy.maxKeysPerRead)for(const r of await fetch(keys.slice(i,i+measurementArchivePolicy.maxKeysPerRead)))rows.set(r.key,r.payload);
 const out=[];
 for(const s of segments){
  const doc=await openRecord(s.key,rows.get(s.key));
  if(doc?.kind!=='bunker-measurement-archive'||doc.version!==measurementArchivePolicy.version||doc.project!==s.project||!Array.isArray(doc.items)||doc.items.length!==s.count||doc.items.some(m=>m?.project!==s.project))throw integrity('segmento');
  for(const m of doc.items)if((!adAccountId||m.adAccountId===adAccountId)&&(!externalId||m.externalId===externalId)&&(!from||t(m.from)===t(from))&&(!to||t(m.to)===t(to)))out.push(m);
 }
 return out;
}
/** True when `fetchedAt` is one of the reads of an archived measurement already loaded. Re-exported for the readers. */
export {measurementReadAt};
