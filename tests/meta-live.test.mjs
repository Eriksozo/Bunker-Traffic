import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readMetaCampaigns,normalizeMetaCampaign,cleanMetaIds,metaLivePolicy} from '../lib/meta-live.mjs';
import {overlayMetaLive,newCampaignStage,first24hGuard,metaLiveCandidates} from '../lib/first-24h.mjs';

// Synthetic fixtures only: ids, values and the token are invented.
const node=(id,extra={})=>({id,status:'ACTIVE',effective_status:'ACTIVE',start_time:'2026-11-08T00:00:00-0300',created_time:'2026-11-07T18:00:00-0300',...extra});
const ins=(spend,actions=[])=>({insights:{data:[{date_start:'2026-11-08',spend:String(spend),impressions:'900',account_currency:'USD',actions}]}});

test('The edge function runs the same read-only module and checks the server credential',()=>{
 assert.equal(readFileSync(new URL('../supabase/functions/meta-read/meta-live.mjs',import.meta.url),'utf8'),readFileSync(new URL('../lib/meta-live.mjs',import.meta.url),'utf8'));
 const src=readFileSync(new URL('../supabase/functions/meta-read/index.ts',import.meta.url),'utf8');
 assert.match(src,/authenticateServer/);assert.match(src,/Meta_Acess_Token/);assert.doesNotMatch(src,/method:'(POST|DELETE)'.*graph/);
 const lib=readFileSync(new URL('../lib/meta-live.mjs',import.meta.url),'utf8');assert.doesNotMatch(lib,/method:'(POST|DELETE|PUT)'/);
});
test('Reads by id in chunks of 50 with GET and the token only in the header; IC and purchases never double count',async()=>{
 const calls=[];const ids=Array.from({length:60},(_,i)=>String(120000000+i));
 const fetchImpl=async(url,init)=>{calls.push({url,init});const q=new URL(url).searchParams.get('ids').split(',');return {ok:true,status:200,json:async()=>Object.fromEntries(q.map(id=>[id,{...node(id),...ins(10,[{action_type:'initiate_checkout',value:'2'},{action_type:'offsite_conversion.fb_pixel_initiate_checkout',value:'2'},{action_type:'omni_purchase',value:'1'}])}]))};};
 const r=await readMetaCampaigns(fetchImpl,'tok-fake',ids);
 assert.equal(calls.length,2);assert.equal(r.items.length,60);
 for(const c of calls){assert.equal(c.init.method,'GET');assert.equal(c.init.headers.Authorization,'Bearer tok-fake');assert.doesNotMatch(c.url,/tok-fake/);}
 assert.deepEqual([r.items[0].checkouts,r.items[0].purchases,r.items[0].spend,r.items[0].currency],[2,1,10,'USD']);
});
test('No insights today means zero delivery for a read campaign; errors become fixed codes; bad ids are refused',async()=>{
 assert.deepEqual([normalizeMetaCampaign(node('1234567')).spend,normalizeMetaCampaign(node('1234567')).hasInsights],[0,false]);
 await assert.rejects(readMetaCampaigns(async()=>({ok:false,status:400,json:async()=>({error:{code:190,message:'token secret text'}})}),'t',['1234567']),e=>e.code==='META_190'&&!/secret/.test(e.message));
 const partial=await readMetaCampaigns(async()=>({ok:false,status:500,json:async()=>({})}),'t',['1234567']);assert.deepEqual(partial.errors,['META_HTTP_500']);
 assert.deepEqual(cleanMetaIds(['1234567','abc','1234567','1;DROP']),['1234567']);
 assert.throws(()=>cleanMetaIds(Array.from({length:metaLivePolicy.maxIds+1},(_,i)=>String(1000000+i))),/META_TOO_MANY_IDS/);
 await assert.rejects(readMetaCampaigns(fetch,'',['1234567']),e=>e.code==='META_TOKEN_MISSING');
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
test('Candidates: recent and scheduled dates first, then tests, then undated; old dated campaigns out',()=>{
 const now=Date.parse('2026-11-08T02:00:00Z'),r=(id,name,extra={})=>({externalId:id,name,level:'campaign',provider:'meta',status:'ACTIVE',spend:0,...extra});
 const items=[{snapshot:{timezone:'America/Sao_Paulo',rows:[r('1000001','20/10 - [CBO] [TESTE] X'),r('1000002','08/11 - [CBO] PRE'),r('1000003','[CBO] SEM DATA'),r('1000004','20/10 - [CBO] [ESCALA]'),r('1000005','07/11 - [ENGAJAMENTO]'),r('1000006','06/11 - [CBO] Y',{status:'PAUSED'}),r('uuid-x','07/11 Z')]}}];
 assert.deepEqual(metaLiveCandidates(items,{now}),['1000002','1000001','1000003']);
});
