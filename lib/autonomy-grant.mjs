/** Autonomy module (owner request of 09/11/2026: "quero poder ativar quando for pra ele assumir o controle das
 * campanhas ... Vou setar o que ele pode fazer").
 *
 * The owner sets, in the web interface only, what the Bunk may do:
 *  - a general switch (`enabled`, off by default) that also works as the kill switch;
 *  - per project a mode: off · shadow (only records) · confirm (Bunk prepares, the owner approves with Touch ID) ·
 *    auto (Bunk sends the order alone, within the limits);
 *  - per campaign an exception to the project's mode (e.g. "never touch this one");
 *  - which actions are allowed (pause, reduce, increase, activate) and the limits (max % up/down, daily-budget ceiling in
 *    the campaign's currency, orders per campaign per day).
 *
 * An "auto" order is born only from a Sombra decision of this very pass that would execute (nothing blocks it, the rule
 * passed its own score when the rule is score-gated) and that passes every check below. It is an approved exact
 * proposal with the live Malva value, sent by the Cloudflare executor through the same claim → prepare → single submit
 * → reread → confirm as the owner's direct order. The grant is re-checked at claim, prepare and submit: turning the
 * switch off, changing the project or campaign mode or any limit voids every order not yet sent.
 *
 * Pure: no provider call, no storage. */
import {liveOrderActions,liveTarget} from './owner-order-live.mjs';
import {isWarmupTarget} from './campaign-scope.mjs';
import {proposalSeal,collaborationLimits} from './collaboration.mjs';
import {fingerprint} from './fingerprint.mjs';
import {autonomyModes,campaignKey,autonomyFingerprint,effectiveMode,isAutonomyOrder,assertAutonomyGrant} from './autonomy-fence.mjs';
export {autonomyModes,campaignKey,autonomyFingerprint,effectiveMode,isAutonomyOrder,assertAutonomyGrant};

export const autonomyActions=Object.freeze(['pause','reduce','increase','activate']);
export const autonomyLimits=Object.freeze({validityMs:10*60000,cooldownMs:60*60000,maxCampaignRules:300,defaultOrdersPerDay:2,maxOrdersPerDay:10,keepLog:200,maxUnsentRetries:3,keepAsks:40});
/** @type {Readonly<Record<string,string>>} */
export const modeLabels=Object.freeze({off:'Desligado',shadow:'Sombra',confirm:'Confirmar',auto:'Automático'});
/** @type {Readonly<Record<string,string>>} */
export const actionLabels=Object.freeze({pause:'Pausar',reduce:'Reduzir orçamento',increase:'Aumentar orçamento',activate:'Reativar campanha'});

const finite=Number.isFinite,time=v=>typeof v==='number'?v:Date.parse(v||''),iso=v=>new Date(time(v)).toISOString();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents=v=>Math.round((v+Number.EPSILON)*100)/100;
const sameCents=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<0.0005;
export class AutonomyConfigError extends Error{constructor(message){super(message);this.code='AUTONOMY_CONFIG_INVALID';}}
const bad=m=>{throw new AutonomyConfigError(m);};

function num(v,label,{min,max,int=false}){
 if(v===null||v===undefined||v==='')return null;
 if(typeof v!=='number'||!finite(v)||v<min||v>max||int&&!Number.isInteger(v))bad(`${label}: use um número de ${min} a ${max}.`);
 return int?v:cents(v);
}
const emptyProject=()=>({mode:'shadow',actions:{pause:false,reduce:false,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:null,budgetCap:null,ordersPerDay:autonomyLimits.defaultOrdersPerDay},campaigns:{}});

/** Validated owner configuration. Unknown projects are refused; a missing project keeps "Sombra" with nothing allowed. */
export function normalizeAutonomyConfig(input,projectIds){
 if(!input||typeof input!=='object')bad('Configuração de autonomia ausente.');
 if(typeof input.enabled!=='boolean')bad('Interruptor geral inválido.');
 const ids=new Set(projectIds),projects={};
 const raw=input.projects&&typeof input.projects==='object'?input.projects:{};
 for(const [id,p] of Object.entries(raw)){
  if(!ids.has(id))bad('Projeto não configurado no Bunker.');
  if(!p||typeof p!=='object')bad('Projeto inválido.');
  const mode=p.mode??'shadow';if(!autonomyModes.includes(mode))bad('Nível do projeto inválido.');
  const actions={};for(const a of autonomyActions){const v=p.actions?.[a]??false;if(typeof v!=='boolean')bad('Ação inválida.');actions[a]=v;}
  const l=p.limits||{};
  const limits={maxIncreasePct:num(l.maxIncreasePct,'Aumento máximo (%)',{min:1,max:1000}),maxReducePct:num(l.maxReducePct,'Redução máxima (%)',{min:1,max:99}),
   budgetCap:num(l.budgetCap,'Teto de orçamento diário',{min:1,max:1e9}),ordersPerDay:num(l.ordersPerDay??autonomyLimits.defaultOrdersPerDay,'Ordens por campanha por dia',{min:1,max:autonomyLimits.maxOrdersPerDay,int:true})};
  const campaigns={},list=p.campaigns&&typeof p.campaigns==='object'?Object.entries(p.campaigns):[];
  if(list.length>autonomyLimits.maxCampaignRules)bad(`Até ${autonomyLimits.maxCampaignRules} exceções de campanha por projeto.`);
  for(const [key,c] of list){
   if(typeof key!=='string'||!/^[^:\s]{1,80}:[^:\s]{1,80}$/.test(key))bad('Campanha da exceção inválida.');
   if(!c||!autonomyModes.includes(c.mode))bad('Nível da exceção de campanha inválido.');
   campaigns[key]={mode:c.mode,name:typeof c.name==='string'?c.name.trim().slice(0,200):null};
  }
  projects[id]={mode,actions,limits,campaigns};
 }
 return {version:1,enabled:input.enabled,projects};
}

/** Fingerprint of what the owner allowed; any change voids an order not yet sent. Ignores who saved it and when. */

/** Owner write (web interface only). Returns the stored config. */
export function setAutonomyConfig(state,input,ownerId,now=Date.now()){
 if(typeof ownerId!=='string'||!ownerId)bad('Somente o dono pode alterar a autonomia.');
 const next=normalizeAutonomyConfig(input,Object.keys(state.config||{}));
 const prev=state.autonomy||null,turnedOn=next.enabled&&!prev?.enabled;
 state.autonomy={...next,updatedAt:iso(now),updatedBy:ownerId,enabledAt:next.enabled?(turnedOn?iso(now):prev?.enabledAt||iso(now)):null,disabledAt:next.enabled?null:(prev?.enabled?iso(now):prev?.disabledAt||null)};
 state.events||=[];
 state.events.unshift({id:crypto.randomUUID(),at:iso(now),text:turnedOn?'Autonomia do Bunk ligada pelo dono.':next.enabled?'Permissões da autonomia do Bunk atualizadas pelo dono.':prev?.enabled?'Autonomia do Bunk desligada pelo dono.':'Permissões da autonomia do Bunk salvas (desligada).'});
 state.events=state.events.slice(0,120);
 return state.autonomy;
}

/** General switch off, from any owner surface. Keeps every permission as it was. */
export function killAutonomy(state,ownerId,now=Date.now()){
 if(typeof ownerId!=='string'||!ownerId)bad('Somente o dono pode desligar a autonomia.');
 const prev=state.autonomy;if(!prev?.enabled)return prev||null;
 state.autonomy={...prev,enabled:false,updatedAt:iso(now),updatedBy:ownerId,disabledAt:iso(now)};
 state.events||=[];state.events.unshift({id:crypto.randomUUID(),at:iso(now),text:'Autonomia do Bunk desligada pelo dono.'});state.events=state.events.slice(0,120);
 return state.autonomy;
}

/** The mode that applies to one campaign: its exception, else the project's mode; "Sombra" without configuration. */

/** Owner's ceiling for this project (campaign's native currency), or null. */
export function autonomyBudgetCap(config,project){const v=config?.projects?.[project]?.limits?.budgetCap;return finite(v)&&v>0?v:null;}

/** Action of a Sombra decision: pause / activate (status) or increase / reduce (daily budget), with its percent. */
export function decisionAction(d){
 if(d?.action==='status')return d.after?.status==='PAUSED'?{action:'pause',percent:null}:d.after?.status==='ACTIVE'?{action:'activate',percent:null}:null;
 if(d?.action==='budget'&&finite(d.before?.dailyBudget)&&d.before.dailyBudget>0&&finite(d.after?.dailyBudget)){
  const pct=Math.round((d.after.dailyBudget/d.before.dailyBudget-1)*10000)/100;
  return pct>0?{action:'increase',percent:pct}:pct<0?{action:'reduce',percent:-pct}:null;
 }
 return null;
}

/** Autonomy orders of one Meta campaign, newest first. Counted by account + object across projects: a campaign
 * shared by two configured projects (same ad account) is one campaign, so limits and cooldown apply once. */
function campaignOrders(state,adAccountId,objectId){
 return (state.proposals||[]).filter(p=>p.autonomyOrder===true&&p.payload?.adAccountId===adAccountId&&p.payload?.objectId===objectId).sort((a,b)=>time(b.createdAt)-time(a.createdAt));
}
/**
 * A Bunk order that never left the Bunker and can no longer run: its validity ended and no execution of it has a
 * dispatch, a pending verification or a live reservation. It never touched the campaign, so it does not hold the day's
 * count, the cooldown or the "already an order" mark (owner report of 12/11/2026: saving a permission voided an order
 * and the campaign stayed blocked for the rest of the day). Anything with submittedAt, Enviada, Verificação necessária
 * Confirmada or an applied mark always counts: a dispatched order is never tried again. Without the executions list (read models,
 * simulator) or a valid expiry the order counts, as before.
 */
export function unsentAutonomyOrder(state,p,now=Date.now()){
 if(!Array.isArray(state?.executions)||!finite(time(p?.expiresAt))||time(p.expiresAt)>now||p.appliedAt)return false;
 // The proposal keeps a copy of its execution: either record showing a dispatch is enough to count the order.
 const mine=[...state.executions.filter(e=>e?.proposalId===p.id),...(p.execution?[p.execution]:[])];
 if(mine.some(e=>e.submittedAt||['Enviada','Verificação necessária','Confirmada'].includes(e.status)))return false;
 return !mine.some(e=>['Reservada','Preparada'].includes(e.status)&&time(e.leaseUntil)>now);
}
const localDay=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};

/**
 * What the owner's permissions say about one Sombra decision of the current pass. Never an order by itself.
 * @param {any} state @param {any} d @param {{now?:number,timezone?:string}} [opts]
 * @returns {{mode:string,act:'none'|'confirm'|'auto',action:string|null,percent:number|null,blockers:string[]}}
 */
export function autonomyGrant(state,d,{now=Date.now(),timezone='America/Sao_Paulo'}={}){
 const config=state?.autonomy,mode=effectiveMode(config,d?.project,d?.adAccountId,d?.objectId),a=decisionAction(d),blockers=[];
 const out=(act)=>({mode,act:blockers.length?'none':act,action:a?.action??null,percent:a?.percent??null,blockers});
 if(mode==='off'){blockers.push('Desligado para esta campanha/projeto.');return out('none');}
 if(mode==='shadow')return out('none');
 if(!config?.enabled)blockers.push('Autonomia desligada no interruptor geral.');
 if(state?.paused)blockers.push('Escritório pausado.');
 if(!d?.wouldExecute||(Array.isArray(d.blockedBy)&&d.blockedBy.length))blockers.push('A Sombra não executaria esta decisão agora.');
 if(d?.alertOnly)blockers.push('Só alerta.');
 if(!a){blockers.push('Ação fora das permissões (só pausar, reduzir, aumentar ou reativar).');return out('none');}
 const p=config?.projects?.[d.project],l=p?.limits||{};
 if(!p?.actions?.[a.action])blockers.push(`${actionLabels[a.action]} não permitido neste projeto.`);
 if(a.action==='increase'){
  if(!finite(l.maxIncreasePct))blockers.push('Aumento máximo (%) não definido.');else if(a.percent>l.maxIncreasePct+1e-9)blockers.push(`Aumento de ${a.percent}% acima do máximo de ${l.maxIncreasePct}%.`);
  if(!finite(l.budgetCap))blockers.push('Teto de orçamento diário não definido.');else if(d.after.dailyBudget>l.budgetCap+0.0005)blockers.push(`Novo orçamento acima do teto de ${l.budgetCap} ${d.after.currency||''}`.trim()+'.');
 }
 if(a.action==='reduce'){if(!finite(l.maxReducePct))blockers.push('Redução máxima (%) não definida.');else if(a.percent>l.maxReducePct+1e-9)blockers.push(`Redução de ${a.percent}% acima do máximo de ${l.maxReducePct}%.`);}
 if(a.action==='activate')blockers.push('Reativação ainda sem regra da Sombra: nada é reativado sozinho.');
 const every=campaignOrders(state,d.adAccountId,d.objectId),orders=every.filter(o=>!unsentAutonomyOrder(state,o,now)),today=localDay(now,timezone);
 if(orders.some(o=>o.payload?.shadowId&&o.payload.shadowId===d.id))blockers.push('Esta decisão já virou ordem.');
 const unsent=every.filter(o=>o.payload?.shadowId&&o.payload.shadowId===d.id&&unsentAutonomyOrder(state,o,now)).length;
 if(unsent>=autonomyLimits.maxUnsentRetries)blockers.push(`Esta decisão já teve ${unsent} ordens que venceram sem envio hoje: o Bunk não tenta de novo.`);
 const todays=orders.filter(o=>localDay(time(o.createdAt),timezone)===today).length,limit=finite(l.ordersPerDay)?l.ordersPerDay:autonomyLimits.defaultOrdersPerDay;
 if(todays>=limit)blockers.push(`Limite de ${limit} ordem${limit===1?'':'s'} do Bunk por campanha hoje atingido.`);
 if(orders[0]&&now-time(orders[0].createdAt)<autonomyLimits.cooldownMs)blockers.push('Outra ordem do Bunk nesta campanha há menos de 1h.');
 return out(mode==='auto'?'auto':'confirm');
}

/** True for an order the Bunk created under the owner's autonomy permission. */


/**
 * Turns one granted "auto" decision into an approved exact order, with the live Malva value of the last minutes.
 * The Sombra may have read Meta: the order is refused when Malva still shows another value (prepare compares Malva).
 * @param {any} state @param {any} d Sombra decision
 * @param {{live?:any,now?:number,timezone?:string}} [opts]
 * @returns {{proposal?:any,blocked?:string[]}}
 */
export function recordAutonomyOrder(state,d,{live=null,now=Date.now(),timezone=undefined}={}){
 now=time(now);
 const g=autonomyGrant(state,d,{now,timezone});if(g.act!=='auto')return {blocked:g.blockers.length?g.blockers:['Modo da campanha não é Automático.']};
 const r=live?.row,blockers=[];
 if(!r)return {blocked:['Sem leitura ao vivo da Malva desta campanha nos últimos 10 minutos.']};
 if(r.adAccountId!==d.adAccountId||r.externalId!==d.objectId)return {blocked:['A leitura ao vivo não é desta campanha.']};
 if(String(r.provider||'').toLowerCase()!=='meta')blockers.push('Só campanhas Meta.');
 if(!uuid.test(r.id||'')||!uuid.test(d.project))blockers.push('A Malva não informou o ID interno desta campanha.');
 const currency=String(r.budgetCurrency||'').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))blockers.push('Moeda nativa da campanha não confirmada na Malva.');
 if(isWarmupTarget(state,d.project,'campaign',r))blockers.push('Aquecimento/engajamento fica fora das ordens de vendas.');
 const allowed=liveOrderActions(live,{paused:!!state.paused});
 if(g.action==='pause'){if(!allowed.pause||d.before?.status!==r.status)blockers.push('O status na Malva não confere com a decisão da Sombra.');}
 else if(!allowed[g.action]||!sameCents(d.before?.dailyBudget,r.dailyBudget))blockers.push('O orçamento na Malva não confere com a decisão da Sombra.');
 if(g.action!=='pause'&&String(d.before?.currency||'').toUpperCase()!==currency)blockers.push('Moeda da decisão não confere com a Malva.');
 const next=g.action==='pause'?null:cents(d.after.dailyBudget);
 if(next!==null&&(!(next>0)||next>1e9||sameCents(next,r.dailyBudget)))blockers.push('Novo orçamento inválido.');
 // Any project: the same Meta campaign may sit in two projects that share the ad account.
 if((state.proposals||[]).some(p=>p.payload?.adAccountId===d.adAccountId&&p.payload?.objectId===d.objectId&&p.status==='Aprovada'&&!p.appliedAt&&time(p.expiresAt)>now))blockers.push('Já há uma ordem aprovada desta campanha a caminho do executor.');
 if((state.proposals||[]).length>=collaborationLimits.proposals)blockers.push('Limite de propostas atingido.');
 if(blockers.length)return {blocked:blockers};
 const kind=g.action==='pause'?'status':'budget',before={},after={};
 if(kind==='status'){before.status='ACTIVE';after.status='PAUSED';}else{before.dailyBudget=r.dailyBudget;after.dailyBudget=next;}
 const verb=g.action==='pause'?'Pausar campanha':`${g.action==='increase'?'Aumentar':'Reduzir'} orçamento diário ${g.percent}%`;
 const accountName=typeof r.accountName==='string'&&r.accountName.trim()?r.accountName.trim().slice(0,500):d.adAccountId;
 const config=state.autonomy,fp=autonomyFingerprint(config);
 const payload={title:accountName+' · '+verb+' (Bunk, autonomia)',reason:String(d.reason||'').slice(0,1000)||'Decisão da Sombra dentro das permissões do dono.',action:kind,level:'campaign',provider:'meta',
  adAccountId:d.adAccountId,objectId:d.objectId,objectName:typeof r.name==='string'?r.name.slice(0,500):d.objectId,accountName,currency,budgetOwner:kind==='budget'?'CBO':null,before,after,
  sourceCut:[],sourceHash:null,evidenceRefs:[{period:'today',level:'campaign',adAccountId:d.adAccountId,externalId:d.objectId,fetchedAt:iso(live.fetchedAt)}],opinionRefs:[],risks:[],
  autonomyOrder:true,rule:d.rule,ruleLabel:d.ruleLabel||null,shadowId:d.id||null,liveTarget:liveTarget(r),liveFetchedAt:iso(live.fetchedAt)};
 const proposal={id:crypto.randomUUID(),roundId:null,project:d.project,version:1,status:'Aguardando aprovação',createdAt:iso(now),expiresAt:iso(now+autonomyLimits.validityMs),
  createdBy:'bunk',autonomyOrder:true,directOrder:true,ownerOrder:false,grant:{fingerprint:fp,mode:'auto',grantedBy:config.updatedBy||null,grantedAt:config.updatedAt||null},
  payload,supersedes:null,reviews:[],reviewClaims:{},clientId:'autonomy:'+(d.id||crypto.randomUUID()),requestFingerprint:fingerprint({autonomy:fp,payload:{action:kind,adAccountId:d.adAccountId,objectId:d.objectId,before,after}})};
 proposal.signature=proposalSeal(proposal);
 const comment='Permissão de autonomia do dono (modo Automático), conferida neste instante.';
 proposal.reviews.push({id:crypto.randomUUID(),actor:'autonomy',actorId:config.updatedBy||null,agentId:null,decision:'approve',comment,version:1,signature:proposal.signature,createdAt:iso(now),clientId:proposal.clientId+':approve',
  requestFingerprint:fingerprint({actorKey:'autonomy:'+fp,decision:'approve',comment,version:1,signature:proposal.signature})});
 Object.assign(proposal,{status:'Aprovada',approvedAt:iso(now),approvedVersion:1,approvedSignature:proposal.signature,updatedAt:iso(now)});
 state.proposals||=[];state.proposals.unshift(proposal);
 return {proposal};
}

/** Log line kept by the executor (no secret, no full payload). */
export function autonomyLogEntry(d,g,result,now=Date.now()){
 return {at:iso(now),project:d.project,projectName:d.projectName||null,adAccountId:d.adAccountId,objectId:d.objectId,campaign:d.name||null,rule:d.rule,ruleLabel:d.ruleLabel||null,shadowId:d.id||null,
  mode:g.mode,action:g.action,percent:g.percent,before:d.before??null,after:d.after??null,result,proposalId:result.proposalId||null};
}
export function mergeAutonomyLog(prev,entries){
 const list=[...(Array.isArray(entries)?entries:[]),...(Array.isArray(prev)?prev:[])];
 // One line per shadow decision and outcome kind: a blocked decision re-seen every minute does not flood the log.
 const seen=new Set(),out=[];
 for(const e of list){const k=JSON.stringify([e.shadowId,e.result?.kind,(e.result?.blockers||[]).join('|')]);if(seen.has(k))continue;seen.add(k);out.push(e);}
 return out.slice(0,autonomyLimits.keepLog);
}

/**
 * One request waiting for the owner (level Confirmar): the exact change the Bunk would make, for the notch and the web.
 * Never an order, a proposal or an approval: the owner executes it himself, with Touch ID.
 */
export function autonomyAskEntry(d,g,now=Date.now()){
 return {id:String(d.id||JSON.stringify([d.project,d.adAccountId,d.objectId,g.action])),at:iso(now),project:d.project,projectName:d.projectName||null,adAccountId:d.adAccountId,objectId:d.objectId,
  campaign:typeof d.name==='string'?d.name.slice(0,200):null,account:typeof d.accountName==='string'?d.accountName.slice(0,120):null,rule:d.rule||null,ruleLabel:d.ruleLabel||null,
  action:g.action,percent:g.percent,before:d.before??null,after:d.after??null,reason:typeof d.reason==='string'?d.reason.slice(0,400):null};
}
/**
 * The list of open requests after one pass. A project evaluated in this pass keeps only what the pass still asks (a
 * decision the rule dropped, a level change or the switch off closes the request); a project the pass did not evaluate
 * keeps its requests. A request keeps the time it was first asked, so it alerts once.
 * @param {any[]} prev @param {any[]} current requests of this pass @param {string[]|null} evaluated project ids of this pass (null: all)
 */
export function mergeAutonomyAsks(prev,current,evaluated=null){
 const old=new Map((Array.isArray(prev)?prev:[]).filter(a=>a&&typeof a.id==='string').map(a=>[a.id,a])),seen=new Set(),out=[];
 for(const a of Array.isArray(current)?current:[]){if(!a||typeof a.id!=='string'||seen.has(a.id))continue;seen.add(a.id);out.push({...a,at:old.get(a.id)?.at||a.at});}
 if(Array.isArray(evaluated)){const done=new Set(evaluated);for(const a of old.values())if(!seen.has(a.id)&&!done.has(a.project))out.push(a);}
 return out.sort((a,b)=>time(b.at)-time(a.at)).slice(0,autonomyLimits.keepAsks);
}

/** Read model for the web panel and the notch. */
export function autonomyView(state){
 const config=state?.autonomy||null,names=Object.fromEntries(Object.entries(state?.config||{}).map(([id,c])=>[id,c?.projectName||id]));
 return {enabled:!!config?.enabled,updatedAt:config?.updatedAt||null,enabledAt:config?.enabledAt||null,disabledAt:config?.disabledAt||null,fingerprint:autonomyFingerprint(config),
  projects:Object.keys(state?.config||{}).map(id=>{const p=config?.projects?.[id]||emptyProject();return {id,name:names[id],mode:p.mode,actions:p.actions,limits:p.limits,campaigns:p.campaigns||{}};})};
}
export {emptyProject as autonomyEmptyProject};
