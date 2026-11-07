import test from 'node:test';
import assert from 'node:assert/strict';
import {collectActivityHistory,activityHistoryProjects,historyActor} from '../lib/activity-history.mjs';
import {activityLog,activitySummary} from '../lib/campaign-activity.mjs';
import {companionSummary} from '../lib/companion-summary.mjs';
const now=Date.parse('2026-11-07T17:00:00Z'),project={id:'p',name:'Projeto',timezone:'America/Sao_Paulo'};
const event=(id,objectId='c',name='Ana',extra={})=>({id,at:'2026-11-07T13:00:00.000Z',source:'malva',category:'status',automatic:false,actor:name?{key:'malva:technical-id',name,profile:null}:null,object:{level:'campaign',externalId:objectId,name:'Campanha '+objectId},account:{id:'act',label:'Conta',provider:'meta',currency:'USD'},values:{kind:'status',from:'active',to:'paused'},...extra});
const page=(items,cursor=null)=>({timezone:project.timezone,period:{from:'2026-11-01T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',timezone:project.timezone},items,nextCursor:cursor});
const source=pages=>{const calls=[];return {calls,async read(tool,args){calls.push({tool,args});if(!pages.length)throw Error('Unexpected source call');return pages.shift();}};};

test('project history includes campaign edits missed between observations, with Malva snake_case budgets and lowercase status',async()=>{
 const read=source([page([event('pause'),event('budget','other','Bruno',{category:'budget',values:{kind:'money',field:'daily_budget',from:200,to:160,currency:'USD'}})])]);
 const r=await collectActivityHistory(read,project,null,{now:()=>now});
 assert.equal(r.complete,true);assert.equal(r.calls,1);assert.equal(r.events[0].actor,'Ana');assert.equal(r.events[0].before,'ACTIVE');
 assert.equal(r.events[1].field,'dailyBudget');assert.equal(r.events[1].actor,'Bruno');
 assert.deepEqual(read.calls[0].args,{projectId:'p',provider:['meta'],who:'all',level:['campaign'],category:['budget','status'],limit:100,preset:'custom',from:'2026-11-01',to:'2026-11-07'});
 const state={config:{p:{projectName:'Projeto'}},snapshots:[],changeAttributions:r.events};
 const web=activityLog(state,{now}),notch=companionSummary(state,{project:'p',now});
 assert.deepEqual(web.map(e=>[e.objectId,e.actor,e.action]).sort(),[['c','Ana','pause'],['other','Bruno','reduce']]);
 assert.deepEqual(notch.activity.summary,activitySummary(web));
 assert.equal(notch.activity.recent.find(e=>e.campaignId==='c').actor,'Ana');
 assert.equal(notch.activity.recent.find(e=>e.campaignId==='other').percent,-20);
});

test('pagination refreshes head and resumes original backfill without losing the cursor',async()=>{
 const r1=await collectActivityHistory(source([page([event('head')],'cursor1'),page([event('older')],'cursor2')]),project,null,{now:()=>now});
 assert.equal(r1.calls,2);assert.equal(r1.complete,false);assert.equal(r1.pending.cursor,'cursor2');
 const read=source([page([event('new')],'newCursor'),page([event('oldest')])]);
 const r2=await collectActivityHistory(read,project,r1,{now:()=>now+60000});
 assert.equal(read.calls[1].args.cursor,'cursor2');assert.equal(r2.pending.cursor,'newCursor');
 assert.deepEqual(r2.events.map(e=>e.eventId),['new','oldest']);
 const last=await collectActivityHistory(source([page([event('head')]),page([event('tail')])]),project,r2,{now:()=>now+120000});
 assert.equal(last.complete,true);
});

test('project rotation covers all configured projects without six-hour negative caching and respects pause',()=>{
 const s={config:{a:{projectName:'A'},b:{projectName:'B'},c:{projectName:'C'}}};
 assert.deepEqual(activityHistoryProjects(s,[],now).map(p=>p.id),['a','b']);
 assert.deepEqual(activityHistoryProjects(s,[{project:'a',checkedAt:new Date(now).toISOString(),error:'FAILED'},{project:'b',checkedAt:new Date(now).toISOString()}],now).map(p=>p.id),['c']);
 assert.deepEqual(activityHistoryProjects({...s,paused:true},[],now),[]);
 assert.deepEqual(activityHistoryProjects(s,[{project:'a',checkedAt:new Date(now-61000).toISOString()}],now).map(p=>p.id),['b','c']);
});

test('invalid source identity, future dates, out-of-window data and changed pagination fail without partial results',async()=>{
 for(const bad of [page([event('foreign','c','X',{account:{id:'act',provider:'kwai',currency:'USD'}})]),page([event('future','c','X',{at:'2026-11-07T23:00:00Z'})]),page([event('old','c','X',{at:'2026-10-30T23:00:00Z'})]),{...page([]),timezone:'UTC'}]){
  await assert.rejects(collectActivityHistory(source([bad]),project,null,{now:()=>now}));
 }
 const prior={pending:{project:'other',timezone:project.timezone}};
 await assert.rejects(collectActivityHistory(source([page([])]),project,prior,{now:()=>now}),/IDENTITY/);
 await assert.rejects(collectActivityHistory(source([{...page([]),period:{...page([]).period,from:'2026-11-07T03:00:00Z'}}]),project,null,{now:()=>now}),/PERIOD/);
 const other={...page([]),period:{...page([]).period,from:'2026-11-02T03:00:00Z'}};
 await assert.rejects(collectActivityHistory(source([page([],'next'),other]),project,null,{now:()=>now}),/PERIOD_CHANGED/);
 await assert.rejects(collectActivityHistory(source([page([],'loop'),page([],'loop')]),project,{pending:{project:'p',timezone:project.timezone,request:{},period:page([]).period,cursor:'loop',cursors:['loop']}},{now:()=>now}),/CURSOR/);
});

test('missing author remains unknown; a technical ID or profile is never a manager name',async()=>{
 assert.equal(historyActor({key:'id',profile:'Malva'}),null);assert.equal(historyActor(null,true),'Regra automática');
 const r=await collectActivityHistory(source([page([event('unknown','c',null)])]),project,null,{now:()=>now});
 assert.equal(r.events[0].actor,null);
 const s={config:{p:{projectName:'Projeto'}},snapshots:[],changeAttributions:r.events};
 assert.equal(companionSummary(s,{project:'p',now}).activity.summary.pause.unknown,1);
});

test('The notch queue drops a campaign the manager paused after the analysis',async()=>{
 const {companionSummary:summary}=await import('../lib/companion-summary.mjs');
 const now=Date.parse('2026-11-07T19:30:00Z'),base={projectId:'p',projectName:'P',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true,fetchedAt:'2026-11-07T18:27:00Z',lastSyncAt:'2026-11-07T18:22:00Z'};
 const r={externalId:'c1',adAccountId:'act',accountName:'CA 1',name:'07/11 - [TESTE] X',level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:50,budgetCurrency:'USD',spend:200,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:2,impressions:1000,linkClicks:20};
 const state={config:{p:{projectName:'P'}},snapshots:[{...base,period:'today',from:'2026-11-07T03:00:00Z',to:'2026-11-08T03:00:00Z',rows:[r]}]};
 const before=summary(state,{project:'p',now});
 const pausedState={...state,changeAttributions:[{key:'k1',project:'p',adAccountId:'act',objectId:'c1',name:r.name,accountName:'CA 1',field:'status',before:'ACTIVE',after:'PAUSED',at:'2026-11-07T19:07:32Z',actor:'Gestor',eventId:'e1'}]};
 const after=summary(pausedState,{project:'p',now});
 assert.equal(after.queue.some(q=>q.campaignId==='c1'),false);
 assert.equal(before.queue.some(q=>q.campaignId==='c1'),true,'it was queued before the pause');
});
