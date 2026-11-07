import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateShadow,mergeShadow,shadowOutcomes,shadowSummary,launchDay} from '../lib/autonomy-shadow.mjs';

// Synthetic fixtures only: identifiers and values are invented.
const now=Date.parse('2026-11-07T17:00:00Z'); // 14:00 America/Sao_Paulo
const iso=ms=>new Date(ms).toISOString();
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0,extra={})=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0,...extra});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'USD',budgetRate:5,lifetimeBudget:null,...metrics,...extra});
function state({today=[],closed={}}={}){
 const cut=(period,from,rows)=>({...base,period,from,to:'2026-11-07T03:00:00.000Z',fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows});
 return {config:{p:{projectName:'Fictício'}},snapshots:[
  {...base,period:'today',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows:today},
  cut('7d','2026-10-31T03:00:00.000Z',closed['7d']||[]),cut('3d','2026-11-04T03:00:00.000Z',closed['3d']||[]),cut('yesterday','2026-11-06T03:00:00.000Z',closed.yesterday||[])]};
}
const params={pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:300};
const run=(s,opts={})=>evaluateShadow(s,{project:'p',params,now,...opts});

test('First-day test without sales above the project threshold would be paused; below it, nothing',()=>{
 const hot=row('t1','07/11 - [TESTE] A',m(230,0,0,0,3)),cold=row('t2','07/11 - [TESTE] B',m(150,0,0,0,2));
 const out=run(state({today:[hot,cold]}));
 const d=out.decisions.filter(x=>x.rule==='test-no-sale');
 assert.deepEqual(d.map(x=>x.objectId),['t1']);assert.equal(d[0].wouldExecute,true);assert.equal(d[0].launchDay,0);
 assert.deepEqual([d[0].before.status,d[0].after.status],['ACTIVE','PAUSED']);
 assert.equal(out.source.kind,'analysis');
});
test('Zero checkouts uses the lower threshold; a sale or a missing threshold never becomes an executable pause',()=>{
 const noIc=row('t3','07/11 - [TESTE] C',m(130,0,0,0,0));
 assert.equal(run(state({today:[noIc]})).decisions[0]?.wouldExecute,true);
 const sold=row('t4','07/11 - [TESTE] D',m(400,297,1,1,6));
 assert.equal(run(state({today:[sold]})).decisions.some(x=>x.rule==='test-no-sale'),false);
 const blocked=run(state({today:[row('t5','07/11 - [TESTE] E',m(500))]}),{params:{}}).decisions[0];
 assert.equal(blocked.wouldExecute,false);assert.match(blocked.blockedBy[0],/Limiar/);
});
test('Second-day test counts as no-sale only when yesterday also sold nothing',()=>{
 const today=row('t6','06/11 - [TESTE] F',m(250,0,0,0,2)),y=row('t6','06/11 - [TESTE] F',m(180,0,0));
 const s=state({today:[today],closed:{yesterday:[y],'3d':[y],'7d':[y]}});
 assert.equal(launchDay(today,{yesterday:y,'3d':y,'7d':y,today},{now}),1);
 assert.equal(run(s).decisions.find(x=>x.rule==='test-no-sale')?.launchDay,1);
 const ySold={...y,frontOrders:1,orders:1,revenueNet:297};
 assert.equal(run(state({today:[today],closed:{yesterday:[ySold],'3d':[ySold],'7d':[ySold]}})).decisions.some(x=>x.rule==='test-no-sale'),false);
 const older={...y,spend:400};// spend before yesterday: neither day 0 nor day 1
 assert.equal(run(state({today:[today],closed:{yesterday:[y],'3d':[older],'7d':[older]}})).decisions.some(x=>x.rule==='test-no-sale'),false);
});
test('A manager edit in the last 2h blocks execution and is named; stale sources evaluate nothing',()=>{
 const r=row('t7','07/11 - [TESTE] G',m(260,0,0,0,1));
 const events=[{project:'p',adAccountId:'acc1',objectId:'t7',action:'reduce',actor:'Gestor X',at:iso(now-1800000),origin:'history'}];
 const d=run(state({today:[r]}),{events}).decisions[0];
 assert.equal(d.wouldExecute,false);assert.match(d.blockedBy.join(' '),/Gestor X/);
 const stale=state({today:[r]});stale.snapshots[0].fetchedAt=iso(now-3600000);stale.snapshots[0].lastSyncAt=iso(now-3700000);
 const out=run(stale);assert.equal(out.decisions.length,0);assert.match(out.skipped,/vencida/);
});
test('A fresher live cut wins over the analysis cut for today',()=>{
 const s=state({today:[row('t8','07/11 - [TESTE] H',m(100,0,0,0,1))]});
 const liveItem={projectId:'p',snapshot:{...s.snapshots[0],fetchedAt:iso(now-60000),lastSyncAt:iso(now-120000),rows:[row('t8','07/11 - [TESTE] H',m(240,0,0,0,1))]}};
 const out=run(s,{liveItem});assert.equal(out.source.kind,'live');assert.equal(out.decisions[0]?.metrics.spend,240);
});
test('Bad day on a good campaign proposes −20% on the CBO budget after 10h; scale phases stay suggestion-only',()=>{
 const good=m(3000,6000,10,10,40),today=m(800,150,1,1,10);
 const r=row('c1','01/11 - [CBO] - [PRE-ESCALA] X',today,{dailyBudget:500}),hist=row('c1','01/11 - [CBO] - [PRE-ESCALA] X',good);
 const s=state({today:[r],closed:{'3d':[hist],'7d':[hist],yesterday:[hist]}});
 const d=run(s).decisions.find(x=>x.rule==='bad-day-reduce');
 assert.equal(d.after.dailyBudget,400);assert.equal(d.before.currency,'USD');
 assert.equal(d.wouldExecute,false,'PRE-ESCALA matches the scale-phase guard');
 const t=row('c2','01/11 - [CBO] - [AVATAR] Y',today,{dailyBudget:500}),th=row('c2','01/11 - [CBO] - [AVATAR] Y',good);
 assert.equal(run(state({today:[t],closed:{'3d':[th],'7d':[th],yesterday:[th]}})).decisions.find(x=>x.rule==='bad-day-reduce').wouldExecute,true);
 assert.equal(run(state({today:[t],closed:{'3d':[th],'7d':[th],yesterday:[th]}}),{now:Date.parse('2026-11-07T11:00:00Z')}).decisions.some(x=>x.rule==='bad-day-reduce'),false,'08:00 local is too early');
});
test('Morning increase needs the owner cap to execute and never exceeds it',()=>{
 const r=row('i1','04/11 - [CBO] - [AVATAR] Z',m(400,1500,4,5,20),{dailyBudget:100}),h=row('i1','04/11 - [CBO] - [AVATAR] Z',m(1000,2000,6,6,30));
 const s=state({today:[r],closed:{'3d':[h],'7d':[h],yesterday:[h]}});
 const noCap=run(s).decisions.find(x=>x.rule==='morning-increase');
 assert.equal(noCap.after.dailyBudget,150);assert.equal(noCap.wouldExecute,false);assert.match(noCap.blockedBy[0],/Teto/);
 assert.equal(run(s,{params:{...params,budgetCap:200}}).decisions.find(x=>x.rule==='morning-increase').wouldExecute,true);
 assert.equal(run(s,{params:{...params,budgetCap:120}}).decisions.find(x=>x.rule==='morning-increase').wouldExecute,false);
 const fewOrders=row('i2','04/11 - [CBO] - [AVATAR] W',m(400,900,2,2,10));
 assert.equal(run(state({today:[fewOrders]}),{params:{...params,budgetCap:999}}).decisions.some(x=>x.rule==='morning-increase'),false);
});
test('No delivery after midday with verified empty closed windows is an organizational pause',()=>{
 const r=row('n1','20/10 - [CBO] - [TESTE] OLD',m(0));
 const d=run(state({today:[r]})).decisions.find(x=>x.rule==='no-delivery');
 assert.equal(d.after.status,'PAUSED');assert.match(d.limitations.join(' '),/programada/);
 for(const name of ['07/11 - [CBO] - [AVATAR] NOVA','06/11 - [CBO] - [PRE-ESCALA] ONTEM'])assert.equal(run(state({today:[row('n2',name,m(0))]})).decisions.some(x=>x.rule==='no-delivery'),false,name);
});
test('Warmup, paused objects and disabled accounts are never evaluated; the state is not mutated',()=>{
 const rows=[row('w1','07/11 [ENGAJAMENTO] [TESTE]',m(300)),row('w2','07/11 [TESTE] P',m(300),{status:'PAUSED',effectiveStatus:'PAUSED'}),row('w3','07/11 [TESTE] Q',m(300),{accountStatus:{active:false}})];
 const s=state({today:rows}),copy=structuredClone(s);
 assert.equal(run(s).decisions.length,0);assert.deepEqual(s,copy);
});
test('Merging keeps the first instant; outcomes show whether a manager acted later and by how much',()=>{
 const r=row('t9','07/11 - [TESTE] J',m(250,0,0,0,2)),s=state({today:[r]});
 const first=mergeShadow([],run(s).decisions,{now,day:'2026-11-07'});
 const second=mergeShadow(first,run(s,{now:now+900000}).decisions,{now:now+900000,day:'2026-11-07'});
 assert.equal(second.length,1);assert.equal(second[0].firstAt,iso(now));assert.equal(second[0].seen,2);
 const events=[{project:'p',adAccountId:'acc1',objectId:'t9',action:'pause',actor:'Gestor Y',at:iso(now+40*60000),origin:'history',before:'ACTIVE',after:'PAUSED'}];
 const [o]=shadowOutcomes(second,events);assert.equal(o.manager.actor,'Gestor Y');assert.equal(o.manager.minutesAfter,40);
 const summary=shadowSummary([o],{day:'2026-11-07'});assert.equal(summary.byRule['test-no-sale'].bunkerFirst,1);assert.equal(summary.byRule['test-no-sale'].wouldExecute,1);
 assert.equal(shadowOutcomes(second,[{...events[0],adAccountId:'other'}])[0].manager,null,'another account is another object');
});
