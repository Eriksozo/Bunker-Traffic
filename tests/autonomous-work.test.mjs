import test from 'node:test';
import assert from 'node:assert/strict';
import {autonomousWorkPlan,autonomousSourceAgeMs} from '../lib/autonomous-work.mjs';
const now=Date.parse('2026-11-03T15:30:00Z');
const at=delta=>new Date(now+delta).toISOString();
const state=()=>({config:{p:{projectName:'John'}},collaborationRounds:[{id:'round',project:'p'}],messages:[],proposals:[]});
const round=()=>({roundId:'round',project:'p',sourceCut:['7d','3d','yesterday','today'].map(period=>({period,level:'campaign',fetchedAt:at(-1000)})),stages:[{agentId:'traffic',status:'Pendente'}],nextAgent:'traffic',discussionPending:[],discussionClaims:{}});
const base=r=>({due:[{project:'p'}],execution:{executions:[]},collaboration:{rounds:[r],proposals:[]}});
test('Actual pending discussion precedes independent review, next stage and a fresh collection',()=>{
 const s=state(),r=round(),b=base(r);r.discussionPending=[{id:'question',fromAgent:'creative',toAgent:'traffic'}];
 b.collaboration.proposals=[{id:'proposal',roundId:'round',project:'p',status:'Em revisão',expiresAt:at(10000),reviewAgents:['budget']}];
 s.messages=[{id:'owner-question',project:'p',status:'Pendente',agentId:'creative'}];
 const before=JSON.stringify(s),p=autonomousWorkPlan(s,b,now);
 assert.deepEqual(p.ready.map(w=>w.kind),['ownerQuestion','discussion','review','stage','collection']);
 assert.equal(p.ready[1].replyTo,'question');assert.equal(p.ready[1].agentId,'traffic');assert.equal(JSON.stringify(s),before);
 assert.equal(p.ready.some(w=>w.kind==='execute'||w.dispatchGranted),false);
});
test('Live claims are not offered to another worker; an expired claim can be resumed',()=>{
 const r=round();r.stages=[{agentId:'traffic',status:'Em análise',startedAt:at(-1000),leaseUntil:at(1000)}];
 r.discussionPending=[{id:'question',toAgent:'creative'}];r.discussionClaims.creative={status:'Em análise',startedAt:at(-1000),leaseUntil:at(1000)};
 let p=autonomousWorkPlan(state(),base(r),now);assert.deepEqual(p.ready.map(w=>w.kind),['collection']);assert.equal(p.waitingCount,2);
 p=autonomousWorkPlan(state(),base(r),now+2000);assert.deepEqual(p.ready.map(w=>w.kind),['discussion','stage','collection']);
});
test('Expired/incomplete/replaced sources never produce stage or discussion dispatch',()=>{
 for(const shape of ['old','missing','replaced']){
  const r=round();r.discussionPending=[{id:'question',toAgent:'traffic'}];
  if(shape==='old')r.sourceCut.forEach(s=>s.fetchedAt=at(-autonomousSourceAgeMs));
  if(shape==='missing')r.sourceCut.pop();
  if(shape==='replaced')r.blocked='Fonte substituída';
  const p=autonomousWorkPlan(state(),base(r),now);
  assert.deepEqual(p.ready.map(w=>w.kind),['collection']);assert.equal(p.refresh.length,shape==='replaced'?0:1);
 }
});
test('Pause stops analysis and collections but preserves verification-only recovery',()=>{
 const s=state();s.paused=true;const b=base(round());
 b.execution.executions=[{id:'sent',project:'p',proposalId:'approved',verificationOnly:true},{id:'reserved',project:'p',canPrepare:true,leaseUntil:at(1000)}];
 const p=autonomousWorkPlan(s,b,now);assert.deepEqual(p.ready.map(w=>w.kind),['verify']);assert.equal(p.next.verificationOnly,true);assert.equal(p.counts.collection,0);
});
test('A stale proposal in peer-review is routed to revision instead of deadlocking its collection',()=>{
 const s=state(),r=round(),b=base(r);r.sourceCut.forEach(c=>c.fetchedAt=at(-autonomousSourceAgeMs));
 b.collaboration.proposals=[{id:'proposal',roundId:'round',project:'p',status:'Em revisão',expiresAt:at(10000),reviewAgents:['budget','traffic']}];
 const p=autonomousWorkPlan(s,b,now);assert.equal(p.next.kind,'review');assert.equal(p.next.mode,'requestRevision');
 assert.equal(p.ready.some(w=>w.kind==='stage'||w.kind==='discussion'),false);
});
test('Unapproved/malformed approval cannot create financial work or provider commands',()=>{
 const s=state();s.proposals=[{id:'unapproved',status:'Aguardando aprovação'},{id:'forged',status:'Aprovada'}];
 const p=autonomousWorkPlan(s,{execution:{executions:[]},collaboration:{rounds:[],proposals:[]}},now);
 assert.equal(p.readyCount,0);assert.equal(p.next,null);
});
test('Plan is bounded while retaining truthful counts and no duplicated synthetic discussion',()=>{
 const s=state();s.messages=Array.from({length:105},(_,i)=>({id:String(i),project:'p',status:'Pendente'}));
 const p=autonomousWorkPlan(s,{execution:{executions:[]},collaboration:{rounds:[],proposals:[]}},now);
 assert.equal(p.ready.length,100);assert.equal(p.readyCount,105);assert.equal(p.truncated,true);assert.equal(p.counts.discussion,0);
});
test('An exhausted expired claim is attention for renewal, never an infinite dispatch loop',()=>{
 const s=state(),r=round(),b=base(r);r.stages=[{agentId:'traffic',status:'Em análise',attempt:3,startedAt:at(-2000),leaseUntil:at(-1000)}];
 r.discussionPending=[{id:'question',toAgent:'creative'}];r.discussionClaims.creative={status:'Em análise',attempt:3,replyTo:'question',startedAt:at(-2000),leaseUntil:at(-1000)};
 const p=autonomousWorkPlan(s,b,now);assert.deepEqual(p.ready.map(w=>w.kind),['collection']);assert.equal(p.refresh.length,2);
});
