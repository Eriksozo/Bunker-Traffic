import {CloudError} from './cloud-malva.mjs';
/**
 * Why a memory review was refused, as a fixed label (and the position of the evidence reference, 0-7), so the next
 * attempt of the same stage can correct exactly that. Never text, never a value; it does not relax any check.
 */
export const memoryReviewFailureReasons=Object.freeze([
 'references_format',          // evidenceReferences missing, not a list, more than 8, or mixed with indices
 'reference_shape',            // an item is not {observation,metric}
 'reference_not_in_packet',    // observation or metric absent from the frozen packet
 'not_in_reflection',          // the reference is not among the reflection's own citations
 'ambiguous_reflection',       // the same observation/metric appears more than once in the reflection citations
 'duplicate_reference',        // the same citation referenced twice
 'index_invalid',              // a resolved position outside the reflection citations
 'numeric_evidence_required',  // current numbers exist: at least one reference is required
 'inconclusive_required',      // no current numbers: stance must be inconclusive with no references
]);
const allowed=new Set(memoryReviewFailureReasons);
export function safeMemoryReviewFailure(value){
 if(!value||!allowed.has(value.reason))return null;
 return {reason:value.reason,...(Number.isInteger(value.index)&&value.index>=0&&value.index<8?{index:value.index}:{})};
}
export function memoryReviewError(reason,index=null){
 const error=new CloudError('CLOUD_MEMORY_REVIEW_EVIDENCE');const failure=safeMemoryReviewFailure({reason,index});if(failure)error.memoryReviewFailure=failure;return error;
}
