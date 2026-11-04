import {storage} from '@/lib/storage';
import {sourceSignals} from '@/lib/source-watch.mjs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return json({error:'Entre com sua conta.'},401);
 const list=new URL(req.url).searchParams.get('projects')||'';
 try{return json(await sourceSignals(storage(),list?list.split(','):[]));}catch{return json({error:'Não foi possível conferir as atualizações.'},503);}
}
