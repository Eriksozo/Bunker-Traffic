import {isManualDecision} from './decision-intent.mjs';
import {buildDecisionCards} from './decision-cards.mjs';
import {campaignLiveDrift} from './campaign-live-context.mjs';
import {storage} from './storage';
import {readState} from './state';
import {liveDataAction,readLiveData} from './live-data.mjs';
import hosting from '../.openai/hosting.json';
import {decisionContingency,riskIncreasing} from './decision-contingency.mjs';
import {assertFinancialSources} from './analysis-validation.mjs';
import {liveOrderRow} from './owner-order-live.mjs';

export async function readLiveState(){
 const {state}=await readState();return {...await readLiveData(storage(),state),siteProjectId:hosting.project_id};
}
export async function updateLiveState(input:Record<string,unknown>,state?:unknown){
 const configuredState=state??(await readState()).state;
 return {...await liveDataAction(storage(),configuredState,input),siteProjectId:hosting.project_id};
}

/** Cache is not evidence for analysis or approval. A newer divergent native
 * state can only veto a stale choice until a full reread has been completed. */
export async function assertCurrentDecisionContext(state:any,input:any){
 // Recording feedback never authorizes a provider command. Identity and the
 // exact displayed source seal are still checked by recordOwnerChoice.
 if(isManualDecision(input))return;
 if(input.op!=='cardDecision'&&!(input.op==='proposalReview'&&input.decision==='approve'))return;
 const proposal=input.op==='proposalReview'||input.op==='cardDecision'&&input.approveExact?(state.proposals||[]).find((p:any)=>p.id===(input.op==='proposalReview'?input.id:input.proposalId)):null;
 const project=input.project||proposal?.project;if(!project)return;
 if(proposal)assertFinancialSources(proposal.payload?.sourceCut);
 const cards=buildDecisionCards(state,project),card=cards.find((c:any)=>input.op==='cardDecision'?c.id===input.cardId:c.row.externalId===proposal?.payload.objectId&&c.row.adAccountId===proposal?.payload.adAccountId);
 const latest=await readLiveData(storage(),state,project);
 // Owner direct order: the server-read live row is its source; a drift from the older analysis is expected,
 // so only the contingency below applies (the executor re-reads Malva before sending).
 if(input.op==='cardDecision'&&input.ownerOrder===true&&card){
  const live=liveOrderRow(latest.items,project,card.row.adAccountId,card.row.externalId);
  const guard=decisionContingency({state,project,row:live?.row||card.row,proposal:null,action:input.choice||'keep',percent:input.percent,liveItems:latest.items});
  if(guard.blocked)throw Error('Contingência: '+guard.blockers.join(' '));
  return {live};
 }
 const drift=card?campaignLiveDrift(card,latest.items):null;
 if(drift)throw Error(drift.kind==='native'?'O status ou orçamento mudou na plataforma. Aguarde uma nova análise antes de registrar outra decisão.':'O cenário de desempenho mudou ou a análise venceu. Aguarde a releitura e os novos pareceres antes de decidir.');
 const row=card?.row||(state.snapshots||[]).find((s:any)=>s.projectId===project&&s.period==='today'&&s.level===proposal?.payload?.level)?.rows.find((r:any)=>r.adAccountId===proposal?.payload?.adAccountId&&r.externalId===proposal?.payload?.objectId);
 if(!row)return;
 const guard=decisionContingency({state,project,row,proposal,action:input.choice||'keep',percent:input.percent,liveItems:latest.items});
 if(guard.blocked)throw Error('Contingência: '+guard.blockers.join(' '));
}

/** Live cache can veto an unsafe dispatch, never authorize one. Submitted
 * retries and confirmations always retain verification-only semantics. */
export async function assertCurrentExecutionContingency(state:any,args:any){
 if(!['executionPrepare','executionSubmit'].includes(args.action))return;
 const execution=(state.executions||[]).find((e:any)=>e.id===args.id);if(!execution||execution.submittedAt)return;
 const proposal=(state.proposals||[]).find((p:any)=>p.id===execution.proposalId);if(!proposal)return;
 const p=proposal.payload,latest=await readLiveData(storage(),state,proposal.project).catch(()=>{if(riskIncreasing(proposal))throw Error('Contingência: acompanhamento indisponível antes de ampliar exposição.');return {items:[]};});
 const source=p.level==='campaign'?latest.items[0]?.snapshot:(state.snapshots||[]).find((s:any)=>s.projectId===proposal.project&&s.period==='today'&&s.level===p.level);
 const row=source?.rows.find((r:any)=>r.adAccountId===p.adAccountId&&r.externalId===p.objectId)||{};
 const guard=decisionContingency({state,project:proposal.project,row,proposal,executionId:execution.id,liveItems:latest.items});
 if(guard.blocked)throw Error('Contingência: '+guard.blockers.join(' '));
}
