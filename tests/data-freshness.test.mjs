import test from 'node:test';
import assert from 'node:assert/strict';
import {dataFreshness} from '../lib/data-freshness.mjs';
const now=Date.parse('2026-11-02T20:00:00Z');
test('A recent source timestamp cannot hide an old Bunker collection',()=>{assert.equal(dataFreshness({fetchedAt:'2026-11-02T18:00:00Z',lastSyncAt:'2026-11-02T19:59:00Z'},now).stale,true);});
test('A recent collection cannot hide an old Malva synchronization',()=>{assert.equal(dataFreshness({fetchedAt:'2026-11-02T19:59:00Z',lastSyncAt:'2026-11-02T18:00:00Z'},now).stale,true);});
test('Missing, invalid or future timestamps are unavailable instead of fresh',()=>{for(const stamp of [null,undefined,'bad-date','2026-11-03T00:00:00Z']){const result=dataFreshness({fetchedAt:stamp,lastSyncAt:stamp},now);assert.deepEqual(result,{fetchedAt:null,sourceUpdatedAt:null,stale:true});}assert.equal(dataFreshness(undefined,now).stale,true);});
test('Both confirmed clocks stay visible for a recent saved reading',()=>{const snapshot={fetchedAt:'2026-11-02T19:59:00Z',lastSyncAt:'2026-11-02T19:55:00Z'};assert.deepEqual(dataFreshness(snapshot,now),{...{fetchedAt:snapshot.fetchedAt,sourceUpdatedAt:snapshot.lastSyncAt},stale:false});});
