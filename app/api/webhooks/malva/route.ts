import {env} from 'cloudflare:workers';
import {executorControl} from '@/lib/executor-control';
import {normalizeSale,orderRef,salesFeedLimits} from '@/lib/sales-feed.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
/** Malva outbound webhook (sales). The Cloudflare boundary already checked the path secret in constant time and the
 * body size, and forwards only with x-bunker-webhook. A sale is stored for display only: never an action. */
export async function POST(req:Request){
 if((env as any).BUNKER_HOST!=='cloudflare'||req.headers.get('x-bunker-webhook')!=='malva')return response({error:'Não autorizado.'},401);
 const text=await req.text();if(text.length>salesFeedLimits.bodyBytes)return response({error:'Corpo grande demais.'},413);
 let body:any;try{body=JSON.parse(text);}catch{return response({ok:true,ignored:'formato'});}
 const sale:any=normalizeSale(body);if(!sale)return response({ok:true,ignored:'não é venda paga'});
 sale.orderRef=await orderRef(sale.orderRef);
 try{const r:any=await executorControl({action:'sale',sale} as any);return response({ok:true,added:!!r?.added});}
 catch{return response({error:'Indisponível agora.'},503);}
}
export async function GET(){return response({error:'Use POST.'},405);}
