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
