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
 */
export const historyStorageLimits=Object.freeze({version:1,hotDays:35,maxBlobBytes:1200000,maxKeysPerRead:400});
const CHANGES='history-changes:',OUTCOME='history-outcome:',HEAVY=['request','before','after'];
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
function expand(item,project){
 const {key,...rest}=item;
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
export async function packHistoryState(input,now=Date.now()){
 if(!object(input))return {state:input,archives:[],stats:{hotChanges:0,coldGroups:0,outcomes:0}};
 const state={...input},known=new Set(arr(input.historyStorage?.known)),archives=[],add=(key,payload)=>{if(!known.has(key)&&!archives.some(a=>a.key===key))archives.push({key,payload});};
 delete state.historyStorage;
 let hotChanges=0,coldGroups=0,outcomes=0;
 const hl=input.historyLearning;
 if(object(hl)&&Array.isArray(hl.changes)){
  if('changesStorage' in hl)throw integrity('estado já compactado recebido como lógico');
  const refs=new Set(arr(input.decisionHistoryOutcomes).flatMap(o=>arr(o?.otherChangeKeys)));
  const cutoff=new Date(now-historyStorageLimits.hotDays*dayMs).toISOString().slice(0,10),groups=new Map();
  for(const c of hl.changes){
   if(!object(c)||typeof c.project!=='string')throw integrity('mudança sem projeto');
   const g=[c.project,dayOf(c),financial(c)?'f':'o'].join('|');(groups.get(g)||groups.set(g,[]).get(g)).push(c);
  }
  const entries=[],cold=arr(hl.changesArchive).slice();
  for(const g of [...groups.keys()].sort()){
   const [project,day,cls]=g.split('|'),items=canonicalChanges(groups.get(g));
   const hot=cls==='f'||day==='sem-data'||day>=cutoff||items.some(c=>refs.has(c.key));
   const head={kind:'bunker-history-changes',version:historyStorageLimits.version,project,day,cls};
   const parts=chunks(items.map(c=>compact(c,project)),head);
   for(let part=0;part<parts.length;part++){
    const sealed=await seal({...head,part,items:parts[part]}),key=CHANGES+sealed.hash,entry={key,project,day,cls,part,count:parts[part].length};
    if(!hot)entry.campaigns=[...new Set(parts[part].map(c=>[c.adAccountId,c.campaignExternalId].join('|')))].sort();
    add(key,sealed.payload);
    if(hot){entries.push(entry);hotChanges+=entry.count;}else if(!cold.some(e=>e.key===key)){cold.push(entry);coldGroups++;}
   }
  }
  // Same key order as the logical object: `changesStorage` takes the place of `changes`.
  const out={};
  for(const [k,v] of Object.entries(hl)){if(k==='changes')out.changesStorage={version:historyStorageLimits.version,entries};else if(k!=='changesArchive')out[k]=v;}
  if(cold.length)out.changesArchive=cold;
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
 return {state,archives,stats:{hotChanges,coldGroups,outcomes}};
}

/** True when a measurement window [fromIso, toIso] of this campaign touches a cold (stored, not loaded) group. */
export function archivedWindow(historyLearning,project,adAccountId,campaign,fromIso,toIso){
 const utc=v=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null;},from=utc(fromIso),to=utc(toIso),id=[adAccountId,campaign].join('|');
 if(!from||!to)return false;
 return arr(historyLearning?.changesArchive).some(g=>g.project===project&&g.day>=from&&g.day<=to&&(!Array.isArray(g.campaigns)||g.campaigns.includes(id)));
}

/** Every record the central state points to and loads on read. */
export function historyKeys(stored){
 const keys=[];
 for(const e of arr(stored?.historyLearning?.changesStorage?.entries))keys.push(e?.key);
 for(const o of arr(stored?.decisionHistoryOutcomes))if(object(o?.partsStorage))keys.push(o.partsStorage.key);
 return keys;
}

/**
 * Central state (already decoded) + its records → logical state, identical to what was packed (changes in canonical
 * order). `fetch(keys)` returns rows {key,payload}. Fails closed on any missing, extra or altered record.
 */
export async function hydrateHistoryState(stored,fetch){
 if(!object(stored))return stored;
 const keys=historyKeys(stored);
 const hasLedger=object(stored.historyLearning?.changesStorage);
 if(!keys.length&&!hasLedger)return stored;
 for(const k of keys)if(typeof k!=='string'||!/^history-(changes|outcome):[0-9a-f]{64}$/.test(k))throw integrity('chave');
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
  for(const e of changesStorage.entries){
   const doc=await read(e.key);
   if(doc.kind!=='bunker-history-changes'||doc.project!==e.project||doc.day!==e.day||doc.cls!==e.cls||doc.part!==e.part||!Array.isArray(doc.items)||doc.items.length!==e.count)throw integrity('grupo de mudanças');
   for(const item of doc.items)changes.push(expand(item,doc.project));
  }
  // An older Worker (rollback, stale deploy) may have written inline `changes` next to the index: keep both, never
  // let one key hide the other. Same key twice keeps the indexed copy.
  const seen=new Set(changes.map(c=>c.key));
  for(const c of arr(stored.historyLearning.changes))if(object(c)&&!seen.has(c.key)){changes.push(c);seen.add(c.key);}
  const sorted=canonicalChanges(changes),out={};
  for(const [k,v] of Object.entries(stored.historyLearning)){if(k==='changesStorage')out.changes=sorted;else if(k!=='changes')out[k]=v;}
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
 // Unchanged records are not resent on the next commit (the keys are content hashes of what was just verified).
 if(unique.length)state.historyStorage={version:historyStorageLimits.version,known:unique};
 return state;
}

/** After a commit: the logical state as the next read will return it (same ledger order, cold groups, known records). */
export function historyView(logical,packed){
 if(!object(logical))return logical;
 const out={...logical};delete out.historyStorage;
 if(object(logical.historyLearning)&&Array.isArray(logical.historyLearning.changes)){
  const hot=new Set(arr(packed?.historyLearning?.changesStorage?.entries).map(e=>[e.project,e.day,e.cls].join('|')));
  const archive=packed?.historyLearning?.changesArchive,view={};
  for(const [k,v] of Object.entries(logical.historyLearning)){
   if(k==='changes')view.changes=canonicalChanges(v.filter(c=>hot.has([c.project,dayOf(c),financial(c)?'f':'o'].join('|'))));
   else if(k!=='changesArchive')view[k]=v;
  }
  if(archive)view.changesArchive=archive;
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
