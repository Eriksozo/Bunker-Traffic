import test from 'node:test';
import assert from 'node:assert/strict';
import {actionIndex,classifyActor,actionId,actionContext,shadowRelation,teamActions,mergeTeam,gradeTeamShard,teamStats,teamProposals,teamLines,teamKey,recentTeamKeys,teamPolicy,ownerLabel,outsideLabel} from '../lib/team-learning.mjs';

// Synthetic fixtures only: invented people (Ana Souza, Bruno Lima, owner "Dono Teste"), projects, accounts and amounts.
const P='proj-1',P2='proj-2',NOW=Date.parse('2026-11-09T18:00:00Z'),TZ='America/Sao_Paulo';
const iso=ms=>new Date(ms).toISOString(),ago=min=>iso(NOW-min*60000);
const row=(id,over={})=>({provider:'meta',level:'campaign',name:'09/11 [TESTE] '+id,adAccountId:'acc-1',externalId:id,status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:100,budgetCurrency:'BRL',spend:80,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:1,...over});
// Brasília day 09/11 starts at 03:00Z.
const today=(rows,over={})=>({projectId:P,period:'today',level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:'2026-11-09T03:00:00.000Z',to:'2026-11-10T03:00:00.000Z',fetchedAt:iso(NOW-60000),lastSyncAt:iso(NOW-120000),rows,...over});
const closedWin=(period,fromDay,rows,over={})=>({projectId:P,period,level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:fromDay+'T03:00:00.000Z',to:'2026-11-09T03:00:00.000Z',fetchedAt:iso(NOW-3600000),lastSyncAt:iso(NOW-3600000),rows,...over});
// A raw Malva edit as the feed stores it (attr:history:<project>:<eventId>).
const edit=(over={})=>({key:'history:'+(over.project||P)+':'+(over.eventId||'ev1'),eventId:'ev1',project:P,adAccountId:'acc-1',objectId:'c1',name:'09/11 [TESTE] c1',field:'status',before:'ACTIVE',after:'PAUSED',currency:'BRL',at:ago(30),checkedAt:ago(29),actor:'Ana Souza',automatic:false,source:'malva',matched:true,feedVersion:2,...over});
const choice=(over={})=>({id:'ch1',project:P,adAccountId:'acc-1',objectId:'c1',name:'09/11 [TESTE] c1',action:'pause',before:{status:'ACTIVE'},appliedByOwner:true,appliedAt:ago(20),...over});
const pauseOrder={action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'}};
const order=(id,createdBy,over={},payload={})=>({id:'p-'+id,createdBy,...(createdBy==='bunk'?{autonomyOrder:true}:{ownerOrder:true}),project:P,payload:{adAccountId:'acc-1',objectId:'c1',...pauseOrder,...payload},...over});
const execution=(id,over={})=>({id,proposalId:'p-'+id,status:'Confirmada',submittedAt:ago(31),confirmedAt:ago(30.5),...over});
const state=(extra={})=>({config:{[P]:{projectName:'Projeto Um'},[P2]:{projectName:'Projeto Dois'}},snapshots:[today([row('c1'),row('c2',{spend:40,checkouts:0})]),{...today([row('c1')]),projectId:P2}],proposals:[],executions:[],ownerChoices:[],...extra});
const run=(attributions,st=state(),o={})=>teamActions({attributions,state:st,ownerNames:['Dono Teste'],now:NOW,...o});
const moves=out=>out.actions.map(a=>[a.who,a.name,a.via]);

test('Who acted: owner, managers, the outside label, the Bunk itself, Meta, automations and no author',()=>{
 const st=state({proposals:[order('xb','bunk'),order('xo','owner',{},{objectId:'c2'})],executions:[execution('xb'),execution('xo',{submittedAt:ago(20),confirmedAt:ago(19)})]});
 const index=actionIndex(st),h=o=>({origin:'history',project:P,adAccountId:'acc-1',objectId:'c1',action:'pause',field:'status',before:'ACTIVE',after:'PAUSED',at:ago(30),actor:'Ana Souza',...o});
 const c=(e,o={})=>classifyActor(e,{index,ownerNames:['Dono Teste'],...o});
 assert.deepEqual(c({origin:'bunker',id:'bunker:xb'}),{who:'bunk',execution:'xb'},'the Bunk never learns from itself');
 assert.deepEqual(c({origin:'bunker',id:'bunker:xo'}),{who:'owner',name:ownerLabel,via:'bunker',execution:'xo'});
 assert.deepEqual(c(h({actor:'Dono Teste'})),{who:'bunk',execution:'xb'},'the owner\'s Malva connection doing exactly the Bunk order: its echo');
 assert.deepEqual(c(h({actor:'Dono Teste',objectId:'c2',at:ago(19.5)})),{who:'owner',name:ownerLabel,via:'bunker',execution:'xo'},'echo of an owner order');
 assert.deepEqual(c(h({actor:'Dono Teste',objectId:'c3'})),{who:'owner',name:ownerLabel,via:'malva'},'the owner editing in Malva');
 assert.deepEqual(c(h({objectId:'c3'})),{who:'team',name:'Ana Souza'});
 assert.deepEqual(c(h()),{who:'team',name:'Ana Souza'},'a named manager doing the same move inside the window is still herself');
 assert.deepEqual(c(h({objectId:'c3',actor:outsideLabel})),{who:'team',name:outsideLabel,outside:true});
 assert.deepEqual(c(h({objectId:'c3',actor:outsideLabel,confirmedBy:['owner']})),{who:'team',name:outsideLabel,outside:true},'a merged-log hint never makes someone the owner');
 for(const actor of ['Meta','Regra automática','Automação: corta CPA'])assert.equal(c(h({objectId:'c3',actor})).who,'system',actor);
 assert.equal(c(h({objectId:'c3',automatic:true,actor:'Ana Souza'})).who,'system','automatic edits are not a person\'s');
 for(const actor of [null,''])assert.equal(c(h({objectId:'c3',actor})).who,'unknown');
 assert.equal(c(h({objectId:'c3',actor:'Dono Teste'}),{ownerNames:[]}).who,'team','owner name unknown yet: kept by name');
 // An order that was never sent has no echo.
 const unsent=actionIndex(state({proposals:[order('xb','bunk')],executions:[execution('xb',{status:'Reservada',submittedAt:undefined,confirmedAt:undefined,claimedAt:ago(31)})]}));
 assert.deepEqual(classifyActor(h({actor:'Dono Teste'}),{index:unsent,ownerNames:['Dono Teste']}),{who:'owner',name:ownerLabel,via:'malva'});
 // The owner reversing a Bunk pause minutes later is his own act: the disagreement signal.
 assert.deepEqual(c(h({actor:'Dono Teste',action:'activate',before:'PAUSED',after:'ACTIVE',at:ago(25)})),{who:'owner',name:ownerLabel,via:'malva'});
});

test('Team moves from the raw feed: settled, in scope, one per Malva event, pause point only where the rule judges',()=>{
 const out=run([edit(),edit({eventId:'ev2',at:ago(2)}),edit({eventId:'ev3',name:'[AQUECIMENTO] x'}),edit({eventId:'ev4',field:'dailyBudget',before:100,after:130,objectId:'c2',actor:'Bruno Lima'}),
  edit({eventId:'ev5',project:'other'}),edit({eventId:'ev6',field:'lifetimeBudget',before:100,after:200}),edit({eventId:'ev7',at:ago(30*60)}),edit({eventId:'ev8',actor:'Meta'}),edit({eventId:'ev9',actor:null})]);
 assert.deepEqual(out.actions.map(a=>[a.name,a.kind]),[['Ana Souza','pause'],['Bruno Lima','increase']],'unsettled, warm-up, other project, lifetime budget, older than the window, Meta and no author out');
 const [pause,inc]=out.actions;
 assert.deepEqual(pause.guard,{level:'alert',pauseAt:99,limit:110,basis:'low-ic'},'R$80 with 1 IC: alert (70% of R$110), before the R$99 pause point');
 assert.deepEqual(inc.budget,{before:100,after:130,step:0.3,currency:'BRL'});
 assert.equal(inc.guard,null);
 assert.deepEqual([pause.day,pause.actor,pause.id],['2026-11-09','Ana Souza',actionId({eventId:'ev1',project:P},{})]);
 const old=state({snapshots:[today([row('c1',{name:'[TESTE] c1'})]),closedWin('yesterday','2026-11-08',[row('c1',{spend:30})]),closedWin('3d','2026-11-06',[row('c1',{spend:200})]),closedWin('7d','2026-11-02',[row('c1',{spend:400})])]});
 assert.equal(run([edit({name:'[TESTE] c1'})],old).actions[0].guard,null,'an older test is not judged by the first-days rule');
});

test('Context of the moment: Malva numbers of the same local day within 45 min, closed windows aligned, read time kept',()=>{
 const st=state({snapshots:[today([row('c1',{spend:80,checkouts:1})]),closedWin('yesterday','2026-11-08',[row('c1',{spend:30,checkouts:0})]),closedWin('3d','2026-11-06',[row('c1',{spend:30})]),closedWin('7d','2026-11-02',[row('c1',{spend:30})])]});
 const e={project:P,adAccountId:'acc-1',objectId:'c1',at:ago(30)};
 const c=actionContext(st,e);
 assert.deepEqual([c.test,c.today.spend,c.today.checkouts,c.yesterday.spend,c.afterAction],[true,80,1,30,true]);
 assert.equal(actionContext(st,{...e,at:'2026-11-08T20:00:00Z'}),null,'a move of another day never reads today\'s numbers');
 assert.equal(actionContext(st,{...e,objectId:'zz'}),null);
 assert.equal(actionContext(st,{...e,at:ago(120)}),null,'a cut read 2 h after the move is not "the moment"');
 const live={projectId:P,snapshot:today([row('c1',{spend:95})],{fetchedAt:iso(NOW-10000)})};
 assert.equal(actionContext(st,e,{liveItem:live}).today.spend,95,'the freshest same-day cut wins');
});

test('Sombra relation: flagged before, by how much, by either kind of cut, active window',()=>{
 const entry=(over={})=>({project:P,adAccountId:'acc-1',objectId:'c1',rule:'test-no-sale',action:'status',after:{status:'PAUSED'},firstAt:ago(75),...over});
 const by=list=>{const m=new Map();for(const x of list){const k=JSON.stringify([x.project,x.adAccountId,x.objectId]);m.set(k,[...(m.get(k)||[]),x]);}return m;};
 const e={project:P,adAccountId:'acc-1',objectId:'c1',action:'pause',at:ago(30)};
 assert.deepEqual(shadowRelation(by([entry({firstWouldExecuteAt:ago(70)})]),e),{flagged:true,cutFlagged:true,rule:'test-no-sale',leadMin:45,executable:true,alertOnly:false});
 assert.equal(shadowRelation(by([entry({firstAt:iso(NOW-40*3600000)})]),e).flagged,false,'older than 36 h');
 assert.equal(shadowRelation(by([entry({firstAt:iso(NOW-40*3600000),lastAt:iso(NOW-12*3600000)})]),e).flagged,true,'still flagged 12 h ago: active');
 const reduce=shadowRelation(by([entry({action:'budget',before:{dailyBudget:100},after:{dailyBudget:80}})]),e);
 assert.deepEqual([reduce.flagged,reduce.cutFlagged],[false,true],'a Sombra "reduzir" covers a person\'s pause');
 assert.equal(shadowRelation(by([entry({action:'budget',before:{dailyBudget:100},after:{dailyBudget:130}})]),e).cutFlagged,false,'a raise never covers a cut');
 assert.equal(shadowRelation(by([entry({firstAt:ago(27)})]),e).leadMin,-3,'up to 5 min later counts, as late');
});

test('The Bunk is never learned; a manager\'s same move is never taken for the Bunk; owner orders count once',()=>{
 const bunk=state({proposals:[order('xb','bunk')],executions:[execution('xb')]});
 assert.deepEqual(run([edit({actor:'Dono Teste'})],bunk).actions,[],'the Bunk\'s order and its echo: nothing learned');
 assert.deepEqual(moves(run([edit({actor:'Ana Souza',at:ago(28)})],bunk)),[['team','Ana Souza',null]],'Ana right after a Bunk pause: hers');
 const failed=state({proposals:[order('xb','bunk')],executions:[execution('xb',{status:'Verificação necessária',confirmedAt:undefined})]});
 assert.deepEqual(moves(run([edit({at:ago(26)})],failed)),[['team','Ana Souza',null]],'a Bunk dispatch that did not land, then Ana: hers');
 // Shared campaign: the echo through the other project is the Bunk's too.
 assert.deepEqual(run([edit({project:P2,eventId:'e2',actor:'Dono Teste'})],bunk).actions,[],'found by the Meta campaign id across projects');
 // Owner order: counted once, by its execution; its echo is not a second move.
 const owned=state({proposals:[order('xo','owner')],executions:[execution('xo')]});
 const o=run([edit({actor:'Dono Teste'})],owned);
 assert.deepEqual(moves(o),[['owner',ownerLabel,'bunker']]);
 // The owner re-applies by notch what the Bunk had done and Ana undone: his order counts.
 const again=state({proposals:[order('xb','bunk',{},{action:'budget',before:{dailyBudget:100},after:{dailyBudget:80}}),order('xo','owner',{},{action:'budget',before:{dailyBudget:100},after:{dailyBudget:80}})],
  executions:[execution('xb',{submittedAt:ago(60),confirmedAt:ago(59.5)}),execution('xo',{submittedAt:ago(54),confirmedAt:ago(53.5)})]});
 const seq=run([edit({eventId:'b1',actor:'Dono Teste',field:'dailyBudget',before:100,after:80,at:ago(59.5)}),edit({eventId:'a1',actor:'Ana Souza',field:'dailyBudget',before:80,after:100,at:ago(57)}),edit({eventId:'o1',actor:'Dono Teste',field:'dailyBudget',before:100,after:80,at:ago(53.5)})],again);
 assert.deepEqual(seq.actions.map(a=>[a.who,a.name,a.kind]).sort(),[['owner',ownerLabel,'reduce'],['team','Ana Souza','increase']].sort());
 const k=teamKey('2026-11-09',P),merged=mergeTeam(new Map(),seq.actions,{aliases:seq.aliases,dropMoves:seq.dropMoves}).put[k];
 assert.deepEqual(Object.values(merged.actions).map(a=>a.who).sort(),['owner','team'],'the owner\'s order survives the Bunk\'s drop window');
});

test('A Bunk echo stored by a pass with an older central is removed once its order is known',()=>{
 const stale=run([edit({actor:'Dono Teste'})]);
 assert.deepEqual(moves(stale),[['owner',ownerLabel,'malva']],'without the order the pass cannot know');
 const k=teamKey('2026-11-09',P),stored=mergeTeam(new Map(),stale.actions).put[k];
 const fresh=run([edit({actor:'Dono Teste'})],state({proposals:[order('xb','bunk')],executions:[execution('xb')]}));
 assert.deepEqual(fresh.actions,[]);
 const healed=mergeTeam(new Map([[k,stored]]),fresh.actions,{aliases:fresh.aliases,dropMoves:fresh.dropMoves}).put[k];
 assert.deepEqual(healed.actions,{},'removed by its description');
 // A manager's stored move is never removed as an echo.
 const ana=mergeTeam(new Map(),run([edit({at:ago(29)})]).actions).put[k];
 assert.deepEqual(mergeTeam(new Map([[k,ana]]),fresh.actions,{dropMoves:fresh.dropMoves}).put,{},'Ana\'s pause stays');
 // Owner name unknown at the stale pass: the echo was stored under his name, and goes once the name is known.
 const nameless=mergeTeam(new Map(),run([edit({actor:'Dono Teste'})],state(),{ownerNames:[]}).actions).put[k];
 const gone=mergeTeam(new Map([[k,nameless]]),[],{dropMoves:fresh.dropMoves}).put[k];
 assert.deepEqual(gone.actions,{});
});

test('A "Já fiz" and its trace in the Meta manager are one owner act, in either order; a named manager stays his',()=>{
 const trace=edit({eventId:'ev9',actor:outsideLabel,source:'meta',at:ago(40)});
 const withReport=state({ownerChoices:[choice()]});
 const both=run([trace],withReport);
 assert.deepEqual(moves(both),[['owner',ownerLabel,'notch']],'one move, not two');
 assert.equal(both.actions[0].id,actionId({eventId:'ev9',project:P},{}),'under the trace\'s id');
 const k=teamKey('2026-11-09',P);
 // Trace stored first as "Fora da Malva Dash", report later: the stored move becomes the owner's.
 const lone=run([trace]);
 assert.deepEqual(moves(lone),[['team',outsideLabel,null]]);
 const later=mergeTeam(new Map([[k,mergeTeam(new Map(),lone.actions).put[k]]]),both.actions,{aliases:both.aliases}).put[k];
 assert.deepEqual(Object.values(later.actions).map(a=>[a.who,a.via]),[['owner','notch']]);
 // Report stored first alone, trace later: the report moves onto the trace's id (same project only).
 const alone=run([],withReport);
 assert.deepEqual(moves(alone),[['owner',ownerLabel,'notch']]);
 const stored=mergeTeam(new Map(),alone.actions).put[k],moved=mergeTeam(new Map([[k,stored]]),both.actions,{aliases:both.aliases}).put[k];
 assert.deepEqual(Object.keys(moved.actions),[both.actions[0].id],'one move under the trace id');
 // A named manager's Malva edit near a "Já fiz" stays the manager's; the report stays the owner's own.
 const named=run([edit({eventId:'ev8',actor:'Bruno Lima',at:ago(40)})],withReport);
 assert.deepEqual(moves(named).sort(),[['owner',ownerLabel,'notch'],['team','Bruno Lima',null]].sort());
 // The report pairs with the closest edit before the tap, never a later identical move by someone outside Malva.
 const two=run([edit({eventId:'early',actor:outsideLabel,at:ago(25)}),edit({eventId:'late',actor:outsideLabel,at:ago(12)})],withReport);
 assert.equal(two.actions.length,2,'the later identical move stays a move of its own');
 assert.equal(two.actions.find(a=>a.who==='owner').id,actionId({eventId:'early',project:P},{}));
 // The same native edit through another project (shared account) is the owner's there too.
 const shared=run([trace,edit({eventId:'ev9b',project:P2,actor:outsideLabel,source:'meta',at:ago(40)})],withReport);
 assert.deepEqual(shared.actions.map(a=>[a.project,a.who]).sort(),[[P,'owner'],[P2,'owner']].sort());
});

test('Memory shards: frozen first sighting, author upgraded only toward the owner, grade added once, full flagged',()=>{
 const a={id:'a1',v:1,day:'2026-11-09',project:P,who:'team',name:'Dono Teste',actor:'Dono Teste',kind:'pause',at:ago(30),ctx:{today:{spend:80}},shadow:{flagged:false},grade:null};
 const k=teamKey('2026-11-09',P),first=mergeTeam(new Map(),[a]).put[k];
 assert.equal(Object.keys(first.actions).length,1);
 assert.deepEqual(mergeTeam(new Map([[k,first]]),[{...a,ctx:{today:{spend:999}}}]).put,{},'numbers of the first sighting stay');
 const up=mergeTeam(new Map([[k,first]]),[{...a,who:'owner',name:ownerLabel,via:'malva'}]).put[k].actions.a1;
 assert.deepEqual([up.who,up.name,up.ctx.today.spend],['owner',ownerLabel,80],'later trace names the owner');
 assert.deepEqual(mergeTeam(new Map([[k,{...first,actions:{a1:{...a,who:'owner',name:ownerLabel}}}]]),[a]).put,{},'never downgraded from owner to team');
 assert.deepEqual(mergeTeam({[k]:first},[],{drop:['a1']}).put[k].actions,{},'plain objects work as the store too');
 const many=Array.from({length:teamPolicy.maxActionsPerShard+3},(_,i)=>({...a,id:'m'+i}));
 const capped=mergeTeam(new Map(),many).put[k];
 assert.deepEqual([Object.keys(capped.actions).length,capped.full],[teamPolicy.maxActionsPerShard,true],'a full shard is flagged, never silent');
 assert.deepEqual(mergeTeam(new Map([[k,capped]]),[{...a,id:'late'}]).put,{},'flagged once: not rewritten every pass');
 assert.deepEqual(recentTeamKeys([P],NOW,2),[teamKey('2026-11-09',P),teamKey('2026-11-08',P)]);
 assert.deepEqual(recentTeamKeys([P],Date.parse('2026-11-10T01:00:00Z'),1,()=>'Europe/Lisbon'),[teamKey('2026-11-10',P)],'each project\'s own local day');
});

test('Next-day grade of budget moves and activations, with the Sombra verdict; night moves read that same day',()=>{
 const y=(day,rows)=>({projectId:P,period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:day+'T03:00:00.000Z',rows});
 const shard={day:'2026-11-08',project:P,kind:'team',actions:{
  up:{id:'up',day:'2026-11-08',project:P,kind:'increase',minute:600,adAccountId:'acc-1',objectId:'c1'},
  night:{id:'night',day:'2026-11-08',project:P,kind:'increase',minute:10,adAccountId:'acc-1',objectId:'c2'},
  cut:{id:'cut',day:'2026-11-08',project:P,kind:'reduce',minute:700,adAccountId:'acc-1',objectId:'c3'},
  pause:{id:'pause',day:'2026-11-08',project:P,kind:'pause',minute:700,adAccountId:'acc-1',objectId:'c1'}}};
 const d9=y('2026-11-09',[row('c1',{revenueNet:300}),row('c3',{revenueNet:10}),row('c2',{revenueNet:0})]),d8=y('2026-11-08',[row('c2',{revenueNet:500})]);
 const g=gradeTeamShard(shard,[d9,d8]).actions;
 assert.deepEqual([g.up.grade.verdict,g.up.grade.target],['acertou','2026-11-09'],'raise, next day made money');
 assert.deepEqual([g.night.grade.verdict,g.night.grade.target],['acertou','2026-11-08'],'00:10 raise acts on that day');
 assert.equal(g.cut.grade.verdict,'acertou','cut, next day lost money');
 assert.equal(g.pause.grade,undefined,'a pause has no next day to read');
 assert.equal(gradeTeamShard({...shard,actions:{up:g.up}},[y('2026-11-09',[row('c1',{revenueNet:0})])]),null,'a grade is never rewritten');
 assert.equal(gradeTeamShard({...shard,actions:{up:shard.actions.up}},[y('2026-11-09',[row('c1',{productCost:null})])]),null,'missing costs stay open');
 assert.equal(gradeTeamShard({...shard,actions:{up:shard.actions.up}},[y('2026-11-09',[])]).actions.up.grade.verdict,'parou');
});

test('Patterns per person, anticipation over watched hours, proposals with the pause point in force, and lines',()=>{
 const mk=(i,over={})=>({id:'t'+i,day:'2026-11-0'+(5+i%4),project:P,who:'team',name:i%2?'Ana Souza':'Bruno Lima',kind:'pause',at:'2026-11-0'+(5+i%4)+'T15:00:00Z',objectId:'c'+i,
  ctx:{since:{spend:50+i*5,checkouts:i%2,frontOrders:0,orders:0,revenueNet:0},today:{spend:50+i*5}},guard:{level:'watch',pauseAt:99,limit:110,basis:'low-ic'},shadow:{flagged:i<4,leadMin:i<4?20+i:null},...over});
 const hours=['2026-11-05T15','2026-11-06T15','2026-11-07T15','2026-11-08T15','2026-11-08T13','2026-11-07T13','2026-11-06T13'];
 const actions=[...Array.from({length:8},(_,i)=>mk(i)),
  {id:'o1',day:'2026-11-08',project:P,who:'owner',name:ownerLabel,kind:'increase',at:'2026-11-08T13:00:00Z',budget:{step:0.3},grade:{verdict:'acertou'},shadow:{flagged:false}},
  {id:'o2',day:'2026-11-07',project:P,who:'owner',name:ownerLabel,kind:'increase',at:'2026-11-07T13:00:00Z',budget:{step:0.2},grade:{verdict:'acertou'},shadow:{flagged:false}},
  {id:'o3',day:'2026-11-06',project:P,who:'owner',name:ownerLabel,kind:'increase',at:'2026-11-06T13:00:00Z',budget:{step:0.5},grade:{verdict:'errou'},shadow:{flagged:false}}];
 const shards=[{kind:'team',day:'x',project:P,actions:Object.fromEntries(actions.map(a=>[a.id,a]))}];
 const st=teamStats(shards,{now:NOW,names:{[P]:'Projeto Um'},coverage:{[P]:hours}});
 const ana=st.all.people.find(p=>p.name==='Ana Souza'),you=st.all.people.find(p=>p.name===ownerLabel);
 assert.deepEqual([ana.testPauses.n,ana.testPauses.median,ana.testPauses.beforePoint],[4,70,4]);
 assert.deepEqual([you.budget.graded,you.budget.right,you.budget.medianUp],[3,2,0.3]);
 assert.deepEqual([st.all.lead.cuts,st.all.lead.ahead,st.all.lead.medianLeadMin],[8,4,21.5]);
 assert.equal(st.all.lead.daily.length,teamPolicy.trendDays);
 assert.equal(teamStats(shards,{now:NOW,coverage:{}}).all.lead.cuts,0,'no anticipation claim where the Sombra was not evaluating');
 assert.equal(teamStats(shards,{now:NOW,coverage:{[P]:['2026-11-08T15']}}).all.lead.cuts,2,'only moves made in hours it was watching');
 assert.equal(st.proposals.length,1);
 const p=st.proposals[0];
 assert.deepEqual([p.n,p.campaigns,p.days,p.median,p.current,p.value,p.before],[8,8,4,67.5,99,70,8]);
 assert.match(p.text,/^Projeto Um: em 30 dias, vocês fizeram 8 pausas de campanhas novas sem venda com 0–1 IC \(8 campanhas, 4 dias\), com gasto mediano de R\$68/);
 assert.match(p.text,/Só muda com o seu sim/);
 assert.deepEqual(teamStats(shards,{now:NOW,coverage:{[P]:hours},paramsOf:()=>({first24hLowIcPauseAt:70})}).proposals,[],'an accepted point (R$70 now) stops the proposal');
 assert.deepEqual(teamProposals(actions.map(a=>a.guard?{...a,objectId:'same'}:a),{now:NOW}),[],'one campaign paused 8 times is not a pattern');
 assert.deepEqual(teamProposals(actions.slice(0,4),{now:NOW}),[],'fewer than 5 pauses: no proposal');
 assert.deepEqual(teamProposals(actions.map(a=>a.guard?{...a,ctx:{...a.ctx,since:{...a.ctx.since,spend:98}}}:a),{now:NOW}),[],'pausing near the point: nothing to propose');
 const lines=teamLines(st);
 assert.equal(lines.length,3);
 assert.match(lines[0],/^Pausas de campanhas novas sem venda \(30 dias\): Ana 4 · mediana R\$70; Bruno 4 · mediana R\$65\.$/);
 assert.match(lines[1],/^A Sombra apontou antes 4 de 8 cortes da equipe em 7 dias \(mediana 22 min antes\)\.$/);
 assert.match(lines[2],/^Aumentos seguidos de lucro e reduções seguidas de prejuízo no dia seguinte \(30 dias\): Você 2 de 3\.$/);
 assert.deepEqual(teamLines(st,{project:'none'}),[]);
 assert.ok(lines.every(l=>!/garant|100%|certeza/.test(l)),'no promise of certainty');
 // One native move seen through two projects counts once in the overall view.
 const twin={...actions[0],id:'twin',project:P2,native:'n0'},base0={...actions[0],native:'n0'};
 const dual=teamStats([{kind:'team',actions:{[base0.id]:base0,twin}}],{now:NOW,coverage:{[P]:hours,[P2]:hours}});
 assert.deepEqual([dual.all.actions,dual.projects[P].actions,dual.projects[P2].actions],[1,1,1]);
});

// --- Modo Gestor (W3): identity by Malva actor key, exclusions, d7, reversals, hours, base, D+3, backfill ----------
import {personId,actorExclusion,exclusionCounts,teamReversals,backfillMoves,launchApps} from '../lib/team-learning.mjs';
const info=(key,name,over={})=>({key,kind:'malva',name,profile:null,app:'malva',...over});

test('Actor key beats the display name: one person across renames, the owner under any name, never by name alone',()=>{
 const renamed=run([edit({eventId:'k1',actor:'Ana Souza',actorInfo:info('malva:fake-ana','Ana Souza')}),edit({eventId:'k2',objectId:'c2',actor:'Ana S.',actorInfo:info('malva:fake-ana','Ana S.'),field:'dailyBudget',before:100,after:130})]);
 assert.equal(new Set(renamed.actions.map(a=>a.person)).size,1,'same key, two names: one person');
 assert.deepEqual(renamed.actions.map(a=>a.role),['team','team']);assert.match(renamed.actions[0].person,/^p:[0-9a-z]+$/);
 assert.doesNotMatch(JSON.stringify(renamed.actions),/malva:fake-ana/,'the raw key is never stored in the move');
 const st=teamStats([{kind:'team',actions:Object.fromEntries(renamed.actions.map(a=>[a.id,a]))}],{now:NOW});
 assert.equal(st.all.people.length,1);assert.equal(st.all.people[0].actions,2);assert.equal(st.all.people[0].person,renamed.actions[0].person);
 // The owner's key, learned from his own name, recognizes him after a rename; another key under his name is not him.
 const owner=run([edit({eventId:'o1',actor:'Dono Teste',actorInfo:info('malva:fake-owner','Dono Teste')}),edit({eventId:'o2',objectId:'c2',actor:'Dono T.',actorInfo:info('malva:fake-owner','Dono T.'),field:'dailyBudget',before:100,after:80})]);
 assert.deepEqual(owner.actions.map(a=>[a.who,a.person]),[['owner','owner'],['owner','owner']]);
 const impostor=run([edit({eventId:'o3',actor:'Dono Teste',actorInfo:info('malva:fake-other','Dono Teste')})],state(),{ownerKeys:['malva:fake-owner']});
 assert.deepEqual(impostor.actions.map(a=>a.who),['team'],'a known owner key wins over a matching display name');
 assert.equal(personId({who:'team',name:outsideLabel,outside:true}),'outside');assert.equal(personId({who:'owner'}),'owner');
 assert.equal(personId({who:'team',name:'Ana Souza'}),personId({who:'team',name:'Ana Souza'}),'legacy records: stable by name');
});

test('Exclusions by Malva actor fields: automations, Meta, launch tools; counted per reason',()=>{
 assert.equal(actorExclusion(info('automacao:x','Automação: y',{kind:'automation'})),'automation');
 assert.equal(actorExclusion({key:'sistema',kind:'system',name:'Meta'}),'meta');
 assert.equal(actorExclusion({key:'fora',kind:'outside',name:outsideLabel,profile:'Meta'}),'meta','an outside "Meta" profile flips issues: not a decision');
 for(const app of launchApps)assert.equal(actorExclusion({key:'fora',kind:'outside',profile:'Pessoa',app}),'launch-tool',app);
 assert.equal(actorExclusion({key:'fora',kind:'outside',profile:'Malva',app:null}),'launch-tool');
 assert.equal(actorExclusion(info('malva:fake-ana','Ana Souza')),null);assert.equal(actorExclusion(null),null);
 const out=run([edit({eventId:'x1',actor:outsideLabel,actorInfo:{key:'fora',kind:'outside',name:outsideLabel,profile:'Malva',app:'Malva Epidemia'}}),edit({eventId:'x2',actor:null}),edit({eventId:'x3',project:'other'})]);
 assert.deepEqual(out.actions,[]);assert.deepEqual(exclusionCounts(out.excluded).byReason,{'launch-tool':1,'no-author':1,'out-of-scope':1});
 assert.deepEqual(exclusionCounts([]),{total:0,byReason:{},quarantined:0});
});

test('Context gains the closed 7 days; moves keep hours; reversals within 48 h; base and D+3 for team moves',()=>{
 const st=state({snapshots:[today([row('c1',{spend:80})]),closedWin('yesterday','2026-11-08',[row('c1',{spend:30,revenueNet:60})]),closedWin('3d','2026-11-06',[row('c1',{spend:90,revenueNet:200})]),closedWin('7d','2026-11-02',[row('c1',{spend:210,revenueNet:400})])]});
 const c=actionContext(st,{project:P,adAccountId:'acc-1',objectId:'c1',at:ago(30)});
 assert.deepEqual(c.d7,{spend:210,roi:1.905,result:190});
 assert.equal(actionContext(state(),{project:P,adAccountId:'acc-1',objectId:'c1',at:ago(30)}).d7,null,'no closed 7 days: N/D');
 const mk=(id,kind,at,person='p:a')=>({id,kind,at,person,name:'X',adAccountId:'acc-1',objectId:'c1'});
 const rev=teamReversals([mk('a','pause','2026-11-08T12:00:00Z'),mk('b','activate','2026-11-09T10:00:00Z','p:b'),mk('c','increase','2026-11-01T12:00:00Z'),mk('d','reduce','2026-11-05T12:00:00Z')]);
 assert.deepEqual(rev.get('a'),{person:'p:b',name:'X',kind:'activate',at:'2026-11-09T10:00:00Z'});assert.equal(rev.has('c'),false,'4 days later is not a reversal');
 const y=(day,rows)=>({projectId:P,period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:day+'T03:00:00.000Z',rows});
 const d3=(day,rows)=>({projectId:P,period:'3d',level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:day+'T03:00:00.000Z',to:new Date(Date.parse(day+'T03:00:00.000Z')+3*86400000).toISOString(),rows});
 const shard={day:'2026-11-05',project:P,kind:'team',actions:{up:{id:'up',day:'2026-11-05',project:P,kind:'increase',minute:600,adAccountId:'acc-1',objectId:'c1',who:'team',name:'Ana Souza',at:'2026-11-05T13:00:00Z'}}};
 const g1=gradeTeamShard(shard,[y('2026-11-06',[row('c1',{revenueNet:300})])]);assert.equal(g1.actions.up.grade.verdict,'acertou');assert.equal(g1.actions.up.grade.d3,undefined);
 const g3=gradeTeamShard(g1,[d3('2026-11-06',[row('c1',{spend:300,revenueNet:100})])]);
 assert.deepEqual([g3.actions.up.grade.verdict,g3.actions.up.grade.d3.verdict,g3.actions.up.grade.d3.target],['acertou','errou','2026-11-06'],'D+3 added apart; D+1 unchanged');
 assert.equal(gradeTeamShard(g3,[d3('2026-11-06',[row('c1',{revenueNet:900})])]),null,'D+3 is read once');
 const stats=teamStats([g3],{now:NOW,bases:[{project:P,day:'2026-11-06',campaigns:10,loss:3,profit:6}]});
 const ana=stats.all.people[0];
 assert.deepEqual(ana.budget.base,{graded:1,expected:0.6,edge:0.4});assert.deepEqual([ana.budget.d3.graded,ana.budget.d3.right],[1,0]);
 assert.equal(ana.hours[10],1);assert.equal(ana.hours.length,24);
 const undo={...g3,actions:{...g3.actions,dn:{id:'dn',day:'2026-11-05',project:P,kind:'reduce',minute:700,adAccountId:'acc-1',objectId:'c1',who:'team',name:'Bruno Lima',at:'2026-11-05T20:00:00Z'}}};
 assert.equal(teamStats([undo],{now:NOW}).all.people.find(p=>p.name==='Ana Souza').reversed,1,'her raise was undone the same day');
 assert.equal(teamStats([g3],{now:NOW}).all.people[0].budget.base,null,'no bases given: N/D');
});

test('Backfilled moves: same exclusions as the live capture, day-level only, the live id (no double count)',()=>{
 const ev=(eventId,over={})=>({key:'history:'+P+':'+eventId,eventId,project:P,adAccountId:'acc-1',objectId:'c1',name:'Campanha c1',field:'status',before:'ACTIVE',after:'PAUSED',currency:'BRL',at:'2026-11-03T15:00:00.000Z',actor:'Ana Souza',automatic:false,actorInfo:info('malva:fake-ana','Ana Souza'),...over});
 const bunk=state({proposals:[order('xb','bunk',{},{objectId:'c9'})],executions:[execution('xb',{submittedAt:'2026-11-03T14:59:00.000Z',confirmedAt:'2026-11-03T14:59:30.000Z'})]});
 const out=backfillMoves([ev('b1'),ev('b2',{objectId:'c9',actor:'Dono Teste',actorInfo:info('malva:fake-owner','Dono Teste')}),ev('b3',{actor:'Automação: x',actorInfo:{key:'automacao:1',kind:'automation',name:'Automação: x'}}),ev('b4',{after:'DELETED'}),ev('b5',{name:'[AQUECIMENTO] y'})],{state:bunk,ownerNames:['Dono Teste'],timezone:TZ});
 assert.deepEqual(out.moves.map(m=>[m.person,m.kind,m.day,m.ctx.source]),[[personId({who:'team',name:'Ana Souza',key:'malva:fake-ana'}),'pause','2026-11-03','backfill-daily']]);
 assert.equal(out.moves[0].id,actionId({eventId:'b1',project:P},{}),'the same id the live capture gives that Malva event');
 assert.deepEqual(exclusionCounts(out.excluded).byReason,{bunk:1,automation:1,'create-delete':1,'out-of-scope':1});
 assert.equal(out.moves[0].campaign,'Campanha c1');assert.equal(out.moves[0].minute,12*60);
});

test('One person across the deploy: a move stored before the actor key joins the key-based id of the same name',async()=>{
 const {personId:pidOf,personResolver}=await import('../lib/team-learning.mjs');
 const keyed=pidOf({who:'team',name:'Jorge Souza',key:'malva:fake-jorge'});
 const old={id:'old1',day:'2026-11-04',project:P,who:'team',name:'Jorge Souza',kind:'pause',at:'2026-11-04T15:00:00.000Z',adAccountId:'acc-1',objectId:'c1',minute:720,guard:{level:'review',pauseAt:110},ctx:{since:{spend:90},today:{spend:90}}};
 const fresh={...old,id:'new1',day:'2026-11-09',at:'2026-11-09T15:00:00.000Z',objectId:'c2',person:keyed,role:'team'};
 const st=teamStats([{kind:'team',actions:{old1:old,new1:fresh}}],{now:NOW});
 assert.deepEqual(st.all.people.map(p=>[p.name,p.person,p.actions]),[['Jorge Souza',keyed,2]],'one person, both moves, the key-based id');
 assert.ok(teamLines(st).every(l=>!/Jorge 1 .*Jorge 1/.test(l)),'lines never name the same person twice');
 // Two different keys under one display name: ambiguous, the old record keeps its name hash (never guessed).
 const other={...fresh,id:'new2',person:pidOf({who:'team',name:'Jorge Souza',key:'malva:fake-jorge-2'})};
 const r=personResolver([fresh,other]);assert.equal(r(old),pidOf({who:'team',name:'Jorge Souza'}));
 // Known pairs (pb:people) also resolve; the owner and the outside label never change.
 assert.equal(personResolver([],[[keyed,'Jorge Souza']])(old),keyed);
 assert.equal(personResolver([fresh])({...old,who:'owner'}),'owner');assert.equal(personResolver([fresh])({...old,name:outsideLabel,outside:true}),'outside');
});
