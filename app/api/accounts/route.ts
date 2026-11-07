import {executorControl} from '@/lib/executor-control';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** Owner-only, read-only: ad-account panel built by the executor (Malva accounts + Meta daily spending limit). */
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return response({error:'Entre com sua conta.'},401);
 try{const data:any=await executorControl({action:'accounts'});return response({panel:data?.panel??null});}
 catch{return response({panel:null,unavailable:true});}
}
