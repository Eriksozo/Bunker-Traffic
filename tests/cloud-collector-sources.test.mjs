import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCloudProject} from '../lib/cloud-collector.mjs';
import {validateAnalysisBundle,assertFinancialSources} from '../lib/analysis-validation.mjs';

// Curadoria of 13/11/2026 (P1/P2): the tracked-campaign detail fallback and the active/spent overlap of today's cut.
// Synthetic fixtures only; every read is in memory and no provider is called.
const now=Date.parse('2026-11-13T15:00:00Z'),iso=n=>new Date(n).toISOString();
const p={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic',timezone:'UTC',currency:'BRL'};
const account='22222222-2222-4222-8222-222222222222';
const row={id:'33333333-3333-4333-8333-333333333333',externalId:'123456',adAccountId:account,accountName:'Synthetic',projectId:p.id,projectName:p.name,provider:'meta',level:'campaign',name:'Synthetic',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'BRL',dailyBudget:100,spend:10};
const tracked={...row,id:'44444444-4444-4444-8444-444444444444',externalId:'654321',status:'PAUSED',effectiveStatus:'PAUSED'};
const period=a=>({timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to)+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]});
const detail=()=>({row:{...tracked},provider:'meta',level:'campaign',externalId:tracked.externalId,accountId:'555555555555',currency:'BRL',freshAt:iso(now-1000),lastSyncAt:iso(now-1000),
 period:{timezone:'UTC',from:'2026-11-13T00:00:00.000Z',to:'2026-11-14T00:00:00.000Z',days:['2026-11-13']}});
function source({mutateDetail,active,spent}={}){
 return {read:async(tool,a)=>{
  if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta',accountId:'555555555555'}]};
  if(tool==='tracking_ad_detail'){const d=detail();mutateDetail?.(d);return d;}
  assert.equal(tool,'tracking_campaigns');
  const part=a.status==='active'?active:a.status==='spent'?spent:null,stamp=part?.at??now,rows=part?.row?[part.row]:[{...row}];
  return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(stamp),lastSyncAt:iso(stamp),period:period(a),rows:a.level==='campaign'?rows:[]};
 }};
}
const collect=(client,extra={})=>collectCloudProject(client,p,{now:()=>now,startedAt:iso(now-5000),...extra});
const today=out=>out.snapshots.find(s=>s.period==='today'&&s.level==='campaign');

test('detail fallback: a valid detail joins the cut with its own time and passes the financial validation',async()=>{
 const out=await collect(source(),{tracked:[tracked]});
 assert.equal(out.snapshots.length,12);
 const t=today(out);assert.ok(t.rows.some(r=>r.externalId===tracked.externalId));
 assert.equal(t.fetchedAt,iso(now-1000),'the detail freshAt, older than the listing, is the cut time');
 validateAnalysisBundle(out,{snapshots:[]},now);assertFinancialSources(out.snapshots,now);
});

test('detail fallback: yesterday, foreign project, other period, future or invalid time fail explicitly',async()=>{
 const cases={
  'freshAt of yesterday':d=>{d.freshAt=iso(now-86400000);d.lastSyncAt=d.freshAt;},
  'freshAt in the future':d=>{d.freshAt=iso(now+3600000);},
  'freshAt invalid':d=>{d.freshAt='ontem';},
  'freshAt before the collection':d=>{d.freshAt=iso(now-60000);},
  'foreign project':d=>{d.row.projectId='99999999-9999-4999-8999-999999999999';d.row.projectName='Foreign';},
  'project fields missing':d=>{delete d.row.projectId;},
  'yesterday period':d=>{d.period={...d.period,from:'2026-11-12T00:00:00.000Z',to:'2026-11-13T00:00:00.000Z',days:['2026-11-12']};},
  'other provider':d=>{d.provider='google';},
  'other object':d=>{d.externalId='000';},
 };
 for(const [name,mutate] of Object.entries(cases))await assert.rejects(collect(source({mutateDetail:mutate}),{tracked:[tracked]}),e=>/^SOURCE_/.test(e.code),name);
});

test('detail fallback: a detail without its own freshness is declared unavailable, never dated by the listing',async()=>{
 const out=await collect(source({mutateDetail:d=>{delete d.freshAt;delete d.lastSyncAt;}}),{tracked:[tracked]});
 const t=today(out);
 assert.equal(t.rows.some(r=>r.externalId===tracked.externalId),false,'the undated row stays out');
 assert.equal(t.analysisScope.trackedComplete,false);
 assert.deepEqual(t.analysisScope.unavailableTracked.map(u=>[u.externalId,u.reason]),[[tracked.externalId,'no-freshness']]);
 // The analysis accepts the declared gap only for an identity tracked before (here, yesterday's saved analysis).
 const before={snapshots:[{projectId:p.id,projectName:p.name,period:'today',level:'campaign',fetchedAt:iso(now-86400000),lastSyncAt:null,rows:[tracked]}]};
 validateAnalysisBundle(out,before,now);assertFinancialSources(out.snapshots,now);
});

test('active/spent overlap: different status or budget refuses a hybrid reading; only metrics → the newer whole row',async()=>{
 const live={levels:['campaign'],periodsWanted:['today'],purpose:'live'};
 // Active newer with another budget, spent older: the source changed between the reads.
 await assert.rejects(collect(source({active:{row:{...row,dailyBudget:80,spend:20}},spent:{row:{...row,spend:10},at:now-1000}}),live),{code:'SOURCE_CHANGED'});
 // Same clock, different status: refused too.
 await assert.rejects(collect(source({active:{row:{...row}},spent:{row:{...row,status:'PAUSED',effectiveStatus:'PAUSED'}}}),live),{code:'SOURCE_CHANGED'});
 // Metrics only: the newer read wins whole, in either order.
 const activeNewer=await collect(source({active:{row:{...row,spend:20}},spent:{row:{...row,spend:10},at:now-1000}}),live);
 assert.equal(today(activeNewer).rows[0].spend,20);
 const spentNewer=await collect(source({active:{row:{...row,spend:20},at:now-1000},spent:{row:{...row,spend:30}}}),live);
 assert.equal(today(spentNewer).rows[0].spend,30);
 // Coherent overlap: one row, the cut dated by the older read.
 const same=await collect(source({active:{row:{...row},at:now-2000},spent:{row:{...row}}}),live);
 assert.equal(today(same).rows.length,1);assert.equal(today(same).fetchedAt,iso(now-2000));
});
