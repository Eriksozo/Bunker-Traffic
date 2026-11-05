import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionColumns,decisionKanban,decisionSuggestion,matchesDecisionFilter,decisionReviewState} from '../lib/decision-kanban.mjs';
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

test('Manter filters only current authored recommendations, never diagnostic defaults or stale choices',()=>{
 const keep={id:'real-keep',teamReady:true,suggestion:{origin:'team',action:'keep'}};
 const cards=[{id:'default',suggestion:{origin:'diagnostic',action:'keep'}},{...keep,id:'no-team',teamReady:false},{...keep,id:'stale',analysisStale:true},{...keep,id:'changed',liveDrift:{kind:'native'}},{...keep,id:'incident',monitor:{requiresReview:true}},keep,{id:'increase',teamReady:true,suggestion:{origin:'team',action:'increase'}}];
 const before=structuredClone(cards);
 assert.deepEqual(cards.filter(c=>matchesDecisionFilter(c,'keep')).map(c=>c.id),['real-keep']);
 assert.deepEqual(cards.filter(c=>matchesDecisionFilter(c,'pending')).map(c=>c.id),['default','no-team','stale','changed','incident']);
 assert.deepEqual(cards.filter(c=>matchesDecisionFilter(c,'reread')).map(c=>c.id),['stale','changed','incident']);
 assert.equal(cards.filter(c=>matchesDecisionFilter(c,'all')).length,cards.length);
 assert.deepEqual(cards,before);
});

test('all four action filters reject diagnostic, unknown and unreviewed actions',()=>{
 for(const action of ['keep','increase','reduce','pause']){
  assert.equal(matchesDecisionFilter({teamReady:true,suggestion:{origin:'diagnostic',action}},action),false);
  assert.equal(matchesDecisionFilter({teamReady:false,suggestion:{origin:'team',action}},action),false);
  assert.equal(matchesDecisionFilter({teamReady:true,suggestion:{origin:'team',action}},action),true);
 }
 assert.equal(decisionSuggestion({teamReady:true,suggestion:{origin:'team',action:'invented'}}),null);
 assert.equal(decisionSuggestion(null),null);
});

test('reassessment always stays in review, even if a caller offers an approval callback',()=>{
 const cards=[{id:'changed',teamReady:true,liveDrift:{kind:'native'},suggestion:{origin:'team',action:'keep'}},{id:'diagnostic',teamReady:true,suggestion:{origin:'diagnostic',action:'keep'}}];
 assert.deepEqual(groupedIds(decisionKanban(cards,()=>true)),{analysis:['changed','diagnostic'],suggestions:[],approval:[]});
});

function liveReview(){
 const card={project:'john',roundId:'round',row:{adAccountId:'account',externalId:'campaign'},suggestion:{origin:'diagnostic',action:'keep'}};
 const state={paused:false,cloudResearch:{john:{jobId:'job',focus:[{adAccountId:'account',externalId:'campaign'}]}},collaborationRounds:[{id:'round',project:'john',jobId:'job',stages:[{status:'Em análise',claimId:'claim',executionRef:'cloud-worker',startedAt:'2026-11-02T19:59:00Z',leaseUntil:'2026-11-02T20:01:00Z'}]}]};
 return {card,state};
}

test('only the exact campaign in a live claimed batch is described as in review',()=>{
 const {card,state}=liveReview(),before=structuredClone(state),at=Date.parse('2026-11-02T20:00:00Z');
 assert.equal(decisionReviewState(card,state,at).id,'reviewing');
 assert.equal(decisionReviewState({...card,row:{...card.row,adAccountId:'other-account'}},state,at).id,'pending');
 assert.equal(decisionReviewState({...card,project:'nico'},state,at).id,'pending');
 assert.equal(decisionReviewState({...card,roundId:'other-round'},state,at).id,'pending');
 assert.deepEqual(state,before);
});

test('expired, future, paused or abandoned claims cannot simulate an active review',()=>{
 const at=Date.parse('2026-11-02T20:00:00Z');
 for(const patch of [{leaseUntil:'2026-11-02T19:59:59Z'},{leaseUntil:'invalid'},{startedAt:'2026-11-02T20:00:01Z'},{status:'Falhou'},{status:'Concluída'},{claimId:null},{executionRef:null}]){
  const {card,state}=liveReview();Object.assign(state.collaborationRounds[0].stages[0],patch);
  assert.equal(decisionReviewState(card,state,at).id,'pending');
 }
 const {card,state}=liveReview();state.paused=true;assert.equal(decisionReviewState(card,state,at).id,'pending');
 state.paused=false;state.cloudResearch.john.jobId='previous-job';assert.equal(decisionReviewState(card,state,at).id,'pending');
});

test('changed context gets a reread label; three opinions alone never imply a completed recommendation',()=>{
 const {card,state}=liveReview(),at=Date.parse('2026-11-02T20:00:00Z');
 assert.equal(decisionReviewState({...card,liveDrift:{kind:'native'}},state,at).id,'reread');
 assert.equal(decisionReviewState({...card,teamReady:true,suggestion:{origin:'diagnostic',action:'keep'}},{},at).id,'pending');
 assert.equal(decisionReviewState({...card,teamReady:true,suggestion:{origin:'team',action:'keep'}},state,at).id,'suggestion');
});

test('A proposal label or status cannot grant approval readiness without the caller validating its exact scope',()=>{
 const cards=[
  {id:'in-review',teamReady:true,suggestion:{origin:'proposal',action:'increase'},proposal:{status:'Em revisão'}},
  {id:'apparently-ready',teamReady:true,suggestion:{origin:'proposal',action:'increase'},proposal:{status:'Aguardando aprovação'}},
  {id:'already-approved',teamReady:true,suggestion:{origin:'proposal',action:'increase'},proposal:{status:'Aprovada'}},
 ];
 assert.deepEqual(groupedIds(decisionKanban(cards)),{analysis:['already-approved'],suggestions:['in-review','apparently-ready'],approval:[]});
 assert.deepEqual(groupedIds(decisionKanban(cards,card=>card.id==='apparently-ready')),{analysis:['already-approved'],suggestions:['in-review'],approval:['apparently-ready']});
 assert.deepEqual(cards.map(card=>card.proposal.status),['Em revisão','Aguardando aprovação','Aprovada']);
});

test('Every stage receives its complete filtered population before a display limit is applied',()=>{
 const cards=[...Array.from({length:17},(_,i)=>({id:'triage-'+i,suggestion:{origin:'diagnostic',action:'keep'}})),{id:'late-suggestion',teamReady:true,suggestion:{origin:'team',action:'reduce'}},{id:'late-approval',teamReady:true,suggestion:{origin:'proposal',action:'pause'},proposal:{status:'Aguardando aprovação'}}];
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
