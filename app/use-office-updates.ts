'use client';
import {useEffect,useRef} from 'react';

/** Refresh only the saved central state. Drafts remain owned by the parent. */
export function useOfficeUpdates(active:boolean,revision:number,saving:boolean,onUpdate:(data:any)=>void){
 const latest=useRef({revision,saving,onUpdate});
 useEffect(()=>{latest.current={revision,saving,onUpdate};},[revision,saving,onUpdate]);
 useEffect(()=>{
  if(!active)return;
  let disposed=false,checking=false;
  const controller=new AbortController();
  async function check(){
   if(disposed||checking||latest.current.saving||document.visibilityState!=='visible')return;
   checking=true;
   try{
    const options={cache:'no-store' as RequestCache,signal:controller.signal};
    const response=await fetch('/api/state?revisionOnly=1',options);
    if(!response.ok)return;
    const head:any=await response.json();
    if(disposed||latest.current.saving||head.revision<=latest.current.revision)return;
    const full=await fetch('/api/state',options);if(!full.ok)return;
    const data:any=await full.json();
    if(!disposed&&!latest.current.saving&&data.revision>latest.current.revision)latest.current.onUpdate(data);
   }catch{/* The existing update notice provides retry and error feedback. */}
   finally{checking=false;}
  }
  const visible=()=>{if(document.visibilityState==='visible')void check();};
  const timer=setInterval(check,10000);
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);void check();
  return()=>{disposed=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);};
 },[active]);
}
