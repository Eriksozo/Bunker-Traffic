'use client';
import {createSourceWatch,createReadRecovery,SOURCE_WATCH_MS,mergeSourceFeed} from '../lib/source-watch.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';

export type LiveSnapshot={projectId:string;projectName:string;period:'today';level:'campaign';source:'Malva MCP';from:string;to:string;timezone:string;fetchedAt:string;lastSyncAt:string|null;complete:boolean;coverage?:{kind:'active-spent-tracked';activeComplete:true;spentComplete:true;trackedComplete:true;trackedCount:number};rows:Record<string,unknown>[]};
export type LiveItem={projectId:string;snapshot:LiveSnapshot|null;lastAttemptAt:string|null;lastSuccessAt:string|null;error:{code:string;message:string;at:string}|null;revision:number};
export type LiveData={projects:{projectId:string;projectName:string}[];paused:boolean;items:LiveItem[];pollIntervalSeconds:number;creativeItems?:any[];creativeError?:string};

/** Poll the private Bunker cache only; the Mac executor owns Malva collection. */
export function useLiveData(){
 const [data,setData]=useState<LiveData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[watchError,setWatchError]=useState(''),[now,setNow]=useState(()=>Date.now());
 const latest=useRef<LiveData|null>(null),queued=useRef(false);
 const recovery=useRef<ReturnType<typeof createReadRecovery>|null>(null);
 const alive=useRef(false),controller=useRef<AbortController|null>(null),inflight=useRef<Promise<void>|null>(null);
 const refresh=useCallback(()=>{
  if(inflight.current){queued.current=true;return inflight.current;}
  if(!alive.current)return Promise.resolve();
  const request=new AbortController();controller.current=request;let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;request.abort();},15000);
  setLoading(true);setNow(Date.now());
  const work=(async()=>{
   try{
    const response=await fetch('/api/live',{cache:'no-store',signal:request.signal});
    const raw=await response.json(),result=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
    if(!response.ok)throw Error(typeof result.error==='string'?result.error:'Não foi possível ler os dados de sincronização.');
    if(!Array.isArray(result.projects)||!Array.isArray(result.items))throw Error('Os dados de sincronização retornaram um formato inválido.');
    if(alive.current&&!request.signal.aborted){const merged=mergeSourceFeed(latest.current,result) as LiveData;latest.current=merged;recovery.current?.succeeded();setData(merged);setError('');setNow(Date.now());}
   }catch(cause){
    if(alive.current&&(!request.signal.aborted||timedOut)){recovery.current?.failed();setError(timedOut?'A consulta aos dados não respondeu. Os últimos dados foram preservados.':cause instanceof Error?cause.message:'Não foi possível ler os dados de sincronização.');}
   }finally{
    clearTimeout(timer);
    if(controller.current===request){controller.current=null;inflight.current=null;if(alive.current){setLoading(false);if(queued.current){queued.current=false;queueMicrotask(()=>void refresh());}}}
   }
  })();
  inflight.current=work;return work;
 },[]);
 useEffect(()=>{
  alive.current=true;
  const rescue=createReadRecovery({retry:refresh});recovery.current=rescue;
  let broken=false;
  const watch=createSourceWatch({getProjects:()=>latest.current?.projects.map(p=>p.projectId)||[],visible:()=>document.visibilityState==='visible',onChange:(change:any)=>{if(change.central||change.live||change.creative)void refresh();if(change.central)window.dispatchEvent(new Event('bunker:central-changed'));},onError:(value:string|null)=>{broken=!!value;if(alive.current)setWatchError(value||'');}});
  const check=()=>{if(document.visibilityState==='visible'){setNow(Date.now());void watch.check();void rescue.check();}};
  const focus=()=>{if(document.visibilityState==='visible'){void refresh();check();}};
  const visible=()=>{if(document.visibilityState==='visible')focus();else controller.current?.abort();};
  const timer=setInterval(check,SOURCE_WATCH_MS),fallback=setInterval(()=>{if(broken&&document.visibilityState==='visible')void refresh();},30000);
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visible);void refresh();check();
  return()=>{alive.current=false;watch.dispose();rescue.dispose();if(recovery.current===rescue)recovery.current=null;controller.current?.abort();clearInterval(timer);clearInterval(fallback);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);};
 },[refresh]);
 return {data,error:error||watchError,loading,now,refresh};
}
