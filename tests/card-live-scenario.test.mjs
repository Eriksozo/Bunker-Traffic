import test from 'node:test';
import assert from 'node:assert/strict';
import {cardLiveScenario} from '../lib/card-live-scenario.mjs';
import {decorateCampaignCard} from '../lib/campaign-live-context.mjs';
import {sum} from '../lib/analysis.mjs';
const now=Date.parse('2026-11-04T12:00:00Z'),from='2026-11-04T03:00:00Z',to='2026-11-05T03:00:00Z',timezone='America/Sao_Paulo';
const row={id:'internal-1',externalId:'object-1',adAccountId:'account-1',level:'campaign',provider:'Meta',name:'[ESCALA] QA',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'BRL',dailyBudget:1000,spend:300,revenueNet:100,adCosts:0,productCost:0,saleTax:0,frontOrders:1,orders:1,checkouts:5};
const card=()=>({project:'john',row:structuredClone(row),sourceAt:'2026-11-04T11:30:00Z',signature:'frozen-seal',windows:{today:{...sum([row]),from,to,timezone}},actionable:{increase:true,reduce:true,pause:true,keep:true},suggestion:{origin:'team',action:'keep'},proposal:null});
const item=(patch={},extra={})=>({projectId:'john',error:null,snapshot:{projectId:'john',period:'today',level:'campaign',source:'Malva MCP',complete:true,from,to,timezone,fetchedAt:'2026-11-04T11:59:30Z',lastSyncAt:'2026-11-04T11:59:00Z',rows:[{...row,...patch}],...extra}});
test('The same card moves from loss to profit with new front and native values without overwriting its analysis',()=>{
 const original=card(),before=structuredClone(original);
 const loss=decorateCampaignCard(original,[item()],now);assert.equal(cardLiveScenario(loss).kind,'attention');
 const profit=decorateCampaignCard(original,[item({spend:350,revenueNet:900,frontOrders:4,dailyBudget:1500})],now);
 assert.equal(cardLiveScenario(profit).kind,'positive');assert.equal(profit.liveToday.frontOrders,4);assert.equal(profit.liveToday.spend,350);assert.equal(profit.observedRow.dailyBudget,1500);
 assert.equal(profit.actionable.increase,false);assert.equal(profit.proposal,null);assert.deepEqual(original,before);assert.equal(profit.signature,original.signature);
});
test('Worsening losses invalidate keep even without crossing equilibrium or adding front',()=>{
 const original=card(),worse=decorateCampaignCard(original,[item({spend:500})],now);
 assert.ok(worse.liveDrift.materialChanges.some(c=>c.field==='lossDeterioration'));assert.equal(worse.teamReady,false);assert.equal(worse.actionable.keep,false);assert.match(worse.blockedReasons.at(-1),/prejuízo/);
});
test('Origin age, cache failure and absent data never produce a positive current scenario',()=>{
 const original=card();
 const delayed=decorateCampaignCard(original,[item({revenueNet:900},{lastSyncAt:'2026-11-04T10:00:00Z'})],now);assert.equal(cardLiveScenario(delayed).kind,'stale');
 for(const card of [{},{liveToday:{spend:null,frontOrders:3,roi:3}},{liveToday:{spend:100,frontOrders:null,roi:3}},{liveToday:{spend:100,frontOrders:2,roi:3},liveStale:true}])assert.notEqual(cardLiveScenario(card).kind,'positive');
});
test('Zero front, paid acquisition, upsells, equality and missing return remain distinct observations',()=>{
 const classify=metrics=>cardLiveScenario({liveToday:metrics});
 assert.equal(classify({spend:100,frontOrders:0,orders:4,roi:3}).kind,'attention');assert.equal(classify({spend:0,frontOrders:0}).kind,'idle');
 assert.equal(classify({spend:100,frontOrders:2,roi:null}).kind,'unknown');assert.equal(classify({spend:100,frontOrders:2,roi:1}).kind,'idle');
});
test('500 successive readings update metrics without manufacturing an executable action or rewriting history',()=>{
 const original=card(),saved=structuredClone(original);
 for(let i=1;i<=500;i++){
  const observed=decorateCampaignCard(original,[item({spend:300+i,revenueNet:i*3,frontOrders:Math.floor(i/10)})],now),scenario=cardLiveScenario(observed);
  assert.equal(scenario.metrics.spend,300+i);assert.equal(scenario.metrics.frontOrders,Math.floor(i/10));assert.equal(observed.signature,original.signature);
  assert.equal(Object.hasOwn(scenario,'action'),false);assert.equal(Object.hasOwn(scenario,'percent'),false);assert.equal(observed.proposal,null);
 }
 assert.deepEqual(original,saved);
});
