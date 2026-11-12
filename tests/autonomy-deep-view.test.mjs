import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as deep from '../lib/autonomy-deep-view.mjs';
import * as grantLib from '../lib/autonomy-grant.mjs';
import * as shadowLib from '../lib/autonomy-shadow.mjs';
import * as activity from '../lib/campaign-activity.mjs';
import * as attribution from '../lib/change-attribution.mjs';
import * as companion from '../lib/companion-summary.mjs';
import * as dailySeries from '../lib/daily-series.mjs';
import * as metaDisplay from '../lib/meta-display.mjs';
import * as learning from '../lib/shadow-learning.mjs';
import * as team from '../lib/team-learning.mjs';
import * as ownerLive from '../lib/owner-order-live.mjs';
import * as contingency from '../lib/decision-contingency.mjs';
import * as sales from '../lib/sales-feed.mjs';

// Modo Gestor, Phase 1 read model (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, a). Synthetic fixtures only: invented
// projects, accounts, campaigns and amounts.
const {buildDeepBase,buildDeepView,decisionStatus,shrinkDeepView,deepViewPolicy,simRow,simRowsView,simColumns}=deep;
const NOW=Date.parse('2026-11-10T15:00:00Z'),DAY='2026-11-10',FROM='2026-11-10T03:00:00.000Z',P='p1',iso=ms=>new Date(ms).toISOString();
const deepFreeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);}return o;};
const m=(spend,revenueNet=0,front=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:0,impressions:1000,linkClicks:20});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:200,budgetCurrency:'BRL',budgetRate:1,...metrics,...extra});
const cut=(period,from,rows,extra={})=>({projectId:P,projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true,period,from,to:iso(Date.parse(from)+(period==='7d'?7:period==='3d'?3:1)*86400000),fetchedAt:iso(NOW-300000),lastSyncAt:iso(NOW-360000),rows,...extra});
const autonomy=(mode='auto',extra={})=>({version:1,enabled:true,projects:{[P]:{mode,actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:500,ordersPerDay:2},campaigns:{'acc1:c3':{mode:'off',name:'Desligada'}},...extra}}});
function state({mode='auto',orders=true}={}){
 return {config:{[P]:{projectName:'Fictício'}},paused:false,autonomy:autonomy(mode),
  snapshots:[cut('today',FROM,[row('c1','Escala A',m(300,600,3)),row('c2','05/11 - Escala B',m(120,0,0)),row('c3','Escala C',m(50,40,1),{budgetCurrency:'USD',budgetRate:5}),row('c4','Nula',{...m(0),spend:null})]),
   cut('yesterday','2026-11-09T03:00:00.000Z',[row('c1','Escala A',m(250,500,2))]),cut('3d','2026-11-07T03:00:00.000Z',[row('c1','Escala A',m(700,1400,7))]),cut('7d','2026-11-03T03:00:00.000Z',[row('c1','Escala A',m(1500,3000,15))])],
  proposals:orders?[{id:'o1',project:P,autonomyOrder:true,createdBy:'bunk',createdAt:iso(NOW-30*60000),approvedAt:iso(NOW-30*60000),status:'Aprovada',payload:{adAccountId:'acc1',objectId:'c1',shadowId:'sid-old',action:'budget',before:{dailyBudget:250},after:{dailyBudget:200},objectName:'Escala A',rule:'bad-day-reduce'}},
   {id:'manual',project:P,createdAt:iso(NOW-600000),payload:{adAccountId:'acc1',objectId:'c2'}}]:[],
  executions:orders?[{id:'e1',proposalId:'o1',status:'Confirmada',claimedAt:iso(NOW-29*60000),preparedAt:iso(NOW-28*60000),submittedAt:iso(NOW-27*60000),confirmedAt:iso(NOW-26*60000),monitorChecks:[{checkpointMinutes:15,recordedAt:iso(NOW-10*60000),status:'Observado',delta:{spend:5,result:-2}}]}]:[]};
}
const entry=(id,extra={})=>({id:JSON.stringify([DAY,'test-no-sale',P,'acc1',id,'status']),day:DAY,rule:'test-no-sale',ruleLabel:shadowLib.shadowRules['test-no-sale'],project:P,projectName:'Fictício',adAccountId:'acc1',accountName:'Conta',objectId:id,name:'Camp '+id,
 action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',blockedBy:[],limitations:['l'],wouldExecute:true,firstAt:iso(NOW-600000),lastAt:iso(NOW-60000),firstWouldExecuteAt:iso(NOW-600000),seen:3,ruleVersion:2,metrics:{spend:150,frontOrders:0,orders:0,revenueNet:0,checkouts:0,roi:null,roas:0,cpc:2,recentRoi:null},...extra});
const baseOf=(opts)=>buildDeepBase({state:state(opts),liveItems:[],accuracy:{'bad-day-reduce':{graded:22,right:16,accuracy:16/22}},policy:{projects:{[P]:{ticketFront:97}}},now:NOW});

test('The deep base is compact, from the state in hand, and never mutates it',()=>{
 const s=deepFreeze(state()),base=buildDeepBase({state:s,liveItems:[],accuracy:{},policy:{projects:{[P]:{}}},now:NOW});
 assert.equal(base.v,1);assert.equal(base.enabled,true);
 assert.deepEqual(base.config,grantLib.autonomyView(s),'config is exactly autonomyView(state)');
 assert.deepEqual(base.orders,[{id:'o1',project:P,createdAt:iso(NOW-30*60000),payload:{adAccountId:'acc1',objectId:'c1',shadowId:'sid-old'}}],'only the Bunk\'s own orders');
 const p=base.projects[P];assert.equal(p.configured,true);assert.equal(p.shadowPolicy,true);
 assert.deepEqual(p.now.map(c=>c.objectId),['c1','c2','c3','c4'],'by today\'s spend, N/D last');
 const c1=p.now[0];
 assert.equal(c1.key,'acc1:c1');assert.equal(c1.mode,'auto');assert.equal(p.now[2].mode,'off','campaign exception');
 assert.equal(c1.windows.today.spend,300);assert.equal(c1.windows.yesterday.spend,250);assert.equal(c1.windows.d7.spend,1500);
 assert.equal(p.now[1].windows.yesterday,null,'no row in the closed window: null, not zeros');
 assert.equal(p.now[3].windows.today.spend,null,'spend N/D stays null');
 assert.deepEqual(c1.guard.ordersToday,1);assert.equal(c1.guard.ordersLimit,2);assert.equal(c1.guard.cooldownUntil,iso(NOW+30*60000),'the cooldown is stored as its end time');
 assert.equal(buildDeepView({base,project:P,now:NOW}).projects[P].now.campaigns[0].guard.cooldownMin,30,'and read as minutes left');
 assert.equal(buildDeepView({base,project:P,now:NOW+10*60000}).projects[P].now.campaigns[0].guard.cooldownMin,20);
 assert.deepEqual(c1.guard.capUse,{cur:200,cap:500,currency:'BRL',share:0.4,mixedCurrency:true},'BRL and USD campaigns: the single Teto is ambiguous');
 assert.equal(p.now[1].guard.ordersToday,0);assert.equal(p.now[1].guard.cooldownUntil,null);
 assert.deepEqual(c1.guard.contingency,[],'stored once per project in the base');assert.ok(p.contingency.some(t=>/Teto diário não definido/.test(t)));
 assert.ok(buildDeepView({base,project:P,now:NOW}).projects[P].now.campaigns[0].guard.contingency.some(t=>/Teto diário não definido/.test(t)),'the view puts it in every campaign guard');
 assert.deepEqual(p.done.map(d=>[d.proposalId,d.kind,d.percent,d.executionStatus]),[['o1','reduce',-20,'Confirmada']]);
 assert.deepEqual(p.done[0].steps.map(s=>s.kind),['decidiu','aprovada','reservada','preparada','enviada','confirmada']);
 assert.deepEqual(p.done[0].monitorChecks,[{minutes:15,at:iso(NOW-10*60000),status:'Observado',delta:{spend:5,roi:null,result:-2}}]);
 assert.equal(p.done[0].grade,null);
 assert.ok(JSON.stringify(base).length<deepViewPolicy.baseMaxBytes);
 assert.equal(deep.deepBaseSignature(base),deep.deepBaseSignature({...base,at:'other'}),'the build time is not part of the signature');
 // Live numbers (today's windows, partial day, cut time) and the order of the list do not change the signature; a mode does.
 const live=JSON.parse(JSON.stringify(base));live.projects[P].now[0].windows.today.spend=999;live.projects[P].todayAt=iso(NOW+60000);live.projects[P].now.reverse();live.stateAt=iso(NOW+60000);
 assert.equal(deep.deepBaseSignature(live),deep.deepBaseSignature(base),'live numbers ride on the periodic rewrite only');
 const slow=JSON.parse(JSON.stringify(base));slow.projects[P].now[0].mode='off';
 assert.notEqual(deep.deepBaseSignature(slow),deep.deepBaseSignature(base),'a permission change rewrites at once');
});

test('decisionStatus follows the contract table, first match wins',()=>{
 const base=baseOf(),ctx={base,now:NOW,shadowAt:iso(NOW-60000),timezone:'America/Sao_Paulo',log:[]};
 const st=(e,c={})=>decisionStatus(e,{...ctx,...c});
 assert.equal(st(entry('c3')).status,'desligado','campaign exception off');
 assert.deepEqual([st(entry('c2')).status,st(entry('c2')).holdReasons],['enviaria',[]],'auto, allowed, nothing blocking');
 assert.equal(st(entry('c1',{action:'budget',rule:'bad-day-reduce',before:{dailyBudget:200,currency:'BRL'},after:{dailyBudget:160,currency:'BRL'}})).status,'segurada','cooldown of the recent Bunk order');
 assert.match(st(entry('c1',{action:'budget',rule:'bad-day-reduce',before:{dailyBudget:200,currency:'BRL'},after:{dailyBudget:160,currency:'BRL'}})).holdReasons.join(' '),/menos de 1h/);
 const alert=st(entry('c2',{rule:'new-sale-loss',alertOnly:true,blockedBy:['Só alerta: ROI entre 0.8 e 1']}));assert.deepEqual([alert.status,alert.suggestionWhy],['so-sugestao','so-alerta']);
 const gated=st(entry('c2',{rule:'bad-day-reduce',blockedBy:['Só sugestão até o placar desta regra passar de 60%']}));
 assert.deepEqual([gated.status,gated.suggestionWhy],['so-sugestao','placar']);
 assert.deepEqual(gated.gate,{graded:22,right:16,need:20,min:0.6,metric:'accuracy',proven:true,source:'7d'});
 assert.equal(st(entry('c2')).gate,null,'non-gated rules carry no gate');
 assert.equal(st(entry('c2',{lastAt:iso(NOW-3600000)})).status,'segurada','not re-emitted by the latest pass');
 assert.deepEqual(st(entry('c2',{blockedBy:['Edição de Ana há menos de 2h']})).holdReasons,['Edição de Ana há menos de 2h']);
 const shadowBase=baseOf({mode:'shadow'});
 assert.deepEqual([decisionStatus(entry('c2'),{...ctx,base:shadowBase}).status,decisionStatus(entry('c2'),{...ctx,base:shadowBase}).suggestionWhy],['so-sugestao','nivel-sombra']);
 const id=entry('c2').id;
 assert.deepEqual([st(entry('c2'),{log:[{shadowId:id,result:{kind:'order',proposalId:'px'},proposalId:'px'}]}).status,st(entry('c2'),{log:[{shadowId:id,result:{kind:'order',proposalId:'px'},proposalId:'px'}]}).proposalId],['enviaria','px']);
 assert.equal(st(entry('c2'),{log:[{shadowId:id,result:{kind:'confirm'}}]}).status,'pediria');
 assert.deepEqual(st(entry('c2'),{log:[{shadowId:id,result:{kind:'blocked',blockers:['x']}}]}).holdReasons,['x']);
 assert.equal(decisionStatus(entry('c2'),{...ctx,base:baseOf({mode:'confirm'})}).status,'pediria');
});

test('A playbook decision is never "enviaria" or "pediria", whatever the permissions say',()=>{
 for(const mode of ['auto','confirm','shadow']){
  const base=baseOf({mode});
  const open=decisionStatus(entry('c2',{source:'playbook',rule:'pb:test-pause',wouldExecute:false,firstWouldExecuteAt:null}),{base,now:NOW,log:[{shadowId:entry('c2').id,result:{kind:'order'}}]});
  assert.deepEqual([open.status,open.suggestionWhy],['so-sugestao','jogada-em-observacao'],mode);
  const held=decisionStatus(entry('c2',{source:'playbook',rule:'pb:test-pause',blockedBy:['Dado ambíguo: gasto N/D']}),{base,now:NOW});
  assert.equal(held.status,'segurada');
 }
 const view=buildDeepView({base:baseOf(),project:P,now:NOW,shadowStatus:{at:iso(NOW-60000),days:{[P]:DAY}},
  pbsEntries:[entry('c2',{id:'pb1',source:'playbook',rule:'pb:test-pause',ruleRev:'v1:abcd1234',playKey:'pb:test-pause@'+P,wouldExecute:true,firstWouldExecuteAt:iso(NOW),play:{params:{k:1.2},learnedStep:null,clampedStep:null},learnedFrom:[{person:'p:x',n:9}],caseRefs:Array.from({length:9},(_,i)=>({day:DAY,adAccountId:'acc1',objectId:'c'+i,person:'p:x',name:'Ana',kind:'pause',at:iso(NOW)}))})]});
 const d=view.projects[P].decisions[0];
 assert.equal(d.source,'playbook');assert.equal(d.wouldExecute,false,'forced false even if a stored entry said otherwise');assert.equal(d.firstWouldExecuteAt,null);
 assert.equal(d.play.caseRefs.length,5);assert.equal(d.rev,'v1:abcd1234');
 assert.equal(view.totals.decisions.enviaria+view.totals.decisions.pediria,0);
});

test('Missing sources are N/D (null), never zeros',()=>{
 const view=buildDeepView({base:baseOf(),project:P,now:NOW,shadowStatus:null});
 const p=view.projects[P];
 assert.equal(view.memory,null);assert.equal(view.playbookStatus,null);assert.equal(view.learningStatus,null);assert.equal(view.totals.agreement,null);
 assert.equal(p.team,null);assert.equal(p.playbook,null);assert.equal(p.score.lead14d,null);assert.deepEqual(p.score.blindSpots,[]);
 assert.deepEqual(Object.keys(p.score.rules).sort(),Object.keys(shadowLib.shadowRules).sort(),'all six fixed rules');
 for(const r of Object.values(p.score.rules)){assert.equal(r.graded,0);assert.equal(r.accuracy,null);assert.equal(r.low,null);assert.equal(r.base,null);assert.equal(r.chanceBetter,null);assert.equal(r.rev,null);}
 assert.equal(p.score.rules['bad-day-reduce'].stage,'pode-enviar','gate proven by the 7-day count');
 assert.equal(p.score.rules['night-increase'].stage,'sombra');
 assert.equal(p.pilot,null);assert.equal(p.level.limits.ordersPerDay,2);assert.equal(p.level.limits.maxIncreasePct,null);
 // With only the Sombra memory: memory depth is known, people figures are not.
 const withMemory=buildDeepView({base:baseOf(),project:'all',now:NOW,learningSummary:{ruleVersion:2,memory:{days:12,from:'2026-10-30'},current:{}}});
 assert.deepEqual(withMemory.memory,{days:12,from:'2026-10-30',peopleMoves:[],excluded:{total:0,byReason:{}},quarantined:0,backfill:{}});
 assert.equal(withMemory.playbookStatus,null);
 // An Agreement with no matched moves has every rate null.
 const pv={v:1,at:iso(NOW),playbook:{fitAt:null,state:'observando',plays:[{id:'pb:test-pause',key:'pb:test-pause@'+P,rev:'v1:x',stage:'observando',sentence:'s',agreement:{precision:0,recall:0,n:0},support:{moves:3}}],divergences:[]},people:[{person:'owner',name:'Você',agreement:{precision:0.7,n:0}}]};
 const v2=buildDeepView({base:baseOf(),project:P,now:NOW,pbViews:{[P]:pv},learningSummary:{ruleVersion:2,team:{projects:{[P]:{people:[{name:'Você',actions:3,pause:1,reduce:1,increase:1,activate:0,testPauses:{n:0,campaigns:0,median:null,p25:null,p75:null,beforePoint:0},budget:{graded:0,right:0,accuracy:null,low:null,high:null,medianUp:null,medianDown:null}}],lead:{cuts:0,ahead:0,share:null,medianLeadMin:null,previous:{cuts:0,ahead:0,share:null},daily:[]}}},proposals:[]}}});
 const play=v2.projects[P].playbook.plays[0];
 assert.deepEqual([play.agreement.precision,play.agreement.recall,play.agreement.n],[null,null,0]);
 assert.equal(play.adoptable,false);assert.equal(play.adoptHint,'chega na próxima fase');
 const person=v2.projects[P].team.people[0];
 assert.deepEqual([person.person,person.role,person.hours,person.agreement.precision],['owner','owner',null,null]);
});

test('Caps per project and for "all", newest first, with truncation counters',()=>{
 const s=state();s.snapshots[0].rows=Array.from({length:100},(_,i)=>row('k'+i,'Camp '+i,m(1000-i)));
 const base=buildDeepBase({state:s,liveItems:[],accuracy:{},policy:{},now:NOW});
 assert.equal(base.projects[P].now.length,80);assert.equal(base.truncated['now.campaigns'],20);
 const entries=Array.from({length:200},(_,i)=>entry('k'+i,{firstAt:iso(NOW-i*60000),lastAt:iso(NOW-30000)}));
 const plays=Array.from({length:15},(_,i)=>({id:'pb:'+i,key:'pb:'+i+'@'+P,rev:'v1:'+i,stage:i%2?'candidata':'sombra',sentence:'s'+i,support:{moves:i}}));
 const one=buildDeepView({base,project:P,now:NOW,shadowStatus:{at:iso(NOW-60000),days:{[P]:DAY}},shadowEntries:entries,pbViews:{[P]:{playbook:{plays,divergences:[]},people:[]}}});
 assert.equal(one.projects[P].decisions.length,150);assert.equal(one.truncated.decisions,50);
 assert.equal(one.projects[P].now.campaigns.length,80);assert.equal(one.projects[P].playbook.plays.length,12);assert.equal(one.truncated.plays,3);
 assert.ok(one.projects[P].playbook.plays.every(p=>['observando','candidata'].includes(p.stage)),'Phase 1 stages only');
 const order=one.projects[P].decisions.map(d=>d.status==='enviaria'||d.status==='pediria'?1:0);
 assert.deepEqual(order,[...order].sort((a,b)=>b-a),'enviaria/pediria rank first');
 const all=buildDeepView({base,project:'all',now:NOW,shadowStatus:{at:iso(NOW-60000),days:{[P]:DAY}},shadowEntries:entries,pbViews:{[P]:{playbook:{plays,divergences:[]},people:[]}}});
 assert.equal(all.projects[P].now.campaigns.length,20);assert.equal(all.projects[P].playbook.plays.length,6);
 assert.deepEqual(all.caps,{campaigns:20,decisions:150,done:50,plays:6,caseRefs:5,blindSpots:20,divergences:10,proposals:5,people:8});
 assert.ok(JSON.stringify(all).length<=deepViewPolicy.maxBytes);
 assert.equal(one.totals.decisions.enviaria+one.totals.decisions.segurada+one.totals.decisions['so-sugestao']+one.totals.decisions.pediria+one.totals.decisions.desligado,200,'totals count every decision of today');
});

test('The 400 KB ceiling shrinks in the fixed order, re-measuring after each step',()=>{
 const big=n=>'x'.repeat(n);
 const make=()=>({project:P,truncated:{},projects:{[P]:{
  decisions:Array.from({length:150},(_,i)=>({id:'d'+i,source:'rules',status:'so-sugestao',firstAt:iso(NOW-i*1000),limitations:[big(600)],play:{caseRefs:[{x:big(600)}]},reason:big(1500)})),
  now:{campaigns:Array.from({length:80},()=>({name:big(2500)}))},playbook:{plays:Array.from({length:12},()=>({sentence:big(20000)}))}}}});
 const out=shrinkDeepView(make());
 assert.deepEqual(Object.keys(out.truncated),['decisions.limitations','decisions.play.caseRefs','decisions','now.campaigns','plays'],'every step, in order');
 assert.equal(out.projects[P].decisions.length,100);assert.equal(out.projects[P].now.campaigns.length,40);assert.equal(out.projects[P].playbook.plays.length,6);
 assert.equal(out.truncated.decisions,50);
 const small=make();small.projects[P].decisions.forEach(d=>{d.reason='r';d.play.caseRefs=[];});small.projects[P].now.campaigns=[];small.projects[P].playbook.plays=[];
 const once=shrinkDeepView(small);
 assert.ok(!('decisions' in once.truncated),'stops as soon as it fits');
 const fits=make();fits.projects[P].decisions=[];fits.projects[P].now.campaigns=[];fits.projects[P].playbook.plays=[];
 assert.deepEqual(shrinkDeepView(fits).truncated,{},'nothing cut: {}');
});

test('Simulator rows are positional, 7 days of this project only, newest first and capped',()=>{
 const base=baseOf(),rows=Array.from({length:1600},(_,i)=>simRow(entry('k'+i,{firstWouldExecuteAt:i%3?iso(NOW-i*60000):null,grade:{verdict:'acertou',winnerCut:i===2}})));
 const sim=simRowsView({base,project:P,rows,now:NOW,shadowStatus:{days:{[P]:DAY}}});
 assert.deepEqual(sim.columns,[...simColumns]);assert.equal(sim.rows.length,1500);assert.equal(sim.truncated,100);
 assert.equal(sim.today,DAY);assert.deepEqual(sim.seedOrders,base.orders);assert.deepEqual(sim.saved,base.config);
 assert.equal(sim.rows[0][simColumns.indexOf('objectId')],'k1','newest would-execute first');
 assert.equal(simRow(entry('a',{blockedBy:['Só alerta: x']}))[simColumns.indexOf('alertOnly')],true);
});

// ── Executor (real Durable Object code, infrastructure replaced) ───────────────────────────────────────────────────
const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function executor(store={},{env={},runner={},malva=null}={}){
 const mods={'autonomy-deep-view':deep,'autonomy-grant':grantLib,'autonomy-shadow':shadowLib,'campaign-activity':activity,'change-attribution':attribution,'companion-summary':companion,'daily-series':dailySeries,
  'meta-display':metaDisplay,'shadow-learning':learning,'team-learning':team,'owner-order-live':ownerLive,'decision-contingency':contingency,'sales-feed':sales,'playbook-runner':runner,...(malva?{'cloud-malva':malva}:{})};
 const writes=[],sorted=()=>Object.keys(store).sort();
 const storage={get:async k=>Array.isArray(k)?new Map(k.filter(x=>x in store).map(x=>[x,store[x]])):store[k],
  list:async({prefix,limit,startAfter})=>{const keys=sorted().filter(k=>k.startsWith(prefix)&&(startAfter===undefined||k>startAfter));return new Map((limit?keys.slice(0,limit):keys).map(k=>[k,store[k]]));},
  put:async(k,v)=>{writes.push(typeof k==='object'?Object.keys(k):[k]);if(typeof k==='object')Object.assign(store,k);else store[k]=v;},delete:async keys=>{writes.push(['delete',...[].concat(keys)]);for(const k of [].concat(keys))delete store[k];},setAlarm:async()=>{},deleteAlarm:async()=>{}};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 const exports={};
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:Object.entries(mods).find(([k])=>name.endsWith('/'+k+'.mjs'))?.[1]||{},Date,Response,Intl,Map,Set,setInterval,clearInterval,setTimeout,clearTimeout,structuredClone,TextEncoder,crypto:globalThis.crypto,Promise,Object,Error});
 const e=new exports.BunkerCloudExecutor({storage},env);e.phoneAlerts=async()=>{};
 return {e,store,writes,control:async input=>{const r=await e.fetch(new Request('https://bunker-internal/control',{method:'POST',body:JSON.stringify(input)}));return {status:r.status,body:await r.json()};}};
}
const withNow=async(t,fn)=>{const real=Date.now;Date.now=()=>t;try{return await fn();}finally{Date.now=real;}};

test('The executor\'s deep and sim reads use only Durable Object keys: no central read, no write',async()=>{
 const base=baseOf(),store={autonomyDeepBase:base,shadowStatus:{at:iso(NOW-60000),day:DAY,days:{[P]:DAY}},autonomyLog:[],learningSummary:null,
  ['shadow:'+entry('c2').id]:entry('c2'),['shadow:'+entry('c1',{day:'2026-11-09',id:JSON.stringify(['2026-11-09','test-no-sale',P,'acc1','c1','status'])}).id]:entry('c1',{day:'2026-11-09',id:JSON.stringify(['2026-11-09','test-no-sale',P,'acc1','c1','status'])}),
  ['pbs:'+JSON.stringify([DAY,'pb:test-pause',P,'acc1','c2','status'])]:entry('c2',{id:JSON.stringify([DAY,'pb:test-pause',P,'acc1','c2','status']),source:'playbook',rule:'pb:test-pause'})};
 const {e,writes,control}=executor(store);
 const forbid=name=>()=>{throw Error('central read: '+name);};e.read=forbid('read');e.view=forbid('view');e.db=forbid('db');e.write=forbid('write');
 const lists=[];const realList=e.ctx.storage.list;e.ctx.storage.list=async o=>{lists.push(o.prefix);return realList(o);};
 const d=await withNow(NOW,()=>control({action:'autonomy',view:'deep',project:'all'}));
 assert.equal(d.status,200);
 assert.deepEqual(d.body.deep.projects[P].decisions.map(x=>[x.source,x.objectId]),[['rules','c2'],['playbook','c2']],'only today\'s entries, the would-send first');
 assert.deepEqual([...new Set(lists)].sort(),['pbs:["'+DAY+'"','shadow:["'+DAY+'"'],'lists only today\'s day prefixes');
 const s=await withNow(NOW,()=>control({action:'autonomy',view:'sim',project:P}));
 assert.equal(s.status,200);assert.equal(s.body.sim.rows.length,2,'7 days of shadow:*, this project');
 assert.deepEqual(writes,[],'no storage write in any read');
 assert.deepEqual((await control({action:'autonomy',view:'deep',project:'nope'})).body,{invalid:'Projeto não configurado no Bunker.'});
 assert.deepEqual((await control({action:'autonomy',view:'sim',project:'all'})).body,{invalid:'Escolha um projeto.'});
 assert.deepEqual((await executor({}).control({action:'autonomy',view:'deep',project:'all'})).body,{deep:null},'base not written yet');
 // The plain action is unchanged for current callers.
 const plain=await control({action:'autonomy'});
 assert.deepEqual(Object.keys(plain.body),['shadowProjects','shadowAt','status','log','asks']);
});

test('storeShadow: hook A runs after autonomyAct, writes the deep base, and a failing or missing runner changes nothing else',async()=>{
 const env={AUTONOMY_SHADOW_POLICY:JSON.stringify({projects:{[P]:{pauseTestMinSpend:100}}})};
 const s=state({mode:'shadow',orders:false});s.snapshots[0].rows.push(row('t1','10/11 - [TESTE] T',m(160,0,0),{deliveryStartedAt:iso(NOW-5*3600000)}));
 const run=async(runner,store={})=>{const x=executor(store,{env,runner});x.e.lastLearnAt=NOW;await withNow(NOW,()=>x.e.storeShadow(s,{learn:false}));return x;};
 const seen=[],okStore={};
 const ok=await run({playbookRunnerPolicy:{enabled:true,shadowBudgetMs:250},playbookStore:st=>({wrapped:st}),
  runPlaybookShadow:async(store,input,{deadline})=>{seen.push({autonomyFirst:!!okStore.autonomyStatus,shadowFirst:!!okStore.shadowStatus,baseAfter:!okStore.autonomyDeepBase,fixed:input.fixed,state:input.state===s,deadline,store:Object.keys(store)});return {ok:true};}},okStore);
 const none=await run({});
 const boom=await run({playbookRunnerPolicy:{enabled:true,shadowBudgetMs:250},playbookStore:()=>({}),runPlaybookShadow:async()=>{throw Error('bug');}});
 const off=await run({playbookRunnerPolicy:{enabled:false},playbookStore:()=>({}),runPlaybookShadow:async()=>{throw Error('must not run');}});
 assert.equal(seen.length,1);assert.equal(seen[0].state,true,'the same state object, never cloned');
 assert.deepEqual([seen[0].shadowFirst,seen[0].autonomyFirst,seen[0].baseAfter],[true,true,true],'after the Sombra and autonomyAct, before the deep base');
 assert.ok(Array.isArray(seen[0].fixed)&&seen[0].fixed.every(([l,d])=>Array.isArray(l)&&typeof d==='string'),'this pass\'s fixed decisions, as a copy');assert.deepEqual(seen[0].store,['wrapped'],'only the facade');
 assert.ok(seen[0].deadline>NOW&&seen[0].deadline<=NOW+250);
 const strip=st=>Object.fromEntries(Object.entries(st).filter(([k])=>k!=='pb:status'));
 for(const x of [none,boom,off]){
  assert.deepEqual(Object.keys(strip(x.store)).sort(),Object.keys(strip(ok.store)).sort());
  assert.deepEqual(x.store.shadowStatus.evaluated,ok.store.shadowStatus.evaluated);
  assert.deepEqual(JSON.parse(JSON.stringify(x.store.autonomyStatus)),JSON.parse(JSON.stringify(ok.store.autonomyStatus)));
 }
 assert.ok(ok.store.autonomyDeepBase?.projects?.[P],'deep base written');
 assert.deepEqual(Object.keys(boom.store['pb:status']).sort(),['at','code','ok','stage']);assert.equal(boom.store['pb:status'].code,'PLAYBOOK_HOOK_FAILED');assert.equal(boom.store['pb:status'].stage,'shadow');
 assert.equal(none.store['pb:status'],undefined,'no runner: nothing recorded');assert.equal(off.store['pb:status'],undefined,'kill switch: a no-op');
 assert.ok(Object.keys(ok.store).every(k=>!k.startsWith('pbs:')),'the executor itself never writes pbs:*');
});

test('Hook C: only two tracking_ad_changes reads reach Malva, on the pulse\'s own listing',async()=>{
 const calls=[];const malva={cloudMalvaClient:()=>({read:async(tool,args)=>{calls.push(tool);return {items:[]};}})};
 const runner={playbookRunnerPolicy:{enabled:true,backfillBudgetMs:8000},playbookStore:()=>({}),runPlaybookBackfill:async(store,source,input)=>{
  const got=[];for(const tool of ['tracking_ad_changes','tracking_campaigns','tracking_ad_changes','tracking_ad_changes'])got.push(await source.read(tool,{projectId:'x'}).then(()=>'ok',e=>e.code));
  input.got=got;runner.input=input;return {ok:true};}};
 const {e,store}=executor({runtime:{enabled:true}},{runner,malva});e.db=()=>({});
 await e.playbookBackfill(state());
 assert.equal(runner.input,undefined,'no listing this pulse: skipped');
 e.attrListed={items:[{id:P,name:'Fictício',timezone:'America/Sao_Paulo'},{id:'other',name:'Outro'}]};
 await e.playbookBackfill(state());
 assert.deepEqual(runner.input.got,['ok','PLAYBOOK_SOURCE_DENIED','ok','PLAYBOOK_SOURCE_DENIED']);
 assert.deepEqual(calls,['tracking_ad_changes','tracking_ad_changes'],'at most 2 pages, never another tool');
 assert.deepEqual(JSON.parse(JSON.stringify(runner.input.projects)),[{id:P,name:'Fictício',timezone:'America/Sao_Paulo'}],'configured ∩ listed, by id and name');
 assert.equal(e.attrListed,null,'the listing is used once');
 store.runtime={enabled:false};e.attrListed={items:[]};runner.input=undefined;await e.playbookBackfill(state());
 assert.equal(runner.input,undefined,'executor paused: no backfill');
});

test('Static: hooks sit after autonomyAct, batches is never appended after the loop, and every hook is guarded',()=>{
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 const body=src.slice(src.indexOf(' private async storeShadow(state:any,opts'),src.indexOf(' private async ownerNames('));
 const act=body.indexOf('await this.autonomyAct('),hook=body.indexOf('await this.playbookShadow('),baseAt=body.indexOf('await this.storeDeepBase('),guard=body.indexOf('if(opts.learn===false');
 assert.ok(act>0&&hook>act&&baseAt>hook&&guard>baseAt,'order: autonomyAct → hook A → deep base → learning guard');
 const loopEnd=body.indexOf('batches.push(');
 assert.equal(body.slice(loopEnd+1).includes('batches.push('),false,'batches is only built inside the per-project loop');
 const learn=src.slice(src.indexOf(' private async storeLearning('),src.indexOf(' private async storeFirst24h('));
 assert.ok(learn.indexOf('await this.playbookLearning(')>learn.indexOf("learningDirty:new Date(now).toISOString()});")&&learn.indexOf('await this.playbookLearning(')<learn.indexOf('const prev=await'),'hook B after the shard writes, before the summary early return');
 for(const m of ['playbookShadow','playbookLearning','playbookBackfill','storeDeepBase','companionAutonomy']){
  const i=src.indexOf(' private async '+m+'('),b=src.slice(i,src.indexOf('\n }\n',i));
  assert.match(b,/try\{/,m+' is wrapped');assert.match(b,/\}catch\{/,m+' swallows its failure');
  assert.doesNotMatch(b,/this\.(read|view|write)\(|commitPersistedState|this\.autonomyAct\(|recordAutonomyOrder|autonomyGrant\(/,m+' never reads/writes the central or reaches the grant');
 }
 const read=src.slice(src.indexOf(' private async autonomyRead('),src.indexOf(' private async companionAutonomy('));
 assert.doesNotMatch(read,/this\.(read|view|write|db)\(|readPersistedState|storage\.(put|delete)/,'the deep read never touches the central or writes');
 assert.match(src,/if\(liveState&&\(await this\.setting\(\)\)\.enabled\)await this\.playbookBackfill\(liveState\)\.catch\(\(\)=>\{\}\);/);
});

// ── Route ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function route(answer){
 const calls=[],src=ts.transpileModule(fs.readFileSync(new URL('../app/api/autonomy/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
 vm.runInNewContext(src,{exports,require:name=>name==='@/lib/executor-control'?{executorControl:async input=>{calls.push(input);if(answer instanceof Error)throw answer;return typeof answer==='function'?answer(input):answer;}}:{},Response,URL});
 const get=async(qs,headers={'oai-authenticated-user-id':'owner'})=>{const r=await exports.GET(new Request('https://x/api/autonomy'+qs,{headers}));return {status:r.status,cache:r.headers.get('cache-control'),body:r.status===401?null:await r.json()};};
 return {get,calls,exports};
}
test('Route: owner only, the notch credential refused, validated, private no-store, plain call unchanged',async()=>{
 const r=await route(input=>input.view==='deep'?{deep:{v:1,project:input.project}}:input.view==='sim'?{sim:{v:1}}:{shadowProjects:null,shadowAt:null,status:null,log:[]});
 assert.equal((await r.get('?view=deep&project=all',{})).status,401);
 const companion=await r.get('?view=deep&project=all',{'oai-authenticated-user-id':'owner','x-bunker-companion':'read'});
 assert.deepEqual([companion.status,companion.body.error],[403,'Somente na sessão do dono.']);
 assert.equal((await r.get('?view=sim&project=p1',{'oai-authenticated-user-id':'owner','x-bunker-companion':'owner'})).status,403);
 assert.deepEqual((await r.get('?view=x&project=all')).body,{error:'Visão desconhecida.'});
 assert.equal((await r.get('?view=deep')).status,400);assert.equal((await r.get('?view=deep&project='+'a'.repeat(81))).status,400);
 assert.deepEqual((await r.get('?view=sim&project=all')).body,{error:'Escolha um projeto.'});
 const ok=await r.get('?view=deep&project=p1');assert.deepEqual([ok.status,ok.cache,ok.body],[200,'private, no-store',{v:1,project:'p1'}]);
 assert.deepEqual((await r.get('?view=sim&project=p1')).body,{v:1});
 const plain=await r.get('');assert.deepEqual([plain.status,plain.cache,plain.body],[200,'private, no-store',{shadowProjects:null,shadowAt:null,status:null,log:[]}]);
 assert.deepEqual(JSON.parse(JSON.stringify(r.calls.at(-1))),{action:'autonomy'},'the plain call sends exactly what it did before');
 assert.deepEqual(JSON.parse(JSON.stringify(r.calls.filter(c=>c.view))).map(c=>[c.view,c.project]),[['deep','p1'],['sim','p1']]);
 assert.equal((await (await route({invalid:'Projeto não configurado no Bunker.'})).get('?view=deep&project=zz')).status,400);
 const preparing=await (await route({deep:null})).get('?view=deep&project=all');
 assert.deepEqual([preparing.status,preparing.body.error],[503,'Leitura da autonomia em preparação pelo executor. Tente em 1 a 2 minutos.']);
 const down=await (await route(Error('x'))).get('?view=deep&project=all');assert.deepEqual([down.status,down.body.error],[503,'Executor da nuvem indisponível.']);
 assert.deepEqual(Object.keys(r.exports).filter(k=>/^(POST|PUT|PATCH|DELETE)$/.test(k)),[],'GET only');
});
