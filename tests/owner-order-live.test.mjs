import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {ensureCollaboration,approvedExecutionProposal} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution} from '../lib/execution.mjs';
import {companionCards} from '../lib/companion-cards.mjs';
import {liveOrderRow,liveOrderActions,liveOrderLimits} from '../lib/owner-order-live.mjs';

// Production Malva rows carry provider 'meta' (lowercase), which the dispatch fence requires.
// Synthetic fixture (tests/owner-applied.test.mjs) with real closed-window boundaries, as the executor's financial fence requires.
const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
function fixture(){
 const base={id:'22222222-2222-4222-8222-222222222222',externalId:'meta-campaign',adAccountId:'account',provider:'meta',name:'01/11 [CBO] [TESTE] Example',accountName:'USD account',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:2,impressions:1000,linkClicks:20,refundedRevenue:0};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:{today:'2026-11-02T03:00:00.000Z',yesterday:'2026-11-01T03:00:00.000Z','3d':'2026-10-30T03:00:00.000Z','7d':'2026-10-26T03:00:00.000Z'}[period],to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]})),paused:false};
 ensureCollaboration(state,job,now);return state;
}
const card=s=>buildDecisionCards(s,project,now)[0];
const today=s=>s.snapshots.find(x=>x.period==='today');
const observation=(s,at,change={})=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:date(at),rows:today(s).rows.map(r=>({...r,...change}))});
// At night the analysis is two hours old; the live reading of the campaign is two minutes old and the budget moved to 120.
const later=now+2*3600000;
const liveItems=(s,at=later-120000,change={dailyBudget:120})=>[{projectId:project,error:null,snapshot:{...today(s),fetchedAt:date(at),rows:today(s).rows.map(r=>({...r,...change}))}}];
const liveOf=(s,items)=>liveOrderRow(items,project,'account','meta-campaign',later);
const cardAt=(s,at)=>buildDecisionCards(s,project,at)[0];

test('live reading helpers: fresh, complete, single row; stale or failed readings give nothing', () => {
 const s=fixture();
 assert.equal(liveOf(s,liveItems(s)).row.dailyBudget,120);
 assert.equal(liveOrderRow(liveItems(s,later-liveOrderLimits.freshMs-1000),project,'account','meta-campaign',later),null);
 assert.equal(liveOrderRow([{...liveItems(s)[0],error:{code:'X'}}],project,'account','meta-campaign',later),null);
 assert.deepEqual(liveOrderActions(liveOf(s,liveItems(s)),{paused:true}),{increase:false,reduce:false,pause:false,keep:false});
 assert.deepEqual(liveOrderActions(liveOf(s,liveItems(s))),{increase:true,reduce:true,pause:true,keep:false});
});

test('with a stale analysis, an owner order uses the live value and runs through the executor once', () => {
 const s=fixture(),c=cardAt(s,later),args={project,cardId:c.id,signature:c.signature,choice:'reduce',percent:25,clientId:'live-1',ownerOrder:true};
 assert.equal(c.actionable.reduce,false,'the two-hour-old analysis alone blocks');
 assert.throws(()=>recordOwnerChoice(s,args,'mac-touchid:test',later),/não permitem/);
 const r=recordOwnerChoice(s,{...args,clientId:'live-2'},'mac-touchid:test',later,{live:liveOf(s,liveItems(s))});
 const p=s.proposals.find(x=>x.id===r.proposalId);
 assert.equal(r.status,'Autorizado');assert.deepEqual(p.payload.before,{dailyBudget:120});assert.deepEqual(p.payload.after,{dailyBudget:90});
 assert.equal(p.payload.liveTarget.dailyBudget,120);
 assert.doesNotThrow(()=>approvedExecutionProposal(s,{proposalId:p.id,version:p.version,signature:p.signature},later+1000),'the one-hour analysis age does not apply to a live owner order');
 const t=later+1000,e=claimExecution(s,{proposalId:p.id,version:p.version,signature:p.signature,clientId:'claim-l',executionRef:'cloud-test'},t),lease={id:e.id,claimId:e.claimId,executionRef:'cloud-test'};
 const prepared=prepareExecution(s,{...lease,clientId:'prep-l',observation:observation(s,t+500,{dailyBudget:120})},t+1000);
 assert.equal(prepared.command.arguments.dailyBudget,90);
 assert.equal(submitExecution(s,{...lease,clientId:'submit-l'},t+2000).dispatchGranted,true);
});

test('a live order is still refused at prepare when the current value moved again', () => {
 const s=fixture(),c=cardAt(s,later);
 const r=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:10,clientId:'live-3',ownerOrder:true},'mac-touchid:test',later,{live:liveOf(s,liveItems(s))});
 const p=s.proposals.find(x=>x.id===r.proposalId),t=later+1000,e=claimExecution(s,{proposalId:p.id,version:p.version,signature:p.signature,clientId:'claim-m',executionRef:'cloud-test'},t);
 assert.throws(()=>prepareExecution(s,{id:e.id,claimId:e.claimId,executionRef:'cloud-test',clientId:'prep-m',observation:observation(s,t+500,{dailyBudget:150})},t+1000),/mudou/);
});

test('team proposals keep the one-hour analysis rule', () => {
 const s=fixture(),c=cardAt(s,now);
 const r=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'plain',ownerOrder:true},'mac-touchid:test',now);
 const p=s.proposals.find(x=>x.id===r.proposalId);
 assert.equal(p.payload.liveTarget,undefined);
 assert.throws(()=>approvedExecutionProposal(s,{proposalId:p.id,version:p.version,signature:p.signature},now+59*60000+3600000),/vencida|expirada/);
});

test('the notch sees the live source and the order unblocked', () => {
 const s=fixture(),items=liveItems(s);
 const v=companionCards(s,{project,adAccountId:'account',objectId:'meta-campaign'},1,later,{liveItems:items}).cards[0];
 assert.equal(v.orderActions.reduce,true);assert.equal(v.orderSource.kind,'live');assert.equal(v.orderSource.dailyBudget,120);
 assert.ok(!v.orderBlockers.some(b=>/vencida/.test(b)));
 const without=companionCards(s,{project,adAccountId:'account',objectId:'meta-campaign'},1,later).cards[0];
 assert.equal(without.orderActions.reduce,false);assert.equal(without.orderSource.kind,'analysis');assert.ok(without.orderBlockers.some(b=>/vencida/.test(b)));
});

test('receipts follow the executor journal, and a stage change moves the pulse', async () => {
 const {ownerOrderReceipts}=await import('../lib/owner-orders.mjs');const {orderPulse}=await import('../lib/change-watch.mjs');const {confirmExecution}=await import('../lib/execution.mjs');
 const s=fixture(),c=cardAt(s,now);
 const r=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'reduce',percent:20,clientId:'rcpt',ownerOrder:true},'mac-touchid:test',now);
 const p=s.proposals.find(x=>x.id===r.proposalId);
 let list=ownerOrderReceipts(s,{now:now+500});assert.equal(list.length,1);assert.equal(list[0].stage,'queued');assert.equal(list[0].after.dailyBudget,80);
 const first=orderPulse({version:2},list,'',now);assert.equal(first.pulse.version,3);assert.equal(orderPulse(first.pulse,list,first.sig,now).pulse,null,'same stage: no new pulse');
 const t=now+1000,e=claimExecution(s,{proposalId:p.id,version:p.version,signature:p.signature,clientId:'claim-r',executionRef:'cloud-test'},t),lease={id:e.id,claimId:e.claimId,executionRef:'cloud-test'};
 assert.equal(ownerOrderReceipts(s,{now:t}).at(0).stage,'checking');
 prepareExecution(s,{...lease,clientId:'prep-r',observation:observation(s,t+500)},t+1000);submitExecution(s,{...lease,clientId:'sub-r'},t+2000);
 assert.equal(ownerOrderReceipts(s,{now:t+2100}).at(0).stage,'sent');
 confirmExecution(s,{id:e.id,executionRef:'cloud-verify',clientId:'conf-r',observation:observation(s,t+4000,{dailyBudget:80})},t+5000);
 list=ownerOrderReceipts(s,{now:t+5100});assert.equal(list[0].stage,'confirmed');assert.equal(list[0].label,'Confirmada na Meta');
 assert.equal(ownerOrderReceipts(s,{now:now+30*3600000}).length,0,'only the last day');
});
