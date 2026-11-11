/* Modo Gestor, Phase 1 integration (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md): the real W3 runner feeds the W1 deep view
 * and companion block, the W2 cockpit renders that exact deep view, and the W4 notch decoder knows every key the companion
 * block sends. No stubs between the pieces. Synthetic fixtures only (invented people, projects, campaigns and amounts);
 * no network, no browser, no screenshot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {playbookStore,runPlaybookShadow,runPlaybookLearning,playbookRunnerPolicy as R} from '../lib/playbook-runner.mjs';
import {binsKey} from '../lib/team-observations.mjs';
import {buildDeepBase,buildDeepView,autonomyCompanion,simRow,simRowsView} from '../lib/autonomy-deep-view.mjs';
import {memoryStorage,syntheticDays,iso,dayStart,TZ} from './helpers/playbook-fixtures.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const D='2026-11-09',NOW=dayStart(D)+15*3600000,P='p1',LATER=NOW+20*60000;

/** The executor's storage after the plays were fitted and replayed (hook B) and one Sombra pass ran (hook A). */
async function pipeline(){
 const storage=memoryStorage(),store=playbookStore(storage);
 const {bins}=syntheticDays({days:40,from:'2026-09-30',project:P,campaigns:8,seed:1});
 for(const b of bins)storage.map.set(binsKey(b.day,P),b);
 const rows=Array.from({length:12},(_,i)=>({id:'u'+i,externalId:'c'+i,adAccountId:'acc-1',accountName:'Conta Fictícia',name:i%2?'Madura '+i:'09/11 - [TESTE] '+i,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},
  dailyBudget:200,budgetCurrency:'BRL',budgetRate:1,spend:100+i*20,revenue:i%2?i*30:0,revenueNet:i%2?i*30:0,adCosts:0,productCost:0,saleTax:0,frontOrders:i%2?1:0,orders:i%2?1:0,checkouts:1,impressions:1000,linkClicks:20}));
 const cut=(period,from,days)=>({projectId:P,projectName:'Projeto Um',period,level:'campaign',source:'Malva MCP',timezone:TZ,complete:true,from:iso(from),to:iso(from+days*86400000),fetchedAt:iso(NOW-60000),lastSyncAt:iso(NOW-60000),rows:rows.map(r=>({...r}))});
 const state={config:{[P]:{projectName:'Projeto Um'}},paused:false,
  autonomy:{version:1,enabled:true,projects:{[P]:{mode:'auto',actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:500,ordersPerDay:2},campaigns:{}}}},
  snapshots:[cut('today',dayStart(D),1),cut('yesterday',dayStart(D)-86400000,1),cut('3d',dayStart(D)-3*86400000,3),cut('7d',dayStart(D)-7*86400000,7)],proposals:[],executions:[],changeAttributions:[]};
 for(let i=0;i<120;i++){
  const r=await runPlaybookLearning(store,{state,now:NOW+i*1000,projects:[P],zone:()=>TZ,names:{[P]:'Projeto Um'}},{deadline:Date.now()+R.learnBudgetMs});
  assert.equal(r.ok,true,JSON.stringify(r));
  const c=storage.map.get('pb:cursor');if(storage.map.get('pb:model')?.fitAt&&!c.fit&&c.replay?.[P]===shiftDay(D,-1))break;
 }
 await runPlaybookLearning(store,{state,now:NOW+11*60000,projects:[P],zone:()=>TZ,names:{[P]:'Projeto Um'}},{deadline:Date.now()+R.learnBudgetMs});
 const a=await runPlaybookShadow(store,{state,liveItems:[],events:[],now:LATER,projects:[{project:P,params:{ticketFront:100},day:D}],fixed:[]},{deadline:Date.now()+2000});
 assert.equal(a.ok,true,JSON.stringify(a));
 const base=buildDeepBase({state,liveItems:[],accuracy:{},policy:{projects:{[P]:{ticketFront:100}}},now:LATER});
 const pbs=[...storage.map].filter(([k])=>k.startsWith('pbs:')).map(([,v])=>v);
 const shadowStatus={at:iso(LATER-60000),day:D,days:{[P]:D},projects:[P],skipped:{}};
 const deepOf=project=>buildDeepView({base,project,now:LATER,shadowStatus,autonomyStatus:{at:iso(LATER-60000),ok:true,enabled:true,acting:true,created:0,logged:0},autonomyLog:[],learningSummary:null,learningStatus:null,
  pbStatus:storage.map.get('pb:status'),pbView:storage.map.get('pb:view'),pbViews:{[P]:storage.map.get('pb:view:'+P)},shadowEntries:[],pbsEntries:pbs});
 return {storage,state,base,pbs,deepAll:deepOf('all'),deepP:deepOf(P),companion:project=>autonomyCompanion({base,shadowRecent:[{projectId:P,adAccountId:'acc-1',objectId:'c0'}],log:[],pbView:storage.map.get('pb:view'),pbViews:{[P]:storage.map.get('pb:view:'+P)},project,now:LATER,entries:[],days:{[P]:D},shadowAt:iso(LATER-60000)})};
}
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const ctx=await pipeline();

test('Runner → deep view: play decisions arrive as "só sugestão", never executable, with names instead of hashed ids',()=>{
 const {deepP,pbs}=ctx,dec=deepP.projects[P].decisions.filter(d=>d.source==='playbook');
 assert.ok(pbs.length>0&&dec.length===pbs.length,'every stored play decision of today reaches the deep view');
 for(const e of pbs){assert.equal(e.wouldExecute,false);assert.equal(e.firstWouldExecuteAt,null);assert.equal(e.source,'playbook');}
 for(const d of dec){
  assert.equal(d.status,'so-sugestao','the project is in Automático with the switch on, and a play still never sends or asks');
  assert.equal(d.wouldExecute,false);assert.equal(d.firstWouldExecuteAt,null);assert.equal(d.proposalId,null);
  for(const l of d.play.learnedFrom){assert.doesNotMatch(l.name,/^p:[a-z0-9]+$/,'never the hashed person id');assert.ok(l.name.length>0);}
 }
 assert.ok(dec.some(d=>d.play.learnedFrom.some(l=>l.name==='Ana Souza')),'the name the runner resolved for the play');
 assert.equal(deepP.totals.decisions.enviaria+deepP.totals.decisions.pediria,0);
});

test('Runner → deep view: per-project agreement and the reason a play is only observed flow through',()=>{
 const {storage,deepAll,deepP}=ctx,v=storage.map.get('pb:view:'+P);
 assert.ok(v.agreement&&v.agreement.n>0,'pb:view:<p> carries the project agreement of the last 7 replayed days');
 assert.deepEqual(deepP.totals.agreement,deepAll.totals.agreement,'one project: the project agreement equals the all-projects one');
 assert.ok(Number.isFinite(deepP.totals.agreement.precision));
 const plays=deepP.projects[P].playbook.plays;assert.ok(plays.length>0);
 for(const p of plays){
  assert.ok(['observando','candidata'].includes(p.stage));assert.equal(p.adoptable,false);assert.equal(p.adoptHint,'chega na próxima fase');
  if(p.stage==='candidata')assert.equal(p.reason,null);
  else assert.ok(['poucos-casos','instavel','divergencia','dormindo','sem-acerto'].includes(p.reason),String(p.reason));
  if(!p.agreement.n)assert.equal(p.agreement.precision,null,'N/D, never 0');
 }
 assert.ok(JSON.stringify(deepAll).length<400*1024);
});

// The W2 cockpit, bundled in memory exactly like tests/autonomy-cockpit.test.mjs, rendered with the real deep view.
const bundled=await build({stdin:{contents:["export * as I from './app/autonomy/island.tsx';","export * as N from './app/autonomy/now.tsx';","export * as L from './app/autonomy/learning.tsx';","export * as S from './app/autonomy/score.tsx';"].join('\n'),resolveDir:root,loader:'tsx',sourcefile:'integration-entry.tsx'},
 absWorkingDir:root,bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},packages:'external',logLevel:'silent'});
const mod={exports:{}};
new Function('module','exports','require',bundled.outputFiles[0].text)(mod,mod.exports,id=>require(id.startsWith('@/')?root+id.slice(2):id));
const {I,N,L,S}=mod.exports;
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const text=h=>renderToStaticMarkup(h).replace(/<!-- -->/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/\s+/g,' ');
const noop=()=>{};

test('Deep view → cockpit: every tab renders the real read model with no leaked ids, NaN or "undefined"',()=>{
 const saved={enabled:true,enabledAt:null,disabledAt:null,projects:[{id:P,name:'Projeto Um',mode:'auto',actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:500,ordersPerDay:2},campaigns:{}}]};
 const ctl={saved,draft:null,busy:null,kill:noop,turnOn:noop,discard:noop,projects:saved.projects,conflict:false,error:'',last:null,edit:noop};
 for(const [scope,deep] of [['all',ctx.deepAll],[P,ctx.deepP]]){
  const tabs={ilha:React.createElement(I.Island,{deep,deepError:null,ctl,saving:false,now:LATER,filter:scope,setFilter:noop}),
   agora:React.createElement(N.NowTab,{deep,loading:false,fallbackOrders:[],showProject:false,onOpen:noop}),
   aprendizado:React.createElement(L.LearningTab,{deep,loading:false,showProject:false,onOpen:noop}),
   placar:React.createElement(S.ScoreTab,{deep,loading:false,showProject:false,onOpen:noop})};
  const out={};
  for(const [k,el] of Object.entries(tabs)){
   out[k]=text(el);
   assert.doesNotMatch(out[k],/undefined|NaN|\[object Object\]|Infinity|\bp:[a-z0-9]{6,}/,`${k} (${scope})`);
  }
  assert.match(out.agora,/Só sugestão · jogada em observação/);assert.doesNotMatch(out.agora,/Enviaria|Pediria a você/);
  assert.match(out.agora,/aprendida com Ana Souza/);
  assert.match(out.ilha,/Concordância com a equipe \d+%/,'the agreement tile has a value under both filters');
  const play=ctx.deepP.projects[P].playbook.plays[0];
  assert.ok(out.aprendizado.includes(play.sentence),'the fitted play sentence');
  assert.match(out.aprendizado,/Adotar chega na próxima fase/);
  assert.ok(out.placar.includes(play.sentence),'a play with cases is on the scoreboard even before its first grade');
 }
 const html=renderToStaticMarkup(React.createElement(L.LearningTab,{deep:ctx.deepP,loading:false,showProject:false,onOpen:noop}));
 for(const b of html.match(/<button[^>]*>[^<]*(Adotar|Liberar)[^<]*/g)||[])assert.match(b,/disabled/,'Adopt / Liberar stay disabled in Phase 1');
});

test('Companion block → notch: every key the server sends is one the Swift decoder reads, N/D stays null',()=>{
 const swift=fs.readFileSync(new URL('../mac/BunkerNotch/Sources/BunkerNotch/SummaryLossy.swift',import.meta.url),'utf8');
 const keysOf=type=>{const m=new RegExp(`extension Summary\\.${type}: Decodable \\{\\s*private enum Keys: String, CodingKey \\{ case ([^}]+)\\}`).exec(swift);assert.ok(m,type);return new Set(m[1].split(',').map(s=>s.trim()));};
 assert.match(swift,/case [^}]*\bautonomy\b/,'the summary decodes the autonomy key');
 const sub=(o,type)=>{const k=keysOf(type);for(const key of Object.keys(o))assert.ok(k.has(key),`${type}.${key} is decoded by the notch`);};
 for(const project of ['all',P]){
  const b=ctx.companion(project);assert.ok(b&&JSON.stringify(b).length<=6*1024);
  sub(b,'Autonomy');sub(b.island,'AutonomyIsland');
  for(const p of b.projects){sub(p,'AutonomyProject');sub(p.today,'AutonomyToday');for(const x of p.plays)sub(x,'AutonomyPlay');for(const x of p.people)sub(x,'AutonomyPerson');assert.equal(p.pilot,null);}
  for(const c of b.campaigns){sub(c,'AutonomyCampaign');for(const k of ['projectId','adAccountId','objectId','mode'])assert.equal(typeof c[k],'string');}
  assert.ok(Number.isFinite(b.island.agreement)&&b.island.agreement>=0&&b.island.agreement<=1,'a 0–1 fraction the notch accepts');
  for(const p of b.projects)for(const x of p.plays)assert.ok(x.agreement===null?x.n===0||x.n>=0:x.agreement>=0&&x.agreement<=1);
 }
});

test('Worker wiring: the real runner is imported, called after autonomyAct, only through the pb:/pbs: facade',()=>{
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.match(src,/import \* as playbookRunner from '\.\.\/lib\/playbook-runner\.mjs';/);
 const shadow=src.slice(src.indexOf('private async storeShadow('),src.indexOf('private async storeLearning('));
 assert.ok(shadow.indexOf('this.autonomyAct(')>0&&shadow.indexOf('this.autonomyAct(')<shadow.indexOf('this.playbookShadow('),'hook A runs after the autonomy acted on this pass');
 for(const fn of ['runPlaybookShadow','runPlaybookLearning','runPlaybookBackfill'])
  assert.match(src,new RegExp(`r\\.${fn}\\(r\\.playbookStore\\(this\\.ctx\\.storage\\)`),`${fn} gets only the facade`);
 const act=src.indexOf('private async autonomyAct(');
 assert.doesNotMatch(src.slice(act,src.indexOf('\n }\n',act)),/pbs:|playbook/i,'autonomyAct never reads the plays');
 // The sim rows view the route unwraps carries `rows` at the top, as the Permissões simulator expects.
 const sim=simRowsView({base:ctx.base,project:P,rows:[],now:LATER,shadowStatus:null});
 assert.ok(Array.isArray(sim.rows)&&Array.isArray(sim.columns));assert.equal(typeof simRow,'function');
});
