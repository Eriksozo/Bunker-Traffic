import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateShadow,ruleAccuracy,shadowRulePolicy} from '../lib/autonomy-shadow.mjs';

// Owner decision of 08/11/2026 ("Aplicar agora"). Synthetic rows only.
// Synthetic fixtures only: identifiers and values are invented.
const now=Date.parse('2026-11-07T17:00:00Z'); // 14:00 America/Sao_Paulo
const iso=ms=>new Date(ms).toISOString();
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0,extra={})=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0,...extra});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'USD',budgetRate:5,lifetimeBudget:null,...metrics,...extra});
function state({today=[],closed={}}={}){
 const cut=(period,from,rows)=>({...base,period,from,to:'2026-11-07T03:00:00.000Z',fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows});
 return {config:{p:{projectName:'Fictício'}},snapshots:[
  {...base,period:'today',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows:today},
  cut('7d','2026-10-31T03:00:00.000Z',closed['7d']||[]),cut('3d','2026-11-04T03:00:00.000Z',closed['3d']||[]),cut('yesterday','2026-11-06T03:00:00.000Z',closed.yesterday||[])]};
}
const params={pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:300,budgetCap:5000};
const run=(s,opts={})=>evaluateShadow(s,{project:'p',params,now,...opts}).decisions;

test('ruleAccuracy counts only graded right/wrong of that rule, under the current rule version',()=>{
 const v=shadowRulePolicy.version,e=[{rule:'bad-day-reduce',ruleVersion:v,grade:{verdict:'acertou'}},{rule:'bad-day-reduce',ruleVersion:v,grade:{verdict:'errou'}},{rule:'bad-day-reduce',ruleVersion:v,grade:{verdict:'N/D'}},{rule:'bad-day-reduce',ruleVersion:v},{rule:'morning-increase',ruleVersion:v,grade:{verdict:'acertou'}}];
 assert.deepEqual(ruleAccuracy(e,'bad-day-reduce'),{graded:2,right:1,accuracy:0.5});
 // Decisions born under other rules (or before the version stamp) never count: the score restarts with the rules.
 assert.deepEqual(ruleAccuracy([{rule:'bad-day-reduce',grade:{verdict:'acertou'}},{rule:'bad-day-reduce',ruleVersion:v-1,grade:{verdict:'acertou'}}],'bad-day-reduce'),{graded:0,right:0,accuracy:null});
 assert.deepEqual(ruleAccuracy([], 'bad-day-reduce'),{graded:0,right:0,accuracy:null});
});

test('Bad day stays a suggestion until 60% over 20+ graded decisions',()=>{
 const good=m(3000,6000,10,10,40),bad=m(800,150,1,1,10);
 const s=state({today:[row('c1','01/11 - [CBO] - [AVATAR] Y',bad,{dailyBudget:500})],closed:{'3d':[row('c1','x',good)],'7d':[row('c1','x',good)],yesterday:[row('c1','x',good)]}});
 const pick=acc=>run(s,{accuracy:acc}).find(d=>d.rule==='bad-day-reduce');
 const none=pick(null);assert.equal(none.wouldExecute,false);assert.match(none.blockedBy.join(' '),/Só sugestão.*sem avaliações/);
 assert.equal(pick({'bad-day-reduce':{graded:19,right:19,accuracy:1}}).wouldExecute,false,'too few graded');
 const low=pick({'bad-day-reduce':{graded:30,right:17,accuracy:17/30}});assert.equal(low.wouldExecute,false);assert.match(low.blockedBy.join(' '),/17 de 30/);
 assert.equal(pick({'bad-day-reduce':{graded:20,right:12,accuracy:0.6}}).wouldExecute,true,'proven at exactly 60% / 20');
 assert.equal(shadowRulePolicy.badDayMinAccuracy,0.6);assert.equal(shadowRulePolicy.badDayMinGraded,20);
});

test('Increase needs a 3-day ROI of 1.3; strong day +50%, otherwise +30%',()=>{
 const pick=(today,hist)=>run(state({today:[row('i1','04/11 - [CBO] - [AVATAR] Z',today,{dailyBudget:100})],closed:{'3d':[row('i1','x',hist)],'7d':[row('i1','x',hist)],yesterday:[row('i1','x',hist)]}})).find(d=>d.rule==='morning-increase');
 const strong=pick(m(400,1500,4,5,20),m(1000,2000,6,6,30));
 assert.equal(strong.after.dailyBudget,150);assert.match(strong.reason,/dia forte/);assert.equal(strong.wouldExecute,true);
 const base=pick(m(400,1100,4,5,20),m(1000,2000,6,6,30));
 assert.equal(base.after.dailyBudget,130);assert.doesNotMatch(base.reason,/dia forte/);assert.equal(base.wouldExecute,true);
 const weak=pick(m(400,1500,4,5,20),m(1000,1200,6,6,30));
 assert.equal(weak.wouldExecute,false);assert.match(weak.blockedBy.join(' '),/Histórico de 3 dias abaixo de ROI 1.3 \(1.2\)/);
});
