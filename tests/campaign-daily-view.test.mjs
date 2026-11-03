import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeDailyItem,sameDailyCache} from '../lib/campaign-daily-view.mjs';

const target={projectId:'john',adAccountId:'account-a',objectId:'meta-1',internalObjectId:'malva-a',timezone:'America/Sao_Paulo'};
const range={from:'2026-10-28',to:'2026-11-03'};
const snapshot={fetchedAt:'2026-11-03T14:00:00.000Z',from:range.from,to:range.to,rows:[{day:'2026-11-03',spend:100,orders:2}]};
const item=(patch={})=>({target:{...target},range:{...range},snapshot:structuredClone(snapshot),revision:8,status:'ready',error:null,...patch});

test('a new internal Malva identity clears the old series and accepts its reset revision',()=>{
 const previous=item(),pending=item({target:{...target,internalObjectId:'malva-b'},revision:0,snapshot:null,status:'pending'});
 assert.equal(sameDailyCache(previous,pending),false);
 assert.deepEqual(mergeDailyItem(previous,pending),pending);
 const fresh=item({target:pending.target,revision:1,snapshot:{...snapshot,fetchedAt:'2026-11-03T13:59:00.000Z',rows:[{day:'2026-11-03',spend:20,orders:1}]}});
 assert.deepEqual(mergeDailyItem(previous,fresh),fresh);
 assert.equal(previous.snapshot.rows[0].spend,100);
});

test('the next local day clears yesterday series even when no new snapshot is available',()=>{
 const previous=item(),next=item({range:{from:'2026-10-29',to:'2026-11-04'},revision:0,snapshot:null,status:'pending'});
 assert.equal(sameDailyCache(previous,next),false);
 const result=mergeDailyItem(previous,next);
 assert.equal(result.snapshot,null);assert.equal(result.range.to,'2026-11-04');assert.equal(result.revision,0);
});

test('a failed refresh preserves the last snapshot only within the exact same identity and range',()=>{
 const previous=item(),before=structuredClone(previous),incoming=item({revision:9,snapshot:null,status:'error',error:{message:'Malva indisponível'}}),incomingBefore=structuredClone(incoming);
 const merged=mergeDailyItem(previous,incoming);
 assert.deepEqual(merged.snapshot,previous.snapshot);assert.equal(merged.status,'error');assert.deepEqual(merged.error,incoming.error);
 assert.deepEqual(previous,before);assert.deepEqual(incoming,incomingBefore);
});

test('project, account, external ID and timezone changes cannot inherit another cache',()=>{
 for(const field of ['projectId','adAccountId','objectId','timezone']){
  const incoming=item({target:{...target,[field]:'different'},revision:0,snapshot:null});
  assert.equal(sameDailyCache(item(),incoming),false,field);
  assert.equal(mergeDailyItem(item(),incoming).snapshot,null,field);
 }
});

test('only an older revision from the same exact cache is ignored',()=>{
 const previous=item(),older=item({revision:7,snapshot:null,status:'pending'});
 assert.equal(mergeDailyItem(previous,older),previous);
 const newer=item({revision:9,snapshot:{...snapshot,fetchedAt:'2026-11-03T13:00:00.000Z'},status:'error'});
 const merged=mergeDailyItem(previous,newer);assert.equal(merged.revision,9);assert.equal(merged.status,'error');assert.deepEqual(merged.snapshot,previous.snapshot);
});

test('unconfirmed identity or missing response never justifies retaining an old series',()=>{
 const incoming=item({target:{projectId:target.projectId,adAccountId:target.adAccountId,objectId:target.objectId},revision:0,snapshot:null});
 assert.equal(sameDailyCache(item(),incoming),false);assert.equal(mergeDailyItem(item(),incoming).snapshot,null);
 assert.equal(mergeDailyItem(item(),null),null);
});
