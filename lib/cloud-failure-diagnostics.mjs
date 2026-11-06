import {safeModelFailure} from './cloud-model-diagnostics.mjs';
import {safeMcpDiagnostic} from './cloud-malva.mjs';
const allowedPhases=new Set(['reservation','identity','campaigns','research','learning','persist']);
export function collectionFailure(error,{project,jobId,phase},now=Date.now()){
 return {kind:'collectionFailure',project,jobId,phase:allowedPhases.has(phase)?phase:'campaigns',code:/^[A-Z][A-Z0-9_]{2,79}$/.test(error?.code||'')?error.code:error?.message==='CONFLICT'?'CLOUD_REVISION_CONFLICT':error?.name==='ZodError'?'SOURCE_SCHEMA_INVALID':'CLOUD_COLLECTION_FAILED',at:new Date(now).toISOString(),...safeMcpDiagnostic(error)};
}
/** Operational rolling diagnostics; full failure notes remain on the original jobs. */
export function preserveCollectionFailure(state,failure){
 const items=Array.isArray(state.cloudCollectionFailures)?state.cloudCollectionFailures:[];
 if(items.some(f=>f.jobId===failure.jobId&&f.code===failure.code&&f.phase===failure.phase))return;
 state.cloudCollectionFailures=[...items,failure].slice(-120);
}
export function runtimeFailure(runtime,error,now=Date.now()){
 const code=/^[A-Z][A-Z0-9_]{2,79}$/.test(error?.code||'')?error.code:error?.message==='CONFLICT'?'CLOUD_REVISION_CONFLICT':'CLOUD_STEP_FAILED';
 const modelFailure=code==='CLOUD_AI_INVALID'?safeModelFailure(error?.modelFailure):null;
 const event={at:new Date(now).toISOString(),kind:'failure',code,...error?.collectionFailure?{collection:error.collectionFailure}:{},...(modelFailure?{modelFailure}:{})};
 return {...runtime,lastError:code,lastErrorDetail:String(error?.message||code).replace(/(?:mck_|mvk_|sb_secret_)[A-Za-z0-9_-]+/g,'[redacted]').replace(/eyJ[A-Za-z0-9_.-]{20,}/g,'[redacted]').slice(0,400),lastUnitAt:event.at,lastFailure:event,history:[event,...(runtime.history||[])].slice(0,30)};
}
