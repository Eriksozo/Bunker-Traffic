import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates,budget} from '../lib/analysis.mjs';
import {actionQueue} from '../lib/daily-brief.mjs';

const now=Date.parse('2026-11-08T15:00:00Z');
const m=(spend,revenueNet,front=1,extra={})=>({spend,revenueNet,revenue:revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:front*2+2,impressions:5000,linkClicks:100,refundedRevenue:0,...extra});
const row=(id,name,extra={})=>({externalId:id,adAccountId:'act',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},...extra});
/** windows: {campaignId:{name,extra,'7d':metrics,...}} — a period left out has no row for that campaign. */
function state(campaigns,config={testHours:24}){
 return {config:{p:{projectName:'Fictício',...config}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:'p',projectName:'Fictício',period,level:'campaign',fetchedAt:new Date(now-1000).toISOString(),lastSyncAt:new Date(now-2000).toISOString(),rows:Object.entries(campaigns).filter(([,c])=>c[period]).map(([id,c])=>({...row(id,c.name,c.extra),...c[period]}))}))};
}
const one=(c,config)=>candidates(state({c},config),'p',now)[0];

test('Teste protegido: an unknown start with closed-window spend no longer hides a losing test, and the queue shows it',()=>{
 const losing={name:'[TESTE] criativo 12','7d':m(2100,609,3),'3d':m(900,198,1),yesterday:m(300,0,0),today:m(150,0,0)};
 const c=one(losing);
 assert.notEqual(c.decision,'Teste protegido');assert.equal(c.tone,'red');assert.equal(c.testLaunch.priority,false);
 const q=actionQueue([c],{now});assert.equal(q.protectedTests,0);assert.equal(q.losses,1);assert.equal(q.items[0].candidate.row.externalId,'c');
 // A confirmed recent start keeps the configured protection.
 const young=one({...losing,extra:{deliveryStartedAt:new Date(now-2*3600000).toISOString()}});
 assert.equal(young.decision,'Teste protegido');assert.equal(actionQueue([young],{now}).protectedTests,1);
});
test('Old TESTE campaign from the queue finding reaches the action queue',()=>{
 const c=one({name:'[TESTE] criativo 12','7d':m(7000,2000,5),'3d':m(3000,800,2),yesterday:m(1000,200,0),today:m(400,97,1)});
 assert.notEqual(c.decision,'Teste protegido');
 const q=actionQueue([c],{now});assert.equal(q.protectedTests,0);assert.equal(q.considered,1);assert.equal(q.items.length,1);assert.equal(q.items[0].kind,'loss');
});
test('Teste protegido with unknown start: only today, or closed windows with measured zero spend, stay protected; N/D spend does not',()=>{
 const today=m(200,600,2);
 assert.equal(one({name:'[TESTE] novo',today}).decision,'Teste protegido');
 assert.equal(one({name:'[TESTE] novo','7d':m(0,0,0),'3d':m(0,0,0),yesterday:m(0,0,0),today}).decision,'Teste protegido');
 assert.notEqual(one({name:'[TESTE] novo','7d':m(null,0,0),today}).decision,'Teste protegido');
 assert.notEqual(one({name:'[TESTE] novo',yesterday:m(50,0,0),today}).decision,'Teste protegido');
});

test('Amostra recente: 7d equal to 3d is one sample, not consistency in 3 and 7 days',()=>{
 const second=one({name:'[ESCALA] duplicada','7d':m(600,1200,6),'3d':m(600,1200,6),yesterday:m(600,1200,6),today:m(40,80,1)});
 assert.equal(second.decision,'Amostra recente');assert.equal(second.tone,'amber');assert.doesNotMatch(second.reason,/dia atual/);
 // Distinct closed windows keep the scale signal.
 assert.equal(one({name:'[ESCALA] madura','7d':m(1400,2800,12),'3d':m(600,1200,6),yesterday:m(200,400,2),today:m(40,80,1)}).decision,'Candidato à escala');
 // N/D never matches N/D.
 assert.notEqual(one({name:'[ESCALA] sem gasto','7d':m(null,null,null),'3d':m(null,null,null),today:m(null,null,null)}).decision,'Amostra recente');
});
test('Amostra recente does not pre-empt a weak-acquisition loss review',()=>{
 const c=one({name:'[ESCALA] perde','7d':m(600,200,0),'3d':m(600,200,0),yesterday:m(200,60,0),today:m(100,30,0)});
 assert.equal(c.decision,'Avaliar pausa ou redução');assert.equal(c.tone,'red');
});

test('Consistently strong campaign below R$500 is not called a recovery',()=>{
 const c=one({name:'[ESCALA] pequena','7d':m(420,1260,8),'3d':m(180,540,4),today:m(20,60,1)});
 assert.equal(c.decision,'Retorno consistente com pouca exposição');assert.equal(c.tone,'green');assert.doesNotMatch(c.reason,/recupera/i);
 assert.equal(one({name:'[ESCALA] volta','7d':m(1400,1680,8),'3d':m(300,900,4),today:m(20,60,1)}).decision,'Sinal de recuperação');
 const unknownWeek=one({name:'[ESCALA] sem 7d','7d':m(1400,1680,8,{productCost:null}),'3d':m(300,900,4),today:m(20,60,1)});
 assert.equal(unknownWeek.week.roi,null);assert.equal(unknownWeek.decision,'Bom retorno recente');assert.match(unknownWeek.reason,/N\/D/);
});

test('Queue sort keeps a measured zero spend today at zero instead of falling back to 7d spend',()=>{
 const list=candidates(state({
  a:{name:'[ESCALA] parada hoje','7d':m(5000,2500,20),'3d':m(2000,1000,8),today:m(0,0,0)},
  b:{name:'[ESCALA] queimando','7d':m(900,300,0),'3d':m(600,200,0),yesterday:m(200,60,0),today:m(300,90,0)},
 }),'p',now);
 assert.deepEqual(list.map(c=>[c.row.externalId,c.tone]),[['b','red'],['a','red']]);
 assert.equal(list.find(c=>c.row.externalId==='a').decision,'Revisar perda');
 // N/D today falls back to the closed 3d daily average, comparable with a one-day spend.
 const nd=candidates(state({a:{name:'[ESCALA] x','7d':m(5000,2500,20),'3d':m(2000,1000,8),today:m(null,0,0)},b:{name:'[ESCALA] y','7d':m(5000,2500,20),'3d':m(2000,1000,8),today:m(700,350,1)}}),'p',now);
 assert.deepEqual(nd.map(c=>c.row.externalId),['b','a']);
});

test('budget() counts a BRL budget without a conversion rate; other currencies still need one',()=>{
 const brl=row('brl','[ESCALA]',{projectId:'p',spend:100,dailyBudget:500,budgetCurrency:'BRL',budgetRate:null});
 assert.deepEqual(budget([brl]),{active:500,scheduled:0,unknown:0});
 assert.deepEqual(budget([{...brl,budgetRate:undefined,budgetCurrency:'brl'}]),{active:500,scheduled:0,unknown:0});
 assert.deepEqual(budget([{...brl,budgetCurrency:'USD'}]),{active:0,scheduled:0,unknown:1});
 assert.deepEqual(budget([{...brl,budgetCurrency:'USD',budgetRate:5}]),{active:2500,scheduled:0,unknown:0});
 assert.deepEqual(budget([{...brl,dailyBudget:null}]),{active:0,scheduled:0,unknown:1});
});
