import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates} from '../lib/analysis.mjs';
import {campaignDetailView} from '../lib/campaign-detail-view.mjs';

const now=Date.parse('2026-11-05T10:00:00Z'),from='2026-11-05T03:00:00Z',to='2026-11-06T03:00:00Z';
const row={level:'campaign',provider:'meta',externalId:'campaign',adAccountId:'account',name:'[TESTE] JHON_A_312_H1',effectiveStatus:'ACTIVE',spend:0,revenue:0,revenueNet:0,frontOrders:0,orders:0,adCosts:0,productCost:0,saleTax:0,impressions:0,linkClicks:0,checkouts:0};
const source=(period,rows=[row],patch={})=>({projectId:'john',projectName:'John',level:'campaign',source:'Malva MCP',complete:true,period,from:period==='today'?from:'2026-10-29T03:00:00Z',to:period==='today'?to:from,timezone:'America/Sao_Paulo',fetchedAt:'2026-11-05T09:59:00Z',lastSyncAt:'2026-11-05T09:58:00Z',rows:structuredClone(rows),...patch});
const stateFor=()=>({config:{john:{projectName:'John'}},snapshots:[source('7d',[{...row,spend:7000,revenueNet:14000,frontOrders:36,orders:44}]),source('today')]});
const selected=state=>candidates(state,'john',now)[0];
const feed=(rows=[{...row,spend:150,frontOrders:1,orders:1}],patch={})=>({projectId:'john',snapshot:source('today',rows,{fetchedAt:'2026-11-05T09:59:30Z',...patch})});

test('a confirmed empty day is zero, while ratios stay unknown and history remains populated',()=>{
 const state=stateFor(),view=campaignDetailView(selected(state),state,[],'today',now);
 assert.equal(view.confirmedEmpty,true);assert.equal(view.unavailable,false);
 assert.equal(view.selectedMetrics.spend,0);assert.equal(view.selectedMetrics.frontOrders,0);
 assert.equal(view.selectedMetrics.roi,null);assert.equal(view.selectedMetrics.cpaFront,null);
 assert.equal(view.metrics['7d'].spend,7000);assert.equal(view.metrics['7d'].frontOrders,36);
});

test('an already open detail re-resolves a changed analysis instead of freezing its initial values',()=>{
 const state=stateFor(),selection=selected(state),before=structuredClone(selection);
 state.snapshots[1].rows[0]={...row,spend:200,frontOrders:2,effectiveStatus:'PAUSED'};
 const view=campaignDetailView(selection,state,[],'today',now);
 assert.equal(view.selectedMetrics.spend,200);assert.equal(view.row.effectiveStatus,'PAUSED');
 assert.equal(view.confirmedEmpty,false);assert.deepEqual(selection,before);
});

test('live values and status update presentation without rewriting the analysis',()=>{
 const state=stateFor(),selection=selected(state),before=structuredClone({state,selection});
 const view=campaignDetailView(selection,state,[feed([{...row,spend:150,frontOrders:1,orders:1,effectiveStatus:'PAUSED'}])],'today',now);
 assert.equal(view.live,true);assert.equal(view.selectedMetrics.spend,150);
 assert.equal(view.row.effectiveStatus,'PAUSED');assert.equal(view.analysis.windows.today.spend,0);
 assert.deepEqual({state,selection},before);
 assert.equal(campaignDetailView(selection,state,[feed()],'7d',now).selectedMetrics.spend,7000);
});

test('duplicate names in other projects or accounts cannot fill this detail',()=>{
 const state=stateFor(),selection=selected(state);
 const other=feed([{...row,adAccountId:'another',spend:999}]);
 const cross=feed();cross.projectId='nico';cross.snapshot.projectId='nico';
 const view=campaignDetailView(selection,state,[other,cross],'today',now);
 assert.equal(view.live,false);assert.equal(view.selectedMetrics.spend,0);assert.equal(view.row.adAccountId,'account');
 state.snapshots.push(source('today',[{...row,spend:999}],{projectId:'nico'}));
 assert.equal(campaignDetailView(selection,state,[],'today',now).selectedMetrics.spend,0);
});

test('an absent or previous-day today row never becomes a fabricated zero or yesterday value',()=>{
 const state=stateFor(),selection=selected(state);state.snapshots[1].rows=[];
 let view=campaignDetailView(selection,state,[],'today',now);
 assert.equal(view.unavailable,true);assert.equal(view.confirmedEmpty,false);assert.equal(view.selectedMetrics.spend,null);
 state.snapshots[1]=source('today',[{...row,spend:300}],{from:'2026-11-04T03:00:00Z',to:from});
 view=campaignDetailView(selection,state,[],'today',now);
 assert.equal(view.unavailable,true);assert.equal(view.selectedMetrics.spend,null);
 assert.equal(view.metrics['7d'].spend,7000);
});

test('an older feed or ambiguous duplicate cannot replace a newer exact analysis',()=>{
 const state=stateFor(),selection=selected(state);
 for(const item of [feed(undefined,{fetchedAt:'2026-11-05T09:58:30Z'}),feed([row,{...row,spend:999}]),feed(undefined,{complete:false})]){
  const view=campaignDetailView(selection,state,[item],'today',now);
  assert.equal(view.live,false);assert.equal(view.selectedMetrics.spend,0);
 }
});

test('the newest feed omitting the object cannot revive an older matching cache entry',()=>{
 const state=stateFor(),view=campaignDetailView(selected(state),state,[feed(),feed([],{fetchedAt:'2026-11-05T09:59:45Z'})],'today',now);
 assert.equal(view.live,false);assert.equal(view.selectedMetrics.spend,0);
});

test('feed failures preserve the timestamped observation with an explicit stale flag',()=>{
 const state=stateFor(),item=feed();item.error={message:'Malva indisponível'};
 const view=campaignDetailView(selected(state),state,[item],'today',now);
 assert.equal(view.selectedMetrics.spend,150);assert.equal(view.stale,true);
 assert.equal(view.source.fetchedAt,item.snapshot.fetchedAt);
});
