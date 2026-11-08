import {CloudError} from './cloud-malva.mjs';
import {modelOutputFailure,modelContentSize,modelTailRepetition} from './cloud-model-diagnostics.mjs';
const policies=Object.freeze({
 legacy:Object.freeze({id:'legacy',model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',label:'Workers AI Llama 3.3 70B',contextBytes:40000,retryContextBytes:24000,stageOutputTokens:3200,otherOutputTokens:2200,responseKind:'response',truncationRetry:null}),
 wide:Object.freeze({id:'wide',model:'@cf/openai/gpt-oss-120b',label:'Workers AI gpt-oss-120b',contextBytes:160000,retryContextBytes:80000,stageOutputTokens:6400,otherOutputTokens:4400,responseKind:'choices',
  // After a cut (finish 'length') the same stage retries with OpenAI's recommended gpt-oss sampling to leave a
  // low-temperature loop. Same token cap, no extra call or attempt.
  truncationRetry:Object.freeze({temperature:1,topP:1})})
});
export function cloudModelPolicy(id='legacy'){if(!Object.hasOwn(policies,id))throw new CloudError('CLOUD_AI_POLICY');return policies[id];}
/** The native binding uses different JSON schema contracts for the two model families.
 * GPT-OSS takes the Chat Completions wrapper, as declared by Workers AI's per-model inputs.
 * Keep the exact schema intact; provider constraints never replace server-side validation.
 */
export function cloudModelOptions(policy,schema){
 if(policy.id==='wide')return {reasoning_effort:'low',response_format:{type:'json_schema',json_schema:{name:'bunker_agent_opinion_v1',schema}}};
 return {response_format:{type:'json_schema',json_schema:schema}};
}
/** True only for content that is exactly one complete JSON object plus edge whitespace (no prose, marker or fence). */
export function completeBeforeWhitespace(content){
 if(typeof content!=='string')return false;const t=content.trim();
 if(!t.startsWith('{')||!t.endsWith('}'))return false;
 try{const v=JSON.parse(t);return !!v&&typeof v==='object'&&!Array.isArray(v);}catch{return false;}
}
/** Only the final assistant content is decoded. Provider reasoning never becomes an opinion or a tool command. */
export function cloudModelContent(response,policy){
 if(policy.responseKind!=='choices')return response?.response;
 const choice=response?.choices?.[0];
 if(!Array.isArray(response?.choices)||response.choices.length!==1)throw modelOutputFailure(response,'envelope','unexpected_envelope');
 if(choice?.finish_reason==='length'){const c=choice?.message?.content;
  // gpt-oss whitespace loop (owner decision 08/11/2026): the answer is one complete JSON object and only whitespace
  // follows until the cap. Dropping that whitespace changes nothing in the answer and every validation still runs.
  // A cut object, extra text, markers or fences stay refused as truncated.
  if(choice?.message?.role==='assistant'&&completeBeforeWhitespace(c))return c.trim();
  throw modelOutputFailure(response,'envelope','output_truncated',{contentPresent:typeof c==='string'&&c.trim().length>0,...(typeof c==='string'?{contentSize:modelContentSize(c)}:{}),...modelTailRepetition(c)});}
 if(choice?.finish_reason!=='stop'||choice?.message?.role!=='assistant')throw modelOutputFailure(response,'envelope','unexpected_envelope');
 if(typeof choice.message.content!=='string'||!choice.message.content.trim())throw modelOutputFailure(response,'envelope','no_final_content');
 return choice.message.content;
}
// Production opts in explicitly; direct callers retain the legacy policy unless requested.
export const cloudProductionModelPolicy='wide';
