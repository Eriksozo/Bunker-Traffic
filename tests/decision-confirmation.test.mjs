import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedOwnerChoice,isValidCentralResponse} from '../lib/decision-confirmation.mjs';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from '../lib/collaboration.mjs';

const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
function fixture({choice='keep',percent,reason='',team=false}={}){
 const row={id:'22222222-2222-4222-8222-222222222222',externalId:'campaign',adAccountId:'account',provider:'Meta',name:'Campanha de mesmo nome',accountName:'Conta',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:280,revenueNet:250,adCosts:4,productCost:0,saleTax:0,frontOrders:3,orders:4,checkouts:10,impressions:1000,linkClicks:20,refundedRevenue:0};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T03:00:00.000Z':'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(row)]})),paused:false};
 let proposal;
 if(team){
  const round=ensureCollaboration(state,job,now),ref={period:'today',level:'campaign',adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:date(now-2000)};let ops;
  for(const agentId of ['traffic','creative','budget','ops']){
   const c=claimCollaboration(state,{roundId:round.id,agentId,executionRef:'real-'+agentId,clientId:'claim-'+agentId},now);
   if(agentId==='ops'){ops=c;break;}
   postCollaboration(state,{roundId:round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'opinion-'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Observed context '+agentId,evidenceRefs:[ref]},now);
  }
  proposal=submitProposal(state,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'proposal',payload:{title:'Exact budget',reason:'Observed repeat acquisition',action:'budget',level:'campaign',provider:'Meta',adAccountId:row.adAccountId,objectId:row.externalId,currency:'USD',budgetOwner:'CBO',before:{dailyBudget:100},after:{dailyBudget:150},evidenceRefs:[ref],opinionRefs:round.stages.slice(0,3).map(s=>s.conclusionId)},expiresAt:date(now+300000)},now);
  for(const agentId of ['traffic','budget']){
   const c=claimCollaboration(state,{roundId:round.id,agentId,proposalId:proposal.id,executionRef:'review-'+agentId,clientId:'peer-'+agentId},now);
   reviewProposal(state,{id:proposal.id,version:proposal.version,signature:proposal.signature,decision:'approve',comment:'Independent exact review',clientId:'review-'+agentId,claimId:c.claimId,executionRef:c.executionRef},{kind:'agent',agentId},now);
  }
 }
 const card=buildDecisionCards(state,project,now)[0];
 const input={op:'cardDecision',project,cardId:card.id,signature:card.signature,choice,percent,reason,clientId:'original-request',approveExact:team,...(proposal?{proposalId:proposal.id,proposalVersion:proposal.version,proposalSignature:proposal.signature}:{})};
 const saved=recordOwnerChoice(state,input,'authenticated-owner',now);
 return {state,input,saved,data:{state,revision:9,updatedAt:date(now)}};
}

test('A real saved keep choice is recognized without changing state or creating execution',()=>{
 const f=fixture(),before=structuredClone(f.data);
 assert.equal(confirmedOwnerChoice(f.data,f.input),f.saved);
 assert.deepEqual(f.data,before);assert.equal(f.state.executions,undefined);assert.equal(f.state.ownerChoices.length,1);
});
test('Lost responses and fresh-client-id retries recognize the original immutable record',()=>{
 const f=fixture({choice:'increase',percent:50,reason:'  repetiu front  '}),retry={...f.input,reason:'repetiu front',clientId:'another-mounted-client'};
 assert.equal(recordOwnerChoice(f.state,retry,'authenticated-owner',now+1000).id,f.saved.id);
 assert.equal(confirmedOwnerChoice(f.data,retry),f.saved);assert.equal(f.saved.clientId,'original-request');assert.equal(f.state.ownerChoices.length,1);
});
test('Keep and pause normalize omitted/null percent; reason defaults match the domain exactly',()=>{
 for(const choice of ['keep','pause']){
  const f=fixture({choice});assert.equal(f.saved.reason,'Sem motivo adicional.');assert.equal(confirmedOwnerChoice(f.data,{...f.input,percent:null}),f.saved);
  assert.equal(confirmedOwnerChoice(f.data,{...f.input,percent:20}),null);
 }
 const f=fixture({reason:undefined}); // fixture defaults to an empty UI string.
 const noReason={...f.input,clientId:'undefined-reason'};delete noReason.reason;
 assert.equal(confirmedOwnerChoice(f.data,noReason),null);
 const other=fixture();const noReasonState=structuredClone(other.state);delete noReasonState.ownerChoices;
 const card=buildDecisionCards(noReasonState,project,now)[0],input={...noReason,signature:card.signature};
 const saved=recordOwnerChoice(noReasonState,input,'authenticated-owner',now);
 assert.equal(saved.reason,'');assert.equal(confirmedOwnerChoice({state:noReasonState,revision:1},input),saved);
 assert.equal(confirmedOwnerChoice(f.data,{...f.input,reason:'   '}),null);
});
test('HTTP-shaped success, missing state and invalid revisions do not prove persistence',()=>{
 const f=fixture();
 for(const data of [{ok:true},{...f.data,revision:undefined},{...f.data,revision:-1},{...f.data,revision:1.5},{...f.data,revision:Infinity},{...f.data,state:{...f.state,ownerChoices:undefined}},{...f.data,state:{...f.state,ownerChoices:[]}}])assert.equal(confirmedOwnerChoice(data,f.input),null);
 assert.equal(isValidCentralResponse(f.data),true);assert.equal(isValidCentralResponse({state:{config:{},snapshots:[]},revision:0}),true);
 assert.equal(isValidCentralResponse({...f.data,state:null}),false);assert.equal(isValidCentralResponse({...f.data,state:{...f.state,config:[]}}),false);
});
test('Same-name foreign cards, altered signatures, actions, percentages and reasons cannot acknowledge a different choice',()=>{
 const f=fixture({choice:'increase',percent:50,reason:'novo front'});
 for(const patch of [{project:'another-project'},{cardId:'another-card'},{signature:'different-context'},{choice:'reduce'},{percent:100},{percent:NaN},{reason:'outro motivo'},{op:'decision'},{clientId:''}])assert.equal(confirmedOwnerChoice(f.data,{...f.input,...patch}),null);
 for(const patch of [{adAccountId:'other-account'},{objectId:'other-campaign'},{action:'pause'},{choice:'pause'},{cardSignature:'other-seal'}]){
  const state={...f.state,ownerChoices:[{...f.saved,...patch}]};assert.equal(confirmedOwnerChoice({...f.data,state},f.input),null);
 }
 const duplicate={...f.data,state:{...f.state,ownerChoices:[f.saved,{...f.saved,id:'duplicate'}]}};assert.equal(confirmedOwnerChoice(duplicate,f.input),null);
});
test('An approved real proposal needs the exact authorized version and seal; an intention is not approval',()=>{
 const f=fixture({choice:'increase',percent:50,team:true});assert.equal(f.saved.status,'Autorizado');
 assert.equal(confirmedOwnerChoice(f.data,f.input),f.saved);assert.equal(f.state.executions,undefined);
 for(const patch of [{approveExact:false},{proposalId:'other'},{proposalVersion:f.input.proposalVersion+1},{proposalSignature:'other-seal'}])assert.equal(confirmedOwnerChoice(f.data,{...f.input,...patch}),null);
 for(const patch of [{status:'Pendente de revisão'},{proposalId:'other'},{proposalVersion:99},{proposalSignature:'other-seal'}])assert.equal(confirmedOwnerChoice({...f.data,state:{...f.state,ownerChoices:[{...f.saved,...patch}]}},f.input),null);
 const pending=fixture({choice:'increase',percent:50});assert.equal(confirmedOwnerChoice(pending.data,{...pending.input,approveExact:true,...{proposalId:f.input.proposalId,proposalVersion:f.input.proposalVersion,proposalSignature:f.input.proposalSignature}}),null);
});
