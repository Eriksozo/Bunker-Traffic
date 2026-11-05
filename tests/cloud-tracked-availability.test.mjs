import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCloudProject,cloudRanges} from '../lib/cloud-collector.mjs';
import {bundleSchema} from '../lib/snapshot-schema.mjs';
import {validateAnalysisBundle} from '../lib/analysis-validation.mjs';
import {cloudFocus} from '../lib/cloud-analysis.mjs';
import {trackedTargets} from '../lib/live-data.mjs';
import {emptyRoundEligibility} from '../lib/empty-round-review.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
const project={id:'11111111-1111-4111-8111-111111111111',name:'Example',timezone:'UTC',currency:'BRL'},account='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-11-05T15:00:00Z'),iso=n=>new Date(n).toISOString(),ranges=cloudRanges(now,'UTC');
const active={id:'33333333-3333-4333-8333-333333333333',externalId:'active',adAccountId:account,accountName:'Account',projectId:project.id,projectName:project.name,provider:'meta',level:'campaign',name:'Active sales',status:'ACTIVE',budgetCurrency:'BRL',dailyBudget:100,spend:100,revenueNet:200,frontOrders:2};
const missing={...active,id:'44444444-4444-4444-8444-444444444444',externalId:'missing',name:'Prior sales',status:'PAUSED',spend:50};
function source({reappeared=false,changeDetail,changeCurrent}={}){let details=0;return {get details(){return details;},read:async(tool,a)=>{
 if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta',accountId:'native-account'}]};
 if(tool==='tracking_ad_detail'){details++;const detail={row:null,provider:'meta',level:'campaign',externalId:missing.externalId,accountId:'native-account',currency:'BRL',period:{timezone:'UTC',from:ranges.today.from+'T00:00:00.000Z',to:iso(Date.parse(ranges.today.to)+86400000)}};changeDetail?.(detail);return detail;}
 const period=a.from===ranges.today.from?'today':a.from===ranges['7d'].from?'7d':a.from===ranges['3d'].from?'3d':'yesterday';
 let rows=a.level!=='campaign'?[]:period==='today'?a.q?[]:[{...active},...(reappeared?[{...missing,spend:0}]:[])]:[{...active},{...missing}];if(period==='today')changeCurrent?.(rows);
 return {rows,level:a.level,currency:'BRL',salesScope:{kind:'traffic'},freshAt:iso(now),lastSyncAt:iso(now-1000),period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to)+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]}};
 }};}
test('A verified metadata-only lookup keeps unavailable tracked identity explicit and lets valid campaigns finish twelve cuts',async()=>{
 const client=source(),out=await collectCloudProject(client,project,{now:()=>now,tracked:[missing]}),today=out.snapshots.find(s=>s.period==='today'&&s.level==='campaign');
 assert.equal(client.details,1);assert.equal(out.snapshots.length,12);assert.equal(today.analysisScope.trackedComplete,false);assert.equal(today.rows.length,1);assert.equal(today.rows[0].spend,100);assert.deepEqual(today.analysisScope.unavailableTracked,[{id:missing.id,externalId:'missing',adAccountId:account,reason:'no-current-row',checkedAt:iso(now)}]);
 const state={config:{[project.id]:{projectName:project.name}},snapshots:out.snapshots,jobs:[{id:'job',project:project.id,status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now)}],agents:{[project.id]:{jobId:'job'}}};
 assert.doesNotThrow(()=>validateAnalysisBundle(out,{snapshots:[]},now));for(const mutate of [g=>g.id='foreign',g=>g.checkedAt=iso(now+600000),g=>g.checkedAt=iso(now-600000)]){const invalid=structuredClone(out);mutate(invalid.snapshots.find(s=>s.period==='today'&&s.level==='campaign').analysisScope.unavailableTracked[0]);assert.throws(()=>validateAnalysisBundle(invalid,{snapshots:[]},now));}assert.deepEqual(cloudFocus(state,project.id).map(r=>r.externalId),['active']);assert.ok(trackedTargets(state,project.id).some(t=>t.externalId==='missing'));
 const round=ensureCollaboration(state,state.jobs[0],now);assert.equal(round.sourceCut.find(c=>c.period==='today'&&c.level==='campaign').analysisScope.unavailableTracked[0].externalId,'missing');
 assert.equal(emptyRoundEligibility(state,round,now),false);assert.equal(today.rows.some(r=>r.externalId==='missing'),false);
});
test('Returning tracked rows are restored from the new source, without copying old spend or retaining a false gap',async()=>{
 const out=await collectCloudProject(source({reappeared:true}),project,{now:()=>now,tracked:[missing]}),today=out.snapshots.find(s=>s.period==='today'&&s.level==='campaign');assert.equal(today.analysisScope.trackedComplete,true);assert.equal(today.analysisScope.unavailableTracked,undefined);assert.equal(today.rows.find(r=>r.externalId==='missing').spend,0);
});
test('A null row never excuses wrong native account, object, provider, period or missing identity metadata',async()=>{
 for(const changeDetail of [d=>d.accountId='foreign',d=>d.externalId='foreign',d=>d.provider='kwai',d=>d.period.timezone='America/Sao_Paulo',d=>d.period.to=iso(now),d=>delete d.row,d=>delete d.accountId])await assert.rejects(collectCloudProject(source({changeDetail}),project,{now:()=>now,tracked:[missing]}),e=>e.code==='SOURCE_TRACKED_IDENTITY');
 await assert.rejects(collectCloudProject(source({changeCurrent:rows=>{if(rows[0])rows[0].id=missing.id;}}),project,{now:()=>now,tracked:[active]}),e=>e.code==='SOURCE_TRACKED_IDENTITY');
});
test('Coverage cannot fabricate zero rows, omit a declared gap, duplicate one or call unresolved tracking complete',async()=>{
 const out=await collectCloudProject(source(),project,{now:()=>now,tracked:[missing]}),s=out.snapshots.find(s=>s.period==='today'&&s.level==='campaign');
 for(const mutate of [s=>s.analysisScope.trackedComplete=true,s=>delete s.analysisScope.unavailableTracked,s=>s.analysisScope.unavailableTracked.push(s.analysisScope.unavailableTracked[0]),s=>s.rows.push(missing),s=>s.analysisScope.unavailableTracked[0].spend=0,s=>s.period='7d']){const changed=structuredClone(s);mutate(changed);assert.equal(bundleSchema.safeParse({snapshots:[changed]}).success,false);}
});
