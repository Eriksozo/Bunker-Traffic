import {assertCollaborationWorker,fingerprint} from './collaboration.mjs';
import {readKnowledgePlan} from './knowledge.mjs';
const learningError=code=>Object.assign(new Error(code),{code});
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||'');
export const learningEnrollmentPolicy=Object.freeze({version:1,maximum:300,providerWrites:false});
/** Enroll before approval or application, never retrospectively after observing a win. */
export function enrollProposalLearning(state,args,now=Date.now()){
 const input=args.entry,proposal=arr(state.proposals).find(p=>p.id===input?.proposalId);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['project','proposalId','proposalVersion','proposalSignature','knowledgeId','knowledgeRevision','reason'].includes(k)))throw learningError('CLOUD_LEARNING_ENROLLMENT_INVALID');
 if(!proposal||proposal.project!==input.project||proposal.version!==input.proposalVersion||proposal.signature!==input.proposalSignature)throw learningError('CLOUD_LEARNING_ENROLLMENT_SCOPE');
 if(!Number.isFinite(now)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>400)throw learningError('CLOUD_LEARNING_ENROLLMENT_INVALID');
 const request=fingerprint({roundId:args.roundId,claimId:args.claimId,executionRef:args.executionRef,entry:input});
 const prior=arr(state.learningEnrollments).find(e=>e.proposalId===proposal.id);
 if(prior){if(prior.request!==request)throw learningError('CLOUD_LEARNING_ENROLLMENT_CONFLICT');return prior;}
 const worker=assertCollaborationWorker(state,args,now);
 if(worker.agentId!=='ops'||worker.project!==proposal.project||proposal.roundId!==args.roundId||proposal.status!=='Em revisão'||proposal.approvedVersion||proposal.execution||arr(state.executions).some(e=>e.proposalId===proposal.id)||at(proposal.createdAt)>now)throw learningError('CLOUD_LEARNING_ENROLLMENT_LATE');
 const knowledge=readKnowledgePlan(state,proposal.project,new Date(now).toISOString()).items.find(k=>k.id===input.knowledgeId);
 if(!knowledge||knowledge.revision!==input.knowledgeRevision||knowledge.status==='Invalidado'||knowledge.stale||at(knowledge.updatedAt)>at(proposal.createdAt))throw learningError('CLOUD_LEARNING_ENROLLMENT_HYPOTHESIS');
 if(arr(state.learningEnrollments).length>=learningEnrollmentPolicy.maximum)throw learningError('CLOUD_LEARNING_ENROLLMENT_CAPACITY');
 const payload=proposal.payload;
 const action=payload.action==='budget'?(payload.after.dailyBudget>payload.before.dailyBudget?'increase':'reduce'):payload.action==='status'&&payload.after.status==='PAUSED'?'pause':null;
 if(!action||payload.level!=='campaign'||String(payload.provider).toLowerCase()!=='meta')throw learningError('CLOUD_LEARNING_ENROLLMENT_SCOPE');
 const entry={id:crypto.randomUUID(),project:proposal.project,proposalId:proposal.id,proposalVersion:proposal.version,proposalSignature:proposal.signature,adAccountId:payload.adAccountId,objectId:payload.objectId,action,knowledgeId:knowledge.id,knowledgeRevision:knowledge.revision,knowledgeRegisteredAt:knowledge.updatedAt,reason:input.reason.trim(),roundId:args.roundId,claimId:args.claimId,executionRef:args.executionRef,createdAt:new Date(now).toISOString(),request};
 state.learningEnrollments=[...arr(state.learningEnrollments),entry];return entry;
}
/** Exact immutable association only; a changed hypothesis remains unlinked, not resealed after results. */
export function proposalLearningEnrollment(state,proposal,now=Date.now()){
 if(!proposal)return null;
 const e=arr(state.learningEnrollments).find(e=>e.proposalId===proposal.id),k=e&&arr(state.knowledge).find(k=>k.project===proposal.project&&k.id===e.knowledgeId);
 if(!e||!k||e.project!==proposal.project||e.proposalVersion!==proposal.version||e.proposalSignature!==proposal.signature||e.adAccountId!==proposal.payload?.adAccountId||e.objectId!==proposal.payload?.objectId||e.knowledgeRevision!==k.revision||e.knowledgeRegisteredAt!==k.updatedAt||at(k.updatedAt)>at(proposal.createdAt)||at(e.createdAt)>now||at(e.createdAt)<at(proposal.createdAt))return null;
 const sent=arr(state.executions).filter(x=>x.proposalId===proposal.id).map(x=>at(x.submittedAt)).filter(Number.isFinite);
 if(proposal.execution?.submittedAt)sent.push(at(proposal.execution.submittedAt));
 if(sent.length&&at(e.createdAt)>Math.min(...sent))return null;
 return structuredClone(e);
}
