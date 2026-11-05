import {mockCampaignReadings} from './fixtures/campaign-readings.mjs';
import {authenticateServer} from '../supabase/functions/malva-mcp/server-auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {callRemoteMcp,cloudMalvaClient,unpackMcp} from '../lib/cloud-malva.mjs';
import {cloudNext,cloudDispatch,cloudProposalPayload,failCloudOpinion,createCloudEngine} from '../lib/cloud-engine.mjs';
import {authorizeCloudDispatch} from '../lib/cloud-dispatch-guard.mjs';
import {runCloudAnalyst,cloudFocus,cloudEvidence,compactCloudContext,cloudLearningContext,cloudHistoryContext,cloudAnalysisContext} from '../lib/cloud-analysis.mjs';
import {collectCloudProject,cloudRanges} from '../lib/cloud-collector.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from '../lib/collaboration.mjs';
import {recordKnowledge} from '../lib/knowledge.mjs';
const project='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',internal='33333333-3333-4333-8333-333333333333';
const iso=t=>new Date(t).toISOString();
function fixture(){
 const now=Date.now(),start=Date.parse(iso(now).slice(0,10)+'T00:00:00Z'),row={id:internal,externalId:'123',adAccountId:account,provider:'meta',name:'Sales',accountName:'Example',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',level:'campaign'};
 const job={id:'job',project,status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)};
 const state={config:{[project]:{projectName:'Example'}},jobs:[job],agents:{[project]:{jobId:'job'}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Example',period,level:'campaign',source:'Malva MCP',complete:true,from:iso(start-({today:0,yesterday:1,'3d':3,'7d':7}[period])*86400000),to:iso(start+(period==='today'?86400000:0)),timezone:'UTC',fetchedAt:iso(now-1000),lastSyncAt:null,rows:[structuredClone(row)]}))};
 const round=ensureCollaboration(state,job),refs=[{period:'today',level:'campaign',adAccountId:account,externalId:'123',fetchedAt:iso(now-1000)}];let ops;
 for(const role of ['traffic','creative','budget','ops']){const c=claimCollaboration(state,{roundId:round.id,agentId:role,executionRef:'model-'+role,clientId:'claim-'+role});if(role==='ops')ops=c;else postCollaboration(state,{roundId:round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'opinion-'+role,toAgent:'ops',kind:'conclusion',text:'Actual test opinion',evidenceRefs:refs});}
 const payload=cloudProposalPayload({action:'reduce',percent:20,reason:'Repeated acquisition deterioration'},row,refs,round.stages.slice(0,3).map(x=>x.conclusionId));
 const p=submitProposal(state,{roundId:round.id,claimId:ops.claimId,executionRef:ops.executionRef,clientId:'proposal',payload,expiresAt:iso(now+600000)});
 for(const role of ['budget','traffic']){const c=claimCollaboration(state,{roundId:round.id,agentId:role,proposalId:p.id,executionRef:'peer-'+role,clientId:'peer-'+role});reviewProposal(state,{id:p.id,version:p.version,signature:p.signature,decision:'approve',comment:'Actual peer test',clientId:'review-'+role,claimId:c.claimId,executionRef:c.executionRef},{kind:'agent',agentId:role});}
 reviewProposal(state,{id:p.id,version:p.version,signature:p.signature,decision:'approve',comment:'Exact scope',clientId:'owner'},{kind:'owner',id:'owner-test'});
 return {state,p,row};
}
function memory(f,loseSubmit=false){let state=f.state;return {get state(){return state;},write:async fn=>{const draft=structuredClone(state),r=await fn(draft,1);state=draft;if(loseSubmit&&r?.dispatchGranted===true)throw Error('lost response');return r;}};}
test('cloud dispatch uses the exact prepared command once, then real readback confirms',async()=>{
 const f=fixture(),store=memory(f);let calls=0;const source={dispatch:async(command,proof)=>{calls++;const a=authorizeCloudDispatch(store.state,{tool:command.tool,args:command.arguments,execution:proof});assert.equal(a.command.arguments.dailyBudget,80);}};
 const out=await cloudDispatch({write:store.write,source,prepareGuard:async()=>{},proposal:f.p,executionRef:'cloud-run',readObservation:async()=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:iso(Date.now()),rows:[{...f.row,dailyBudget:calls?80:100}]})});
 assert.equal(calls,1);assert.equal(out.status,'confirmed');assert.equal(store.state.executions[0].status,'Confirmada');
 await assert.rejects(cloudDispatch({write:store.write,source,prepareGuard:async()=>{},proposal:f.p,executionRef:'cloud-retry',readObservation:async()=>{throw Error();}}));assert.equal(calls,1);
});
test('a lost submit response grants no provider call, even though the submitted journal persisted',async()=>{
 const f=fixture(),store=memory(f,true);let calls=0;await assert.rejects(cloudDispatch({write:store.write,source:{dispatch:async()=>{calls++;}},prepareGuard:async()=>{},proposal:f.p,executionRef:'cloud-run',readObservation:async()=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:iso(Date.now()),rows:[f.row]})}));assert.equal(calls,0);assert.equal(store.state.executions[0].status,'Enviada');assert.equal(cloudNext(store.state).kind,'verify');
});
test('timeout after dispatch is verification-only and cannot dispatch again',async()=>{
 const f=fixture(),store=memory(f);let calls=0;const args={write:store.write,source:{dispatch:async()=>{calls++;throw Error('timeout');}},prepareGuard:async()=>{},proposal:f.p,executionRef:'cloud-run',readObservation:async()=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:iso(Date.now()),rows:[f.row]})};
 assert.equal((await cloudDispatch(args)).status,'verificationOnly');assert.equal(store.state.executions[0].status,'Verificação necessária');await assert.rejects(cloudDispatch(args));assert.equal(calls,1);
});
test('server bridge refuses forged version, currency, amount, unapproved and paused states',async()=>{
 const f=fixture(),store=memory(f);let state,input;
 await cloudDispatch({write:store.write,source:{dispatch:async(c,e)=>{state=structuredClone(store.state);input={tool:c.tool,args:c.arguments,execution:e};throw Error('stop');}},prepareGuard:async()=>{},proposal:f.p,executionRef:'cloud-run',readObservation:async()=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:iso(Date.now()),rows:[f.row]})});
 for(const mutate of [s=>s.paused=true,s=>s.proposals[0].approvedVersion=99,s=>s.proposals[0].status='Aguardando aprovação',s=>s.executions[0].currency='BRL',s=>s.executions[0].command.arguments.dailyBudget=900]){const s=structuredClone(state);mutate(s);assert.throws(()=>authorizeCloudDispatch(s,input));}
 const bad=structuredClone(input);bad.args.dailyBudget=999;assert.throws(()=>authorizeCloudDispatch(state,bad));
});
test('cloud reads cannot call write tools or arbitrary URLs; SSE and JSON tool results are supported',async()=>{
 const client=cloudMalvaClient({rpc:async()=>{throw Error('must not call');}});await assert.rejects(client.read('tracking_set_ad_budget',{}),e=>e.code==='MCP_TOOL_NOT_ALLOWED');
 for(const sse of [false,true]){let sent;const out=await callRemoteMcp({key:'mck_test',tool:'workspace_whoami',fetch:async(url,r)=>{sent={url,r};const j={jsonrpc:'2.0',id:'1',result:{structuredContent:{workspace:{id:'fixture'}}}};return new Response(sse?'data: '+JSON.stringify(j)+'\n\n':JSON.stringify(j));}});assert.equal(sent.url,'https://malvadash.com/api/mcp');assert.equal(sent.r.redirect,'error');assert.equal(out.workspace.id,'fixture');}
});
test('model outputs are scoped and a malformed response cannot become an opinion or tool call',async()=>{
 const context={campaigns:[{target:{adAccountId:account,externalId:'123'}}]},valid={decision:'Observar',reason:'Histórico insuficiente',nextStep:'Comparar novas vendas',text:'Não houve evidência suficiente para um novo corte.',suggestions:[],question:null};assert.equal((await runCloudAnalyst({run:async()=>({response:JSON.stringify(valid)})},'traffic',context)).decision,'Observar');
 for(const value of ['not-json',JSON.stringify({...valid,suggestions:[{adAccountId:'other',objectId:'123',action:'reduce',percent:20,reason:'invalid'}]})])await assert.rejects(runCloudAnalyst({run:async()=>({response:value})},'ops',context));
});
test('a paused central admits no collection and cannot inherit a due slot',()=>{assert.equal(cloudNext({config:{[project]:{projectName:'Example'}},paused:true,jobs:[],snapshots:[]}),null);});
test('full collector validates identities and produces twelve independent source windows without summing overlaps',async()=>{
 const now=Date.now(),p={id:project,name:'Example',timezone:'UTC',currency:'BRL'},ranges=cloudRanges(now,'UTC');let calls=0;
 const source={read:async(tool,a)=>{if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta'}]};calls++;return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now),lastSyncAt:null,period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to+'T00:00:00Z')+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]},rows:[{id:internal,projectId:project,projectName:'Example',externalId:'123',adAccountId:account,accountName:'Test',name:'Example',level:a.level,provider:'meta',spend:100,campaignExternalId:a.level==='campaign'?null:'123'}]};}};
 const out=await collectCloudProject(source,p,{now:()=>now,startedAt:iso(now-1000)});assert.equal(out.snapshots.length,12);assert.equal(out.snapshots.find(s=>s.period==='today'&&s.level==='campaign').analysisScope.kind,'meta-operating-cohort');assert.equal(out.snapshots.find(s=>s.period==='7d').from,ranges['7d'].from+'T00:00:00.000Z');
 const bad={read:async(tool,a)=>tool==='tracking_ad_accounts'?{items:[]}: {...await source.read(tool,a),truncated:{shown:1,total:2}}};await assert.rejects(collectCloudProject(bad,p,{now:()=>now}),e=>e.code==='SOURCE_INCOMPLETE');
});

test('a project with only paused or warmup rows still has real evidence for a no-action conclusion',()=>{
 const f=fixture();assert.equal(cloudFocus(f.state,project).length,0);const refs=cloudEvidence(f.state,project,[]);assert.equal(refs.length,4);assert.ok(refs.every(r=>r.externalId==='123'&&r.adAccountId===account));
});
test('pausing during preparation prevents submit and provider dispatch',async()=>{
 const f=fixture(),store=memory(f);let checks=0,calls=0;await assert.rejects(cloudDispatch({write:store.write,source:{dispatch:async()=>{calls++;}},prepareGuard:async()=>{if(++checks===2)throw Error('CLOUD_EXECUTOR_PAUSED');},proposal:f.p,executionRef:'cloud-pause',readObservation:async()=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:iso(Date.now()),rows:[f.row]})}));assert.equal(calls,0);assert.notEqual(store.state.executions[0].status,'Enviada');
});

test('MCP edge auth accepts injected server keys and rejects users, public keys and arbitrary credentials',async()=>{
 const env={service:'server-fixture',secretKeys:JSON.stringify({default:'sb_secret_fixture'})};
 assert.equal(await authenticateServer(new Request('https://example.test',{headers:{Authorization:'Bearer server-fixture'}}),env),true);
 assert.equal(await authenticateServer(new Request('https://example.test',{headers:{apikey:'sb_secret_fixture'}}),env),true);
 for(const key of ['user-jwt','sb_publishable_fixture','sb_secret_forged',''])assert.equal(await authenticateServer(new Request('https://example.test',{headers:{apikey:key}}),env),false);
 assert.equal(await authenticateServer(new Request('https://example.test',{headers:{apikey:'sb_secret_fixture'}}),{...env,secretKeys:'invalid-json'}),false);
});

test('structured cloud generation forbids targets with no candidates and uses exact current ID enums',async()=>{
 const value={decision:'Observar',reason:'Sem candidatos',nextStep:'Aguardar',text:'Sem campanha elegível neste recorte.',suggestions:[],question:null};
 for(const role of ['traffic','ops']){let request;await runCloudAnalyst({run:async(_model,r)=>{request=r;return {response:value};}},role,{campaigns:[]});assert.equal(request.response_format.type,'json_schema');assert.equal(request.response_format.json_schema.properties.suggestions.maxItems,0);}
 let req;await runCloudAnalyst({run:async(_m,r)=>{req=r;return {response:value};}},'ops',{campaigns:[{target:{adAccountId:account,externalId:'123'}}]});assert.deepEqual(req.response_format.json_schema.properties.suggestions.items.properties.objectId.enum,['123']);
});
test('generation failure releases only its own claim, preserves attempt evidence and never records a conclusion',()=>{
 const f=fixture(),round=f.state.collaborationRounds[0],stage=round.stages[3],args={roundId:round.id,agentId:stage.agentId,claimId:stage.claimId,executionRef:stage.executionRef};
 assert.throws(()=>failCloudOpinion(f.state,{...args,executionRef:'other'},'CLOUD_AI_SCOPE'));
 failCloudOpinion(f.state,args,'CLOUD_AI_SCOPE');assert.equal(stage.status,'Falhou');assert.equal(f.state.cloudAttemptFailures[stage.claimId].attempt,stage.attempt);assert.equal(stage.conclusionId,undefined);
});

test('large model packets preserve numbers and mark reduced hierarchy and deferred campaign coverage',()=>{
 const campaigns=Array.from({length:6},(_,i)=>({target:{adAccountId:account,externalId:String(i)},windows:{today:{spend:100+i}},hierarchy:[{total:4,rows:Array.from({length:4},()=>({spend:123,name:'x'.repeat(600)}))}]}));
 const input={campaigns,coverage:{individuallyPrioritized:6},priorOpinions:[],research:{details:campaigns.map(c=>({adAccountId:account,externalId:c.target.externalId,detail:'x'.repeat(1600)}))}};
 const out=compactCloudContext(input,6000);assert.ok(JSON.stringify(out).length<=6000);assert.equal(out.coverage.contextCompacted,true);assert.equal(out.campaigns[0].windows.today.spend,100);assert.ok(out.campaigns[0].hierarchy[0].omittedRows>0);assert.ok(out.coverage.deferredPrioritized>0);assert.equal(input.campaigns.length,6);
});

test('model context omits repeated audit payloads while retaining current knowledge and edit evidence',()=>{
 const input={campaigns:[{target:{adAccountId:account,externalId:'123'},windows:{today:{spend:321}},hierarchy:[]}],learning:[{id:'learning',claim:'Do not repeat an increase from the same acquisition',confidence:0.4,status:'Hipótese',sources:[{reference:'source',observedAt:iso(Date.now())}],supportCases:[{objectId:'123',reference:'source'}],revisions:Array.from({length:30},()=>({claim:'x'.repeat(5000)}))}],incidents:[{id:'incident',status:'Em retomada',note:'Checkout restored; compare new acquisition',scope:{objectIds:[{adAccountId:account,objectId:'123'}]},reportedAt:iso(Date.now()),history:[{note:'x'.repeat(10000)}]}],research:{details:[{adAccountId:account,externalId:'123',history:{items:[{at:iso(Date.now()),eventType:'budget',actor:{name:'Manager'},values:{before:100,after:80},raw:{duplicate:'x'.repeat(10000)},echo:{duplicate:'x'.repeat(10000)}}],truncated:true}}]}};
 const out=compactCloudContext(input,5000);
 assert.ok(new TextEncoder().encode(JSON.stringify(out)).length<=5000);
 assert.equal(out.learning[0].claim,input.learning[0].claim);assert.equal(out.learning[0].confidence,0.4);assert.deepEqual(out.learning[0].sources,input.learning[0].sources);assert.deepEqual(out.learning[0].supportCases,input.learning[0].supportCases);assert.equal(out.learning[0].omittedRevisions,30);
 assert.equal(out.incidents[0].status,'Em retomada');assert.deepEqual(out.incidents[0].scope,input.incidents[0].scope);assert.equal(out.incidents[0].omittedHistoryEntries,1);
 assert.deepEqual(out.research.details[0].history.items[0].values,{before:100,after:80});assert.deepEqual(out.research.details[0].history.items[0].omittedFields,['raw','echo']);assert.equal(out.research.details[0].history.truncated,true);
 assert.equal(input.learning[0].revisions.length,30);assert.ok(input.research.details[0].history.items[0].raw);
});

test('default model packet reserves token headroom and declares deferred advisory learning',()=>{
 const input={campaigns:[{target:{adAccountId:account,externalId:'123'},windows:{today:{spend:321}},hierarchy:[]}],learning:Array.from({length:5},(_,i)=>({id:'learning-'+i,claim:'x'.repeat(6000),sources:[{reference:'source-'+i}]})),research:{details:[{adAccountId:account,externalId:'123',detail:'x'.repeat(20000)}]}};
 const out=compactCloudContext(input);assert.ok(new TextEncoder().encode(JSON.stringify(out)).length<=40000);assert.equal(out.campaigns[0].windows.today.spend,321);assert.ok(out.coverage.deferredLearningIds.length>0);assert.equal(out.learning.at(-1).id,'learning-4');assert.equal(input.learning.length,5);
});

test('today cohort reads active and spent plus exact tracked paused objects, not the dormant archive',async()=>{
 const now=Date.now(),p={id:project,name:'Example',timezone:'UTC',currency:'BRL'},ranges=cloudRanges(now,'UTC'),pausedId='44444444-4444-4444-8444-444444444444';
 const active={id:internal,externalId:'123',adAccountId:account,accountName:'Test',projectId:project,projectName:'Example',name:'Active',level:'campaign',provider:'meta',status:'ACTIVE',spend:5};
 const paused={...active,id:pausedId,externalId:'456',status:'PAUSED',spend:0};let details=0;
 const source={read:async(tool,a)=>{if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta'}]};if(tool==='tracking_ad_detail'){details++;assert.equal(a.objectId,pausedId);return {row:paused,currency:'BRL',period:{timezone:'UTC'}};}assert.ok(['active','spent'].includes(a.status)||a.status==='all'&&a.accountIds?.[0]===account);return {level:'campaign',salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now),lastSyncAt:null,period:{timezone:'UTC',from:ranges.today.from+'T00:00:00.000Z',to:iso(Date.parse(ranges.today.to+'T00:00:00Z')+86400000),days:[ranges.today.from]},rows:[active]};}};
 const out=await collectCloudProject(source,p,{now:()=>now,levels:['campaign'],periodsWanted:['today'],purpose:'live',tracked:[paused]});assert.equal(details,1);assert.equal(out.snapshots[0].rows.length,2);assert.equal(out.snapshots[0].coverage.trackedComplete,true);assert.equal(out.snapshots[0].rows.find(r=>r.externalId==='456').status,'PAUSED');
});

test('cloud perspectives and synthesis complete a real domain round without manufacturing owner approvals',async()=>{
 const f=fixture();f.state.collaborationRounds=[];f.state.collaborationMessages=[];f.state.proposals=[];f.state.executions=[];
 for(const cut of f.state.snapshots)for(const r of cut.rows){r.spend=100;r.revenueNet=200;r.frontOrders=2;}
 const round=ensureCollaboration(f.state,f.state.jobs[0]),store=memory(f);let generations=0;
 const ai={run:async(_m,request)=>{generations++;const {context:c,reflectionRequirements:r}=JSON.parse(request.messages[1].content);return {response:{campaignReadings:mockCampaignReadings(c),decision:'Manter',reason:'Aguardar aquisição nova',nextStep:'Conferir evolução',text:'Uma campanha priorizada; os demais objetos não receberam leitura individual.',reflection:{lesson:'Conferir aquisição nova',uncertainty:'Efeito ainda não medido',nextCheck:'Comparar período fechado',citations:r.examples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'inconclusive',reason:'Efeito ainda não medido.'}))},suggestions:[],question:null}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{},ai,ops:{}});
 for(let i=0;i<4;i++){const result=await engine.step();assert.equal(result.kind,'stage');}
 assert.equal(generations,4);assert.equal(store.state.collaborationRounds.find(r=>r.id===round.id).status,'Concluída');assert.equal(store.state.collaborationMessages.filter(m=>m.kind==='conclusion').length,4);assert.equal(store.state.proposals.length,0);assert.equal(store.state.executions.length,0);
 assert.equal(new Set(store.state.collaborationMessages.filter(m=>m.kind==='conclusion').map(m=>m.executionRef)).size,4);
});

for(const changeDuringSynthesis of [false,true])test(changeDuringSynthesis?'a hypothesis revision during synthesis rolls back suggestion and proposal and releases the claim':'cloud synthesis enrolls its explicit hypothesis before approval without dispatching',async()=>{
 const f=fixture();f.state.collaborationRounds=[];f.state.collaborationMessages=[];f.state.proposals=[];f.state.executions=[];
 for(const cut of f.state.snapshots)for(const r of cut.rows){r.spend=100;r.revenueNet=150;r.frontOrders=2;r.adCosts=0;r.productCost=0;r.saleTax=0;}
 const stamp=iso(Date.now()-3000),k=recordKnowledge(f.state,{project,topic:'Conter perda contextual',claim:'Hipótese para comparar aquisição e exposição após redução.',confidence:0.3,sources:[{system:'Malva MCP',reference:'prior-observation',observedAt:stamp,summary:'Hipótese anterior à proposta.'}]},stamp);
 ensureCollaboration(f.state,f.state.jobs[0]);const store=memory(f);let calls=0,dispatch=0;
 const ai={run:async(_m,request)=>{calls++;const {context:c,reflectionRequirements:r}=JSON.parse(request.messages[1].content);if(changeDuringSynthesis&&c.role==='ops')await store.write(st=>recordKnowledge(st,{...k,id:k.id,expectedRevision:1,claim:'Hipótese alterada durante a síntese.'},iso(Date.now())));return {response:{campaignReadings:mockCampaignReadings(c),decision:'Conter com aprovação',reason:'Investigar perda nova',nextStep:'Aguardar revisão e aprovação',text:'Sugestão restrita à campanha priorizada, sem aplicação.',suggestions:c.role==='ops'?[{adAccountId:account,objectId:'123',action:'reduce',percent:20,reason:'Comparar aquisição depois de conter exposição.',learning:{knowledgeId:k.id,knowledgeRevision:1,reason:'Testar a hipótese de contenção no mesmo projeto.'}}]:[],question:null,reflection:{lesson:'Conferir aquisição nova.',uncertainty:'Sem efeito causal demonstrado.',nextCheck:'Comparar dias fechados.',citations:r.examples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'support',reason:'Fonte e escopo conferidos.'}))}}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{dispatch:async()=>{dispatch++;}},ai,ops:{}});
 for(let i=0;i<3;i++)assert.equal((await engine.step()).kind,'stage');
 if(changeDuringSynthesis){await assert.rejects(engine.step(),e=>e.code==='CLOUD_LEARNING_ENROLLMENT_HYPOTHESIS');assert.equal(store.state.proposals.length,0);assert.equal(store.state.cardSuggestions?.length||0,0);assert.equal(store.state.learningEnrollments,undefined);assert.equal(store.state.collaborationRounds[0].stages[3].status,'Falhou');assert.equal(dispatch,0);return;}
 assert.equal((await engine.step()).kind,'stage');
 assert.equal(calls,4);assert.equal(dispatch,0);assert.equal(store.state.proposals.length,1);const p=store.state.proposals[0];assert.equal(p.status,'Em revisão');assert.equal(p.payload.currency,'USD');assert.equal(p.payload.before.dailyBudget,100);assert.equal(p.payload.after.dailyBudget,80);assert.equal(p.approvedVersion,undefined);assert.equal(store.state.executions.length,0);assert.equal(store.state.learningEnrollments.length,1);assert.equal(store.state.learningEnrollments[0].proposalSignature,p.signature);assert.equal(store.state.learningEnrollments[0].knowledgeId,k.id);
});

test('cloud scheduling finishes a partially completed round before starting a newer one',()=>{
 const f=fixture();f.state.proposals=[];f.state.executions=[];const existing=f.state.collaborationRounds[0];existing.stages[3]={agentId:'ops',status:'Pendente',attempt:0};
 const newer=structuredClone(existing);newer.id='newer-round';newer.createdAt=iso(Date.now());newer.stages=['traffic','creative','budget','ops'].map(agentId=>({agentId,status:'Pendente',attempt:0}));
 f.state.collaborationRounds.unshift(newer);assert.equal(cloudNext(f.state).roundId,existing.id);
});

test('visual cache coverage stays rejected; analytic operative scope requires all twelve independent cuts',async()=>{
 const {validateAnalysisBundle}=await import('../lib/analysis-validation.mjs');const f=fixture();const sources=f.state.snapshots.flatMap(s=>['campaign','adset','ad'].map(level=>({...s,level,rows:[]})));const today=sources.find(s=>s.period==='today'&&s.level==='campaign');today.analysisScope={kind:'meta-operating-cohort',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:0,inactiveArchiveExcluded:true,parentCampaignCount:null};
 assert.equal(validateAnalysisBundle({snapshots:sources},{snapshots:[]}).snapshots.length,12);assert.throws(()=>validateAnalysisBundle({snapshots:[today]},{snapshots:[]}));
 today.coverage={kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:0};assert.throws(()=>validateAnalysisBundle({snapshots:sources},{snapshots:[]}),/acompanhamento/);
});

test('vendor refusal diagnostics preserve only safe status/code metadata, never response content',()=>{
 assert.throws(()=>unpackMcp({isError:true,structuredContent:{status:404,code:'NOT_FOUND',message:'private response body'}}),e=>e.code==='MCP_TOOL_FAILED'&&e.providerStatus===404&&e.providerCode==='NOT_FOUND'&&!e.message.includes('private'));
 for(const isError of [false,true])assert.throws(()=>unpackMcp({isError,structuredContent:{error:{status:400,code:'INVALID_ARGUMENT',message:'Too long: private data omitted',fields:{q:['private name'],privateClientField:['private value']}}}}),e=>e.providerStatus===400&&e.providerCode==='INVALID_ARGUMENT'&&e.providerCategory==='input-limit'&&JSON.stringify(e.providerFields)==='["q"]'&&!JSON.stringify(e).includes('private'));
 assert.throws(()=>unpackMcp({isError:true,content:[{type:'text',text:'Request timed out with private-name and mck_fixture'}]}),e=>e.providerCategory==='timeout'&&!JSON.stringify(e).includes('private-name')&&!JSON.stringify(e).includes('mck_fixture'));
});

test('learning packets preserve current claims and locators while bounding repeated source/case journals',()=>{
 const entry={id:'learning',project,claim:'An isolated sale does not require keeping an unprofitable test',status:'Hipótese',confidence:0.5,revision:3,updatedAt:iso(Date.now()),sources:Array.from({length:12},(_,i)=>({system:'Bunker',reference:'source-'+i,observedAt:iso(Date.now()),summary:'x'.repeat(800)})),supportCases:Array.from({length:40},(_,i)=>({objectId:String(i),reference:'source-'+(i%12)})),revisions:Array.from({length:30},()=>({claim:'x'.repeat(1600)}))};
 const before=structuredClone(entry),out=cloudLearningContext([entry])[0];
 assert.equal(out.claim,entry.claim);assert.equal(out.status,'Hipótese');assert.equal(out.sources.length,3);assert.equal(out.omittedSources,9);assert.equal(out.omittedRevisions,30);assert.equal(out.omittedSupportCases,40-out.supportCases.length);assert.ok(out.supportCases.every(c=>out.sources.some(s=>s.reference===c.reference)));assert.deepEqual(entry,before);
});

test('edit context retains the latest budget/creative evidence despite status noise and declares omitted events',()=>{
 const items=Array.from({length:20},(_,i)=>({id:'event-'+i,at:iso(Date.now()-i*60000),category:i===15?'budget':i===18?'creative':'status',values:i===15?{kind:'money',field:'daily_budget',currency:'USD',from:100,to:150}:{kind:'status',from:'processing',to:'active'},actor:{name:'Manager',kind:'human',profile:'x'.repeat(2000)},object:{level:'campaign',externalId:'123',objectId:internal,name:'Campaign'},raw:{duplicate:'x'.repeat(4000)}}));
 const history={items,nextCursor:'cursor',truncated:true},out=cloudHistoryContext(history);
 assert.ok(out.items.length<=8);assert.ok(out.items.some(e=>e.id==='event-15'&&e.values.currency==='USD'&&e.values.to===150));assert.ok(out.items.some(e=>e.id==='event-18'));assert.equal(out.availableItemCount,20);assert.equal(out.omittedItemCount,20-out.items.length);assert.equal(out.hasNextPage,true);assert.equal(out.truncated,true);assert.equal(out.items[0].actor.name,'Manager');assert.ok(out.items.every(e=>!e.raw));assert.ok(history.items[0].raw);
});

test('a rejected AI context can shrink once, with new target enums and actual coverage; financial calls do not exist here',async()=>{
 const input={campaigns:[0,1].map(i=>({target:{adAccountId:account,externalId:String(i)},hierarchy:[],windows:{today:{spend:100}}})),research:{details:[0,1].map(i=>({adAccountId:account,externalId:String(i),detail:'x'.repeat(15000)}))},coverage:{individuallyPrioritized:2}};
 const requests=[],value={decision:'Investigar',reason:'Sem aquisição nova',nextStep:'Conferir edições',text:'Somente uma campanha na amostra reduzida.',suggestions:[],question:null};
 const result=await runCloudAnalyst({run:async(_m,r)=>{requests.push(r);if(requests.length===1)throw Error("This model's maximum context length is 24000 tokens");return {response:value};}},'ops',input);
 assert.equal(requests.length,2);assert.equal(result.analysisTargets.length,1);assert.deepEqual(requests[1].response_format.json_schema.properties.suggestions.items.properties.objectId.enum,['0']);assert.equal(JSON.parse(requests[1].messages[1].content).context.coverage.deferredPrioritized,1);assert.equal(input.campaigns.length,2);
 let calls=0;await assert.rejects(runCloudAnalyst({run:async()=>{calls++;throw Error('Unavailable');}},'ops',input));assert.equal(calls,1);
});

test('model context includes only local learning and the revised pause/reduce reasoning without inventing front counts',async()=>{
 const f=fixture(),round=f.state.collaborationRounds[0];f.state.knowledge=[{id:'foreign',project:'other',claim:'foreign threshold'}, {id:'local',project,claim:'Owner prefers pause in this loss scenario',updatedAt:iso(Date.now()),sources:[],supportCases:[]}];
 const context=cloudAnalysisContext(f.state,round,[f.row],'traffic');assert.equal(context.learning.length,1);assert.equal(context.learning[0].id,'local');assert.equal(context.campaigns[0].windows.today.calculated.frontOrders,null);
 let req;await runCloudAnalyst({run:async(_m,r)=>{req=r;const needs=JSON.parse(r.messages[1].content).reflectionRequirements;return {response:{decision:'Investigar',reason:'Dados insuficientes',nextStep:'Conferir entrega',text:'A preferência não é uma execução.',reflection:{lesson:'Preferência não prova lucro',uncertainty:'Sem front conhecido',nextCheck:'Conferir dados ausentes',citations:needs.examples.slice(0,1),peerChecks:needs.requiredPeerRoles.map(role=>({messageId:needs.peerConclusions.find(p=>p.role===role).messageId,stance:'inconclusive',reason:'Sem dado novo após edição.'}))},suggestions:[],question:null}};}},'traffic',context);
 assert.match(req.messages[0].content,/uma venda isolada não obriga manter/i);assert.match(req.messages[0].content,/config.testHours/);assert.match(req.messages[0].content,/Omissões.*lacunas/);
});

test('research collection reads daily history and today separately and retains an older budget amid status noise',async()=>{
 const f=fixture();f.state.jobs[0].status='Em análise';f.state.jobs[0].executor='cloudflare';f.state.collaborationRounds=[];f.state.proposals=[];f.state.executions=[];f.state.snapshots=[];
 const store=memory(f),now=Date.now(),ranges=cloudRanges(now,'UTC'),detailPresets=[];
 const r={...f.row,projectId:project,projectName:'Example',spend:100,frontOrders:0};
 const source={read:async(tool,a)=>{
  if(tool==='workspace_whoami')return {workspace:{id:'workspace'},platforms:[{platform:'tracking',read:true}]};
  if(tool==='tracking_list_projects')return {items:[{id:project,name:'Example',timezone:'UTC',currency:'BRL'}]};
  if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta'}]};
  if(tool==='tracking_campaigns')return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now),lastSyncAt:null,period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to+'T00:00:00Z')+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]},rows:[{...r,level:a.level,campaignExternalId:a.level==='campaign'?null:'123'}]};
  if(tool==='tracking_ad_changes')return {timezone:'UTC',period:{from:null,to:null,timezone:'UTC'},items:Array.from({length:50},(_,i)=>({id:String(i),source:'meta',object:{level:'campaign',externalId:'123',name:'Sales'},account:{id:account,accountId:'native',provider:'meta',currency:'USD'},category:i===40?'budget':'status',at:iso(now-(i+1)*1000),values:{kind:'money',field:'daily_budget',from:100,to:150}})),nextCursor:null};
  if(tool==='tracking_ad_detail'){detailPresets.push(a.preset);return {row:r,currency:'BRL',daily:[],period:{timezone:'UTC',from:ranges.today.from+'T00:00:00Z',to:iso(Date.parse(ranges.today.to+'T00:00:00Z')+86400000),days:a.preset==='today'?[ranges.today.from]:['previous',ranges.today.from]},hourly:[{hour:1,spend:10,orders:0}]};}
  throw Error('Unexpected tool');
 }};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source,now:()=>now,ops:{liveItems:async()=>[],importBundle:(s,b)=>{s.snapshots=b.snapshots;},updateRun:(_s,j,status)=>{j.status=status;}}});
 const result=await engine.step();assert.equal(result.kind,'collection');assert.deepEqual(detailPresets,['14d','today']);const research=store.state.cloudResearch[project].details[0];assert.equal(research.detail.intraday.period.days.length,1);assert.equal(research.detail.period.days.length,2);assert.ok(research.history.items.some(e=>e.category==='budget'));assert.equal(research.history.returnedCount,50);assert.equal(research.history.truncated,true);
});

test('large parent cohorts are partitioned before MCP validation, with complete unique child coverage',async()=>{
 const now=Date.now(),p={id:project,name:'Example',timezone:'UTC',currency:'BRL'},ranges=cloudRanges(now,'UTC'),parents=Array.from({length:60},(_,i)=>({id:crypto.randomUUID(),externalId:String(1000+i),projectId:project,projectName:'Example',adAccountId:account,accountName:'Test',level:'campaign',provider:'meta',name:'Campaign '+i,status:'ACTIVE',spend:10})),sizes=[];
 const source={read:async(tool,a)=>{
  if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta'}]};
  if(a.campaignIds){sizes.push(a.campaignIds.length);if(a.campaignIds.length>25)throw Error('Parent filter rejected');}
  const selected=parents.filter(r=>!a.campaignIds||a.campaignIds.includes(r.externalId));
  const all=a.level==='campaign'?selected:selected.flatMap(r=>Array.from({length:a.level==='adset'?3:5},(_,i)=>({...r,level:a.level,externalId:r.externalId+'-'+i,campaignExternalId:r.externalId})));
  return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now),lastSyncAt:null,period:{timezone:'UTC',from:ranges.today.from+'T00:00:00Z',to:iso(Date.parse(ranges.today.to+'T00:00:00Z')+86400000),days:[ranges.today.from]},rows:all.slice(0,a.limit),truncated:all.length>a.limit?{shown:a.limit,total:all.length}:false};
 }};
 const result=await collectCloudProject(source,p,{now:()=>now,periodsWanted:['today']});assert.deepEqual(result.snapshots.map(s=>s.rows.length),[60,180,300]);assert.ok(sizes.every(n=>n<=25));assert.ok(sizes.some(n=>n<25),'Truncated chunks must be refined.');assert.equal(new Set(result.snapshots[2].rows.map(r=>r.externalId)).size,300);
 const foreign={read:async(tool,a)=>{const response=await source.read(tool,a);if(a.campaignIds&&response.rows.length)response.rows[0]={...response.rows[0],campaignExternalId:'foreign-parent'};return response;}};
 await assert.rejects(collectCloudProject(foreign,p,{now:()=>now,periodsWanted:['today']}),e=>e.code==='SOURCE_IDENTITY');
 const inconsistent={read:async(tool,a)=>{const response=await source.read(tool,a);if(a.level==='ad'&&a.campaignIds?.length===25&&response.truncated)response.truncated.total++;return response;}};
 await assert.rejects(collectCloudProject(inconsistent,p,{now:()=>now,periodsWanted:['today']}),e=>e.code==='SOURCE_INCOMPLETE');
});

test('each real role receives a distinct verification task and peer review cannot impersonate owner approval',async()=>{
 const systems={};for(const role of ['traffic','creative','budget','ops'])await runCloudAnalyst({run:async(_m,r)=>{systems[role]=r.messages[0].content;return {response:{decision:'Investigar',reason:'Sem dados suficientes',nextStep:'Conferir origem',text:'Sem alvo elegível neste recorte.',suggestions:[],question:null}};}},role,{campaigns:[]});
 assert.match(systems.traffic,/TRÁFEGO:.*aquisição front/);assert.match(systems.creative,/CRIATIVOS:.*conjuntos\/anúncios/);assert.match(systems.budget,/ORÇAMENTO:.*moeda nativos/);assert.match(systems.budget,/não é aprovação do dono/);assert.match(systems.ops,/textos genéricos não substitui/);assert.equal(new Set(Object.values(systems)).size,4);
});

test('A rejected numeric reading teaches only the same role and round; a corrected retry earns one contribution',async()=>{
 const f=fixture();f.state.collaborationRounds=[];f.state.collaborationMessages=[];f.state.proposals=[];f.state.executions=[];
 for(const cut of f.state.snapshots)for(const r of cut.rows){r.spend=100;r.revenueNet=200;r.frontOrders=2;}
 const round=ensureCollaboration(f.state,f.state.jobs[0]),store=memory(f);let calls=0;const packets=[];
 const ai={run:async(_m,request)=>{calls++;const body=JSON.parse(request.messages[1].content),c=body.context,r=body.reflectionRequirements;packets.push(c);const readings=mockCampaignReadings(c);if(calls===1)readings[0].citations[0].value=999999;
 return {response:{campaignReadings:readings,decision:'Observar',reason:'Conferir aquisição',nextStep:'Comparar novas vendas',text:'Uma campanha priorizada nesta unidade.',reflection:{lesson:'Validar números da origem.',uncertainty:'Efeito não medido.',nextCheck:'Comparar períodos.',citations:r.examples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'inconclusive',reason:'Sem resultado novo.'}))},suggestions:[],question:null}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{},ai,ops:{}});
 await assert.rejects(engine.step(),e=>e.code==='CLOUD_CAMPAIGN_READING_EVIDENCE');assert.equal(store.state.collaborationMessages.filter(m=>m.kind==='conclusion').length,0);assert.equal(store.state.campaignReviewCoverage,undefined);
 const failure=Object.values(store.state.cloudAttemptFailures)[0];assert.deepEqual(failure.readingFailure,{adAccountId:account,externalId:'123',reason:'citation_not_in_packet'});
 await store.write(s=>{s.cloudAttemptFailures.foreign={...failure,roundId:'other',code:'FOREIGN_ROUND'};s.cloudAttemptFailures.otherRole={...failure,agentId:'budget',code:'FOREIGN_ROLE'};});
 assert.equal((await engine.step()).kind,'stage');assert.equal(packets[1].validationFeedback.code,'CLOUD_CAMPAIGN_READING_EVIDENCE');assert.deepEqual(packets[1].validationFeedback.readingFailure,failure.readingFailure);assert.equal(store.state.collaborationMessages.filter(m=>m.kind==='conclusion').length,1);
 assert.equal((await engine.step()).kind,'stage');assert.equal(packets[2].validationFeedback,undefined);assert.equal(store.state.proposals.length,0);assert.equal(store.state.executions.length,0);
});

test('Four authored role analyses select frozen facts and persist reference receipts without approving or dispatching',async()=>{
 const f=fixture();f.state.collaborationRounds=[];f.state.collaborationMessages=[];f.state.proposals=[];f.state.executions=[];for(const cut of f.state.snapshots)for(const r of cut.rows){r.spend=100;r.revenueNet=200;r.frontOrders=2;}
 const round=ensureCollaboration(f.state,f.state.jobs[0]),store=memory(f);let calls=0;
 const ai={run:async(_m,request)=>{calls++;const b=JSON.parse(request.messages[1].content),r=b.reflectionRequirements;return {response:{campaignReadings:b.evidenceSelection.campaignExamples.map(c=>({...c,assessment:'observe',reason:'Conferir aquisição desta campanha.'})),decision:'Observar',reason:'Aguardar aquisição nova',nextStep:'Comparar período fechado',text:'Uma campanha priorizada foi analisada.',reflection:{lesson:'Conferir os dados da própria fonte.',uncertainty:'Efeito ainda não medido.',nextCheck:'Comparar novas vendas.',citations:b.evidenceSelection.reflectionExamples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'inconclusive',reason:'Não há resultado medido novo.'}))},suggestions:[],question:null}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{dispatch:async()=>{throw Error('No action authorized');}},ai,ops:{}});for(let i=0;i<4;i++)assert.equal((await engine.step()).kind,'stage');
 assert.equal(calls,4);assert.equal(store.state.collaborationRounds.find(r=>r.id===round.id).status,'Concluída');const messages=store.state.collaborationMessages.filter(m=>m.kind==='conclusion');assert.equal(messages.length,4);for(const m of messages){assert.equal(m.evidenceResolution.sourceHash,round.sourceHash);assert.ok(m.evidenceResolution.selected.length>=2);assert.equal(m.campaignReadings[0].citations[0].value,2);}assert.equal(store.state.proposals.length,0);assert.equal(store.state.executions.length,0);
});

test('Due projects are admitted before an older live collection, while closed admission never creates retroactive jobs',()=>{
 const now=Date.parse('2026-11-05T15:00:00Z'),other='55555555-5555-4555-8555-555555555555',state={config:{[project]:{projectName:'Running'},[other]:{projectName:'Due'}},paused:false,cadence:{enabled:true,intervalMinutes:60,start:'08:00',end:'20:00',weekdays:[0,1,2,3,4,5,6],timezone:'UTC'},jobs:[{id:'running',project,executor:'cloudflare',status:'Em análise',startedAt:iso(now-1000),updatedAt:iso(now-1000)}],agents:{[project]:{jobId:'running'}},snapshots:[]};
 const before=structuredClone(state);assert.deepEqual(cloudNext(state,[],now),{kind:'admit',projects:[other]});assert.deepEqual(state,before);
 const outside=Date.parse('2026-11-05T21:00:00Z');state.jobs[0].startedAt=iso(outside-1000);state.jobs[0].updatedAt=iso(outside-1000);assert.deepEqual(cloudNext(state,[],outside),{kind:'collectJob',project,jobId:'running'});
});
test('An approved exact execution stays ahead of due-source admission',()=>{
 const f=fixture(),other='55555555-5555-4555-8555-555555555555';f.state.config[other]={projectName:'Due'};f.state.cadence={enabled:true,intervalMinutes:15,start:'00:00',end:'23:59',weekdays:[0,1,2,3,4,5,6],timezone:'UTC'};const next=cloudNext(f.state);assert.equal(next.kind,'execution');assert.equal(next.proposalId,f.p.id);
});
