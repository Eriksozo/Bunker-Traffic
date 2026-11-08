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

test('Impossible negatives are refused at the import boundary; net revenue and costs may still be negative', async () => {
 const {bundleSchema}=await import('../lib/snapshot-schema.mjs');
 const row={externalId:'c1',name:'Camp',level:'campaign',adAccountId:'a1',accountName:'Conta',spend:10,revenueNet:-5,adCosts:-1,budgetRate:1,dailyBudget:100};
 const snap=r=>({snapshots:[{projectId:'p',projectName:'P',period:'today',from:'2026-11-08T03:00:00.000Z',to:'2026-11-09T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:'2026-11-08T12:00:00.000Z',lastSyncAt:null,source:'Malva MCP',level:'campaign',complete:true,rows:[r]}]});
 assert.equal(bundleSchema.safeParse(snap(row)).success,true,'refund-driven negative net revenue is real');
 for(const f of ['spend','revenue','orders','frontOrders','checkouts','impressions','linkClicks','dailyBudget','lifetimeBudget','refundedRevenue'])assert.equal(bundleSchema.safeParse(snap({...row,[f]:-1})).success,false,f);
 for(const budgetRate of [0,-5.4])assert.equal(bundleSchema.safeParse(snap({...row,budgetRate})).success,false,'rate '+budgetRate);
 assert.equal(bundleSchema.safeParse(snap({...row,spend:null,budgetRate:null})).success,true,'N/D stays allowed');
});
