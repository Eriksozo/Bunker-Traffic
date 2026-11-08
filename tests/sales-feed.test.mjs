import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSale,orderRef,addSale,salesView,salesFeedLimits} from '../lib/sales-feed.mjs';
import {cloudflareAuth} from '../lib/cloudflare-auth.mjs';

const now=Date.parse('2026-11-08T01:00:00Z');
test('a paid sale keeps only amount, currency, product, campaign, project and time; buyer data never enters', () => {
 const s=normalizeSale({topic:'order.paid',data:{amount:'297,00',currency:'brl',product:{name:'Curso X'},utm_campaign:'07/11 - [CBO] - JOHN',projectId:'p1',paidAt:'2026-11-08T00:59:00Z',orderId:'ord-1',customer:{name:'Fulano',email:'f@x.com',phone:'1199'}}},now);
 assert.deepEqual(s,{amount:297,currency:'BRL',product:'Curso X',campaign:'07/11 - [CBO] - JOHN',project:'p1',at:'2026-11-08T00:59:00.000Z',orderRef:'ord-1'});
 assert.ok(!JSON.stringify(s).includes('f@x.com'));
});
test('refunds, other topics, zero or missing amounts are ignored; missing fields stay null', () => {
 assert.equal(normalizeSale({topic:'order.refunded',data:{amount:100}}),null);
 assert.equal(normalizeSale({topic:'visitor.created',data:{amount:100}}),null);
 assert.equal(normalizeSale({topic:'order.paid',data:{amount:0}}),null);
 assert.equal(normalizeSale([1,2]),null);
 const bare=normalizeSale({amount:49.9},now);assert.equal(bare.amount,49.9);assert.equal(bare.product,null);assert.equal(bare.at,new Date(now).toISOString());
});
test('the order id becomes a short hash; retries do not duplicate; the list is bounded', async () => {
 const ref=await orderRef('ord-1');assert.match(ref,/^[0-9a-f]{16}$/);assert.equal(await orderRef(null),null);
 let list=[];for(let i=0;i<salesFeedLimits.keep+5;i++)list=addSale(list,{amount:1,at:new Date(now).toISOString(),orderRef:'r'+i}).list;
 assert.equal(list.length,salesFeedLimits.keep);
 assert.equal(addSale(list,{amount:1,orderRef:'r44'}).added,false);
 const view=salesView([{amount:1,at:new Date(now-60000).toISOString(),project:'p1',orderRef:'x'},{amount:2,at:new Date(now-7200000).toISOString(),project:'p2'}],{project:'p1',now});
 assert.equal(view.recent.length,1);assert.equal(view.lastHour,1);assert.equal(view.recent[0].orderRef,undefined);
});
test('the boundary checks the path secret before reading the body and strips identity headers', async () => {
 const base={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',BUNKER_OWNER_EMAIL:'owner@example.com'};
 const env={...base,BUNKER_HOST:'cloudflare',MALVA_WEBHOOK_SECRET:'s'.repeat(48)};
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/wrong',{method:'POST',body:'{}'}),env)).status,401);
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/x',{method:'POST',body:'{}'}),{...base,BUNKER_HOST:'cloudflare'})).status,503);
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48),{method:'GET'}),env)).status,405);
 const ok=await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48),{method:'POST',body:'{"amount":1}',headers:{'x-bunker-companion':'owner','oai-authenticated-user-id':'forged'}}),env);
 assert.ok(ok instanceof Request);assert.equal(new URL(ok.url).pathname,'/api/webhooks/malva');assert.equal(ok.headers.get('x-bunker-webhook'),'malva');
 assert.equal(ok.headers.has('x-bunker-companion'),false);assert.equal(ok.headers.has('oai-authenticated-user-id'),false);assert.equal(await ok.text(),'{"amount":1}');
 const big=await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48),{method:'POST',body:'x'.repeat(70000)}),env);assert.equal(big.status,413);
});
