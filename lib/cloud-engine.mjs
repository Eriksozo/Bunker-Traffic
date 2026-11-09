import {safeModelFailure} from './cloud-model-diagnostics.mjs';
import {safeMemoryReviewFailure} from './memory-review-failure.mjs';
import {failOwnerQuestion,countsTowardOwnerQuestionLimit} from './owner-question-limit.mjs';
import {registerAgentHypothesis} from './automatic-agent-hypotheses.mjs';
import {liveCollectionLease} from './collection-lease.mjs';
import {cloudPacketProfile} from './cloud-packet-economy.mjs';
import {cloudReviewFocus,scopeCloudReviewContext} from './cloud-review-focus.mjs';
import {systemRoundEligibility,closeSystemRound} from './empty-round-review.mjs';
import {collectionFailure,preserveCollectionFailure} from './cloud-failure-diagnostics.mjs';
import {campaignCoveragePolicy,normalizeCampaignReadings} from './campaign-learning-coverage.mjs';
import {autonomousLearningPlan,processAutonomousLearning} from './learning-outcomes.mjs';
import {creativeLearningContext} from './creative-learning-context.mjs';
import {contingencyPlan,contingencyObservation} from './decision-contingency.mjs';
import {monitorExecution} from './execution.mjs';
import {duePlan} from './cadence.mjs';
import {collaborationPlan,claimCollaboration,postCollaboration,submitProposal,reviewProposal,fingerprint,isLiveOrder} from './collaboration.mjs';
import {executionPlan,claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution} from './execution.mjs';
import {autonomousWorkPlan} from './autonomous-work.mjs';
import {recordCardSuggestion,buildDecisionCards} from './decision-cards.mjs';
import {collectCloudProject,cloudRanges,trackedCloudCampaigns} from './cloud-collector.mjs';
import {normalizeAgentReflection} from './agent-development.mjs';
import {learningPeerPacket,persistLearningPeerReview} from './learning-peer-review.mjs';
import {collectHistoryLearning,storeHistoryCollection,historyLearningKey} from './cloud-history-learning.mjs';
import {collectExternalLearning,persistExternalLearning} from './external-learning.mjs';
import {enrollProposalLearning,proposalLearningEnrollment} from './learning-enrollment.mjs';
import {validateResearchDetail} from './cloud-research.mjs';
import {cloudFocus,cloudEvidence,cloudAnalysisContext,runCloudAnalyst,suggestionShapeFailure,droppedSuggestion} from './cloud-analysis.mjs';
import {CloudError} from './cloud-malva.mjs';
const clone=x=>structuredClone(x),uid=()=>crypto.randomUUID(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const findRound=(s,id)=>s.collaborationRounds?.find(r=>r.id===id);
/** `only`: the fast lane's kinds (verify/followUp/execution); returns the first ready unit of those kinds, else null.
 * `skip`: the heavy pulse leaves those kinds to the fast lane, so one order never has two workers in the same object.
 * @param {any} state @param {any[]} [items] @param {number} [at] @param {{only?:readonly string[]|null,skip?:readonly string[]|null}} [opts] */
/** Short label of whether the Sombra reading reached this analyst (runtime history; the full receipt stays on the message). */
const sombraDelivery=inputs=>{const s=inputs?.shadowLearning;if(!s)return null;return s.delivered?(s.shortened?'encurtada':'entregue'):s.deferred?'adiada (pacote cheio)':'indisponível';};

export function cloudNext(state,items=[],at=Date.now(),{only=null,skip=null}={}){
 const collection=duePlan(state,new Date(at)),plan=autonomousWorkPlan(state,{...collection,contingency:contingencyPlan(state,items,at),collaboration:collaborationPlan(state,at),execution:executionPlan(state,at)},at);
 // A submitted command is verification-only regardless of actor. Live claims owned by other workers stay untouched.
 const ready=plan.ready.filter(w=>w.kind!=='collection'&&!skip?.includes(w.kind)&&(w.kind!=='ownerQuestion'||state.collaborationRounds?.some(r=>r.project===w.project)&&state.snapshots?.some(c=>c.projectId===w.project&&c.period==='today'&&at-Date.parse(c.fetchedAt)<3600000))); ready.sort((a,b)=>{if(a.kind!=='stage'||b.kind!=='stage')return 0;const ar=findRound(state,a.roundId),br=findRound(state,b.roundId);return (br?.stages.filter(x=>x.status==='Concluída').length||0)-(ar?.stages.filter(x=>x.status==='Concluída').length||0)||Date.parse(ar?.createdAt||0)-Date.parse(br?.createdAt||0);});if(only)return ready.find(w=>only.includes(w.kind))||null;if(ready.length&&['verify','followUp','execution','ownerQuestion'].includes(ready[0].kind))return ready[0];
 if(ready.length&&ready[0].kind!=='stage')return ready[0];
 const job=!state.paused&&state.jobs?.filter(j=>j.executor==='cloudflare'&&j.status==='Em análise'&&state.agents?.[j.project]?.jobId===j.id).sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||(Date.parse(state.agents?.[a.project]?.lastSuccessAt||'')||0)-(Date.parse(state.agents?.[b.project]?.lastSuccessAt||'')||0)||String(a.id).localeCompare(String(b.id)))[0];
 // Already admitted source jobs must not spend their finite lease behind repeated model stages.
 // New due projects are still admitted atomically before any collection starts.
 if(job)return collection.due.length?{kind:'admit',projects:collection.due.map(p=>p.project)}:{kind:'collectJob',project:job.project,jobId:job.id};
 if(!state.paused&&autonomousLearningPlan(state,null,at).ready.length)return {kind:'learning'};
 if(ready.length)return ready[0];
 return collection.due.length?{kind:'admit',projects:collection.due.map(p=>p.project)}:null;
}
/** No renewal, takeover or network call. Expired admitted jobs require a new eligible reservation. */
export function assertCloudCollectionReservation(state,jobId,at=Date.now()){
 const job=state.jobs?.find(j=>j.id===jobId);
 if(state.paused||job?.executor!=='cloudflare'||job.status!=='Em análise'||state.agents?.[job.project]?.jobId!==job.id||!state.config?.[job.project])throw new CloudError('CLOUD_CLAIM_CHANGED');
 if(!Number.isFinite(at)||!Number.isFinite(Date.parse(job.startedAt))||Date.parse(job.startedAt)>at)throw new CloudError('CLOUD_COLLECTION_LEASE_INVALID');
 if(!liveCollectionLease(job,at))throw new CloudError('CLOUD_COLLECTION_LEASE_EXPIRED');
 return job;
}
export function cloudProposalPayload(suggestion,row,refs,opinions){
 const before={dailyBudget:row.dailyBudget},after={dailyBudget:Math.round(row.dailyBudget*(1+(suggestion.action==='increase'?1:-1)*suggestion.percent/100)*100)/100};
 if(['increase','reduce'].includes(suggestion.action)&&(!Number.isFinite(row.dailyBudget)||row.dailyBudget<=0||row.lifetimeBudget>0||!Number.isFinite(suggestion.percent)||after.dailyBudget<=0))throw new CloudError('CLOUD_PROPOSAL_INVALID');
 return {title:row.accountName+' · '+(suggestion.action==='pause'?'Pausar campanha':(suggestion.action==='increase'?'Aumentar ':'Reduzir ')+suggestion.percent+'%'),reason:suggestion.reason,action:suggestion.action==='pause'?'status':'budget',level:'campaign',provider:'meta',adAccountId:row.adAccountId,objectId:row.externalId,currency:row.budgetCurrency,budgetOwner:'CBO',before:suggestion.action==='pause'?{status:row.status}:before,after:suggestion.action==='pause'?{status:'PAUSED'}:after,evidenceRefs:refs.filter(r=>r.externalId===row.externalId&&r.adAccountId===row.adAccountId),opinionRefs:opinions,risks:['Executar somente a versão exata aprovada. Reconfirmar aquisição, última edição, orçamento e status antes do envio.']};
}
/** Why this target cannot take this suggestion now, or null. Mirrors the card and proposal guards so the item is
 * dropped with a code instead of aborting the OPS stage. A missing card stays an integrity error downstream. */
export function cloudSuggestionBlock(suggestion,card){
 const shape=suggestionShapeFailure(suggestion);if(shape)return shape;if(suggestion.action==='keep'||!card)return null;const row=card.row;
 if(suggestion.action==='pause')return row.status!=='ACTIVE'?'not_active':card.actionable.pause?null:'source_not_actionable';
 if(!Number.isFinite(row.dailyBudget)||row.dailyBudget<=0||row.lifetimeBudget>0)return 'no_own_daily_budget';
 if(!card.actionable[suggestion.action])return 'source_not_actionable';
 const after=Math.round((row.dailyBudget*(1+(suggestion.action==='increase'?1:-1)*suggestion.percent/100)+Number.EPSILON)*100)/100;
 return after<=0||after>1e9||after===row.dailyBudget?'budget_change_not_representable':null;
}
/** No provider retry exists in this function. A lost submit response cannot reach dispatch. */
export async function cloudDispatch({write,source,prepareGuard,proposal,readObservation,executionRef}){
 const e=await write(s=>claimExecution(s,{proposalId:proposal.id,version:proposal.version,signature:proposal.signature,executionRef,clientId:'cloud-claim:'+uid()}));
 const observation=await readObservation(proposal);
 const prepared=await write(async s=>{await prepareGuard(s,{action:'executionPrepare',id:e.id});return prepareExecution(s,{id:e.id,claimId:e.claimId,executionRef,clientId:'cloud-prepare:'+uid(),observation});});
 const submitted=await write(async s=>{await prepareGuard(s,{action:'executionSubmit',id:e.id});return submitExecution(s,{id:e.id,claimId:e.claimId,executionRef,clientId:'cloud-submit:'+uid()});});
 if(submitted.dispatchGranted!==true)return {status:'verificationOnly'};
 try{await source.dispatch(prepared.command,{id:e.id,submitClientId:submitted.execution.submitClientId});}
 catch{await write(s=>failExecution(s,{id:e.id,claimId:e.claimId,executionRef,clientId:'cloud-failure:'+uid(),reason:'O envio não teve confirmação de resposta. Somente conferir a plataforma; não reenviar.'}));return {status:'verificationOnly'};}
 try{const observed=await readObservation(proposal);await write(s=>confirmExecution(s,{id:e.id,executionRef,clientId:'cloud-confirm:'+uid(),observation:observed}));return {status:'confirmed'};}
 catch{await write(s=>failExecution(s,{id:e.id,claimId:e.claimId,executionRef,clientId:'cloud-failure:'+uid(),reason:'A leitura posterior não confirmou o valor aprovado. Conferência pendente, sem reenvio.'}));return {status:'verificationOnly'};}
}
/** Only the worker that owns a claim may record its failed generation. Never turn failure into a conclusion. */
export function failCloudOpinion(state,{roundId,agentId,claimId,executionRef,proposalId,replyTo},code,at=Date.now(),readingFailure=null,modelFailure=null,memoryReviewFailure=null){
 const round=findRound(state,roundId);const target=proposalId?state.proposals?.find(p=>p.id===proposalId)?.reviewClaims?.[agentId]:replyTo?round?.discussionClaims?.[agentId]:round?.stages.find(s=>s.agentId===agentId);
 if(!target||target.claimId!==claimId||target.executionRef!==executionRef||target.status!=='Em análise')throw new CloudError('CLOUD_CLAIM_CHANGED');
 state.cloudAttemptFailures||={};const safeReading=readingFailure&&['duplicate_citation','citation_not_in_packet','numeric_citation_required','child_citation_required','missing_numbers_require_investigate'].includes(readingFailure.reason)&&state.snapshots?.some(s=>s.projectId===round.project&&s.level==='campaign'&&s.rows?.some(r=>r.adAccountId===readingFailure.adAccountId&&r.externalId===readingFailure.externalId))?{adAccountId:readingFailure.adAccountId,externalId:readingFailure.externalId,reason:readingFailure.reason}:null;
 const safeModel=code==='CLOUD_AI_INVALID'?safeModelFailure(modelFailure):null,safeMemory=code==='CLOUD_MEMORY_REVIEW_EVIDENCE'?safeMemoryReviewFailure(memoryReviewFailure):null;
 state.cloudAttemptFailures[claimId]={roundId,agentId,claimId,executionRef,code,at:new Date(at).toISOString(),attempt:target.attempt,...(proposalId?{proposalId}:{}),...(replyTo?{replyTo}:{}),...(safeReading?{readingFailure:safeReading}:{}),...(safeModel?{modelFailure:safeModel}:{}),...(safeMemory?{memoryReviewFailure:safeMemory}:{})};
 target.status='Falhou';target.leaseUntil=new Date(at).toISOString();target.failedAt=new Date(at).toISOString();target.failureCode=code;return {claimId,status:'Falhou'};
}
export function createCloudEngine({read,write,source,ai,ops,modelPolicy='legacy',prepareGuard=async(_state,_args)=>{},now=Date.now}){
 async function identity(){const who=await source.read('workspace_whoami',{});if(!who.workspace?.id||!who.platforms?.some(p=>p.platform==='tracking'&&p.read))throw new CloudError('CLOUD_MALVA_IDENTITY');const projects=await source.read('tracking_list_projects',{});if(!Array.isArray(projects.items))throw new CloudError('CLOUD_MALVA_IDENTITY');return {who,projects:projects.items};}
 async function observation(p){
  // An owner live order carries the Malva internal id it was approved for; it may be absent from the analysis.
  const lt=isLiveOrder(p)&&p.payload.liveTarget?.id?{id:p.payload.liveTarget.id,externalId:p.payload.objectId,adAccountId:p.payload.adAccountId}:null;
  const state=lt?null:(await read()).state,snapshot=state?.snapshots.find(s=>s.projectId===p.project&&s.period==='today'&&s.level===p.payload.level),target=lt||snapshot?.rows.find(r=>r.externalId===p.payload.objectId&&r.adAccountId===p.payload.adAccountId);if(!target?.id)throw new CloudError('CLOUD_TARGET_MISSING');
  const fetchOne=async(level,id,externalId,account)=>{const detail=await source.read('tracking_ad_detail',{projectId:p.project,objectId:id,sales:'traffic',preset:'today'}),r=detail.row;if(!r||r.id!==id||r.externalId!==externalId||r.adAccountId!==account||r.level!==level||r.provider!=='meta')throw new CloudError('CLOUD_TARGET_IDENTITY');return {source:'Malva MCP',complete:true,projectId:p.project,level,fetchedAt:new Date(now()).toISOString(),from:detail.period?.from,to:detail.period?.to,timezone:detail.period?.timezone,metricsCurrency:detail.currency,rows:[r]};};
  const o=await fetchOne(p.payload.level,target.id,target.externalId,target.adAccountId),b=p.payload.activationBudget;if(b&&!(b.level===p.payload.level&&b.externalId===target.externalId))o.budgetOwner=await fetchOne(b.level,b.id,b.externalId,b.adAccountId);return o;
 }
 /** @param {{only?:readonly string[]|null,skip?:readonly string[]|null}} [opts] fast lane: only these kinds (no model call); heavy pulse: skip them */
 async function step({only=null,skip=null}={}){
  // Distinct model units retain distinct authorship even within the same alarm.
  const executionRef='cloudflare:'+uid();
  const current=await read(),s=current.state,work=cloudNext(s,ops.liveItems?await ops.liveItems(s):[],now(),{only,skip});if(!work)return {kind:'idle',paused:!!s.paused};
  if(work.kind==='verify'){
   const e=s.executions.find(e=>e.id===work.executionId),p=s.proposals.find(p=>p.id===e.proposalId);if(!p)return {kind:'blocked',reason:'Proposta de conferência ausente.'};
   const o=await observation(p);await write(st=>confirmExecution(st,{id:e.id,executionRef,clientId:'cloud-verify:'+uid(),observation:o}));return {kind:'verify',project:p.project,confirmed:true};
  }
  if(s.paused)return {kind:'idle',paused:true};
  if(work.kind==='learning')return write(st=>processAutonomousLearning(st,now()));
  if(work.kind==='followUp'){
   const items=await ops.liveItems(s),o=contingencyObservation(s,items,work.executionId);if(!o)return {kind:'blocked',reason:'Sem leitura nova para acompanhar a execução.'};
   await write(st=>monitorExecution(st,{id:work.executionId,executionRef,clientId:'cloud-monitor:'+uid(),entry:{checkpointMinutes:work.checkpointMinutes},observation:o}));return {kind:'followUp',project:work.project,checkpointMinutes:work.checkpointMinutes};
  }
  if(work.kind==='execution'){
   const p=s.proposals.find(p=>p.id===work.proposalId);const who=await identity();if(!who.who.platforms.some(p=>p.platform==='tracking'&&p.ads))throw new CloudError('CLOUD_MALVA_ADS_REQUIRED');
   return {kind:'execution',project:p.project,...await cloudDispatch({write,source,prepareGuard,proposal:p,readObservation:observation,executionRef})};
  }
  if(work.kind==='admit'){
   const ids=await identity();
   const out=await write((st,revision)=>{
    // Identity I/O may cross a retry boundary or the end of an admission window.
    // Recompute priority and the complete batch against the commit-time state and one clock.
    const at=now(),currentWork=cloudNext(st,[],at);if(currentWork?.kind!=='admit')return [];
    for(const project of currentWork.projects)if(!ids.projects.some(p=>p.id===project&&p.name===st.config[project]?.projectName))throw new CloudError('CLOUD_MALVA_IDENTITY');
    const r=ops.claimBatch(st,currentWork.projects,revision,new Date(at));for(const j of r.jobs)j.executor='cloudflare';return r.jobs.map(j=>({id:j.id,project:j.project}));
   });return out.length?{kind:'admit',jobs:out}:{kind:'idle',reason:'A elegibilidade mudou antes da reserva; fila atual preservada.'};
  }
  if(work.kind==='collectJob'){
   const job=s.jobs.find(j=>j.id===work.jobId);let phase='reservation';
   try{
    assertCloudCollectionReservation(s,job.id,now());phase='identity';
    const id=await identity(),project=id.projects.find(p=>p.id===job.project&&p.name===s.config[job.project].projectName);if(!project)throw new CloudError('CLOUD_MALVA_IDENTITY');
    phase='reservation';const collectionState=(await read()).state;assertCloudCollectionReservation(collectionState,job.id,now());
    if(collectionState.config?.[job.project]?.projectName!==project.name)throw new CloudError('CLOUD_MALVA_IDENTITY');
    const selected=cloudNext(collectionState,[],now());if(selected?.kind!=='collectJob'||selected.jobId!==job.id)return {kind:'deferred',project:project.id,reason:'A prioridade mudou antes da coleta; reserva e fontes preservadas.'};
    phase='campaigns';
    const bundle=await collectCloudProject(source,project,{now,startedAt:job.startedAt,tracked:trackedCloudCampaigns(collectionState,project.id)});
    // Research candidates are explicit. No claim that every collected object was individually reviewed by an LLM.
    const draft=clone(collectionState);draft.snapshots=draft.snapshots.filter(c=>c.projectId!==project.id).concat(bundle.snapshots);const focus=cloudFocus(draft,project.id),details=[],historyCollections=[];
    phase='research';
    for(const row of focus){
     assertCloudCollectionReservation(collectionState,job.id,now());
     const [collectedHistory,detail,today]=await Promise.all([collectHistoryLearning(source,project,row,collectionState.historyLearning?.scopes?.[historyLearningKey(project.id,row.adAccountId,row.externalId)],{now}),source.read('tracking_ad_detail',{projectId:project.id,objectId:row.id,sales:'traffic',preset:'14d'}),source.read('tracking_ad_detail',{projectId:project.id,objectId:row.id,sales:'traffic',preset:'today'})]);
     const history=collectedHistory.research;history.timezone=project.timezone;historyCollections.push(collectedHistory);
     validateResearchDetail(detail,row,project);validateResearchDetail(today,row,project);
     if(!Array.isArray(history.items)||history.timezone!==project.timezone||today.period.days?.length!==1||today.period.days[0]!==cloudRanges(now(),project.timezone).today.from)throw new CloudError('SOURCE_RESEARCH_IDENTITY');
     const ordered=history.items.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),retained=new Set(ordered.slice(0,20));
     for(const category of ['budget','status','creative']){const latest=ordered.find(e=>e.category===category);if(latest)retained.add(latest);}
     const items=ordered.filter(e=>retained.has(e));
     details.push({adAccountId:row.adAccountId,externalId:row.externalId,history:{items,returnedCount:history.items.length,nextCursor:history.nextCursor||null,truncated:history.items.length>items.length||!!history.nextCursor},detail:{daily:detail.daily,dailyRange:detail.dailyRange,period:detail.period,currency:detail.currency,intraday:{hourly:Array.isArray(today.hourly)?today.hourly:null,hourlySpend:today.hourlySpend,period:today.period,currency:today.currency,fetchedAt:new Date(now()).toISOString()}}});
    }
    phase='learning';
    assertCloudCollectionReservation(collectionState,job.id,now());
    for(const history of historyCollections)storeHistoryCollection(draft,history,now());
    const externalLearning=await collectExternalLearning(source,draft,project,{now});
    const research={jobId:job.id,focusPolicy:campaignCoveragePolicy.version,collectedAt:new Date(now()).toISOString(),scope:bundle.scope,sourceCalls:bundle.sourceCalls,focus:focus.map(r=>({adAccountId:r.adAccountId,externalId:r.externalId})),details};
    if(new TextEncoder().encode(JSON.stringify(research)).length>350000)throw new CloudError('CLOUD_CONTEXT_LIMIT');
    phase='persist';
    const committed=await write(st=>{const j=assertCloudCollectionReservation(st,job.id,now()),selected=cloudNext(st,[],now());if(selected?.kind!=='collectJob'||selected.jobId!==job.id)return null;const historyResults=historyCollections.map(h=>storeHistoryCollection(st,h,now()));ops.importBundle(st,bundle);const externalResult=persistExternalLearning(st,externalLearning,now());st.cloudResearch||={};st.cloudResearch[project.id]={...research,historyLearning:historyResults,externalLearning:externalResult};ops.updateRun(st,j,'Concluída',`Coleta Cloudflare: ${bundle.snapshots.length} fontes, 4 períodos e 3 níveis. ${focus.length} campanhas priorizadas para leitura individual; demais objetos coletados não receberam parecer individual nesta unidade.`);return j.id;});
    if(!committed)return {kind:'deferred',project:project.id,reason:'A prioridade mudou antes da gravação; reserva e fontes preservadas.'};
    return {kind:'collection',project:project.id,sources:bundle.snapshots.length,prioritized:focus.length};
   }catch(error){const diagnostic=collectionFailure(error,{project:job.project,jobId:job.id,phase},now());await write(st=>{preserveCollectionFailure(st,diagnostic);const j=st.jobs.find(j=>j.id===job.id);if(j?.status==='Em análise'&&st.agents[j.project]?.jobId===j.id)ops.updateRun(st,j,'Falhou','A coleta Cloudflare não confirmou todas as fontes: '+diagnostic.code+' · etapa '+diagnostic.phase);return null;});const failure=new CloudError(diagnostic.code);failure.collectionFailure=diagnostic;throw failure;}
  }
  if(work.kind==='ownerQuestion'){
   const m=s.messages.find(m=>m.id===work.messageId),round=s.collaborationRounds?.find(r=>r.project===work.project);if(!round)return {kind:'blocked',reason:'A pergunta aguarda fontes da próxima rodada.'};
   const context=cloudAnalysisContext(s,round,cloudFocus(s,work.project),work.agentId,now());context.ownerQuestion=m.text;
   const shadowLearning=ops.shadowLearning?await ops.shadowLearning(s,work.project).catch(()=>null):null;if(shadowLearning)context.shadowLearning=shadowLearning;let out;try{out=await runCloudAnalyst(ai,work.agentId,context,modelPolicy);}catch(error){if(countsTowardOwnerQuestionLimit(error?.code))await write(st=>failOwnerQuestion(st,m.id,work.project,round.id,error.code,now(),error.modelFailure));throw error;}await write(st=>ops.answer(st,m.id,out.text));return {kind:'ownerQuestion',project:work.project};
  }
  if(['stage','discussion','review'].includes(work.kind)){
   const round=findRound(s,work.roundId);if(!round)throw new CloudError('CLOUD_ROUND_MISSING');
   if(work.kind==='stage'&&systemRoundEligibility(s,round,now()))return {kind:'systemReview',...await write(st=>closeSystemRound(st,round.id,now()))};
   const role=work.agentId,claimArgs={roundId:round.id,agentId:role,executionRef,clientId:'cloud-'+work.kind+':'+uid(),...(work.proposalId?{proposalId:work.proposalId}:{}),...(work.replyTo?{replyTo:work.replyTo}:{})};
   const claim=await write(st=>claimCollaboration(st,claimArgs,now())),latest=(await read()).state;
   let focus=cloudFocus(latest,round.project),context=cloudAnalysisContext(latest,findRound(latest,round.id),focus,role,now()),retryAfter=null;
   if(work.kind==='stage'){context.learningReview=learningPeerPacket(latest,round.project,role,now());context.campaignReviewPolicy=campaignCoveragePolicy;const prior=Object.values(latest.cloudAttemptFailures||{}).filter(f=>f.roundId===round.id&&f.agentId===role&&!f.proposalId&&!f.replyTo).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
    // Only the attempt right after a recorded cut changes sampling (never the token cap); the signal stays out of the packet.
    if(prior?.code==='CLOUD_AI_INVALID'&&safeModelFailure(prior.modelFailure)?.reason==='output_truncated'&&prior.attempt===claim.attempt-1)retryAfter='output_truncated';
    if(prior)context.validationFeedback={code:prior.code,readingFailure:prior.readingFailure||null,modelFailure:prior.code==='CLOUD_AI_INVALID'?safeModelFailure(prior.modelFailure):null,memoryReviewFailure:prior.code==='CLOUD_MEMORY_REVIEW_EVIDENCE'?safeMemoryReviewFailure(prior.memoryReviewFailure):null,rule:'Tentativa recusada; corrigir com as fontes atuais. Não é aprendizado financeiro validado nem autorização.'};}
   const creative=ops.creativeItems?await ops.creativeItems(latest,round.project).catch(()=>({items:[],error:'Órbita indisponível nesta leitura.'})):{items:[],error:'Leitura Órbita não configurada no executor.'};
   context.creativeContext=creativeLearningContext(latest,round.project,creative,focus,now());
   // What the Sombra learned (scores, team patterns, open proposals): a reading for the analysts, never an instruction.
   const shadowLearning=ops.shadowLearning?await ops.shadowLearning(latest,round.project).catch(()=>null):null;if(shadowLearning)context.shadowLearning=shadowLearning;
   if(work.proposalId){context.proposal=latest.proposals.find(p=>p.id===work.proposalId);context.proposalLearning=proposalLearningEnrollment(latest,context.proposal,now());}if(work.replyTo)context.receivedQuestion=latest.collaborationMessages.find(m=>m.id===work.replyTo);
   let out,analyzedFocus,inputProfile;try{
    if(work.kind==='review'){
     const requested=focus.length,p=context.proposal,learning=context.proposalLearning;
     focus=cloudReviewFocus(latest,round.project,focus,p);context=scopeCloudReviewContext(cloudAnalysisContext(latest,findRound(latest,round.id),focus,role,now()),p,requested,latest);context.campaignReviewPolicy=campaignCoveragePolicy;
     context.creativeContext=creativeLearningContext(latest,round.project,creative,focus,now());context.proposal=p;context.proposalLearning=learning;if(shadowLearning)context.shadowLearning=shadowLearning;
    }
    inputProfile=cloudPacketProfile(context);out=await runCloudAnalyst(ai,role,context,modelPolicy,{retryAfter});analyzedFocus=focus.filter(r=>out.analysisTargets.some(c=>c.adAccountId===r.adAccountId&&c.externalId===r.externalId));normalizeCampaignReadings(out.campaignReadings,{state:latest,round:findRound(latest,round.id),role,evidenceRefs:cloudEvidence(latest,round.project,analyzedFocus)});if(out.reflection)normalizeAgentReflection(out.reflection,{state:latest,round:findRound(latest,round.id),agentId:role,evidenceRefs:cloudEvidence(latest,round.project,analyzedFocus)});}catch(error){await write(st=>failCloudOpinion(st,{...claimArgs,claimId:claim.claimId},error.code||'CLOUD_AI_UNAVAILABLE',now(),error.readingFailure,error.modelFailure,error.memoryReviewFailure));error.attemptRecorded=true;throw error;}
   const refs=cloudEvidence(latest,round.project,analyzedFocus),base={roundId:round.id,claimId:claim.claimId,executionRef};
   if(!refs.length)throw new CloudError('CLOUD_EVIDENCE_MISSING');
   if(work.kind==='review'){
    const p=context.proposal,decision=work.mode==='requestRevision'?'revise':out.verdict||'revise',clientId='cloud-review:'+uid();
    await write(st=>{const reflection=out.reflection?normalizeAgentReflection(out.reflection,{state:st,round:findRound(st,round.id),agentId:role,evidenceRefs:refs}):null,saved=reviewProposal(st,{...base,id:p.id,version:p.version,signature:p.signature,decision,comment:out.text,clientId},{kind:'agent',agentId:role},now()),record=saved.reviews.find(r=>r.clientId===clientId);record.model={policy:out.modelPolicy,name:out.modelName};record.packetProfile={input:inputProfile,delivered:out.packetProfile};record.reviewScope=context.coverage.proposalReview;record.learningInputs=out.learningInputs;record.generationProfile=out.generationProfile;record.reviewTiming=context.reviewTiming;if(out.memoryReview)record.memoryReview=out.memoryReview;if(reflection)record.reflection=reflection;return saved;});return {kind:'review',project:round.project,agent:role,model:out.modelName,reviewedParents:analyzedFocus.length,packetBytes:out.packetProfile.transportBytes,shadowLearning:sombraDelivery(out.learningInputs)};
   }
   if(work.kind==='discussion'){
    const clientId='cloud-reply:'+uid();await write(st=>{const message=postCollaboration(st,{...base,kind:'message',replyTo:work.replyTo,toAgent:context.receivedQuestion.fromAgent,requiresReply:false,text:out.text,summary:{decision:out.decision,reason:out.reason,nextStep:out.nextStep},...(out.reflection?{reflection:out.reflection}:{}),evidenceRefs:refs,clientId},now());message.learningInputs=out.learningInputs;message.generationProfile=out.generationProfile;message.reviewTiming=context.reviewTiming;if(out.memoryReview)message.memoryReview=out.memoryReview;return message;});return {kind:'discussion',project:round.project,agent:role};
   }
   // An actual model call authored this contribution. Persist its role/model and source-scoped evidence.
   if(out.question&&out.question.toAgent!==role)await write(st=>postCollaboration(st,{...base,kind:'message',toAgent:out.question.toAgent,requiresReply:true,text:out.question.text,evidenceRefs:refs,clientId:'cloud-question:'+uid()},now()));
   const suggestionDrops=[...(out.suggestionDrops||[])];
   if(role==='ops'&&out.suggestions.length){
    const opinions=latest.collaborationMessages.filter(m=>m.roundId===round.id&&m.kind==='conclusion'&&['traffic','creative','budget'].includes(m.fromAgent)).map(m=>m.id);
    const rows=out.suggestions.map(suggestion=>{const row=focus.find(r=>r.adAccountId===suggestion.adAccountId&&r.externalId===suggestion.objectId);if(!row)throw new CloudError('CLOUD_AI_SCOPE');return row;});
    // One write for the whole list: a later failure can no longer leave earlier proposals behind for the retry to hit.
    try{suggestionDrops.push(...await write(st=>{
     normalizeCampaignReadings(out.campaignReadings,{state:st,round:findRound(st,round.id),role,evidenceRefs:refs});
     const cards=buildDecisionCards(st,round.project,now()),drops=[],seen=new Set();
     out.suggestions.forEach((suggestion,i)=>{
      const row=rows[i],{learning:enrollment,...financialSuggestion}=suggestion,target=fingerprint([row.adAccountId,row.externalId]),clientId='cloud-proposal:'+claim.claimId+':'+target;
      const blocked=cloudSuggestionBlock(suggestion,cards.find(c=>c.roundId===round.id&&c.row.adAccountId===row.adAccountId&&c.row.externalId===row.externalId));
      // Card and proposal ids are per claim and target, so a second item for the same campaign would abort the list.
      // A blocked item does not take the campaign's slot: a valid item for the same campaign may still follow.
      if(blocked){drops.push(droppedSuggestion(suggestion,blocked));return;}
      if(seen.has(target)){drops.push(droppedSuggestion(suggestion,'duplicate_target'));return;}seen.add(target);
      recordCardSuggestion(st,{...base,payload:{...financialSuggestion,opinionRefs:opinions},clientId:'cloud-suggestion:'+claim.claimId+':'+target},now());
      if(suggestion.action==='keep')return;
      // A retry (new claim) or an owner order may already hold this object/action in the round: keep it, do not collide.
      const existing=st.proposals.find(p=>p.roundId===round.id&&p.payload.adAccountId===row.adAccountId&&p.payload.objectId===row.externalId&&p.payload.action===(suggestion.action==='pause'?'status':'budget'));
      if(existing&&existing.clientId!==clientId){drops.push(droppedSuggestion(suggestion,'proposal_exists',{proposalId:existing.id,cardSuggestionRecorded:true}));return;}
      if(!existing&&st.proposals.filter(p=>p.roundId===round.id).length>=3)return;
      const payload=cloudProposalPayload(suggestion,row,refs,opinions);
      const p=submitProposal(st,{...base,payload,expiresAt:new Date(now()+30*60000).toISOString(),clientId},now());
      if(enrollment)enrollProposalLearning(st,{...base,entry:{project:round.project,proposalId:p.id,proposalVersion:p.version,proposalSignature:p.signature,...enrollment}},now());
     });
     return drops;
    }));}catch(error){
     if(/^CLOUD_LEARNING_/.test(error.code||''))await write(st=>{const stage=findRound(st,round.id)?.stages.find(x=>x.agentId===role);return stage?.claimId===claim.claimId&&stage.executionRef===executionRef&&stage.status==='Em análise'?failCloudOpinion(st,{...claimArgs,claimId:claim.claimId},error.code,now()):null;});
     throw error;
    }
   }
   const completed=await write(st=>{
    const result=persistLearningPeerReview(st,{...base,project:round.project,agentId:role},out.learningReview,context.learningReview,now());
    const message=postCollaboration(st,{...base,kind:'conclusion',toAgent:role==='ops'?'traffic':'ops',text:out.text,summary:{decision:out.decision,reason:out.reason,nextStep:out.nextStep},...(out.reflection?{reflection:out.reflection}:{}),...(out.campaignReadings?{campaignReadings:out.campaignReadings}:{}),evidenceRefs:refs,clientId:'cloud-conclusion:'+claim.claimId},now());
    message.packetProfile={input:inputProfile,delivered:out.packetProfile};
    message.model={policy:out.modelPolicy,name:out.modelName};
    message.learningInputs=out.learningInputs;message.generationProfile=out.generationProfile;message.reviewTiming=context.reviewTiming;
    if(out.memoryReview)message.memoryReview=out.memoryReview;
    if(suggestionDrops.length)message.suggestionDrops=suggestionDrops;
    message.analysisCoverage={requested:focus.length,reviewed:analyzedFocus.length,deferred:focus.filter(r=>!analyzedFocus.some(a=>a.adAccountId===r.adAccountId&&a.externalId===r.externalId)).map(r=>({adAccountId:r.adAccountId,externalId:r.externalId}))};
    if(out.evidenceSelections?.length)message.evidenceResolution={version:1,sourceHash:round.sourceHash,selected:out.evidenceSelections};
    message.automaticHypothesis=registerAgentHypothesis(st,message.id,now());
    return {learningReview:result,automaticHypothesis:message.automaticHypothesis};
   });
   return {kind:'stage',project:round.project,agent:role,model:out.modelName,prioritized:analyzedFocus.length,requestedTargets:focus.length,deferredTargets:focus.length-analyzedFocus.length,packetBytes:out.packetProfile.transportBytes,shadowLearning:sombraDelivery(out.learningInputs),...completed};
  }
  // Owner questions remain visibly pending until a supported, source-scoped response is authored.
  return {kind:'blocked',project:work.project,reason:'Trabalho '+work.kind+' exige contexto adicional; preservado na fila.'};
 }
 return {step,identity};
}
