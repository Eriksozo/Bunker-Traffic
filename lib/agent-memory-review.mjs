import {z} from 'zod';
import {fingerprint} from './collaboration.mjs';
import {CloudError} from './cloud-malva.mjs';
const arr=x=>Array.isArray(x)?x:[];
export const memoryReviewSchema=z.object({reference:z.string().min(1).max(20),stance:z.enum(['apply','adapt','reject','inconclusive']),reason:z.string().trim().min(1).max(400),evidenceIndices:z.array(z.number().int().min(0).max(7)).max(8)}).strict();
/** Only entries actually delivered in this final packet can be confronted. */
export function memoryReviewOptions(context){
 const m=context.agentMemory;if(!m)return [];
 const entries=[];
 for(const [key,type,idKey] of [['episodes','episode','messageId'],['ownerFeedback','owner-choice','choiceId'],['measuredOutcomes','measured-case','outcomeId'],['externalResults','external-case','outcomeId'],['proposalFeedback','proposal-feedback','proposalId']])for(const [i,e] of arr(m[key]).entries()){
  if(typeof e?.[idKey]!=='string'||!e[idKey]||e.project&&e.project!==context.project||type==='episode'&&e.agentId&&e.agentId!==(context.role||m.role))continue;
  entries.push({type,id:e[idKey],path:`agentMemory.${key}[${i}]`,fingerprint:fingerprint(e)});
 }
 const counts=new Map();for(const e of entries){const k=JSON.stringify([e.type,e.id]);counts.set(k,(counts.get(k)||0)+1);}
 for(const e of arr(context.learning))if(e.agentOrigin?.kind==='cloud-reflection'&&e.agentOrigin.agentId===(context.role||m.role)&&e.agentOrigin.lastRecordedRevision===e.revision&&e.project===context.project&&e.status==='Hipótese'&&typeof e.researchFingerprint==='string'){
  entries.push({type:'research-hypothesis',id:e.id,path:`learning[${context.learning.indexOf(e)}]`,fingerprint:fingerprint(e)});const k=JSON.stringify(['research-hypothesis',e.id]);counts.set(k,(counts.get(k)||0)+1);
 }
 return entries.filter(e=>counts.get(JSON.stringify([e.type,e.id]))===1).map((e,i)=>({reference:'M'+i,...e}));
}
export function memoryReviewRequirements(context,numericRequired){
 const options=memoryReviewOptions(context);return {required:options.length>0,currentEvidenceRequired:!!numericRequired,options,rule:'Escolha uma referência real do pacote e confronte com o cenário atual. apply/adapt/reject/inconclusive são julgamentos, não eficácia. Na geração, evidenceReferences seleciona {observation,metric} que também esteja nas citations da própria reflection; não adivinhar posições. O servidor resolve evidenceIndices somente depois da conferência. Sem números atuais: somente inconclusive e referências vazias. Sem opções: memoryReview null.'};
}
/** Grounding proves reference/number availability, not semantic correctness or efficacy. */
export function validateMemoryReview(out,context,numericRequired){
 const options=memoryReviewOptions(context);let review=out.memoryReview;
 if(!options.length){if(review)throw new CloudError('CLOUD_MEMORY_REVIEW_SCOPE');return null;}
 if(!review)throw new CloudError('CLOUD_MEMORY_REVIEW_REQUIRED');
 const parsed=memoryReviewSchema.safeParse(review);if(!parsed.success)throw new CloudError('CLOUD_MEMORY_REVIEW_SCHEMA');review=parsed.data;
 const selected=options.find(o=>o.reference===review.reference);if(!selected)throw new CloudError('CLOUD_MEMORY_REVIEW_SCOPE');
 const citations=arr(out.reflection?.citations),seen=new Set();
 for(const i of review.evidenceIndices)if(!Number.isInteger(i)||i<0||i>=citations.length||seen.has(i))throw new CloudError('CLOUD_MEMORY_REVIEW_EVIDENCE');else seen.add(i);
 if(numericRequired&&!seen.size||!numericRequired&&(review.stance!=='inconclusive'||seen.size))throw new CloudError('CLOUD_MEMORY_REVIEW_EVIDENCE');
 return {...review,version:1,sourceType:selected.type,sourceId:selected.id,sourceFingerprint:selected.fingerprint,packetMemoryFingerprint:fingerprint(context.agentMemory),referenceChecked:true,currentEvidenceRequired:!!numericRequired,currentEvidenceCount:seen.size,interpretation:'Confronto autoral com referência e números conferidos; não comprova interpretação correta, causalidade ou eficácia.'};
}
