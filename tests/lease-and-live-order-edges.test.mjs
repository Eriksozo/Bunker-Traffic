import test from 'node:test';
import assert from 'node:assert/strict';
import {liveCollectionLease,collectionLeaseMs} from '../lib/collection-lease.mjs';
import {liveOrderRow,liveOrderActions,liveTarget,liveOrderLimits} from '../lib/owner-order-live.mjs';

const now=Date.parse('2026-11-08T15:00:00.000Z'),iso=t=>new Date(t).toISOString();

test('Collection lease: live strictly inside 45 min, never from the future or a bad clock', () => {
 const job=at=>({startedAt:iso(at)});
 assert.equal(liveCollectionLease(job(now),now),true,'just started');
 assert.equal(liveCollectionLease(job(now-collectionLeaseMs+1),now),true);
 assert.equal(liveCollectionLease(job(now-collectionLeaseMs),now),false,'exactly 45 min is expired');
 assert.equal(liveCollectionLease(job(now+1),now),false,'start in the future');
 for(const bad of [null,undefined,{},{startedAt:'ontem'},{startedAt:''}])assert.equal(liveCollectionLease(bad,now),false);
 assert.equal(liveCollectionLease(job(now),NaN),false,'invalid clock');
});

const row=(over={})=>({id:'4f0c2c1e-8f43-4a8b-9a1d-3c3f9f1f2a10',adAccountId:'act1',externalId:'c1',provider:'meta',budgetCurrency:'BRL',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',...over});
const item=(over={},snap={})=>({projectId:'p1',snapshot:{complete:true,level:'campaign',source:'Malva MCP',fetchedAt:iso(now-60000),rows:[row()],...snap},...over});

test('Live order row: only a fresh, complete, campaign-level Malva reading with exactly one match', () => {
 assert.equal(liveOrderRow([item()],'p1','act1','c1',now).row.externalId,'c1');
 const refused={error:[item({error:'timeout'})],incomplete:[item({},{complete:false})],adset:[item({},{level:'adset'})],other:[item({},{source:'CSV'})],
  stale:[item({},{fetchedAt:iso(now-liveOrderLimits.freshMs-1)})],future:[item({},{fetchedAt:iso(now+6000)})],badDate:[item({},{fetchedAt:'agora'})],
  duplicate:[item({},{rows:[row(),row()]})],otherAccount:[item({},{rows:[row({adAccountId:'act2'})]})],otherProject:[item({projectId:'p2'})],noRows:[item({},{rows:undefined})]};
 for(const [k,items] of Object.entries(refused))assert.equal(liveOrderRow(items,'p1','act1','c1',now),null,k);
 assert.ok(liveOrderRow([item({},{fetchedAt:iso(now+4000)})],'p1','act1','c1',now),'small clock skew tolerated');
 for(const bad of [null,undefined,'x',{}])assert.equal(liveOrderRow(bad,'p1','act1','c1',now),null);
});

test('Live order actions follow the row, never more than it allows', () => {
 const a=r=>liveOrderActions({row:row(r)});
 assert.deepEqual(a({}),{increase:true,reduce:true,pause:true,keep:false});
 assert.deepEqual(liveOrderActions({row:row()},{paused:true}),{increase:false,reduce:false,pause:false,keep:false},'office pause blocks all');
 assert.deepEqual(liveOrderActions(null),{increase:false,reduce:false,pause:false,keep:false});
 assert.equal(a({accountStatus:{active:false}}).increase,false,'inactive account: no more exposure');
 assert.equal(a({accountStatus:{active:false}}).reduce,true,'but it may still be contained');
 for(const r of [{lifetimeBudget:500},{dailyBudget:0},{dailyBudget:null},{dailyBudget:'100'}]){const x=a(r);assert.equal(x.increase||x.reduce,false,JSON.stringify(r));}
 for(const r of [{budgetCurrency:'R$'},{budgetCurrency:'brl'},{budgetCurrency:null}])assert.deepEqual(a(r),{increase:false,reduce:false,pause:false,keep:false},'currency must be native ISO');
 assert.equal(a({status:'PAUSED'}).pause,false);assert.equal(a({provider:'kwai'}).pause,false,'Kwai out of scope');
 assert.equal(a({provider:'META'}).reduce,true,'provider name is case-insensitive');
});

test('Live target keeps N/D as null and drops non-text ids', () => {
 assert.deepEqual(liveTarget(row()),{id:row().id,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE'});
 assert.deepEqual(liveTarget({id:42}),{id:null,dailyBudget:null,lifetimeBudget:null,status:null});
});
