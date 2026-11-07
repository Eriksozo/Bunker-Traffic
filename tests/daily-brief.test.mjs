import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyComparison,actionQueue,sortCampaigns,matchesStatus,campaignColumns,rememberedChoice} from '../lib/daily-brief.mjs';
import {sum} from '../lib/analysis.mjs';

const metrics=(spend,revenueNet,front=1)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:front*2,impressions:1000,linkClicks:20,refundedRevenue:0});
const snap=(projectId,period,rows)=>({projectId,projectName:'Fictício '+projectId,period,level:'campaign',from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',fetchedAt:'2026-11-02T00:10:00Z',lastSyncAt:'2026-11-02T00:05:00Z',complete:true,rows});
const row=(id,m,status='ACTIVE')=>({externalId:id,adAccountId:'act',accountName:'Conta',name:'Campanha '+id,level:'campaign',effectiveStatus:status,accountStatus:{active:true},...m});

test('daily comparison uses ratios only and leaves missing windows as null',()=>{
 const state={config:{p:{projectName:'P'}},snapshots:[snap('p','today',[row('a',metrics(100,250))]),snap('p','yesterday',[row('a',metrics(200,200))]),snap('p','7d',[row('a',metrics(1400,2100))])]};
 const c=dailyComparison(state,'p');
 assert.equal(c.today.roas,2.5);assert.equal(c.yesterday.roas,1);assert.equal(c.week.roas,1.5);
 assert.equal(c.deltas.roas.yesterday,1.5);assert.ok(Math.abs(c.deltas.roas.week-2/3)<1e-9);
 const missing=dailyComparison({config:{p:{}},snapshots:[snap('p','today',[row('a',metrics(100,250))])]},'p');
 assert.equal(missing.yesterday,null);assert.equal(missing.deltas.roas.yesterday,null);
});

const candidate=(id,{today,recent,week,yesterday,tone='amber',decision='Acompanhar',status='ACTIVE'})=>({id,row:row(id,{deliveryStartedAt:'2026-10-01T00:00:00Z'},status),windows:{...(today?{today:row(id,today,status)}:{}),...(yesterday?{yesterday:row(id,yesterday,status)}:{})},recent:recent?sum([recent]):null,week:week?sum([week]):null,tone,decision});

test('action queue ranks money lost today, keeps opportunities, and leaves paused or protected tests out',()=>{
 const list=[
  candidate('small-loss',{today:metrics(100,80)}),
  candidate('big-loss',{today:metrics(1200,780),week:metrics(9000,12000)}),
  candidate('paused-loss',{today:metrics(3000,0)},),
  candidate('protected',{today:metrics(2000,100),decision:'Teste protegido'}),
  candidate('old-loss',{recent:metrics(900,300)}),
  candidate('winner',{today:metrics(500,1500),recent:metrics(1500,4500),tone:'green',decision:'Candidato à escala'}),
  candidate('green-no-profit',{recent:metrics(100,80),tone:'green'}),
 ];
 list[2].row.effectiveStatus='PAUSED';
 const q=actionQueue(list,{limit:4});
 assert.deepEqual(q.items.map(i=>i.candidate.id),['big-loss','old-loss','small-loss','winner']);
 const big=q.items[0];assert.equal(big.kind,'loss');assert.equal(big.period,'today');assert.equal(big.amount,420);assert.equal(big.basis,'result');
 assert.equal(q.items[1].period,'3d');assert.equal(q.items.at(-1).kind,'opportunity');assert.equal(q.items.at(-1).amount,3000);
 assert.ok(!q.items.some(i=>['paused-loss','protected','green-no-profit'].includes(i.candidate.id)));
});

test('tests with under 24h of delivery are preserved and counted, also when the start is unknown and only today exists',()=>{
 const now=Date.parse('2026-11-07T12:00:00Z');
 const young=candidate('young',{today:metrics(500,50)});young.row.deliveryStartedAt='2026-11-07T01:00:00Z';
 const old=candidate('old',{today:metrics(500,50),week:metrics(3000,2000)});old.row.deliveryStartedAt='2026-10-01T00:00:00Z';
 const unknown=candidate('unknown',{today:metrics(400,40)});delete unknown.row.deliveryStartedAt;
 const q=actionQueue([young,old,unknown],{now});
 assert.deepEqual(q.items.map(i=>i.candidate.id),['old']);assert.equal(q.protectedTests,2);assert.equal(q.considered,1);
});
test('missing cost components fall back to revenue minus media, never to an invented profit',()=>{
 const m={...metrics(100,60)};m.productCost=null;
 const q=actionQueue([candidate('x',{today:m})]);assert.equal(q.items[0].basis,'revenue');assert.equal(q.items[0].amount,40);
 assert.equal(actionQueue([candidate('y',{today:{...metrics(0,0)}})]).items.length,0);
});

test('table columns, sorting keeps missing values last, and status filter',()=>{
 const list=[candidate('a',{today:metrics(100,300),week:metrics(700,700)}),candidate('b',{week:metrics(1400,2800)}),candidate('c',{today:metrics(300,300),yesterday:metrics(200,100),week:metrics(100,50)})];
 assert.deepEqual(campaignColumns(list[2]).yesterdayRoas,0.5);
 assert.deepEqual(sortCampaigns(list,'todaySpend','desc').map(c=>c.id),['c','a','b']);
 assert.deepEqual(sortCampaigns(list,'todaySpend','asc').map(c=>c.id),['a','c','b']);
 assert.deepEqual(sortCampaigns(list,'weekRoas','desc').map(c=>c.id),['b','a','c']);
 assert.deepEqual(sortCampaigns(list,'name','asc').map(c=>c.id),['a','b','c']);
 assert.equal(sortCampaigns(list,'',''),list);
 assert.equal(matchesStatus('ACTIVE','active'),true);assert.equal(matchesStatus('PAUSED','active'),false);assert.equal(matchesStatus('PAUSED','paused'),true);assert.equal(matchesStatus(undefined,'all'),true);
 assert.equal(rememberedChoice('3d',['7d','3d'],'today'),'3d');assert.equal(rememberedChoice('x',['7d'],'today'),'today');assert.equal(rememberedChoice(null,['7d'],'today'),'today');
});
