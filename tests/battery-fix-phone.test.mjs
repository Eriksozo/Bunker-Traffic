import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneAlerts,deliverPhoneAlerts,rememberSent,phonePolicy} from '../lib/phone-alerts.mjs';

// Invented fixtures only; fetch is always mocked.
const now=Date.parse('2026-11-09T15:00:00Z');
const creds={token:'t'.repeat(30),user:'u'.repeat(30)};
const base=(over={})=>({approvals:{items:[]},queue:[],orders:[],pace:{byProject:[]},...over});
const okFetch=calls=>async(url,init)=>{calls.push(Object.fromEntries(init.body));return {ok:true,status:200};};
const primed=()=>rememberSent(undefined,[],{now});
const loss=(period,amount,over={})=>({kind:'loss',adAccountId:'act_x',campaignId:'cx',campaign:'Camp Teste',project:'Projeto X',period,amount,...over});

test('lastError survives a pulse that sends nothing and clears only after a successful send', async()=>{
 const s=base({approvals:{items:[{id:'z1',title:'Prop'}]}});
 const r1=await deliverPhoneAlerts({summary:s,ledger:primed(),credentials:creds,fetchFn:async()=>({ok:false,status:400}),now});
 assert.equal(r1.ledger.lastError,'PUSHOVER_400');
 const r2=await deliverPhoneAlerts({summary:s,ledger:r1.ledger,credentials:creds,fetchFn:async()=>({ok:false,status:400}),now:now+60000});
 assert.equal(r2.sent,0);assert.equal(r2.ledger.lastError,'PUSHOVER_400');assert.equal(r2.ledger.lastErrorAt,r1.ledger.lastErrorAt);
 const r3=await deliverPhoneAlerts({summary:base({approvals:{items:[{id:'z2',title:'Prop 2'}]}}),ledger:r2.ledger,credentials:creds,fetchFn:okFetch([]),now:now+120000});
 assert.equal(r3.sent,1);assert.equal(r3.ledger.lastError,null);
 const r4=await deliverPhoneAlerts({summary:base({approvals:{items:[{id:'z3',title:'Prop 3'}]}}),ledger:r3.ledger,credentials:creds,fetchFn:async()=>({ok:false,status:503}),now:now+180000});
 assert.equal(r4.ledger.lastError,'PUSHOVER_503');
});

test('a loss window change (today → 3 complete days) is never called growth, and the message names the window', async()=>{
 const c1=[];let ledger=(await deliverPhoneAlerts({summary:base({queue:[loss('today',40)]}),ledger:primed(),credentials:creds,fetchFn:okFetch(c1),now})).ledger;
 assert.equal(c1[0].title,'Perda para revisar');assert.match(c1[0].message,/R\$\s?40,00 hoje$/);
 // Another window below 1.5× the amount that rang stays quiet (one ring per campaign, as in the notch).
 assert.deepEqual(phoneAlerts(base({queue:[loss('3d',59)]}),ledger,{now}).fresh,[]);
 const c2=[];ledger=(await deliverPhoneAlerts({summary:base({queue:[loss('3d',100)]}),ledger,credentials:creds,fetchFn:okFetch(c2),now:now+3600000})).ledger;
 assert.equal(c2.length,1);assert.equal(c2[0].title,'Perda para revisar');assert.match(c2[0].message,/R\$\s?100,00 em 3 dias completos$/);
 // Growth is still announced inside the same window.
 assert.deepEqual(phoneAlerts(base({queue:[loss('3d',140)]}),ledger,{now}).fresh,[]);
 const grown=phoneAlerts(base({queue:[loss('3d',150)]}),ledger,{now}).fresh;
 assert.equal(grown.length,1);assert.equal(grown[0].title,'Perda cresceu');
 // A loss without a window keeps the plain amount (no invented window).
 const plain=phoneAlerts(base({queue:[loss(undefined,30,{campaignId:'cy'})]}),primed(),{now}).fresh;
 assert.match(plain[0].message,/R\$\s?30,00$/);
});

test('a ledger key from before the window existed is a quiet baseline, not a claimed growth', ()=>{
 const legacy=rememberSent(undefined,[{key:'lo:act_x:cx',value:80}],{now});
 assert.deepEqual(phoneAlerts(base({queue:[loss('3d',100)]}),legacy,{now}).fresh,[]);
 const bigger=phoneAlerts(base({queue:[loss('3d',200)]}),legacy,{now}).fresh;
 assert.equal(bigger.length,1);assert.equal(bigger[0].title,'Perda para revisar');
});

test('the ledger trim keeps every key the summary still shows, so an unchanged loss never rings twice', async()=>{
 const s=base({queue:[loss('3d',120)]});
 const c=[];let ledger=(await deliverPhoneAlerts({summary:s,ledger:primed(),credentials:creds,fetchFn:okFetch(c),now})).ledger;
 assert.equal(c.length,1);
 const rang=[];
 for(let i=0;i<phonePolicy.seenLimit/4+2;i++){
  const si=base({queue:[loss('3d',120)],approvals:{items:[1,2,3,4].map(n=>({id:'n'+i+'_'+n,title:'Nova'}))}});
  ledger=(await deliverPhoneAlerts({summary:si,ledger,credentials:creds,fetchFn:okFetch(rang),now:now+i*60000})).ledger;
 }
 assert.ok(Object.keys(ledger.seen).length<=phonePolicy.seenLimit);
 assert.ok('lo:act_x:cx:3d' in ledger.seen);
 assert.equal(rang.filter(x=>x.title.startsWith('Perda')).length,0);
});

test('owner order receipts go first: order, approval, loss, pace', async()=>{
 const s=base({approvals:{items:[1,2,3].map(i=>({id:'q'+i,title:'Prop '+i}))},
  queue:[1,2].map(i=>loss('today',10*i,{campaignId:'k'+i})),
  orders:[{id:'w1',stage:'failed',campaign:'Camp W',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'}}],
  pace:{byProject:[{project:'px',name:'Projeto X',alert:'under',leftoverPct:30,spend:10,budget:100,currency:'BRL',known:2,unknown:0}]}});
 assert.deepEqual(phoneAlerts(s,primed(),{now}).fresh.map(a=>a.kind),['order','approval','approval','approval','loss','loss','pace']);
 const c=[];const r=await deliverPhoneAlerts({summary:s,ledger:primed(),credentials:creds,fetchFn:okFetch(c),now});
 assert.equal(c[0].title,'Ordem não enviada');assert.equal(c.length,phonePolicy.maxPerRun);assert.equal(r.pending,2);
});

test('a persistent loss does not ring again when the window flips to a smaller amount today', async()=>{
 const c=[];let ledger=(await deliverPhoneAlerts({summary:base({queue:[loss('3d',300,{basis:'result'})]}),ledger:primed(),credentials:creds,fetchFn:okFetch(c),now})).ledger;
 ledger=(await deliverPhoneAlerts({summary:base({queue:[loss('today',12,{basis:'result'})]}),ledger,credentials:creds,fetchFn:okFetch(c),now:now+5*3600000})).ledger;
 assert.equal(c.length,1);assert.match(c[0].message,/R\$\s?300,00 de prejuízo em 3 dias completos$/);
 assert.ok('lo:act_x:cx:3d:result' in ledger.seen);
 const big=phoneAlerts(base({queue:[loss('today',450,{basis:'result'})]}),ledger,{now}).fresh;
 assert.equal(big.length,1);assert.equal(big[0].title,'Perda para revisar');assert.match(big[0].message,/R\$\s?450,00 de prejuízo hoje$/);
 assert.ok(phoneAlerts(base({queue:[loss('today',12,{basis:'result'})]}),ledger,{now}).present.includes('lo:act_x:cx:3d:result'));
});

test('a basis change in the same window (revenue → result) is never called growth, and the message names the measure', async()=>{
 const c=[];let ledger=(await deliverPhoneAlerts({summary:base({queue:[loss('today',40,{basis:'revenue'})]}),ledger:primed(),credentials:creds,fetchFn:okFetch(c),now})).ledger;
 assert.match(c[0].message,/receita R\$\s?40,00 abaixo da mídia hoje$/);
 assert.deepEqual(phoneAlerts(base({queue:[loss('today',55,{basis:'result'})]}),ledger,{now}).fresh,[]);
 const r=phoneAlerts(base({queue:[loss('today',70,{basis:'result'})]}),ledger,{now}).fresh;
 assert.equal(r.length,1);assert.equal(r[0].title,'Perda para revisar');assert.match(r[0].message,/R\$\s?70,00 de prejuízo hoje$/);
 // Same window and basis: growth is still named.
 const g=phoneAlerts(base({queue:[loss('today',60,{basis:'revenue'})]}),ledger,{now}).fresh;
 assert.equal(g.length,1);assert.equal(g[0].title,'Perda cresceu');
});

test('Final review: yesterday\'s "hoje" loss is never the base of "Perda cresceu" today; legacy keys stay quiet baselines',async()=>{
 const {phoneAlerts}=await import('../lib/phone-alerts.mjs');
 const q=(amount)=>({queue:[{kind:'loss',project:'Fictício',campaign:'Campanha Fictícia',adAccountId:'acc',campaignId:'c1',period:'today',basis:'result',amount}]});
 const d1=Date.parse('2026-11-09T18:00:00Z'),d2=Date.parse('2026-11-10T18:00:00Z');
 const first=phoneAlerts(q(100),{primed:true,seen:{}},{now:d1});assert.equal(first.alerts?.[0]?.title??first[0]?.title??first.fresh?.[0]?.title,'Perda para revisar');
 const seen=Object.fromEntries((first.alerts||first.fresh||first).map(a=>[a.key,a.value]));
 const next=phoneAlerts(q(200),{primed:true,seen},{now:d2}),list=next.alerts||next.fresh||next;
 assert.ok(list.every(a=>a.title!=='Perda cresceu'),'a new day is not growth of yesterday');
 const legacy=phoneAlerts(q(120),{primed:true,seen:{'lo:acc:c1:today:result':100}},{now:d2}),l2=legacy.alerts||legacy.fresh||legacy;
 assert.equal(l2.length,0,'the pre-deploy key without the day stays a quiet baseline below 1.5×');
});
