/** Owner direct order from the notch (owner request of 2026-11-08: "pausar, aumentar, reduzir direto do notch, tudo via
 * MCP Malva"). The owner picks pause / increase % / reduce % on one Meta campaign and confirms the exact change with
 * Touch ID. This module turns that signed request into one approved exact proposal, without an analysis round:
 *
 *  - the "before" value is the server-read live Malva row of the last few minutes, and it must equal the value the
 *    owner saw and signed (status, daily budget, currency); a drift is refused, never silently re-priced;
 *  - the Cloudflare executor is the only sender: claim → prepare (reads Malva again, must still match) → one submit
 *    via Malva tracking_set_ad_status / tracking_set_ad_budget → reread → confirm. A lost answer is verification only;
 *  - an increase past the owner's daily-budget ceiling for the campaign (lib/owner-budget-cap.mjs) is refused;
 *  - status activation, bids, audiences, creatives and new campaigns are not offered here.
 *
 * Pure: no provider call, no storage. The route supplies the live reading and the contingency guard. */
import {liveOrderRow,liveOrderActions,liveTarget} from './owner-order-live.mjs';
import {isWarmupTarget} from './campaign-scope.mjs';
import {proposalSeal,fingerprint,collaborationLimits} from './collaboration.mjs';
import {executionLimits} from './execution.mjs';
import {ownerBudgetCap,capRefusal,capView} from './owner-budget-cap.mjs';

export const directOrderLimits=Object.freeze({validityMs:15*60000,keepMs:7*24*3600000,maxIncrease:1000});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time=v=>typeof v==='number'?v:Date.parse(v);
const iso=v=>new Date(time(v)).toISOString();
const cents=v=>Math.round((v+Number.EPSILON)*100)/100;
const finite=Number.isFinite;
// Same cents, allowing only binary floating-point noise from the Mac's JSON (never a different cent).
const sameCents=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<0.0005;
export class DirectOrderError extends Error{constructor(message,code='DIRECT_ORDER_INVALID',detail=null){super(message);this.code=code;this.detail=detail;}}
const fail=(message,code,detail)=>{throw new DirectOrderError(message,code,detail);};
const str=(v,label,max=250)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(label+' inválido.');return v.trim();};

/** New daily budget after a percent change, rounded to cents (same rule as the cards and the notch). */
export function directOrderBudget(before,action,percent){
 if(!finite(before)||before<=0)fail('Orçamento diário próprio da campanha não confirmado.','DIRECT_ORDER_BUDGET');
 if(!finite(percent)||percent<=0)fail('Digite um percentual maior que zero.','DIRECT_ORDER_PERCENT');
 if(action==='increase'&&percent>directOrderLimits.maxIncrease)fail('Aumento vai até 1000%.','DIRECT_ORDER_PERCENT');
 if(action==='reduce'&&percent>=100)fail('Redução precisa ser menor que 100% (para parar, use Pausar).','DIRECT_ORDER_PERCENT');
 const next=cents(before*(1+(action==='increase'?1:-1)*percent/100));
 if(!(next>0)||next===cents(before))fail('Esse percentual não muda o orçamento em centavos.','DIRECT_ORDER_PERCENT');
 if(next>1e9)fail('Orçamento resultante fora do limite aceito.','DIRECT_ORDER_PERCENT');
 return next;
}

/** What the notch may offer right now for one campaign, from the live reading only. Read-only. */
export function directOrderView(state,{project,adAccountId,objectId},liveItems,now=Date.now(),policy=null){
 const live=liveOrderRow(liveItems,project,adAccountId,objectId,now),r=live?.row||null,blockers=[];
 if(state.paused)blockers.push('Escritório pausado: retome no Bunker para executar.');
 if(!r)blockers.push('Sem leitura ao vivo desta campanha nos últimos 10 minutos. A próxima leitura da Malva chega em poucos minutos: recarregue e tente de novo.');
 else{
  if(String(r.provider||'').toLowerCase()!=='meta')blockers.push('Ordem direta só para campanhas Meta.');
  if(!uuid.test(r.id||''))blockers.push('A Malva não informou o ID interno desta campanha.');
  if(isWarmupTarget(state,project,'campaign',r))blockers.push('Campanha de aquecimento/engajamento fica fora das ordens de vendas.');
 }
 const pending=pendingOrder(state,project,adAccountId,objectId,now);
 if(pending)blockers.push('Já há uma ordem aprovada desta campanha a caminho do executor: aguarde o recibo em Agora › Suas ordens.');
 const ok=blockers.length?{increase:false,reduce:false,pause:false,keep:false}:liveOrderActions(live,{paused:!!state.paused});
 // The owner's ceiling: shown next to the percent, and an increase is off once the budget already reached it.
 const before=finite(r?.dailyBudget)?r.dailyBudget:null,cap=r?capView(ownerBudgetCap(policy,project,adAccountId),before,r.budgetCurrency??null):null;
 if(cap&&finite(before)&&before>=cap.dailyBudget)ok.increase=false;
 return {available:!blockers.length,actions:{increase:ok.increase,reduce:ok.reduce,pause:ok.pause,keep:false},blockers,
  source:r?{kind:'live',at:live.fetchedAt,status:r.status??null,dailyBudget:finite(r.dailyBudget)?r.dailyBudget:null,currency:r.budgetCurrency??null}:null,
  budgetCap:cap,campaign:r?.name??null,account:r?.accountName??null};
}

/** An approved, not yet applied, unexpired proposal of the same campaign (direct or reviewed): a real collision.
 * A failure before dispatch stays pending while the executor may still reclaim it (attempts left, order not expired). */
const finalExecution=e=>e.status==='Confirmada'||e.status==='Falhou'&&(e.attempt||1)>=executionLimits.attempts;
function pendingOrder(state,project,adAccountId,objectId,now){
 return (state.proposals||[]).find(p=>p.project===project&&p.payload?.adAccountId===adAccountId&&p.payload?.objectId===objectId&&p.status==='Aprovada'&&!p.appliedAt&&time(p.expiresAt)>now&&!(state.executions||[]).some(e=>e.proposalId===p.id&&finalExecution(e)))||null;
}

/** Old direct orders leave the central after a week, once nothing can still run or be checked. Never removes one
 * with an unconfirmed dispatch ("Enviada"/"Verificação necessária") or a live claim. */
export function pruneDirectOrders(state,now=Date.now()){
 const executions=state.executions||[],before=new Set((state.proposals||[]).filter(p=>p.directOrder===true&&p.roundId===null).map(p=>p.id));
 state.proposals=(state.proposals||[]).filter(p=>{
  if(!(p.directOrder===true&&p.roundId===null))return true;
  if(now-time(p.createdAt)<directOrderLimits.keepMs)return true;
  const e=executions.filter(x=>x.proposalId===p.id);
  return e.some(x=>!['Confirmada','Falhou'].includes(x.status));
 });
 // Their executions go with them: orphans would count toward the executor's limit forever.
 const kept=new Set(state.proposals.map(p=>p.id)),removed=new Set(executions.filter(e=>!kept.has(e.proposalId)&&before.has(e.proposalId)).map(e=>e.id));
 if(removed.size)state.executions=executions.filter(e=>!removed.has(e.id));
 return state.proposals;
}

/** @param {any} state @param {any} input signed by the Mac @param {string} ownerId 'mac-touchid:…' @param {{live:any,now?:number,policy?:any}} opts
 * `policy`: the parsed private Sombra policy with the owner's layer, for the owner's daily-budget ceiling. */
export function recordDirectOrder(state,input,ownerId,{live,now=Date.now(),policy=null}={}){
 now=time(now);
 if(typeof ownerId!=='string'||!ownerId.startsWith('mac-touchid:'))fail('Ordem direta só pelo Mac, confirmada com Touch ID.','DIRECT_ORDER_OWNER');
 const clientId=str(input?.clientId,'clientId',150);
 state.proposals||=[];
 const replay=state.proposals.find(p=>p.directOrder===true&&p.clientId===clientId);
 if(replay){if(replay.signature!==proposalSeal(replay))fail('Conteúdo da ordem mudou.');return replay;}
 if(state.paused)fail('Escritório pausado: retome no Bunker para executar.','DIRECT_ORDER_PAUSED');
 const project=str(input.project,'Projeto'),adAccountId=str(input.adAccountId,'Conta'),objectId=str(input.objectId,'Campanha');
 if(!Object.prototype.hasOwnProperty.call(state.config||{},project))fail('Projeto não configurado no Bunker.','DIRECT_ORDER_PROJECT');
 const action=input.action;if(!['pause','increase','reduce'].includes(action))fail('Ação da ordem inválida: use pausar, aumentar ou reduzir.');
 const r=live?.row;if(!r)fail('Sem leitura ao vivo desta campanha nos últimos 10 minutos. Tente de novo em 1 minuto.','DIRECT_ORDER_NO_LIVE');
 if(r.adAccountId!==adAccountId||r.externalId!==objectId)fail('A leitura ao vivo não é desta campanha.','DIRECT_ORDER_IDENTITY');
 if(String(r.provider||'').toLowerCase()!=='meta')fail('Ordem direta só para campanhas Meta.','DIRECT_ORDER_PROVIDER');
 if(!uuid.test(r.id||'')||!uuid.test(project))fail('A Malva não informou o ID interno desta campanha.','DIRECT_ORDER_IDENTITY');
 const currency=String(r.budgetCurrency||'').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))fail('Moeda nativa da campanha não confirmada na Malva.','DIRECT_ORDER_CURRENCY');
 if(isWarmupTarget(state,project,'campaign',r))fail('Campanha de aquecimento/engajamento fica fora das ordens de vendas.','DIRECT_ORDER_WARMUP');
 const allowed=liveOrderActions(live,{paused:!!state.paused});
 if(!allowed[action])fail(action==='pause'?'Só é possível pausar campanha ativa.':action==='increase'&&r.accountStatus?.active===false?'Conta de anúncios sem aptidão ativa: aumento bloqueado.':'Orçamento diário próprio da campanha não confirmado (CBO diário).','DIRECT_ORDER_ACTION');
 // The owner signed what the notch showed. Any drift since then is refused with the current values.
 const e=input.expected||{},current={status:r.status??null,dailyBudget:finite(r.dailyBudget)?r.dailyBudget:null,currency};
 if(e.status!==current.status||(action!=='pause'&&!sameCents(e.dailyBudget,current.dailyBudget))||String(e.currency||'').toUpperCase()!==currency)
  fail('O valor mudou desde que você abriu. Confira o valor atual e confirme de novo.','DIRECT_ORDER_CHANGED',current);
 if(pendingOrder(state,project,adAccountId,objectId,now))fail('Já há uma ordem aprovada desta campanha a caminho do executor.','DIRECT_ORDER_PENDING');
 const before={},after={};let kind,verb;
 if(action==='pause'){kind='status';before.status='ACTIVE';after.status='PAUSED';verb='Pausar campanha';}
 else{
  kind='budget';const next=directOrderBudget(r.dailyBudget,action,input.percent);
  if(input.after?.dailyBudget!==undefined&&!sameCents(input.after.dailyBudget,next))fail('O novo orçamento calculado não confere com o exibido. Confira e confirme de novo.','DIRECT_ORDER_CHANGED',current);
  const refusal=action==='increase'?capRefusal({cap:ownerBudgetCap(policy,project,adAccountId),before:r.dailyBudget,after:next,currency}):null;
  if(refusal)fail(refusal.message,'DIRECT_ORDER_CAP',{...current,cap:refusal.cap,maxIncreasePercent:refusal.maxPercent});
  before.dailyBudget=r.dailyBudget;after.dailyBudget=next;verb=(action==='increase'?'Aumentar':'Reduzir')+' orçamento diário '+input.percent+'%';
 }
 pruneDirectOrders(state,now);
 if(state.proposals.length>=collaborationLimits.proposals)fail('Limite de propostas atingido. Arquive o histórico antes de uma nova ordem.','DIRECT_ORDER_CAPACITY');
 const reason=typeof input.reason==='string'&&input.reason.trim()?input.reason.trim().slice(0,1000):'Ordem direta do dono no notch, confirmada com Touch ID.';
 const accountName=typeof r.accountName==='string'&&r.accountName.trim()?r.accountName.trim().slice(0,500):adAccountId;
 const payload={title:accountName+' · '+verb+' (ordem do dono)',reason,action:kind,level:'campaign',provider:'meta',adAccountId,objectId,
  objectName:typeof r.name==='string'?r.name.slice(0,500):objectId,accountName,currency,budgetOwner:kind==='budget'?'CBO':null,before,after,
  sourceCut:[],sourceHash:null,evidenceRefs:[{period:'today',level:'campaign',adAccountId,externalId:objectId,fetchedAt:iso(live.fetchedAt)}],opinionRefs:[],risks:[],
  ownerOrder:true,directOrder:true,liveTarget:liveTarget(r),liveFetchedAt:iso(live.fetchedAt)};
 const proposal={id:crypto.randomUUID(),roundId:null,project,version:1,status:'Aguardando aprovação',createdAt:iso(now),expiresAt:iso(now+directOrderLimits.validityMs),
  createdBy:'owner',ownerOrder:true,directOrder:true,ownerId,payload,supersedes:null,reviews:[],reviewClaims:{},clientId,
  requestFingerprint:fingerprint({owner:ownerId,payload:{action:kind,adAccountId,objectId,before,after}})};
 proposal.signature=proposalSeal(proposal);
 const comment='Ordem direta do dono, confirmada com Touch ID no Mac.';
 proposal.reviews.push({id:crypto.randomUUID(),actor:'owner',actorId:ownerId,agentId:null,decision:'approve',comment,version:1,signature:proposal.signature,createdAt:iso(now),clientId:clientId+':approve',
  requestFingerprint:fingerprint({actorKey:'owner:'+ownerId,decision:'approve',comment,version:1,signature:proposal.signature,claimId:null,executionRef:null})});
 Object.assign(proposal,{status:'Aprovada',approvedAt:iso(now),approvedVersion:1,approvedSignature:proposal.signature,updatedAt:iso(now)});
 state.proposals.unshift(proposal);
 return proposal;
}
