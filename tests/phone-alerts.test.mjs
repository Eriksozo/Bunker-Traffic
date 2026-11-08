import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneAlerts,deliverPhoneAlerts,rememberSent,bunkerDay,phonePolicy} from '../lib/phone-alerts.mjs';

const now=Date.parse('2026-11-08T15:00:00Z');
const summary=(over={})=>({
 approvals:{items:[{id:'p1',title:'Reduzir orçamento',project:'Gabe'}]},
 queue:[{kind:'loss',adAccountId:'act_1',campaignId:'c1',campaign:'Camp A',project:'Gabe',amount:-120},{kind:'scale',adAccountId:'act_1',campaignId:'c2',campaign:'Camp B',amount:50}],
 orders:[{id:'o1',stage:'confirmed',campaign:'Camp A',action:'budget',currency:'BRL',before:{dailyBudget:100},after:{dailyBudget:80}},{id:'o2',stage:'sent',campaign:'Camp C'}],
 pace:{byProject:[{project:'gabe',name:'Gabe',alert:'early',exhaustsAt:'2026-11-08T19:30:00Z',spend:800,budget:1500,currency:'BRL',known:12,unknown:0},{project:'john',name:'John',alert:null}]},
 ...over});
const okFetch=calls=>async(url,init)=>{calls.push({url,body:Object.fromEntries(init.body)});return {ok:true,status:200};};
const creds={token:'t'.repeat(30),user:'u'.repeat(30)};

test('first run only primes: nothing that already existed rings', async()=>{
 const calls=[];const r=await deliverPhoneAlerts({summary:summary(),ledger:undefined,credentials:creds,fetchFn:okFetch(calls),now});
 assert.equal(calls.length,0);assert.equal(r.ledger.primed,true);
 assert.deepEqual(phoneAlerts(summary(),r.ledger,{now}).fresh,[]);
});

test('the four kinds ring once each; sale/scale/sent orders never do', async()=>{
 const primed=rememberSent(undefined,[],{now});
 const {fresh}=phoneAlerts(summary(),primed,{now});
 assert.deepEqual(fresh.map(a=>a.kind).sort(),['approval','loss','order','pace']);
 const loss=fresh.find(a=>a.kind==='loss');assert.equal(loss.title,'Perda para revisar');assert.match(loss.message,/Gabe · Camp A · .*120/);
 assert.match(fresh.find(a=>a.kind==='order').message,/Reduzir · R\$\s?100,00 → R\$\s?80,00\/dia/);
 assert.match(fresh.find(a=>a.kind==='pace').title,/Orçamento de Gabe acaba às 15:30/);
 const calls=[];const r=await deliverPhoneAlerts({summary:summary(),ledger:primed,credentials:creds,fetchFn:okFetch(calls),now});
 assert.equal(calls.length,4);assert.equal(r.sent,4);assert.equal(calls[0].url,phonePolicy.endpoint);
 assert.equal(calls[0].body.url,phonePolicy.url);
 const again=[];await deliverPhoneAlerts({summary:summary(),ledger:r.ledger,credentials:creds,fetchFn:okFetch(again),now});
 assert.equal(again.length,0);
});

test('a loss rings again only when it grows to 1.5×', async()=>{
 let ledger=rememberSent(undefined,[],{now});
 ledger=(await deliverPhoneAlerts({summary:summary(),ledger,credentials:creds,fetchFn:okFetch([]),now})).ledger;
 const bigger=amount=>summary({queue:[{kind:'loss',adAccountId:'act_1',campaignId:'c1',campaign:'Camp A',amount}]});
 assert.deepEqual(phoneAlerts(bigger(-170),ledger,{now}).fresh,[]);
 const grown=phoneAlerts(bigger(-180),ledger,{now}).fresh;
 assert.equal(grown.length,1);assert.equal(grown[0].title,'Perda cresceu');
});

test('pace warns once per Bunker day (Boa Vista, not UTC)', ()=>{
 assert.equal(bunkerDay(Date.parse('2026-11-09T02:00:00Z')),'2026-11-08');
 const ledger=rememberSent(undefined,[{key:'pace:gabe:early:2026-11-08',value:1}],{now});
 const fresh=phoneAlerts(summary({approvals:{items:[]},queue:[],orders:[]}),ledger,{now:Date.parse('2026-11-09T13:00:00Z')}).fresh;
 assert.deepEqual(fresh.map(a=>a.key),['pace:gabe:early:2026-11-09']);
});

test('retryable failure stays pending; a refusal is not retried; credentials never in the ledger', async()=>{
 const primed=rememberSent(undefined,[],{now});
 const down=await deliverPhoneAlerts({summary:summary(),ledger:primed,credentials:creds,fetchFn:async()=>({ok:false,status:503}),now});
 assert.equal(down.sent,0);assert.equal(down.ledger.lastError,'PUSHOVER_503');
 assert.equal(phoneAlerts(summary(),down.ledger,{now}).fresh.length,4);
 const refused=await deliverPhoneAlerts({summary:summary(),ledger:primed,credentials:creds,fetchFn:async()=>({ok:false,status:400}),now});
 assert.equal(phoneAlerts(summary(),refused.ledger,{now}).fresh.length,0);
 assert.ok(!JSON.stringify(refused.ledger).includes(creds.token));assert.ok(!JSON.stringify(refused.ledger).includes(creds.user));
 const thrown=await deliverPhoneAlerts({summary:summary(),ledger:primed,credentials:creds,fetchFn:async()=>{throw new Error('net');},now});
 assert.equal(thrown.ledger.lastError,'PUSHOVER_NETWORK');
});

test('at most five per run; the rest go on the next summary', async()=>{
 const many=summary({approvals:{items:Array.from({length:8},(_,i)=>({id:'p'+i,title:'P'+i}))},queue:[],orders:[],pace:{byProject:[]}});
 const calls=[];const r=await deliverPhoneAlerts({summary:many,ledger:rememberSent(undefined,[],{now}),credentials:creds,fetchFn:okFetch(calls),now});
 assert.equal(calls.length,phonePolicy.maxPerRun);assert.equal(r.pending,3);
 const next=[];await deliverPhoneAlerts({summary:many,ledger:r.ledger,credentials:creds,fetchFn:okFetch(next),now});
 assert.equal(next.length,3);
});

test('executor wires phone alerts after the notch summary, gated by both secrets', async()=>{
 const {readFile}=await import('node:fs/promises');
 const src=await readFile(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.match(src,/await this\.ctx\.storage\.put\(out\);\n\s*await this\.phoneAlerts\(out\['companion:all'\]\)\.catch/);
 assert.match(src,/if\(!summary\|\|!token\|\|!user\|\|this\.phoneBusy\)return;/);
});
