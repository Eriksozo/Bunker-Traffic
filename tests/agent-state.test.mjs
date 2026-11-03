import test from 'node:test';
import assert from 'node:assert/strict';
import {updateRun,cadenceSchema,compactState,claim,claimBatch} from '../lib/agent-state.ts';
import {duePlan} from '../lib/cadence.mjs';
const fresh=()=>({config:{p:{projectName:'Nico'}},snapshots:[],jobs:[],reports:[],events:[],messages:[],tasks:[],decisions:[],paused:false});
const windowRead=(period,fetchedAt=new Date().toISOString())=>({projectId:'p',projectName:'Nico',period,level:'campaign',complete:true,source:'Malva MCP',from:'2026-10-26',to:'2026-11-02',timezone:'America/Boa_Vista',fetchedAt,lastSyncAt:null,rows:[]});
test('Completion requires four complete reads made after start',()=>{const s=fresh(),j={id:'j',project:'p',status:'Em análise',startedAt:new Date(Date.now()-10000).toISOString()};s.jobs=[j];assert.throws(()=>updateRun(s,j,'Concluída','summary'),/incompleta/);s.snapshots=['7d','3d','yesterday','today'].map(period=>windowRead(period));updateRun(s,j,'Concluída','summary');assert.equal(s.agents.p.status,'Concluída');assert.equal(s.reports.length,1);assert.equal(s.collaborationRounds.length,1);assert.equal(s.collaborationRounds[0].jobId,j.id);updateRun(s,j,'Concluída','summary');assert.equal(s.reports.length,1);assert.equal(s.collaborationRounds.length,1);});
test('Old source reads cannot satisfy a new run',()=>{const s=fresh(),j={id:'j',project:'p',status:'Em análise',startedAt:new Date().toISOString()};s.jobs=[j];s.snapshots=['7d','3d','yesterday','today'].map(period=>({projectId:'p',period,level:'campaign',complete:true,fetchedAt:'2026-01-01T00:00:00Z',rows:[]}));assert.throws(()=>updateRun(s,j,'Concluída','summary'),/incompleta/);});
test('Failed work retains earlier successful timestamp',()=>{const s=fresh(),j={id:'j',project:'p',status:'Pendente'};s.agents={p:{lastSuccessAt:'2026-11-01T12:00:00Z'}};updateRun(s,j,'Em análise','started');updateRun(s,j,'Falhou','source unavailable');assert.equal(s.agents.p.lastSuccessAt,'2026-11-01T12:00:00Z');assert.equal(s.agents.p.status,'Falhou');});
test('Cadence accepts only supported, bounded, same-day schedules',()=>{const base={enabled:true,intervalMinutes:60,start:'08:00',end:'20:00',weekdays:[1],timezone:'America/Boa_Vista'};assert.ok(cadenceSchema.safeParse(base).success);assert.equal(cadenceSchema.safeParse({...base,start:'08:07'}).success,false);assert.equal(cadenceSchema.safeParse({...base,intervalMinutes:30}).success,true);assert.equal(cadenceSchema.safeParse({...base,intervalMinutes:90}).success,true);assert.equal(cadenceSchema.safeParse({...base,start:'08:15'}).success,true);assert.equal(cadenceSchema.safeParse({...base,weekdays:[]}).success,false);assert.equal(cadenceSchema.safeParse({...base,end:'07:00'}).success,false);});
test('Reading summary avoids returning large raw datasets',()=>{const s=fresh();s.snapshots=[{projectId:'p',period:'today',level:'campaign',rows:[{spend:42}]}];const r=compactState({state:s,revision:1});assert.equal(r.state.snapshots[0].rows,undefined);assert.equal(r.state.snapshots[0].rowCount,1);assert.equal(r.state.snapshots[0].totals.spend,42);});
test('Minute cadence accepts five-minute increments and rejects invalid schedules',()=>{
 const base={enabled:true,intervalMinutes:5,start:'08:05',end:'20:55',weekdays:[1],timezone:'America/Boa_Vista'};
 for(const intervalMinutes of [5,10,15,20,25,30,35,40,45,50,55,60,90,120,1440])assert.equal(cadenceSchema.safeParse({...base,intervalMinutes}).success,true);
 for(const intervalMinutes of [0,1,4,7,12.5,1445])assert.equal(cadenceSchema.safeParse({...base,intervalMinutes}).success,false);
 for(const start of ['08:01','08:07','24:00'])assert.equal(cadenceSchema.safeParse({...base,start}).success,false);
 assert.equal(cadenceSchema.safeParse({...base,start:'23:55',end:'00:00'}).success,false);
});

test('Manual reservation works outside automatic cadence and cannot overlap',()=>{const s=fresh();s.cadence={enabled:false};s.jobs=[{id:'manual',project:'p',status:'Pendente'}];const a=claim(s,'p',1);assert.equal(a.job.id,'manual');assert.equal(a.job.status,'Em análise');assert.throws(()=>claim(s,'p',2),/não elegível/);});

const completeReads=(state)=>{state.snapshots=['7d','3d','yesterday','today'].map(period=>windowRead(period));};
test('Takeover expires the old lease and prevents it from completing with new reads',()=>{
 const s=fresh(),old={id:'old',project:'p',status:'Em análise',startedAt:new Date(Date.now()-46*60000).toISOString()},pending={id:'new',project:'p',status:'Pendente'};
 s.cadence={enabled:false};s.jobs=[pending,old];s.agents={p:{jobId:'old',status:'Em análise',lastSuccessAt:'2026-11-01T12:00:00Z'}};
 const next=claim(s,'p',1).job;
 assert.equal(next.id,'new');assert.equal(old.status,'Falhou');assert.ok(old.expiredAt);assert.equal(s.agents.p.jobId,'new');
 completeReads(s);
 assert.throws(()=>updateRun(s,old,'Concluída','stale result'),/encerrada/);
 assert.throws(()=>updateRun(s,old,'Em análise','retry'),/encerrada/);
 assert.equal(s.reports.length,0);assert.equal(s.agents.p.jobId,'new');
 updateRun(s,next,'Concluída','current result');assert.equal(s.reports.length,1);assert.equal(s.reports[0].jobId,'new');
});
test('Expired current lease cannot complete or renew itself',()=>{
 const s=fresh(),old={id:'old',project:'p',status:'Em análise',startedAt:new Date(Date.now()-46*60000).toISOString()};s.jobs=[old];s.agents={p:{jobId:'old',status:'Em análise'}};completeReads(s);
 assert.throws(()=>updateRun(s,old,'Concluída','late result'),/expirada/);
 assert.throws(()=>updateRun(s,old,'Em análise','renew'),/expirada/);
 assert.equal(s.reports.length,0);
});
test('Current job ownership fences a still-valid replaced worker',()=>{
 const s=fresh(),old={id:'old',project:'p',status:'Em análise',startedAt:new Date(Date.now()-1000).toISOString()};s.jobs=[old];s.agents={p:{jobId:'other',status:'Em análise'}};completeReads(s);
 assert.throws(()=>updateRun(s,old,'Concluída','stale'),/substituída/);
 assert.throws(()=>updateRun(s,old,'Falhou','stale error'),/substituída/);
 assert.equal(s.agents.p.jobId,'other');assert.equal(s.reports.length,0);
});
test('Terminal replay is idempotent and cannot change result, note, or ownership',()=>{
 for(const status of ['Concluída','Falhou','Cancelada']){
  const s=fresh(),j={id:'done',project:'p',status,note:'original',updatedAt:'2026-11-01T12:00:00Z'};
  s.jobs=[j];s.agents={p:{jobId:'new',status:'Em análise'}};
  const before=JSON.stringify(s);
  updateRun(s,j,status,'different note');assert.equal(JSON.stringify(s),before);
  for(const target of ['Pendente','Em análise','Concluída','Falhou','Cancelada'].filter(x=>x!==status))assert.throws(()=>updateRun(s,j,target,'replay'),/encerrada/);
  assert.equal(JSON.stringify(s),before);
 }
});
test('Legacy pending job starts with fresh timestamps through jobStatus',()=>{
 const s=fresh(),j={id:'pending',project:'p',status:'Pendente',startedAt:'2026-01-01T00:00:00Z',completedAt:'2026-01-01T01:00:00Z'};s.jobs=[j];
 updateRun(s,j,'Em análise','begin');
 assert.ok(Date.parse(j.startedAt)>Date.now()-1000);assert.equal(j.completedAt,undefined);assert.equal(s.agents.p.jobId,'pending');
 s.snapshots=['7d','3d','yesterday','today'].map(period=>({projectId:'p',period,level:'campaign',complete:true,fetchedAt:'2026-01-01T01:00:00Z',rows:[]}));
 assert.throws(()=>updateRun(s,j,'Concluída','old reads'),/incompleta/);
 assert.throws(()=>updateRun(s,j,'Pendente','reset'),/não pode voltar/);
});
test('Legacy single running job without an agent owner can finish a valid lease',()=>{
 const s=fresh(),j={id:'legacy',project:'p',status:'Em análise',startedAt:new Date(Date.now()-1000).toISOString()};s.jobs=[j];completeReads(s);
 updateRun(s,j,'Concluída','legacy completion');assert.equal(s.agents.p.jobId,'legacy');assert.equal(s.reports[0].jobId,'legacy');
});
test('Legacy running jobs cannot both adopt an absent owner',()=>{
 const s=fresh(),startedAt=new Date(Date.now()-1000).toISOString(),a={id:'a',project:'p',status:'Em análise',startedAt},b={id:'b',project:'p',status:'Em análise',startedAt};s.jobs=[a,b];completeReads(s);
 assert.throws(()=>updateRun(s,a,'Concluída','ambiguous legacy'),/substituída/);assert.equal(s.reports.length,0);
});
test('jobStatus takeover expires stale attempts, while active overlap stays protected',()=>{
 const s=fresh(),old={id:'old',project:'p',status:'Em análise',startedAt:new Date(Date.now()-46*60000).toISOString()},j={id:'new',project:'p',status:'Pendente'};s.jobs=[j,old];s.agents={p:{jobId:'old'}};
 updateRun(s,j,'Em análise','begin');assert.equal(old.status,'Falhou');assert.equal(s.agents.p.jobId,'new');
 const pending={id:'third',project:'p',status:'Pendente'};s.jobs.unshift(pending);
 assert.throws(()=>updateRun(s,pending,'Em análise','overlap'),/Já existe/);assert.equal(pending.status,'Pendente');assert.equal(s.agents.p.jobId,'new');
});

test('A queued cancellation does not overwrite another running owner',()=>{
 const s=fresh(),j={id:'queued',project:'p',status:'Pendente'};s.jobs=[j];s.agents={p:{jobId:'running',status:'Em análise'}};
 updateRun(s,j,'Cancelada','cancel queued');assert.equal(j.status,'Cancelada');assert.equal(s.agents.p.jobId,'running');assert.equal(s.agents.p.status,'Em análise');
});

test('One batch admits every due project at20h and both can complete after the window closes',t=>{
 const at=Date.parse('2026-11-03T00:00:00.000Z');t.mock.timers.enable({apis:['Date'],now:at});
 const s=fresh();s.config.q={projectName:'John'};
 const result=claimBatch(s,['p','q'],7);
 assert.equal(result.state,s);assert.equal(result.revision,7);assert.equal(result.jobs.length,2);
 assert.equal(new Set(result.jobs.map(job=>job.id)).size,2);
 assert.ok(result.jobs.every(job=>job.startedAt==='2026-11-03T00:00:00.000Z'&&job.slotKey==='2026-11-02:1200:America/Boa_Vista'));
 t.mock.timers.setTime(at+2*60000);assert.equal(duePlan(s).due.length,0);
 s.snapshots=['p','q'].flatMap(projectId=>['7d','3d','yesterday','today'].map(period=>({...windowRead(period),projectId})));
 for(const job of result.jobs)updateRun(s,job,'Concluída','Source collected after batch admission.');
 assert.ok(s.jobs.every(job=>job.status==='Concluída'));
 assert.ok(s.jobs.every(job=>job.completedAt==='2026-11-03T00:02:00.000Z'));
 assert.equal(s.collaborationRounds.length,2);
});

test('Batch validation rejects malformed, duplicate, unknown, partial, or actively leased inputs atomically',()=>{
 const at=new Date('2026-11-02T12:00:00.000Z');
 for(const input of [undefined,[],['p','p'],['p','missing'],['p'],['p',null],['p','']]){
  const s=fresh();s.config.q={projectName:'John'};const before=JSON.stringify(s);
  assert.throws(()=>claimBatch(s,input,1,at));assert.equal(JSON.stringify(s),before);
 }
 const s=fresh();s.config.q={projectName:'John'};s.jobs=[{id:'live',project:'q',status:'Em análise',startedAt:'2026-11-02T11:59:00.000Z'}];s.agents={q:{jobId:'live',status:'Em análise'}};
 const before=JSON.stringify(s);assert.throws(()=>claimBatch(s,['p','q'],1,at),/elegível/);assert.equal(JSON.stringify(s),before);
 const paused=fresh();paused.paused=true;const beforePause=JSON.stringify(paused);assert.throws(()=>claimBatch(paused,['p'],1,at),/elegível/);assert.equal(JSON.stringify(paused),beforePause);
});

test('Batch preserves manual jobs outside the automatic window and takes over only expired work',()=>{
 const at=new Date('2026-11-02T03:00:00.000Z'),s=fresh();s.config.q={projectName:'John'};s.cadence={enabled:false};
 s.jobs=[{id:'p-manual',project:'p',status:'Pendente'},{id:'q-manual',project:'q',status:'Pendente'},{id:'expired',project:'q',status:'Em análise',startedAt:'2026-11-02T02:14:00.000Z'}];s.agents={q:{jobId:'expired',status:'Em análise'}};
 const result=claimBatch(s,['p','q'],1,at);
 assert.deepEqual(result.jobs.map(job=>job.id),['p-manual','q-manual']);assert.ok(result.jobs.every(job=>job.slotKey===null));
 assert.equal(s.jobs.find(job=>job.id==='expired').status,'Falhou');assert.equal(s.agents.q.jobId,'q-manual');
 const before=JSON.stringify(s);assert.throws(()=>claimBatch(s,['p','q'],2,at),/elegível/);assert.equal(JSON.stringify(s),before);
});
