const list=value=>Array.isArray(value)?value:[];
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const jobKeys=['id','project','status','createdAt','startedAt','updatedAt','completedAt','expiredAt','slotKey'];
export const reviewReadRequest=(projectId,section='context',extra={})=>({tool:'bunker_atualizar_rodada',arguments:{id:'review-data',status:'Pendente',revision:0,note:JSON.stringify({action:'read',projectId,section,...extra})}});

/** MCP transport only: immutable journals remain in storage and the dashboard. */
export function briefAgentState(state){
 const jobs=list(state.jobs),selected=new Map();
 for(const project of Object.keys(state.config||{})){
  const owner=state.agents?.[project]?.jobId;
  const job=jobs.find(j=>j.id===owner)||jobs.find(j=>j.project===project);
  if(job)selected.set(job.id,job);
 }
 for(const job of jobs.filter(j=>['Pendente','Em análise'].includes(j.status)))selected.set(job.id,job);
 return {config:state.config,paused:state.paused,cadence:state.cadence,agents:Object.fromEntries(Object.entries(state.agents||{}).map(([id,a])=>[id,pick(a,['status','jobId','lastSuccessAt','startedAt','lastCheckAt'])])),jobs:[...selected.values()].map(j=>({...pick(j,jobKeys),...(j.status==='Falhou'&&j.note?{failureNote:String(j.note).slice(0,350)}:{})})),messages:list(state.messages).filter(m=>m.status==='Pendente').map(m=>pick(m,['id','project','agentId','agentName','agentRole','status','text','createdAt'])),snapshots:list(state.snapshots).map(s=>({...pick(s,['projectId','projectName','period','level','from','to','timezone','source','fetchedAt','lastSyncAt','complete','rowCount']),...(s.level==='campaign'?{totals:s.totals}:{})})),briefing:{historyOmitted:true,counts:Object.fromEntries(['reports','events','knowledge','collaborationMessages','ownerChoices','decisionHistory'].map(key=>[key,list(state[key]).length]))}};
}

export function briefAgentPlans(plan,state){
 const projects=Object.keys(state.config||{}),latest=new Map();
 for(const r of list(plan.collaboration?.rounds)){
  const owner=state.agents?.[r.project]?.jobId;
  if(!latest.has(r.project)||r.jobId===owner)latest.set(r.project,r);
 }
 const relevantIds=new Set([...list(plan.autonomous?.ready).map(w=>w.roundId),...list(plan.collaboration?.proposals).filter(p=>['Em revisão','Aguardando aprovação','Aprovada'].includes(p.status)).map(p=>p.roundId)].filter(Boolean));
 const rounds=list(plan.collaboration?.rounds).filter(r=>latest.get(r.project)?.roundId===r.roundId||relevantIds.has(r.roundId)).map(r=>({...r,sourceCut:list(r.sourceCut).map(c=>pick(c,['projectId','period','level','fetchedAt','lastSyncAt','complete','rowCount','fingerprint'])),readRequest:reviewReadRequest(r.project,'context',{roundId:r.roundId})}));
 const knowledge=list(plan.knowledge).map(k=>({project:k.project,freshCount:k.freshCount,staleCount:k.staleCount,itemCount:list(k.items).length,readRequest:{action:'learningRead',projectId:k.project},policy:k.policy}));
 const learning=plan.learning?pick(plan.learning,['version','policy','stats','limits','automaticMeasurement','automaticPeerReview','automaticHistory','campaignCoverage']):null;
 const monitoring=plan.campaignMonitoring?{incidentCount:plan.campaignMonitoring.incidentCount,changeCount:plan.campaignMonitoring.changeCount,notice:plan.campaignMonitoring.notice,readRequests:projects.map(p=>reviewReadRequest(p,'context'))}:undefined;
 const decisions=plan.decisions?{...pick(plan.decisions,['stats','maturity','policy','truncation']),reconsiderations:plan.decisions.reconsiderations,readRequests:projects.map(projectId=>({action:'decisionRead',projectId,limit:20}))}:undefined;
 const watch=plan.watch?{...plan.watch,signals:undefined}:undefined;
 const autonomous=plan.autonomous?{...plan.autonomous,ready:list(plan.autonomous.ready).map(work=>({...work,...(work.project?{readRequest:reviewReadRequest(work.project,['verify','execution','followUp'].includes(work.kind)?'execution':'context',{...(work.roundId?{roundId:work.roundId}:{}),...(work.proposalId?{proposalId:work.proposalId}:{}),...(work.executionId?{executionId:work.executionId}:{})})}:{})}))}:undefined;
 if(autonomous)autonomous.next=autonomous.ready[0]||null;
 return {...plan,sourceReads:{source:'Malva API via Supabase',status:'Validar conexão e alcance antes de usar',discovery:malvaReadRequest({section:'projects'}),policy:'Antes de coletar, descubra o alcance real da chave. Use somente projetos alcançados e configurados; demais seguem pelo MCP Malva. Se a API retornar MALVA_KEY_FORMAT_INVALID, MALVA_KEY_INVALID ou MALVA_PROJECT_OUT_OF_SCOPE, preserve o MCP como alternativa e não repita consultas ao provedor nesta rodada. Preserve pausa, cadência e reserva. A API não sela fontes nem executa ajustes. Nunca use readAt como horário de sincronização da Meta.',projects:projects.map(projectId=>({projectId,readRequest:malvaReadRequest({section:'campaigns',projectId,level:'campaign',period:'four'})}))},autonomous,collaboration:{...plan.collaboration,rounds},learning:learning&&{...learning,readRequests:projects.map(projectId=>({action:'learningRead',projectId}))},knowledge,campaignMonitoring:monitoring,decisions,watch};
}

export const malvaReadRequest=input=>({tool:'bunker_atualizar_rodada',arguments:{id:'source-data',status:'Pendente',revision:0,note:JSON.stringify(input)}});
