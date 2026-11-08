import {env} from 'cloudflare:workers';
import {executorControl} from '@/lib/executor-control';
import {bindSale,normalizeSale,orderRef,salesFeedLimits} from '@/lib/sales-feed.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
/** Malva outbound webhook (sales). The Cloudflare boundary already checked the path secret in constant time and the
 * body size, and forwards only with x-bunker-webhook. A sale is stored for display only: never an action. */
export async function POST(req:Request){
 if((env as any).BUNKER_HOST!=='cloudflare'||req.headers.get('x-bunker-webhook')!=='malva')return response({error:'Não autorizado.'},401);
 const text=await req.text();if(text.length>salesFeedLimits.bodyBytes)return response({error:'Corpo grande demais.'},413);
 let body:any;try{body=JSON.parse(text);}catch{return response({ok:true,ignored:'formato'});}
 const normalized:any=normalizeSale(body);if(!normalized)return response({ok:true,ignored:'não é venda paga'});
 // The project comes from the webhook address (set by the boundary); a payload that disagrees is refused, visibly.
 const bound:any=bindSale(normalized,req.headers.get('x-bunker-webhook-project'));if(bound.error)return response({error:bound.error},422);
 const sale={...bound.sale,orderRef:await orderRef(bound.sale.orderRef,bound.sale.project)};
 try{const r:any=await executorControl({action:'sale',sale} as any);if(r?.refused)return response({error:r.refused},422);return response({ok:true,added:!!r?.added});}
 catch{return response({error:'Indisponível agora.'},503);}
}
export async function GET(){return response({error:'Use POST.'},405);}
