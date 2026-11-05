import {cloudPacketProfile} from './cloud-packet-economy.mjs';
import {cloudReviewFocus,scopeCloudReviewContext} from './cloud-review-focus.mjs';
import {emptyRoundEligibility,closeEmptyRound} from './empty-round-review.mjs';
import {collectionFailure,preserveCollectionFailure} from './cloud-failure-diagnostics.mjs';
import {campaignCoveragePolicy,normalizeCampaignReadings} from './campaign-learning-coverage.mjs';
import {autonomousLearningPlan,processAutonomousLearning} from './learning-outcomes.mjs';
import {creativeLearningContext} from './creative-learning-context.mjs';
import {contingencyPlan,contingencyObservation} from './decision-contingency.mjs';
import {monitorExecution} from './execution.mjs';
import {duePlan} from './cadence.mjs';
import {collaborationPlan,claimCollaboration,postCollaboration,submitProposal,reviewProposal,fingerprint} from './collaboration.mjs';
import {executionPlan,claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution} from './execution.mjs';
import {autonomousWorkPlan} from './autonomous-work.mjs';
import {recordCardSuggestion} from './decision-cards.mjs';
import {collectCloudProject,cloudRanges,trackedCloudCampaigns} from './cloud-collector.mjs';
import {normalizeAgentReflection} from './agent-development.mjs';
import {learningPeerPacket,persistLearningPeerReview} from './learning-peer-review.mjs';
import {collectHistoryLearning,storeHistoryCollection,historyLearningKey} from './cloud-history-learning.mjs';
import {collectExternalLearning,persistExternalLearning} from './external-learning.mjs';
import {enrollProposalLearning,proposalLearningEnrollment} from './learning-enrollment.mjs';
import {validateResearchDetail} from './cloud-research.mjs';
import {cloudFocus,cloudEvidence,cloudAnalysisContext,runCloudAnalyst} from './cloud-analysis.mjs';
import {CloudError} from './cloud-malva.mjs';
const clone=x=>structuredClone(x),uid=()=>crypto.randomUUID(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const findRound=(s,id)=>s.collaborationRounds?.find(r=>r.id===id);
export function cloudNext(state,items=[],at=Date.now()){
 const collection=duePlan(state,new Date(at)),plan=autonomousWorkPlan(state,{...collection,contingency:contingencyPlan(state,items,at),collaboration:collaborationPlan(state,at),execution:executionPlan(state,at)},at);
 // A submitted command is verification-only regardless of actor. Live claims owned by other workers stay untouched.
 const ready=plan.ready.filter(w=>w.kind!=='collection'&&(w.kind!=='ownerQuestion'||state.collaborationRounds?.some(r=>r.project===w.project)&&state.snapshots?.some(c=>c.projectId===w.project&&c.period==='today'&&at-Date.parse(c.fetchedAt)<3600000))); ready.sort((a,b)=>{if(a.kind!=='stage'||b.kind!=='stage')return 0;const ar=findRound(state,a.roundId),br=findRound(state,b.roundId);return (br?.stages.filter(x=>x.status==='Concluída').length||0)-(ar?.stages.filter(x=>x.status==='Concluída').length||0)||Date.parse(ar?.createdAt||0)-Date.parse(br?.createdAt||0);});if(ready.length&&['verify','followUp','execution','ownerQuestion'].includes(ready[0].kind))return ready[0];
 if(!state.paused&&autonomousLearningPlan(state,null,at).ready.length)return {kind:'learning'};
 if(ready.length)return ready[0];
 const job=state.jobs?.filter(j=>j.executor==='cloudflare'&&j.status==='Em análise').sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||(Date.parse(state.agents?.[a.project]?.lastSuccessAt||'')||0)-(Date.parse(state.agents?.[b.project]?.lastSuccessAt||'')||0)||String(a.id).localeCompare(String(b.id)))[0];
 return collection.due.length?{kind:'admit',projects:collection.due.map(p=>p.project)}:job?{kind:'collectJob',project:job.project,jobId:job.id}:null;
}
export function cloudProposalPayload(suggestion,row,refs,opinions){
 const before={dailyBudget:row.dailyBudget},after={dailyBudget:Math.round(row.dailyBudget*(1+(suggestion.action==='increase'?1:-1)*suggestion.percent/100)*100)/100};
 if(['increase','reduce'].includes(suggestion.action)&&(!Number.isFinite(row.dailyBudget)||row.dailyBudget<=0||row.lifetimeBudget>0||!Number.isFinite(suggestion.percent)||after.dailyBudget<=0))throw new CloudError('CLOUD_PROPOSAL_INVALID');
 return {title:row.accountName+' · '+(suggestion.action==='pause'?'Pausar campanha':(suggestion.action==='increase'?'Aumentar ':'Reduzir ')+suggestion.percent+'%'),reason:suggestion.reason,action:suggestion.action==='pause'?'status':'budget',level:'campaign',provider:'meta',adAccountId:row.adAccountId,objectId:row.externalId,currency:row.budgetCurrency,budgetOwner:'CBO',before:suggestion.action==='pause'?{status:row.status}:before,after:suggestion.action==='pause'?{status:'PAUSED'}:after,evidenceRefs:refs.filter(r=>r.externalId===row.externalId&&r.adAccountId===row.adAccountId),opinionRefs:opinions,risks:['Executar somente a versão exata aprovada. Reconfirmar aquisição, última edição, orçamento e status antes do envio.']};
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
export function failCloudOpinion(state,{roundId,agentId,claimId,executionRef,proposalId,replyTo},code,at=Date.now(),readingFailure=null){
 const round=findRound(state,roundId);const target=proposalId?state.proposals?.find(p=>p.id===proposalId)?.reviewClaims?.[agentId]:replyTo?round?.discussionClaims?.[agentId]:round?.stages.find(s=>s.agentId===agentId);
 if(!target||target.claimId!==claimId||target.executionRef!==executionRef||target.status!=='Em análise')throw new CloudError('CLOUD_CLAIM_CHANGED');
 state.cloudAttemptFailures||={};const safeReading=readingFailure&&['duplicate_citation','citation_not_in_packet','numeric_citation_required','child_citation_required','missing_numbers_require_investigate'].includes(readingFailure.reason)&&state.snapshots?.some(s=>s.projectId===round.project&&s.level==='campaign'&&s.rows?.some(r=>r.adAccountId===readingFailure.adAccountId&&r.externalId===readingFailure.externalId))?{adAccountId:readingFailure.adAccountId,externalId:readingFailure.externalId,reason:readingFailure.reason}:null;
 state.cloudAttemptFailures[claimId]={roundId,agentId,claimId,executionRef,code,at:new Date(at).toISOString(),attempt:target.attempt,...(safeReading?{readingFailure:safeReading}:{})};
 target.status='Falhou';target.leaseUntil=new Date(at).toISOString();target.failedAt=new Date(at).toISOString();target.failureCode=code;return {claimId,status:'Falhou'};
}
export function createCloudEngine({read,write,source,ai,ops,modelPolicy='legacy',prepareGuard=async(_state,_args)=>{},now=Date.now}){
 async function identity(){const who=await source.read('workspace_whoami',{});if(!who.workspace?.id||!who.platforms?.some(p=>p.platform==='tracking'&&p.read))throw new CloudError('CLOUD_MALVA_IDENTITY');const projects=await source.read('tracking_list_projects',{});if(!Array.isArray(projects.items))throw new CloudError('CLOUD_MALVA_IDENTITY');return {who,projects:projects.items};}
 async function observation(p){
  const state=(await read()).state,snapshot=state.snapshots.find(s=>s.projectId===p.project&&s.period==='today'&&s.level===p.payload.level),target=snapshot?.rows.find(r=>r.externalId===p.payload.objectId&&r.adAccountId===p.payload.adAccountId);if(!target?.id)throw new CloudError('CLOUD_TARGET_MISSING');
  const fetchOne=async(level,id,externalId,account)=>{const detail=await source.read('tracking_ad_detail',{projectId:p.project,objectId:id,sales:'traffic',preset:'today'}),r=detail.row;if(!r||r.id!==id||r.externalId!==externalId||r.adAccountId!==account||r.level!==level||r.provider!=='meta')throw new CloudError('CLOUD_TARGET_IDENTITY');return {source:'Malva MCP',complete:true,projectId:p.project,level,fetchedAt:new Date(now()).toISOString(),from:detail.period?.from,to:detail.period?.to,timezone:detail.period?.timezone,metricsCurrency:detail.currency,rows:[r]};};
  const o=await fetchOne(p.payload.level,target.id,target.externalId,target.adAccountId),b=p.payload.activationBudget;if(b&&!(b.level===p.payload.level&&b.externalId===target.externalId))o.budgetOwner=await fetchOne(b.level,b.id,b.externalId,b.adAccountId);return o;
 }
 async function step(){
  // Distinct model units retain distinct authorship even within the same alarm.
  const executionRef='cloudflare:'+uid();
  const current=await read(),s=current.state,work=cloudNext(s,ops.liveItems?await ops.liveItems(s):[],now());if(!work)return {kind:'idle',paused:!!s.paused};
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
   const ids=await identity();for(const project of work.projects)if(!ids.projects.some(p=>p.id===project&&p.name===s.config[project].projectName))throw new CloudError('CLOUD_MALVA_IDENTITY');
   const out=await write((st,revision)=>{const r=ops.claimBatch(st,work.projects,revision,new Date(now()));for(const j of r.jobs)j.executor='cloudflare';return r.jobs.map(j=>({id:j.id,project:j.project}));});return {kind:'admit',jobs:out};
  }
  if(work.kind==='collectJob'){
   const job=s.jobs.find(j=>j.id===work.jobId);let phase='identity';
   try{
    const id=await identity(),project=id.projects.find(p=>p.id===job.project&&p.name===s.config[job.project].projectName);if(!project)throw new CloudError('CLOUD_MALVA_IDENTITY');
    phase='campaigns';
    const bundle=await collectCloudProject(source,project,{now,startedAt:job.startedAt,tracked:trackedCloudCampaigns(s,project.id)});
    // Research candidates are explicit. No claim that every collected object was individually reviewed by an LLM.
    const draft=clone(s);draft.snapshots=draft.snapshots.filter(c=>c.projectId!==project.id).concat(bundle.snapshots);const focus=cloudFocus(draft,project.id),details=[],historyCollections=[];
    phase='research';
    for(const row of focus){
     const [collectedHistory,detail,today]=await Promise.all([collectHistoryLearning(source,project,row,s.historyLearning?.scopes?.[historyLearningKey(project.id,row.adAccountId,row.externalId)],{now}),source.read('tracking_ad_detail',{projectId:project.id,objectId:row.id,sales:'traffic',preset:'14d'}),source.read('tracking_ad_detail',{projectId:project.id,objectId:row.id,sales:'traffic',preset:'today'})]);
     const history=collectedHistory.research;history.timezone=project.timezone;historyCollections.push(collectedHistory);
     validateResearchDetail(detail,row,project);validateResearchDetail(today,row,project);
     if(!Array.isArray(history.items)||history.timezone!==project.timezone||today.period.days?.length!==1||today.period.days[0]!==cloudRanges(now(),project.timezone).today.from)throw new CloudError('SOURCE_RESEARCH_IDENTITY');
     const ordered=history.items.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),retained=new Set(ordered.slice(0,20));
     for(const category of ['budget','status','creative']){const latest=ordered.find(e=>e.category===category);if(latest)retained.add(latest);}
     const items=ordered.filter(e=>retained.has(e));
     details.push({adAccountId:row.adAccountId,externalId:row.externalId,history:{items,returnedCount:history.items.length,nextCursor:history.nextCursor||null,truncated:history.items.length>items.length||!!history.nextCursor},detail:{daily:detail.daily,dailyRange:detail.dailyRange,period:detail.period,currency:detail.currency,intraday:{hourly:Array.isArray(today.hourly)?today.hourly:null,hourlySpend:today.hourlySpend,period:today.period,currency:today.currency,fetchedAt:new Date(now()).toISOString()}}});
    }
    phase='learning';
    for(const history of historyCollections)storeHistoryCollection(draft,history,now());
    const externalLearning=await collectExternalLearning(source,draft,project,{now});
    const research={jobId:job.id,focusPolicy:campaignCoveragePolicy.version,collectedAt:new Date(now()).toISOString(),scope:bundle.scope,sourceCalls:bundle.sourceCalls,focus:focus.map(r=>({adAccountId:r.adAccountId,externalId:r.externalId})),details};
    if(new TextEncoder().encode(JSON.stringify(research)).length>350000)throw new CloudError('CLOUD_CONTEXT_LIMIT');
    phase='persist';
    await write(st=>{const j=st.jobs.find(j=>j.id===job.id);if(st.paused||j?.executor!=='cloudflare'||j.status!=='Em análise'||st.agents[j.project]?.jobId!==j.id)throw new CloudError('CLOUD_CLAIM_CHANGED');const historyResults=historyCollections.map(h=>storeHistoryCollection(st,h,now()));ops.importBundle(st,bundle);const externalResult=persistExternalLearning(st,externalLearning,now());st.cloudResearch||={};st.cloudResearch[project.id]={...research,historyLearning:historyResults,externalLearning:externalResult};ops.updateRun(st,j,'Concluída',`Coleta Cloudflare: ${bundle.snapshots.length} fontes, 4 períodos e 3 níveis. ${focus.length} campanhas priorizadas para leitura individual; demais objetos coletados não receberam parecer individual nesta unidade.`);return j.id;});
    return {kind:'collection',project:project.id,sources:bundle.snapshots.length,prioritized:focus.length};
   }catch(error){const diagnostic=collectionFailure(error,{project:job.project,jobId:job.id,phase},now());await write(st=>{preserveCollectionFailure(st,diagnostic);const j=st.jobs.find(j=>j.id===job.id);if(j?.status==='Em análise'&&st.agents[j.project]?.jobId===j.id)ops.updateRun(st,j,'Falhou','A coleta Cloudflare não confirmou todas as fontes: '+diagnostic.code+' · etapa '+diagnostic.phase);return null;});const failure=new CloudError(diagnostic.code);failure.collectionFailure=diagnostic;throw failure;}
  }
  if(work.kind==='ownerQuestion'){
   const m=s.messages.find(m=>m.id===work.messageId),round=s.collaborationRounds?.find(r=>r.project===work.project);if(!round)return {kind:'blocked',reason:'A pergunta aguarda fontes da próxima rodada.'};
   const context=cloudAnalysisContext(s,round,cloudFocus(s,work.project),work.agentId);context.ownerQuestion=m.text;const out=await runCloudAnalyst(ai,work.agentId,context,modelPolicy);await write(st=>ops.answer(st,m.id,out.text));return {kind:'ownerQuestion',project:work.project};
  }
  if(['stage','discussion','review'].includes(work.kind)){
   const round=findRound(s,work.roundId);if(!round)throw new CloudError('CLOUD_ROUND_MISSING');
   if(work.kind==='stage'&&emptyRoundEligibility(s,round,now()))return {kind:'systemReview',...await write(st=>closeEmptyRound(st,round.id,now()))};
   const role=work.agentId,claimArgs={roundId:round.id,agentId:role,executionRef,clientId:'cloud-'+work.kind+':'+uid(),...(work.proposalId?{proposalId:work.proposalId}:{}),...(work.replyTo?{replyTo:work.replyTo}:{})};
   const claim=await write(st=>claimCollaboration(st,claimArgs,now())),latest=(await read()).state;
   let focus=cloudFocus(latest,round.project),context=cloudAnalysisContext(latest,findRound(latest,round.id),focus,role);
   if(work.kind==='stage'){context.learningReview=learningPeerPacket(latest,round.project,role,now());context.campaignReviewPolicy=campaignCoveragePolicy;const prior=Object.values(latest.cloudAttemptFailures||{}).filter(f=>f.roundId===round.id&&f.agentId===role).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];if(prior)context.validationFeedback={code:prior.code,readingFailure:prior.readingFailure||null,rule:'Tentativa recusada; corrigir com as fontes atuais. Não é aprendizado financeiro validado nem autorização.'};}
   const creative=ops.creativeItems?await ops.creativeItems(latest,round.project).catch(()=>({items:[],error:'Órbita indisponível nesta leitura.'})):{items:[],error:'Leitura Órbita não configurada no executor.'};
   context.creativeContext=creativeLearningContext(latest,round.project,creative,focus,now());
   if(work.proposalId){context.proposal=latest.proposals.find(p=>p.id===work.proposalId);context.proposalLearning=proposalLearningEnrollment(latest,context.proposal,now());}if(work.replyTo)context.receivedQuestion=latest.collaborationMessages.find(m=>m.id===work.replyTo);
   let out,analyzedFocus,inputProfile;try{
    if(work.kind==='review'){
     const requested=focus.length,p=context.proposal,learning=context.proposalLearning;
     focus=cloudReviewFocus(latest,round.project,focus,p);context=scopeCloudReviewContext(cloudAnalysisContext(latest,findRound(latest,round.id),focus,role),p,requested,latest);context.campaignReviewPolicy=campaignCoveragePolicy;
     context.creativeContext=creativeLearningContext(latest,round.project,creative,focus,now());context.proposal=p;context.proposalLearning=learning;
    }
    inputProfile=cloudPacketProfile(context);out=await runCloudAnalyst(ai,role,context,modelPolicy);analyzedFocus=focus.filter(r=>out.analysisTargets.some(c=>c.adAccountId===r.adAccountId&&c.externalId===r.externalId));normalizeCampaignReadings(out.campaignReadings,{state:latest,round:findRound(latest,round.id),role,evidenceRefs:cloudEvidence(latest,round.project,analyzedFocus)});if(out.reflection)normalizeAgentReflection(out.reflection,{state:latest,round:findRound(latest,round.id),agentId:role,evidenceRefs:cloudEvidence(latest,round.project,analyzedFocus)});}catch(error){await write(st=>failCloudOpinion(st,{...claimArgs,claimId:claim.claimId},error.code||'CLOUD_AI_UNAVAILABLE',now(),error.readingFailure));throw error;}
   const refs=cloudEvidence(latest,round.project,analyzedFocus),base={roundId:round.id,claimId:claim.claimId,executionRef};
   if(!refs.length)throw new CloudError('CLOUD_EVIDENCE_MISSING');
   if(work.kind==='review'){
    const p=context.proposal,decision=work.mode==='requestRevision'?'revise':out.verdict||'revise',clientId='cloud-review:'+uid();
    await write(st=>{const saved=reviewProposal(st,{...base,id:p.id,version:p.version,signature:p.signature,decision,comment:out.text,clientId},{kind:'agent',agentId:role},now()),record=saved.reviews.find(r=>r.clientId===clientId);record.model={policy:out.modelPolicy,name:out.modelName};record.packetProfile={input:inputProfile,delivered:out.packetProfile};record.reviewScope=context.coverage.proposalReview;return saved;});return {kind:'review',project:round.project,agent:role,model:out.modelName,reviewedParents:analyzedFocus.length,packetBytes:out.packetProfile.transportBytes};
   }
   if(work.kind==='discussion'){
    await write(st=>postCollaboration(st,{...base,kind:'message',replyTo:work.replyTo,toAgent:context.receivedQuestion.fromAgent,requiresReply:false,text:out.text,summary:{decision:out.decision,reason:out.reason,nextStep:out.nextStep},...(out.reflection?{reflection:out.reflection}:{}),evidenceRefs:refs,clientId:'cloud-reply:'+uid()},now()));return {kind:'discussion',project:round.project,agent:role};
   }
   // An actual model call authored this contribution. Persist its role/model and source-scoped evidence.
   if(out.question&&out.question.toAgent!==role)await write(st=>postCollaboration(st,{...base,kind:'message',toAgent:out.question.toAgent,requiresReply:true,text:out.question.text,evidenceRefs:refs,clientId:'cloud-question:'+uid()},now()));
   if(role==='ops'){
    const opinions=latest.collaborationMessages.filter(m=>m.roundId===round.id&&m.kind==='conclusion'&&['traffic','creative','budget'].includes(m.fromAgent)).map(m=>m.id);
    for(const suggestion of out.suggestions){
     const row=focus.find(r=>r.adAccountId===suggestion.adAccountId&&r.externalId===suggestion.objectId);if(!row)throw new CloudError('CLOUD_AI_SCOPE');
     const {learning:enrollment,...financialSuggestion}=suggestion;
     try{await write(st=>{
      normalizeCampaignReadings(out.campaignReadings,{state:st,round:findRound(st,round.id),role,evidenceRefs:refs});
      const target=fingerprint([row.adAccountId,row.externalId]);
      recordCardSuggestion(st,{...base,payload:{...financialSuggestion,opinionRefs:opinions},clientId:'cloud-suggestion:'+claim.claimId+':'+target},now());
      if(suggestion.action!=='keep'&&st.proposals.filter(p=>p.roundId===round.id).length<3){
       const payload=cloudProposalPayload(suggestion,row,refs,opinions);
       const p=submitProposal(st,{...base,payload,expiresAt:new Date(now()+30*60000).toISOString(),clientId:'cloud-proposal:'+claim.claimId+':'+target},now());
       if(enrollment)enrollProposalLearning(st,{...base,entry:{project:round.project,proposalId:p.id,proposalVersion:p.version,proposalSignature:p.signature,...enrollment}},now());
      }
      return null;
     });}catch(error){
      if(/^CLOUD_LEARNING_/.test(error.code||''))await write(st=>{const stage=findRound(st,round.id)?.stages.find(x=>x.agentId===role);return stage?.claimId===claim.claimId&&stage.executionRef===executionRef&&stage.status==='Em análise'?failCloudOpinion(st,{...claimArgs,claimId:claim.claimId},error.code,now()):null;});
      throw error;
     }
    }
   }
   const learningReview=await write(st=>{
    const result=persistLearningPeerReview(st,{...base,project:round.project,agentId:role},out.learningReview,context.learningReview,now());
    const message=postCollaboration(st,{...base,kind:'conclusion',toAgent:role==='ops'?'traffic':'ops',text:out.text,summary:{decision:out.decision,reason:out.reason,nextStep:out.nextStep},...(out.reflection?{reflection:out.reflection}:{}),...(out.campaignReadings?{campaignReadings:out.campaignReadings}:{}),evidenceRefs:refs,clientId:'cloud-conclusion:'+claim.claimId},now());
    message.packetProfile={input:inputProfile,delivered:out.packetProfile};
    message.model={policy:out.modelPolicy,name:out.modelName};
    message.analysisCoverage={requested:focus.length,reviewed:analyzedFocus.length,deferred:focus.filter(r=>!analyzedFocus.some(a=>a.adAccountId===r.adAccountId&&a.externalId===r.externalId)).map(r=>({adAccountId:r.adAccountId,externalId:r.externalId}))};
    if(out.evidenceSelections?.length)message.evidenceResolution={version:1,sourceHash:round.sourceHash,selected:out.evidenceSelections};
    return result;
   });
   return {kind:'stage',project:round.project,agent:role,model:out.modelName,prioritized:analyzedFocus.length,requestedTargets:focus.length,deferredTargets:focus.length-analyzedFocus.length,packetBytes:out.packetProfile.transportBytes,learningReview};
  }
  // Owner questions remain visibly pending until a supported, source-scoped response is authored.
  return {kind:'blocked',project:work.project,reason:'Trabalho '+work.kind+' exige contexto adicional; preservado na fila.'};
 }
 return {step,identity};
}
