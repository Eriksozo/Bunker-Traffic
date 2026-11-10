import {env} from 'cloudflare:workers';
import {updateDailyState} from '@/lib/campaign-daily-state';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** Owner session or the Mac read credential (checked at the Cloudflare boundary). */
const allowed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id')||((env as any).BUNKER_HOST==='cloudflare'&&req.headers.get('x-bunker-companion')==='read');
const id=(v:string|null)=>v&&v.length<=120&&/^[A-Za-z0-9_-]+$/.test(v)?v:null;
/**
 * Day-by-day results of one campaign for the notch detail: the same display-only series as the web detail
 * (lib/cloud-daily-results.mjs). Opening it may refresh that campaign's own visual cache (`daily:` records, at most
 * once a minute); it never touches the central, analysis, proposals or orders.
 */
export async function GET(req:Request){
 if(!allowed(req))return response({error:'Acesso não autorizado.'},401);
 const q=new URL(req.url).searchParams,target={projectId:id(q.get('projectId')),adAccountId:id(q.get('adAccountId')),objectId:id(q.get('objectId'))};
 if(!target.projectId||!target.adAccountId||!target.objectId)return response({error:'Campanha inválida.'},400);
 try{
  const out:any=await updateDailyState({action:'request',...target}),item=out?.item||null,s=item?.snapshot||null;
  const error=item?.error?typeof item.error==='string'?item.error.slice(0,200):typeof item.error?.message==='string'?item.error.message.slice(0,200):'Leitura indisponível':null;
  return response({paused:!!out?.paused,status:item?.status||null,stale:!!item?.stale,error,range:item?.range||null,
   snapshot:s?{currency:s.currency??null,timezone:s.timezone,fetchedAt:s.fetchedAt,from:s.from,to:s.to,rows:Array.isArray(s.rows)?s.rows:[]}:null});
 }catch(e:any){
  const code=typeof e?.code==='string'?e.code:'DAILY_UNAVAILABLE';
  return response({error:'Resultado por dia indisponível agora.',code},code==='DAILY_UNAVAILABLE'?503:400);
 }
}
