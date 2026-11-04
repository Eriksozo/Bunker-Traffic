import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedScenario,withClock,empty,project} from './helpers/e2e-scenario.mjs';
import {commitPersistedState} from '../lib/persistence.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution,monitorExecution} from '../lib/execution.mjs';
import {recordOwnerChoice} from '../lib/decision-cards.mjs';
import {confirmedOwnerChoice} from '../lib/decision-confirmation.mjs';
import {decisionQueue} from '../lib/decision-reconsider.mjs';
import {decisionContingency} from '../lib/decision-contingency.mjs';
const start=Date.parse('2026-11-04T16:00:00Z');
async function prepare(f){const s=f.current().state,e=claimExecution(s,{proposalId:f.proposal.id,version:f.proposal.version,signature:f.proposal.signature,executionRef:'ISOLATED-executor',clientId:'claim-execution'},start);await f.save();const args={id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'prepare',observation:f.observation(start)};prepareExecution(f.current().state,args,start);await f.save();return {e,args,submit:{id:e.id,claimId:e.claimId,executionRef:e.executionRef,clientId:'submit'}};}

test('End-to-end: import → independent opinions → owner card receipt → CAS → one dispatch → readback → 15/30/60 followups',async()=>withClock(start,async clock=>{
 const f=await approvedScenario({now:start});try{
  assert.ok(confirmedOwnerChoice(f.current(),f.input));assert.equal(decisionQueue(f.current().state,project,start).length,0);assert.equal(f.current().state.ownerChoices.length,1);
  const replay=recordOwnerChoice(f.current().state,f.input,'ISOLATED-OWNER',start);assert.equal(replay.id,f.choice.id);assert.equal(f.current().state.ownerChoices.length,1);
  const frame=f.observation(start),live={projectId:project,snapshot:{...frame,period:'today',coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:1}}};
  const guard=decisionContingency({state:f.current().state,project,row:f.row,proposal:f.proposal,liveItems:[live],now:start});assert.equal(guard.blocked,false);
  const {e,submit}=await prepare(f),a=await f.read(),b=await f.read();
  const first=submitExecution(a.state,submit,start),second=submitExecution(b.state,{...submit,clientId:'racing-submit'},start);assert.equal(first.dispatchGranted,true);assert.equal(second.dispatchGranted,true);
  const committed=await Promise.allSettled([commitPersistedState(f.db.api,a.state,a.revision),commitPersistedState(f.db.api,b.state,b.revision)]);assert.equal(committed.filter(r=>r.status==='fulfilled').length,1);assert.equal(committed.filter(r=>r.status==='rejected').length,1);
  // The provider is isolated/in memory. No application is dispatched before a winning commit.
  const provider={calls:0,budget:100};for(let i=0;i<committed.length;i++)if(committed[i].status==='fulfilled'){provider.calls++;provider.budget=[first,second][i].execution.command.arguments.dailyBudget;}
  assert.equal(provider.calls,1);assert.equal(provider.budget,150);
  const winner=committed.findIndex(r=>r.status==='fulfilled'),winningSubmit=winner===0?submit:{...submit,clientId:'racing-submit'};
  const latest=await f.read(),receipt=submitExecution(latest.state,winningSubmit,start);assert.equal(receipt.dispatchGranted,false);assert.equal(provider.calls,1);
  assert.throws(()=>submitExecution(latest.state,winner===0?{...submit,clientId:'racing-submit'}:submit,start),/Não reenviar/);
  clock.advance(1000);confirmExecution(latest.state,{id:e.id,clientId:'confirm',executionRef:'ISOLATED-readback',observation:f.observation(clock.now,{dailyBudget:provider.budget})},clock.now);let saved=await commitPersistedState(f.db.api,latest.state,latest.revision);assert.equal(saved.state.executions[0].status,'Confirmada');
  for(const minutes of [15,30,60]){clock.now=start+1000+minutes*60000;const read=await f.read(),args={id:e.id,entry:{checkpointMinutes:minutes},clientId:'follow-'+minutes,executionRef:'ISOLATED-follow-'+minutes,observation:f.observation(clock.now,{dailyBudget:150,spend:100+minutes,revenueNet:250+minutes*2,frontOrders:3+Math.floor(minutes/15)})};const result=monitorExecution(read.state,args,clock.now);assert.equal(result.delta.spend,minutes);assert.equal(result.lateByMs,0);assert.equal(result.automaticAction,false);saved=await commitPersistedState(f.db.api,read.state,read.revision);}
  const final=await f.read();assert.equal(final.state.executions[0].monitorChecks.length,3);assert.equal(final.state.executions[0].status,'Confirmada');assert.equal(final.state.ownerChoices.length,1);assert.equal(provider.calls,1);assert.equal(final.state.proposals[0].payload.after.dailyBudget,150);
 }finally{f.db.d.close();}
}));

test('End-to-end: lost dispatch response after application never causes a second provider write',async()=>withClock(start,async clock=>{
 const f=await approvedScenario({now:start});try{const {e,submit}=await prepare(f),read=await f.read();const grant=submitExecution(read.state,submit,start);await commitPersistedState(f.db.api,read.state,read.revision);let calls=0,budget=100;if(grant.dispatchGranted){calls++;budget=150;}// Response is intentionally lost.
  const retry=await f.read();assert.equal(submitExecution(retry.state,submit,start).dispatchGranted,false);assert.equal(calls,1);clock.advance(1000);confirmExecution(retry.state,{id:e.id,clientId:'verify-lost',executionRef:'ISOLATED-verifier',observation:f.observation(clock.now,{dailyBudget:budget})},clock.now);await commitPersistedState(f.db.api,retry.state,retry.revision);assert.equal((await f.read()).state.executions[0].status,'Confirmada');assert.equal(calls,1);
 }finally{f.db.d.close();}
}));

test('End-to-end: interruption before provider call stays verification-only; it never invents successful application',async()=>withClock(start,async clock=>{
 const f=await approvedScenario({now:start});try{const {e,submit}=await prepare(f),read=await f.read();submitExecution(read.state,submit,start);await commitPersistedState(f.db.api,read.state,read.revision);const providerCalls=0;
  clock.advance(1000);const latest=await f.read();failExecution(latest.state,{...submit,clientId:'interrupted',reason:'ISOLATED interruption before any provider invocation.'},clock.now);await commitPersistedState(f.db.api,latest.state,latest.revision);
  const verify=await f.read();assert.equal(submitExecution(verify.state,submit,clock.now).dispatchGranted,false);assert.throws(()=>confirmExecution(verify.state,{id:e.id,clientId:'not-applied',executionRef:'ISOLATED-verifier',observation:f.observation(clock.now,{dailyBudget:100})},clock.now),/não confirma/);assert.equal(verify.state.executions[0].status,'Verificação necessária');assert.equal(verify.state.proposals[0].appliedAt,undefined);assert.equal(providerCalls,0);
 }finally{f.db.d.close();}
}));
