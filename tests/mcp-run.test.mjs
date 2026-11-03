import test from 'node:test';
import assert from 'node:assert/strict';
import {agentView,reserveRequest} from '../lib/mcp-run.ts';
const state=()=>({config:{p:{projectName:'Nico'}},snapshots:[],jobs:[{id:'manual',project:'p',status:'Pendente'}],reports:[],events:[],messages:[],paused:false,cadence:{enabled:false}});
test('Existing client reservation request returns a real job and prevents duplicate reservation',()=>{
 const s=state(),view=agentView({state:s,revision:4});const request=view.plan.due[0].startRequest;
 assert.equal(request.tool,'bunker_atualizar_rodada');assert.equal(request.arguments.id,'project:p');
 const claimed=reserveRequest(s,request.arguments);assert.equal(claimed.job.id,'manual');assert.equal(claimed.job.status,'Em análise');assert.throws(()=>reserveRequest(s,request.arguments),/não elegível/);
});
test('Both published project argument names resolve the same allowed reservation',()=>{
 assert.equal(reserveRequest(state(),{projectId:'p',revision:1}).job.id,'manual');
 assert.equal(reserveRequest(state(),{project:'p',revision:1}).job.id,'manual');
 assert.throws(()=>reserveRequest(state(),{project:'other',revision:1}),/não elegível/);
});

test('The published batch request reserves all due projects in one state transition',()=>{
 const s=state();s.config.q={projectName:'John'};s.jobs.push({id:'q-manual',project:'q',status:'Pendente'});
 const request=agentView({state:s,revision:4}).plan.batchStartRequest;
 assert.equal(request.tool,'bunker_atualizar_rodada');assert.equal(request.arguments.id,'projects:due');assert.equal(request.arguments.status,'Em análise');assert.equal(request.arguments.revision,4);
 assert.deepEqual(JSON.parse(request.arguments.note),{projectIds:['p','q']});
 const result=reserveRequest(s,request.arguments,new Date('2026-11-02T03:00:00.000Z'));
 assert.deepEqual(result.jobs.map(job=>job.id),['manual','q-manual']);assert.equal(result.jobs[0].startedAt,result.jobs[1].startedAt);
 assert.equal(agentView({state:s,revision:5}).plan.batchStartRequest,undefined);
});

test('Malformed or incomplete batch envelopes never leave partial reservations',()=>{
 for(const note of ['not JSON','null','[]',JSON.stringify({projectIds:['p','missing']}),JSON.stringify({projectIds:['p','p']})]){
  const s=state(),before=JSON.stringify(s);
  assert.throws(()=>reserveRequest(s,{id:'projects:due',status:'Em análise',revision:1,note}));assert.equal(JSON.stringify(s),before);
 }
});
