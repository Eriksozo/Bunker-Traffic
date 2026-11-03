import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {choiceResolutionArchiveQuery,hydrateChoiceResolutions,readChoiceResolution} from '../lib/decision-resolution.mjs';
import {decisionLearningSummary,readDecisionExamples} from '../lib/decision-learning-view.mjs';

const project='project-a',now=Date.parse('2026-11-02T20:00:00Z');
const submittedAt='2026-11-02T19:00:00.000Z',confirmedAt='2026-11-02T19:00:01.000Z';
function fixture(){
 const choice={id:'choice',project,objectId:'campaign',adAccountId:'account',currency:'USD',action:'increase',before:{dailyBudget:100},after:{dailyBudget:150},proposalId:'proposal',status:'Pendente de revisão'};
 const proposal={id:'proposal',project,status:'Aprovada',version:2,signature:'sealed-version',approvedVersion:2,approvedSignature:'sealed-version',executionConfirmedAt:confirmedAt,payload:{level:'campaign',action:'budget',provider:'Meta',objectId:'campaign',adAccountId:'account',currency:'USD',before:{dailyBudget:100},after:{dailyBudget:150},sourceCut:{snapshots:['never copy sources '.repeat(10000)]}}};
 const execution={id:'execution',proposalId:'proposal',project,proposalVersion:2,proposalSignature:'sealed-version',status:'Confirmada',submittedAt,confirmedAt,preflight:{row:{id:'internal'}},readback:{source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:confirmedAt,row:{id:'internal',externalId:'campaign',adAccountId:'account',provider:'Meta',budgetCurrency:'USD',dailyBudget:150,status:'ACTIVE'}},events:[{private:'full execution journal is archived'}]};
 const archive={key:'collaboration:round',payload:{type:'bunker-collaboration',version:1,round:{id:'round',project},proposals:[proposal],executions:[execution],messages:[{text:'never copy discussion'}]}};
 return {state:{config:{[project]:{}},ownerChoices:[choice]},archive,choice,proposal,execution};
}
function db(archives=[]){
 const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE bunker_records(key TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER,updated_at TEXT)');
 for(const a of archives)d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run(a.key,JSON.stringify(a.payload),1,confirmedAt);
 return d;
}
function adapter(d,calls=[]){return {prepare(sql){calls.push(sql);return {bind(...params){return {async all(){return {success:true,results:d.prepare(sql).all(...params)};}};}};}};}

test('Old confirmed archives hydrate bounded receipts through SELECT without rewriting choices or archives',async()=>{
 const f=fixture(),d=db([f.archive]),saved=structuredClone(f.state),before=d.prepare('SELECT total_changes() AS n').get().n,calls=[];
 const query=choiceResolutionArchiveQuery(f.state,now),proofs=d.prepare(query.sql).all(...query.params);
 assert.equal(proofs.length,1);assert.ok(JSON.stringify(proofs).length<4000);assert.ok(!JSON.stringify(proofs).includes('never copy'));assert.ok(!JSON.stringify(proofs).includes('full execution'));
 assert.deepEqual(await hydrateChoiceResolutions(adapter(d,calls),f.state,now),{requested:1,recovered:1});
 const receipt=readChoiceResolution(f.state,f.choice,now);assert.equal(receipt.executionId,'execution');assert.equal(receipt.archiveKey,f.archive.key);assert.equal(receipt.proposalVersion,2);
 assert.deepEqual(f.state.ownerChoices,saved.ownerChoices);assert.deepEqual(f.state.config,saved.config);assert.equal(f.state.proposals,undefined);assert.equal(f.state.executions,undefined);
 assert.equal(d.prepare('SELECT total_changes() AS n').get().n,before);assert.deepEqual(JSON.parse(d.prepare('SELECT payload FROM bunker_records').get().payload),f.archive.payload);
 assert.deepEqual(await hydrateChoiceResolutions(adapter(d,calls),f.state,now),{requested:0,recovered:0});assert.equal(calls.length,1);
 const summary=decisionLearningSummary(f.state,project,now);assert.equal(summary.choices[0].executionStatus,'Confirmada');assert.equal(summary.choices[0].proposalStatus,'Aprovada');assert.equal(summary.choices[0].resolution.archiveKey,f.archive.key);assert.equal(summary.pendingChoices.length,0);assert.equal(summary.choices[0].windows,undefined);
 assert.equal(readDecisionExamples(f.state,{projectId:project,choiceId:f.choice.id}).resolution.executionId,'execution');
 d.close();
});

test('Receipt hydration requires exact project, account, currency, values, approval and confirmation proof',async()=>{
 const mismatches=[
  f=>f.archive.payload.round.project='other-project',f=>f.proposal.project='other-project',f=>f.execution.project='other-project',
  f=>f.proposal.payload.adAccountId='other-account',f=>f.proposal.payload.objectId='other-campaign',f=>f.proposal.payload.currency='BRL',
  f=>f.proposal.payload.before.dailyBudget=99,f=>f.proposal.payload.after.dailyBudget=151,f=>f.execution.readback.row.dailyBudget=151,
  f=>f.execution.readback.row.adAccountId='other-account',f=>f.execution.readback.row.externalId='other-campaign',f=>f.execution.readback.row.budgetCurrency='BRL',
  f=>f.execution.readback.row.id='different-internal',f=>f.execution.readback.source='Meta UI',f=>f.execution.readback.complete=1,
  f=>f.execution.readback.fetchedAt='2026-11-02T18:00:00.000Z',f=>f.execution.confirmedAt='2026-11-03T00:00:00.000Z',
  f=>f.proposal.approvedVersion=1,f=>f.proposal.approvedSignature='other',f=>f.execution.proposalVersion=1,f=>f.execution.proposalSignature='other',
  f=>f.proposal.executionConfirmedAt=null,f=>f.execution.submittedAt=null,f=>f.execution.status='Enviada',f=>f.proposal.status='Aguardando aprovação',
  f=>f.archive.payload.type='different-type',f=>f.archive.payload.version=2
 ];
 for(const [i,change] of mismatches.entries()){
  const f=fixture();change(f);const d=db([f.archive]),saved=structuredClone(f.state);
  assert.deepEqual(await hydrateChoiceResolutions(adapter(d),f.state,now),{requested:1,recovered:0},'mismatch '+i);assert.deepEqual(f.state,saved,'immutable '+i);d.close();
 }
});

test('Linked intentions hydrate status receipts and never manufacture a proposal or duplicate a choice',async()=>{
 const f=fixture();delete f.choice.proposalId;f.state.choiceLinks=[{id:'link',choiceId:f.choice.id,proposalId:f.proposal.id}];
 f.choice.action='pause';f.choice.before={status:'ACTIVE'};f.choice.after={status:'PAUSED'};
 f.proposal.payload.action='status';f.proposal.payload.before={status:'ACTIVE'};f.proposal.payload.after={status:'PAUSED'};f.execution.readback.row.status='PAUSED';
 const d=db([f.archive]),saved=structuredClone(f.state);await hydrateChoiceResolutions(adapter(d),f.state,now);
 assert.equal(readChoiceResolution(f.state,f.choice,now).status,'Confirmada');assert.deepEqual(f.state.ownerChoices,saved.ownerChoices);assert.deepEqual(f.state.choiceLinks,saved.choiceLinks);assert.equal(f.state.ownerChoices.length,1);assert.equal(decisionLearningSummary(f.state,project,now).pendingChoices.length,0);d.close();
});

test('Archive lookup is bounded, parameterized and skips live proposals, nonfinancial choices and existing receipts',()=>{
 const f=fixture();f.state.proposals=[structuredClone(f.proposal)];assert.equal(choiceResolutionArchiveQuery(f.state,now),null);delete f.state.proposals;
 f.choice.action='keep';assert.equal(choiceResolutionArchiveQuery(f.state,now),null);f.choice.action='increase';
 f.choice.proposalId="proposal' OR 1=1 --";const query=choiceResolutionArchiveQuery(f.state,now);assert.ok(!query.sql.includes("proposal'"));assert.equal(JSON.parse(query.params[0])[0].proposalId,f.choice.proposalId);assert.equal(query.params[1],500);
 f.state.ownerChoices=Array.from({length:700},(_,i)=>({...f.choice,id:'choice-'+i,proposalId:'proposal-'+i}));const bounded=choiceResolutionArchiveQuery(f.state,now);assert.equal(JSON.parse(bounded.params[0]).length,500);assert.equal(bounded.requested,500);
});

test('Unavailable archival proof is surfaced without marking a decision applied',async()=>{
 const f=fixture(),saved=structuredClone(f.state),bad={prepare(){return {bind(){return {async all(){return {success:false};}};}};}};
 await assert.rejects(hydrateChoiceResolutions(bad,f.state,now),/recibos arquivados/);assert.deepEqual(f.state,saved);
});
