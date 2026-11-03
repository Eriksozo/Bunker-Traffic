import {campaignReviewMarker,campaignIncident} from './campaign-observation.mjs';

/** A changed native state or an owner-reported incident requests analysis,
 * never a Meta mutation or a retrospective verdict on the old choice. */
export function campaignReassessment(state,project,row,{sourceCut=[],round=null,teamReady=false,lastChoice=null}={}){
 const marker=campaignReviewMarker(state,project,row),incident=campaignIncident(state,project,row);
 if(!marker)return null;
 const at=Date.parse(marker.at),afterChoice=!lastChoice||Date.parse(lastChoice.createdAt)<at;
 const today=sourceCut.find(s=>s.period==='today'&&s.level==='campaign');
 const four=['7d','3d','yesterday','today'].every(period=>sourceCut.some(s=>s.period===period&&s.level==='campaign'&&s.complete));
 const postIncident=marker.kind!=='incident'||sourceCut.every(s=>Date.parse(s.fetchedAt)>=at);
 const ready=!!round&&teamReady&&four&&Date.parse(round.createdAt)>=at&&Date.parse(today?.fetchedAt)>=at&&postIncident;
 const title=marker.kind==='change'?'Status ou orçamento mudou':marker.incident.status==='Em retomada'?'Retomada informada':marker.incident.status==='Encerrado'?'Incidente encerrado':'Incidente informado';
 return {markerId:marker.id,kind:marker.kind,at,title,incident,ready,afterChoice,requiresReview:afterChoice&&!ready,summary:ready?'A equipe releu os quatro períodos neste novo cenário. A decisão anterior continua no histórico.':'Aguardar leitura atual e novos pareceres. Separar o desempenho antes, durante e depois do incidente ou ajuste; não repetir a decisão anterior.'};
}

/** Invalidate unsent analysis after an owner context update. Submitted and
 * confirmed journals and approvals remain available for verification only. */
export function invalidateIncidentContext(state,incident){
 const at=Date.parse(incident.reportedAt);
 for(const round of state.collaborationRounds||[]){
  if(round.project!==incident.project||Date.parse(round.createdAt)>=at)continue;
  round.status='Fonte substituída';round.sourceInvalidatedAt||=incident.reportedAt;
  round.sourceInvalidationReason='Novo contexto de incidente informado pelo dono; conferir os quatro períodos novamente.';
 }
 for(const proposal of state.proposals||[]){
  if(proposal.project!==incident.project||Date.parse(proposal.createdAt)>=at||!['Em revisão','Aguardando aprovação','Aprovada'].includes(proposal.status))continue;
  const executions=[proposal.execution,...(state.executions||[]).filter(e=>e.proposalId===proposal.id)].filter(Boolean);
  if(executions.some(e=>e.submittedAt||['Enviada','Verificação necessária','Confirmada'].includes(e.status)))continue;
  proposal.status='Fonte substituída';proposal.sourceInvalidatedAt=incident.reportedAt;
  proposal.sourceInvalidationReason='Contexto de incidente atualizado; nova análise e aprovação exata necessárias.';
 }
}
