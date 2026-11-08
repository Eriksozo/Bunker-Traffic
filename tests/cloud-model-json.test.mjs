import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeModelJson,modelJsonShape,unwrapModelJson} from '../lib/cloud-model-json.mjs';
import {modelJsonShapes} from '../lib/cloud-model-diagnostics.mjs';
import {runCloudAnalyst} from '../lib/cloud-analysis.mjs';

const secret='private-generated-text-mvk_do_not_store';
const value={decision:'Observar',reason:secret,nextStep:'Comparar',text:'Texto.',suggestions:[],question:null};
const json=JSON.stringify(value);
const response=(content,finish='stop')=>({choices:[{finish_reason:finish,message:{role:'assistant',content,reasoning_content:secret}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,completion_tokens_details:{reasoning_tokens:12}}});

test('content that already parses is used as is, even with markers or fences inside its strings',()=>{
 for(const c of [json,'\n  '+json+'\n',JSON.stringify({...value,text:'cita <|channel|>final<|message|> e ```json'})])assert.deepEqual(decodeModelJson(c,response(c)),JSON.parse(c.trim()));
});

test('only lossless wrappers are removed: edge whitespace/BOM, edge fences and the gpt-oss final channel',()=>{
 const accepted=[
  '﻿'+json,
  '```json\n'+json+'\n```\n',            // trailing newline after the closing fence (rejected before)
  '  ```JSON\n'+json+'\n```',             // leading space and upper-case tag
  '```json'+json+'```',                   // single line, accepted before
  '```json\n'+json,                       // opening fence only, accepted before
  json+'\n```',                           // closing fence only, accepted before
  '```\n'+json+'\n```',
  '<|channel|>analysis<|message|>'+secret+'<|end|><|start|>assistant<|channel|>final<|message|>'+json+'<|return|>',
  '<|channel|>final<|message|>```json\n'+json+'\n```<|end|>',
 ];
 for(const c of accepted)assert.deepEqual(decodeModelJson(c,response(c)),value,JSON.stringify(c.slice(0,40)));
 // Text of other channels is discarded, never part of the decoded value.
 assert.equal(unwrapModelJson('<|channel|>analysis<|message|>'+secret+'<|end|><|start|>assistant<|channel|>final<|message|>{}'),'{}');
 // An unclosed reasoning message before the header is not a complete other-channel message: left as is (refused).
 assert.throws(()=>decodeModelJson('<|channel|>analysis<|message|>'+secret+'<|channel|>final<|message|>{}',response('')),e=>e.modelFailure.shape==='harmony_marker');
});

test('anything that would need repair or a choice is refused with a fixed shape and no content',()=>{
 const refused=[
  ['Resposta: '+json,'leading_text'],
  [json+' Obrigado.','trailing_text'],
  [json+json,'multiple_values'],
  [json+'\n'+json,'multiple_values'],
  ['<|channel|>analysis<|message|>'+json,'harmony_marker'],
  ['assistantfinal'+json,'leading_text'],
  ['Veja ```json\n'+json+'\n```','fenced'],
  ['{"decision":"Observar","text":"cortado','unterminated'],
  ['{"decision":"Observar",}','invalid_syntax'],
  ['{"text":"linha\nquebrada"}','invalid_syntax'],
  ['<|channel|>final<|message|><|return|>','empty'],
  // Review 08/11: the final header never selects one of two answers nor lifts JSON out of prose or reasoning.
  ['<|channel|>final<|message|>'+JSON.stringify({...value,decision:'Pausar'})+'<|end|><|start|>assistant<|channel|>final<|message|>'+json+'<|return|>','harmony_marker'],
  [JSON.stringify({...value,decision:'Pausar'})+'<|channel|>final<|message|>'+json,'harmony_marker'],
  ['Aqui está a resposta: <|channel|>final<|message|>'+json,'harmony_marker'],
  ['<|channel|>analysis<|message|>Rascunho: <|channel|>final<|message|>'+JSON.stringify({...value,decision:'Pausar'})+'<|end|>','harmony_marker'],
  [json+'<|call|>','harmony_marker'],
  ['<|channel|>final <|message|>'+JSON.stringify({...value,decision:'Pausar'})+'<|end|><|start|>assistant<|channel|>final<|message|>'+json,'harmony_marker'],
  ['<|channel|>Final<|message|>'+JSON.stringify({...value,decision:'Pausar'})+'<|end|><|channel|>final<|message|>'+json,'harmony_marker'],
  ['<|channel|><|message|>'+JSON.stringify({...value,decision:'Pausar'})+'<|end|><|channel|>final<|message|>'+json,'harmony_marker'],
  ['<|start|>assistant<|channel|>commentary<|message|>'+JSON.stringify({...value,decision:'Pausar'})+'<|end|><|start|>assistant<|channel|>final<|message|>'+json,'harmony_marker'],
  ['   ','empty'],
 ];
 for(const [c,shape] of refused){
  assert.equal(modelJsonShape(c),shape,JSON.stringify(c.slice(0,40)));
  assert.throws(()=>decodeModelJson(c,response(c)),e=>{
   assert.equal(e.code,'CLOUD_AI_INVALID');assert.equal(e.modelFailure.phase,'json');assert.equal(e.modelFailure.reason,'invalid_final_json');
   assert.equal(e.modelFailure.shape,shape);assert.equal(e.modelFailure.contentSize,'lt1k');assert.equal(e.modelFailure.reasoningField,true);
   assert.equal(e.modelFailure.usage.reasoning_tokens,12);
   assert.doesNotMatch(JSON.stringify(e),/private-generated|do_not_store|Obrigado|Resposta|cortado|quebrada|Pausar|Rascunho|Aqui/);return true;});
 }
 assert.ok(refused.every(([,s])=>modelJsonShapes.includes(s)));
});

test('the analysis accepts a wrapped final answer once and still refuses a cut one, without retrying',async()=>{
 let calls=0;
 const ok=await runCloudAnalyst({run:async()=>{calls++;return response('```json\n'+JSON.stringify({...value,reason:'Motivo.'})+'\n```\n');}},'traffic',{campaigns:[]},'wide');
 assert.equal(ok.decision,'Observar');assert.equal(calls,1);
 await assert.rejects(runCloudAnalyst({run:async()=>{calls++;return response('{"decision":"Obs');}},'traffic',{campaigns:[]},'wide'),e=>e.modelFailure.shape==='unterminated'&&e.modelFailure.phase==='json');
 assert.equal(calls,2,'a refused format is never retried inside the call');
});

test('the final-header check and end-token strip stay fast on long inputs',()=>{
 const long=['{'+' '.repeat(64000)+'x','<|end|>'.repeat(9000)+'{','{'+'<|end|>'.repeat(9000),'<|channel|>analysis<|message|>'+'a<|end|>'.repeat(6000)+'<|channel|>final<|message|>{}'];
 for(const c of long){const t=Date.now();try{decodeModelJson(c,response(c));}catch{}modelJsonShape(c);assert.ok(Date.now()-t<500,'took '+(Date.now()-t)+'ms');}
});
