import test from 'node:test';
import assert from 'node:assert/strict';
import {recordDirectOrder,directOrderView,directOrderBudget,pruneDirectOrders,directOrderLimits} from '../lib/owner-direct-order.mjs';
import {approvedExecutionProposal,isDirectOwnerOrder,proposalSeal} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution} from '../lib/execution.mjs';
import {authorizeCloudDispatch} from '../lib/cloud-dispatch-guard.mjs';
import {autonomousWorkPlan} from '../lib/autonomous-work.mjs';
import {companionCards} from '../lib/companion-cards.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import {ownerDeviceOps} from '../lib/owner-device.mjs';

// Synthetic data only. No analysis round, no snapshot: the direct order lives on the live Malva reading.
const now=Date.parse('2026-11-08T12:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
const owner='mac-touchid:0123456789abcdef';
const row=(change={})=>({id:'22222222-2222-4222-8222-222222222222',externalId:'120000000000000001',adAccountId:'33333333-3333-4333-8333-333333333333',provider:'meta',name:'08/11 - [CBO] - [TESTE] - Example',accountName:'USD account',budgetCurrency:'USD',budgetRate:5.5,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',accountStatus:{active:true},spend:20,...change});
const liveItems=(r=row(),at=now-60000)=>[{projectId:project,snapshot:{projectId:project,period:'today',level:'campaign',source:'Malva MCP',complete:true,fetchedAt:date(at),lastSyncAt:date(at-30000),rows:[r]}}];
const live=(r=row(),at=now-60000)=>({row:r,fetchedAt:date(at)});
const state=()=>({config:{[project]:{projectName:'Test',targetRoas:2}},paused:false,proposals:[],executions:[]});
const base=(change={})=>({op:'ownerDirectOrder',revision:1,clientId:'notch-direct-0001',project,adAccountId:row().adAccountId,objectId:row().externalId,action:'pause',expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'},...change});
const observation=(r,at)=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:date(at),rows:[r]});

test('the Mac may send a direct order; it is the only new op',()=>{
 assert.deepEqual([...ownerDeviceOps],['cardDecision','proposalReview','ownerDirectOrder']);
});

test('pause from the notch: approved exact proposal, no round, then claim → prepare → one dispatch → reread → confirmed',()=>{
 const s=state(),p=recordDirectOrder(s,base(),owner,{live:live(),now});
 assert.equal(p.status,'Aprovada');assert.equal(p.roundId,null);assert.equal(isDirectOwnerOrder(p),true);
 assert.deepEqual(p.payload.before,{status:'ACTIVE'});assert.deepEqual(p.payload.after,{status:'PAUSED'});
 assert.equal(p.signature,proposalSeal(p));assert.equal(p.approvedSignature,p.signature);
 assert.equal(approvedExecutionProposal(s,{proposalId:p.id,version:1,signature:p.signature},now+1000).id,p.id);
 const plan=autonomousWorkPlan(s,{},now+1000);
 assert.ok(plan.ready.some(w=>w.kind==='execution'&&w.proposalId===p.id),'the executor picks it up');
 const t=now+2000,e=claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'claim-1',executionRef:'cloudflare:test'},t);
 const lease={id:e.id,claimId:e.claimId,executionRef:'cloudflare:test'};
 const prepared=prepareExecution(s,{...lease,clientId:'prep-1',observation:observation(row(),t+500)},t+1000);
 assert.deepEqual(prepared.command,{tool:'tracking_set_ad_status',arguments:{objectId:row().id,projectId:project,status:'PAUSED'}});
 const sent=submitExecution(s,{...lease,clientId:'submit-1'},t+2000);assert.equal(sent.dispatchGranted,true);
 assert.equal(submitExecution(s,{...lease,clientId:'submit-1'},t+2500).dispatchGranted,false,'a repeat never dispatches again');
 assert.equal(authorizeCloudDispatch(s,{tool:'tracking_set_ad_status',args:prepared.command.arguments,execution:{id:e.id,submitClientId:'submit-1'}},t+3000).proposalId,p.id);
 assert.throws(()=>authorizeCloudDispatch(s,{tool:'tracking_set_ad_status',args:{...prepared.command.arguments,status:'ACTIVE'},execution:{id:e.id,submitClientId:'submit-1'}},t+3000),/MCP_COMMAND_MISMATCH/);
 confirmExecution(s,{id:e.id,executionRef:'cloudflare:verify',clientId:'confirm-1',observation:observation(row({status:'PAUSED'}),t+4000)},t+5000);
 assert.equal(s.executions[0].status,'Confirmada');
 const receipt=ownerOrderReceipts(s,{now:t+6000})[0];
 assert.equal(receipt.stage,'confirmed');assert.equal(receipt.source,'live');
});

test('increase and reduce use the live daily budget and the exact cents the notch showed',()=>{
 const s=state();
 const up=recordDirectOrder(s,base({clientId:'notch-direct-up01',action:'increase',percent:20,after:{dailyBudget:120}}),owner,{live:live(),now});
 assert.deepEqual([up.payload.before.dailyBudget,up.payload.after.dailyBudget,up.payload.action],[100,120,'budget']);
 const noisy=recordDirectOrder(state(),base({clientId:'notch-direct-up02',action:'reduce',percent:20,expected:{status:'ACTIVE',dailyBudget:95.10000000000001,currency:'USD'},after:{dailyBudget:76.08000000000001}}),owner,{live:live(row({dailyBudget:95.1})),now});
 assert.equal(noisy.payload.after.dailyBudget,76.08,'float noise from the Mac JSON is not a different cent');
 const s2=state();
 assert.throws(()=>recordDirectOrder(s2,base({clientId:'notch-direct-dn01',action:'reduce',percent:20,after:{dailyBudget:81}}),owner,{live:live(),now}),e=>e.code==='DIRECT_ORDER_CHANGED');
 const dn=recordDirectOrder(s2,base({clientId:'notch-direct-dn02',action:'reduce',percent:12.5,expected:{status:'ACTIVE',dailyBudget:95.1,currency:'USD'}}),owner,{live:live(row({dailyBudget:95.1})),now});
 assert.equal(dn.payload.after.dailyBudget,83.21);
 assert.equal(directOrderBudget(95.1,'reduce',20),76.08);
 assert.throws(()=>directOrderBudget(100,'reduce',100),/menor que 100%/);
 assert.throws(()=>directOrderBudget(100,'increase',1001),/até 1000%/);
 assert.throws(()=>directOrderBudget(1,'increase',0.1),/centavos/);
});

test('a value that changed since the notch opened is refused with the current value, never re-priced',()=>{
 const s=state();
 assert.throws(()=>recordDirectOrder(s,base({action:'increase',percent:10,expected:{status:'ACTIVE',dailyBudget:90,currency:'USD'}}),owner,{live:live(),now}),e=>e.code==='DIRECT_ORDER_CHANGED'&&e.detail.dailyBudget===100);
 assert.throws(()=>recordDirectOrder(s,base(),owner,{live:live(row({status:'PAUSED'})),now}),e=>e.code==='DIRECT_ORDER_CHANGED'||e.code==='DIRECT_ORDER_ACTION');
 assert.equal(s.proposals.length,0);
});

test('fences: Mac only, office pause, Meta only, warmup, activation never, no live reading, unknown project',()=>{
 assert.throws(()=>recordDirectOrder(state(),base(),'supabase-owner',{live:live(),now}),/só pelo Mac/);
 assert.throws(()=>recordDirectOrder({...state(),paused:true},base(),owner,{live:live(),now}),/pausado/);
 assert.throws(()=>recordDirectOrder(state(),base(),owner,{live:live(row({provider:'kwai'})),now}),/Meta/);
 assert.throws(()=>recordDirectOrder(state(),base(),owner,{live:live(row({name:'08/11 - [AQUECIMENTO] - Engajamento'})),now}),/aquecimento/);
 assert.throws(()=>recordDirectOrder(state(),base({action:'activate'}),owner,{live:live(),now}),/inválida/);
 assert.throws(()=>recordDirectOrder(state(),base(),owner,{live:null,now}),e=>e.code==='DIRECT_ORDER_NO_LIVE');
 assert.throws(()=>recordDirectOrder(state(),base({project:'44444444-4444-4444-8444-444444444444'}),owner,{live:live(),now}),/não configurado/);
 assert.throws(()=>recordDirectOrder(state(),base({action:'increase',percent:10}),owner,{live:live(row({accountStatus:{active:false}})),now}),/aptidão/);
 assert.throws(()=>recordDirectOrder(state(),base({action:'reduce',percent:10}),owner,{live:live(row({dailyBudget:null})),now}),/Orçamento diário/);
});

test('same clientId is one order; a second order while one is on its way is refused',()=>{
 const s=state(),a=recordDirectOrder(s,base(),owner,{live:live(),now});
 assert.equal(recordDirectOrder(s,base(),owner,{live:live(),now:now+1000}).id,a.id);
 assert.throws(()=>recordDirectOrder(s,base({clientId:'notch-direct-0002'}),owner,{live:live(),now:now+1000}),e=>e.code==='DIRECT_ORDER_PENDING');
 assert.equal(s.proposals.length,1);
});

test('the executor refuses when Malva shows another value at prepare, and an expired order never runs',()=>{
 const s=state(),p=recordDirectOrder(s,base({action:'reduce',percent:20}),owner,{live:live(),now});
 const e=claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'claim-d',executionRef:'cloudflare:test'},now+1000);
 assert.throws(()=>prepareExecution(s,{id:e.id,claimId:e.claimId,executionRef:'cloudflare:test',clientId:'prep-d',observation:observation(row({dailyBudget:150}),now+1500)},now+2000),/mudou/);
 const s2=state(),q=recordDirectOrder(s2,base(),owner,{live:live(),now});
 assert.throws(()=>approvedExecutionProposal(s2,{proposalId:q.id,version:1,signature:q.signature},now+directOrderLimits.validityMs+1),/expirada/);
 assert.ok(!autonomousWorkPlan(s2,{},now+directOrderLimits.validityMs+1).ready.some(w=>w.proposalId===q.id));
 const s3=state(),r=recordDirectOrder(s3,base(),owner,{live:live(),now});s3.paused=true;
 assert.throws(()=>approvedExecutionProposal(s3,{proposalId:r.id,version:1,signature:r.signature},now+1000),/pausado/);
 const s4=state(),t=recordDirectOrder(s4,base(),owner,{live:live(),now});t.payload.after.status='ACTIVE';
 assert.throws(()=>approvedExecutionProposal(s4,{proposalId:t.id,version:1,signature:t.signature},now+1000),/Conteúdo da proposta mudou/);
});

test('the notch view: works without any analysis card, shows why it cannot run',()=>{
 const s=state();
 const cards=companionCards(s,{project,adAccountId:row().adAccountId,objectId:row().externalId},7,now,{liveItems:liveItems()});
 assert.equal(cards.cards.length,0);
 assert.equal(cards.directOrder.available,true);
 assert.deepEqual(cards.directOrder.actions,{increase:true,reduce:true,pause:true,keep:false});
 assert.deepEqual(cards.directOrder.source,{kind:'live',at:date(now-60000),status:'ACTIVE',dailyBudget:100,currency:'USD'});
 const stale=companionCards(s,{project,adAccountId:row().adAccountId,objectId:row().externalId},7,now,{liveItems:liveItems(row(),now-11*60000)});
 assert.equal(stale.directOrder.available,false);assert.match(stale.directOrder.blockers[0],/10 minutos/);
 const paused=companionCards({...s,paused:true},{project,adAccountId:row().adAccountId,objectId:row().externalId},7,now,{liveItems:liveItems()});
 assert.equal(paused.directOrder.actions.pause,false);
 assert.equal(companionCards(s,{project},7,now,{liveItems:liveItems()}).directOrder,null,'only for one campaign');
 recordDirectOrder(s,base(),owner,{live:live(),now});
 const busy=companionCards(s,{project,adAccountId:row().adAccountId,objectId:row().externalId},7,now+1000,{liveItems:liveItems()});
 assert.equal(busy.directOrder.available,false);assert.match(busy.directOrder.blockers.join(' '),/a caminho/);
});

test('old finished direct orders leave the central after a week; unconfirmed dispatches stay',()=>{
 const s=state(),a=recordDirectOrder(s,base(),owner,{live:live(),now}),b=recordDirectOrder(s,base({clientId:'notch-direct-0003',objectId:'120000000000000002'}),owner,{live:live(row({externalId:'120000000000000002'})),now});
 s.executions.push({proposalId:b.id,status:'Verificação necessária'});
 pruneDirectOrders(s,now+directOrderLimits.keepMs+1);
 assert.deepEqual(s.proposals.map(p=>p.id),[b.id]);
 assert.ok(a.id);
});

// Owner decision of 09/11/2026 ("Yes, check the cap"): hand-typed increases are held to the owner's daily-budget ceiling.
test('a direct increase past the owner ceiling is refused with the largest allowed percent; reduce and pause are not limited',()=>{
 const policy={projects:{[project]:{budgetCap:150}}};
 const up=(pct,next,extra={})=>base({clientId:'notch-cap-'+pct,action:'increase',percent:pct,after:{dailyBudget:next},...extra});
 const s=state();
 assert.throws(()=>recordDirectOrder(s,up(60,160),owner,{live:live(),now,policy}),e=>e.code==='DIRECT_ORDER_CAP'&&/teto de orçamento diário/.test(e.message)&&/Aumento máximo agora: 50%/.test(e.message)&&e.detail.cap===150&&e.detail.maxIncreasePercent===50);
 assert.equal(s.proposals.length,0,'nothing recorded');
 assert.equal(recordDirectOrder(s,up(50,150),owner,{live:live(),now,policy}).payload.after.dailyBudget,150,'exactly at the ceiling is allowed');
 assert.equal(recordDirectOrder(state(),base({clientId:'notch-cap-r',action:'reduce',percent:20,after:{dailyBudget:80}}),owner,{live:live(row({dailyBudget:100})),now,policy:{projects:{[project]:{budgetCap:50}}}}).payload.after.dailyBudget,80,'a reduce is never limited');
 assert.equal(recordDirectOrder(state(),base({clientId:'notch-cap-p'}),owner,{live:live(),now,policy:{projects:{[project]:{budgetCap:50}}}}).payload.after.status,'PAUSED');
 assert.equal(recordDirectOrder(state(),up(60,160),owner,{live:live(),now}).payload.after.dailyBudget,160,'no ceiling configured: no limit, as before');
});

test('the account ceiling wins over the project one; at the ceiling the notch view turns increase off and shows it',()=>{
 const policy={projects:{[project]:{budgetCap:1000,budgetCaps:{[row().adAccountId]:120}}}};
 assert.throws(()=>recordDirectOrder(state(),base({clientId:'notch-cap-a',action:'increase',percent:30,after:{dailyBudget:130}}),owner,{live:live(),now,policy}),e=>e.code==='DIRECT_ORDER_CAP'&&/máximo agora: 20%/.test(e.message));
 const v=directOrderView(state(),{project,adAccountId:row().adAccountId,objectId:row().externalId},liveItems(),now,policy);
 assert.deepEqual(v.budgetCap,{dailyBudget:120,currency:'USD',maxIncreasePercent:20});assert.equal(v.actions.increase,true);
 const at=directOrderView(state(),{project,adAccountId:row().adAccountId,objectId:row().externalId},liveItems(row({dailyBudget:120})),now,policy);
 assert.equal(at.actions.increase,false);assert.equal(at.actions.reduce,true);assert.equal(at.budgetCap.maxIncreasePercent,0);
 assert.throws(()=>recordDirectOrder(state(),base({clientId:'notch-cap-b',action:'increase',percent:10,expected:{status:'ACTIVE',dailyBudget:120,currency:'USD'},after:{dailyBudget:132}}),owner,{live:live(row({dailyBudget:120})),now,policy}),/já está no teto: só reduzir ou pausar/);
 assert.equal(directOrderView(state(),{project,adAccountId:row().adAccountId,objectId:row().externalId},liveItems(),now).budgetCap,null,'no policy: no ceiling shown');
 const cards=companionCards(state(),{project,adAccountId:row().adAccountId,objectId:row().externalId},1,now,{liveItems:liveItems(),policy});
 assert.equal(cards.directOrder.budgetCap.dailyBudget,120);
});

test('a resend of an order recorded before the ceiling changed gets its receipt back, never a new check',()=>{
 const s=state(),input=base({clientId:'notch-cap-replay',action:'increase',percent:60,after:{dailyBudget:160}});
 const p=recordDirectOrder(s,input,owner,{live:live(),now});
 assert.equal(recordDirectOrder(s,input,owner,{live:null,now,policy:{projects:{[project]:{budgetCap:120}}}}).id,p.id);
});
