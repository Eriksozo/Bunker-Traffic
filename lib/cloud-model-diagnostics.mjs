import {CloudError} from './cloud-malva.mjs';
const reasons={envelope:new Set(['unexpected_envelope','output_truncated','no_final_content']),json:new Set(['invalid_final_json']),schema:new Set(['invalid_schema'])};
/** Fixed metadata only: never retain generated content, reasoning, headers or arbitrary provider fields. */
export function safeModelFailure(value){
 if(!value||!Object.hasOwn(reasons,value.phase)||!reasons[value.phase].has(value.reason))return null;
 const out={version:1,phase:value.phase,reason:value.reason};
 if(['stop','length','content_filter','tool_calls','other'].includes(value.finishReason))out.finishReason=value.finishReason;
 const usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(value.usage?.[key])&&value.usage[key]>=0&&value.usage[key]<=1e9)usage[key]=value.usage[key];
 if(Object.keys(usage).length)out.usage=usage;
 return out;
}
export function modelOutputFailure(response,phase,reason){
 const finish=response?.choices?.[0]?.finish_reason,error=new CloudError('CLOUD_AI_INVALID');
 error.modelFailure=safeModelFailure({phase,reason,...(typeof finish==='string'?{finishReason:['stop','length','content_filter','tool_calls'].includes(finish)?finish:'other'}:{}),usage:response?.usage});
 return error;
}
