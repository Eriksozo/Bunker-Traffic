import test from 'node:test';
import assert from 'node:assert/strict';
import {first24hGuard,first24hReason,first24hPolicy,overlayMetaLive,nameDateOffset,groupMetaAccounts,metaLiveCandidates} from '../lib/first-24h.mjs';

// Synthetic fixtures only.
const sales0={frontOrders:0,orders:0,revenueNet:0};
const g=(spend,checkouts,params)=>first24hGuard({spend,checkouts,...sales0},params);

test('Owner ceiling R$110: alert at 70%, shadow pause at 90%, over at 100%, exact boundaries', () => {
 assert.equal(first24hPolicy.lowIcSpendLimitBrl,110);
 assert.equal(g(76.99,0).level,'watch');assert.equal(g(77,0).level,'alert');
 assert.equal(g(98.99,1).level,'alert');assert.equal(g(99,1).level,'pause');assert.equal(g(99,1).pauseAt,99);
 assert.equal(g(109.99,0).level,'pause');assert.equal(g(110,0).level,'over');
 assert.equal(g(0,0).level,'waiting');assert.equal(g(null,0).level,'waiting');assert.equal(g(-5,0).level,'waiting');
});

test('The private policy may lower the ceiling, never raise it', () => {
 assert.equal(g(50,0,{first24hLowIcLimit:60}).limit,60);
 assert.equal(g(50,0,{first24hLowIcLimit:500}).limit,110,'owner ceiling is the maximum');
 assert.equal(g(50,0,{first24hLowIcLimit:0}).limit,110,'zero or invalid is ignored');
 assert.equal(g(50,0,{pauseTestMinSpendNoCheckout:80}).limit,80,'no-checkout threshold can be stricter');
 assert.equal(g(50,1,{pauseTestMinSpendNoCheckout:80}).limit,110,'that threshold is for 0 IC only');
 assert.equal(g(50,0,{pauseTestMinSpendNoCheckout:300}).limit,110);
});

test('With 2+ IC the project threshold rules, and without one it only watches', () => {
 const x=g(150,2,{pauseTestMinSpend:140});assert.equal(x.basis,'project');assert.equal(x.level,'over');assert.equal(x.pauseAt,140);
 const y=g(150,3);assert.equal(y.limit,null);assert.equal(y.level,'watch');
 const u=g(100,null);assert.equal(u.basis,'ic-unknown');assert.equal(u.level,'pause','unknown IC uses the low-IC ceiling, the safer side');
});

test('A sale (Malva or Meta) lifts the ceiling; unknown sales never read as zero', () => {
 assert.equal(first24hGuard({spend:200,checkouts:0,frontOrders:1,orders:1,revenueNet:297}).level,'sold');
 assert.equal(first24hGuard({spend:200,checkouts:0,frontOrders:null,orders:null,revenueNet:null,metaPurchases:1}).basis,'meta-sale');
 const unknown=first24hGuard({spend:200,checkouts:0,frontOrders:null,orders:0,revenueNet:0});
 assert.equal(unknown.level,'watch');assert.equal(unknown.salesKnown,false);
 assert.match(first24hReason({stage:'first-day'},unknown),/venda N\/D/);assert.doesNotMatch(first24hReason({stage:'first-day'},unknown),/0 venda/);
 assert.match(first24hReason({stage:'first-day'},g(100,0)),/0 venda.*Teto R\$110.*R\$99/);
 assert.match(first24hReason({stage:'second-day'},g(100,0)),/2º dia/);
 assert.match(first24hReason(null,first24hGuard({spend:150,checkouts:4,frontOrders:null,orders:null,revenueNet:null})),/4 IC, venda N\/D/);
});

const now=Date.parse('2026-11-08T15:00:00Z'),day='2026-11-08';
const meta=(item,at=new Date(now-60000).toISOString())=>({at,items:{c1:item}});
const row={externalId:'c1',spend:20,checkouts:0,impressions:100,budgetCurrency:'USD',budgetRate:5};

test('Meta live overlay: only fresh, same local day, convertible spend that is ahead of the Malva', () => {
 const o=overlayMetaLive(row,meta({spend:10,currency:'USD',day,checkouts:2,purchases:0,impressions:900}),{now});
 assert.equal(o.spend,50);assert.equal(o.metaLive.spendUsed,true);assert.equal(o.checkouts,2);assert.equal(o.impressions,900);assert.equal(o.metaPurchases,0);
 assert.equal(overlayMetaLive(row,meta({spend:1,currency:'USD',day}),{now}).spend,20,'Meta behind the Malva: keep Malva');
 assert.equal(overlayMetaLive(row,meta({spend:99,currency:'USD',day:'2026-11-07'}),{now}).spend,20,'other day never mixes');
 assert.equal(overlayMetaLive(row,meta({spend:99,currency:'EUR',day}),{now}).spend,20,'no rate for that currency');
 assert.equal(overlayMetaLive(row,meta({spend:99,currency:'USD',day},new Date(now-700000).toISOString()),{now}),row,'stale read ignored');
 assert.equal(overlayMetaLive(row,{at:'x',items:{c1:{spend:99}}},{now}),row);
 assert.equal(overlayMetaLive(row,null,{now}),row);
 assert.equal(overlayMetaLive({...row,checkouts:5},meta({checkouts:1,currency:'USD',day}),{now}).checkouts,5,'more IC never pushes toward a pause');
 const brl=overlayMetaLive({externalId:'c1',spend:null},meta({spend:33.333,currency:'BRL',day}),{now});assert.equal(brl.spend,33.33);
});

test('Name dates: DD/MM only, nearest year across the new year, invalid dates rejected', () => {
 const dec31=Date.parse('2026-12-31T15:00:00Z'),jan1=Date.parse('2027-01-01T15:00:00Z');
 assert.equal(nameDateOffset('01/01 - [TESTE]',dec31),1,'tomorrow across the year');
 assert.equal(nameDateOffset('31/12 - x',jan1),-1);
 assert.equal(nameDateOffset('29/02 - x',Date.parse('2026-03-01T15:00:00Z')),null,'no 29/02 in 2025-2027');
 for(const bad of ['32/11 x','08/13 x','8/11 x','08/11/2026 x','x 08/11',null,''])assert.equal(nameDateOffset(bad,now),null,String(bad));
 assert.equal(nameDateOffset('  +08/11 x',now),0);
 assert.equal(nameDateOffset('08/11 x',Date.parse('2026-11-09T02:30:00Z')),0,'Brasília is still on 08/11 at 23:30');
});

test('Meta account grouping and candidate ranking stay inside their caps', () => {
 const picks=[{id:'1',adAccountId:'m1'},{id:'2',adAccountId:'m2'},{id:'3',adAccountId:'m1'},{id:'4',adAccountId:'gone'}];
 assert.deepEqual(groupMetaAccounts(picks,{m1:'act_123456',m2:'654321',gone:'act_x'},{maxAccounts:5}),[{account:'123456',ids:['1','3']},{account:'654321',ids:['2']}]);
 assert.deepEqual(groupMetaAccounts(picks,{m1:'act_123456',m2:'654321'},{maxAccounts:1}).map(x=>x.account),['123456']);
 assert.deepEqual(groupMetaAccounts(picks,{m1:'act_123456'},{skip:new Set(['123456'])}),[]);
 const r=(id,name,over={})=>({level:'campaign',provider:'meta',status:'ACTIVE',externalId:id,adAccountId:'m1',name,spend:1,...over});
 const items=[{snapshot:{timezone:'America/Sao_Paulo',rows:[r('1000001','01/10 - antiga'),r('1000002','sem data'),r('1000003','[TESTE] x'),r('1000004','08/11 - nova'),r('1000005','09/11 ENGAJAMENTO'),r('1000006','08/11 pausada',{status:'PAUSED'}),r('abc','08/11 id ruim'),r('1000007','08/11 kwai',{provider:'kwai'})]}}];
 assert.deepEqual(metaLiveCandidates(items,{now}).map(x=>x.id),['1000004','1000003','1000002'],'new first, then tests, then undated; warm-up, paused, old, Kwai and bad ids out');
 assert.equal(metaLiveCandidates(items,{now,limit:1}).length,1);
});

test('A campaign without spend yet never prints a null ceiling', () => {
 const w=first24hGuard({spend:0,checkouts:0,frontOrders:0,orders:0,revenueNet:0});
 assert.equal(w.level,'waiting');assert.equal(first24hReason({stage:'first-day'},w),'Campanha nova nas primeiras 24h: sem gasto ainda.');
 assert.doesNotMatch(first24hReason({stage:'first-day'},first24hGuard({spend:null,checkouts:null})),/null/);
});
