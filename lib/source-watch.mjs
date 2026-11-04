/** Lightweight saved-data signals. Does not poll any upstream advertising API. */
export const SOURCE_WATCH_MS=2000;
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function signalKeys(values){
 if(!Array.isArray(values)||values.length>500||values.some(v=>typeof v!=='string'||!id.test(v))||new Set(values).size!==values.length)throw Error('Projetos inválidos.');
 return ['central',...values.slice().sort().flatMap(v=>['live:'+v,'creative:'+v])];
}
export async function sourceSignals(db,projects){
 const keys=signalKeys(projects),r=await db.prepare(`SELECT key,revision,updated_at FROM bunker_records WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all();
 if(r.success===false||!Array.isArray(r.results))throw Error('Sinais indisponíveis.');
 const rows=new Map();for(const row of r.results){if(!keys.includes(row.key)||rows.has(row.key)||!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('Sinais inválidos.');rows.set(row.key,{key:row.key,revision:row.revision,updatedAt:row.updated_at??null});}
 return {items:keys.map(key=>rows.get(key)||{key,revision:0,updatedAt:null})};
}
export function createSourceWatch({fetch:request=globalThis.fetch,getProjects,onChange,onError=(_value)=>{},visible=()=>true}){
 let running=false,disposed=false,baseline=null;const controller=new AbortController();
 return {async check(){
  if(running||disposed||!visible())return;running=true;
  try{
   const projects=getProjects().slice().sort(),keys=signalKeys(projects),response=await request('/api/sync?projects='+encodeURIComponent(projects.join(',')),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
   if(!response.ok)throw Error('Sinais indisponíveis.');const value=await response.json();
   if(!Array.isArray(value.items)||value.items.length!==keys.length)throw Error('Sinais incompletos.');
   const map=new Map();for(const row of value.items){if(!keys.includes(row.key)||map.has(row.key)||!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('Sinais inválidos.');map.set(row.key,row.revision);}
   if(disposed||!visible())return;
   if(baseline&&baseline.scope===projects.join(',')){
    // Replica regression never triggers a replacement of a newer local cache.
    if(keys.some(key=>map.get(key)<baseline.map.get(key)))throw Error('Sinal anterior à base.');
    const changed=keys.filter(key=>map.get(key)!==baseline.map.get(key));
    if(changed.length)onChange({central:changed.includes('central'),live:changed.some(k=>k.startsWith('live:')),creative:changed.some(k=>k.startsWith('creative:'))});
   }
   if(baseline&&baseline.scope!==projects.join(','))onChange({central:true,live:true,creative:true});
   baseline={scope:projects.join(','),map};onError(null);
  }catch{if(!disposed)onError('A conferência contínua está indisponível; a última leitura foi preservada.');}
  finally{running=false;}
 },dispose(){disposed=true;controller.abort();}};
}

/** Preserve a newer confirmed project read when an old response arrives late. */
export function mergeSourceFeed(previous,next){
 if(!next||!Array.isArray(next.projects)||!Array.isArray(next.items))throw Error('Leitura inválida.');
 const ids=new Set(next.projects.map(p=>p.projectId));if(ids.size!==next.projects.length||next.items.length!==ids.size)throw Error('Projetos duplicados ou leitura incompleta.');
 const merge=(incoming,prior)=>{const seen=new Set();return incoming.map(item=>{if(!ids.has(item.projectId)||seen.has(item.projectId)||!Number.isSafeInteger(item.revision)||item.revision<0)throw Error('Revisão de fonte inválida.');seen.add(item.projectId);const before=(prior||[]).find(p=>p.projectId===item.projectId);return before&&before.revision>item.revision?before:item;});};
 const priorCreative=(previous?.creativeItems||[]).filter(item=>ids.has(item.projectId));
 return {...next,items:merge(next.items,previous?.items),creativeItems:next.creativeError?priorCreative:next.creativeItems?merge(next.creativeItems,priorCreative):priorCreative};
}

/** A failed full read must recover even when the lightweight head succeeds
 * and never changes again. Passive checks are bounded and never retry writes. */
export function createReadRecovery({retry,now=Date.now,intervalMs=30000}){
 let failed=false,retryAt=0,running=false,disposed=false;
 return {failed(){failed=true;retryAt=now()+intervalMs;},succeeded(){failed=false;retryAt=0;},async check(visible=true){
  if(disposed||running||!visible||!failed||now()<retryAt)return false;
  running=true;retryAt=now()+intervalMs;
  try{await retry();return true;}catch{return false;}finally{running=false;}
 },dispose(){disposed=true;}};
}
