import {recordIncident} from '../lib/campaign-incidents.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice,recordCardSuggestion,linkChoiceProposal,importDecisionHistory,decisionLearningPlan,decisionCardLimits} from '../lib/decision-cards.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal,compactCollaboration} from '../lib/collaboration.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution} from '../lib/execution.mjs';
import {readChoiceResolution} from '../lib/decision-resolution.mjs';

const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
function fixture({team=false,row={},config={}}={}){
 const base={id:'22222222-2222-4222-8222-222222222222',externalId:'meta-campaign',adAccountId:'account',provider:'Meta',name:'01/11 [CBO] [TESTE] Example',accountName:'USD account',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:280,revenueNet:250,adCosts:4,productCost:0,saleTax:0,frontOrders:3,orders:4,checkouts:10,impressions:1000,linkClicks:20,refundedRevenue:0,...row};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000,...config}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:period==='today'?'2026-11-02T03:00:00.000Z':period==='3d'?'2026-10-30T03:00:00.000Z':period==='yesterday'?'2026-11-01T03:00:00.000Z':'2026-10-26T03:00:00.000Z',to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]})),paused:false};
 const round=ensureCollaboration(state,job,now),ref={period:'today',level:'campaign',adAccountId:base.adAccountId,externalId:base.externalId,fetchedAt:date(now-2000)};let ops;
 if(team)for(const agentId of ['traffic','creative','budget','ops']){const c=claimCollaboration(state,{roundId:round.id,agentId,executionRef:'real-'+agentId,clientId:'claim-'+agentId},now);if(agentId==='ops'){ops=c;break;}postCollaboration(state,{roundId:round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'opinion-'+agentId,toAgent:agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Observed context for '+agentId,evidenceRefs:[ref]},now);}
 return {state,row:base,round,ops,ref};
}
const card=f=>buildDecisionCards(f.state,project,now)[0];
function choose(f,extra={}){const c=card(f);return recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:50,clientId:'choice',...extra},'server-owner',now);}
function proposed(f,after=150){
 const payload={title:'Increase exact native budget',reason:'Observed repeat acquisition',action:'budget',level:'campaign',provider:'Meta',adAccountId:f.row.adAccountId,objectId:f.row.externalId,currency:'USD',budgetOwner:'CBO',before:{dailyBudget:f.row.dailyBudget},after:{dailyBudget:after},evidenceRefs:[f.ref],opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)};
 const p=submitProposal(f.state,{roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'proposal',payload,expiresAt:date(now+300000)},now);
 for(const agentId of ['traffic','budget']){const claim=claimCollaboration(f.state,{roundId:f.round.id,agentId,proposalId:p.id,executionRef:'review-'+agentId,clientId:'peer-'+agentId},now);reviewProposal(f.state,{id:p.id,version:p.version,signature:p.signature,decision:'approve',comment:'Independent exact review',clientId:'review-'+agentId,claimId:claim.claimId,executionRef:claim.executionRef},{kind:'agent',agentId},now);}
 return p;
}
function historyEntry(p=project,events=[]){return {project:p,from:'2026-11-01T03:00:00.000Z',to:'2026-11-02T03:00:00.000Z',fetchedAt:date(now-1000),complete:true,pagination:{complete:true,nextCursor:null},events};}
function event(extra={}){return {id:'event',objectId:'meta-campaign',adAccountId:'account',nativeAccountId:'native-account',occurredAt:'2026-11-01T17:00:00.000Z',source:'malva',actor:{key:'malva:other',name:'Other operator',kind:'malva'},automatic:false,field:'dailyBudget',before:100,after:150,currency:'USD',echo:false,...extra};}

test('Cards expose measured windows and diagnostic keep without inventing team opinions',()=>{
 const f=fixture(),before=structuredClone(f.state),c=card(f);assert.equal(c.row.externalId,'meta-campaign');assert.equal(c.windows.today.roas,2.5);assert.equal(c.windows.today.partial,true);assert.equal(c.phase,'Teste');assert.equal(c.teamReady,false);assert.deepEqual(c.teamOpinions,[]);assert.equal(c.suggestion.origin,'diagnostic');assert.equal(c.suggestion.action,'keep');assert.ok(c.blockedReasons.some(x=>/pareceres/.test(x)));assert.deepEqual(f.state,before);
 const noSource=fixture();noSource.state.snapshots[3].rows=[];const historical=card(noSource);assert.equal(historical.actionable.increase,false);assert.equal(historical.windows.today,null);assert.equal(historical.windows['7d'].frontOrders,3);
});

test('OPS may record a genuine recommendation only after scoped opinions and a live claim',()=>{
 const f=fixture({team:true}),args={roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'suggestion',payload:{objectId:f.row.externalId,adAccountId:f.row.adAccountId,action:'increase',percent:20,reason:'Repeated front acquisition',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}};
 const r=recordCardSuggestion(f.state,args,now);assert.equal(card(f).suggestion.origin,'team');assert.equal(card(f).suggestion.percent,20);assert.equal(recordCardSuggestion(f.state,args,now+1).id,r.id);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,payload:{...args.payload,percent:50}},now),/clientId/);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,clientId:'bad-claim',claimId:'invented'},now),/OPS/);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,clientId:'expired'},now+16*60000),/OPS/);
 const absent=fixture();assert.throws(()=>recordCardSuggestion(absent.state,{...args,roundId:absent.round.id},now),/OPS/);
});

test('An exact current suggestion with a new clientId is one recommendation, not another vote',()=>{
 const f=fixture({team:true}),args={roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'original',payload:{objectId:f.row.externalId,adAccountId:f.row.adAccountId,action:'increase',percent:20,reason:'Repeated front acquisition',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}};
 const first=recordCardSuggestion(f.state,args,now),frozen=structuredClone(first);
 const replay=recordCardSuggestion(f.state,{...args,clientId:'fresh-transport-id',payload:{...args.payload,opinionRefs:[...args.payload.opinionRefs].reverse()}},now+1);
 assert.equal(replay.id,first.id);assert.equal(f.state.cardSuggestions.length,1);assert.deepEqual(first,frozen);
 const aliasState=structuredClone(f.state),aliasArgs={...args,clientId:'fresh-transport-id',payload:{...args.payload,opinionRefs:[...args.payload.opinionRefs].reverse()}};
 assert.equal(recordCardSuggestion(f.state,aliasArgs,now+2).id,first.id);assert.deepEqual(f.state,aliasState);
 assert.throws(()=>recordCardSuggestion(f.state,{...aliasArgs,payload:{...aliasArgs.payload,reason:'Changed alias request'}},now+2),/clientId/);assert.deepEqual(f.state,aliasState);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,payload:{...args.payload,reason:'Changed original request'}},now+2),/clientId/);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,clientId:'invalid-lease',claimId:'invented'},now+2),/OPS/);
 const changed=recordCardSuggestion(f.state,{...args,clientId:'new-rationale',payload:{...args.payload,reason:'New evidence requires a different rationale'}},now+2);
 assert.notEqual(changed.id,first.id);assert.equal(f.state.cardSuggestions.length,2);assert.deepEqual(first,frozen);
 const reverted=recordCardSuggestion(f.state,{...args,clientId:'reconsider-earlier-rationale'},now+3);
 assert.notEqual(reverted.id,first.id);assert.equal(f.state.cardSuggestions.length,3);assert.equal(card(f).suggestion.reason,args.payload.reason);
 assert.equal(recordCardSuggestion(f.state,{...args,clientId:'replay-latest-rationale'},now+4).id,reverted.id);assert.equal(f.state.cardSuggestions.length,3);
 assert.equal(f.state.ownerChoices,undefined);assert.equal(f.state.executions,undefined);assert.deepEqual(f.state.proposals,[]);
});

test('Semantic replay at the suggestion limit keeps its original receipt, while new intent still fails closed',()=>{
 const f=fixture({team:true}),args={roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'original',payload:{objectId:f.row.externalId,adAccountId:f.row.adAccountId,action:'keep',reason:'Observe the current acquisition',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}};
 const first=recordCardSuggestion(f.state,args,now);
 f.state.cardSuggestions.push(...Array.from({length:499},(_,i)=>({id:'historical-'+i,clientId:'old-'+i,roundId:'old-round',contextHash:'old-context'})));
 assert.equal(recordCardSuggestion(f.state,{...args,clientId:'duplicate-at-cap'},now+1).id,first.id);assert.equal(f.state.cardSuggestions.length,500);assert.equal(f.state.cardSuggestions[0].requestAliases[0].clientId,'duplicate-at-cap');
 const before=structuredClone(f.state);assert.equal(recordCardSuggestion(f.state,{...args,clientId:'duplicate-at-cap'},now+2).id,first.id);assert.deepEqual(f.state,before);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,clientId:'new-at-cap',payload:{...args.payload,reason:'Different recommendation'}},now+1),/500/);assert.deepEqual(f.state,before);
});

test('Semantic replay aliases are bounded and cannot bypass their original payload fingerprint',()=>{
 const f=fixture({team:true}),args={roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'bounded-original',payload:{objectId:f.row.externalId,adAccountId:f.row.adAccountId,action:'keep',reason:'Observe acquisition',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}};
 const first=recordCardSuggestion(f.state,args,now);
 for(let i=0;i<decisionCardLimits.suggestionAliases;i++)assert.equal(recordCardSuggestion(f.state,{...args,clientId:'alias-'+i},now+i+1).id,first.id);
 const before=structuredClone(f.state);assert.equal(f.state.cardSuggestions.length,1);assert.equal(f.state.cardSuggestions[0].requestAliases.length,decisionCardLimits.suggestionAliases);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,clientId:'one-alias-too-many'},now+30),/aliases/);assert.deepEqual(f.state,before);
 assert.throws(()=>recordCardSuggestion(f.state,{...args,clientId:'alias-0',payload:{...args.payload,reason:'Different contents'}},now+30),/clientId/);assert.deepEqual(f.state,before);
 assert.equal(recordCardSuggestion(f.state,{...args,clientId:'alias-0'},now+30).id,first.id);assert.deepEqual(f.state,before);
});

test('Archived suggestions remain in their round payload and a removed-round replay cannot recreate them',()=>{
 const f=fixture({team:true}),args={roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'archived-request',payload:{objectId:f.row.externalId,adAccountId:f.row.adAccountId,action:'keep',reason:'Observe before changing',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}};
 const suggestion=recordCardSuggestion(f.state,args,now),frozen=structuredClone(suggestion);
 postCollaboration(f.state,{roundId:f.round.id,claimId:f.ops.claimId,executionRef:f.ops.executionRef,clientId:'ops-finished',toAgent:'traffic',kind:'conclusion',text:'Recommendation persisted; no external execution.',evidenceRefs:[f.ref]},now+1);
 for(let i=1;i<=3;i++)f.state.collaborationRounds.unshift({...structuredClone(f.round),id:'newer-'+i,jobId:'settled-'+i,createdAt:date(now+i*1000)});
 const result=compactCollaboration(f.state,now+5000),archive=result.archives.find(a=>a.payload.round.id===f.round.id);
 assert.deepEqual(archive.payload.cardSuggestions,[frozen]);assert.deepEqual(f.state.cardSuggestions,[]);
 const before=structuredClone(f.state);assert.throws(()=>recordCardSuggestion(f.state,args,now+5001),/não está disponível/);assert.deepEqual(f.state,before);
});

test('Owner intentions freeze native before/after and do not approve or execute',()=>{
 const f=fixture({row:{dailyBudget:71.96},config:{targetRoas:null,dailyCap:null}}),c=card(f),record=choose(f,{ownerId:'forged-client-owner'});assert.equal(c.actionable.increase,true);assert.equal(record.ownerId,'server-owner');assert.equal(record.before.dailyBudget,71.96);assert.equal(record.after.dailyBudget,107.94);assert.equal(record.currency,'USD');assert.equal(record.status,'Pendente de revisão');assert.equal(record.financialOutcome,'N/D');assert.equal(f.state.proposals.length,0);assert.equal(f.state.executions,undefined);assert.equal(record.windows.today.frontOrders,3);assert.equal(f.state.config[project].targetRoas,null);
 const request={project,cardId:c.id,signature:c.signature,choice:'increase',percent:50,clientId:'choice',ownerId:'forged-client-owner'};assert.equal(recordOwnerChoice(f.state,request,'server-owner',now+1).id,record.id);assert.throws(()=>recordOwnerChoice(f.state,{...request,percent:100},'server-owner',now),/clientId/);assert.equal(recordOwnerChoice(f.state,{...request,clientId:'double-click'},'server-owner',now).id,record.id);assert.equal(f.state.ownerChoices.length,1);
});

test('Wrong signature, foreign project, changed source and bad native values cannot submit financial choices',()=>{
 for(const mutation of [f=>f.state.snapshots[3].rows[0].dailyBudget=200,f=>f.state.snapshots[0].rows[0].spend=999,f=>f.state.config[project].targetRoas=3]){const f=fixture(),c=card(f);mutation(f);assert.throws(()=>recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:20,clientId:'changed'},'owner',now),/card mudou/);assert.equal(f.state.ownerChoices,undefined);}
 const old=fixture(),at=now+61*60000,c=buildDecisionCards(old.state,project,at)[0];const intent=recordOwnerChoice(old.state,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'stale'},'owner',at);assert.equal(intent.intentOnly,true);assert.equal(intent.status,'Pendente de revisão');assert.equal(old.state.executions,undefined);
 for(const row of [{budgetCurrency:undefined},{dailyBudget:null},{lifetimeBudget:1000},{dailyBudget:0}]){const f=fixture({row});assert.throws(()=>choose(f),/fonte/);assert.equal(f.state.ownerChoices,undefined);}
 for(const [choice,percent] of [['increase',0],['increase',1001],['reduce',100],['reduce',-1],['keep',20],['pause',10]])assert.throws(()=>choose(fixture(),{choice,percent}));
});

test('Keep is an auditable observation even with old diagnostic context and never a command',()=>{
 const f=fixture({row:{dailyBudget:null,budgetCurrency:undefined}}),c=buildDecisionCards(f.state,project,now+70*60000)[0];const kept=recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'keep',clientId:'keep'},'owner',now+70*60000);assert.equal(kept.status,'Mantido');assert.equal(kept.after.dailyBudget,null);assert.equal(f.state.proposals.length,0);assert.equal(f.state.executions,undefined);assert.throws(()=>{const d=buildDecisionCards(f.state,project,now+70*60000)[0];recordOwnerChoice(f.state,{project,cardId:d.id,signature:d.signature,choice:'keep',clientId:'keep-approval',approveExact:true},'owner',now+70*60000);},/autorização/);
});

test('Only a matching reviewed proposal can be owner-approved; adjustment stays a pending intention',()=>{
 const f=fixture({team:true}),p=proposed(f),original=structuredClone(p.payload),c=card(f);assert.equal(c.suggestion.origin,'proposal');const accepted=recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:50,clientId:'approve',approveExact:true,proposalId:p.id,proposalVersion:p.version,proposalSignature:p.signature},'authenticated-owner',now);assert.equal(accepted.status,'Autorizado');assert.equal(f.state.proposals[0].status,'Aprovada');assert.equal(f.state.proposals[0].reviews.at(-1).actorId,'authenticated-owner');assert.deepEqual(f.state.proposals[0].payload,original);assert.equal(f.state.executions,undefined);
 const altered=fixture({team:true}),q=proposed(altered),d=card(altered);assert.throws(()=>recordOwnerChoice(altered.state,{project,cardId:d.id,signature:d.signature,choice:'increase',percent:100,clientId:'wrong',approveExact:true,proposalId:q.id,proposalVersion:q.version,proposalSignature:q.signature},'owner',now),/não corresponde/);assert.equal(altered.state.ownerChoices,undefined);assert.equal(q.status,'Aguardando aprovação');const pending=choose(altered,{percent:100});assert.equal(pending.status,'Pendente de revisão');assert.equal(q.status,'Aguardando aprovação');
});

test('Choice links require exact native scope and do not rewrite choices or grant approval',()=>{
 const f=fixture({team:true}),choice=choose(f),p=proposed(f),before=structuredClone(choice),link=linkChoiceProposal(f.state,{choiceId:choice.id,proposalId:p.id},now);assert.equal(link.proposalId,p.id);assert.deepEqual(choice,before);assert.equal(p.status,'Aguardando aprovação');assert.equal(decisionLearningPlan(f.state,project,now).pendingChoices.length,1);assert.equal(linkChoiceProposal(f.state,{choiceId:choice.id,proposalId:p.id},now+1).id,link.id);
 const mismatch=fixture({team:true}),wrong=choose(mismatch,{percent:100}),q=proposed(mismatch);assert.throws(()=>linkChoiceProposal(mismatch.state,{choiceId:wrong.id,proposalId:q.id},now),/não corresponde/);assert.equal(mismatch.state.choiceLinks,undefined);
});

test('Journals refuse capacity without removing choices, approvals or sources',()=>{
 const f=fixture();f.state.ownerChoices=Array.from({length:decisionCardLimits.choices},(_,i)=>({id:'old-'+i,clientId:'old-'+i}));const before=structuredClone(f.state);assert.throws(()=>choose(f),/500/);assert.deepEqual(f.state,before);
});

test('History imports complete native observations, keeps attached echoes and distinguishes system events',()=>{
 const f=fixture(),native={id:'native-event',at:'2026-11-01T17:00:00.000Z',source:'malva',category:'budget',automatic:false,actor:{key:'malva:other',name:'Other operator',kind:'malva',profile:null},object:{level:'campaign',objectId:'internal-a',externalId:'campaign-external'},account:{id:'account-internal',accountId:'native-123',currency:'USD',provider:'meta'},values:{kind:'money',field:'daily_budget',from:100,to:150},echo:{at:'2026-11-01T16:59:59.000Z',actorName:'Dash',app:'Some app'}};
 const r=importDecisionHistory(f.state,{entry:historyEntry(project,[native])},now);assert.equal(r.inserted,1);const saved=f.state.decisionHistory[0];assert.equal(saved.echo,false);assert.equal(saved.humanObserved,true);assert.equal(saved.nativeEcho.actorName,'Dash');assert.equal(saved.nativeAccountId,'native-123');assert.equal(saved.preferenceOwner,false);assert.equal(saved.financialOutcome,'N/D');
 const automatic={...native,id:'automatic',at:'2026-11-01T18:00:00.000Z',source:'meta',automatic:true,category:'status',values:{kind:'status',from:'processing',to:'active'},actor:{key:'system',name:'Meta',kind:'system',profile:'Person name'},echo:null};importDecisionHistory(f.state,{entry:historyEntry(project,[automatic])},now);assert.equal(f.state.decisionHistory[1].action,'status');assert.equal(f.state.decisionHistory[1].humanObserved,false);assert.equal(f.state.decisionHistory[1].automatic,true);
});

test('History deduplicates cross-project links by native action and retains both project/actor provenances',()=>{
 const f=fixture();f.state.config.other={projectName:'Other',targetRoas:9};const a=event(),entry=historyEntry(project,[a]);const first=importDecisionHistory(f.state,{entry},now);assert.equal(first.inserted,1);assert.equal(importDecisionHistory(f.state,{entry},now+1).id,first.id);
 const mirrored=event({id:'other-id',adAccountId:'different-internal-account'});const second=importDecisionHistory(f.state,{entry:historyEntry('other',[mirrored])},now);assert.equal(second.inserted,0);assert.equal(second.duplicates,1);assert.equal(f.state.decisionHistory.length,1);assert.deepEqual(f.state.decisionHistory[0].projects,[project,'other']);assert.equal(f.state.decisionHistory[0].originObservations.length,2);assert.equal(f.state.decisionHistory[0].originObservations[1].actor.name,'Other operator');assert.equal(decisionLearningPlan(f.state,'other',now).history.length,1);assert.equal(decisionLearningPlan(f.state,'other',now).referenceCases.length,0);
 const divergent=structuredClone(entry);divergent.events[0].after=200;assert.throws(()=>importDecisionHistory(f.state,{entry:divergent},now),/conteúdo divergente/);assert.equal(f.state.decisionHistory.length,1);
});

test('Echo observations are not independent actions, and invalid/partial imports are atomic',()=>{
 const f=fixture();importDecisionHistory(f.state,{entry:historyEntry(project,[event(),event({id:'echo',actor:{key:'meta-app',name:'App'},source:'meta',echo:true})])},now);assert.equal(f.state.decisionHistory.length,1);assert.equal(f.state.decisionHistoryImports[0].duplicates,1);assert.equal(f.state.decisionHistoryImports[0].observations[1].actor.name,'App');
 const before=structuredClone(f.state);for(const changes of [{complete:false},{pagination:{complete:false,nextCursor:'more'}},{events:[event({id:'new'}),event({id:'bad',field:'bid'})]},{events:[event({id:'badtime',occurredAt:'2026-11-02T03:00:00.000Z'})]}])assert.throws(()=>importDecisionHistory(f.state,{entry:{...historyEntry(project),...changes}},now));assert.deepEqual(f.state,before);
});

test('Other-project history is reference only and never becomes personal preference or config',()=>{
 const f=fixture();f.state.config.other={projectName:'Other',targetRoas:20,dailyCap:999};const cfg=structuredClone(f.state.config);importDecisionHistory(f.state,{entry:historyEntry('other',[event()])},now);const plan=decisionLearningPlan(f.state,project,now);assert.equal(plan.referenceCases.length,1);assert.equal(plan.referenceCases[0].referenceOnly,true);assert.equal(plan.referenceCases[0].financialOutcome,'N/D');assert.equal(plan.preferences.find(x=>x.action==='increase').count,0);assert.equal(plan.maturity.automaticExecutionEnabled,false);assert.deepEqual(f.state.config,cfg);
});

test('Learning exposes sample counts without treating a click as a financial win or sufficient pattern',()=>{
 const f=fixture();choose(f);let p=decisionLearningPlan(f.state,project,now);assert.equal(p.choices.length,1);assert.equal(p.pendingChoices.length,1);assert.equal(p.preferences.find(x=>x.action==='increase').count,1);assert.equal(p.preferences.find(x=>x.action==='increase').medianPercent,null);assert.equal(p.preferences.find(x=>x.action==='increase').confidence,'Insuficiente');assert.equal(p.stats.verifiedOutcomes,0);
 for(let i=0;i<2;i++){f.state.ownerChoices.push({...structuredClone(f.state.ownerChoices[0]),id:'choice-'+i,objectId:'independent-'+i,percent:20+i*10});}p=decisionLearningPlan(f.state,project,now);assert.equal(p.preferences.find(x=>x.action==='increase').medianPercent,30);assert.equal(p.preferences.find(x=>x.action==='increase').independentCampaigns,3);
 f.state.knowledgeOutcomes=[{id:'forged',project,objectId:'meta-campaign',adAccountId:'account',before:{},after:{},sources:[],summary:'Clicked approved; assume profit'}];assert.equal(decisionLearningPlan(f.state,project,now).outcomes[0].verified,false);assert.equal(decisionLearningPlan(f.state,project,now).outcomes[0].classification,'N/D');
});

import {decisionQueue,reopenDecision,reconsiderationPlan} from '../lib/decision-reconsider.mjs';
test('A decision leaves the queue across source refreshes and remains immutable in history',()=>{
 const f=fixture();const chosen=choose(f,{choice:'keep',percent:undefined}),saved=structuredClone(chosen);
 assert.equal(decisionQueue(f.state,project,now).length,0);f.state.snapshots[3].rows[0].spend=120;
 assert.equal(decisionQueue(f.state,project,now+1000).length,0);assert.deepEqual(f.state.ownerChoices[0],saved);
 const reopen=reopenDecision(f.state,{project,choiceId:chosen.id,clientId:'reopen'},'owner',now+2000);
 assert.equal(decisionQueue(f.state,project,now+2000).length,1);assert.equal(f.state.jobs.find(j=>j.id===reopen.jobId).status,'Pendente');
 assert.deepEqual(f.state.ownerChoices[0],saved);assert.equal(reopenDecision(f.state,{project,choiceId:chosen.id,clientId:'reopen'},'owner',now+3000).id,reopen.id);
 assert.equal(f.state.jobs.length,2);assert.equal(reconsiderationPlan(f.state,project)[0].status,'Reavaliação solicitada');
 const c=card(f),next=recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:20,clientId:'changed-mind'},'owner',now+4000);
 assert.equal(next.reconsidersChoiceId,chosen.id);assert.equal(decisionQueue(f.state,project,now+4000).length,0);assert.equal(f.state.ownerChoices.length,2);
 assert.equal(reconsiderationPlan(f.state,project)[0].status,'Nova decisão registrada');
});
test('Reconsidering withdraws an unsent exact authorization, without rewriting sealed scope or owner history',()=>{
 const f=fixture({team:true}),p=proposed(f),c=card(f);
 const choice=recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:50,clientId:'approved',approveExact:true,proposalId:p.id,proposalVersion:p.version,proposalSignature:p.signature},'owner',now);
 const saved=structuredClone(choice),scope=structuredClone(p.payload),signature=p.signature;
 reopenDecision(f.state,{project,choiceId:choice.id,clientId:'withdraw'},'owner',now+1000);
 assert.equal(f.state.proposals[0].status,'Revisão solicitada');assert.equal(f.state.proposals[0].reviews.at(-1).actor,'owner');
 assert.equal(f.state.proposals[0].signature,signature);assert.deepEqual(f.state.proposals[0].payload,scope);assert.deepEqual(f.state.ownerChoices[0],saved);assert.equal(f.state.executions,undefined);
});
test('Ambiguous dispatch blocks re-evaluation atomically; confirmed execution permits fresh analysis, never rollback',()=>{
 const f=fixture({team:true}),p=proposed(f),choice=choose(f);f.state.executions=[{project,proposalId:p.id,status:'Verificação necessária',submittedAt:date(now-1000)}];const before=structuredClone(f.state);
 assert.throws(()=>reopenDecision(f.state,{project,choiceId:choice.id,clientId:'unsafe'},'owner',now),/conferência/);assert.deepEqual(f.state,before);
 f.state.executions[0].status='Confirmada';f.state.executions[0].confirmedAt=date(now);const execution=structuredClone(f.state.executions);
 reopenDecision(f.state,{project,choiceId:choice.id,clientId:'after-confirm'},'owner',now+1000);
 assert.deepEqual(f.state.executions,execution);assert.equal(f.state.proposals[0].status,p.status);assert.equal(f.state.ownerChoices.length,1);
});
test('Re-evaluation rejects foreign decisions and pause without a partial write',()=>{
 const f=fixture(),choice=choose(f);for(const input of [{project:'foreign',choiceId:choice.id,clientId:'foreign'},{project,choiceId:'missing',clientId:'missing'}]){const before=structuredClone(f.state);assert.throws(()=>reopenDecision(f.state,input,'owner',now));assert.deepEqual(f.state,before);}
 f.state.paused=true;const before=structuredClone(f.state);assert.throws(()=>reopenDecision(f.state,{project,choiceId:choice.id,clientId:'paused'},'owner',now),/Retome/);assert.deepEqual(f.state,before);
});

test('Archived proposals cannot hide an unverified dispatch when another collection is pending',()=>{
 const f=fixture(),choice=choose(f);f.state.jobs.unshift({id:'pending',project,status:'Pendente'});
 f.state.executions=[{project,proposalId:'archived',status:'Verificação necessária',submittedAt:date(now-1000)}];
 const before=structuredClone(f.state);assert.throws(()=>reopenDecision(f.state,{project,choiceId:choice.id,clientId:'archived-send'},'owner',now),/conferência/);assert.deepEqual(f.state,before);
 f.state.executions[0].status='Confirmada';assert.throws(()=>reopenDecision(f.state,{project,choiceId:choice.id,clientId:'unproven-confirm'},'owner',now),/conferência/);
});

test('A lost response with another clientId returns the original sealed choice without another preference',()=>{
 const f=fixture(),c=card(f),input={project,cardId:c.id,signature:c.signature,choice:'keep',clientId:'first-response'};
 const first=recordOwnerChoice(f.state,input,'owner',now),before=structuredClone(f.state);
 assert.equal(recordOwnerChoice(f.state,{...input,clientId:'another-tab'},'owner',now+1000).id,first.id);
 assert.deepEqual(f.state,before);assert.equal(decisionQueue(f.state,project,now+1000).length,0);
});
test('A current signature cannot vote again in a decided cycle, even after refresh or from a second instance',()=>{
 const f=fixture(),first=choose(f,{choice:'keep',percent:undefined}),c=card(f),before=structuredClone(f.state);
 for(const choice of ['keep','pause'])assert.throws(()=>recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice,clientId:'second-'+choice},'owner',now+1000),/Rever cenário/);
 assert.deepEqual(f.state,before);assert.equal(f.state.ownerChoices.length,1);
 reopenDecision(f.state,{project,choiceId:first.id,clientId:'explicit-reopen'},'owner',now+2000);
 const reopenedCard=card(f),next=recordOwnerChoice(f.state,{project,cardId:reopenedCard.id,signature:reopenedCard.signature,choice:'keep',clientId:'new-cycle'},'owner',now+3000);
 assert.equal(next.reconsidersChoiceId,first.id);assert.equal(f.state.ownerChoices.length,2);
 const after=card(f),saved=structuredClone(f.state);assert.throws(()=>recordOwnerChoice(f.state,{project,cardId:after.id,signature:after.signature,choice:'keep',clientId:'second-in-reopen'},'owner',now+4000),/Rever cenário/);assert.deepEqual(f.state,saved);
});
test('Equal campaign names in separate accounts remain distinct decisions and metrics',()=>{
 const f=fixture(),a=card(f);for(const s of f.state.snapshots)s.rows.push({...structuredClone(s.rows[0]),adAccountId:'another-account',accountName:'Another account',externalId:'another-campaign',spend:77});
 const cards=buildDecisionCards(f.state,project,now),b=cards.find(c=>c.row.adAccountId==='another-account');
 recordOwnerChoice(f.state,{project,cardId:a.id,signature:cards.find(c=>c.id===a.id).signature,choice:'keep',clientId:'account-one'},'owner',now);
 const remaining=decisionQueue(f.state,project,now);assert.equal(remaining.length,1);assert.equal(remaining[0].id,b.id);assert.equal(remaining[0].windows.today.spend,77);
 recordOwnerChoice(f.state,{project,cardId:b.id,signature:b.signature,choice:'keep',clientId:'account-two'},'owner',now);
 assert.equal(f.state.ownerChoices.length,2);assert.notEqual(f.state.ownerChoices[0].adAccountId,f.state.ownerChoices[1].adAccountId);assert.equal(decisionQueue(f.state,project,now).length,0);
});

function appliedChoice({linked=false,confirm=true}={}){
 const f=fixture({team:true});let choice;
 if(linked)choice=choose(f);
 const proposal=proposed(f),c=card(f);
 if(linked){linkChoiceProposal(f.state,{choiceId:choice.id,proposalId:proposal.id},now);reviewProposal(f.state,{id:proposal.id,version:proposal.version,signature:proposal.signature,decision:'approve',comment:'Exact approval',clientId:'owner-approval'},{kind:'owner',id:'owner'},now);}
 else choice=recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:'increase',percent:50,clientId:'owner-choice',approveExact:true,proposalId:proposal.id,proposalVersion:proposal.version,proposalSignature:proposal.signature},'owner',now);
 const execution=claimExecution(f.state,{proposalId:proposal.id,version:proposal.version,signature:proposal.signature,executionRef:'real-fixture-executor',clientId:'execution'},now);
 const observation=(at,budget)=>({projectId:project,level:'campaign',source:'Malva MCP',complete:true,fetchedAt:date(at),rows:[{...f.row,dailyBudget:budget}]});
 prepareExecution(f.state,{id:execution.id,claimId:execution.claimId,executionRef:execution.executionRef,clientId:'prepare',observation:observation(now,100)},now);
 submitExecution(f.state,{id:execution.id,claimId:execution.claimId,executionRef:execution.executionRef,clientId:'submit'},now+1);
 if(confirm)confirmExecution(f.state,{id:execution.id,executionRef:'real-fixture-verifier',clientId:'confirm',observation:observation(now+2,150)},now+2);
 const saved=structuredClone(choice),round=f.state.collaborationRounds[0];
 for(let i=1;i<=3;i++)f.state.collaborationRounds.unshift({...structuredClone(round),id:'newer-round-'+i,jobId:'newer-job-'+i,status:'Concluída',createdAt:date(now+i*1000)});
 f.state.agents[project].jobId='another-round';
 return {...f,choice,proposal,execution,saved};
}
test('A confirmed choice stays verified after its detailed execution is archived, without rewriting the choice',()=>{
 const f=appliedChoice(),compacted=compactCollaboration(f.state,now+400000),archive=compacted.archives.find(a=>a.payload.proposals.some(p=>p.id===f.proposal.id));
 assert.ok(archive);assert.equal(f.state.proposals.some(p=>p.id===f.proposal.id),false);assert.equal(f.state.executions.length,0);
 const plan=decisionLearningPlan(f.state,project,now+400001),choice=plan.choices[0];assert.equal(choice.executionStatus,'Confirmada');assert.equal(choice.resolution.archiveKey,archive.key);assert.equal(choice.resolution.confirmedAt,f.execution.confirmedAt);assert.equal(choice.resolution.executionId,f.execution.id);
 assert.deepEqual(f.state.ownerChoices[0],f.saved);assert.equal(plan.pendingChoices.length,0);assert.equal(f.state.choiceResolutions.length,1);
 compactCollaboration(f.state,now+400002);assert.equal(f.state.choiceResolutions.length,1);
 assert.equal(readChoiceResolution(f.state,{...f.saved,project:'another'},now+400001),null);assert.equal(readChoiceResolution(f.state,{...f.saved,adAccountId:'another'},now+400001),null);
});
test('A linked intention does not return to pending analysis after confirmed application is archived',()=>{
 const f=appliedChoice({linked:true});assert.equal(decisionLearningPlan(f.state,project,now+3).pendingChoices.length,0);
 compactCollaboration(f.state,now+400000);const plan=decisionLearningPlan(f.state,project,now+400001);
 assert.equal(plan.pendingChoices.length,0);assert.equal(plan.choices[0].executionStatus,'Confirmada');assert.deepEqual(f.state.ownerChoices[0],f.saved);
});
test('A dispatched but unconfirmed choice never receives a confirmed archival receipt',()=>{
 const f=appliedChoice({confirm:false}),compacted=compactCollaboration(f.state,now+400000);
 assert.equal(compacted.archives.some(a=>a.payload.proposals.some(p=>p.id===f.proposal.id)),false);assert.equal(f.state.choiceResolutions,undefined);
 assert.equal(decisionLearningPlan(f.state,project,now+400001).choices[0].executionStatus,'Enviada');
});


test('Disabled accounts cannot receive owner increase choices; containment remains available',()=>{
 const f=fixture({row:{accountStatus:{active:false}}}),card=buildDecisionCards(f.state,project,now)[0];
 assert.equal(card.actionable.increase,false);assert.equal(card.actionable.reduce,true);assert.equal(card.actionable.pause,true);
 const before=structuredClone(f.state);
 assert.throws(()=>recordOwnerChoice(f.state,{project,cardId:card.id,signature:card.signature,choice:'increase',percent:50,clientId:'disabled-increase'},'owner',now),/não permitem/);
 assert.deepEqual(f.state,before);
});


test('Owner can record all four intentions during expired analysis, without authorizing a proposal',()=>{
 for(const action of ['increase','reduce','pause','keep']){
  const f=fixture(),at=now+70*60000,c=buildDecisionCards(f.state,project,at)[0];
  const record=recordOwnerChoice(f.state,{project,cardId:c.id,signature:c.signature,choice:action,...(['increase','reduce'].includes(action)?{percent:30}:{}),clientId:'intent-'+action},'owner',at);
  assert.equal(record.intentOnly,true);assert.equal(record.status,action==='keep'?'Mantido':'Pendente de revisão');assert.equal(record.proposalId,null);
  assert.equal(f.state.executions,undefined);assert.equal(f.state.proposals.length,0);
 }
});
test('Manual intention after an incident leaves exact execution blocked and preserves reference values',()=>{
 for(const action of ['increase','reduce','pause','keep']){
  const f=fixture({row:{level:'campaign'}});recordIncident(f.state,{project,op:'incidentReport',kind:'checkout',status:'Em retomada',note:'Checkout retomado',scope:{accountIds:[],objectIds:[]},clientId:'incident'},'owner',now-1000);
  const c=buildDecisionCards(f.state,project,now)[0];assert.equal(c.monitor.requiresReview,true);assert.equal(c.actionable.keep,false);
  const input={project,cardId:c.id,signature:c.signature,choice:action,...(['increase','reduce'].includes(action)?{percent:20}:{}),clientId:'manual-'+action};
  assert.throws(()=>recordOwnerChoice(f.state,{...input,approveExact:true,clientId:'blocked-approval'},'owner',now));assert.equal(f.state.ownerChoices,undefined);
  const record=recordOwnerChoice(f.state,input,'owner',now);assert.equal(record.intentOnly,true);assert.equal(record.before.dailyBudget,100);assert.equal(record.proposalId,null);assert.equal(f.state.executions,undefined);
 }
});
test('Intentions still reject source replacement, disabled office and duplicate owner decisions',()=>{
 const f=fixture(),c=card(f),input={project,cardId:c.id,signature:c.signature,choice:'keep',clientId:'keep-stale'};
 f.state.paused=true;assert.throws(()=>recordOwnerChoice(f.state,input,'owner',now),/pausado/);assert.equal(f.state.ownerChoices,undefined);
 f.state.paused=false;recordOwnerChoice(f.state,input,'owner',now);
 const next=buildDecisionCards(f.state,project,now)[0];assert.throws(()=>recordOwnerChoice(f.state,{...input,signature:next.signature,clientId:'other'},'owner',now),/já tem uma decisão/);
});
