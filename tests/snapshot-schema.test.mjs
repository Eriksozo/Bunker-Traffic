import test from 'node:test';import assert from 'node:assert/strict';
import {bundleSchema,snapshotRange} from '../lib/snapshot-schema.mjs';
const snapshot={projectId:'p',projectName:'Test',period:'today',from:'2026-11-02T04:00:00Z',to:'2026-11-03T04:00:00Z',timezone:'America/Boa_Vista',fetchedAt:'2026-11-02T12:00:00Z',lastSyncAt:null,source:'Malva MCP',level:'campaign',complete:true,rows:[]};
test('Import accepts valid explicit windows and IANA zones',()=>{assert.equal(bundleSchema.safeParse({snapshots:[snapshot]}).success,true);assert.match(snapshotRange(snapshot),/02\/11\/2026 — 02\/11\/2026/);});
test('Invalid zones, dates and reversed ranges fail the whole import',()=>{for(const patch of [{timezone:'UTC+3'},{from:'not-a-date'},{to:snapshot.from},{from:snapshot.to,to:snapshot.from}])assert.equal(bundleSchema.safeParse({snapshots:[snapshot,{...snapshot,...patch}]}).success,false);});
test('Legacy invalid saved data is displayed as unavailable instead of throwing',()=>{for(const patch of [{timezone:'UTC+3'},{from:'invalid'},{to:snapshot.from}])assert.match(snapshotRange({...snapshot,...patch}),/N\/D/);});
test('Operational display coverage survives validation and cannot claim an incomplete partition is complete',()=>{
 const coverage={kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:42};
 const parsed=bundleSchema.parse({snapshots:[{...snapshot,coverage}]});
 assert.deepEqual(parsed.snapshots[0].coverage,coverage);
 for(const patch of [{spentComplete:false},{kind:'all-history'},{trackedCount:-1}])assert.equal(bundleSchema.safeParse({snapshots:[{...snapshot,coverage:{...coverage,...patch}}]}).success,false);
});
