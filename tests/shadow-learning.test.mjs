import test from 'node:test';
import assert from 'node:assert/strict';
import {betaCdf,chanceAbove,wilson,learningRecords,dailyBases,blindSpots,shadowObjects,mergeLearning,learningKeys,learningStats,gateAccuracy,learningBrief,learningKey,learningPolicy} from '../lib/shadow-learning.mjs';
import {shadowRulePolicy} from '../lib/autonomy-shadow.mjs';

// Synthetic fixtures only (no operational data). Brasília noon of 09/11/2026 = 15:00Z.
const NOW=Date.parse('2026-11-09T15:00:00Z'),P='p1',Q='p2';
const cut=(over={})=>({id:'e',rule:'bad-day-reduce',project:P,adAccountId:'a1',objectId:'c1',day:'2026-11-05',action:'budget',before:{dailyBudget:100},after:{dailyBudget:80},firstAt:'2026-11-05T15:00:00Z',metrics:{spend:120},grade:{verdict:'acertou',basis:'next',next:{roi:0.5}},...over});
const row=(over={})=>({provider:'meta',name:'[CBO] Oferta',adAccountId:'a1',externalId:'c1',spend:100,revenueNet:50,adCosts:0,productCost:0,saleTax:0,...over});
const yesterday=(project,day,rows,over={})=>({projectId:project,period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',timezone:'America/Sao_Paulo',from:day+'T03:00:00.000Z',rows,...over});
const shardsOf=put=>Object.values(put);

test('Beta, Wilson and the chance of beating the base match known values',()=>{
 assert.ok(Math.abs(betaCdf(0.3,2,3)-0.3483)<1e-4,'Beta(2,3) at 0.3 = 6x²−8x³+3x⁴');
 assert.ok(Math.abs(betaCdf(0.5,1,1)-0.5)<1e-9);
 assert.ok(Math.abs(betaCdf(0.9,5,2)-(6*0.9**5*0.1+0.9**6))<1e-9,'Beta(5,2) at 0.9 = 6x⁵(1−x)+x⁶');
 assert.ok(Math.abs(wilson(20,20).low-0.839)<0.002,'20 of 20 is not proof of 100%: lower bound ≈ 84%');
 assert.deepEqual(wilson(0,0),{low:null,high:null});
 assert.ok(chanceAbove(15,20,0.5)>0.98,'15 of 20 against a coin');
 assert.ok(Math.abs(chanceAbove(6,10,0.6)-0.5)<0.1,'6 of 10 against 60%: a coin flip');
 assert.equal(chanceAbove(0,0,0.5),null);
});

test('Only final grades become records; kind, target day and who came first are kept',()=>{
 const night=cut({id:'n',rule:'night-increase',after:{dailyBudget:200},grade:{verdict:'acertou',basis:'day',day:{roi:2}}});
 const late=cut({id:'l',action:'status',rule:'test-no-sale',before:{status:'ACTIVE'},after:{status:'PAUSED'},firstWouldExecuteAt:'2026-11-05T16:00:00Z',manager:{at:'2026-11-05T15:30:00Z'}});
 const followed=cut({id:'f',firstWouldExecuteAt:'2026-11-05T16:00:00Z',manager:{at:'2026-11-05T17:00:00Z'},owner:{at:'2026-11-05T17:00:00Z'}});
 const out=learningRecords([cut(),night,late,followed,cut({id:'o',grade:{verdict:'N/D'}}),cut({id:'g',grade:undefined}),cut({id:'b',day:'ontem'})]);
 assert.equal(out.length,4,'N/D, ungraded and malformed stay out');
 const [r,n,l,f]=out;
 assert.deepEqual([r.kind,r.target,r.verdict,r.spend,r.roi,r.manager,r.v],['reduce','2026-11-06','acertou',120,0.5,null,shadowRulePolicy.version]);
 assert.deepEqual([n.kind,n.target,n.roi],['increase','2026-11-05',2],'night increase reads D itself');
 assert.deepEqual([l.kind,l.manager],['pause','before'],'manager before the would-execute time: the Bunk was late');
 assert.deepEqual([f.manager,f.owner],['after',true]);
 assert.ok(!JSON.stringify(out).includes('c1'),'no object id or name is needed to learn');
});

test('Daily base: losing and profitable campaigns with spend, warm-up and incomplete sources out',()=>{
 const b=dailyBases([
  yesterday(P,'2026-11-06',[row(),row({externalId:'c2',revenueNet:300}),row({externalId:'c3',spend:0}),row({externalId:'c4',name:'[AQUECIMENTO] perfil',revenueNet:0}),row({externalId:'c5',productCost:null}),row({externalId:'c6',provider:'kwai'})]),
  yesterday(Q,'2026-11-06',[row()],{complete:false}),
  {...yesterday(Q,'2026-11-06',[row()]),period:'today'}]);
 assert.deepEqual(b,[{day:'2026-11-06',project:P,campaigns:2,loss:1,profit:1}]);
});

test('Blind spots: a person cut the Bunk never flagged; warnings, the Bunker itself, Meta and unsettled moves are not',()=>{
 const ev=(over={})=>({id:'h1',project:P,adAccountId:'a1',objectId:'c9',action:'pause',origin:'history',actor:'Jorge',at:'2026-11-09T12:00:00Z',name:'[TESTE] X',...over});
 const warned={project:P,adAccountId:'a1',objectId:'c8',action:'status',after:{status:'PAUSED'},firstAt:'2026-11-09T11:00:00Z',alertOnly:true};
 const out=blindSpots([warned],[ev(),ev({id:'h2',objectId:'c8'}),ev({id:'h3',origin:'bunker'}),ev({id:'h4',actor:'Meta'}),ev({id:'h5',at:'2026-11-09T14:58:00Z'}),ev({id:'h6',project:'zz'}),ev({id:'h7',action:'activate'}),ev({id:'h8',origin:'owner',action:'reduce'})],{projects:[P],now:NOW});
 assert.deepEqual(out.map(m=>[m.kind,m.by,m.day]),[['pause','manager','2026-11-09'],['reduce','owner','2026-11-09']]);
 assert.equal(blindSpots([{...warned,objectId:'c9',firstAt:'2026-11-07T11:00:00Z'}],[ev()],{now:NOW}).length,1,'a warning older than 36h does not cover it');
 assert.equal(blindSpots([],[ev({name:'[ENGAJAMENTO] perfil'})],{now:NOW}).length,0,'warm-up is out of the sales scope');
 // Only what the shadow evaluates: Meta campaign rows outside warm-up, never an ad set, an ad or another provider.
 const objects=shadowObjects([yesterday(P,'2026-11-08',[row({externalId:'c9'}),row({externalId:'k1',provider:'kwai'}),row({externalId:'w1',name:'AQUECIMENTO'})]),{...yesterday(P,'2026-11-08',[row({externalId:'s1'})]),level:'adset'}]);
 assert.deepEqual([...objects],[JSON.stringify([P,'a1','c9'])]);
 assert.deepEqual(blindSpots([],[ev(),ev({id:'k',objectId:'k1'}),ev({id:'s',objectId:'s1'})],{objects,now:NOW}).map(m=>m.objectId),['c9']);
});

test('Memory shards: upsert by id, a miss counts once, base updates, caps and retention',()=>{
 const recs=learningRecords([cut({id:'1'}),cut({id:'2',grade:{verdict:'errou',basis:'next',next:{roi:2},winnerCut:true}})]);
 const miss=[{id:'m1',day:'2026-11-05',project:P,kind:'pause',by:'manager',at:'2026-11-05T12:00:00Z'}];
 const base=[{day:'2026-11-05',project:P,campaigns:4,loss:1,profit:3}];
 assert.deepEqual(learningKeys(recs,miss,base),[learningKey('2026-11-05',P)]);
 const first=mergeLearning(new Map(),recs,miss,{now:NOW,bases:base});
 const k=learningKey('2026-11-05',P),s=first.put[k];
 assert.deepEqual([Object.keys(s.records).length,Object.keys(s.misses).length,s.base.campaigns],[2,1,4]);
 assert.deepEqual(mergeLearning(new Map([[k,s]]),recs,miss,{now:NOW,bases:base}).put,{},'nothing new, nothing written');
 const again=mergeLearning(new Map([[k,s]]),[],[{...miss[0],by:'owner'}],{now:NOW});
 assert.deepEqual(again.put,{},'a stored miss is never rewritten');
 const old=mergeLearning(new Map(),learningRecords([cut({id:'z',day:'2026-07-01'})]),[],{now:NOW,keys:[learningKey('2026-07-01',P),k,'learningSummary']});
 assert.deepEqual([Object.keys(old.put),old.drop],[[],[learningKey('2026-07-01',P)]],'past retention: not stored, dropped');
 const many=learningRecords(Array.from({length:learningPolicy.maxRecordsPerShard+5},(_,i)=>cut({id:'n'+i})));
 assert.equal(Object.keys(mergeLearning(new Map(),many,[],{now:NOW}).put[k].records).length,learningPolicy.maxRecordsPerShard,'shard capped');
});

test('Stats: accuracy with range, edge over doing nothing, small projects pulled to the rule, lessons',()=>{
 // 12 reductions in P (9 right), base of their target day: 25% of campaigns lost → doing nothing scores 25%.
 const p=Array.from({length:12},(_,i)=>cut({id:'p'+i,grade:{verdict:i<9?'acertou':'errou',basis:'next',next:{roi:i<9?0.5:2},winnerCut:i>=9}}));
 // 6 increases in Q, 3 right, on days where 75% of campaigns made money anyway.
 const q=Array.from({length:6},(_,i)=>cut({id:'q'+i,rule:'morning-increase',project:Q,after:{dailyBudget:130},grade:{verdict:i<3?'acertou':'errou',basis:'next',next:{roi:1}}}));
 const bases=[{day:'2026-11-06',project:P,campaigns:4,loss:1,profit:3},{day:'2026-11-06',project:Q,campaigns:4,loss:1,profit:3}];
 const misses=[1,2,3,4].map(i=>({id:'m'+i,day:'2026-11-08',project:Q,kind:i<3?'pause':i<4?'reduce':'increase',by:'manager',at:'2026-11-08T12:00:00Z'}));
 const shards=shardsOf(mergeLearning(new Map(),learningRecords([...p,...q]),misses,{now:NOW,bases}).put);
 const st=learningStats(shards,{now:NOW,names:{[Q]:'Projeto Q'}});
 const r=st.rules['bad-day-reduce'],m=st.rules['morning-increase'];
 assert.deepEqual([r.graded,r.right,r.accuracy,r.base.expected,r.base.edge],[12,9,0.75,0.25,0.5]);
 assert.ok(r.low>0.45&&r.high<0.95,'honest range, not a point');
 assert.ok(r.base.chanceBetter>0.99,'far above doing nothing');
 assert.equal(r.winnersCut,3);
 assert.deepEqual([m.accuracy,m.base.expected],[0.5,0.75]);
 assert.ok(m.base.chanceBetter<0.2,'raising here did worse than leaving it');
 assert.equal(r.projects[P].shrunk,r.accuracy,'one project: its own rate');
 assert.deepEqual([st.memory.days,st.memory.records,st.memory.misses,st.blindSpots.total,st.blindSpots.increases],[2,18,4,3,1],'blind spots are cuts; raises apart');
 assert.equal(learningBrief(st,{project:Q}).blindSpots,3);
 assert.equal(st.overall.graded,18);
 const kinds=st.lessons.map(l=>l.kind);
 assert.ok(kinds.includes('vantagem')&&kinds.includes('sem-vantagem')&&kinds.includes('ponto-cego')&&kinds.includes('vencedor'),kinds.join(','));
 assert.match(st.lessons.find(l=>l.kind==='ponto-cego').text,/^Projeto Q: 3 cortes de gestor\/dono sem aviso/);
 assert.match(st.lessons.find(l=>l.kind==='sem-vantagem').text,/não fazer nada acertaria 75%/);
 assert.ok(st.lessons.every(l=>!/garant|100% de chance/.test(l.text)),'no promise of certainty');
 assert.match(st.lessons.find(l=>l.kind==='vantagem').text,/mais de 99% de chance/);
 // Shrinkage: a small project far from the rule is pulled toward it.
 const mixed=learningStats(shardsOf(mergeLearning(new Map(),learningRecords([...p,cut({id:'x1',project:Q,grade:{verdict:'errou',basis:'next'}}),cut({id:'x2',project:Q,grade:{verdict:'errou',basis:'next'}})]),[],{now:NOW}).put),{now:NOW});
 const small=mixed.rules['bad-day-reduce'].projects[Q];
 assert.ok(small.accuracy===0&&small.shrunk>0.5,'2 misses alone do not make the rule 0% in that project');
});

test('Gate reads the long memory of the current version, never a smaller one; brief per scope',()=>{
 const p=Array.from({length:25},(_,i)=>cut({id:'p'+i,day:i<10?'2026-10-20':'2026-11-05',grade:{verdict:i%5?'acertou':'errou',basis:'next'}}));
 const st=learningStats(shardsOf(mergeLearning(new Map(),learningRecords(p),[],{now:NOW}).put),{now:NOW});
 const g=gateAccuracy(st,'bad-day-reduce',{graded:8,right:6,accuracy:0.75});
 assert.deepEqual([g.graded,g.right,g.accuracy,g.source],[25,20,0.8,'memory'],'older than 7 days still counts');
 assert.deepEqual(gateAccuracy(st,'bad-day-reduce',{graded:30,right:10,accuracy:1/3}),{graded:30,right:10,accuracy:1/3},'memory smaller than the live count: the live count');
 assert.equal(gateAccuracy(st,'night-increase',null),null);
 const old=learningStats(shardsOf(mergeLearning(new Map(),learningRecords(p).map(r=>({...r,v:shadowRulePolicy.version-1})),[],{now:NOW}).put),{now:NOW});
 assert.equal(gateAccuracy(old,'bad-day-reduce',null),null,'decisions of an older rule version never open the gate');
 const b=learningBrief(st,{project:P});
 assert.deepEqual([b.days,b.graded,b.right,b.blindSpots],[2,25,20,0]);
 assert.deepEqual(learningBrief(st,{project:'other'}).graded,0);
 assert.equal(learningBrief(null),null);
});

test('The executor feeds the gate from the memory, stores it apart and shows it in the shadow read and the notch',async()=>{
 const fs=await import('node:fs');
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.match(src,/gateAccuracy\(learned,rule,ruleAccuracy\(prior,rule\)\)/,'gate: memory, never fewer than the 7 days');
 assert.match(src,/await this\.storeLearning\(state,merged,events,policy,now\)\.catch\(/,'a memory failure never breaks the shadow');
 assert.match(src,/prefix:'learn:'/);
 assert.match(src,/learning:await this\.ctx\.storage\.get<any>\('learningSummary'\)/,'shadow read');
 assert.match(src,/learning:learningBrief\(learned,\{project\}\)/,'notch summary per scope');
 assert.ok(!/learningSummary[^\n]*dispatch|storeLearning[^\n]*submit/.test(src),'memory never dispatches');
 const swift=fs.readFileSync(new URL('../mac/BunkerNotch/Sources/BunkerNotch/Summary.swift',import.meta.url),'utf8');
 assert.match(swift,/var learning: ShadowLearning\? = nil/,'older servers without the field still decode');
});

test('End to end in the executor: graded decisions and the day base land in the memory, the summary and the gate',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm'),ts=(await import('typescript')).default;
 const mods={'autonomy-grant':await import('../lib/autonomy-grant.mjs'),'autonomy-shadow':await import('../lib/autonomy-shadow.mjs'),'campaign-activity':await import('../lib/campaign-activity.mjs'),'change-attribution':await import('../lib/change-attribution.mjs'),
  'companion-summary':await import('../lib/companion-summary.mjs'),'meta-display':await import('../lib/meta-display.mjs'),'shadow-learning':await import('../lib/shadow-learning.mjs')};
 const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const store={},exports={};
 const storage={get:async k=>Array.isArray(k)?new Map(k.filter(x=>x in store).map(x=>[x,store[x]])):store[k],list:async({prefix})=>new Map(Object.entries(store).filter(([k])=>k.startsWith(prefix))),put:async(k,v)=>{if(typeof k==='object')Object.assign(store,k);else store[k]=v;},delete:async keys=>{for(const k of [].concat(keys))delete store[k];},setAlarm:async()=>{}};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:Object.entries(mods).find(([k])=>name.includes(k))?.[1]||{},Date,Response,Intl,setInterval,clearInterval});
 const e=new exports.BunkerCloudExecutor({storage},{AUTONOMY_SHADOW_POLICY:JSON.stringify({projects:{[P]:{pauseTestMinSpend:100}}})});
 // 22 graded reductions from 20 days ago to 3 days ago: older than the 7 days the shadow keeps.
 const graded=Array.from({length:22},(_,i)=>{const day=new Date(NOW-(3+i%18)*86400000).toISOString().slice(0,10);
  return cut({id:'g'+i,day,firstAt:day+'T15:00:00Z',lastAt:new Date(NOW-3600000).toISOString(),grade:{verdict:i%4?'acertou':'errou',basis:'next',next:{roi:i%4?0.5:2},day:{roi:1}}});});
 for(const g of graded)store['shadow:'+g.id]=g;
 const state={config:{[P]:{projectName:'Fictício'}},snapshots:[yesterday(P,'2026-11-07',[row(),row({externalId:'c2',revenueNet:300}),row({externalId:'c3',revenueNet:10})])]};
 const real=Date.now;Date.now=()=>NOW;
 try{await e.storeShadow(state);}finally{Date.now=real;}
 assert.equal(store.learningStatus?.ok,true,JSON.stringify(store.learningStatus));
 const shards=Object.keys(store).filter(k=>k.startsWith('learn:'));
 assert.ok(shards.length>=18,'one shard per day × project');
 assert.deepEqual(store[learningKey('2026-11-07',P)].base,{campaigns:3,loss:2,profit:1});
 const s=store.learningSummary;
 assert.deepEqual([s.rules['bad-day-reduce'].graded,s.rules['bad-day-reduce'].right],[22,16]);
 assert.equal(learningBrief(s,{project:P}).graded,22);
 // Older entries leave the 7-day shadow store, the memory keeps them and the gate reads them.
 for(const k of Object.keys(store))if(k.startsWith('shadow:'))delete store[k];
 const g=gateAccuracy(store.learningSummary,'bad-day-reduce',{graded:0,right:0,accuracy:null});
 assert.deepEqual([g.graded,g.source],[22,'memory']);
});
