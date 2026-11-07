import {env} from 'cloudflare:workers';
import {readState} from '@/lib/state';
import {companionCards} from '@/lib/companion-cards.mjs';
import {ALL_PROJECTS} from '@/lib/project-scope.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** Owner session or the Mac read credential (checked at the Cloudflare boundary). Read on demand when the owner opens an adjustment. */
const allowed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id')||((env as any).BUNKER_HOST==='cloudflare'&&req.headers.get('x-bunker-companion')==='read');
const id=(v:string|null)=>v&&v.length<=250?v:null;
export async function GET(req:Request){
 if(!allowed(req))return response({error:'Acesso não autorizado.'},401);
 const q=new URL(req.url).searchParams;
 try{
  const {state,revision}=await readState() as any;
  return response(companionCards(state,{project:id(q.get('project'))||ALL_PROJECTS,adAccountId:id(q.get('account')),objectId:id(q.get('campaign'))},revision));
 }catch{return response({error:'Cards indisponíveis agora.'},503);}
}
