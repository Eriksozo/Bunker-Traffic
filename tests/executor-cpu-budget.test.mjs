import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Owner report of 10/11/2026 ("bunk não conseguiu ler nada"): the executor object was reset several times an hour for
// exceeding its CPU limit, and the notch read 503s. Between pulses the Sombra stays on every reading; the long memory not.
const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
const vite=fs.readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');

test('Between-pulse shadow runs skip the long memory unless it is older than the interval; the heavy pulse always learns',()=>{
 assert.match(src,/this\.queueShadow\(state,\{learn:false\}\)/,'freshShadow asks for a light run');
 assert.match(src,/await this\.queueShadow\(liveState\)\.catch/,'heavy pulse: full run');
 const body=src.slice(src.indexOf(' private async storeShadow(state:any,opts'),src.indexOf(' private async ownerNames('));
 const guard=body.indexOf('if(opts.learn===false&&now-this.lastLearnAt<BunkerCloudExecutor.betweenPulseLearnMs)return merged;');
 assert.ok(guard>0,'guard present');
 assert.ok(guard>body.indexOf("put('shadowStatus'")&&guard>body.indexOf('this.autonomyAct('),'decisions, status and autonomy still run every reading');
 assert.ok(guard<body.indexOf('this.storeLearning('),'only the memory is skipped');
 assert.match(src,/betweenPulseLearnMs=5\*60000/);
});

test('The Cloudflare build declares the Standard plan CPU ceiling',()=>{
 assert.match(vite,/limits:\{cpu_ms:300000\}/);
});

// ── Modo Gestor read model and hooks (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, a.6 and c.6): bounded CPU on a large,
// 60-day synthetic fixture (6 projects × 80 active campaigns, 3000 Sombra entries, 60 days of Bunk orders). ──
import * as deepMg from '../lib/autonomy-deep-view.mjs';
import {simulateGrant} from '../lib/autonomy-simulate.mjs';
const CNOW=Date.parse('2026-11-10T15:00:00Z'),cIso=ms=>new Date(ms).toISOString(),CDAY='2026-11-10';
const cRow=(p,i,spend)=>({id:'uuid-'+p+i,externalId:p+'c'+i,adAccountId:'acc-'+p,accountName:'Conta '+p,name:(i%5?'Escala ':'0'+(1+i%9)+'/11 - [TESTE] ')+i,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},
 dailyBudget:100+i,budgetCurrency:i%7?'BRL':'USD',budgetRate:i%7?1:5,spend,revenue:spend*1.4,revenueNet:spend*1.3,adCosts:0,productCost:0,saleTax:0,frontOrders:i%3,orders:i%3,checkouts:i%4,impressions:1000+i,linkClicks:20+i});
function cpuFixture(){
 const projects=Array.from({length:6},(_,i)=>'p'+i),config={},snapshots=[],proposals=[],executions=[],entries=[];
 for(const p of projects){
  config[p]={projectName:'Projeto '+p,dailyCap:null};
  const rows=n=>Array.from({length:80},(_,i)=>cRow(p,i,n*(i+1)));
  const cut=(period,from,mult)=>({projectId:p,projectName:'Projeto '+p,level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true,period,from,to:cIso(Date.parse(from)+86400000),fetchedAt:cIso(CNOW-300000),lastSyncAt:cIso(CNOW-360000),rows:rows(mult)});
  snapshots.push(cut('today','2026-11-10T03:00:00.000Z',2),cut('yesterday','2026-11-09T03:00:00.000Z',5),cut('3d','2026-11-07T03:00:00.000Z',15),cut('7d','2026-11-03T03:00:00.000Z',35));
  for(let d=0;d<60;d++)for(let k=0;k<2;k++){const id=p+'-o'+d+'-'+k,at=CNOW-d*86400000-k*3*3600000;
   proposals.push({id,project:p,autonomyOrder:true,createdBy:'bunk',createdAt:cIso(at),approvedAt:cIso(at),status:'Aprovada',payload:{adAccountId:'acc-'+p,objectId:p+'c'+(d%80),shadowId:'s'+id,action:'budget',before:{dailyBudget:200},after:{dailyBudget:160},objectName:'Escala',rule:'bad-day-reduce'}});
   executions.push({id:'e'+id,proposalId:id,status:'Confirmada',claimedAt:cIso(at+60000),preparedAt:cIso(at+120000),submittedAt:cIso(at+180000),confirmedAt:cIso(at+240000),monitorChecks:[{checkpointMinutes:15,recordedAt:cIso(at+16*60000),status:'Observado',delta:{spend:3,result:1}}]});}
 }
 const rules=Object.keys({'test-no-sale':1,'new-sale-loss':1,'bad-day-reduce':1,'no-delivery':1,'morning-increase':1,'night-increase':1});
 for(let i=0;i<3000;i++){const p=projects[i%6],day=new Date(CNOW-Math.floor(i/430)*86400000).toISOString().slice(0,10),rule=rules[i%6],obj=p+'c'+(i%80);
  entries.push({id:JSON.stringify([day,rule,p,'acc-'+p,obj,i%2?'status':'budget']),day,rule,ruleLabel:'r',project:p,projectName:'Projeto '+p,adAccountId:'acc-'+p,accountName:'Conta',objectId:obj,name:'Escala '+i,action:i%2?'status':'budget',
   before:i%2?{status:'ACTIVE'}:{dailyBudget:200,currency:'BRL'},after:i%2?{status:'PAUSED'}:{dailyBudget:160,currency:'BRL'},reason:'Motivo '.repeat(10),blockedBy:i%3?[]:['Só sugestão até o placar'],limitations:['a','b'],wouldExecute:!!(i%3),
   firstAt:cIso(CNOW-i*60000),lastAt:cIso(CNOW-30000),firstWouldExecuteAt:i%3?cIso(CNOW-i*60000):null,ruleVersion:2,metrics:{spend:100,frontOrders:0,orders:0,revenueNet:0,checkouts:1,roi:0.5,roas:0.5,cpc:2,recentRoi:1},grade:i%4?{verdict:'acertou',basis:'next',next:{spend:50,result:-5,roi:0.8}}:null});}
 const tallyOf=()=>({graded:40,right:25,accuracy:0.625,low:0.47,high:0.76,base:{graded:30,accuracy:0.6,expected:0.4,edge:0.2,chanceBetter:0.95,campaigns:10,days:5},recent:{graded:20,accuracy:0.6},previous:{graded:20,accuracy:0.65},winnersCut:2});
 const learningSummary={version:2,ruleVersion:2,at:cIso(CNOW-60000),memory:{days:60,from:'2026-09-11'},current:Object.fromEntries(rules.map(r=>[r,{...tallyOf(),projects:Object.fromEntries(projects.map(p=>[p,tallyOf()]))}])),
  blindSpots:{recent:Array.from({length:10},(_,i)=>({day:CDAY,project:projects[i%6],kind:'pause',by:'manager',at:cIso(CNOW-i*60000),adAccountId:'a',objectId:'o'}))},
  team:{all:{people:[],lead:null},projects:Object.fromEntries(projects.map(p=>[p,{people:Array.from({length:4},(_,i)=>({name:'Pessoa '+i,actions:30,pause:10,reduce:10,increase:10,activate:0,testPauses:{n:5,campaigns:4,median:100,p25:80,p75:120,beforePoint:2},budget:{graded:10,right:6,accuracy:0.6,low:0.3,high:0.8,medianUp:0.3,medianDown:-0.2},hours:Array(24).fill(1)})),
   lead:{cuts:10,ahead:4,share:0.4,medianLeadMin:30,previous:{cuts:8,ahead:2,share:0.25},daily:Array.from({length:14},(_,i)=>({day:CDAY,cuts:1,ahead:i%2}))}}])),proposals:[]}};
 const pbViews=Object.fromEntries(projects.map(p=>[p,{v:1,at:cIso(CNOW),playbook:{fitAt:cIso(CNOW),state:'com-candidatas',plays:Array.from({length:12},(_,i)=>({id:'pb:t'+i,key:'pb:t'+i+'@'+p,rev:'v1:'+i,stage:i%2?'candidata':'observando',sentence:'Jogada '+i,params:{k:1},step:{median:0.3,p25:0.2,p75:0.4},
  learnedFrom:[{person:'p:a',name:'Ana',n:9,params:{k:1}}],support:{moves:8+i,campaigns:5,days:4},agreement:{precision:0.7,recall:0.5,leadMin:20,opposite:0.1,low:0.5,high:0.85,n:20},outcome:{d1:{rate:0.6,n:10,low:0.3,high:0.8},d3:null,base:0.4},flags:[],caseRefs:Array.from({length:5},()=>({day:CDAY,adAccountId:'a',objectId:'o',person:'p:a',name:'Ana',kind:'pause',at:cIso(CNOW),step:null}))})),divergences:[]},
  people:[{person:'owner',name:'Você',agreement:{precision:0.8,n:12}}],scorePlays:{}}]));
 return {state:{config,paused:false,autonomy:{version:1,enabled:true,projects:Object.fromEntries(projects.map(p=>[p,{mode:'auto',actions:{pause:true,reduce:true,increase:true,activate:false},limits:{maxIncreasePct:50,maxReducePct:30,budgetCap:1000,ordersPerDay:2},campaigns:{}}]))},snapshots,proposals,executions},entries,learningSummary,pbViews,projects};
}
const cpu=fn=>{const a=process.cpuUsage();const out=fn();const b=process.cpuUsage(a);return {ms:(b.user+b.system)/1000,out};};

test('Modo Gestor read model: base, deep view, notch block and simulator stay within their CPU and size budgets',()=>{
 const f=cpuFixture(),accuracy={'bad-day-reduce':{graded:22,right:16,accuracy:16/22,source:'7d'}};
 // Warm-up (JIT) outside the measurement, as in a long-lived isolate.
 deepMg.buildDeepBase({state:f.state,liveItems:[],accuracy,policy:{},now:CNOW});
 const b=cpu(()=>deepMg.buildDeepBase({state:f.state,liveItems:[],accuracy,policy:{},now:CNOW})),base=b.out;
 assert.ok(b.ms<300,'deep base '+b.ms+' ms');
 assert.ok(new TextEncoder().encode(JSON.stringify(base)).length<=256000,'base ≤ 256 KB');
 assert.ok(base.orders.length<=400&&Object.values(base.projects).every(p=>p.done.length<=50&&p.now.length<=80));
 const today=f.entries.filter(e=>e.day===CDAY),status={at:cIso(CNOW-60000),day:CDAY,days:Object.fromEntries(f.projects.map(p=>[p,CDAY]))};
 const input=project=>({base,project,now:CNOW,shadowStatus:status,autonomyLog:[],learningSummary:f.learningSummary,pbView:{memory:{days:60,from:'2026-09-11',peopleMoves:[],excluded:{total:3,byReason:{bunk:3}},quarantined:1,backfill:{}},agreement:{precision:0.7,n:30}},pbViews:f.pbViews,shadowEntries:today,pbsEntries:[]});
 deepMg.buildDeepView(input('all'));
 for(const project of ['all','p0']){
  const v=cpu(()=>deepMg.buildDeepView(input(project)));
  assert.ok(v.ms<300,'deep view '+project+' '+v.ms+' ms');
  assert.ok(new TextEncoder().encode(JSON.stringify(v.out)).length<=400000,'deep view ≤ 400 KB');
 }
 const c=cpu(()=>['all',...f.projects].map(project=>deepMg.autonomyCompanion({base,project,now:CNOW,pbViews:f.pbViews,entries:f.entries,days:status.days,shadowAt:status.at})));
 assert.ok(c.ms<200,'notch blocks '+c.ms+' ms');
 assert.ok(c.out.every(x=>new TextEncoder().encode(JSON.stringify(x)).length<=6000),'every block ≤ 6 KB');
 const s=cpu(()=>{const rows=f.entries.filter(e=>e.project==='p0').map(deepMg.simRow);const sim=deepMg.simRowsView({base,project:'p0',rows,now:CNOW,shadowStatus:status});
  return simulateGrant(sim,{enabled:true,projects:{p0:{mode:'auto',actions:{pause:true,reduce:true,increase:true,activate:false},limits:{maxIncreasePct:50,maxReducePct:30,budgetCap:1000,ordersPerDay:2}}}},{now:CNOW,projectIds:f.projects});});
 assert.equal(s.out.ok,true);assert.ok(s.ms<300,'simulator '+s.ms+' ms');
});

test('Modo Gestor hooks: bounded by the runner policy, guarded, and never in the Sombra\'s or autonomy\'s path',()=>{
 for(const [m,budget] of [['playbookShadow','shadowBudgetMs'],['playbookLearning','learnBudgetMs'],['playbookBackfill','backfillBudgetMs']]){
  const i=src.indexOf(' private async '+m+'('),body=src.slice(i,src.indexOf('\n }\n',i));
  assert.ok(i>0,m);assert.match(body,new RegExp('deadline:Date\\.now\\(\\)\\+r\\.playbookRunnerPolicy\\.'+budget),m+' passes its own time budget');
  assert.match(body,/^\s*try\{/m,m+' is wrapped');
 }
 assert.match(src,/private async storeDeepBase[\s\S]*?if\(this\.deepBaseSig&&now-this\.deepBaseAt<deepViewPolicy\.baseEveryMs\)return;/,'the deep base is built at most once a minute');
 assert.doesNotMatch(src,/structuredClone\(state\)\);?\s*\/\/ ?Modo Gestor|JSON\.parse\(JSON\.stringify\(state\)\)/,'the state is never cloned for the read model');
});

test('Modo Gestor hooks with the real runner on the 60-day fixture',async()=>{
 const r=await import('../lib/playbook-runner.mjs'),f=cpuFixture(),store=new Map();
 const storage={get:async k=>Array.isArray(k)?new Map(k.filter(x=>store.has(x)).map(x=>[x,store.get(x)])):store.get(k),put:async(k,v)=>{if(typeof k==='object')for(const [a,b] of Object.entries(k))store.set(a,b);else store.set(k,v);},
  delete:async keys=>{let n=0;for(const k of [].concat(keys))n+=store.delete(k)?1:0;return n;},list:async({prefix,limit,startAfter,start,end})=>new Map([...store.keys()].sort().filter(k=>k.startsWith(prefix)&&(!startAfter||k>startAfter)&&(!start||k>=start)&&(!end||k<end)).slice(0,limit).map(k=>[k,store.get(k)]))};
 const facade=r.playbookStore(storage),projects=f.projects.map(p=>({project:p,params:{},day:CDAY}));
 const a=process.cpuUsage(),A=await r.runPlaybookShadow(facade,{state:f.state,liveItems:[],events:[],meta:null,now:CNOW,projects,fixed:[]},{deadline:Date.now()+r.playbookRunnerPolicy.shadowBudgetMs}),aMs=(process.cpuUsage(a).user)/1000;
 assert.equal(typeof A?.ok,'boolean','hook A returns, never throws');assert.ok(aMs<500,'hook A '+aMs+' ms');
 const b=process.cpuUsage(),B=await r.runPlaybookLearning(facade,{state:f.state,now:CNOW,team:[],teamKeys:[],bases:[],coverage:{},ownerNames:[],zone:()=>'America/Sao_Paulo',projects:f.projects,names:{}},{deadline:Date.now()+r.playbookRunnerPolicy.learnBudgetMs}),bMs=(process.cpuUsage(b).user)/1000;
 assert.equal(typeof B?.ok,'boolean','hook B returns, never throws');assert.ok(bMs<3000,'hook B '+bMs+' ms');
 for(const k of store.keys())assert.ok(k.startsWith('pb:')||k.startsWith('pbs:'),'runner writes only pb:/pbs: keys: '+k);
 for(const k of store.keys())if(k.startsWith('pbs:'))assert.equal(store.get(k).wouldExecute,false);
});

// ── Modo Gestor hook B under real load: 6 projects × 60 full daily bins × 80 campaigns (≈77 KB each, built by the real
// pipeline), the fit cycle to its end and replay passes. Live heap at every storage call (after a forced gc) and CPU
// per pass are bounded: bins are streamed a few at a time and never decoded all at once. ──
import v8 from 'node:v8';
import vm from 'node:vm';
import {syntheticDays,memoryStorage} from './helpers/playbook-fixtures.mjs';
test('Modo Gestor hook B with 60 full bins per project: bounded live heap and CPU per pass, the fit cycle completes',async()=>{
 v8.setFlagsFromString('--expose_gc');const gc=vm.runInNewContext('gc');
 const r=await import('../lib/playbook-runner.mjs'),projects=Array.from({length:6},(_,i)=>'p'+i),today='2026-11-10',now=Date.parse('2026-11-10T15:00:00Z');
 const {bins}=syntheticDays({project:'p0',from:'2026-09-11',days:60,campaigns:80});
 const initial={};for(const p of projects)for(const b of bins)initial[`pb:bins:${b.day}:${p}`]={...b,project:p};
 const mem=memoryStorage(initial);let baseline=0,peak=0,measuring=false;
 const probe=()=>{if(!measuring)return;gc();peak=Math.max(peak,process.memoryUsage().heapUsed-baseline);};
 // Every read is a deserialized copy, as in a Durable Object; heap is sampled before each storage call.
 const storage={get:async k=>{probe();return mem.get(k);},put:async(a,b)=>{probe();return mem.put(a,b);},delete:async k=>{probe();return mem.delete(k);},list:async o=>{probe();return mem.list(o);}};
 const facade=r.playbookStore(storage),state={config:Object.fromEntries(projects.map(p=>[p,{projectName:'Projeto '+p}])),snapshots:[],autonomy:null};
 const input=at=>({state,now:at,team:[],teamKeys:[],bases:[],coverage:{},ownerNames:[],zone:()=>'America/Sao_Paulo',projects,names:{},heavy:true});
 const pass=async at=>{gc();baseline=process.memoryUsage().heapUsed;measuring=true;const c=process.cpuUsage();const out=await r.runPlaybookLearning(facade,input(at),{deadline:Date.now()+600000});const u=process.cpuUsage(c);measuring=false;return {out,ms:(u.user+u.system)/1000};};
 let fitDone=false,maxMs=0,replays=0,passes=0;
 for(let i=0;i<60&&(!fitDone||replays<6);i++){
  const {out,ms}=await pass(now+i*60000);passes++;
  assert.equal(out.ok,true,JSON.stringify(out));maxMs=Math.max(maxMs,ms);
  if(out.replayed)replays++;
  if(!fitDone&&(await mem.get('pb:model'))?.fitAt)fitDone=true;
 }
 assert.ok(fitDone,'the fit cycle (36 groups, 2 per pass) completes');assert.ok(replays>=6,'then one replay day per pass');
 assert.ok(peak<15*1024*1024,'live heap above baseline at the runner\'s storage calls: '+Math.round(peak/1048576)+' MB');
 assert.ok(maxMs<1500,'CPU per pass '+Math.round(maxMs)+' ms');
 const model=await mem.get('pb:model');assert.ok(Object.keys(model.plays).length>=6,'plays fitted for the projects');
 assert.ok(new TextEncoder().encode(JSON.stringify(await mem.get('pb:cursor'))).length<20000,'the cursor stays small (fits live in pb:fits:<p>)');
 // Between pulses (heavy:false) nothing heavy runs: no bin is read for fitting or replay.
 const before=mem.calls.get;const light=await r.runPlaybookLearning(facade,{...input(now+3600000),heavy:false},{deadline:Date.now()+600000});
 assert.equal(light.ok,true);assert.equal(light.fitted,false);assert.equal(light.replayed,false);assert.ok(mem.calls.get-before<40,'a light pass reads only small keys: '+(mem.calls.get-before));
});
