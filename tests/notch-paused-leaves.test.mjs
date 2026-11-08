import test from 'node:test';
import assert from 'node:assert/strict';
import {first24hWatch} from '../lib/autonomy-shadow.mjs';
import {pausedAfterAnalysis,actionQueue,objectKey} from '../lib/daily-brief.mjs';

// Owner report 08/11/2026: a campaign paused from the notch stayed listed after the order was confirmed.

// Synthetic fixtures only: identifiers and values are invented.
const now=Date.parse('2026-11-07T17:00:00Z'); // 14:00 America/Sao_Paulo
const iso=ms=>new Date(ms).toISOString();
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true};
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0,extra={})=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0,...extra});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'USD',budgetRate:5,lifetimeBudget:null,...metrics,...extra});
function state({today=[],closed={}}={}){
 const cut=(period,from,rows)=>({...base,period,from,to:'2026-11-07T03:00:00.000Z',fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows});
 return {config:{p:{projectName:'Fictício'}},snapshots:[
  {...base,period:'today',from:'2026-11-07T03:00:00.000Z',to:'2026-11-08T03:00:00.000Z',fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows:today},
  cut('7d','2026-10-31T03:00:00.000Z',closed['7d']||[]),cut('3d','2026-11-04T03:00:00.000Z',closed['3d']||[]),cut('yesterday','2026-11-06T03:00:00.000Z',closed.yesterday||[])]};
}
const params={pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:300};
const order=(objectId,confirmedAt)=>({proposals:[{id:'o1',project:'p',status:'Aprovada',directOrder:true,ownerOrder:true,payload:{action:'status',adAccountId:'acc1',objectId,before:{status:'ACTIVE'},after:{status:'PAUSED'}}}],
 executions:[{id:'e1',proposalId:'o1',project:'p',status:'Confirmada',confirmedAt:iso(confirmedAt)}]});
const rows=()=>[row('b2','07/11 - [CBO] - [PRE] X',m(100,0,0,0,0)),row('b3','07/11 - [CBO] - [TESTE] Y',m(60,0,0,0,1))];
const ids=b=>b.items.map(i=>i.objectId);

test('First-24h board: a confirmed Bunker pause newer than the cut takes the campaign off at once',()=>{
 const s=state({today:rows()});
 assert.deepEqual(ids(first24hWatch(s,{project:'p',params:{},now})),['b2','b3'],'control');
 assert.deepEqual(ids(first24hWatch({...s,...order('b2',now-60000)},{project:'p',params:{},now})),['b3'],'paused from the notch 1 min ago');
 // A pause older than the cut is already in the row itself: it does not hide a campaign the cut shows active.
 assert.deepEqual(ids(first24hWatch({...s,...order('b2',now-3600000)},{project:'p',params:{},now})),['b2','b3']);
});

test('First-24h board: a newer live row with PAUSED takes it off even when the board uses the analysis cut',()=>{
 const s=state({today:rows()});
 const paused={...rows()[0],status:'PAUSED',effectiveStatus:'PAUSED'};
 const liveItem={projectId:'p',snapshot:{...s.snapshots[0],fetchedAt:iso(now-30000),lastSyncAt:iso(now-45000),from:'2026-11-06T03:00:00.000Z',rows:[paused]}};
 assert.deepEqual(ids(first24hWatch(s,{project:'p',liveItem,params:{},now})),['b3']);
 // A row whose effective status is already PAUSED never enters the board.
 assert.deepEqual(ids(first24hWatch(state({today:[{...rows()[0],effectiveStatus:'PAUSED'},rows()[1]]}),{project:'p',params:{},now})),['b3']);
});

test('Queue: a Malva cache older than the confirmed pause does not undo it; PAUSED in either field is a pause',()=>{
 const cand=[{id:'c',row:{...rows()[0],projectId:'p',sourceAt:iso(now-600000)}}];
 const events=[{project:'p',adAccountId:'acc1',objectId:'b2',action:'pause',field:'status',after:'PAUSED',at:iso(now-120000),origin:'bunker'}];
 const stale={...rows()[0],projectId:'p',status:'ACTIVE',effectiveStatus:'ACTIVE',fetchedAt:iso(now-30000),lastSyncAt:iso(now-300000)};
 assert.ok(pausedAfterAnalysis(cand,{events,liveRows:[stale]}).has(objectKey('p','acc1','b2')),'origin sync before the pause');
 assert.ok(!pausedAfterAnalysis(cand,{events,liveRows:[{...stale,lastSyncAt:iso(now-10000)}]}).has(objectKey('p','acc1','b2')),'reactivated after: active again');
 assert.ok(pausedAfterAnalysis(cand,{liveRows:[{...stale,status:'PAUSED',lastSyncAt:iso(now-10000)}]}).has(objectKey('p','acc1','b2')));
 const q=actionQueue([{id:'c',row:{...rows()[0],status:'PAUSED'},windows:{today:m(100,0)}}]);
 assert.equal(q.considered,0,'status PAUSED with effectiveStatus still ACTIVE stays out of the queue');
});

test('Shadow: the owner pause sent through the Bunker reads as done by the owner, counters unchanged',async()=>{
 const {shadowOutcomes,shadowSummary}=await import('../lib/autonomy-shadow.mjs');
 const entry={id:'x',day:'2026-11-08',rule:'test-no-sale',project:'p',adAccountId:'acc1',objectId:'b2',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},firstAt:iso(now-3600000),firstWouldExecuteAt:iso(now-3600000)};
 const mine={project:'p',adAccountId:'acc1',objectId:'b2',action:'pause',actor:'Bunker · aprovado por você',at:iso(now-1800000),origin:'bunker'};
 const [read]=shadowOutcomes([entry],[mine]);
 assert.equal(read.manager,null,'a Bunker execution is not a manager reaction');
 assert.equal(read.owner.minutesAfter,30);
 const s=shadowSummary([read],{day:'2026-11-08'});
 assert.equal(s.recent[0].owner.minutesAfter,30);
 assert.equal(s.byRule['test-no-sale'].managerDid,0);assert.equal(s.byRule['test-no-sale'].bunkerFirst,0);
 // Kept after the event ages out of the rolling window; another object or action does not count.
 assert.deepEqual(shadowOutcomes([read],[])[0].owner,read.owner);
 assert.equal(shadowOutcomes([entry],[{...mine,objectId:'other'}])[0].owner,null);
 assert.equal(shadowOutcomes([entry],[{...mine,action:'reduce'}])[0].owner,null);
});
