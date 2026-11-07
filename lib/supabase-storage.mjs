import {safeMcpDiagnostic} from './cloud-malva.mjs';
export const slowStorageMs=2000;
const storageOps=new Set(['cas','commit','get','daily','suggestions','collaborations','reports','resolutions','cloudExecutor','malvaRead','malvaMcp','orbitaMcp']);
const storageKeyClasses=new Set(['central','collaboration','snapshots','daily','suggestions','live','creative','other']);
const storageTransports=new Set(['timeout','network','decode']);
// Supabase request ids are UUIDs; Cloudflare rays are 16 hex digits plus the colo.
const requestIdPattern=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16}-[A-Z]{3})$/;
const keyClass=key=>{if(typeof key!=='string')return 'other';if(key==='central')return 'central';const i=key.indexOf(':'),c=i>0&&i<key.length-1?key.slice(0,i):'';return c!=='central'&&c!=='other'&&storageKeyClasses.has(c)?c:'other';};
/** Correlatable storage diagnostic: known operation, key classes, timing and status only — never payloads, keys, SQL, URLs or credentials. */
export function safeStorageDiagnostic(value){
 if(!value||typeof value!=='object'||!storageOps.has(value.op))return null;
 const out={op:value.op};
 if(Array.isArray(value.keyClasses))out.keyClasses=[...new Set(value.keyClasses.filter(k=>storageKeyClasses.has(k)))].sort();
 if(Number.isSafeInteger(value.keyCount)&&value.keyCount>=0)out.keyCount=Math.min(value.keyCount,10000);
 if(Number.isFinite(value.ms)&&value.ms>=0)out.ms=Math.min(Math.round(value.ms),600000);
 if(Number.isSafeInteger(value.status)&&value.status>=100&&value.status<=599)out.status=value.status;
 if(typeof value.pgCode==='string'&&/^[0-9A-Z]{5}$/.test(value.pgCode))out.pgCode=value.pgCode;
 if(storageTransports.has(value.transport))out.transport=value.transport;
 if(typeof value.requestId==='string'&&requestIdPattern.test(value.requestId))out.requestId=value.requestId;
 return out;
}
function storageDiagnostic(op,args,started,response,pgCode,transport){
 const keys=Array.isArray(args?.keys)?args.keys:typeof args?.key==='string'?[args.key]:[];
 const header=name=>{try{return response?.headers?.get?.(name)||undefined;}catch{return undefined;}};
 return safeStorageDiagnostic({op,keyClasses:keys.map(keyClass),keyCount:keys.length,ms:Date.now()-started,status:response?.status,pgCode,transport,requestId:[header('sb-request-id'),header('cf-ray')].find(v=>typeof v==='string'&&requestIdPattern.test(v))});
}
function reportStorage(event,storage){if(storage)console.warn(JSON.stringify({event,...storage}));}
/** Fixed, provider-independent message: the raw provider error never reaches lastErrorDetail. No retry happens here. */
function storageFailure(message,storage){reportStorage('bunker_storage_failure',storage);return Object.assign(new Error(message),storage?{storage}:{});}
/** Server-only Postgres transport. No service credential is sent to the browser. */
export class SupabaseStorage {
 /** @param {{url?:string,key?:string,gateway?:string,fetch?:typeof globalThis.fetch}} config */
 constructor({url,key,gateway,fetch:request=globalThis.fetch}){
  if((gateway?!/^https:\/\/[a-z0-9.-]+\/internal\/storage$/.test(gateway):!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url||''))||!key)throw Error('Supabase do servidor não configurado.');
  this.url=url;this.key=key;this.gateway=gateway;this.request=request.bind(globalThis);
 }
 async rpc(op,args={}){
  const headers=this.gateway?{Authorization:'Bearer '+this.key}:{apikey:this.key,...(this.key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+this.key})};
  const started=Date.now();let r;
  try{r=await this.request(this.gateway||this.url+(op==='orbitaMcp'?'/functions/v1/orbita-mcp':op==='malvaMcp'?'/functions/v1/malva-mcp':op==='malvaRead'?'/functions/v1/malva-read':'/rest/v1/rpc/bunker_store'),{method:'POST',headers:{...headers,'Content-Type':'application/json','User-Agent':'Bunker-Storage/1.0'},body:JSON.stringify(['malvaRead','malvaMcp','orbitaMcp'].includes(op)&&!this.gateway?args:{operation:op,input:args}),signal:AbortSignal.timeout(30000)});}
  catch(error){const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';throw storageFailure(timeout?'Tempo esgotado no armazenamento.':'Falha de rede no armazenamento.',storageDiagnostic(op,args,started,null,null,timeout?'timeout':'network'));}
  if(!r.ok){
   if(op==='cloudExecutor'){const body=await r.json().catch(()=>({}));throw Error(typeof body.error==='string'&&/^(?:CLOUD|MALVA|MCP)_[A-Z_]+$/.test(body.error)?body.error:'CLOUD_CONTROL_UNAVAILABLE');}
   if(['malvaRead','malvaMcp','orbitaMcp'].includes(op)){const body=await r.json().catch(()=>({}));const error=new Error('Fonte independente indisponível.');error.code=typeof body.error==='string'&&/^(?:MALVA|MCP|ORBITA)_[A-Z_]+$/.test(body.error)?body.error:'MALVA_BRIDGE_UNAVAILABLE';if(op==='malvaMcp')Object.assign(error,safeMcpDiagnostic(body.diagnostic));throw error;}
   // Only the SQLSTATE is read from the provider body; messages and details can carry data.
   const body=await r.json().catch(()=>({}));
   throw storageFailure('Falha no armazenamento Supabase ('+r.status+').',storageDiagnostic(op,args,started,r,body?.code));
  }
  // The measured duration includes reading and decoding the body (large central payloads).
  let result;try{result=await r.json();}
  catch(error){const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';throw storageFailure(timeout?'Tempo esgotado no armazenamento.':'Resposta inválida do armazenamento.',storageDiagnostic(op,args,started,r,null,timeout?'timeout':'decode'));}
  const storage=storageDiagnostic(op,args,started,r);if(storage&&storage.ms>=slowStorageMs)reportStorage('bunker_storage_slow',storage);
  return result;
 }
 prepare(sql){return new Statement(this,sql,[]);}
 async batch(statements){
  if(!statements.length||statements.some(s=>s.db!==this))throw Error('Transação inválida.');
  const first=statements[0].operation();
  if(first.op!=='cas'||first.input.key!=='central')throw Error('Transação da central esperada.');
  const archives=statements.slice(1).filter(s=>!s.sql.includes('bunker_reports')).map(s=>{
   if(!s.sql.includes('WHERE EXISTS')||s.params.length!==7)throw Error('Arquivo da transação inválido.');
   return {key:s.params[0],payload:s.params[1],revision:s.params[2],updated_at:s.params[3],immutable:!s.sql.startsWith('INSERT OR IGNORE')};
  });
  const result=await this.rpc('commit',{...first.input,archives});
  return statements.map((_,i)=>({success:true,meta:{changes:i===0?result.changes:0},results:[]}));
 }
}
class Statement{
 constructor(db,sql,params){this.db=db;this.sql=sql;this.params=params;}
 bind(...params){return new Statement(this.db,this.sql,params);}
 operation(){
  const s=this.sql,p=this.params;
  if(s.startsWith('INSERT OR IGNORE INTO bunker_records')&&!s.includes('WHERE EXISTS'))return {op:'cas',input:{key:p[0],payload:p[1],expected:0,updated_at:p[3]}};
  if(s.startsWith('UPDATE bunker_records SET payload='))return {op:'cas',input:{key:p[3],payload:p[0],expected:p[4],updated_at:p[2]}};
  if(s.includes('WITH requested AS'))return {op:'resolutions',input:{requests:JSON.parse(p[0]),limit:p[1]}};
  if(s.includes('combined AS'))return {op:'reports',input:{project:s.includes("project IN (?, 'all')")?p[0]:'all',cursor:p.length>2?{at:p.at(-4),id:p.at(-2)}:null,limit:p.at(-1)}};
  if(s.includes("key GLOB 'suggestions:*'"))return {op:'suggestions',input:{project:p[0],cursor:p.length>3?{at:p[2],key:p[4]}:null,limit:p.at(-1)}};
  if(s.includes("key LIKE 'collaboration:%'"))return {op:'collaborations',input:{project:p[0],cursor:p[1],limit:p[3]}};
  if(s.includes("key LIKE 'daily:%'"))return {op:'daily',input:{now:p[0],limit:p[2]}};
  if(s.includes('FROM bunker_records WHERE key IN ('))return {op:'get',input:{keys:p,...(s.startsWith('SELECT key,revision,updated_at')?{projection:'revision'}:{})}};
  if(s==='SELECT revision,updated_at FROM bunker_records WHERE key = ?')return {op:'get',input:{keys:[p[0]],projection:'revision'}};
  if(/FROM bunker_records WHERE key\s*=\s*\?/.test(s))return {op:'get',input:{keys:[p[0]]}};
  throw Error('Consulta não suportada no Postgres.');
 }
 async all(){const q=this.operation(),r=await this.db.rpc(q.op,q.input);return {success:true,results:r.rows||[],meta:{changes:r.changes||0}};}
 async first(){return (await this.all()).results[0]??null;}
 async run(){return this.all();}
}
