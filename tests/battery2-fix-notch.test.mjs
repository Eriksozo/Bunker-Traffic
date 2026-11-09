import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeShadow,shadowSummary} from '../lib/autonomy-shadow.mjs';

const d=(extra={})=>({rule:'test-no-sale',project:'p',projectName:'P',adAccountId:'a',objectId:'1',name:'[TESTE] x',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',blockedBy:[],wouldExecute:true,...extra});
const at=h=>Date.parse('2026-11-09T00:00:00Z')+h*3600000;

test('Summary rows say whether the latest shadow pass still proposes them',()=>{
 let list=mergeShadow([],[d()],{now:at(14),day:'2026-11-09'});
 list=mergeShadow(list,[],{now:at(21),day:'2026-11-09'});
 const stale=shadowSummary(list,{day:'2026-11-09',pulseAt:new Date(at(21)).toISOString()}).recent[0];
 assert.equal(stale.current,false,'a decision the rule stopped emitting is not current');
 list=mergeShadow(list,[d()],{now:at(22),day:'2026-11-09'});
 assert.equal(shadowSummary(list,{day:'2026-11-09',pulseAt:new Date(at(22)).toISOString()}).recent[0].current,true);
 assert.equal(shadowSummary(list,{day:'2026-11-09'}).recent[0].current,null,'unknown pass time is N/D, never current');
});

test('Alert-only rows are marked, also legacy ones carrying only the "Só alerta" text',()=>{
 const list=mergeShadow([],[d({rule:'new-sale-loss',alertOnly:true,wouldExecute:false,blockedBy:['Só alerta: ROI entre 0.8 e 1 se recupera.']}),d({objectId:'2',blockedBy:['Só alerta: legado'],wouldExecute:false})],{now:at(14),day:'2026-11-09'});
 const rows=shadowSummary(list,{day:'2026-11-09'}).recent;
 assert.deepEqual(rows.map(r=>r.alertOnly),[true,true]);
 assert.equal(shadowSummary(mergeShadow([],[d()],{now:at(14),day:'2026-11-09'}),{day:'2026-11-09'}).recent[0].alertOnly,false);
});

test('The executor passes the shadow pass time to the notch summary, and none after a failed pass',async()=>{
 const src=await import('node:fs').then(fs=>fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'));
 assert.match(src,/pulseAt:shadowStatus\?\.failed\?null:shadowStatus\?\.at\|\|null/);
});
