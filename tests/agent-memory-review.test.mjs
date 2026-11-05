import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryReviewOptions,memoryReviewRequirements,validateMemoryReview} from '../lib/agent-memory-review.mjs';
import {runCloudAnalyst} from '../lib/cloud-analysis.mjs';
const citation={period:'today',level:'campaign',adAccountId:'account',externalId:'campaign',metric:'spend',value:100};
function fixture(){return {project:'p',role:'traffic',campaigns:[{target:{adAccountId:'account',externalId:'campaign'},windows:{today:{spend:100,frontOrders:0}},hierarchy:[]}],priorOpinions:[],agentMemory:{role:'traffic',episodes:[{messageId:'own-episode',project:'p',agentId:'traffic',roundId:'before',reflection:{lesson:'Esperar novas compras depois da edição.'}}],ownerFeedback:[{choiceId:'actual-choice',action:'reduce',percent:20,reason:'Conter o prejuízo.'}],externalResults:[{outcomeId:'actual-case',classification:'Inconclusivo'}]}};}
function output(){return {decision:'Observar',reason:'Aquisição ainda não recuperou.',nextStep:'Conferir compras posteriores à edição.',text:'O caso anterior não comprova eficácia aqui.',reflection:{lesson:'Comparar aquisição depois da edição.',uncertainty:'Atribuição ainda pode mudar.',nextCheck:'Conferir novas compras.',citations:[{...citation}],peerChecks:[]},memoryReview:{reference:'M0',stance:'adapt',reason:'A lição pede separar as compras posteriores; hoje ainda não há aquisição.',evidenceIndices:[0]},suggestions:[],question:null};}
test('Memory confrontation binds one delivered source and current exact citations, never efficacy or permission',()=>{
 const c=fixture(),before=structuredClone(c),out=output(),review=validateMemoryReview(out,c,true);assert.deepEqual(c,before);assert.equal(review.sourceId,'own-episode');assert.equal(review.sourceType,'episode');assert.equal(review.referenceChecked,true);assert.equal(review.currentEvidenceCount,1);assert.equal(review.financialSuccessRate,undefined);assert.equal(review.autoExecute,undefined);assert.equal(out.memoryReview.sourceId,undefined);
 const changed=fixture();changed.agentMemory.episodes[0].reflection.lesson='Outra lição.';assert.notEqual(validateMemoryReview(out,changed,true).sourceFingerprint,review.sourceFingerprint);
});
test('Foreign roles/projects, ambiguous source IDs and omitted memory cannot be claimed as reviewed',()=>{
 const c=fixture();c.agentMemory.episodes.push({...c.agentMemory.episodes[0],messageId:'foreign-project',project:'q'},{...c.agentMemory.episodes[0],messageId:'foreign-role',agentId:'budget'});assert.equal(memoryReviewOptions(c).some(x=>x.id.startsWith('foreign')),false);
 c.agentMemory.episodes.push(structuredClone(c.agentMemory.episodes[0]));assert.equal(memoryReviewOptions(c).some(x=>x.id==='own-episode'),false);
 assert.throws(()=>validateMemoryReview(output(),{...c,agentMemory:{}},true),e=>e.code==='CLOUD_MEMORY_REVIEW_SCOPE');assert.equal(validateMemoryReview({...output(),memoryReview:null},{...c,agentMemory:{}},true),null);
});
test('Missing, invented, duplicate and ungrounded confrontations cannot become verified memory',()=>{
 for(const mutate of [o=>o.memoryReview=null,o=>o.memoryReview.reference='M99',o=>o.memoryReview.evidenceIndices=[99],o=>o.memoryReview.evidenceIndices=[0,0],o=>o.memoryReview.evidenceIndices=[]]){const out=output();mutate(out);assert.throws(()=>validateMemoryReview(out,fixture(),true));}
 const c=fixture();c.campaigns=[];const out=output();out.reflection.citations=[];out.memoryReview.evidenceIndices=[];assert.throws(()=>validateMemoryReview(out,c,false));out.memoryReview.stance='inconclusive';assert.equal(validateMemoryReview(out,c,false).currentEvidenceCount,0);assert.equal(memoryReviewRequirements(c,false).currentEvidenceRequired,false);
});
test('Confrontation text cannot smuggle permissions, financial grades or unsupported judgments',()=>{
 for(const mutate of [r=>r.autoExecute=true,r=>r.financialSuccessRate=1,r=>r.reason=' ',r=>r.stance='approved']){const out=output();mutate(out.memoryReview);assert.throws(()=>validateMemoryReview(out,fixture(),true),e=>e.code==='CLOUD_MEMORY_REVIEW_SCHEMA');}
});
test('Actual model generation must author the comparison; server resolves its source only after exact numeric validation',async()=>{
 const c=fixture();let request;const result=await runCloudAnalyst({run:async(_m,r)=>{request=r;return {response:output()};}},'traffic',c);
 const body=JSON.parse(request.messages[1].content);assert.equal(body.memoryReviewRequirements.required,true);assert.equal(body.memoryReviewRequirements.options[0].path,'agentMemory.episodes[0]');assert.ok(request.response_format.json_schema.required.includes('memoryReview'));assert.equal(result.memoryReview.sourceId,'own-episode');assert.equal(result.memoryReview.stance,'adapt');assert.equal(result.learningInputs.episodes[0].messageId,'own-episode');assert.equal(result.suggestions.length,0);
 const invalid=output();delete invalid.memoryReview;await assert.rejects(runCloudAnalyst({run:async()=>({response:invalid})},'traffic',c),e=>e.code==='CLOUD_MEMORY_REVIEW_REQUIRED');const lied=output();lied.reflection.citations[0].value=101;await assert.rejects(runCloudAnalyst({run:async()=>({response:lied})},'traffic',c),e=>e.code==='CLOUD_REFLECTION_CITATION');
});
test('Context reduction regenerates memory references and rejects references from the omitted packet',async()=>{
 const c={project:'p',role:'traffic',campaigns:[],config:{notes:'y'.repeat(7000)},agentMemory:{role:'traffic',episodes:[0,1,2].map(i=>({messageId:'episode-'+i,project:'p',agentId:'traffic',reflection:{lesson:'x'.repeat(9000)}}))}};
 let calls=0;const packets=[];await assert.rejects(runCloudAnalyst({run:async(_m,r)=>{calls++;packets.push(JSON.parse(r.messages[1].content));if(calls===1)throw Error('maximum context length');const out=output();out.reflection.citations=[];out.memoryReview={reference:'M2',stance:'inconclusive',reason:'Não havia dados novos.',evidenceIndices:[]};return {response:out};}},'traffic',c),e=>e.code==='CLOUD_MEMORY_REVIEW_SCOPE');assert.equal(calls,2);assert.equal(packets[0].memoryReviewRequirements.options.length,3);assert.equal(packets[1].memoryReviewRequirements.options.length,1);assert.equal(c.agentMemory.episodes.length,3);
});
