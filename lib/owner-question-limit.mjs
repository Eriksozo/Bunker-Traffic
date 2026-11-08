import {safeModelFailure} from './cloud-model-diagnostics.mjs';
/**
 * An owner question is top priority, so a question the model cannot answer would otherwise abort every pulse.
 * Like stages, it gets three attempts per collection round: only deterministic model/validation failures count
 * (a provider outage never parks it), and a new round renews the attempts. Fixed metadata only.
 */
export const ownerQuestionAttempts=3;
const deterministic=/^CLOUD_(?:AI_INVALID|AI_SCOPE|CONTEXT_LIMIT|(?:REFLECTION|LEARNING|MEMORY_REVIEW|CAMPAIGN_READING|LEARNING_REVIEW|LEARNING_ENROLLMENT)_[A-Z_]+)$/;
export const countsTowardOwnerQuestionLimit=code=>typeof code==='string'&&deterministic.test(code);
/** The round the executor answers with (same lookup as the owner-question step). */
export const ownerQuestionRound=(state,project)=>(state.collaborationRounds||[]).find(r=>r.project===project)?.id||null;
/** Parked: three counted failures in the project's current round. A new round, or a new question, tries again. */
export function ownerQuestionParked(state,message){
 const f=state?.ownerQuestionFailures?.[message?.id];
 return !!f&&f.attempts>=ownerQuestionAttempts&&!!f.roundId&&f.roundId===ownerQuestionRound(state,message.project);
}
export function failOwnerQuestion(state,messageId,project,roundId,code,at=Date.now(),modelFailure=null){
 if(!countsTowardOwnerQuestionLimit(code))return null;
 const pending=new Set((state.messages||[]).filter(m=>m.status==='Pendente').map(m=>m.id)),prior=state.ownerQuestionFailures?.[messageId];
 const kept=Object.fromEntries(Object.entries(state.ownerQuestionFailures||{}).filter(([id])=>pending.has(id)&&id!==messageId).slice(-49));
 const attempts=prior?.roundId===roundId?(prior.attempts||0)+1:1;
 const safeModel=code==='CLOUD_AI_INVALID'?safeModelFailure(modelFailure):null;
 state.ownerQuestionFailures={...kept,[messageId]:{messageId,project,roundId,code,at:new Date(at).toISOString(),attempts:Math.min(ownerQuestionAttempts,attempts),...(safeModel?{modelFailure:safeModel}:{})}};
 return state.ownerQuestionFailures[messageId];
}
