import {closedSystemRound,systemRoundReviewKind} from './system-round-review.mjs';
import {normalizeCampaignReadings,recordCampaignCoverage} from './campaign-learning-coverage.mjs';
import {retainChoiceResolutions} from './decision-resolution.mjs';
import {isWarmupTarget} from './campaign-scope.mjs';
import {normalizeAgentSummary} from './agent-summary.mjs';
import {normalizeAgentReflection,retainAgentEpisodes} from './agent-development.mjs';
import {assertFinancialSources} from './analysis-validation.mjs';
/**
 * Durable collaboration of connected agent executions. This module never calls an
 * ad provider and does not manufacture agent dialogue. Its callers must expose
 * agent operations only through the authenticated MCP adapter, and owner reviews
 * only through the authenticated owner API (actor is server supplied).
 */
export const collaborationRoles=Object.freeze(['traffic','creative','budget','ops']);
export const collaborationLimits=Object.freeze({rounds:40,messages:600,proposals:160,messagesPerRound:24,questionsPerRound:10,proposalsPerRound:3,reviewsPerProposal:12,evidenceRefs:1000,attempts:3,leaseMs:15*60000,validityMs:24*60*60000});
const periods=['7d','3d','yesterday','today'],levels=['campaign','adset','ad','account'];
const terminalProposal=new Set(['Aprovada','Recusada','Revisão solicitada','Expirada','Fonte substituída']);
const clone=value=>JSON.parse(JSON.stringify(value));
const id=()=>globalThis.crypto.randomUUID();
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
function fail(text){throw new Error(text);}
function text(value,label,max=4000){if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label} inválido.`);return value.trim();}
function time(value=Date.now()){const n=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(n))fail('Data inválida.');return n;}
const iso=value=>new Date(time(value)).toISOString();
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
/** Integrity marker, not a cryptographic signature or client authorization. */
export function fingerprint(value){const s=canonical(value);let a=2166136261,b=3335557771;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),2246822519);}return 'v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
function init(state){for(const key of ['collaborationRounds','collaborationMessages','proposals']){if(state[key]===undefined)state[key]=[];if(!Array.isArray(state[key]))fail('Estado de colaboração inválido.');}}
function capacity(items,maximum,label){if(items.length>=maximum)fail(`Limite de ${label} atingido. Exporte o histórico; nenhum registro pendente será removido.`);}
function active(state){if(state.paused)fail('Escritório pausado.');}
function role(value){if(!collaborationRoles.includes(value))fail('Agente de colaboração inválido.');return value;}
function client(value){return text(value,'clientId',150);}
function jobFor(state,job){const stored=(state.jobs||[]).find(j=>j.id===job?.id);if(!stored||stored.project!==job.project)fail('Rodada de coleta não encontrada.');return stored;}
function sourceMeta(snapshot){return {period:snapshot.period,level:snapshot.level,from:snapshot.from,to:snapshot.to,timezone:snapshot.timezone,fetchedAt:snapshot.fetchedAt,lastSyncAt:snapshot.lastSyncAt??null,source:snapshot.source,complete:true,rowCount:snapshot.rows.length,...(snapshot.analysisScope?{analysisScope:clone(snapshot.analysisScope)}:{}),fingerprint:fingerprint(snapshot)};}
function collectSources(state,job,now){
 const started=time(job.startedAt),completed=time(job.completedAt);
 if(started>completed||completed>now+300000)fail('Datas da rodada de coleta inválidas.');
 const sources=(state.snapshots||[]).filter(s=>s.projectId===job.project&&s.complete===true&&periods.includes(s.period)&&levels.includes(s.level)&&Array.isArray(s.rows)&&Number.isFinite(Date.parse(s.fetchedAt))&&Date.parse(s.fetchedAt)>=started&&Date.parse(s.fetchedAt)<=completed+300000);
 for(const period of periods)if(sources.filter(s=>s.period===period&&s.level==='campaign').length!==1)fail('Colaboração exige quatro janelas de campanhas completas coletadas após o início da rodada.');
 const keys=new Set();
 for(const s of sources){const key=s.period+':'+s.level;if(keys.has(key))fail('Fonte duplicada na rodada.');keys.add(key);if(s.source!=='Malva MCP'||!s.from||!s.to||!s.timezone)fail('Fonte da coleta sem procedência, período ou fuso.');if(Date.parse(s.fetchedAt)>now+300000)fail('Fonte da coleta no futuro.');}
 return sources.sort((a,b)=>periods.indexOf(a.period)-periods.indexOf(b.period)||levels.indexOf(a.level)-levels.indexOf(b.level)).map(sourceMeta);
}
function roundFor(state,roundId){init(state);const round=state.collaborationRounds.find(r=>r.id===roundId);if(!round)fail('Colaboração não encontrada.');return round;}
function context(state,round,now){
 if(!own(state.config,round.project))fail('Projeto da colaboração não encontrado.');
 const job=(state.jobs||[]).find(j=>j.id===round.jobId&&j.project===round.project&&j.status==='Concluída');if(!job)fail('A coleta desta colaboração não está concluída.');
 // An unsuccessful refresh is not a replacement source. Keep the last successful
 // cut usable only when every later attempt failed/cancelled and its exact data
 // is still present (fingerprints below). A live or successful successor fences it.
 const unsuccessful=j=>['Falhou','Cancelada'].includes(j.status),began=j=>Date.parse(j.startedAt||j.createdAt||'');
 const owner=state.agents?.[round.project]?.jobId;
 if(owner&&owner!==round.jobId){const attempt=(state.jobs||[]).find(j=>j.id===owner&&j.project===round.project);if(!attempt||!unsuccessful(attempt)||!Number.isFinite(began(attempt))||began(attempt)<Date.parse(job.startedAt))fail('Uma rodada nova substituiu a fonte desta colaboração.');}
 if((state.jobs||[]).some(j=>j.project===round.project&&j.id!==round.jobId&&began(j)>Date.parse(job.startedAt)&&!unsuccessful(j)))fail('Uma rodada nova substituiu a fonte desta colaboração.');
 if(fingerprint(state.config[round.project])!==round.configFingerprint)fail('Os parâmetros do projeto mudaram. Inicie uma nova colaboração.');
 for(const cut of round.sourceCut){const s=(state.snapshots||[]).find(s=>s.projectId===round.project&&s.period===cut.period&&s.level===cut.level);if(!s||fingerprint(s)!==cut.fingerprint)fail('A fonte congelada mudou. Inicie uma nova rodada antes de continuar.');}
 if(Date.parse(round.createdAt)>now+300000)fail('Data da colaboração no futuro.');
}
function evidence(state,round,refs){
 if(!Array.isArray(refs)||refs.length<1||refs.length>collaborationLimits.evidenceRefs)fail(`Informe de 1 a ${collaborationLimits.evidenceRefs} referências de evidência.`);
 const seen=new Set();return refs.map(ref=>{
  if(!ref||typeof ref!=='object')fail('Referência de evidência inválida.');
  if(ref.empty!==undefined&&typeof ref.empty!=='boolean')fail('Marcador de fonte vazia inválido.');
  if(ref.empty===true&&(ref.adAccountId!==undefined||ref.externalId!==undefined))fail('Fonte vazia não pode inventar conta ou objeto.');
  if(ref.projectId!==undefined&&ref.projectId!==round.project)fail('Evidência pertence a outro projeto.');
  const normalized={period:ref.period,level:ref.level,...(ref.empty===true?{empty:true}:{adAccountId:text(ref.adAccountId,'Conta da evidência',250),externalId:text(ref.externalId,'Objeto da evidência',250)}),fetchedAt:iso(ref.fetchedAt)};
  if(!periods.includes(normalized.period)||!levels.includes(normalized.level))fail('Janela ou nível da evidência inválido.');
  const cut=round.sourceCut.find(s=>s.period===normalized.period&&s.level===normalized.level&&Date.parse(s.fetchedAt)===Date.parse(normalized.fetchedAt));
  const source=cut&&(state.snapshots||[]).find(s=>s.projectId===round.project&&s.period===cut.period&&s.level===cut.level&&fingerprint(s)===cut.fingerprint);
  if(!source||source.complete!==true||(normalized.empty?source.rows.length!==0:!source.rows.some(r=>r.adAccountId===normalized.adAccountId&&r.externalId===normalized.externalId)))fail('Evidência não pertence à fonte congelada deste projeto, ou a fonte não está vazia.');
  const key=canonical(normalized);if(seen.has(key))fail('Referência de evidência repetida.');seen.add(key);return normalized;
 });
}
function assertLease(claim,args,now){if(!claim||claim.claimId!==args.claimId||claim.executionRef!==args.executionRef)fail('Reserva de execução não corresponde a esta tentativa.');if(Date.parse(claim.leaseUntil)<=now||Date.parse(claim.startedAt)>now)fail('Reserva da colaboração expirada.');}
/** Read-only identity/lease check shared by learning peer reviews. */
export function assertCollaborationWorker(state,args,now=Date.now()){
 now=time(now);const round=roundFor(state,args.roundId);active(state);context(state,round,now);
 const claim=Object.values(round.discussionClaims||{}).find(c=>c.claimId===args.claimId)||round.stages.find(c=>c.claimId===args.claimId);
 assertLease(claim,args,now);if(claim.status!=='Em análise')fail('A etapa já foi concluída.');
 if(round.sourceCut.some(c=>now-Date.parse(c.fetchedAt)>=60*60000||Date.parse(c.fetchedAt)>now))fail('Fonte vencida para a revisão do aprendizado.');
 return {project:round.project,agentId:claim.agentId};
}
function messageDigest(args){return fingerprint({claimId:args.claimId,executionRef:args.executionRef,toAgent:args.toAgent,kind:args.kind||'message',text:args.text,evidenceRefs:args.evidenceRefs,replyTo:args.replyTo||null,...(args.requiresReply===undefined?{}:{requiresReply:args.requiresReply}),...(args.summary===undefined?{}:{summary:args.summary}),...(args.reflection===undefined?{}:{reflection:args.reflection}),...(args.campaignReadings===undefined?{}:{campaignReadings:args.campaignReadings})});}
function proposalSeal(proposal){return fingerprint({id:proposal.id,roundId:proposal.roundId,project:proposal.project,version:proposal.version,expiresAt:proposal.expiresAt,supersedes:proposal.supersedes||null,payload:proposal.payload});}
function intact(proposal){if(proposal.signature!==proposalSeal(proposal))fail('Conteúdo da proposta mudou. A aprovação exige uma nova versão.');}
function proposalFor(state,value){const proposal=(state.proposals||[]).find(p=>p.id===value);if(!proposal)fail('Proposta não encontrada.');intact(proposal);return proposal;}
function available(proposal,now){if(Date.parse(proposal.expiresAt)<=now)fail('Proposta expirada. Solicite uma proposta atualizada.');}
function acquisitionOnly(state,project,payload){if(isWarmupTarget(state,project,payload.level,{adAccountId:payload.adAccountId,externalId:payload.objectId}))fail('Campanha de aquecimento/engajamento fora do fluxo de otimização de vendas.');}

/** Executor-only guard; confirmation may outlive the authorization, dispatch cannot. */
export function approvedExecutionProposal(state,args,now=Date.now(),confirmation=false){
 const proposal=proposalFor(state,args.proposalId);
 if(proposal.status!=='Aprovada'||proposal.approvedVersion!==proposal.version||proposal.approvedSignature!==proposal.signature||args.version!==proposal.version||args.signature!==proposal.signature)fail('Execução exige aprovação do dono para esta versão e assinatura exatas.');
 if(!confirmation){active(state);available(proposal,time(now));context(state,roundFor(state,proposal.roundId),time(now));acquisitionOnly(state,proposal.project,proposal.payload);assertFinancialSources(proposal.payload.sourceCut,time(now));if(proposal.payload.action==='status'&&proposal.payload.after.status==='ACTIVE'&&!proposal.payload.activationBudget)fail('Ativação sem contexto financeiro selado exige nova proposta e aprovação.');}
 return proposal;
}

/** Idempotently creates one frozen-source collaboration per completed collection. */
export function ensureCollaboration(state,job,now=Date.now()){
 init(state);now=time(now);job=jobFor(state,job);
 const existing=state.collaborationRounds.find(r=>r.jobId===job.id);if(existing)return existing;
 active(state);if(job.status!=='Concluída'||!job.startedAt||!job.completedAt)fail('Conclua a rodada de coleta antes da colaboração.');
 if(!own(state.config,job.project))fail('Projeto da colaboração não encontrado.');
 const sourceCut=collectSources(state,job,now);capacity(state.collaborationRounds,collaborationLimits.rounds,'colaborações');
 const round={id:id(),jobId:job.id,project:job.project,status:'Pendente',createdAt:iso(now),sourceCut:clone(sourceCut),sourceHash:fingerprint(sourceCut),configFingerprint:fingerprint(state.config[job.project]),stages:collaborationRoles.map(agentId=>({agentId,status:'Pendente',attempt:0}))};
 state.collaborationRounds.unshift(round);return round;
}

/** Read-only work plan. A lease is evidence of a connected worker claim, not online presence. */
export function collaborationPlan(state,now=Date.now()){
 now=time(now);const rounds=(state.collaborationRounds||[]).map(round=>{
  let blocked=null;try{context(state,round,now);}catch(error){blocked=error.message;}
  const messages=(state.collaborationMessages||[]).filter(m=>m.roundId===round.id),discussionPending=messages.filter(m=>m.kind==='message'&&(m.requiresReply??!m.replyTo)&&!messages.some(reply=>reply.replyTo===m.id&&reply.fromAgent===m.toAgent)).map(m=>({id:m.id,fromAgent:m.fromAgent,toAgent:m.toAgent}));
  const next=closedSystemRound(round,now)?null:round.stages.find(s=>s.status!=='Concluída');return {roundId:round.id,jobId:round.jobId,project:round.project,status:blocked?'Bloqueada':round.status,blocked,sourceCut:clone(round.sourceCut),sourceHash:round.sourceHash,...(round.systemReview?{systemReview:clone(round.systemReview)}:{}),nextAgent:state.paused||blocked?null:next?.agentId||null,stages:clone(round.stages),discussionClaims:clone(round.discussionClaims||{}),discussionPending,claimed:!!next?.claimId&&Date.parse(next.leaseUntil)>now};
 });
 const proposals=(state.proposals||[]).map(p=>({id:p.id,roundId:p.roundId,project:p.project,version:p.version,signature:p.signature,status:!terminalProposal.has(p.status)&&Date.parse(p.expiresAt)<=now?'Expirada':p.status,expiresAt:p.expiresAt,reviewAgents:p.status==='Em revisão'?['budget',...(['traffic','creative'].some(agentId=>p.reviews.some(r=>r.actor==='agent'&&r.agentId===agentId&&r.decision==='approve'))?[]:['traffic','creative'])].filter(agentId=>!p.reviews.some(r=>r.actor==='agent'&&r.agentId===agentId)):[]}));
 return {paused:!!state.paused,rounds,proposals};
}

/**
 * Compacts only settled/obsolete work. The caller must persist every returned
 * archive and the returned central state atomically; never commit central alone.
 * No valid outstanding work or unexpired owner authorization is discarded.
 */
export function compactCollaboration(state,now=Date.now()){
 init(state);now=time(now);const archives=[],closedByProject=new Map(),retained=new Set();
 for(const round of state.collaborationRounds){
  const proposals=state.proposals.filter(p=>p.roundId===round.id);let invalid=null;
  try{context(state,round,now);}catch(error){invalid=error.message;}
  if(invalid){
   round.status='Fonte substituída';round.sourceInvalidatedAt||=iso(now);round.sourceInvalidationReason||=invalid;
   for(const proposal of proposals)if(!terminalProposal.has(proposal.status)){proposal.status='Fonte substituída';proposal.sourceInvalidatedAt||=iso(now);}
  }
  for(const proposal of proposals){
   if(Date.parse(proposal.expiresAt)<=now){
    if(proposal.status==='Aprovada')proposal.authorizationExpiredAt||=iso(now);
    else if(!terminalProposal.has(proposal.status)){proposal.status='Expirada';proposal.expiredAt||=iso(now);}
   }
  }
  const awaiting=proposals.some(p=>!terminalProposal.has(p.status)&&Date.parse(p.expiresAt)>now);
  const approvedUnapplied=proposals.some(p=>p.status==='Aprovada'&&Date.parse(p.expiresAt)>now&&!p.appliedAt&&!p.confirmedAt&&!p.execution?.confirmedAt);
  const proposalIds=new Set(proposals.map(p=>p.id)),executionPending=(state.executions||[]).some(e=>proposalIds.has(e.proposalId)&&(['Enviada','Verificação necessária'].includes(e.status)||['Reservada','Preparada'].includes(e.status)&&Date.parse(e.leaseUntil)>now&&proposals.some(p=>p.id===e.proposalId&&p.status==='Aprovada'&&Date.parse(p.expiresAt)>now)));
  if(executionPending||approvedUnapplied||!invalid&&(awaiting||!closedSystemRound(round,now)&&!['Concluída','Bloqueada','Cancelada','Falhou','Sem campanhas elegíveis'].includes(round.status))){retained.add(round.id);continue;}
  const settled=closedByProject.get(round.project)||[];settled.push(round);closedByProject.set(round.project,settled);
 }
 for(const settled of closedByProject.values()){
  settled.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
  for(const round of settled.slice(0,2))retained.add(round.id);
 }
 for(const round of state.collaborationRounds)if(!retained.has(round.id)){const proposals=state.proposals.filter(p=>p.roundId===round.id),proposalIds=new Set(proposals.map(p=>p.id));archives.push({key:'collaboration:'+round.id,payload:{type:'bunker-collaboration',version:1,archivedAt:iso(now),round:clone(round),messages:clone(state.collaborationMessages.filter(m=>m.roundId===round.id)),proposals:clone(proposals),executions:clone((state.executions||[]).filter(e=>proposalIds.has(e.proposalId)))}});}
 const archived=new Set(archives.map(a=>a.payload.round.id));
 const suggestions=state.cardSuggestions||[];
 if(!Array.isArray(suggestions))fail('Arquivo de sugestões inválido.');
 const idCounts=new Map();for(const suggestion of suggestions)idCounts.set(suggestion.id,(idCounts.get(suggestion.id)||0)+1);
 const archivedSuggestions=new Set(suggestions.filter(s=>typeof s.id==='string'&&idCounts.get(s.id)===1&&archived.has(s.roundId)).map(s=>s.id));
 // A batch is one durable receipt, including semantic reuses shared with other
 // batches. Retain the whole connected group if any member must stay central,
 // is missing, or cannot be identified unambiguously. Never split its receipt.
 let changed;
 do{
  changed=false;
  for(const suggestion of suggestions){
   const receipts=[...(suggestion.batchReceipt?[suggestion.batchReceipt]:[]),...(Array.isArray(suggestion.batchReceipts)?suggestion.batchReceipts:[])];
   for(const receipt of receipts){
    const members=[suggestion.id,...(Array.isArray(receipt?.recordIds)?receipt.recordIds:[])];
    if(!Array.isArray(receipt?.recordIds)||!receipt.recordIds.length||members.some(member=>!archivedSuggestions.has(member)))for(const member of members)if(archivedSuggestions.delete(member))changed=true;
   }
  }
 }while(changed);
 for(const archive of archives)archive.payload.cardSuggestions=clone(suggestions.filter(s=>archivedSuggestions.has(s.id)&&s.roundId===archive.payload.round.id));
  // Keep a small confirmed receipt next to the choice, while its full immutable
  // journal remains in the transactionally persisted collaboration archive.
  retainChoiceResolutions(state,archives,now);
 retainAgentEpisodes(state,archives);
 const archivedProposalIds=new Set(archives.flatMap(a=>a.payload.proposals.map(p=>p.id)));
 state.collaborationRounds=state.collaborationRounds.filter(r=>!archived.has(r.id));state.collaborationMessages=state.collaborationMessages.filter(m=>!archived.has(m.roundId));state.proposals=state.proposals.filter(p=>!archived.has(p.roundId));
 if(state.cardSuggestions)state.cardSuggestions=suggestions.filter(s=>!archivedSuggestions.has(s.id));
 if(state.executions)state.executions=state.executions.filter(e=>!archivedProposalIds.has(e.proposalId));
 return {state,archives};
}

/** Claims the next perspective, an addressed discussion reply, or independent review. */
export function claimCollaboration(state,args,now=Date.now()){
 now=time(now);const round=roundFor(state,args.roundId);active(state);context(state,round,now);
 if(systemRoundReviewKind(round))fail('A triagem desta fonte foi encerrada. Uma nova fonte exige nova rodada.');
 const agentId=role(args.agentId),executionRef=text(args.executionRef,'Referência da execução conectada',500),clientId=client(args.clientId);
 let target;
 if(args.proposalId&&args.replyTo)fail('Reserve uma revisão ou uma resposta por vez.');
 if(args.replyTo){
  const parent=state.collaborationMessages.find(m=>m.roundId===round.id&&m.id===args.replyTo);
  if(!parent||parent.toAgent!==agentId||parent.fromAgent===agentId)fail('Reserve apenas respostas a mensagens recebidas nesta colaboração.');
  round.discussionClaims||={};target=round.discussionClaims[agentId]||{agentId,status:'Pendente',attempt:0};
  if(target.clientId===clientId){if(target.executionRef!==executionRef||target.replyTo!==args.replyTo)fail('clientId já usado por outra execução ou resposta.');return target;}
  if(target.status==='Em análise'&&Date.parse(target.leaseUntil)>now)fail('Uma resposta desse agente já está reservada por outra execução.');
  if(state.collaborationMessages.some(m=>m.roundId===round.id&&m.replyTo===parent.id&&m.fromAgent===agentId))fail('Esta mensagem já recebeu a resposta imutável do agente.');
  if(target.replyTo!==args.replyTo)target={agentId,status:'Pendente',attempt:0};
 }else if(args.proposalId){
  const proposal=proposalFor(state,args.proposalId);if(proposal.roundId!==round.id)fail('Proposta pertence a outra colaboração.');available(proposal,now);
  if(proposal.status!=='Em revisão'||agentId==='ops')fail('Esta proposta não aceita revisão desse agente.');
  if(proposal.reviews.some(r=>r.actor==='agent'&&r.agentId===agentId))fail('Este agente já registrou um parecer imutável.');
  proposal.reviewClaims||={};target=proposal.reviewClaims[agentId]||{agentId,status:'Pendente',attempt:0};
 }else{
  target=round.stages.find(s=>s.agentId===agentId);
  if(target.clientId===clientId){if(target.executionRef!==executionRef)fail('clientId já usado por outra execução.');return target;}
  if(round.stages.find(s=>s.status!=='Concluída')!==target)fail('Respeite a sequência tráfego, criativos, orçamento e gestão.');
 }
 if(target.clientId===clientId){if(target.executionRef!==executionRef)fail('clientId já usado por outra execução.');return target;}
 if(target.status==='Em análise'&&Date.parse(target.leaseUntil)>now)fail('A etapa já está reservada por outra execução.');
 if(target.attempt>=collaborationLimits.attempts)fail('Limite de tentativas atingido. Uma nova rodada deve revisar a pendência.');
 const next={agentId,status:'Em análise',attempt:target.attempt+1,claimId:id(),executionRef,clientId,startedAt:iso(now),leaseUntil:iso(now+collaborationLimits.leaseMs)};
 if(args.replyTo){next.replyTo=args.replyTo;round.discussionClaims[agentId]=next;round.updatedAt=iso(now);}
 else if(args.proposalId)proposalFor(state,args.proposalId).reviewClaims[agentId]=next;else{Object.assign(target,next);round.status='Em análise';round.updatedAt=iso(now);}
 return args.proposalId||args.replyTo?next:target;
}

/** Posts authored evidence. A conclusion is the only way to finish a role's stage. */
export function postCollaboration(state,args,now=Date.now()){
 now=time(now);const round=roundFor(state,args.roundId),clientId=client(args.clientId),summary=normalizeAgentSummary(args.summary),digest=messageDigest(args);
 const replay=state.collaborationMessages.find(m=>m.roundId===round.id&&m.clientId===clientId);
 if(replay){if(replay.requestFingerprint!==digest)fail('clientId já usado com outro conteúdo.');return replay;}
 active(state);context(state,round,now);
 const discussion=Object.values(round.discussionClaims||{}).find(s=>s.claimId===args.claimId),stage=discussion||round.stages.find(s=>s.claimId===args.claimId);assertLease(stage,args,now);if(stage.status!=='Em análise')fail('A etapa já foi concluída.');
 const toAgent=role(args.toAgent);if(toAgent===stage.agentId)fail('A mensagem deve ser dirigida a outro agente.');
 const kind=args.kind||'message';if(!['message','conclusion'].includes(kind))fail('Tipo de mensagem inválido.');
 if(args.requiresReply!==undefined&&typeof args.requiresReply!=='boolean')fail('requiresReply precisa ser booleano.');
 if(discussion&&(kind!=='message'||args.replyTo!==discussion.replyTo))fail('A reserva de discussão permite somente a resposta exata; conclusões anteriores são imutáveis.');
 const body=text(args.text,'Mensagem',6000),refs=evidence(state,round,args.evidenceRefs);
 const reflection=normalizeAgentReflection(args.reflection,{state,round,agentId:stage.agentId,evidenceRefs:refs});
 const campaignReadings=normalizeCampaignReadings(args.campaignReadings,{state,round,role:stage.agentId,evidenceRefs:refs});
 const messages=state.collaborationMessages.filter(m=>m.roundId===round.id);
 if(args.replyTo){const parent=messages.find(m=>m.id===args.replyTo);if(!parent||parent.toAgent!==stage.agentId||parent.fromAgent===stage.agentId||discussion&&toAgent!==parent.fromAgent)fail('A resposta deve referenciar uma mensagem recebida nesta colaboração e voltar ao autor.');}
 capacity(state.collaborationMessages,collaborationLimits.messages,'mensagens de colaboração');capacity(messages,collaborationLimits.messagesPerRound,'mensagens nesta colaboração');
 if(kind==='message')capacity(messages.filter(m=>m.kind==='message'),collaborationLimits.questionsPerRound,'perguntas nesta colaboração');
 const message={id:id(),roundId:round.id,project:round.project,fromAgent:stage.agentId,toAgent,kind,text:body,...(summary?{summary}:{}),...(reflection?{reflection}:{}),...(campaignReadings?{campaignReadings}:{}),evidenceRefs:refs,replyTo:args.replyTo||null,requiresReply:kind==='message'?(args.requiresReply??!args.replyTo):false,executionRef:stage.executionRef,attempt:stage.attempt,claimId:stage.claimId,createdAt:iso(now),clientId,requestFingerprint:digest};
 state.collaborationMessages.push(message);recordCampaignCoverage(state,message,round);
 if(discussion){discussion.status='Concluída';discussion.completedAt=iso(now);discussion.responseId=message.id;}
 if(kind==='conclusion'){stage.status='Concluída';stage.completedAt=iso(now);stage.conclusionId=message.id;if(stage.agentId==='ops'){round.status='Concluída';round.completedAt=iso(now);}}
 round.updatedAt=iso(now);return message;
}

function activationBudgetContext(state,round,target,level){
 const hasBudget=row=>Number.isFinite(row?.dailyBudget)&&row.dailyBudget>0||Number.isFinite(row?.lifetimeBudget)&&row.lifetimeBudget>0;
 const find=(wantedLevel,externalId)=>{
  if(!externalId)fail('Ativação exige a fonte de hoje do pai financeiro e seu vínculo com o objeto.');
  const cut=round.sourceCut.find(c=>c.period==='today'&&c.level===wantedLevel),snapshot=cut&&(state.snapshots||[]).find(s=>s.projectId===round.project&&s.period==='today'&&s.level===wantedLevel&&fingerprint(s)===cut.fingerprint);
  const rows=(snapshot?.rows||[]).filter(r=>r.adAccountId===target.adAccountId&&r.externalId===externalId);
  if(rows.length!==1)fail('Ativação exige a fonte de hoje do pai financeiro na coleta congelada.');
  return rows[0];
 };
 let owner=target,ownerLevel=level;
 if(level==='ad'){
  owner=find('adset',target.adsetExternalId);ownerLevel='adset';
  if(target.campaignExternalId&&owner.campaignExternalId!==target.campaignExternalId)fail('Vínculo do conjunto com a campanha não confere.');
 }
 if(ownerLevel==='adset'&&!hasBudget(owner)){owner=find('campaign',owner.campaignExternalId);ownerLevel='campaign';}
 if(!hasBudget(owner))fail('Ativação exige o orçamento proprietário confirmado; campanha ABO requer contexto financeiro dos conjuntos.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner.id||''))fail('Ativação exige UUID interno confirmado do proprietário do orçamento.');
 if(owner.provider!==target.provider||owner.budgetCurrency!==target.budgetCurrency)fail('Provedor ou moeda do pai financeiro não confere com o objeto.');
 for(const field of ['dailyBudget','lifetimeBudget'])if(owner[field]!=null&&(!Number.isFinite(owner[field])||owner[field]<0||owner[field]>1e9))fail('Orçamento proprietário inválido.');
 if(owner.dailyBudget>0&&owner.lifetimeBudget>0)fail('Proprietário com diário e vitalício simultâneos exige conciliação.');
 return {budgetOwner:ownerLevel==='campaign'?'CBO':'ABO',level:ownerLevel,id:owner.id,externalId:owner.externalId,adAccountId:owner.adAccountId,provider:owner.provider,currency:owner.budgetCurrency,dailyBudget:owner.dailyBudget??null,lifetimeBudget:owner.lifetimeBudget??null,status:text(owner.status,'Status do proprietário na fonte',100)};
}

function normalizeProposal(state,round,input){
 if(!input||typeof input!=='object')fail('Informe o conteúdo da proposta.');
 const action=input.action;if(!['budget','status'].includes(action))fail('Ação proposta inválida.');
 const level=input.level;if(!['campaign','adset','ad'].includes(level))fail('Nível da proposta inválido.');
 if(action==='budget'&&level==='ad')fail('Anúncio não possui orçamento próprio.');
 const adAccountId=text(input.adAccountId,'Conta',250),objectId=text(input.objectId,'Objeto',250),currency=text(input.currency,'Moeda nativa',3).toUpperCase();if(!/^[A-Z]{3}$/.test(currency))fail('Moeda nativa inválida.');
 const refs=evidence(state,round,input.evidenceRefs);
 if(!refs.some(r=>r.period==='today'&&r.level===level&&r.adAccountId===adAccountId&&r.externalId===objectId))fail('A proposta precisa da leitura de hoje do objeto exato.');
 const source=(state.snapshots||[]).find(s=>s.projectId===round.project&&s.period==='today'&&s.level===level),row=source?.rows.find(r=>r.adAccountId===adAccountId&&r.externalId===objectId);
 if(!row)fail('Objeto da proposta ausente da fonte.');
 acquisitionOnly(state,round.project,{level,adAccountId,objectId});
 const provider=text(input.provider,'Provedor',80);if(!row.provider||row.provider!==provider)fail('Provedor do objeto não foi confirmado na fonte.');
 if(!row.budgetCurrency||row.budgetCurrency.toUpperCase()!==currency)fail('Moeda nativa do objeto não foi confirmada na fonte.');
 const before={},after={};
 if(action==='budget'){
  if(!['CBO','ABO'].includes(input.budgetOwner)||input.budgetOwner!==(level==='campaign'?'CBO':'ABO'))fail('Confirme o nível proprietário do orçamento CBO/ABO.');
  for(const [object,value] of [[before,input.before?.dailyBudget],[after,input.after?.dailyBudget]]){if(!Number.isFinite(value)||value<0||value>1e9)fail('Orçamento diário nativo inválido.');object.dailyBudget=value;}
  if(row.dailyBudget!==before.dailyBudget||row.lifetimeBudget>0)fail('O orçamento anterior não confere com a verba diária nativa da fonte.');
  if(before.dailyBudget===after.dailyBudget)fail('A proposta precisa alterar o orçamento.');
 }else{
  before.status=text(input.before?.status,'Status anterior',100);after.status=text(input.after?.status,'Novo status',100);
  if(before.status!==row.status||!['ACTIVE','PAUSED'].includes(after.status)||before.status===after.status)fail('O status proposto não confere com o objeto da fonte.');
 }
 if(!Array.isArray(input.opinionRefs)||input.opinionRefs.length!==3||new Set(input.opinionRefs).size!==3)fail('Referencie as três conclusões de tráfego, criativos e orçamento.');
 const opinions=input.opinionRefs.map(opinionId=>state.collaborationMessages.find(m=>m.id===opinionId&&m.roundId===round.id&&m.kind==='conclusion'));
 if(['traffic','creative','budget'].some(agentId=>!opinions.some(m=>m?.fromAgent===agentId&&round.stages.find(s=>s.agentId===agentId)?.conclusionId===m.id)))fail('Pareceres devem ser conclusões reais já persistidas nesta colaboração.');
 for(const opinion of opinions)if(!opinion.evidenceRefs.some(ref=>{
  if(ref.adAccountId!==adAccountId)return false;
  if(ref.level===level&&ref.externalId===objectId)return true;
  const snapshot=(state.snapshots||[]).find(s=>s.projectId===round.project&&s.period===ref.period&&s.level===ref.level),object=snapshot?.rows.find(r=>r.adAccountId===ref.adAccountId&&r.externalId===ref.externalId);
  return level==='campaign'&&object?.campaignExternalId===objectId||level==='adset'&&object?.adsetExternalId===objectId;
 }))fail('Cada parecer deve conter evidência do objeto proposto ou de sua hierarquia.');
 const risks=input.risks??[];if(!Array.isArray(risks)||risks.length>12)fail('Lista de riscos inválida.');
 // Display names are also approval scope: derive them from the exact source row.
 return {title:text(input.title,'Título',250),reason:text(input.reason,'Motivo',4000),action,level,provider,adAccountId,objectId,objectName:text(row.name,'Nome do objeto na fonte',500),accountName:text(row.accountName,'Nome da conta na fonte',500),currency,budgetOwner:action==='budget'?input.budgetOwner:null,before,after,...(action==='status'&&after.status==='ACTIVE'?{activationBudget:activationBudgetContext(state,round,row,level)}:{}),sourceCut:clone(round.sourceCut),sourceHash:round.sourceHash,evidenceRefs:refs,opinionRefs:[...input.opinionRefs],risks:risks.map(r=>text(r,'Risco',500))};
}

/** Only the claimed operations role can submit a proposal after three real perspectives. */
export function submitProposal(state,args,now=Date.now()){
 now=time(now);const round=roundFor(state,args.roundId),clientId=client(args.clientId);
 const digest=fingerprint({claimId:args.claimId,executionRef:args.executionRef,payload:args.payload,expiresAt:args.expiresAt,supersedes:args.supersedes||null});
 const replay=state.proposals.find(p=>p.roundId===round.id&&p.clientId===clientId);if(replay){if(replay.requestFingerprint!==digest)fail('clientId já usado com outra proposta.');intact(replay);return replay;}
 active(state);context(state,round,now);const stage=round.stages.find(s=>s.agentId==='ops');assertLease(stage,args,now);
 if(!['Em análise','Concluída'].includes(stage.status))fail('A gestão precisa assumir a etapa antes de propor.');
 if(round.stages.slice(0,3).some(s=>s.status!=='Concluída'))fail('Faltam perspectivas reais antes da proposta.');
 const payload=normalizeProposal(state,round,args.payload),expiresAt=time(args.expiresAt);if(expiresAt<=now||expiresAt>now+collaborationLimits.validityMs)fail('Validade da proposta deve ser futura e de no máximo 24 horas.');
 let version=1,supersedes=null;
 if(args.supersedes){const previous=proposalFor(state,args.supersedes);if(previous.roundId!==round.id||previous.payload.adAccountId!==payload.adAccountId||previous.payload.objectId!==payload.objectId||previous.payload.action!==payload.action||!['Recusada','Revisão solicitada','Expirada'].includes(previous.status)&&Date.parse(previous.expiresAt)>now)fail('A versão anterior precisa ter o mesmo objeto e estar recusada, em revisão solicitada ou expirada.');if(state.proposals.some(p=>p.supersedes===previous.id))fail('Esta proposta já possui uma versão substituta.');supersedes=previous.id;version=previous.version+1;}
 else if(state.proposals.some(p=>p.roundId===round.id&&p.payload.adAccountId===payload.adAccountId&&p.payload.objectId===payload.objectId&&p.payload.action===payload.action))fail('Já existe proposta para este objeto e ação. Use uma nova versão explícita.');
 capacity(state.proposals,collaborationLimits.proposals,'propostas');capacity(state.proposals.filter(p=>p.roundId===round.id),collaborationLimits.proposalsPerRound,'propostas nesta colaboração');
 const proposal={id:id(),roundId:round.id,project:round.project,version,status:'Em revisão',createdAt:iso(now),expiresAt:iso(expiresAt),createdBy:'ops',executionRef:stage.executionRef,payload,supersedes,reviews:[],reviewClaims:{},clientId,requestFingerprint:digest};
 proposal.signature=proposalSeal(proposal);state.proposals.unshift(proposal);return proposal;
}

/** Actor is trusted API context, never a value copied from the client request. */
export function reviewProposal(state,args,actor,now=Date.now()){
 now=time(now);init(state);const proposal=proposalFor(state,args.id),clientId=client(args.clientId);
 if(!actor||!['owner','agent'].includes(actor.kind))fail('Revisor autenticado obrigatório.');
 const actorKey=actor.kind==='owner'?'owner:'+text(actor.id,'Identidade do dono',250):'agent:'+role(actor.agentId);
 const decision=args.decision;if(!['approve','reject','revise'].includes(decision))fail('Parecer inválido.');
 const comment=actor.kind==='owner'&&decision==='approve'&&(args.comment===undefined||typeof args.comment==='string'&&!args.comment.trim())?'Versão exibida aprovada pelo dono.':text(args.comment,'Comentário do parecer',4000);
 if(args.version!==proposal.version||args.signature!==proposal.signature)fail('Versão ou assinatura da proposta não confere. Atualize antes de decidir.');
 const digest=fingerprint({actorKey,decision,comment,version:args.version,signature:args.signature,claimId:args.claimId||null,executionRef:args.executionRef||null});
 const replay=proposal.reviews.find(r=>r.clientId===clientId);if(replay){if(replay.requestFingerprint!==digest)fail('clientId já usado com outro parecer.');return proposal;}
 if(terminalProposal.has(proposal.status))fail('Proposta já encerrada. O parecer entregue é imutável.');
 // A refusal may close even stale work; approval always requires current evidence.
 if(decision==='approve'){active(state);available(proposal,now);context(state,roundFor(state,proposal.roundId),now);acquisitionOnly(state,proposal.project,proposal.payload);if(proposal.payload.action==='status'&&proposal.payload.after.status==='ACTIVE'&&!proposal.payload.activationBudget)fail('Ativação sem contexto financeiro selado exige nova proposta e aprovação.');}
 if(actor.kind==='owner'){
  if(proposal.status!=='Aguardando aprovação')fail('Aguarde os pareceres dos agentes antes de decidir.');
 }else{
  active(state);available(proposal,now);context(state,roundFor(state,proposal.roundId),now);
  if(actor.agentId==='ops'||proposal.status!=='Em revisão')fail('O autor da proposta não pode realizar a revisão independente.');
  if(proposal.reviews.some(r=>r.actor==='agent'&&r.agentId===actor.agentId))fail('Este agente já registrou seu parecer imutável.');
  assertLease(proposal.reviewClaims?.[actor.agentId],args,now);
 }
 capacity(proposal.reviews,collaborationLimits.reviewsPerProposal,'pareceres da proposta');
 const record={id:id(),actor:actor.kind,actorId:actor.kind==='owner'?actor.id:null,agentId:actor.kind==='agent'?actor.agentId:null,decision,comment,version:proposal.version,signature:proposal.signature,createdAt:iso(now),clientId,requestFingerprint:digest};
 if(actor.kind==='agent'){record.executionRef=args.executionRef;record.claimId=args.claimId;proposal.reviewClaims[actor.agentId].status='Concluída';proposal.reviewClaims[actor.agentId].completedAt=iso(now);}
 proposal.reviews.push(record);proposal.updatedAt=iso(now);
 if(decision==='reject')proposal.status='Recusada';else if(decision==='revise')proposal.status='Revisão solicitada';
 else if(actor.kind==='owner'){proposal.status='Aprovada';proposal.approvedAt=iso(now);proposal.approvedVersion=proposal.version;proposal.approvedSignature=proposal.signature;}
 else if(proposal.reviews.some(r=>r.actor==='agent'&&r.agentId==='budget'&&r.decision==='approve')&&proposal.reviews.some(r=>r.actor==='agent'&&['traffic','creative'].includes(r.agentId)&&r.decision==='approve'))proposal.status='Aguardando aprovação';
 return proposal;
}
