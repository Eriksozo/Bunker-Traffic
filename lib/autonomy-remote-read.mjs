/** The plain `/api/autonomy` read in the Autonomia panel (requests of the level Confirmar, the executor's log, the Sombra
 * coverage and the last pass), web only. Loading, failure and the last good reading are kept apart: a failed read never
 * turns into "no requests" and never wipes a good reading; a failure after a success keeps that reading and says when it
 * was taken. Read-only presentation: nothing here creates, closes or sends a request. */
import {openAsks} from './autonomy-ui.mjs';

/** Poll every 30 s; one attempt at a time, given up (aborted) after 45 s so a hung request never blocks the next one,
 * while a slow but valid answer (e.g. 31 s) still lands. */
export const remoteReadPolicy=Object.freeze({pollMs:30000,timeoutMs:45000});

/** @returns {{data:any,loading:boolean,error:string|null,lastSuccessAt:number|null,failedAt:number|null}} */
export function remoteReadInitial(){return {data:null,loading:true,error:null,lastSuccessAt:null,failedAt:null};}

/** A new attempt: the last good reading stays on screen while it runs. @param {any} prev */
export function remoteReadStart(prev){return {...(prev||remoteReadInitial()),loading:true};}

const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/**
 * The body of a successful `/api/autonomy` response, or null when it is not the executor's contract
 * (worker/cloud-executor.ts action 'autonomy': {shadowProjects:string[]|null, shadowAt:string|null, status:object|null,
 * log:object[], asks:object[]}). A malformed body ({}, an error envelope, a non-list) is a failed read, never "nothing":
 * the caller keeps the last good reading. `asks` absent (older executor) stays null, so its count is N/D, never zero.
 * @param {any} body
 */
export function autonomyRemoteBody(body){
 if(!plain(body)||'error' in body)return null;
 if(!Array.isArray(body.log)||!body.log.every(plain))return null;
 if(!('shadowProjects' in body)||body.shadowProjects!==null&&!(Array.isArray(body.shadowProjects)&&body.shadowProjects.every(x=>typeof x==='string')))return null;
 if(body.status!=null&&!plain(body.status))return null;
 if(body.shadowAt!=null&&typeof body.shadowAt!=='string')return null;
 if('asks' in body&&!(Array.isArray(body.asks)&&body.asks.every(a=>plain(a)&&typeof a.id==='string')))return null;
 return {log:body.log,shadowProjects:body.shadowProjects,status:body.status??null,asks:'asks' in body?body.asks:null};
}

/** @param {any} data @param {number} at */
export function remoteReadSuccess(data,at){return {data,loading:false,error:null,lastSuccessAt:at,failedAt:null};}

/** Keeps the last good reading (if any) and records the failure. @param {any} prev @param {string} error @param {number} at */
export function remoteReadFailure(prev,error,at){const base=prev||remoteReadInitial();return {...base,loading:false,error:error||'Leitura do executor indisponível agora.',failedAt:at};}

/** The pt-BR message for a failed attempt. @param {{status?:number,network?:boolean,invalid?:boolean,timeout?:boolean}} reason */
export function remoteReadError({status,network=false,invalid=false,timeout=false}={}){
 if(timeout)return `A leitura do executor passou de ${Math.round(remoteReadPolicy.timeoutMs/1000)} s e foi interrompida.`;
 if(network)return 'Executor da nuvem indisponível.';
 if(invalid)return 'A leitura do executor voltou num formato inesperado.';
 return `Leitura do executor indisponível agora${Number.isFinite(status)?` (HTTP ${status})`:''}.`;
}

/**
 * What the "Aguardando você" card may show.
 * - `off`: the switch is off, nothing is asked (known locally, no read needed).
 * - `loading`: first read still running; no list yet, so no count is claimed.
 * - `unavailable`: the read failed and there is no good reading; the count is unknown, never zero.
 * - `ok`: the list from the last good reading; `stale` when a later read failed, with `lastSuccessAt`.
 * @param {ReturnType<typeof remoteReadInitial>} read @param {{enabled?:boolean,now?:number,project?:string}} [options]
 */
export function asksView(read,{enabled=false,now=Date.now(),project='all'}={}){
 const lastSuccessAt=read?.lastSuccessAt??null,error=read?.error??null;
 if(!enabled)return {status:'off',asks:[],stale:false,error:null,lastSuccessAt};
 if(!read?.data)return {status:read?.loading&&!error?'loading':'unavailable',asks:null,stale:false,error,lastSuccessAt:null};
 // An executor that did not send `asks`: the count is unknown (N/D), never derived as zero.
 if(!Array.isArray(read.data.asks))return {status:'unavailable',asks:null,stale:false,error:error||'A leitura do executor não trouxe os pedidos do nível Confirmar.',lastSuccessAt};
 return {status:'ok',asks:openAsks(read.data,{enabled,now,project}),stale:!!error,error,lastSuccessAt};
}

/**
 * Single-flight reader for the plain read. `load()` starts an attempt unless one is already running (then it returns the
 * running one: the poll never overlaps or discards a slow answer). Each attempt ends exactly once: the answer (valid →
 * success, malformed or non-OK → failure keeping the last good reading), a network error, or the timeout, which aborts
 * the request and frees the slot so the next poll or "Ler de novo" retries. An answer arriving after its timeout or after
 * `dispose()` changes nothing.
 * @param {{request:(signal:AbortSignal)=>Promise<any>,update:(fn:(prev:any)=>any)=>void,now?:()=>number,
 *  timers?:{setTimeout:(fn:()=>void,ms:number)=>any,clearTimeout:(id:any)=>void},timeoutMs?:number}} options
 */
export function createRemoteReader({request,update,now=Date.now,timers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)},timeoutMs=remoteReadPolicy.timeoutMs}){
 /** @type {any} */
 let current=null,disposed=false;
 /** @param {any} attempt @param {(prev:any)=>any} next */
 const finish=(attempt,next)=>{
  if(current!==attempt)return;
  timers.clearTimeout(attempt.timer);current=null;
  if(!disposed)update(next);
 };
 function load(){
  if(disposed)return Promise.resolve();
  if(current)return current.promise;
  const controller=new AbortController();
  /** @type {any} */
  const attempt={controller,timer:null,promise:null};
  current=attempt;
  update(remoteReadStart);
  attempt.timer=timers.setTimeout(()=>{controller.abort();finish(attempt,prev=>remoteReadFailure(prev,remoteReadError({timeout:true}),now()));},timeoutMs);
  attempt.promise=(async()=>{
   try{
    const r=await request(controller.signal);
    const body=await r.json().catch(()=>null);
    const data=r.ok?autonomyRemoteBody(body):null;
    finish(attempt,data?()=>remoteReadSuccess(data,now()):prev=>remoteReadFailure(prev,remoteReadError(r.ok?{invalid:true}:{status:r.status}),now()));
   }catch{finish(attempt,prev=>remoteReadFailure(prev,remoteReadError({network:true}),now()));}
  })();
  return attempt.promise;
 }
 function dispose(){disposed=true;if(current){timers.clearTimeout(current.timer);current.controller.abort();current=null;}}
 return {load,dispose,get busy(){return current!==null;}};
}
