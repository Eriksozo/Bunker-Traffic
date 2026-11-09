/** Owner-only requests for a fresh assessment. Never calls an ad provider. */
import {buildDecisionCards} from './decision-cards.mjs';
import {ownerAppliedDiverges} from './owner-applied.mjs';
import {shouldQueueChoiceReview} from './decision-review-queue.mjs';
import {isWarmupCampaign,isWarmupTarget} from './campaign-scope.mjs';
const rows=(s,k)=>Array.isArray(s[k])?s[k]:[];
export function decisionQueue(state,project,now=Date.now()){
 // A "Já fiz" report that the next Malva reading contradicts brings the campaign back to the queue.
 return buildDecisionCards(state,project,now).filter(card=>!card.lastChoice||card.monitor?.afterChoice||rows(state,'decisionReopens').some(r=>r.project===card.project&&r.choiceId===card.lastChoice.id)||ownerAppliedDiverges(state,card.lastChoice));
}
export function reconsiderationPlan(state,project){
 return rows(state,'decisionReopens').filter(r=>!project||project==='all'||r.project===project).map(r=>{
  const next=rows(state,'ownerChoices').some(c=>c.project===r.project&&c.cardId===r.cardId&&Date.parse(c.createdAt)>=Date.parse(r.createdAt)&&c.id!==r.choiceId);
  const job=rows(state,'jobs').find(j=>j.id===r.jobId),round=rows(state,'collaborationRounds').find(c=>c.jobId===r.jobId);
  const reviewed=round?.stages?.length===4&&round.stages.every(s=>s.status==='Concluída');
  return {...r,status:next?'Nova decisão registrada':reviewed?'Avaliação concluída':job?.status==='Falhou'?'Falha na coleta':state.paused?'Aguardando retomada':'Reavaliação solicitada'};
 });
}
export function reopenDecision(state,input,ownerId,now=Date.now()){
 const staged=structuredClone(state),result=reopen(staged,input,ownerId,now);Object.assign(state,staged);return result;
}
function reopen(state,input,ownerId,now){
 if(typeof ownerId!=='string'||!ownerId)throw Error('Dono autenticado obrigatório.');
 if(typeof input.clientId!=='string'||!input.clientId||input.clientId.length>150)throw Error('Identificador da solicitação inválido.');
 const existing=rows(state,'decisionReopens').find(r=>r.clientId===input.clientId);
 if(existing){if(existing.originChoiceId!==input.choiceId||existing.ownerId!==ownerId||existing.project!==input.project)throw Error('Identificador já usado por outra solicitação.');return existing;}
 if(state.paused)throw Error('Retome o escritório antes de solicitar uma reavaliação.');
 const origin=rows(state,'ownerChoices').find(c=>c.id===input.choiceId&&c.project===input.project);
 if(!origin||!state.config?.[origin.project])throw Error('Decisão não encontrada neste projeto.');
 if(isWarmupCampaign(origin.name)||isWarmupTarget(state,origin.project,'campaign',{adAccountId:origin.adAccountId,externalId:origin.objectId}))throw Error('Campanha de aquecimento/engajamento fora do fluxo de otimização de vendas.');
 const latest=rows(state,'ownerChoices').filter(c=>c.project===origin.project&&c.cardId===origin.cardId).at(-1);
 const proposals=rows(state,'proposals').filter(p=>p.project===origin.project&&p.payload?.level==='campaign'&&p.payload.adAccountId===origin.adAccountId&&p.payload.objectId===origin.objectId);
 const awaiting=e=>!(e.status==='Confirmada'&&Number.isFinite(Date.parse(e.confirmedAt))&&Date.parse(e.confirmedAt)<=now)&&(e.submittedAt||['Enviada','Verificação necessária'].includes(e.status));
 const journals=rows(state,'executions').filter(e=>(e.project||rows(state,'proposals').find(p=>p.id===e.proposalId)?.project)===origin.project);
 if(journals.some(awaiting)||proposals.some(p=>p.execution&&awaiting(p.execution)))throw Error('Aguarde a conferência da ação enviada antes de rever este cenário. Nenhum comando será repetido.');
 const duplicate=rows(state,'decisionReopens').find(r=>r.project===origin.project&&r.choiceId===latest.id);
 if(duplicate)return duplicate;
 if(rows(state,'decisionReopens').length>=500)throw Error('Limite de reavaliações atingido; preserve e exporte o histórico.');
 const at=new Date(now).toISOString();
 // Invalidate only unsent approvals/proposals. Keep sealed payloads, signatures,
 // old choices and all execution journals intact, including confirmed actions.
 for(const p of proposals){const es=[p.execution,...rows(state,'executions').filter(e=>e.proposalId===p.id)].filter(Boolean);if(es.some(e=>e.status==='Confirmada'))continue;if(['Em revisão','Aguardando aprovação','Aprovada'].includes(p.status)){p.status='Revisão solicitada';p.updatedAt=at;(p.reviews||=[]).push({id:crypto.randomUUID(),actor:'owner',actorId:ownerId,agentId:null,decision:'revise',comment:'Reavaliação solicitada pelo histórico. A autorização anterior não vale para um novo cenário.',version:p.version,signature:p.signature,createdAt:at,clientId:input.clientId+':withdraw'});}}
 const record={id:crypto.randomUUID(),clientId:input.clientId,ownerId,project:origin.project,cardId:origin.cardId,objectId:origin.objectId,adAccountId:origin.adAccountId,choiceId:latest.id,originChoiceId:origin.id,createdAt:at,jobId:null};
 const pending=rows(state,'jobs').find(j=>j.project===origin.project&&(j.status==='Pendente'||j.status==='Em análise'&&Date.parse(j.startedAt)<=now&&now-Date.parse(j.startedAt)<45*60000));
 if(pending)record.jobId=pending.id;
 else if(shouldQueueChoiceReview(state,{project:origin.project,status:'Pendente de revisão'},false,now)){
  const job={id:crypto.randomUUID(),project:origin.project,status:'Pendente',createdAt:at,note:`Reavaliar decisão ${latest.id} da campanha ${origin.objectId}. Consultar quatro períodos, hierarquia e últimas edições. Não restaurar valores antigos nem executar sem nova aprovação exata.`};
  (state.jobs||=[]).unshift(job);record.jobId=job.id;
 }
 if(!record.jobId)throw Error('Há uma ação pendente de conferência neste projeto. Aguarde antes de solicitar nova análise.');
 state.decisionReopens=[...rows(state,'decisionReopens'),record];return record;
}
