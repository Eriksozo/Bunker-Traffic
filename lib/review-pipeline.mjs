import {duePlan} from './cadence.mjs';
import {collaborationPlan,fingerprint} from './collaboration.mjs';
import {sum} from './analysis.mjs';

const list=v=>Array.isArray(v)?v:[];
const time=v=>Number.isFinite(Date.parse(v))?Date.parse(v):null;
const iso=v=>new Date(v).toISOString();
export const reviewSteps=[{id:'collection',name:'Coleta'},{id:'traffic',name:'Tráfego'},{id:'creative',name:'Criativos'},{id:'budget',name:'Orçamento'},{id:'ops',name:'Síntese'}];
const request=(projectId,section,extra={})=>({tool:'bunker_atualizar_rodada',arguments:{id:'review-data',status:'Pendente',revision:0,note:JSON.stringify({action:'read',projectId,section,...extra})}});

/** Actual persisted milestones, not simulated agent presence or an estimated % of time. */
export function reviewPipeline(state,project='all',now=Date.now()){
 const schedule=duePlan(state,new Date(now)),workflow=collaborationPlan(state,now);
 const ids=project==='all'?Object.keys(state.config||{}):Object.hasOwn(state.config||{},project)?[project]:[];
 const projects=ids.map(id=>{
  const jobs=list(state.jobs).filter(j=>j.project===id).slice().sort((a,b)=>(time(b.createdAt)||0)-(time(a.createdAt)||0));
  const pending=jobs.find(j=>j.status==='Pendente');
  const job=jobs.find(j=>j.id===state.agents?.[id]?.jobId)||jobs[0];
  const round=list(state.collaborationRounds).filter(r=>r.project===id&&r.jobId===job?.id).at(-1);
  const view=workflow.rounds.find(r=>r.roundId===round?.id);
  const collectionLive=job?.status==='Em análise'&&time(job.startedAt)!==null&&time(job.startedAt)<=now&&now-time(job.startedAt)<45*60000;
  const collectionExpired=job?.status==='Em análise'&&!collectionLive;
  const cut=['7d','3d','yesterday','today'].map(period=>list(state.snapshots).find(s=>s.projectId===id&&s.period===period&&s.level==='campaign'));
  const collected=cut.filter(s=>s?.complete===true&&time(s.fetchedAt)!==null&&time(job?.startedAt)!==null&&time(s.fetchedAt)>=time(job.startedAt)).length;
  const stages=reviewSteps.map(step=>{
   if(step.id==='collection')return {...step,status:job?.status==='Concluída'?'Concluída':collectionLive?'Em análise':'Pendente',at:job?.completedAt||job?.updatedAt||job?.startedAt||null};
   const stage=round?.stages?.find(s=>s.agentId===step.id);
   return {...step,status:stage?.status==='Em análise'&&!(time(stage.leaseUntil)>now)?'Pendente':stage?.status||'Pendente',at:stage?.completedAt||stage?.startedAt||null,leaseUntil:stage?.leaseUntil||null};
  });
  const proposals=list(state.proposals).filter(p=>p.project===id&&p.roundId===round?.id&&time(p.expiresAt)>now&&!p.appliedAt);
  const waitingOwner=proposals.filter(p=>p.status==='Aguardando aprovação').length;
  const reviewing=proposals.filter(p=>p.status==='Em revisão').length;
  const submitted=list(state.executions).filter(e=>e.project===id&&e.submittedAt&&e.status!=='Confirmada').length;
  const done=!!round&&!view?.blocked&&stages.every(s=>s.status==='Concluída');
  const active=collectionLive||!!round&&!done&&!view?.blocked;
  const stage=stages.find(s=>s.status!=='Concluída');
  const lastAt=[job?.updatedAt,job?.completedAt,job?.startedAt,round?.updatedAt,...stages.map(s=>s.at)].filter(v=>time(v)!==null&&time(v)<=now).sort((a,b)=>time(b)-time(a))[0]||null;
  const held=schedule.held.find(h=>h.project===id)?.reason;
  const blocked=view?.blocked||null;
  const status=state.paused?'Pausado':submitted?'Conferência pendente':waitingOwner?'Aguardando sua aprovação':reviewing?'Revisão da proposta':blocked?'Releitura necessária':collectionExpired?'Coleta expirada':job?.status==='Falhou'?'Falha na coleta':job?.status==='Cancelada'?'Coleta cancelada':done?'Análise concluída':active?(stage?.status==='Em análise'?stage.name+' em andamento':'Aguardando '+(stage?.name||'análise').toLowerCase()):pending?'Na fila':'Aguardando revisão';
  const started=time(job?.startedAt),finished=time(round?.completedAt);
  return {id,name:state.config[id].projectName,jobId:job?.id||null,pendingJobId:pending?.id||null,roundId:round?.id||null,status,stages,completed:stages.filter(s=>s.status==='Concluída').length,collected,startedAt:job?.startedAt||null,lastAt,completedAt:round?.completedAt||null,durationSeconds:started!==null&&finished!==null&&finished>=started?Math.round((finished-started)/1000):null,elapsedSeconds:active&&started!==null&&started<=now?Math.round((now-started)/1000):null,stalled:!!active&&!!lastAt&&now-time(lastAt)>300000,blocked,held,waitingOwner,reviewing,submitted,suggestions:list(state.cardSuggestions).filter(s=>s.project===id&&s.roundId===round?.id).length,canRequest:!state.paused&&!pending&&!active&&!held,contextRequest:request(id,'context',round?{roundId:round.id}:{})};
 });
 return {version:1,paused:!!state.paused,generatedAt:iso(now),projects,counts:{projects:projects.length,active:projects.filter(p=>p.elapsedSeconds!==null).length,queued:projects.filter(p=>p.pendingJobId).length,completed:projects.filter(p=>p.status==='Análise concluída').length,awaitingApproval:projects.reduce((n,p)=>n+p.waitingOwner,0)},nextAutomatic:schedule.reason,policy:'Progresso vem de registros confirmados. O executor na nuvem consulta a Malva e processa os agentes quando ativado; a dashboard controla pedidos, mostra resultados e recebe aprovações. Nenhuma presença online ou duração futura é presumida.'};
}

/** Owner queue request, atomic and idempotent. No sources, claims or ad status change. */
export function requestReviewBatch(state,input,ownerId,now=Date.now()){
 if(!ownerId||typeof input.clientId!=='string'||!input.clientId.trim()||input.clientId.length>150)throw Error('Pedido autenticado e identificador são obrigatórios.');
 const ids=input.projectIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!Object.hasOwn(state.config||{},id)))throw Error('Selecione projetos configurados, sem repetir.');
 const signature=fingerprint({ownerId,projectIds:[...ids].sort()});
 const receipt=list(state.reviewRequests).find(r=>r.clientId===input.clientId);
 if(receipt){if(receipt.signature!==signature)throw Error('Identificador usado em outro pedido.');return receipt;}
 if(state.paused)throw Error('Retome o painel antes de solicitar uma revisão.');
 const progress=reviewPipeline(state,'all',now),draft=structuredClone(state),at=iso(now);
 const items=ids.map(id=>{
  const p=progress.projects.find(p=>p.id===id);
  if(p.pendingJobId)return {project:id,status:'Já na fila',jobId:p.pendingJobId};
  if(!p.canRequest)return {project:id,status:'Em acompanhamento',jobId:p.jobId,reason:p.held||p.blocked||p.status};
  const job={id:crypto.randomUUID(),project:id,status:'Pendente',createdAt:at,requestedBy:ownerId};
  draft.jobs.unshift(job);return {project:id,status:'Na fila',jobId:job.id};
 });
 const record={id:crypto.randomUUID(),clientId:input.clientId,signature,createdAt:at,ownerId,items};
 draft.reviewRequests=[...list(draft.reviewRequests),record].slice(-30);
 draft.events.unshift({id:crypto.randomUUID(),at,text:`Revisão solicitada pela dashboard: ${items.filter(i=>i.status==='Na fila').length} projetos adicionados à fila.`});
 draft.events=draft.events.slice(0,120);Object.assign(state,draft);return record;
}

/** Bounded project context. Pagination is fenced to the exact sealed snapshot. */
export function readReviewContext(state,args={},now=Date.now()){
 if(args.action!=='read')throw Error('Este canal é somente de leitura.');
 const project=args.projectId;
 if(!Object.hasOwn(state.config||{},project))throw Error('Projeto não configurado.');
 const section=args.section||'context';
 if(section==='execution'){
  if(!args.proposalId&&!args.executionId)throw Error('Informe a proposta ou execução exata.');
  const execution=args.executionId?list(state.executions).find(e=>e.id===args.executionId&&e.project===project):null;
  if(args.executionId&&!execution)throw Error('Execução não encontrada neste projeto.');
  if(execution&&args.proposalId&&execution.proposalId!==args.proposalId)throw Error('Proposta e execução incompatíveis.');
  const proposal=list(state.proposals).find(p=>p.project===project&&p.id===(args.proposalId||execution?.proposalId));
  if(!proposal)throw Error('Proposta não encontrada neste projeto.');
  return {project,config:state.config[project],paused:!!state.paused,proposal,executions:list(state.executions).filter(e=>e.project===project&&e.proposalId===proposal.id),notice:'Somente leitura. Aprovação, envio e confirmação são estados distintos. Após submittedAt, não reenviar.'};
 }
 const round=args.roundId?list(state.collaborationRounds).find(r=>r.id===args.roundId&&r.project===project):null;
 if(args.roundId&&!round)throw Error('Rodada não encontrada neste projeto.');
 const view=round?collaborationPlan({...state,collaborationRounds:[round]},now).rounds[0]:null;
 const snapshots=list(state.snapshots).filter(s=>s.projectId===project);
 if(section==='context')return {project,projectName:state.config[project].projectName,config:state.config[project],paused:!!state.paused,round:view,pipeline:reviewPipeline(state,project,now),sources:snapshots.map(s=>({period:s.period,level:s.level,from:s.from,to:s.to,timezone:s.timezone,fetchedAt:s.fetchedAt,lastSyncAt:s.lastSyncAt,complete:s.complete,rowCount:list(s.rows).length,...(s.level==='campaign'?{totals:sum(s.rows)}:{}),readRequest:request(project,'sources',{...(round?{roundId:round.id}:{}),period:s.period,level:s.level,limit:25})})),incidents:list(state.incidents).filter(i=>i.project===project),recentChanges:list(state.campaignChanges).filter(c=>c.project===project).slice(-10),changesTruncated:list(state.campaignChanges).filter(c=>c.project===project).length>10,opinions:list(state.collaborationMessages).filter(m=>m.project===project&&m.roundId===round?.id),learningRead:{action:'learningRead',projectId:project},choicesRead:{action:'decisionRead',projectId:project,limit:20}};
 if(section!=='sources')throw Error('Seção de revisão inválida.');
 if(view?.blocked)throw Error('Fonte da rodada substituída ou bloqueada. Releia o contexto.');
 if(!['7d','3d','yesterday','today'].includes(args.period)||!['campaign','adset','ad','account'].includes(args.level))throw Error('Informe período e nível exatos.');
 if(args.objectId&&!args.adAccountId)throw Error('Informe a conta ao buscar um objeto.');
 const snapshot=snapshots.find(s=>s.period===args.period&&s.level===args.level);
 if(!snapshot)return {project,sourceAvailable:false,items:[],nextCursor:null};
 if(round&&!round.sourceCut.some(c=>c.period===snapshot.period&&c.level===snapshot.level&&c.fingerprint===fingerprint(snapshot)))throw Error('Fonte fora do recorte selado da rodada.');
 const limit=args.limit??25;if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Limite de 1 a 50 objetos.');
 const hash=fingerprint(snapshot),scope=fingerprint({project,roundId:args.roundId||null,period:args.period,level:args.level,adAccountId:args.adAccountId||null,objectId:args.objectId||null});
 let offset=0;if(args.cursor){try{const c=JSON.parse(atob(args.cursor));if(c.scope!==scope||c.hash!==hash||!Number.isInteger(c.offset)||c.offset<0)throw Error();offset=c.offset;}catch{throw Error('Cursor inválido ou fonte atualizada. Reinicie a leitura.');}}
 const rows=list(snapshot.rows).filter(r=>(!args.adAccountId||r.adAccountId===args.adAccountId)&&(!args.objectId||r.externalId===args.objectId));
 const {rows:ignored,...meta}=snapshot;
 return {project,sourceAvailable:true,source:meta,sourceHash:hash,items:rows.slice(offset,offset+limit),total:rows.length,nextCursor:offset+limit<rows.length?btoa(JSON.stringify({scope,hash,offset:offset+limit})):null};
}
