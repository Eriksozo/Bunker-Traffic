import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {claimBatch} from '../lib/agent-state.ts';
const iso=t=>new Date(t).toISOString();
function fixture(at=Date.parse('2026-11-05T15:00:00Z')){
 let clock=at,state={paused:false,config:{p:{projectName:'One'},q:{projectName:'Two'}},cadence:{enabled:true,intervalMinutes:15,start:'08:00',end:'20:00',weekdays:[0,1,2,3,4,5,6],timezone:'UTC'},snapshots:[],jobs:[{id:'failed',project:'q',status:'Falhou',updatedAt:iso(at-15*60000+500)}],agents:{},collaborationRounds:[],proposals:[],executions:[]};let mutate=()=>{},calls=0;
 const engine=createCloudEngine({read:async()=>({state:structuredClone(state),revision:1}),write:async fn=>{const draft=structuredClone(state),r=await fn(draft,1);state=draft;return r;},now:()=>clock,ops:{claimBatch},source:{read:async tool=>{calls++;if(tool==='workspace_whoami'){clock+=1000;mutate(state);return {workspace:{id:'workspace'},platforms:[{platform:'tracking',read:true}]};}if(tool==='tracking_list_projects')return {items:[{id:'p',name:'One'},{id:'q',name:'Two'}]};throw Error('Unexpected campaign collection');}},ai:{run:async()=>{throw Error('No inference during admission');}}});
 return {engine,get state(){return state;},get calls(){return calls;},setMutate(fn){mutate=fn;}};
}
test('A cooldown ending during identity lookup joins the same complete commit-time batch',async()=>{
 const f=fixture(),out=await f.engine.step();assert.equal(out.kind,'admit');assert.deepEqual(out.jobs.map(j=>j.project).sort(),['p','q']);assert.equal(f.calls,2);const running=f.state.jobs.filter(j=>j.status==='Em análise');assert.equal(running.length,2);assert.ok(running.every(j=>j.executor==='cloudflare'&&j.startedAt==='2026-11-05T15:00:01.000Z'));assert.equal(f.state.jobs.find(j=>j.id==='failed').status,'Falhou');
});
test('Closing the admission window during identity lookup cannot create retroactive jobs',async()=>{
 const f=fixture(Date.parse('2026-11-05T20:00:59.500Z')),out=await f.engine.step();assert.equal(out.kind,'idle');assert.equal(f.state.jobs.length,1);assert.equal(f.state.jobs.some(j=>j.status==='Em análise'),false);assert.deepEqual(f.state.agents,{});
});
test('A pause or newly changed project identity before the commit cannot reserve stale work',async()=>{
 const paused=fixture();paused.setMutate(s=>s.paused=true);assert.equal((await paused.engine.step()).kind,'idle');assert.equal(paused.state.jobs.length,1);
 const changed=fixture();changed.setMutate(s=>s.config.q.projectName='Different owner project');await assert.rejects(changed.engine.step(),e=>e.code==='CLOUD_MALVA_IDENTITY');assert.equal(changed.state.jobs.length,1);assert.deepEqual(changed.state.agents,{});
});
test('Current manual requests remain eligible outside the automatic window without inventing an automatic slot',async()=>{
 const f=fixture(Date.parse('2026-11-05T21:00:00Z'));f.state.jobs=[{id:'manual',project:'p',status:'Pendente'}];const out=await f.engine.step();assert.equal(out.kind,'admit');assert.equal(out.jobs.length,1);assert.equal(out.jobs[0].id,'manual');assert.equal(f.state.jobs[0].slotKey,null);assert.equal(f.state.jobs[0].executor,'cloudflare');
});
