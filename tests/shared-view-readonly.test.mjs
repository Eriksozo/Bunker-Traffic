import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {companionSummary,projectBoard} from '../lib/companion-summary.mjs';
import {evaluateShadow,first24hWatch} from '../lib/autonomy-shadow.mjs';
import {activityLog} from '../lib/campaign-activity.mjs';
import {liveTodayState,liveRowIndex} from '../lib/meta-display.mjs';
import {dailyBases,shadowObjects} from '../lib/shadow-learning.mjs';
import {teamActions} from '../lib/team-learning.mjs';

// Owner report of 10/11/2026: the executor object exceeded its memory. Read-only callers now share one hydrated copy of
// the central per revision, so every builder they call must leave it untouched. Synthetic fixtures only.
const deepFreeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);}return o;};
const now=Date.parse('2026-11-07T17:00:00Z'),iso=ms=>new Date(ms).toISOString();
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,checkouts=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts,impressions:1000,linkClicks:20});
const row=(id,name,metrics)=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',deliveryStartedAt:iso(now-5*3600000),...metrics});
const cut=(period,from,rows)=>({...base,period,from,to:period==='today'?'2026-11-08T03:00:00.000Z':'2026-11-07T03:00:00.000Z',fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows});
const state=()=>({config:{p:{projectName:'Fictício'}},paused:false,ownerChoices:[],decisions:[],proposals:[{id:'pr',project:'p',status:'Aguardando aprovação',expiresAt:iso(now+3600000)}],
 snapshots:[cut('today','2026-11-07T03:00:00.000Z',[row('t1','07/11 - [TESTE] A',m(230,0,0,3)),row('c2','Escala',m(500,900,3,9))]),cut('yesterday','2026-11-06T03:00:00.000Z',[row('c2','Escala',m(400,700,2,5))]),cut('3d','2026-11-04T03:00:00.000Z',[row('c2','Escala',m(1200,2000,6,15))]),cut('7d','2026-10-31T03:00:00.000Z',[row('c2','Escala',m(2800,4600,14,30))])],
 decisionHistory:[{id:'h',project:'p',projects:['p'],adAccountId:'acc1',objectId:'c2',name:'Escala',field:'dailyBudget',before:100,after:120,occurredAt:iso(now-7200000),actor:{name:'Ana'},currency:'BRL'}],
 collaborationMessages:[],changeAttributions:[]});

test('Every builder fed by the shared view leaves a frozen state untouched',()=>{
 const s=deepFreeze(state()),live=deepFreeze([{projectId:'p',snapshot:s.snapshots[0],lastSuccessAt:iso(now-60000)}]);
 assert.doesNotThrow(()=>{
  const todayState=liveTodayState(s,live,{now});liveRowIndex(live,{now});
  const board=projectBoard(s,now,{live,todayState});
  companionSummary(s,{project:'all',now,board,live,todayState});companionSummary(s,{project:'p',now,board,live,todayState});
  const events=activityLog(s,{since:now-26*3600000,now});
  evaluateShadow(s,{project:'p',liveItem:live[0],events,params:{pauseTestMinSpend:200,first24hLowIcPauseAt:80},now});
  first24hWatch(s,{project:'p',liveItem:live[0],params:{},now});
  dailyBases(s.snapshots);const objects=shadowObjects(s.snapshots);
  teamActions({attributions:[],state:s,entries:[],objects,ownerNames:[],liveItems:live,now});
 });
});

test('Read-only callers use the shared view; writes and the engine keep a fresh copy',()=>{
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.match(src,/const run=this\.writeChain\.then\(async\(\)=>\{const current=await this\.read\(\);/);
 assert.match(src,/createCloudEngine\(\{read:\(\)=>this\.read\(\)/);
 assert.match(src,/commitPersistedState\(this\.db\(\),current\.state,current\.revision\);this\.viewCache=null;/,'a commit drops the old copy');
 assert.equal((src.match(/this\.read\(\)/g)||[]).length,6,'only view() (cache fill and probe fallbacks), write() and the engine (read, readCurrent) read a fresh copy');
});

test('The shared view hydrates once per central revision, concurrent callers share it, and a commit drops it',async()=>{
 const {default:ts}=await import('typescript'),vm=await import('node:vm');
 const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:{},Date,Response,setInterval,clearInterval,setTimeout,clearTimeout,console,URL,Intl,TextEncoder,crypto:globalThis.crypto});
 const e=new exports.BunkerCloudExecutor({storage:{get:async()=>undefined,put:async()=>{}}},{});
 let revision=7,reads=0,probe=true;
 e.db=()=>({prepare:()=>({bind:()=>({first:async()=>{if(!probe)throw Error('down');return {revision};}})})});
 e.read=async()=>{reads++;await new Promise(r=>setTimeout(r,5));return {state:{paused:false,n:reads},revision};};
 const [a,b]=await Promise.all([e.view(),e.view()]);
 assert.equal(reads,1,'concurrent callers share one hydration');assert.equal(a,b);
 assert.equal(await e.view(),a,'same revision: same copy');assert.equal(reads,1);
 revision=8;const c=await e.view();assert.equal(reads,2);assert.notEqual(c,a,'new revision: fresh copy');
 probe=false;const d=await e.view();assert.equal(reads,3);assert.notEqual(d,c,'failed probe: plain fresh read, never a stale copy');
});
