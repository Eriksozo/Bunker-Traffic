import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAutonomyConfig,setAutonomyConfig,killAutonomy,autonomyGrant,recordAutonomyOrder,isAutonomyOrder,effectiveMode,decisionAction,autonomyView,mergeAutonomyLog,autonomyLogEntry,campaignKey} from '../lib/autonomy-grant.mjs';
import {approvedExecutionProposal,proposalSeal} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution} from '../lib/execution.mjs';
import {authorizeCloudDispatch} from '../lib/cloud-dispatch-guard.mjs';
import {autonomousWorkPlan} from '../lib/autonomous-work.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import {recordDirectOrder} from '../lib/owner-direct-order.mjs';
import {authorizeCloudDispatch as edgeDispatch} from '../supabase/functions/malva-mcp/cloud-dispatch-guard.mjs';
import {orderAlertTitle,phoneAlerts} from '../lib/phone-alerts.mjs';

// Synthetic data only: no real project, account or campaign. Nothing here calls a provider.
const now=Date.parse('2026-11-09T15:00:00Z'),date=n=>new Date(n).toISOString();
const project='11111111-1111-4111-8111-111111111111',other='55555555-5555-4555-8555-555555555555';
const acct='33333333-3333-4333-8333-333333333333',obj='120000000000000001';
const row=(change={})=>({id:'22222222-2222-4222-8222-222222222222',externalId:obj,adAccountId:acct,provider:'meta',name:'09/11 - [CBO] - [TESTE] - Example',accountName:'BRL account',budgetCurrency:'BRL',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',accountStatus:{active:true},...change});
const live=(r=row(),at=now-60000)=>({row:r,fetchedAt:date(at)});
const observation=(r,at)=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:date(at),rows:[r]});
const base=()=>({config:{[project]:{projectName:'Test'},[other]:{projectName:'Other'}},paused:false,proposals:[],executions:[],events:[]});
const allow=(change={})=>({enabled:true,projects:{[project]:{mode:'auto',actions:{pause:true,reduce:true,increase:true,activate:false},limits:{maxIncreasePct:50,maxReducePct:30,budgetCap:500,ordersPerDay:2},campaigns:{},...change}}});
const withConfig=(cfg=allow())=>{const s=base();setAutonomyConfig(s,cfg,'web:owner',now-3600000);return s;};
const pause=(change={})=>({id:'["2026-11-09","test-no-sale","p","a","o","status"]',rule:'test-no-sale',ruleLabel:'Pausar campanha nova sem venda',project,projectName:'Test',adAccountId:acct,objectId:obj,name:row().name,action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'Sem venda.',blockedBy:[],wouldExecute:true,...change});
const increase=(change={})=>pause({id:'inc-1',rule:'morning-increase',action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:130,currency:'BRL'},...change});
const reduce=(change={})=>pause({id:'red-1',rule:'bad-day-reduce',action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:80,currency:'BRL'},...change});

test('config: owner only, configured projects only, modes and limits validated; off by default',()=>{
 assert.throws(()=>normalizeAutonomyConfig({enabled:true,projects:{'99999999-9999-4999-8999-999999999999':{mode:'auto'}}},[project]),/não configurado/);
 assert.throws(()=>normalizeAutonomyConfig({enabled:'yes',projects:{}},[project]),/Interruptor/);
 assert.throws(()=>normalizeAutonomyConfig({enabled:true,projects:{[project]:{mode:'turbo'}}},[project]),/Nível/);
 assert.throws(()=>normalizeAutonomyConfig({enabled:true,projects:{[project]:{mode:'auto',limits:{maxReducePct:100}}}},[project]),/Redução/);
 assert.throws(()=>normalizeAutonomyConfig({enabled:true,projects:{[project]:{mode:'auto',limits:{maxIncreasePct:1001}}}},[project]),/Aumento/);
 assert.throws(()=>setAutonomyConfig(base(),allow(),''),/dono/);
 const view=autonomyView(base());
 assert.equal(view.enabled,false);
 assert.deepEqual(view.projects.map(p=>p.mode),['shadow','shadow'],'a project never configured stays Sombra');
 assert.equal(effectiveMode(undefined,project,acct,obj),'shadow');
});

test('grant: shadow and off never act; general switch off holds everything; confirm only asks',()=>{
 assert.equal(autonomyGrant(base(),pause(),{now}).act,'none');
 assert.equal(autonomyGrant(withConfig(allow({mode:'shadow'})),pause(),{now}).act,'none');
 const off=autonomyGrant(withConfig(allow({mode:'off'})),pause(),{now});assert.equal(off.act,'none');assert.match(off.blockers[0],/Desligado/);
 const switchOff=autonomyGrant(withConfig({...allow(),enabled:false}),pause(),{now});assert.equal(switchOff.act,'none');assert.ok(switchOff.blockers.some(b=>/interruptor geral/.test(b)));
 assert.equal(autonomyGrant(withConfig(allow({mode:'confirm'})),pause(),{now}).act,'confirm');
 assert.equal(autonomyGrant(withConfig(),pause(),{now}).act,'auto');
});

test('grant: Sombra must execute now; actions, percents and the ceiling come from the owner',()=>{
 const s=withConfig();
 assert.equal(autonomyGrant(s,pause({wouldExecute:false}),{now}).act,'none');
 assert.equal(autonomyGrant(s,pause({blockedBy:['Edição de gestor há menos de 2h']}),{now}).act,'none');
 assert.equal(autonomyGrant(s,pause({alertOnly:true}),{now}).act,'none');
 assert.equal(autonomyGrant(s,increase(),{now}).act,'auto');
 assert.match(autonomyGrant(s,increase({after:{dailyBudget:160,currency:'BRL'}}),{now}).blockers.join(' '),/acima do máximo de 50%/);
 assert.match(autonomyGrant(withConfig(allow({limits:{maxIncreasePct:100,budgetCap:120}})),increase(),{now}).blockers.join(' '),/teto/);
 assert.match(autonomyGrant(withConfig(allow({limits:{maxIncreasePct:100}})),increase(),{now}).blockers.join(' '),/Teto de orçamento diário não definido/);
 assert.match(autonomyGrant(withConfig(allow({limits:{}})),reduce(),{now}).blockers.join(' '),/Redução máxima/);
 assert.match(autonomyGrant(withConfig(allow({actions:{pause:false,reduce:true,increase:true,activate:false}})),pause(),{now}).blockers.join(' '),/Pausar não permitido/);
 assert.match(autonomyGrant(withConfig(allow({actions:{pause:true,reduce:true,increase:true,activate:true}})),pause({after:{status:'ACTIVE'},before:{status:'PAUSED'}}),{now}).blockers.join(' '),/Reativação ainda sem regra/);
 assert.deepEqual(decisionAction(reduce()),{action:'reduce',percent:20});
});

test('campaign exceptions override the project mode both ways',()=>{
 const key=campaignKey(acct,obj);
 assert.equal(autonomyGrant(withConfig(allow({campaigns:{[key]:{mode:'off',name:'X'}}})),pause(),{now}).act,'none');
 assert.equal(autonomyGrant(withConfig(allow({mode:'shadow',campaigns:{[key]:{mode:'auto'}}})),pause(),{now}).act,'auto');
 assert.equal(autonomyGrant(withConfig(allow({campaigns:{[key]:{mode:'confirm'}}})),pause(),{now}).act,'confirm');
});

test('auto: the order is an approved exact proposal on the live Malva value, sent once and confirmed',()=>{
 const s=withConfig(),out=recordAutonomyOrder(s,pause(),{live:live(),now});
 const p=out.proposal;assert.ok(p,JSON.stringify(out));
 assert.equal(isAutonomyOrder(p),true);assert.equal(p.status,'Aprovada');assert.equal(p.createdBy,'bunk');assert.equal(p.ownerOrder,false);
 assert.equal(p.signature,proposalSeal(p));assert.deepEqual(p.payload.after,{status:'PAUSED'});
 assert.equal(approvedExecutionProposal(s,{proposalId:p.id,version:1,signature:p.signature},now+1000).id,p.id);
 assert.ok(autonomousWorkPlan(s,{},now+1000).ready.some(w=>w.kind==='execution'&&w.proposalId===p.id),'the executor picks it up');
 const t=now+2000,e=claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'claim-a',executionRef:'cloudflare:test'},t),lease={id:e.id,claimId:e.claimId,executionRef:'cloudflare:test'};
 const prepared=prepareExecution(s,{...lease,clientId:'prep-a',observation:observation(row(),t+500)},t+1000);
 assert.deepEqual(prepared.command,{tool:'tracking_set_ad_status',arguments:{objectId:row().id,projectId:project,status:'PAUSED'}});
 assert.equal(submitExecution(s,{...lease,clientId:'submit-a'},t+2000).dispatchGranted,true);
 assert.equal(submitExecution(s,{...lease,clientId:'submit-a'},t+2500).dispatchGranted,false,'never twice');
 assert.equal(authorizeCloudDispatch(s,{tool:'tracking_set_ad_status',args:prepared.command.arguments,execution:{id:e.id,submitClientId:'submit-a'}},t+3000).proposalId,p.id);
 confirmExecution(s,{id:e.id,executionRef:'cloudflare:verify',clientId:'confirm-a',observation:observation(row({status:'PAUSED'}),t+4000)},t+5000);
 assert.equal(s.executions[0].status,'Confirmada');
 const r=ownerOrderReceipts(s,{now:t+6000})[0];assert.equal(r.by,'bunk');assert.equal(r.stage,'confirmed');
});

test('auto budget: exact cents from the decision, same value on Malva required',()=>{
 const s=withConfig(),p=recordAutonomyOrder(s,increase(),{live:live(),now}).proposal;
 assert.deepEqual([p.payload.action,p.payload.before.dailyBudget,p.payload.after.dailyBudget,p.payload.currency],['budget',100,130,'BRL']);
 const moved=recordAutonomyOrder(withConfig(),increase(),{live:live(row({dailyBudget:110})),now});
 assert.match(moved.blocked.join(' '),/não confere/);
 assert.match(recordAutonomyOrder(withConfig(),pause(),{live:null,now}).blocked.join(' '),/Sem leitura ao vivo/);
 assert.match(recordAutonomyOrder(withConfig(),pause(),{live:live(row({name:'[AQUECIMENTO] Engajamento'})),now}).blocked.join(' '),/Aquecimento/);
 assert.match(recordAutonomyOrder(withConfig(allow({mode:'confirm'})),pause(),{live:live(),now}).blocked.join(' '),/Automático/);
});

test('switch off, a permission change or a campaign moved out of auto voids an order not yet sent',()=>{
 for(const change of [
  s=>killAutonomy(s,'mac-touchid:owner',now+500),
  s=>setAutonomyConfig(s,allow({limits:{maxIncreasePct:20,maxReducePct:30,budgetCap:500,ordersPerDay:2}}),'web:owner',now+500),
  s=>setAutonomyConfig(s,allow({campaigns:{[campaignKey(acct,obj)]:{mode:'confirm'}}}),'web:owner',now+500),
 ]){
  const s=withConfig(),p=recordAutonomyOrder(s,pause(),{live:live(),now}).proposal;
  change(s);
  assert.throws(()=>approvedExecutionProposal(s,{proposalId:p.id,version:1,signature:p.signature},now+1000),/Autonomia desligada|mudaram|Automático/);
  assert.ok(!autonomousWorkPlan(s,{},now+1000).ready.some(w=>w.kind==='execution'&&w.proposalId===p.id));
 }
 // After dispatch, a switch off never blocks the reread: confirmation outlives the authorization.
 const s=withConfig(),p=recordAutonomyOrder(s,pause(),{live:live(),now}).proposal,t=now+2000;
 const e=claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'c',executionRef:'cf'},t),lease={id:e.id,claimId:e.claimId,executionRef:'cf'};
 prepareExecution(s,{...lease,clientId:'p',observation:observation(row(),t+500)},t+1000);submitExecution(s,{...lease,clientId:'s'},t+2000);
 killAutonomy(s,'web:owner',t+2500);
 confirmExecution(s,{id:e.id,executionRef:'cf:v',clientId:'v',observation:observation(row({status:'PAUSED'}),t+3000)},t+4000);
 assert.equal(s.executions[0].status,'Confirmada');
});

test('one order per decision, daily limit and 1h cooldown per campaign; owner and Bunk never collide',()=>{
 const s=withConfig(allow({limits:{maxIncreasePct:50,maxReducePct:30,budgetCap:500,ordersPerDay:1}}));
 const p=recordAutonomyOrder(s,pause(),{live:live(),now}).proposal;assert.ok(p);
 assert.match(recordAutonomyOrder(s,pause(),{live:live(),now:now+1000}).blocked.join(' '),/já virou ordem|a caminho/);
 p.appliedAt=date(now+2000);   // pretend it was applied
 const g=autonomyGrant(s,reduce(),{now:now+3000});assert.match(g.blockers.join(' '),/Limite de 1 ordem/);assert.match(g.blockers.join(' '),/menos de 1h/);
 // A pending Bunk order blocks a hand-typed owner order on the same campaign (same collision rule).
 const s2=withConfig();recordAutonomyOrder(s2,pause(),{live:live(),now});
 assert.throws(()=>recordDirectOrder(s2,{op:'ownerDirectOrder',clientId:'notch-x',project,adAccountId:acct,objectId:obj,action:'pause',expected:{status:'ACTIVE',dailyBudget:100,currency:'BRL'}},'mac-touchid:owner',{live:live(),now:now+1000}),/a caminho/);
});

test('owner events and log: kill keeps permissions; the log does not repeat the same hold',()=>{
 const s=withConfig();killAutonomy(s,'web:owner',now);
 assert.equal(s.autonomy.enabled,false);assert.equal(s.autonomy.projects[project].mode,'auto','permissions kept');
 assert.match(s.events[0].text,/desligada/);
 const g=autonomyGrant(s,pause(),{now}),e=autonomyLogEntry(pause(),g,{kind:'blocked',blockers:g.blockers},now);
 assert.equal(mergeAutonomyLog(mergeAutonomyLog([],[e]),[{...e,at:date(now+60000)}]).length,1);
});

test('dispatch fence (Worker and Edge Function copies): a Bunk order needs the general switch still on',()=>{
 for(const guard of [authorizeCloudDispatch,edgeDispatch]){
  const s=withConfig(),p=recordAutonomyOrder(s,pause(),{live:live(),now}).proposal,t=now+2000;
  const e=claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'c',executionRef:'cf'},t),lease={id:e.id,claimId:e.claimId,executionRef:'cf'};
  const prepared=prepareExecution(s,{...lease,clientId:'p',observation:observation(row(),t+500)},t+1000);submitExecution(s,{...lease,clientId:'s'},t+2000);
  const input={tool:'tracking_set_ad_status',args:prepared.command.arguments,execution:{id:e.id,submitClientId:'s'}};
  assert.equal(guard(s,input,t+3000).proposalId,p.id);
  killAutonomy(s,'web:owner',t+2500);
  assert.throws(()=>guard(s,input,t+3000),/MCP_APPROVAL_REQUIRED/,'switched off between submit and dispatch: nothing is sent');
 }
});

test('phone and notch alerts say when the order is the Bunk',()=>{
 assert.equal(orderAlertTitle({stage:'confirmed'}),'Ordem confirmada na Meta');
 assert.equal(orderAlertTitle({stage:'confirmed',by:'bunk'}),'Bunk (autonomia): ordem confirmada na Meta');
 assert.equal(orderAlertTitle({stage:'verify',by:'bunk'}),'Bunk (autonomia): ordem enviada: conferir na Meta');
 const out=phoneAlerts({orders:[{id:'x',stage:'failed',by:'bunk',campaign:'Exemplo',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'}}]},{primed:true,seen:{}},{now});
 assert.equal(out.fresh[0].title,'Bunk (autonomia): ordem não enviada');
});
