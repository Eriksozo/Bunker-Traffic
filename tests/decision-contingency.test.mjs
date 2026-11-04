import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionContingency,financialScope,assertExecutionIsolation,observedPerformance,postActionDelta,contingencyPlan} from '../lib/decision-contingency.mjs';
import {autonomousWorkPlan} from '../lib/autonomous-work.mjs';
const now=Date.parse('2026-11-04T15:00:00Z'),stamp=n=>new Date(now+n).toISOString();
const row=(id,budget=100)=>({id:'internal-'+id,externalId:id,adAccountId:'a',provider:'Meta',level:'campaign',name:id,status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'BRL',dailyBudget:budget,spend:100,revenueNet:200,productCost:0,saleTax:0,adCosts:0,frontOrders:2,orders:3,checkouts:4});
const proposal=(id,objectId='c',before=100,after=150)=>({id,project:'p',status:'Aprovada',expiresAt:stamp(3600000),payload:{level:'campaign',provider:'Meta',adAccountId:'a',objectId,action:'budget',currency:'BRL',before:{dailyBudget:before},after:{dailyBudget:after}}});
function setup(){
 const rows=[row('c'),row('d',200)],snapshot={projectId:'p',period:'today',level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-04T00:00:00Z',to:'2026-11-05T00:00:00Z',timezone:'UTC',fetchedAt:stamp(-1000),lastSyncAt:stamp(-2000),coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true},rows};
 const state={config:{p:{projectName:'John',dailyCap:500,lossCap:null}},snapshots:[{...structuredClone(snapshot),fetchedAt:stamp(-100000)}],executions:[],proposals:[]};
 return {state,project:'p',row:rows[0],action:'increase',percent:50,liveItems:[{projectId:'p',snapshot}],now};
}
test('Headroom accounts for native currency and exact total budget, without mutating financial state',()=>{
 const x=setup(),before=JSON.stringify(x),p=decisionContingency(x);assert.equal(p.exposure.activeDaily,300);assert.equal(p.exposure.projectedDaily,350);assert.equal(p.blocked,false);assert.equal(JSON.stringify(x),before);
 x.row.budgetCurrency='USD';x.row.budgetRate=5;assert.equal(decisionContingency(x).exposure.activeDaily,700);assert.equal(decisionContingency(x).blocked,true);
});
test('Missing caps stay absent; explicit zero is a zero limit, not unbounded permission',()=>{
 const x=setup();x.state.config.p.dailyCap=null;const p=decisionContingency(x);assert.equal(p.exposure.dailyCap,null);assert.ok(p.warnings.some(s=>s.includes('Teto diário não definido')));assert.equal(p.blocked,false);
 x.state.config.p.dailyCap=0;assert.equal(decisionContingency(x).blocked,true);
});
test('Spend cap and projected aggregate cap independently veto increases but allow fresh containment',()=>{
 for(const cap of [150,320]){const x=setup();x.state.config.p.dailyCap=cap;assert.equal(decisionContingency(x).blocked,true);x.action='reduce';x.percent=20;assert.equal(decisionContingency(x).blocked,false);}
});
test('Pending increases reserve headroom, alternative versions are not added twice, reductions release nothing',()=>{
 const x=setup();x.state.proposals=[proposal('one','d',200,350),proposal('alternative','d',200,400),proposal('reduction','c',100,20)];const p=decisionContingency(x);assert.equal(p.exposure.reservedExtra,200);assert.equal(p.exposure.projectedDaily,550);assert.equal(p.blocked,true);
 x.state.executions=[{proposalId:'alternative',status:'Confirmada'}];assert.equal(decisionContingency(x).exposure.reservedExtra,150);
});
test('An ambiguous application already visible in cache does not reserve the applied increase twice',()=>{
 const x=setup();x.state.proposals=[proposal('one','d',200,350)];x.state.executions=[{proposalId:'one',project:'p',status:'Verificação necessária',submittedAt:stamp(-1000)}];x.liveItems[0].snapshot.rows[1].dailyBudget=350;assert.equal(decisionContingency(x).exposure.reservedExtra,0);
});
test('Unknown FX/ABO/coverage does not become zero exposure or pass a configured ceiling',()=>{
 for(const mode of ['fx','abo','coverage','spend']){const x=setup();if(mode==='fx'){x.row.budgetCurrency='USD';delete x.row.budgetRate;}if(mode==='abo')x.liveItems[0].snapshot.rows.forEach(r=>r.dailyBudget=0);if(mode==='coverage')delete x.liveItems[0].snapshot.coverage;if(mode==='spend')x.row.spend=null;const p=decisionContingency(x);assert.equal(p.blocked,true);if(mode==='abo')assert.equal(p.exposure.activeDaily,null);if(mode==='spend')assert.equal(p.exposure.spend,null);}
});
test('Unavailable, old or unconfirmed source clock cannot authorize a configured financial ceiling',()=>{
 for(const mode of ['missing','old','clock']){const x=setup();if(mode==='missing')x.liveItems=[];if(mode==='old')x.liveItems[0].snapshot.fetchedAt=stamp(-300001);if(mode==='clock')x.liveItems[0].snapshot.lastSyncAt=null;assert.equal(decisionContingency(x).blocked,true);}
});
test('Loss limit means deterioration since a comparable round, not total daily loss',()=>{
 const x=setup();x.state.config.p.lossCap=50;x.row.revenueNet=100;const p=decisionContingency(x);assert.equal(p.exposure.roundResultDelta,-100);assert.equal(p.blocked,true);
 x.liveItems[0].snapshot.from='2026-11-04T01:00:00Z';const unknown=decisionContingency(x);assert.equal(unknown.exposure.roundResultDelta,null);assert.ok(unknown.blockers.some(s=>s.includes('perda da rodada')));
});
test('A new identity or a different cohort cannot manufacture comparable round losses',()=>{
 const x=setup();x.state.config.p.lossCap=50;x.liveItems[0].snapshot.rows.push(row('new'));const p=decisionContingency(x);assert.equal(p.exposure.roundResultDelta,null);assert.equal(p.blocked,true);
});
test('Incident is scoped to project/account/object and does not stop reduction proposals',()=>{
 const x=setup();x.state.incidents=[{project:'p',status:'Em retomada',scope:{objectIds:[{adAccountId:'a',objectId:'c'}]}}];assert.equal(decisionContingency(x).blocked,true);x.action='reduce';assert.equal(decisionContingency(x).blocked,false);x.state.incidents[0].scope.objectIds[0].adAccountId='other';const other={...row('c'),adAccountId:'other'};x.liveItems[0].snapshot.rows.push(other);x.state.snapshots[0].rows.push(structuredClone(other));x.action='increase';assert.equal(decisionContingency(x).blocked,false);
});
test('Two different ads sharing CBO are one financial scope; another account stays isolated',()=>{
 const x=setup();x.state.snapshots.push({...x.state.snapshots[0],level:'ad',rows:[{...row('ad1'),campaignExternalId:'c'},{...row('ad2'),campaignExternalId:'c'}]});const a=proposal('pa','ad1'),b=proposal('pb','ad2');a.payload.level=b.payload.level='ad';a.payload.action=b.payload.action='status';a.payload.after=b.payload.after={status:'PAUSED'};
 assert.equal(financialScope(x.state,a),financialScope(x.state,b));x.state.proposals=[a,b];x.state.executions=[{id:'e',project:'p',proposalId:a.id,status:'Reservada',leaseUntil:stamp(1000)}];assert.throws(()=>assertExecutionIsolation(x.state,b,null,now),/outra execução/);b.payload.adAccountId='other';assert.doesNotThrow(()=>assertExecutionIsolation(x.state,b,null,now));
});
test('Ambiguous sends hold the scope after lease expiry, confirmed changes require observation before another increase',()=>{
 const x=setup(),old=proposal('old'),next=proposal('next');x.state.proposals=[old,next];x.state.executions=[{id:'e',proposalId:'old',project:'p',status:'Verificação necessária',submittedAt:stamp(-10000),leaseUntil:stamp(-1000)}];assert.throws(()=>assertExecutionIsolation(x.state,next,null,now),/sem confirmação/);
 Object.assign(x.state.executions[0],{status:'Confirmada',confirmedAt:stamp(-10000)});assert.throws(()=>assertExecutionIsolation(x.state,next,null,now),/60 minutos/);next.payload.after.dailyBudget=50;assert.doesNotThrow(()=>assertExecutionIsolation(x.state,next,null,now));
});
test('Warmup costs remain in portfolio exposure while optimization scope remains separate',()=>{
 const x=setup();x.liveItems[0].snapshot.rows[1].name='[ENGAJAMENTO]';assert.equal(decisionContingency(x).exposure.activeDaily,300);
});
test('Post-action comparison uses explicit BRL same-window baselines, never retroactive or cross-currency sums',()=>{
 const x=setup(),r=row('c'),input={metricsCurrency:'BRL',from:'2026-11-04T00:00:00Z',to:'2026-11-05T00:00:00Z',timezone:'UTC',fetchedAt:stamp(-1000)},before=observedPerformance(input,r),after=observedPerformance({...input,fetchedAt:stamp(0)},{...r,spend:150,revenueNet:230,frontOrders:3});
 assert.equal(postActionDelta(before,after).spend,50);assert.equal(postActionDelta(before,after).result,-20);assert.equal(postActionDelta(before,after).frontOrders,1);
 assert.equal(observedPerformance({...input,metricsCurrency:'USD'},r),null);assert.equal(postActionDelta(before,{...after,currency:'USD'}),null);assert.equal(postActionDelta(before,{...after,from:'2026-11-03T00:00:00Z'}),null);assert.equal(postActionDelta(before,{...after,spend:5}),null);
});
test('Due followups consume fresh existing cache, do not invent a completion or provider collection',()=>{
 const x=setup(),p=proposal('p');x.state.proposals=[p];x.state.executions=[{id:'e',proposalId:p.id,project:'p',status:'Confirmada',confirmedAt:stamp(-20*60000)}];const before=JSON.stringify(x.state),plan=contingencyPlan(x.state,x.liveItems,now);assert.equal(plan.followUps[0].checkpointMinutes,15);assert.equal(plan.followUps[0].readyFromCache,true);assert.equal(plan.followUps[0].delta,null);assert.equal(plan.followUps[0].baselineAvailable,false);assert.equal(JSON.stringify(x.state),before);
 const base={execution:{executions:[]},collaboration:{rounds:[],proposals:[]},contingency:plan};let work=autonomousWorkPlan(x.state,base,now);assert.equal(work.ready[0].kind,'followUp');assert.equal(work.counts.collection,0);x.state.paused=true;work=autonomousWorkPlan(x.state,base,now);assert.equal(work.ready.length,0);
});
test('Activating a child inside an existing CBO does not invent another parent budget',()=>{
 const x=setup();x.state.config.p.dailyCap=300;
 const ad={...row('ad'),level:'ad',campaignExternalId:'c',status:'PAUSED',effectiveStatus:'PAUSED',dailyBudget:undefined};
 x.state.snapshots.push({...x.state.snapshots[0],level:'ad',rows:[ad]});
 const p=proposal('child','ad');Object.assign(p.payload,{level:'ad',action:'status',before:{status:'PAUSED'},after:{status:'ACTIVE'},activationBudget:{level:'campaign',externalId:'c',adAccountId:'a',provider:'Meta',dailyBudget:100,currency:'BRL',status:'ACTIVE'}});
 x.proposal=p;x.row=ad;x.action='activate';const guard=decisionContingency(x);assert.equal(guard.exposure.projectedDaily,300);assert.equal(guard.blocked,false);
 x.state.proposals=[{...structuredClone(p),id:'another-child'}];assert.equal(decisionContingency(x).exposure.reservedExtra,0);
});
test('Missing tracked campaigns invalidate financial coverage instead of quietly freeing budget',()=>{
 const x=setup();x.liveItems[0].snapshot.rows.pop();const p=decisionContingency(x);assert.equal(p.exposure.completeExposure,false);assert.equal(p.blocked,true);assert.ok(p.warnings.some(w=>w.includes('parcial')));
});
test('Reservations in another currency cannot be converted using the current object currency by accident',()=>{
 const x=setup();x.state.proposals=[proposal('fx-drift','d',200,300)];x.state.proposals[0].payload.currency='USD';const p=decisionContingency(x);assert.equal(p.exposure.reservedExtra,null);assert.equal(p.exposure.completeExposure,false);assert.equal(p.blocked,true);
});
test('Reactivation cannot silently inherit a changed parent status from live cache',()=>{
 const x=setup();x.state.config.p.dailyCap=1000;const p=proposal('activate');p.payload.action='status';p.payload.before={status:'PAUSED'};p.payload.after={status:'ACTIVE'};p.payload.activationBudget={level:'campaign',externalId:'c',adAccountId:'a',provider:'Meta',dailyBudget:100,currency:'BRL',status:'PAUSED'};x.proposal=p;const g=decisionContingency(x);assert.equal(g.exposure.projectedDaily,null);assert.equal(g.blocked,true);
});
test('4000 seeded portfolio scenarios never accept a configured ceiling with incomplete or excess exposure',()=>{
 let seed=123456789;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);let accepted=0,rejected=0;
 for(let n=0;n<4000;n++){
  const x=setup(),cap=Math.floor(rnd()*5000);x.state.config.p.dailyCap=cap;x.percent=1+Math.floor(rnd()*300);x.row.dailyBudget=1+Math.floor(rnd()*500);x.liveItems[0].snapshot.rows[1].dailyBudget=1+Math.floor(rnd()*500);
  if(n%3===0){x.row.budgetCurrency='USD';x.row.budgetRate=3+rnd()*4;}if(n%17===0){x.row.budgetCurrency='USD';delete x.row.budgetRate;}if(n%13===0)x.row.spend=null;if(n%11===0)x.liveItems[0].snapshot.lastSyncAt=null;
  if(n%5===0)x.state.proposals=[proposal('pending','d',x.liveItems[0].snapshot.rows[1].dailyBudget,600)];
  const g=decisionContingency(x);
  if(!g.blocked){accepted++;assert.ok(g.exposure.completeExposure);assert.ok(Number.isFinite(g.exposure.projectedDaily));assert.ok(g.exposure.projectedDaily<=cap);assert.ok(g.exposure.spend<cap);assert.ok(g.exposure.sourceFresh);}else rejected++;
  x.action='reduce';x.proposal=null;assert.equal(decisionContingency(x).blocked,false);
 }
 assert.ok(accepted>500);assert.ok(rejected>500);
});
