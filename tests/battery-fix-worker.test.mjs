import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as shadowLib from '../lib/autonomy-shadow.mjs';
import * as activity from '../lib/campaign-activity.mjs';
import * as attribution from '../lib/change-attribution.mjs';
import * as companion from '../lib/companion-summary.mjs';
import * as metaDisplay from '../lib/meta-display.mjs';
import {evaluateDay} from '../scripts/suggestion-backtest.mjs';
// Battery fixes of the worker group. Synthetic fixtures only: invented projects, accounts, campaigns and amounts.
const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules={'autonomy-shadow':shadowLib,'campaign-activity':activity,'change-attribution':attribution,'companion-summary':companion,'meta-display':metaDisplay};
function executor(store={},env={}){
 const exports={};
 const storage={get:async k=>store[k],list:async({prefix})=>new Map(Object.entries(store).filter(([k])=>k.startsWith(prefix))),put:async(k,v)=>{if(typeof k==='object')Object.assign(store,k);else store[k]=v;},delete:async keys=>{for(const k of [].concat(keys))delete store[k];},setAlarm:async()=>{}};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:Object.entries(modules).find(([k])=>name.includes(k))?.[1]||{},Date,Response,Intl,setInterval,clearInterval});
 const e=new exports.BunkerCloudExecutor({storage},env);e.phoneAlerts=async()=>{};
 return {e,store,control:async input=>(await e.fetch(new Request('https://bunker-internal/control',{method:'POST',body:JSON.stringify(input)}))).json()};
}
const withNow=async(t,fn)=>{const real=Date.now;Date.now=()=>t;try{return await fn();}finally{Date.now=real;}};
const iso=ms=>new Date(ms).toISOString();
const base={projectName:'Fictício',level:'campaign',source:'Malva MCP',complete:true};
const m=(spend,revenueNet=0,orders=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:orders,orders,checkouts:0,impressions:spend>0?1000:0,linkClicks:spend>0?20:0});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc-x',accountName:'Conta X',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,...metrics,...extra});
const todaySnap=(pid,tz,dayStartZ,now,rows,{age=300000}={})=>({...base,projectId:pid,timezone:tz,period:'today',from:iso(dayStartZ),to:iso(dayStartZ+86400000),fetchedAt:iso(now-age),lastSyncAt:iso(now-age-60000),rows});
const closedSnaps=(pid,tz,dayStartZ,now)=>['7d','3d','yesterday'].map(p=>({...base,projectId:pid,timezone:tz,period:p,from:iso(dayStartZ-(p==='7d'?7:p==='3d'?3:1)*86400000),to:iso(dayStartZ),fetchedAt:iso(now-600000),lastSyncAt:iso(now-700000),rows:[]}));
const entry=(day,id,firstAt,extra={})=>({id,day,rule:'test-no-sale',ruleLabel:shadowLib.shadowRules['test-no-sale'],project:'p',projectName:'Fictício',adAccountId:'acc-x',accountName:'Conta X',objectId:id,name:'01/11 - [TESTE] '+id,action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',blockedBy:[],limitations:['l'],wouldExecute:true,firstAt,lastAt:firstAt,firstWouldExecuteAt:firstAt,seen:1,manager:null,...extra});

test('finding 6/45: a pulse where every project is skipped keeps "hoje" on the local day, not the 7 retained days',async()=>{
 const now=Date.parse('2026-11-09T17:00:00Z'),dayZ=Date.parse('2026-11-09T03:00:00Z'),store={};
 for(let i=0;i<5;i++){const d=`2026-11-0${5+i}`;store['shadow:o'+i]=entry(d,'o'+i,`${d}T15:00:00.000Z`);}
 const state={config:{p:{projectName:'Fictício'}},snapshots:[todaySnap('p','America/Sao_Paulo',dayZ,now,[],{age:3600000}),...closedSnaps('p','America/Sao_Paulo',dayZ,now)]};
 const {e,control}=executor(store,{AUTONOMY_SHADOW_POLICY:JSON.stringify({projects:{p:{}}})});
 const merged=await withNow(now,()=>e.storeShadow(state));
 assert.ok(store.shadowStatus.skipped.p,'control: the stale source skipped the project');
 assert.equal(store.shadowStatus.day,'2026-11-09','no evaluated project still records the local day');
 await withNow(now,()=>e.storeCompanion(state,merged));
 const s=store['companion:all'].shadow;
 assert.equal(s.day,'2026-11-09');assert.equal(s.total,1,'only today\'s decision is "hoje"');
 const read=await withNow(now,()=>control({action:'shadow'}));
 assert.equal(read.entries.length,1);assert.equal(read.summary.total,1);
});

test('finding 6: after a failed shadow (status without a day) the notch summary is still filtered to today',async()=>{
 const now=Date.parse('2026-11-09T17:00:00Z'),store={shadowStatus:{at:iso(now),failed:true,code:'SHADOW_FAILED'}};
 const list=[entry('2026-11-08','a','2026-11-08T15:00:00.000Z'),entry('2026-11-09','b','2026-11-09T15:00:00.000Z')];
 const {e}=executor(store);
 await withNow(now,()=>e.storeCompanion({config:{p:{projectName:'Fictício'}},snapshots:[]},list));
 assert.equal(store['companion:all'].shadow.day,'2026-11-09');assert.equal(store['companion:all'].shadow.total,1);
 assert.match(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),/put\('shadowStatus',\{at:new Date\(\)\.toISOString\(\),day:shadowLocalDay\(Date\.now\(\)\),failed:true/,'the failure path records the local day');
});

test('finding 9: each project\'s decisions keep that project\'s own local day',async()=>{
 // 03:30Z = 00:30 of 10/11 in São Paulo and 23:30 of 09/11 in Manaus.
 const now=Date.parse('2026-11-10T03:30:00Z'),spZ=Date.parse('2026-11-10T03:00:00Z'),mnZ=Date.parse('2026-11-09T04:00:00Z'),store={};
 const state={config:{sp:{projectName:'SP'},mn:{projectName:'MN'}},snapshots:[
  todaySnap('sp','America/Sao_Paulo',spZ,now,[]),...closedSnaps('sp','America/Sao_Paulo',spZ,now),
  todaySnap('mn','America/Manaus',mnZ,now,[row('m1','09/11 - [TESTE] M',m(130),{adAccountId:'acc-m'})]),...closedSnaps('mn','America/Manaus',mnZ,now)]};
 const solo=shadowLib.evaluateShadow(state,{project:'mn',params:{},now});
 assert.equal(solo.day,'2026-11-09');assert.ok(solo.decisions.length,'control: the Manaus project decides');
 const {e}=executor(store,{AUTONOMY_SHADOW_POLICY:JSON.stringify({projects:{sp:{},mn:{}}})});
 const merged=await withNow(now,()=>e.storeShadow(state));
 const mn=merged.filter(x=>x.project==='mn');
 assert.ok(mn.length);for(const x of mn){assert.equal(x.day,'2026-11-09');assert.equal(JSON.parse(x.id)[0],'2026-11-09');}
 assert.deepEqual({...store.shadowStatus.days},{sp:'2026-11-10',mn:'2026-11-09'});assert.equal(store.shadowStatus.day,'2026-11-10');
 await withNow(now,()=>e.storeCompanion(state,merged));
 assert.equal(store['companion:mn'].shadow.day,'2026-11-09');assert.equal(store['companion:mn'].shadow.total,mn.length,'the Manaus "hoje" is its own day');
});

test('finding 43: the MCP shadow read keeps owner, grade, rule label and limitations on every entry',async()=>{
 const now=Date.parse('2026-11-08T15:00:00Z');
 const owned=entry('2026-11-08','x',iso(now-3600000),{owner:{actor:'Bunker · aprovado por você',at:iso(now-1800000),minutesAfter:30},grade:{next:{spend:50,result:-5,roi:0.9},verdict:'acertou',winnerCut:false}});
 const plain=entry('2026-11-08','y',iso(now-1200000));delete plain.limitations;
 const {control}=executor({'shadow:x':owned,'shadow:y':plain,shadowStatus:{day:'2026-11-08'}});
 const out=await withNow(now,()=>control({action:'shadow'}));
 const [a,b]=out.entries;
 assert.equal(a.owner.actor,'Bunker · aprovado por você');assert.equal(a.grade.verdict,'acertou');assert.equal(a.ruleLabel,shadowLib.shadowRules['test-no-sale']);assert.deepEqual(a.limitations,['l']);
 assert.equal(b.owner,null);assert.equal(b.grade,null);assert.equal(b.limitations,null,'missing stays N/D, never an invented empty list');
});

test('finding 46: the MCP route forwards a validated shadow day, and the worker lists that day',async()=>{
 const src=fs.readFileSync(new URL('../app/mcp/route.ts',import.meta.url),'utf8');
 assert.match(src,/const day=input\.action==='shadow'&&typeof input\.day==='string'&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(input\.day\)\?input\.day:undefined;/);
 assert.match(src,/executorControl\(\{action:input\.action,day\} as \{action:string\}\)/);
 const {control}=executor({'shadow:a':entry('2026-11-07','a','2026-11-07T15:00:00.000Z'),'shadow:b':entry('2026-11-08','b','2026-11-08T15:00:00.000Z'),shadowStatus:{day:'2026-11-08'}});
 const out=await control({action:'shadow',day:'2026-11-07'});
 assert.deepEqual(out.entries.map(x=>x.objectId),['a']);assert.equal(out.summary.day,'2026-11-07');
});

test('finding 44: the backtest bad-day proxy uses the live v2 thresholds, young campaigns included',()=>{
 const meta={objectId:'u1',externalId:'z1',adAccountId:'acc-x',projectId:'p',name:'20/10 - [CBO] - Z1',dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null};
 const day=(date,spend,rev,o)=>({date,spend,revenueNet:rev,adCosts:0,productCost:0,saleTax:0,frontOrders:o,orders:o,checkouts:o,impressions:spend>0?1000:0,linkClicks:spend>0?20:0});
 const dates=Array.from({length:10},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`),now=Date.parse('2026-11-08T23:59:00-03:00');
 const old=roi=>evaluateDay(meta,[...dates.slice(0,7).map(d=>day(d,300,600,3)),day(dates[7],300,300*roi,1),day(dates[8],300,600,3)],7,{now}).badDay;
 assert.equal(old(0.8),true,'ROI 0.8 is below the live 0.9 trigger');assert.equal(old(0.95),false);
 // First spend yesterday (second day), yesterday ROI 1.5, a sale today at ROI 0.5.
 const young=(y,t,o=1)=>evaluateDay({...meta,name:'07/11 - [CBO] - Z2'},[...dates.slice(0,6).map(d=>day(d,0,0,0)),day(dates[6],100,100*y,1),day(dates[7],100,100*t,o),day(dates[8],100,100,1)],7,{now}).badDay;
 assert.equal(young(1.5,0.5),true,'young campaign with a good yesterday and a bad today');
 assert.equal(young(1.1,0.5),false,'yesterday below 1.2');assert.equal(young(1.5,0.5,0),false,'no sale today is the first-24h ceiling\'s job');
 const launch=evaluateDay({...meta,name:'08/11 - [CBO] - Z3'},[...dates.slice(0,7).map(d=>day(d,0,0,0)),day(dates[7],100,50,1),day(dates[8],100,100,1)],7,{now}).badDay;
 assert.equal(launch,false,'never on the launch day');
});

test('Final review: the all-projects shadow summary keeps each project\'s own local day',async()=>{
 const {shadowSummary}=await import('../lib/autonomy-shadow.mjs');
 const e=(project,day)=>({rule:'test-no-sale',project,day,name:project+day,action:'status',firstAt:'2026-11-10T03:30:00Z'});
 const list=[e('sp','2026-11-10'),e('mn','2026-11-09'),e('mn','2026-11-08'),e('sp','2026-11-09')];
 const s=shadowSummary(list,{project:'all',day:'2026-11-10',days:{sp:'2026-11-10',mn:'2026-11-09'}});
 assert.deepEqual(s.recent.map(r=>r.campaign).sort(),['mn2026-11-09','sp2026-11-10']);
 assert.equal(shadowSummary(list,{project:'all',day:'2026-11-10'}).total,1,'without the map: the single day, as before');
});
