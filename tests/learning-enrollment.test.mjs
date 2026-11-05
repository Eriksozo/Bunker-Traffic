import test from 'node:test';
import assert from 'node:assert/strict';
import {learningFixture,learningNow as now} from './fixtures/learning-flow.mjs';
import {claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';
import {enrollProposalLearning,proposalLearningEnrollment} from '../lib/learning-enrollment.mjs';
import {recordKnowledge} from '../lib/knowledge.mjs';
import {processAutonomousLearning} from '../lib/learning-outcomes.mjs';
import {learningCyclePlan} from '../lib/learning-cycle.mjs';
import {runCloudAnalyst} from '../lib/cloud-analysis.mjs';
const iso=n=>new Date(n).toISOString(),day=86400000;
function fixture(){
 const f=learningFixture(0),refs=[{period:'today',level:'campaign',adAccountId:'local',externalId:'current',fetchedAt:iso(now-1000)}];
 for(const role of ['traffic','creative','budget']){const c=claimCollaboration(f.state,{roundId:f.round.id,agentId:role,executionRef:'worker-'+role,clientId:'claim-'+role},now);postCollaboration(f.state,{roundId:f.round.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'done-'+role,toAgent:'ops',kind:'conclusion',text:'Parecer real no protocolo de teste.',evidenceRefs:refs},now);}
 const c=claimCollaboration(f.state,{roundId:f.round.id,agentId:'ops',executionRef:'worker-ops',clientId:'claim-ops'},now);
 const proposal={id:'proposal',roundId:f.round.id,project:'p',version:1,signature:'seal',status:'Em revisão',createdAt:iso(now),payload:{action:'budget',level:'campaign',provider:'meta',objectId:'current',adAccountId:'local',currency:'BRL',before:{dailyBudget:100},after:{dailyBudget:80}}};f.state.proposals.push(proposal);
 return {...f,proposal,args:{roundId:f.round.id,claimId:c.claimId,executionRef:c.executionRef,entry:{project:'p',proposalId:proposal.id,proposalVersion:1,proposalSignature:'seal',knowledgeId:f.knowledge.id,knowledgeRevision:1,reason:'Conter exposição segundo a hipótese antes de conhecer o resultado.'}}};
}
test('enrollment freezes a hypothesis before approval and leaves all money and permissions unchanged',()=>{
 const f=fixture(),prior={proposal:structuredClone(f.proposal),config:structuredClone(f.state.config),snapshots:structuredClone(f.state.snapshots)};
 const saved=enrollProposalLearning(f.state,f.args,now);assert.equal(saved.action,'reduce');assert.equal(saved.knowledgeRegisteredAt,f.knowledge.updatedAt);assert.equal(saved.knowledgeRevision,1);assert.equal(f.state.learningEnrollments.length,1);assert.equal(f.state.proposals[0].status,'Em revisão');assert.deepEqual(f.proposal,prior.proposal);assert.deepEqual(f.state.config,prior.config);assert.deepEqual(f.state.snapshots,prior.snapshots);assert.equal(f.state.executions,undefined);
 assert.equal(enrollProposalLearning(f.state,f.args,now+day).id,saved.id);assert.throws(()=>enrollProposalLearning(f.state,{...f.args,entry:{...f.args.entry,reason:'New narrative after result'}},now),/CONFLICT/);assert.equal(proposalLearningEnrollment(f.state,f.proposal,now).id,saved.id);
});
test('late association, another proposal version, another role, or invented knowledge is refused',()=>{
 for(const change of [f=>f.proposal.status='Aprovada',f=>f.proposal.approvedVersion=1,f=>f.proposal.execution={status:'Reservada'},f=>f.state.executions=[{proposalId:'proposal',status:'Enviada'}],f=>f.args.entry.proposalSignature='other',f=>f.args.entry.knowledgeRevision=2,f=>f.args.entry.project='q',f=>f.args.entry.knowledgeId='invented',f=>f.args.claimId='invented',f=>f.args.entry.autoExecute=true,f=>f.knowledge.status='Invalidado']){
  const f=fixture();change(f);assert.throws(()=>enrollProposalLearning(f.state,f.args,now));assert.equal(f.state.learningEnrollments,undefined);
 }
});
test('changed hypotheses and retroactive enrollment clocks cannot be resealed as prospective evidence',()=>{
 const f=fixture();enrollProposalLearning(f.state,f.args,now);f.state.learningEnrollments[0].createdAt=iso(now-1);assert.equal(proposalLearningEnrollment(f.state,f.proposal,now),null);f.state.learningEnrollments[0].createdAt=iso(now);
 recordKnowledge(f.state,{...f.knowledge,id:f.knowledge.id,expectedRevision:1,claim:'Revised after observing the action.'},iso(now));assert.equal(proposalLearningEnrollment(f.state,f.proposal,now),null);
});
test('application chronology and exact campaign/account/version stay bound after enrollment',()=>{
 for(const mutate of [f=>f.proposal.signature='other',f=>f.proposal.payload.objectId='other',f=>f.proposal.payload.adAccountId='other',f=>f.state.executions=[{proposalId:'proposal',submittedAt:iso(now-1)}]]){
  const f=fixture();enrollProposalLearning(f.state,f.args,now);mutate(f);assert.equal(proposalLearningEnrollment(f.state,f.proposal,now),null);
 }
});
function confirmed(f){
 enrollProposalLearning(f.state,f.args,now);const applied=iso(now+3600000),evaluated=now+3*day;
 const row={id:'internal',externalId:'current',adAccountId:'local',provider:'meta',status:'ACTIVE',dailyBudget:80,budgetCurrency:'BRL'};
 const execution={id:'execution',project:'p',proposalId:'proposal',proposalVersion:1,proposalSignature:'seal',status:'Confirmada',submittedAt:iso(now+3599000),confirmedAt:applied,leaseUntil:applied,preflight:{fetchedAt:applied,row:{id:'internal'}},readback:{source:'Malva MCP',complete:true,projectId:'p',level:'campaign',fetchedAt:applied,row}};
 Object.assign(f.proposal,{status:'Aprovada',approvedVersion:1,approvedSignature:'seal',appliedAt:applied,executionConfirmedAt:applied,execution:structuredClone(execution)});f.state.executions=[execution];
 const start=Date.parse('2026-11-05T00:00:00Z'),metrics={spend:100,revenueNet:150,adCosts:0,productCost:0,saleTax:0,frontOrders:2};
 for(const [from,to,values] of [[start-day,start,metrics],[start+day,start+2*day,{...metrics,revenueNet:250,frontOrders:3}]])f.state.snapshots.push({projectId:'p',level:'campaign',source:'Malva MCP',complete:true,from:iso(from),to:iso(to),fetchedAt:iso(evaluated-1000),lastSyncAt:iso(evaluated-1000),timezone:'UTC',rows:[{...row,...values}]});
 return evaluated;
}
test('automatic measurement links only the hypothesis enrolled before the confirmed application',()=>{
 const f=fixture(),evaluated=confirmed(f),before={proposal:structuredClone(f.proposal),execution:structuredClone(f.state.executions)};
 assert.equal(processAutonomousLearning(f.state,evaluated).recorded,1);const o=f.state.knowledgeOutcomes[0];assert.equal(o.knowledgeId,f.knowledge.id);assert.equal(o.knowledgeRevision,1);assert.equal(o.knowledgeRegisteredAt,f.knowledge.updatedAt);assert.equal(learningCyclePlan(f.state,'p',evaluated).items[0].counts.prospective,1);assert.equal(learningCyclePlan(f.state,'p',evaluated).stats.advisory,0);assert.deepEqual(f.proposal,before.proposal);assert.deepEqual(f.state.executions,before.execution);
});
test('revision after application cannot borrow a historical win for the new hypothesis',()=>{
 const f=fixture(),evaluated=confirmed(f);recordKnowledge(f.state,{...f.knowledge,id:f.knowledge.id,expectedRevision:1,claim:'New hypothesis learned after application.'},iso(now+2*3600000));
 assert.equal(processAutonomousLearning(f.state,evaluated).recorded,1);assert.equal(f.state.knowledgeOutcomes[0].knowledgeId,null);assert.equal(learningCyclePlan(f.state,'p',evaluated).items[0].counts.prospective,0);
});
test('structured synthesis may enroll only a supplied, fresh hypothesis of the same project and revision',async()=>{
 const context={project:'p',campaigns:[{target:{adAccountId:'local',externalId:'current'}}],learning:[{id:'k',project:'p',revision:1,enrollmentEligible:true}]};
 const output={decision:'Conter',reason:'Perda nova',nextStep:'Aguardar aprovação',text:'Hipótese anterior ao resultado.',question:null,suggestions:[{adAccountId:'local',objectId:'current',action:'reduce',percent:20,reason:'Conter perda',learning:{knowledgeId:'k',knowledgeRevision:1,reason:'Hipótese contextual de contenção.'}}]};
 let request;assert.equal((await runCloudAnalyst({run:async(_m,r)=>{request=r;return {response:output};}},'ops',context)).suggestions[0].learning.knowledgeId,'k');
 assert.deepEqual(request.response_format.json_schema.properties.suggestions.items.properties.learning.anyOf[0].properties.knowledgeId.enum,['k']);
 for(const modify of [c=>c.learning[0].project='q',c=>c.learning[0].revision=2,c=>c.learning[0].enrollmentEligible=false]){const c=structuredClone(context);modify(c);await assert.rejects(runCloudAnalyst({run:async()=>({response:output})},'ops',c),e=>e.code==='CLOUD_LEARNING_ENROLLMENT_SCOPE');}
});
