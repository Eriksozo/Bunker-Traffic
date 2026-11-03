import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {decisionQueue} from '../lib/decision-reconsider.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';
import {reconcileCampaignObservations} from '../lib/campaign-observation.mjs';
import {campaignReassessment,invalidateIncidentContext} from '../lib/campaign-reassessment.mjs';
import {recordIncident} from '../lib/campaign-incidents.mjs';

const at=Date.parse('2026-11-02T20:00:00Z'),iso=n=>new Date(n).toISOString(),project='john';
const periods=['7d','3d','yesterday','today'];
function fixture(){
 const row={id:'internal-a',externalId:'same-id',adAccountId:'account-a',accountName:'Conta A',name:'Campanha validada',level:'campaign',provider:'Meta',budgetCurrency:'BRL',dailyBudget:100,lifetimeBudget:null,status:'PAUSED',effectiveStatus:'PAUSED',accountStatus:{active:true},spend:120,revenue:300,revenueNet:280,adCosts:5,productCost:0,saleTax:0,frontOrders:3,orders:4,checkouts:8,impressions:1200,linkClicks:30,refundedRevenue:0};
 const job={id:'old-job',project,status:'Concluída',startedAt:iso(at-60000),completedAt:iso(at-1000)};
 const from={'7d':'2026-10-26','3d':'2026-10-30',yesterday:'2026-11-01',today:'2026-11-02'};
 const state={config:{john:{projectName:'John',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{john:{jobId:job.id}},paused:false,snapshots:periods.map(period=>({projectId:project,projectName:'John',period,level:'campaign',source:'Malva MCP',complete:true,from:from[period]+'T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:iso(at-2000),lastSyncAt:iso(at-5000),rows:[structuredClone(row),{...structuredClone(row),id:'internal-b',adAccountId:'account-b',accountName:'Conta B'}]}))};
 ensureCollaboration(state,job,at);return state;
}
const card=(state,time=at,account='account-a')=>buildDecisionCards(state,project,time).find(c=>c.row.adAccountId===account);
function keep(state,clientId='first',time=at,account='account-a'){
 const c=card(state,time,account);return recordOwnerChoice(state,{project,cardId:c.id,signature:c.signature,choice:'keep',clientId},'owner',time);
}
function refreshed(state,{change=true,fetched=at+59000}={}){
 const snapshots=structuredClone(state.snapshots).map(s=>({...s,fetchedAt:iso(fetched),lastSyncAt:iso(fetched-1000),rows:s.rows.map(row=>({...row,...(change&&row.adAccountId==='account-a'?{status:'ACTIVE',effectiveStatus:'ACTIVE'}:{})}))}));
 reconcileCampaignObservations(state,snapshots,fetched+1);state.snapshots=snapshots;return snapshots;
}
function newRound(state,time=at+60000){
 const job={id:'job-'+time,project,status:'Concluída',startedAt:iso(time-2000),completedAt:iso(time)};state.jobs.push(job);state.agents.john={jobId:job.id};return ensureCollaboration(state,job,time+1);
}
function opinions(state,round,{count=3,time=at+60002}={}){
 const source=state.snapshots.find(s=>s.period==='today');
 for(const agentId of ['traffic','creative','budget'].slice(0,count)){
  const c=claimCollaboration(state,{roundId:round.id,agentId,executionRef:round.id+':'+agentId,clientId:round.id+':claim:'+agentId},time);
  postCollaboration(state,{roundId:round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:round.id+':opinion:'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Nova leitura completa da campanha, incluindo o contexto informado.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:'account-a',externalId:'same-id',fetchedAt:source.fetchedAt}]},time+1);
 }
}

test('A prior keep leaves the queue; a verified native-state difference reopens analysis only for the exact account',()=>{
 const s=fixture(),first=keep(s),saved=structuredClone(first);keep(s,'other-account',at,'account-b');
 assert.equal(decisionQueue(s,project,at).length,0);
 refreshed(s);const current=card(s,at+60000);
 assert.equal(current.row.status,'ACTIVE');assert.equal(s.campaignChanges.length,1);assert.equal(s.campaignChanges[0].executionByBunker,false);
 assert.equal(current.monitor.kind,'change');assert.equal(current.monitor.afterChoice,true);assert.equal(current.monitor.ready,false);assert.equal(current.actionable.keep,false);
 assert.deepEqual(decisionQueue(s,project,at+60000).map(c=>c.row.adAccountId),['account-a']);
 assert.throws(()=>keep(s,'premature',at+60000),/fonte/);assert.deepEqual(s.ownerChoices[0],saved);assert.equal(s.executions,undefined);
});

test('New campaign data needs the new round and three independent scoped opinions before another choice',()=>{
 const s=fixture(),first=keep(s),saved=structuredClone(first);refreshed(s);const round=newRound(s);
 assert.equal(card(s,at+60002).monitor.ready,false);assert.throws(()=>keep(s,'before-opinions',at+60002),/fonte/);
 opinions(s,round,{count:2});assert.equal(card(s,at+60004).monitor.ready,false);
 const claim=claimCollaboration(s,{roundId:round.id,agentId:'budget',executionRef:'budget-last',clientId:'budget-last'},at+60005);
 postCollaboration(s,{roundId:round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'budget-last-opinion',toAgent:'ops',kind:'conclusion',text:'Revisei o orçamento no novo cenário.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:'account-a',externalId:'same-id',fetchedAt:iso(at+59000)}]},at+60006);
 const c=card(s,at+60007);assert.equal(c.teamOpinions.length,3);assert.equal(c.monitor.ready,true);assert.equal(c.actionable.keep,true);
 const args={project,cardId:c.id,signature:c.signature,choice:'keep',clientId:'after-review'};
 const second=recordOwnerChoice(s,args,'owner',at+60007);
 assert.equal(second.reconsidersChoiceId,first.id);assert.equal(second.reviewMarkerId,s.campaignChanges[0].id);assert.deepEqual(s.ownerChoices[0],saved);assert.equal(s.ownerChoices.length,2);
 assert.equal(recordOwnerChoice(s,args,'owner',at+60008).id,second.id);assert.equal(recordOwnerChoice(s,{...args,clientId:'double-click'},'owner',at+60008).id,second.id);assert.equal(s.ownerChoices.length,2);
 assert.equal(decisionQueue(s,project,at+60008).filter(c=>c.row.adAccountId==='account-a').length,0);
});

test('Metrics-only refreshes without a native-state ledger do not reopen a settled decision',()=>{
 const s=fixture();keep(s);const next=structuredClone(s.snapshots).map(snapshot=>({...snapshot,fetchedAt:iso(at+59000),rows:snapshot.rows.map(row=>({...row,spend:row.spend+50,frontOrders:row.frontOrders+1}))}));
 assert.equal(reconcileCampaignObservations(s,next,at+60000).inserted,0);s.snapshots=next;newRound(s);assert.equal(card(s,at+60002).monitor,null);assert.equal(decisionQueue(s,project,at+60002).some(c=>c.row.adAccountId==='account-a'),false);
});

test('Readiness requires four complete current source cuts; a declaration never manufactures results or delivery',()=>{
 const s=fixture(),first=keep(s),rows=structuredClone(s.snapshots),incident=recordIncident(s,{op:'incidentReport',project,kind:'checkout',status:'Em retomada',note:'O checkout voltou e reativei parte das campanhas.',scope:{accountIds:[],objectIds:[]},clientId:'incident'},'owner',at+10000);
 invalidateIncidentContext(s,incident);assert.deepEqual(s.snapshots,rows);assert.deepEqual(s.ownerChoices,[first]);assert.equal(s.executions,undefined);
 const before=card(s,at+11000);assert.equal(before.row.status,'PAUSED');assert.equal(before.windows.today.spend,120);assert.equal(before.monitor.kind,'incident');assert.equal(before.actionable.keep,false);assert.equal(decisionQueue(s,project,at+11000).length,2);
 refreshed(s,{change:false});const round=newRound(s);opinions(s,round);const current=card(s,at+60004);assert.equal(current.monitor.ready,true);assert.equal(current.monitor.incident.status,'Em retomada');
 const complete=current.sourceCut,base={round,teamReady:true,lastChoice:first};
 assert.equal(campaignReassessment(s,project,current.row,{...base,sourceCut:complete.filter(cut=>cut.period!=='3d')}).ready,false);
 assert.equal(campaignReassessment(s,project,current.row,{...base,sourceCut:complete.map(cut=>cut.period==='3d'?{...cut,complete:false}:cut)}).ready,false);
 assert.equal(campaignReassessment(s,project,current.row,{...base,sourceCut:complete.map(cut=>cut.period==='3d'?{...cut,fetchedAt:iso(at+9000)}:cut)}).ready,false);
 assert.equal(current.row.status,'PAUSED');assert.equal(current.windows.today.spend,120);
});

test('An account-scoped incident neither reopens nor labels another account with the same campaign ID',()=>{
 const s=fixture();keep(s);keep(s,'other',at,'account-b');const incident=recordIncident(s,{op:'incidentReport',project,kind:'checkout',status:'Em retomada',note:'Retomada somente da conta A.',scope:{accountIds:['account-a'],objectIds:[]},clientId:'scoped-incident'},'owner',at+10000);
 invalidateIncidentContext(s,incident);assert.equal(card(s,at+11000).monitor.kind,'incident');assert.equal(card(s,at+11000,'account-b').monitor,null);assert.deepEqual(decisionQueue(s,project,at+11000).map(c=>c.row.adAccountId),['account-a']);
});

test('Incident invalidation preserves dispatched and confirmed execution journals, and newer proposals',()=>{
 const s=fixture(),incident={id:'context',project,reportedAt:iso(at+10000),scope:{accountIds:[],objectIds:[]}};
 s.proposals=[
  {id:'old-unsent',project,status:'Aprovada',createdAt:iso(at),payload:{level:'campaign',adAccountId:'account-a',objectId:'same-id'}},
  {id:'sent',project,status:'Aprovada',createdAt:iso(at),execution:{status:'Enviada',submittedAt:iso(at+1000)}},
  {id:'confirmed',project,status:'Aprovada',createdAt:iso(at),execution:{status:'Confirmada',submittedAt:iso(at+1000),confirmedAt:iso(at+2000)}},
  {id:'new-unsent',project,status:'Aguardando aprovação',createdAt:iso(at+20000)},
  {id:'other-project',project:'nico',status:'Aprovada',createdAt:iso(at)},
 ];
 s.executions=[{id:'sent-journal',project,proposalId:'sent',status:'Enviada',submittedAt:iso(at+1000),events:[{type:'dispatch-reserved'}]},{id:'confirmed-journal',project,proposalId:'confirmed',status:'Confirmada',submittedAt:iso(at+1000),confirmedAt:iso(at+2000),events:[{type:'confirmed'}]}];
 const journal=structuredClone(s.executions),sent=structuredClone(s.proposals.slice(1));invalidateIncidentContext(s,incident);
 assert.deepEqual(s.executions,journal);assert.equal(s.proposals[0].status,'Fonte substituída');assert.deepEqual(s.proposals.slice(1),sent);
});
