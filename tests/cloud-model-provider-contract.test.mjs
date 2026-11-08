import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import ts from 'typescript';
import {runCloudAnalyst} from '../lib/cloud-analysis.mjs';
import {cloudModelPolicy,cloudModelOptions} from '../lib/cloud-model-policy.mjs';
import {checkCloudModel} from '../lib/cloud-model-check.mjs';
const value={decision:'Observar',reason:'Conferir aquisição.',nextStep:'Comparar novas compras.',text:'Sem execução.',suggestions:[],question:null};
const envelope=(content=JSON.stringify(value),finish='stop')=>({choices:[{finish_reason:finish,message:{role:'assistant',content}}]});
// Compile the captured production request against the installed official per-model SDK contract.
// The negative control catches the old flat-schema shape; a permissive mock alone would miss it.
function sdkErrors(model,request){
 const dir=mkdtempSync(join(tmpdir(),'bunker-ai-contract-')),file=join(dir,'contract.ts');
 try{
  writeFileSync(file,`/// <reference path=${JSON.stringify(resolve('node_modules/@cloudflare/workers-types/index.d.ts'))} />\nconst request = ${JSON.stringify(request)} satisfies AiModels[${JSON.stringify(model)}]['inputs'];\n`);
  const program=ts.createProgram([file],{strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022});
  return ts.getPreEmitDiagnostics(program).filter(d=>d.file?.fileName===file).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('Actual model requests satisfy their official provider contract; the old GPT-OSS schema envelope is rejected',async()=>{
 const requests={};
 for(const policyId of ['wide','legacy']){
  await runCloudAnalyst({run:async(model,request)=>{requests[policyId]={model,request};return policyId==='wide'?envelope():{response:value};}},'traffic',{campaigns:[]},policyId);
  const {model,request}=requests[policyId];assert.deepEqual(sdkErrors(model,request),[]);
 }
 const {model,request}=requests.wide,schema=request.response_format.json_schema.schema;
 assert.equal(request.reasoning_effort,'low');assert.equal(request.response_format.json_schema.name,'bunker_agent_opinion_v1');
 assert.ok(schema.properties.text);assert.equal(request.max_tokens,4400);assert.equal(requests.legacy.request.reasoning_effort,undefined);
 assert.ok(sdkErrors(model,{...request,response_format:{type:'json_schema',json_schema:schema}}).length>0);
 assert.ok(sdkErrors(model,{...request,reasoning_effort:'none'}).length>0);
 const before=structuredClone(schema);assert.deepEqual(cloudModelOptions(cloudModelPolicy('legacy'),schema).response_format.json_schema,before);assert.deepEqual(schema,before);
});
test('Production connectivity check recognizes the final GPT-OSS envelope, uses bounded structured generation, and has no external command',async()=>{
 let calls=0;
 assert.equal(await checkCloudModel({run:async(model,request)=>{calls++;assert.equal(model,cloudModelPolicy('wide').model);assert.equal(request.max_tokens,256);assert.equal(request.reasoning_effort,'low');assert.deepEqual(request.response_format.json_schema.schema,{type:'object',properties:{ok:{type:'boolean',const:true}},required:['ok'],additionalProperties:false});assert.equal(request.tools,undefined);return envelope('{"ok":true}');}}),true);
 assert.equal(calls,1);
 assert.equal(await checkCloudModel({run:async()=>({response:{ok:true}})},'legacy'),true);
});
test('Connectivity cannot succeed through reasoning, truncation, another model envelope or an invalid final object; it never retries',async()=>{
 const failures=[{response:'OK'},envelope('{"ok":','length'),envelope('{"ok":true} obrigado','length'),envelope('OK'),envelope('{"ok":false}'),envelope('{"ok":true,"untrusted":1}'),envelope('null'),{choices:[{finish_reason:'stop',message:{role:'assistant',reasoning_content:'{"ok":true}'}}]}];
 let calls=0;for(const response of failures)await assert.rejects(checkCloudModel({run:async()=>{calls++;return response;}}),e=>e.code==='CLOUD_AI_INVALID');
 assert.equal(calls,failures.length);
});

test('the retry after a cut keeps the token cap, adds only OpenAI-recommended sampling and still satisfies the contract',async()=>{
 let captured;await runCloudAnalyst({run:async(model,request)=>{captured={model,request};return envelope();}},'traffic',{campaigns:[]},'wide',{retryAfter:'output_truncated'});
 assert.deepEqual(sdkErrors(captured.model,captured.request),[]);
 assert.equal(captured.request.max_tokens,4400,'never a larger cap');assert.equal(captured.request.temperature,1);assert.equal(captured.request.top_p,1);
 let legacy;await runCloudAnalyst({run:async(model,request)=>{legacy=request;return {response:value};}},'traffic',{campaigns:[]},'legacy',{retryAfter:'output_truncated'});
 assert.equal(legacy.temperature,0.1);assert.equal(legacy.top_p,undefined,'policies without truncationRetry keep their sampling');
});
