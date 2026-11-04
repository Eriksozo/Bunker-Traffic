import {authenticateServer} from '../supabase/functions/malva-mcp/server-auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {callRemoteMcp,cloudMalvaClient} from '../lib/cloud-malva.mjs';
import {cloudNext,cloudDispatch,cloudProposalPayload,failCloudOpinion,createCloudEngine} from '../lib/cloud-engine.mjs';
import {authorizeCloudDispatch} from '../lib/cloud-dispatch-guard.mjs';
import {runCloudAnalyst,cloudFocus,cloudEvidence,compactCloudContext} from '../lib/cloud-analysis.mjs';
import {collectCloudProject,cloudRanges} from '../lib/cloud-collector.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal} from '../lib/collaboration.mjs';
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
 const source={read:async(tool,a)=>{if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta'}]};calls++;return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now),lastSyncAt:null,period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to+'T00:00:00Z')+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]},rows:[{id:internal,projectId:project,projectName:'Example',externalId:'123',adAccountId:account,accountName:'Test',name:'Example',level:a.level,provider:'meta',spend:100}]};}};
 const out=await collectCloudProject(source,p,{now:()=>now,startedAt:iso(now-1000)});assert.equal(out.snapshots.length,12);assert.equal(out.snapshots.find(s=>s.period==='today'&&s.level==='campaign').coverage.kind,'active-spent-tracked');assert.equal(out.snapshots.find(s=>s.period==='7d').from,ranges['7d'].from+'T00:00:00.000Z');
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

test('today cohort reads active and spent plus exact tracked paused objects, not the dormant archive',async()=>{
 const now=Date.now(),p={id:project,name:'Example',timezone:'UTC',currency:'BRL'},ranges=cloudRanges(now,'UTC'),pausedId='44444444-4444-4444-8444-444444444444';
 const active={id:internal,externalId:'123',adAccountId:account,accountName:'Test',projectId:project,projectName:'Example',name:'Active',level:'campaign',provider:'meta',status:'ACTIVE',spend:5};
 const paused={...active,id:pausedId,externalId:'456',status:'PAUSED',spend:0};let details=0;
 const source={read:async(tool,a)=>{if(tool==='tracking_ad_accounts')return {items:[{id:account,provider:'meta'}]};if(tool==='tracking_ad_detail'){details++;assert.equal(a.objectId,pausedId);return {row:paused,currency:'BRL',period:{timezone:'UTC'}};}assert.ok(['active','spent'].includes(a.status)||a.status==='all'&&a.accountIds?.[0]===account);return {level:'campaign',salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now),lastSyncAt:null,period:{timezone:'UTC',from:ranges.today.from+'T00:00:00.000Z',to:iso(Date.parse(ranges.today.to+'T00:00:00Z')+86400000),days:[ranges.today.from]},rows:[active]};}};
 const out=await collectCloudProject(source,p,{now:()=>now,levels:['campaign'],periodsWanted:['today'],tracked:[paused]});assert.equal(details,1);assert.equal(out.snapshots[0].rows.length,2);assert.equal(out.snapshots[0].coverage.trackedComplete,true);assert.equal(out.snapshots[0].rows.find(r=>r.externalId==='456').status,'PAUSED');
});

test('cloud perspectives and synthesis complete a real domain round without manufacturing owner approvals',async()=>{
 const f=fixture();f.state.collaborationRounds=[];f.state.collaborationMessages=[];f.state.proposals=[];f.state.executions=[];
 for(const cut of f.state.snapshots)for(const r of cut.rows){r.spend=100;r.revenueNet=200;r.frontOrders=2;}
 const round=ensureCollaboration(f.state,f.state.jobs[0]),store=memory(f);let generations=0;
 const ai={run:async()=>{generations++;return {response:{decision:'Manter',reason:'Aguardar aquisição nova',nextStep:'Conferir evolução',text:'Uma campanha priorizada; os demais objetos não receberam leitura individual.',suggestions:[],question:null}};}};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{},ai,ops:{}});
 for(let i=0;i<4;i++){const result=await engine.step();assert.equal(result.kind,'stage');}
 assert.equal(generations,4);assert.equal(store.state.collaborationRounds.find(r=>r.id===round.id).status,'Concluída');assert.equal(store.state.collaborationMessages.filter(m=>m.kind==='conclusion').length,4);assert.equal(store.state.proposals.length,0);assert.equal(store.state.executions.length,0);
});

test('cloud scheduling finishes a partially completed round before starting a newer one',()=>{
 const f=fixture();f.state.proposals=[];f.state.executions=[];const existing=f.state.collaborationRounds[0];existing.stages[3]={agentId:'ops',status:'Pendente',attempt:0};
 const newer=structuredClone(existing);newer.id='newer-round';newer.createdAt=iso(Date.now());newer.stages=['traffic','creative','budget','ops'].map(agentId=>({agentId,status:'Pendente',attempt:0}));
 f.state.collaborationRounds.unshift(newer);assert.equal(cloudNext(f.state).roundId,existing.id);
});
