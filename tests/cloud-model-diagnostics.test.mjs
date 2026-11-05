import test from 'node:test';
import assert from 'node:assert/strict';
import {safeModelFailure,modelOutputFailure} from '../lib/cloud-model-diagnostics.mjs';
import {cloudModelContent,cloudModelPolicy} from '../lib/cloud-model-policy.mjs';
import {runCloudAnalyst} from '../lib/cloud-analysis.mjs';
import {runtimeFailure} from '../lib/cloud-failure-diagnostics.mjs';
const secret='private-body-and-reasoning-mvk_do_not_store';
const response=(content,finish='stop')=>({choices:[{finish_reason:finish,message:{role:'assistant',content,reasoning_content:secret}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300,private:secret},headers:{authorization:secret}});
test('Rejected final messages carry a precise fixed reason without partial output or reasoning',()=>{
 const cases=[[response('{','length'),'output_truncated'],[response(''),'no_final_content'],[{choices:[]},'unexpected_envelope'],[{choices:{0:{finish_reason:'stop'},length:1}},'unexpected_envelope'],[response(secret,'content_filter'),'unexpected_envelope']];
 for(const [input,reason] of cases)assert.throws(()=>cloudModelContent(input,cloudModelPolicy('wide')),e=>{assert.equal(e.code,'CLOUD_AI_INVALID');assert.equal(e.modelFailure.phase,'envelope');assert.equal(e.modelFailure.reason,reason);assert.doesNotMatch(JSON.stringify(e),/private-body|do_not_store|reasoning_content|authorization/);return true;});
});
test('Diagnostic sanitizer allows only recognized phase/reason pairs and bounded numeric token counts',()=>{
 for(const phase of ['toString','constructor','__proto__','foreign',null])assert.equal(safeModelFailure({phase,reason:'invalid_schema'}),null);
 assert.equal(safeModelFailure({phase:'schema',reason:'output_truncated'}),null);
 assert.deepEqual(safeModelFailure({phase:'json',reason:'invalid_final_json',finishReason:secret,usage:{prompt_tokens:Infinity,completion_tokens:-1,total_tokens:1e10},raw:secret}),{version:1,phase:'json',reason:'invalid_final_json'});
 assert.deepEqual(modelOutputFailure(response(secret,'provider-secret'),'json','invalid_final_json').modelFailure,{version:1,phase:'json',reason:'invalid_final_json',finishReason:'other',usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}});
});
test('Generation distinguishes JSON syntax from schema failures without retries or financial output',async()=>{
 let calls=0;for(const [content,phase,reason] of [['{','json','invalid_final_json'],[JSON.stringify({decision:'only-one-field'}),'schema','invalid_schema']]){
  await assert.rejects(runCloudAnalyst({run:async()=>{calls++;return response(content);}},'traffic',{campaigns:[]},'wide'),e=>e.code==='CLOUD_AI_INVALID'&&e.modelFailure.phase===phase&&e.modelFailure.reason===reason);
 }assert.equal(calls,2);
});
test('Runtime history preserves sanitized model diagnostics across later success, without attributing a financial result',()=>{
 const e=modelOutputFailure(response(secret,'length'),'envelope','output_truncated');e.modelFailure.raw=secret;
 const r=runtimeFailure({history:[]},e,Date.parse('2026-11-05T22:00:00Z'));assert.equal(r.lastFailure.modelFailure.reason,'output_truncated');assert.equal(r.lastFailure.modelFailure.usage.completion_tokens,200);assert.doesNotMatch(JSON.stringify(r),/private-body|do_not_store|reasoning_content|authorization/);
 const later={...r,lastError:null,history:[{kind:'stage'},...r.history]};assert.equal(later.history[1].modelFailure.reason,'output_truncated');assert.equal(later.history[1].financialSuccess,undefined);
});
