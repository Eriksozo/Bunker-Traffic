import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {cloudOutputContract,cloudGenerationProfile} from '../lib/cloud-output-contract.mjs';
import {cloudOpinionSchema,runCloudAnalyst} from '../lib/cloud-analysis.mjs';
const base=()=>{const s=z.toJSONSchema(cloudOpinionSchema,{target:'draft-7'});delete s.$schema;s.required.push('reflection','campaignReadings');s.properties.campaignReadings.minItems=6;s.properties.campaignReadings.maxItems=6;s.properties.reflection.properties.peerChecks.minItems=3;s.properties.reflection.properties.citations.minItems=1;return s;};
const value={decision:'Observar',reason:'Conferir aquisição.',nextStep:'Comparar novas compras.',text:'Seis campanhas priorizadas nesta unidade.',suggestions:[],question:null};
test('Compact generation changes prose caps only, preserving exact coverage, peer checks, identity and evidence constraints',()=>{
 const s=base(),before=structuredClone(s),out=cloudOutputContract(s,{campaigns:[]});
 const withoutCaps=x=>{const copy=structuredClone(x);const walk=n=>{if(n&&typeof n==='object'){delete n.maxLength;for(const v of Object.values(n))walk(v);}};walk(copy);return copy;};
 assert.deepEqual(withoutCaps(out.schema),withoutCaps(s));assert.deepEqual(s,before);assert.equal(out.schema.properties.campaignReadings.minItems,6);assert.equal(out.schema.properties.campaignReadings.maxItems,6);assert.equal(out.schema.properties.reflection.properties.peerChecks.minItems,3);assert.equal(out.schema.properties.reflection.properties.citations.minItems,1);assert.equal(out.schema.properties.text.maxLength,1600);assert.equal(out.schema.properties.campaignReadings.items.properties.reason.maxLength,180);
 assert.match(out.requirements.rule,/TODOS os alvos/);assert.match(out.requirements.rule,/nunca a evidência/);
});
test('Dialogue, review and owner answers receive shorter generation guidance without widening the base schema',()=>{
 for(const [context,phase,max] of [[{},'stage',1600],[{receivedQuestion:{id:'q'}},'dialogue',1000],[{proposal:{id:'p'}},'proposal-review',1200],[{ownerQuestion:'Pergunta'},'owner-question',1000]]){
  const s=base(),out=cloudOutputContract(s,context);assert.equal(out.requirements.phase,phase);assert.equal(out.schema.properties.text.maxLength,max);assert.equal(out.schema.properties.question.anyOf.find(x=>x.type==='object').properties.text.maxLength,360);assert.equal(out.schema.properties.suggestions.items.properties.learning.anyOf.find(x=>x.type==='object').properties.reason.maxLength,240);
 }
 const s=base();s.properties.text.maxLength=500;assert.equal(cloudOutputContract(s,{}).schema.properties.text.maxLength,500);
});
test('Output receipts measure final content and numeric usage without copying content, reasoning or forged model metrics',()=>{
 const raw={...value,text:'á'.repeat(10)},before=structuredClone(raw),req=cloudOutputContract(base(),{}).requirements;
 const p=cloudGenerationProfile({usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300,reasoning:'secret'},choices:[{message:{reasoning_content:'secret'}}]},raw,req,6400);
 assert.equal(p.textCharacters,10);assert.equal(p.textWithinRequestedCap,true);assert.equal(p.finalOutputBytes,new TextEncoder().encode(JSON.stringify(raw)).length);assert.deepEqual(p.usage,{prompt_tokens:100,completion_tokens:200,total_tokens:300});assert.doesNotMatch(JSON.stringify(p),/secret|Seis campanhas/);assert.deepEqual(raw,before);
 assert.deepEqual(cloudGenerationProfile({},raw,req,6400).usage,{});assert.equal(cloudGenerationProfile({},{...raw,text:'x'.repeat(1700)},req,6400).textWithinRequestedCap,false);
});
test('The real model request gets compact guidance while six target readings and numeric validation remain mandatory',async()=>{
 const c={project:'p',campaignReviewPolicy:{version:1},campaigns:Array.from({length:6},(_,i)=>({target:{adAccountId:'a',externalId:'c'+i},windows:{today:{spend:100+i}},hierarchy:[]})),priorOpinions:[]};let calls=0;const packets=[];
 const ai={run:async(_model,r)=>{calls++;const body=JSON.parse(r.messages[1].content);packets.push(body);assert.equal(r.max_tokens,6400);assert.equal(r.response_format.json_schema.schema.properties.text.maxLength,1600);assert.equal(r.response_format.json_schema.schema.properties.campaignReadings.minItems,6);const readings=body.evidenceSelection.campaignExamples.map(e=>({...e,assessment:'observe',reason:'Conferir aquisição própria.'}));return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...value,campaignReadings:readings})}}],usage:{prompt_tokens:1200,completion_tokens:900,total_tokens:2100}};}};
 const out=await runCloudAnalyst(ai,'traffic',c,'wide');assert.equal(calls,1);assert.equal(packets[0].outputRequirements.phase,'stage');assert.equal(out.analysisTargets.length,6);assert.equal(out.campaignReadings.length,6);assert.equal(out.generationProfile.usage.completion_tokens,900);assert.equal(out.generationProfile.textWithinRequestedCap,true);assert.equal(out.suggestions.length,0);
 const bad={run:async(_model,r)=>{const b=JSON.parse(r.messages[1].content);return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...value,campaignReadings:b.evidenceSelection.campaignExamples.slice(1).map(e=>({...e,assessment:'observe',reason:'Alvo omitido.'}))})}}]};}};
 await assert.rejects(runCloudAnalyst(bad,'traffic',c,'wide'),e=>e.code==='CLOUD_CAMPAIGN_READING_REQUIRED');
});

test('A complete valid long answer is preserved verbatim and excess guidance is measured, never silently cut or relabeled',async()=>{
 const text='Parecer autoral completo. '.repeat(80),raw={...value,text,generationProfile:{version:99,financialSuccessRate:1}},out=await runCloudAnalyst({run:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]})},'traffic',{campaigns:[]},'wide');
 assert.equal(out.text,text);assert.equal(out.generationProfile.textCharacters,text.length);assert.equal(out.generationProfile.textWithinRequestedCap,false);assert.equal(out.generationProfile.version,1);assert.equal(out.generationProfile.financialSuccessRate,undefined);assert.deepEqual(out.generationProfile.usage,{});
});
