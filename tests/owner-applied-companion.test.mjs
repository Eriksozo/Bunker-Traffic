import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
import {companionCards} from '../lib/companion-cards.mjs';
// Synthetic fixture (same shape as tests/decision-cards.test.mjs).
const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
function fixture(){
 const base={id:'22222222-2222-4222-8222-222222222222',externalId:'meta-campaign',adAccountId:'account',provider:'Meta',name:'01/11 [CBO] [TESTE] Example',accountName:'USD account',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:2,impressions:1000,linkClicks:20,refundedRevenue:0};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T03:00:00.000Z':'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]})),paused:false};
 ensureCollaboration(state,job,now);return state;
}
const card=s=>buildDecisionCards(s,project,now)[0];
const reread=(s,change,at)=>{const t=s.snapshots.find(x=>x.period==='today');s.snapshots=s.snapshots.filter(x=>x!==t).concat({...t,fetchedAt:date(at),lastSyncAt:date(at-1000),rows:t.rows.map(r=>({...r,...change}))});};
test('the notch sees an intent it can report as done, then the Malva check of the owner report',()=>{
 const s=fixture(),c=card(s);
 recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'intent-1'},'mac-touchid:test',now);
 let last=companionCards(s,{project},1,now).cards[0].lastChoice;
 assert.equal(last.status,'Pendente de revisão');assert.equal(last.canReportApplied,'pause');assert.equal(last.appliedByOwner,false);assert.equal(last.verification,null);
 const c2=card(s);recordOwnerChoice(s,{project,cardId:c2.id,signature:c2.signature,choice:'pause',clientId:'applied-1',applied:true},'mac-touchid:test',now);
 last=companionCards(s,{project},2,now).cards[0].lastChoice;
 assert.equal(last.appliedByOwner,true);assert.equal(last.canReportApplied,null);assert.equal(last.verification,'A conferir');
 reread(s,{status:'PAUSED'},now+5*60000);
 const after=companionCards(s,{project},3,now+5*60000).cards[0];assert.ok(after,'card stays visible');assert.equal(after.lastChoice.verification,'Conferida');
});
