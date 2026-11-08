import test from 'node:test';
import assert from 'node:assert/strict';
import {newChanges,orderPulse,nextPulse,liveOrder} from '../lib/change-watch.mjs';

const e=(id,min)=>({id,at:new Date(Date.parse('2026-11-08T12:00:00Z')+min*60000).toISOString()});

test('Edit watch is independent of the source order: no replays, nothing old on the first look', () => {
 const first=newChanges(null,[e('a',1),e('c',3),e('b',2)]);
 assert.deepEqual(first.fresh,[]);assert.equal(first.head.id,'c','head is the newest edit, not the first listed');
 const same=newChanges(first.head,[e('b',2),e('a',1),e('c',3)]);assert.deepEqual(same.fresh,[],'reordered list replays nothing');
 const more=newChanges(same.head,[e('a',1),e('d',4),e('c',3),e('e',5)]);
 assert.deepEqual(more.fresh.map(x=>x.id),['e','d']);assert.equal(more.head.id,'e');
 assert.deepEqual(newChanges(more.head,[e('e',5),e('d',4)]).fresh,[]);
});

test('When the head fell out of the short list, only edits after it count', () => {
 const r=newChanges(e('h',10),[e('x',9),e('y',11),e('z',12)]);
 assert.deepEqual(r.fresh.map(x=>x.id),['z','y']);assert.equal(r.head.id,'z');
 assert.deepEqual(newChanges(e('h',10),[]).fresh,[]);assert.equal(newChanges(e('h',10),null).head.id,'h');
});

test('Pulses move only when something changed', () => {
 assert.deepEqual(nextPulse({version:4},[{project:'p',events:[]}]),{version:4});
 const p=nextPulse({version:4},[{project:'p',events:[{project:'p',name:'Camp',at:'2026-11-08T12:00:00Z',actor:'Erik'},{project:'p',name:'Nova',at:'2026-11-08T12:05:00Z',actor:'Ana'}]}],Date.parse('2026-11-08T12:06:00Z'));
 assert.equal(p.version,5);assert.equal(p.last.campaign,'Nova');assert.deepEqual(p.projects,['p']);
 const r=[{id:'o',stage:'checking',project:'p'}],a=orderPulse({version:1},r,'');assert.equal(a.pulse.version,2);
 assert.equal(orderPulse(a.pulse,r,a.sig).pulse,null);
 assert.equal(orderPulse(a.pulse,[{...r[0],stage:'failed'}],a.sig).pulse.version,3,'stalled order surfacing as failed moves the pulse');
});

test('Live reads: projects with fresh edits first, then urgent, then the oldest read, capped', () => {
 const ps=['a','b','c','d'].map(projectId=>({projectId}));
 assert.deepEqual(liveOrder(ps,{first:['c'],urgent:['d'],lastSuccess:{a:'2026-11-08T12:00:00Z',b:'2026-11-08T11:00:00Z'}}).map(p=>p.projectId),['c','d']);
 assert.deepEqual(liveOrder(ps,{lastSuccess:{a:'2026-11-08T12:00:00Z',b:'2026-11-08T11:00:00Z',c:'2026-11-08T12:01:00Z',d:'2026-11-08T12:02:00Z'}}).map(p=>p.projectId),['b','a']);
});
