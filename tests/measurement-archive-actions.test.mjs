import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {retainKnowledgeMeasurements,recordOutcome} from '../lib/knowledge.mjs';
import {archiveColdMeasurements,loadMeasurementsForAction} from '../lib/measurement-archive.mjs';
import {assessLearningOutcome} from '../lib/learning-cycle.mjs';

// Review of 14/11/2026, before the last publication of the round:
// 1. a result saved from snapshots carries no measurementId; its sides must stay loaded (exact pin) once the snapshots roll;
// 2. a new result must reach archived measurements through the real MCP action (agentAutonomyWithArchive), not by a test
//    injecting them. Fixture from the reviewer's offline reproduction; synthetic, no provider, no order.
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const bundled=await build({entryPoints:[root+'lib/autonomy.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:['cloudflare:workers'],logLevel:'silent',absWorkingDir:root});
const autonomyModule={exports:{}};
new Function('module','exports','require',bundled.outputFiles[0].text)(autonomyModule,autonomyModule.exports,id=>id==='cloudflare:workers'?{env:{}}:require(id.startsWith('@/')?root+id.slice(2):id));
const {agentAutonomyWithArchive}=autonomyModule.exports;
const later='2027-03-01T00:00:00.000Z';

function coldFixture(){
 const s={config:{john:{projectName:'John'}},decisions:[{id:'decision-a',project:'john',objectId:'campaign-a',status:'Aplicada pelo operador',appliedAt:'2026-10-29T12:00:00.000Z'}],knowledge:[],snapshots:[]};
 const b={from:'2026-10-28T00:00:00.000Z',to:'2026-10-29T00:00:00.000Z'},a={from:'2026-10-30T00:00:00.000Z',to:'2026-10-31T00:00:00.000Z'},f='2026-11-02T16:00:00.000Z';
 const bm={spend:400,revenueNet:700,adCosts:10,productCost:10,saleTax:5,frontOrders:2},am={...bm,spend:500,revenueNet:1000,frontOrders:4};
 const snap=(w,metrics)=>({projectId:'john',source:'Malva MCP',complete:true,level:'campaign',timezone:'UTC',...w,fetchedAt:f,rows:[{externalId:'campaign-a',adAccountId:'account-john',...metrics}]});
 s.snapshots=[snap(b,bm),snap(a,am)];retainKnowledgeMeasurements(s,'2026-11-02T18:00:00.000Z');
 // Unrelated evidence of another object: the narrow lookup must not load it.
 s.knowledgeMeasurements.push({...structuredClone(s.knowledgeMeasurements[0]),id:'other',key:'other',externalId:'campaign-z',reference:'measurement:other'});
 const src=(reference,w)=>({system:'Malva MCP',reference,observedAt:f,...w,summary:'Leitura conferida.'});
 const input={project:'john',objectId:'campaign-a',proposalId:'decision-a',before:{...b,metrics:bm},after:{...a,metrics:am},sources:[src('before',b),src('after',a)],summary:'Comparação sem causalidade.'};
 return {s,input};
}
function recordsOf(out){
 const records=new Map(out.records.map(x=>[x.key,JSON.stringify(x.payload)])),asked=[];
 return {records,asked,fetch:async keys=>{asked.push(...keys);return keys.filter(k=>records.has(k)).map(k=>({key:k,payload:records.get(k)}));}};
}

test('a result saved from snapshots (no measurementId) pins its exact sides: still verified after the snapshots roll',async()=>{
 const {s,input}=coldFixture(),o=recordOutcome(s,input,later);
 assert.equal(o.before.measurementId,undefined);assert.equal(assessLearningOutcome(s,o,Date.parse(later)).verified,true);
 s.snapshots=[];const r=await archiveColdMeasurements(s,Date.parse(later));
 assert.equal(r.archived,1,'only the unrelated measurement leaves');assert.deepEqual(s.knowledgeMeasurements.map(m=>m.externalId).sort(),['campaign-a','campaign-a']);
 assert.equal(assessLearningOutcome(s,o,Date.parse(later)).verified,true);
 // Exact, not broad: a side whose metrics differ pins nothing.
 const other=structuredClone(s);other.knowledgeOutcomes[0].after.metrics.spend=1;
 await archiveColdMeasurements(other,Date.parse(later));assert.deepEqual(other.knowledgeMeasurements.map(m=>m.metrics.spend),[400]);
});

test('production action: an outcome on archived measurements loads only its windows, records, keeps them pinned, fails closed on a bad record',async()=>{
 const {s,input}=coldFixture();s.snapshots=[];
 const out=await archiveColdMeasurements(s,Date.parse(later));assert.equal(out.archived,3);assert.deepEqual(s.knowledgeMeasurements,[]);
 const {records,asked,fetch}=recordsOf(out);
 // The regression the review found: without the archive lookup the same action fails.
 assert.throws(()=>recordOutcome(structuredClone(s),input,later),/falta leitura/);
 const state=structuredClone(s),record=await agentAutonomyWithArchive(state,{action:'outcome',entry:input},fetch);
 assert.equal(record.before.metrics.spend,400);assert.equal(record.after.metrics.spend,500);assert.ok(record.before.measurementId&&record.after.measurementId);
 assert.deepEqual(state.knowledgeMeasurements.map(m=>m.externalId).sort(),['campaign-a','campaign-a'],'the unrelated measurement is not loaded');
 assert.equal(assessLearningOutcome(state,record,Date.parse(later)).verified,true);
 assert.equal((await archiveColdMeasurements(state,Date.parse(later))).archived,0,'the recorded result keeps them pinned');
 // A non-outcome action never reads the archive.
 asked.length=0;
 await assert.rejects(agentAutonomyWithArchive(structuredClone(s),{action:'nope'},fetch),/não permitida/);assert.deepEqual(asked,[]);
 // Missing or altered record: fails closed, nothing recorded.
 const key=s.knowledgeMeasurementArchive.segments[0].key,bad=structuredClone(s);
 await assert.rejects(agentAutonomyWithArchive(bad,{action:'outcome',entry:input},async keys=>(await fetch(keys)).filter(r=>r.key!==key)),e=>e.code==='STORAGE_INTEGRITY');
 assert.equal(bad.knowledgeOutcomes,undefined);
 const forged=JSON.parse(records.get(key));forged.rawBytes+=1;
 await assert.rejects(agentAutonomyWithArchive(structuredClone(s),{action:'outcome',entry:input},async keys=>(await fetch(keys)).map(r=>r.key===key?{key,payload:JSON.stringify(forged)}:r)),e=>e.code==='STORAGE_INTEGRITY');
});

test('decisionHistoryOutcome action: the lookup uses only the request rows (account, object) and windows',async()=>{
 const {s}=coldFixture();s.snapshots=[];const {fetch}=recordsOf(await archiveColdMeasurements(s,Date.parse(later)));
 const w=(from,to)=>({from,to,rows:[{externalId:'campaign-a',adAccountId:'account-john'}]});
 const state=structuredClone(s),added=await loadMeasurementsForAction(state,{action:'decisionHistoryOutcome',entry:{project:'john',before:w('2026-10-28T00:00:00.000Z','2026-10-29T00:00:00.000Z'),after:w('2026-10-30T00:00:00.000Z','2026-10-31T00:00:00.000Z')}},fetch);
 assert.equal(added.size,2);assert.ok(state.knowledgeMeasurements.every(m=>m.externalId==='campaign-a'));
});
