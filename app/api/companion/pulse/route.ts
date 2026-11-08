import {env} from 'cloudflare:workers';
import {executorControl} from '@/lib/executor-control';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const allowed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id')||((env as any).BUNKER_HOST==='cloudflare'&&req.headers.get('x-bunker-companion')==='read');
/** Edit pulse from the executor's fast watch (lib/change-watch.mjs): a counter that moves when a new budget/status
 * edit appears in Malva, plus the newest edit. Served from the executor object only: no central or Supabase read,
 * so the web and the notch can ask every few seconds. */
export async function GET(req:Request){
 if(!allowed(req))return response({error:'Acesso não autorizado.'},401);
 try{const stored:any=await executorControl({action:'pulse'});return response({pulse:stored?.pulse||{version:0,at:null,last:null},watchedAt:stored?.watchedAt||null});}
 catch{return response({error:'Pulso indisponível agora.'},503);}
}
export async function POST(){return response({error:'Somente leitura.'},405);}
