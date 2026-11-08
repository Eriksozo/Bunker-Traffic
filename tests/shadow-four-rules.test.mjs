import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateShadow,shadowRules,scoreGatedRules} from '../lib/autonomy-shadow.mjs';

// Owner approval of 08/11/2026 ("Aplicar as 4"). Synthetic fixtures only: identifiers and values are invented.
const now=Date.parse('2026-11-07T17:00:00Z'); // 07/11 14:00 America/Sao_Paulo
const iso=ms=>new Date(ms).toISOString();
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'USD',budgetRate:5,lifetimeBudget:null,...metrics,...extra});
function state({today=[],closed={}}={}){
 const cut=(period,from,rows)=>({...base,period,from,to:'2026-11-07T03:00:00.000Z',fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows});
 return {config:{p:{projectName:'Fictício'}},snapshots:[
  {...base,period:'today',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows:today},
  cut('7d','2026-10-31T03:00:00.000Z',closed['7d']||[]),cut('3d','2026-11-04T03:00:00.000Z',closed['3d']||[]),cut('yesterday','2026-11-06T03:00:00.000Z',closed.yesterday||[])]};
}
const params={pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:300,budgetCap:5000};
const run=(s,opts={})=>evaluateShadow(s,{project:'p',params,now,...opts}).decisions;
const pick=(list,rule,id)=>list.find(d=>d.rule===rule&&(!id||d.objectId===id));

test('Rules are named and budget rules are score-gated',()=>{
 for(const r of ['new-sale-loss','night-increase'])assert.ok(shadowRules[r]);
 assert.deepEqual([...scoreGatedRules].sort(),['bad-day-reduce','morning-increase','night-increase']);
});

test('1. New campaign with a sale and a loss: pause below ROI 0.8 from R$300, alert from 0.8 to 1.0',()=>{
 const n='07/11 - [CBO] - [TESTE] ';
 const d=run(state({today:[row('a1',n+'A1',m(400,260,1,1,6)),row('a2',n+'A2',m(400,360,1,1,6)),row('a3',n+'A3',m(250,150,1,1,3)),row('a4',n+'A4',m(400,600,2,2,6))]}));
 const p1=pick(d,'new-sale-loss','a1'),p2=pick(d,'new-sale-loss','a2');
 assert.equal(p1.wouldExecute,true);assert.deepEqual([p1.before.status,p1.after.status],['ACTIVE','PAUSED']);assert.match(p1.reason,/1º dia: R\$400 gastos hoje, 1 venda, ROI de hoje 0\.65/);
 assert.equal(p2.wouldExecute,false);assert.match(p2.blockedBy[0],/Só alerta/);
 assert.equal(pick(d,'new-sale-loss','a3'),undefined,'below R$300');assert.equal(pick(d,'new-sale-loss','a4'),undefined,'ROI 1.5');
 // Never doubled by the no-sale ceiling or a budget cut on the same campaign.
 assert.equal(d.filter(x=>x.objectId==='a1').length,1);
 // An older campaign is not "new": this rule stays out.
 assert.equal(pick(run(state({today:[row('a5','20/10 - [CBO] - [AVATAR] A5',m(400,260,1,1,6))],closed:{'7d':[row('a5','x',m(900,1800,6,6))]}})),'new-sale-loss'),undefined);
});

test('2. Bad day: campaigns 1–3 days old with a good yesterday, ROI below 0.9, −30% after an increase today',()=>{
 const n='05/11 - [CBO] - [TESTE] B1',y=row('b1',n,m(500,800,3,3)),d3=row('b1',n,m(900,1000,4,4));// 3d ROI 1.11: not the old path
 const s=state({today:[row('b1',n,m(600,400,1,1,6))],closed:{yesterday:[y],'3d':[d3],'7d':[d3]}});
 const r=pick(run(s),'bad-day-reduce','b1');
 assert.equal(r.after.dailyBudget,80);assert.match(r.reason,/Campanha recente: ontem ROI 1\.6/);assert.equal(r.wouldExecute,false);assert.match(r.blockedBy[0],/Só sugestão/);
 const events=[{project:'p',adAccountId:'acc1',objectId:'b1',action:'increase',actor:'Gestor',at:iso(now-3*3600000),origin:'history',before:80,after:100}];
 const raised=pick(run(s,{events}),'bad-day-reduce','b1');assert.equal(raised.after.dailyBudget,70);assert.match(raised.reason,/aumentado hoje/);
 // No sale today on a young campaign: that is the first-24h ceiling's job, not a cut.
 const noSale=state({today:[row('b1',n,m(600,0,0,0,6))],closed:{yesterday:[y],'3d':[d3],'7d':[d3]}});
 assert.equal(pick(run(noSale),'bad-day-reduce'),undefined);
 // Yesterday below 1.2: nothing.
 const weak=row('b1',n,m(500,550,2,2));
 assert.equal(pick(run(state({today:[row('b1',n,m(600,400,1,1,6))],closed:{yesterday:[weak],'3d':[d3],'7d':[d3]}})),'bad-day-reduce'),undefined);
 // Older campaign with a good 3-day history: the trigger is now ROI < 0.9 (was 0.7).
 const old='20/10 - [CBO] - [AVATAR] C1',good=row('c1',old,m(3000,6000,10,10));
 const o=pick(run(state({today:[row('c1',old,m(900,765,3,3,9))],closed:{yesterday:[good],'3d':[good],'7d':[good]}})),'bad-day-reduce','c1');
 assert.ok(o);assert.match(o.reason,/3 dias com ROI 2/);
});

test('3. Night pass: 00:00–00:30, 1–4 days old, yesterday ROI >= 1.3 with a front',()=>{
 const night=Date.parse('2026-11-08T03:15:00Z');// 08/11 00:15 local
 const y=(id,name,metrics,extra)=>row(id,name,metrics,extra),liveRow=(id,name,extra)=>row(id,name,m(5),extra);
 const prev=[y('n1','07/11 - [CBO] - [TESTE] N1',m(500,900,3,3)),y('n2','06/11 - [CBO] - [PRE] N2',m(1500,3750,8,8),{dailyBudget:300}),y('n3','07/11 - [CBO] - [TESTE] N3',m(500,550,2,2)),y('n4','01/11 - [CBO] - [AVATAR] N4',m(500,900,3,3))];
 const s={config:{p:{projectName:'Fictício'}},snapshots:[{...base,period:'today',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:iso(night-80*60000),lastSyncAt:iso(night-75*60000),rows:prev}]};
 const liveItem={projectId:'p',snapshot:{...base,period:'today',from:'2026-11-08T03:00:00.000Z',to:'2026-11-09T03:00:00.000Z',fetchedAt:iso(night-60000),lastSyncAt:iso(night-120000),
  rows:[liveRow('n1','07/11 - [CBO] - [TESTE] N1'),liveRow('n2','06/11 - [CBO] - [PRE] N2',{dailyBudget:300}),liveRow('n3','07/11 - [CBO] - [TESTE] N3'),liveRow('n4','01/11 - [CBO] - [AVATAR] N4')]}};
 const d=evaluateShadow(s,{project:'p',params,now:night,liveItem}).decisions.filter(x=>x.rule==='night-increase');
 assert.deepEqual(d.map(x=>[x.objectId,x.after.dailyBudget]),[['n1',200],['n2',450]]);// small: +100%; large with ROI 2.5: +50%
 assert.equal(d[0].wouldExecute,false);assert.match(d[0].blockedBy[0],/Só sugestão/);assert.match(d[0].limitations.join(' '),/Ontem lido até 23:00/);
 assert.match(d[0].reason,/Ontem 3 front, ROI 1\.8/);
 // After 00:30 the night pass is over.
 assert.equal(evaluateShadow(s,{project:'p',params,now:night+20*60000,liveItem:{...liveItem,snapshot:{...liveItem.snapshot,fetchedAt:iso(night+19*60000),lastSyncAt:iso(night+18*60000)}}}).decisions.some(x=>x.rule==='night-increase'),false);
});

test('4. Sales since midnight: a new campaign needs no 3-day history (2+ fronts, ROI >= 2: +30%, suggestion)',()=>{
 const d=run(state({today:[row('m1','07/11 - [CBO] - [TESTE] M1',m(400,880,2,2,6)),row('m2','20/10 - [CBO] - [AVATAR] M2',m(400,880,2,2,6))],closed:{'7d':[row('m2','x',m(900,1000,3,3))]}}));
 const inc=pick(d,'morning-increase','m1');
 assert.equal(inc.after.dailyBudget,130);assert.equal(inc.wouldExecute,false);assert.match(inc.blockedBy[0],/Só sugestão/);
 assert.equal(pick(d,'morning-increase','m2'),undefined,'an older campaign keeps the old trigger (3 orders, ROI 2.5)');
});
