import {executorControl} from '@/lib/executor-control';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** Owner-only, read-only: authors the executor matched in the Malva edit history for observed changes. */
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return response({error:'Entre com sua conta.'},401);
 try{const data:any=await executorControl({action:'attribution'});return response({items:Array.isArray(data?.items)?data.items:[],pending:data?.pending??null,status:data?.status??null});}
 catch{return response({items:[],pending:null,status:null,unavailable:true});}
}
