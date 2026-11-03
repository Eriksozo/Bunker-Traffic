import test from 'node:test';
import assert from 'node:assert/strict';
import {recordIncident,incidentLimits} from '../lib/campaign-incidents.mjs';
const now=Date.parse('2026-11-03T03:00:00Z');
const state=()=>({config:{john:{projectName:'John'},nico:{projectName:'Nico'}},paused:true,jobs:[],executions:[],snapshots:[],cadence:{intervalMinutes:60}});
const report=(patch={})=>({op:'incidentReport',project:'john',kind:'checkout',status:'Em retomada',note:'Checkout voltou; algumas campanhas foram reativadas fora do Bunker.',scope:{accountIds:[],objectIds:[]},clientId:'report-1',...patch});
const update=(record,patch={})=>({op:'incidentUpdate',id:record.id,project:'john',status:'Encerrado',note:'Acompanhamento concluído.',clientId:'update-1',...patch});

test('Owner declaration works while paused and changes only the incident register',()=>{
 const s=state(),before=structuredClone(s),r=recordIncident(s,report(),'owner',now);
 assert.equal(r.project,'john');assert.equal(r.status,'Em retomada');assert.equal(r.reportedAt,new Date(now).toISOString());assert.equal(r.createdAt,r.reportedAt);assert.equal(r.history.length,1);assert.equal(r.history[0].ownerId,'owner');
 assert.equal(r.startedAt,undefined);assert.equal(r.recoveredAt,undefined);assert.equal(r.verified,undefined);assert.equal(r.executionByBunker,undefined);
 const {incidents,...rest}=s;assert.deepEqual(rest,before);assert.equal(incidents.length,1);
});
test('Replay returns the same incident even after update and ignores transport revision',()=>{
 const s=state(),r=recordIncident(s,report({revision:1}),'owner',now);
 const changed=recordIncident(s,update(r),'owner',now+1000),snapshot=structuredClone(s);
 assert.equal(recordIncident(s,report({revision:99}),'owner',now+2000),changed);assert.deepEqual(s,snapshot);
 assert.equal(recordIncident(s,update(r),'owner',now+2000),changed);assert.equal(s.incidents.length,1);assert.equal(changed.history.length,2);
});
test('Client collisions across projects, payloads, operations and owners are rejected atomically',()=>{
 const s=state(),r=recordIncident(s,report(),'owner',now),before=structuredClone(s);
 for(const [args,owner] of [[report({project:'nico'}),'owner'],[report({note:'Outra observação.'}),'owner'],[report(),'other-owner'],[update(r,{clientId:'report-1'}),'owner']]){
  assert.throws(()=>recordIncident(s,args,owner,now+1000),/Identificador/);assert.deepEqual(s,before);
 }
});
test('Updates preserve immutable scope and the complete sequence of communications',()=>{
 const s=state(),r=recordIncident(s,report({status:'Interrompido',scope:{accountIds:['account1'],objectIds:[{adAccountId:'account1',objectId:'campaign1'}]}}),'owner',now),original=structuredClone(r);
 const resumed=recordIncident(s,update(r,{status:'Em retomada',note:'Informei a retomada.',clientId:'resume'}),'owner',now+1000);
 const closed=recordIncident(s,update(r),'owner',now+2000);
 assert.deepEqual(closed.scope,original.scope);assert.equal(closed.createdAt,original.createdAt);assert.deepEqual(closed.history[0],original.history[0]);assert.deepEqual(closed.history.map(h=>h.status),['Interrompido','Em retomada','Encerrado']);assert.equal(resumed.history.length,2);assert.equal(s.incidents.length,1);
});
test('Exact project identity and authenticated owner are mandatory',()=>{
 const s=state();for(const [args,owner] of [[report({project:'missing'}),'owner'],[report(),''],[report(),' '.repeat(2)]])assert.throws(()=>recordIncident(s,args,owner,now));
 const r=recordIncident(s,report(),'owner',now),before=structuredClone(s);
 assert.throws(()=>recordIncident(s,update(r,{project:'nico'}),'owner',now+1000),/não encontrado/);assert.deepEqual(s,before);
});
test('Schemas reject unknown ownership/recovery claims, invalid status, missing notes and duplicate scope',()=>{
 const invalid=[{status:'Ativa'},{kind:'Meta'},{note:''},{note:'x'.repeat(2501)},{ownerId:'forged'},{recoveredAt:new Date(now).toISOString()},
  {scope:{accountIds:['a','a'],objectIds:[]}},{scope:{accountIds:[],objectIds:[{adAccountId:'a',objectId:'c'},{adAccountId:'a',objectId:'c'}]}},{scope:{accountIds:['a'],objectIds:[{adAccountId:'b',objectId:'c'}]}}];
 for(const patch of invalid){const s=state();assert.throws(()=>recordIncident(s,report(patch),'owner',now));assert.equal(s.incidents,undefined);}
 const s=state(),r=recordIncident(s,report(),'owner',now),before=structuredClone(s);
 assert.throws(()=>recordIncident(s,{...update(r),scope:{accountIds:['b'],objectIds:[]}},'owner',now+1000));assert.deepEqual(s,before);
});
test('Same campaign ID in different accounts is legal and remains exactly scoped',()=>{
 const s=state(),scope={accountIds:['a','b'],objectIds:[{adAccountId:'a',objectId:'same'},{adAccountId:'b',objectId:'same'}]};
 assert.deepEqual(recordIncident(s,report({scope}),'owner',now).scope,scope);
});
test('Invalid timestamps, backwards updates, corrupt state and capacity retain all prior data',()=>{
 const s=state();assert.throws(()=>recordIncident(s,report(),'owner',NaN));assert.equal(s.incidents,undefined);
 const r=recordIncident(s,report(),'owner',now),before=structuredClone(s);assert.throws(()=>recordIncident(s,update(r),'owner',now-1),/anteceder/);assert.deepEqual(s,before);
 const full=state();full.incidents=Array.from({length:incidentLimits.incidents},(_,i)=>({...r,id:'incident'+i,history:[]}));const fullBefore=structuredClone(full);assert.throws(()=>recordIncident(full,report({clientId:'new'}),'owner',now),/Limite/);assert.deepEqual(full,fullBefore);
 const history=state();history.incidents=[{...r,history:Array.from({length:incidentLimits.history},(_,i)=>({...r.history[0],clientId:'c'+i}))}];const historyBefore=structuredClone(history);assert.throws(()=>recordIncident(history,update(r),'owner',now+1),/Limite/);assert.deepEqual(history,historyBefore);
 const broken=state();broken.incidents={};assert.throws(()=>recordIncident(broken,report(),'owner',now),/Histórico/);
});
