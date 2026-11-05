import {closedSystemRound} from './system-round-review.mjs';
import {collaborationPlan} from './collaboration.mjs';

export const defaultCadence={enabled:true,intervalMinutes:60,start:'08:00',end:'20:00',weekdays:[0,1,2,3,4,5,6],timezone:'America/Boa_Vista'};
export const cadenceIntervals=Object.freeze([...Array.from({length:11},(_,i)=>(i+1)*5),...Array.from({length:24},(_,i)=>(i+1)*60)]);
const minuteMs=60000,stepMs=5*minuteMs,leaseMs=45*minuteMs,retryMs=15*minuteMs;
const pendingWorkMaxAgeMs=60*minuteMs;
const finiteTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const recent=(value,now,age)=>{const at=finiteTime(value);return Number.isFinite(at)&&at<=now&&now-at<age;};
const confirmed=(execution,now)=>execution?.status==='Confirmada'&&Number.isFinite(finiteTime(execution.confirmedAt))&&finiteTime(execution.confirmedAt)<=now;
export function cadenceOf(state){return {...defaultCadence,...state.cadence};}
function valid(c){
 const validTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)&&Number(value.slice(3))%5===0;
 return typeof c.enabled==='boolean'&&Number.isInteger(c.intervalMinutes)&&c.intervalMinutes>=5&&c.intervalMinutes<=1440&&c.intervalMinutes%5===0&&validTime(c.start)&&validTime(c.end)&&c.start<=c.end&&Array.isArray(c.weekdays)&&c.weekdays.length>0&&c.weekdays.length<=7&&new Set(c.weekdays).size===c.weekdays.length&&c.weekdays.every(day=>Number.isInteger(day)&&day>=0&&day<=6)&&typeof c.timezone==='string';
}
function formatter(timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}
export function cadenceIsValid(cadence){const c={...defaultCadence,...cadence};if(!valid(c))return false;try{formatter(c.timezone);return true;}catch{return false;}}
function clock(now,format){
 const parts=Object.fromEntries(format.formatToParts(now).map(x=>[x.type,x.value]));
 return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute),weekday:new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`).getUTCDay()};
}
const toMinutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
function windowAt(c,now,format){
 const t=clock(now,format),start=toMinutes(c.start),end=toMinutes(c.end);
 if(!c.weekdays.includes(t.weekday)||t.minute<start||t.minute>end)return null;
 const slot=Math.floor((t.minute-start)/c.intervalMinutes);
 return {key:`${t.day}:${start+slot*c.intervalMinutes}:${c.timezone}`,day:t.day,startMinute:start+slot*c.intervalMinutes};
}
export function cadenceWindow(cadence,now=new Date()){
 const c={...defaultCadence,...cadence};
 if(!valid(c)||!c.enabled||!Number.isFinite(now.getTime()))return null;
 try{return windowAt(c,now,formatter(c.timezone));}catch{return null;}
}
function pendingRound(state,round,now){
 // A reply can be unclaimed between pulses. Preserve its exact sources while
 // work remains actionable, without letting an old update extend the hold.
 const cuts=round.sourceCut;
 if(!Array.isArray(cuts)||!['7d','3d','yesterday','today'].every(period=>cuts.some(cut=>cut.period===period&&cut.level==='campaign'))||!cuts.every(cut=>cut.complete===true&&cut.source==='Malva MCP'&&recent(cut.fetchedAt,now,pendingWorkMaxAgeMs)))return null;
 try{
  const view=collaborationPlan({...state,collaborationRounds:[round],proposals:[]},now).rounds[0];
  const exhausted=claim=>(claim?.attempt||0)>=3&&finiteTime(claim.leaseUntil)<=now;
  if(view?.stages?.some(stage=>stage.status!=='Concluída'&&exhausted(stage))||view?.discussionPending?.some(message=>{const claim=view.discussionClaims?.[message.toAgent];return claim?.replyTo===message.id&&exhausted(claim);}))return null;
  return view&&!view.blocked?view:null;
 }catch{return null;}
}
function projectHold(state,project,now){
 const proposals=(state.proposals||[]).filter(p=>p.project===project),executions=state.executions||[];
 const associated=e=>(e.project||(state.proposals||[]).find(p=>p.id===e.proposalId)?.project)===project;
 // A dispatch is never displaced by a new collection, even after expiry/failure.
 const pendingVerification=e=>e&&!confirmed(e,now)&&(e.submittedAt||['Enviada','Verificação necessária'].includes(e.status));
 for(const e of [...executions.filter(associated),...proposals.map(p=>p.execution).filter(Boolean)]){
  if(pendingVerification(e))return 'Conferência de uma ação enviada pendente.';
  if(!confirmed(e,now)&&['Reservada','Preparada'].includes(e.status)&&!e.submittedAt&&finiteTime(e.leaseUntil)>now)return 'Execução já reservada em andamento.';
 }
 const owner=state.agents?.[project]?.jobId;
 const currentRounds=(state.collaborationRounds||[]).filter(r=>r.project===project&&(!owner||r.jobId===owner)&&!['Fonte substituída','Bloqueada','Falhou','Cancelada'].includes(r.status)&&!r.blocked);
 // Analytical freshness never relaxes an existing financial authorization gate.
 for(const proposal of proposals){
  if(!['Em revisão','Aguardando aprovação','Aprovada'].includes(proposal.status)||!Number.isFinite(finiteTime(proposal.expiresAt))||finiteTime(proposal.expiresAt)<=now||!currentRounds.some(r=>r.id===proposal.roundId))continue;
  const related=executions.filter(e=>e.proposalId===proposal.id);
  if(confirmed(proposal.execution,now)||related.some(e=>confirmed(e,now)))continue;
  return proposal.status==='Aprovada'?'Proposta aprovada aguardando aplicação e conferência.':'Proposta aguardando revisão ou sua decisão.';
 }
 for(const round of currentRounds){
  if(closedSystemRound(round,now))continue;
  const pending=pendingRound(state,round,now);if(!pending)continue;
  const discussionLive=Object.values(round.discussionClaims||{}).some(claim=>claim.status==='Em análise'&&finiteTime(claim.leaseUntil)>now&&(!claim.startedAt||finiteTime(claim.startedAt)<=now));
  if(discussionLive)return 'Resposta dos agentes em andamento.';
  if(pending.discussionPending.length)return 'Pergunta entre agentes aguardando resposta.';
  if(round.status==='Concluída'||(round.stages?.length===4&&round.stages.every(stage=>stage.status==='Concluída')))continue;
  if((round.stages||[]).some(stage=>stage.status!=='Concluída'))return 'Análise conjunta em andamento.';
 }
 return null;
}
export function duePlan(state,now=new Date()){
 if(state.paused)return {paused:true,cadence:cadenceOf(state),due:[],held:[],reason:'Escritório pausado.'};
 const c=cadenceOf(state),at=now.getTime(),slot=cadenceWindow(c,now),due=[],held=[],jobs=state.jobs||[];
 if(!Number.isFinite(at))return {paused:false,cadence:c,due,held,reason:'Horário da revisão inválido.'};
 for(const [project,cfg] of Object.entries(state.config||{})){
  const running=jobs.some(j=>j.project===project&&j.status==='Em análise'&&j.startedAt&&at-Date.parse(j.startedAt)<leaseMs);
  const hold=running?'Coleta em andamento.':projectHold(state,project,at);
  if(hold){held.push({project,projectName:cfg.projectName,reason:hold});continue;}
  const manual=jobs.find(j=>j.project===project&&j.status==='Pendente');
  const done=slot&&jobs.some(j=>j.project===project&&j.slotKey===slot.key&&j.status==='Concluída');
  const failed=jobs.some(j=>j.project===project&&j.status==='Falhou'&&j.updatedAt&&at-Date.parse(j.updatedAt)<retryMs);
  if(failed){held.push({project,projectName:cfg.projectName,reason:'Aguardando nova tentativa após falha.'});continue;}
  if(manual||(slot&&!done))due.push({project,projectName:cfg.projectName,manualJobId:manual?.id||null,slotKey:manual?null:slot.key});
 }
 return {paused:false,cadence:c,due,held,reason:due.length?'Rodadas disponíveis.':held.length?'Há trabalhos ou decisões em andamento; as fontes foram preservadas.':slot?'Esta janela já foi atendida.':'Fora da janela automática; pedidos manuais continuam elegíveis.'};
}
export function nextWindow(cadence,now=new Date()){
 const c={...defaultCadence,...cadence};if(!valid(c)||!c.enabled||!Number.isFinite(now.getTime()))return null;
 // One formatter per search; do not construct thousands while walking the week.
 let format;try{format=formatter(c.timezone);}catch{return null;}
 const start=Math.ceil(now.getTime()/stepMs)*stepMs;
 for(let time=start;time<start+8*86400000;time+=stepMs){const n=new Date(time),s=windowAt(c,n,format);if(s&&clock(n,format).minute===s.startMinute)return n.toISOString();}
 return null;
}
