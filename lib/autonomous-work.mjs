import {collaborationPlan,approvedExecutionProposal} from './collaboration.mjs';
import {executionPlan} from './execution.mjs';

const arr=value=>Array.isArray(value)?value:[];
const time=value=>Date.parse(value||'');
const live=(claim,now)=>claim?.status==='Em análise'&&time(claim.startedAt)<=now&&time(claim.leaseUntil)>now;
const exhausted=(claim,now)=>(claim?.attempt||0)>=3&&!live(claim,now);
export const autonomousSourceAgeMs=60*60000;
/** Read-only dispatch plan. It assigns no identities, writes no claims and authorizes no provider call. */
export function autonomousWorkPlan(state,base={},now=Date.now()){
 const workflow=base.collaboration||collaborationPlan(state,now),execution=base.execution||executionPlan(state,now);
 const ready=[],waiting=[],refresh=[],paused=!!state.paused;
 const add=(kind,project,extra={})=>ready.push({kind,project,projectName:state.config?.[project]?.projectName||project,...extra});
 const storedRounds=new Map(arr(state.collaborationRounds).map(r=>[r.id,r]));
 const executionIds=new Set(arr(execution.executions).map(e=>e.proposalId));
 for(const e of arr(execution.executions)){
  if(e.verificationOnly)add('verify',e.project,{executionId:e.id,proposalId:e.proposalId,verificationOnly:true});
  else if(!paused&&(e.canPrepare||e.canSubmit||e.canReclaim)){
   if(time(e.leaseUntil)>now)waiting.push({kind:'execution',project:e.project,executionId:e.id,reason:'Execução reservada; conferir o trabalhador responsável antes de continuar.'});
   else add('execution',e.project,{executionId:e.id,proposalId:e.proposalId,requiresExactOwnerApproval:true});
  }
 }
 if(!paused){
  for(const p of arr(state.proposals)){
   if(p.status!=='Aprovada'||executionIds.has(p.id)||p.appliedAt)continue;
   try{approvedExecutionProposal(state,{proposalId:p.id,version:p.version,signature:p.signature},now);add('execution',p.project,{proposalId:p.id,version:p.version,signature:p.signature,requiresExactOwnerApproval:true});}catch{ /* Invalid authorization never enters the dispatch plan. */ }
  }
  for(const m of arr(state.messages))if(m.status==='Pendente'&&state.config?.[m.project])add('ownerQuestion',m.project,{messageId:m.id,agentId:m.agentId||'ops'});
  for(const r of arr(workflow.rounds)){
   if(r.blocked||!storedRounds.has(r.roundId))continue;
   const round=storedRounds.get(r.roundId),campaignCuts=arr(r.sourceCut).filter(s=>s.level==='campaign');
   const fresh=campaignCuts.length===4&&campaignCuts.every(s=>Number.isFinite(time(s.fetchedAt))&&time(s.fetchedAt)<=now&&now-time(s.fetchedAt)<autonomousSourceAgeMs);
   const reviews=arr(workflow.proposals).filter(p=>p.roundId===r.roundId&&p.status==='Em revisão'&&time(p.expiresAt)>now);
   const hasWork=arr(r.discussionPending).length||r.nextAgent||reviews.length;
   if(!fresh){
    if(hasWork)refresh.push({project:r.project,roundId:r.roundId,reason:'Fonte vencida ou incompleta; recolher antes de discutir ou sugerir.'});
    // A proposal still in peer-review holds its source. Route it to a real
    // reviewer to request a revision; never deadlock it or recommend from old data.
    for(const p of reviews){const role=arr(p.reviewAgents)[0],claim=arr(state.proposals).find(item=>item.id===p.id)?.reviewClaims?.[role];
     if(role&&!live(claim,now)&&!exhausted(claim,now))add('review',r.project,{roundId:r.roundId,proposalId:p.id,agentId:role,mode:'requestRevision',reason:'Fonte vencida; pedir revisão, sem aprovar nem recomendar novo valor.'});
    }
    continue;
   }
   for(const m of arr(r.discussionPending)){
    const claim=r.discussionClaims?.[m.toAgent];
    if(exhausted(claim,now)&&claim.replyTo===m.id){refresh.push({project:r.project,roundId:r.roundId,reason:'Resposta atingiu o limite de tentativas; requer nova rodada.'});continue;}
    if(live(claim,now))waiting.push({kind:'discussion',project:r.project,roundId:r.roundId,agentId:m.toAgent,reason:'Resposta já reservada.'});
    else add('discussion',r.project,{roundId:r.roundId,agentId:m.toAgent,replyTo:m.id});
   }
   for(const p of reviews)for(const role of arr(p.reviewAgents)){
    const claim=arr(state.proposals).find(item=>item.id===p.id)?.reviewClaims?.[role];
    if(exhausted(claim,now)){refresh.push({project:r.project,roundId:r.roundId,proposalId:p.id,reason:'Parecer atingiu o limite de tentativas; revisão requer atenção.'});continue;}
    if(live(claim,now))waiting.push({kind:'review',project:r.project,roundId:r.roundId,proposalId:p.id,agentId:role,reason:'Parecer já reservado.'});
    else add('review',r.project,{roundId:r.roundId,proposalId:p.id,agentId:role});
   }
   if(r.nextAgent){
    const stage=arr(r.stages).find(s=>s.agentId===r.nextAgent);
    if(exhausted(stage,now)){refresh.push({project:r.project,roundId:r.roundId,reason:'Etapa atingiu o limite de tentativas; requer nova rodada.'});continue;}
    if(live(stage,now))waiting.push({kind:'stage',project:r.project,roundId:r.roundId,agentId:r.nextAgent,reason:'Leitura já reservada.'});
    else add('stage',r.project,{roundId:r.roundId,agentId:r.nextAgent});
   }
  }
  if(arr(base.due).length)ready.push({kind:'collection',projects:base.due.map(p=>p.project)});
 }
 const priority={verify:0,execution:1,ownerQuestion:2,discussion:3,review:4,stage:5,collection:6};
 ready.sort((a,b)=>priority[a.kind]-priority[b.kind]);
 const counts=Object.fromEntries(Object.keys(priority).map(k=>[k,ready.filter(w=>w.kind===k).length]));
 const suggestions=arr(state.cardSuggestions),roundIds=new Set(storedRounds.keys());
 return {version:1,paused,ready:ready.slice(0,100),readyCount:ready.length,truncated:ready.length>100,waiting:waiting.slice(0,50),waitingCount:waiting.length,refresh:refresh.slice(0,50),counts,next:ready[0]||null,journal:{suggestions:suggestions.length,orphanSuggestions:suggestions.filter(s=>!roundIds.has(s.roundId)).length},rule:'Releia antes de cada escrita. Termine respostas, pareceres e síntese válidos antes de substituir suas fontes. Delegue papéis reais; publique somente sugestões sustentadas. O plano não autoriza execução financeira, não prova presença nem dispensa claim/prepare/submit/confirm.'};
}
