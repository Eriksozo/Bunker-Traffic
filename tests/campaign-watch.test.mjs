import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignWatchPlan} from '../lib/campaign-watch.mjs';
import {agentView} from '../lib/mcp-run.ts';
const now=Date.parse('2026-11-03T13:00:00Z'),stamp=d=>new Date(now+d).toISOString();
const row=(id='c',account='a')=>({externalId:id,adAccountId:account,accountName:account,name:'[ESCALA] '+id,provider:'meta',level:'campaign',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'BRL',dailyBudget:500,spend:100,revenueNet:300,adCosts:0,productCost:0,saleTax:0,frontOrders:3,orders:3});
function setup(){
 const r=row(),from='2026-11-03T00:00:00.000Z',to='2026-11-04T00:00:00.000Z';
 const snapshot={projectId:'p',projectName:'John',period:'today',level:'campaign',source:'Malva MCP',from,to,timezone:'UTC',fetchedAt:stamp(-1000),lastSyncAt:stamp(-2000),complete:true,coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:1},rows:[{...r,frontOrders:4}]};
 const state={config:{p:{projectName:'John',targetRoas:2}},snapshots:['7d','3d','yesterday','today'].map(period=>({...snapshot,period,from:period==='today'?from:'2026-10-27T00:00:00.000Z',to:period==='today'?to:from,fetchedAt:stamp(-120000),rows:[{...r}]})),paused:false,jobs:[],reports:[],events:[],messages:[],cadence:{enabled:false}};
 return {state,feed:{items:[{projectId:'p',snapshot,error:null}]},snapshot};
}
const kinds=p=>p.signals.map(s=>s.kind);
test('New front plus profitable closed windows yields investigation only, no mutations or commands',()=>{
 const {state,feed}=setup(),before=JSON.stringify({state,feed});const plan=campaignWatchPlan(state,feed,now);
 assert.deepEqual(kinds(plan),['opportunity']);assert.equal(plan.signals[0].canExecute,false);assert.equal(plan.signals[0].requiresFourPeriods,true);assert.equal(JSON.stringify({state,feed}),before);assert.equal(plan.projects[0].scopeComplete,true);
});
test('A changed native budget supersedes performance and preserves exact identity',()=>{
 const {state,feed,snapshot}=setup();snapshot.rows[0].dailyBudget=700;
 const plan=campaignWatchPlan(state,feed,now);assert.deepEqual(kinds(plan),['edited']);assert.equal(plan.signals[0].changes[0].after,700);assert.equal(plan.signals[0].adAccountId,'a');
});
test('Warm-up is counted but never optimized; new campaigns need analysis',()=>{
 const {state,feed,snapshot}=setup();snapshot.rows.push({...row('warm'),name:'[ENGAJAMENTO]'},row('new'));
 const p=campaignWatchPlan(state,feed,now);assert.equal(p.projects[0].warmup,1);assert.equal(p.projects[0].withoutAnalysis,1);assert.equal(p.projects[0].observed,2);assert.equal(p.signals.some(s=>s.objectId==='warm'),false);assert.ok(kinds(p).includes('new'));
});
test('Same name/id in another account cannot consume the original baseline; absence is not a pause',()=>{
 const {state,feed,snapshot}=setup();snapshot.rows=[row('c','other')];const p=campaignWatchPlan(state,feed,now);
 assert.equal(p.projects[0].missing,1);assert.equal(p.projects[0].withoutAnalysis,1);assert.equal(p.projects[0].scopeComplete,false);assert.ok(kinds(p).includes('coverage'));assert.ok(kinds(p).includes('new'));assert.equal(p.signals.some(s=>s.kind==='edited'),false);
});
test('Unknown or old upstream sync withholds performance signals even after a fresh collection',()=>{
 for(const sync of [null,stamp(-901000)]){const {state,feed,snapshot}=setup();snapshot.lastSyncAt=sync;assert.deepEqual(kinds(campaignWatchPlan(state,feed,now)),['source-clock']);}
});
test('Failure, old cache and day rollover cannot produce performance signals',()=>{
 for(const type of ['error','old','day']){const {state,feed,snapshot}=setup();if(type==='error')feed.items[0].error={message:'Fonte indisponível'};if(type==='old')snapshot.fetchedAt=stamp(-301000);if(type==='day')snapshot.to='2026-11-03T00:00:00Z';assert.deepEqual(kinds(campaignWatchPlan(state,feed,now)),['source']);}
});
test('No stale analysis is renewed by recent today cache',()=>{
 const {state,feed}=setup();state.snapshots.forEach(s=>s.fetchedAt=stamp(-3600001));assert.deepEqual(kinds(campaignWatchPlan(state,feed,now)),['reread']);
});
test('Partial-day loss in a young test is investigation with a protection, not a pause',()=>{
 const {state,feed,snapshot}=setup();state.snapshots.forEach(s=>s.rows[0].name='[TESTE] c');Object.assign(snapshot.rows[0],{name:'[TESTE] c',startAt:stamp(-3600000),spend:500,revenueNet:100});const p=campaignWatchPlan(state,feed,now);assert.deepEqual(kinds(p),['loss']);assert.equal(p.signals[0].guards.testProtected,true);assert.match(p.signals[0].reason,/sem corte precoce/);assert.equal(p.signals[0].canExecute,false);
});
test('Upsells, incident and paused campaigns cannot alone create scale opportunities',()=>{
 for(const variant of ['upsell','incident','paused']){const {state,feed,snapshot}=setup();if(variant==='upsell')Object.assign(snapshot.rows[0],{frontOrders:3,orders:99,revenueNet:10000});if(variant==='incident')state.incidents=[{project:'p',status:'Em retomada',scope:{}}];if(variant==='paused')Object.assign(snapshot.rows[0],{status:'PAUSED',effectiveStatus:'PAUSED'});assert.equal(kinds(campaignWatchPlan(state,feed,now)).includes('opportunity'),false);}
});
test('Analysis newer than the cache cannot be invalidated by old native observations',()=>{
 const {state,feed,snapshot}=setup();snapshot.fetchedAt=stamp(-180000);snapshot.rows[0].dailyBudget=600;assert.equal(kinds(campaignWatchPlan(state,feed,now)).includes('edited'),false);
});
test('Pagination preserves totals and all identities without appending duplicate journals',()=>{
 const {state,feed,snapshot}=setup();snapshot.rows=Array.from({length:120},(_,i)=>row('new'+i));const before=JSON.stringify(state),p=campaignWatchPlan(state,feed,now,{projectId:'p',limit:25});assert.equal(p.signals.length,25);assert.equal(p.nextOffset,25);assert.equal(p.signalCount,121);const next=campaignWatchPlan(state,feed,now,{projectId:'p',offset:25,limit:25});assert.equal(new Set([...p.signals,...next.signals].map(s=>s.id)).size,50);assert.equal(JSON.stringify(state),before);assert.throws(()=>campaignWatchPlan(state,feed,now,{offset:-1}));assert.throws(()=>campaignWatchPlan(state,feed,now,{projectId:'foreign'}));
});
test('Paused Bunker exposes observations without creating eligible collections',()=>{
 const {state,feed}=setup();state.paused=true;feed.due=[{project:'p'}];const p=campaignWatchPlan(state,feed,now);assert.equal(p.projects[0].eligible,false);assert.equal(p.paused,true);const view=agentView({state,revision:1},feed);assert.equal(view.plan.autonomous.ready.some(w=>w.kind==='collection'),false);assert.equal(view.plan.batchStartRequest,undefined);
});
test('Duplicate current identities do not manufacture a unique campaign signal',()=>{
 const {state,feed,snapshot}=setup();snapshot.rows.push({...snapshot.rows[0]});const p=campaignWatchPlan(state,feed,now);assert.deepEqual(kinds(p),['ambiguous']);assert.equal(p.projects[0].scopeComplete,false);
});
