import test from 'node:test';
import assert from 'node:assert/strict';
import {accountOverview,overviewSignals} from '../lib/overview-view.mjs';
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
