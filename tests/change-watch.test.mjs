import test from 'node:test';
import assert from 'node:assert/strict';
import {changeWatchRequest,newChanges,watchProject,nextPulse,liveOrder,changeWatchPolicy} from '../lib/change-watch.mjs';

const project={id:'72b71a6b-f55a-4563-a456-1b441dec9851',name:'John',timezone:'America/Sao_Paulo'};
const now=Date.parse('2026-11-07T23:10:00Z');
const item=(id,at,extra={})=>({id,at,source:'malva',eventType:'update_campaign_run_status',category:'status',automatic:false,actor:{name:'Erik Sozo',kind:'malva'},app:'Malva Dash',
 object:{level:'campaign',externalId:'1202'+id,name:'Campanha '+id},account:{id:'acc-'+id,label:'Conta 13',currency:'BRL',provider:'meta'},values:{kind:'status',from:'active',to:'paused'},...extra});
const page=items=>({period:{from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',timezone:'America/Sao_Paulo'},timezone:'America/Sao_Paulo',items,nextCursor:null});
const source=items=>({calls:[],async read(tool,args){this.calls.push({tool,args});return page(items);}});

test('The watch asks only for the newest few campaign budget/status edits of today', () => {
 const r=changeWatchRequest(project);
 assert.deepEqual(r,{projectId:project.id,provider:['meta'],who:'people',level:['campaign'],category:['budget','status'],limit:changeWatchPolicy.limit,preset:'today'});
});

test('First look primes the head; later looks return only what is new', () => {
 const a=item('a','2026-11-07T23:07:51.451Z'),b=item('b','2026-11-07T22:55:06.986Z');
 assert.deepEqual(newChanges(null,[a,b]),{fresh:[],head:{id:'a',at:a.at}});
 assert.deepEqual(newChanges({id:'a',at:a.at},[a,b]).fresh,[]);
 const c=item('c','2026-11-07T23:09:00.000Z');
 const next=newChanges({id:'a',at:a.at},[c,a,b]);
 assert.deepEqual(next.fresh.map(x=>x.id),['c']);assert.equal(next.head.id,'c');
 // The old head scrolled out (e.g. a new day): fall back to time.
 assert.deepEqual(newChanges({id:'zz',at:'2026-11-07T23:00:00.000Z'},[c,a,b]).fresh.map(x=>x.id),['c','a']);
 assert.deepEqual(newChanges({id:'a',at:a.at},[]),{fresh:[],head:{id:'a',at:a.at}});
});

test('A new edit becomes a stored event with author, same key as the history feed', async () => {
 const s=source([item('c','2026-11-07T23:09:00.000Z'),item('a','2026-11-07T23:07:51.451Z')]);
 const out=await watchProject(s,project,{id:'a',at:'2026-11-07T23:07:51.451Z'},now);
 assert.equal(s.calls.length,1);assert.equal(s.calls[0].tool,'tracking_ad_changes');
 assert.equal(out.events.length,1);
 const e=out.events[0];
 assert.equal(e.key,'history:'+project.id+':c');assert.equal(e.actor,'Erik Sozo');assert.equal(e.field,'status');assert.equal(e.before,'ACTIVE');assert.equal(e.after,'PAUSED');assert.equal(e.objectId,'1202c');
 await assert.rejects(()=>watchProject({async read(){return {...page([]),timezone:'UTC'};}},project,null,now),/ACTIVITY_HISTORY_IDENTITY/);
});

test('The pulse counts only real news and names the newest edit', async () => {
 assert.deepEqual(nextPulse(null,[],now),{version:0,at:null,last:null});
 const s=source([item('c','2026-11-07T23:09:00.000Z'),item('a','2026-11-07T23:07:51.451Z')]);
 const change=await watchProject(s,project,{id:'a',at:'2026-11-07T23:07:51.451Z'},now);
 const p=nextPulse({version:4},[change,{project:'x',events:[]}],now);
 assert.equal(p.version,5);assert.deepEqual(p.projects,[project.id]);assert.equal(p.last.actor,'Erik Sozo');assert.equal(p.last.after,'PAUSED');
 assert.equal(nextPulse(p,[{project:'x',events:[]}],now),p);
});

test('Projects with fresh edits are read first, at most two per pulse', () => {
 const ps=[{projectId:'a'},{projectId:'b'},{projectId:'c'}];
 assert.deepEqual(liveOrder(ps,{first:['c'],lastSuccess:{a:'2026-11-07T20:00:00Z',b:'2026-11-07T21:00:00Z'}}).map(p=>p.projectId),['c','a']);
 assert.deepEqual(liveOrder(ps,{urgent:['b']}).map(p=>p.projectId),['b','a']);
});
