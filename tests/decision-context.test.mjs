import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionContext,contextChecks} from '../lib/decision-context.mjs';
import {candidates,sum} from '../lib/analysis.mjs';
import {buildDecisionCards} from '../lib/decision-cards.mjs';

const now=Date.now(),project='project-context',date=at=>new Date(at).toISOString();
const periodSpend={'7d':1000,'3d':600,yesterday:200,today:100};
function fixture({roi={'7d':2,'3d':2.2,yesterday:1.8,today:0.3},row={},config={}}={}){
 const base={id:'internal-campaign',externalId:'meta-campaign',adAccountId:'account-a',accountName:'Conta A',provider:'Meta',name:'[CBO] [ESCALA] Criativo validado',level:'campaign',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},budgetCurrency:'USD',budgetRate:5,dailyBudget:100,lifetimeBudget:null,adCosts:4,productCost:0,saleTax:0,frontOrders:4,orders:6,checkouts:10,impressions:2000,linkClicks:40,refundedRevenue:0,...row};
 return {config:{[project]:{projectName:'Projeto contexto',targetRoas:2,dailyCap:1000,lossCap:200,testHours:24,...config}},paused:false,jobs:[],snapshots:['7d','3d','yesterday','today'].map(period=>{
  const spend=periodSpend[period],revenueNet=roi[period]*(spend+base.adCosts);
  return {projectId:project,projectName:'Projeto contexto',period,level:'campaign',source:'Malva MCP',complete:true,from:date(now-(period==='7d'?7:period==='3d'?3:1)*86400000),to:date(period==='today'?now+3600000:now-3600000),timezone:'America/Sao_Paulo',fetchedAt:date(now-1000),lastSyncAt:date(now-2000),rows:[{...structuredClone(base),spend,revenueNet,revenue:revenueNet+50}]};
 })};
}
const windows=state=>Object.fromEntries(state.snapshots.map(snapshot=>[snapshot.period,sum(snapshot.rows)]));

test('Weak today with profitable closed windows becomes context review instead of a scale signal',()=>{
 const state=fixture(),before=structuredClone(state),signal=candidates(state,project)[0];
 assert.equal(signal.context.kind,'mixed-return');
 assert.equal(signal.decision,'Revisar contexto do dia');
 assert.equal(signal.tone,'amber');
 assert.equal(signal.context.automaticAction,false);
 assert.ok(signal.recent.roi>=1.8&&signal.week.roi>=1.8,'This would otherwise pass the historical scale branch.');
 assert.deepEqual(state,before);
});

test('A profitable four-day remainder is not inferred from conflicting overlapping aggregates',()=>{
 const metrics=windows(fixture({roi:{'7d':1.6,'3d':0.7,yesterday:0.5,today:0.4}})),before=structuredClone(metrics),context=decisionContext(metrics);
 assert.equal(context.kind,'mixed-return');
 assert.equal(context.title,'Retorno divergente entre períodos');
 assert.match(context.limitation,/não provam.*isolada/);
 assert.match(context.limitation,/sequência/);
 assert.equal(context.automaticAction,false);
 assert.deepEqual(metrics,before);
});

test('Missing, zero or non-finite observation cost and invalid ROI remain unknown context',()=>{
 const measured=windows(fixture());
 for(const period of ['7d','3d','today']){
  for(const value of [null,undefined,NaN,Infinity,-Infinity,0,-1,'100']){
   const sample=structuredClone(measured);sample[period].spend=value;
   assert.equal(decisionContext(sample),null,`${period} cost ${String(value)} cannot establish a contrast.`);
  }
  for(const value of [null,undefined,NaN,Infinity,-Infinity,'0.3']){
   const sample=structuredClone(measured);sample[period].roi=value;
   assert.equal(decisionContext(sample),null,`${period} ROI ${String(value)} must stay unknown.`);
  }
  const missing=structuredClone(measured);delete missing[period];assert.equal(decisionContext(missing),null);
 }
 assert.equal(decisionContext(null),null);
 assert.equal(decisionContext({}),null);
});

test('Measured zero return is a weak observation and is not confused with absent data',()=>{
 const metrics=windows(fixture({roi:{'7d':1.4,'3d':1.3,yesterday:1.2,today:0}}));
 const context=decisionContext(metrics);
 assert.equal(context.kind,'mixed-return');
 assert.equal(context.title,'Hoje fraco, histórico rentável');
 assert.equal(context.automaticAction,false);
});

test('Loss in both closed windows still calls for investigating losses rather than immunity from history',()=>{
 const state=fixture({roi:{'7d':0.8,'3d':0.6,yesterday:0.5,today:0.4}}),context=decisionContext(windows(state)),signal=candidates(state,project)[0];
 assert.equal(context.kind,'negative-history');
 assert.equal(context.tone,'red');
 assert.equal(context.automaticAction,false);
 assert.equal(signal.decision,'Revisar perda');
 assert.match(context.limitation,/não comprovam dias ruins consecutivos/);
 assert.match(context.limitation,/não justificam.*pausar/);
});

test('A good partial day does not erase losses in the closed windows or manufacture a recovery sequence',()=>{
 const state=fixture({roi:{'7d':0.8,'3d':0.6,yesterday:0.5,today:2}}),signal=candidates(state,project)[0];
 assert.equal(signal.context.kind,'negative-history');
 assert.equal(signal.decision,'Revisar perda');
 assert.equal(signal.context.automaticAction,false);
});

test('No profile invents an action when all known windows are profitable or exactly at equilibrium',()=>{
 for(const roi of [1,1.2,2])assert.equal(decisionContext(windows(fixture({roi:{'7d':roi,'3d':roi,yesterday:roi,today:roi}}))),null);
});

test('Upsell orders and aggregate return are never described as repeated new front buyers',()=>{
 const state=fixture({row:{frontOrders:0,orders:8}}),card=buildDecisionCards(state,project,now)[0];
 assert.equal(card.windows['3d'].frontOrders,0);
 assert.equal(card.windows['3d'].orders,8);
 assert.equal(card.context.kind,'mixed-return');
 assert.equal(card.context.automaticAction,false);
 assert.ok(card.context.checks.some(check=>/pedidos e upsells não são novas vendas front/.test(check)));
 assert.doesNotMatch(card.context.summary,/compradores|vendas front consistentes|aquisição recorrente/);
});

test('Stale data, ineffective status and account issues retain priority over the context triage',()=>{
 for(const [row,decision] of [[{effectiveStatus:'PAUSED'},'Revisar objeto sem entrega ativa'],[{effectiveStatus:'WITH_ISSUES'},'Investigar'],[{accountStatus:{active:false}},'Investigar']]){
  const state=fixture({row}),signal=candidates(state,project)[0];
  assert.equal(signal.context.kind,'mixed-return');assert.equal(signal.decision,decision);
 }
 const stale=fixture();for(const source of stale.snapshots){source.lastSyncAt=date(now-61*60000);source.fetchedAt=date(now-61*60000);}
 const signal=candidates(stale,project)[0],card=buildDecisionCards(stale,project,now)[0];
 assert.equal(signal.decision,'Investigar');assert.equal(signal.tone,'gray');
 assert.equal(card.actionable.increase,false);assert.equal(card.actionable.reduce,false);assert.equal(card.actionable.pause,false);
});

test('Context remains a diagnostic on cards and does not create opinions, choices, proposals or financial authorization',()=>{
 const state=fixture(),before=structuredClone(state),card=buildDecisionCards(state,project,now)[0];
 assert.equal(card.context.kind,'mixed-return');
 assert.equal(card.context.automaticAction,false);
 assert.equal(card.suggestion.origin,'diagnostic');
 assert.equal(card.teamReady,false);assert.deepEqual(card.teamOpinions,[]);
 assert.deepEqual(state,before);
 assert.equal(state.ownerChoices,undefined);assert.equal(state.proposals,undefined);assert.equal(state.executions,undefined);
 const paused=structuredClone(state);paused.paused=true;const held=buildDecisionCards(paused,project,now)[0];
 assert.equal(held.context.kind,'mixed-return');
 assert.equal(held.actionable.increase,false);assert.equal(held.actionable.reduce,false);assert.equal(held.actionable.pause,false);
});

test('A protected test keeps its delivery safeguard and context never sets a new limit',()=>{
 const state=fixture({row:{name:'[CBO] [TESTE] novo criativo'},config:{dailyCap:null,lossCap:null}}),before=structuredClone(state),signal=candidates(state,project)[0];
 assert.equal(signal.decision,'Teste protegido');
 assert.equal(signal.context.kind,'mixed-return');
 assert.equal(signal.context.automaticAction,false);
 assert.deepEqual(state,before);
 assert.equal(state.config[project].dailyCap,null);assert.equal(state.config[project].lossCap,null);
});

test('Test protection cannot conceal an inactive advertising account',()=>{
 const state=fixture({row:{name:'[CBO] [TESTE] novo criativo',accountStatus:{active:false}}}),before=structuredClone(state),signal=candidates(state,project)[0];
 assert.equal(signal.context.kind,'mixed-return');
 assert.equal(signal.decision,'Investigar');
 assert.equal(signal.tone,'red');
 assert.match(signal.reason,/restrição ou reprovação/);
 assert.deepEqual(state,before);
});

test('Identical overlapping samples and independent account identities are not converted into a daily streak',()=>{
 const state=fixture();for(const source of state.snapshots){source.rows[0].spend=100;source.rows[0].revenueNet=30;source.rows[0].revenue=40;}
 const signal=candidates(state,project)[0];
 assert.equal(signal.decision,'Amostra recente');
 assert.equal(signal.context.kind,'negative-history');
 assert.match(signal.context.limitation,/sobrepostas/);
 for(const source of state.snapshots)source.rows.push({...source.rows[0],id:'internal-b',adAccountId:'account-b',revenueNet:250,revenue:280});
 const cards=buildDecisionCards(state,project,now);
 assert.equal(cards.length,2);
 assert.equal(cards.find(card=>card.row.adAccountId==='account-a').context.kind,'negative-history');
 assert.equal(cards.find(card=>card.row.adAccountId==='account-b').context,null);
});

test('Callers cannot corrupt the shared checklist by changing a previous returned profile',()=>{
 const metrics=windows(fixture()),first=decisionContext(metrics);first.checks.pop();
 const next=decisionContext(metrics);
 assert.deepEqual(next.checks,contextChecks);assert.notEqual(first.checks,next.checks);
});

test('zero or isolated front acquisition with losses becomes a pause/reduce review, never a financial instruction',()=>{
 for(const frontOrders of [0,1]){
  const state=fixture({roi:{'7d':0.7,'3d':0.6,yesterday:0.5,today:0.4},row:{frontOrders,orders:frontOrders+3}}),before=structuredClone(state),card=buildDecisionCards(state,project,now)[0],signal=candidates(state,project)[0];
  assert.equal(card.context.kind,'weak-acquisition');assert.equal(card.context.automaticAction,false);assert.match(card.context.summary,/uma venda isolada/);assert.equal(signal.decision,'Avaliar pausa ou redução');assert.equal(card.suggestion.origin,'diagnostic');assert.deepEqual(state,before);assert.equal(state.proposals,undefined);
 }
});

test('missing front data, protected tests and profitable history cannot be converted into automatic pause cases',()=>{
 const loss={roi:{'7d':0.7,'3d':0.6,yesterday:0.5,today:0.4}};
 for(const frontOrders of [null,undefined,NaN,'0'])assert.equal(decisionContext(windows(fixture({...loss,row:{frontOrders}}))).kind,'negative-history');
 const protectedState=fixture({...loss,row:{frontOrders:0,name:'[TESTE] young',deliveryStartedAt:date(now-3600000)}});assert.equal(candidates(protectedState,project)[0].decision,'Teste protegido');assert.equal(protectedState.config[project].testHours,24);
 assert.equal(decisionContext(windows(fixture({row:{frontOrders:1}}))).kind,'mixed-return');
});
