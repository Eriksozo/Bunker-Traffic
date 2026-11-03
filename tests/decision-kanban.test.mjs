import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionColumns,decisionKanban} from '../lib/decision-kanban.mjs';
import {recordOwnerChoice} from '../lib/decision-cards.mjs';
import {decisionQueue,reopenDecision} from '../lib/decision-reconsider.mjs';

const groupedIds=columns=>Object.fromEntries(columns.map(column=>[column.id,column.cards.map(card=>card.id)]));
const pendingIds=columns=>columns.flatMap(column=>column.cards.map(card=>card.id));

test('A campaign occupies exactly one review stage, with approval taking priority over a team suggestion',()=>{
 const cards=[
  {id:'triage',teamReady:false,suggestion:{origin:'diagnostic',action:'keep'}},
  {id:'team',teamReady:true,suggestion:{origin:'team',action:'increase'}},
  {id:'reviewed',teamReady:true,suggestion:{origin:'team',action:'pause'}},
 ];
 const before=structuredClone(cards),columns=decisionKanban(cards,card=>card.id==='reviewed');
 assert.deepEqual(groupedIds(columns),{analysis:['triage'],suggestions:['team'],approval:['reviewed']});
 assert.equal(new Set(pendingIds(columns)).size,cards.length);
 assert.equal(pendingIds(columns).length,cards.length);
 assert.deepEqual(cards,before);
 assert.equal(columns[2].cards[0],cards[2],'The board retains the original sealed card instead of manufacturing another card.');
});

test('Diagnostic keep remains analysis even when three agent opinions exist',()=>{
 const cards=[{id:'diagnostic',teamReady:true,suggestion:{origin:'diagnostic',action:'keep'}},{id:'genuine-keep',teamReady:true,suggestion:{origin:'team',action:'keep'}}];
 assert.deepEqual(groupedIds(decisionKanban(cards)),{analysis:['diagnostic'],suggestions:['genuine-keep'],approval:[]});
});

test('A proposal label or status cannot grant approval readiness without the caller validating its exact scope',()=>{
 const cards=[
  {id:'in-review',teamReady:true,suggestion:{origin:'proposal',action:'increase'},proposal:{status:'Em revisão'}},
  {id:'apparently-ready',teamReady:true,suggestion:{origin:'proposal',action:'increase'},proposal:{status:'Aguardando aprovação'}},
  {id:'already-approved',teamReady:true,suggestion:{origin:'proposal',action:'increase'},proposal:{status:'Aprovada'}},
 ];
 assert.deepEqual(groupedIds(decisionKanban(cards)),{analysis:cards.map(card=>card.id),suggestions:[],approval:[]});
 assert.deepEqual(groupedIds(decisionKanban(cards,card=>card.id==='apparently-ready')),{analysis:['in-review','already-approved'],suggestions:[],approval:['apparently-ready']});
 assert.deepEqual(cards.map(card=>card.proposal.status),['Em revisão','Aguardando aprovação','Aprovada']);
});

test('Every stage receives its complete filtered population before a display limit is applied',()=>{
 const cards=[...Array.from({length:17},(_,i)=>({id:'triage-'+i,suggestion:{origin:'diagnostic',action:'keep'}})),{id:'late-suggestion',teamReady:true,suggestion:{origin:'team',action:'reduce'}},{id:'late-approval',suggestion:{origin:'proposal',action:'pause'}}];
 const columns=decisionKanban(cards,card=>card.id==='late-approval'),limit=6;
 assert.deepEqual(columns.map(column=>column.cards.length),[17,1,1]);
 assert.deepEqual(columns.map(column=>column.cards.slice(0,limit).map(card=>card.id)),[cards.slice(0,6).map(card=>card.id),['late-suggestion'],['late-approval']]);
 assert.equal(columns[0].cards.at(-1).id,'triage-16');
});

test('Empty boards expose the same stages without retaining cards from another render',()=>{
 const occupied=decisionKanban([{id:'prior',teamReady:true,suggestion:{origin:'team'}}]);
 const empty=decisionKanban([]);
 assert.deepEqual(empty.map(({id,title,description})=>({id,title,description})),decisionColumns);
 assert.deepEqual(empty.map(column=>column.cards),[[],[],[]]);
 assert.deepEqual(pendingIds(occupied),['prior']);
});

const now=Date.parse('2026-11-02T20:00:00.000Z'),project='project-a',date=value=>new Date(value).toISOString();
function fixture(){
 const base={provider:'Meta',level:'campaign',budgetCurrency:'BRL',dailyBudget:100,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},revenue:600,revenueNet:550,adCosts:10,productCost:0,saleTax:0,frontOrders:2,orders:2,checkouts:5,impressions:1000,linkClicks:20,refundedRevenue:0};
 const rows=[
  {...base,id:'internal-a',adAccountId:'account-a',externalId:'same-campaign-id',accountName:'Conta A',name:'Mesma nomenclatura',spend:300},
  {...base,id:'internal-b',adAccountId:'account-b',externalId:'same-campaign-id',accountName:'Conta B',name:'Mesma nomenclatura',spend:200},
 ];
 return {config:{[project]:{projectName:'Projeto A',targetRoas:2,dailyCap:1000}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Projeto A',period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T03:00:00.000Z':'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-1000),lastSyncAt:date(now-5000),rows:structuredClone(rows)})),jobs:[],paused:false};
}
const board=(state,at=now)=>decisionKanban(decisionQueue(state,project,at));
const boardAccounts=columns=>columns.flatMap(column=>column.cards.map(card=>card.row.adAccountId)).sort();
function keep(state,account,at,clientId){
 const card=decisionQueue(state,project,at).find(card=>card.row.adAccountId===account);
 return recordOwnerChoice(state,{project,cardId:card.id,signature:card.signature,choice:'keep',clientId},'authenticated-owner',at);
}

test('Registered decisions leave the board across refreshes, and only an explicit reopening restores the exact account once',()=>{
 const state=fixture(),initial=board(state);
 assert.deepEqual(boardAccounts(initial),['account-a','account-b']);
 assert.equal(new Set(pendingIds(initial)).size,2,'Equal campaign names and external IDs in separate accounts stay distinct.');
 const first=keep(state,'account-a',now,'keep-a'),saved=structuredClone(first);
 assert.deepEqual(boardAccounts(board(state)),['account-b']);
 for(const snapshot of state.snapshots){snapshot.fetchedAt=date(now+1000);snapshot.rows[0].spend+=50;}
 assert.deepEqual(boardAccounts(board(state,now+2000)),['account-b']);
 reopenDecision(state,{project,choiceId:first.id,clientId:'reopen-a'},'authenticated-owner',now+3000);
 assert.deepEqual(boardAccounts(board(state,now+4000)),['account-a','account-b']);
 reopenDecision(state,{project,choiceId:first.id,clientId:'reopen-a'},'authenticated-owner',now+4000);
 assert.equal(pendingIds(board(state,now+4000)).length,2,'Retrying reopening never duplicates a tile.');
 const second=keep(state,'account-a',now+5000,'keep-a-again');
 assert.deepEqual(boardAccounts(board(state,now+6000)),['account-b']);
 assert.equal(second.reconsidersChoiceId,first.id);
 assert.deepEqual(state.ownerChoices[0],saved);
 assert.equal(state.ownerChoices.length,2);
 assert.equal(state.proposals?.length||0,0);
 assert.equal(state.executions,undefined);
});
