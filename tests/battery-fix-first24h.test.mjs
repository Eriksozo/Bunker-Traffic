import test from 'node:test';
import assert from 'node:assert/strict';
import {first24hGuard,first24hReason,nameDateOffset,newCampaignStage} from '../lib/first-24h.mjs';
import {evaluateShadow} from '../lib/autonomy-shadow.mjs';

// Synthetic fixtures only: invented names, ids and amounts.
const H=3600000,now=Date.parse('2026-11-09T17:00:00Z');// 14:00 local, 09/11
const iso=t=>new Date(t).toISOString();
const r=(name,extra={})=>({externalId:'900001',adAccountId:'acc-x',name,level:'campaign',provider:'meta',status:'ACTIVE',spend:0,impressions:0,...extra});

test('#2/#42 a known positive front, order or revenue is a sale even with another field N/D', () => {
 for(const totals of [{spend:400,checkouts:3,frontOrders:2,orders:null,revenueNet:900},{spend:80,checkouts:1,frontOrders:1,orders:null,revenueNet:null},{spend:80,checkouts:0,frontOrders:null,orders:1,revenueNet:null},{spend:80,checkouts:0,frontOrders:null,orders:null,revenueNet:50}]){
  const g=first24hGuard(totals);assert.equal(g.level,'sold',JSON.stringify(totals));assert.equal(g.basis,'sale');
 }
 // No positive field and one N/D: stays N/D (watch, salesKnown false), never "0 venda".
 const nd=first24hGuard({spend:90,checkouts:0,frontOrders:0,orders:null,revenueNet:0});
 assert.equal(nd.level,'watch');assert.equal(nd.salesKnown,false);assert.match(first24hReason({stage:'first-day'},nd),/venda N\/D/);
 // All known and zero: the ceiling applies as before.
 assert.equal(first24hGuard({spend:99,checkouts:0,frontOrders:0,orders:0,revenueNet:0}).level,'pause');
});

test('#15 a name date beyond the schedule horizon reads as the past, not months ahead', () => {
 assert.equal(nameDateOffset('01/05 - [CBO] - [PRE] fixture',now),-192);
 assert.equal(nameDateOffset('23/11 - x',now),14,'horizon edge stays ahead');
 assert.equal(nameDateOffset('24/11 - x',now),15,'beyond the schedule horizon still reads ahead (not scheduled)');
 assert.equal(newCampaignStage(r('24/11 - [CBO] fixture'),{},{now}),null);
 assert.equal(nameDateOffset('08/01 - x',now),60,'name-ahead edge');
 assert.equal(nameDateOffset('09/01 - x',now),-304,'past the name-ahead window is last year');
 assert.equal(nameDateOffset('13/03 - x',Date.parse('2026-11-18T15:00:00Z')),-250);
 assert.equal(nameDateOffset('02/01 - x',Date.parse('2026-12-28T15:00:00Z')),5,'year turn still forward');
 assert.equal(nameDateOffset('28/12 - x',Date.parse('2027-01-02T15:00:00Z')),-5);
 assert.equal(newCampaignStage(r('01/05 - [CBO] - [PRE] fixture'),{},{now}),null);
});

test('#16 todayOnly header follows the stage: first day across midnight is "primeiras 24h"', () => {
 const stage=newCampaignStage(r('[CBO] - [PRE] fixture',{startAt:iso(now-18*H),spend:100,impressions:900}),{},{now});
 assert.equal(stage.stage,'first-day');assert.equal(stage.spansYesterday,true);
 const guard={...first24hGuard({spend:100,checkouts:0,frontOrders:0,orders:0,revenueNet:0}),todayOnly:true};
 const first=first24hReason(stage,guard);
 assert.match(first,/^Campanha nova nas primeiras 24h: vendeu ontem, hoje sem venda \(gasto de hoje\)/);assert.doesNotMatch(first,/2º dia/);
 assert.match(first24hReason({stage:'second-day'},guard),/^Campanha nova no 2º dia: vendeu ontem, hoje sem venda/);
});

test('#17 spend N/D is written "gasto N/D", never "R$null"', () => {
 const sold=first24hGuard({spend:null,checkouts:1,frontOrders:1,orders:1,revenueNet:297});
 const txt=first24hReason({stage:'first-day'},sold);
 assert.equal(txt,'Campanha nova nas primeiras 24h: gasto N/D com venda. Seguir o acompanhamento normal.');
 assert.doesNotMatch(first24hReason({stage:'first-day'},first24hGuard({spend:null,checkouts:null})),/null|sem gasto ainda/);
 assert.equal(first24hReason({stage:'first-day'},first24hGuard({spend:0,checkouts:0,frontOrders:0,orders:0,revenueNet:0})),'Campanha nova nas primeiras 24h: sem gasto ainda.');
});

test('#18 a past Meta start wins over a name dated ahead: not "Programada"', () => {
 assert.equal(newCampaignStage(r('10/11 - [CBO] renamed fixture',{startAt:iso(now-5*24*H),createdAt:iso(now-6*24*H)}),{},{now}),null);
 // Without a Meta start the name still schedules; a future Meta start still schedules by the schedule.
 assert.equal(newCampaignStage(r('10/11 - [CBO] fixture'),{},{now})?.basis,'name');
 assert.equal(newCampaignStage(r('10/11 - [CBO] fixture',{startAt:iso(now+20*H)}),{},{now})?.basis,'schedule');
});

test('#19 the 0-IC stricter limit is described as "com 0 IC"', () => {
 const g0=first24hGuard({spend:90,checkouts:0,frontOrders:0,orders:0,revenueNet:0},{pauseTestMinSpendNoCheckout:80});
 assert.equal(g0.limit,80);assert.equal(g0.noCheckoutLimit,true);
 assert.match(first24hReason({stage:'first-day'},g0),/Teto R\$80 com 0 IC; pausa a partir de R\$72\./);
 const g1=first24hGuard({spend:90,checkouts:1,frontOrders:0,orders:0,revenueNet:0},{pauseTestMinSpendNoCheckout:80});
 assert.equal(g1.limit,110);assert.equal('noCheckoutLimit' in g1,false);assert.match(first24hReason({stage:'first-day'},g1),/Teto R\$110 com até 1 IC/);
 const low=first24hGuard({spend:50,checkouts:0,frontOrders:0,orders:0,revenueNet:0},{first24hLowIcLimit:60});
 assert.match(first24hReason({stage:'first-day'},low),/Teto R\$60 com até 1 IC/,'a project ceiling for 0–1 IC keeps "até 1 IC"');
});

test('#15 review: a name dated 15–60 days ahead stays out of the no-delivery shadow rule; an old one is evaluated', () => {
 const start=Date.parse('2026-11-09T03:00:00.000Z'),D=86400000,snap=(period,from,to,rows,at)=>({projectId:'p',projectName:'Fixture',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true,period,from:iso(from),to:iso(to),fetchedAt:iso(at),lastSyncAt:iso(at),rows});
 const row=name=>({id:'uuid-900002',externalId:'900002',adAccountId:'acc-x',accountName:'Conta Fixture',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,spend:0,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:0,impressions:0,linkClicks:0});
 const state=name=>({config:{p:{projectName:'Fixture'}},snapshots:[snap('today',start,start+D,[row(name)],now-300000),snap('7d',start-7*D,start,[],start+60000),snap('3d',start-3*D,start,[],start+60000),snap('yesterday',start-D,start,[],start+60000)]});
 const noDelivery=name=>evaluateShadow(state(name),{project:'p',now,params:{enabled:true}}).decisions.filter(d=>d.rule==='no-delivery').length;
 assert.equal(noDelivery('01/08 - [CBO] - [PRE] fixture'),1,'control: 100 days ago');
 assert.equal(noDelivery('01/05 - [CBO] - [PRE] fixture'),1,'192 days ago is old, not ahead');
 assert.equal(noDelivery('29/11 - [CBO] - [PRE] fixture'),0,'20 days ahead');
 assert.equal(noDelivery('24/12 - [CBO] - [PRE] fixture'),0,'45 days ahead');
});
