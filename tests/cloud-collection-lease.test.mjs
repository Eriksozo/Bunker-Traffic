import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudNext,createCloudEngine,assertCloudCollectionReservation} from '../lib/cloud-engine.mjs';
import {collectionLeaseMs,liveCollectionLease} from '../lib/collection-lease.mjs';
import {updateRun} from '../lib/agent-state.ts';
import {ensureCollaboration} from '../lib/collaboration.mjs';
import {collectionFailure} from '../lib/cloud-failure-diagnostics.mjs';
const iso=n=>new Date(n).toISOString(),at=Date.parse('2026-11-05T23:33:21.147Z');
function queued(startedAt=iso(at-1000)){
 return {config:{p:{projectName:'Example'}},paused:false,cadence:{enabled:false},jobs:[{id:'reserved',project:'p',executor:'cloudflare',status:'Em análise',startedAt}],agents:{p:{jobId:'reserved'}},snapshots:[{projectId:'p',period:'today',level:'campaign',fetchedAt:iso(at-3600000),rows:[{externalId:'old',spend:77}]}],collaborationRounds:[],proposals:[],executions:[],reports:[]};
}
function memory(initial,clock,source){let state=structuredClone(initial);return {get state(){return state;},engine:createCloudEngine({read:async()=>({state:structuredClone(state),revision:1}),write:async fn=>{const draft=structuredClone(state),out=await fn(draft,1);state=draft;return out;},source,ops:{updateRun:(_s,j,status,note)=>{j.status=status;j.note=note;}},ai:{run:async()=>{throw Error('No model generation expected');}},now:clock})};}
function withStage(){
 const s=queued(iso(at-40*60000)),start=Date.parse('2026-11-05T00:00:00Z');s.config.a={projectName:'Analysis'};
 const j={id:'analysis',project:'a',status:'Concluída',startedAt:iso(at-60000),completedAt:iso(at-500)};s.jobs.push(j);s.agents.a={jobId:j.id};
 for(const [period,days] of [['7d',7],['3d',3],['yesterday',1],['today',0]])s.snapshots.push({projectId:'a',period,level:'campaign',source:'Malva MCP',complete:true,from:iso(start-days*86400000),to:iso(start+(period==='today'?86400000:0)),fetchedAt:iso(at-1000),timezone:'UTC',rows:[{externalId:'analysis-campaign',adAccountId:'account',provider:'meta',status:'ACTIVE',spend:100}]});
 ensureCollaboration(s,j,at);return s;
}
test('The observed 51-minute queue delay exceeds the unchanged 45-minute completion lease',t=>{
 t.mock.timers.enable({apis:['Date'],now:at});const s=queued('2026-11-05T22:41:49.026Z');
 assert.equal(collectionLeaseMs,45*60000);assert.equal(liveCollectionLease(s.jobs[0],at),false);
 assert.throws(()=>updateRun(s,s.jobs[0],'Concluída','No result'),/Reserva expirada/);
 assert.equal(s.jobs[0].status,'Em análise');
});
test('An expired reservation fails before any source call, retaining the exact old data and history without retroactive admission',async()=>{
 const s=queued('2026-11-05T22:41:49.026Z'),before=structuredClone(s),sourceCalls=[];
 const m=memory(s,()=>at,{read:async(tool)=>{sourceCalls.push(tool);throw Error('Must not query');},dispatch:async()=>{throw Error('No write authorized');}});
 await assert.rejects(m.engine.step(),e=>e.code==='CLOUD_COLLECTION_LEASE_EXPIRED'&&e.collectionFailure.phase==='reservation');
 assert.deepEqual(sourceCalls,[]);assert.equal(m.state.jobs.length,1);assert.equal(m.state.jobs[0].startedAt,before.jobs[0].startedAt);assert.equal(m.state.jobs[0].status,'Falhou');assert.deepEqual(m.state.snapshots,before.snapshots);assert.deepEqual(m.state.collaborationRounds,before.collaborationRounds);assert.deepEqual(m.state.executions,[]);assert.equal(m.state.cloudCollectionFailures[0].code,'CLOUD_COLLECTION_LEASE_EXPIRED');
 assert.equal(cloudNext(m.state,[],at),null);
});
test('The reservation is rechecked after identity I/O; expiry, pause and takeover do not reach campaign collection',async()=>{
 for(const mode of ['expiry','pause','takeover']){
  let clock=at,calls=0,reads=0;const s=queued();let state=structuredClone(s);
  // Simulate a control/ownership change through the authoritative read boundary.
  const engine=createCloudEngine({read:async()=>{reads++;if(reads===2&&mode==='pause')state.paused=true;if(reads===2&&mode==='takeover')state.agents.p.jobId='other-worker';return {state:structuredClone(state),revision:1};},write:async fn=>{const draft=structuredClone(state),out=await fn(draft,1);state=draft;return out;},source:{read:async tool=>{calls++;if(tool==='workspace_whoami')return {workspace:{id:'w'},platforms:[{platform:'tracking',read:true}]};if(tool==='tracking_list_projects'){if(mode==='expiry')clock+=collectionLeaseMs;return {items:[{id:'p',name:'Example',timezone:'UTC',currency:'BRL'}]};}throw Error('No campaign call');}},ops:{updateRun:(_s,j,status)=>{j.status=status;}},now:()=>clock});
  await assert.rejects(engine.step(),e=>e.code===(mode==='expiry'?'CLOUD_COLLECTION_LEASE_EXPIRED':'CLOUD_CLAIM_CHANGED'));
  assert.equal(calls,2);assert.deepEqual(state.snapshots,s.snapshots);assert.equal(state.jobs[0].startedAt,s.jobs[0].startedAt);if(mode==='takeover'){assert.equal(state.agents.p.jobId,'other-worker');assert.equal(state.jobs[0].status,'Em análise');}
 }
});
test('Admitted collections are served before background stages, then the stage resumes; requests and other workers remain protected',()=>{
 const s=withStage(),before=structuredClone(s);assert.equal(cloudNext(s,[],at).kind,'collectJob');assert.deepEqual(s,before);
 s.jobs[0].status='Concluída';assert.equal(cloudNext(s,[],at).kind,'stage');s.jobs[0].status='Em análise';
 s.messages=[{id:'owner-question',project:'a',status:'Pendente',agentId:'traffic'}];assert.equal(cloudNext(s,[],at).kind,'ownerQuestion');s.messages=[];
 s.agents.p.jobId='other-worker';assert.equal(cloudNext(s,[],at).kind,'stage');s.paused=true;assert.equal(cloudNext(s,[],at),null);
});
test('A priority arriving during identity lookup defers collection without new source calls, failure, takeover or renewal',async()=>{
 const initial=withStage();let state=structuredClone(initial),reads=0,calls=0,writes=0;
 const engine=createCloudEngine({read:async()=>{reads++;if(reads===2)state.messages=[{id:'urgent',project:'a',status:'Pendente',agentId:'traffic'}];return {state:structuredClone(state),revision:1};},write:async()=>{writes++;throw Error('No mutation expected');},source:{read:async tool=>{calls++;if(tool==='workspace_whoami')return {workspace:{id:'w'},platforms:[{platform:'tracking',read:true}]};if(tool==='tracking_list_projects')return {items:[{id:'p',name:'Example',timezone:'UTC',currency:'BRL'}]};throw Error('No campaign read');}},now:()=>at,ops:{}});
 assert.equal((await engine.step()).kind,'deferred');assert.equal(calls,2);assert.equal(writes,0);assert.equal(state.jobs[0].status,'Em análise');assert.equal(state.jobs[0].startedAt,initial.jobs[0].startedAt);assert.deepEqual(state.snapshots,initial.snapshots);assert.equal(state.cloudCollectionFailures,undefined);assert.equal(cloudNext(state,[],at).kind,'ownerQuestion');
});
test('Six admitted projects cannot remain behind another project’s repeated model stages',()=>{
 const s=withStage();s.jobs=s.jobs.filter(j=>j.project==='a');delete s.agents.p;delete s.config.p;
 for(let i=0;i<6;i++){const project='queued-'+i,id='j'+i;s.config[project]={projectName:project};s.jobs.push({id,project,executor:'cloudflare',status:'Em análise',startedAt:iso(at-1000)});s.agents[project]={jobId:id};}
 const served=[];for(let i=0;i<6;i++){const next=cloudNext(s,[],at);assert.equal(next.kind,'collectJob');served.push(next.project);s.jobs.find(j=>j.id===next.jobId).status='Concluída';}
 assert.equal(new Set(served).size,6);assert.equal(cloudNext(s,[],at).kind,'stage');
});
test('Boundary, invalid clocks and current owner are rechecked by the same commit guard, without renewal or mutation',()=>{
 const s=queued(),before=structuredClone(s);assert.equal(assertCloudCollectionReservation(s,'reserved',at),s.jobs[0]);
 assert.equal(liveCollectionLease({startedAt:iso(at-collectionLeaseMs+1)},at),true);assert.equal(liveCollectionLease({startedAt:iso(at-collectionLeaseMs)},at),false);
 assert.throws(()=>assertCloudCollectionReservation(s,'reserved',at+collectionLeaseMs),e=>e.code==='CLOUD_COLLECTION_LEASE_EXPIRED');
 for(const startedAt of ['invalid',iso(at+1)]){const bad=structuredClone(s);bad.jobs[0].startedAt=startedAt;assert.throws(()=>assertCloudCollectionReservation(bad,'reserved',at),e=>e.code==='CLOUD_COLLECTION_LEASE_INVALID');}
 const foreign=structuredClone(s);foreign.agents.p.jobId='other';assert.throws(()=>assertCloudCollectionReservation(foreign,'reserved',at),e=>e.code==='CLOUD_CLAIM_CHANGED');assert.deepEqual(s,before);
 assert.equal(collectionFailure(Error('CONFLICT'),{project:'p',jobId:'j',phase:'persist'},at).code,'CLOUD_REVISION_CONFLICT');
});
test('A complete fetched bundle cannot replace valid data when the lease expires at commit, priority changes or the database CAS loses',async()=>{
 for(const mode of ['expiry','conflict','priority']){
  const project='11111111-1111-4111-8111-111111111111',initial=queued();initial.config={[project]:{projectName:'Example'}};initial.jobs[0].project=project;initial.agents={[project]:{jobId:'reserved'}};initial.snapshots[0].projectId=project;
  if(mode==='priority'){const extra=withStage();initial.config.a=extra.config.a;initial.jobs.push(extra.jobs.find(j=>j.project==='a'));initial.agents.a=extra.agents.a;initial.snapshots.push(...extra.snapshots.filter(s=>s.projectId==='a'));initial.collaborationRounds=extra.collaborationRounds;}
  let clock=at,state=structuredClone(initial),writes=0,imports=0,sourceCalls=0;
  const source={read:async(tool,a)=>{
   sourceCalls++;
   if(tool==='workspace_whoami')return {workspace:{id:'w'},platforms:[{platform:'tracking',read:true}]};
   if(tool==='tracking_list_projects')return {items:[{id:project,name:'Example',timezone:'UTC',currency:'BRL'}]};
   if(tool==='tracking_ad_accounts')return {items:[]};
   if(tool==='tracking_campaigns')return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(clock),lastSyncAt:null,period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to+'T00:00:00Z')+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]},rows:[]};
   throw Error('Unexpected source');
  }};
  const engine=createCloudEngine({read:async()=>({state:structuredClone(state),revision:1}),write:async fn=>{writes++;if(writes===1){if(mode==='conflict')throw Error('CONFLICT');if(mode==='expiry')clock+=collectionLeaseMs;if(mode==='priority')state.messages=[{id:'urgent',project:'a',status:'Pendente',agentId:'traffic'}];}const draft=structuredClone(state),out=await fn(draft,1);state=draft;return out;},source,ops:{importBundle:()=>{imports++;},updateRun:(_s,j,status,note)=>{j.status=status;j.note=note;}},now:()=>clock});
  if(mode==='priority'){assert.equal((await engine.step()).kind,'deferred');assert.equal(state.jobs[0].status,'Em análise');assert.equal(writes,1);assert.equal(state.cloudCollectionFailures,undefined);}else{await assert.rejects(engine.step(),e=>e.code===(mode==='expiry'?'CLOUD_COLLECTION_LEASE_EXPIRED':'CLOUD_REVISION_CONFLICT')&&e.collectionFailure.phase==='persist');assert.equal(writes,2);assert.equal(state.jobs[0].status,'Falhou');}
  assert.ok(sourceCalls>12);assert.equal(imports,0);assert.deepEqual(state.snapshots,initial.snapshots);assert.equal(state.jobs[0].startedAt,initial.jobs[0].startedAt);assert.deepEqual(state.collaborationRounds,initial.collaborationRounds);assert.deepEqual(state.executions,[]);
 }
});
