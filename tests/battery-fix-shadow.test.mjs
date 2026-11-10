import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateShadow,first24hWatch,mergeShadow,shadowOutcomes,shadowGrades,shadowSummary} from '../lib/autonomy-shadow.mjs';

// Synthetic fixtures only: identifiers, names and values are invented.
const H=3600000,D=86400000,iso=ms=>new Date(ms).toISOString();
const dayStart=d=>Date.parse(d+'T03:00:00Z');// America/Sao_Paulo (UTC−3)
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,...metrics,...extra});
const cut=(period,from,to,at,rows)=>({...base,period,from:iso(from),to:iso(to),fetchedAt:iso(at),lastSyncAt:iso(at-60000),rows});
/** Analysis of `day` (its "today" plus the closed windows ending at its start), read at `at`. */
function analysis(day,at,{today=[],y=[],d3=[],d7=[]}={}){
 const t=dayStart(day);
 return {config:{p:{projectName:'Fictício'}},snapshots:[cut('today',t,t+D,at,today),cut('yesterday',t-D,t,at,y),cut('3d',t-3*D,t,at,d3),cut('7d',t-7*D,t,at,d7)]};
}
const liveCut=(day,at,rows)=>({projectId:'p',snapshot:cut('today',dayStart(day),dayStart(day)+D,at,rows)});
const proven={'night-increase':{graded:25,right:20,accuracy:0.8},'morning-increase':{graded:25,right:20,accuracy:0.8}};

test('#0/#40 after midnight the previous day cut is not "today": no rule runs on it and the board is stale',()=>{
 const now=Date.parse('2026-11-09T03:10:00Z');// 09/11 00:10 local; last analysis of 08/11 read at 23:50
 const n='07/11 - [CBO] - [PRE] N1',d2=row('n1',n,m(500,1500,4,4)),d1=row('n1',n,m(600,300,1,1));
 const s=analysis('2026-11-08',now-20*60000,{today:[d1,row('t1','08/11 - [CBO] - [TESTE] T1',m(150,0,0,0,0))],y:[d2],d3:[d2],d7:[d2]});
 const out=evaluateShadow(s,{project:'p',params:{budgetCap:5000},now});
 assert.deepEqual(out.decisions,[]);assert.match(out.skipped,/vencida/);
 const b=first24hWatch(s,{project:'p',now});assert.equal(b.stale,true);assert.deepEqual(b.items,[]);
 // A live cut of the day that just ended is not today's either.
 assert.deepEqual(evaluateShadow(s,{project:'p',now,liveItem:liveCut('2026-11-08',now-60000,[d1])}).decisions,[]);
 // With the new day's live cut, the night pass reads 08/11 (the cut that ended) as yesterday, declared as such.
 const good=analysis('2026-11-08',now-20*60000,{today:[row('n1',n,m(600,1800,3,3))]});
 const night=evaluateShadow(good,{project:'p',params:{budgetCap:5000},now,liveItem:liveCut('2026-11-09',now-60000,[row('n1',n,m(4))])}).decisions.find(d=>d.rule==='night-increase');
 assert.ok(night);assert.match(night.reason,/R\$600/);assert.match(night.limitations.join(' '),/último corte da análise de ontem/);
});

test('#1 a pause in the same pulse wins: the increase on that object is blocked with a reason',()=>{
 const now=Date.parse('2026-11-09T03:25:00Z'),n='08/11 - [CBO] - [PRE] GRANDE',x={dailyBudget:1500,budgetCurrency:'USD',budgetRate:5};
 // Yesterday's profit (R$100) does not cover today's R$130 without a sale, so the partial-day hold (lib/partial-day.mjs) stays out.
 const y=row('g1',n,m(300,400,1,1,20),x),s=analysis('2026-11-09',now-300000,{today:[row('g1',n,m(130,0,0,0,0),x)],y:[y],d3:[y],d7:[y]});
 const d=evaluateShadow(s,{project:'p',params:{budgetCap:20000},now,accuracy:proven}).decisions;
 const pause=d.find(e=>e.rule==='test-no-sale'),inc=d.find(e=>e.rule==='night-increase');
 assert.equal(pause.wouldExecute,true);assert.equal(inc.wouldExecute,false);
 assert.match(inc.blockedBy.join(' '),/Pausa registrada nesta leitura/);
});

test('#3 missing sales counts read N/D in the reasons, never "null"',()=>{
 const now=Date.parse('2026-11-07T17:00:00Z');
 const a=row('a','07/11 - [CBO] - [TESTE] A',m(400,100,null,null,3)),b=row('b','07/11 - [CBO] - [TESTE] B',m(400,900,2,null,3));
 const d=evaluateShadow(analysis('2026-11-07',now-300000,{today:[a,b]}),{project:'p',params:{ticketFront:300},now}).decisions;
 for(const r of d.map(x=>x.reason))assert.doesNotMatch(r,/\bnull\b/);
 assert.match(d.find(x=>x.rule==='new-sale-loss'&&x.objectId==='a').reason,/vendas N\/D/);
 assert.match(d.find(x=>x.rule==='morning-increase'&&x.objectId==='b').reason,/pedidos N\/D \(2 front\)/);
});

test('#4 night pass with the BRL budget N/D (no rate) records no "orçamento grande"',()=>{
 const now=Date.parse('2026-11-08T03:15:00Z'),n='07/11 - [CBO] - [TESTE] N2',x={dailyBudget:100,budgetCurrency:'USD',budgetRate:null};
 const s=analysis('2026-11-07',now-80*60000,{today:[row('n2',n,m(500,900,3,3),x)]});
 const d=evaluateShadow(s,{project:'p',params:{budgetCap:5000},now,liveItem:liveCut('2026-11-08',now-60000,[row('n2',n,m(5),x)])}).decisions;
 assert.equal(d.some(e=>e.rule==='night-increase'),false);
 // Control: with the rate, the same campaign is evaluated (small budget).
 const ok=evaluateShadow(analysis('2026-11-07',now-80*60000,{today:[row('n2',n,m(500,900,3,3),{...x,budgetRate:5})]}),{project:'p',params:{budgetCap:5000},now,liveItem:liveCut('2026-11-08',now-60000,[row('n2',n,m(5),{...x,budgetRate:5})])}).decisions.find(e=>e.rule==='night-increase');
 assert.match(ok.reason,/orçamento pequeno/);
});

test('#41 day 2 with a sale field N/D yesterday: today alone (known zero sale) is held to the ceiling',()=>{
 const now=Date.parse('2026-11-08T17:00:00Z'),n='07/11 - [CBO] - [TESTE] S4',y=row('s4',n,{...m(60,0,0,0,0),orders:null});
 const s=analysis('2026-11-08',now-300000,{today:[row('s4',n,m(150,0,0,0,1))],y:[y],d3:[y],d7:[y]});
 const d=evaluateShadow(s,{project:'p',params:{},now}).decisions.filter(x=>x.rule==='test-no-sale');
 assert.equal(d.length,1);assert.equal(d[0].wouldExecute,true);
 assert.doesNotMatch(d[0].reason,/vendeu ontem/);assert.match(d[0].reason,/venda de ontem N\/D/);
 const it=first24hWatch(s,{project:'p',now}).items.find(i=>i.objectId==='s4');assert.deepEqual([it.level,it.spend],['over',150]);
});

test('#5 the owner\'s "Já fiz no Gerenciador" report counts as the owner, not as a manager',()=>{
 const now=Date.parse('2026-11-09T17:00:00Z');
 const [entry]=mergeShadow([],[{rule:'test-no-sale',project:'p',adAccountId:'acc1',objectId:'o1',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},wouldExecute:true,blockedBy:[]}],{now:now-H,day:'2026-11-09'});
 const ev={project:'p',adAccountId:'acc1',objectId:'o1',action:'pause',at:iso(now-30*60000),actor:'Você · informado no notch',origin:'owner'};
 const [e]=shadowOutcomes([entry],[ev]);
 assert.equal(e.manager,null);assert.equal(e.owner.actor,'Você · informado no notch');
 const b=shadowSummary([e],{day:'2026-11-09'}).byRule['test-no-sale'];assert.deepEqual([b.managerDid,b.bunkerFirst],[0,0]);
});

test('#7 a manager pause undone before the decision is not the reaction: the later pause that stuck is',()=>{
 const t=h=>Date.parse('2026-11-09T'+h+':00Z'),dec={rule:'test-no-sale',project:'p',adAccountId:'acc1',objectId:'o2',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},blockedBy:[]};
 const list=mergeShadow(mergeShadow([],[{...dec,wouldExecute:false}],{now:t('14:00'),day:'2026-11-09'}),[{...dec,wouldExecute:true}],{now:t('15:00'),day:'2026-11-09'});
 const ev=(action,at,actor)=>({project:'p',adAccountId:'acc1',objectId:'o2',action,actor,at:iso(t(at)),origin:'history'});
 const [e]=shadowOutcomes(list,[ev('pause','13:00','Gestor X'),ev('activate','13:20','Gestor X'),ev('pause','15:30','Gestor Y')]);
 assert.deepEqual([e.manager.actor,e.manager.minutesAfter],['Gestor Y',90]);
 assert.equal(shadowSummary([e],{day:'2026-11-09'}).byRule['test-no-sale'].bunkerFirst,1);
 // Without the reversal, a pre-decision pause inside the guard still counts.
 assert.equal(shadowOutcomes(list,[ev('pause','13:00','Gestor X')])[0].manager.actor,'Gestor X');
});

const yWin=(day,rows)=>({...base,period:'yesterday',from:iso(dayStart(day)),to:iso(dayStart(day)+D),rows});
test('#8 a D+1 spend N/D is graded N/D and stays open for a later complete reading',()=>{
 const e={id:'x',rule:'bad-day-reduce',project:'p',adAccountId:'acc1',objectId:'c1',day:'2026-11-08',action:'budget',before:{dailyBudget:100},after:{dailyBudget:80}};
 const r={adAccountId:'acc1',externalId:'c1',...m(null,900)};
 const [g]=shadowGrades([e],[yWin('2026-11-09',[r])]);
 assert.equal(g.grade.verdict,'N/D');assert.equal(g.grade.next,undefined);assert.equal(shadowSummary([g]).scorecard.stopped,0);
 const [g2]=shadowGrades([g],[yWin('2026-11-09',[{...r,spend:500}])]);
 assert.equal(g2.grade.verdict,'errou');assert.equal(g2.grade.next.spend,500);
 // A measured zero or an absent row is still "parou".
 assert.equal(shadowGrades([e],[yWin('2026-11-09',[])])[0].grade.verdict,'parou');
});

test('#10 night-increase is graded by D, the day the raise acts on',()=>{
 const e={id:'n',rule:'night-increase',project:'p',adAccountId:'acc1',objectId:'n1',day:'2026-11-09',action:'budget',before:{dailyBudget:100},after:{dailyBudget:200}};
 const lossD={adAccountId:'acc1',externalId:'n1',...m(400,100)},winD1={adAccountId:'acc1',externalId:'n1',...m(400,900)};
 const [g1]=shadowGrades([e],[yWin('2026-11-09',[lossD])]);assert.equal(g1.grade.verdict,'errou');assert.equal(g1.grade.basis,'day');
 const [g2]=shadowGrades([g1],[yWin('2026-11-10',[winD1])]);assert.equal(g2.grade.verdict,'errou','D+1 does not overrule D');
 // Other rules keep the next day.
 const [o]=shadowGrades(shadowGrades([{...e,id:'m',rule:'morning-increase'}],[yWin('2026-11-09',[lossD])]),[yWin('2026-11-10',[winD1])]);assert.equal(o.grade.verdict,'acertou');
});

test('#47 an alert-only new-sale-loss entry is not graded as a cut',()=>{
 const now=Date.parse('2026-11-07T17:00:00Z'),n='07/11 - [CBO] - [TESTE] AL';
 const d=evaluateShadow(analysis('2026-11-07',now-300000,{today:[row('al',n,m(400,360,1,1,3))]}),{project:'p',params:{},now}).decisions.find(x=>x.rule==='new-sale-loss');
 assert.equal(d.alertOnly,true);assert.equal(d.wouldExecute,false);
 const [entry]=mergeShadow([],[d],{now,day:'2026-11-07'});
 const [g]=shadowGrades([entry],[yWin('2026-11-08',[{adAccountId:'acc1',externalId:'al',...m(300,600,3)}])]);
 assert.equal(g.grade,undefined);
 assert.deepEqual(shadowSummary([g]).scorecard,{days:7,graded:0,right:0,wrong:0,winnersCut:0,stopped:0});
 // An entry stored before the flag is recognized by its "Só alerta" reason; a real pause is still graded.
 const legacy={...entry,alertOnly:undefined};assert.equal(shadowGrades([legacy],[yWin('2026-11-08',[{adAccountId:'acc1',externalId:'al',...m(300,600,3)}])])[0].grade,undefined);
 const real={...entry,alertOnly:false,blockedBy:[],firstWouldExecuteAt:iso(now)};
 assert.equal(shadowGrades([real],[yWin('2026-11-08',[{adAccountId:'acc1',externalId:'al',...m(300,600,3)}])])[0].grade.winnerCut,true);
});

test('#11 a 2nd day by schedule that began two days ago counts that day too (since launch)',()=>{
 const now=Date.parse('2026-11-09T12:00:00Z'),startAt='2026-11-07T14:00:00Z';// 46h ago, started 07/11 local
 const n='[CBO] - [TESTE] E',y=row('e1',n,m(35,0,0,0,0)),r3=row('e1',n,m(95,0,0,0,0));
 const s=analysis('2026-11-09',now-300000,{today:[row('e1',n,m(6,0,0,0,0),{startAt})],y:[y],d3:[r3],d7:[r3]});
 const it=first24hWatch(s,{project:'p',now}).items[0];assert.deepEqual([it.stage,it.spend,it.level],['second-day',101,'pause']);
 assert.equal(evaluateShadow(s,{project:'p',params:{},now}).decisions.filter(d=>d.rule==='test-no-sale').length,1);
 // Without the 3-day window, the reading says what it left out instead of "desde o início".
 const no3={...s,snapshots:s.snapshots.filter(x=>x.period!=='3d')},it2=first24hWatch(no3,{project:'p',now}).items[0];
 assert.equal(it2.spend,41);assert.doesNotMatch(it2.reason,/desde o início/);assert.match(it2.reason,/anteontem não lido/);
});

test('#12 after midnight (live-only cut) a day-2 campaign keeps yesterday from the last analysis cut',()=>{
 const now=Date.parse('2026-11-09T03:40:00Z');// 00:40 local on 09/11, analysis still of 08/11
 const c=row('c1','[CBO] - [TESTE] C',m(95,0,0,0,0),{startAt:iso(now-30*H)}),dd=row('d1','08/11 - [CBO] - [TESTE] D',m(97,0,0,0,0));
 const s=analysis('2026-11-08',now-50*60000,{today:[c,dd]});
 const liveItem=liveCut('2026-11-09',now-30000,[row('c1','[CBO] - [TESTE] C',m(8,0,0,0,0),{startAt:iso(now-30*H)}),row('d1','08/11 - [CBO] - [TESTE] D',m(5,0,0,0,0))]);
 const b=first24hWatch(s,{project:'p',now,liveItem});assert.equal(b.aligned,false);
 const ic=b.items.find(i=>i.objectId==='c1'),id=b.items.find(i=>i.objectId==='d1');
 assert.deepEqual([ic.stage,ic.spend,ic.level],['second-day',103,'pause']);assert.ok(id,'name-dated day-2 campaign stays on the board');assert.equal(id.spend,102);
 const d=evaluateShadow(s,{project:'p',params:{},now,liveItem}).decisions.filter(x=>x.rule==='test-no-sale');
 assert.deepEqual(d.map(x=>x.objectId).sort(),['c1','d1']);assert.match(d[0].limitations.join(' '),/último corte da análise de ontem/);
 // With no previous cut at all, the second day says yesterday was not read.
 const bare={...s,snapshots:s.snapshots.map(x=>x.period==='today'?{...x,rows:[]}:x)};
 const it=first24hWatch(bare,{project:'p',now,liveItem}).items.find(i=>i.objectId==='c1');
 assert.equal(it.spend,8);assert.match(it.reason,/ontem não lido/);
});

test('#12b live-only day 2 without yesterday read: the shadow declares it in the pause record',()=>{
 const now=Date.parse('2026-11-09T03:40:00Z'),startAt=iso(now-30*H);
 const s=analysis('2026-11-08',now-50*60000,{today:[]}),liveItem=liveCut('2026-11-09',now-30000,[row('c2','[CBO] - [TESTE] C2',m(105,0,0,0,0),{startAt})]);
 const d=evaluateShadow(s,{project:'p',params:{},now,liveItem}).decisions.find(x=>x.rule==='test-no-sale');
 assert.ok(d);assert.match(d.limitations.join(' '),/gasto de ontem e de anteontem não foi lido/);assert.doesNotMatch(d.reason,/desde o início/);
});

test('#47/#10 review: grades frozen before the fix follow the new rules (alert-only dropped, night-increase by D)',()=>{
 const alert={id:'la',rule:'new-sale-loss',project:'p',adAccountId:'acc1',objectId:'la1',day:'2026-11-07',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},blockedBy:['Só alerta: ROI fictício.'],firstWouldExecuteAt:null,grade:{day:{spend:300,result:-20,roi:0.9},next:{spend:200,result:100,roi:1.5},verdict:'errou',winnerCut:true}};
 const [a]=shadowGrades([alert],[]);assert.equal(a.grade,undefined);
 assert.deepEqual(shadowSummary([a]).scorecard,{days:7,graded:0,right:0,wrong:0,winnersCut:0,stopped:0});
 const night={id:'ln',rule:'night-increase',project:'p',adAccountId:'acc1',objectId:'ln1',day:'2026-11-07',action:'budget',before:{dailyBudget:100},after:{dailyBudget:200},grade:{day:{spend:300,result:-50,roi:0.8},next:{spend:200,result:100,roi:1.5},verdict:'acertou',winnerCut:false}};
 const [n]=shadowGrades([night],[]);assert.equal(n.grade.verdict,'errou');assert.equal(n.grade.basis,'day');
 assert.equal(shadowGrades([n],[])[0],n,'once graded by D it stays frozen');
 // A legacy D+1 verdict with no D reading loses its verdict instead of counting as D.
 const [o]=shadowGrades([{...night,grade:{next:{spend:200,result:100,roi:1.5},verdict:'acertou',winnerCut:false}}],[]);assert.equal(o.grade.verdict,undefined);assert.equal(o.grade.next.spend,200);
 // A legacy D+1 verdict regraded from the D window when that window is still read.
 const [w]=shadowGrades([{...night,grade:{next:{spend:200,result:100,roi:1.5},verdict:'acertou'}}],[yWin('2026-11-07',[{adAccountId:'acc1',externalId:'ln1',...m(400,100)}])]);assert.equal(w.grade.verdict,'errou');assert.equal(w.grade.basis,'day');
});
