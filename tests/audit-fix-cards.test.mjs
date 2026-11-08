import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice,recordCardSuggestion} from '../lib/decision-cards.mjs';
import {decisionQueue} from '../lib/decision-reconsider.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from '../lib/collaboration.mjs';
import {reconcileCampaignObservations} from '../lib/campaign-observation.mjs';
import {ownerAppliedVerification} from '../lib/owner-applied.mjs';
import {decisionSuggestion} from '../lib/decision-kanban.mjs';

const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='p1';
const from={'7d':'2026-10-26','3d':'2026-10-30',yesterday:'2026-11-01',today:'2026-11-02'};
function fixture(extra={}){
 const base={id:'i1',externalId:'meta-campaign',adAccountId:'account',provider:'Meta',level:'campaign',name:'01/11 [CBO] Example',accountName:'A',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:300,revenueNet:280,adCosts:4,productCost:0,saleTax:0,frontOrders:3,orders:4,checkouts:10,impressions:1000,linkClicks:20,refundedRevenue:0,...extra};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},paused:false,snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:from[period]+'T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]}))};
 const round=ensureCollaboration(state,job,now);return {state,round,base};
}
// Production path: apply op:'import' reconciles observations before replacing the snapshots.
function reread(state,at,patch){
 const next=state.snapshots.map(x=>({...structuredClone(x),fetchedAt:date(at),lastSyncAt:date(at-1000),rows:x.rows.map(r=>({...r,...patch}))}));
 reconcileCampaignObservations(state,next,at+1);state.snapshots=next;
}
const card=(s,t)=>buildDecisionCards(s,project,t)[0];

test('A confirmed "Já fiz" pause stays out of the queue after the reconciled reading',()=>{
 const {state:s}=fixture(),c=card(s,now);
 const choice=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'a',applied:true},'mac-touchid:x',now);
 assert.equal(decisionQueue(s,project,now).length,0);
 const at=now+5*60000;reread(s,at,{status:'PAUSED',effectiveStatus:'PAUSED'});
 assert.equal(s.campaignChanges.length,1);
 assert.equal(ownerAppliedVerification(s,choice).status,'Conferida');
 const after=card(s,at+60000);
 assert.equal(after.monitor.kind,'change');assert.equal(after.monitor.afterChoice,false);assert.equal(after.monitor.requiresReview,false);
 assert.ok(!after.blockedReasons.includes('O cenário mudou: aguarde a releitura e novos pareceres.'));
 assert.equal(decisionQueue(s,project,at+60000).length,0);
 // A later, unexplained change (someone reactivated it) is a new scenario and comes back.
 const later=at+10*60000;reread(s,later,{status:'ACTIVE',effectiveStatus:'ACTIVE'});
 const back=decisionQueue(s,project,later+60000);
 assert.equal(back.length,1);assert.equal(back[0].monitor.afterChoice,true);assert.equal(back[0].monitor.title,'Status ou orçamento mudou');
});

test('A confirmed "Já fiz" budget cut stays out; a different budget is Divergente and returns',()=>{
 const {state:s}=fixture(),c=card(s,now);
 const choice=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'reduce',percent:20,clientId:'r',applied:true},'mac-touchid:x',now);
 assert.equal(choice.after.dailyBudget,80);
 const at=now+5*60000;reread(s,at,{dailyBudget:80});
 assert.equal(ownerAppliedVerification(s,choice).status,'Conferida');
 assert.equal(card(s,at+60000).monitor.afterChoice,false);assert.equal(decisionQueue(s,project,at+60000).length,0);
 const {state:d}=fixture(),dc=card(d,now);
 const dChoice=recordOwnerChoice(d,{project,cardId:dc.id,signature:dc.signature,choice:'reduce',percent:20,clientId:'r',applied:true},'mac-touchid:x',now);
 reread(d,at,{dailyBudget:60});
 assert.equal(ownerAppliedVerification(d,dChoice).status,'Divergente');
 const q=decisionQueue(d,project,at+60000);assert.equal(q.length,1);assert.equal(q[0].monitor.afterChoice,true);
});

test('A matching change with extra unexplained fields still reopens analysis',()=>{
 const {state:s}=fixture(),c=card(s,now);
 recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'a',applied:true},'mac-touchid:x',now);
 const at=now+5*60000;reread(s,at,{status:'PAUSED',effectiveStatus:'PAUSED',dailyBudget:150});
 const q=decisionQueue(s,project,at+60000);assert.equal(q.length,1);assert.equal(q[0].monitor.afterChoice,true);
});

test('A Bunker execution confirmed in the journal is not re-queued; an unconfirmed intent still is',()=>{
 for(const confirmed of [true,false]){
  const {state:s}=fixture(),c=card(s,now);
  const choice=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'i'},'owner',now);
  assert.equal(choice.status,'Pendente de revisão');
  if(confirmed){choice.proposalId='prop-confirmed';s.executions=[{id:'e1',proposalId:'prop-confirmed',project,status:'Confirmada',confirmedAt:date(now+60000)}];}
  const at=now+5*60000;reread(s,at,{status:'PAUSED',effectiveStatus:'PAUSED'});
  const after=card(s,at+60000);
  assert.equal(after.monitor.afterChoice,!confirmed);assert.equal(decisionQueue(s,project,at+60000).length,confirmed?0:1);
 }
});

function teamRound(){
 const f=fixture(),{state:s,round,base}=f,ref={period:'today',level:'campaign',adAccountId:base.adAccountId,externalId:base.externalId,fetchedAt:date(now-2000)};let ops;
 for(const agentId of ['traffic','creative','budget','ops']){const c=claimCollaboration(s,{roundId:round.id,agentId,executionRef:'real-'+agentId,clientId:'claim-'+agentId},now);if(agentId==='ops'){ops=c;break;}postCollaboration(s,{roundId:round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'opinion-'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Observed context for '+agentId,evidenceRefs:[ref]},now);}
 const opinionRefs=round.stages.slice(0,3).map(x=>x.conclusionId);
 return {...f,ref,ops,opinionRefs};
}
function suggestAndPropose({state:s,round,base,ref,ops,opinionRefs}){
 recordCardSuggestion(s,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'cloud-suggestion',payload:{objectId:base.externalId,adAccountId:base.adAccountId,action:'pause',percent:null,reason:'cut',opinionRefs}},now);
 const payload={title:'Pause',reason:'cut',action:'status',level:'campaign',provider:'Meta',adAccountId:base.adAccountId,objectId:base.externalId,currency:'USD',before:{status:'ACTIVE'},after:{status:'PAUSED'},evidenceRefs:[ref],opinionRefs};
 return submitProposal(s,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'cloud-proposal',payload,expiresAt:date(now+300000)},now);
}
function peerReview(s,round,p,decision,comment){
 const claim=claimCollaboration(s,{roundId:round.id,agentId:'budget',proposalId:p.id,executionRef:'review-budget',clientId:'peer-budget'},now);
 reviewProposal(s,{id:p.id,version:p.version,signature:p.signature,decision,comment,clientId:'review-budget',claimId:claim.claimId,executionRef:claim.executionRef},{kind:'agent',agentId:'budget'},now);
}

test('A pause the budget peer rejected is no longer shown as the team suggestion',()=>{
 const f=teamRound(),s=f.state,p=suggestAndPropose(f);
 assert.equal(card(s,now).suggestion.origin,'proposal');
 peerReview(s,f.round,p,'reject','ROI 3.0, do not cut');
 assert.equal(s.proposals.find(x=>x.id===p.id).status,'Recusada');
 const c=card(s,now);
 assert.equal(c.proposal,null);assert.equal(c.suggestion.action,'keep');assert.equal(c.suggestion.origin,'diagnostic');
 assert.deepEqual(c.suggestion.refusedProposal,{id:p.id,version:p.version,status:'Recusada'});
 assert.match(c.suggestion.reason,/recusou a proposta de pausa/);assert.match(c.suggestion.reason,/ROI 3\.0, do not cut/);
 assert.equal(decisionSuggestion(c),null);
 // Availability still reflects the live row; the owner keeps every manual option.
 assert.equal(c.actionable.pause,true);
 assert.equal(card(s,now).signature,c.signature);
});

test('A peer revision request also supersedes the recorded suggestion',()=>{
 const f=teamRound(),s=f.state,p=suggestAndPropose(f);
 peerReview(s,f.round,p,'revise','Check yesterday first');
 const c=card(s,now);
 assert.equal(c.suggestion.origin,'diagnostic');assert.equal(c.suggestion.refusedProposal.status,'Revisão solicitada');assert.match(c.suggestion.reason,/pediu revisão da proposta de pausa/);
});

test('A suggestion without any closed proposal, or for another action, stays the team suggestion',()=>{
 const f=teamRound(),s=f.state,{round,base,ops,opinionRefs}=f;
 recordCardSuggestion(s,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'only-suggestion',payload:{objectId:base.externalId,adAccountId:base.adAccountId,action:'pause',percent:null,reason:'cut',opinionRefs}},now);
 assert.deepEqual(card(s,now).suggestion,{action:'pause',percent:null,reason:'cut',origin:'team'});
 const g=teamRound(),t=g.state,p=suggestAndPropose(g);peerReview(t,g.round,p,'reject','ROI 3.0, do not cut');
 recordCardSuggestion(t,{roundId:g.round.id,claimId:g.ops.claimId,executionRef:g.ops.executionRef,clientId:'reduce-after',payload:{objectId:g.base.externalId,adAccountId:g.base.adAccountId,action:'reduce',percent:20,reason:'trim instead',opinionRefs:g.opinionRefs}},now+1);
 assert.deepEqual(card(t,now+1).suggestion,{action:'reduce',percent:20,reason:'trim instead',origin:'team'});
});
