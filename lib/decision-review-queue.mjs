/** Whether a new owner intention may enqueue analysis. This never reserves work,
 * executes an action, rewrites an approval or changes the saved cadence.
 */
const activeLeaseMs=45*60000;
const finiteTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
function confirmed(execution,now){const at=finiteTime(execution?.confirmedAt);return execution?.status==='Confirmada'&&Number.isFinite(at)&&at<=now;}
function awaitingVerification(execution,now){
 if(!execution||confirmed(execution,now))return false;
 // A missing/odd dispatch timestamp must not turn an ambiguous send into a new
 // collection that would replace its evidence. Status alone may retain a send.
 return !!execution.submittedAt||['Enviada','Verificação necessária'].includes(execution.status);
}

export function shouldQueueChoiceReview(state,record,replay=false,now=Date.now()){
 const at=typeof now==='number'?now:Date.parse(now);
 if(!Number.isFinite(at))throw Error('Instante da fila inválido.');
 if(replay||state.paused||record?.status!=='Pendente de revisão'||typeof record.project!=='string'||!Object.prototype.hasOwnProperty.call(state.config||{},record.project))return false;
 const project=record.project,jobs=state.jobs||[],proposals=state.proposals||[],executions=state.executions||[];
 if(![jobs,proposals,executions].every(Array.isArray))throw Error('Estado da fila de decisões inválido.');
 if(jobs.some(job=>job.project===project&&(job.status==='Pendente'||job.status==='Em análise'&&(!Number.isFinite(finiteTime(job.startedAt))||finiteTime(job.startedAt)>at||at-finiteTime(job.startedAt)<activeLeaseMs))))return false;
 for(const execution of executions){const p=proposals.find(p=>p.id===execution.proposalId),scope=execution.project||p?.project;if(scope===project&&awaitingVerification(execution,at))return false;}
 for(const proposal of proposals){
  if(proposal.project!==project)continue;
  if(awaitingVerification(proposal.execution,at))return false;
  const journal=executions.find(execution=>execution.proposalId===proposal.id);
  if(confirmed(proposal.execution,at)||confirmed(journal,at))continue;
  const expires=finiteTime(proposal.expiresAt);
  // Expired and never-dispatched approvals cannot authorize a new mutation and
  // therefore do not indefinitely fence a user-requested analysis.
  if(proposal.status==='Aprovada'&&(!Number.isFinite(expires)||expires>at))return false;
 }
 return true;
}
