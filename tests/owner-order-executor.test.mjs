import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution} from '../lib/execution.mjs';
import {authorizeCloudDispatch} from '../lib/cloud-dispatch-guard.mjs';
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
test('an owner order runs the whole executor path once: claim, current-value check, single dispatch, Malva fence',()=>{
 const s=fixture(),c=card(s);
 const r=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'reduce',percent:20,clientId:'order-e2e',ownerOrder:true},'mac-touchid:test',now);
 const p=s.proposals.find(x=>x.id===r.proposalId),t=now+1000;
 const e=claimExecution(s,{proposalId:p.id,version:p.version,signature:p.signature,clientId:'claim-1',executionRef:'cloud-test'},t);
 const lease={id:e.id,claimId:e.claimId,executionRef:'cloud-test'};
 const prepared=prepareExecution(s,{...lease,clientId:'prep-1',observation:observation(s,t+500)},t+1000);
 assert.deepEqual(prepared.command,{tool:'tracking_set_ad_budget',arguments:{objectId:today(s).rows[0].id,projectId:project,dailyBudget:80}});
 const sent=submitExecution(s,{...lease,clientId:'submit-1'},t+2000);assert.equal(sent.dispatchGranted,true);
 assert.equal(submitExecution(s,{...lease,clientId:'submit-1'},t+2500).dispatchGranted,false,'a repeat never dispatches again');
 const fence=authorizeCloudDispatch(s,{tool:'tracking_set_ad_budget',args:prepared.command.arguments,execution:{id:e.id,submitClientId:'submit-1'}},t+3000);
 assert.equal(fence.proposalId,p.id);
 assert.throws(()=>authorizeCloudDispatch(s,{tool:'tracking_set_ad_budget',args:{...prepared.command.arguments,dailyBudget:800},execution:{id:e.id,submitClientId:'submit-1'}},t+3000),/MCP_COMMAND_MISMATCH/);
});
test('an owner order is refused before dispatch when the current budget already changed',()=>{
 const s=fixture(),c=card(s);
 const r=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:10,clientId:'order-drift',ownerOrder:true},'mac-touchid:test',now);
 const p=s.proposals.find(x=>x.id===r.proposalId),t=now+1000;
 const e=claimExecution(s,{proposalId:p.id,version:p.version,signature:p.signature,clientId:'claim-d',executionRef:'cloud-test'},t);
 assert.throws(()=>prepareExecution(s,{id:e.id,claimId:e.claimId,executionRef:'cloud-test',clientId:'prep-d',observation:observation(s,t+500,{dailyBudget:150})},t+1000),/mudou/);
});
test('the web session cannot give a direct order',()=>{
 const s=fixture(),c=card(s);
 assert.throws(()=>recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'order-web',ownerOrder:true},'supabase-owner-id',now),/só pelo Mac/);
});
