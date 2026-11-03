import {isValidCentralResponse} from './decision-confirmation.mjs';

/** Read-only reconciliation. Never replay a mutation or replace a newer receipt. */
export function createCentralSync({fetch:request=globalThis.fetch,getCurrent,onUpdate,onStatus,visible=()=>true,now=Date.now}){
 let disposed=false,checking=false,lastCheckedAt=null;
 const controller=new AbortController();
 const publish=(status)=>{if(!disposed)onStatus({...status,lastCheckedAt});};
 async function check(){
  if(disposed||checking||getCurrent().saving||!visible())return;
  checking=true;
  try{
   const options={cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])};
   const headResponse=await request('/api/state?revisionOnly=1',options);
   if(!headResponse.ok){publish({status:headResponse.status===401?'signed-out':'unavailable'});return;}
   const head=await headResponse.json();
   if(!Number.isSafeInteger(head.revision)||head.revision<0)throw Error('Invalid revision');
   if(disposed||getCurrent().saving)return;
   if(head.revision<getCurrent().revision){publish({status:'unavailable'});return;}
   if(head.revision>getCurrent().revision){
    const response=await request('/api/state',options);
    if(!response.ok){publish({status:response.status===401?'signed-out':'unavailable'});return;}
    const data=await response.json();
    if(!isValidCentralResponse(data)||data.revision<head.revision)throw Error('Incomplete revision');
    if(disposed||getCurrent().saving)return;
    if(data.revision>getCurrent().revision)onUpdate(data);
   }
   lastCheckedAt=new Date(now()).toISOString();publish({status:'current'});
  }catch{publish({status:'unavailable'});}
  finally{checking=false;}
 }
 return {check,dispose(){disposed=true;controller.abort();}};
}
