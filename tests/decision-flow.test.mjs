import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingCampaignCandidates} from '../lib/decision-flow.mjs';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {reopenDecision} from '../lib/decision-reconsider.mjs';

const now=Date.parse('2026-11-02T20:00:00.000Z'),project='project-a',date=value=>new Date(value).toISOString();
function fixture(){
 const base={provider:'Meta',level:'campaign',budgetCurrency:'BRL',dailyBudget:100,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},revenue:600,revenueNet:550,adCosts:10,productCost:0,saleTax:0,frontOrders:2,orders:2,checkouts:5,impressions:1000,linkClicks:20,refundedRevenue:0};
 const rows=[
  {...base,id:'internal-a',adAccountId:'account-a',externalId:'campaign-a',accountName:'Conta A',name:'Campanha com nomenclatura repetida',spend:300},
  {...base,id:'internal-b',adAccountId:'account-b',externalId:'campaign-b',accountName:'Conta B',name:'Campanha com nomenclatura repetida',spend:200},
  {...base,id:'internal-c',adAccountId:'account-a',externalId:'campaign-c',accountName:'Conta A',name:'Outra campanha',spend:100},
 ];
 return {config:{[project]:{projectName:'Projeto A',targetRoas:2,dailyCap:1000}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Projeto A',period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T03:00:00.000Z':'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-1000),lastSyncAt:date(now-5000),rows:structuredClone(rows)})),jobs:[],paused:false};
}
const ids=rows=>rows.map(candidate=>candidate.row.externalId).sort();
function decide(state,objectId='campaign-a'){
 const card=buildDecisionCards(state,project,now).find(card=>card.row.externalId===objectId);
 return recordOwnerChoice(state,{project,cardId:card.id,signature:card.signature,choice:'keep',clientId:'choice-'+objectId},'authenticated-owner',now);
}

test('A registered decision leaves priority candidates while equal names in other accounts remain pending',()=>{
 const state=fixture();assert.deepEqual(ids(pendingCampaignCandidates(state,project,now)),['campaign-a','campaign-b','campaign-c']);
 const chosen=decide(state),saved=structuredClone(chosen),before=structuredClone(state);
 const pending=pendingCampaignCandidates(state,project,now);
 assert.deepEqual(ids(pending),['campaign-b','campaign-c']);
 assert.equal(pending.find(candidate=>candidate.row.externalId==='campaign-b').row.accountName,'Conta B');
 assert.deepEqual(state,before);assert.deepEqual(state.ownerChoices,[saved]);
});

test('Refreshing every source and changing metrics never places a resolved campaign back in priorities',()=>{
 const state=fixture(),chosen=decide(state),saved=structuredClone(chosen);
 for(const snapshot of state.snapshots){snapshot.fetchedAt=date(now+1000);snapshot.rows[0].spend+=500;snapshot.rows[0].dailyBudget=150;}
 assert.deepEqual(ids(pendingCampaignCandidates(state,project,now+2000)),['campaign-b','campaign-c']);
 assert.deepEqual(state.ownerChoices,[saved]);
});

test('Explicit reconsideration reopens only the original campaign and a new choice removes it again',()=>{
 const state=fixture(),first=decide(state),saved=structuredClone(first);
 reopenDecision(state,{project,choiceId:first.id,clientId:'reopen-a'},'authenticated-owner',now+1000);
 assert.deepEqual(ids(pendingCampaignCandidates(state,project,now+2000)),['campaign-a','campaign-b','campaign-c']);
 const card=buildDecisionCards(state,project,now+2000).find(card=>card.row.externalId==='campaign-a');
 recordOwnerChoice(state,{project,cardId:card.id,signature:card.signature,choice:'keep',clientId:'reconsidered-a'},'authenticated-owner',now+2000);
 assert.deepEqual(ids(pendingCampaignCandidates(state,project,now+3000)),['campaign-b','campaign-c']);
 assert.deepEqual(state.ownerChoices[0],saved);assert.equal(state.ownerChoices[1].reconsidersChoiceId,first.id);
});

test('The same account and campaign identifiers in another linked project are not removed by this project decision',()=>{
 const state=fixture();state.config['project-b']={projectName:'Projeto B'};
 state.snapshots.push(...structuredClone(state.snapshots).map(snapshot=>({...snapshot,projectId:'project-b',projectName:'Projeto B'})));
 decide(state);
 const pending=pendingCampaignCandidates(state,'all',now);
 assert.equal(pending.length,5);
 assert.equal(pending.filter(candidate=>candidate.row.projectId===project&&candidate.row.externalId==='campaign-a').length,0);
 assert.equal(pending.filter(candidate=>candidate.row.projectId==='project-b'&&candidate.row.externalId==='campaign-a').length,1);
});
