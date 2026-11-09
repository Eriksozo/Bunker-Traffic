import test from 'node:test';
import assert from 'node:assert/strict';
import {packHistoryState,hydrateHistoryState,historyKeys,historyView,journalStorage} from '../lib/history-storage.mjs';

// Synthetic fixtures only. Owner report of 09/11/2026: the central reached 87% of its limit; the append-only journals
// move to their own sealed segments, nothing deleted.
const now=Date.parse('2026-11-09T12:00:00Z');
const store=()=>{const rows=new Map();return {rows,fetch:async keys=>keys.filter(k=>rows.has(k)).map(k=>({key:k,payload:rows.get(k)})),put:archives=>{for(const a of archives)rows.set(a.key,JSON.stringify(a.payload));}};};
const item=(prefix,i)=>({id:prefix+i,eventId:'e'+i,payload:'x'.repeat(200),n:i});
const logical=()=>({
 decisionHistory:Array.from({length:230},(_,i)=>item('d',i)),
 decisionHistoryImports:Array.from({length:41},(_,i)=>item('imp',i)),
 campaignChanges:Array.from({length:3},(_,i)=>item('cc',i)),
 externalHistoryMeasurements:[],
 executions:[{id:'x1'}],other:{keep:true}
});

test('Journals leave the central and come back identical, in order',async()=>{
 const db=store(),input=logical(),packed=await packHistoryState(input,now,{journals:true});db.put(packed.archives);
 for(const name of ['decisionHistory','decisionHistoryImports','campaignChanges'])assert.equal(packed.state[name],undefined,name+' left the central');
 assert.deepEqual(packed.state.externalHistoryMeasurements,[],'an empty journal stays inline');
 assert.deepEqual(packed.state.journalStorage.journals.decisionHistory.map(s=>s.count),[100,100,30]);
 assert.deepEqual(packed.state.journalStorage.journals.decisionHistoryImports.map(s=>s.count),[40,1]);
 assert.ok(packed.archives.every(a=>/^history-journal:[0-9a-f]{64}$/.test(a.key)));
 const back=await hydrateHistoryState(packed.state,db.fetch);
 const {historyStorage,...rest}=back;
 assert.deepEqual(rest,input,'lossless round trip');
 assert.deepEqual(historyStorage.known.sort(),historyKeys(packed.state).sort());
 assert.ok(JSON.stringify(packed.state).length<JSON.stringify(input).length/5,'the central keeps only the index');
});

test('Appending re-seals only the last segment; a mutated old item re-seals only its own segment',async()=>{
 const db=store(),first=await packHistoryState(logical(),now,{journals:true});db.put(first.archives);
 const read=await hydrateHistoryState(first.state,db.fetch);
 assert.equal((await packHistoryState(read,now,{journals:true})).archives.length,0,'nothing new to write');
 read.decisionHistory.push(item('d',999));
 const appended=await packHistoryState(read,now,{journals:true});
 assert.equal(appended.archives.length,1,'only the tail segment');
 read.decisionHistory[5]={...read.decisionHistory[5],originObservations:[{x:1}]};
 const mutated=await packHistoryState(read,now,{journals:true});
 assert.equal(mutated.archives.length,2,'tail plus the first segment');
});

test('An older writer appending inline next to the index keeps both; same id keeps the indexed copy',async()=>{
 const db=store(),packed=await packHistoryState(logical(),now,{journals:true});db.put(packed.archives);
 const mixed={...packed.state,decisionHistory:[{id:'d3',changed:true},{id:'new-1',n:1}]};
 const back=await hydrateHistoryState(mixed,db.fetch);
 assert.equal(back.decisionHistory.length,231);
 assert.equal(back.decisionHistory.find(x=>x.id==='d3').changed,undefined,'indexed copy wins');
 assert.equal(back.decisionHistory.at(-1).id,'new-1');
});

test('Missing, swapped or unknown journal records fail closed, never an empty list',async()=>{
 const db=store(),packed=await packHistoryState(logical(),now,{journals:true});db.put(packed.archives);
 const key=packed.state.journalStorage.journals.decisionHistory[1].key;
 const missing=store();missing.put(packed.archives.filter(a=>a.key!==key));
 await assert.rejects(hydrateHistoryState(packed.state,missing.fetch),e=>e.code==='STORAGE_INTEGRITY');
 const swapped={...packed.state,journalStorage:{...packed.state.journalStorage,journals:{...packed.state.journalStorage.journals,decisionHistory:[...packed.state.journalStorage.journals.decisionHistory].reverse()}}};
 await assert.rejects(hydrateHistoryState(swapped,db.fetch),e=>e.code==='STORAGE_INTEGRITY','segments out of order');
 const unknown={...packed.state,journalStorage:{version:1,journals:{reports:[]}}};
 await assert.rejects(hydrateHistoryState(unknown,db.fetch),e=>e.code==='STORAGE_INTEGRITY');
 await assert.rejects(packHistoryState(packed.state,now,{journals:true}),e=>e.code==='STORAGE_INTEGRITY','a packed state is never packed again');
});

test('Two-step rollout: the default writes inline (readers first); the reader already understands the index',async()=>{
 assert.equal(journalStorage.write,false);
 const packed=await packHistoryState(logical(),now);
 assert.equal(packed.state.journalStorage,undefined);
 assert.equal(packed.state.decisionHistory.length,230);
 const view=historyView(logical(),packed.state);assert.equal(view.decisionHistory.length,230);
});
