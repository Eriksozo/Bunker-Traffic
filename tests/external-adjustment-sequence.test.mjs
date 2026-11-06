import test from 'node:test';
import assert from 'node:assert/strict';
import {externalAdjustmentSequence,externalSequencePolicy} from '../lib/external-adjustment-sequence.mjs';
import {externalLearningRecall,readExternalLearningCases} from '../lib/external-learning.mjs';
import {cloudAgentMemory} from '../lib/agent-development.mjs';
import {learningInputReceipt} from '../lib/learning-input-receipt.mjs';
import {compactCloudContext} from '../lib/cloud-analysis.mjs';
import {modelPacketView} from '../lib/cloud-packet-economy.mjs';
import {readDecisionExamples} from '../lib/decision-learning-view.mjs';
import {sequenceFixture,now,row} from './fixtures/external-sequence.mjs';
test('Revalidated memory exposes the observed scale-scale-reduce-pause sequence without turning the compound case into efficacy',async()=>{
 const f=await sequenceFixture(),before=structuredClone(f.state),sequence=f.recall.adjustmentSequence;
 assert.equal(f.recall.classification,'Inconclusivo');assert.deepEqual(sequence.steps.map(s=>s.action),['increase','increase','reduce','pause']);assert.deepEqual(sequence.steps.slice(0,3).map(s=>[s.before,s.after]),[[100,120],[120,180],[180,90]]);assert.ok(sequence.steps.every(s=>s.currency==='USD'&&s.actor.name==='Gestor'));assert.equal(f.recall.before.metricsCurrency,'BRL');assert.equal(sequence.steps.filter(s=>s.selectedEvent).length,1);assert.equal(sequence.steps.at(-1).selectedEvent,true);assert.ok(sequence.steps.every(s=>s.metaApplicationObserved));assert.equal(sequence.otherChanges.some(c=>c.objectId==='child'&&c.category==='creative'),true);assert.equal(sequence.financialClassification,'Inconclusivo');assert.equal(sequence.coverage.kind,'comparison-referenced-items-only');
 for(const role of ['traffic','creative','budget','ops']){const memory=cloudAgentMemory(f.state,{id:'next',project:'p'},role,[row],{items:[],actionOutcomes:[]},now);assert.deepEqual(memory.externalResults[0].adjustmentSequence,sequence);assert.equal(memory.measuredOutcomes.length,0);assert.equal(memory.externalResults[0].executionByBunker,false);}
 assert.deepEqual(f.state,before);assert.equal(f.state.executions,undefined);assert.equal(f.state.proposals,undefined);
});
test('Each step preserves whether Meta confirmation exists; one echoed action cannot confirm its neighbors',async()=>{
 const f=await sequenceFixture(),unconfirmed=f.state.decisionHistory.find(e=>e.action==='reduce');delete unconfirmed.nativeEcho;unconfirmed.originObservations=[];const sequence=externalAdjustmentSequence(f.state,f.event,f.comparison,now);
 assert.equal(sequence.steps.find(s=>s.action==='reduce').metaApplicationObserved,false);assert.equal(sequence.steps.find(s=>s.selectedEvent).metaApplicationObserved,true);assert.equal(sequence.financialClassification,'Inconclusivo');
});
test('Automatic processing transitions do not crowd out budget changes, pauses or activations; a selected status is still retained',async()=>{
 const f=await sequenceFixture(),comparison=structuredClone(f.comparison);
 for(let i=0;i<20;i++){const id='processing-'+i,e={...f.event,id,eventKey:JSON.stringify(['p',id]),field:'status',action:'status',before:i%2?'PROCESSING':'ACTIVE',after:i%2?'ACTIVE':'PROCESSING',automatic:true,occurredAt:new Date(Date.parse(f.event.occurredAt)+i*1000).toISOString()};f.state.decisionHistory.push(e);comparison.competingEventIds.push(id);}
 const sequence=externalAdjustmentSequence(f.state,f.event,comparison,now);
 assert.equal(sequence.steps.length,6);assert.equal(sequence.coverage.knownDecisionSteps,4);assert.equal(sequence.coverage.shownDecisionSteps,4);assert.equal(sequence.coverage.omittedDecisionSteps,0);assert.equal(sequence.coverage.knownOperationalStatuses,20);assert.equal(sequence.coverage.shownOperationalStatuses,2);assert.deepEqual(sequence.steps.filter(s=>s.action!=='status').map(s=>s.action),['increase','increase','reduce','pause']);assert.equal(sequence.financialClassification,'Inconclusivo');
 const selectedStatus=f.state.decisionHistory.find(e=>e.id==='processing-0'),statusSequence=externalAdjustmentSequence(f.state,selectedStatus,{...comparison,eventId:selectedStatus.id,competingEventIds:[...comparison.competingEventIds,f.event.id]},now);
 assert.equal(statusSequence.steps.find(s=>s.selectedEvent).historyId,selectedStatus.id);assert.equal(statusSequence.coverage.shownDecisionSteps,4);
});
test('Foreign identities, invalid values, heating, missing and ambiguous references remain omitted with explicit counts',async()=>{
 const f=await sequenceFixture();
 for(const mutate of [e=>e.project='q',e=>e.adAccountId='foreign',e=>e.objectId='foreign',e=>e.currency='BRL',e=>e.before=NaN,e=>e.name='[ENGAJAMENTO]',e=>e.occurredAt=new Date(now+1).toISOString(),e=>e.action='keep']){
  const state=structuredClone(f.state),e=state.decisionHistory.find(e=>e.action==='increase');mutate(e);const sequence=externalAdjustmentSequence(state,f.event,f.comparison,now);assert.equal(sequence.coverage.unavailableReferences,1);assert.equal(sequence.steps.length,3);
 }
 const state=structuredClone(f.state),duplicate=state.decisionHistory.find(e=>e.action==='reduce');state.decisionHistory.push(structuredClone(duplicate));let sequence=externalAdjustmentSequence(state,f.event,f.comparison,now);assert.equal(sequence.coverage.unavailableReferences,1);assert.equal(sequence.steps.some(s=>s.historyId===duplicate.id),false);
 state.decisionHistory=state.decisionHistory.filter(e=>e.id!==f.event.id);sequence=externalAdjustmentSequence(state,f.event,f.comparison,now);assert.equal(sequence.coverage.selectedEventAvailable,false);assert.equal(sequence.coverage.unavailableReferences,2);
 assert.equal(externalAdjustmentSequence(f.state,f.event,{...f.comparison,project:'q'},now),null);
});
test('Context is bounded, time ties do not invent order, and raw descriptors are not counted as additional ledger actions',async()=>{
 const f=await sequenceFixture(),comparison=structuredClone(f.comparison);
 for(let i=0;i<12;i++){const id='extra-'+i,e={...f.event,id,eventKey:JSON.stringify(['p',id]),field:'dailyBudget',action:'increase',before:100+i,after:101+i,occurredAt:new Date(Date.parse(f.event.occurredAt)+(i?i:0)*1000).toISOString()};f.state.decisionHistory.push(e);comparison.competingEventIds.push(id);const key='raw-'+i;f.state.historyLearning.changes.push({key,project:'p',adAccountId:'a',campaignExternalId:'c',objectExternalId:'child-'+i,level:'ad',category:'creative',source:'meta',at:e.occurredAt});comparison.otherChangeKeys.push(key);}
 const before=structuredClone(f.state),sequence=externalAdjustmentSequence(f.state,f.event,comparison,now);
 assert.equal(sequence.steps.length,externalSequencePolicy.maximumSteps);assert.equal(sequence.otherChanges.length,externalSequencePolicy.maximumOtherChanges);assert.ok(sequence.coverage.omittedSteps>0);assert.ok(sequence.coverage.omittedOtherChanges>0);assert.equal(sequence.coverage.hasTimeTies,true);assert.equal(sequence.coverage.knownSteps,16);assert.equal(sequence.financialClassification,'Inconclusivo');assert.deepEqual(f.state,before);
});
test('The case journal distinguishes recorded classification from current revalidation and scopes its cursor',async()=>{
 const f=await sequenceFixture();f.state.decisionHistoryOutcomes[0].classification='Favorável';f.state.decisionHistoryOutcomes.push({...structuredClone(f.comparison),id:'copy',observedAt:new Date(now-100).toISOString()});const before=structuredClone(f.state),first=readDecisionExamples(f.state,{entry:{journal:'external-outcomes'},projectId:'p',limit:1});
 assert.equal(first.items[0].revalidated,true);assert.equal(first.items[0].classification,'Inconclusivo');assert.equal(first.items[0].recordedClassification,'Favorável');assert.ok(first.nextCursor);const next=readExternalLearningCases(f.state,{projectId:'p',limit:1,cursor:first.nextCursor},now);assert.equal(next.items.length,1);assert.notEqual(next.items[0].id,first.items[0].id);assert.equal(next.nextCursor,null);assert.throws(()=>readExternalLearningCases(f.state,{projectId:'q',cursor:first.nextCursor},now),/Cursor/);assert.deepEqual(f.state,before);
 f.state.externalHistoryMeasurements=[];const missing=readExternalLearningCases(f.state,{projectId:'p'},now);assert.ok(missing.items.every(c=>!c.revalidated&&c.classification==='N/D'&&c.adjustmentSequence===undefined));assert.equal(f.state.decisionHistoryOutcomes[0].classification,'Favorável');
});
test('A changed stored comparison identity cannot borrow a different valid event’s metrics or chronology',async()=>{
 const f=await sequenceFixture();f.state.decisionHistoryOutcomes[0].eventKey='forged';assert.deepEqual(externalLearningRecall(f.state,'p',[row],now),[]);const read=readExternalLearningCases(f.state,{projectId:'p'},now);assert.equal(read.items[0].revalidated,false);assert.equal(read.items[0].classification,'N/D');assert.equal(read.items[0].before,undefined);
});
test('Optional chronology is deferred before current campaigns or children, and its delivery receipt cannot claim omitted steps',async()=>{
 const f=await sequenceFixture(),campaigns=Array.from({length:6},(_,i)=>({target:{adAccountId:'a',externalId:'c'+i},windows:{today:{spend:100+i,frontOrders:0}},hierarchy:[{period:'today',level:'ad',rows:[{adAccountId:'a',externalId:'ad'+i,spend:10,frontOrders:0},{adAccountId:'a',externalId:'ad-other'+i,spend:20,frontOrders:0}]}]})),context={project:'p',role:'traffic',campaigns,agentMemory:{role:'traffic',externalResults:[f.recall]}},base=structuredClone(context);delete base.agentMemory.externalResults[0].adjustmentSequence;
 const maxBytes=new TextEncoder().encode(JSON.stringify(modelPacketView(base))).length+512,before=structuredClone(context),result=compactCloudContext(context,maxBytes);
 assert.equal(result.campaigns.length,6);assert.ok(result.campaigns.every(c=>c.hierarchy[0].rows.length===2&&c.windows.today.frontOrders===0));assert.equal(result.agentMemory.externalResults[0].adjustmentSequence,undefined);assert.equal(result.agentMemory.externalResults[0].sequenceDeferred.reason,'packet-budget');assert.deepEqual(result.coverage.deferredHistorySequences,[f.recall.outcomeId]);assert.deepEqual(result.agentMemory.externalResults[0].limits,f.recall.limits);assert.deepEqual(learningInputReceipt(result).externalCases[0].sequence,{included:false,deferred:true});
 const receipt=learningInputReceipt(context).externalCases[0].sequence;assert.equal(receipt.included,true);assert.equal(receipt.historyIds.length,4);assert.ok(receipt.fingerprint);assert.equal(JSON.stringify(receipt).includes('Gestor'),false);assert.deepEqual(context,before);
});
