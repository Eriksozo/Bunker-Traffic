import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudEvidenceReferences,referenceCitationSchema,referenceExamples,resolveEvidenceReferences} from '../lib/cloud-evidence-references.mjs';
import {runCloudAnalyst,compactCloudContext} from '../lib/cloud-analysis.mjs';
const row={adAccountId:'a',externalId:'c',spend:123.456789,frontOrders:0,revenueNet:null};
function fixture(){return {campaignReviewPolicy:{version:1},campaigns:[{target:{adAccountId:'a',externalId:'c'},windows:{today:row},hierarchy:[{period:'today',level:'ad',rows:[{adAccountId:'a',externalId:'child',spend:25,frontOrders:1}]}]}]};}
test('References preserve exact numbers and zero from the final packet without mutating sources',()=>{
 const context=fixture(),before=structuredClone(context),index=cloudEvidenceReferences(context),raw={reflection:{citations:[{observation:'C0/P/today',metric:'spend'}]},campaignReadings:[{adAccountId:'a',externalId:'c',citations:[{observation:'C0/H0/R0',metric:'frontOrders'}]}]},original=structuredClone(raw),r=resolveEvidenceReferences(raw,index);
 assert.equal(r.value.reflection.citations[0].value,123.456789);assert.equal(r.value.campaignReadings[0].citations[0].value,1);assert.equal(r.value.campaignReadings[0].citations[0].externalId,'child');assert.equal(r.receipts.length,2);assert.deepEqual(context,before);assert.deepEqual(raw,original);
 assert.equal(resolveEvidenceReferences({reflection:{citations:[{observation:'C0/P/today',metric:'frontOrders'}]}},index).value.reflection.citations[0].value,0);
});
test('Missing, null, forged values, extra fields and cross-campaign references never resolve into financial facts',()=>{
 const index=cloudEvidenceReferences(fixture());for(const c of [{observation:'foreign',metric:'spend'},{observation:'C0/P/today',metric:'revenueNet'},{observation:'C0/P/today',metric:'spend',value:0},{observation:'C0/P/today',metric:'unknown'}])assert.throws(()=>resolveEvidenceReferences({reflection:{citations:[c]}},index),e=>e.code==='CLOUD_REFLECTION_CITATION');
 assert.throws(()=>resolveEvidenceReferences({campaignReadings:[{adAccountId:'foreign',externalId:'c',citations:[{observation:'C0/P/today',metric:'spend'}]}]},index),e=>e.code==='CLOUD_CAMPAIGN_READING_EVIDENCE');
});
test('The model selects a child reference; existing validators still verify the exact resolved citation',async()=>{
 let request;const result=await runCloudAnalyst({run:async(_m,r)=>{request=r;const body=JSON.parse(r.messages[1].content),example=body.evidenceSelection.campaignExamples[0];return {response:{decision:'Observar',reason:'Aquisição do filho conferida.',nextStep:'Comparar novas vendas.',text:'Leitura da campanha priorizada.',suggestions:[],question:null,campaignReadings:[{...example,assessment:'observe',reason:'Conferir aquisição nova.'}]}};}},'creative',fixture());
 assert.equal(result.campaignReadings[0].citations[0].externalId,'child');assert.equal(result.evidenceSelections.length,2);const citation=request.response_format.json_schema.properties.campaignReadings.items.properties.citations.items;assert.ok(citation.properties.observation.enum.includes('C0/H0/R0'));assert.ok(!citation.properties.observation.enum.includes('C0/P/today'));assert.equal(citation.properties.value,undefined);
});
test('Legacy exact citations remain validated; authored numbers are never silently corrected',async()=>{
 const context=fixture(),out={decision:'Observar',reason:'Conferir aquisição.',nextStep:'Comparar novas vendas.',text:'Leitura da campanha.',suggestions:[],question:null,campaignReadings:[{adAccountId:'a',externalId:'c',assessment:'observe',reason:'Conferir',citations:[{period:'today',level:'campaign',externalId:'c',metric:'spend',value:999}]}]};await assert.rejects(runCloudAnalyst({run:async()=>({response:out})},'traffic',context),e=>e.code==='CLOUD_CAMPAIGN_READING_EVIDENCE');
});
test('Only final compacted packet references are enumerated, and empty data does not gain invented examples',()=>{
 const input=fixture();input.campaigns.push({...structuredClone(input.campaigns[0]),target:{adAccountId:'b',externalId:'other'},hierarchy:[]});const index=cloudEvidenceReferences(input),schema=referenceCitationSchema(index,true);assert.deepEqual(schema.properties.observation.enum,['C0/H0/R0']);assert.deepEqual(referenceExamples([{adAccountId:'a',externalId:'c',period:'today',level:'campaign',metric:'spend',value:row.spend}],index),[{observation:'C0/P/today',metric:'spend'}]);assert.deepEqual(referenceExamples([{...row,period:'today',level:'campaign',metric:'spend',value:0}],index),[]);
 assert.equal(cloudEvidenceReferences({campaigns:[]}).size,0);assert.deepEqual(referenceCitationSchema(new Map()).properties,{});
});
