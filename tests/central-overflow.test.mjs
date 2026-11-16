// Owner report of 2026-11-16 (notch: "Armazenamento central em 86% do limite", "isso nunca pode acontecer"):
// measured results become a journal, and an overflow valve keeps the central under its target by construction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {commitPersistedState,readPersistedState,centralByteLimit} from '../lib/persistence.mjs';
import {hydrateCoreState} from '../lib/core-storage.mjs';
import {hydrateCoreState as edgeHydrateCoreState} from '../supabase/functions/malva-mcp/core-storage.mjs';
import {overflowStorage,overflowCandidates,packHistoryState,hydrateHistoryState} from '../lib/history-storage.mjs';
import {database} from './helpers/e2e-scenario.mjs';

const P='11111111-1111-4111-8111-111111111111';
// Large states: compare without printing them on failure.
const same=(a,b,message)=>assert.ok(isDeepStrictEqual(a,b),message);
const base=()=>({config:{[P]:{projectName:'QA'}},snapshots:[],jobs:[],agents:{},reports:[],events:[],messages:[],tasks:[],decisions:[],paused:false,autonomy:{enabled:false,campaigns:{}},proposals:[{id:'p1',project:P}],executions:[{id:'e1',proposalId:'p1'}]});
// Incompressible text: base64 of random bytes (4 characters per 3 bytes).
const noise=n=>randomBytes(n).toString('base64');
const outcome=(i,extra={})=>({id:'o'+i,project:P,eventKey:'ev'+i,observedAt:'2026-11-15T10:00:00Z',classification:'Inconclusivo',otherChangeKeys:Array.from({length:30},(_,k)=>'["'+P+'","chg-'+i+'-'+k+'"]'),summary:'s'+i,request:{q:noise(200)},before:{spend:i},after:{spend:i+1},...extra});
const centralRow=db=>db.d.prepare("SELECT payload FROM bunker_records WHERE key='central'").get().payload;
const rowCount=db=>db.d.prepare('SELECT count(*) n FROM bunker_records').get().n;
const storedRow=db=>{const {_commitToken,...stored}=JSON.parse(centralRow(db));return stored;};
const storedCore=async db=>hydrateCoreState(storedRow(db));
// A map heavy enough (incompressible) to push the central above the valve target on its own.
const heavyCoverage=(entries,size)=>Object.fromEntries(Array.from({length:entries},(_,i)=>['cmp-'+String(entries-i).padStart(4,'0'),{project:P,roles:{traffic:noise(size)}}]));

test('Measured results leave the central: journaled stubs, evidence in its own record, exact read, no resend', async () => {
 const db=database(),state={...base(),decisionHistoryOutcomes:Array.from({length:95},(_,i)=>outcome(i))};
 const saved=await commitPersistedState(db.api,state,0);
 const core=await storedCore(db);
 assert.equal(core.decisionHistoryOutcomes,undefined,'no result inline in the central');
 assert.deepEqual(core.journalStorage.journals.decisionHistoryOutcomes.map(s=>s.count),[40,40,15]);
 const read=await readPersistedState(db.api,base);
 same(read.state,saved.state,'the commit returns what the next read returns');
 assert.deepEqual(read.state.decisionHistoryOutcomes,state.decisionHistoryOutcomes,'every result comes back with its evidence');
 assert.equal(JSON.stringify(read.state.decisionHistoryOutcomes[7]),JSON.stringify(state.decisionHistoryOutcomes[7]),'same key order inside a result');
 const before=rowCount(db);
 const again=await commitPersistedState(db.api,read.state,read.revision);
 assert.equal(rowCount(db),before,'a second commit writes no new record');
 // One more result: only the last segment and its own evidence are new.
 await commitPersistedState(db.api,{...again.state,decisionHistoryOutcomes:[...again.state.decisionHistoryOutcomes,outcome(95)]},again.revision);
 assert.equal(rowCount(db),before+2,'one new segment, one new evidence record');
 const last=await readPersistedState(db.api,base);
 assert.equal(last.state.decisionHistoryOutcomes.length,96);assert.deepEqual(last.state.decisionHistoryOutcomes[95],outcome(95,{request:last.state.decisionHistoryOutcomes[95].request}));
});

test('The valve moves the largest listed field when the central passes the target, and the central stays under it', async () => {
 const db=database(),coverage=heavyCoverage(300,3000),state={...base(),campaignReviewCoverage:coverage,learningReviews:[{id:'r1',note:'small'}]};
 const saved=await commitPersistedState(db.api,state,0);
 const size=Buffer.byteLength(centralRow(db));
 assert.ok(size<=centralByteLimit*overflowStorage.target,'central at '+(100*size/centralByteLimit).toFixed(1)+'% after the valve');
 const core=await storedCore(db);
 assert.ok(core.campaignReviewCoverage===undefined,'the heavy map left the central');
 assert.deepEqual(core.learningReviews,[{id:'r1',note:'small'}],'a small field stays inline: only what is needed moves');
 assert.deepEqual(saved.storage.history.overflow,['campaignReviewCoverage']);
 const read=await readPersistedState(db.api,base);
 same(read.state,saved.state,'the commit returns what the next read returns');
 assert.deepEqual(Object.keys(read.state.campaignReviewCoverage),Object.keys(coverage),'the map keeps its key order');
 assert.ok(JSON.stringify(read.state.campaignReviewCoverage)===JSON.stringify(coverage),'the map reads back byte for byte');
 assert.deepEqual(read.storage.history.overflow,['campaignReviewCoverage']);
 // Sticky: once moved, a much smaller map stays moved (no back and forth near the line).
 const small={'cmp-1':{project:P,roles:{}}};
 const next=await commitPersistedState(db.api,{...read.state,campaignReviewCoverage:small},read.revision);
 assert.ok((await storedCore(db)).campaignReviewCoverage===undefined,'still out of the central');
 const reread=await readPersistedState(db.api,base);
 assert.deepEqual(reread.state.campaignReviewCoverage,small);same(reread.state,next.state,'commit and read agree after the shrink');
 // The display (lean) read loads moved fields too.
 const lean=await readPersistedState(db.api,base,{lean:true});
 assert.deepEqual(lean.state.campaignReviewCoverage,small,'a display reader still sees a moved field');
 assert.deepEqual(lean.storage.history.overflow,['campaignReviewCoverage']);
});

test('The valve moves several fields, largest first, and never a field the Edge dispatch or the configuration reads', async () => {
 // ~91% of the limit in all: moving the largest (coverage, ~29%) is not enough, the second (knowledge) is.
 const db=database(),proposals=[{id:'p1',project:P,evidence:noise(337500)}];
 const state={...base(),proposals,campaignReviewCoverage:heavyCoverage(125,3000),knowledge:Array.from({length:100},(_,i)=>({id:'k'+i,text:noise(3375)})),jobs:Array.from({length:50},(_,i)=>({id:'j'+i,note:noise(3000)})),events:[{id:'ev1'}]};
 assert.deepEqual(overflowCandidates(state),['campaignReviewCoverage','knowledge','jobs','events']);
 await commitPersistedState(db.api,state,0);
 const size=Buffer.byteLength(centralRow(db));
 assert.ok(size<=centralByteLimit*overflowStorage.target,'central at '+(100*size/centralByteLimit).toFixed(1)+'%');
 const stored=storedRow(db),core=await hydrateCoreState(stored);
 assert.ok(core.campaignReviewCoverage===undefined&&core.knowledge===undefined,'the two largest moved');
 assert.ok(Array.isArray(core.jobs)&&core.jobs.length===50,'the third stays: the target was reached before');assert.deepEqual(core.events,[{id:'ev1'}]);
 // The Edge reads the core only: what it needs is never moved.
 const edge=await edgeHydrateCoreState(stored);
 for(const k of ['executions','proposals','paused','autonomy','config'])assert.ok(JSON.stringify(edge[k])===JSON.stringify(state[k]),k+' stays readable by the Edge');
 for(const k of ['executions','proposals','paused','autonomy','config','cadence','agents','snapshots','reports'])assert.ok(!(k in overflowStorage.fields),k+' is never listed');
 const read=await readPersistedState(db.api,base);
 for(const k of ['campaignReviewCoverage','knowledge','jobs','events','proposals'])assert.ok(JSON.stringify(read.state[k])===JSON.stringify(state[k]),k+' reads back exactly');
});

test('Moved fields fail closed: missing or altered segment, unknown name, a field also inline', async () => {
 const db=database();
 await commitPersistedState(db.api,{...base(),campaignReviewCoverage:heavyCoverage(300,3000)},0);
 const stored=storedRow(db),core=await hydrateCoreState(stored),seg=core.journalStorage.journals.campaignReviewCoverage[0].key;
 const rows=new Map(db.d.prepare('SELECT key,payload FROM bunker_records').all().map(r=>[r.key,r.payload]));
 const fetchFrom=map=>async keys=>keys.filter(k=>map.has(k)).map(k=>({key:k,payload:map.get(k)}));
 const without=new Map(rows);without.delete(seg);
 await assert.rejects(hydrateHistoryState(core,fetchFrom(without)),e=>e.code==='STORAGE_INTEGRITY','missing segment');
 const other=core.journalStorage.journals.campaignReviewCoverage[1].key,swapped=new Map(rows);swapped.set(seg,rows.get(other));
 await assert.rejects(hydrateHistoryState(core,fetchFrom(swapped)),e=>e.code==='STORAGE_INTEGRITY','altered segment');
 const unknown=structuredClone(core);unknown.journalStorage.journals.somethingElse=unknown.journalStorage.journals.campaignReviewCoverage;delete unknown.journalStorage.journals.campaignReviewCoverage;
 await assert.rejects(hydrateHistoryState(unknown,fetchFrom(rows)),e=>e.code==='STORAGE_INTEGRITY','unknown name');
 await assert.rejects(hydrateHistoryState({...core,campaignReviewCoverage:{}},fetchFrom(rows)),e=>e.code==='STORAGE_INTEGRITY','moved and also inline');
 const bad=await packHistoryState({...base(),campaignReviewCoverage:{a:1}},Date.now(),{overflow:['campaignReviewCoverage']});
 const badRows=new Map(bad.archives.map(a=>[a.key,JSON.stringify(a.payload)]));
 assert.deepEqual((await hydrateHistoryState(bad.state,fetchFrom(badRows))).campaignReviewCoverage,{a:1},'a well-formed one reads back');
 // A lean read refuses the same faults.
 await assert.rejects(hydrateHistoryState(core,fetchFrom(without),{lean:true}),e=>e.code==='STORAGE_INTEGRITY','lean: missing segment');
});

test('Under the target nothing moves and the commit costs one pack', async () => {
 const db=database(),state={...base(),campaignReviewCoverage:{'cmp-1':{project:P,roles:{}}},knowledge:[{id:'k1'}]};
 const saved=await commitPersistedState(db.api,state,0),core=await storedCore(db);
 assert.deepEqual(core.campaignReviewCoverage,state.campaignReviewCoverage);assert.deepEqual(core.knowledge,state.knowledge);
 assert.deepEqual(saved.storage.history.overflow,[]);
});

test('Past the codec ceiling (a write that used to be refused), the valve still moves fields and the commit succeeds', async () => {
 // ~1.8 M incompressible characters in one listed map: the core codec alone would refuse it (STORAGE_LIMIT).
 const db=database(),coverage=heavyCoverage(450,3000);
 const saved=await commitPersistedState(db.api,{...base(),campaignReviewCoverage:coverage},0);
 const size=Buffer.byteLength(centralRow(db));
 assert.ok(size<=centralByteLimit*overflowStorage.target,'central at '+(100*size/centralByteLimit).toFixed(1)+'%');
 assert.deepEqual(saved.storage.history.overflow,['campaignReviewCoverage']);
 const read=await readPersistedState(db.api,base);
 same(read.state,saved.state,'the commit returns what the next read returns');
 assert.ok(JSON.stringify(read.state.campaignReviewCoverage)===JSON.stringify(coverage),'nothing lost');
 // Nothing listed to move: the old refusal stands, and nothing is written.
 const db2=database(),rows=()=>db2.d.prepare('SELECT count(*) n FROM bunker_records').get().n;
 await assert.rejects(commitPersistedState(db2.api,{...base(),proposals:[{id:'p1',evidence:noise(1400000)}]},0),e=>e.code==='STORAGE_LIMIT');
 assert.equal(rows(),0,'a refused commit writes nothing');
});
