'use client';
import {useEffect,useRef,useState} from 'react';
import {createCentralSync} from '../lib/central-sync.mjs';

export type CentralSyncStatus={status:'connecting'|'current'|'unavailable'|'signed-out';lastCheckedAt:string|null};

/** Refresh only the saved central state. Drafts remain owned by the parent. */
export function useOfficeUpdates(active:boolean,revision:number,saving:boolean,onUpdate:(data:any)=>void){
 const [status,setStatus]=useState<CentralSyncStatus>({status:'connecting',lastCheckedAt:null});
 const latest=useRef({revision,saving,onUpdate});
 useEffect(()=>{latest.current={revision,saving,onUpdate};},[revision,saving,onUpdate]);
 useEffect(()=>{
  if(!active)return;
  const sync=createCentralSync({getCurrent:()=>latest.current,onUpdate:(data:any)=>latest.current.onUpdate(data),onStatus:setStatus,visible:()=>document.visibilityState==='visible'});
  const check=()=>sync.check();
  const visible=()=>{if(document.visibilityState==='visible')void check();};
  const timer=setInterval(check,2000);
  window.addEventListener('bunker:central-changed',check);window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);void check();
  return()=>{sync.dispose();clearInterval(timer);window.removeEventListener('bunker:central-changed',check);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);};
 },[active]);
 return status;
}
