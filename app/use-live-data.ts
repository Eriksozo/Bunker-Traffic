'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

export type LiveSnapshot={projectId:string;projectName:string;period:'today';level:'campaign';source:'Malva MCP';from:string;to:string;timezone:string;fetchedAt:string;lastSyncAt:string|null;complete:boolean;coverage?:{kind:'active-spent-tracked';activeComplete:true;spentComplete:true;trackedComplete:true;trackedCount:number};rows:Record<string,unknown>[]};
export type LiveItem={projectId:string;snapshot:LiveSnapshot|null;lastAttemptAt:string|null;lastSuccessAt:string|null;error:{code:string;message:string;at:string}|null;revision:number};
export type LiveData={projects:{projectId:string;projectName:string}[];paused:boolean;items:LiveItem[];pollIntervalSeconds:number};

/** Poll the private Bunker cache only; the Mac executor owns Malva collection. */
export function useLiveData(){
 const [data,setData]=useState<LiveData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[now,setNow]=useState(()=>Date.now());
 const alive=useRef(false),controller=useRef<AbortController|null>(null),inflight=useRef<Promise<void>|null>(null);
 const refresh=useCallback(()=>{
  if(inflight.current)return inflight.current;
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
    if(alive.current&&!request.signal.aborted){setData(result as LiveData);setError('');setNow(Date.now());}
   }catch(cause){
    if(alive.current&&(!request.signal.aborted||timedOut))setError(timedOut?'A consulta aos dados não respondeu. Os últimos dados foram preservados.':cause instanceof Error?cause.message:'Não foi possível ler os dados de sincronização.');
   }finally{
    clearTimeout(timer);
    if(controller.current===request){controller.current=null;inflight.current=null;if(alive.current)setLoading(false);}
   }
  })();
  inflight.current=work;return work;
 },[]);
 useEffect(()=>{
  alive.current=true;
  const check=()=>{if(document.visibilityState==='visible')void refresh();};
  const visible=()=>{if(document.visibilityState==='visible')check();else controller.current?.abort();};
  const timer=setInterval(check,10000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);check();
  return()=>{alive.current=false;controller.current?.abort();clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);};
 },[refresh]);
 return {data,error,loading,now,refresh};
}
