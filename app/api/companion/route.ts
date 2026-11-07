import {env} from 'cloudflare:workers';
import {readState} from '@/lib/state';
import {executorControl} from '@/lib/executor-control';
import {companionSummary} from '@/lib/companion-summary.mjs';
import {ALL_PROJECTS} from '@/lib/project-scope.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** The owner session, or the Mac companion credential checked by the Cloudflare auth boundary (read-only). */
const allowed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id')||((env as any).BUNKER_HOST==='cloudflare'&&req.headers.get('x-bunker-companion')==='read');
export async function GET(req:Request){
 if(!allowed(req))return response({error:'Acesso não autorizado.'},401);
 const project=new URL(req.url).searchParams.get('project')||ALL_PROJECTS;
 try{
  const [cur,executor,attribution]=await Promise.all([readState(),executorControl({action:'status'}).catch(()=>null),executorControl({action:'attribution'}).catch(()=>null)]);
  const items=Array.isArray((attribution as any)?.items)?(attribution as any).items:[];
  return response({revision:cur.revision,...companionSummary({...cur.state,changeAttributions:items},{project,executor})});
 }catch(error:any){return response({error:/Projeto não configurado/.test(error?.message||'')?'Projeto não configurado.':'Resumo indisponível agora.'},/Projeto não configurado/.test(error?.message||'')?404:503);}
}
export async function POST(){return response({error:'Somente leitura.'},405);}
