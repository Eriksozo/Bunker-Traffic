import test from 'node:test';
import assert from 'node:assert/strict';
import {playbookStore,runPlaybookShadow,runPlaybookLearning,runPlaybookBackfill,playbookRunnerPolicy as R} from '../lib/playbook-runner.mjs';
import {backfillTeamHistory} from '../lib/activity-history.mjs';
import {binsKey,obsKey,binCells} from '../lib/team-observations.mjs';
import {pbsDayPrefix} from '../lib/playbook-eval.mjs';
import {memoryStorage,syntheticDays,iso,dayStart,shift,TZ,people,pid} from './helpers/playbook-fixtures.mjs';

// Modo Gestor runner (contract c.2–c.8). Synthetic fixtures only: invented people, projects, campaigns and amounts.
const P='proj-1',D='2026-11-09',NOW=dayStart(D)+15*3600000,project={id:P,name:'Projeto Um',timezone:TZ};
const deadline=ms=>({deadline:Date.now()+ms});
// A raw Malva history item, as tracking_ad_changes returns it.
const raw=(id,at,{who='ana',kind='status',obj='c1',from='active',to='paused',actor=null}={})=>({id,at,source:'malva',category:kind==='status'?'status':'budget',automatic:false,app:'malva',
 actor:actor||{key:people[who].key,kind:'malva',name:people[who].name,profile:null},object:{level:'campaign',externalId:obj,name:'Campanha '+obj},account:{id:'acc-1',label:'Conta',provider:'meta',currency:'BRL'},
 values:kind==='status'?{kind:'status',from,to}:{kind:'money',field:'daily_budget',from,to,currency:'BRL'}});
const window30={from:iso(dayStart(shift(D,-30))),to:iso(dayStart(D)),timezone:TZ};
const page=(items,cursor=null)=>({timezone:TZ,period:window30,items,nextCursor:cursor});
function source(pages){const calls=[];return {calls,async read(tool,args){calls.push({tool,args});if(tool!=='tracking_ad_changes')throw Object.assign(Error('PLAYBOOK_SOURCE_DENIED'),{code:'PLAYBOOK_SOURCE_DENIED'});if(!pages.length)throw Error('unexpected call');const p=pages.shift();if(p instanceof Error)throw p;return p;}};}
const baseState=()=>({config:{[P]:{projectName:'Projeto Um'}},snapshots:[],proposals:[],executions:[],changeAttributions:[]});

test('Backfill: read-only, people only, the 30 closed days, ≤2 pages per pulse, cursor after the write, zero calls when complete',async()=>{
 const items1=[raw('e3',iso(dayStart(shift(D,-2))+15*3600000)),raw('e2',iso(dayStart(shift(D,-3))+14*3600000),{who:'bruno',kind:'budget',from:400,to:320})];
 const items2=[raw('e1',iso(dayStart(shift(D,-20))+11*3600000),{who:'ana'})];
 const items3=[raw('e0',iso(dayStart(shift(D,-29))+10*3600000),{who:'bruno',kind:'budget',from:300,to:390})];
 const src=source([page(items1,'k1'),page(items2,'k2'),page(items3,null)]);
 const storage=memoryStorage(),store=playbookStore(storage);
 const a=await runPlaybookBackfill(store,src,{projects:[project],now:NOW},deadline(2000));
 assert.deepEqual([a.ok,a.calls,a.project,a.moves,a.complete],[true,2,P,3,false]);
 assert.deepEqual(src.calls.map(c=>c.tool),['tracking_ad_changes','tracking_ad_changes']);
 assert.deepEqual(src.calls[0].args,{projectId:P,provider:['meta'],who:'people',level:['campaign'],category:['budget','status'],limit:100,preset:'custom',from:shift(D,-30),to:shift(D,-1)});
 assert.equal(src.calls[1].args.cursor,'k1');
 const st=storage.map.get('pb:backfill:'+P);assert.deepEqual([st.complete,st.cursor,st.pages,st.moves],[false,'k2',2,3]);
 assert.ok(storage.map.get(`pb:bf:${shift(D,-2)}:${P}`).events.some(e=>e.eventId==='e3'&&e.actorInfo?.kind==='malva'));
 const b=await runPlaybookBackfill(store,src,{projects:[project],now:NOW+3600000},deadline(2000));
 assert.deepEqual([b.calls,b.complete],[1,true]);assert.equal(storage.map.get('pb:backfill:'+P).complete,true);
 const c=await runPlaybookBackfill(store,source([]),{projects:[project],now:NOW+7200000},deadline(2000));
 assert.deepEqual([c.ok,c.calls,c.project,c.complete],[true,0,null,true],'complete: zero calls');
});

test('Backfill: a Malva error keeps the cursor, records failedAt/code and waits before retrying; stillEnabled stops it',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage);
 const src=source([page([raw('e1',iso(dayStart(shift(D,-5))+15*3600000))],'k1'),Object.assign(Error('Malva fora'),{code:'SOURCE_UNAVAILABLE'})]);
 const r=await runPlaybookBackfill(store,src,{projects:[project],now:NOW},deadline(2000));
 assert.deepEqual([r.ok,r.code,r.calls],[false,'PLAYBOOK_BACKFILL_READ',2]);
 const st=storage.map.get('pb:backfill:'+P);
 assert.deepEqual([st.complete,st.cursor??null,st.code,st.failedAt],[false,null,'PLAYBOOK_BACKFILL_READ',iso(NOW)],'no cursor advanced: the pages are read again later (read-only)');
 assert.ok(![...storage.map.keys()].some(k=>k.startsWith('pb:bf:')),'nothing half-written');
 // Retry window: the next pulse within 15 min makes no call.
 const quiet=source([]);assert.equal((await runPlaybookBackfill(store,quiet,{projects:[project],now:NOW+60000},deadline(2000))).calls,0);
 // Turned off between reads: no further read.
 const off=source([page([],null)]);let n=0;
 const r2=await runPlaybookBackfill(playbookStore(memoryStorage()),off,{projects:[project],now:NOW,stillEnabled:()=>++n<1},deadline(2000));
 assert.equal(r2.calls,0);assert.equal(off.calls.length,0);
 // An identity mismatch (another timezone) never stores anything.
 const wrong=source([{...page([]),timezone:'Europe/Lisbon'}]),s3=memoryStorage();
 const r3=await runPlaybookBackfill(playbookStore(s3),wrong,{projects:[project],now:NOW},deadline(2000));
 assert.equal(r3.code,'PLAYBOOK_BACKFILL_IDENTITY');assert.ok(![...s3.map.keys()].some(k=>k.startsWith('pb:bf:')));
 // The executor's wrapper refuses a third read and any other tool before it reaches Malva.
 let calls=0;const malva={read:async()=>page([],'next')},wrapped={read:(tool,args)=>tool==='tracking_ad_changes'&&++calls<=2?malva.read(tool,args):Promise.reject(Object.assign(Error('PLAYBOOK_SOURCE_DENIED'),{code:'PLAYBOOK_SOURCE_DENIED'}))};
 await assert.rejects(()=>wrapped.read('tracking_campaigns',{}),e=>e.code==='PLAYBOOK_SOURCE_DENIED');
 const lib=await backfillTeamHistory(wrapped,project,null,{now:()=>NOW,pages:5});assert.equal(lib.calls,2,'the library itself never asks for more than 2 pages');
});

test('Backfilled moves fold into bins as day-level moves (intraday N/D), counted in memory, Bunk/automation excluded',async()=>{
 // Newest first, as Malva returns them.
 const items=[raw('au',iso(dayStart(shift(D,-2))+17*3600000),{actor:{key:'automacao:fake',kind:'automation',name:'Automação: corta'}}),
  raw('e2',iso(dayStart(shift(D,-2))+16*3600000),{who:'bruno',kind:'budget',from:400,to:320}),raw('e3',iso(dayStart(shift(D,-2))+15*3600000))];
 const storage=memoryStorage(),store=playbookStore(storage);
 await runPlaybookBackfill(store,source([page(items,null)]),{projects:[project],now:NOW},deadline(2000));
 for(let i=0;i<10;i++)await runPlaybookLearning(store,{state:baseState(),now:NOW+i*1000,projects:[P],names:{[P]:'Projeto Um'},zone:()=>TZ},deadline(3000));
 const bin=storage.map.get(binsKey(shift(D,-2),P));assert.ok(bin,'the backfilled day has a bin');
 assert.deepEqual([bin.people[pid('ana')].pause,bin.people[pid('bruno')].reduce,bin.bf],[1,1,2]);
 assert.deepEqual(bin.steps.reduce.map(s=>[s[0],s[2]]),[[-0.2,1]],'steps come from backfill (flagged), for the step estimate only');
 assert.deepEqual(bin.cells,[],'no reading behind them: no feature cell, nothing to fit thresholds on');
 assert.deepEqual(bin.excluded,{automation:1});
 const view=storage.map.get('pb:view');
 assert.deepEqual(view.memory.peopleMoves.map(p=>[p.name,p.moves]).sort(),[['Ana Souza',1],['Bruno Lima',1]]);
 assert.equal(view.memory.backfill[P].complete,true);assert.equal(view.memory.excluded.byReason.automation,1);
 assert.ok(view.memory.days>=2&&view.memory.from===shift(D,-2));
 assert.doesNotMatch(JSON.stringify(view),/malva:fake/,'raw Malva member keys never leave the stored moves');
});

test('Live day: hourly readings, labels from the team shards after 90 min, fold after the day closes',async()=>{
 const row=(id,name,m)=>({id:'u-'+id,externalId:id,adAccountId:'acc-1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:0,impressions:1000,linkClicks:20,...m});
 const at=h=>dayStart(D)+h*3600000;
 const stateAt=h=>({...baseState(),snapshots:[{projectId:P,period:'today',level:'campaign',source:'Malva MCP',timezone:TZ,complete:true,from:iso(dayStart(D)),to:iso(dayStart(D)+86400000),fetchedAt:iso(at(h)-60000),lastSyncAt:iso(at(h)-60000),
  rows:[row('t1','09/11 - [TESTE] A',{spend:h*20}),row('t2','09/11 - [TESTE] B',{spend:h*10})]}]});
 const storage=memoryStorage(),store=playbookStore(storage);
 for(const h of [10,11,12])await runPlaybookShadow(store,{state:stateAt(h),liveItems:[],events:[],now:at(h)+60000,projects:[{project:P,params:{ticketFront:100},day:D}]},deadline(1000));
 assert.deepEqual([...storage.map.keys()].filter(k=>k.startsWith('pb:obs:')).sort(),[10,11,12].map(h=>obsKey(D,P,h)));
 // Ana paused t1 at 11:20; the team shard holds it (written by storeLearning before hook B).
 const shardKey=`learn:${D}:${P}:team`;
 storage.map.set(shardKey,{day:D,project:P,kind:'team',actions:{a1:{id:'a1',day:D,project:P,who:'team',name:'Ana Souza',person:pid('ana'),role:'team',kind:'pause',at:iso(at(11)+20*60000),adAccountId:'acc-1',objectId:'t1',minute:11*60+20,ctx:{}}}});
 await runPlaybookLearning(store,{state:stateAt(13),now:at(13)+30*60000,teamKeys:[shardKey],projects:[P],zone:()=>TZ},deadline(3000));
 const o10=storage.map.get(obsKey(D,P,10)),o11=storage.map.get(obsKey(D,P,11)),o12=storage.map.get(obsKey(D,P,12));
 const label=(o,obj)=>o.rows.find(r=>r[o.cols.indexOf('obj')]===obj)[o.cols.indexOf('label')];
 assert.deepEqual([label(o10,'t1'),label(o10,'t2'),label(o11,'t1'),label(o11,'t2')],['pause','manter','pause','manter']);
 assert.equal(o12.labeledAt,undefined,'the 12:00 reading is not 90 min old yet');
 // Next day, 02:00 local: the day is folded.
 for(let i=0;i<3;i++)await runPlaybookLearning(store,{state:baseState(),now:dayStart(shift(D,1))+2*3600000+i,teamKeys:[shardKey],projects:[P],zone:()=>TZ},deadline(3000));
 const bin=storage.map.get(binsKey(D,P));assert.ok(bin);
 const cells=binCells(bin);assert.ok(cells.some(c=>c.label==='pause'&&c.person===pid('ana')));assert.ok(cells.some(c=>c.label==='manter'));
 assert.equal(bin.people[pid('ana')].pause,1);
});

test('Retention and caps: old play decisions, readings and bins go oldest first; listings never exceed a page',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage);let maxLimit=0;const list=storage.list.bind(storage);storage.list=async o=>{maxLimit=Math.max(maxLimit,o.limit??Infinity);return list(o);};
 const old=shift(D,-10),recent=shift(D,-1);
 const e=(day,obj)=>({id:JSON.stringify([day,'pb:test-pause',P,'acc-1',obj,'status']),day,source:'playbook',project:P,rule:'pb:test-pause',playKey:'pb:test-pause@'+P,ruleRev:'v1:x',wouldExecute:false,firstWouldExecuteAt:null,action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},firstAt:iso(dayStart(day)),grade:null});
 for(let i=0;i<5;i++){const x=e(old,'o'+i);storage.map.set('pbs:'+x.id,x);}
 const keep=e(recent,'r1');storage.map.set('pbs:'+keep.id,keep);
 storage.map.set(obsKey(shift(D,-25),P,10),{v:1,at:iso(dayStart(shift(D,-25))),rows:[],cols:[]});storage.map.set(obsKey(shift(D,-2),P,10),{v:1,at:iso(dayStart(shift(D,-2))),rows:[],cols:[],labeledAt:iso(0)});
 storage.map.set(binsKey(shift(D,-95),P),{day:shift(D,-95),project:P,cells:[]});
 storage.map.set('shadow:["2026-10-01","x"]',{keep:true});storage.map.set('learn:2026-08-01:'+P,{keep:true});
 const r=await runPlaybookLearning(store,{state:baseState(),now:NOW,projects:[P],zone:()=>TZ},deadline(3000));
 assert.equal(r.ok,true);
 assert.deepEqual([...storage.map.keys()].filter(k=>k.startsWith('pbs:')),['pbs:'+keep.id],'7 days');
 assert.ok(!storage.map.has(obsKey(shift(D,-25),P,10))&&storage.map.has(obsKey(shift(D,-2),P,10)),'readings 21 days');
 assert.ok(!storage.map.has(binsKey(shift(D,-95),P)),'bins 90 days');
 assert.ok(storage.map.has('shadow:["2026-10-01","x"]')&&storage.map.has('learn:2026-08-01:'+P),'never touches the Sombra or the long memory');
 assert.ok(maxLimit<=R.listPage,String(maxLimit));
 assert.ok(pbsDayPrefix(old)<pbsDayPrefix(recent));
});

test('Views follow the contract: stages ≤ candidata, not adoptable, N/D as null; 60-day fixture within the time budget',async()=>{
 const projects=['p1','p2','p3','p4','p5','p6'],storage=memoryStorage(),store=playbookStore(storage);
 for(const [i,p] of projects.entries()){const {bins}=syntheticDays({days:60,from:'2026-09-10',project:p,campaigns:12,seed:i+1});for(const b of bins)storage.map.set(binsKey(b.day,p),b);}
 const state={config:Object.fromEntries(projects.map(p=>[p,{projectName:'Projeto '+p}])),snapshots:[],proposals:[],executions:[]};
 let worst=0,calls=0;
 for(;calls<80;calls++){
  const t0=performance.now(),r=await runPlaybookLearning(store,{state,now:NOW+calls*1000,projects,zone:()=>TZ},deadline(R.learnBudgetMs));worst=Math.max(worst,performance.now()-t0);
  assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.evals<=R.maxPredicateEvals,String(r.evals));
  if(storage.map.get('pb:model')?.fitAt&&!storage.map.get('pb:cursor').fit)break;
 }
 assert.ok(calls<80,'a full fit cycle completes');assert.ok(worst<1500,`worst call ${Math.round(worst)} ms`);
 const model=storage.map.get('pb:model');assert.ok(JSON.stringify(model).length<=R.modelMaxBytes);
 for(const p of projects){
  const v=storage.map.get('pb:view:'+p);assert.ok(v&&JSON.stringify(v).length<=R.maxValueBytes);
  assert.ok(['sem-dados','observando','com-candidatas'].includes(v.playbook.state));
  for(const play of v.playbook.plays){
   assert.ok(['observando','candidata'].includes(play.stage),play.stage);assert.equal(play.role,'challenger');assert.equal(play.adoptable,false);assert.equal(play.adoptHint,'chega na próxima fase');
   assert.ok(play.sentence.length<=140);assert.ok(play.caseRefs.length<=5);
   if(play.agreement.n===0)assert.deepEqual([play.agreement.precision,play.agreement.recall],[null,null],'N/D, never 0');
   if(play.support.moves<8)assert.ok(Object.values(play.params).every(x=>x===null),'no threshold below the support');
  }
  assert.ok(v.playbook.plays.length<=12&&v.playbook.divergences.length<=10);
 }
 assert.ok(storage.map.get('pb:versions:p1'));
 // Hook A on 80 campaigns: within its budget.
 const rows=Array.from({length:80},(_,i)=>({id:'u'+i,externalId:'c'+i,adAccountId:'acc-1',name:i%2?'Madura '+i:'09/11 - [TESTE] '+i,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:200,budgetCurrency:'BRL',budgetRate:1,spend:100+i,revenueNet:i*3,adCosts:0,productCost:0,saleTax:0,frontOrders:i%3,orders:i%3,checkouts:1}));
 const st={...state,snapshots:[{projectId:'p1',period:'today',level:'campaign',source:'Malva MCP',timezone:TZ,complete:true,from:iso(dayStart(D)),to:iso(dayStart(D)+86400000),fetchedAt:iso(NOW-60000),lastSyncAt:iso(NOW-60000),rows}]};
 const t0=performance.now(),a=await runPlaybookShadow(store,{state:st,liveItems:[],events:[],now:NOW,projects:projects.map(p=>({project:p,params:{ticketFront:100},day:D}))},deadline(R.shadowBudgetMs));
 assert.equal(a.ok,true);assert.ok(performance.now()-t0<250,`hook A ${Math.round(performance.now()-t0)} ms`);
});

test('The kill switch and an exhausted deadline are clean no-ops',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage);
 const r=await runPlaybookLearning(store,{state:baseState(),now:NOW,projects:[P],zone:()=>TZ},{deadline:Date.now()-1});
 assert.equal(r.ok,true);assert.equal(r.partial,true);
 const a=await runPlaybookShadow(store,{state:baseState(),liveItems:[],events:[],now:NOW,projects:[{project:P,day:D}]},{deadline:Date.now()-1});
 assert.equal(a.ok,true);
 assert.equal(Object.isFrozen(R)&&R.enabled,true,'one-line kill switch lives in the frozen policy');
});

test('Drift: agreement of the last 7 days ≥15 pp below the 7 before (two-proportion z) flags the play',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage),key='pb:test-pause@'+P;
 storage.map.set('pb:model',{v:1,fitAt:iso(NOW-3600000),fitDay:D,plays:{[key]:{id:'pb:test-pause',project:P,key,stage:'candidata',rev:'v1:aaaaaaaa',version:1,params:{k:2},step:null,generalized:[],sentence:'Pausar…',learnedFrom:[],support:{moves:40,campaigns:30,days:20,need:{moves:8,campaigns:4,days:3},missing:0},flags:[],challenger:null,caseRefs:[],outcome:null}},versions:{},divergences:{}});
 const days={};for(let i=1;i<=14;i++){const d=shift(D,-i);days[d]={'pb:test-pause':i<=7?{fired:20,agree:8,moves:20,caught:8,opposite:0,manter:12,leads:[],people:{}}:{fired:20,agree:18,moves:20,caught:18,opposite:0,manter:2,leads:[],people:{}}};}
 storage.map.set('pb:replay',{v:1,days:{[P]:days}});
 storage.map.set('pb:cursor',{v:1,replay:{[P]:shift(D,-1)}});
 await runPlaybookLearning(store,{state:baseState(),now:NOW,projects:[P],zone:()=>TZ},deadline(3000));
 const play=storage.map.get('pb:view:'+P).playbook.plays[0];
 assert.ok(play.flags.includes('drift'),JSON.stringify(play.flags));
 assert.deepEqual([play.agreement.n>0,play.wouldHave7d.total],[true,140]);
});

// ── Review fixes (10/11/2026): small index instead of re-reading readings, one write per project, shrink-to-fit writes,
// the challenger scored apart and never swapped in, one identity for old and new moves. ──
const liveRow=(id,name,m)=>({id:'u-'+id,externalId:id,adAccountId:'acc-1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:0,impressions:1000,linkClicks:20,...m});
const liveState=(h,rows)=>({...baseState(),snapshots:[{projectId:P,period:'today',level:'campaign',source:'Malva MCP',timezone:TZ,complete:true,from:iso(dayStart(D)),to:iso(dayStart(D)+86400000),fetchedAt:iso(dayStart(D)+h*3600000-60000),lastSyncAt:iso(dayStart(D)+h*3600000-60000),rows}]});

test('Readings: hook A knows the written hours from pb:obs-index; hook B reads only the hours not labelled yet',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage),at=h=>dayStart(D)+h*3600000+60000;
 const rows=[liveRow('t1','09/11 - [TESTE] A',{spend:200})];
 for(const h of [10,11])await runPlaybookShadow(store,{state:liveState(h,rows),liveItems:[],events:[],now:at(h),projects:[{project:P,params:{ticketFront:100},day:D}]},deadline(1000));
 const ix=storage.map.get('pb:obs-index');assert.deepEqual(ix.days[P][D].w,[10,11]);assert.equal(ix.last[P].key,obsKey(D,P,11));
 // Same hour again: no second reading, and no reading value is fetched to find that out.
 const got=storage.get.bind(storage),asked=[];storage.get=async k=>{asked.push(...[].concat(k));return got(k);};
 const again=await runPlaybookShadow(store,{state:liveState(11,rows),liveItems:[],events:[],now:at(11)+120000,projects:[{project:P,params:{ticketFront:100},day:D}]},deadline(1000));
 assert.equal(again.obs,0);assert.ok(!asked.some(k=>k.startsWith('pb:obs:')),'hook A never reads observation values: '+asked.join(','));
 // Hook B at 13:00: labels 10 and 11 once (exact gets), then never reads them again.
 asked.length=0;let listed=0;const list=storage.list.bind(storage);storage.list=async o=>{if(o.prefix.startsWith('pb:obs:')&&o.end===undefined)listed++;return list(o);};
 await runPlaybookLearning(store,{state:baseState(),now:dayStart(D)+13*3600000,projects:[P],zone:()=>TZ},deadline(3000));
 assert.equal(listed,0,'no listing of every reading (retention lists only the expired range)');assert.deepEqual(asked.filter(k=>k.startsWith('pb:obs:'+D)).sort(),[obsKey(D,P,10),obsKey(D,P,11)],'today: only the two written hours (older days are folded by exact keys, once)');
 assert.ok(storage.map.get(obsKey(D,P,10)).labeledAt&&storage.map.get(obsKey(D,P,11)).labeledAt);
 asked.length=0;await runPlaybookLearning(store,{state:baseState(),now:dayStart(D)+13*3600000+60000,projects:[P],zone:()=>TZ},deadline(3000));
 assert.deepEqual(asked.filter(k=>k.startsWith('pb:obs:'+D)),[],'labelled hours are not read again');
});

test('Readings: a project with hundreds of long rows is trimmed by bytes and written alone; the others still get theirs',async()=>{
 const big=Array.from({length:450},(_,i)=>liveRow(String(100000000000000000n+BigInt(i)),('Campanha de escala com nome bem comprido e acentuação — ação '+i).slice(0,60),{adAccountId:'act_1234567890123456',spend:150.123456+i,frontOrders:1,orders:2,checkouts:3,revenueNet:200.98765}));
 const state={...liveState(10,big),config:{[P]:{projectName:'Grande'},q:{projectName:'Pequeno'}}};
 state.snapshots.push({...state.snapshots[0],projectId:'q',rows:[liveRow('s1','09/11 - [TESTE] S',{spend:50})]});
 const storage=memoryStorage(),store=playbookStore(storage);
 const r=await runPlaybookShadow(store,{state,liveItems:[],events:[],now:dayStart(D)+10*3600000+60000,projects:[{project:P,params:{},day:D},{project:'q',params:{},day:D}]},deadline(2000));
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.obs,2,'both projects observed');
 const v=storage.map.get(obsKey(D,P,10));assert.ok(new TextEncoder().encode(JSON.stringify(v)).length<=100000,'under the store cap, in UTF-8');
 assert.ok(v.truncated>0&&v.rows.length<450,'rows trimmed by bytes, marked truncated');assert.ok(storage.map.get(obsKey(D,'q',10)));
});

test('Writes shrink to fit: an oversize cursor or memory never fails the pass at the same put',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage);
 const fat='x'.repeat(2000),scores=Object.fromEntries(Array.from({length:80},(_,i)=>['pb:t'+i+'@'+P+'|v1:'+i,{playKey:'pb:t'+i+'@'+P,rev:'v1:'+i,graded:0,right:0,winnersCut:0,recent:[0,0],previous:[0,0],revertida:0,provavelAcerto:0,opposite:0,entries:0,note:fat}]));
 storage.map.set('pb:cursor',{v:1,scores,gradeAcc:scores});
 const r=await runPlaybookLearning(store,{state:baseState(),now:NOW,projects:[P],zone:()=>TZ},deadline(3000));
 assert.equal(r.ok,true,JSON.stringify(r));
 const c=storage.map.get('pb:cursor');assert.ok(new TextEncoder().encode(JSON.stringify(c)).length<=100000,'the cursor was shrunk and saved');assert.ok(c.at,'progress kept');
});

test('A refit\'s challenger runs in the Sombra under its own rev and id, is scored apart, and never replaces the version in use',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage),key='pb:test-pause@'+P;
 storage.map.set('pb:model',{v:1,fitAt:iso(NOW),plays:{[key]:{id:'pb:test-pause',project:P,key,stage:'candidata',rev:'v1:aaaaaaaa',version:1,params:{k:3},step:null,generalized:[],sentence:'Pausar teste',learnedFrom:[],support:{moves:9},flags:[],
  challenger:{rev:'v2:bbbbbbbb',version:2,params:{k:1},step:null,diff:[{param:'k',from:3,to:1}]}}}});
 const rows=[liveRow('t1','09/11 - [TESTE] A',{spend:200})];
 const r=await runPlaybookShadow(store,{state:liveState(15,rows),liveItems:[],events:[],now:NOW,projects:[{project:P,params:{ticketFront:100},day:D}]},deadline(1000));
 assert.equal(r.ok,true,JSON.stringify(r));
 const pbs=[...storage.map.entries()].filter(([k])=>k.startsWith('pbs:')).map(([,v])=>v);
 assert.deepEqual(pbs.map(e=>[e.ruleRev,e.versionRole]).sort(),[['v2:bbbbbbbb','next']],'2 tickets: only the challenger (k=1) fires; the version in use (k=3) does not');
 assert.ok(pbs.every(e=>e.wouldExecute===false&&e.id.includes('@next')),'its own id, never executable');
 const deep=await import('../lib/autonomy-deep-view.mjs');
 const view=deep.buildDeepView({base:{v:1,config:{enabled:false,projects:[{id:P,mode:'shadow',actions:{},limits:{},campaigns:{}}]},projects:{[P]:{name:'Projeto Um',timezone:TZ,now:[],done:[],contingency:[]}},orders:[],gate:{}},project:P,now:NOW,shadowStatus:{at:iso(NOW),day:D,days:{[P]:D}},pbsEntries:pbs});
 assert.deepEqual(view.projects[P].decisions,[],'a challenger\'s decisions are scored only, never listed as what the Bunk would do now');
 assert.equal(storage.map.get('pb:model').plays[key].rev,'v1:aaaaaaaa','the version in use is unchanged');
});
