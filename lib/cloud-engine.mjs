import {contingencyPlan,contingencyObservation} from './decision-contingency.mjs';
import {monitorExecution} from './execution.mjs';
import {duePlan} from './cadence.mjs';
import {collaborationPlan,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from './collaboration.mjs';
import {executionPlan,claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution} from './execution.mjs';
import {autonomousWorkPlan} from './autonomous-work.mjs';
import {recordCardSuggestion} from './decision-cards.mjs';
import {collectCloudProject} from './cloud-collector.mjs';
import {cloudFocus,cloudEvidence,cloudAnalysisContext,compactCloudContext,runCloudAnalyst} from './cloud-analysis.mjs';
import {CloudError} from './cloud-malva.mjs';
const clone=x=>structuredClone(x),uid=()=>crypto.randomUUID(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const findRound=(s,id)=>s.collaborationRounds?.find(r=>r.id===id);
export function cloudNext(state,items=[]){
 const collection=duePlan(state),plan=autonomousWorkPlan(state,{...collection,contingency:contingencyPlan(state,items),collaboration:collaborationPlan(state),execution:executionPlan(state)});
 // A submitted command is verification-only regardless of actor. Live claims owned by other workers stay untouched.
 const ready=plan.ready.filter(w=>w.kind!=='collection'&&(w.kind!=='ownerQuestion'||state.collaborationRounds?.some(r=>r.project===w.project)&&state.snapshots?.some(c=>c.projectId===w.project&&c.period==='today'&&Date.now()-Date.parse(c.fetchedAt)<3600000))); ready.sort((a,b)=>{if(a.kind!=='stage'||b.kind!=='stage')return 0;const ar=findRound(state,a.roundId),br=findRound(state,b.roundId);return (br?.stages.filter(x=>x.status==='Concluída').length||0)-(ar?.stages.filter(x=>x.status==='Concluída').length||0)||Date.parse(ar?.createdAt||0)-Date.parse(br?.createdAt||0);});if(ready.length)return ready[0];
 const job=state.jobs?.filter(j=>j.executor==='cloudflare'&&j.status==='Em análise').sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt))[0];
 return job?{kind:'collectJob',project:job.project,jobId:job.id}:collection.due.length?{kind:'admit',projects:collection.due.map(p=>p.project)}:null;
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
export function failCloudOpinion(state,{roundId,agentId,claimId,executionRef,proposalId,replyTo},code,at=Date.now()){
 const round=findRound(state,roundId);const target=proposalId?state.proposals?.find(p=>p.id===proposalId)?.reviewClaims?.[agentId]:replyTo?round?.discussionClaims?.[agentId]:round?.stages.find(s=>s.agentId===agentId);
 if(!target||target.claimId!==claimId||target.executionRef!==executionRef||target.status!=='Em análise')throw new CloudError('CLOUD_CLAIM_CHANGED');
 state.cloudAttemptFailures||={};state.cloudAttemptFailures[claimId]={roundId,agentId,claimId,executionRef,code,at:new Date(at).toISOString(),attempt:target.attempt};
 target.status='Falhou';target.leaseUntil=new Date(at).toISOString();target.failedAt=new Date(at).toISOString();target.failureCode=code;return {claimId,status:'Falhou'};
}
export function createCloudEngine({read,write,source,ai,ops,prepareGuard=async(_state,_args)=>{},now=Date.now}){
 const executionRef='cloudflare:'+uid();
 async function identity(){const who=await source.read('workspace_whoami',{});if(!who.workspace?.id||!who.platforms?.some(p=>p.platform==='tracking'&&p.read))throw new CloudError('CLOUD_MALVA_IDENTITY');const projects=await source.read('tracking_list_projects',{});if(!Array.isArray(projects.items))throw new CloudError('CLOUD_MALVA_IDENTITY');return {who,projects:projects.items};}
 async function observation(p){
  const state=(await read()).state,snapshot=state.snapshots.find(s=>s.projectId===p.project&&s.period==='today'&&s.level===p.payload.level),target=snapshot?.rows.find(r=>r.externalId===p.payload.objectId&&r.adAccountId===p.payload.adAccountId);if(!target?.id)throw new CloudError('CLOUD_TARGET_MISSING');
  const fetchOne=async(level,id,externalId,account)=>{const detail=await source.read('tracking_ad_detail',{projectId:p.project,objectId:id,sales:'traffic',preset:'today'}),r=detail.row;if(!r||r.id!==id||r.externalId!==externalId||r.adAccountId!==account||r.level!==level||r.provider!=='meta')throw new CloudError('CLOUD_TARGET_IDENTITY');return {source:'Malva MCP',complete:true,projectId:p.project,level,fetchedAt:new Date(now()).toISOString(),from:detail.period?.from,to:detail.period?.to,timezone:detail.period?.timezone,metricsCurrency:detail.currency,rows:[r]};};
  const o=await fetchOne(p.payload.level,target.id,target.externalId,target.adAccountId),b=p.payload.activationBudget;if(b&&!(b.level===p.payload.level&&b.externalId===target.externalId))o.budgetOwner=await fetchOne(b.level,b.id,b.externalId,b.adAccountId);return o;
 }
 async function step(){
  const current=await read(),s=current.state,work=cloudNext(s,ops.liveItems?await ops.liveItems(s):[]);if(!work)return {kind:'idle',paused:!!s.paused};
  if(work.kind==='verify'){
   const e=s.executions.find(e=>e.id===work.executionId),p=s.proposals.find(p=>p.id===e.proposalId);if(!p)return {kind:'blocked',reason:'Proposta de conferência ausente.'};
   const o=await observation(p);await write(st=>confirmExecution(st,{id:e.id,executionRef,clientId:'cloud-verify:'+uid(),observation:o}));return {kind:'verify',project:p.project,confirmed:true};
  }
  if(s.paused)return {kind:'idle',paused:true};
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
   const job=s.jobs.find(j=>j.id===work.jobId),id=await identity(),project=id.projects.find(p=>p.id===job.project&&p.name===s.config[job.project].projectName);if(!project)throw new CloudError('CLOUD_MALVA_IDENTITY');
   try{
    const bundle=await collectCloudProject(source,project,{now,startedAt:job.startedAt,tracked:s.snapshots.filter(x=>x.projectId===project.id&&x.level==='campaign'&&x.period==='today').flatMap(x=>x.rows).filter(r=>r.provider==='meta')});
    // Research candidates are explicit. No claim that every collected object was individually reviewed by an LLM.
    const draft=clone(s);draft.snapshots=draft.snapshots.filter(c=>c.projectId!==project.id).concat(bundle.snapshots);const focus=cloudFocus(draft,project.id),details=[];
    for(const row of focus){const [history,detail]=await Promise.all([source.read('tracking_ad_changes',{projectId:project.id,objectId:row.externalId,preset:'7d',provider:['meta'],who:'all',limit:100}),source.read('tracking_ad_detail',{projectId:project.id,objectId:row.id,sales:'traffic',preset:'14d'})]);details.push({adAccountId:row.adAccountId,externalId:row.externalId,history:{items:(history.items||[]).slice(0,20),nextCursor:history.nextCursor||null,truncated:(history.items||[]).length>20||!!history.nextCursor},detail:{daily:detail.daily,dailyRange:detail.dailyRange,hourly:Array.isArray(detail.hourly)?detail.hourly.slice(-12):null,hourlySpend:Array.isArray(detail.hourlySpend)?detail.hourlySpend.slice(-12):null,period:detail.period,currency:detail.currency}});}
    const research={jobId:job.id,collectedAt:new Date(now()).toISOString(),scope:bundle.scope,sourceCalls:bundle.sourceCalls,focus:focus.map(r=>({adAccountId:r.adAccountId,externalId:r.externalId})),details};
    if(new TextEncoder().encode(JSON.stringify(research)).length>350000)throw new CloudError('CLOUD_CONTEXT_LIMIT');
    await write(st=>{const j=st.jobs.find(j=>j.id===job.id);if(st.paused||j?.executor!=='cloudflare'||j.status!=='Em análise'||st.agents[j.project]?.jobId!==j.id)throw new CloudError('CLOUD_CLAIM_CHANGED');ops.importBundle(st,bundle);st.cloudResearch||={};st.cloudResearch[project.id]=research;ops.updateRun(st,j,'Concluída',`Coleta Cloudflare: ${bundle.snapshots.length} fontes, 4 períodos e 3 níveis. ${focus.length} campanhas priorizadas para leitura individual; demais objetos coletados não receberam parecer individual nesta unidade.`);return j.id;});
    return {kind:'collection',project:project.id,sources:bundle.snapshots.length,prioritized:focus.length};
   }catch(error){await write(st=>{const j=st.jobs.find(j=>j.id===job.id);if(j?.status==='Em análise'&&st.agents[j.project]?.jobId===j.id)ops.updateRun(st,j,'Falhou','A coleta Cloudflare não confirmou todas as fontes: '+(error.code||'CLOUD_COLLECTION_FAILED'));return null;});throw error;}
  }
  if(work.kind==='ownerQuestion'){
   const m=s.messages.find(m=>m.id===work.messageId),round=s.collaborationRounds?.find(r=>r.project===work.project);if(!round)return {kind:'blocked',reason:'A pergunta aguarda fontes da próxima rodada.'};
   const context=cloudAnalysisContext(s,round,cloudFocus(s,work.project),work.agentId);context.ownerQuestion=m.text;const out=await runCloudAnalyst(ai,work.agentId,context);await write(st=>ops.answer(st,m.id,out.text));return {kind:'ownerQuestion',project:work.project};
  }
  if(['stage','discussion','review'].includes(work.kind)){
   const round=findRound(s,work.roundId);if(!round)throw new CloudError('CLOUD_ROUND_MISSING');
   const role=work.agentId,claimArgs={roundId:round.id,agentId:role,executionRef,clientId:'cloud-'+work.kind+':'+uid(),...(work.proposalId?{proposalId:work.proposalId}:{}),...(work.replyTo?{replyTo:work.replyTo}:{})};
   const claim=await write(st=>claimCollaboration(st,claimArgs)),latest=(await read()).state,focus=cloudFocus(latest,round.project),context=cloudAnalysisContext(latest,findRound(latest,round.id),focus,role);
   if(work.proposalId)context.proposal=latest.proposals.find(p=>p.id===work.proposalId);if(work.replyTo)context.receivedQuestion=latest.collaborationMessages.find(m=>m.id===work.replyTo);
   let out,analyzedFocus;try{const bounded=compactCloudContext(context);analyzedFocus=focus.filter(r=>bounded.campaigns.some(c=>c.target.adAccountId===r.adAccountId&&c.target.externalId===r.externalId));out=await runCloudAnalyst(ai,role,bounded);}catch(error){await write(st=>failCloudOpinion(st,{...claimArgs,claimId:claim.claimId},error.code||'CLOUD_AI_UNAVAILABLE',now()));throw error;}
   const refs=cloudEvidence(latest,round.project,analyzedFocus),base={roundId:round.id,claimId:claim.claimId,executionRef};
   if(!refs.length)throw new CloudError('CLOUD_EVIDENCE_MISSING');
   if(work.kind==='review'){
    const p=context.proposal,decision=work.mode==='requestRevision'?'revise':out.verdict||'revise';
    await write(st=>reviewProposal(st,{...base,id:p.id,version:p.version,signature:p.signature,decision,comment:out.text,clientId:'cloud-review:'+uid()},{kind:'agent',agentId:role}));return {kind:'review',project:round.project,agent:role};
   }
   if(work.kind==='discussion'){
    await write(st=>postCollaboration(st,{...base,kind:'message',replyTo:work.replyTo,toAgent:context.receivedQuestion.fromAgent,requiresReply:false,text:out.text,summary:{decision:out.decision,reason:out.reason,nextStep:out.nextStep},evidenceRefs:refs,clientId:'cloud-reply:'+uid()}));return {kind:'discussion',project:round.project,agent:role};
   }
   // An actual model call authored this contribution. Persist its role/model and source-scoped evidence.
   if(out.question&&out.question.toAgent!==role)await write(st=>postCollaboration(st,{...base,kind:'message',toAgent:out.question.toAgent,requiresReply:true,text:out.question.text,evidenceRefs:refs,clientId:'cloud-question:'+uid()}));
   if(role==='ops'){
    const opinions=latest.collaborationMessages.filter(m=>m.roundId===round.id&&m.kind==='conclusion'&&['traffic','creative','budget'].includes(m.fromAgent)).map(m=>m.id);
    for(const suggestion of out.suggestions){
     const row=focus.find(r=>r.adAccountId===suggestion.adAccountId&&r.externalId===suggestion.objectId);if(!row)throw new CloudError('CLOUD_AI_SCOPE');
     await write(st=>recordCardSuggestion(st,{...base,payload:{...suggestion,opinionRefs:opinions},clientId:'cloud-suggestion:'+uid()}));
     if(suggestion.action!=='keep'&&(await read()).state.proposals.filter(p=>p.roundId===round.id).length<3){
      const payload=cloudProposalPayload(suggestion,row,refs,opinions);await write(st=>submitProposal(st,{...base,payload,expiresAt:new Date(now()+30*60000).toISOString(),clientId:'cloud-proposal:'+uid()}));
     }
    }
   }
   await write(st=>postCollaboration(st,{...base,kind:'conclusion',toAgent:role==='ops'?'traffic':'ops',text:out.text,summary:{decision:out.decision,reason:out.reason,nextStep:out.nextStep},evidenceRefs:refs,clientId:'cloud-conclusion:'+uid()}));
   return {kind:'stage',project:round.project,agent:role,model:'Workers AI Llama 3.3 70B',prioritized:analyzedFocus.length};
  }
  // Owner questions remain visibly pending until a supported, source-scoped response is authored.
  return {kind:'blocked',project:work.project,reason:'Trabalho '+work.kind+' exige contexto adicional; preservado na fila.'};
 }
 return {step,identity};
}
