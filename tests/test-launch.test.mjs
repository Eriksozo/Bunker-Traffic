import test from 'node:test';
import assert from 'node:assert/strict';
import {testLaunchContext,isTestCampaign,verifiedNoSpendPeriods} from '../lib/test-launch.mjs';
import {actionQueue,isYoungTest} from '../lib/daily-brief.mjs';
import {candidates} from '../lib/analysis.mjs';
import {selectLearningFocus} from '../lib/campaign-learning-coverage.mjs';
const now=Date.parse('2026-11-07T15:00:00Z');
const row=(id='c',account='a')=>({externalId:id,adAccountId:account,projectId:'p',level:'campaign',provider:'meta',name:'07/11 - [TESTE] NEW',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:250,revenueNet:0,frontOrders:0,orders:0,checkouts:5,adCosts:10,productCost:0,saleTax:0});
const windows=r=>Object.fromEntries(['7d','3d','yesterday','today'].map(p=>[p,p==='today'?r:{...r,spend:0,orders:0,frontOrders:0,revenueNet:0}]));
const context=(r,w=windows(r),opts={})=>testLaunchContext(r,w,{now,...opts});
const state=r=>({config:{p:{projectName:'Fictício',testHours:24}},snapshots:Object.entries(windows(r)).map(([period,r])=>({projectId:'p',level:'campaign',period,source:'Malva MCP',timezone:'America/Sao_Paulo',from:'2026-11-07T03:00:00Z',to:'2026-11-08T03:00:00Z',fetchedAt:new Date(now-1000).toISOString(),lastSyncAt:new Date(now-2000).toISOString(),complete:true,rows:[r]}))});
test('First-day zero sales are reviewable before 24h; neither schedule nor automatic pause is invented',()=>{
 const r=row(),v=context(r);assert.equal(v.priority,true);assert.equal(v.basis,'name-unconfirmed');assert.equal(v.historyKnown,true);assert.equal(v.ageHours,null);assert.equal(v.canExecute,false);assert.equal(v.automaticPause,false);
});
test('Confirmed delivery time and proposed scheduling have different provenance',()=>{
 const r={...row(),deliveryStartedAt:'2026-11-07T03:00:00Z'};assert.equal(context(r).basis,'delivery');assert.equal(context(r).ageHours,12);
 delete r.deliveryStartedAt;r.startAt='2026-11-07T03:00:00Z';assert.equal(context(r).basis,'schedule-unconfirmed');assert.equal(context(r).ageHours,null);
});
test('All closed windows must be known; their overlapping spend is never summed',()=>{
 const r=row(),w=windows(r);delete w['7d'];const v=context(r,w);assert.equal(v.priority,true);assert.equal(v.historyKnown,false);
 const undated={...r,name:'[TESTE] NEW'};assert.equal(context(undated,{}).eligible,false);assert.equal(context(undated,windows(undated)).basis,'first-spend-unconfirmed');
});
test('Earlier spend or an old delivery defeats a renamed date; a profitable history is preserved',()=>{
 const r=row(),w=windows(r);w.yesterday.spend=100;w.yesterday.frontOrders=2;assert.equal(context(r,w).eligible,false);
 assert.equal(context({...r,deliveryStartedAt:'2026-11-01T03:00:00Z'}).eligible,false);
});
test('Future schedule/delivery cannot be described as a running new test',()=>{
 for(const field of ['startAt','deliveryStartedAt'])assert.equal(context({...row(),[field]:'2026-11-08T03:00:00Z'}).eligible,false);
});
test('Timezone rollover uses project day; prefix alone remains unconfirmed',()=>{
 const r={...row(),name:'06/11 - [TESTE] NEW'},w={};
 assert.equal(context(r,w,{now:Date.parse('2026-11-07T01:00:00Z')}).eligible,true);
 assert.equal(context(r,w,{now:Date.parse('2026-11-07T04:00:00Z')}).eligible,false);
});
test('Unknown numbers, a purchase or attributed revenue never manufacture a no-sale signal',()=>{
 for(const extra of [{frontOrders:null},{orders:null},{revenueNet:null},{frontOrders:1},{orders:1},{revenueNet:25},{spend:0}])assert.equal(context({...row(),...extra}).priority,false);
});
test('Warmup, Avatars, scale, foreign providers, disabled accounts and paused campaigns are excluded',()=>{
 for(const name of ['[ENGAJAMENTO] [TESTE]','[AVATAR] [TESTE]','[PRE-ESCALA] [TESTE]','[COST-CAP] [TESTE]'])assert.equal(isTestCampaign(name),false);
 for(const extra of [{provider:'kwai'},{accountStatus:{active:false}},{status:'PAUSED'},{effectiveStatus:'PAUSED'}])assert.equal(context({...row(),...extra}).eligible,false);
});
test('Another account with the same name cannot supply the history or consume the losing copy',()=>{
 const r=row(),w=windows(row('c','other'));w.today={...row('c','other'),frontOrders:3,orders:4,revenueNet:1000};
 assert.equal(context(r,w).priority,true);assert.equal(context(r,w).historyKnown,false);assert.equal(context(w.today,windows(w.today)).priority,false);
});
test('Triage overrides the blanket 24h shield for fresh no-sale first-day tests, not a provider command',()=>{
 const r=row(),s=state(r),c=candidates(s,'p',now)[0];assert.equal(c.decision,'Revisar teste novo sem vendas');assert.equal(c.testLaunch.canExecute,false);
 const q=actionQueue([c],{now});assert.equal(q.protectedTests,0);assert.equal(q.priorityTests,1);assert.equal(q.items[0].testLaunch.priority,true);
});
test('The daily queue retains young winners for maturation and prioritizes the exposed new test',()=>{
 const r=row(),loser=candidates(state(r),'p',now)[0],winnerRow={...row('winner'),spend:300,frontOrders:3,orders:4,revenueNet:1200},winner=candidates(state(winnerRow),'p',now)[0];
 const q=actionQueue([loser,winner],{now});assert.equal(q.priorityTests,1);assert.equal(q.protectedTests,1);assert.deepEqual(q.items.map(x=>x.candidate.row.externalId),['c']);
 assert.equal(isYoungTest({row:{name:'[ESCALA]',deliveryStartedAt:new Date(now-1000).toISOString()}},now),false);
});
test('Agent focus admits smaller exposed tests without replacing two rotating slots or freezing a new target set mid-job',()=>{
 const r=row(),s=state(r);for(const cut of s.snapshots)for(let i=0;i<10;i++)cut.rows.push({...row('old'+i),name:'[ESCALA] OLD',spend:10000-i,revenueNet:20000,frontOrders:10,orders:10});
 const focus=selectLearningFocus(s,'p',now);assert.equal(focus.length,6);assert.equal(focus[0].externalId,'c');assert.equal(new Set(focus.map(r=>r.externalId)).size,6);
});

// Closed windows are collected with status "spent": a genuinely new test never has a row there.
const spentOnlyState=(r,extra=[])=>{
 const today={projectId:'p',level:'campaign',period:'today',source:'Malva MCP',timezone:'America/Sao_Paulo',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:new Date(now-1000).toISOString(),lastSyncAt:new Date(now-2000).toISOString(),complete:true,rows:[r,...extra]};
 const closedCut=(period,from)=>({...today,period,from,to:'2026-11-07T03:00:00.000Z',rows:extra.map(x=>({...x,spend:500}))});
 return {config:{p:{projectName:'Fictício',testHours:24}},snapshots:[closedCut('7d','2026-10-31T03:00:00.000Z'),closedCut('3d','2026-11-04T03:00:00.000Z'),closedCut('yesterday','2026-11-06T03:00:00.000Z'),today]};
};
test('A test named for yesterday and first spending today is found through complete spent-only closed sources',()=>{
 const r={...row(),name:'06/11 - [TESTE] SCHEDULED'},s=spentOnlyState(r),todayFrom=s.snapshots[3].from;
 assert.deepEqual(verifiedNoSpendPeriods(s.snapshots,'p',r,todayFrom),['7d','3d','yesterday']);
 assert.equal(context(r,{today:r}).eligible,false,'without verified sources the absence stays N/D');
 const v=context(r,{today:r},{noSpendPeriods:verifiedNoSpendPeriods(s.snapshots,'p',r,todayFrom)});
 assert.equal(v.priority,true);assert.equal(v.basis,'first-spend-unconfirmed');assert.equal(v.historyKnown,true);assert.deepEqual(v.noSpendPeriods,['7d','3d','yesterday']);assert.equal(v.canExecute,false);assert.equal(v.automaticPause,false);
 const c=candidates(s,'p',now).find(x=>x.row.externalId==='c');assert.equal(c.decision,'Revisar teste novo sem vendas');
 assert.equal(actionQueue([c],{now}).priorityTests,1);
});
test('Stale, incomplete, duplicated, unsynced or foreign closed cuts never prove absence of spend',()=>{
 const r={...row(),name:'06/11 - [TESTE] SCHEDULED'},base=spentOnlyState(r),todayFrom=base.snapshots[3].from;
 const variant=f=>{const s=structuredClone(base);f(s.snapshots);return verifiedNoSpendPeriods(s.snapshots,'p',r,todayFrom);};
 assert.deepEqual(variant(x=>{x[2].to='2026-11-06T03:00:00.000Z';}),['7d','3d'],'a closed cut from another day is not today\'s yesterday');
 assert.deepEqual(variant(x=>{x[1].complete=false;}),['7d','yesterday']);
 assert.deepEqual(variant(x=>{x.push({...x[0]});}),['3d','yesterday']);
 assert.deepEqual(variant(x=>{x[0].lastSyncAt=null;}),['3d','yesterday']);
 assert.deepEqual(variant(x=>{x[0].lastSyncAt='2026-11-06T20:00:00.000Z';}),['3d','yesterday'],'source synced before the window closed');
 assert.deepEqual(variant(x=>{x[0].source='Importado';}),['3d','yesterday']);
 assert.deepEqual(variant(x=>{x[0].projectId='q';}),['3d','yesterday']);
 assert.deepEqual(verifiedNoSpendPeriods(base.snapshots,'p',r,undefined),[]);
 // The same ID in another account does not hide this account's absence; this account's own row does.
 assert.deepEqual(variant(x=>{x[2].rows.push({...r,adAccountId:'other',spend:90});}),['7d','3d','yesterday']);
 assert.deepEqual(variant(x=>{x[2].rows.push({...r,spend:90});}),['7d','3d']);
});
test('Earlier spend found in a closed source still defeats the date and the verified absences of other windows',()=>{
 const r={...row(),name:'06/11 - [TESTE] SCHEDULED'},w={today:r,yesterday:{...r,spend:90,frontOrders:0}};
 assert.equal(context(r,w,{noSpendPeriods:['7d','3d','yesterday']}).eligible,false);
 assert.equal(context(r,{today:r},{noSpendPeriods:['7d','3d']}).eligible,false,'two verified windows are not three');
});
test('Agent focus reserves a priority slot for the scheduled first-day test instead of the archive',()=>{
 const r={...row(),name:'06/11 - [TESTE] SCHEDULED',spend:120},old=Array.from({length:10},(_,i)=>({...row('old'+i),name:'[ESCALA] OLD',spend:10000-i,revenueNet:20000,frontOrders:10,orders:10}));
 const focus=selectLearningFocus(spentOnlyState(r,old),'p',now);assert.equal(focus.length,6);assert.equal(focus[0].externalId,'c');
});
