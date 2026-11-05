import {CloudError} from './cloud-malva.mjs';
const policies=Object.freeze({
 legacy:Object.freeze({id:'legacy',model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',label:'Workers AI Llama 3.3 70B',contextBytes:40000,retryContextBytes:24000,stageOutputTokens:3200,otherOutputTokens:2200,responseKind:'response'}),
 wide:Object.freeze({id:'wide',model:'@cf/openai/gpt-oss-120b',label:'Workers AI gpt-oss-120b',contextBytes:160000,retryContextBytes:80000,stageOutputTokens:6400,otherOutputTokens:4400,responseKind:'choices'})
});
export function cloudModelPolicy(id='legacy'){if(!Object.hasOwn(policies,id))throw new CloudError('CLOUD_AI_POLICY');return policies[id];}
/** Only the final assistant content is decoded. Provider reasoning never becomes an opinion or a tool command. */
export function cloudModelContent(response,policy){
 if(policy.responseKind!=='choices')return response?.response;
 const choice=response?.choices?.[0];
 if(response?.choices?.length!==1||choice?.finish_reason!=='stop'||choice?.message?.role!=='assistant'||typeof choice.message.content!=='string'||!choice.message.content.trim())throw new CloudError('CLOUD_AI_INVALID');
 return choice.message.content;
}
// Production opts in explicitly; direct callers retain the legacy policy unless requested.
export const cloudProductionModelPolicy='wide';
