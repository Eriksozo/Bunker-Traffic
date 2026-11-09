import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateShadow,mergeShadow,shadowOutcomes,shadowSummary,first24hWatch} from '../lib/autonomy-shadow.mjs';
import {newCampaignStage} from '../lib/first-24h.mjs';

// Synthetic fixtures only: identifiers and values are invented.
const iso=ms=>new Date(ms).toISOString();
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'USD',budgetRate:5,lifetimeBudget:null,...metrics,...extra});
// Local day D starts at D 03:00Z (America/Sao_Paulo, UTC−3).
const D=d=>Date.parse(d+'T03:00:00Z');
function state(day,now,{today=[],closed={}}={}){
 const t=D(day),cut=(period,from,rows)=>({...base,period,from:iso(from),to:iso(t),fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows});
 return {config:{p:{projectName:'Fictício'}},snapshots:[
  {...base,period:'today',from:iso(t),to:iso(t+86400000),fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows:today},
  cut('7d',t-7*86400000,closed['7d']||[]),cut('3d',t-3*86400000,closed['3d']||[]),cut('yesterday',t-86400000,closed.yesterday||[])]};
}
const now7=Date.parse('2026-11-07T17:00:00Z');// 14:00 local
const params={ticketFront:300};

test('Manager outcome survives the rolling event window; the earliest reaction wins',()=>{
 const entry={id:'x',day:'2026-11-07',rule:'test-no-sale',project:'p',adAccountId:'acc1',objectId:'t1',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},firstAt:iso(now7),firstWouldExecuteAt:iso(now7)};
 const pause={project:'p',adAccountId:'acc1',objectId:'t1',action:'pause',actor:'Gestor Y',at:iso(now7+40*60000),origin:'history'};
 const [read]=shadowOutcomes([entry],[pause]);assert.equal(read.manager.minutesAfter,40);
 // D+1 11:40 onwards the worker no longer passes the 09:40 event: the reaction must stay.
 const [later]=shadowOutcomes([read],[]);assert.deepEqual(later.manager,read.manager);
 const s=shadowSummary([later],{day:'2026-11-07'}).byRule['test-no-sale'];assert.equal(s.managerDid,1);assert.equal(s.bunkerFirst,1);
 // A later matching event does not replace the first reaction; an earlier one (late attribution) does.
 assert.equal(shadowOutcomes([read],[{...pause,actor:'Outro',at:iso(now7+90*60000)}])[0].manager.actor,'Gestor Y');
 assert.equal(shadowOutcomes([read],[{...pause,actor:'Antes',at:iso(now7+10*60000)}])[0].manager.minutesAfter,10);
});

test('Same since-midnight evidence does not push the same direction again after an edit today (manager or Bunker)',()=>{
 const sales=m(400,1500,4,5,20),hist=m(1000,2000,6,6,30);
 const inc=row('i1','04/11 - [CBO] - [AVATAR] Z',sales,{dailyBudget:130}),h=row('i1','04/11 - [CBO] - [AVATAR] Z',hist);
 const s=state('2026-11-07',now7,{today:[inc],closed:{'3d':[h],'7d':[h],yesterday:[h]}});
 const raise={project:'p',adAccountId:'acc1',objectId:'i1',action:'increase',field:'dailyBudget',before:100,after:130,actor:'Gestor X',at:iso(now7-125*60000),origin:'history'};
 const proven={'bad-day-reduce':{graded:20,right:12,accuracy:0.6}};
 const run=(st,events)=>evaluateShadow(st,{project:'p',params:{...params,budgetCap:1000},now:now7,events,accuracy:proven}).decisions;
 assert.equal(run(s,[]).find(d=>d.rule==='morning-increase').wouldExecute,true,'control: no edit today');
 const blocked=run(s,[raise]).find(d=>d.rule==='morning-increase');
 assert.equal(blocked.wouldExecute,false);assert.match(blocked.blockedBy.join(' '),/já aumentado hoje às 11:55 \(Gestor X\)/);
 // An edit of yesterday or in the other direction is not the same evidence.
 assert.equal(run(s,[{...raise,at:iso(D('2026-11-07')-3600000)}]).find(d=>d.rule==='morning-increase').wouldExecute,true);
 assert.equal(run(s,[{...raise,action:'reduce',before:160,after:130}]).find(d=>d.rule==='morning-increase').wouldExecute,true);
 // The Bunker's own confirmed execution 5 min ago blocks a second −20% on the same bad day.
 const good=m(3000,6000,10,10,40),bad=m(800,150,1,1,10);
 const r=row('c2','01/11 - [CBO] - [AVATAR] Y',bad,{dailyBudget:400}),th=row('c2','01/11 - [CBO] - [AVATAR] Y',good);
 const s2=state('2026-11-07',now7,{today:[r],closed:{'3d':[th],'7d':[th],yesterday:[th]}});
 assert.equal(run(s2,[]).find(d=>d.rule==='bad-day-reduce').wouldExecute,true,'control');
 const cut={project:'p',adAccountId:'acc1',objectId:'c2',action:'reduce',field:'dailyBudget',before:500,after:400,actor:'Bunker · aprovado por você',at:iso(now7-5*60000),origin:'bunker'};
 const d=run(s2,[cut]).find(x=>x.rule==='bad-day-reduce');assert.equal(d.wouldExecute,false);assert.match(d.blockedBy.join(' '),/já reduzido hoje às 13:55 \(Bunker\)/);
 // The stored entry keeps what the Bunker would have done first (500→400), not the compounded 400→320.
 const first=mergeShadow([],[{...d,before:{dailyBudget:500},after:{dailyBudget:400},blockedBy:[],wouldExecute:true}],{now:now7-3600000,day:'2026-11-07'});
 const [merged]=mergeShadow(first,[d],{now:now7,day:'2026-11-07'});
 assert.deepEqual([merged.before.dailyBudget,merged.after.dailyBudget],[500,400]);assert.equal(merged.firstWouldExecuteAt,first[0].firstWouldExecuteAt);
});

test('bunkerFirst counts only decisions that could have executed before the manager acted',()=>{
 const e=(id,firstWouldExecuteAt,minutes)=>({id,day:'2026-11-07',rule:'bad-day-reduce',project:'p',adAccountId:'acc1',objectId:id,action:'budget',before:{dailyBudget:500},after:{dailyBudget:400},firstAt:iso(now7),firstWouldExecuteAt,
  manager:{actor:'Gestor',at:iso(now7+minutes*60000),minutesAfter:minutes}});
 const list=[e('escala',null,30),e('exec',iso(now7),30),e('late',iso(now7+60*60000),30),e('before',iso(now7),-10)];
 const b=shadowSummary(list,{day:'2026-11-07'}).byRule['bad-day-reduce'];
 assert.deepEqual([b.managerDid,b.wouldExecute,b.bunkerFirst,b.anticipatedBlocked],[4,3,1,2]);
});

test('First 24h by the Meta schedule across midnight counts yesterday + today against the R$110 ceiling',()=>{
 const now=Date.parse('2026-11-08T17:00:00Z');// 08/11 14:00 local
 const name='07/11 - [CBO] - [PRE] X',startAt='2026-11-07T23:00:00Z';// 07/11 20:00 local, 18h ago
 const t=row('s1',name,m(50,0,0,0,0),{startAt}),y=row('s1',name,m(90,0,0,0,0));
 const st=newCampaignStage(t,{yesterday:y,'3d':y,'7d':y},{now});
 assert.deepEqual([st.stage,st.basis,st.spansYesterday],['first-day','schedule',true]);
 const s=state('2026-11-08',now,{today:[t],closed:{yesterday:[y],'3d':[y],'7d':[y]}});
 const d=evaluateShadow(s,{project:'p',params:{},now}).decisions.find(x=>x.rule==='test-no-sale');
 assert.ok(d,'R$140 since launch crosses the ceiling');assert.match(d.reason,/R\$140/);assert.match(d.reason,/ultrapassado/);assert.equal(d.wouldExecute,true);
 const board=first24hWatch(s,{project:'p',params:{},now}).items.find(i=>i.objectId==='s1');
 assert.deepEqual([board.level,board.spend,board.spansYesterday],['over',140,true]);
 // Delivery basis: same summation.
 const dv=row('s2',name,m(50,0,0,0,0),{deliveryStartedAt:startAt}),dy=row('s2',name,m(90,0,0,0,0));
 assert.equal(newCampaignStage(dv,{yesterday:dy},{now}).spansYesterday,true);
 assert.equal(first24hWatch(state('2026-11-08',now,{today:[dv],closed:{yesterday:[dy],'3d':[dy],'7d':[dy]}}),{project:'p',params:{},now}).items[0].level,'over');
 // Started after today's midnight: today only, no flag.
 const fresh=row('s3','08/11 - [CBO] - [PRE] Y',m(50,0,0,0,0),{startAt:'2026-11-08T04:00:00Z'});
 const sf=newCampaignStage(fresh,{},{now});assert.equal(sf.stage,'first-day');assert.equal(sf.spansYesterday,undefined);
 assert.equal(first24hWatch(state('2026-11-08',now,{today:[fresh]}),{project:'p',params:{},now}).items[0].spend,50);
});

test('A first day across midnight without yesterday read says the ceiling saw only today',()=>{
 const now=Date.parse('2026-11-08T17:00:00Z'),startAt='2026-11-07T23:00:00Z';
 const t=row('s4','07/11 - [CBO] - [PRE] Z',m(105,0,0,0,0),{startAt});
 const s=state('2026-11-08',now,{today:[t]});s.snapshots=s.snapshots.filter(x=>x.period!=='yesterday');
 const d=evaluateShadow(s,{project:'p',params:{},now}).decisions.find(x=>x.rule==='test-no-sale');
 assert.match(d.limitations.join(' '),/gasto de ontem não foi lido/);
});

test('shadow summary rows carry the campaign ids so the owner can order the anticipated move himself',()=>{
 const e={project:'p1',projectName:'John',adAccountId:'act_1',accountName:'CA 1',objectId:'123',name:'C',rule:'test-no-sale',ruleLabel:'x',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},day:'2026-11-09',firstAt:'2026-11-09T08:00:00.000Z',firstWouldExecuteAt:'2026-11-09T08:00:00.000Z',blockedBy:[]};
 const r=shadowSummary([e],{day:'2026-11-09'}).recent[0];
 assert.deepEqual([r.projectId,r.adAccountId,r.objectId,r.project],['p1','act_1','123','John']);
 assert.deepEqual([shadowSummary([{...e,adAccountId:undefined}],{day:'2026-11-09'}).recent[0].adAccountId],[null]);
});
