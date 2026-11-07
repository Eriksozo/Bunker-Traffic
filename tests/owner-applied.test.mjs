import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {decisionQueue} from '../lib/decision-reconsider.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
import {activityLog} from '../lib/campaign-activity.mjs';
import {ownerAppliedVerification,requestLiveRefresh,pendingLiveRefresh,ownerAppliedStatus} from '../lib/owner-applied.mjs';
import {isManualDecision} from '../lib/decision-intent.mjs';

// Synthetic fixture (same shape as tests/decision-cards.test.mjs).
const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
function fixture(){
 const base={id:'22222222-2222-4222-8222-222222222222',externalId:'meta-campaign',adAccountId:'account',provider:'Meta',name:'01/11 [CBO] [TESTE] Example',accountName:'USD account',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:2,impressions:1000,linkClicks:20,refundedRevenue:0};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T03:00:00.000Z':'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]})),paused:false};
 ensureCollaboration(state,job,now);return state;
}
const card=s=>buildDecisionCards(s,project,now)[0];
const report=(s,extra={})=>{const c=card(s);return recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'applied-1',applied:true,...extra},'mac-touchid:test',now);};
/** A later complete Malva reading of today with the given row changes. */
const reread=(s,change,at=now+5*60000)=>{const t=s.snapshots.find(x=>x.period==='today');s.snapshots=s.snapshots.filter(x=>x!==t).concat({...t,fetchedAt:date(at),lastSyncAt:date(at-1000),rows:t.rows.map(r=>({...r,...change}))});};

test('"Já fiz" records what the owner reported, never approves, and leaves the queue',()=>{
 const s=fixture();assert.equal(decisionQueue(s,project,now).length,1);
 const r=report(s);
 assert.equal(r.status,ownerAppliedStatus);assert.equal(r.appliedByOwner,true);assert.equal(r.appliedAt,date(now));assert.equal(r.intentOnly,false);
 assert.equal(r.proposalId??null,null,'no proposal is approved');assert.equal(s.proposals?.some(p=>p.status==='Aprovada')??false,false);assert.equal(isManualDecision({op:'cardDecision',applied:true}),true,'stays outside the drift veto');
 assert.equal(decisionQueue(s,project,now).length,0);
 const ex=fixture();assert.throws(()=>{const c=card(ex);recordOwnerChoice(ex,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'x-applied',applied:true,approveExact:true},'o',now);},/não aprova/);
 const keep=fixture(),c=card(keep);assert.equal(recordOwnerChoice(keep,{project,cardId:c.id,signature:c.signature,choice:'keep',clientId:'keep-1',applied:true},'o',now).status,'Mantido');
});
test('The next complete Malva reading reconciles it; a contradiction brings the campaign back',()=>{
 const s=fixture(),r=report(s);
 assert.equal(ownerAppliedVerification(s,r).status,'A conferir');
 reread(s,{status:'PAUSED',effectiveStatus:'PAUSED'});
 assert.equal(ownerAppliedVerification(s,r).status,'Conferida');assert.equal(decisionQueue(s,project,now+6*60000).length,0);
 const d=fixture(),rd=report(d);reread(d,{});
 assert.equal(ownerAppliedVerification(d,rd).status,'Divergente');assert.equal(decisionQueue(d,project,now+6*60000).length,1,'divergent report returns to the queue');
 // A reading taken before the report (+60 s grace) never confirms it.
 const e=fixture(),re=report(e);reread(e,{status:'PAUSED',effectiveStatus:'PAUSED'},now+30000);assert.equal(ownerAppliedVerification(e,re).status,'A conferir');
});
test('Budget reports need the percent and are checked against the reported value with a 2% tolerance',()=>{
 const s=fixture(),c=card(s);
 const r=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:30,clientId:'inc-1',applied:true},'o',now);
 assert.equal(r.after.dailyBudget,130);
 reread(s,{dailyBudget:131});assert.equal(ownerAppliedVerification(s,r).status,'Conferida');
 reread(s,{dailyBudget:150},now+10*60000);assert.equal(ownerAppliedVerification(s,r).status,'Divergente');
});
test('An applied report may follow an intent of the same action, not a different one',()=>{
 const s=fixture(),c=card(s);
 recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'intent-1'},'o',now);
 const c2=card(s);assert.equal(recordOwnerChoice(s,{project,cardId:c2.id,signature:c2.signature,choice:'pause',clientId:'applied-2',applied:true},'o',now).status,ownerAppliedStatus);
 const t=fixture(),d=card(t);recordOwnerChoice(t,{project,cardId:d.id,signature:d.signature,choice:'reduce',percent:20,clientId:'intent-2'},'o',now);
 const d2=card(t);assert.throws(()=>recordOwnerChoice(t,{project,cardId:d2.id,signature:d2.signature,choice:'pause',clientId:'applied-3',applied:true},'o',now),/já tem uma decisão/);
});
test('The report shows in the activity log and asks the executor to re-read the project first',()=>{
 const s=fixture();report(s);
 const e=activityLog(s,{now:now+1000}).find(x=>x.origin==='owner');
 assert.equal(e.actor,'Você · informado no notch');assert.equal(e.action,'pause');assert.equal(e.after,'PAUSED');
 requestLiveRefresh(s,project,now);requestLiveRefresh(s,project,now+1000);
 assert.equal(s.liveRefreshRequests.length,1);
 assert.deepEqual(pendingLiveRefresh(s,{}),[project]);
 assert.deepEqual(pendingLiveRefresh(s,{[project]:date(now+2000)}),[],'served once a newer live read succeeded');
});
