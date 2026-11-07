import test from 'node:test';
import assert from 'node:assert/strict';
import {describeChange,activityLog,activityForRange,activityTimezone,activitySummary,cardActivity,metricEvolution} from '../lib/campaign-activity.mjs';

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


test('Today uses project midnight, excludes yesterday and future events, preserves rolling ranges',()=>{
 const at=Date.parse('2026-11-07T12:00:00Z');
 const event=(id,occurredAt)=>history(id,'dailyBudget',100,120,0,'Gestor',{objectId:id,occurredAt});
 const state={snapshots:[{projectId:'p',source:'Malva MCP',complete:true,timezone:'America/Sao_Paulo'}],decisionHistory:[
  event('yesterday','2026-11-07T02:59:59Z'),event('midnight','2026-11-07T03:00:00Z'),event('now','2026-11-07T12:00:00Z'),event('future','2026-11-07T12:01:00Z'),event('old','2026-11-02T12:00:00Z')]};
 assert.equal(activityTimezone(state,'p'),'America/Sao_Paulo');
 assert.deepEqual(activityForRange(state,{project:'p',range:'today',now:at}).events.map(e=>e.objectId),['now','midnight']);
 assert.equal(activityForRange(state,{project:'p',range:'day',now:at}).events.length,3);
 assert.equal(activityForRange(state,{project:'p',range:'week',now:at}).events.length,4);
 const all=activityForRange(state,{project:'all',range:'today',now:at});
 assert.equal(all.timezone,'America/Boa_Vista');assert.deepEqual(all.events.map(e=>e.objectId),['now']);
 assert.deepEqual(activityForRange(state,{project:'p',range:'today',now:Date.parse('2026-11-08T03:00:00Z')}).events,[]);
});

test('Today follows DST calendar boundaries and timezone fallback stays explicit',()=>{
 const state={snapshots:[{projectId:'p',source:'Malva MCP',complete:true,timezone:'America/New_York'}],decisionHistory:[
  history('before','status','ACTIVE','PAUSED',0,'Ana',{occurredAt:'2026-11-01T03:59:59Z'}),
  history('start','status','PAUSED','ACTIVE',0,'Ana',{occurredAt:'2026-11-01T04:00:00Z'}),
  history('end','dailyBudget',100,150,0,'Ana',{occurredAt:'2026-11-02T04:30:00Z'})]};
 assert.equal(activityForRange(state,{project:'p',range:'today',now:Date.parse('2026-11-02T04:45:00Z')}).events.length,2);
 assert.equal(activityTimezone({snapshots:[{projectId:'p',source:'Malva MCP',complete:true,timezone:'invalid'}]},'p'),'America/Boa_Vista');
 assert.equal(activityTimezone({},'p'),'America/Boa_Vista');
 assert.deepEqual(activityForRange(state,{range:'today',now:NaN}).events,[]);
});

test('an executor attribution names the author of an observed change and keeps its exact time',()=>{
 const state={campaignChanges:[{id:'o1',project:'p',adAccountId:'act',objectId:'c9',name:'Campanha 9',observedAt:iso(1),previousObservedAt:iso(1.25),changes:[{field:'status',before:'ACTIVE',after:'PAUSED'}]}],
  changeAttributions:[{key:'o1:status',project:'p',adAccountId:'act',objectId:'c9',field:'status',before:'ACTIVE',after:'PAUSED',at:iso(1.1),actor:'Jorge Raimundo',matched:true}]};
 const log=activityLog(state,{project:'p',now});
 assert.equal(log.length,1);assert.equal(log[0].actor,'Jorge Raimundo');assert.equal(log[0].at,iso(1.1));assert.equal(log[0].name,'Campanha 9');
 assert.equal(activitySummary(log).pause.unknown,0);
});

test('named history wins over an anonymous duplicate, but repeated real transitions retain their own managers',()=>{
 const state={decisionHistory:[history('missing','status','ACTIVE','PAUSED',1.1,null,{eventId:'e1'})],changeAttributions:[
  {key:'same',eventId:'e1',project:'p',adAccountId:'act',objectId:'c1',field:'status',before:'ACTIVE',after:'PAUSED',at:iso(1.1),actor:'Jorge',currency:'BRL'},
  {key:'another',eventId:'e2',project:'p',adAccountId:'act',objectId:'c1',field:'status',before:'ACTIVE',after:'PAUSED',at:iso(2),actor:'Leonardo',currency:'BRL'}]};
 const log=activityLog(state,{now});assert.equal(log.length,2);assert.deepEqual(log.map(e=>e.actor),['Jorge','Leonardo']);
});

test('observed transition only merges within its observed interval; distinct account, currency and project never borrow an author',()=>{
 const observed={id:'o',project:'p',adAccountId:'act',objectId:'c1',observedAt:iso(1),previousObservedAt:iso(1.25),changes:[{field:'dailyBudget',before:100,after:200}],before:{budgetCurrency:'BRL'},after:{budgetCurrency:'BRL'}};
 const s={campaignChanges:[observed],decisionHistory:[history('outside','dailyBudget',100,200,2,'Outra'),history('currency','dailyBudget',100,200,1.1,'Dolar',{currency:'USD'}),history('account','dailyBudget',100,200,1.1,'Outra conta',{adAccountId:'act2'}),history('project','dailyBudget',100,200,1.1,'Outro projeto',{project:'q',projects:['q']})]};
 const log=activityLog(s,{project:'p',now});assert.equal(log.find(e=>e.origin==='observed').actor,null);assert.equal(log.length,4);
});
