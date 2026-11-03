import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {compactOrphanSuggestions,suggestionHistoryQuery,suggestionHistoryPage} from '../lib/suggestion-history.mjs';
const suggestion=(id,roundId='old',project='john',extra={})=>({id,roundId,project,clientId:'client-'+id,requestFingerprint:'digest-'+id,createdAt:'2026-11-03T12:00:00Z',...extra});
test('Orphan migration preserves original records and keeps ambiguous or connected retained batches central',()=>{
 const receipt={clientId:'batch',requestFingerprint:'batch-digest',recordIds:['a','b']};
 const state={config:{john:{},nico:{}},collaborationRounds:[{id:'live'}],cardSuggestions:[suggestion('a','old','john',{batchReceipt:receipt,requestAliases:[{clientId:'alias',requestFingerprint:'immutable'}]}),suggestion('b'),suggestion('keep','live'),suggestion('linked','old','john',{batchReceipt:{recordIds:['linked','keep']}}),suggestion('chained','old','john',{batchReceipt:{recordIds:['chained','linked']}}),suggestion('absent','old','john',{batchReceipt:{recordIds:['absent','missing']}}),suggestion('cross-a','other','john',{batchReceipt:{recordIds:['cross-a','cross-b']}}),suggestion('cross-b','other','nico'),suggestion('duplicate'),suggestion('duplicate'),suggestion('unknown','old','unconfigured')]};
 const original=structuredClone(state.cardSuggestions),r=compactOrphanSuggestions(state,Date.parse('2026-11-03T13:00:00Z'));
 assert.equal(r.archives.length,1);assert.match(r.archives[0].key,/^suggestions:[a-f0-9-]{36}$/);assert.equal(r.archives[0].immutableNew,true);
 assert.deepEqual(r.archives[0].payload,{type:'bunker-suggestions',version:1,project:'john',roundId:'old',archivedAt:'2026-11-03T13:00:00.000Z',cardSuggestions:original.slice(0,2)});
 assert.deepEqual(state.cardSuggestions,original.slice(2));assert.equal(compactOrphanSuggestions(state).archives.length,0);
});
test('Suggestion history reads both journal formats with project-bound stable cursors and no SQL interpolation',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE bunker_records(key TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');
 const put=(key,payload)=>db.prepare('INSERT INTO bunker_records VALUES(?,?,1,?)').run(key,JSON.stringify(payload),'2026-11-03T13:00:00.000Z');
 for(let i=0;i<7;i++)put('suggestions:'+i,{type:'bunker-suggestions',version:1,project:i%2?'nico':'john',roundId:'old-'+i,archivedAt:'2026-11-03T13:00:00.000Z',cardSuggestions:[suggestion('s'+i,'old-'+i,i%2?'nico':'john')]});
 put('collaboration:old',{type:'bunker-collaboration',version:1,round:{id:'legacy',project:'john'},archivedAt:'2026-11-03T13:00:00.000Z',cardSuggestions:[suggestion('legacy','legacy')],messages:[{text:'not part of suggestion journal'}]});
 const read=(project,cursor=null)=>{const q=suggestionHistoryQuery(project,2,cursor);return suggestionHistoryPage(db.prepare(q.sql).all(...q.params),q);};
 let cursor=null,items=[];do{const p=read('john',cursor);items.push(...p.items);cursor=p.nextCursor;}while(cursor);
 assert.equal(items.length,5);assert.equal(new Set(items.map(i=>i.archiveKey)).size,5);assert.ok(items.every(i=>i.project==='john'));assert.ok(items.some(i=>i.origin==='collaboration'&&i.roundId==='legacy'));assert.ok(items.every(i=>i.messages===undefined));
 const first=read('john');assert.throws(()=>read('nico',first.nextCursor),/Cursor/);assert.throws(()=>read('john','broken!'),/Cursor/);assert.throws(()=>suggestionHistoryQuery('john',21),/Limite/);assert.throws(()=>suggestionHistoryQuery('all'),/projeto/);
 const hostile="john' OR 1=1 --",q=suggestionHistoryQuery(hostile);assert.ok(!q.sql.includes(hostile));assert.deepEqual(db.prepare(q.sql).all(...q.params),[]);db.close();
});
