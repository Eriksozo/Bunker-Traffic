import test from 'node:test';
import assert from 'node:assert/strict';
import {registerAgentHypothesis,automaticHypothesisPolicy} from '../lib/automatic-agent-hypotheses.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,fingerprint} from '../lib/collaboration.mjs';
import {recordKnowledge} from '../lib/knowledge.mjs';
import {learningCyclePlan} from '../lib/learning-cycle.mjs';
import {cloudLearningContext,compactCloudContext} from '../lib/cloud-analysis.mjs';
import {learningInputReceipt} from '../lib/learning-input-receipt.mjs';
import {validateMemoryReview,memoryReviewOptions} from '../lib/agent-memory-review.mjs';
const start=Date.parse('2026-11-05T16:00:00Z'),iso=n=>new Date(n).toISOString(),day=86400000;
function fixture(now=start,{role='traffic',knowledge=[],lesson='Conferir aquisição nova antes de repetir uma escala.',spend=100}={}){
 const state={config:{p:{projectName:'John'},q:{projectName:'Other'}},knowledge:structuredClone(knowledge),snapshots:[],jobs:[],ownerChoices:[]};
 for(const period of ['7d','3d','yesterday','today'])for(const level of ['campaign','adset','ad'])state.snapshots.push({projectId:'p',period,level,source:'Malva MCP',complete:true,from:iso(now-day),to:iso(now+(period==='today'?3600000:-2000)),timezone:'UTC',fetchedAt:iso(now-1000),rows:[{externalId:level==='campaign'?'c':level,adAccountId:'a',campaignExternalId:level==='campaign'?null:'c',provider:'meta',name:'Sales',status:'ACTIVE',spend,frontOrders:0}]});
 const job={id:'job',project:'p',status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)};state.jobs.push(job);const round=ensureCollaboration(state,job,now);
 for(const prior of ['traffic','creative','budget','ops'].slice(0,['traffic','creative','budget','ops'].indexOf(role))){const c=claimCollaboration(state,{roundId:round.id,agentId:prior,executionRef:'prior-'+prior,clientId:'prior-claim-'+prior},now);postCollaboration(state,{roundId:round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'prior-conclusion-'+prior,kind:'conclusion',toAgent:'ops',text:'Perspectiva anterior real.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:'a',externalId:'c',fetchedAt:iso(now-1000)}]},now);}
 const claim=claimCollaboration(state,{roundId:round.id,agentId:role,executionRef:'actual-'+role,clientId:'claim-'+role},now);
 const refs=[{period:'today',level:'campaign',adAccountId:'a',externalId:'c',fetchedAt:iso(now-1000)}],reflection={lesson,uncertainty:'Efeito financeiro ainda não medido.',nextCheck:'Confrontar novas compras e ajustes recentes.',citations:[{period:'today',level:'campaign',adAccountId:'a',externalId:'c',metric:'spend',value:spend}],peerChecks:[]};
 const m=postCollaboration(state,{roundId:round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'conclusion',kind:'conclusion',toAgent:'ops',text:'Hipótese autoral com fonte; não autoriza execução.',evidenceRefs:refs,reflection},now);m.model={policy:'wide',name:'Cloudflare model'};m.learningInputs={project:'p',role};
 return {state,round,m,now};
}
function confront(f,k,stance='adapt'){
 const c={project:'p',role:f.m.fromAgent,agentMemory:{role:f.m.fromAgent},learning:cloudLearningContext([k],f.now)};f.m.learningInputs=learningInputReceipt(c);f.m.memoryReview=validateMemoryReview({reflection:f.m.reflection,memoryReview:{reference:'M0',stance,reason:'A evidência nova muda a hipótese no mesmo contexto.',evidenceIndices:[0]}},c,true);return c;
}
test('A real source-grounded conclusion registers an unvalidated hypothesis, preserving exact provenance and replay',()=>{
 const f=fixture(),before=structuredClone(f.state),saved=registerAgentHypothesis(f.state,f.m.id,f.now),k=f.state.knowledge[0];
 assert.equal(saved.status,'Hipótese registrada');assert.equal(k.status,'Hipótese');assert.equal(k.confidence,0);assert.deepEqual(k.supportCases,[]);assert.match(k.claim,/Conferir aquisição nova/);assert.match(k.claim,/Efeito financeiro ainda não medido/);assert.equal(k.agentOrigin.latestMessageId,f.m.id);assert.equal(k.agentOrigin.agentId,'traffic');assert.equal(k.agentOrigin.sourceHash,f.round.sourceHash);assert.equal(k.agentOrigin.citations[0].value,100);assert.equal(k.agentOrigin.citations[0].to,iso(start+3600000));assert.equal(k.sources[0].reference,'conclusion:'+f.m.id);assert.equal(k.revisions[0].agentOrigin.latestMessageId,f.m.id);
 assert.deepEqual(f.state.config,before.config);assert.deepEqual(f.state.snapshots,before.snapshots);assert.deepEqual(f.state.proposals,before.proposals);assert.equal(f.state.executions,undefined);const snapshot=structuredClone(f.state);assert.equal(registerAgentHypothesis(f.state,f.m.id,f.now+day).status,'Já registrada');assert.deepEqual(f.state,snapshot);
 const cycle=learningCyclePlan(f.state,'p',f.now);assert.equal(cycle.items[0].stage,'Em estudo');assert.equal(cycle.stats.advisory,0);assert.equal(cycle.items[0].counts.recorded,0);assert.equal(cycle.policy.automaticExecutionEnabled,false);assert.equal(cloudLearningContext([k],f.now)[0].agentOrigin.agentId,'traffic');
});
test('New numeric values alone do not create another lesson; revision needs an explicit confronted source rather than a daily wait',()=>{
 const a=fixture();registerAgentHypothesis(a.state,a.m.id,a.now);
 const repeated=fixture(start+10000,{knowledge:a.state.knowledge,spend:200});assert.equal(registerAgentHypothesis(repeated.state,repeated.m.id,repeated.now).status,'Hipótese já existente');assert.equal(repeated.state.knowledge.length,1);
 const early=fixture(start+1000,{knowledge:a.state.knowledge,lesson:'Conferir a concentração de perda no filho.'});assert.equal(registerAgentHypothesis(early.state,early.m.id,early.now).status,'Aguardando confronto da hipótese');assert.equal(early.state.knowledge[0].revision,1);
 const next=fixture(start+15*60000,{knowledge:a.state.knowledge,lesson:'Conferir a concentração de perda no filho.'});confront(next,next.state.knowledge[0]);const original=structuredClone(a.state.knowledge[0]),saved=registerAgentHypothesis(next.state,next.m.id,next.now),k=next.state.knowledge[0];assert.equal(saved.status,'Hipótese revisada');assert.equal(k.id,original.id);assert.equal(k.revision,2);assert.deepEqual(k.revisions[0],original.revisions[0]);assert.equal(k.agentOrigin.firstMessageId,a.m.id);assert.equal(k.agentOrigin.latestMessageId,next.m.id);assert.equal(k.confidence,0);assert.equal(k.agentOrigin.reconsideration.knowledgeRevision,1);
});
test('A hypothesis linked to enrollment, outcomes or review is never rewritten; bounded capacity preserves original research',()=>{
 for(const key of ['learningEnrollments','knowledgeOutcomes','learningReviews']){
  const a=fixture();registerAgentHypothesis(a.state,a.m.id,a.now);const original=structuredClone(a.state.knowledge[0]);
  const b=fixture(start+day+1,{knowledge:a.state.knowledge,lesson:'Nova hipótese contextual.'});b.state[key]=[{project:'p',knowledgeId:original.id}];confront(b,b.state.knowledge[0]);assert.equal(registerAgentHypothesis(b.state,b.m.id,b.now).status,'Hipótese registrada');assert.deepEqual(b.state.knowledge.find(k=>k.id===original.id),original);assert.equal(b.state.knowledge.length,2);
  const c=fixture(start+2*day+2,{knowledge:b.state.knowledge,lesson:'Terceira hipótese não substitui evidência.'});c.state[key]=b.state.knowledge.map(k=>({project:'p',knowledgeId:k.id}));confront(c,c.state.knowledge.at(-1));const before=structuredClone(c.state.knowledge);assert.equal(registerAgentHypothesis(c.state,c.m.id,c.now).status,'Hipóteses aguardam revisão');assert.deepEqual(c.state.knowledge,before);assert.equal(before.length,automaticHypothesisPolicy.activePerRole);
 }
});
test('Apply, uncertainty, missing delivery and forged/stale references cannot revise an authored hypothesis',()=>{
 const a=fixture();registerAgentHypothesis(a.state,a.m.id,a.now);
 for(const change of [f=>f.m.memoryReview.stance='apply',f=>f.m.memoryReview.stance='inconclusive',f=>f.m.memoryReview.currentEvidenceCount=0,f=>f.m.memoryReview.sourceFingerprint='forged',f=>f.m.learningInputs.researchHypotheses=[],f=>f.m.learningInputs.researchHypotheses[0].agentId='budget',f=>f.m.learningInputs.researchHypotheses[0].revision=999,f=>f.m.learningInputs.researchHypotheses[0].researchFingerprint='stale']){
  const f=fixture(start+60000,{knowledge:a.state.knowledge,lesson:'Uma lição diferente exige confronto real.'});confront(f,f.state.knowledge[0]);change(f);const before=structuredClone(f.state.knowledge);assert.equal(registerAgentHypothesis(f.state,f.m.id,f.now).status,'Aguardando confronto da hipótese');assert.deepEqual(f.state.knowledge,before);
 }
 const rejected=fixture(start+60000,{knowledge:a.state.knowledge,lesson:'Investigar uma explicação alternativa.'});confront(rejected,rejected.state.knowledge[0],'reject');assert.equal(registerAgentHypothesis(rejected.state,rejected.m.id,rejected.now).status,'Hipótese revisada');assert.equal(rejected.state.knowledge[0].agentOrigin.reconsideration.stance,'reject');assert.equal(rejected.state.knowledge[0].status,'Hipótese');
});
test('Manual edits retain origin but prevent automatic overwrite; other projects and roles do not share slots',()=>{
 const a=fixture();registerAgentHypothesis(a.state,a.m.id,a.now);const original=a.state.knowledge[0];recordKnowledge(a.state,{...original,id:original.id,expectedRevision:1,claim:'Revisão manual que precisa ser preservada.'},iso(start+1000));assert.equal(a.state.knowledge[0].agentOrigin.latestMessageId,a.m.id);assert.equal(a.state.knowledge[0].agentOrigin.lastRecordedRevision,1);
 const b=fixture(start+day+2001,{knowledge:a.state.knowledge,lesson:'Hipótese posterior independente.'});assert.equal(registerAgentHypothesis(b.state,b.m.id,b.now).status,'Aguardando confronto da hipótese');assert.equal(b.state.knowledge.length,1);assert.equal(b.state.knowledge.find(k=>k.id===original.id).claim,'Revisão manual que precisa ser preservada.');assert.equal(memoryReviewOptions({project:'p',role:'traffic',agentMemory:{role:'traffic'},learning:cloudLearningContext(b.state.knowledge,b.now)}).length,0);
 const otherRole=fixture(start+day+3001,{role:'budget',knowledge:b.state.knowledge,lesson:'Conferir exposição.'});assert.equal(registerAgentHypothesis(otherRole.state,otherRole.m.id,otherRole.now).status,'Hipótese registrada');assert.equal(otherRole.state.knowledge.at(-1).agentOrigin.agentId,'budget');
 const c=fixture(start+2*day,{knowledge:b.state.knowledge,lesson:'Novo projeto.'});c.state.knowledge=c.state.knowledge.map(k=>({...k,project:'q'}));assert.equal(registerAgentHypothesis(c.state,c.m.id,c.now).status,'Hipótese registrada');assert.equal(c.state.knowledge.filter(k=>k.project==='q').length,1);
});
test('Forged role/claim/model/receipt, replaced sources, future clocks and heating cannot create research',()=>{
 for(const change of [f=>f.m.claimId='forged',f=>f.m.kind='message',f=>f.m.project='q',f=>f.m.model=null,f=>f.m.learningInputs.role='ops',f=>f.round.sourceHash='',f=>f.m.createdAt=iso(start+1),f=>f.state.config.p.targetRoas=999,f=>f.m.reflection.citations[0].value=999,f=>f.state.snapshots.find(s=>s.period==='today'&&s.level==='campaign').rows[0].spend=999]){
  const f=fixture();change(f);assert.throws(()=>registerAgentHypothesis(f.state,f.m.id,f.now),e=>e.code==='CLOUD_HYPOTHESIS_SOURCE');assert.equal(f.state.knowledge.length,0);
 }
 const f=fixture();for(const s of f.state.snapshots)s.rows[0].name='[ENGAJAMENTO]';for(const cut of f.round.sourceCut)cut.fingerprint=fingerprint(f.state.snapshots.find(s=>s.period===cut.period&&s.level===cut.level));f.round.sourceHash=fingerprint(f.round.sourceCut);assert.equal(registerAgentHypothesis(f.state,f.m.id,f.now).status,'Aquecimento fora do aprendizado de vendas');assert.equal(f.state.knowledge.length,0);
 const paused=fixture();paused.state.paused=true;assert.equal(registerAgentHypothesis(paused.state,paused.m.id,paused.now).status,'Pausada');assert.equal(paused.state.knowledge.length,0);
});
test('A full knowledge journal does not discard old hypotheses or block a conclusion',()=>{
 const f=fixture();f.state.knowledge=Array.from({length:120},(_,i)=>({id:'old'+i,project:'q'}));const before=structuredClone(f.state.knowledge);assert.equal(registerAgentHypothesis(f.state,f.m.id,f.now).status,'Base de hipóteses cheia');assert.deepEqual(f.state.knowledge,before);assert.equal(f.round.stages[0].status,'Concluída');
});
test('Optional automatic hypotheses are deferred before current campaigns or children',()=>{
 const c={role:'traffic',project:'p',campaigns:Array.from({length:6},(_,i)=>({target:{externalId:'c'+i,adAccountId:'a'},windows:{today:{spend:100+i}},hierarchy:[{period:'today',level:'ad',rows:[{externalId:'child'+i,adAccountId:'a',spend:10}]}]})),learning:[{id:'automatic',claim:'x'.repeat(12000),agentOrigin:{kind:'cloud-reflection'}},{id:'owner',claim:'Preferência registrada pelo dono.'}],agentMemory:{patternValidation:[{knowledgeId:'automatic',stage:'Em estudo'}]}};
 const before=structuredClone(c),out=compactCloudContext(c,7000);assert.equal(out.campaigns.length,6);assert.ok(out.campaigns.every(x=>x.hierarchy[0].rows.length===1));assert.deepEqual(out.coverage.deferredAgentHypothesisIds,['automatic']);assert.equal(out.learning[0].id,'owner');assert.equal(out.agentMemory.patternValidation.length,0);assert.deepEqual(c,before);
});
