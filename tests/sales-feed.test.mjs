import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSale,orderRef,addSale,salesView,salesFeedLimits,paymentEvidence,bindSale} from '../lib/sales-feed.mjs';
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
 const bare=normalizeSale({status:'paid',amount:49.9},now);assert.equal(bare.amount,49.9);assert.equal(bare.product,null);assert.equal(bare.at,new Date(now).toISOString());
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
 const ok=await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48)+'/proj-aaaa',{method:'POST',body:'{"amount":1}',headers:{'x-bunker-companion':'owner','oai-authenticated-user-id':'forged','x-bunker-webhook-project':'proj-forged'}}),env);
 assert.ok(ok instanceof Request);assert.equal(new URL(ok.url).pathname,'/api/webhooks/malva');assert.equal(ok.headers.get('x-bunker-webhook'),'malva');
 assert.equal(ok.headers.get('x-bunker-webhook-project'),'proj-aaaa','project comes from the address, never from a client header');
 assert.equal(ok.headers.has('x-bunker-companion'),false);assert.equal(ok.headers.has('oai-authenticated-user-id'),false);assert.equal(await ok.text(),'{"amount":1}');
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/%E0%A4%A',{method:'POST',body:'{}'}),env)).status,401,'malformed escape: 401, not 500');
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/short',{method:'POST',body:'{}'}),{...env,MALVA_WEBHOOK_SECRET:'short'})).status,503,'short secret fails closed');
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48),{method:'POST',body:'{}'}),{...env,BUNKER_COMPANION_TOKEN:'s'.repeat(48)})).status,503,'secret reused from another credential fails closed');
 const big=await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48)+'/proj-aaaa',{method:'POST',body:'x'.repeat(70000)}),env);assert.equal(big.status,413);
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48),{method:'POST',body:'{}'}),env)).status,400,'address without project is refused');
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48)+'/a/b',{method:'POST',body:'{}'}),env)).status,400);
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+'s'.repeat(48)+'/x%20y',{method:'POST',body:'{}'}),env)).status,400);
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/webhooks/malva/wrong/proj-aaaa',{method:'POST',body:'{}'}),env)).status,401,'secret first');
});

test('Codex review: pending, unpaid, generic order topics and bare amounts are not paid sales', () => {
 assert.equal(normalizeSale({topic:'order.created',data:{amount:100,status:'pending',orderId:'o'}}),null);
 assert.equal(normalizeSale({event:'payment.unpaid',data:{amount:100,status:'unpaid',orderId:'o'}}),null);
 assert.equal(normalizeSale({amount:100}),null);
 assert.equal(normalizeSale({topic:'order.created',data:{amount:100,orderId:'o'}}),null,'generic topic is not evidence');
 assert.equal(normalizeSale({topic:'order.paid',data:{amount:100,status:'refunded'}}),null,'a negative status wins over a paid topic');
 assert.equal(normalizeSale({topic:'order.paid',data:{amount:100,payment:{status:'waiting_payment'}}}),null);
 assert.equal(normalizeSale({topic:'order.paid',data:{amount:100,paid:false}}),null);
 for(const status of ['pendente','aguardando_pagamento','recusado','expirado','cancelado','chargeback','estornado','not_paid','processing'])assert.equal(paymentEvidence({status}).paid,false,status);
 for(const status of ['paid','approved','Aprovado','pago','completed','confirmado'])assert.equal(paymentEvidence({status}).paid,true,status);
 assert.equal(paymentEvidence({topic:'order.created'}).reason,'sem prova de pagamento');
 assert.ok(normalizeSale({topic:'order.created',data:{amount:100,status:'paid',orderId:'o'}}),'explicit paid status is evidence');
});
test('Codex review: the webhook address binds the project; missing, divergent or ambiguous never spreads', () => {
 const sale=normalizeSale({topic:'order.paid',data:{amount:10,orderId:'o1'}});
 assert.equal(sale.project,null);
 assert.deepEqual(bindSale(sale,'proj-aaaa').sale.project,'proj-aaaa');
 assert.equal(bindSale(sale,null).error,'projeto ausente no endereço');
 assert.equal(bindSale({...sale,project:'proj-bbbb'},'proj-aaaa').error,'projeto do pedido diferente do endereço');
 const two=normalizeSale({topic:'order.paid',data:{amount:10,orderId:'o1',projectId:'proj-aaaa',project:{id:'proj-bbbb'}}});
 assert.equal(two.project,'ambiguous');assert.equal(bindSale(two,'proj-aaaa').error,'projeto ambíguo no pedido');
 assert.equal(bindSale({...sale,orderRef:null},'proj-aaaa').error,'pedido sem identificação');
 assert.equal(bindSale(null,'proj-aaaa').error,'não é venda paga');
 const view=salesView([{amount:1,at:new Date(now).toISOString()},{amount:2,at:new Date(now).toISOString(),project:'proj-bbbb'}],{project:'proj-aaaa',now});
 assert.equal(view.recent.length,0,'a sale without a project never shows in a project view');
 assert.equal(salesView([{amount:1,at:new Date(now).toISOString(),project:'proj-aaaa'}],{project:'all',now}).recent.length,1);
});
test('Codex review: dedupe is per project + order id', async () => {
 assert.notEqual(await orderRef('ord-1','proj-aaaa'),await orderRef('ord-1','proj-bbbb'));
 assert.equal(await orderRef('ord-1','proj-aaaa'),await orderRef('ord-1','proj-aaaa'));
 let list=addSale([],{amount:1,project:'proj-aaaa',orderRef:'r'}).list;
 assert.equal(addSale(list,{amount:1,project:'proj-aaaa',orderRef:'r'}).added,false);
 assert.equal(addSale(list,{amount:1,project:'proj-bbbb',orderRef:'r'}).added,true);
});

test('Codex review 2: explicit negatives and contradictions win, from the envelope or from data', () => {
 assert.equal(normalizeSale({topic:'order.paid',data:{amount:10,status:'rejected',orderId:'o'}}),null,'paid topic + rejected status');
 assert.equal(normalizeSale({topic:'order.not_approved',data:{amount:10,orderId:'o'}}),null,'negated positive token');
 for(const v of ['not_approved','nao_aprovado','unconfirmed','incomplete','disapproved','desaprovado','nao_pago','reprovado','rejeitado','denied','error','invalid','blocked','on_hold','reversed','partially_paid','order.payment_failed'])
  assert.equal(paymentEvidence({topic:'order.paid',data:{status:v}}).paid,false,v);
 assert.equal(paymentEvidence({topic:'order.not_approved'}).paid,false);
 assert.equal(paymentEvidence({status:'rejected',data:{status:'paid'}}).paid,false,'envelope negative wins over data positive');
 assert.equal(paymentEvidence({topic:'order.paid',data:{payment:{paid:false}}}).paid,false);
 assert.equal(paymentEvidence({topic:'order.paid',data:{order:{status:'refused'}}}).paid,false);
 assert.equal(paymentEvidence({topic:'sale',data:{type:'refund'}}).paid,false);
 for(const v of ['paid','approved','order.approved','aprovado','pago','completed','concluido','confirmed','confirmado'])assert.equal(paymentEvidence({topic:v}).paid,true,v);
});
test('Codex review 2: projects in the envelope and in data must agree', () => {
 const split=normalizeSale({topic:'order.paid',projectId:'project-B',data:{amount:10,orderId:'o',projectId:'project-A'}});
 assert.equal(split.project,'ambiguous');assert.equal(bindSale(split,'project-A').error,'projeto ambíguo no pedido');
 const envOnly=normalizeSale({topic:'order.paid',project:{id:'project-B'},data:{amount:10,orderId:'o'}});
 assert.equal(bindSale(envOnly,'project-A').error,'projeto do pedido diferente do endereço');
 const nested=normalizeSale({topic:'order.paid',data:{amount:10,orderId:'o',projectId:'project-A',order:{projectId:'project-C'}}});
 assert.equal(nested.project,'ambiguous');
 const same=normalizeSale({topic:'order.paid',projectId:'project-A',data:{amount:10,orderId:'o',project:{id:'project-A'}}});
 assert.equal(bindSale(same,'project-A').sale.project,'project-A','the same id twice is not ambiguous');
});
