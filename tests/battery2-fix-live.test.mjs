import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import v8 from 'node:v8';
import ts from 'typescript';
import {normalizeSale,paymentEvidence,addSale,salesView,salesFeedLimits} from '../lib/sales-feed.mjs';
import {normalizeMetaAccount} from '../lib/account-limits.mjs';
import {validateAnalysisBundle} from '../lib/analysis-validation.mjs';
import {bundleSchema} from '../lib/snapshot-schema.mjs';

const now=Date.parse('2026-11-09T15:00:00Z');

test('chargedback, charged_back, devolvido, protested, overdue and similar statuses are not paid sales',()=>{
 const cases=[{event:'order.updated',data:{order:{status:'chargedback'},payment:{status:'approved'},amount:297,orderId:'A1'}},
  {data:{status:'charged_back',payment:{status:'paid'},amount:297,orderId:'A2'}},{data:{status:'charge-back',payment:{status:'paid'},amount:297,orderId:'A2b'}},
  {data:{status:'devolvido',payment_status:'aprovado',amount:297,orderId:'A3'}},{data:{status:'PROTESTED',payment:{status:'APPROVED'},amount:297,orderId:'A4'}},
  {data:{status:'overdue',topic:'invoice.paid',amount:297,orderId:'A5'}},{data:{status:'Vencida',payment:{status:'paid'},amount:297,orderId:'A6'}},
  {data:{status:'DELAYED',topic:'purchase.approved',amount:297,orderId:'A7'}},{data:{status:'UNDER_ANALISYS',topic:'purchase.approved',amount:297,orderId:'A8'}},
  {data:{status:'em_analise',topic:'order.paid',amount:297,orderId:'A9'}},{data:{status:'past_due',topic:'order.paid',amount:297,orderId:'A10'}},
  {data:{status:'refunded',payment:{status:'approved'},amount:297,orderId:'A11'}},{data:{status:'chargeback',topic:'order.paid',amount:297,orderId:'A12'}}];
 for(const b of cases){assert.equal(paymentEvidence(b).paid,false,JSON.stringify(b.data));assert.equal(normalizeSale(b,now),null);}
 // Ordinary paid statuses and payment types are not over-matched.
 for(const [topic,status,type] of [['order.paid','paid','credit_card'],['purchase.approved','APPROVED','billet'],['sale.completed','completed','pix'],['order.paid','pago','boleto'],['payment.approved','aprovado','subscription'],['order.paid','confirmed','order_bump']])
  assert.equal(normalizeSale({topic,data:{status,type,amount:297,orderId:'P'}},now)?.amount,297,status+' '+type);
});

test('Brazilian and dotted amounts are parsed; ambiguous or unparseable stay N/D (sale dropped), never 0',()=>{
 for(const [amount,want] of [['1.297,00',1297],['R$ 297,00',297],['R$1.297,50',1297.5],['1297.000',1297],['1,297.00',1297],['1.297.000',1297000],['1.297.000,99',1297000.99],['0.297',0.3],['297',297],['297,00',297],['49.9',49.9],[' 12,5 ',12.5],[1297,1297],['297.5 ',297.5]])
  assert.equal(normalizeSale({status:'paid',data:{amount,orderId:'o'}},now)?.amount,want,JSON.stringify(amount));
 for(const amount of ['1.297','1,297','1e3','',' ','297,0001','-10','R$','1.29.7','12.34.56','1,297,00','abc','1.297,000',0,'0'])
  assert.equal(normalizeSale({status:'paid',data:{amount,orderId:'o'}},now),null,JSON.stringify(amount));
});

test('payment time wins over creation time',()=>{
 const base={amount:10,orderId:'o',createdAt:'2026-11-09T10:00:00Z'};
 assert.equal(normalizeSale({topic:'order.paid',data:{...base,order:{paidAt:'2026-11-09T12:00:00Z'}}},now).at,'2026-11-09T12:00:00.000Z');
 assert.equal(normalizeSale({topic:'order.paid',data:{...base,payment:{paidAt:'2026-11-09T12:30:00Z'}}},now).at,'2026-11-09T12:30:00.000Z');
 assert.equal(normalizeSale({topic:'order.paid',data:{...base,paidAt:'2026-11-09T13:00:00Z',approvedAt:'2026-11-09T11:00:00Z'}},now).at,'2026-11-09T13:00:00.000Z');
 assert.equal(normalizeSale({topic:'order.paid',data:{...base,paidAt:'garbage'}},now).at,'2026-11-09T10:00:00.000Z','unparseable payment time falls to the next one');
 assert.equal(normalizeSale({topic:'order.paid',data:base},now).at,'2026-11-09T10:00:00.000Z','creation time when no payment time');
 assert.equal(normalizeSale({topic:'order.paid',data:{amount:10,orderId:'o'}},now).at,new Date(now).toISOString(),'no time: received now');
});

const mk=(id,project,at=now)=>({amount:10,currency:'BRL',product:null,campaign:null,project,at:new Date(at).toISOString(),orderRef:id});
test('a retry after 40 other sales is still recognized and the last-hour count is not capped at the shown rows',()=>{
 let list=addSale([],mk('dup','projA')).list;
 for(let i=0;i<60;i++)list=addSale(list,mk('o'+i,'projB')).list;
 assert.equal(list.length,salesFeedLimits.keep,'shown rows stay bounded');
 assert.equal(addSale(list,mk('dup','projA')).added,false,'retry after 60 other sales');
 assert.equal(addSale(list,mk('dup','projB')).added,true,'same ref in another project is another sale');
 assert.equal(salesView(list,{project:'all',now}).lastHour,61);
 assert.equal(salesView(list,{project:'projB',now}).lastHour,60);
 assert.equal(salesView(list,{project:'projA',now}).lastHour,1);
 assert.equal(salesView(list,{project:'projA',now}).recent.length,0,'projA row left the shown list');
 assert.equal(salesView(list,{project:'all',now}).recent.length,10);
 assert.equal(salesView(list,{project:'all',now:now+3600001}).lastHour,0,'older than an hour');
 // Bounded memory; it survives the Durable Object's structured clone.
 for(let i=0;i<salesFeedLimits.seen+50;i++)list=addSale(list,mk('z'+i,'projC')).list;
 assert.equal(list.seen.length,salesFeedLimits.seen);assert.equal(list.length,salesFeedLimits.keep);
 const stored=v8.deserialize(v8.serialize(list));
 assert.equal(stored.seen.length,salesFeedLimits.seen);assert.equal(addSale(stored,mk('z'+(salesFeedLimits.seen+49),'projC')).added,false);
 assert.ok(v8.serialize(stored).length<128*1024,'fits a Durable Object value');
});

test('a feed stored before `seen` existed still dedupes by its rows and counts them',()=>{
 const old=[mk('a','projA',now-60000),mk('b','projA',now-7200000)];
 assert.equal(addSale(old,mk('a','projA')).added,false);
 assert.equal(salesView(old,{project:'projA',now}).lastHour,1);
 const out=addSale(old,mk('c','projA'));
 assert.equal(out.added,true);assert.equal(out.list.length,3);assert.equal(out.list.seen.length,3);
 assert.equal(addSale(out.list,mk('b','projA')).added,false);
 assert.deepEqual(salesView(undefined,{now}),{recent:[],lastHour:0});
 assert.equal(salesView(out.list,{project:'projA',now}).recent[0].orderRef,undefined,'order ref never shown');
});

test('Meta account: empty or unparseable spend and limit are N/D; no insights row is 0 spend',()=>{
 const base={account_id:'act_123',currency:'BRL',account_status:1};
 assert.equal(normalizeMetaAccount({...base,insights:{data:[{spend:''}]}}).todaySpend,null);
 assert.equal(normalizeMetaAccount({...base,insights:{data:[{spend:'  '}]}}).todaySpend,null);
 assert.equal(normalizeMetaAccount({...base,insights:{data:[{spend:'abc'}]}}).todaySpend,null);
 assert.equal(normalizeMetaAccount({...base,insights:{data:[{}]}}).todaySpend,null);
 assert.equal(normalizeMetaAccount({...base,insights:{data:[{spend:'12.34'}]}}).todaySpend,12.34);
 assert.equal(normalizeMetaAccount({...base,insights:{data:[{spend:'0'}]}}).todaySpend,0);
 assert.equal(normalizeMetaAccount(base).todaySpend,0,'no insights edge: no delivery today');
 assert.equal(normalizeMetaAccount({...base,insights:{data:[]}}).todaySpend,0);
 assert.equal(normalizeMetaAccount({...base,adtrust_dsl:''}).dailyLimit,null);
 assert.equal(normalizeMetaAccount({...base,adtrust_dsl:' '}).dailyLimit,null);
 assert.equal(normalizeMetaAccount({...base,adtrust_dsl:'500'}).dailyLimit,500);
 assert.equal(normalizeMetaAccount({...base,disable_reason:''}).disableReason,null);
 assert.equal(normalizeMetaAccount({...base,disable_reason:'0'}).disableReason,0);
 assert.equal(fs.readFileSync(new URL('../lib/account-limits.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/functions/meta-read/account-limits.mjs',import.meta.url),'utf8'));
});

test('accounts panel money: no currency means a bare number with "moeda N/D", never USD',()=>{
 const src=fs.readFileSync(new URL('../app/accounts-panel.tsx',import.meta.url),'utf8'),line=src.split('\n').find(l=>l.startsWith('const money='));
 const money=new Function(ts.transpileModule(line+'\nreturn money;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();
 const n=1234.5,brl=n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
 assert.equal(money(n,'BRL'),brl);
 assert.equal(money(n,null),n.toLocaleString('pt-BR',{maximumFractionDigits:2})+' (moeda N/D)');
 assert.equal(money(n,'reais'),n.toLocaleString('pt-BR',{maximumFractionDigits:2})+' (moeda N/D)');
 assert.doesNotMatch(money(n,null),/US\$|\$/);
 assert.equal(money(null,'BRL'),'N/D');assert.equal(money(NaN,null),'N/D');
});

const snap=(extra={})=>({projectId:'p',projectName:'Gabe',period:'7d',timezone:'America/Sao_Paulo',from:'2026-11-02T03:00:00Z',to:'2026-11-09T03:00:00Z',fetchedAt:'2026-11-09T12:00:00Z',lastSyncAt:'2026-11-09T11:59:00Z',source:'Malva MCP',level:'campaign',complete:true,rows:[],...extra});
test('new analysis writes need ISO 8601 window boundaries with Z or offset; stored history stays readable',()=>{
 const write=s=>validateAnalysisBundle({snapshots:[s]},{snapshots:[]},now);
 for(const [from,to] of [['2026-11-02T03:00:00Z','2026-11-09T03:00:00Z'],['2026-11-02T00:00:00-03:00','2026-11-09T00:00:00-03:00'],['2026-11-02T00:00-03:00','2026-11-09T00:00:00.000-03:00'],['2026-11-02T03:00:00.000Z','2026-11-09T03:00:00.000Z']])
  assert.doesNotThrow(()=>write(snap({from,to})),from);
 for(const [from,to] of [['1','2'],['2026-11-02 00:00','2026-11-09 00:00'],['2026-11-02T00:00:00','2026-11-09T00:00:00'],['Nov 2 2026','Nov 9 2026'],['2026-11-02','2026-11-09'],['2026-02-30T03:00:00Z','2026-11-09T03:00:00Z'],['2026-11-02T24:00:00Z','2026-11-09T03:00:00Z'],['2026-11-02T00:00:00+0300','2026-11-09T03:00:00Z']])
  assert.throws(()=>write(snap({from,to})),/ISO 8601/,from);
 // fetchedAt/lastSyncAt are already strict (zod datetime: Z, real calendar date) in the schema.
 assert.throws(()=>write(snap({fetchedAt:'2026-02-30T12:00:00Z',lastSyncAt:null})));
 assert.throws(()=>write(snap({lastSyncAt:'2026-02-31T11:00:00Z'})));
 assert.doesNotThrow(()=>write(snap({lastSyncAt:null})));
 // Reading stored history (the schema) is unchanged: loose frozen sources still parse.
 assert.equal(bundleSchema.safeParse({snapshots:[snap({from:'2026-11-02 00:00',to:'2026-11-09 00:00'})]}).success,true);
});
