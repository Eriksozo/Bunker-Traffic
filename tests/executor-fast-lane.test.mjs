import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {runtimeFailure} from '../lib/cloud-failure-diagnostics.mjs';
import * as changeWatch from '../lib/change-watch.mjs';
import * as ownerOrders from '../lib/owner-orders.mjs';
import * as salesFeed from '../lib/sales-feed.mjs';
import {cloudNext} from '../lib/cloud-engine.mjs';
// Fast lane (owner request of 2026-11-08): an owner order and a status change no longer wait for the whole heavy pulse.
// The real Durable Object code runs with only infrastructure and provider boundaries replaced.
const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function executor({steps=[],enabled=true}={}){
 const exports={},values=new Map([['runtime',{enabled,history:[]}]]),alarms=[];
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [a,b] of Object.entries(k))values.set(a,b);}else values.set(k,v);},delete:async k=>values.delete(k),setAlarm:async at=>alarms.push(at)};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:name.includes('cloud-failure-diagnostics')?{runtimeFailure}:name.includes('change-watch')?changeWatch:name.includes('owner-orders')?ownerOrders:name.includes('sales-feed')?salesFeed:{},Date,Response});
 const e=new exports.BunkerCloudExecutor({storage},{}),calls=[];
 e.engine=()=>({step:async opts=>{calls.push(opts?.only?'fast:'+opts.only.join('/'):'heavy');return steps.shift()||{kind:'idle'};}});
 e.watchChanges=async()=>{e.freshChanges=[];return [];};e.read=async()=>({state:{paused:false}});e.storedShadow=async()=>[];
 e.syncLive=async(first=[],only=false)=>{calls.push('live:'+(only?first.join(','):'rotation'));return {paused:false};};
 e.syncAttribution=async()=>calls.push('authors');e.storeCompanion=async()=>calls.push('notch');e.syncAccounts=async()=>{};e.syncMetaLive=async()=>{};e.storeShadow=async()=>[];e.storeFirst24h=async()=>{};
 const call=async body=>(await e.fetch(new Request('https://bunker-internal/control',{method:'POST',body:JSON.stringify(body)}))).json();
 return {e,calls,values,alarms,call};
}
test('a wake only marks a flag and brings the alarm forward in the same object',async()=>{
 const {values,alarms,call}=executor();
 const r=await call({action:'wake',order:true,projects:['proj-a','bad id!',7]});
 assert.equal(r.ok,true);assert.deepEqual([...values.get('wake').projects],['proj-a']);assert.equal(values.get('wake').order,true);
 assert.equal(alarms.length,1);assert.ok(alarms[0]-Date.now()<=1000,'alarm in under a second');
 await call({action:'wake',order:false,projects:['proj-b']});
 assert.equal(values.get('wake').order,true,'a later wake never drops a pending order');assert.deepEqual([...values.get('wake').projects],['proj-a','proj-b']);
 const off=executor({enabled:false});await off.call({action:'wake',order:true,projects:['proj-a']});assert.equal(off.alarms.length,0,'paused executor: no alarm');
});
test('between pulses a woken order runs only order work, then the touched project is reread and the pulse moves',async()=>{
 const {e,calls,values,call}=executor({steps:[{kind:'execution',project:'proj-a',status:'confirmed'}]});values.set('lastHeavyAt',Date.now());
 await call({action:'wake',order:true,projects:['proj-a']});await e.alarm();
 assert.deepEqual(calls,['fast:verify/followUp/execution','fast:verify/followUp/execution','notch','live:proj-a','notch']);
 assert.equal(values.get('wake'),undefined,'the flag is consumed');
 assert.equal(values.get('runtime').history[0].lane,'fast');assert.equal(values.get('runtime').history[0].kind,'execution');
 assert.equal(values.get('syncPulse').last.kind,'live');
});
test('a wake that arrives during a heavy pulse is served between its units, not after the whole pulse',async()=>{
 let ctx;ctx=executor({steps:[{kind:'stage',project:'proj-x'},{kind:'stage',project:'proj-x'}]});
 const {e,calls}=ctx;const step=e.engine;
 e.engine=()=>({step:async opts=>{const r=await step().step(opts);if(!opts&&calls.filter(c=>c==='heavy').length===1)await ctx.call({action:'wake',order:true,projects:['proj-a']});return r;}});
 await e.alarm();
 const fast=calls.indexOf('fast:verify/followUp/execution'),second=calls.lastIndexOf('heavy');
 assert.ok(fast>0&&fast<second,'the order work ran before the next heavy unit: '+calls.join(' > '));
});
test('with nothing new the fast lane rereads only the stalest live project, once per stale window',async()=>{
 const {e,calls}=executor();e.ctx.storage.put('lastHeavyAt',Date.now());
 const old=Date.now()-changeWatch.changeWatchPolicy.liveStaleMs-1000;e.liveReadAt={'proj-new':Date.now(),'proj-old':old};
 await e.alarm();assert.deepEqual(calls,['live:proj-old','notch']);
 calls.length=0;e.lastWatchAt=0;await e.alarm();assert.deepEqual(calls,[],'not again until it is stale again');
});
test('the fast lane never asks the engine for model work',()=>{
 assert.deepEqual([...changeWatch.fastLaneKinds],['verify','followUp','execution']);
 const s={config:{},jobs:[],agents:{},snapshots:[],proposals:[],executions:[],messages:[{id:'q',project:'a',status:'Pendente',agentId:'traffic'}],collaborationRounds:[]};
 assert.equal(cloudNext(s,[],Date.now(),{only:changeWatch.fastLaneKinds}),null,'an owner question or stage is left to the heavy pulse');
});
