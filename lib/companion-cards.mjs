import {buildDecisionCards} from './decision-cards.mjs';
import {decisionIntentActions} from './decision-intent.mjs';
import {ownerAppliedVerification} from './owner-applied.mjs';
import {liveOrderRow,liveOrderActions} from './owner-order-live.mjs';
import {directOrderView} from './owner-direct-order.mjs';
/** Compact decision view for the Mac app: the same cards and proposals the web shows,
 * with the exact seals the owner request must echo back. Read-only; no provider call. */
const num=v=>Number.isFinite(v)?v:null;
const window=w=>w?{spend:num(w.spend),roas:num(w.roas),roi:num(w.roi),frontOrders:num(w.frontOrders)}:null;
function proposalView(p,now){
 const v=p.payload||{};
 return {id:p.id,version:p.version,signature:p.signature,status:p.status,project:p.project,title:v.title??null,reason:v.reason??null,action:v.action,level:v.level,
  adAccountId:v.adAccountId,objectId:v.objectId,campaign:v.objectName??null,account:v.accountName??null,currency:v.currency??null,
  before:{dailyBudget:num(v.before?.dailyBudget),status:v.before?.status??null},after:{dailyBudget:num(v.after?.dailyBudget),status:v.after?.status??null},
  expiresAt:p.expiresAt,expired:!(Date.parse(p.expiresAt)>now)};
}
/** Owner direct order: which actions run now, and what still blocks them. Team opinions, return goal and
 * daily cap inform but do not block an owner order (owner decision of 2026-11-07); source, pause, budget
 * ownership, account and a live proposal still do. The server re-checks everything on submit. */
const advisory=/Faltam pareceres|Meta de retorno|Teto diário/;
function ownerOrderView(c,liveItems,paused,now){
 const live=!!c.proposal&&['Em revisão','Aguardando aprovação','Aprovada'].includes(c.proposal.status);
 // Fresh live reading (a few minutes old): the order uses it, so the older analysis no longer blocks.
 const fresh=liveOrderRow(liveItems,c.project,c.row.adAccountId,c.row.externalId,now),byLive=fresh?liveOrderActions(fresh,{paused}):null;
 const stale=/Leitura de hoje vencida|quatro janelas completas|cenário mudou/;
 const blockers=c.blockedReasons.filter(r=>!advisory.test(r)&&!(fresh&&stale.test(r)));
 if(live)blockers.push('Há uma proposta em andamento para esta campanha: decida por ela em "Aguardando você".');
 if(!c.roundId&&!blockers.some(r=>/Rodada/.test(r)))blockers.push('Rodada conjunta válida ainda não está disponível.');
 const ok=a=>!!c.roundId&&!live&&(byLive?byLive[a]===true:c.actionable?.[a]===true);
 const r=fresh?.row;
 return {orderActions:{increase:ok('increase'),reduce:ok('reduce'),pause:ok('pause'),keep:false},orderBlockers:blockers,
  orderSource:fresh?{kind:'live',at:fresh.fetchedAt,status:r.status??null,dailyBudget:num(r.dailyBudget),currency:r.budgetCurrency??null}:{kind:'analysis',at:c.sourceAt??null,status:c.row.status??null,dailyBudget:num(c.row.dailyBudget),currency:c.row.budgetCurrency??null}};
}

/** @param {any} state @param {{project?:string,adAccountId?:string|null,objectId?:string|null}} [scope] @param {number|null} [revision] @param {number} [now] @param {{liveItems?:any[]}} [live] */
export function companionCards(state,{project='all',adAccountId=null,objectId=null}={},revision=null,now=Date.now(),{liveItems=[]}={}){
 const names=Object.fromEntries(Object.entries(state.config||{}).map(([id,c])=>[id,c?.projectName||id]));
 const projects=project&&project!=='all'?[project]:Object.keys(state.config||{});
 const cards=[];
 for(const p of projects){
  if(!Object.prototype.hasOwnProperty.call(state.config||{},p))continue;
  for(const c of buildDecisionCards(state,p,now)){
   if(adAccountId&&c.row.adAccountId!==adAccountId||objectId&&c.row.externalId!==objectId)continue;
   const r=c.row;
   cards.push({id:c.id,signature:c.signature,project:c.project,projectName:names[c.project]||c.project,
    campaign:r.name??null,account:r.accountName??null,adAccountId:r.adAccountId,objectId:r.externalId,status:r.status??null,
    dailyBudget:num(r.dailyBudget),currency:r.budgetCurrency??null,
    windows:{today:window(c.windows.today),yesterday:window(c.windows.yesterday),'3d':window(c.windows['3d']),'7d':window(c.windows['7d'])},
    suggestion:c.suggestion?{action:c.suggestion.action,percent:num(c.suggestion.percent),reason:c.suggestion.reason??null,origin:c.suggestion.origin}:null,
    intentActions:decisionIntentActions(c),blockedReasons:c.blockedReasons,...ownerOrderView(c,liveItems,!!state.paused,now),
    lastChoice:c.lastChoice?{action:c.lastChoice.action,percent:num(c.lastChoice.percent),status:c.lastChoice.status,createdAt:c.lastChoice.createdAt,reopenable:!!c.monitor?.afterChoice,appliedByOwner:c.lastChoice.appliedByOwner===true,canReportApplied:c.lastChoice.status==='Pendente de revisão'&&c.lastChoice.appliedByOwner!==true?c.lastChoice.action:null,verification:ownerAppliedVerification(state,c.lastChoice)?.status??null}:null,
    proposal:c.proposal?proposalView(c.proposal,now):null});
  }
 }
 const approvals=(state.proposals||[]).filter(p=>p.status==='Aguardando aprovação'&&projects.includes(p.project)&&(!adAccountId||p.payload?.adAccountId===adAccountId)&&(!objectId||p.payload?.objectId===objectId)).map(p=>({...proposalView(p,now),projectName:names[p.project]||p.project}));
 // One campaign: the owner's direct order (pause / increase / reduce) from the live Malva reading, card or not.
 const direct=objectId&&adAccountId&&project&&project!=='all'&&Object.prototype.hasOwnProperty.call(state.config||{},project)?{project,adAccountId,objectId,...directOrderView(state,{project,adAccountId,objectId},liveItems,now)}:null;
 return {revision,paused:!!state.paused,generatedAt:new Date(now).toISOString(),cards:cards.slice(0,objectId?5:60),approvals,directOrder:direct};
}
