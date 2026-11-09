import test from 'node:test';
import assert from 'node:assert/strict';
import {isTestCampaign,testLaunchContext} from '../lib/test-launch.mjs';
import {isWarmupCampaign} from '../lib/campaign-scope.mjs';
import {decisionList} from '../lib/decision-list.mjs';
import {financialScope,executionCollision,assertExecutionIsolation} from '../lib/decision-contingency.mjs';
import {recordDecisionHistoryOutcome} from '../lib/decision-history-outcomes.mjs';

const now=Date.parse('2026-11-09T15:00:00Z');
const win=(spend,front=0)=>({adAccountId:'acc',externalId:'1',spend,frontOrders:front,orders:front,revenueNet:front*100});
const test1=(extra={})=>({name:'[TESTE] noturno',provider:'meta',adAccountId:'acc',externalId:'1',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},...extra});

test('A test started last night keeps the new-test priority the next day when all closed-window spend is from yesterday',()=>{
 const windows={'7d':win(20),'3d':win(20),yesterday:win(20),today:win(150)};
 for(const start of [{deliveryStartedAt:'2026-11-09T00:00:00Z'},{startAt:'2026-11-09T00:00:00Z'}]){
  const c=testLaunchContext(test1(start),windows,{now});assert.equal(c.eligible,true);assert.equal(c.priority,true);
 }
 // Spend older than yesterday, or a start today with closed-window spend, is history: not a new test.
 assert.equal(testLaunchContext(test1({deliveryStartedAt:'2026-11-09T00:00:00Z'}),{...windows,'7d':win(300)},{now}).eligible,false);
 assert.equal(testLaunchContext(test1({deliveryStartedAt:'2026-11-09T13:00:00Z'}),windows,{now}).eligible,false);
 assert.equal(testLaunchContext(test1(),windows,{now}).eligible,false,'unknown start keeps the old rule');
 assert.equal(testLaunchContext(test1({provider:'Meta',deliveryStartedAt:'2026-11-09T13:00:00Z'}),{today:win(150)},{now}).priority,true,'provider case does not matter');
});

test('Test and warm-up names: whole words, digits and plurals',()=>{
 for(const n of ['[TESTE] A','[TESTE01] A','[TESTES] B','teste - c','[PRÉ] [TESTE]'])assert.equal(isTestCampaign(n),true,n);
 for(const n of ['[CBO] TESTEMUNHO Vendas','[ATESTADO]','[ESCALA] teste','[TESTE] engajamento'])assert.equal(isTestCampaign(n),false,n);
 for(const n of ['[AQUECIMENTO01] Perfil','[ENGAJAMENTO2]','[ENGAJAMENTOS] IG','[AQUECIDA]','[AQUECENDO]','[WARMUP]','engajamento'])assert.equal(isWarmupCampaign(n),true,n);
 for(const n of ['[CBO] Vendas','WARMUPPER','ENGAGEMENTSCORE'])assert.equal(isWarmupCampaign(n),false,n);
});

test('Without a live reading the list still ranks money at stake, and a new test without sales comes first in its stage',()=>{
 const card=(name,spend,priority=false)=>({row:{name},windows:{today:{spend}},testLaunch:{priority}});
 const order=decisionList([{id:'analysis',cards:[card('[CBO] A vencedora',3),card('[CBO] B grande',900),card('[TESTE] Z novo sem vendas',480,true)]}]).map(r=>r.card.row.name);
 assert.deepEqual(order,['[TESTE] Z novo sem vendas','[CBO] B grande','[CBO] A vencedora']);
 assert.equal(decisionList([{id:'analysis',cards:[card('X',480)]}])[0].metrics.spendToday,null,'label stays N/D');
});

test('Two projects sharing an ad account share the budget lock',()=>{
 const pay={level:'campaign',provider:'meta',adAccountId:'acc',objectId:'111',action:'budget',before:{dailyBudget:100},after:{dailyBudget:150},currency:'BRL'};
 const pJ={id:'pJ',project:'John',payload:pay},pG={id:'pG',project:'Gabe',payload:pay};
 const s={config:{Gabe:{},John:{}},proposals:[pJ,pG],executions:[{id:'e1',proposalId:'pJ',project:'John',status:'Enviada',submittedAt:'2026-11-09T14:59:00Z'}]};
 assert.equal(financialScope(s,pJ),financialScope(s,pG));
 assert.ok(executionCollision(s,pG,'x',now));assert.throws(()=>assertExecutionIsolation(s,pG,'x',now),/outra execução/);
 assert.doesNotThrow(()=>assertExecutionIsolation(s,{...pG,payload:{...pay,adAccountId:'other'}},'x',now));
});

test('An incident of another campaign in the same account does not taint an outcome',()=>{
 const m=(spend,net)=>({name:'[TESTE] Y',provider:'meta',level:'campaign',adAccountId:'acc',externalId:'Y',budgetCurrency:'BRL',spend,revenueNet:net,adCosts:0,productCost:0,saleTax:0,frontOrders:3,orders:3,checkouts:5,impressions:1000,linkClicks:50});
 const w=(from,to,row)=>({source:'Malva MCP',complete:true,level:'campaign',projectId:'Gabe',period:'7d',from,to,fetchedAt:'2026-11-09T10:00:00.000Z',lastSyncAt:'2026-11-09T10:00:00.000Z',timezone:'America/Sao_Paulo',rows:[row]});
 const before=w('2026-11-05T03:00:00.000Z','2026-11-07T03:00:00.000Z',m(100,150)),after=w('2026-11-07T03:00:00.000Z','2026-11-09T03:00:00.000Z',m(100,300));
 const mk=incidents=>({config:{Gabe:{}},snapshots:[before,after],decisionHistory:[{id:'ev',eventKey:'k',project:'Gabe',sourceSystem:'Malva MCP',objectId:'Y',adAccountId:'acc',currency:'BRL',occurredAt:'2026-11-07T03:00:00.000Z',source:'meta'}],incidents});
 const inc=(objectId)=>[{id:'inc',project:'Gabe',status:'Interrompido',createdAt:'2026-11-06T00:00:00Z',reportedAt:'2026-11-06T00:00:00Z',scope:{accountIds:['acc'],objectIds:[{adAccountId:'acc',objectId}]}}];
 const run=s=>recordDecisionHistoryOutcome(s,{clientId:'c',entry:{eventId:'ev',project:'Gabe',before,after}},now);
 assert.equal(run(mk(inc('X-other'))).classification,run(mk([])).classification);
 assert.deepEqual(run(mk(inc('Y'))).incidentIds,['inc'],'the same campaign still counts');
 assert.deepEqual(run(mk([{...inc('Y')[0],scope:{accountIds:['acc']}}])).incidentIds,['inc'],'account-wide still counts');
});
