import test from 'node:test';
import assert from 'node:assert/strict';
import {officeDecisionView} from '../lib/office-decision-view.mjs';
import {buildDecisionCards,recordCardSuggestion,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';

const now=Date.parse('2026-11-03T16:00:00.000Z'),date=value=>new Date(value).toISOString();
function fixture(project='project-a',team=true,name='03/11 [CBO] [TESTE] Campanha'){
 const row={id:'internal-'+project,externalId:'same-meta-id',adAccountId:'same-account',level:'campaign',provider:'Meta',name,accountName:'Conta',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenueNet:200,adCosts:4,productCost:0,saleTax:0,frontOrders:2,orders:3,checkouts:5,impressions:1000,linkClicks:20};
 const job={id:'job-'+project,project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:project,targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},messages:[],paused:false,snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-03T03:00:00Z':'2026-10-27T03:00:00Z',to:period==='today'?'2026-11-04T03:00:00Z':'2026-11-03T03:00:00Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(row)]}))};
 const round=ensureCollaboration(state,job,now),ref={period:'today',level:'campaign',externalId:row.externalId,adAccountId:row.adAccountId,fetchedAt:date(now-2000)};
 if(team){
  let ops;
  for(const agentId of ['traffic','creative','budget','ops']){
   const claim=claimCollaboration(state,{roundId:round.id,agentId,executionRef:project+'-'+agentId,clientId:project+'-claim-'+agentId},now);
   if(agentId==='ops'){ops=claim;break;}
   postCollaboration(state,{roundId:round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:project+'-conclusion-'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Contexto conferido.',evidenceRefs:[ref]},now);
  }
  recordCardSuggestion(state,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:project+'-suggestion',payload:{objectId:row.externalId,adAccountId:row.adAccountId,action:'reduce',percent:20,reason:'Conter perda observada.',opinionRefs:round.stages.slice(0,3).map(stage=>stage.conclusionId)}},now);
 }
 return {state,row,project};
}

test('Office surfaces a real team suggestion with the unchanged sealed board card, without mutating work',()=>{
 const f=fixture(),before=structuredClone(f.state),view=officeDecisionView(f.state,f.project,[],now);
 assert.equal(view.suggestions,1);assert.equal(view.decisionsAvailable,1);assert.equal(view.rereads,0);assert.equal(view.hasAttention,true);
 const original=buildDecisionCards(f.state,f.project,now)[0];
 assert.equal(view.cards[0].id,original.id);assert.equal(view.cards[0].signature,original.signature);assert.deepEqual(view.cards[0].sourceCut,original.sourceCut);
 assert.deepEqual(f.state,before);assert.equal(f.state.ownerChoices,undefined);assert.equal(f.state.executions,undefined);
});

test('Fresh diagnostics and empty or unknown projects never manufacture a suggestion or an agent conversation',()=>{
 const f=fixture('project-a',false),before=structuredClone(f.state),view=officeDecisionView(f.state,f.project,[],now);
 assert.equal(view.cards.length,1);assert.equal(view.suggestions,0);assert.equal(view.rereads,0);assert.equal(view.hasAttention,false);
 for(const project of ['',null,'other'])assert.deepEqual(officeDecisionView(f.state,project,[],now).cards,[]);
 assert.deepEqual(f.state,before);assert.equal(f.state.collaborationMessages.length,0);
});

test('A registered owner decision disappears from the office summary as well as the board',()=>{
 const f=fixture(),card=officeDecisionView(f.state,f.project,[],now).cards[0];
 recordOwnerChoice(f.state,{project:f.project,cardId:card.id,signature:card.signature,choice:'keep',clientId:'owner-choice'},'authenticated-owner',now);
 const view=officeDecisionView(f.state,f.project,[],now);
 assert.equal(view.cards.length,0);assert.equal(view.suggestions,0);assert.equal(view.hasAttention,false);
 assert.equal(f.state.ownerChoices.length,1);assert.equal(f.state.proposals.length,0);
});

test('Expired analysis becomes a reread instead of a ready recommendation, even without live cache',()=>{
 const f=fixture(),view=officeDecisionView(f.state,f.project,[],now+61*60000);
 assert.equal(view.suggestions,0);assert.equal(view.decisionsAvailable,0);assert.equal(view.rereads,1);assert.equal(view.hasAttention,true);
 assert.equal(view.cards[0].suggestion.origin,'diagnostic');assert.equal(view.cards[0].actionable.reduce,false);
});

test('A new external budget makes the office and shared card await rereading without changing the sealed amount',()=>{
 const f=fixture(),cache={projectId:f.project,snapshot:{projectId:f.project,period:'today',level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-03T03:00:00Z',to:'2026-11-04T03:00:00Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-1000),rows:[{...f.row,dailyBudget:50}]}},before=structuredClone(f.state);
 const view=officeDecisionView(f.state,f.project,[cache],now);
 assert.equal(view.suggestions,0);assert.equal(view.rereads,1);assert.equal(view.cards[0].observedRow.dailyBudget,50);assert.equal(view.cards[0].row.dailyBudget,100);
 assert.deepEqual(f.state,before);
});

test('Pause and scope isolation never advertise a decision from another project or enable execution',()=>{
 const a=fixture('project-a'),b=fixture('project-b');
 const state={...a.state,config:{...a.state.config,...b.state.config},snapshots:[...a.state.snapshots,...b.state.snapshots],jobs:[...a.state.jobs,...b.state.jobs],agents:{...a.state.agents,...b.state.agents},collaborationRounds:[...a.state.collaborationRounds,...b.state.collaborationRounds],collaborationMessages:[...a.state.collaborationMessages,...b.state.collaborationMessages],cardSuggestions:[...a.state.cardSuggestions,...b.state.cardSuggestions]};
 const view=officeDecisionView(state,a.project,[],now);assert.equal(view.suggestions,1);assert.ok(view.cards.every(card=>card.project===a.project));
 state.paused=true;const paused=officeDecisionView(state,a.project,[],now);assert.equal(paused.decisionsAvailable,0);assert.equal(state.executions,undefined);
 const warm=fixture('warming',false,'03/11 [ENGAJAMENTO] Aquecimento');assert.equal(officeDecisionView(warm.state,warm.project,[],now).cards.length,0);
});
