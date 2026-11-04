import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceWatch,sourceSignals,signalKeys,mergeSourceFeed} from '../lib/source-watch.mjs';
import {SupabaseStorage} from '../lib/supabase-storage.mjs';
const p='11111111-1111-4111-8111-111111111111',q='22222222-2222-4222-8222-222222222222',keys=signalKeys([p]);
const payload=revision=>({items:keys.map(key=>({key,revision,updatedAt:'2026-11-03T18:00:00Z'}))});
test('signals request only revision projections, never source payload or credentials',async()=>{
 let body;const db=new SupabaseStorage({url:'https://example.supabase.co',key:'private-key',fetch:async(_url,request)=>{body=JSON.parse(request.body);return Response.json({rows:[{key:'central',revision:8,updated_at:'now'}]});}});
 const result=await sourceSignals(db,[p]);assert.equal(body.input.projection,'revision');assert.deepEqual(body.input.keys,keys);assert.equal(JSON.stringify(result).includes('private-key'),false);assert.equal(result.items.find(i=>i.key==='live:'+p).revision,0);
 for(const values of [[p,p],['foreign'],Array(501).fill(p)])assert.throws(()=>signalKeys(values));
});
test('unchanged signals do not download full records; each real change is notified once',async()=>{
 let revision=2,calls=0;const changed=[],errors=[];const watch=createSourceWatch({getProjects:()=>[p],fetch:async()=>{calls++;return Response.json(payload(revision));},onChange:v=>changed.push(v),onError:v=>errors.push(v)});
 await watch.check();await watch.check();assert.equal(calls,2);assert.equal(changed.length,0);revision=3;await watch.check();await watch.check();assert.equal(changed.length,1);assert.deepEqual(changed[0],{central:true,live:true,creative:true});assert.equal(errors.at(-1),null);
});
test('in-flight dedup, visibility, disposal, incomplete and regressed signals preserve the baseline',async()=>{
 let release,visible=true,calls=0;const changed=[],errors=[];let mode='pending';const watch=createSourceWatch({getProjects:()=>[p],visible:()=>visible,fetch:async()=>{calls++;return mode==='pending'?new Promise(r=>release=r):Response.json(mode==='old'?payload(1):{items:[]});},onChange:v=>changed.push(v),onError:v=>errors.push(v)});
 const first=watch.check();await watch.check();assert.equal(calls,1);release(Response.json(payload(2)));await first;mode='old';await watch.check();assert.ok(errors.at(-1));assert.equal(changed.length,0);visible=false;await watch.check();assert.equal(calls,2);visible=true;mode='bad';await watch.check();assert.ok(errors.at(-1));watch.dispose();await watch.check();assert.equal(calls,3);
});
test('new project scope triggers a read and cannot borrow the previous scope baseline',async()=>{
 let projects=[p];const updates=[];const watch=createSourceWatch({getProjects:()=>projects,fetch:async()=>Response.json({items:signalKeys(projects).map(key=>({key,revision:1}))}),onChange:v=>updates.push(v)});
 await watch.check();projects=[q];await watch.check();assert.equal(updates.length,1);
});
test('source responses cannot regress newer project revisions or duplicate an identity',()=>{
 const previous={projects:[{projectId:p}],items:[{projectId:p,revision:5,snapshot:{spend:99}}],creativeItems:[{projectId:p,revision:4}]},next={projects:[{projectId:p}],items:[{projectId:p,revision:3,snapshot:{spend:1}}],creativeItems:[{projectId:p,revision:5}]};
 const merged=mergeSourceFeed(previous,next);assert.equal(merged.items[0].snapshot.spend,99);assert.equal(merged.creativeItems[0].revision,5);assert.throws(()=>mergeSourceFeed(previous,{...next,items:[next.items[0],next.items[0]]}));
});

test('Creative cache fallback removes projects no longer in the current authorized scope',()=>{
 const previous={projects:[{projectId:p},{projectId:q}],items:[{projectId:p,revision:1},{projectId:q,revision:1}],creativeItems:[{projectId:p,revision:5},{projectId:q,revision:9}]};
 const next={projects:[{projectId:p}],items:[{projectId:p,revision:2}],creativeError:'Temporary source failure'};
 assert.deepEqual(mergeSourceFeed(previous,next).creativeItems,[{projectId:p,revision:5}]);
});

test('Failed full read recovers even when the lightweight source revision remains unchanged',async()=>{
 const {createReadRecovery}=await import('../lib/source-watch.mjs');let now=0,calls=0,fail=true,lastGood='saved',recovery;
 recovery=createReadRecovery({now:()=>now,retry:async()=>{calls++;if(fail){recovery.failed();throw Error('ISOLATED transport loss');}lastGood='fresh';recovery.succeeded();}});
 recovery.failed();assert.equal(await recovery.check(),false);now=30000;assert.equal(await recovery.check(),false);assert.equal(calls,1);assert.equal(lastGood,'saved');
 fail=false;now=59999;assert.equal(await recovery.check(),false);now=60000;assert.equal(await recovery.check(),true);assert.equal(lastGood,'fresh');assert.equal(calls,2);
 now=90000;assert.equal(await recovery.check(),false);assert.equal(calls,2);recovery.dispose();
});

test('Read recovery respects hidden pages, concurrent attempts and disposal without retrying writes',async()=>{
 const {createReadRecovery}=await import('../lib/source-watch.mjs');let now=30000,calls=0,release;const r=createReadRecovery({now:()=>now,retry:()=>{calls++;return new Promise(resolve=>release=resolve);}});r.failed();now=60000;assert.equal(await r.check(false),false);const a=r.check();assert.equal(await r.check(),false);assert.equal(calls,1);release();await a;r.dispose();now=90000;assert.equal(await r.check(),false);assert.equal(calls,1);
});
