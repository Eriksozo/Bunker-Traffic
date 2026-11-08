import test from 'node:test';
import assert from 'node:assert/strict';
import {companionSummary,projectBoard} from '../lib/companion-summary.mjs';

// The notch queue must drop a campaign paused after the analysis from the same sources as the web queue.
const now=Date.parse('2026-11-08T15:00:00Z'),iso=h=>new Date(now-h*3600000).toISOString();
const m=(spend,net,front=1)=>({spend,revenue:net,revenueNet:net,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:2,impressions:1000,linkClicks:10,refundedRevenue:0});
const snap=(period,rows,fetchedH=2,projectId='p')=>({projectId,projectName:projectId.toUpperCase(),period,level:'campaign',source:'Malva MCP',complete:true,timezone:'UTC',from:'2026-11-08T00:00:00Z',to:'2026-11-09T00:00:00Z',fetchedAt:iso(fetchedH),lastSyncAt:iso(fetchedH+0.05),rows});
const row=id=>({externalId:id,adAccountId:'act',accountName:'Conta',name:'Campanha '+id,level:'campaign',provider:'meta',effectiveStatus:'ACTIVE',status:'ACTIVE',accountStatus:{active:true},deliveryStartedAt:'2026-10-01T00:00:00Z'});
const state=(fetchedH=2)=>({config:{p:{projectName:'P'}},paused:false,ownerChoices:[],decisions:[],proposals:[],decisionHistory:[],collaborationMessages:[],
 snapshots:[snap('today',[{...row('c1'),...m(500,200)}],fetchedH),snap('yesterday',[{...row('c1'),...m(400,500)}],fetchedH),snap('3d',[{...row('c1'),...m(1200,1300)}],fetchedH),snap('7d',[{...row('c1'),...m(3000,4000)}],fetchedH)]});
const liveItem=(status,fetchedH)=>({projectId:'p',snapshot:snap('today',[{...row('c1'),effectiveStatus:status,status,...m(500,200)}],fetchedH)});
const losses=out=>out.queue.filter(q=>q.kind==='loss').map(q=>q.campaignId);

test('baseline: without a newer pause the losing campaign is in the notch queue and board',()=>{
 const out=companionSummary(state(),{project:'p',now});
 assert.deepEqual(losses(out),['c1']);assert.equal(out.board[0].losses,1);
});
test('a pause seen only in the live reading after the analysis drops the campaign from queue and board',()=>{
 const live=[liveItem('PAUSED',0.5)];
 for(const project of ['p','all']){const out=companionSummary(state(),{project,now,live});assert.deepEqual(losses(out),[],project);assert.equal(out.board[0].losses,0,project);}
 assert.equal(projectBoard(state(),now,{live})[0].losses,0);
 assert.equal(projectBoard(state(),now)[0].losses,1,'without live rows the board keeps the analysis status');
});
test('live rows that are older than the analysis, still active, or stale never hide the campaign',()=>{
 assert.deepEqual(losses(companionSummary(state(),{project:'p',now,live:[liveItem('PAUSED',3)]})),['c1'],'live reading older than the analysis');
 assert.deepEqual(losses(companionSummary(state(),{project:'p',now,live:[liveItem('ACTIVE',0.5)]})),['c1'],'live reading still active');
 const otherDay={projectId:'p',snapshot:{...liveItem('PAUSED',0.5).snapshot,from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z'}};
 assert.deepEqual(losses(companionSummary(state(),{project:'p',now,live:[otherDay]})),['c1'],'a closed-day snapshot is not a live reading');
 assert.deepEqual(losses(companionSummary(state(),{project:'p',now,live:[{...liveItem('PAUSED',0.5),projectId:'q'}]})),['c1'],'another project');
});
test('a pause older than the 24h activity window still counts when the analysis is older still',()=>{
 const s=state(30);s.decisionHistory=[{id:'h',project:'p',projects:['p'],adAccountId:'act',objectId:'c1',name:'Campanha c1',field:'status',before:'ACTIVE',after:'PAUSED',occurredAt:iso(26),actor:{name:'Ana'}}];
 const out=companionSummary(s,{project:'p',now});
 assert.deepEqual(losses(out),[]);assert.equal(out.board[0].losses,0);
 assert.equal(out.activity.recent.length,0,'the display window stays 24h');
});
