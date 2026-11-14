import {requestReviewBatch} from './review-pipeline.mjs';
import {loadMeasurementsForAction,releaseLoadedMeasurements} from './measurement-archive.mjs';
import {recordIncident} from './campaign-incidents.mjs';
import {invalidateIncidentContext} from './campaign-reassessment.mjs';
import {apply} from './state';
import {ensureCollaboration,collaborationPlan,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from './collaboration.mjs';
import {recordKnowledge,readKnowledgePlan,recordOutcome} from './knowledge.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution,monitorExecution,executionPlan} from './execution.mjs';
import {recordOwnerChoice,decisionLearningPlan,importDecisionHistory,linkChoiceProposal,recordCardSuggestion} from './decision-cards.mjs';
import {recordDecisionHistoryOutcome} from './decision-history-outcomes.mjs';
import {shouldQueueChoiceReview} from './decision-review-queue.mjs';
import {decisionLearningSummary} from './decision-learning-view.mjs';
import {reopenDecision} from './decision-reconsider.mjs';
import {learningCyclePlan,recordLearningReview} from './learning-cycle.mjs';
import {autonomousWorkPlan} from './autonomous-work.mjs';
import {requestLiveRefresh} from './owner-applied.mjs';

/** `opts.live`: the live campaign row the server read for an owner order (never taken from the request).
 * `opts.policy`: the parsed private Sombra policy (Worker secrets), for the owner's daily-budget ceiling. */
export function ownerAutonomy(state:any,input:any,ownerId:string,opts:{live?:any,policy?:any}={}){
 if(input.op==='reviewBatch')return requestReviewBatch(state,input,ownerId);
 if(['incidentReport','incidentUpdate'].includes(input.op)){const record=recordIncident(state,input,ownerId);invalidateIncidentContext(state,record);return record;}
 if(input.op==='cardReopen')return reopenDecision(state,input,ownerId);
 if(input.op==='cardDecision'){
  const existingIds=new Set((state.ownerChoices||[]).map((c:any)=>c.id));
  const record=recordOwnerChoice(state,input,ownerId,Date.now(),opts);
  const replay=existingIds.has(record.id);
  // A reviewed choice is a user-requested analysis. Do not fence an earlier
  // approved execution by queuing a successor before it has been reconciled.
  if(shouldQueueChoiceReview(state,record,replay))apply(state,{op:'job',project:record.project});
  // "Já fiz": re-read this project's live data on the next pulse so every screen reconciles it soon.
  if(record.appliedByOwner&&!replay)requestLiveRefresh(state,record.project);
  if(!replay){state.events.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),text:`${record.accountName} · ${record.name}: decisão de ${record.action} registrada; ${record.status.toLowerCase()}.`});state.events=state.events.slice(0,120);}
  return record;
 }
 if(input.op==='proposalReview')return reviewProposal(state,input,{kind:'owner',id:ownerId});
 if(input.op!=='collaborationRun')throw Error('Ação do dono não permitida.');
 if(!state.config[input.project])throw Error('Projeto não configurado.');
 if(state.paused)throw Error('Retome as revisões antes de iniciar.');
 const now=Date.now();
 const pending=state.jobs.find((j:any)=>j.project===input.project&&(j.status==='Pendente'||j.status==='Em análise'&&Number.isFinite(Date.parse(j.startedAt))&&Date.parse(j.startedAt)<=now&&now-Date.parse(j.startedAt)<45*60000));
 if(pending)return pending;
 apply(state,{op:'job',project:input.project});return state.jobs[0];
}

export function collaborationRead(state:any,args:any={}){
 const round=args.roundId?(state.collaborationRounds||[]).find((r:any)=>r.id===args.roundId):null;
 if(args.roundId&&!round)throw Error('Colaboração não encontrada.');
 if(args.action==='learningRead')return learningCyclePlan(state,args.projectId||round?.project);
 const workflow=collaborationPlan(state),blocked=round?workflow.rounds.find((r:any)=>r.roundId===round.id)?.blocked:null;
 const evidence=round&&!blocked?(state.snapshots||[]).filter((s:any)=>s.projectId===round.project&&round.sourceCut.some((c:any)=>c.period===s.period&&c.level===s.level)&&(!args.period||s.period===args.period)&&(!args.level||s.level===args.level)).map((s:any)=>{
  const rows=s.rows.filter((r:any)=>!args.objectId||r.externalId===args.objectId);
  return {...s,rows:rows.slice(0,50),rowCount:rows.length,truncated:rows.length>50};
 }):undefined;
 const execution=executionPlan(state);
 return {workflow,execution,learning:learningCyclePlan(state,round?.project),autonomous:autonomousWorkPlan(state,{collaboration:workflow,execution}),decisions:decisionLearningSummary(state,round?.project),knowledge:Object.keys(state.config).map(project=>readKnowledgePlan(state,project)),...(blocked?{evidenceBlocked:blocked}:{}),...(evidence?{evidence}:{} )};
}

/**
 * The MCP entry point of `agentAutonomy`. For an outcome action it first loads, from the cold archive of the same read,
 * only the archived measurements of the action's exact windows (lib/measurement-archive.mjs); afterwards it keeps loaded
 * only those a pin now needs. Every other action is unchanged. `fetch(keys)` → rows {key,payload}.
 */
export async function agentAutonomyWithArchive(state:any,args:any,fetch:(keys:string[])=>Promise<any[]>){
 const added=await loadMeasurementsForAction(state,args,fetch);
 const record=agentAutonomy(state,args);
 releaseLoadedMeasurements(state,added);
 return record;
}

export function agentAutonomy(state:any,args:any){
 const action=args.action;
 if(action==='cardSuggestion')return recordCardSuggestion(state,args);
 if(action==='decisionHistory')return importDecisionHistory(state,args);
 if(action==='decisionHistoryOutcome')return recordDecisionHistoryOutcome(state,args);
 if(action==='choiceProposal')return linkChoiceProposal(state,args);
 if(action==='ensure'){
  const job=state.jobs.find((j:any)=>j.id===args.jobId);if(!job)throw Error('Coleta não encontrada.');
  return ensureCollaboration(state,job);
 }
 if(action==='claim')return claimCollaboration(state,args);
 if(action==='message')return postCollaboration(state,args);
 if(action==='proposal')return submitProposal(state,args);
 if(action==='review'){
  const proposal=(state.proposals||[]).find((p:any)=>p.id===args.id);
  const claim=Object.values(proposal?.reviewClaims||{}).find((c:any)=>c.claimId===args.claimId&&c.executionRef===args.executionRef) as any;
  if(!claim)throw Error('Reserva de revisão não encontrada.');
  return reviewProposal(state,args,{kind:'agent',agentId:claim.agentId});
 }
 if(action==='learningReview')return recordLearningReview(state,args);
 if(action==='knowledge')return recordKnowledge(state,args.entry);
 if(action==='outcome')return recordOutcome(state,args.entry);
 if(action==='executionClaim')return claimExecution(state,args);
 if(action==='executionPrepare')return prepareExecution(state,args);
 if(action==='executionSubmit')return submitExecution(state,args);
 if(action==='executionConfirm')return confirmExecution(state,args);
 if(action==='executionFail')return failExecution(state,args);
 if(action==='executionMonitor')return monitorExecution(state,args);
 throw Error('Operação de colaboração não permitida.');
}
