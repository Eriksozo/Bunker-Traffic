import test from 'node:test';
import assert from 'node:assert/strict';
import {projectScope,consolidateCampaigns,scopeLiveStatus} from '../lib/project-scope.mjs';
import {budget} from '../lib/analysis.mjs';

const now=Date.parse('2026-11-04T14:00:00Z');
const row=(id,spend,net,extra={})=>({externalId:id,level:'campaign',adAccountId:'account',provider:'meta',spend,revenue:net,revenueNet:net,adCosts:0,productCost:0,saleTax:0,frontOrders:1,orders:1,checkouts:2,impressions:100,linkClicks:10,refundedRevenue:0,...extra});
const snapshot=(id,rows,extra={})=>({projectId:id,projectName:id,period:'today',level:'campaign',source:'Malva MCP',from:'2026-11-04T03:00:00Z',to:'2026-11-05T03:00:00Z',timezone:'America/Sao_Paulo',complete:true,fetchedAt:'2026-11-04T13:00:00Z',lastSyncAt:'2026-11-04T12:59:00Z',rows,...extra});
const base=snapshots=>({config:{p:{projectName:'Alpha'},q:{projectName:'Beta'}},snapshots});

test('all projects sums comparable windows and calculates weighted ratios',()=>{
 const state=base([snapshot('p',[row('a',100,300)]),snapshot('q',[row('b',900,900)])]),before=structuredClone(state);
 const scope=projectScope(state,'all','today',{now});
 assert.equal(scope.metrics.spend,1000);assert.equal(scope.metrics.roas,1.2);assert.equal(scope.metrics.cpaFront,500);
 assert.equal(scope.included,2);assert.equal(scope.complete,true);assert.equal(scope.rows[0].projectId,'p');assert.deepEqual(state,before);
});
test('missing or mismatched project windows are explicit partial coverage',()=>{
 const state=base([snapshot('p',[row('a',100,300)]),snapshot('q',[row('b',900,900)],{from:'2026-11-03T03:00:00Z',to:'2026-11-04T03:00:00Z',fetchedAt:'2026-11-03T15:00:00Z'})]);
 const scope=projectScope(state,'all','today',{now});
 assert.equal(scope.metrics.spend,100);assert.equal(scope.included,1);assert.equal(scope.complete,false);assert.equal(scope.stale,true);
 assert.equal(scope.snapshot.fetchedAt,null);assert.equal(scope.entries.find(e=>e.id==='q').included,false);
 assert.equal(projectScope(base([]),'all','today',{now}).metrics.spend,null);
});
test('uses latest analysis per project without duplicate snapshots',()=>{
 const scope=projectScope(base([snapshot('p',[row('a',10,10)]),snapshot('p',[row('a',20,40)],{fetchedAt:'2026-11-04T13:30:00Z'}),snapshot('q',[])]),'all','today',{now});
 assert.equal(scope.metrics.spend,20);assert.equal(scope.complete,true);
});
test('per-project live display falls back to analysis and historical periods stay frozen',()=>{
 const state=base([snapshot('p',[row('a',10,20)]),snapshot('q',[row('b',30,60)])]);
 const items=[{projectId:'p',snapshot:snapshot('p',[row('a',100,200)],{fetchedAt:'2026-11-04T13:59:00Z',lastSyncAt:'2026-11-04T13:58:00Z'}),lastSuccessAt:'2026-11-04T13:59:00Z'}];
 const scope=projectScope(state,'all','today',{now,live:true,items});assert.equal(scope.metrics.spend,130);assert.equal(scope.usesLive,true);assert.equal(scope.entries[1].live,false);
 assert.equal(projectScope(state,'all','today',{now,live:false,items}).metrics.spend,40);
 assert.equal(projectScope(state,'all','7d',{now,live:true,items}).usesLive,false);
});
test('media and budget from a shared campaign are counted once with sole checkout attribution',()=>{
 const shared=row('same',100,200,{projectId:'p',projectName:'Alpha',scopeFetchedAt:'2026-11-04T13:00:00Z'});
 const other=row('same',120,0,{projectId:'q',projectName:'Beta',frontOrders:0,orders:0,scopeFetchedAt:'2026-11-04T13:59:00Z'});
 const result=consolidateCampaigns([shared,other]);assert.equal(result.rows.length,1);assert.equal(result.rows[0].spend,120);assert.equal(result.rows[0].revenueNet,200);assert.equal(result.duplicates,1);assert.equal(result.ambiguous,0);assert.deepEqual(result.rows[0].scopeProjects,['Beta','Alpha']);
});
test('multiple financial attributions or missing values stay N/D instead of being guessed',()=>{
 const state=base([snapshot('p',[row('same',100,200)]),snapshot('q',[row('same',100,200)])]);
 const scope=projectScope(state,'all','today',{now});assert.equal(scope.metrics.spend,100);assert.equal(scope.metrics.revenueNet,null);assert.equal(scope.metrics.roas,null);assert.equal(scope.metrics.result,null);assert.equal(scope.ambiguous,1);
 const unknown=consolidateCampaigns([row('x',10,0),row('x',10,null)]);assert.equal(unknown.rows[0].revenueNet,null);
});
test('account, provider and exact campaign identities prevent unrelated merges',()=>{
 const result=consolidateCampaigns([row('same',10,0),row('other',20,0),row('same',30,0,{adAccountId:'other'}),row('same',40,0,{provider:'other'}),row('same',50,0,{provider:undefined})]);
 assert.equal(result.rows.length,5);assert.equal(result.duplicates,0);
});
test('consolidated clocks never hide a stale, missing, failed or paused project',()=>{
 const items=['p','q'].map(id=>({projectId:id,snapshot:snapshot(id,[],{fetchedAt:'2026-11-04T13:59:00Z',lastSyncAt:'2026-11-04T13:58:00Z'}),lastSuccessAt:'2026-11-04T13:59:00Z'}));
 assert.equal(scopeLiveStatus(['p','q'],{items},{now}).recent,true);
 assert.equal(scopeLiveStatus(['p','q'],{items:[items[0]]},{now}).recent,false);
 assert.equal(scopeLiveStatus(['p','q'],{items,paused:true},{now}).recent,false);
 assert.equal(scopeLiveStatus(['p','q'],{items},{now,error:'Unavailable'}).recent,false);
 items[1].snapshot.lastSyncAt='2026-11-04T12:00:00Z';assert.equal(scopeLiveStatus(['p','q'],{items},{now}).count,1);
});
test('an individual project preserves its exact identity and metrics',()=>{
 const state=base([snapshot('p',[row('same',10,30)]),snapshot('q',[row('same',100,300)])]);
 const scope=projectScope(state,'p','today',{now});assert.equal(scope.metrics.spend,10);assert.equal(scope.expected,1);assert.equal(scope.snapshot.projectId,'p');assert.equal(scope.duplicates,0);
});
test('equivalent date serializations remain comparable and old today data is excluded from live totals',()=>{
 const state=base([snapshot('p',[row('a',10,20)]),snapshot('q',[row('b',20,40)],{from:'2026-11-04T03:00:00.000Z',to:'2026-11-05T03:00:00.000Z'})]);
 assert.equal(projectScope(state,'all','today',{now}).included,2);
 const old=base([snapshot('p',[row('a',10,20)],{from:'2026-11-03T03:00:00Z',to:'2026-11-04T03:00:00Z'})]);
 assert.equal(projectScope(old,'all','today',{now,live:true}).metrics.spend,null);
});
test('a shared active campaign contributes its daily budget once',()=>{
 const campaign=row('shared',100,0,{frontOrders:0,orders:0,effectiveStatus:'ACTIVE',dailyBudget:500,budgetRate:1});
 const scope=projectScope(base([snapshot('p',[campaign]),snapshot('q',[campaign])]),'all','today',{now});
 assert.equal(budget(scope.rows).active,500);
});
