import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPace,budgetPace} from '../lib/budget-pace.mjs';

const from='2026-11-07T04:00:00Z',at=h=>new Date(Date.parse(from)+h*3600000).toISOString();
const row=(id,spend,dailyBudget,extra={})=>({externalId:id,adAccountId:'act',level:'campaign',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend,dailyBudget,budgetCurrency:'BRL',...extra});
const state=(rows,hours,cfg={currency:'BRL'})=>({config:{p:{projectName:'P',...cfg}},snapshots:[{projectId:'p',period:'today',level:'campaign',from,fetchedAt:at(hours),rows}]});

test('on pace, under and running out are told apart from the elapsed share of the day', () => {
 assert.equal(projectPace(state([row('a',500,1000)],12),'p',Date.parse(at(12))).status,'on');
 const under=projectPace(state([row('a',200,1000)],12),'p',Date.parse(at(12)));
 assert.equal(under.status,'under');assert.equal(under.leftoverPct,60);
 const fast=projectPace(state([row('a',600,1000)],6),'p',Date.parse(at(6)));
 assert.equal(fast.status,'exhausts');assert.equal(fast.exhaustsAt,at(10));
 assert.equal(projectPace(state([row('a',1000,1000)],8),'p',Date.parse(at(8))).status,'spent');
});

test('missing signal stays N/D: too early, no budget, paused rows and foreign currency without a rate', () => {
 const early=projectPace(state([row('a',100,1000)],1),'p',Date.parse(at(1)));
 assert.equal(early.status,'nd');assert.match(early.reason,/Cedo demais/);
 assert.equal(projectPace(state([row('a',100,null)],8),'p',Date.parse(at(8))).status,'nd');
 assert.equal(projectPace(state([row('a',100,1000,{effectiveStatus:'PAUSED'})],8),'p',Date.parse(at(8))).known,0);
 const usd=projectPace(state([row('a',100,100,{budgetCurrency:'USD'}),row('b',400,1000)],12),'p',Date.parse(at(12)));
 assert.equal(usd.unknown,1);assert.equal(usd.known,1);assert.equal(usd.budget,1000);
 const converted=projectPace(state([row('a',300,100,{budgetCurrency:'USD',budgetRate:5.5})],12),'p',Date.parse(at(12)));
 assert.equal(converted.budget,550);
 assert.equal(projectPace({config:{p:{}},snapshots:[]},'p').status,'nd');
});

test('all projects combine only within one currency', () => {
 const two={config:{p:{projectName:'P',currency:'BRL'},q:{projectName:'Q',currency:'BRL'}},snapshots:[
  {projectId:'p',period:'today',level:'campaign',from,fetchedAt:at(12),rows:[row('a',500,1000)]},
  {projectId:'q',period:'today',level:'campaign',from,fetchedAt:at(12),rows:[row('b',100,1000)]}]};
 const all=budgetPace(two,'all',Date.parse(at(12)));
 assert.equal(all.budget,2000);assert.equal(all.status,'under');assert.equal(all.byProject.length,2);
 two.config.q.currency='USD';two.snapshots[1].rows=[row('b',100,1000,{budgetCurrency:'USD'})];
 const mixed=budgetPace(two,'all',Date.parse(at(12)));
 assert.equal(mixed.status,'nd');assert.match(mixed.reason,/moedas diferentes/);
});
