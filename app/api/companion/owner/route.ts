import {env} from 'cloudflare:workers';
import {assertCurrentDecisionContext} from '@/lib/live-state';
import {readState,commit} from '@/lib/state';
import {ownerAutonomy} from '@/lib/autonomy';
import {ownerDeviceOps} from '@/lib/owner-device.mjs';
import {readLiveData} from '@/lib/live-data.mjs';
import {storage} from '@/lib/storage';
import {liveOrderRow} from '@/lib/owner-order-live.mjs';
import {recordDirectOrder,DirectOrderError} from '@/lib/owner-direct-order.mjs';
import {decisionContingency} from '@/lib/decision-contingency.mjs';
import {requestLiveRefresh} from '@/lib/owner-applied.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** Wakes the Cloudflare executor's fast lane (same object, same alarm): an approved order is sent in seconds instead of
 * waiting for the next pulse, and the touched project is reread live. Only a hint: a failure changes nothing. */
async function wakeExecutor(order:boolean,projects:unknown[]){
 try{const ns=(env as any).BUNKER_EXECUTOR;if(ns)await ns.getByName('primary').fetch('https://bunker-internal/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'wake',order,projects:projects.filter(p=>typeof p==='string')})});}catch{}
}

/** Owner direct order (pause / increase / reduce one Meta campaign), signed with Touch ID. It does not depend on the
 * analysis round or on the central revision the notch opened: the exact value the owner signed is compared with the
 * server-read live Malva row, then the Cloudflare executor rereads Malva, sends once and confirms. */
async function directOrder(input:any,owner:string){
 for(let attempt=0;attempt<2;attempt++){
  const cur=await readState() as any,state=cur.state;
  const project=typeof input.project==='string'?input.project:'';
  if(!state.config?.[project])return response({error:'Projeto não configurado no Bunker.',code:'DIRECT_ORDER_PROJECT'},400);
  const latest=await readLiveData(storage(),state,project).catch(()=>({items:[]})) as any;
  const live=liveOrderRow(latest.items,project,input.adAccountId,input.objectId);
  try{
   if(!live)throw new DirectOrderError('Sem leitura ao vivo desta campanha nos últimos 10 minutos. O Bunker pediu uma releitura agora; tente de novo em 30 segundos.','DIRECT_ORDER_NO_LIVE');
   const guard=decisionContingency({state,project,row:live.row,proposal:null,action:input.action,percent:input.percent,liveItems:latest.items});
   if(guard.blocked)throw new DirectOrderError('Contingência: '+guard.blockers.join(' '),'DIRECT_ORDER_CONTINGENCY');
   const proposal=recordDirectOrder(state,input,owner,{live});
   const saved=await commit(state,cur.revision) as any;
   await wakeExecutor(proposal.status==='Aprovada',[project]);
   return response({ok:true,op:input.op,status:proposal.status,id:proposal.id,revision:saved?.revision??null,before:proposal.payload.before,after:proposal.payload.after,currency:proposal.payload.currency,expiresAt:proposal.expiresAt});
  }catch(e:any){
   if(e?.message==='CONFLICT'&&attempt===0)continue;   // a concurrent executor write: read again, same clientId
   if(e instanceof DirectOrderError){
    if(e.code==='DIRECT_ORDER_NO_LIVE'){try{requestLiveRefresh(state,project);await commit(state,cur.revision);}catch{}await wakeExecutor(false,[project]);}
    return response({error:e.message,code:e.code,current:e.detail||undefined},e.code==='DIRECT_ORDER_CHANGED'||e.code==='DIRECT_ORDER_PENDING'?409:400);
   }
   return response({error:e?.message==='CONFLICT'?'O Bunker estava gravando outra coisa. Toque em Executar de novo.':e?.message||'Não foi possível registrar a ordem.',code:e?.message==='CONFLICT'?'CONFLICT':'DIRECT_ORDER_FAILED'},e?.message==='CONFLICT'?409:400);
  }
 }
 return response({error:'O Bunker estava gravando outra coisa. Toque em Executar de novo.',code:'CONFLICT'},409);
}

/** Owner decision signed with Touch ID on the Mac. The Cloudflare boundary verified the
 * signature and forwards only the signed input. Same rules as the web card: an intent asks
 * the team; only an exact proposal already reviewed by the agents can be approved. */
export async function POST(req:Request){
 const owner=req.headers.get('x-bunker-owner-device');
 if((env as any).BUNKER_HOST!=='cloudflare'||req.headers.get('x-bunker-companion')!=='owner'||!owner?.startsWith('mac-touchid:'))return response({error:'Acesso não autorizado.'},401);
 try{
  const input=JSON.parse(await req.text());
  if(!ownerDeviceOps.includes(input?.op))return response({error:'Ação não permitida pelo Mac.'},403);
  if(input.op==='ownerDirectOrder')return await directOrder(input,owner);
  const cur=await readState() as any;
  if(input.revision!==cur.revision)return response({error:'Os dados mudaram desde que você abriu. Confira de novo e confirme.',code:'CONFLICT'},409);
  const context:any=await assertCurrentDecisionContext(cur.state,input);
  const record=ownerAutonomy(cur.state,input,owner,{live:context?.live||null});
  const saved=await commit(cur.state,cur.revision) as any;
  const proposal=input.op==='proposalReview'?record:null;
  await wakeExecutor(proposal?.status==='Aprovada',[record?.project??input.project]);
  return response({ok:true,revision:saved?.revision??null,op:input.op,status:proposal?proposal.status:record?.status??null,id:record?.id??null});
 }catch(e:any){return response({error:e.message==='CONFLICT'?'Os dados mudaram. Confira de novo e confirme.':e.message||'Não foi possível registrar.'},e.message==='CONFLICT'?409:400);}
}
export async function GET(){return response({error:'Use POST assinado pelo Mac.'},405);}
