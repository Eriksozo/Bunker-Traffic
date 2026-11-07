import test from 'node:test';
import assert from 'node:assert/strict';
import {describeChange,activityLog,activitySummary,cardActivity,metricEvolution} from '../lib/campaign-activity.mjs';

const now=Date.parse('2026-11-07T15:00:00Z'),iso=h=>new Date(now-h*3600000).toISOString();
const history=(id,field,before,after,hoursAgo,actor,extra={})=>({id,project:'p',projects:['p'],adAccountId:'act',objectId:'c1',name:'Campanha 1',accountName:'Conta',field,before,after,occurredAt:iso(hoursAgo),actor,currency:'BRL',...extra});

test('transitions carry exact before/after and percent; unknown or zero baselines get no invented percent',()=>{
 assert.deepEqual(describeChange({field:'dailyBudget',before:1000,after:700}),{action:'reduce',field:'dailyBudget',before:1000,after:700,percent:-30});
 assert.equal(describeChange({field:'dailyBudget',before:300,after:1500}).percent,400);
 assert.equal(describeChange({field:'dailyBudget',before:0,after:100}).percent,null);
 assert.equal(describeChange({field:'status',before:'ACTIVE',after:'PAUSED'}).action,'pause');
 assert.equal(describeChange({field:'status',before:'PAUSED',after:'ACTIVE'}).action,'activate');
 assert.equal(describeChange({field:'dailyBudget',before:null,after:100}),null);
 assert.equal(describeChange({field:'dailyBudget',before:100,after:100}),null);
});

test('the log merges a Malva edit with the read that observed it, keeps the actor and never names an unknown author',()=>{
 const state={decisionHistory:[history('h1','dailyBudget',1000,1300,2,{name:'Ana Gestora'}),history('h2','status','ACTIVE','PAUSED',30,'Bruno'),history('h3','dailyBudget',500,400,1,null,{project:'q',projects:['q']})],
  campaignChanges:[{id:'o1',project:'p',adAccountId:'act',objectId:'c1',name:'Campanha 1',observedAt:iso(1.5),previousObservedAt:iso(2.5),changes:[{field:'dailyBudget',before:1000,after:1300}],before:{budgetCurrency:'BRL'},after:{budgetCurrency:'BRL'}},
   {id:'o2',project:'p',adAccountId:'act',objectId:'c2',name:'Campanha 2',observedAt:iso(3),previousObservedAt:iso(4),changes:[{field:'status',before:'ACTIVE',after:'PAUSED'},{field:'effectiveStatus',before:'ACTIVE',after:'PAUSED'}]}]};
 const log=activityLog(state,{project:'p',now});
 assert.deepEqual(log.map(e=>[e.objectId,e.action,e.actor,e.origin]),[['c1','increase','Ana Gestora','history'],['c2','pause',null,'observed'],['c1','pause','Bruno','history']]);
 assert.equal(log[0].percent,30);assert.ok(log[0].confirmedBy.includes('Leitura Malva (autor não informado)'));
 assert.equal(activityLog(state,{project:'p',since:now-24*3600000,now}).length,2);
 const summary=activitySummary(activityLog(state,{project:'all',now}));
 assert.equal(summary.increase.count,1);assert.deepEqual(summary.increase.actors,{'Ana Gestora':1});
 assert.equal(summary.pause.count,2);assert.equal(summary.pause.unknown,1);assert.equal(summary.reduce.count,1);assert.equal(summary.reduce.unknown,1);
});

test('a change confirmed by a Bunker execution is labelled as the owner-approved Bunker action, not another manager',()=>{
 const state={proposals:[{id:'pr1',project:'p',payload:{action:'budget',adAccountId:'act',objectId:'c1',currency:'BRL',before:{dailyBudget:1000},after:{dailyBudget:800}}}],
  executions:[{id:'e1',proposalId:'pr1',project:'p',status:'Confirmada',confirmedAt:iso(1)},{id:'e2',proposalId:'pr1',project:'p',status:'Enviada'}],
  decisionHistory:[history('h1','dailyBudget',1000,800,1.1,{name:'Chave API'})]};
 const log=activityLog(state,{project:'p',now});
 assert.equal(log.length,1);assert.equal(log[0].origin,'bunker');assert.equal(log[0].percent,-20);assert.ok(log[0].confirmedBy.includes('Histórico de edições Malva'));
});

test('a card shows changes made after its analysis, including a live-read change not yet logged',()=>{
 const state={decisionHistory:[history('old','dailyBudget',800,1000,10,'Ana'),history('new','dailyBudget',1000,700,1,'Bruno')]};
 const card={project:'p',sourceAt:iso(3),liveAt:iso(0.1),row:{adAccountId:'act',externalId:'c1',name:'Campanha 1',budgetCurrency:'BRL'},liveDrift:{changes:[{field:'status',before:'ACTIVE',after:'PAUSED'}]}};
 const a=cardActivity(state,card,{now});
 assert.deepEqual(a.events.map(e=>[e.action,e.actor]),[['pause',null],['reduce','Bruno'],['increase','Ana']]);
 assert.deepEqual(a.sinceAnalysis.map(e=>e.action),['pause','reduce']);assert.equal(a.latest.origin,'live');
 assert.deepEqual(cardActivity(state,{project:'p',row:null}),{events:[],sinceAnalysis:[],latest:null});
});

test('metric evolution compares the same day window only and keeps missing values null',()=>{
 const card={sourceAt:iso(2),liveAt:iso(0.1),windows:{today:{from:'2026-11-07T03:00:00Z',spend:100,frontOrders:1,revenueNet:150,roas:1.5,roi:1.4}},liveToday:{from:'2026-11-07T03:00:00Z',spend:250,frontOrders:3,revenueNet:500,roas:2,roi:null}};
 const m=metricEvolution(card);assert.equal(m.spend,150);assert.equal(m.frontOrders,2);assert.deepEqual(m.roas,{before:1.5,after:2});assert.deepEqual(m.roi,{before:1.4,after:null});
 assert.equal(metricEvolution({...card,liveToday:{...card.liveToday,from:'2026-11-08T03:00:00Z'}}),null);
 assert.equal(metricEvolution({...card,liveAt:iso(3)}),null);
});
