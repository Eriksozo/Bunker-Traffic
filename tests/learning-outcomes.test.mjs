import test from 'node:test';
import assert from 'node:assert/strict';
import {autonomousLearningPlan,processAutonomousLearning} from '../lib/learning-outcomes.mjs';
import {learningCyclePlan} from '../lib/learning-cycle.mjs';
import {cloudNext,createCloudEngine} from '../lib/cloud-engine.mjs';
const now=Date.parse('2026-11-05T12:00:00Z'),stamp=n=>new Date(n).toISOString();
function fixture(){
 const applied='2026-11-03T12:00:00.000Z',row={id:'internal',externalId:'campaign',adAccountId:'account',provider:'Meta',budgetCurrency:'BRL',dailyBudget:80,status:'ACTIVE'};
 const p={id:'proposal',project:'p',status:'Aprovada',version:1,signature:'seal',approvedVersion:1,approvedSignature:'seal',appliedAt:applied,executionConfirmedAt:applied,payload:{level:'campaign',provider:'Meta',action:'budget',objectId:'campaign',adAccountId:'account',currency:'BRL',before:{dailyBudget:100},after:{dailyBudget:80}}};
 const e={id:'execution',project:'p',proposalId:p.id,proposalVersion:1,proposalSignature:'seal',status:'Confirmada',leaseUntil:applied,submittedAt:'2026-11-03T11:59:59Z',confirmedAt:applied,preflight:{fetchedAt:applied,row:{id:'internal'}},readback:{source:'Malva MCP',complete:true,projectId:'p',level:'campaign',fetchedAt:applied,row}};p.execution=structuredClone(e);
 const metrics={spend:100,revenueNet:150,adCosts:0,productCost:0,saleTax:0,frontOrders:2};
 const cuts=[['2026-11-02','2026-11-03',metrics],['2026-11-04','2026-11-05',{...metrics,revenueNet:250,frontOrders:3}]].map(([from,to,values])=>({projectId:'p',level:'campaign',source:'Malva MCP',complete:true,from:from+'T00:00:00.000Z',to:to+'T00:00:00.000Z',fetchedAt:stamp(now-1000),lastSyncAt:stamp(now-2000),timezone:'UTC',rows:[{...row,...values}]}));
 return {state:{config:{p:{projectName:'John'},q:{projectName:'Nico'}},snapshots:cuts,proposals:[p],executions:[e]},p,e};
}
test('Autonomous measurement is pure until committed and never calls a provider or changes controls',()=>{
 const {state}=fixture(),before=structuredClone(state),plan=autonomousLearningPlan(state,null,now);assert.equal(plan.ready.length,1);assert.deepEqual(state,before);
 assert.deepEqual(processAutonomousLearning(state,now),{kind:'learning',recorded:1,limited:0,providerWrites:0});assert.equal(state.knowledgeOutcomes.length,1);assert.equal(state.learningAttempts[0].status,'Medido');assert.deepEqual(state.proposals,before.proposals);assert.deepEqual(state.executions,before.executions);assert.deepEqual(state.config,before.config);
 const cycle=learningCyclePlan(state,'p',now);assert.equal(cycle.stats.measuredApplications,1);assert.equal(cycle.stats.advisory,0);assert.equal(cycle.actionOutcomes[0].classification,'Favorável');assert.equal(cycle.actionOutcomes[0].confirmedApplication,true);
 const saved=structuredClone(state);assert.equal(autonomousLearningPlan(state,null,now).ready.length,0);processAutonomousLearning(state,now);assert.deepEqual(state,saved);
});
test('Source closure, exposure, scope, currency and exact confirmation remain mandatory',()=>{
 for(const change of [s=>s.proposals[0].status='Aguardando aprovação',s=>{s.executions[0].status='Enviada';s.proposals[0].execution.status='Enviada';},s=>s.proposals[0].approvedSignature='other',s=>s.snapshots[1].rows[0].adAccountId='foreign',s=>s.snapshots[1].rows[0].frontOrders=null,s=>s.snapshots[1].rows[0].spend=0,s=>s.snapshots[1].to=stamp(now+1000),s=>s.snapshots[1].currency='USD',s=>s.snapshots[1].timezone='America/Boa_Vista']){
  const {state}=fixture();change(state);assert.equal(autonomousLearningPlan(state,null,now).ready.length,0);const saved=structuredClone(state);processAutonomousLearning(state,now);assert.deepEqual(state,saved);
 }
 const {state}=fixture();state.paused=true;assert.equal(autonomousLearningPlan(state,null,now).ready.length,0);assert.equal(processAutonomousLearning(state,now).recorded,0);
 assert.equal(autonomousLearningPlan(fixture().state,'q',now).ready.length,0);
});
test('Competing changes and incidents become limitations; unchanged inputs never retry or turn into success',()=>{
 for(const patch of [{incidents:[{project:'p',status:'Em retomada',createdAt:'2026-11-03T00:00:00Z'}]},{campaignChanges:[{project:'p',objectId:'campaign',adAccountId:'account',observedAt:'2026-11-04T05:00:00Z'}]}]){
  const {state}=fixture();Object.assign(state,patch);const controls=structuredClone(state.config);assert.equal(processAutonomousLearning(state,now).limited,1);assert.equal(state.knowledgeOutcomes?.length||0,0);assert.equal(autonomousLearningPlan(state,null,now).ready.length,0);assert.equal(state.learningAttempts[0].status,'Evidência insuficiente');assert.deepEqual(state.config,controls);
 }
});
test('Bad outcomes remain visible and are never auto-promoted to a validated pattern',()=>{
 const {state}=fixture();state.snapshots[1].rows[0].revenueNet=30;state.snapshots[1].rows[0].frontOrders=1;processAutonomousLearning(state,now);
 const cycle=learningCyclePlan(state,'p',now);assert.equal(cycle.actionOutcomes[0].classification,'Desfavorável');assert.equal(cycle.stats.verifiedOutcomes,1);assert.equal(cycle.stats.advisory,0);assert.equal(state.knowledge,undefined);
});
test('Retained daily measurements survive replacement of the current snapshots',()=>{
 const {state}=fixture();state.knowledgeMeasurements=state.snapshots.map((s,i)=>({id:'m'+i,project:'p',externalId:'campaign',adAccountId:'account',level:'campaign',source:'Malva MCP',complete:true,from:s.from,to:s.to,fetchedAt:s.fetchedAt,lastSyncAt:s.lastSyncAt,timezone:s.timezone,metrics:s.rows[0],reference:'measurement:m'+i}));state.snapshots=[];
 assert.equal(processAutonomousLearning(state,now).recorded,1);
});
test('The cloud worker measures eligible cases autonomously without model, source reads or provider dispatch',async()=>{
 const f=fixture();let state={...f.state,jobs:[],agents:{},messages:[],tasks:[],decisions:[],reports:[],events:[],paused:false,cadence:{enabled:false,intervalMinutes:15,start:'06:00',end:'20:00',weekdays:[0,1,2,3,4,5,6],timezone:'UTC'}};
 assert.equal(cloudNext(state,[],now).kind,'learning');let calls=0;
 const engine=createCloudEngine({read:async()=>({state}),write:async fn=>{const draft=structuredClone(state),result=await fn(draft,1);state=draft;return result;},source:{read:async()=>{calls++;throw Error('unexpected source read');},dispatch:async()=>{calls++;throw Error('unexpected dispatch');}},ai:{run:async()=>{calls++;throw Error('unexpected model call');}},ops:{},now:()=>now});
 const result=await engine.step();assert.equal(result.kind,'learning');assert.equal(result.recorded,1);assert.equal(calls,0);assert.equal(state.knowledgeOutcomes.length,1);assert.equal(cloudNext(state,[],now),null);
});


test('A repeated read with a newer fetch timestamp does not retry the same limited evidence',()=>{
 const {state}=fixture();state.incidents=[{project:'p',status:'Em retomada',createdAt:'2026-11-03T00:00:00Z'}];processAutonomousLearning(state,now);
 for(const s of state.snapshots)s.fetchedAt=stamp(now-500);
 assert.equal(autonomousLearningPlan(state,null,now).ready.length,0);
 state.snapshots[1].rows[0].frontOrders=4;assert.equal(autonomousLearningPlan(state,null,now).ready.length,1);
});
