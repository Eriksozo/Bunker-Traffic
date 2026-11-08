import test from 'node:test';
import assert from 'node:assert/strict';
import {sum,candidates,phase,budget} from '../lib/analysis.mjs';
const base={externalId:'1',level:'campaign',adAccountId:'a',accountName:'A',name:'[TESTE]',effectiveStatus:'ACTIVE',spend:1000,revenue:3000,revenueNet:2900,adCosts:100,productCost:0,saleTax:0,frontOrders:10,orders:14,checkouts:40,impressions:10000,linkClicks:500,refundedRevenue:0};
const make=(rows=[base],config={})=>({config,snapshots:['7d','3d','today'].map((period,i)=>({projectId:'p',period,level:'campaign',lastSyncAt:new Date().toISOString(),rows:rows.map(r=>({...r,spend:r.spend/(i+1)}))}))});
test('Ratios use summed denominators, not averages',()=>{assert.equal(sum([{...base,spend:100,revenue:1200,revenueNet:1000},{...base,spend:900,revenue:1100,revenueNet:900}]).roas,1.9);assert.equal(sum([{...base,adCosts:null}]).roi,null);assert.equal(sum([]).spend,null);});
test('Paused winner never gets operational scale signal',()=>{const c=candidates(make([{...base,effectiveStatus:'PAUSED'}]),'p')[0];assert.equal(c.decision,'Revisar objeto sem entrega ativa');});
test('Same-day windows are not evidence of multiple successful days',()=>{const s=make();s.snapshots.forEach(x=>x.rows=[base]);assert.equal(candidates(s,'p')[0].decision,'Amostra recente');});
// Updated: closed 7d/3d spend proves delivery older than today, so an unknown start no longer protects this losing test (Malva never sends deliveryStartedAt).
test('Protected test with unknown delivery does not get a cut signal',()=>{const s=make([{...base,revenue:0,revenueNet:0}],{p:{testHours:24}});assert.notEqual(candidates(s,'p')[0].decision,'Teste protegido');s.snapshots=s.snapshots.filter(x=>x.period==='today');assert.equal(candidates(s,'p')[0].decision,'Teste protegido');});
test('Stale data is not made fresh by a protection label',()=>{const s=make([base],{p:{testHours:24}});s.snapshots.forEach(x=>x.lastSyncAt='2026-01-01T00:00:00Z');assert.equal(candidates(s,'p')[0].decision,'Investigar');});
test('Bid and Cost Cap are scale; pre-scale stays separate',()=>{assert.equal(phase('[COST-CAP]'),'Escala');assert.equal(phase('[PRE-ESCALA]'),'Pré-escala');});
test('CBO budget is counted once; missing ABO is explicitly unknown',()=>{const r={...base,projectId:'p',dailyBudget:100,budgetRate:5};const b=budget([r,r,{...r,externalId:'2',dailyBudget:null}]);assert.equal(b.active,500);assert.equal(b.unknown,1);});

test('Malva campaign ROAS uses checkout net; ROI additionally deducts product and tax',()=>{const m=sum([{...base,spend:100,revenue:200,revenueNet:180,adCosts:10,productCost:20,saleTax:5}]);assert.equal(m.roas,1.8);assert.equal(m.roi,155/110);assert.equal(m.result,45);assert.equal(sum([{...base,productCost:undefined}]).roi,null);});

test('Absent or non-finite spend never becomes a zero cost per acquisition or click',()=>{
 for(const spend of [null,undefined,NaN,Infinity,-Infinity,'100']){
  const rows=[{...base,spend}],before=structuredClone(rows),m=sum(rows);
  for(const key of ['spend','cpc','cpm','ic','cpaFront','roas','roi','result'])assert.equal(m[key],null,`${key} must remain unknown for ${String(spend)}`);
  assert.deepEqual(rows,before);
 }
});
test('Missing denominator in any contributing row keeps only its dependent metric unknown',()=>{
 const cases={linkClicks:'cpc',impressions:'cpm',checkouts:'ic',frontOrders:'cpaFront'};
 for(const [field,metric] of Object.entries(cases))for(const value of [null,undefined,NaN,Infinity]){
  const m=sum([{...base},{...base,[field]:value}]);assert.equal(m[field],null);assert.equal(m[metric],null);assert.equal(m.spend,2000);assert.equal(m.roas,2.9);
 }
});
test('A measured zero spend remains zero cost with known positive denominators',()=>{
 const m=sum([{...base,spend:0}]);for(const key of ['cpc','cpm','ic','cpaFront'])assert.equal(m[key],0);
 assert.equal(m.roas,null);assert.equal(m.roi,null);
});
test('Non-finite aggregates and derived ratios are reported as unknown',()=>{
 const overflow=sum([{...base,spend:1e308},{...base,spend:1e308}]);assert.equal(overflow.spend,null);assert.equal(overflow.cpc,null);
 const derived=sum([{...base,spend:1e308,impressions:1}]);assert.equal(derived.cpm,null);assert.ok(Number.isFinite(derived.cpc));
});
test('Active budgets with missing, zero, negative or non-finite native amounts or rates remain unknown',()=>{
 const valid={...base,projectId:'p',dailyBudget:100,budgetRate:5};
 for(const field of ['dailyBudget','budgetRate'])for(const value of [null,undefined,0,-1,NaN,Infinity,-Infinity,'100']){
  const row={...valid,[field]:value},b=budget([row,row]);assert.deepEqual(b,{active:0,scheduled:0,unknown:1},`${field}=${String(value)}`);
 }
 assert.deepEqual(budget([{...valid,dailyBudget:1e308,budgetRate:10}]),{active:0,scheduled:0,unknown:1});
 const huge={...valid,dailyBudget:1e308,budgetRate:1};assert.deepEqual(budget([huge,{...huge,externalId:'overflow'}]),{active:1e308,scheduled:0,unknown:1});
});
test('Finite positive budgets preserve conversion, scheduling and inactive-account exclusions',()=>{
 const valid={...base,projectId:'p',dailyBudget:0.01,budgetRate:1};
 const scheduled={...valid,externalId:'future',dailyBudget:100,budgetRate:5,startAt:new Date(Date.now()+3600000).toISOString()};
 const paused={...valid,externalId:'paused',effectiveStatus:'PAUSED',dailyBudget:-1};
 const disabled={...valid,externalId:'disabled',accountStatus:{active:false},budgetRate:null};
 assert.deepEqual(budget([valid,scheduled,paused,disabled]),{active:0.01,scheduled:500,unknown:0});
});
