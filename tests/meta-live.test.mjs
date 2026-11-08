import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readMetaAccountCampaigns,normalizeMetaCampaign,cleanMetaIds,cleanMetaAccounts,metaLivePolicy} from '../lib/meta-live.mjs';
import {overlayMetaLive,newCampaignStage,first24hGuard,metaLiveCandidates,groupMetaAccounts} from '../lib/first-24h.mjs';

// Synthetic fixtures only: ids, values and the token are invented.
const node=(id,extra={})=>({id,status:'ACTIVE',effective_status:'ACTIVE',start_time:'2026-11-08T00:00:00-0300',created_time:'2026-11-07T18:00:00-0300',...extra});
const ins=(spend,actions=[])=>({insights:{data:[{date_start:'2026-11-08',spend:String(spend),impressions:'900',account_currency:'USD',actions}]}});

test('The edge function runs the same read-only module and checks the server credential',()=>{
 assert.equal(readFileSync(new URL('../supabase/functions/meta-read/meta-live.mjs',import.meta.url),'utf8'),readFileSync(new URL('../lib/meta-live.mjs',import.meta.url),'utf8'));
 const src=readFileSync(new URL('../supabase/functions/meta-read/index.ts',import.meta.url),'utf8');
 assert.match(src,/authenticateServer/);assert.match(src,/Meta_Acess_Token/);assert.doesNotMatch(src,/method:'(POST|DELETE)'.*graph/);
 const lib=readFileSync(new URL('../lib/meta-live.mjs',import.meta.url),'utf8');assert.doesNotMatch(lib,/method:'(POST|DELETE|PUT)'/);
});
test('Real start: scheduled until start_time, then first 24h counted from it',()=>{
 const now=Date.parse('2026-11-08T02:00:00Z');// 23:00 of 07/11 local
 const row={externalId:'120000001',adAccountId:'a',name:'[CBO] SEM DATA',level:'campaign',provider:'meta',status:'ACTIVE',spend:0,impressions:0,budgetCurrency:'USD',budgetRate:5};
 const meta={at:new Date(now-60000).toISOString(),items:{'120000001':normalizeMetaCampaign(node('120000001'))}};
 const s=newCampaignStage(overlayMetaLive(row,meta,{now}),{},{now});
 assert.equal(s.stage,'scheduled');assert.equal(s.startsOn,'08/11 00:00');
 const later=Date.parse('2026-11-08T08:00:00Z');// 05:00 local, 5h after the start
 const m2={at:new Date(later-60000).toISOString(),items:{'120000001':normalizeMetaCampaign({...node('120000001'),...ins(20,[{action_type:'initiate_checkout',value:'1'}])})}};
 const live=overlayMetaLive({...row,spend:40},m2,{now:later});
 assert.equal(live.spend,100,'Meta USD 20 × rate 5 is ahead of the Malva R$40');assert.equal(live.checkouts,1);
 const st=newCampaignStage(live,{},{now:later});assert.equal(st.stage,'first-day');assert.equal(st.basis,'schedule');assert.equal(st.ageHours,5);
 assert.equal(first24hGuard({spend:live.spend,checkouts:live.checkouts,frontOrders:0,orders:0,revenueNet:0,metaPurchases:0}).level,'pause');
 assert.equal(first24hGuard({spend:live.spend,checkouts:1,frontOrders:0,orders:0,revenueNet:0,metaPurchases:1}).level,'sold','a purchase Meta sees clears the ceiling');
 // A renamed old campaign: real start 3 days ago is not new, whatever the name says.
 const old={at:new Date(later-60000).toISOString(),items:{'120000001':normalizeMetaCampaign(node('120000001',{start_time:'2026-11-05T00:00:00-0300',created_time:'2026-11-04T00:00:00-0300'}))}};
 assert.equal(newCampaignStage(overlayMetaLive({...row,name:'08/11 - [CBO] RENOMEADA',spend:30},old,{now:later}),{},{now:later}),null);
});
test('Overlay guards: stale read, another Meta day or an unknown rate never replace the Malva spend',()=>{
 const now=Date.parse('2026-11-08T15:00:00Z'),row={externalId:'120000002',spend:50,checkouts:3,budgetCurrency:'USD',budgetRate:5};
 const item=normalizeMetaCampaign({...node('120000002'),...ins(30,[{action_type:'initiate_checkout',value:'1'}])});
 assert.equal(overlayMetaLive(row,{at:new Date(now-11*60000).toISOString(),items:{'120000002':item}},{now}),row,'older than 10 minutes');
 assert.equal(overlayMetaLive(row,{at:new Date(now).toISOString(),items:{'120000002':{...item,day:'2026-11-07'}}},{now}).spend,50,'other day');
 assert.equal(overlayMetaLive({...row,budgetCurrency:'BRL',budgetRate:null},{at:new Date(now).toISOString(),items:{'120000002':item}},{now}).spend,50,'USD spend with a BRL row has no rate');
 assert.equal(overlayMetaLive(row,{at:new Date(now).toISOString(),items:{'120000002':item}},{now}).checkouts,3,'more IC from the Malva is kept');
});

const page=(nodes,next)=>({ok:true,status:200,json:async()=>({data:nodes,paging:next?{cursors:{after:next},next:'x'}:{}})});
test('Reads each ad account with GET, only active campaigns, and keeps only the requested ids; IC never double counts',async()=>{
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url,init});const u=new URL(url);
  if(u.pathname.endsWith('/act_11111/campaigns'))return u.searchParams.get('after')?page([{...node('120000002'),...ins(5)}]):page([{...node('120000001'),...ins(10,[{action_type:'initiate_checkout',value:'2'},{action_type:'offsite_conversion.fb_pixel_initiate_checkout',value:'2'},{action_type:'omni_purchase',value:'1'}])},node('999999999')],'c1');
  return page([node('120000003')]);};
 const r=await readMetaAccountCampaigns(fetchImpl,'tok-fake',[{account:'act_11111',ids:['120000001','120000002']},{account:'22222',ids:['120000003']}]);
 assert.deepEqual(r.items.map(i=>i.id).sort(),['120000001','120000002','120000003']);
 assert.equal(calls.length,3,'two pages for the first account, one for the second');
 for(const c of calls){assert.equal(c.init.method,'GET');assert.equal(c.init.headers.Authorization,'Bearer tok-fake');assert.doesNotMatch(c.url,/tok-fake/);assert.match(c.url,/graph\.facebook\.com\/v26\.0\/act_\d+\/campaigns/);assert.match(decodeURIComponent(c.url),/effective_status=\["ACTIVE"/);}
 const first=r.items.find(i=>i.id==='120000001');assert.deepEqual([first.checkouts,first.purchases,first.spend,first.currency],[2,1,10,'USD']);
 assert.equal(normalizeMetaCampaign(node('1234567')).spend,0,'no insights today: zero delivery for a read campaign');
});
test('Insights refused once: schedule fields still read for every account; a refused account is skipped, not the batch',async()=>{
 const fetchImpl=async url=>{const u=new URL(url);
  if(u.pathname.includes('act_33333'))return {ok:false,status:400,json:async()=>({error:{code:100,error_subcode:33,message:'Object with ID act_33333 does not exist'}})};
  if(u.searchParams.get('fields').includes('insights'))return {ok:false,status:400,json:async()=>({error:{code:100,message:'Tried accessing nonexisting field (insights) on node 120000001'}})};
  return page([node('120000001'),node('120000004')]);};
 const r=await readMetaAccountCampaigns(fetchImpl,'t',[{account:'11111',ids:['120000001']},{account:'33333',ids:['120000009']},{account:'44444',ids:['120000004']}]);
 assert.equal(r.fields,'basic');assert.ok(r.errors.includes('META_INSIGHTS_REJECTED'));assert.ok(r.errors.includes('META_100_33'));
 assert.deepEqual(r.skippedAccounts,['33333']);assert.deepEqual(r.items.map(i=>i.id),['120000001','120000004']);
 assert.match(r.diagnostic.message,/node #/);assert.doesNotMatch(JSON.stringify(r.diagnostic),/120000001/);
 await assert.rejects(readMetaAccountCampaigns(async()=>({ok:false,status:400,json:async()=>({error:{code:190,message:'secret text'}})}),'t',[{account:'11111',ids:['120000001']}]),e=>e.code==='META_190'&&!/secret/.test(e.message));
 await assert.rejects(readMetaAccountCampaigns(fetch,'',[{account:'11111',ids:['120000001']}]),e=>e.code==='META_TOKEN_MISSING');
});
test('Inputs are bounded and cleaned before any request',()=>{
 assert.deepEqual(cleanMetaIds(['1234567','abc','1234567','1;DROP']),['1234567']);
 assert.deepEqual(cleanMetaAccounts([{account:'act_12345',ids:['1234567']},{account:'x',ids:['1234567']},{account:'12345',ids:['7654321']},{account:'99999',ids:['bad']}]),[{account:'12345',ids:['1234567','7654321']}]);
 assert.throws(()=>cleanMetaAccounts(Array.from({length:metaLivePolicy.maxAccounts+1},(_,i)=>({account:String(10000+i),ids:['1234567']}))),/META_TOO_MANY_ACCOUNTS/);
});
test('Candidates: recent and scheduled dates first, then tests, then undated; grouped by the linked Meta account',()=>{
 const now=Date.parse('2026-11-08T02:00:00Z'),r=(id,name,extra={})=>({externalId:id,adAccountId:'m-a',name,level:'campaign',provider:'meta',status:'ACTIVE',spend:0,...extra});
 const items=[{snapshot:{timezone:'America/Sao_Paulo',rows:[r('1000001','20/10 - [CBO] [TESTE] X'),r('1000002','08/11 - [CBO] PRE',{adAccountId:'m-b'}),r('1000003','[CBO] SEM DATA'),r('1000004','20/10 - [CBO] [ESCALA]'),r('1000005','07/11 - [ENGAJAMENTO]'),r('1000006','06/11 - [CBO] Y',{status:'PAUSED'}),r('uuid-x','07/11 Z')]}}];
 const picks=metaLiveCandidates(items,{now});
 assert.deepEqual(picks.map(p=>p.id),['1000002','1000001','1000003']);
 assert.deepEqual(groupMetaAccounts(picks,{'m-a':'act_55555','m-b':'66666'}),[{account:'66666',ids:['1000002']},{account:'55555',ids:['1000001','1000003']}]);
 assert.deepEqual(groupMetaAccounts(picks,{'m-a':'55555'},{skip:new Set(['55555'])}),[],'unlinked or recently refused accounts are left out');
});
