import {sum} from './analysis.mjs';
import {currentLiveSnapshot} from './live-display.mjs';
import {trackedTargets} from './live-data.mjs';

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
const meta=r=>String(r?.provider||'').toLowerCase()==='meta';
const rate=r=>r?.budgetCurrency==='BRL'?1:finite(r?.budgetRate)&&r.budgetRate>0?r.budgetRate:null;
const recent=(v,at,age)=>finite(time(v))&&time(v)<=at&&at-time(v)<=age;
export const contingencyLimits=Object.freeze({freshnessMs:300000,cooldownMs:3600000,checkpoints:[15,30,60]});

/** Resolve the shared financial parent so two different children cannot race
 * the same CBO/ABO owner. Identity always includes project/account/provider. */
export function financialScope(state,proposal){
 if(!proposal?.payload)return null;
 const p=proposal?.payload||{},owner=p.activationBudget;
 if(owner)return JSON.stringify([proposal.project,String(owner.provider).toLowerCase(),owner.adAccountId,owner.level,owner.externalId]);
 let level=p.level,id=p.objectId;
 const source=arr(state.snapshots).find(s=>s.projectId===proposal.project&&s.period==='today'&&s.level===p.level),row=arr(source?.rows).find(r=>r.adAccountId===p.adAccountId&&r.externalId===p.objectId);
 if(level!=='campaign'&&row?.campaignExternalId){
  const campaign=arr(state.snapshots).find(s=>s.projectId===proposal.project&&s.period==='today'&&s.level==='campaign')?.rows?.find(r=>r.adAccountId===p.adAccountId&&r.externalId===row.campaignExternalId);
  if(finite(campaign?.dailyBudget)&&campaign.dailyBudget>0){level='campaign';id=campaign.externalId;}
  else if(level==='ad'&&row.adsetExternalId){level='adset';id=row.adsetExternalId;}
 }
 return JSON.stringify([proposal.project,String(p.provider).toLowerCase(),p.adAccountId,level,id]);
}
export function riskIncreasing(p){return p?.payload?.action==='budget'?p.payload.after?.dailyBudget>p.payload.before?.dailyBudget:p?.payload?.action==='status'&&p.payload.after?.status==='ACTIVE';}
export function executionCollision(state,proposal,executionId,now=Date.now()){
 const scope=financialScope(state,proposal);
 return arr(state.executions).find(e=>{
  if(e.id===executionId||e.proposalId===proposal.id||e.project!==proposal.project||e.status==='Confirmada')return false;
  const p=arr(state.proposals).find(p=>p.id===e.proposalId);if(!p||financialScope(state,p)!==scope)return false;
  return !!e.submittedAt||['Enviada','Verificação necessária'].includes(e.status)||['Reservada','Preparada'].includes(e.status)&&time(e.leaseUntil)>now;
 })||null;
}
/** Hard technical lock, applied again inside claim/prepare/submit. A recent
 * confirmed reduction may be contained again with a NEW approval; another
 * increase waits for observation instead of recycling the same result. */
export function assertExecutionIsolation(state,proposal,executionId,now=Date.now()){
 const collision=executionCollision(state,proposal,executionId,now);
 if(collision)throw Error('Contingência: outra execução do mesmo orçamento financeiro está reservada ou sem confirmação. Conferir antes de enviar.');
 if(riskIncreasing(proposal)){
  const scope=financialScope(state,proposal),last=arr(state.executions).find(e=>e.id!==executionId&&e.proposalId!==proposal.id&&e.status==='Confirmada'&&recent(e.confirmedAt,now,contingencyLimits.cooldownMs)&&financialScope(state,arr(state.proposals).find(p=>p.id===e.proposalId))===scope);
  if(last)throw Error('Contingência: aguarde 60 minutos de observação após a última aplicação neste orçamento antes de outra escala ou reativação.');
 }
}
function activeIncident(state,project,row){return arr(state.incidents).find(i=>i.project===project&&i.status!=='Encerrado'&&(!arr(i.scope?.accountIds).length||i.scope.accountIds.includes(row?.adAccountId))&&(!arr(i.scope?.objectIds).length||i.scope.objectIds.some(o=>o.adAccountId===row?.adAccountId&&o.objectId===row?.externalId)));}
function currentItem(items,project,at){const matches=arr(items).filter(i=>i.projectId===project);if(matches.length!==1)return null;const item=matches[0],s=currentLiveSnapshot(item,project,undefined,at);return s&&!item.error&&recent(s.fetchedAt,at,contingencyLimits.freshnessMs)?s:null;}
function portfolio(state,project,items,at,proposalId){
 const s=currentItem(items,project,at),out={fresh:!!s,sourceFresh:!!s&&recent(s.lastSyncAt,at,900000),observedAt:s?.fetchedAt||null,spend:null,result:null,roundResultDelta:null,activeDaily:null,reservedExtra:null,completeExposure:false,unknown:0};
 if(!s)return out;
 const rows=arr(s.rows).filter(meta),ids=new Set();
 for(const r of rows){if(ids.has(key(r)))return out;ids.add(key(r));}
 Object.assign(out,{spend:sum(rows).spend,result:sum(rows).result,activeDaily:0,reservedExtra:0});
 // Query completeness is not proof that every known ID returned. A missing
 // tracked object may not silently disappear from the financial exposure.
 try{out.unknown+=trackedTargets(state,project).filter(r=>!ids.has(key(r))).length;}catch{out.unknown++;}
 const indexed=new Map(rows.map(r=>[key(r),r]));
 let knownOwners=0,unknownReservations=0;
 for(const r of rows){
  if(r.accountStatus?.active===false||r.status==='PAUSED'||r.effectiveStatus==='PAUSED'||['DELETED','ARCHIVED'].includes(r.status))continue;
  if(r.status!=='ACTIVE'||r.effectiveStatus!=='ACTIVE'||!finite(r.dailyBudget)||r.dailyBudget<=0||r.lifetimeBudget>0||rate(r)===null){out.unknown++;continue;}
  out.activeDaily+=r.dailyBudget*rate(r);knownOwners++;
 }
 // Never spend a promised reduction before its actual application. Deduplicate
 // alternative proposals by financial owner and reserve the largest increase.
 const pending=new Map();
 for(const p of arr(state.proposals)){
  if(p.project!==project||p.id===proposalId||!['Em revisão','Aguardando aprovação','Aprovada'].includes(p.status)||!riskIncreasing(p))continue;
  const e=arr(state.executions).find(e=>e.proposalId===p.id);if(e?.status==='Confirmada'||!e?.submittedAt&&(!finite(time(p.expiresAt))||time(p.expiresAt)<=at))continue;
  const v=p.payload,owner=v.activationBudget,r=indexed.get(JSON.stringify([v.adAccountId,owner?.level==='campaign'?owner.externalId:v.objectId]));
  if(v.level!=='campaign'&&owner?.level!=='campaign'||!r||rate(r)===null||owner&&owner.level!=='campaign'||r.budgetCurrency!==(owner?.currency||v.currency)||String(r.provider).toLowerCase()!==String(v.provider).toLowerCase()){out.unknown++;unknownReservations++;continue;}
  const wanted=v.action==='budget'?v.after.dailyBudget:owner.dailyBudget;
  if(!finite(wanted)){out.unknown++;unknownReservations++;continue;}
  const existing=r.status==='ACTIVE'&&r.effectiveStatus==='ACTIVE'&&finite(r.dailyBudget)?r.dailyBudget:0;
  const extra=owner&&(owner.level!==v.level||owner.externalId!==v.objectId)?0:Math.max(0,wanted-existing)*rate(r),k=financialScope(state,p);pending.set(k,Math.max(pending.get(k)||0,extra));
 }
 out.reservedExtra=unknownReservations?null:[...pending.values()].reduce((a,b)=>a+b,0);
 if(!knownOwners&&out.unknown)out.activeDaily=null;
 out.completeExposure=out.unknown===0&&s.coverage?.kind==='active-spent-tracked'&&s.coverage.activeComplete===true&&s.coverage.spentComplete===true&&s.coverage.trackedComplete===true;
 const baseline=arr(state.snapshots).filter(x=>x.projectId===project&&x.level==='campaign'&&x.period==='today'&&x.complete===true&&x.source==='Malva MCP');
 if(baseline.length===1){const b=baseline[0],before=arr(b.rows).filter(meta),keys=new Set(before.map(key));
  if(b.from===s.from&&b.to===s.to&&b.timezone===s.timezone&&time(b.fetchedAt)<=time(s.fetchedAt)&&keys.size===before.length&&keys.size===ids.size&&[...keys].every(k=>ids.has(k))){const old=sum(before).result;if(finite(old)&&finite(out.result))out.roundResultDelta=out.result-old;}
 }
 return out;
}

/** @param {any} input */
export function decisionContingency(input){
 const {state,project,row={},proposal=null,action='keep',percent=null,liveItems,now=Date.now()}=input;
 const cfg=state.config?.[project]||{},riskUp=proposal?riskIncreasing(proposal):action==='increase'||action==='activate',p=proposal||{project,payload:{level:row.level||'campaign',provider:row.provider,adAccountId:row.adAccountId,objectId:row.externalId,action:action==='pause'?'status':'budget',before:{dailyBudget:row.dailyBudget},after:{dailyBudget:action==='increase'&&finite(percent)?row.dailyBudget*(1+percent/100):row.dailyBudget}}};
 const exposure=portfolio(state,project,liveItems,now,proposal?.id),blockers=[],warnings=[],checks=[];
 const add=(phase,status,title,detail)=>checks.push({phase,status,title,detail});
 if(liveItems!==undefined&&!exposure.fresh){warnings.push('Acompanhamento atual indisponível. Não há confirmação de gasto e exposição neste momento.');if(riskUp)blockers.push('Atualizar a leitura do projeto antes de aumentar exposição.');}
 if(exposure.fresh&&!exposure.sourceFresh)warnings.push('Relógio de sincronização da origem ausente ou com mais de 15 minutos; coleta recente não garante valores instantâneos.');
 const incident=activeIncident(state,project,row);if(incident){warnings.push('Incidente ou retomada em acompanhamento. Separar o período afetado.');if(riskUp)blockers.push('Conferir e encerrar o incidente antes de ampliar a exposição.');}
 try{assertExecutionIsolation(state,p,input.executionId,now);}catch(error){blockers.push(error.message);}
 const cap=finite(cfg.dailyCap)&&cfg.dailyCap>=0?cfg.dailyCap:null,loss=finite(cfg.lossCap)&&cfg.lossCap>=0?cfg.lossCap:null;
 if(cap===null)warnings.push('Teto diário não definido: não existe bloqueio financeiro por valor configurado.');
 if(loss===null)warnings.push('Limite de perda da rodada não definido.');
 let extra=0;
 if(riskUp){
  const native=proposal?.payload?.action==='budget'?proposal.payload.after.dailyBudget:action==='increase'&&finite(percent)?row.dailyBudget*(1+percent/100):proposal?.payload?.activationBudget?.dailyBudget;
  extra=finite(native)&&finite(row.dailyBudget)&&rate(row)!==null?Math.max(0,native-(row.status==='PAUSED'?0:row.dailyBudget))*rate(row):null;
  const owner=proposal?.payload?.activationBudget,payload=proposal?.payload;
  if(owner?.level==='campaign'){
   const parent=currentItem(liveItems,project,now)?.rows.filter(r=>r.adAccountId===owner.adAccountId&&r.externalId===owner.externalId)||[];
   if(parent.length===1&&rate(parent[0])!==null&&parent[0].dailyBudget===owner.dailyBudget&&parent[0].budgetCurrency===owner.currency&&parent[0].status===owner.status){
    const isOwner=payload.level===owner.level&&payload.objectId===owner.externalId;
    extra=isOwner&&parent[0].status==='PAUSED'?owner.dailyBudget*rate(parent[0]):0;
   }else extra=null;
  }
 }
 const projected=finite(exposure.activeDaily)&&finite(exposure.reservedExtra)&&finite(extra)?exposure.activeDaily+exposure.reservedExtra+extra:null;
 if(cap!==null){
  if(riskUp&&!exposure.sourceFresh)blockers.push('Atualização da origem não confirmada para conferir o teto financeiro.');
  if(riskUp&&!finite(exposure.spend))blockers.push('Gasto atual não conciliado para conferir o teto financeiro.');
  if(finite(exposure.spend)&&exposure.spend>=cap){warnings.push('O gasto observado alcançou o teto diário. Priorizar contenção e conferir entrega.');if(riskUp)blockers.push('Teto diário de gasto alcançado.');}
  if(riskUp&&(!exposure.completeExposure||!finite(projected)))blockers.push('A exposição total não está conciliada para conferir o teto diário.');
  else if(finite(projected)&&projected>cap){warnings.push('Diário identificado e reservas ultrapassam o teto: revisar a exposição.');if(riskUp)blockers.push('O diário identificado, as reservas e esta ação ultrapassam o teto diário autorizado.');}
 }
 if(loss!==null){
  if(riskUp&&!exposure.sourceFresh)blockers.push('Atualização da origem não confirmada para conferir a perda da rodada.');
  if(!finite(exposure.roundResultDelta)){warnings.push('Perda da rodada N/D: faltam duas leituras comparáveis do mesmo dia e escopo.');if(riskUp)blockers.push('Conferir a perda da rodada antes de ampliar exposição.');}
  else if(exposure.roundResultDelta<0&&-exposure.roundResultDelta>=loss){warnings.push('A deterioração líquida desde a leitura da rodada atingiu o limite de perda.');if(riskUp)blockers.push('Limite de perda da rodada alcançado.');}
 }
 if(!exposure.completeExposure)warnings.push('Orçamento identificado é parcial: ABO, moeda, status ou escopo ainda podem exigir conciliação.');
 add('before',blockers.length?'blocked':warnings.length?'attention':'ready','Antes de decidir',blockers[0]||'Conferir quatro períodos, hierarquia, checkout, alterações recentes e exposição da operação.');
 add('during','protected','Durante a aplicação','Uma reserva por proprietário financeiro; conferir valor/moeda/status, enviar uma única vez e confirmar por nova leitura. Resposta ambígua exige conferência, sem reenvio.');
 add('after','pending','Depois da aplicação','Revisar em 15, 30 e 60 minutos, quando houver dados novos e o executor estiver disponível. Sem recuperação: preparar contenção ou reversão com nova aprovação exata.');
 return {blocked:riskUp&&blockers.length>0||!!executionCollision(state,p,input.executionId,now),riskIncreasing:riskUp,blockers:[...new Set(blockers)],warnings:[...new Set(warnings)],checks,exposure:{...exposure,projectedDaily:projected,dailyCap:cap,lossCap:loss},rule:'Proteções do Bunker não são um limite de gasto na Meta. Não garantem interrupção imediata nem autorizam pausa, redução ou reversão automática.'};
}

/** Store only explicitly BRL, same-day performance. Unknown metrics remain null. */
export function observedPerformance(input,row){
 if(input?.metricsCurrency!=='BRL'||!input.timezone||!finite(time(input.from))||!finite(time(input.to))||!(time(input.from)<=time(input.fetchedAt)&&time(input.fetchedAt)<time(input.to)))return null;
 try{new Intl.DateTimeFormat('pt-BR',{timeZone:input.timezone});}catch{return null;}
 return {currency:'BRL',from:input.from,to:input.to,timezone:input.timezone,fetchedAt:input.fetchedAt,...sum([row])};
}
export function postActionDelta(baseline,current){
 if(!baseline||!current||baseline.currency!=='BRL'||current.currency!==baseline.currency||['from','to','timezone'].some(k=>baseline[k]!==current[k])||!finite(time(baseline.fetchedAt))||!finite(time(current.fetchedAt))||time(current.fetchedAt)<=time(baseline.fetchedAt))return null;
 const delta={};for(const k of ['spend','revenueNet','frontOrders','orders','checkouts','result'])delta[k]=finite(baseline[k])&&finite(current[k])?current[k]-baseline[k]:null;
 if(finite(delta.spend)&&delta.spend<0||finite(delta.frontOrders)&&delta.frontOrders<0)return null;
 return delta;
}
function postSource(state,items,proposal,now){
 if(proposal.payload.level==='campaign')return currentItem(items,proposal.project,now);
 const sources=arr(state.snapshots).filter(s=>s.projectId===proposal.project&&s.period==='today'&&s.level===proposal.payload.level&&s.complete===true&&s.source==='Malva MCP'&&recent(s.fetchedAt,now,contingencyLimits.freshnessMs)&&time(s.from)<=now&&time(s.to)>now);
 return sources.length===1?sources[0]:null;
}
/** Bounded exact-target read; no source query or authorizing command. Both
 * permitted stores contain normalized BRL performance, separate from budgets. */
export function contingencyObservation(state,items,executionId,now=Date.now()){
 const e=arr(state.executions).find(e=>e.id===executionId&&e.status==='Confirmada'),p=arr(state.proposals).find(p=>p.id===e?.proposalId);if(!e||!p)return null;
 const s=postSource(state,items,p,now),matches=arr(s?.rows).filter(r=>r.adAccountId===p.payload.adAccountId&&r.externalId===p.payload.objectId);
 return s&&matches.length===1?{projectId:p.project,level:p.payload.level,source:s.source,complete:true,fetchedAt:s.fetchedAt,lastSyncAt:s.lastSyncAt??null,from:s.from,to:s.to,timezone:s.timezone,metricsCurrency:'BRL',rows:[matches[0]]}:null;
}
export function contingencyPlan(state,items=[],now=Date.now()){
 const projects=Object.keys(state.config||{}).map(project=>({project,projectName:state.config[project].projectName,...decisionContingency({state,project,liveItems:items,now})})),followUps=[];
 for(const e of arr(state.executions)){
  if(e.status!=='Confirmada'||!finite(time(e.confirmedAt))||time(e.confirmedAt)>now)continue;
  const p=arr(state.proposals).find(p=>p.id===e.proposalId);if(!p)continue;
  const checkpoint=contingencyLimits.checkpoints.find(n=>!arr(e.monitorChecks).some(c=>c.checkpointMinutes===n));if(!checkpoint)continue;
  const dueAt=time(e.confirmedAt)+checkpoint*60000,observed=contingencyObservation(state,items,e.id,now);
  const last=arr(e.monitorChecks).at(-1),ready=!!observed&&time(observed.fetchedAt)>=dueAt&&(!last||time(observed.fetchedAt)>time(last.observation?.fetchedAt));
  followUps.push({executionId:e.id,proposalId:p.id,project:e.project,objectId:p.payload.objectId,adAccountId:p.payload.adAccountId,checkpointMinutes:checkpoint,dueAt:new Date(dueAt).toISOString(),due:dueAt<=now,readyFromCache:ready,delta:ready?postActionDelta(e.readback?.performance,observedPerformance(observed,observed.rows[0])):null,baselineAvailable:!!e.readback?.performance,observationRequest:{action:'executionMonitor',id:e.id,entry:{checkpointMinutes:checkpoint}},notice:ready?'Revisão pendente. Observação não prova efeito causal.':'Aguardar leitura nova; não coletar fora da cadência para preencher a revisão.'});
 }
 return {projects,followUps,rule:'Antes: contexto e exposição; durante: isolamento, envio único e readback; após: 15/30/60 minutos, com registro e dados reais. Falta de limites permanece explícita. Reversão exige nova proposta e aprovação.'};
}
