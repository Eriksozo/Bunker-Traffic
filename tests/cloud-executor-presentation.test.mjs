import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {runtimeFailure} from '../lib/cloud-failure-diagnostics.mjs';
import * as changeWatch from '../lib/change-watch.mjs';
import * as ownerOrders from '../lib/owner-orders.mjs';
import * as salesFeed from '../lib/sales-feed.mjs';
// Exercise the real Durable Object alarm with only infrastructure and provider boundaries replaced.
const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function executor({step,enabled=true}={}){
 const exports={},values=new Map([['runtime',{enabled,history:[]}]]),alarms=[];
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [a,b] of Object.entries(k))values.set(a,b);}else values.set(k,v);},setAlarm:async at=>alarms.push(at)};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:name.includes('cloud-failure-diagnostics')?{runtimeFailure}:name.includes('change-watch')?changeWatch:name.includes('owner-orders')?ownerOrders:name.includes('sales-feed')?salesFeed:{},Date,Response});
 const e=new exports.BunkerCloudExecutor({storage},{}),calls=[];
 e.engine=()=>({step:step||(async()=>{calls.push('analysis');throw Object.assign(Error('rejected'),{code:'CLOUD_MEMORY_REVIEW_EVIDENCE'});})});
 e.syncLive=async()=>{calls.push('live');return {paused:false};};e.syncAttribution=async()=>calls.push('authors');e.storeCompanion=async()=>calls.push('notch');
 return {e,calls,values,alarms};
}
test('a failed opinion keeps its failure record and still refreshes live data, authors and the notch',async()=>{
 const {e,calls,values,alarms}=executor();await e.alarm();
 assert.deepEqual(calls,['analysis','live','authors','notch']);
 assert.equal(values.get('runtime').lastError,'CLOUD_MEMORY_REVIEW_EVIDENCE');assert.equal(values.get('runtime').history[0].kind,'failure');
 assert.equal(alarms.length,1);assert.equal(e.running,false);
});
test('disabled executor does no analysis or presentation; a pause during analysis prevents new reads',async()=>{
 const disabled=executor({enabled:false});await disabled.e.alarm();assert.deepEqual(disabled.calls,[]);assert.equal(disabled.alarms.length,0);
 let active;active=executor({step:async()=>{active.values.set('runtime',{enabled:false,history:[]});throw Error('stopped');}});
 await active.e.alarm();assert.deepEqual(active.calls,[]);assert.equal(active.alarms.length,0);
});
test('authorship failure stays separate and does not block the notch summary',async()=>{
 const {e,calls,values}=executor({step:async()=>({kind:'idle'})});
 e.syncAttribution=async()=>{calls.push('authors');throw Error('source unavailable');};
 await e.alarm();assert.deepEqual(calls,['live','authors','notch']);assert.equal(values.get('attributionStatus').failed,true);
 assert.equal(values.get('runtime').lastError,null);
});

test('between minute pulses a new Malva edit refreshes the notch at once, then the live read, and moves the pulse after each',async()=>{
 const {e,calls,values,alarms}=executor();values.set('lastHeavyAt',Date.now());
 const edit={key:'history:p:1',project:'p',name:'Campanha',accountName:'Conta',field:'status',before:'ACTIVE',after:'PAUSED',currency:'BRL',actor:'Erik',at:new Date().toISOString()};
 e.watchChanges=async()=>{e.freshChanges=[{project:'p',events:[edit]}];return ['p'];};e.read=async()=>({state:{paused:false}});e.storedShadow=async()=>[];
 const pulses=[];const put=e.ctx.storage.put;e.ctx.storage.put=async(k,v)=>{if(k==='syncPulse')pulses.push(v);return put(k,v);};
 await e.alarm();
 assert.deepEqual(calls,['notch','live','notch'],'no analysis between minute pulses');
 assert.equal(pulses[0].last.actor,'Erik','the edit moves the pulse with its author first');
 assert.equal(values.get('syncPulse').version,2);assert.equal(values.get('syncPulse').last.kind,'live','the live reread moves it again without repeating the edit toast');assert.deepEqual([...values.get('syncPulse').projects],['p']);
 assert.equal(alarms.length,1);assert.ok(alarms[0]-Date.now()<=changeWatch.changeWatchPolicy.tickMs+50);
 const quiet=executor();quiet.values.set('lastHeavyAt',Date.now());quiet.e.watchChanges=async()=>[];await quiet.e.alarm();
 assert.deepEqual(quiet.calls,[]);assert.equal(quiet.values.get('syncPulse'),undefined);
});

test('a sale reaches only a configured project, needs an order id and is deduplicated per project',async()=>{
 const {e,values}=executor();
 const call=async sale=>(await e.fetch(new Request('https://bunker-internal/control',{method:'POST',body:JSON.stringify({action:'sale',sale})}))).json();
 const base={amount:97,currency:'BRL',at:new Date().toISOString(),orderRef:'abc'};
 assert.equal((await call({...base,project:'proj-aaaa'})).refused,'projeto não configurado no Bunker','no config yet: refused');
 values.set('watchConfig',['proj-aaaa','proj-bbbb']);
 assert.equal((await call({...base,project:'proj-kwai'})).refused,'projeto não configurado no Bunker');
 assert.equal((await call({...base})).refused,'projeto não configurado no Bunker','no project never means every project');
 assert.equal((await call({...base,project:'proj-aaaa',orderRef:null})).refused,'pedido sem identificação');
 assert.equal((await call({...base,project:'proj-aaaa'})).added,true);
 assert.equal((await call({...base,project:'proj-aaaa'})).added,false,'retry does not duplicate');
 assert.equal((await call({...base,project:'proj-bbbb'})).added,true,'same ref in another project is a different sale');
 assert.equal(values.get('salesFeed').length,2);assert.equal(values.get('syncPulse').version,2);
});

test('a recorded model format failure retries in the same pulse; other failures still end it',async()=>{
 let n=0;const {e,calls,values}=executor({step:async()=>{n++;calls.push('unit'+n);if(n===1)throw Object.assign(Error('format'),{code:'CLOUD_AI_INVALID',attemptRecorded:true,modelFailure:{phase:'json',reason:'invalid_final_json'}});return {kind:'idle'};}});
 await e.alarm();
 assert.deepEqual(calls.slice(0,2),['unit1','unit2'],'the stage gets its next attempt now');
 const rt=values.get('runtime');assert.equal(rt.lastError,null,'the later success clears the error');assert.equal(rt.history[1].code,'CLOUD_AI_INVALID');assert.equal(rt.history[1].modelFailure.reason,'invalid_final_json');
 let m=0;const other=executor({step:async()=>{m++;throw Object.assign(Error('x'),{code:'CLOUD_AI_INVALID'});}});await other.e.alarm();
 assert.equal(m,1,'an unrecorded failure (not a stage attempt) ends the pulse');assert.equal(other.values.get('runtime').lastError,'CLOUD_AI_INVALID');
 let k=0;const capped=executor({step:async()=>{k++;throw Object.assign(Error('f'),{code:'CLOUD_AI_INVALID',attemptRecorded:true});}});await capped.e.alarm();
 assert.equal(k,4,'never more than the four units of a pulse');
});
