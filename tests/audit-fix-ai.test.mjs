import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudEngine,cloudSuggestionBlock,failCloudOpinion} from '../lib/cloud-engine.mjs';
import {runCloudAnalyst,suggestionShapeFailure} from '../lib/cloud-analysis.mjs';
import {ensureCollaboration,claimCollaboration,submitProposal} from '../lib/collaboration.mjs';
import {cloudProposalPayload} from '../lib/cloud-engine.mjs';
const project='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const iso=t=>new Date(t).toISOString();
// Six Meta campaigns with sales; 403 has only a lifetime budget (no own daily budget to change).
function fixture(){
 const now=Date.now(),start=Date.parse(iso(now).slice(0,10)+'T00:00:00Z');
 const base={externalId:'123',adAccountId:account,provider:'meta',name:'Sales',accountName:'Example',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',level:'campaign',spend:100,revenueNet:200,frontOrders:2};
 const rows=()=>Array.from({length:6},(_,i)=>({...base,id:'internal-'+i,externalId:i?String(400+i):'123',name:'Sales '+i,...(i===3?{dailyBudget:null,lifetimeBudget:1000}:{})}));
 const job={id:'job',project,status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)};
 const state={config:{[project]:{projectName:'Example'}},jobs:[job],agents:{[project]:{jobId:'job'}},collaborationRounds:[],collaborationMessages:[],proposals:[],executions:[],snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Example',period,level:'campaign',source:'Malva MCP',complete:true,from:iso(start-({today:0,yesterday:1,'3d':3,'7d':7}[period])*86400000),to:iso(start+(period==='today'?86400000:0)),timezone:'UTC',fetchedAt:iso(now-1000),lastSyncAt:null,rows:rows()}))};
 const round=ensureCollaboration(state,job);return {state,round};
}
// Same per-write commit semantics as the worker: a throwing callback commits nothing. failWhen simulates a lost commit.
function memory(state,failWhen=()=>false){return {get state(){return state;},write:async fn=>{const draft=structuredClone(state),r=await fn(draft,1);if(failWhen(draft))throw Error('storage write lost');state=draft;return r;}};}
function model(opsSuggestions){let ops=0;return {get opsCalls(){return ops;},run:async(_m,request)=>{const b=JSON.parse(request.messages[1].content),c=b.context,r=b.reflectionRequirements;if(c.role==='ops'&&!c.proposal)ops++;
 return {response:{decision:'Revisar exposição',reason:'Conferir aquisição',nextStep:'Aguardar o dono',text:'Leitura das campanhas do pacote.',verdict:c.proposal?'approve':null,memoryReview:b.memoryReviewRequirements?.required?{reference:b.memoryReviewRequirements.options[0].reference,stance:'inconclusive',reason:'Sem resultado posterior; confrontar a fonte atual.',evidenceReferences:b.evidenceSelection.reflectionExamples.slice(0,1)}:null,campaignReadings:b.evidenceSelection.campaignExamples.map(x=>({...x,assessment:'observe',reason:'Conferir aquisição desta campanha.'})),reflection:{lesson:'Conferir a própria fonte.',uncertainty:'Resultado não medido.',nextCheck:'Confrontar novas vendas.',citations:c.role==='ops'?b.evidenceSelection.campaignExamples.map(x=>x.citations[0]).slice(0,8):b.evidenceSelection.reflectionExamples.slice(0,1),peerChecks:r.peerConclusions.map(p=>({messageId:p.messageId,stance:'support',reason:'Aquisição e exposição conferidas.'}))},suggestions:c.role==='ops'&&!c.proposal?(typeof opsSuggestions==='function'?opsSuggestions(ops):opsSuggestions):[],question:null}};}};}
const s=(objectId,action,percent)=>({adAccountId:account,objectId,action,percent,reason:'Motivo concreto do teste.'});
const engineFor=(store,ai,now=Date.now)=>createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{dispatch:async()=>{throw Error('No owner approval');}},ai,ops:{},now});
const opsStage=(state,roundId)=>state.collaborationRounds.find(r=>r.id===roundId).stages.find(x=>x.agentId==='ops');

test('Percent is tied to the action per item, never repaired or defaulted',()=>{
 assert.equal(suggestionShapeFailure(s('1','pause',50)),'percent_not_allowed');assert.equal(suggestionShapeFailure(s('1','keep',10)),'percent_not_allowed');
 assert.equal(suggestionShapeFailure(s('1','increase',null)),'percent_required');assert.equal(suggestionShapeFailure(s('1','reduce',null)),'percent_required');
 assert.equal(suggestionShapeFailure(s('1','reduce',150)),'reduce_percent_out_of_range');assert.equal(suggestionShapeFailure(s('1','reduce',100)),'reduce_percent_out_of_range');
 for(const ok of [s('1','pause',null),s('1','keep',null),s('1','increase',500),s('1','reduce',99.5),s('1','reduce',20)])assert.equal(suggestionShapeFailure(ok),null);
 const card=(row,actionable={increase:true,reduce:true,pause:true,keep:true})=>({row:{dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',...row},actionable});
 assert.equal(cloudSuggestionBlock(s('1','reduce',20),card({dailyBudget:null,lifetimeBudget:1000})),'no_own_daily_budget');
 assert.equal(cloudSuggestionBlock(s('1','pause',null),card({status:'PAUSED'})),'not_active');
 assert.equal(cloudSuggestionBlock(s('1','reduce',20),card({},{reduce:false})),'source_not_actionable');
 assert.equal(cloudSuggestionBlock(s('1','reduce',1),card({dailyBudget:0.5})),'budget_change_not_representable');
 assert.equal(cloudSuggestionBlock(s('1','reduce',20),card({})),null);assert.equal(cloudSuggestionBlock(s('1','keep',null),card({},{keep:true})),null);
});

test('The OPS model schema describes the percent each action takes',async()=>{
 let request;const value={decision:'d',reason:'r',nextStep:'n',text:'t',suggestions:[],question:null};
 await runCloudAnalyst({run:async(_m,r)=>{request=r;return {response:value};}},'ops',{campaigns:[{target:{adAccountId:account,externalId:'123'}}]});
 assert.match(request.response_format.json_schema.properties.suggestions.items.properties.percent.description,/pause e keep: null.*reduce: número maior que 0 e menor que 100/);
});

test('Malformed or non-actionable OPS items are dropped with their code; the valid cut is still proposed and the stage concludes',async()=>{
 const {state,round}=fixture(),store=memory(state);
 const ai=model([s('401','pause',50),s('403','reduce',20),s('404','increase',null),s('402','reduce',150),s('405','pause',null),s('123','keep',10)]);
 const engine=engineFor(store,ai);for(let i=0;i<4;i++)assert.equal((await engine.step()).kind,'stage');
 assert.equal(opsStage(store.state,round.id).status,'Concluída');
 const conclusion=store.state.collaborationMessages.find(m=>m.kind==='conclusion'&&m.fromAgent==='ops');assert.ok(conclusion);
 assert.deepEqual(conclusion.suggestionDrops.map(d=>[d.objectId,d.action,d.percent,d.reason]),[['401','pause',50,'percent_not_allowed'],['404','increase',null,'percent_required'],['402','reduce',150,'reduce_percent_out_of_range'],['123','keep',10,'percent_not_allowed'],['403','reduce',20,'no_own_daily_budget']]);
 assert.deepEqual(store.state.cardSuggestions.map(x=>[x.objectId,x.action,x.percent]),[['405','pause',null]]);
 assert.deepEqual(store.state.proposals.map(p=>[p.payload.objectId,p.payload.action,p.payload.after.status,p.status]),[['405','status','PAUSED','Em revisão']]);
 // Never an execution: the proposal still waits for peer reviews and the owner.
 assert.equal(store.state.executions.length,0);assert.equal(store.state.proposals[0].approvedVersion,undefined);
});

test('All OPS suggestions commit in one write: a lost write leaves no partial proposal, and the retry proposes both without colliding',async()=>{
 // Before the fix the first item had its own committed write, so losing the second left the 405 proposal behind.
 const {state,round}=fixture();let lose=true;
 const store=memory(state,d=>lose&&(d.cardSuggestions||[]).length>=2&&opsStage(d,round.id)?.status==='Em análise');
 const ai=model([s('405','pause',null),s('404','reduce',20)]),engine=engineFor(store,ai);
 for(let i=0;i<3;i++)assert.equal((await engine.step()).kind,'stage');
 await assert.rejects(engine.step(),/storage write lost/);
 assert.equal((store.state.cardSuggestions||[]).length,0);assert.equal(store.state.proposals.length,0);
 lose=false;const later=Date.now()+16*60000,retry=engineFor(store,ai,()=>later);
 assert.equal((await retry.step()).kind,'stage');assert.equal(ai.opsCalls,2);
 assert.equal(opsStage(store.state,round.id).status,'Concluída');assert.equal(opsStage(store.state,round.id).attempt,2);
 assert.deepEqual(store.state.proposals.map(p=>p.payload.objectId).sort(),['404','405']);
 assert.equal(store.state.collaborationMessages.find(m=>m.kind==='conclusion'&&m.fromAgent==='ops').suggestionDrops,undefined);
});

test('A retry that meets a proposal left by an earlier claim keeps it, records the skip and still concludes',async()=>{
 const {state,round}=fixture(),store=memory(state),ai=model([s('405','pause',null),s('404','reduce',20)]),engine=engineFor(store,ai);
 for(let i=0;i<3;i++)assert.equal((await engine.step()).kind,'stage');
 // Earlier OPS claim that wrote the 405 proposal and then failed before its conclusion (the pre-fix partial write).
 let earlier;await store.write(st=>{const c=claimCollaboration(st,{roundId:round.id,agentId:'ops',executionRef:'old-run',clientId:'old-claim'});const row=st.snapshots.find(x=>x.period==='today').rows.find(r=>r.externalId==='405'),refs=[{period:'today',level:'campaign',adAccountId:account,externalId:'405',fetchedAt:st.snapshots[0].fetchedAt}],opinions=st.collaborationMessages.filter(m=>m.kind==='conclusion').map(m=>m.id);
  earlier=submitProposal(st,{roundId:round.id,claimId:c.claimId,executionRef:'old-run',clientId:'cloud-proposal:'+c.claimId+':x',payload:cloudProposalPayload({action:'pause',percent:null,reason:'Teste sem vendas.'},row,refs,opinions),expiresAt:iso(Date.now()+30*60000)}).id;
  failCloudOpinion(st,{roundId:round.id,agentId:'ops',claimId:c.claimId,executionRef:'old-run'},'CLOUD_PROPOSAL_INVALID');});
 for(let i=0;i<6&&opsStage(store.state,round.id).status!=='Concluída';i++)await engine.step();
 assert.equal(opsStage(store.state,round.id).status,'Concluída');assert.equal(opsStage(store.state,round.id).attempt,2);
 const pauses=store.state.proposals.filter(p=>p.payload.objectId==='405');assert.equal(pauses.length,1);assert.equal(pauses[0].id,earlier);
 assert.ok(store.state.proposals.some(p=>p.payload.objectId==='404'&&p.payload.action==='budget'));
 const drop=store.state.collaborationMessages.find(m=>m.kind==='conclusion'&&m.fromAgent==='ops').suggestionDrops;
 assert.deepEqual(drop,[{adAccountId:account,objectId:'405',action:'pause',percent:null,reason:'proposal_exists',proposalId:earlier,cardSuggestionRecorded:true}]);
 assert.equal(store.state.executions.length,0);
});

test('Two items for the same campaign in one output drop the second instead of aborting the list',async()=>{
 const {state,round}=fixture(),store=memory(state),ai=model([s('405','pause',null),s('405','reduce',30)]),engine=engineFor(store,ai);
 for(let i=0;i<4;i++)assert.equal((await engine.step()).kind,'stage');
 assert.equal(opsStage(store.state,round.id).status,'Concluída');assert.equal(store.state.proposals.length,1);
 assert.deepEqual(store.state.collaborationMessages.find(m=>m.kind==='conclusion'&&m.fromAgent==='ops').suggestionDrops.map(d=>d.reason),['duplicate_target']);
});

test('Review fix: a blocked item does not take the campaign slot; a valid item after it is still proposed',async()=>{
 // Campaign 403 has a lifetime budget: an increase is blocked (no own daily budget) but a pause is valid.
 const {state,round}=fixture(),store=memory(state),ai=model([s('403','increase',20),s('403','pause',null)]),engine=engineFor(store,ai);
 for(let i=0;i<4;i++)assert.equal((await engine.step()).kind,'stage');
 assert.equal(opsStage(store.state,round.id).status,'Concluída');
 const drops=store.state.collaborationMessages.find(m=>m.kind==='conclusion'&&m.fromAgent==='ops').suggestionDrops.map(d=>[d.objectId,d.action,d.reason]);
 assert.deepEqual(drops,[['403','increase','no_own_daily_budget']]);
 assert.deepEqual(store.state.proposals.map(p=>[p.payload.objectId,p.payload.action,p.payload.after.status]),[['403','status','PAUSED']]);
});
