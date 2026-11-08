import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPace,budgetPace} from '../lib/budget-pace.mjs';

// Synthetic fixtures only.
const from='2026-11-07T03:00:00Z',at=h=>new Date(Date.parse(from)+h*3600000).toISOString(),t=h=>Date.parse(at(h));
const row=(id,spend,dailyBudget,extra={})=>({externalId:id,adAccountId:'act',level:'campaign',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend,dailyBudget,budgetCurrency:'BRL',...extra});
const snap=(rows,hours,over={})=>({projectId:'p',period:'today',level:'campaign',from,fetchedAt:at(hours),timezone:'America/Sao_Paulo',rows,...over});
const state=(snaps,cfg={currency:'BRL'})=>({config:{p:{projectName:'P',...cfg}},snapshots:snaps});

test('After midnight, yesterday\'s "today" source is not today\'s pace (no false under-pace alert)', () => {
 const s=state([snap([row('a',100,1000)],23.5)]);
 const late=projectPace(s,'p',t(23.9));assert.equal(late.status,'under','still the same day');
 const next=projectPace(s,'p',t(24.2));
 assert.equal(next.status,'nd');assert.equal(next.alert,undefined);assert.match(next.reason,/dia anterior/);
 assert.equal(budgetPace(s,'all',t(24.2)).status,'nd');
});

test('Pace counts each campaign once, only active ones, and leaves unknown budgets out', () => {
 const rows=[row('a',300,1000),row('a',300,1000),row('b',50,null),row('c',50,200,{lifetimeBudget:0,effectiveStatus:'PAUSED'}),row('d',50,200,{accountStatus:{active:false}}),row('e',null,200)];
 const p=projectPace(state([snap(rows,12)]),'p',t(12));
 assert.equal(p.known,1);assert.equal(p.unknown,2);assert.equal(p.budget,1000);assert.equal(p.spend,300);
});

test('Native budgets convert with the row rate; another currency without a rate is unknown', () => {
 const p=projectPace(state([snap([row('a',270,100,{budgetCurrency:'USD',budgetRate:5.4}),row('b',10,100,{budgetCurrency:'EUR'})],12)]),'p',t(12));
 assert.equal(p.budget,540);assert.equal(p.known,1);assert.equal(p.unknown,1);
 const noCurrency=projectPace(state([snap([row('a',10,100)],12)],{}),'p',t(12));
 assert.equal(noCurrency.known,0,'without a project currency BRL is not assumed');
});

test('The newest today source wins and a future fetch time is clamped to now', () => {
 const s=state([snap([row('a',900,1000)],10),snap([row('a',100,1000)],2)]);
 assert.equal(projectPace(s,'p',t(12)).spend,900);
 const future=projectPace(state([snap([row('a',500,1000)],14)]),'p',t(12));
 assert.equal(future.elapsedPct,50,'elapsed never runs ahead of the clock');
});

test('Combined line refuses mixed currencies and keeps the earliest run-out', () => {
 const two={config:{p:{projectName:'P',currency:'BRL'},q:{projectName:'Q',currency:'USD'}},snapshots:[snap([row('a',600,1000)],6),{...snap([row('b',600,1000,{budgetCurrency:'USD'})],6),projectId:'q'}]};
 const all=budgetPace(two,'all',t(6));assert.equal(all.status,'nd');assert.equal(all.currency,null);assert.match(all.reason,/moedas diferentes/);
 two.config.q.currency='BRL';two.snapshots[1].rows=[row('b',300,1000)];
 const same=budgetPace(two,'all',t(6));assert.equal(same.currency,'BRL');assert.equal(same.budget,2000);
 assert.equal(same.exhaustsAt,budgetPace(two,'p',t(6)).exhaustsAt,'the faster project runs out first');
});

test('Early in the day the pace is not measured', () => {
 const p=projectPace(state([snap([row('a',600,1000)],1.5)]),'p',t(1.5));
 assert.equal(p.status,'nd');assert.match(p.reason,/Cedo demais/);assert.equal(p.projected,null);
});
