import test from 'node:test';
import assert from 'node:assert/strict';
import {dayRow,windowRow,evaluateDay,outcomeAfter,score,backtest} from '../scripts/suggestion-backtest.mjs';

// Synthetic daily series only.
const day=(date,spend,revenueNet,orders=1)=>({date,spend,revenueNet,orders,adCosts:spend*0.04,productCost:0,saleTax:0,impressions:1000,linkClicks:50});
const dates=Array.from({length:12},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`);
const meta={objectId:'c',externalId:'e',adAccountId:'a',projectId:'p',name:'01/11 - [CBO] - Escala A',dailyBudget:1000,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null};

test('Windows use only days before D; today is D; missing fields stay N/D', () => {
 const days=dates.map((d,i)=>dayRow(day(d,100*(i+1),150*(i+1))));
 const w=windowRow(days.slice(0,7));assert.equal(w.spend,2800);
 assert.equal(dayRow({date:'2026-11-01',spend:10}).frontOrders,null,'front orders absent stay null');
 assert.equal(dayRow({date:'2026-11-01',orders:3},{proxyFront:true}).frontOrders,3,'proxy only on request');
 assert.equal(windowRow([dayRow({date:'x',spend:1}),dayRow({date:'y'})]).spend,null,'a day without the field makes the window N/D');
 const e=evaluateDay(meta,days,8,{now:Date.parse('2026-11-09T23:59:00-03:00')});
 assert.equal(e.windows['7d'].spend,days.slice(1,8).reduce((s,d)=>s+d.spend,0),'7d ends the day before D');
 assert.equal(e.windows.today.spend,days[8].spend);
});

test('Engines run on each day: bad day on a good history, queue loss with recovery, labels', () => {
 const days=dates.map(d=>dayRow(day(d,1000,2000,6)));days[8]=dayRow(day(dates[8],1000,200,1));
 const e=evaluateDay(meta,days,8,{now:Date.parse('2026-11-09T23:59:00-03:00')});
 assert.equal(e.badDay,true,'3d ROI ~1.9, today ROI ~0.2, spend above 30% of the budget');
 assert.equal(e.queueLoss,true);assert.equal(e.recovers,true,'7d profit covers today');
 assert.equal(e.context,'mixed-return');assert.ok(e.label);
});

test('Outcome is the next day and the next two days; scoring separates cuts and scales', () => {
 const days=dates.map(d=>dayRow(day(d,100,50)));days[9]=dayRow(day(dates[9],100,300));
 const o=outcomeAfter(days,8);assert.ok(o.next.result>0);assert.ok(o.next2.result>0);
 assert.deepEqual(outcomeAfter(days,11).next,{spend:null,result:null,roi:null},'no next day');
 const pts=[{outcome:{next:{spend:1,result:-5,roi:0.5}}},{outcome:{next:{spend:1,result:9,roi:2}}},{outcome:{next:{spend:0,result:0,roi:null}}}];
 assert.deepEqual(score(pts,{kind:'cut'}),{n:3,scored:2,precision:0.5,cutWinners:1,nextResult:4});
 assert.equal(score(pts,{kind:'scale'}).precision,0.5);
 assert.equal(score([], {kind:'cut'}).precision,null);
});

test('Backtest skips warm-up, days without spend and days without enough history', () => {
 const days=dates.map(d=>dayRow(day(d,100,150)));days[9].spend=0;
 const pts=backtest([{meta,days},{meta:{...meta,name:'ENGAJAMENTO 05/11'},days}].filter(s=>!/ENGAJ/.test(s.meta.name)));
 assert.ok(pts.every(p=>p.date>=dates[7]),'7 days of history first');
 assert.ok(!pts.some(p=>p.date===dates[9]),'no spend: no suggestion');
 assert.ok(!pts.some(p=>p.date===dates[11]),'last day has no outcome');
});
