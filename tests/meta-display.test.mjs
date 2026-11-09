import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {overlayMetaRow,overlayMetaSnapshot,overlayMetaItems,metaLiveTargets,liveTodayState,liveRowIndex,freshMeta} from '../lib/meta-display.mjs';
import {readMetaAccountCampaigns,metaBudget,metaLivePolicy} from '../lib/meta-live.mjs';
import {companionSummary} from '../lib/companion-summary.mjs';

const now=Date.parse('2026-11-09T15:00:00Z');
const iso=ms=>new Date(ms).toISOString();
const row=(extra={})=>({id:'malva-1',level:'campaign',provider:'meta',externalId:'120000001',adAccountId:'acc-1',name:'05/11 - [CBO] X',status:'ACTIVE',effectiveStatus:'ACTIVE',
 budgetCurrency:'USD',budgetRate:5,dailyBudget:100,lifetimeBudget:null,spend:100,spendNative:20,impressions:1000,clicks:40,linkClicks:20,checkouts:4,orders:2,frontOrders:2,
 revenue:300,revenueNet:270,adCosts:4,productCost:0,saleTax:0,ctr:0.02,cpc:5,cpm:100,roas:2.7,roi:2.5962,profit:166,...extra});
const item=(extra={})=>({id:'120000001',status:'ACTIVE',effectiveStatus:'ACTIVE',day:'2026-11-09',spend:30,impressions:1500,clicks:60,linkClicks:30,currency:'USD',dailyBudgetMinor:15000,checkouts:9,purchases:3,...extra});

test('Meta spend, clicks and budget overlay the Malva row; ratios follow the Malva formulas; sales stay the Malva\'s',()=>{
 const out=overlayMetaRow(row(),item(),{metaAt:now,fetchedAt:now-120000,sameDay:true,adCostShare:null});
 assert.equal(out.spend,150,'USD 30 at the row rate 5');assert.equal(out.spendNative,30);
 assert.equal(out.adCosts,6,'ad costs keep the row share (4%)');
 assert.deepEqual([out.impressions,out.clicks,out.linkClicks],[1500,60,30]);
 assert.equal(out.roas,1.8);assert.equal(out.profit,114);assert.equal(out.roi,round4(270/156));
 assert.equal(out.cpm,100);assert.equal(out.ctr,0.02);assert.equal(out.cpc,5);assert.equal(out.costPerCheckout,37.5);
 assert.deepEqual([out.checkouts,out.orders,out.revenueNet],[4,2,270],'IC, orders and revenue are the Malva\'s');
 assert.equal(out.dailyBudget,150,'minor units of USD');
 assert.deepEqual(out.metaLive,{at:iso(now),status:false,budget:true,spend:true,checkouts:9,purchases:3},'pixel IC and purchases kept apart');
});
const round4=n=>Math.round(n*10000)/10000;

test('Status and budget follow Meta only when its read is newer than the Malva reading',()=>{
 const paused=item({status:'PAUSED',effectiveStatus:'PAUSED'});
 assert.equal(overlayMetaRow(row(),paused,{metaAt:now,fetchedAt:now-30000,sameDay:true}).status,'PAUSED');
 const older=overlayMetaRow(row({status:'PAUSED',effectiveStatus:'PAUSED'}),item(),{metaAt:now-60000,fetchedAt:now,sameDay:true});
 assert.equal(older.status,'PAUSED','a Malva reading taken after the Meta read wins (pause just sent)');
 assert.equal(older.dailyBudget,100);
 assert.equal(overlayMetaRow(row({lifetimeBudget:500,dailyBudget:null}),item(),{metaAt:now,fetchedAt:now-1,sameDay:true}).dailyBudget,null,'lifetime budget: no daily budget');
});

test('Guards: another day, another currency, an unknown rate or less spend never replace the Malva numbers',()=>{
 assert.equal(overlayMetaRow(row(),item(),{metaAt:now,fetchedAt:now-1,sameDay:false}).spend,100,'another Meta day');
 assert.equal(overlayMetaRow(row(),item({currency:'EUR'}),{metaAt:now,fetchedAt:now-1,sameDay:true}).spend,100,'another currency');
 assert.equal(overlayMetaRow(row({budgetRate:null}),item(),{metaAt:now,fetchedAt:now-1,sameDay:true}).spend,100,'no rate');
 assert.equal(overlayMetaRow(row(),item({spend:10}),{metaAt:now,fetchedAt:now-1,sameDay:true}).spend,100,'Meta behind the Malva');
 const zero=overlayMetaRow(row({spend:0,adCosts:0,spendNative:0}),item({currency:'USD'}),{metaAt:now,fetchedAt:now-1,sameDay:true,adCostShare:null});
 assert.equal(zero.spend,150);assert.equal(zero.adCosts,null,'unknown ad-cost share: N/D, never zero');assert.equal(zero.roi,null);
 assert.equal(overlayMetaRow(row({spend:0,adCosts:0}),item(),{metaAt:now,fetchedAt:now-1,sameDay:true,adCostShare:0.04}).adCosts,6,'reading share');
 assert.equal(overlayMetaRow(row(),item({id:'999'}),{metaAt:now,fetchedAt:now-1,sameDay:true}).metaLive,undefined,'another campaign id');
 assert.equal(metaBudget(15000,'BRL'),150);assert.equal(metaBudget(15000,'JPY'),15000);assert.equal(metaBudget(0,'BRL'),null);assert.equal(metaBudget(100,'x'),null);
});

const snap=(rows,extra={})=>({projectId:'p1',projectName:'P1',source:'Malva MCP',period:'today',level:'campaign',complete:true,timezone:'America/Sao_Paulo',
 from:'2026-11-09T03:00:00.000Z',to:'2026-11-10T03:00:00.000Z',fetchedAt:iso(now-120000),lastSyncAt:iso(now-400000),rows,...extra});
test('Snapshot and items: a stale or missing Meta read leaves everything as the Malva sent it',()=>{
 const meta={at:iso(now-30000),items:{'120000001':item()}};
 const s=overlayMetaSnapshot(snap([row(),row({externalId:'120000002',id:'m2'}),row({externalId:'120000001',provider:'mgid',id:'m3'})]),meta,{now});
 assert.equal(s.metaLiveRows,1);assert.equal(s.metaLiveAt,iso(now-30000));assert.equal(s.rows[0].spend,150);assert.equal(s.rows[1].spend,100);assert.equal(s.rows[2].spend,100,'another provider');
 assert.equal(s.lastSyncAt,iso(now-400000),'the Malva synchronization clock is untouched');
 const stale={at:iso(now-11*60000),items:meta.items};
 assert.equal(freshMeta(stale,now),null);
 const items=[{projectId:'p1',snapshot:snap([row()])}];
 assert.equal(overlayMetaItems(items,stale,{now}),items);
 const over=overlayMetaItems(items,meta,{now});assert.equal(over[0].snapshot.rows[0].spend,150);assert.equal(items[0].snapshot.rows[0].spend,100,'input never changed');
});

test('Targets: new campaigns first, then every other active Meta campaign by spend; never paused, other providers or bad ids',()=>{
 const r=(id,name,extra={})=>({externalId:id,adAccountId:'a',name,level:'campaign',provider:'meta',status:'ACTIVE',spend:0,...extra});
 const items=[{snapshot:{timezone:'America/Sao_Paulo',rows:[r('1000001','01/10 - [CBO] ESCALA',{spend:50}),r('1000002','09/11 - [CBO] NOVA'),r('1000003','01/10 - [CBO] OUTRA',{spend:900}),
  r('1000004','01/10 - X',{status:'PAUSED',spend:999}),r('1000005','01/10 - Y',{provider:'mgid',spend:999}),r('x-1','01/10 - Z',{spend:999}),r('1000006','01/10 - [ENGAJAMENTO]',{spend:10})]}}];
 assert.deepEqual(metaLiveTargets(items,{now}).map(t=>t.id),['1000002','1000003','1000001','1000006']);
 assert.equal(metaLiveTargets(items,{now,limit:2}).length,2);
});

test('Notch day numbers come from the current live reading; the queue keeps the analysis',()=>{
 const analysis=snap([row({spend:80,sourceAt:undefined})],{fetchedAt:iso(now-3600000),lastSyncAt:iso(now-3700000)});
 const closed=p=>({...snap([row({spend:500})]),period:p,from:'2026-11-02T03:00:00.000Z',to:'2026-11-09T03:00:00.000Z'});
 const state={config:{p1:{projectName:'P1'}},snapshots:[analysis,closed('7d'),closed('3d'),{...closed('yesterday'),from:'2026-11-08T03:00:00.000Z'}],proposals:[],ownerChoices:[],executions:[],messages:[],collaborationMessages:[],jobs:[],incidents:[]};
 const live=overlayMetaItems([{projectId:'p1',snapshot:snap([row()])}],{at:iso(now-30000),items:{'120000001':item()}},{now});
 const todayState=liveTodayState(state,live,{now});
 assert.equal(todayState.snapshots.filter(s=>s.period==='today').length,1);assert.equal(todayState.snapshots.find(s=>s.period==='today').liveDisplay,true);
 assert.equal(todayState.snapshots.filter(s=>s.period!=='today').length,3,'closed windows untouched');
 assert.equal(state.snapshots[0],analysis,'the analysis state is never changed');
 assert.equal(liveTodayState(state,[{projectId:'p1',snapshot:snap([row()],{fetchedAt:iso(now-7200000)})}],{now}),state,'a live reading older than the analysis changes nothing');
 const s=companionSummary(state,{project:'p1',now,todayState,liveRows:liveRowIndex(live,{now}),live});
 assert.equal(s.today.today.spend,150);assert.equal(s.board[0].spend,150);
 assert.equal(s.liveAt,iso(now-120000));assert.equal(s.metaLiveAt,iso(now-30000));
 const plain=companionSummary(state,{project:'p1',now});
 assert.equal(plain.today.today.spend,80);assert.equal(plain.liveAt,null);
 assert.deepEqual(s.queue.map(q=>q.campaignId),plain.queue.map(q=>q.campaignId),'same queue with or without the live numbers');
 const index=liveRowIndex(live,{now}),hit=index.get('p1:acc-1:120000001');assert.equal(hit.row.spend,150);assert.equal(hit.metaLiveAt,iso(now-30000));
});

const page=(nodes,next)=>({ok:true,status:200,json:async()=>({data:nodes,paging:next?{cursors:{after:next},next:'x'}:{}})});
const node=(id,extra={})=>({id,status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'15000',insights:{data:[{date_start:'2026-11-09',spend:'30',impressions:'1500',clicks:'60',inline_link_clicks:'30',account_currency:'USD',actions:[]}]},...extra});
test('A requested campaign missing from the active listing (just paused) is read by its id, with GET only',async()=>{
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url,init});const u=new URL(url);
  if(u.pathname.endsWith('/act_11111/campaigns'))return page([node('120000001')]);
  if(u.pathname.endsWith('/120000002'))return {ok:true,status:200,json:async()=>node('120000002',{status:'PAUSED',effective_status:'PAUSED'})};
  return {ok:false,status:404,json:async()=>({error:{code:100}})};};
 const r=await readMetaAccountCampaigns(fetchImpl,'tok-fake',[{account:'11111',ids:['120000001','120000002']}]);
 assert.equal(r.direct,1);const paused=r.items.find(i=>i.id==='120000002');
 assert.deepEqual([paused.status,paused.effectiveStatus,paused.dailyBudgetMinor,paused.dailyBudget,paused.linkClicks],['PAUSED','PAUSED',15000,150,30]);
 for(const c of calls){assert.equal(c.init.method,'GET');assert.doesNotMatch(c.url,/tok-fake/);}
});
test('A rate-limit answer stops new requests and is reported; insights refused in parallel reads still read every account',async()=>{
 let n=0;
 const limited=await readMetaAccountCampaigns(async()=>{n++;return {ok:false,status:400,json:async()=>({error:{code:17,message:'User request limit reached'}})};},'t',
  Array.from({length:20},(_,i)=>({account:String(20000+i),ids:[String(1200000+i)]})));
 assert.equal(limited.rateLimited,true);assert.ok(limited.errors.includes('META_RATE_LIMIT'));assert.ok(n<=metaLivePolicy.concurrency,'no new request after the limit');
 const refused=await readMetaAccountCampaigns(async url=>{const u=new URL(url);if(u.searchParams.get('fields').includes('insights'))return {ok:false,status:400,json:async()=>({error:{code:100,message:'insights'}})};return page([node(u.pathname.includes('11111')?'120000001':'120000004',{insights:undefined})]);},'t',
  [{account:'11111',ids:['120000001']},{account:'44444',ids:['120000004']}]);
 assert.deepEqual(refused.items.map(i=>i.id).sort(),['120000001','120000004']);assert.deepEqual(refused.skippedAccounts,[]);assert.equal(refused.fields,'basic');
});

test('Display only: the web live route and the notch summaries use the overlay; order checks keep the Malva reading',()=>{
 const route=readFileSync(new URL('../app/api/live/route.ts',import.meta.url),'utf8');assert.match(route,/overlayMetaItems\(live\.items,meta\)/);
 const worker=readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.match(worker,/overlayMetaItems\(this\.liveItems/);assert.match(worker,/action==='metaLive'/);
 for(const f of ['../lib/live-state.ts','../app/api/companion/owner/route.ts','../app/api/companion/cards/route.ts','../lib/owner-order-live.mjs','../lib/live-data.mjs'])
  assert.doesNotMatch(readFileSync(new URL(f,import.meta.url),'utf8'),/meta-display|overlayMeta/,f+' must keep the Malva reading');
 assert.doesNotMatch(readFileSync(new URL('../lib/meta-display.mjs',import.meta.url),'utf8'),/fetch\(|method:/,'the overlay never calls a provider');
});

// The real Durable Object code with infrastructure and provider boundaries replaced (same harness as the fast-lane tests).
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as metaLive from '../lib/meta-live.mjs';
import * as metaDisplay from '../lib/meta-display.mjs';
import * as first24h from '../lib/first-24h.mjs';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function worker(rpcAnswer){
 const exports={},values=new Map([['runtime',{enabled:true,history:[]}],['metaAccountLinks',{links:{'acc-1':'12345'}}]]),log=[];
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [a,b] of Object.entries(k))values.set(a,b);}else values.set(k,v);},delete:async k=>values.delete(k),setAlarm:async()=>{}};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 const mods={'meta-live':metaLive,'meta-display':metaDisplay,'first-24h':first24h};
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:Object.entries(mods).find(([k])=>name.endsWith(k+'.mjs'))?.[1]||{},Date,Response,Intl,setInterval,clearInterval});
 const e=new exports.BunkerCloudExecutor({storage},{});
 e.liveItems=[{projectId:'p1',snapshot:snap([row()])}];
 e.read=async()=>{log.push('central');return {state:{paused:false,config:{}}};};
 e.db=()=>({rpc:async(name,args)=>{log.push('meta:'+args.accounts.map(a=>a.account+'='+a.ids.join('/')).join(','));return rpcAnswer();}});
 e.storeCompanion=async(_s,shadow)=>log.push(shadow?.length?'notch+shadow':'notch');e.storeFirst24h=async()=>log.push('first24h');e.storedShadow=async()=>[];
 e.storeShadow=async()=>{log.push('shadow');return [{id:'x'}];};
 return {e,values,log};
}
test('Executor: one Meta read a minute, at once after an order (10 s apart at least), nothing while Meta asks to wait',async()=>{
 let t=now;const real=Date.now;Date.now=()=>t;
 try{
  const {e,values,log}=worker(()=>({at:iso(t),items:[item()],requests:1,errors:[]}));
  await e.metaTick(false);
  assert.deepEqual(log,['central','meta:12345=120000001','central','first24h','shadow','notch+shadow'],'read, then the Sombra rules and the notch summary from a fresh central read');
  assert.ok(values.get('syncPulse').version>=1,'the pulse moves: the web and the notch reload');
  assert.equal(values.get('metaLive').read,1);
  log.length=0;t+=5000;await e.metaTick(false);await e.metaTick(true);assert.deepEqual(log,[],'not due: not even the central is read');
  t+=6000;await e.metaTick(true);assert.equal(log.filter(l=>l.startsWith('meta:')).length,1,'after an order: 10 s are enough');
  log.length=0;t+=30000;await e.metaTick(false);assert.deepEqual(log,[],'a regular read waits the minute');
  t+=31000;await e.metaTick(false);assert.equal(log.filter(l=>l.startsWith('meta:')).length,1);
  const r=await (await e.fetch(new Request('https://bunker-internal/control',{method:'POST',body:JSON.stringify({action:'metaLive'})}))).json();
  assert.equal(r.meta.items['120000001'].spend,30,'the web reads the last fresh Meta read');
  const limited=worker(()=>({at:iso(t),items:[],rateLimited:true,errors:['META_RATE_LIMIT']}));
  await limited.e.metaTick(false);assert.ok(Date.parse(limited.values.get('metaLive').backoffUntil)>t);
  limited.log.length=0;t+=5*60000;await limited.e.metaTick(true);assert.deepEqual(limited.log,[],'rate limit: no read for 10 minutes, not even after an order');
  t+=6*60000;await limited.e.metaTick(false);assert.equal(limited.log.filter(l=>l.startsWith('meta:')).length,1);
  const stale=await (await e.fetch(new Request('https://bunker-internal/control',{method:'POST',body:JSON.stringify({action:'metaLive'})}))).json();
  assert.equal(stale.meta,null,'older than 10 minutes: not shown');
 }finally{Date.now=real;}
});

test('Executor: the Sombra runs on each new reading, one run at a time, and a failed run keeps the stored entries',async()=>{
 const {e,log}=worker(()=>({}));
 let open=0,max=0;e.storeShadow=async()=>{open++;max=Math.max(max,open);await new Promise(r=>setTimeout(r,5));open--;log.push('shadow');return [{id:'a'}];};
 const [a,b]=await Promise.all([e.queueShadow({}),e.queueShadow({})]);
 assert.equal(max,1,'the heavy pulse and the fast lane never evaluate at the same time');
 assert.deepEqual([a.length,b.length],[1,1],'each caller gets its own result');
 e.storeShadow=async()=>{throw new Error('boom');};e.storedShadow=async()=>[{id:'kept'}];
 assert.deepEqual(await e.freshShadow({}),[{id:'kept'}],'between pulses a failure shows the last entries');
 e.storeShadow=async()=>[{id:'next'}];assert.deepEqual(await e.queueShadow({}),[{id:'next'}],'a failure never blocks the next run');
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.equal((src.match(/this\.storeShadow\(/g)||[]).length,1,'every run goes through the queue');
 assert.match(src,/storeFirst24h\(liveState\)[^\n]*freshShadow\(liveState\)/,'the fast-lane live read reevaluates the Sombra too');
});
