import test from 'node:test';
import assert from 'node:assert/strict';
import {shadowGrades,shadowSummary} from '../lib/autonomy-shadow.mjs';

// Synthetic fixtures only. Brasília midnight of 08/11 = 03:00Z.
const P='p1',row=(over={})=>({adAccountId:'a1',externalId:'c1',spend:1000,revenueNet:500,adCosts:40,productCost:0,saleTax:0,...over});
const yesterday=(day,rows)=>({projectId:P,period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',timezone:'America/Sao_Paulo',from:day+'T03:00:00.000Z',rows});
const entry=(over={})=>({id:'x',rule:'bad-day-reduce',project:P,adAccountId:'a1',objectId:'c1',day:'2026-11-08',action:'budget',before:{dailyBudget:100},after:{dailyBudget:80},...over});

test('A cut is graded by the real next day; once read the grade stays', () => {
 let [e]=shadowGrades([entry()],[yesterday('2026-11-08',[row()])]);
 assert.equal(e.grade.day.spend,1000);assert.equal(e.grade.next,undefined,'D+1 not closed yet');
 [e]=shadowGrades([e],[yesterday('2026-11-09',[row({revenueNet:300})])]);
 assert.equal(e.grade.verdict,'acertou','next day lost money: the reduction was right');assert.equal(e.grade.day.spend,1000,'day grade kept');
 const again=shadowGrades([e],[yesterday('2026-11-09',[row({revenueNet:9000})])])[0];
 assert.equal(again.grade.verdict,'acertou','a stored grade is never rewritten');
 const [w]=shadowGrades([entry()],[yesterday('2026-11-09',[row({revenueNet:3000})])]);
 assert.equal(w.grade.verdict,'errou');assert.equal(w.grade.winnerCut,true,'cut a next-day winner (ROI >= 1.2)');
});

test('Increase is right when the next day makes money; no spend is "parou"; other projects and days never match', () => {
 const inc=entry({rule:'morning-increase',after:{dailyBudget:150}});
 assert.equal(shadowGrades([inc],[yesterday('2026-11-09',[row({revenueNet:3000})])])[0].grade.verdict,'acertou');
 assert.equal(shadowGrades([entry()],[yesterday('2026-11-09',[])])[0].grade.verdict,'parou');
 const pause=entry({rule:'test-no-sale',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'}});
 assert.equal(shadowGrades([pause],[yesterday('2026-11-09',[row({revenueNet:100})])])[0].grade.verdict,'acertou');
 assert.equal(shadowGrades([entry()],[{...yesterday('2026-11-09',[row()]),projectId:'p2'}])[0].grade,undefined);
 assert.equal(shadowGrades([entry()],[yesterday('2026-11-12',[row()])])[0].grade,undefined);
 assert.equal(shadowGrades([entry()],[{...yesterday('2026-11-09',[row()]),complete:false}])[0].grade,undefined,'incomplete source never grades');
 assert.equal(shadowGrades([entry()],[yesterday('2026-11-09',[row({productCost:null})])])[0].grade.verdict,'N/D','missing costs stay N/D');
});

test('The summary counts right, wrong and winners cut per rule', () => {
 const graded=[entry({id:'1',grade:{verdict:'acertou'}}),entry({id:'2',grade:{verdict:'errou',winnerCut:true}}),entry({id:'3',grade:{verdict:'parou'}}),entry({id:'4'})];
 const b=shadowSummary(graded).byRule['bad-day-reduce'];
 assert.deepEqual([b.total,b.graded,b.right,b.wrong,b.winnersCut],[4,2,1,1,1]);
 assert.equal(shadowSummary(graded).recent[1].grade.verdict,'errou');
});

test('The scorecard covers every retained day of the scope, not only today', () => {
 const e=(id,day,verdict,extra={})=>({id,rule:'bad-day-reduce',project:extra.project||'p1',adAccountId:'a1',objectId:id,day,action:'budget',grade:{verdict,...extra}});
 const list=[e('1','2026-11-06','acertou'),e('2','2026-11-06','errou',{winnerCut:true}),e('3','2026-11-07','parou'),e('4','2026-11-08','acertou',{project:'p2'})];
 assert.deepEqual(shadowSummary(list,{day:'2026-11-08'}).scorecard,{days:7,graded:3,right:2,wrong:1,winnersCut:1,stopped:1});
 assert.deepEqual(shadowSummary(list,{project:'p1',day:'2026-11-08'}).scorecard,{days:7,graded:2,right:1,wrong:1,winnersCut:1,stopped:1});
});
