import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralSync} from '../lib/central-sync.mjs';
const data=revision=>({revision,state:{config:{},snapshots:[]}});
function harness(request){
 const current={revision:4,saving:false},statuses=[],updates=[],calls=[];
 const sync=createCentralSync({fetch:async(...args)=>{calls.push(args[0]);return request(...args);},getCurrent:()=>current,onUpdate:value=>{updates.push(value);current.revision=value.revision;},onStatus:value=>statuses.push(value),now:()=>Date.parse('2026-11-03T12:00:00Z')});
 return {sync,current,statuses,updates,calls};
}
test('unchanged revisions do not download state and a newer revision is reconciled once',async()=>{
 let revision=4;const h=harness(async url=>Response.json(url.includes('?')?{revision}:data(revision)));
 await h.sync.check();assert.deepEqual(h.calls,['/api/state?revisionOnly=1']);assert.equal(h.updates.length,0);
 revision=5;await h.sync.check();assert.equal(h.current.revision,5);assert.equal(h.updates.length,1);
 await h.sync.check();assert.equal(h.calls.filter(url=>url==='/api/state').length,1);assert.equal(h.statuses.at(-1).status,'current');
});
test('overlapping checks and active writes cannot replace drafts or duplicate reads',async()=>{
 let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));const pending=h.sync.check();await h.sync.check();assert.equal(h.calls.length,1);
 h.current.saving=true;resolve(Response.json({revision:5}));await pending;await h.sync.check();assert.equal(h.calls.length,1);assert.equal(h.updates.length,0);
});
test('a delayed full response cannot overwrite a newer mutation receipt',async()=>{
 let resolve;const h=harness(async url=>url.includes('?')?Response.json({revision:5}):new Promise(done=>{resolve=done;}));
 const pending=h.sync.check();while(!resolve)await new Promise(done=>setImmediate(done));h.current.revision=6;resolve(Response.json(data(5)));await pending;assert.equal(h.updates.length,0);assert.equal(h.current.revision,6);
});
test('a head request started before a successful write cannot report a false outage',async()=>{
 let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));const pending=h.sync.check();h.current.revision=5;resolve(Response.json({revision:4}));await pending;
 assert.equal(h.statuses.length,0);assert.equal(h.updates.length,0);assert.equal(h.calls.length,1);
});
test('failure preserves the last successful check and recovers without writing',async()=>{
 let broken=false;const h=harness(async()=>{if(broken)throw Error('offline');return Response.json({revision:4});});
 await h.sync.check();const last=h.statuses.at(-1).lastCheckedAt;broken=true;await h.sync.check();assert.equal(h.statuses.at(-1).status,'unavailable');assert.equal(h.statuses.at(-1).lastCheckedAt,last);assert.equal(h.updates.length,0);
 broken=false;await h.sync.check();assert.equal(h.statuses.at(-1).status,'current');
});
test('expired sessions, malformed data and regressed backend revisions never appear current',async()=>{
 for(const response of [()=>new Response(null,{status:401}),()=>Response.json({revision:'5'}),()=>Response.json({revision:3})]){
  const h=harness(response);await h.sync.check();assert.ok(['signed-out','unavailable'].includes(h.statuses.at(-1).status));assert.equal(h.statuses.at(-1).lastCheckedAt,null);assert.equal(h.updates.length,0);
 }
 const h=harness(async url=>Response.json(url.includes('?')?{revision:5}:{revision:5}));await h.sync.check();assert.equal(h.statuses.at(-1).status,'unavailable');assert.equal(h.updates.length,0);
});
test('disposing during a read prevents late UI updates and aborts network work',async()=>{
 let resolve,signal;const h=harness((url,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});});const pending=h.sync.check();h.sync.dispose();assert.equal(signal.aborted,true);resolve(Response.json({revision:5}));await pending;assert.equal(h.statuses.length,0);assert.equal(h.updates.length,0);
});
