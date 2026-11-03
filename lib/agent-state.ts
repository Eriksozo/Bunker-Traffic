import {z} from 'zod';
import {cadenceOf,cadenceWindow,duePlan} from './cadence.mjs';
import {sum} from './analysis.mjs';
import {ensureCollaboration} from './collaboration.mjs';
export const cadenceSchema=z.object({enabled:z.boolean(),intervalMinutes:z.number().int().min(5).max(1440).refine(n=>n%5===0,'Use intervalos de 5 em 5 minutos.'),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),timezone:z.enum(['America/Boa_Vista','America/Sao_Paulo'])}).refine(c=>c.start<=c.end,'O fim deve ser no mesmo dia e após o início.').refine(c=>[c.start,c.end].every(t=>Number(t.slice(3))%5===0),'Use horários de 5 em 5 minutos.');
export function compactState(current:any){
 const s=current.state;return {...current,state:{...s,snapshots:s.snapshots.map((x:any)=>({...x,rows:undefined,rowCount:x.rows.length,totals:sum(x.rows)})),cadence:cadenceOf(s),agents:s.agents||{},reports:s.reports.slice(0,10),events:s.events.slice(0,20)},plan:duePlan(s),runbook:'Na etapa de análise, somente leitura nos sistemas externos e gravação no Bunker. Coletar 7 e 3 dias completos, ontem e hoje parcial com limites/fuso explícitos; completar truncamentos; revisar hierarquia e última edição antes de ações. Fonte e dado ausente nunca viram zero. Execução externa depende exclusivamente do contrato de proposta aprovada e executor descrito a seguir; análise não é autorização.'};
}
const leaseMs=45*60000;
const terminal=new Set(['Concluída','Cancelada','Falhou']);
function liveLease(job:any,now:number){
 const started=Date.parse(job.startedAt||'');
 return Number.isFinite(started)&&started<=now&&now-started<leaseMs;
}
function expirePrevious(state:any,project:string,exceptId:string,now:string){
 for(const prior of state.jobs){
  if(prior.id===exceptId||prior.project!==project||prior.status!=='Em análise')continue;
  prior.status='Falhou';prior.expiredAt=now;prior.updatedAt=now;
  prior.note='Reserva expirada. Uma nova rodada assumiu a revisão; esta tentativa não pode mais concluir.';
 }
}
function assertCurrent(state:any,job:any,now:number){
 if(!liveLease(job,now))throw new Error('Reserva expirada: solicite uma nova rodada.');
 const owner=state.agents?.[job.project]?.jobId;
 if(owner===job.id)return;
 // Compatibility for a legacy running job that predates the per-project owner.
 const legacy=!owner&&state.jobs.some((j:any)=>j.id===job.id)&&!state.jobs.some((j:any)=>j.id!==job.id&&j.project===job.project&&j.status==='Em análise'&&liveLease(j,now));
 if(!legacy)throw new Error('Rodada substituída: outra reserva controla este projeto.');
}
function reserveItem(state:any,item:any,at:Date){
 const project=item.project,now=at.toISOString();state.agents||={};
 let job=item.manualJobId?state.jobs.find((j:any)=>j.id===item.manualJobId):null;
 if(item.manualJobId&&!job)throw new Error('Pedido manual não encontrado. Releia a fila.');
 if(!job){job={id:crypto.randomUUID(),project,createdAt:now,status:'Pendente',slotKey:item.slotKey};state.jobs.unshift(job);}
 expirePrevious(state,project,job.id,now);
 job.slotKey=cadenceWindow(cadenceOf(state),at)?.key||null;job.status='Em análise';job.startedAt=now;job.updatedAt=now;job.note='Coleta iniciada pelo agente. Nenhuma alteração externa permitida.';
 delete job.completedAt;delete job.expiredAt;
 state.agents[project]={...(state.agents[project]||{}),status:'Em análise',startedAt:now,lastCheckAt:now,jobId:job.id};
 return job;
}
function reservationClock(now:Date){
 const at=new Date(now.getTime());if(!Number.isFinite(at.getTime()))throw new Error('Horário da reserva inválido.');return at;
}
export function claim(state:any,project:string,revision:number,now=new Date()){
 const at=reservationClock(now),plan=duePlan(state,at);const item=plan.due.find((x:any)=>x.project===project);if(!item)throw new Error('Projeto não elegível: pausado, fora da agenda, já atendido ou em análise.');
 const job=reserveItem(state,item,at);
 return {state,job,revision};
}
/** One pulse admits all currently due projects, before any source collection begins. */
export function claimBatch(state:any,projectIds:any,revision:number,now=new Date()){
 if(!Array.isArray(projectIds)||!projectIds.length||projectIds.length>100||projectIds.some(id=>typeof id!=='string'||!id.trim()||id.length>250))throw new Error('Informe uma lista de projetos válidos para o lote.');
 if(new Set(projectIds).size!==projectIds.length)throw new Error('Projeto duplicado no lote.');
 const at=reservationClock(now),plan=duePlan(state,at),items=projectIds.map(project=>plan.due.find((item:any)=>item.project===project));
 if(items.some(item=>!item))throw new Error('Todo projeto do lote precisa estar elegível, sem reserva ativa. Releia a fila.');
 if(projectIds.length!==plan.due.length)throw new Error('O lote deve incluir todos os projetos devidos neste pulso. Releia a fila.');
 // Prepare in isolation: invalid input or a failed reservation never leaves partial ownership.
 const draft=structuredClone(state),jobs=items.map(item=>reserveItem(draft,item,at));
 Object.assign(state,draft);
 return {state,jobs,revision};
}
export function updateRun(state:any,job:any,status:string,note:string){
 const now=new Date().toISOString(),time=Date.parse(now);
 if(terminal.has(job.status)){
  if(status===job.status)return;
  throw new Error('Rodada já encerrada. Solicite uma nova rodada para outra tentativa.');
 }
 state.agents||={};
 if(status==='Pendente'){
  if(job.status!=='Pendente')throw new Error('Uma rodada iniciada não pode voltar à fila. Solicite uma nova rodada.');
  return;
 }
 if(status==='Em análise'){
  if(state.paused)throw new Error('Escritório pausado.');
  if(job.status==='Em análise')assertCurrent(state,job,time);
  else{
   const overlap=state.jobs.some((j:any)=>j.id!==job.id&&j.project===job.project&&j.status==='Em análise'&&liveLease(j,time));
   if(overlap)throw new Error('Já existe rodada em análise para este projeto.');
   expirePrevious(state,job.project,job.id,now);
   job.startedAt=now;job.slotKey=cadenceWindow(cadenceOf(state))?.key||null;
   delete job.completedAt;delete job.expiredAt;
  }
  state.agents[job.project]={...(state.agents[job.project]||{}),status:'Em análise',startedAt:job.startedAt,lastCheckAt:now,jobId:job.id};
 }
 if(status==='Concluída'){
  if(job.status!=='Em análise'||!job.startedAt)throw new Error('Inicie a rodada antes de concluir.');
  assertCurrent(state,job,time);
  for(const period of ['7d','3d','yesterday','today']){
   const s=state.snapshots.find((x:any)=>x.projectId===job.project&&x.period===period&&x.level==='campaign');
   if(!s||!s.complete||!Number.isFinite(Date.parse(s.fetchedAt))||Date.parse(s.fetchedAt)<Date.parse(job.startedAt))throw new Error('Rodada incompleta: faltam quatro leituras completas posteriores ao início.');
  }
  job.completedAt=now;
  state.agents[job.project]={status:'Concluída',lastSuccessAt:now,lastCheckAt:now,jobId:job.id,note};
  if(note&&!state.reports.some((r:any)=>r.jobId===job.id))state.reports.unshift({id:crypto.randomUUID(),jobId:job.id,project:job.project,title:`${state.config[job.project]?.projectName||'Projeto'} · revisão do agente`,text:note,createdAt:now});
 }
 if(status==='Falhou'||status==='Cancelada'){
  const owner=state.agents[job.project]?.jobId;
  if(owner&&owner!==job.id&&job.status==='Em análise')throw new Error('Rodada substituída: outra reserva controla este projeto.');
  if(!owner||owner===job.id)state.agents[job.project]={...(state.agents[job.project]||{}),status,lastCheckAt:now,jobId:job.id,note};
 }
 job.status=status;job.note=note;job.updatedAt=now;
 if(status==='Concluída')ensureCollaboration(state,job,Date.parse(now));
}
