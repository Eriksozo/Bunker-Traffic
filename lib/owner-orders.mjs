/** Receipts of the owner's direct orders for the notch: where each order is in the executor path. The state comes
 * from the executor journal (readback), never from the submit answer: "Confirmada" only after the reread matched.
 * Read-only presentation. */
import {executionLimits} from './execution.mjs';
const time=v=>typeof v==='string'?Date.parse(v):NaN;
export const ownerOrderReceiptLimits=Object.freeze({hours:24,max:8});

const labels={queued:'Na fila do executor',retry:'Ainda não enviada · nova tentativa do executor pendente',checking:'Conferindo o valor atual na Malva',sent:'Enviada à Meta · aguardando releitura',confirmed:'Confirmada na Meta',verify:'Enviada · a releitura não confirmou: conferir',failed:'Não enviada',exhausted:'Não enviada · tentativas esgotadas antes do envio',expired:'Expirou sem execução'};

/** A pre-dispatch attempt whose lease ran out is not "checking" any more: without authorization it expired; with every
 * attempt used it will not be sent. Otherwise the executor may still reclaim it. */
function stalled(p,e,now){
 if(!(time(e.leaseUntil)<=now))return null;
 if(time(p.expiresAt)<=now)return 'expired';
 return (e.attempt||1)>=executionLimits.attempts?'exhausted':null;
}

/** One receipt per owner order of the last day (newest first), for one project or all. */
export function ownerOrderReceipts(state,{project='all',now=Date.now()}={}){
 const since=now-ownerOrderReceiptLimits.hours*3600000,names=Object.fromEntries(Object.entries(state?.config||{}).map(([id,c])=>[id,c?.projectName||id]));
 return (state?.proposals||[]).filter(p=>p.ownerOrder===true&&p.createdBy==='owner'&&(project==='all'||p.project===project)&&time(p.createdAt)>=since)
  .sort((a,b)=>time(b.createdAt)-time(a.createdAt)).slice(0,ownerOrderReceiptLimits.max).map(p=>{
   const e=(state.executions||[]).filter(x=>x.proposalId===p.id).sort((a,b)=>time(b.claimedAt)-time(a.claimedAt))[0]||null,v=p.payload||{};
   const key=!e?(time(p.expiresAt)<=now?'expired':'queued'):e.status==='Confirmada'?'confirmed':e.status==='Verificação necessária'?'verify':e.status==='Falhou'?(time(p.expiresAt)<=now?'expired':(e.attempt||1)>=executionLimits.attempts?'exhausted':'retry'):e.status==='Enviada'||e.submittedAt?'sent':stalled(p,e,now)||'checking',stage=key==='exhausted'?'failed':key==='retry'?'checking':key;
   return {id:p.id,project:p.project,projectName:names[p.project]||p.project,campaign:v.objectName||null,account:v.accountName||null,action:v.action,currency:v.currency||null,
    before:{dailyBudget:v.before?.dailyBudget??null,status:v.before?.status??null},after:{dailyBudget:v.after?.dailyBudget??null,status:v.after?.status??null},
    source:v.liveTarget?'live':'analysis',stage,label:labels[key],reason:key==='exhausted'?'Limite de tentativas antes do envio atingido; nada foi enviado à Meta.':stage==='failed'||stage==='verify'?(typeof e?.reason==='string'?e.reason.slice(0,240):null):null,
    at:p.createdAt,sentAt:e?.submittedAt||null,confirmedAt:e?.confirmedAt||null};
  });
}
