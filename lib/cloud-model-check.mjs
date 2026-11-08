import {cloudModelPolicy,cloudModelOptions,cloudModelContent,cloudProductionModelPolicy} from './cloud-model-policy.mjs';
import {modelOutputFailure} from './cloud-model-diagnostics.mjs';
import {decodeModelJson} from './cloud-model-json.mjs';
/** Connectivity only: uses the production envelope/decoder, with no business data or contributions. */
export async function checkCloudModel(ai,policyId=cloudProductionModelPolicy){
 const policy=cloudModelPolicy(policyId),schema={type:'object',properties:{ok:{type:'boolean',const:true}},required:['ok'],additionalProperties:false};
 const response=await ai.run(policy.model,{messages:[{role:'system',content:'Return only the JSON object {"ok":true}. This is a connectivity check, not an analysis.'},{role:'user',content:'Check the structured response format.'}],max_tokens:256,temperature:0.1,...cloudModelOptions(policy,schema)});
 const content=cloudModelContent(response,policy),value=typeof content==='string'?decodeModelJson(content,response):content;
 if(!value||value.ok!==true||Object.keys(value).length!==1)throw modelOutputFailure(response,'schema','invalid_schema');
 return true;
}
