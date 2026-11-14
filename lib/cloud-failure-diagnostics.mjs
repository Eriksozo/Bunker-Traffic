import {safeModelFailure} from './cloud-model-diagnostics.mjs';
import {safeMemoryReviewFailure} from './memory-review-failure.mjs';
import {safeMcpDiagnostic} from './cloud-malva.mjs';
import {safeStorageDiagnostic} from './supabase-storage.mjs';
const storageField=error=>{const storage=safeStorageDiagnostic(error?.storage);return storage?{storage}:{};};
const allowedPhases=new Set(['reservation','identity','campaigns','research','learning','persist']);
/** Sub-steps of the persist phase (lib/cloud-engine.mjs): rereading the central, the reservation, the priority check,
 * history, the import validation, external learning, the research record, the round conclusion and the storage commit. */
export const persistSteps=Object.freeze(['read','reservation','priority','history','import','learning','research','conclude','commit']);
const errorKinds=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','ZodError','CloudError']);
/**
 * Local causes recognized by the fixed beginning of the messages the Bunker itself throws (curadoria of 14/11/2026:
 * a plain Error in the persist phase used to become CLOUD_COLLECTION_FAILED with nothing else). Only the static code
 * below is kept: never the message, a value, a name or a key. Unknown messages stay "unclassified".
 * [pattern, cause, detail]
 */
const knownCauses=Object.freeze([
 // Source validation (lib/analysis-validation.mjs).
 [/^Leitura anterior à base salva\./,'base-older'],
 [/^A mesma data de consulta possui conteúdo diferente\./,'base-same-time-different'],
 [/^Data de consulta ou sincronização no futuro\./,'clock-future'],
 [/^Conferência da campanha indisponível fora da coleta\./,'unavailable-check-time'],
 [/^Campanha indisponível sem identidade previamente acompanhada\./,'unavailable-identity'],
 [/^Janela duplicada no mesmo lote de análise\./,'duplicate-window'],
 [/^Objeto duplicado na mesma janela\./,'duplicate-object'],
 [/^Identidade do projeto vazia\./,'project-identity'],
 [/^Linha com identidade, projeto ou nível incompatíveis com a janela\./,'row-identity'],
 [/^Período da janela precisa de data ISO 8601/,'period-format'],
 [/^O recorte de acompanhamento não pode substituir/,'coverage-in-analysis'],
 [/^Escopo operacional/,'scope-incomplete'],
 [/^(Período ou fuso inválido na fonte financeira|Janelas financeiras precisam de dias completos|As janelas fechadas não terminam no início do dia atual)/,'financial-period'],
 // Round conclusion (lib/agent-state.ts updateRun).
 [/^Rodada incompleta: faltam quatro leituras/,'conclude-readings-before-start'],
 [/^Reserva expirada/,'conclude-lease-expired'],
 [/^Rodada substituída/,'conclude-replaced'],
 [/^Rodada já encerrada/,'conclude-closed'],
 [/^Inicie a rodada antes de concluir/,'conclude-not-started'],
 [/^Escritório pausado/,'paused'],
 // Storage codecs (lib/snapshot-storage.mjs, lib/core-storage.mjs, lib/persistence.mjs).
 [/^Leituras armazenadas inválidas: tamanho das leituras acima do limite/,'snapshot-codec','raw-limit'],
 [/^Leituras armazenadas inválidas: (tamanho compactado|expansão) acima do limite/,'snapshot-codec','encoded-limit'],
 [/^Leituras armazenadas inválidas: quantidade de leituras/,'snapshot-codec','snapshot-count'],
 [/^Leituras armazenadas inválidas: linhas ausentes ou acima do limite/,'snapshot-codec','rows-per-snapshot'],
 [/^Leituras armazenadas inválidas: quantidade de linhas/,'snapshot-codec','row-count'],
 [/^Leituras armazenadas inválidas/,'snapshot-codec','other'],
 [/^Histórico armazenado inválido/,'core-codec'],
 [/^Leituras acima do limite por registro/,'storage-limit','snapshot-record'],
 [/^Limite de armazenamento da central/,'storage-limit','central'],
 [/^Histórico arquivado ausente ou inconsistente/,'storage-integrity'],
 [/^CONFLICT$/,'revision-conflict'],
]);
/** {cause, causeDetail?, errorKind}: static codes only (see knownCauses). */
export function failureCause(error){
 const errorKind=errorKinds.has(error?.name)?error.name:error instanceof Error?'other':'non-error';
 const message=typeof error?.message==='string'?error.message:'';
 for(const [pattern,cause,detail] of knownCauses)if(pattern.test(message))return {cause,...(detail?{causeDetail:detail}:{}),errorKind};
 if(errorKind==='ZodError')return {cause:'schema',errorKind};
 if(/^[A-Z][A-Z0-9_]{2,79}$/.test(error?.code||''))return {cause:'coded',errorKind};
 return {cause:'unclassified',errorKind};
}
export function collectionFailure(error,{project,jobId,phase,step=null},now=Date.now()){
 return {kind:'collectionFailure',project,jobId,phase:allowedPhases.has(phase)?phase:'campaigns',...(persistSteps.includes(step)?{step}:{}),code:/^[A-Z][A-Z0-9_]{2,79}$/.test(error?.code||'')?error.code:error?.message==='CONFLICT'?'CLOUD_REVISION_CONFLICT':error?.name==='ZodError'?'SOURCE_SCHEMA_INVALID':'CLOUD_COLLECTION_FAILED',...failureCause(error),at:new Date(now).toISOString(),...safeMcpDiagnostic(error),...storageField(error)};
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
 const memoryReviewFailure=code==='CLOUD_MEMORY_REVIEW_EVIDENCE'?safeMemoryReviewFailure(error?.memoryReviewFailure):null;
 const event={at:new Date(now).toISOString(),kind:'failure',code,...error?.collectionFailure?{collection:error.collectionFailure}:{},...(modelFailure?{modelFailure}:{}),...(memoryReviewFailure?{memoryReviewFailure}:{}),...storageField(error)};
 return {...runtime,lastError:code,lastErrorDetail:String(error?.message||code).replace(/(?:mck_|mvk_|sb_secret_)[A-Za-z0-9_-]+/g,'[redacted]').replace(/eyJ[A-Za-z0-9_.-]{20,}/g,'[redacted]').slice(0,400),lastUnitAt:event.at,lastFailure:event,history:[event,...(runtime.history||[])].slice(0,30)};
}
