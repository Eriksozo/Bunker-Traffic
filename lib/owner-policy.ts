import {env} from 'cloudflare:workers';
import {ownerShadowPolicy} from './autonomy-shadow.mjs';
/** The private Sombra policy with the owner's layer, as the Cloudflare executor reads it (worker/cloud-executor.ts
 * shadowPolicyFor), for the owner's daily-budget ceiling on hand-typed orders. Parsed in memory only: never logged,
 * returned to a client or stored. A missing or invalid secret means no ceiling, as in the Sombra. */
export function ownerPolicy(state:any):any{
 const parse=(raw:unknown)=>{try{const v=JSON.parse(typeof raw==='string'&&raw?raw:'{}');return v&&typeof v==='object'?v:{};}catch{return {};}};
 return ownerShadowPolicy(parse((env as any).AUTONOMY_SHADOW_POLICY),parse((env as any).AUTONOMY_SHADOW_OWNER),Object.keys(state?.config||{}));
}
