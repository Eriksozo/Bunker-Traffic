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
function executor({steps=[],fastSteps=[],enabled=true,policy={}}={}){
 const exports={},values=new Map([['runtime',{enabled,history:[]}]]),alarms=[];
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [a,b] of Object.entries(k))values.set(a,b);}else values.set(k,v);},delete:async k=>values.delete(k),setAlarm:async at=>alarms.push(at)};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:name.includes('cloud-failure-diagnostics')?{runtimeFailure}:name.includes('change-watch')?{...changeWatch,changeWatchPolicy:{...changeWatch.changeWatchPolicy,...policy}}:name.includes('owner-orders')?ownerOrders:name.includes('sales-feed')?salesFeed:{},Date,Response,setInterval,clearInterval});
 const e=new exports.BunkerCloudExecutor({storage},{}),calls=[];
 e.engine=()=>({step:async opts=>{calls.push(opts?.only?'fast:'+opts.only.join('/'):'heavy');if(opts?.skip)assert.deepEqual([...opts.skip],['verify','followUp','execution'],'the heavy pulse leaves order work to the fast lane');return (opts?.only?fastSteps:steps).shift()||{kind:'idle'};}});
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
 const {e,calls,values,call}=executor({fastSteps:[{kind:'execution',project:'proj-a',status:'confirmed'}]});values.set('lastHeavyAt',Date.now());
 await call({action:'wake',order:true,projects:['proj-a']});await e.alarm();
 assert.deepEqual(calls,['fast:verify/followUp/execution','fast:verify/followUp/execution','notch','live:proj-a','notch']);
 assert.equal(values.get('wake'),undefined,'the flag is consumed');
 assert.equal(values.get('runtime').history[0].lane,'fast');assert.equal(values.get('runtime').history[0].kind,'execution');
 assert.equal(values.get('syncPulse').last.kind,'live');
});
test('a wake during a long heavy unit is served while that unit still waits for the model',async()=>{
 let ctx;ctx=executor({policy:{laneMs:10},fastSteps:[{kind:'execution',project:'proj-a',status:'confirmed'}]});
 const {e,calls,values}=ctx;let release;const slow=new Promise(r=>{release=r;});
 e.engine=()=>({step:async opts=>{
  if(opts?.only){calls.push('fast');return ctx.fastSteps?.shift?.()||{kind:'idle'};}
  calls.push('heavy:start');await ctx.call({action:'wake',order:true,projects:['proj-a']});
  await new Promise(r=>setTimeout(r,80));calls.push('heavy:end');release();return {kind:'idle'};
 }});
 ctx.fastSteps=[{kind:'execution',project:'proj-a',status:'confirmed'}];
 await e.alarm();await slow;
 const order=calls.indexOf('fast',calls.indexOf('heavy:start'));
 assert.ok(order>0&&order<calls.indexOf('heavy:end'),'the order ran during the slow unit: '+calls.join(' > '));
 assert.ok(calls.includes('live:proj-a'));assert.equal(values.get('wake'),undefined);assert.equal(e.laneRun,null,'no fast lane left running after the alarm');
});
test('central writes of the object never overlap',async()=>{
 const {e}=executor();let inside=0,max=0;
 e.read=async()=>({state:{},revision:1});
 const order=[];
 await Promise.all([1,2,3].map(n=>e.write(async()=>{inside++;max=Math.max(max,inside);await new Promise(r=>setTimeout(r,5));order.push(n);inside--;}).catch(()=>{})));
 assert.equal(max,1);assert.deepEqual(order,[1,2,3]);
});
test('with nothing new the fast lane rereads only the stalest live project, once per stale window',async()=>{
 const {e,calls}=executor();e.ctx.storage.put('lastHeavyAt',Date.now());
 const old=Date.now()-changeWatch.changeWatchPolicy.liveStaleMs-1000;e.liveReadAt={'proj-new':Date.now(),'proj-old':old};
 await e.alarm();assert.deepEqual(calls,['fast:verify/followUp/execution','live:proj-old','notch'],'the first look also sweeps for orders approved elsewhere');
 calls.length=0;e.lastWatchAt=0;await e.alarm();assert.deepEqual(calls,[],'not again until it is stale again, and the order sweep waits a minute');
});
test('busy projects never starve a quiet one: the stalest joins the reads of the edited projects',async()=>{
 const {e,calls}=executor();e.ctx.storage.put('lastHeavyAt',Date.now());e.lastOrderSweepAt=Date.now();
 const old=Date.now()-changeWatch.changeWatchPolicy.liveStaleMs-1000;e.liveReadAt={'proj-busy':Date.now()-1000,'proj-quiet':old};
 e.watchChanges=async()=>{e.freshChanges=[{project:'proj-busy',events:[{key:'k',project:'proj-busy',at:new Date().toISOString()}]}];return ['proj-busy'];};
 await e.alarm();
 assert.ok(calls.includes('live:proj-busy,proj-quiet'),'one read of the edited project and the stale one: '+calls.join(' > '));
});
test('a pulse that started earlier never puts back an older live reading over a newer one',()=>{
 const row=(status,at)=>({projectId:'p',snapshot:{fetchedAt:at,rows:[{id:'c',status}]}});
 const paused=row('PAUSED','2026-11-08T14:32:06Z'),before=row('ACTIVE','2026-11-08T14:27:00Z');
 assert.equal(changeWatch.newestLiveItems([paused],[before],{})[0].snapshot.rows[0].status,'PAUSED','the older pulse keeps the fast-lane reread');
 assert.equal(changeWatch.newestLiveItems([before],[{projectId:'p'}],{p:paused})[0].snapshot.rows[0].status,'PAUSED','a fresh import replaces the held one');
 assert.equal(changeWatch.newestLiveItems([],[before],{})[0],before,'nothing held: this read');
});
test('the fast lane never asks the engine for model work',()=>{
 assert.deepEqual([...changeWatch.fastLaneKinds],['verify','followUp','execution']);
 const s={config:{},jobs:[],agents:{},snapshots:[],proposals:[],executions:[],messages:[{id:'q',project:'a',status:'Pendente',agentId:'traffic'}],collaborationRounds:[]};
 assert.equal(cloudNext(s,[],Date.now(),{only:changeWatch.fastLaneKinds}),null,'an owner question or stage is left to the heavy pulse');
});
