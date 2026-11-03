import {updateDailyState} from '@/lib/campaign-daily-state';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const signed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id');
function target(params:URLSearchParams){return {projectId:params.get('projectId'),adAccountId:params.get('adAccountId'),objectId:params.get('objectId')};}
function errorResponse(e:any){const code=typeof e?.code==='string'?e.code:'DAILY_UNAVAILABLE';return response({error:'Não foi possível consultar o resultado por dia. A análise e sua decisão foram preservadas.',code},code==='DAILY_CONFLICT'?409:code==='DAILY_UNAVAILABLE'?503:400);}
export async function GET(req:Request){
 if(!signed(req))return response({error:'Entre com sua conta ChatGPT.'},401);
 try{return response(await updateDailyState({action:'read',...target(new URL(req.url).searchParams)}));}catch(e){return errorResponse(e);}
}
export async function POST(req:Request){
 if(!signed(req))return response({error:'Entre com sua conta ChatGPT.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return response({error:'Origem não autorizada.'},403);
 try{
  const body=await req.text();if(body.length>4000)return response({error:'Pedido acima do limite.'},413);
  const input=JSON.parse(body);
  if(!input||typeof input!=='object'||Array.isArray(input)||input.action!=='request'||Object.keys(input).some(k=>!['action','projectId','adAccountId','objectId'].includes(k)))return response({error:'Pedido de consulta inválido.'},400);
  return response(await updateDailyState(input));
 }catch(e){return errorResponse(e);}
}
