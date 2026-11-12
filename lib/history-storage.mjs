/**
 * History evidence outside the central record (owner approval of 2026-11-08, "Sim, implementar").
 *
 * The central record had ~30 KB left before every write would be refused (STORAGE_LIMIT). Its heaviest parts were
 * the history ledger (historyLearning.changes) and the preserved evidence of each measured result (request, before,
 * after). They now live in their own content-addressed records of bunker_records, written in the same transaction
 * as the central compare-and-swap, and are read back in one query. Nothing is deleted:
 * - changes are grouped by project, UTC day and class (budget/status vs other edits);
 * - a non-financial group older than `hotDays`, with no change cited by a measured result, becomes "cold": it stays
 *   stored and listed in `historyLearning.changesArchive`, but is no longer loaded on every read;
 * - each measured result keeps its summary in the central and its evidence in `history-outcome:<sha256>`.
 * A missing or altered record fails closed (STORAGE_INTEGRITY): nothing is ever replaced by an empty list.
 *
 * Cold by change, not by group (owner report of 2026-11-12, "Histórico de mudanças em 90% do teto", then "Sim,
 * arquivar"). The ledger took 2,000 to 5,000 edits of ad sets and ads a day, and a whole project-day stayed loaded
 * while one measured result cited one change of it. Only three readers reach a non-financial change: the evidence
 * version of a budget/status event (changes of the same campaign less than 3 days away), the measurement of that event
 * (its window lies inside those 3 days) and the recall of what a measured result cited (results observed in the last
 * 30 days). So a non-financial change now stays loaded when a measured result observed within `hotDays` cites it, or
 * when it is younger than `hotDays` and either younger than `quietDays` or within `reachDays` of a budget/status event
 * of its own campaign. Every other one goes cold: stored, listed by campaign, day and time span, not loaded. A
 * measurement whose window touches a cold change of its campaign still gets the "arquivada" limitation
 * (`archivedWindow`) and stays "Inconclusivo", exactly as it would with the change loaded. The archive index is
 * append-only and lives in its own segments (`changesArchiveStorage`), not in the central record.
 */
export const historyStorageLimits=Object.freeze({version:1,hotDays:35,quietDays:5,reachDays:3,archivePer:40,maxBlobBytes:1200000,maxKeysPerRead:400});
/**
 * Append-only journals kept outside the central record (owner report of 2026-11-09: the notch warned "Armazenamento
 * central em 87%", "isso nunca deve acontecer"). Each journal is cut into fixed-size segments by position, so the old
 * segments of an append-only list keep their content address and are never resent; a mutated item only re-seals its
 * own segment. Nothing is deleted. Two-step rollout: the reader shipped first (5542242) and was confirmed in the running
 * executor (`storageFormat.journalReader`) before `write` was turned on; an older Worker would read the journals as empty.
 */
export const journalStorage=Object.freeze({version:1,write:true,per:Object.freeze({decisionHistory:100,decisionHistoryImports:40,campaignChanges:250,externalHistoryMeasurements:200})});
const CHANGES='history-changes:',OUTCOME='history-outcome:',JOURNAL='history-journal:',ARCHIVE='changesArchive',HEAVY=['request','before','after'];
// What the last pack of a state sent cold and its full archive index, for `historyView` (never stored).
const packedLedger=new WeakMap();
const encoder=new TextEncoder(),bytes=v=>encoder.encode(v).byteLength,arr=v=>Array.isArray(v)?v:[];
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),dayMs=86400000;

function integrity(reason){const e=new Error('Histórico arquivado ausente ou inconsistente ('+reason+'). Nenhum dado foi substituído.');e.code='STORAGE_INTEGRITY';return e;}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
async function streamBytes(stream,limit){
 const reader=stream.getReader(),chunks=[];let size=0;
 try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>limit)throw integrity('expansão acima do limite');chunks.push(x.value);}}
 finally{reader.releaseLock();}
 const out=new Uint8Array(size);let o=0;for(const c of chunks){out.set(c,o);o+=c.byteLength;}return out;
}
/** Records are stored compressed (the history used to travel gzipped inside the central; plain JSON would multiply
 * every read). The key is the SHA-256 of the uncompressed document, verified after decompression. */
async function seal(doc){
 const raw=JSON.stringify(doc),bytesRaw=encoder.encode(raw);
 const data=base64(await streamBytes(new Blob([bytesRaw]).stream().pipeThrough(new CompressionStream('gzip')),historyStorageLimits.maxBlobBytes*2));
 return {hash:await sha(raw),payload:{kind:'bunker-history-blob',version:historyStorageLimits.version,encoding:'gzip-base64',rawBytes:bytesRaw.byteLength,data}};
}
async function open(text){
 let p;try{p=JSON.parse(text);}catch{throw integrity('JSON');}
 if(p?.kind!=='bunker-history-blob'||p.version!==historyStorageLimits.version||p.encoding!=='gzip-base64'||!Number.isSafeInteger(p.rawBytes)||p.rawBytes<2||p.rawBytes>historyStorageLimits.maxBlobBytes*4||typeof p.data!=='string')throw integrity('envelope');
 let compressed;try{compressed=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0));}catch{throw integrity('base64');}
 let raw;try{raw=await streamBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),p.rawBytes);}catch(e){throw e?.code==='STORAGE_INTEGRITY'?e:integrity('conteúdo compactado');}
 if(raw.byteLength!==p.rawBytes)throw integrity('tamanho');
 return new TextDecoder('utf-8',{fatal:true}).decode(raw);
}
async function sha(text){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)));return Array.from(h,b=>b.toString(16).padStart(2,'0')).join('');}
const canonicalChanges=list=>list.slice().sort((a,b)=>String(a.at).localeCompare(String(b.at))||String(a.key).localeCompare(String(b.key)));
const dayOf=c=>typeof c?.at==='string'&&/^\d{4}-\d{2}-\d{2}/.test(c.at)?c.at.slice(0,10):'sem-data';
const financial=c=>c?.field!==undefined&&c?.field!==null;

/** One change without what the group already says: the project, and the key when it is the standard [project,eventId]. */
function compact(c,project){
 const {key,project:p,...rest}=c;
 if(p!==project)throw integrity('projeto do grupo');
 return key===JSON.stringify([project,c.eventId])?rest:{key,...rest};
}
/**
 * Text that repeats across the ledger (owner report of 2026-11-12: "Histórico de mudanças em 90% do teto"). A parsed
 * record gives every change its own copy of the account, campaign, object, level, category and source; one campaign
 * has dozens of changes a day. `share` hands back the first copy seen in this read, so the loaded ledger keeps one
 * string per distinct value. Same values, same order, same keys: only the memory changes (tests/history-storage.test.mjs).
 */
export const sharedChangeText=Object.freeze(['adAccountId','campaignExternalId','objectExternalId','level','category','source','at','field','before','after']);
function textPool(){const pool=new Map();return v=>{if(typeof v!=='string')return v;const seen=pool.get(v);if(seen!==undefined)return seen;pool.set(v,v);return v;};}
function expand(item,project,share){
 const {key,...rest}=item;
 if(share)for(const f of sharedChangeText)if(typeof rest[f]==='string')rest[f]=share(rest[f]);
 return {key:key??JSON.stringify([project,item.eventId]),project,...rest};
}
/** Splits items so each record stays far below the 1.75 MB per-record limit. */
function chunks(items,head){
 const out=[];let current=[],size=bytes(JSON.stringify({...head,part:0,items:[]}));
 for(const item of items){const s=bytes(JSON.stringify(item))+1;if(current.length&&size+s>historyStorageLimits.maxBlobBytes){out.push(current);current=[];size=bytes(JSON.stringify({...head,part:0,items:[]}));}current.push(item);size+=s;}
 if(current.length)out.push(current);
 return out;
}

/**
 * Logical state → state for the central record plus the new records to write with it.
 * `known` keys (read in this same state) are not resent: unchanged groups cost nothing per commit.
 * @returns {Promise<{state:any,archives:Array<{key:string,payload:object}>,stats:{hotChanges:number,coldGroups:number,outcomes:number}}>}
 * Each archive payload is a compressed envelope; its key is the SHA-256 of the uncompressed document.
 */
export async function packHistoryState(input,now=Date.now(),{journals:writeJournals=journalStorage.write}={}){
 if(!object(input))return {state:input,archives:[],stats:{hotChanges:0,coldGroups:0,outcomes:0}};
 if(input.historyStorage?.lean===true)throw integrity('leitura parcial recebida para gravação');
 const state={...input},known=new Set(arr(input.historyStorage?.known)),archives=[],add=(key,payload)=>{if(!known.has(key)&&!archives.some(a=>a.key===key))archives.push({key,payload});};
 delete state.historyStorage;
 let hotChanges=0,coldGroups=0,outcomes=0;
 const hl=input.historyLearning;
 // An index without its loaded changes is a packed or lean state, never a logical one.
 if(object(hl)&&('changesStorage' in hl||'changesArchiveStorage' in hl))throw integrity('estado já compactado recebido como lógico');
 if(object(hl)&&Array.isArray(hl.changes)){
  // A result without a readable observation time keeps what it cites loaded.
  const refs=new Set(arr(input.decisionHistoryOutcomes).filter(o=>!(Date.parse(o?.observedAt)<now-historyStorageLimits.hotDays*dayMs)).flatMap(o=>arr(o?.otherChangeKeys)));
  const dayAt=ms=>new Date(ms).toISOString().slice(0,10),cutoff=dayAt(now-historyStorageLimits.hotDays*dayMs),quiet=dayAt(now-historyStorageLimits.quietDays*dayMs),reach=historyStorageLimits.reachDays*dayMs;
  // Budget/status events by campaign: the ledger's own financial changes and every preserved decision event.
  const events=new Map(),campaign=(project,account,id)=>[project,account,id].join('|');
  const seen=(key,when)=>{const t=Date.parse(when);if(Number.isFinite(t))(events.get(key)||events.set(key,[]).get(key)).push(t);};
  const groups=new Map();
  for(const c of hl.changes){
   if(!object(c)||typeof c.project!=='string')throw integrity('mudança sem projeto');
   const g=[c.project,dayOf(c),financial(c)?'f':'o'].join('|');(groups.get(g)||groups.set(g,[]).get(g)).push(c);
   if(financial(c))seen(campaign(c.project,c.adAccountId,c.campaignExternalId),c.at);
  }
  for(const e of arr(input.decisionHistory))if(object(e))seen(campaign(e.project,e.adAccountId,e.objectId),e.occurredAt);
  // An unreadable time is never a reason to archive.
  const near=c=>{const t=Date.parse(c.at);if(!Number.isFinite(t))return true;const list=events.get(campaign(c.project,c.adAccountId,c.campaignExternalId));return !!list&&list.some(e=>Math.abs(e-t)<=reach);};
  const entries=[],cold=arr(hl.changesArchive).slice(),gone=new Set();
  for(const g of [...groups.keys()].sort()){
   const [project,day,cls]=g.split('|'),items=canonicalChanges(groups.get(g));
   let keep=items,rest=[];
   if(cls==='o'&&day!=='sem-data'&&day<quiet){
    const old=day<cutoff;keep=[];
    for(const c of items)(refs.has(c.key)||!old&&near(c)?keep:rest).push(c);
   }
   const head={kind:'bunker-history-changes',version:historyStorageLimits.version,project,day,cls};
   for(const [list,hot] of [[keep,true],[rest,false]]){
    const parts=chunks(list.map(c=>compact(c,project)),head);
    for(let part=0;part<parts.length;part++){
     const sealed=await seal({...head,part,items:parts[part]}),key=CHANGES+sealed.hash,entry={key,project,day,cls,part,count:parts[part].length};
     if(!hot){
      // First and last moment of each campaign's archived changes, so a window is limited only when it can hold one.
      const spans=new Map();
      for(const c of parts[part]){const id=[c.adAccountId,c.campaignExternalId].join('|'),t=Date.parse(c.at),span=spans.get(id);if(!spans.has(id))spans.set(id,Number.isFinite(t)?[t,t]:null);else if(span&&Number.isFinite(t)){if(t<span[0])span[0]=t;if(t>span[1])span[1]=t;}else spans.set(id,null);}
      entry.campaigns=[...spans.keys()].sort();entry.spans=entry.campaigns.map(id=>spans.get(id));
     }
     add(key,sealed.payload);
     if(hot){entries.push(entry);hotChanges+=entry.count;}else if(!cold.some(e=>e.key===key)){cold.push(entry);coldGroups++;}
    }
   }
   for(const c of rest)gone.add(c.key);
  }
  // Same key order as the logical object: `changesStorage` takes the place of `changes`.
  const out={};
  for(const [k,v] of Object.entries(hl)){if(k==='changes')out.changesStorage={version:historyStorageLimits.version,entries};else if(k!=='changesArchive')out[k]=v;}
  if(cold.length){
   // Append-only list cut by position, like the journals: only the last segment is ever resealed.
   const segments=[],per=historyStorageLimits.archivePer;
   for(let index=0;index*per<cold.length;index++){
    const items=cold.slice(index*per,(index+1)*per),doc={kind:'bunker-history-journal',version:historyStorageLimits.version,name:ARCHIVE,index,items};
    if(bytes(JSON.stringify(doc))>historyStorageLimits.maxBlobBytes*4)throw integrity('segmento acima do limite');
    const sealed=await seal(doc),key=JOURNAL+sealed.hash;add(key,sealed.payload);segments.push({key,count:items.length});
   }
   out.changesArchiveStorage={version:historyStorageLimits.version,segments};
  }
  packedLedger.set(out,{gone,archive:cold});
  state.historyLearning=out;
 }
 if(Array.isArray(input.decisionHistoryOutcomes)){
  state.decisionHistoryOutcomes=[];
  for(const o of input.decisionHistoryOutcomes){
   if(!object(o)||!HEAVY.some(k=>k in o)||'partsStorage' in o){state.decisionHistoryOutcomes.push(o);continue;}
   const parts=Object.fromEntries(HEAVY.filter(k=>k in o).map(k=>[k,o[k]]));
   const doc={kind:'bunker-history-outcome',version:historyStorageLimits.version,id:o.id,order:Object.keys(o),parts},text=JSON.stringify(doc);
   if(bytes(text)>historyStorageLimits.maxBlobBytes){state.decisionHistoryOutcomes.push(o);continue;}
   const sealed=await seal(doc),key=OUTCOME+sealed.hash,stub={};for(const [k,v] of Object.entries(o))if(!HEAVY.includes(k))stub[k]=v;
   stub.partsStorage={key};add(key,sealed.payload);state.decisionHistoryOutcomes.push(stub);outcomes++;
  }
 }
 if('journalStorage' in input)throw integrity('estado já compactado recebido como lógico');
 if(writeJournals){
  const journals={};
  for(const [name,per] of Object.entries(journalStorage.per)){
   const list=input[name];if(!Array.isArray(list)||!list.length)continue;
   const segments=[];
   for(let index=0;index*per<list.length;index++){
    const items=list.slice(index*per,(index+1)*per),doc={kind:'bunker-history-journal',version:historyStorageLimits.version,name,index,items};
    if(bytes(JSON.stringify(doc))>historyStorageLimits.maxBlobBytes*4)throw integrity('segmento acima do limite');
    const sealed=await seal(doc),key=JOURNAL+sealed.hash;add(key,sealed.payload);segments.push({key,count:items.length});
   }
   journals[name]=segments;delete state[name];
  }
  if(Object.keys(journals).length)state.journalStorage={version:journalStorage.version,journals};
 }
 return {state,archives,stats:{hotChanges,coldGroups,outcomes}};
}

/**
 * True when a measurement window (fromIso, toIso) of this campaign can hold a cold (stored, not loaded) change.
 * An entry that carries the campaign's time span answers by time; an older entry, or one without a readable time,
 * answers by UTC day, which only ever limits more.
 */
export function archivedWindow(historyLearning,project,adAccountId,campaign,fromIso,toIso){
 const start=Date.parse(fromIso),end=Date.parse(toIso),id=[adAccountId,campaign].join('|');
 if(!Number.isFinite(start)||!Number.isFinite(end))return false;
 const from=new Date(start).toISOString().slice(0,10),to=new Date(end).toISOString().slice(0,10);
 return arr(historyLearning?.changesArchive).some(g=>{
  if(g.project!==project||!(g.day>=from&&g.day<=to))return false;
  if(!Array.isArray(g.campaigns))return true;
  const i=g.campaigns.indexOf(id);if(i<0)return false;
  const span=Array.isArray(g.spans)?g.spans[i]:null;
  return !Array.isArray(span)||!Number.isFinite(span[0])||!Number.isFinite(span[1])||span[1]>start&&span[0]<end;
 });
}

/** Every record the central state points to and loads on read. */
export function historyKeys(stored){
 const keys=[];
 for(const e of arr(stored?.historyLearning?.changesStorage?.entries))keys.push(e?.key);
 for(const e of arr(stored?.historyLearning?.changesArchiveStorage?.segments))keys.push(e?.key);
 for(const o of arr(stored?.decisionHistoryOutcomes))if(object(o?.partsStorage))keys.push(o.partsStorage.key);
 if(object(stored?.journalStorage?.journals))for(const list of Object.values(stored.journalStorage.journals))for(const e of arr(list))keys.push(e?.key);
 return keys;
}

/**
 * Display-only reading (owner report of 10/11/2026: the executor object was reset for memory every few minutes; each
 * full copy of the central is ~40 MB in a 128 MB object). The notch, the web summary, the Sombra, the account panel and
 * the first-24h board never read the change ledger, the evidence of measured results, the import receipts or the external
 * measurements (tests/lean-view.test.mjs), so a lean reading leaves them in their records. A lean state can never be
 * committed: it keeps the indexes, which `packHistoryState` refuses, and is marked `historyStorage.lean`.
 */
export const leanHistory=Object.freeze({journals:Object.freeze(['decisionHistory','campaignChanges'])});
/**
 * Central state (already decoded) + its records → logical state, identical to what was packed (changes in canonical
 * order). `fetch(keys)` returns rows {key,payload}. Fails closed on any missing, extra or altered record.
 * `lean`: only the journals in `leanHistory.journals` are loaded (display readers only, never committed).
 */
export async function hydrateHistoryState(stored,fetch,{lean=false}={}){
 if(!object(stored))return stored;
 if(lean)return hydrateLean(stored,fetch);
 const keys=historyKeys(stored);
 const hasLedger=object(stored.historyLearning?.changesStorage);
 if(!hasLedger&&object(stored.historyLearning)&&'changesArchiveStorage' in stored.historyLearning)throw integrity('índice dos arquivados sem as mudanças');
 const hasJournals='journalStorage' in stored;
 if(!keys.length&&!hasLedger&&!hasJournals)return stored;
 for(const k of keys)if(typeof k!=='string'||!/^history-(changes|outcome|journal):[0-9a-f]{64}$/.test(k))throw integrity('chave');
 const unique=[...new Set(keys)],rows=new Map();
 for(let i=0;i<unique.length;i+=historyStorageLimits.maxKeysPerRead)for(const r of await fetch(unique.slice(i,i+historyStorageLimits.maxKeysPerRead)))rows.set(r.key,r.payload);
 const read=async key=>{
  const payload=rows.get(key);if(typeof payload!=='string')throw integrity('registro ausente');
  const raw=await open(payload);
  if(key.slice(key.indexOf(':')+1)!==await sha(raw))throw integrity('assinatura do conteúdo');
  let doc;try{doc=JSON.parse(raw);}catch{throw integrity('JSON');}
  if(doc?.version!==historyStorageLimits.version)throw integrity('versão');
  return doc;
 };
 const state={...stored};
 if(hasLedger){
  const {changesStorage}=stored.historyLearning,changes=[];
  if(changesStorage.version!==historyStorageLimits.version||!Array.isArray(changesStorage.entries))throw integrity('índice das mudanças');
  const share=textPool();
  for(const e of changesStorage.entries){
   const doc=await read(e.key);
   if(doc.kind!=='bunker-history-changes'||doc.project!==e.project||doc.day!==e.day||doc.cls!==e.cls||doc.part!==e.part||!Array.isArray(doc.items)||doc.items.length!==e.count)throw integrity('grupo de mudanças');
   const project=share(doc.project);
   for(const item of doc.items)changes.push(expand(item,project,share));
  }
  // An older Worker (rollback, stale deploy) may have written inline `changes` next to the index: keep both, never
  // let one key hide the other. Same key twice keeps the indexed copy.
  const seen=new Set(changes.map(c=>c.key));
  for(const c of arr(stored.historyLearning.changes))if(object(c)&&!seen.has(c.key)){changes.push(c);seen.add(c.key);}
  const sorted=canonicalChanges(changes),out={};
  for(const [k,v] of Object.entries(stored.historyLearning)){if(k==='changesStorage')out.changes=sorted;else if(!['changes','changesArchive','changesArchiveStorage'].includes(k))out[k]=v;}
  // The archive index: its segments first, then whatever an older Worker (rollback, stale deploy) wrote inline.
  const archive=[],index=stored.historyLearning.changesArchiveStorage;
  if(index!==undefined){
   if(!object(index)||index.version!==historyStorageLimits.version||!Array.isArray(index.segments))throw integrity('índice dos arquivados');
   for(let i=0;i<index.segments.length;i++){
    const doc=await read(index.segments[i]?.key);
    if(doc.kind!=='bunker-history-journal'||doc.name!==ARCHIVE||doc.index!==i||!Array.isArray(doc.items)||doc.items.length!==index.segments[i].count)throw integrity('segmento dos arquivados');
    for(const e of doc.items){if(!object(e)||typeof e.key!=='string')throw integrity('grupo arquivado');if(Array.isArray(e.campaigns))e.campaigns=e.campaigns.map(share);archive.push(e);}
   }
  }
  const listed=new Set(archive.map(e=>e.key));
  for(const e of arr(stored.historyLearning.changesArchive))if(object(e)&&!listed.has(e.key)){archive.push(e);listed.add(e.key);}
  if(archive.length)out.changesArchive=archive;
  state.historyLearning=out;
 }
 if(Array.isArray(stored.decisionHistoryOutcomes)){
  state.decisionHistoryOutcomes=[];
  for(const o of stored.decisionHistoryOutcomes){
   if(!object(o?.partsStorage)){state.decisionHistoryOutcomes.push(o);continue;}
   const doc=await read(o.partsStorage.key);
   if(doc.kind!=='bunker-history-outcome'||doc.id!==o.id||!Array.isArray(doc.order)||!object(doc.parts))throw integrity('resultado medido');
   const out={};for(const k of doc.order){if(k in doc.parts)out[k]=doc.parts[k];else if(k in o)out[k]=o[k];}
   for(const [k,v] of Object.entries(o))if(k!=='partsStorage'&&!(k in out))out[k]=v;
   state.decisionHistoryOutcomes.push(out);
  }
 }
 if(hasJournals){
  const index=stored.journalStorage;
  if(!object(index)||index.version!==journalStorage.version||!object(index.journals))throw integrity('índice dos diários');
  for(const [name,segments] of Object.entries(index.journals)){
   if(!Object.prototype.hasOwnProperty.call(journalStorage.per,name)||!Array.isArray(segments))throw integrity('diário desconhecido');
   const items=[];
   for(let i=0;i<segments.length;i++){
    const doc=await read(segments[i]?.key);
    if(doc.kind!=='bunker-history-journal'||doc.name!==name||doc.index!==i||!Array.isArray(doc.items)||doc.items.length!==segments[i].count)throw integrity('segmento do diário');
    items.push(...doc.items);
   }
   // An older Worker (rollback, stale deploy) may have appended inline next to the index: keep both, never one hiding
   // the other. Same id twice keeps the indexed copy.
   const seen=new Set(items.map(x=>x?.id).filter(Boolean));
   for(const x of arr(stored[name]))if(!object(x)||!x.id||!seen.has(x.id)){items.push(x);if(x?.id)seen.add(x.id);}
   state[name]=items;
  }
  delete state.journalStorage;
 }
 // Unchanged records are not resent on the next commit (the keys are content hashes of what was just verified).
 if(unique.length)state.historyStorage={version:historyStorageLimits.version,known:unique};
 return state;
}

async function hydrateLean(stored,fetch){
 const index=stored.journalStorage,wanted=leanHistory.journals;
 if(index!==undefined&&(!object(index)||index.version!==journalStorage.version||!object(index.journals)))throw integrity('índice dos diários');
 const journals=object(index?.journals)?index.journals:{},keys=[];
 for(const [name,segments] of Object.entries(journals)){
  if(!Object.prototype.hasOwnProperty.call(journalStorage.per,name)||!Array.isArray(segments))throw integrity('diário desconhecido');
  if(wanted.includes(name))for(const e of segments)keys.push(e?.key);
 }
 for(const k of keys)if(typeof k!=='string'||!/^history-journal:[0-9a-f]{64}$/.test(k))throw integrity('chave');
 const unique=[...new Set(keys)],rows=new Map();
 for(let i=0;i<unique.length;i+=historyStorageLimits.maxKeysPerRead)for(const r of await fetch(unique.slice(i,i+historyStorageLimits.maxKeysPerRead)))rows.set(r.key,r.payload);
 const state={...stored},rest={};
 for(const [name,segments] of Object.entries(journals)){
  if(!wanted.includes(name)){rest[name]=segments;continue;}
  const items=[];
  for(let i=0;i<segments.length;i++){
   const key=segments[i].key,payload=rows.get(key);if(typeof payload!=='string')throw integrity('registro ausente');
   const raw=await open(payload);if(key.slice(key.indexOf(':')+1)!==await sha(raw))throw integrity('assinatura do conteúdo');
   let doc;try{doc=JSON.parse(raw);}catch{throw integrity('JSON');}
   if(doc?.version!==historyStorageLimits.version||doc.kind!=='bunker-history-journal'||doc.name!==name||doc.index!==i||!Array.isArray(doc.items)||doc.items.length!==segments[i].count)throw integrity('segmento do diário');
   items.push(...doc.items);
  }
  const seen=new Set(items.map(x=>x?.id).filter(Boolean));
  for(const x of arr(stored[name]))if(!object(x)||!x.id||!seen.has(x.id)){items.push(x);if(x?.id)seen.add(x.id);}
  state[name]=items;
 }
 // The indexes stay: an accidental commit of this state is refused by packHistoryState (never an empty ledger).
 state.journalStorage={version:journalStorage.version,journals:rest};
 state.historyStorage={version:historyStorageLimits.version,known:unique,lean:true};
 return state;
}

/** After a commit: the logical state as the next read will return it (same ledger order, cold groups, known records). */
export function historyView(logical,packed){
 if(!object(logical))return logical;
 const out={...logical};delete out.historyStorage;
 if(object(logical.historyLearning)&&Array.isArray(logical.historyLearning.changes)){
  const hot=new Set(arr(packed?.historyLearning?.changesStorage?.entries).map(e=>[e.project,e.day,e.cls].join('|')));
  // A group can be half loaded, half cold: the pack that produced `packed` says which changes it archived.
  const sent=packedLedger.get(packed?.historyLearning),archive=sent?.archive??packed?.historyLearning?.changesArchive??logical.historyLearning.changesArchive,view={};
  for(const [k,v] of Object.entries(logical.historyLearning)){
   if(k==='changes')view.changes=canonicalChanges(v.filter(c=>hot.has([c.project,dayOf(c),financial(c)?'f':'o'].join('|'))&&!sent?.gone.has(c.key)));
   else if(k!=='changesArchive')view[k]=v;
  }
  if(arr(archive).length)view.changesArchive=archive;
  out.historyLearning=view;
 }
 const known=[...new Set(historyKeys(packed))];
 if(known.length)out.historyStorage={version:historyStorageLimits.version,known};
 return out;
}

/** Storage pressure for the panel and the notch: warn at 85% of the central limit or of the hot-change ceiling. */
export function storagePressure({storedBytes=0,limitBytes=1,hotChanges=0,maximumChanges=1}={}){
 const central=storedBytes/limitBytes,ledger=hotChanges/maximumChanges,level=Math.max(central,ledger);
 return {centralPct:Math.round(central*1000)/10,ledgerPct:Math.round(ledger*1000)/10,warning:level>=0.85,critical:level>=0.95,
  message:level>=0.85?(central>=ledger?`Armazenamento central em ${Math.round(central*100)}% do limite: acima de 100% o Bunker recusa gravações.`:`Histórico de mudanças em ${Math.round(ledger*100)}% do teto: ao chegar a 100% o aprendizado pausa.`):null};
}
