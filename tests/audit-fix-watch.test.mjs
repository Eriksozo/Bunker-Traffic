import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignWatchPlan} from '../lib/campaign-watch.mjs';
const now=Date.parse('2026-11-03T13:00:00Z'),stamp=d=>new Date(now+d).toISOString();
const row=(id='c',name='[ESCALA] '+id)=>({externalId:id,adAccountId:'a',accountName:'a',name,provider:'meta',level:'campaign',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'BRL',dailyBudget:500,spend:100,revenueNet:300,adCosts:0,productCost:0,saleTax:0,frontOrders:3,orders:3,checkouts:3});
// Fresh, aligned four-period analysis; `cut` edits each period's row, `live` edits today's live row.
function plan({name,cut={},live={}}={}){
 const r=row('c',name),from='2026-11-03T00:00:00.000Z',to='2026-11-04T00:00:00.000Z';
 const snapshot={projectId:'p',projectName:'John',period:'today',level:'campaign',source:'Malva MCP',from,to,timezone:'UTC',fetchedAt:stamp(-1000),lastSyncAt:stamp(-2000),complete:true,coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:1},rows:[{...r,...live}]};
 const snapshots=['7d','3d','yesterday','today'].map(period=>({...snapshot,period,from:period==='today'?from:'2026-10-27T00:00:00.000Z',to:period==='today'?to:from,fetchedAt:stamp(-120000),rows:cut[period]===null?[]:[{...r,...cut[period]}]}));
 return campaignWatchPlan({config:{p:{projectName:'John',targetRoas:2}},snapshots,paused:false,jobs:[],reports:[],events:[],messages:[],cadence:{enabled:false}},{items:[{projectId:'p',snapshot,error:null}]},now);
}
const kinds=p=>p.signals.map(s=>s.kind);
const zero={spend:100,revenueNet:0,frontOrders:0,orders:0};

test('Loss fires when a no-sale campaign keeps spending at ROI 0 (ROI floor, result worse)',()=>{
 const p=plan({cut:{today:zero},live:{spend:600,revenueNet:0,frontOrders:0,orders:0}});
 assert.deepEqual(kinds(p),['loss']);assert.equal(p.signals[0].canExecute,false);assert.match(p.signals[0].reason,/piorou desde a análise/);
});
test('Loss fires when the analysis was taken before any spend today (prior ROI N/D)',()=>{
 const today={spend:0,revenueNet:0,frontOrders:0,orders:0};
 assert.deepEqual(kinds(plan({cut:{today},live:{spend:800,revenueNet:50,frontOrders:1,orders:1}})),['loss']);
 assert.deepEqual(kinds(plan({cut:{today},live:{spend:800,revenueNet:0,frontOrders:0,orders:0}})),['loss']);
});
test('Unknown components stay N/D: no loss is inferred from a missing baseline result',()=>{
 assert.deepEqual(kinds(plan({cut:{today:{spend:0,revenueNet:0,productCost:null}},live:{spend:800,revenueNet:0,frontOrders:0,orders:0}})),[]);
});
test('An improving ROI below 1 is unchanged: only a worse result at equal or lower ROI counts',()=>{
 assert.deepEqual(kinds(plan({cut:{today:{spend:100,revenueNet:50}},live:{spend:200,revenueNet:120}})),[]);
});
test('[TESTE] without start date but with closed-window spend is not protected as a young test',()=>{
 const name='[TESTE] c',cut={'7d':{spend:2000,revenueNet:6000},'3d':{spend:900,revenueNet:2700},yesterday:{spend:300,revenueNet:900}};
 const loss=plan({name,cut,live:{spend:500,revenueNet:100}});
 assert.deepEqual(kinds(loss),['loss']);assert.equal(loss.signals[0].guards.testProtected,false);assert.doesNotMatch(loss.signals[0].reason,/menos de 24h/);
 const win=plan({name,cut,live:{frontOrders:4}});assert.deepEqual(kinds(win),['opportunity']);
});
test('[TESTE] without start date and no closed-window history keeps the unconfirmed-age protection',()=>{
 const p=plan({name:'[TESTE] c',cut:{'7d':null,'3d':null,yesterday:null},live:{spend:500,revenueNet:100}});
 const loss=p.signals.find(s=>s.kind==='loss');assert.ok(loss,JSON.stringify(kinds(p)));assert.equal(loss.guards.testProtected,true);assert.match(loss.reason,/idade não confirmada/);
});
test('First-day campaign that began before local midnight sums yesterday into the R$110 guard',()=>{
 const none={revenueNet:0,frontOrders:0,orders:0,checkouts:0},y={...none,spend:60};
 const p=plan({name:'[TESTE] mid',cut:{'7d':y,'3d':y,yesterday:y,today:{...none,spend:30}},live:{...none,spend:50,startAt:'2026-11-02T22:00:00Z'}});
 const s=p.signals.find(x=>x.kind==='first-24h');assert.ok(s,JSON.stringify(kinds(p)));
 assert.equal(s.newCampaign.stage,'first-day');assert.equal(s.newCampaign.spend,110);assert.equal(s.newCampaign.level,'over');assert.equal(s.canExecute,false);
 // Started after midnight: today's spend alone (R$50, below 70% of R$110) raises no first-24h signal.
 const q=plan({name:'[TESTE] mid',cut:{'7d':{...none,spend:0},'3d':{...none,spend:0},yesterday:{...none,spend:0},today:{...none,spend:30}},live:{...none,spend:50,startAt:'2026-11-03T01:00:00Z'}});
 assert.equal(kinds(q).includes('first-24h'),false);
});

test('Review fix: a first-day test without sales gets its launch signal only, not a second loss alert', () => {
 const p=plan({name:'03/11 - [TESTE] c',cut:{'7d':null,'3d':null,yesterday:null,today:{spend:20,revenueNet:0,frontOrders:0,orders:0}},live:{spend:50,revenueNet:0,frontOrders:0,orders:0,startAt:stamp(-3600000)}});
 const k=kinds(p);
 assert.ok(k.includes('new-test-risk')||k.includes('first-24h'),JSON.stringify(k));
 assert.ok(!k.includes('loss'),'one alert for the same campaign: '+JSON.stringify(k));
});
