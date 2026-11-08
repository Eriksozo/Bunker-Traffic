import {CloudError} from './cloud-malva.mjs';
const reasons={envelope:new Set(['unexpected_envelope','output_truncated','no_final_content']),json:new Set(['invalid_final_json']),schema:new Set(['invalid_schema'])};
/** Fixed labels for why final content did not parse (never the content itself). */
export const modelJsonShapes=Object.freeze(['empty','leading_text','trailing_text','multiple_values','harmony_marker','fenced','unterminated','invalid_syntax']);
const shapes=new Set(modelJsonShapes),sizes=new Set(['lt1k','1k-4k','4k-8k','8k-16k','gt16k']);
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1e9;
export function safeModelUsage(value){
 const usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(count(value?.[key]))usage[key]=value[key];
 // Reasoning is part of completion_tokens on gpt-oss; only the bounded count is kept.
 const reasoning=value?.reasoning_tokens??value?.completion_tokens_details?.reasoning_tokens;if(count(reasoning))usage.reasoning_tokens=reasoning;
 return usage;
}
/** Size bucket of the final content in UTF-8 bytes. */
export function modelContentSize(content){
 if(typeof content!=='string')return null;const n=new TextEncoder().encode(content).length;
 return n<1024?'lt1k':n<4096?'1k-4k':n<8192?'4k-8k':n<16384?'8k-16k':'gt16k';
}
/**
 * Whether the end of a cut output is one block repeated exactly (a generation loop), in linear time and without
 * keeping any text: only the last 8192 code units are scanned (KMP prefix function over the reversed tail).
 * True when the last >=256 characters are at least 4 copies of a unit of <=1024 characters.
 */
export function modelTailRepetition(text){
 if(typeof text!=='string')return {};
 const W=Math.min(text.length,8192);if(W<256)return {repetition:false};
 const at=i=>text.charCodeAt(text.length-1-i),pi=new Int32Array(W);
 for(let i=1;i<W;i++){let k=pi[i-1];while(k>0&&at(i)!==at(k))k=pi[k-1];if(at(i)===at(k))k++;pi[i]=k;}
 for(let L=W;L>=256;L--){const p=L-pi[L-1];if(p<=1024&&L>=4*p){
  let blank=true;for(let i=0;i<p&&blank;i++){const c=at(i);blank=c===32||c===9||c===10||c===13;}
  return {repetition:true,repetitionKind:blank?'whitespace':'text'};
 }}
 return {repetition:false};
}
/** Fixed metadata only: never retain generated content, reasoning, headers or arbitrary provider fields. */
export function safeModelFailure(value){
 if(!value||!Object.hasOwn(reasons,value.phase)||!reasons[value.phase].has(value.reason))return null;
 const out={version:1,phase:value.phase,reason:value.reason};
 if(['stop','length','content_filter','tool_calls','other'].includes(value.finishReason))out.finishReason=value.finishReason;
 if(value.phase==='json'&&shapes.has(value.shape))out.shape=value.shape;
 if(sizes.has(value.contentSize))out.contentSize=value.contentSize;
 if(typeof value.reasoningField==='boolean')out.reasoningField=value.reasoningField;
 if(typeof value.contentPresent==='boolean')out.contentPresent=value.contentPresent;
 if(value.phase==='envelope'&&typeof value.repetition==='boolean'){out.repetition=value.repetition;if(value.repetition&&['whitespace','text'].includes(value.repetitionKind))out.repetitionKind=value.repetitionKind;}
 if(Number.isSafeInteger(value.maxTokens)&&value.maxTokens>=1&&value.maxTokens<=131072)out.maxTokens=value.maxTokens;
 if(typeof value.temperature==='number'&&Number.isFinite(value.temperature)&&value.temperature>=0&&value.temperature<=5)out.temperature=value.temperature;
 if(value.adjustment==='after_output_truncated')out.adjustment=value.adjustment;
 const usage=safeModelUsage(value.usage);
 if(Object.keys(usage).length)out.usage=usage;
 return out;
}
/** Whether the provider returned a separate reasoning field (presence only, never its text). */
function reasoningField(response){
 const message=response?.choices?.[0]?.message;if(!message||typeof message!=='object')return undefined;
 return ['reasoning_content','reasoning'].some(k=>typeof message[k]==='string'&&message[k].trim().length>0);
}
export function modelOutputFailure(response,phase,reason,extra={}){
 const finish=response?.choices?.[0]?.finish_reason,error=new CloudError('CLOUD_AI_INVALID');
 error.modelFailure=safeModelFailure({phase,reason,...(typeof finish==='string'?{finishReason:['stop','length','content_filter','tool_calls'].includes(finish)?finish:'other'}:{}),usage:response?.usage,reasoningField:reasoningField(response),...extra});
 return error;
}
