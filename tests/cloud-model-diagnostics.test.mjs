import test from 'node:test';
import assert from 'node:assert/strict';
import {safeModelFailure,modelOutputFailure,modelTailRepetition} from '../lib/cloud-model-diagnostics.mjs';
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
 assert.deepEqual(modelOutputFailure(response(secret,'provider-secret'),'json','invalid_final_json').modelFailure,{version:1,phase:'json',reason:'invalid_final_json',finishReason:'other',reasoningField:true,usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}});
 // Shape is a fixed label (JSON phase only); size is a bucket; reasoning is presence and a bounded count, never text.
 assert.deepEqual(safeModelFailure({phase:'json',reason:'invalid_final_json',shape:'trailing_text',contentSize:'1k-4k',reasoningField:false,usage:{completion_tokens:5,completion_tokens_details:{reasoning_tokens:3}}}),{version:1,phase:'json',reason:'invalid_final_json',shape:'trailing_text',contentSize:'1k-4k',reasoningField:false,usage:{completion_tokens:5,reasoning_tokens:3}});
 assert.deepEqual(safeModelFailure({phase:'json',reason:'invalid_final_json',shape:secret,contentSize:secret,reasoningField:secret,usage:{completion_tokens_details:{reasoning_tokens:-4}}}),{version:1,phase:'json',reason:'invalid_final_json'});
 assert.equal(safeModelFailure({phase:'envelope',reason:'output_truncated',shape:'trailing_text'}).shape,undefined);
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

test('a cut output says whether its tail is a loop, from fixed labels only, in bounded time',()=>{
 const reading=i=>JSON.stringify({adAccountId:'act_'+i,externalId:'12000'+i,assessment:'observe',reason:'ROAS abaixo do equilíbrio em 3 dias; conferir checkout antes de agir.',citations:[{observation:'C'+i+'/P/3d',metric:'roas'}]});
 const valid='{"decision":"Observar","campaignReadings":['+Array.from({length:12},(_,i)=>reading(i)).join(',')+']';
 for(let cut=0;cut<=valid.length;cut+=7)assert.equal(modelTailRepetition(valid.slice(0,cut)).repetition,false,'valid output cut at '+cut);
 assert.deepEqual(modelTailRepetition(valid+' '.repeat(3000)),{repetition:true,repetitionKind:'whitespace'});
 assert.deepEqual(modelTailRepetition(valid+'\n'.repeat(900)),{repetition:true,repetitionKind:'whitespace'});
 assert.deepEqual(modelTailRepetition(valid+'Conferir a campanha. '.repeat(60)),{repetition:true,repetitionKind:'text'});
 assert.deepEqual(modelTailRepetition(valid+(','+reading(1)).repeat(8)),{repetition:true,repetitionKind:'text'});
 assert.deepEqual(modelTailRepetition(null),{});assert.deepEqual(modelTailRepetition('curto'),{repetition:false});
 const t=Date.now();modelTailRepetition('ab'.repeat(500000)+'x');assert.ok(Date.now()-t<200,'only the tail window is scanned');
 // Whitelist: repetition only on envelope failures; cap, temperature and adjustment bounded; nothing else survives.
 assert.deepEqual(safeModelFailure({phase:'envelope',reason:'output_truncated',contentPresent:true,contentSize:'gt16k',repetition:true,repetitionKind:'whitespace',maxTokens:6400,temperature:1,adjustment:'after_output_truncated',raw:secret}),{version:1,phase:'envelope',reason:'output_truncated',contentSize:'gt16k',contentPresent:true,repetition:true,repetitionKind:'whitespace',maxTokens:6400,temperature:1,adjustment:'after_output_truncated'});
 assert.deepEqual(safeModelFailure({phase:'json',reason:'invalid_final_json',repetition:true,repetitionKind:'text',maxTokens:1e9,temperature:9,adjustment:secret,contentPresent:secret}),{version:1,phase:'json',reason:'invalid_final_json'});
 assert.equal(safeModelFailure({phase:'envelope',reason:'output_truncated',repetition:false,repetitionKind:'text'}).repetitionKind,undefined);
});
test('a truncation records whether content existed and its loop flag, never the content',()=>{
 const loop=secret+' '.repeat(4000);
 assert.throws(()=>cloudModelContent(response(loop,'length'),cloudModelPolicy('wide')),e=>{
  assert.equal(e.modelFailure.reason,'output_truncated');assert.equal(e.modelFailure.contentPresent,true);assert.equal(e.modelFailure.contentSize,'1k-4k');
  assert.equal(e.modelFailure.repetition,true);assert.equal(e.modelFailure.repetitionKind,'whitespace');assert.doesNotMatch(JSON.stringify(e),/private-body|do_not_store/);return true;});
 assert.throws(()=>cloudModelContent({choices:[{finish_reason:'length',message:{role:'assistant',content:null}}]},cloudModelPolicy('wide')),e=>{
  assert.equal(e.modelFailure.contentPresent,false);assert.equal(e.modelFailure.contentSize,undefined);assert.equal(e.modelFailure.repetition,undefined);return true;});
});
