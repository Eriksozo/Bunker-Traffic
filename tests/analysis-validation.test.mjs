import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnalysisBundle,assertFinancialSources} from '../lib/analysis-validation.mjs';
import {cuts,midnight,project} from './helpers/e2e-scenario.mjs';
const now=Date.parse('2026-11-04T16:00:00Z');
const source=()=>({...cuts()[3],fetchedAt:new Date(now-1000).toISOString(),rows:[{level:'campaign',externalId:'c',adAccountId:'a',name:'QA',accountName:'QA'}]});
test('Analysis import rejects the entire invalid batch without changing previous journals',()=>{
 const good=source(),state={snapshots:[good],campaignChanges:[],config:{[project]:{projectName:'QA isolated'}}},before=JSON.stringify(state);
 for(const bad of [{...good,fetchedAt:new Date(now+900000).toISOString()},{...good,rows:[{...good.rows[0],projectId:'foreign'}]},{...good,rows:[{...good.rows[0],level:'ad'}]},{...good,rows:[{...good.rows[0],externalId:' '}]},{...good,rows:[good.rows[0],good.rows[0]]},{...good,lastSyncAt:new Date(now+10000).toISOString()}])assert.throws(()=>validateAnalysisBundle({snapshots:[good,bad]},state,now));
 assert.equal(JSON.stringify(state),before);
});
test('Two versions of the same window cannot overwrite a newer read within one import',()=>{
 const a=source(),b={...a,fetchedAt:new Date(now-2000).toISOString()};for(const snapshots of [[a,b],[b,a]])assert.throws(()=>validateAnalysisBundle({snapshots},{snapshots:[]},now),/duplicada/);
});
test('Foreign row metadata cannot disappear through schema normalization',()=>{
 const a=source();for(const patch of [{projectId:'foreign'},{projectName:'foreign'},{level:'adset'}])assert.throws(()=>validateAnalysisBundle({snapshots:[{...a,rows:[{...a.rows[0],...patch}]}]},{snapshots:[]},now),/incompatíveis/);
});
test('Canonical source windows survive DST and reject independently stale, shifted, duplicated and future cuts',()=>{
 const zones=['America/Boa_Vista','America/Sao_Paulo','America/New_York','Europe/Paris','Asia/Kolkata','Pacific/Auckland'],days=['2026-03-08','2026-03-29','2026-04-05','2026-09-27','2026-10-25','2026-11-01','2026-11-04'];let cases=0;
 for(const tz of zones)for(const day of days){const at=midnight(day,tz)+12*3600000,base=cuts(day,tz,at);assert.doesNotThrow(()=>assertFinancialSources(base,at));cases++;
  for(let i=0;i<4;i++){const old=structuredClone(base);old[i].fetchedAt=new Date(at-3600001).toISOString();assert.throws(()=>assertFinancialSources(old,at));cases++;}
  for(const change of [a=>a.pop(),a=>a.push({...a[0]}),a=>a[2].to=new Date(Date.parse(a[2].to)-3600000).toISOString(),a=>a[0].fetchedAt=new Date(at+1).toISOString(),a=>a[1].from=new Date(Date.parse(a[1].from)-86400000).toISOString()]){const bad=structuredClone(base);change(bad);assert.throws(()=>assertFinancialSources(bad,at));cases++;}
 }
 assert.equal(cases,420);
});
test('A still-unexpired proposal cannot dispatch on yesterday analytics after local midnight',()=>{
 const before=Date.parse('2026-11-05T03:55:00Z'),base=cuts('2026-11-04','America/Boa_Vista',before);assert.doesNotThrow(()=>assertFinancialSources(base,before));assert.throws(()=>assertFinancialSources(base,before+10*60000),/dia mudou/);
});
