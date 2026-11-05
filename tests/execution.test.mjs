import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureCollaboration,compactCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution,executionPlan,executionLimits,monitorExecution} from '../lib/execution.mjs';
const now=Date.parse('2026-11-02T18:00:00Z'),project='11111111-1111-4111-8111-111111111111',internal='22222222-2222-4222-8222-222222222222';
const date=t=>new Date(t).toISOString();
function fixture(action='budget',options={}){
 const row={id:internal,externalId:'external-meta-id',adAccountId:'account-meta',provider:'Meta',name:'Campaign',accountName:'Account',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',...(options.row||{})};
 const level=options.level||'campaign';
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Local test'}},agents:{[project]:{jobId:job.id}},jobs:[job],snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T04:00:00Z':period==='3d'?'2026-10-30T04:00:00Z':period==='yesterday'?'2026-11-01T04:00:00Z':'2026-10-26T04:00:00Z',to:period==='today'?'2026-11-03T04:00:00Z':'2026-11-02T04:00:00Z',timezone:'America/Boa_Vista',fetchedAt:date(now-2000),lastSyncAt:null,rows:[structuredClone(row)]}))};
 if(level!=='campaign'){for(const snapshot of state.snapshots)snapshot.rows=[{...row,...options.campaign}];state.snapshots.push({...structuredClone(state.snapshots.at(-1)),level,rows:[structuredClone(row)]});}
 if(options.adset)state.snapshots.push({...structuredClone(state.snapshots[0]),period:'today',level:'adset',rows:[{...row,...options.adset}]});
 const round=ensureCollaboration(state,job,now),evidenceRefs=[{period:'today',level,adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:date(now-2000)}];let ops;
 for(const agentId of ['traffic','creative','budget','ops']){const lease=claimCollaboration(state,{roundId:round.id,agentId,executionRef:'actual-run-'+agentId,clientId:'claim-'+agentId},now);if(agentId==='ops'){ops=lease;break;}postCollaboration(state,{roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'conclusion-'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Evidence-based perspective',evidenceRefs},now);}
 const payload={title:'Exact operation',reason:'Observed acquisition',action,level,provider:'Meta',adAccountId:row.adAccountId,objectId:row.externalId,currency:'USD',budgetOwner:'CBO',before:action==='budget'?{dailyBudget:100}:{status:row.status},after:action==='budget'?{dailyBudget:150}:{status:row.status==='ACTIVE'?'PAUSED':'ACTIVE'},opinionRefs:round.stages.slice(0,3).map(s=>s.conclusionId),evidenceRefs};
 const p=submitProposal(state,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'proposal',payload,expiresAt:date(now+(options.validForMs||300000))},now);
 for(const agentId of ['traffic','budget']){const lease=claimCollaboration(state,{roundId:round.id,agentId,proposalId:p.id,executionRef:'review-'+agentId,clientId:'peer-'+agentId},now);reviewProposal(state,{id:p.id,version:p.version,signature:p.signature,decision:'approve',comment:'Independent review',clientId:'review-'+agentId,claimId:lease.claimId,executionRef:lease.executionRef},{kind:'agent',agentId},now);}
 reviewProposal(state,{id:p.id,version:p.version,signature:p.signature,decision:'approve',comment:'Exact scope approved',clientId:'owner'},{kind:'owner',id:'owner-local'},now);
 const args={proposalId:p.id,version:p.version,signature:p.signature,executionRef:'actual-executor-run',clientId:'execution-claim'};
 const observation=(t=now,changes={})=>({projectId:project,level,source:'Malva MCP',complete:true,fetchedAt:date(t),rows:[{...row,...changes}]});
 return {state,p,args,row,observation};
}
function prepared(action='budget',options={}){const f=fixture(action,options),e=claimExecution(f.state,f.args,now),args={id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'prepare',observation:f.observation()};prepareExecution(f.state,args,now);return {...f,e,prepareArgs:args,submitArgs:{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'dispatch'}};}

test('Dispatch requires the exact owner-approved immutable version, current context and unexpired authority',()=>{
 for(const mutate of [f=>f.p.status='Em revisão',f=>f.args.signature='different',f=>f.args.version=2,f=>f.p.payload.after.dailyBudget=900,f=>f.state.paused=true,f=>f.state.snapshots[0].rows[0].dailyBudget=999]){const f=fixture();mutate(f);assert.throws(()=>claimExecution(f.state,f.args,now));assert.equal(f.state.executions?.length||0,0);}
 const f=fixture();assert.throws(()=>claimExecution(f.state,f.args,now+300001),/expirada/);
});
test('Preflight rejects notes, stale reads, wrong native before, currency, provider, account or internal ID',()=>{
 for(const observation of [f=>({note:'It was checked'}),f=>f.observation(now-1),f=>f.observation(now,{dailyBudget:500}),f=>f.observation(now,{budgetCurrency:'BRL'}),f=>f.observation(now,{provider:'Other'}),f=>f.observation(now,{adAccountId:'other'}),f=>f.observation(now,{id:'external-meta-id'}),f=>f.observation(now,{id:'33333333-3333-4333-8333-333333333333'})]){const f=fixture(),e=claimExecution(f.state,f.args,now);assert.throws(()=>prepareExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'prepare',observation:observation(f)},now));assert.equal(e.status,'Reservada');}
});
test('Prepared commands use the internal Malva UUID and exact absolute native amount; stale or changed commands cannot submit',()=>{
 const f=prepared();assert.deepEqual(f.e.command,{tool:'tracking_set_ad_budget',arguments:{objectId:internal,projectId:project,dailyBudget:150}});
 assert.throws(()=>submitExecution(f.state,f.submitArgs,now+executionLimits.observationAgeMs+1),/Pré-conferência/);
 f.e.command.arguments.dailyBudget=999;assert.throws(()=>submitExecution(f.state,f.submitArgs,now+1),/comando mudou/);
 const status=prepared('status');assert.deepEqual(status.e.command,{tool:'tracking_set_ad_status',arguments:{objectId:internal,projectId:project,status:'PAUSED'}});
});
test('Persisted dispatch is one-shot: retries and ambiguous failures only permit verification',()=>{
 const f=prepared(),sent=submitExecution(f.state,f.submitArgs,now+1);assert.equal(sent.dispatchGranted,true);assert.equal(sent.execution.id,f.e.id);assert.equal(f.e.status,'Enviada');
 assert.equal(submitExecution(f.state,f.submitArgs,now+2).dispatchGranted,false);
 assert.throws(()=>submitExecution(f.state,{...f.submitArgs,clientId:'second-dispatch'},now+2),/Não reenviar/);
 assert.throws(()=>claimExecution(f.state,{...f.args,clientId:'another-execution'},now+2),/já possui despacho/);
 failExecution(f.state,{...f.submitArgs,clientId:'timeout',reason:'Network outcome unknown'},now+3);assert.equal(f.e.status,'Verificação necessária');assert.equal(executionPlan(f.state,now+3).executions[0].verificationOnly,true);assert.equal(f.p.appliedAt,undefined);
 assert.throws(()=>prepareExecution(f.state,{...f.prepareArgs,clientId:'another-prepare'},now+3),/outra mutação/);
});
test('Only fresh complete readback after dispatch confirms exact after and same IDs; confirmation can outlive approval',()=>{
 const f=prepared();submitExecution(f.state,f.submitArgs,now+1);
 const args={id:f.e.id,clientId:'confirm',executionRef:'actual-verifier-run'};
 for(const observation of [f.observation(now,{dailyBudget:150}),f.observation(now+2,{dailyBudget:149}),f.observation(now+2,{dailyBudget:150,id:'33333333-3333-4333-8333-333333333333'}),{note:'Provider said saved'}])assert.throws(()=>confirmExecution(f.state,{...args,observation},now+2));
 confirmExecution(f.state,{...args,observation:f.observation(now+400000,{dailyBudget:150})},now+400000);assert.equal(f.e.status,'Confirmada');assert.equal(f.p.appliedAt,date(now+400000));assert.equal(f.state.snapshots.at(-1).rows[0].dailyBudget,100);
 const before=structuredClone(f.e);confirmExecution(f.state,{...args,observation:f.observation(now+400000,{dailyBudget:150})},now+400001);assert.deepEqual(f.e,before);
 assert.throws(()=>failExecution(f.state,{...f.submitArgs,clientId:'late-failure',reason:'Overwrite'},now+400001),/imutável/);
});
test('A pre-dispatch failure is never marked applied and cannot silently create another execution',()=>{
 const f=fixture(),e=claimExecution(f.state,f.args,now);failExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'failed',reason:'Provider unavailable before dispatch'},now+1);assert.equal(e.status,'Falhou');assert.equal(f.p.appliedAt,undefined);assert.throws(()=>claimExecution(f.state,{...f.args,clientId:'retry'},now+2),/reserva válida/);
});
test('Post-dispatch failure and confirmation survive pause/source refresh without issuing another dispatch',()=>{
 const f=prepared();submitExecution(f.state,f.submitArgs,now+1);f.state.paused=true;f.state.snapshots.at(-1).rows[0].dailyBudget=150;
 failExecution(f.state,{...f.submitArgs,clientId:'ambiguous',reason:'Connection interrupted after dispatch'},now+2);assert.equal(f.e.status,'Verificação necessária');
 assert.equal(submitExecution(f.state,f.submitArgs,now+3).dispatchGranted,false);
 confirmExecution(f.state,{id:f.e.id,clientId:'readback',executionRef:'verifier-after-refresh',observation:f.observation(now+4,{dailyBudget:150})},now+4);assert.equal(f.e.status,'Confirmada');assert.equal(f.p.executionConfirmedAt,date(now+4));
});
test('An expired authorization with pending dispatch survives source replacement and history compaction until verified',()=>{
 const f=prepared();submitExecution(f.state,f.submitArgs,now+1);const round=f.state.collaborationRounds[0];
 for(let i=1;i<=3;i++)f.state.collaborationRounds.unshift({...structuredClone(round),id:'newer-round-'+i,jobId:'other-job-'+i,status:'Concluída',createdAt:date(now+i*1000)});
 f.state.agents[project].jobId='another-owner';f.state.snapshots.at(-1).rows[0].dailyBudget=150;
 const later=now+400000,compacted=compactCollaboration(f.state,later);assert.ok(f.state.proposals.some(p=>p.id===f.p.id));assert.equal(f.state.executions[0].status,'Enviada');assert.ok(!compacted.archives.some(a=>a.payload.round.id===round.id));
 confirmExecution(f.state,{id:f.e.id,clientId:'after-expiry',executionRef:'late-real-readback',observation:f.observation(later,{dailyBudget:150})},later);
 const settled=compactCollaboration(f.state,later+1),archive=settled.archives.find(a=>a.payload.round.id===round.id);assert.ok(archive);assert.equal(archive.payload.executions[0].status,'Confirmada');assert.equal(archive.payload.proposals[0].appliedAt,date(later));assert.equal(f.state.executions.length,0);assert.ok(!f.state.proposals.some(p=>p.id===f.p.id));
});

test('Activation approval seals its native owner budget; drift cannot prepare or confirm an activation',()=>{
 const f=fixture('status',{row:{status:'PAUSED'}}),e=claimExecution(f.state,f.args,now),args={id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'activation-prepare'};
 assert.deepEqual(f.p.payload.activationBudget,{budgetOwner:'CBO',level:'campaign',id:internal,externalId:f.row.externalId,adAccountId:f.row.adAccountId,provider:'Meta',currency:'USD',dailyBudget:100,lifetimeBudget:null,status:'PAUSED'});
 assert.throws(()=>prepareExecution(f.state,{...args,observation:f.observation(now,{dailyBudget:9000})},now),/anterior mudou/);
 prepareExecution(f.state,{...args,observation:f.observation()},now);
 submitExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'activation-dispatch'},now+1);
 const confirm={id:e.id,executionRef:'activation-verifier',clientId:'activation-confirm'};
 assert.throws(()=>confirmExecution(f.state,{...confirm,observation:f.observation(now+2,{status:'ACTIVE',dailyBudget:9000})},now+2),/fora da alteração/);
 confirmExecution(f.state,{...confirm,observation:f.observation(now+3,{status:'ACTIVE'})},now+3);assert.equal(e.readback.budgetOwner.row.dailyBudget,100);assert.equal(e.status,'Confirmada');
});

test('Every preflight preserves the frozen target status and budget outside the field being changed',()=>{
 for(const [action,changes] of [['budget',{status:'PAUSED'}],['status',{dailyBudget:9000}],['status',{lifetimeBudget:9000}]]){
  const f=fixture(action),e=claimExecution(f.state,f.args,now);assert.throws(()=>prepareExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'drift',observation:f.observation(now,changes)},now),/anterior mudou/);assert.equal(e.status,'Reservada');
 }
});

test('Activating a child requires a fresh exact financial parent and confirms that parent after dispatch',()=>{
 const f=fixture('status',{level:'ad',row:{status:'PAUSED',dailyBudget:null,adsetExternalId:'parent-adset',campaignExternalId:'parent-campaign'},campaign:{id:'44444444-4444-4444-8444-444444444444',externalId:'parent-campaign',dailyBudget:250,status:'ACTIVE'},adset:{id:'33333333-3333-4333-8333-333333333333',externalId:'parent-adset',dailyBudget:null,campaignExternalId:'parent-campaign',status:'ACTIVE'}});
 const owner=f.p.payload.activationBudget;assert.equal(owner.externalId,'parent-campaign');assert.equal(owner.budgetOwner,'CBO');
 const parent=(t=now,changes={})=>({projectId:project,level:'campaign',source:'Malva MCP',complete:true,fetchedAt:date(t),rows:[{...f.state.snapshots.find(s=>s.period==='today'&&s.level==='campaign').rows[0],...changes}]});
 const e=claimExecution(f.state,f.args,now),args={id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'child-prepare'};
 for(const budgetOwner of [undefined,parent(now-1),parent(now,{dailyBudget:9000}),parent(now,{status:'PAUSED'}),parent(now,{budgetCurrency:'BRL'}),parent(now,{id:'55555555-5555-4555-8555-555555555555'})])assert.throws(()=>prepareExecution(f.state,{...args,observation:{...f.observation(),budgetOwner}},now));
 prepareExecution(f.state,{...args,observation:{...f.observation(),budgetOwner:parent()}},now);assert.equal(e.preflight.budgetOwner.row.dailyBudget,250);
 submitExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'child-dispatch'},now+1);
 const confirm={id:e.id,executionRef:'child-verifier',clientId:'child-confirm'};
 assert.throws(()=>confirmExecution(f.state,{...confirm,observation:{...f.observation(now+2,{status:'ACTIVE'}),budgetOwner:parent(now+2,{dailyBudget:9000})}},now+2),/proprietário mudou/);
 confirmExecution(f.state,{...confirm,observation:{...f.observation(now+3,{status:'ACTIVE'}),budgetOwner:parent(now+3)}},now+3);assert.equal(e.readback.budgetOwner.row.dailyBudget,250);assert.equal(e.status,'Confirmada');
});

test('A stale preflight refreshes before dispatch without reopening a sent execution',()=>{
 const f=prepared('budget',{validForMs:3600000}),later=now+executionLimits.observationAgeMs+1;
 let plan=executionPlan(f.state,later).executions[0];assert.equal(plan.canPrepare,true);assert.equal(plan.canSubmit,false);assert.match(plan.reason,/Pré-conferência venceu/);
 prepareExecution(f.state,{...f.prepareArgs,clientId:'fresh-prepare',observation:f.observation(later)},later);assert.equal(f.e.events.at(-1).kind,'refresh-preflight');
 assert.throws(()=>prepareExecution(f.state,{...f.prepareArgs,observation:f.observation(later+1)},later+1),/clientId reutilizado/);
 assert.equal(submitExecution(f.state,f.submitArgs,later+1).dispatchGranted,true);
 assert.throws(()=>prepareExecution(f.state,{...f.prepareArgs,clientId:'after-dispatch',observation:f.observation(later+2)},later+2),/outra mutação/);
});

test('An expired pre-dispatch lease can be reclaimed three times at most, fencing each old worker',()=>{
 const f=prepared('budget',{validForMs:24*3600000}),oldClaim={...f.submitArgs};let later=now+executionLimits.leaseMs;
 assert.equal(executionPlan(f.state,later).executions[0].canReclaim,true);
 const second=claimExecution(f.state,{...f.args,executionRef:'replacement-run',clientId:'replacement-claim'},later);assert.equal(second.attempt,2);assert.notEqual(second.claimId,oldClaim.claimId);assert.equal(second.status,'Reservada');assert.equal(second.attemptHistory[0].status,'Preparada');
 assert.throws(()=>prepareExecution(f.state,{...f.prepareArgs,observation:f.observation(later)},later),/Reserva não corresponde/);
 assert.throws(()=>submitExecution(f.state,oldClaim,later),/Reserva não corresponde/);
 assert.throws(()=>claimExecution(f.state,f.args,later),/Tentativa substituída/);
 failExecution(f.state,{id:second.id,claimId:second.claimId,executionRef:second.executionRef,clientId:'before-send-failed',reason:'Read unavailable before any dispatch'},later+1);
 later+=executionLimits.leaseMs;const third=claimExecution(f.state,{...f.args,executionRef:'third-run',clientId:'third-claim'},later);assert.equal(third.attempt,3);assert.equal(third.attemptHistory[1].status,'Falhou');
 assert.throws(()=>claimExecution(f.state,{...f.args,executionRef:'fourth-run',clientId:'fourth-claim'},later+executionLimits.leaseMs),/Limite de tentativas/);assert.equal(executionPlan(f.state,later+executionLimits.leaseMs).executions[0].canReclaim,false);
});

function confirmedWithPerformance(){
 const f=prepared();submitExecution(f.state,f.submitArgs,now+1);
 const metrics={spend:100,revenueNet:200,adCosts:0,productCost:0,saleTax:0,frontOrders:2,orders:3,checkouts:4};
 const observed=(t,patch={})=>({...f.observation(t,{dailyBudget:150,...metrics,...patch}),metricsCurrency:'BRL',from:'2026-11-02T04:00:00Z',to:'2026-11-03T04:00:00Z',timezone:'America/Boa_Vista'});
 confirmExecution(f.state,{id:f.e.id,clientId:'confirm-with-metrics',executionRef:'real-verifier',observation:observed(now+2)},now+2);
 return {...f,observed};
}
test('Post-action checkpoints require fresh new exact evidence, preserve late timing and never authorize dispatch',()=>{
 const f=confirmedWithPerformance(),t=now+20*60000;
 const args={id:f.e.id,entry:{checkpointMinutes:15},clientId:'monitor-15',executionRef:'real-follow-up',observation:f.observed(t,{spend:150,revenueNet:230,frontOrders:3})};
 const c=monitorExecution(f.state,args,t);assert.equal(c.delta.spend,50);assert.equal(c.delta.result,-20);assert.equal(c.delta.frontOrders,1);assert.equal(c.status,'Observado');assert.ok(c.lateByMs>4*60000);assert.equal(c.automaticAction,false);assert.equal(f.e.status,'Confirmada');assert.equal(f.e.command.arguments.dailyBudget,150);
 assert.equal(monitorExecution(f.state,args,t+1),c);assert.equal(f.e.monitorChecks.length,1);
 assert.throws(()=>monitorExecution(f.state,{...args,clientId:'duplicate-new-id'},t+1),/já foi registrada/);
 assert.throws(()=>monitorExecution(f.state,{...args,observation:f.observed(t,{spend:999})},t+1),/clientId/);
});
test('Monitoring cannot skip checkpoints, backdate a read, borrow another identity or use a future timestamp',()=>{
 for(const mode of ['early','skip','wrong-id','future','wrong-project']){
  const f=confirmedWithPerformance(),t=now+20*60000,args={id:f.e.id,entry:{checkpointMinutes:15},clientId:'check',executionRef:'reviewer',observation:f.observed(t)};
  if(mode==='early')args.observation=f.observed(now+10*60000);
  if(mode==='skip')args.entry.checkpointMinutes=30;
  if(mode==='wrong-id')args.observation.rows[0].id='33333333-3333-4333-8333-333333333333';
  if(mode==='future')args.observation.fetchedAt=date(t+1000);
  if(mode==='wrong-project')args.observation.rows[0].projectId='other';
  assert.throws(()=>monitorExecution(f.state,args,t));assert.equal(f.e.monitorChecks,undefined);
 }
});
test('Post-action financial delta is unavailable after external native change or day rollover; original readback remains',()=>{
 for(const mode of ['edit','day','currency']){const f=confirmedWithPerformance(),baseline=JSON.stringify(f.e.readback),t=now+20*60000,args={id:f.e.id,entry:{checkpointMinutes:15},clientId:'check',executionRef:'reviewer',observation:f.observed(t)};
  if(mode==='edit')args.observation.rows[0].dailyBudget=120;if(mode==='day')args.observation.from='2026-11-02T05:00:00Z';if(mode==='currency')delete args.observation.metricsCurrency;
  const c=monitorExecution(f.state,args,t);assert.equal(c.delta,null);assert.equal(JSON.stringify(f.e.readback),baseline);assert.equal(c.automaticAction,false);
 }
});
test('A post-action review never takes the place of confirming an ambiguous dispatch and respects Bunker pause',()=>{
 const f=prepared(),t=now+20*60000;submitExecution(f.state,f.submitArgs,now+1);assert.throws(()=>monitorExecution(f.state,{id:f.e.id,entry:{checkpointMinutes:15},clientId:'m',executionRef:'r',observation:f.observation(t)},t),/já confirmada/);
 const g=confirmedWithPerformance();g.state.paused=true;assert.throws(()=>monitorExecution(g.state,{id:g.e.id,entry:{checkpointMinutes:15},clientId:'m',executionRef:'r',observation:g.observed(t)},t),/pausado/);
});
test('An unexpired owner approval cannot dispatch after its four-period analysis expires',()=>{
 const f=fixture('budget',{validForMs:24*3600000});assert.throws(()=>claimExecution(f.state,f.args,now+3600001),/Análise vencida/);assert.equal(f.state.executions?.length||0,0);
});


test('A newly disabled account cannot receive an increase or activation in preflight',()=>{
 for(const [action,options] of [['budget',{}],['status',{row:{status:'PAUSED'}}]]){
  const f=fixture(action,options),e=claimExecution(f.state,f.args,now);
  assert.throws(()=>prepareExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'disabled',observation:f.observation(now,{accountStatus:{active:false}})},now),/aptidão ativa/);
  assert.equal(e.status,'Reservada');assert.equal(e.command,undefined);assert.equal(e.submittedAt,undefined);
 }
 const f=fixture('status'),e=claimExecution(f.state,f.args,now);
 prepareExecution(f.state,{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'contain',observation:f.observation(now,{accountStatus:{active:false}})},now);
 assert.equal(e.command.arguments.status,'PAUSED');
});
