import test from 'node:test';
import assert from 'node:assert/strict';
import {betaCdf,chanceAbove,wilson,learningRecords,dailyBases,mergeLearning,learningKeys,learningStats,gateAccuracy,learningBrief,learningKey,learningPolicy} from '../lib/shadow-learning.mjs';
import {mergeShadow,ruleAccuracy,shadowRulePolicy,entryRuleVersion} from '../lib/autonomy-shadow.mjs';
import {teamKey} from '../lib/team-learning.mjs';

// Synthetic fixtures only (no operational data). Brasília noon of 09/11/2026 = 15:00Z.
const NOW=Date.parse('2026-11-09T15:00:00Z'),P='p1',Q='p2',V=shadowRulePolicy.version;
const cut=(over={})=>({id:'e',rule:'bad-day-reduce',project:P,adAccountId:'a1',objectId:'c1',day:'2026-11-05',action:'budget',before:{dailyBudget:100},after:{dailyBudget:80},firstAt:'2026-11-05T15:00:00Z',ruleVersion:V,firstMetrics:{spend:120},metrics:{spend:999},grade:{verdict:'acertou',basis:'next',next:{roi:0.5}},...over});
const row=(over={})=>({provider:'meta',name:'[CBO] Oferta',adAccountId:'a1',externalId:'c1',spend:100,revenueNet:50,adCosts:0,productCost:0,saleTax:0,...over});
const win=(period,project,fromDay,toDay,rows,over={})=>({projectId:project,period,level:'campaign',complete:true,source:'Malva MCP',timezone:'America/Sao_Paulo',from:fromDay+'T03:00:00.000Z',to:toDay+'T03:00:00.000Z',rows,...over});
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

test('Entries are born with their rule version and first numbers; the 7-day count reads only the current version',()=>{
 const d={rule:'bad-day-reduce',project:P,adAccountId:'a1',objectId:'c1',action:'budget',before:{dailyBudget:100},after:{dailyBudget:80},wouldExecute:false,metrics:{spend:50}};
 const [first]=mergeShadow([],[d],{now:NOW,day:'2026-11-09'});
 assert.deepEqual([first.ruleVersion,first.firstMetrics.spend],[V,50]);
 const [again]=mergeShadow([first],[{...d,metrics:{spend:300}}],{now:NOW+60000,day:'2026-11-09'});
 assert.deepEqual([again.ruleVersion,again.firstMetrics.spend,again.metrics.spend],[V,50,300],'first numbers frozen, rolling ones still update');
 const [legacy]=mergeShadow([{...first,ruleVersion:undefined,firstMetrics:undefined}],[d],{now:NOW+120000,day:'2026-11-09'});
 assert.deepEqual([legacy.ruleVersion,legacy.firstMetrics],[null,null],'an entry born before the stamp is never re-stamped');
 assert.equal(entryRuleVersion({firstAt:'2026-11-09T10:00:00Z'}),2,'born after v2 went live (08/11 18:48 UTC): v2');
 assert.equal(entryRuleVersion({firstAt:'2026-11-08T14:00:00Z'}),null,'born before: unknown');
 const graded=(v,firstAt='2026-11-01T00:00:00Z')=>({rule:'bad-day-reduce',ruleVersion:v,firstAt,grade:{verdict:'acertou'}});
 assert.deepEqual(ruleAccuracy([graded(V),graded(V-1),graded(undefined)],'bad-day-reduce'),{graded:1,right:1,accuracy:1},'only the current version counts');
 assert.deepEqual(ruleAccuracy([graded(undefined,'2026-11-09T01:00:00Z')],'bad-day-reduce').graded,V===2?1:0,'an unstamped v2-era decision still counts while v2 is current');
 // A campaign shared by two projects is one decision, not two; a miss in either copy wins.
 const copy=(project,verdict)=>({rule:'bad-day-reduce',ruleVersion:V,project,day:'2026-11-08',objectId:'c1',action:'budget',grade:{verdict}});
 assert.deepEqual(ruleAccuracy([copy(P,'acertou'),copy(Q,'acertou')],'bad-day-reduce'),{graded:1,right:1,accuracy:1});
 assert.deepEqual(ruleAccuracy([copy(P,'acertou'),copy(Q,'errou')],'bad-day-reduce'),{graded:1,right:0,accuracy:0});
 const st=learningStats(shardsOf(mergeLearning(new Map(),learningRecords([cut({id:'s1',project:P}),cut({id:'s2',project:Q,grade:{verdict:'errou',basis:'next'}})]),{now:NOW}).put),{now:NOW});
 assert.deepEqual([st.rules['bad-day-reduce'].graded,st.rules['bad-day-reduce'].right,st.rules['bad-day-reduce'].currentVersion.graded],[1,0,1],'memory counts the shared decision once, the miss wins');
 assert.deepEqual([st.rules['bad-day-reduce'].projects[P].graded,st.rules['bad-day-reduce'].projects[Q].graded],[1,1],'each project keeps its own copy');
});

test('Only final grades become records; version, target day, who came first and first-flag spend are kept',()=>{
 const night=cut({id:'n',rule:'night-increase',after:{dailyBudget:200},grade:{verdict:'acertou',basis:'day',day:{roi:2}}});
 const blocked=cut({id:'b1',action:'status',rule:'test-no-sale',before:{status:'ACTIVE'},after:{status:'PAUSED'},firstWouldExecuteAt:'2026-11-05T16:00:00Z',manager:{at:'2026-11-05T15:30:00Z'}});
 const before=cut({id:'b0',manager:{at:'2026-11-05T14:00:00Z'}});
 const followed=cut({id:'f',firstWouldExecuteAt:'2026-11-05T16:00:00Z',manager:{at:'2026-11-05T17:00:00Z'},owner:{at:'2026-11-05T17:00:00Z'}});
 const out=learningRecords([cut(),night,blocked,before,followed,cut({id:'o',grade:{verdict:'N/D'}}),cut({id:'g',grade:undefined}),cut({id:'b',day:'ontem'}),cut({id:'old',ruleVersion:undefined})]);
 assert.equal(out.length,6,'N/D, ungraded and malformed stay out');
 const [r,n,bl,bf,f,old]=out;
 assert.deepEqual([r.kind,r.target,r.verdict,r.spend,r.roi,r.manager,r.rv],['reduce','2026-11-06','acertou',120,0.5,null,V],'spend of the first flag, never the last');
 assert.deepEqual([n.kind,n.target,n.roi],['increase','2026-11-05',2],'night increase reads D itself');
 assert.equal(bl.manager,'blocked','the Sombra pointed it out first but could not execute yet');
 assert.equal(bf.manager,'before','the manager acted before the first flag');
 assert.deepEqual([f.manager,f.owner],['after',true]);
 assert.equal(old.rv,null,'unversioned entries never count as current');
 assert.equal(r.obj,learningRecords([cut({id:'other-day',day:'2026-11-06'})])[0].obj,'same campaign, same cluster key');
 assert.ok(!JSON.stringify(out).includes('c1'),'no object id or name is needed to learn');
});

test('Daily base: only campaigns that already ran before the day; warm-up, first spend and unaligned 3d out',()=>{
 const y=win('yesterday',P,'2026-11-06','2026-11-07',[row(),row({externalId:'c2',revenueNet:300}),row({externalId:'c3',spend:0}),row({externalId:'c4',name:'[AQUECIMENTO] perfil',revenueNet:0}),row({externalId:'c5',productCost:null}),row({externalId:'c6',provider:'kwai'}),row({externalId:'new',revenueNet:0})]);
 const d3=win('3d',P,'2026-11-04','2026-11-07',[row({spend:300}),row({externalId:'c2',spend:250}),row({externalId:'new',spend:100})]);
 assert.deepEqual(dailyBases([y,d3]),[{day:'2026-11-06',project:P,campaigns:2,loss:1,profit:1}],'"new" spent only that day: it could not be decided on');
 assert.deepEqual(dailyBases([y]),[],'no aligned 3d window: no base rather than a contaminated one');
 assert.deepEqual(dailyBases([y,{...d3,to:'2026-11-06T03:00:00.000Z'}]),[]);
 assert.deepEqual(dailyBases([{...y,complete:false},d3]),[]);
});

test('Memory shards: upsert by id, base frozen at first reading, caps counted, retention',()=>{
 const recs=learningRecords([cut({id:'1'}),cut({id:'2',grade:{verdict:'errou',basis:'next',next:{roi:2},winnerCut:true}})]);
 const base=[{day:'2026-11-05',project:P,campaigns:4,loss:1,profit:3}];
 assert.deepEqual(learningKeys(recs,base),[learningKey('2026-11-05',P)]);
 const first=mergeLearning(new Map(),recs,{now:NOW,bases:base});
 const k=learningKey('2026-11-05',P),s=first.put[k];
 assert.deepEqual([Object.keys(s.records).length,s.base.campaigns],[2,4]);
 assert.deepEqual(mergeLearning(new Map([[k,s]]),recs,{now:NOW,bases:base}).put,{},'nothing new, nothing written');
 assert.deepEqual(mergeLearning(new Map([[k,s]]),[],{now:NOW,bases:[{...base[0],loss:3}]}).put,{},'a later reading never rewrites the base');
 assert.deepEqual(Object.keys(mergeLearning({[k]:s},recs,{now:NOW}).put),[],'plain objects work as the store too');
 const old=mergeLearning(new Map(),learningRecords([cut({id:'z',day:'2026-07-01'})]),{now:NOW,keys:[learningKey('2026-07-01',P),teamKey('2026-07-01',P),k,'learningSummary']});
 assert.deepEqual([Object.keys(old.put),old.drop],[[],[learningKey('2026-07-01',P),teamKey('2026-07-01',P)]],'past retention: not stored, dropped (team shards too)');
 const many=learningRecords(Array.from({length:learningPolicy.maxRecordsPerShard+5},(_,i)=>cut({id:'n'+i})));
 const capped=mergeLearning(new Map(),many,{now:NOW}).put[k];
 assert.deepEqual([Object.keys(capped.records).length,capped.full],[learningPolicy.maxRecordsPerShard,true],'shard flagged full, never silently');
 assert.deepEqual(mergeLearning(new Map([[k,capped]]),learningRecords([cut({id:'late'})]),{now:NOW}).put,{},'flagged once: not rewritten every pass');
});

test('Stats: range, edge over picking any campaign, campaigns behind the claim, honest lessons',()=>{
 // 12 reductions on 12 campaigns over 4 days (9 right); 25% of the campaigns that could be cut lost on those days.
 const day=i=>'2026-11-0'+(4+i%4),p=Array.from({length:12},(_,i)=>cut({id:'p'+i,objectId:'c'+i,day:day(i),grade:{verdict:i<9?'acertou':'errou',basis:'next',next:{roi:i<9?0.5:2},winnerCut:i>=9}}));
 // 6 increases in Q, 3 right, on days where 75% of the campaigns made money anyway.
 const q=Array.from({length:6},(_,i)=>cut({id:'q'+i,rule:'morning-increase',project:Q,objectId:'q'+i,after:{dailyBudget:130},grade:{verdict:i<3?'acertou':'errou',basis:'next',next:{roi:1}}}));
 const bases=['2026-11-05','2026-11-06','2026-11-07','2026-11-08'].map(d=>({day:d,project:P,campaigns:4,loss:1,profit:3})).concat([{day:'2026-11-06',project:Q,campaigns:4,loss:1,profit:3}]);
 const st=learningStats(shardsOf(mergeLearning(new Map(),learningRecords([...p,...q]),{now:NOW,bases}).put),{now:NOW,names:{[Q]:'Projeto Q'}});
 const r=st.rules['bad-day-reduce'],m=st.rules['morning-increase'];
 assert.deepEqual([r.graded,r.right,r.accuracy,r.base.expected,r.base.edge,r.campaigns,r.days],[12,9,0.75,0.25,0.5,12,4]);
 assert.ok(r.low>0.45&&r.high<0.95,'honest range, not a point');
 assert.ok(r.base.chanceBetter>0.99);
 assert.deepEqual([m.accuracy,m.base.expected],[0.5,0.75]);
 assert.ok(m.base.chanceBetter<0.2,'raising here did worse than raising any campaign');
 const kinds=st.lessons.map(l=>l.kind);
 assert.ok(kinds.includes('vantagem')&&kinds.includes('sem-vantagem')&&kinds.includes('vencedor'),kinds.join(','));
 const edge=st.lessons.find(l=>l.kind==='vantagem').text;
 assert.match(edge,/acerta 75% \(faixa provável \d+–\d+%\) contra 25% de cortar uma campanha qualquer do projeto no mesmo dia, em 12 decisões de 12 campanhas \(chance de escolher melhor: 95% ou mais\)/);
 assert.match(st.lessons.find(l=>l.kind==='sem-vantagem').text,/aumentar uma campanha qualquer do projeto no mesmo dia acertaria 75%/);
 assert.ok(st.lessons.every(l=>!/garant|100%|não fazer nada/.test(l.text)),'no promise of certainty, no "doing nothing" framing');
 assert.match(st.lessons.find(l=>l.kind==='vencedor').text,/apontou corte em 3 decisões \(3 campanhas\) que deram ROI ≥ 1,2/);
 // The same campaign flagged 12 times is one campaign: no edge claim.
 const one=learningStats(shardsOf(mergeLearning(new Map(),learningRecords(p.map(e=>({...e,objectId:'same'}))),{now:NOW,bases}).put),{now:NOW});
 assert.ok(!one.lessons.some(l=>l.kind==='vantagem'),'edge needs distinct campaigns');
 // Shrinkage: a small project far from the rule is pulled toward it.
 const mixed=learningStats(shardsOf(mergeLearning(new Map(),learningRecords([...p,cut({id:'x1',project:Q,grade:{verdict:'errou',basis:'next'}}),cut({id:'x2',project:Q,grade:{verdict:'errou',basis:'next'}})]),{now:NOW}).put),{now:NOW});
 const small=mixed.rules['bad-day-reduce'].projects[Q];
 assert.ok(small.accuracy===0&&small.shrunk>0.5,'2 misses alone do not make the rule 0% in that project');
 // Project scope: its own lessons and days, never another project's.
 assert.deepEqual(st.memory.byProject[Q],{days:1,from:'2026-11-05'});
 assert.ok(st.projectLessons[Q].every(l=>/em Projeto Q/.test(l.text)));
 const bq=learningBrief(st,{project:Q});
 assert.deepEqual([bq.days,bq.graded],[1,6]);
 assert.ok(bq.lessons.every(t=>/Projeto Q/.test(t)));
});

test('Who acted first is read honestly: a blocked Sombra flag is not "the manager was earlier"',()=>{
 const l=Array.from({length:4},(_,i)=>cut({id:'m'+i,objectId:'m'+i,rule:'morning-increase',after:{dailyBudget:130},manager:{at:'2026-11-05T16:00:00Z'}}));
 const st=learningStats(shardsOf(mergeLearning(new Map(),learningRecords(l),{now:NOW}).put),{now:NOW});
 assert.deepEqual([st.rules['morning-increase'].managerBefore,st.rules['morning-increase'].managerBlocked],[0,4]);
 assert.ok(!st.lessons.some(x=>x.kind==='atrasada'));
 assert.match(st.lessons.find(x=>x.kind==='antecipou').text,/a Sombra apontou antes da equipe em 4 casos, 4 deles ainda só como sugestão/);
});

test('Blind spots come from people\'s moves: cuts never pointed out, where the Sombra was evaluating',()=>{
 const a=(i,over={})=>({id:'t'+i,day:'2026-11-08',project:Q,who:'team',name:'Ana Souza',kind:'pause',at:'2026-11-08T15:00:00Z',shadow:{flagged:false,cutFlagged:false},...over});
 const team={kind:'team',day:'2026-11-08',project:Q,actions:Object.fromEntries([a(1),a(2,{kind:'reduce'}),a(3,{shadow:{flagged:false,cutFlagged:true,leadMin:30}}),a(4,{who:'owner',name:'Você'}),a(5,{kind:'increase'}),a(6,{at:'2026-11-01T10:00:00Z',day:'2026-11-01'})].map(x=>[x.id,x]))};
 const st=learningStats([team],{now:NOW,names:{[Q]:'Projeto Q'},coverage:{[Q]:['2026-11-08T15','2026-11-08T14']}});
 assert.deepEqual([st.blindSpots.total,st.blindSpots.increases],[3,1],'a reduce flag covers a pause; raises apart; before coverage out');
 assert.deepEqual(st.blindSpots.byProject[Q],{pause:2,reduce:1,increase:1,owner:1,manager:2});
 assert.match(st.lessons.find(l=>l.kind==='ponto-cego').text,/^Cortes de gestor ou seus sem aviso antes da Sombra \(7 dias\): Projeto Q 3\./);
 assert.match(st.projectLessons[Q].find(l=>l.kind==='ponto-cego').text,/3 cortes de gestor ou seu sem aviso antes da Sombra em 7 dias \(2 pausas, 1 redução\)/);
 assert.equal(learningStats([team],{now:NOW,coverage:{}}).blindSpots.total,0,'never claimed where the Sombra was not evaluating');
});

test('Gate: the 7-day count decides; the memory can only keep a rule as a suggestion',()=>{
 const memory=(graded,right,over={})=>({version:learningPolicy.version,ruleVersion:V,at:new Date(NOW-60000).toISOString(),rules:{'bad-day-reduce':{currentVersion:{version:V,graded,right,accuracy:right/graded}}},...over});
 const week={graded:20,right:13,accuracy:0.65};
 assert.deepEqual(gateAccuracy(memory(40,20),'bad-day-reduce',week,{now:NOW}),{graded:40,right:20,accuracy:0.5,source:'memory'},'a good week does not open a rule whose record is below 60%');
 assert.deepEqual(gateAccuracy(memory(40,30),'bad-day-reduce',week,{now:NOW}),week,'record fine: the owner\'s count');
 const weak={graded:8,right:6,accuracy:0.75};
 assert.deepEqual(gateAccuracy(memory(80,70),'bad-day-reduce',weak,{now:NOW}),weak,'never opens earlier than the 7 days');
 assert.deepEqual(gateAccuracy(memory(10,2),'bad-day-reduce',week,{now:NOW}),week,'too few decisions to veto');
 // Fails closed: with the week proven, a stale, foreign or missing memory keeps the rule a suggestion for that pass.
 const closed={graded:20,right:13,accuracy:null,source:'memory-unavailable'};
 assert.deepEqual(gateAccuracy(memory(40,20,{at:new Date(NOW-3*3600000).toISOString()}),'bad-day-reduce',week,{now:NOW}),closed,'age never lifts a veto');
 assert.deepEqual(gateAccuracy(memory(40,30,{at:new Date(NOW-3*3600000).toISOString()}),'bad-day-reduce',week,{now:NOW}),closed,'stale: closed until rebuilt');
 assert.deepEqual(gateAccuracy(memory(40,20,{version:1}),'bad-day-reduce',week,{now:NOW}),closed,'memory of another format');
 assert.deepEqual(gateAccuracy(memory(40,20,{ruleVersion:V-1}),'bad-day-reduce',week,{now:NOW}),closed,'memory built for other rules');
 assert.deepEqual(gateAccuracy(null,'bad-day-reduce',week,{now:NOW}),closed,'no memory yet');
 assert.deepEqual(gateAccuracy(memory(40,20,{at:new Date(NOW+3600000).toISOString()}),'bad-day-reduce',week,{now:NOW}),closed,'a summary from the future is not trusted');
 const noRule=memory(40,20);delete noRule.rules['bad-day-reduce'];
 assert.deepEqual(gateAccuracy(noRule,'bad-day-reduce',week,{now:NOW}),week,'a fresh memory without decisions of this rule cannot veto');
 assert.deepEqual(gateAccuracy(memory(20,12),'bad-day-reduce',{graded:20,right:12,accuracy:0.6},{now:NOW}),{graded:20,right:12,accuracy:0.6},'exactly 60% passes');
 const almost=gateAccuracy(memory(2000,1199),'bad-day-reduce',week,{now:NOW});
 assert.equal(almost.source,'memory','59.95% is below 60%: no rounding up');
 assert.equal(gateAccuracy(null,'bad-day-reduce',null),null);
 assert.deepEqual(gateAccuracy(memory(40,20),'bad-day-reduce',weak,{now:NOW}),weak,'nothing to veto while the week has not passed');
});

test('The gate message says why a rule stays a suggestion',async()=>{
 const {evaluateShadow}=await import('../lib/autonomy-shadow.mjs');
 void evaluateShadow;
 const src=(await import('node:fs')).readFileSync(new URL('../lib/autonomy-shadow.mjs',import.meta.url),'utf8');
 assert.match(src,/memória longa da Sombra está indisponível ou desatualizada/);
 assert.match(src,/o histórico longo desta regra está abaixo de/);
});

test('The executor wires the memory, the team moves and the notch',async()=>{
 const fs=await import('node:fs');
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.match(src,/gateAccuracy\(learned,rule,ruleAccuracy\(prior,rule\),\{now\}\)/,'gate: 7-day count first, memory as a veto');
 assert.match(src,/await this\.storeLearning\(withAuthors,merged,events,policy,now,evaluated\)\.catch\(/,'a memory failure never breaks the shadow');
 assert.match(src,/prefix:'learn:'/);
 assert.match(src,/learning:await this\.ctx\.storage\.get<any>\('learningSummary'\)/,'shadow read');
 assert.match(src,/learning:learningBrief\(learned,\{project\}\)/,'notch summary per scope');
 assert.match(src,/teamActions\(\{attributions:state\.changeAttributions/,'people\'s moves are learned from the raw feed');
 assert.match(src,/learnedStatus\?\.ok===false/,'a failed memory rebuild is not trusted by the gate');
 assert.ok(!/learningSummary[^\n]*dispatch|storeLearning[^\n]*submit/.test(src),'memory never dispatches');
 const swift=fs.readFileSync(new URL('../mac/BunkerNotch/Sources/BunkerNotch/Summary.swift',import.meta.url),'utf8');
 assert.match(swift,/var learning: ShadowLearning\? = nil/,'older servers without the field still decode');
 assert.match(swift,/var team: \[String\]\? = nil/);
});

test('End to end in the executor: memory, team moves, blind spot, retention, gate veto and a second pass',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm'),ts=(await import('typescript')).default;
 const shadowLib=await import('../lib/autonomy-shadow.mjs'),captured=[];
 const spy={...shadowLib,evaluateShadow:(state,opts)=>{captured.push(opts.accuracy);return shadowLib.evaluateShadow(state,opts);}};
 const mods={'autonomy-grant':await import('../lib/autonomy-grant.mjs'),'autonomy-shadow':spy,'campaign-activity':await import('../lib/campaign-activity.mjs'),'change-attribution':await import('../lib/change-attribution.mjs'),
  'companion-summary':await import('../lib/companion-summary.mjs'),'daily-series':await import('../lib/daily-series.mjs'),'meta-display':await import('../lib/meta-display.mjs'),'shadow-learning':await import('../lib/shadow-learning.mjs'),'team-learning':await import('../lib/team-learning.mjs')};
 const compiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const store={},exports={};
 const storage={get:async k=>Array.isArray(k)?new Map(k.filter(x=>x in store).map(x=>[x,store[x]])):store[k],list:async({prefix})=>new Map(Object.entries(store).filter(([k])=>k.startsWith(prefix))),put:async(k,v)=>{if(typeof k==='object')Object.assign(store,k);else store[k]=v;},delete:async keys=>{for(const k of [].concat(keys))delete store[k];},setAlarm:async()=>{}};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 // Map is shared with the vm so the storage's Map behaves as in workerd.
 vm.runInNewContext(compiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:Object.entries(mods).find(([k])=>name.includes(k))?.[1]||{},Date,Response,Intl,Map,setInterval,clearInterval,structuredClone});
 const e=new exports.BunkerCloudExecutor({storage},{AUTONOMY_SHADOW_POLICY:JSON.stringify({projects:{[P]:{pauseTestMinSpend:100}}})});
 // 22 graded reductions of the current rules, on 22 campaigns, 3 to 20 days ago (older ones left the 7-day store).
 const graded=Array.from({length:22},(_,i)=>{const day=new Date(NOW-(3+i%18)*86400000).toISOString().slice(0,10);
  return cut({id:'g'+i,objectId:'g'+i,day,firstAt:day+'T15:00:00Z',lastAt:new Date(NOW-3600000).toISOString(),grade:{verdict:i%4?'acertou':'errou',basis:'next',next:{roi:i%4?0.5:2},day:{roi:1}}});});
 for(const g of graded)store['shadow:'+g.id]=g;
 // Memory says the rule is weak overall (20 of 40); the week alone would pass (16 of 22 = 73%).
 store.learningSummary={version:learningPolicy.version,ruleVersion:V,at:new Date(NOW-15*60000).toISOString(),rules:{'bad-day-reduce':{currentVersion:{version:V,graded:40,right:20}}}};
 store[learningKey('2026-07-01',P)]={day:'2026-07-01',project:P,records:{},base:null};
 store[learningKey('2026-11-07',P)]={day:'2026-11-07',project:P,records:{},base:{campaigns:9,loss:1,profit:8}};
 // A manager's pause (Malva feed), 30 min ago, on a campaign the Sombra never pointed out.
 store.learningCoverage={[P]:['2026-11-09T13','2026-11-09T14']};
 store['attr:history:'+P+':ev1']={key:'history:'+P+':ev1',project:P,adAccountId:'a1',objectId:'n1',name:'09/11 [TESTE] n1',accountName:'Conta',field:'status',before:'ACTIVE',after:'PAUSED',currency:'BRL',at:new Date(NOW-30*60000).toISOString(),checkedAt:new Date(NOW-29*60000).toISOString(),actor:'Ana Souza',automatic:false,eventId:'ev1',source:'malva',matched:true,feedVersion:2};
 const today=win('today',P,'2026-11-09','2026-11-10',[row({externalId:'n1',name:'09/11 [TESTE] n1',status:'PAUSED',effectiveStatus:'PAUSED',revenueNet:0,frontOrders:0,orders:0,checkouts:0,spend:70})],{fetchedAt:new Date(NOW-60000).toISOString(),lastSyncAt:new Date(NOW-120000).toISOString()});
 const state={config:{[P]:{projectName:'Fictício'}},snapshots:[today,win('yesterday',P,'2026-11-07','2026-11-08',[row(),row({externalId:'c2',revenueNet:300}),row({externalId:'c3',revenueNet:10})]),win('3d',P,'2026-11-05','2026-11-08',[row({spend:300}),row({externalId:'c2',spend:300}),row({externalId:'c3',spend:300})])]};
 const real=Date.now;Date.now=()=>NOW;
 try{await e.storeShadow(state);}finally{Date.now=real;}
 assert.equal(store.learningStatus?.ok,true,JSON.stringify(store.learningStatus));
 const gate=captured[0]['bad-day-reduce'];
 assert.deepEqual([gate.graded,gate.right,gate.source],[40,20,'memory'],'the memory vetoes a rule whose record is below 60%');
 assert.equal(store[learningKey('2026-07-01',P)],undefined,'past retention: deleted');
 assert.deepEqual(store[learningKey('2026-11-07',P)].base,{campaigns:3,loss:2,profit:1},'a base of the old definition is replaced once by the current one');
 assert.equal(store[learningKey('2026-11-07',P)].bv,learningPolicy.baseVersion);
 assert.ok(store.learningCoverage[P].includes('2026-11-09T15'),'this pass marks the hour as watched');
 const s=store.learningSummary;
 assert.deepEqual([s.rules['bad-day-reduce'].graded,s.rules['bad-day-reduce'].right,s.rules['bad-day-reduce'].currentVersion.graded],[22,16,22]);
 const teamShard=store[teamKey('2026-11-09',P)];
 const moves=Object.values(teamShard.actions);
 assert.deepEqual(moves.map(a=>[a.name,a.kind,a.ctx.today.spend,a.guard.level]),[['Ana Souza','pause',70,'watch']]);
 assert.equal(s.blindSpots.total,1,'her pause had no Sombra flag: one blind spot');
 assert.ok(store.learningDirty===undefined,'news marker cleared after the rebuild');
 // Second pass: everything is read back; nothing doubles.
 Date.now=()=>NOW+60000;
 try{await e.storeShadow(state);}finally{Date.now=real;}
 assert.equal(Object.keys(store[teamKey('2026-11-09',P)].actions).length,1,'one move, not two');
 assert.equal(store.learningStatus.summarized,false,'no news: no rebuild a minute later');
 assert.equal(learningBrief(store.learningSummary,{project:P}).graded,22);
});
