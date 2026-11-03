import test from 'node:test';
import assert from 'node:assert/strict';
import {currentLiveSnapshot,liveDisplayStatus} from '../lib/live-display.mjs';

const now=Date.parse('2026-11-02T18:00:00.000Z');
const snapshot={projectId:'john',projectName:'John',period:'today',level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-02T04:00:00.000Z',to:'2026-11-03T04:00:00.000Z',timezone:'America/Boa_Vista',fetchedAt:'2026-11-02T17:59:00.000Z',lastSyncAt:'2026-11-02T17:58:00.000Z',rows:[{externalId:'campaign',spend:123}]};
const item={projectId:'john',snapshot,lastSuccessAt:snapshot.fetchedAt,error:null};

test('today display selects a newer complete read without replacing analysis',()=>{
 const analysis=Object.freeze({...snapshot,fetchedAt:'2026-11-02T16:00:00.000Z',rows:Object.freeze([{spend:80}])});
 const before=structuredClone(analysis);
 assert.equal(currentLiveSnapshot(item,'john',analysis,now),snapshot);
 assert.deepEqual(analysis,before);
 assert.equal(currentLiveSnapshot(item,'john',{...analysis,fetchedAt:snapshot.fetchedAt},now),null);
 assert.equal(currentLiveSnapshot(item,'john',{...analysis,fetchedAt:'2026-11-02T18:00:00.000Z'},now),null);
});

test('display never mixes projects, historical periods, hierarchy or partial collections',()=>{
 assert.equal(currentLiveSnapshot(item,'gabe',undefined,now),null);
 for(const patch of [{projectId:'gabe'},{period:'7d'},{level:'ad'},{source:'Other'},{complete:false}]){
  assert.equal(currentLiveSnapshot({...item,snapshot:{...snapshot,...patch}},'john',undefined,now),null);
 }
 assert.equal(currentLiveSnapshot({...item,projectId:'gabe'},'john',undefined,now),null);
});

test('the original timezone fences midnight and rejects old or invalid dates',()=>{
 assert.equal(currentLiveSnapshot(item,'john',undefined,Date.parse(snapshot.to)),null);
 for(const patch of [{fetchedAt:'2026-11-02T03:59:00.000Z'},{from:'2026-11-01T04:00:00.000Z'},{timezone:'invalid'},{fetchedAt:'invalid'},{fetchedAt:'2026-11-02T18:06:00.000Z'}]){
  assert.equal(currentLiveSnapshot({...item,snapshot:{...snapshot,...patch}},'john',undefined,now),null);
 }
});

test('a stale or failed read remains displayable and is clearly no longer recent',()=>{
 const old={...item,snapshot:{...snapshot,fetchedAt:'2026-11-02T17:00:00.000Z'},lastSuccessAt:'2026-11-02T17:00:00.000Z'};
 assert.equal(currentLiveSnapshot(old,'john',undefined,now),old.snapshot);
 assert.equal(liveDisplayStatus(old,'john',{now}).recent,false);
 assert.equal(liveDisplayStatus(old,'john',{now}).label,'Sem atualização recente do Mac');
 const failed={...item,error:{code:'MCP_READ_FAILED',message:'Fonte indisponível',at:'2026-11-02T18:00:00.000Z'}};
 assert.equal(currentLiveSnapshot(failed,'john',undefined,now),snapshot);
 assert.deepEqual(liveDisplayStatus(failed,'john',{now}),{recent:false,label:'Falha de sincronização',error:'Fonte indisponível'});
});

test('pause and endpoint failure cannot be presented as a fresh active connection',()=>{
 assert.equal(liveDisplayStatus(item,'john',{now}).recent,true);
 assert.equal(liveDisplayStatus(item,'john',{now,paused:true}).label,'Pausado no Bunker');
 assert.equal(liveDisplayStatus(item,'john',{now,paused:true}).recent,false);
 assert.equal(liveDisplayStatus(item,'john',{now,error:'Sem conexão'}).recent,false);
 assert.equal(currentLiveSnapshot(undefined,'john',undefined,now),null);
 assert.equal(liveDisplayStatus(undefined,'john',{now}).label,'Aguardando primeira coleta');
 assert.equal(liveDisplayStatus({...item,snapshot:null},'john',{now}).recent,false);
});
