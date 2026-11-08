import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveEvidenceReferences} from '../lib/cloud-evidence-references.mjs';
import {safeMemoryReviewFailure,memoryReviewFailureReasons} from '../lib/memory-review-failure.mjs';
import {runtimeFailure} from '../lib/cloud-failure-diagnostics.mjs';

const index=new Map([['C0/P/3d',{period:'3d',level:'campaign',adAccountId:'a',externalId:'1',campaignExternalId:'1',row:{spend:10,revenueNet:20}}],['C0/P/7d',{period:'7d',level:'campaign',adAccountId:'a',externalId:'1',campaignExternalId:'1',row:{spend:30,revenueNet:60}}]]);
const raw=(refs,citations=[{observation:'C0/P/3d',metric:'spend'}])=>({reflection:{citations},memoryReview:{reference:'M0',stance:'apply',reason:'x',evidenceReferences:refs}});
const why=r=>{try{resolveEvidenceReferences(r,index);return null;}catch(e){assert.equal(e.code,'CLOUD_MEMORY_REVIEW_EVIDENCE');return e.memoryReviewFailure;}};

test('every evidence-reference refusal carries its fixed reason and position',()=>{
 assert.equal(why(raw([{observation:'C0/P/3d',metric:'spend'}])),null,'a reference to an own citation passes');
 assert.deepEqual(why(raw('C0/P/3d')),{reason:'references_format'});
 assert.deepEqual(why(raw(Array.from({length:9},()=>({observation:'C0/P/3d',metric:'spend'}))) ),{reason:'references_format'});
 assert.deepEqual(why(raw([null])),{reason:'reference_shape',index:0});
 assert.deepEqual(why(raw([{observation:'C9/P/3d',metric:'spend'}])),{reason:'reference_not_in_packet',index:0});
 assert.deepEqual(why(raw([{observation:'C0/P/3d',metric:'secret_metric'}])),{reason:'reference_not_in_packet',index:0});
 assert.deepEqual(why(raw([{observation:'C0/P/3d',metric:'spend',value:10}])),{reason:'reference_shape',index:0},'an extra field is a shape problem');
 assert.deepEqual(why(raw([{observation:'C0/P/3d'}])),{reason:'reference_shape',index:0},'a missing metric is a shape problem');
 assert.deepEqual(why(raw([{observation:'C0/P/7d',metric:'spend'}])),{reason:'not_in_reflection',index:0});
 assert.deepEqual(why(raw([{observation:'C0/P/3d',metric:'spend'}],[{observation:'C0/P/3d',metric:'spend'},{observation:'C0/P/3d',metric:'spend'}])),{reason:'ambiguous_reflection',index:0});
 assert.deepEqual(why(raw([{observation:'C0/P/3d',metric:'spend'},{observation:'C0/P/3d',metric:'spend'}])),{reason:'duplicate_reference',index:1});
});

test('only known labels and small positions survive sanitizing; runtime history keeps the label',()=>{
 assert.equal(safeMemoryReviewFailure({reason:'free text'}),null);
 assert.deepEqual(safeMemoryReviewFailure({reason:'not_in_reflection',index:99,text:'secret'}),{reason:'not_in_reflection'});
 assert.equal(memoryReviewFailureReasons.length,9);
 const e=Object.assign(new Error('x'),{code:'CLOUD_MEMORY_REVIEW_EVIDENCE',memoryReviewFailure:{reason:'not_in_reflection',index:2,raw:'secret'}});
 const r=runtimeFailure({history:[]},e);assert.deepEqual(r.lastFailure.memoryReviewFailure,{reason:'not_in_reflection',index:2});assert.doesNotMatch(JSON.stringify(r),/secret/);
 assert.equal(runtimeFailure({history:[]},Object.assign(new Error('x'),{code:'CLOUD_AI_SCOPE',memoryReviewFailure:{reason:'not_in_reflection'}})).lastFailure.memoryReviewFailure,undefined);
});
