import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePlaybook,gradePlaybook,reportedVerdict,playScores,replayDay,replayAgreement,personAgreement,wouldHave,pbsId,pbsDayPrefix} from '../lib/playbook-eval.mjs';
import {cellColumns} from '../lib/team-observations.mjs';
import {syntheticDays,iso,dayStart,TZ,pid,shift} from './helpers/playbook-fixtures.mjs';

// Synthetic fixtures only: invented people, projects, campaigns and amounts.
const P='proj-1';
/** A hand-made test-day bin: cells for the test-pause play with known labels. */
function testBin(day,cells){
 const persons=[pid('ana'),pid('bruno')];
 const mk=c=>{const o={stage:'first-day',test:1,hour:15,slot:'13-16',spendT:3,front:0,ic:0,roiT:0,roiY:null,frontY:null,roi3:null,roi7:null,roiS:0,bBand:'BRL:0',capShare:null,raised:0,cut:0,pd:0,label:'manter',person:null,step:null,camp:'c',mv:null,lead:null,n:1,...c};
  return cellColumns.map(k=>k==='person'?(o.person?persons.indexOf(o.person):null):o[k]);};
 return {v:1,day,project:P,at:iso(dayStart(day)),cols:[...cellColumns],persons,cells:cells.map(mk),people:{},steps:{},campaigns:cells.length,y:{},base:null,excluded:{},caseRefs:[],moves:0,bf:0,obs:1};
}
const D='2026-10-31';
const cells=[
 {spendT:3,label:'pause',person:pid('ana'),mv:'m1',lead:20,camp:'a'},
 {spendT:2.5,label:'pause',person:pid('ana'),mv:'m2',lead:50,camp:'b'},
 {spendT:0.5,label:'pause',person:pid('bruno'),mv:'m3',lead:10,camp:'c'},
 {spendT:3,label:'manter',camp:'d'},
 {spendT:3.5,label:'activate',person:pid('bruno'),mv:'m4',camp:'e'},
 {spendT:0.25,label:'manter',camp:'f'},
];

test('Replay: precision, recall, lead and opposites against what the people did that day',()=>{
 const {bins}=syntheticDays({days:30,from:'2026-10-01'});
 const day=replayDay([...bins,testBin(D,cells)],{project:P,day:D})['pb:test-pause'];
 // Fitted on the 30 days before (k ≈ 1.75 tickets): fires on a, b, d, e; misses c (0.5 ticket) and f.
 assert.deepEqual([day.fired,day.agree,day.moves,day.caught,day.opposite,day.manter],[4,2,3,2,1,1]);
 assert.equal(day.lead,35,'median of 20 and 50 minutes ahead');
 const a=replayAgreement([day]);
 assert.deepEqual([a.precision,a.recall,a.leadMin,a.opposite,a.n,a.fired,a.agree],[0.5,0.667,35,0.25,3,4,2],'precision over the 4 firings, recall over the 3 team moves');
 assert.ok(a.low<0.5&&a.high>0.5,'with its 95% range');
 assert.deepEqual(personAgreement([day],pid('ana')),{precision:null,recall:1,leadMin:null,opposite:null,low:personAgreement([day],pid('ana')).low,high:1,n:2,fired:0,agree:0,caught:2},'per person: recall only (manter cells carry no person)');
 assert.equal(personAgreement([day],pid('bruno')).recall,0,'Bruno\'s early pause was not caught');
 assert.deepEqual(wouldHave([day]),{total:4,sameAsTeam:2,nobodyDid:1});
 assert.deepEqual(replayAgreement([]),{precision:null,recall:null,leadMin:null,opposite:null,low:null,high:null,n:0,fired:0,agree:0},'no moves: N/D, never 0');
 assert.equal(replayAgreement([{fired:0,agree:0,moves:5,caught:0,fit:false}]).recall,null,'a day below the minimum support is not evaluable: N/D, not 0%');
 assert.equal(wouldHave([]),null);
});

test('Replay is forward-only: nothing dated on or after the tested day reaches the fit',()=>{
 const {bins}=syntheticDays({days:30,from:'2026-10-01'});
 const t=testBin(D,cells),base=replayDay([...bins,t],{project:P,day:D});
 // Future bins (any content) and a scrambled copy of the tested day's labels in the "training" set change nothing.
 const future=syntheticDays({days:5,from:'2026-11-01',testPauseTickets:6,seed:99}).bins;
 assert.deepEqual(replayDay([...bins,t,...future],{project:P,day:D}),base);
 const otherProject=syntheticDays({days:30,from:'2026-10-01',project:'proj-2',testPauseTickets:6}).bins;
 assert.deepEqual(replayDay([...bins,t,...otherProject],{project:P,day:D}),base,'another project\'s bins never enter this replay');
 // The past does change it (it is what the fit learns from).
 const past=syntheticDays({days:30,from:'2026-10-01',testPauseTickets:3.25,seed:3}).bins;
 assert.notDeepEqual(replayDay([...past,t],{project:P,day:D})['pb:test-pause'],base['pb:test-pause']);
 assert.deepEqual(replayDay(bins,{project:P,day:'2026-12-01'}),{},'no bin for the day: nothing tested');
});

// --- Stored play decisions --------------------------------------------------------------------------------------
const DAY='2026-11-05',T0=dayStart(DAY)+15*3600000;
const decision=(over={})=>({project:P,projectName:'Projeto Um',adAccountId:'acc-1',accountName:'Conta',objectId:'c1',name:'Madura',rule:'pb:mature-loss-pause',ruleLabel:'Pausar…',action:'status',
 before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',blockedBy:[],limitations:[],metrics:{spend:300,roi:0.6},wouldFire:true,wouldExecute:true,source:'playbook',playKey:'pb:mature-loss-pause@'+P,ruleRev:'v1:aaaaaaaa',...over});

test('Merge: forced Phase 1 fields, first sighting kept, before/after frozen once it fired',()=>{
 const [e]=mergePlaybook(new Map(),[decision({firstWouldExecuteAt:iso(T0)})],{now:T0,day:DAY});
 assert.deepEqual([e.wouldExecute,e.firstWouldExecuteAt,e.ruleVersion,e.source,e.alertOnly,e.role],[false,null,null,'playbook',false,'challenger']);
 assert.equal(e.id,pbsId(DAY,decision()));assert.equal(e.firstFiredAt,iso(T0));
 const budget=decision({rule:'pb:bad-day-cut',action:'budget',before:{dailyBudget:400},after:{dailyBudget:320}});
 const [b1]=mergePlaybook(new Map(),[budget],{now:T0,day:DAY});
 const [b2]=mergePlaybook(new Map([[b1.id,b1]]),[{...budget,before:{dailyBudget:500},after:{dailyBudget:400}}],{now:T0+3600000,day:DAY});
 assert.deepEqual([b2.firstAt,b2.seen,b2.before.dailyBudget,b2.after.dailyBudget],[iso(T0),2,400,320]);
 assert.ok(pbsDayPrefix(DAY)==='pbs:["2026-11-05"'&&('pbs:'+e.id).startsWith(pbsDayPrefix(DAY)));
});

const yesterday=(day,rows)=>({projectId:P,period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:iso(dayStart(day)),to:iso(dayStart(day)+86400000),rows});
const three=(day,rows)=>({projectId:P,period:'3d',level:'campaign',complete:true,source:'Malva MCP',timezone:TZ,from:iso(dayStart(day)),to:iso(dayStart(day)+3*86400000),rows});
const crow=(spend,revenueNet)=>({adAccountId:'acc-1',externalId:'c1',provider:'meta',level:'campaign',spend,revenueNet,adCosts:0,productCost:0,saleTax:0});

test('Grades: the Sombra\'s D+1 verdict, then D+3 (final) which overrides it in reporting',()=>{
 const [e]=mergePlaybook(new Map(),[decision({rule:'pb:bad-day-cut',action:'budget',before:{dailyBudget:400},after:{dailyBudget:320}})],{now:T0,day:DAY});
 const d1=gradePlaybook([e],{snapshots:[yesterday(shift(DAY,1),[crow(300,200)])],now:T0+2*86400000})[0];
 assert.equal(d1.grade.verdict,'acertou','cut, D+1 lost money');assert.equal(reportedVerdict(d1),'acertou');
 const d3=gradePlaybook([d1],{snapshots:[three(shift(DAY,1),[crow(900,1400)])],now:T0+4*86400000})[0];
 assert.deepEqual([d3.grade.verdict,d3.grade.d3.verdict],['acertou','errou'],'D+1 kept as it was; D+3 made money');
 assert.equal(reportedVerdict(d3),'errou','D+3 overrides D+1 in reporting');
 const s=playScores([d3],{now:T0+4*86400000,revOf:()=> 'v1:aaaaaaaa',stageOf:()=>'candidata'})['pb:mature-loss-pause@'+P];
 assert.deepEqual([s.graded,s.right,s.accuracy,s.stage,s.base,s.chanceBetter],[1,0,0,'candidata',null,null]);
 assert.deepEqual(playScores([d3],{now:T0,revOf:()=> 'v2:bbbbbbbb'}),{},'only the current version is scored');
 const none=gradePlaybook([e],{snapshots:[],now:T0+86400000})[0].grade;
 assert.deepEqual([none?.verdict,none?.d3,none?.opposite],[undefined,undefined,null],'nothing read: no verdict, never a zero (only the closed 12 h opposite window)');
 // Every graded entry stays non-executable.
 assert.deepEqual([d3.wouldExecute,d3.firstWouldExecuteAt,d3.source],[false,null,'playbook']);
 // The night raise is judged by the day it acts on.
 const [n]=mergePlaybook(new Map(),[decision({rule:'pb:night-raise',action:'budget',before:{dailyBudget:400},after:{dailyBudget:520},playKey:'pb:night-raise@'+P})],{now:dayStart(DAY)+10*60000,day:DAY});
 const ng=gradePlaybook([n],{snapshots:[yesterday(DAY,[crow(300,600)])],now:dayStart(DAY)+86400000+3600000})[0];
 assert.deepEqual([ng.grade.basis,ng.grade.verdict,ng.rule],['day','acertou','pb:night-raise']);
});

test('Pause proxies: reverted within 48 h is wrong; held 48 h with ROI below 1 is "provável acerto" (not counted)',()=>{
 const [e]=mergePlaybook(new Map(),[decision()],{now:T0,day:DAY});
 const paused={...e,manager:{actor:'Ana Souza',at:iso(T0+30*60000),minutesAfter:30}};
 const back=[{id:'r1',project:P,objectId:'c1',kind:'activate',person:pid('bruno'),name:'Bruno Lima',at:iso(T0+20*3600000)}];
 const rev=gradePlaybook([paused],{snapshots:[],moves:back,now:T0+21*3600000})[0];
 assert.equal(rev.grade.pauseProxy,'revertida');assert.equal(reportedVerdict(rev),'errou');
 const pending=gradePlaybook([paused],{snapshots:[],moves:[],now:T0+24*3600000})[0];
 assert.equal(pending.grade?.pauseProxy??null,null,'before 48 h: open');
 const held=gradePlaybook([paused],{snapshots:[],moves:[],now:T0+49*3600000})[0];
 assert.equal(held.grade.pauseProxy,'provavel-acerto');assert.equal(reportedVerdict(held),null,'labelled as such, never counted as right');
 const s=playScores([held,rev],{now:T0+49*3600000});
 assert.deepEqual([s['pb:mature-loss-pause@'+P].graded,s['pb:mature-loss-pause@'+P].proxy],[1,{revertida:1,provavelAcerto:1}]);
 const fine={...paused,metrics:{roi:1.4},firstMetrics:{roi:1.4}};
 assert.equal(gradePlaybook([fine],{snapshots:[],moves:[],now:T0+49*3600000})[0].grade.pauseProxy??null,null,'held with a good ROI: N/D');
 assert.equal(gradePlaybook([e],{snapshots:[],moves:[],now:T0+49*3600000})[0].grade.pauseProxy??null,null,'nobody paused it: the D+1 grade judges');
});

test('Opposite moves: the play said cut and a person raised within 12 h (or the reverse)',()=>{
 const [e]=mergePlaybook(new Map(),[decision({rule:'pb:bad-day-cut',action:'budget',before:{dailyBudget:400},after:{dailyBudget:320}})],{now:T0,day:DAY});
 const up=[{id:'u1',project:P,objectId:'c1',kind:'increase',person:pid('carla'),name:'Carla Dias',at:iso(T0+2*3600000)}];
 const o=gradePlaybook([e],{snapshots:[],moves:up,now:T0+3*3600000})[0];
 assert.deepEqual(o.grade.opposite,{person:pid('carla'),name:'Carla Dias',kind:'increase',at:iso(T0+2*3600000)});
 const same=[{...up[0],kind:'reduce'}];
 assert.equal(gradePlaybook([e],{snapshots:[],moves:same,now:T0+13*3600000})[0].grade.opposite,null,'the same direction is agreement, not an opposite');
 const late=[{...up[0],at:iso(T0+13*3600000)}];
 assert.equal(gradePlaybook([e],{snapshots:[],moves:late,now:T0+14*3600000})[0].grade.opposite,null);
});
