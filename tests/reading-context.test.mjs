import test from 'node:test';
import assert from 'node:assert/strict';
import {readingContext} from '../lib/reading-context.mjs';
const now=Date.parse('2026-11-04T12:00:00Z'),snapshot={projectId:'john',projectName:'John',period:'today',level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-04T03:00:00Z',to:'2026-11-05T03:00:00Z',timezone:'America/Sao_Paulo',fetchedAt:'2026-11-04T11:59:30Z',lastSyncAt:'2026-11-04T11:59:00Z',rows:[]},item={projectId:'john',snapshot,lastSuccessAt:snapshot.fetchedAt,error:null};
const analysis={...snapshot,period:'7d',fetchedAt:'2026-11-03T18:04:00Z',lastSyncAt:'2026-11-03T17:54:00Z'};
test('Live clock remains current in cards, office and historical views without renewing their frozen analysis',()=>{
 const before=structuredClone(analysis);
 for(const view of ['overview','cards','office','reports','decisions','data']){
  const value=readingContext({item,project:'john',analysis,now,view});
  assert.equal(value.monitoring.fetchedAt,snapshot.fetchedAt);assert.equal(value.monitoring.recent,true);
  assert.equal(value.analysis.fetchedAt,analysis.fetchedAt);assert.equal(value.analysis.stale,true);
 }
 assert.deepEqual(analysis,before);
});
test('A new live revision changes the clock independently of the central analysis revision',()=>{
 const first=readingContext({item,project:'john',analysis,now});
 const next=readingContext({item:{...item,lastSuccessAt:'2026-11-04T12:00:00Z',snapshot:{...snapshot,fetchedAt:'2026-11-04T12:00:00Z'}},project:'john',analysis,now});
 assert.notEqual(first.monitoring.fetchedAt,next.monitoring.fetchedAt);assert.deepEqual(first.analysis,next.analysis);
});
test('A recent poll never disguises a delayed or unknown upstream sync as real-time data',()=>{
 for(const [lastSyncAt,label] of [['2026-11-04T10:00:00Z','Malva com atualização atrasada'],[null,'Horário da origem não confirmado']]){
  const value=readingContext({item:{...item,snapshot:{...snapshot,lastSyncAt}},project:'john',analysis,now});
  assert.equal(value.monitoring.recent,false);assert.equal(value.monitoring.label,label);assert.equal(value.monitoring.fetchedAt,snapshot.fetchedAt);
 }
});
test('Project switches, missing feed, pause and failed polling cannot borrow a green clock',()=>{
 const foreign=readingContext({item,project:'gabe',analysis,now});assert.equal(foreign.monitoring.fetchedAt,null);assert.equal(foreign.analysis.fetchedAt,null);assert.equal(foreign.monitoring.recent,false);
 for(const changes of [{item:undefined},{paused:true},{error:'network failed'}])assert.equal(readingContext({item,project:'john',analysis,now,...changes}).monitoring.recent,false);
});
test('Day rollover preserves the previous timestamp as history, never as a fresh today read',()=>{
 const value=readingContext({item,project:'john',analysis,now:Date.parse(snapshot.to)});
 assert.equal(value.monitoring.recent,false);assert.equal(value.monitoring.fetchedAt,snapshot.fetchedAt);
});
