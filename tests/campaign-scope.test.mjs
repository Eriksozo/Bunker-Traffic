import test from 'node:test';
import assert from 'node:assert/strict';
import {isWarmupCampaign,isWarmupTarget} from '../lib/campaign-scope.mjs';
import {phase,candidates,rowsFor,sum,budget} from '../lib/analysis.mjs';
import {buildDecisionCards,decisionLearningPlan} from '../lib/decision-cards.mjs';
import {decisionQueue,reopenDecision} from '../lib/decision-reconsider.mjs';
import {pendingCampaignCandidates} from '../lib/decision-flow.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution} from '../lib/execution.mjs';

const now=Date.parse('2026-11-02T20:00:00Z'),project='11111111-1111-4111-8111-111111111111';
const date=t=>new Date(t).toISOString();
const periods=['7d','3d','yesterday','today'];
const base={id:'22222222-2222-4222-8222-222222222222',level:'campaign',externalId:'campaign-sales',adAccountId:'account-a',provider:'Meta',name:'[TESTE] Aquisição',accountName:'Conta A',budgetCurrency:'USD',budgetRate:5,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:250,revenueNet:220,adCosts:4,productCost:0,saleTax:0,frontOrders:2,orders:2,checkouts:4,impressions:1000,linkClicks:20,refundedRevenue:0};
function snapshot(period,rows,level='campaign',scope=project){return {projectId:scope,projectName:'Projeto local',period,level,source:'Malva MCP',complete:true,from:'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:structuredClone(rows)};}
function stateFor(rows=[base]){return {paused:false,config:{[project]:{projectName:'Projeto local',targetRoas:2,dailyCap:1000}},jobs:[],snapshots:periods.map(period=>snapshot(period,rows))};}

test('Warmup names accept explicit tokens, accent/case and separators without substring false positives',()=>{
 for(const name of ['[ENGAJAMENTO]','01/11 - [engaj] - Conta','[ENGAGE]','[Engagement]','[AQUEC]','[AQUECIMENTO]','[aquecer]','[áquecimento]','[WARMUP]','[Warm Up]','[WARM-UP]','[WARM_UP]'])assert.equal(isWarmupCampaign(name),true,name);
 for(const name of ['[REENGAJAMENTO]','[TRÁFEGO]','[TRÁFEGO VENDAS]','[TESTE]','[PRE-ESCALA]','[AVATAR]','[ESCALA]','ENGAGEMENTSCORE','WARMUPPER','[COST-CAP]','','Reengage buyers'])assert.equal(isWarmupCampaign(name),false,name);
});

test('Explicit warmup takes priority over overlapping sales-phase tags',()=>{
 for(const name of ['[ESCALA] - [ENGAJAMENTO]','[AVATAR] - [AQUECIMENTO]','[BID-CAP] - [WARM UP]','[TESTE] - [ENGAGE]'])assert.equal(phase(name),'Engajamento',name);
 assert.equal(phase('[PRE-ESCALA]'),'Pré-escala');
 assert.equal(phase('[AVATAR]'),'Avatar');
});

test('Warmup leaves cards and priority queues while financial readings, budgets and source history remain intact',()=>{
 const warm={...base,id:'33333333-3333-4333-8333-333333333333',externalId:'warm',name:'[ENGAJAMENTO]',spend:50,dailyBudget:20};
 const state=stateFor([base,warm]),before=structuredClone(state),today=rowsFor(state,project,'today');
 assert.deepEqual(buildDecisionCards(state,project,now).map(card=>card.row.externalId),['campaign-sales']);
 assert.deepEqual(decisionQueue(state,project,now).map(card=>card.row.externalId),['campaign-sales']);
 assert.deepEqual(candidates(state,project).map(card=>card.row.externalId),['campaign-sales']);
 assert.deepEqual(pendingCampaignCandidates(state,project,now).map(card=>card.row.externalId),['campaign-sales']);
 assert.equal(today.length,2);assert.equal(sum(today).spend,150);assert.equal(budget(today).active,600);
 assert.deepEqual(state,before);
});

test('A child inherits warmup from its campaign, including an ad with only an adset link',()=>{
 const parent={...base,name:'[AQUECIMENTO]'},adset={...base,level:'adset',externalId:'set-1',name:'Conjunto normal',campaignExternalId:base.externalId,dailyBudget:null};
 const state=stateFor([parent]);state.snapshots.push(snapshot('today',[adset],'adset'));
 assert.equal(isWarmupTarget(state,project,'adset',adset),true);
 assert.equal(isWarmupTarget(state,project,'ad',{...base,level:'ad',externalId:'ad-1',name:'NICO_A_001_H1',campaignExternalId:base.externalId,dailyBudget:null}),true);
 assert.equal(isWarmupTarget(state,project,'ad',{...base,level:'ad',externalId:'ad-2',name:'NICO_A_002_H1',adsetExternalId:'set-1',dailyBudget:null}),true);
});

test('Campaign parent lookup never crosses project or account, even when Meta IDs are equal',()=>{
 const state=stateFor([{...base,name:'[ENGAJAMENTO]'}]);
 const saleB={...base,adAccountId:'account-b',name:'[TESTE] Compras'};
 for(const source of state.snapshots)source.rows.push(structuredClone(saleB));
 const other='44444444-4444-4444-8444-444444444444';state.config[other]={projectName:'Outro projeto'};
 state.snapshots.push(...periods.map(period=>snapshot(period,[base],'campaign',other)));
 const child={...base,level:'adset',externalId:'set-1',name:'Conjunto normal',campaignExternalId:base.externalId};
 assert.equal(isWarmupTarget(state,project,'adset',child),true);
 assert.equal(isWarmupTarget(state,project,'adset',{...child,adAccountId:'account-b'}),false);
 assert.equal(isWarmupTarget(state,other,'adset',child),false);
 assert.equal(buildDecisionCards(state,'all',now).length,2);
});

test('The current today name wins over a historic warmup name, and the reverse excludes the current campaign',()=>{
 const state=stateFor([{...base,name:'[AQUECIMENTO]'}]);state.snapshots.find(s=>s.period==='today').rows[0].name='[TESTE] Vendas';
 const child={...base,level:'adset',externalId:'set-1',name:'Conjunto normal',campaignExternalId:base.externalId};
 assert.equal(isWarmupTarget(state,project,'adset',child),false);
 assert.equal(buildDecisionCards(state,project,now).length,1);
 state.snapshots.find(s=>s.period==='today').rows[0].name='[ENGAGEMENT]';
 assert.equal(isWarmupTarget(state,project,'adset',child),true);
 assert.equal(buildDecisionCards(state,project,now).length,0);
});

test('Warmup choices and cross-project examples stay auditable without entering sales preferences or pending analysis',()=>{
 const other='44444444-4444-4444-8444-444444444444',state=stateFor();state.config[other]={projectName:'Projeto de referência'};
 const choice={project,adAccountId:base.adAccountId,name:base.name,action:'increase',status:'Pendente de revisão',createdAt:date(now-10000),percent:25,suggestedAction:'increase',suggestedPercent:25,suggestionOrigin:'team'};
 state.ownerChoices=[{...choice,id:'sale-choice',cardId:'sale-card',objectId:base.externalId},{...choice,id:'warm-choice',cardId:'warm-card',objectId:'warm',name:'[AQUECIMENTO]',percent:500}];
 state.snapshots.push(...periods.map(period=>snapshot(period,[{...base,externalId:'renamed-warm',name:'[ENGAJAMENTO]'}],'campaign',other)));
 const event={project:other,adAccountId:base.adAccountId,action:'increase',percent:100,occurredAt:date(now-20000)};
 state.decisionHistory=[{...event,id:'reference-sale',objectId:'other-sale',name:'[TESTE] Vendas'},{...event,id:'reference-warm',objectId:'other-warm',name:'[WARM UP]'},{...event,id:'reference-renamed-warm',objectId:'renamed-warm',name:'Nome antigo sem identificação'},{...event,id:'local-warm-history',project,objectId:'warm',name:'[AQUECIMENTO]'}];
 const before=structuredClone(state),plan=decisionLearningPlan(state,project,now);
 assert.deepEqual(plan.choices.map(item=>item.id),['sale-choice','warm-choice']);
 assert.deepEqual(plan.history.map(item=>item.id),['local-warm-history']);
 assert.deepEqual(plan.pendingChoices.map(item=>item.id),['sale-choice']);
 const increases=plan.preferences.find(item=>item.action==='increase');
 assert.equal(increases.count,1);assert.equal(increases.independentCampaigns,1);assert.equal(increases.observedMedianPercent,25);
 assert.deepEqual(plan.referenceCases.map(item=>item.id),['reference-sale']);
 assert.equal(decisionLearningPlan(state,'all',now).history.length,4);
 assert.deepEqual(state,before);
});

test('Reopening old warmup decisions is blocked without removing choices, history or existing jobs',()=>{
 for(const currentName of ['[TESTE] Vendas','[ENGAJAMENTO]']){
  const state=stateFor([{...base,name:currentName}]);
  state.ownerChoices=[{id:'old-choice',project,cardId:'old-card',objectId:base.externalId,adAccountId:base.adAccountId,name:currentName==='[TESTE] Vendas'?'[AQUECIMENTO]':'Nome antigo de vendas',status:'Mantido',action:'keep',createdAt:date(now-20000)}];
  const before=structuredClone(state);
  assert.throws(()=>reopenDecision(state,{project,choiceId:'old-choice',clientId:'reopen-warm'},'authenticated-owner',now),/aquec|engaj|otimiza/i);
  assert.deepEqual(state,before);
 }
});

function ready({name=base.name,level='campaign',parentName=name}={}){
 const target={...base,name,level,...(level==='campaign'?{}:{id:'55555555-5555-4555-8555-555555555555',externalId:'child-target',campaignExternalId:base.externalId,dailyBudget:null})};
 const state=stateFor([{...base,name:parentName}]);
 if(level!=='campaign')state.snapshots.push(snapshot('today',[target],level));
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 state.jobs=[job];state.agents={[project]:{jobId:job.id}};
 const round=ensureCollaboration(state,job,now),refs=[{period:'today',level,adAccountId:target.adAccountId,externalId:target.externalId,fetchedAt:date(now-2000)}];let ops;
 for(const agentId of ['traffic','creative','budget','ops']){
  const claim=claimCollaboration(state,{roundId:round.id,agentId,executionRef:'real-test-run-'+agentId,clientId:'claim-'+agentId},now);
  if(agentId==='ops'){ops=claim;break;}
  postCollaboration(state,{roundId:round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'conclusion-'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Perspectiva independente apoiada na fonte.',evidenceRefs:refs},now);
 }
 const args={roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'proposal',expiresAt:date(now+300000),payload:{title:'Pausa seletiva',reason:'Conferir perda recorrente na instância exata.',action:'status',level,provider:'Meta',adAccountId:target.adAccountId,objectId:target.externalId,currency:'USD',before:{status:'ACTIVE'},after:{status:'PAUSED'},evidenceRefs:refs,opinionRefs:round.stages.slice(0,3).map(stage=>stage.conclusionId),risks:[]}};
 return {state,target,round,args};
}
function approved(){
 const f=ready();f.proposal=submitProposal(f.state,f.args,now);
 for(const agentId of ['traffic','budget']){
  const c=claimCollaboration(f.state,{roundId:f.round.id,agentId,proposalId:f.proposal.id,executionRef:'peer-'+agentId,clientId:'peer-claim-'+agentId},now);
  reviewProposal(f.state,{id:f.proposal.id,version:f.proposal.version,signature:f.proposal.signature,claimId:c.claimId,executionRef:c.executionRef,clientId:'peer-review-'+agentId,decision:'approve',comment:'Parecer técnico independente.'},{kind:'agent',agentId},now);
 }
 reviewProposal(f.state,{id:f.proposal.id,version:f.proposal.version,signature:f.proposal.signature,clientId:'owner-review',decision:'approve',comment:'Aprovação exata.'},{kind:'owner',id:'authenticated-owner'},now);
 f.execution=claimExecution(f.state,{proposalId:f.proposal.id,version:f.proposal.version,signature:f.proposal.signature,executionRef:'executor-test',clientId:'execution-claim'},now);
 f.input=(clientId,observation)=>({id:f.execution.id,claimId:f.execution.claimId,executionRef:f.execution.executionRef,clientId,...(observation?{observation}:{})});
 f.observation=(changes={},at=now)=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:date(at),rows:[{...f.target,...changes}]});
 return f;
}

test('Direct MCP proposals reject warmup campaigns and their otherwise normally named adsets/ads',()=>{
 for(const options of [{name:'[ENGAJAMENTO]'},{level:'adset',parentName:'[AQUECIMENTO]',name:'CONJ 01'},{level:'ad',parentName:'[WARM UP]',name:'NICO_A_001_H1'}]){
  const f=ready(options);
  assert.throws(()=>submitProposal(f.state,f.args,now),/aquec|engaj|otimiza/i,JSON.stringify(options));
  assert.equal(f.state.proposals.length,0);
 }
 const sales=ready();assert.equal(submitProposal(sales.state,sales.args,now).payload.objectId,base.externalId);
});

test('A freshly observed warmup rename blocks preparing an old sales approval before any dispatch',()=>{
 const f=approved();
 assert.throws(()=>prepareExecution(f.state,f.input('prepare',f.observation({name:'[ENGAJAMENTO]'})),now),/aquec|engaj|otimiza/i);
 assert.equal(f.execution.status,'Reservada');assert.equal(f.execution.submittedAt,undefined);
 assert.equal(f.execution.command,undefined);
});

test('Warmup exclusions must not prevent readback of an action that was already dispatched',()=>{
 const f=approved();prepareExecution(f.state,f.input('prepare',f.observation()),now);
 assert.equal(submitExecution(f.state,f.input('submit'),now).dispatchGranted,true);
 const result=confirmExecution(f.state,f.input('confirm',f.observation({status:'PAUSED',name:'[ENGAJAMENTO]'},now+1000)),now+1000);
 assert.equal(result.status,'Confirmada');assert.equal(result.readback.row.status,'PAUSED');
});
