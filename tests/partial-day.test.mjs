import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {cloudAnalysisContext} from '../lib/cloud-analysis.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
import {partialDayHold,partialDayReason} from '../lib/partial-day.mjs';
import {evaluateShadow} from '../lib/autonomy-shadow.mjs';

// Owner context of 10/11/2026 (a manager's note, paraphrased without real values): profit yesterday, half a ticket spent today,
// no reason to touch. Synthetic fixtures only: identifiers and values are invented.
const project='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const iso=t=>new Date(t).toISOString();
// Six Meta campaigns with sales and known costs (yesterday's profit is R$100); 403 has only a lifetime budget (no own daily budget to change).
function fixture(){
 const now=Date.now(),start=Date.parse(iso(now).slice(0,10)+'T00:00:00Z');
 const base={externalId:'123',adAccountId:account,provider:'meta',name:'Sales',accountName:'Example',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',level:'campaign',spend:100,revenueNet:200,frontOrders:2,adCosts:0,productCost:0,saleTax:0};
 const rows=()=>Array.from({length:6},(_,i)=>({...base,id:'internal-'+i,externalId:i?String(400+i):'123',name:'Sales '+i,...(i===3?{dailyBudget:null,lifetimeBudget:1000}:{})}));
 const job={id:'job',project,status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)};
 const state={config:{[project]:{projectName:'Example'}},jobs:[job],agents:{[project]:{jobId:'job'}},collaborationRounds:[],collaborationMessages:[],proposals:[],executions:[],snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Example',period,level:'campaign',source:'Malva MCP',complete:true,from:iso(start-({today:0,yesterday:1,'3d':3,'7d':7}[period])*86400000),to:iso(start+(period==='today'?86400000:0)),timezone:'UTC',fetchedAt:iso(now-1000),lastSyncAt:null,rows:rows()}))};
 const round=ensureCollaboration(state,job);return {state,round};
}
// Same per-write commit semantics as the worker: a throwing callback commits nothing. failWhen simulates a lost commit.
function memory(state,failWhen=()=>false){return {get state(){return state;},write:async fn=>{const draft=structuredClone(state),r=await fn(draft,1);if(failWhen(draft))throw Error('storage write lost');state=draft;return r;}};}
function model(opsSuggestions){let ops=0;return {get opsCalls(){return ops;},run:async(_m,request)=>{const b=JSON.parse(request.messages[1].content),c=b.context,r=b.reflectionRequirements;if(c.role==='ops'&&!c.proposal)ops++;
 return {response:{decision:'Revisar exposição',reason:'Conferir aquisição',nextStep:'Aguardar o dono',text:'Leitura das campanhas do pacote.',verdict:c.proposal?'approve':null,memoryReview:b.memoryReviewRequirements?.required?{reference:b.memoryReviewRequirements.options[0].reference,stance:'inconclusive',reason:'Sem resultado posterior; confrontar a fonte atual.',evidenceReferences:b.evidenceSelection.reflectionExamples.slice(0,1)}:null,campaignReadings:b.evidenceSelection.campaignExamples.map(x=>({...x,assessment:'observe',reason:'Conferir aquisição desta campanha.'})),reflection:{lesson:'Conferir a própria fonte.',uncertainty:'Resultado não medido.',nextCheck:'Confrontar novas vendas.',citations:c.role==='ops'?b.evidenceSelection.campaignExamples.map(x=>x.citations[0]).slice(0,8):b.evidenceSelection.reflectionExamples.slice(0,1),peerChecks:r.peerConclusions.map(p=>({messageId:p.messageId,stance:'support',reason:'Aquisição e exposição conferidas.'}))},suggestions:c.role==='ops'&&!c.proposal?(typeof opsSuggestions==='function'?opsSuggestions(ops):opsSuggestions):[],question:null}};}};}
const s=(objectId,action,percent)=>({adAccountId:account,objectId,action,percent,reason:'Motivo concreto do teste.'});
const engineFor=(store,ai,ticket)=>createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{dispatch:async()=>{throw Error('No owner approval');}},ai,ops:{ticketFront:()=>ticket}});

test('The hold needs a known profit yesterday and less than one ticket spent today',()=>{
 const y={result:800,roi:2.1},w={spend:2000,frontOrders:10};
 const h=partialDayHold({yesterday:y,today:{spend:150},week:w},{ticketFront:300});
 assert.deepEqual(h,{version:1,yesterdayResult:800,yesterdayRoi:2.1,todaySpend:150,ticket:300,ticketSource:'project',spentTickets:0.5,coveredByYesterday:true,hold:true});
 assert.match(partialDayReason(h),/lucro de R\$800 e hoje gastou R\$150, 0\.5 ticket .*Segurar corte ou pausa até o gasto de hoje passar de 1 ticket ou do lucro de ontem/);
 assert.equal(partialDayHold({yesterday:y,today:{spend:300}},{ticketFront:300}).hold,false,'one full ticket: today is evidence again');
 // Owner decision of 08/11/2026: a thin profit that today's spend already passed does not cover today.
 const thin=partialDayHold({yesterday:{result:117},today:{spend:250}},{ticketFront:300});assert.equal(thin.spentTickets,0.83);assert.equal(thin.coveredByYesterday,false);assert.equal(thin.hold,false);
 assert.equal(partialDayHold({yesterday:{result:150},today:{spend:150}},{ticketFront:300}).hold,true,'spend equal to the profit is still covered');
 assert.equal(partialDayHold({yesterday:{result:-50},today:{spend:10}},{ticketFront:300}).hold,false,'loss yesterday');
 assert.equal(partialDayHold({yesterday:{result:0},today:{spend:10}},{ticketFront:300}).hold,false,'break-even is not profit');
 assert.equal(partialDayHold({yesterday:{result:null},today:{spend:10}},{ticketFront:300}).hold,false,'profit N/D never holds');
 assert.equal(partialDayHold({today:{spend:10}},{ticketFront:300}).hold,false,'no yesterday (first-day test)');
 // No project ticket: the campaign's own 7-day cost per front sale.
 const c=partialDayHold({yesterday:y,today:{spend:150},week:w});assert.equal(c.ticket,200);assert.equal(c.ticketSource,'cpa7d');assert.equal(c.spentTickets,0.75);assert.equal(c.hold,true);
 const nd=partialDayHold({yesterday:y,today:{spend:150},week:{spend:2000,frontOrders:0}});assert.equal(nd.ticket,null);assert.equal(nd.hold,false,'ticket N/D holds nothing');
 assert.equal(partialDayHold({yesterday:y,today:{spend:null}},{ticketFront:300}).hold,false,'today spend N/D');
});

test('Every analysed campaign carries partialDay in the model packet',()=>{
 const {state,round}=fixture();
 const c=cloudAnalysisContext(state,round,state.snapshots[0].rows.slice(0,1),'ops',Date.now(),{ticketFront:300});
 assert.deepEqual(c.campaigns[0].partialDay,{version:1,yesterdayResult:100,yesterdayRoi:2,todaySpend:100,ticket:300,ticketSource:'project',spentTickets:0.33,coveredByYesterday:true,hold:true});
 assert.equal(cloudAnalysisContext(state,round,state.snapshots[0].rows.slice(0,1),'ops').campaigns[0].partialDay.ticketSource,'cpa7d','without the private ticket');
});

test('Held campaigns lose only their cuts and pauses; increases and keeps pass, and a full ticket lifts the hold',async()=>{
 const run=async ticket=>{const {state,round}=fixture();const store=memory(state),engine=engineFor(store,model([s('405','pause',null),s('404','reduce',20),s('401','increase',20),s('402','keep',null)]),ticket);
  for(let i=0;i<4;i++)assert.equal((await engine.step()).kind,'stage');
  return {store,round,conclusion:store.state.collaborationMessages.find(m=>m.kind==='conclusion'&&m.fromAgent==='ops')};};
 const held=await run(300);
 assert.deepEqual(held.conclusion.suggestionDrops.map(d=>[d.objectId,d.action,d.reason]),[['405','pause','partial_day_after_profit'],['404','reduce','partial_day_after_profit']]);
 assert.deepEqual(held.store.state.proposals.map(p=>[p.payload.objectId,p.payload.action]),[['401','budget']]);
 assert.equal(held.store.state.executions.length,0);
 // R$100 spent today with a R$50 ticket: two tickets without a sale signal is evidence again.
 const open=await run(50);
 assert.equal(open.conclusion.suggestionDrops,undefined);
 assert.deepEqual(open.store.state.proposals.map(p=>p.payload.objectId).sort(),['401','404','405']);
});

test('Sombra: a day-2 test with a profitable closed yesterday and under one ticket today stays a suggestion',()=>{
 const at=Date.parse('2026-11-07T17:00:00Z'),base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
 const m=(spend,revenueNet=0,front=0,checkouts=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0});
 const row=(metrics)=>({id:'uuid-d1',externalId:'d1',adAccountId:'acc1',accountName:'Conta Fictícia',name:'06/11 - [CBO] - [TESTE] D1',level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',lifetimeBudget:null,...metrics});
 const cut=(period,from,rows)=>({...base,period,from,to:'2026-11-07T03:00:00.000Z',fetchedAt:new Date(at-600000).toISOString(),lastSyncAt:new Date(at-720000).toISOString(),rows});
 const y=row(m(400,900,3,6));// closed yesterday: R$500 profit
 const state={config:{p:{projectName:'Fictício'}},snapshots:[{...base,period:'today',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:new Date(at-300000).toISOString(),lastSyncAt:new Date(at-480000).toISOString(),rows:[row(m(115,0,0,0))]},
  cut('7d','2026-10-31T03:00:00.000Z',[y]),cut('3d','2026-11-04T03:00:00.000Z',[y]),cut('yesterday','2026-11-06T03:00:00.000Z',[y])]};
 const decide=ticketFront=>evaluateShadow(state,{project:'p',params:{pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront},now:at}).decisions.find(d=>d.rule==='test-no-sale');
 const held=decide(300);
 assert.ok(held,'the ceiling still records the pause');assert.equal(held.wouldExecute,false);
 assert.ok(held.blockedBy.some(b=>/Ontem fechou com lucro de R\$500 e hoje gastou R\$115, 0\.38 ticket/.test(b)));
 // R$115 against a R$100 ticket: more than one ticket without a sale, the owner's ceiling acts as before.
 const open=decide(100);assert.ok(open);assert.equal(open.blockedBy.some(b=>/Ontem fechou com lucro/.test(b)),false);assert.equal(open.wouldExecute,true);
});
