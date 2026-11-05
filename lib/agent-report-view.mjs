import {normalizeAgentSummary} from './agent-summary.mjs';
import {sum} from './analysis.mjs';
import {fingerprint} from './collaboration.mjs';
const list=value=>Array.isArray(value)?value:[];
const key=ref=>JSON.stringify([ref.level,ref.adAccountId,ref.externalId]);
function briefReason(text){
 const value=typeof text==='string'?text.trim():'';
 if(!value)return 'O motivo não foi registrado nesta proposta.';
 if(value.length<=320)return value;
 const first=value.match(/^.{30,320}?[.!?](?:\s|$)/s)?.[0]?.trim();
 return first||value.slice(0,317).replace(/\s+\S*$/,'')+'…';
}
function proposalAction(payload){
 if(payload.action==='status')return payload.after?.status==='PAUSED'?'Pausar':payload.after?.status==='ACTIVE'?'Ativar':'Rever status';
 if(payload.action==='budget'&&Number.isFinite(payload.before?.dailyBudget)&&Number.isFinite(payload.after?.dailyBudget))return payload.after.dailyBudget>payload.before.dailyBudget?'Aumentar orçamento':'Reduzir orçamento';
 return 'Rever proposta';
}
function nextStep(proposal,now){
 if(['Fonte substituída','Expirada','Recusada','Revisão solicitada'].includes(proposal.status)||Date.parse(proposal.expiresAt)<=now)return 'Consulte uma análise atual antes de decidir.';
 if(proposal.status==='Aguardando aprovação')return 'A proposta está aguardando sua decisão.';
 if(proposal.status==='Aprovada')return 'Aprovação registrada. Confira a aplicação no acompanhamento.';
 return 'A equipe ainda está conferindo a proposta.';
}

/** A readable view of recorded facts. Never guesses a decision from free text.
 * @param {{adAccountId:string,externalId:string}|null} [target]
 */
export function agentReportView(state,message,extraProposals=[],now=Date.now(),target=null){
 const refs=list(message.evidenceRefs),snapshots=list(state?.snapshots),project=message.project;
 const round=list(state?.collaborationRounds).find(r=>r.id===message.roundId&&r.project===project),verified=new Map();
 const exactSource=ref=>{
  if(ref.projectId&&ref.projectId!==project)return undefined;
  const source=snapshots.find(s=>s.projectId===project&&s.level===ref.level&&s.period===ref.period&&s.fetchedAt===ref.fetchedAt&&s.source==='Malva MCP'&&s.complete===true);
  if(!source)return undefined;
  const cut=list(round?.sourceCut).find(c=>c.level===ref.level&&c.period===ref.period);
  if(cut?.fingerprint){if(!verified.has(source))verified.set(source,fingerprint(source)===cut.fingerprint);if(!verified.get(source))return undefined;}
  return source;
 };
 const historical=message._archived===true||round?.status==='Fonte substituída'||refs.some(ref=>!exactSource(ref));
 let summary=null;try{summary=normalizeAgentSummary(message.summary);}catch{}
 const seen=new Set();
 const proposals=[...list(state?.proposals),...list(extraProposals)].filter(p=>{
  if(target&&(p.payload?.adAccountId!==target.adAccountId||p.payload?.objectId!==target.externalId))return false;
  if(!p?.id||seen.has(p.id)||p.project!==project||!message.roundId||p.roundId!==message.roundId)return false;
  if(!list(p.payload?.opinionRefs).includes(message.id)&&message.fromAgent!=='ops')return false;
  seen.add(p.id);return true;
 }).sort((a,b)=>Date.parse(b.createdAt||'')-Date.parse(a.createdAt||'')).slice(0,3).map(p=>({
  id:p.id,action:proposalAction(p.payload||{}),name:p.payload?.objectName||'Objeto sem nome registrado',account:p.payload?.accountName||'Conta N/D',
  reason:briefReason(p.payload?.reason),nextStep:nextStep(p,now),status:p.status,currency:p.payload?.currency,
  before:p.payload?.before,after:p.payload?.after,level:p.payload?.level,adAccountId:p.payload?.adAccountId,externalId:p.payload?.objectId,
 }));
 const readings=list(message.campaignReadings).filter(r=>!target||r.adAccountId===target.adAccountId&&r.externalId===target.externalId).map(r=>({...r,name:snapshots.filter(s=>s.projectId===project&&s.level==='campaign').flatMap(s=>list(s.rows)).find(row=>row.adAccountId===r.adAccountId&&row.externalId===r.externalId)?.name||r.externalId}));
 if(target&&readings.length===1)summary={decision:({observe:'Observar',investigate:'Investigar',candidate:'Candidata a ajuste'})[readings[0].assessment]||'Leitura registrada',reason:readings[0].reason,nextStep:'Confronte os outros pareceres e os dados atuais antes de decidir.'};
 const targets=[],targetKeys=new Set();
 const add=ref=>{if(target&&(ref.adAccountId!==target.adAccountId||ref.externalId!==target.externalId))return;if(!ref.externalId||targetKeys.has(key(ref)))return;targetKeys.add(key(ref));targets.push(ref);};
 for(const p of proposals)add(p);
 if(!targets.length){const campaigns=refs.filter(ref=>!ref.empty&&ref.level==='campaign');for(const ref of (campaigns.length?campaigns:refs.filter(ref=>!ref.empty)))add(ref);}
 const facts=targets.slice(0,3).map(target=>{
  let name=target.name||null,account=target.account||null;
  const windows=['3d','today'].map(period=>{
   const ref=refs.find(r=>r.period===period&&key(r)===key(target)),source=ref&&exactSource(ref);
   const row=list(source?.rows).find(r=>r.adAccountId===target.adAccountId&&r.externalId===target.externalId&&(!r.level||r.level===target.level));
   if(row){name=row.name;account=row.accountName;}
   return {period,metrics:row?sum([row]):null};
  });
  return {key:key(target),name:name||'Objeto da análise',account:account||'Conta N/D',windows};
 }).filter(fact=>fact.windows.some(window=>window.metrics));
 if(!summary)summary=proposals.length?{
  decision:proposals.length===1?proposals[0].action:'A equipe sugeriu '+proposals.length+' ajustes',
  reason:proposals.length===1?proposals[0].reason:'Confira abaixo o motivo e o próximo passo de cada proposta.',
  nextStep:proposals.length===1?proposals[0].nextStep:'Abra a proposta atual para conferir os valores antes de decidir.',
 }:{decision:'Análise registrada',reason:'Não há ajuste proposto vinculado a este parecer.',nextStep:'Os números disponíveis estão abaixo. Uma recomendação precisa de revisão da equipe.'};
 const plain=message.kind==='message'&&!message.summary&&!proposals.length&&typeof message.text==='string'&&message.text.length<=600?message.text:null;
 return {summary,proposals,facts,historical,plain,readings};
}
