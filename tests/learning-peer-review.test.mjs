import {mockCampaignReadings} from './fixtures/campaign-readings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {learningPeerPacket,persistLearningPeerReview} from '../lib/learning-peer-review.mjs';
import {learningCyclePlan} from '../lib/learning-cycle.mjs';
import {recordKnowledge} from '../lib/knowledge.mjs';
import {claimCollaboration} from '../lib/collaboration.mjs';
import {runCloudAnalyst,validateCloudLearningReview,compactCloudContext} from '../lib/cloud-analysis.mjs';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {learningFixture as fixture,learningNow as now} from './fixtures/learning-flow.mjs';
const iso=n=>new Date(n).toISOString(),day=86400000;

function review(packet,verdict='support'){return {...packet.entry,verdict,reason:'Aquisição e resultado melhoraram em janelas fechadas comparáveis; associação temporal, sem causalidade.'};}
function modelReview(packet,verdict='support'){const r=review(packet,verdict);delete r.project;return r;}
function claim(f,role='traffic'){
 const c=claimCollaboration(f.state,{roundId:f.round.id,agentId:role,executionRef:'worker-'+role,clientId:'claim-'+role},now);
 return {roundId:f.round.id,claimId:c.claimId,executionRef:c.executionRef,agentId:role,project:'p'};
}
const output=()=>({decision:'Investigar',reason:'Comparar novas compras',nextStep:'Conferir janela nova',text:'Análise restrita aos alvos priorizados.',suggestions:[],question:null});
test('peer review packets are pure, project-scoped, measured, and do not create another model call or timer',()=>{
 const f=fixture(),before=structuredClone(f.state),packet=learningPeerPacket(f.state,'p','traffic',now);
 assert.equal(packet.entry.project,'p');assert.equal(packet.counts.prospective,5);assert.equal(packet.cases.length,5);assert.equal(packet.cases[0].before.metrics.frontOrders,2);assert.equal(packet.supportAllowed,true);assert.deepEqual(f.state,before);
 assert.equal(packet.policy.additionalModelCalls,0);assert.equal(packet.policy.providerWrites,false);assert.equal(learningPeerPacket(f.state,'q','traffic',now),null);assert.equal(learningPeerPacket(f.state,'p','ops',now),null);const unmeasured=learningPeerPacket(fixture(0).state,'p','traffic',now);assert.equal(unmeasured.phase,'hypothesis');assert.equal(unmeasured.supportAllowed,false);assert.equal(unmeasured.cases.length,0);assert.equal(packet.phase,'evidence');
});
test('an authored verdict requires the active real role, is append-only, and replays without another review',()=>{
 const f=fixture(),packet=learningPeerPacket(f.state,'p','traffic',now),args=claim(f),input=modelReview(packet),before=structuredClone(f.state.config);
 const first=persistLearningPeerReview(f.state,args,input,packet,now);assert.equal(first.status,'Registrada');assert.equal(f.state.learningReviews[0].agentId,'traffic');assert.equal(learningPeerPacket(f.state,'p','traffic',now),null);assert.deepEqual(f.state.config,before);assert.equal(f.state.proposals.length,0);assert.equal(f.state.executions,undefined);
 assert.equal(persistLearningPeerReview(f.state,args,input,packet,now+day).id,first.id);assert.equal(f.state.learningReviews.length,1);assert.throws(()=>persistLearningPeerReview(f.state,args,{...input,reason:'Changed'},packet,now),/clientId/);
});
test('source or hypothesis changes defer the review without overwriting a prior opinion',()=>{
 const f=fixture(),packet=learningPeerPacket(f.state,'p','traffic',now),args=claim(f);
 recordKnowledge(f.state,{...f.knowledge,id:f.knowledge.id,expectedRevision:1,claim:'Nova hipótese precisa de nova validação.'},iso(now));
 assert.equal(persistLearningPeerReview(f.state,args,modelReview(packet),packet,now).status,'Releitura necessária');assert.equal(f.state.learningReviews,undefined);
});
test('wrong role, project, invented fingerprint and closed claim cannot save a review',()=>{
 for(const mutate of [a=>a.agentId='ops',a=>a.agentId='budget',a=>a.project='q',a=>a.claimId='fake']){
  const f=fixture(),packet=learningPeerPacket(f.state,'p','traffic',now),args=claim(f);mutate(args);assert.throws(()=>persistLearningPeerReview(f.state,args,modelReview(packet),packet,now));assert.equal(f.state.learningReviews,undefined);
 }
 const f=fixture(),packet=learningPeerPacket(f.state,'p','traffic',now),args=claim(f);assert.throws(()=>persistLearningPeerReview(f.state,args,{...modelReview(packet),evidenceFingerprint:'invented'},packet,now));
});
test('limited packets prioritize losses, expose omissions, and cannot manufacture support from a sample',()=>{
 const f=fixture(9),o=f.state.knowledgeOutcomes[8];o.after.metrics.revenueNet=30;const saved=f.state.snapshots.find(s=>s.from===o.after.from&&s.rows[0].externalId===o.objectId);saved.rows[0].revenueNet=30;
 const packet=learningPeerPacket(f.state,'p','traffic',now);assert.equal(packet.cases.length,8);assert.equal(packet.omittedCases,1);assert.equal(packet.casePacketComplete,false);assert.equal(packet.supportAllowed,false);assert.equal(packet.cases[0].classification,'Desfavorável');
 const context={project:'p',learningReview:packet};assert.throws(()=>validateCloudLearningReview({...output(),learningReview:modelReview(packet)},context,'traffic'),e=>e.code==='CLOUD_LEARNING_REVIEW_UNSUPPORTED');
 assert.doesNotThrow(()=>validateCloudLearningReview({...output(),learningReview:modelReview(packet,'inconclusive')},context,'traffic'));
});
test('unverifiable and stale evidence do not turn into a supported pattern',()=>{
 const f=fixture();f.state.snapshots[0].rows[0].spend=999;let packet=learningPeerPacket(f.state,'p','traffic',now);assert.equal(packet.counts.unverifiable,1);assert.equal(packet.supportAllowed,false);
 f.knowledge.status='Invalidado';packet=learningPeerPacket(f.state,'p','traffic',now);assert.equal(packet.supportAllowed,false);
 const old=learningPeerPacket(fixture().state,'p','traffic',now+40*day);assert.equal(old.supportAllowed,false);
});
test('pause and full history preserve evidence without admitting more automatic reviews',()=>{
 const f=fixture();f.state.paused=true;assert.equal(learningPeerPacket(f.state,'p','traffic',now),null);f.state.paused=false;f.state.learningReviews=Array.from({length:600},()=>({}));assert.equal(learningPeerPacket(f.state,'p','traffic',now),null);
});
test('structured generation binds the exact pattern and rejects missing or unsolicited review output',async()=>{
 const f=fixture(),packet=learningPeerPacket(f.state,'p','traffic',now),context={project:'p',campaigns:[],learningReview:packet};let request;
 const out=await runCloudAnalyst({run:async(_m,r)=>{request=r;return {response:{...output(),learningReview:modelReview(packet)}};}},'traffic',context);assert.equal(out.learningReview.knowledgeId,packet.entry.knowledgeId);
 const schema=request.response_format.json_schema;assert.ok(schema.required.includes('learningReview'));assert.equal(schema.properties.learningReview.properties.evidenceFingerprint.const,packet.entry.evidenceFingerprint);
 await assert.rejects(runCloudAnalyst({run:async()=>({response:output()})},'traffic',context),e=>e.code==='CLOUD_LEARNING_REVIEW_REQUIRED');
 await assert.rejects(runCloudAnalyst({run:async()=>({response:{...output(),learningReview:modelReview(packet)}})},'traffic',{project:'p',campaigns:[]}),e=>e.code==='CLOUD_LEARNING_REVIEW_SCOPE');
 const limited={...packet,supportAllowed:false};await runCloudAnalyst({run:async(_m,r)=>{request=r;return {response:{...output(),learningReview:modelReview(packet,'challenge')}};}},'traffic',{...context,learningReview:limited});assert.deepEqual(request.response_format.json_schema.properties.learningReview.properties.verdict.enum,['challenge','inconclusive']);
});
test('compaction defers the whole learning packet rather than silently deleting case evidence',()=>{
 const f=fixture(),packet=learningPeerPacket(f.state,'p','traffic',now),input={campaigns:[{target:{adAccountId:'local',externalId:'current'},windows:{today:{spend:50}},hierarchy:[]}],learningReview:packet};
 const compact=compactCloudContext(input,1500);assert.equal(compact.learningReview,undefined);assert.equal(compact.coverage.deferredLearningReview,packet.entry.knowledgeId);assert.equal(input.learningReview.cases.length,5);assert.equal(compact.campaigns[0].windows.today.spend,50);
});
test('normal cloud stages author independent learning reviews, without extra model calls or provider actions',async()=>{
 const f=fixture();let state=f.state,calls=0,providerCalls=0;
 const ai={run:async(_m,request)=>{calls++;const {context:c,reflectionRequirements:r}=JSON.parse(request.messages[1].content);return {response:{...output(),campaignReadings:mockCampaignReadings(c),reflection:{lesson:'Conferir aquisição após edição.',uncertainty:'Associação não demonstra causalidade.',nextCheck:'Comparar novas compras.',citations:r.examples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'support',reason:'Escopo e fontes conferidos.'}))},learningReview:c.learningReview?modelReview(c.learningReview):null}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(state),revision:1}),write:async fn=>{const draft=structuredClone(state),out=await fn(draft,1);state=draft;return out;},ai,source:{read:async()=>{providerCalls++;throw Error('Unexpected read');},dispatch:async()=>{providerCalls++;throw Error('Unexpected write');}},ops:{},now:()=>now});
 for(let i=0;i<4;i++){const result=await engine.step();assert.equal(result.kind,'stage');if(i<3)assert.equal(result.learningReview.status,'Registrada');}
 assert.equal(calls,4);assert.equal(providerCalls,0);assert.equal(state.learningReviews.length,3);assert.equal(new Set(state.learningReviews.map(r=>r.executionRef)).size,3);assert.equal(learningCyclePlan(state,'p',now).stats.advisory,1);assert.equal(state.proposals.length,0);assert.equal(state.executions,undefined);assert.deepEqual(state.config,f.state.config);
});

import {automaticHypothesisPlan} from '../lib/automatic-agent-hypotheses.mjs';
import {recordLearningReview} from '../lib/learning-cycle.mjs';
const critique=(packet,verdict='challenge')=>{const r=review(packet,verdict);delete r.project;r.reason='Dados atuais da rodada não sustentam a hipótese; falta separar front de upsell.';return r;};
test('unmeasured hypotheses get a critique from other roles that never supports, never changes the stage and never repeats',()=>{
 const f=fixture(0),before=structuredClone(f.state.config);
 for(const role of ['creative','budget']){const packet=learningPeerPacket(f.state,'p',role,now);assert.equal(packet.phase,'hypothesis');assert.equal(packet.claim,f.knowledge.claim);assert.equal(packet.sources.length,1);assert.equal(packet.supportAllowed,false);}
 const packet=learningPeerPacket(f.state,'p','traffic',now),args=claim(f);
 assert.throws(()=>persistLearningPeerReview(f.state,args,critique(packet,'support'),packet,now),e=>e.code==='CLOUD_LEARNING_REVIEW_UNSUPPORTED');
 const saved=persistLearningPeerReview(f.state,args,critique(packet),packet,now);assert.equal(saved.status,'Registrada');assert.equal(saved.phase,'hypothesis');
 assert.equal(learningPeerPacket(f.state,'p','traffic',now),null);assert.equal(learningPeerPacket(f.state,'p','creative',now).priorCritiques[0].agentId,'traffic');
 const plan=learningCyclePlan(f.state,'p',now),item=plan.items[0];
 assert.equal(item.stage,'Em estudo');assert.equal(item.reviews.length,0);assert.deepEqual(item.critiques.map(r=>r.agentId),['traffic']);
 assert.equal(plan.stats.needsReview,0);assert.equal(plan.stats.hypothesisCritiques,1);assert.equal(plan.automaticPeerReview.hypothesisPending,2);
 const step=role=>plan.steps.find(s=>s.role===role).activity;assert.equal(step('traffic').critiques,1);assert.equal(step('creative').critiquesWaiting,1);assert.equal(step('budget').critiquesWaiting,1);assert.equal(step('ops').measured,0);
 assert.deepEqual(f.state.config,before);assert.equal(f.state.proposals.length,0);assert.equal(f.state.executions,undefined);
});
test('the author never critiques its own hypothesis and a critique does not lock the author revision',()=>{
 const f=fixture(0),k=f.state.knowledge[0];k.agentOrigin={version:1,kind:'cloud-reflection',agentId:'traffic',lastRecordedRevision:k.revision};k.status='Hipótese';k.confidence=0;
 assert.equal(learningPeerPacket(f.state,'p','traffic',now),null);
 const packet=learningPeerPacket(f.state,'p','creative',now);assert.equal(packet.author,'traffic');
 assert.throws(()=>persistLearningPeerReview(f.state,{roundId:f.round.id,claimId:'x',executionRef:'x',agentId:'traffic',project:'p'},critique(packet),{...packet,role:'traffic'},now),e=>e.code==='CLOUD_LEARNING_REVIEW_SCOPE');
 const c=claim(f);assert.throws(()=>recordLearningReview(f.state,{...c,phase:'hypothesis',clientId:'manual-own',entry:{...packet.entry,verdict:'challenge',reason:'Autocrítica.'}},now),/própria hipótese/);
 const protectedCount=()=>automaticHypothesisPlan(f.state,'p').roles.find(r=>r.agentId==='traffic').protected;
 f.state.learningReviews=[{id:'c',project:'p',knowledgeId:k.id,phase:'hypothesis',agentId:'creative'}];assert.equal(protectedCount(),0);
 f.state.learningReviews=[{id:'e',project:'p',knowledgeId:k.id,agentId:'creative'}];assert.equal(protectedCount(),1);
});
test('measured evidence keeps priority, critiques are refused once a result exists, and pause or the project cap stop them',()=>{
 const measured=fixture();assert.equal(learningPeerPacket(measured.state,'p','creative',now).phase,'evidence');
 const c=claim(measured),entry=learningPeerPacket(measured.state,'p','traffic',now).entry;
 assert.throws(()=>recordLearningReview(measured.state,{...c,phase:'hypothesis',clientId:'manual-late',entry:{...entry,verdict:'challenge',reason:'Tarde demais.'}},now),/CONFLICT/);
 assert.throws(()=>recordLearningReview(measured.state,{...c,phase:'other',clientId:'manual-bad',entry:{...entry,verdict:'challenge',reason:'Fase.'}},now),/Fase/);
 const f=fixture(0);f.state.paused=true;assert.equal(learningPeerPacket(f.state,'p','creative',now),null);f.state.paused=false;
 f.state.learningReviews=Array.from({length:15},(_,i)=>({id:'r'+i,project:'p',knowledgeId:'other',phase:'hypothesis',agentId:'traffic',createdAt:new Date(now-1000).toISOString()}));
 assert.equal(learningPeerPacket(f.state,'p','creative',now),null);assert.ok(learningPeerPacket({...f.state,learningReviews:f.state.learningReviews.map(r=>({...r,project:'q'}))},'p','creative',now));
});
test('cloud stages critique unmeasured hypotheses with the existing calls only, without proposals or provider actions',async()=>{
 const f=fixture(0);let state=f.state,calls=0,providerCalls=0;
 const ai={run:async(_m,request)=>{calls++;const {context:c,reflectionRequirements:r}=JSON.parse(request.messages[1].content);if(c.learningReview)assert.deepEqual(request.response_format.json_schema.properties.learningReview.properties.verdict.enum,['challenge','inconclusive']);return {response:{...output(),campaignReadings:mockCampaignReadings(c),reflection:{lesson:'Conferir aquisição após edição.',uncertainty:'Associação não demonstra causalidade.',nextCheck:'Comparar novas compras.',citations:r.examples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'support',reason:'Escopo e fontes conferidos.'}))},learningReview:c.learningReview?critique(c.learningReview,'inconclusive'):null}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(state),revision:1}),write:async fn=>{const draft=structuredClone(state),out=await fn(draft,1);state=draft;return out;},ai,source:{read:async()=>{providerCalls++;throw Error('Unexpected read');},dispatch:async()=>{providerCalls++;throw Error('Unexpected write');}},ops:{},now:()=>now});
 for(let i=0;i<4;i++){const result=await engine.step();assert.equal(result.kind,'stage');}
 assert.equal(calls,4);assert.equal(providerCalls,0);assert.deepEqual(state.learningReviews.map(r=>r.agentId).sort(),['budget','creative','traffic']);assert.ok(state.learningReviews.every(r=>r.phase==='hypothesis'&&r.verdict==='inconclusive'));
 assert.equal(learningCyclePlan(state,'p',now).items.find(k=>k.id===f.knowledge.id).stage,'Em estudo');assert.equal(state.proposals.length,0);assert.equal(state.executions,undefined);assert.deepEqual(state.config,f.state.config);
});
test('a missing pre-measurement critique never fails the analysis, while a missing evidence review still does',()=>{
 const hypothesis=learningPeerPacket(fixture(0).state,'p','traffic',now),evidence=learningPeerPacket(fixture().state,'p','traffic',now);
 assert.doesNotThrow(()=>validateCloudLearningReview({...output(),learningReview:null},{project:'p',learningReview:hypothesis},'traffic'));
 assert.throws(()=>validateCloudLearningReview({...output(),learningReview:null},{project:'p',learningReview:evidence},'traffic'),e=>e.code==='CLOUD_LEARNING_REVIEW_REQUIRED');
 assert.throws(()=>validateCloudLearningReview({...output(),learningReview:{...critique(hypothesis),verdict:'support'}},{project:'p',learningReview:hypothesis},'traffic'),e=>e.code==='CLOUD_LEARNING_REVIEW_UNSUPPORTED');
});
