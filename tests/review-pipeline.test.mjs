import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPipeline,requestReviewBatch,readReviewContext} from '../lib/review-pipeline.mjs';
import {briefAgentState,briefAgentPlans} from '../lib/agent-briefing.mjs';
const now=Date.parse('2026-11-04T15:00:00Z'),at=n=>new Date(now+n).toISOString();
const state=()=>({config:{p:{projectName:'Alpha'},q:{projectName:'Beta'}},snapshots:[],jobs:[],agents:{},events:[],paused:false,cadence:{enabled:false},collaborationRounds:[],collaborationMessages:[],proposals:[]});
const snapshot=(extra={})=>({projectId:'p',period:'today',level:'campaign',from:at(-3600000),to:at(3600000),fetchedAt:at(-1000),lastSyncAt:at(-2000),source:'Malva MCP',complete:true,rows:[],...extra});
test('dashboard request queues each project once without changing campaigns or cadence',()=>{
 const s=state(),config=structuredClone(s.config),cadence=structuredClone(s.cadence),input={projectIds:['p','q'],clientId:'request'};
 const receipt=requestReviewBatch(s,input,'owner',now),before=structuredClone(s);
 assert.equal(receipt.items.length,2);assert.equal(s.jobs.length,2);assert.equal(s.jobs.every(j=>j.status==='Pendente'),true);
 assert.equal(requestReviewBatch(s,{...input,projectIds:['q','p']},'owner',now+1).id,receipt.id);assert.deepEqual(s,before);
 requestReviewBatch(s,{...input,clientId:'second'},'owner',now+2);assert.equal(s.jobs.length,2);
 assert.deepEqual(s.config,config);assert.deepEqual(s.cadence,cadence);assert.equal(s.proposals.length,0);
});
test('malformed, foreign, paused or reused requests fail atomically',()=>{
 for(const ids of [[],['p','p'],['p','unknown'],null]){const s=state(),before=structuredClone(s);assert.throws(()=>requestReviewBatch(s,{projectIds:ids,clientId:'request'},'owner',now));assert.deepEqual(s,before);}
 const s=state();s.paused=true;assert.throws(()=>requestReviewBatch(s,{projectIds:['p'],clientId:'request'},'owner',now),/Retome/);assert.equal(s.jobs.length,0);
 s.paused=false;requestReviewBatch(s,{projectIds:['p'],clientId:'request'},'owner',now);assert.throws(()=>requestReviewBatch(s,{projectIds:['q'],clientId:'request'},'owner',now),/outro pedido/);
});
test('a live collection or unverified dispatch cannot be displaced by a dashboard request',()=>{
 const s=state();s.jobs=[{id:'running',project:'p',status:'Em análise',startedAt:at(-10000),updatedAt:at(-10000),createdAt:at(-10000)}];s.agents.p={jobId:'running'};
 const p=requestReviewBatch(s,{projectIds:['p'],clientId:'request'},'owner',now);assert.equal(p.items[0].status,'Em acompanhamento');assert.equal(s.jobs.length,1);
 const q=state();q.executions=[{id:'sent',project:'p',proposalId:'proposal',status:'Verificação necessária',submittedAt:at(-5000)}];
 assert.equal(requestReviewBatch(q,{projectIds:['p'],clientId:'request'},'owner',now).items[0].status,'Em acompanhamento');assert.equal(q.jobs.length,0);
});
test('progress does not count old snapshots and distinguishes elapsed time from completion',()=>{
 const s=state();s.jobs=[{id:'job',project:'p',status:'Em análise',startedAt:at(-600000),updatedAt:at(-600000),createdAt:at(-600000)}];s.agents.p={jobId:'job'};
 s.snapshots=['7d','3d','yesterday','today'].map(period=>snapshot({period,fetchedAt:at(-700000)}));
 let p=reviewPipeline(s,'p',now).projects[0];assert.equal(p.collected,0);assert.equal(p.completed,0);assert.equal(p.elapsedSeconds,600);assert.equal(p.stalled,true);assert.equal(p.durationSeconds,null);
 s.snapshots[0].fetchedAt=at(-1000);p=reviewPipeline(s,'p',now).projects[0];assert.equal(p.collected,1);assert.equal(p.status,'Coleta em andamento');
 s.paused=true;assert.equal(reviewPipeline(s,'p',now).projects[0].status,'Pausado');assert.equal(reviewPipeline(s,'p',now).projects[0].canRequest,false);
});
test('source pages keep exact project and account, expose missing sources, fence changed pages',()=>{
 const s=state();s.snapshots=[snapshot({rows:Array.from({length:55},(_,i)=>({externalId:String(i),adAccountId:i===0?'other':'account',spend:i}))}),snapshot({projectId:'q',rows:[{externalId:'foreign',adAccountId:'account'}]})];
 const input={action:'read',section:'sources',projectId:'p',period:'today',level:'campaign',limit:25};
 const first=readReviewContext(s,input,now),second=readReviewContext(s,{...input,cursor:first.nextCursor},now),third=readReviewContext(s,{...input,cursor:second.nextCursor},now);
 assert.equal(first.total,55);assert.equal(first.items.length,25);assert.equal(third.items.length,5);assert.equal(third.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items,...third.items].map(r=>r.externalId)).size,55);
 assert.throws(()=>readReviewContext(s,{...input,projectId:'q',cursor:first.nextCursor},now),/Cursor/);
 assert.throws(()=>readReviewContext(s,{...input,objectId:'0'},now),/conta/);
 assert.equal(readReviewContext(s,{...input,objectId:'0',adAccountId:'account'},now).total,0);
 s.snapshots[0].rows[0].spend=1000;assert.throws(()=>readReviewContext(s,{...input,cursor:first.nextCursor},now),/atualizada/);
 assert.equal(readReviewContext(s,{...input,period:'7d'},now).sourceAvailable,false);
 assert.throws(()=>readReviewContext(s,{...input,action:'approve'},now),/somente/);
});
test('compact briefing excludes bulky immutable journals without deleting or fabricating records',()=>{
 const s=state(),large='x'.repeat(100000);Object.assign(s,{knowledge:[{claim:large}],knowledgeMeasurements:[{rows:large}],collaborationMessages:[{text:large}],reports:[{text:large}],snapshots:[{projectId:'p',period:'today',level:'campaign',rowCount:50,totals:{spend:42}}]});
 const before=structuredClone(s),brief=briefAgentState(s);
 assert.equal(brief.collaborationMessages,undefined);assert.equal(brief.knowledge,undefined);assert.equal(brief.snapshots[0].rowCount,50);assert.equal(brief.snapshots[0].totals.spend,42);assert.deepEqual(s,before);
 assert.ok(JSON.stringify(brief).length<JSON.stringify(s).length*0.01);
 const plans=briefAgentPlans({learning:{stats:{patterns:1},items:[large]},knowledge:[{project:'p',items:[large]}],watch:{signalCount:1,signals:[large]},execution:{executions:[{id:'real-dispatch'}]}},s);
 assert.equal(plans.watch.signalCount,1);assert.equal(plans.watch.signals,undefined);assert.deepEqual(plans.execution.executions,[{id:'real-dispatch'}]);assert.equal(plans.knowledge[0].itemCount,1);
});
test('expired collections allow a new request without pretending an expired worker is running',()=>{
 const s=state();s.jobs=[{id:'old',project:'p',status:'Em análise',startedAt:at(-46*60000),createdAt:at(-46*60000)}];s.agents.p={jobId:'old'};
 const p=reviewPipeline(s,'p',now).projects[0];assert.equal(p.status,'Coleta expirada');assert.equal(p.elapsedSeconds,null);assert.equal(p.canRequest,true);
 assert.equal(requestReviewBatch(s,{projectIds:['p'],clientId:'retry'},'owner',now).items[0].status,'Na fila');assert.equal(s.jobs[1].status,'Em análise');
});
test('exact execution evidence remains accessible without conferring a new authorization',()=>{
 const s=state();s.proposals=[{id:'proposal',project:'p',status:'Aprovada',version:2,payload:{currency:'USD',after:{dailyBudget:42}}}];s.executions=[{id:'sent',project:'p',proposalId:'proposal',submittedAt:at(-5000),status:'Verificação necessária'}];
 const before=structuredClone(s),read=readReviewContext(s,{action:'read',section:'execution',projectId:'p',executionId:'sent'},now);
 assert.equal(read.proposal.version,2);assert.equal(read.executions[0].status,'Verificação necessária');assert.equal(read.dispatchGranted,undefined);assert.deepEqual(s,before);
 assert.throws(()=>readReviewContext(s,{action:'read',section:'execution',projectId:'q',executionId:'sent'},now),/não encontrada/);
 assert.throws(()=>readReviewContext(s,{action:'read',section:'execution',projectId:'p',executionId:'sent',proposalId:'other'},now),/incompatíveis/);
});
