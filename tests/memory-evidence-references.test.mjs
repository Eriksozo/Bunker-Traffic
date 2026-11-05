import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudEvidenceReferences,resolveEvidenceReferences} from '../lib/cloud-evidence-references.mjs';
import {runCloudAnalyst} from '../lib/cloud-analysis.mjs';
const spend={observation:'C0/P/today',metric:'spend'},front={observation:'C0/P/today',metric:'frontOrders'};
function fixture(){return {project:'p',role:'traffic',campaigns:[{target:{adAccountId:'a',externalId:'c'},windows:{today:{spend:100,frontOrders:0}},hierarchy:[]}],agentMemory:{role:'traffic',episodes:[{messageId:'prior',agentId:'traffic',project:'p',roundId:'old',reflection:{lesson:'Conferir novas compras após a edição.'}}]}};}
function output(){return {decision:'Observar',reason:'Conferir aquisição nova.',nextStep:'Conferir os próximos dados.',text:'Memória confrontada com a evidência atual.',suggestions:[],question:null,reflection:{lesson:'Separar histórico de aquisição nova.',uncertainty:'Sem resultado posterior medido.',nextCheck:'Conferir novas compras.',citations:[spend,front],peerChecks:[]},memoryReview:{reference:'M0',stance:'adapt',reason:'O aprendizado anterior pede aquisição nova; ainda há zero front.',evidenceReferences:[front,spend]}};}
test('Memory selects its own exact cited evidence, including zero; array positions are resolved by the server without changing authored prose',async()=>{
 const c=fixture(),raw=output(),before=structuredClone(raw),result=resolveEvidenceReferences(raw,cloudEvidenceReferences(c));
 assert.deepEqual(raw,before);assert.deepEqual(result.value.memoryReview.evidenceIndices,[1,0]);assert.equal(result.value.memoryReview.evidenceReferences,undefined);assert.equal(result.value.reflection.citations[1].value,0);assert.equal(result.value.memoryReview.reason,raw.memoryReview.reason);
 assert.deepEqual(result.receipts.filter(r=>r.scope==='memoryReview').map(r=>({observation:r.observation,metric:r.metric,reflectionIndex:r.reflectionIndex})),[{...front,reflectionIndex:1},{...spend,reflectionIndex:0}]);
 let request;const out=await runCloudAnalyst({run:async(_model,r)=>{request=r;return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]};}},'traffic',c,'wide');
 const schema=request.response_format.json_schema.schema.properties.memoryReview;
 assert.equal(schema.properties.evidenceIndices,undefined);assert.ok(schema.required.includes('evidenceReferences'));assert.equal(schema.properties.evidenceReferences.minItems,1);assert.equal(schema.properties.evidenceReferences.uniqueItems,undefined);assert.deepEqual(schema.properties.reference.enum,['M0']);assert.deepEqual(out.memoryReview.evidenceIndices,[1,0]);assert.equal(out.memoryReview.referenceChecked,true);assert.equal(out.memoryReview.currentEvidenceCount,2);
});
test('Uncited, foreign, invented, mixed, repeated or malformed memory evidence fails without adding citations or repairing the answer',()=>{
 const c=fixture();c.campaigns.push({target:{adAccountId:'foreign',externalId:'other'},windows:{today:{spend:100,frontOrders:0}},hierarchy:[]});const index=cloudEvidenceReferences(c);
 for(const mutate of [
  o=>o.memoryReview.evidenceReferences=[{observation:'C1/P/today',metric:'spend'}],
  o=>o.memoryReview.evidenceReferences=[{observation:'absent',metric:'spend'}],
  o=>o.memoryReview.evidenceReferences=[{...spend,value:100}],
  o=>o.memoryReview.evidenceReferences=[{...spend,metric:'revenueNet'}],
  o=>o.memoryReview.evidenceReferences=[spend,spend],
  o=>o.memoryReview.evidenceIndices=[0],
  o=>o.memoryReview.evidenceReferences=null,
  o=>o.memoryReview.evidenceReferences=[{}],
  o=>o.memoryReview.evidenceReferences=Array(9).fill(spend),
  o=>o.reflection.citations=[front],
  o=>o.reflection.citations={},
  o=>o.reflection.citations=null,
  o=>o.reflection.citations=[spend,spend]
 ]){const raw=output();mutate(raw);const before=structuredClone(raw);assert.throws(()=>resolveEvidenceReferences(raw,index),e=>e.code==='CLOUD_MEMORY_REVIEW_EVIDENCE');assert.deepEqual(raw,before);}
});
test('Selecting a valid number does not bypass memory identity, required evidence or absence rules',async()=>{
 for(const mutate of [o=>o.memoryReview.reference='M99',o=>o.memoryReview.evidenceReferences=[],o=>o.reflection.citations[1]={...front,value:999}]){
  const raw=output();mutate(raw);await assert.rejects(runCloudAnalyst({run:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]})},'traffic',fixture(),'wide'));
 }
 const c=fixture();c.campaigns=[];const raw=output();raw.reflection.citations=[];raw.memoryReview.stance='inconclusive';raw.memoryReview.evidenceReferences=[];
 const result=await runCloudAnalyst({run:async(_m,r)=>{const s=r.response_format.json_schema.schema.properties.memoryReview;assert.equal(s.properties.evidenceReferences.maxItems,0);return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]};}},'traffic',c,'wide');
 assert.equal(result.memoryReview.currentEvidenceCount,0);assert.equal(result.memoryReview.stance,'inconclusive');
});
test('Previously stored positional evidence remains unchanged and still passes the original validators',async()=>{
 const raw=output();raw.reflection.citations=[{period:'today',level:'campaign',adAccountId:'a',externalId:'c',metric:'spend',value:100}];delete raw.memoryReview.evidenceReferences;raw.memoryReview.evidenceIndices=[0];
 const before=structuredClone(raw),out=await runCloudAnalyst({run:async()=>({response:raw})},'traffic',fixture());assert.equal(out.memoryReview.currentEvidenceCount,1);assert.deepEqual(out.memoryReview.evidenceIndices,[0]);assert.deepEqual(raw,before);
});
