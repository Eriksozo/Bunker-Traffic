import {env} from 'cloudflare:workers';
import {executorControl} from '@/lib/executor-control';
import {ALL_PROJECTS} from '@/lib/project-scope.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** The owner session, or the Mac companion credential checked by the Cloudflare auth boundary (read-only). */
const allowed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id')||((env as any).BUNKER_HOST==='cloudflare'&&req.headers.get('x-bunker-companion')==='read');
/** Served from the summaries the executor builds each pulse from the state it already read:
 * this route never reads the central, so the companion adds no load to Supabase. */
export async function GET(req:Request){
 if(!allowed(req))return response({error:'Acesso não autorizado.'},401);
 const project=new URL(req.url).searchParams.get('project')||ALL_PROJECTS;
 try{
  const stored:any=await executorControl({action:'companion',project});
  if(stored?.summary)return response({...stored.summary,source:'executor'});
  return response({error:'Resumo em preparação pelo executor. Tente em 1 a 2 minutos.'},503);
 }catch{return response({error:'Resumo indisponível agora.'},503);}
}
export async function POST(){return response({error:'Somente leitura.'},405);}
