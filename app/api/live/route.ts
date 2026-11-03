import {readLiveState} from '@/lib/live-state';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return response({error:'Entre com sua conta ChatGPT.',signIn:'/signin-with-chatgpt?return_to=%2F'},401);
 try{return response(await readLiveState());}catch{return response({error:'Não foi possível ler os dados atuais. As leituras de análise foram preservadas.'},503);}
}
