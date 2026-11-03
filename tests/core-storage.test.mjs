import test from 'node:test';
import assert from 'node:assert/strict';
import {packCoreState,hydrateCoreState,coreStorageLimits} from '../lib/core-storage.mjs';

function fixture(){return {snapshots:[],snapshotStorage:{kind:'existing-codec'},reports:[{id:'report',text:'Visível ao SQL'}],paused:false,ownerChoices:[{id:'choice',signature:'sealed'}],executions:[{id:'sent',status:'Verificação necessária'}],collaborationMessages:Array.from({length:500},(_,i)=>({id:'message-'+i,text:'Contexto e métricas á 🌱 '.repeat(40),evidenceRefs:[{externalId:'campaign-'+i}]}))};}
test('Core storage preserves decisions, journals and exact values while leaving report SQL fields outside',async()=>{
 const state=fixture(),before=structuredClone(state),packed=await packCoreState(state);assert.deepEqual(state,before);assert.ok(packed.coreStorage);assert.deepEqual(packed.reports,state.reports);assert.deepEqual(packed.snapshotStorage,state.snapshotStorage);assert.equal(packed.ownerChoices,undefined);assert.deepEqual(await hydrateCoreState(packed),state);
 const small={snapshots:[],reports:[],paused:true};assert.deepEqual(await hydrateCoreState(await packCoreState(small)),small);
});
test('Corruption, unknown formats, mixed fields and expansion mismatches fail closed',async()=>{
 const packed=await packCoreState(fixture());
 for(const mutate of [s=>s.coreStorage.version=2,s=>s.coreStorage.rawBytes=2,s=>s.coreStorage.digest='sha256:'+'0'.repeat(64),s=>s.coreStorage.data=s.coreStorage.data.slice(0,-8),s=>s.coreStorage.rawBytes=coreStorageLimits.maxRawBytes+1,s=>s.paused=true]){const s=structuredClone(packed);mutate(s);await assert.rejects(hydrateCoreState(s),/Histórico armazenado inválido/);}
 await assert.rejects(packCoreState(packed),/estado lógico esperado/);
 await assert.rejects(packCoreState({snapshots:[],text:'á'.repeat(coreStorageLimits.maxRawBytes/2)}),/histórico acima do limite/);
});
