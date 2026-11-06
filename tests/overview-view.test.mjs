import test from 'node:test';
import assert from 'node:assert/strict';
import {accountOverview,overviewSignals,overviewAnalysisState} from '../lib/overview-view.mjs';
import {candidates} from '../lib/analysis.mjs';
const row=(account,spend,extra={})=>({projectId:'p',provider:'meta',adAccountId:account,accountName:account,spend,...extra});
test('followed accounts with zero or unknown spend are not presented as accounts with spend',()=>{
 const result=accountOverview([row('spent',30),row('spent',20),row('zero',0),row('unknown',null),row('mixed',10),row('mixed',null)]);
 assert.equal(result.all.length,4);assert.equal(result.withSpend.length,2);assert.equal(result.withoutSpend,1);assert.equal(result.unknown.length,1);
 assert.equal(result.withSpend.find(account=>account.id==='spent').metrics.spend,50);assert.equal(result.withSpend.find(account=>account.id==='mixed').metrics.spend,null);
});
test('same account identifiers in different projects or providers remain separate',()=>{
 const result=accountOverview([row('same',10),row('same',20,{projectId:'q'}),row('same',30,{provider:'google'})]);
 assert.equal(result.withSpend.length,3);assert.deepEqual(result.withSpend.map(account=>account.metrics.spend),[30,20,10]);
});
test('stale-only triage remains visible instead of showing three empty counters',()=>{
 const groups=overviewSignals([{tone:'gray'},{tone:'gray'},{tone:'red'}]);assert.equal(groups.find(group=>group.tone==='gray').n,2);assert.equal(groups.reduce((total,group)=>total+group.n,0),3);
});
test('a future source clock cannot classify a campaign as a scale opportunity',()=>{
 const now=Date.parse('2026-11-03T14:00:00Z'),state={config:{},snapshots:['7d','3d','today'].map((period,index)=>({projectId:'p',period,level:'campaign',lastSyncAt:'2026-11-03T16:00:00Z',rows:[{...row('a',1000-index*100),externalId:'1',level:'campaign',name:'[ESCALA]',effectiveStatus:'ACTIVE',revenueNet:10000,productCost:0,saleTax:0,adCosts:0,frontOrders:10}]}))};
 const before=structuredClone(state);assert.equal(candidates(state,'p',now)[0].tone,'gray');assert.deepEqual(state,before);
});

const at=Date.parse('2026-11-06T16:00:00Z');
function readyState(){return {config:{p:{projectName:'QA'}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:'p',period,level:'campaign',complete:true,timezone:'America/Sao_Paulo',from:period==='today'?'2026-11-06T03:00:00Z':'2026-11-05T03:00:00Z',to:period==='today'?'2026-11-07T03:00:00Z':'2026-11-06T03:00:00Z',fetchedAt:'2026-11-06T15:59:00Z',lastSyncAt:'2026-11-06T15:55:00Z'}))};}
test('Absent or stale classifications are unknown, not zero opportunities; known current signals remain visible',()=>{
 const state=readyState();state.snapshots[0].fetchedAt='2026-11-06T09:00:00Z';
 const view=overviewAnalysisState(state,'p',[{tone:'gray'},{tone:'green'}],at);
 assert.equal(view.incomplete,true);assert.equal(view.groups.find(g=>g.tone==='red').value,null);assert.equal(view.groups.find(g=>g.tone==='green').value,1);assert.equal(view.groups.find(g=>g.tone==='gray').value,1);
 assert.equal(overviewAnalysisState(readyState(),'p',[],at).groups[0].value,0);
});
test('Storage failures are project scoped and disappear after a successful current complete analysis',()=>{
 const state=readyState();state.snapshots.forEach(s=>s.fetchedAt='2026-11-06T09:00:00Z');state.agents={p:{status:'Falhou',jobId:'failed'}};state.jobs=[{id:'failed',project:'p',status:'Falhou',updatedAt:'2026-11-06T15:50:00Z',note:'STORAGE_LIMIT · etapa persist'}];
 assert.equal(overviewAnalysisState(state,'p',[],at).storageFailure,true);assert.equal(overviewAnalysisState(state,'other',[],at).storageFailure,false);
 state.snapshots=readyState().snapshots;assert.equal(overviewAnalysisState(state,'p',[],at).storageFailure,false);
});
test('All-project coverage remains partial if one project lacks a period, has another day or a future source clock',()=>{
 for(const variant of ['missing','day','future']){const state=readyState();state.config.q={projectName:'Other'};state.snapshots.push(...readyState().snapshots.map(s=>({...s,projectId:'q'})));const today=state.snapshots.find(s=>s.projectId==='q'&&s.period==='today');if(variant==='missing')state.snapshots=state.snapshots.filter(s=>!(s.projectId==='q'&&s.period==='3d'));if(variant==='day')today.to='2026-11-06T03:00:00Z';if(variant==='future')today.lastSyncAt='2026-11-07T15:55:00Z';const before=structuredClone(state),view=overviewAnalysisState(state,'all',[],at);assert.equal(view.ready,1);assert.equal(view.total,2);assert.equal(view.incomplete,true);assert.deepEqual(state,before);}
});
