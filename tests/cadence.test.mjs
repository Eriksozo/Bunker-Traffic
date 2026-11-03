import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCadence,cadenceIntervals,cadenceWindow,duePlan,nextWindow} from '../lib/cadence.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
const state=()=>({config:{p:{projectName:'John'}},jobs:[],paused:false});
const at=s=>new Date('2026-11-02T'+s+'Z');
test('Boa Vista: 08h and 20h inclusive; no run outside window',()=>{assert.ok(cadenceWindow(defaultCadence,at('12:00:00')));assert.ok(cadenceWindow(defaultCadence,at('00:00:00')));assert.equal(cadenceWindow(defaultCadence,at('11:59:00')),null);assert.ok(cadenceWindow(defaultCadence,at('23:59:00')));assert.equal(cadenceWindow(defaultCadence,new Date('2026-11-03T00:15:00Z')),null);});
test('A completed slot cannot run again at the quarter-hour',()=>{const s=state();s.jobs.push({project:'p',status:'Concluída',slotKey:cadenceWindow(defaultCadence,at('12:00:00')).key});assert.equal(duePlan(s,at('12:15:00')).due.length,0);assert.equal(duePlan(s,at('13:00:00')).due.length,1);});
test('Pause blocks automatic and manual work; disabled automatic allows manual',()=>{const s=state();s.paused=true;s.jobs.push({id:'m',project:'p',status:'Pendente'});assert.equal(duePlan(s,at('12:00:00')).due.length,0);s.paused=false;s.cadence={enabled:false};assert.equal(duePlan(s,at('03:00:00')).due[0].manualJobId,'m');});
test('Weekdays and custom 2-hour interval are respected',()=>{const c={...defaultCadence,weekdays:[1],intervalMinutes:120};assert.equal(cadenceWindow(c,new Date('2026-11-03T13:00:00Z')),null);assert.equal(cadenceWindow(c,at('13:45:00')).startMinute,480);assert.equal(nextWindow(c,at('12:01:00')),'2026-11-02T14:00:00.000Z');});
test('Concurrent work and recent failure are held back',()=>{const s=state();s.jobs.push({project:'p',status:'Em análise',startedAt:'2026-11-02T11:50:00Z'});assert.equal(duePlan(s,at('12:00:00')).due.length,0);s.jobs=[{project:'p',status:'Falhou',updatedAt:'2026-11-02T11:55:00Z'}];assert.equal(duePlan(s,at('12:00:00')).due.length,0);});

test('Curated presets include five-minute steps up to one hour and preserve every whole-hour option',()=>{
 assert.deepEqual(cadenceIntervals.slice(0,12),[5,10,15,20,25,30,35,40,45,50,55,60]);
 assert.equal(cadenceIntervals.at(-1),1440);assert.equal(cadenceIntervals.length,35);assert.equal(new Set(cadenceIntervals).size,35);
 assert.ok(Object.isFrozen(cadenceIntervals));
});
test('Next review finds minute slots rather than rounding to the next whole hour',()=>{
 const c={...defaultCadence,intervalMinutes:5};
 assert.equal(nextWindow(c,at('12:01:00')),'2026-11-02T12:05:00.000Z');
 assert.equal(nextWindow(c,at('12:05:00')),'2026-11-02T12:05:00.000Z');
 assert.equal(nextWindow(c,at('12:05:01')),'2026-11-02T12:10:00.000Z');
});
test('Minute-based starts, inclusive ends, arbitrary five-minute intervals and selected weekdays align',()=>{
 const c={...defaultCadence,intervalMinutes:10,start:'08:05',end:'09:55',weekdays:[1]};
 assert.equal(nextWindow(c,at('12:01:00')),'2026-11-02T12:05:00.000Z');
 assert.equal(nextWindow(c,at('12:06:00')),'2026-11-02T12:15:00.000Z');
 assert.equal(nextWindow(c,at('13:55:00')),'2026-11-02T13:55:00.000Z');
 assert.equal(nextWindow(c,at('13:55:01')),'2026-11-09T12:05:00.000Z');
 assert.equal(nextWindow({...c,intervalMinutes:90},at('12:06:00')),'2026-11-02T13:35:00.000Z');
 const single={...defaultCadence,intervalMinutes:5,start:'08:05',end:'08:05'};
 assert.ok(cadenceWindow(single,at('12:05:00')));assert.equal(cadenceWindow(single,at('12:06:00')),null);
 assert.equal(nextWindow(single,at('12:06:00')),'2026-11-03T12:05:00.000Z');
});
test('The same absolute time respects each saved timezone and creates separate slot keys',()=>{
 const a={...defaultCadence,intervalMinutes:5,start:'08:05'},b={...a,timezone:'America/Sao_Paulo'};
 assert.equal(nextWindow(a,at('11:01:00')),'2026-11-02T12:05:00.000Z');
 assert.equal(nextWindow(b,at('11:01:00')),'2026-11-02T11:05:00.000Z');
 assert.notEqual(cadenceWindow(a,at('12:05:00')).key,cadenceWindow(b,at('12:05:00')).key);
});
test('Invalid schedules have no automatic window or misleading next review',()=>{
 for(const patch of [{intervalMinutes:0},{intervalMinutes:7},{intervalMinutes:1445},{start:'08:07'},{end:'25:00'},{end:'07:55'},{weekdays:[]},{weekdays:[1,1]},{timezone:'Invalid/Zone'}]){
  const c={...defaultCadence,...patch};assert.equal(cadenceWindow(c,at('12:00:00')),null);assert.equal(nextWindow(c,at('12:00:00')),null);
 }
 assert.equal(nextWindow({...defaultCadence,enabled:false},at('12:00:00')),null);
 assert.equal(nextWindow(defaultCadence,new Date('invalid')),null);
});
test('Five-minute windows deduplicate a completion and never enqueue missed historical slots',()=>{
 const s=state();s.cadence={...defaultCadence,intervalMinutes:5};
 s.jobs.push({project:'p',status:'Concluída',slotKey:cadenceWindow(s.cadence,at('12:00:00')).key});
 assert.equal(duePlan(s,at('12:04:59')).due.length,0);
 assert.equal(duePlan(s,at('12:05:00')).due.length,1);
 const later=duePlan(s,at('12:42:00'));assert.equal(later.due.length,1);assert.equal(later.due[0].slotKey,'2026-11-02:520:America/Boa_Vista');
});
function workflow(){
 const s=state();s.cadence={...defaultCadence,intervalMinutes:5};
 s.jobs=[{id:'j',project:'p',status:'Concluída',startedAt:'2026-11-02T12:00:00Z',completedAt:'2026-11-02T12:03:00Z',slotKey:'2026-11-02:480:America/Boa_Vista'}];s.agents={p:{jobId:'j'}};
 s.snapshots=['7d','3d','yesterday','today'].map(period=>({projectId:'p',period,level:'campaign',complete:true,source:'Malva MCP',from:'2026-11-02T04:00:00Z',to:'2026-11-03T04:00:00Z',timezone:'America/Boa_Vista',fetchedAt:'2026-11-02T12:02:00Z',rows:[]}));
 const round=ensureCollaboration(s,s.jobs[0],Date.parse('2026-11-02T12:03:00Z'));round.id='r';round.status='Em análise';round.updatedAt='2026-11-02T12:04:00Z';
 Object.assign(round.stages[0],{status:'Em análise',startedAt:'2026-11-02T12:04:00Z',leaseUntil:'2026-11-02T12:19:00Z'});
 return s;
}
function reviewProposal(s,status='Aguardando aprovação',expiresAt='2026-11-02T13:00:00Z'){
 s.collaborationRounds[0].status='Concluída';s.collaborationRounds[0].stages=Array.from({length:4},()=>({status:'Concluída'}));
 s.proposals=[{id:'proposal',project:'p',roundId:'r',status,expiresAt}];return s.proposals[0];
}
test('An active collaboration keeps its frozen sources after collection completes, including manual queue requests',()=>{
 const s=workflow();s.jobs.push({id:'manual',project:'p',status:'Pendente'});
 const before=structuredClone(s),plan=duePlan(s,at('12:05:00'));assert.deepEqual(plan.due,[]);assert.equal(plan.held[0].project,'p');assert.match(plan.held[0].reason,/Análise conjunta/);assert.deepEqual(s,before);
});
test('A fresh unclaimed collaboration is preserved, while inactive expired work can recover',()=>{
 const s=workflow();s.collaborationRounds[0].stages=[{agentId:'traffic',status:'Pendente'}];
 assert.equal(duePlan(s,at('12:05:00')).due.length,0);
 assert.equal(duePlan(s,at('12:50:00')).due.length,0,'Unclaimed work can finish against the same recent sources.');
 assert.equal(duePlan(s,at('13:02:00')).due.length,1,'Every source must remain less than sixty minutes old.');
});
test('Live claims are respected; failed, cancelled, blocked and superseded rounds never fence a new collection',()=>{
 const s=workflow();s.collaborationRounds[0].updatedAt='2026-11-02T10:00:00Z';
 assert.equal(duePlan(s,at('12:05:00')).due.length,0);
 for(const status of ['Falhou','Cancelada','Bloqueada','Fonte substituída']){
  const copy=structuredClone(s);copy.collaborationRounds[0].status=status;assert.equal(duePlan(copy,at('12:05:00')).due.length,1,status);
 }
 s.collaborationRounds[0].stages[0].leaseUntil='2026-11-02T12:04:00Z';assert.equal(duePlan(s,at('12:05:00')).due.length,0,'An expired stage claim leaves retryable work on recent sources.');
 assert.equal(duePlan(s,at('13:02:00')).due.length,1,'A pending stage cannot preserve stale sources indefinitely.');
});
test('A claimed discussion preserves a completed round only until its reply lease expires',()=>{
 const s=workflow(),round=s.collaborationRounds[0];
 round.status='Concluída';round.stages=Array.from({length:4},()=>({status:'Concluída'}));
 round.discussionClaims={traffic:{status:'Em análise',startedAt:'2026-11-02T12:04:00Z',leaseUntil:'2026-11-02T12:19:00Z',replyTo:'question'}};
 const before=structuredClone(s),plan=duePlan(s,at('12:05:00'));
 assert.equal(plan.due.length,0);assert.match(plan.held[0].reason,/Resposta/);assert.deepEqual(s,before);
 assert.equal(duePlan(s,at('12:19:00')).due.length,1,'An expired discussion claim does not extend to the collaboration activity timeout.');
 round.discussionClaims.traffic.status='Concluída';assert.equal(duePlan(s,at('12:05:00')).due.length,1);
 round.discussionClaims={};s.collaborationMessages=[{roundId:round.id,id:'question',kind:'message',fromAgent:'budget',toAgent:'traffic',requiresReply:true}];
 assert.equal(duePlan(s,at('12:05:00')).due.length,0,'An unanswered discussion keeps its valid recent source even before a claim.');
 assert.match(duePlan(s,at('12:05:00')).held[0].reason,/Pergunta/);
 s.collaborationMessages.push({roundId:round.id,id:'reply',kind:'message',fromAgent:'traffic',toAgent:'budget',replyTo:'question',requiresReply:false});
 assert.equal(duePlan(s,at('12:05:00')).due.length,1,'An answered discussion releases a completed round.');
});
test('Pending replies cannot renew source freshness through updates or live leases',()=>{
 const s=workflow(),round=s.collaborationRounds[0];round.status='Concluída';round.stages.forEach(stage=>stage.status='Concluída');
 s.collaborationMessages=[{roundId:round.id,id:'question',kind:'message',fromAgent:'traffic',toAgent:'budget',requiresReply:true}];
 assert.equal(duePlan(s,at('13:01:59')).due.length,0);
 round.updatedAt='2026-11-02T13:02:00Z';round.discussionClaims={budget:{status:'Em análise',startedAt:'2026-11-02T12:59:00Z',leaseUntil:'2026-11-02T13:14:00Z'}};
 const before=structuredClone(s),plan=duePlan(s,at('13:02:00'));
 assert.equal(plan.due.length,1);assert.deepEqual(s,before,'Planning never mutates sources, messages or claims.');
});
test('Changed configuration or sources never hold collection for pending work',()=>{
 for(const change of [s=>s.config.p.targetRoas=3,s=>s.snapshots[0].rows.push({externalId:'changed'}),s=>s.snapshots.pop(),s=>s.jobs[0].status='Falhou']){
  const s=workflow();s.collaborationRounds[0].status='Concluída';s.collaborationRounds[0].stages.forEach(stage=>stage.status='Concluída');
  s.collaborationMessages=[{roundId:'r',id:'question',kind:'message',fromAgent:'traffic',toAgent:'budget',requiresReply:true}];change(s);
  const before=structuredClone(s);assert.equal(duePlan(s,at('12:05:00')).due.length,1);assert.deepEqual(s,before);
 }
});
test('Pending work is scoped, pause blocks admission, and disabled automatic review still preserves manual replies',()=>{
 const s=workflow(),round=s.collaborationRounds[0];round.status='Concluída';round.stages.forEach(stage=>stage.status='Concluída');
 s.collaborationMessages=[{roundId:'r',id:'question',kind:'message',fromAgent:'traffic',toAgent:'budget',requiresReply:true}];
 s.config.q={projectName:'Nico'};
 assert.deepEqual(duePlan(s,at('12:05:00')).due.map(item=>item.project),['q']);
 s.paused=true;assert.deepEqual(duePlan(s,at('12:05:00')).due,[]);assert.deepEqual(duePlan(s,at('12:05:00')).held,[]);
 s.paused=false;s.cadence.enabled=false;s.jobs.push({id:'manual',project:'p',status:'Pendente'});
 assert.equal(duePlan(s,at('12:05:00')).due.length,0);assert.match(duePlan(s,at('12:05:00')).held[0].reason,/Pergunta/);
 assert.equal(duePlan(s,at('13:02:00')).due[0].manualJobId,'manual');
});
test('Discussion claims on replaced, failed or cancelled rounds never fence the current project',()=>{
 const s=workflow(),round=s.collaborationRounds[0];round.status='Concluída';round.stages=Array.from({length:4},()=>({status:'Concluída'}));
 round.discussionClaims={traffic:{status:'Em análise',startedAt:'2026-11-02T12:04:00Z',leaseUntil:'2026-11-02T12:19:00Z'}};
 for(const status of ['Fonte substituída','Falhou','Cancelada','Bloqueada']){const copy=structuredClone(s);copy.collaborationRounds[0].status=status;assert.equal(duePlan(copy,at('12:05:00')).due.length,1,status);}
 s.agents.p.jobId='replacement';assert.equal(duePlan(s,at('12:05:00')).due.length,1);
});
test('Current review and owner-approved proposals preserve their source until expiry or a confirmed application',()=>{
 for(const status of ['Em revisão','Aguardando aprovação','Aprovada']){
  const s=workflow();reviewProposal(s,status);s.jobs.push({id:'manual',project:'p',status:'Pendente'});
  assert.equal(duePlan(s,at('12:05:00')).due.length,0,status);assert.match(duePlan(s,at('12:05:00')).held[0].reason,/Proposta/);
  assert.equal(duePlan(s,at('13:00:00')).due.length,1,'Expired, never dispatched approval does not fence indefinitely.');
 }
 const s=workflow(),p=reviewProposal(s,'Aprovada');p.execution={status:'Confirmada',confirmedAt:'2026-11-02T12:04:00Z'};
 assert.equal(duePlan(s,at('12:05:00')).due.length,1);
 for(const status of ['Recusada','Revisão solicitada','Fonte substituída']){reviewProposal(s,status);assert.equal(duePlan(s,at('12:05:00')).due.length,1,status);}
});
test('The analytical sixty-minute limit never releases an unexpired financial review or owner approval',()=>{
 for(const status of ['Em revisão','Aguardando aprovação','Aprovada']){
  const s=workflow();reviewProposal(s,status,'2026-11-02T14:00:00Z');
  const before=structuredClone(s),plan=duePlan(s,at('13:10:00'));
  assert.equal(plan.due.length,0,status);assert.match(plan.held[0].reason,/Proposta/);assert.deepEqual(s,before);
 }
});
test('Proposals from an obsolete round do not prevent refreshing the current project',()=>{
 const s=workflow();reviewProposal(s);s.agents.p.jobId='replacement';
 assert.equal(duePlan(s,at('12:05:00')).due.length,1);
 s.agents.p.jobId='j';s.collaborationRounds[0].status='Fonte substituída';assert.equal(duePlan(s,at('12:05:00')).due.length,1);
});
test('Live pre-dispatch reservations hold new collections only for their lease',()=>{
 for(const status of ['Reservada','Preparada']){
  const s=state();s.cadence={...defaultCadence,intervalMinutes:5};s.executions=[{id:'e',project:'p',status,leaseUntil:'2026-11-02T12:10:00Z'}];
  assert.equal(duePlan(s,at('12:05:00')).due.length,0,status);assert.match(duePlan(s,at('12:05:00')).held[0].reason,/Execução/);
  assert.equal(duePlan(s,at('12:10:00')).due.length,1,status);
 }
});
test('Submitted, failed-after-dispatch and ambiguous actions require confirmation even after approval expires',()=>{
 for(const status of ['Enviada','Verificação necessária','Falhou']){
  const s=workflow(),p=reviewProposal(s,'Aprovada','2026-11-02T12:04:00Z');
  s.executions=[{id:'e',project:'p',proposalId:p.id,status,submittedAt:'2026-11-02T12:03:30Z',leaseUntil:'2026-11-02T12:04:00Z'}];
  assert.equal(duePlan(s,at('12:05:00')).due.length,0,status);assert.match(duePlan(s,at('12:05:00')).held[0].reason,/Conferência/);
  s.executions[0].status='Confirmada';s.executions[0].confirmedAt='2026-11-02T12:04:30Z';assert.equal(duePlan(s,at('12:05:00')).due.length,1,status);
 }
});
test('Project holds are scoped; other eligible projects continue in the same pulse',()=>{
 const s=workflow();s.config.q={projectName:'Nico'};s.jobs.push({id:'q-manual',project:'q',status:'Pendente'});
 const plan=duePlan(s,at('12:05:00'));assert.deepEqual(plan.due.map(p=>p.project),['q']);assert.deepEqual(plan.held.map(p=>p.project),['p']);
 s.paused=true;assert.deepEqual(duePlan(s,at('12:05:00')).due,[]);assert.deepEqual(duePlan(s,at('12:05:00')).held,[]);
});
test('Three exhausted attempts release analytical sources but never override a financial hold',()=>{
 const s=workflow(),round=s.collaborationRounds[0];Object.assign(round.stages[0],{attempt:3,leaseUntil:'2026-11-02T12:04:00Z'});
 assert.equal(duePlan(s,at('12:05:00')).due.length,1);
 const p=reviewProposal(s,'Aprovada');assert.equal(duePlan(s,at('12:05:00')).due.length,0);assert.match(duePlan(s,at('12:05:00')).held[0].reason,/Proposta/);
 s.proposals=[];round.discussionClaims={traffic:{status:'Em análise',attempt:3,replyTo:'question',leaseUntil:'2026-11-02T12:04:00Z'}};
 s.collaborationMessages=[{roundId:round.id,id:'question',kind:'message',fromAgent:'budget',toAgent:'traffic',requiresReply:true}];
 assert.equal(duePlan(s,at('12:05:00')).due.length,1);
});
