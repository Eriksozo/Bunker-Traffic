import {fingerprint} from './collaboration.mjs';
/** Stable scope of a research revision, separate from model-facing packet formatting. */
export const researchHypothesisFingerprint=k=>fingerprint({id:k.id,project:k.project,revision:k.revision,claim:k.claim,status:k.status,sources:k.sources,updatedAt:k.updatedAt,agentOrigin:k.agentOrigin});
