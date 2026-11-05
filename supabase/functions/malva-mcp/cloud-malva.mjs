/** Dedicated server MCP transport. No desktop, browser cookies or GPT session. */
export const cloudReadTools=Object.freeze(['workspace_whoami','tracking_list_projects','tracking_campaigns','tracking_ad_accounts','tracking_ad_detail','tracking_ad_changes','tracking_ad_changes_latest']);
export const cloudWriteTools=Object.freeze(['tracking_set_ad_budget','tracking_set_ad_status']);
export class CloudError extends Error{constructor(code){super(code);this.code=code;}}
export const mcpReadRecoveryPolicy=Object.freeze({version:1,attempts:2,attemptTimeoutMs:20000,totalBudgetMs:26000,backoffMs:500,maximumWaitMs:5000,minimumAttemptMs:1000});
const categories=new Set(['timeout','network','input-limit','validation','permission','rate-limit','unspecified']);
/** Only bounded metadata may cross the bridge; response bodies and headers never do. */
export function safeMcpDiagnostic(error){
 const out={};
 if(Number.isInteger(error?.providerStatus)&&error.providerStatus>=100&&error.providerStatus<=599)out.providerStatus=error.providerStatus;
 if(categories.has(error?.providerCategory))out.providerCategory=error.providerCategory;
 if(typeof error?.providerCode==='string'&&/^[A-Za-z0-9_-]{1,70}$/.test(error.providerCode)&&!/(?:mck_|mvk_|sb_secret_)/i.test(error.providerCode))out.providerCode=error.providerCode;
 if(Array.isArray(error?.providerFields))out.providerFields=error.providerFields.filter(k=>['projectId','accountIds','campaignIds','adsetIds','adIds','q','level','preset','from','to','limit','status','sales','provider','accountStatus','objectId'].includes(k));
 for(const [key,max] of [['transportAttempts',2],['elapsedMs',60000],['retryAfterMs',3600000]])if(Number.isFinite(error?.[key])&&error[key]>=0&&error[key]<=max)out[key]=Math.floor(error[key]);
 return out;
}
function retryDelay(header,now){
 if(typeof header!=='string'||!header.trim())return null;
 const s=header.trim(),ms=/^\d+(?:\.\d+)?$/.test(s)?Number(s)*1000:Date.parse(s)-now;
 return Number.isFinite(ms)?Math.max(0,ms):null;
}
function transient(error){
 if(['permission','validation','input-limit'].includes(error.providerCategory))return false;
 return error.code==='MCP_UNAVAILABLE'&&['network','timeout'].includes(error.providerCategory)||[408,429,500,502,503,504].includes(error.providerStatus);
}
function providerFailure(data){
 const nested=data?.error&&typeof data.error==='object'?data.error:data,e=new CloudError('MCP_TOOL_FAILED'),code=nested?.code??data?.code,status=nested?.status??data?.status;
 e.providerCode=typeof code==='string'&&/^[A-Za-z0-9_-]{1,70}$/.test(code)&&!/(?:mck_|mvk_|sb_secret_)/i.test(code)?code:null;
 e.providerStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
 const message=typeof nested?.message==='string'?nested.message:typeof data?.error==='string'?data.error:'';
 e.providerCategory=/timeout|timed out|deadline|tempo.*esgot/i.test(message)?'timeout':/too long|too many|maximum|tamanho|caracteres/i.test(message)?'input-limit':/invalid|validation|inválid/i.test(message)?'validation':/permission|forbidden|permiss/i.test(message)?'permission':/rate.?limit|muitas.*requisi/i.test(message)?'rate-limit':'unspecified';
 const allowed=new Set(['projectId','accountIds','campaignIds','adsetIds','adIds','q','level','preset','from','to','limit','status','sales','provider','accountStatus','objectId']);
 e.providerFields=(Array.isArray(nested?.fields)?nested.fields.map(x=>x?.path?.[0]):Object.keys(nested?.fields||{})).filter(k=>allowed.has(k));
 return e;
}
export function unpackMcp(result){
 let data=result?.structuredContent;
 if(data==null){const text=result?.content?.find(c=>c.type==='text')?.text;try{data=JSON.parse(text);}catch{if(result?.isError&&typeof text==='string'){try{data=JSON.parse(text.slice(text.indexOf('{')));}catch{}}else throw new CloudError('MCP_PROTOCOL');}if(data==null&&result?.isError&&typeof text==='string')data={message:text};}
 if(!result||typeof result!=='object'||result.isError||!data||typeof data!=='object'||data.error||data.ok===false||typeof data.status==='number'&&data.status>=400)throw providerFailure(data);
 return data;
}
export async function callRemoteMcp({key,tool,args={},fetch:request=globalThis.fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRecovery}){
 key=typeof key==='string'?key.trim().replace(/^Bearer\s+/i,''):'';
 if(!key.startsWith('mck_'))throw new CloudError('MCP_KEY_REQUIRED');
 if(![...cloudReadTools,...cloudWriteTools].includes(tool))throw new CloudError('MCP_TOOL_NOT_ALLOWED');
 const read=cloudReadTools.includes(tool),policy=mcpReadRecoveryPolicy,started=now(),failures=[];let attemptsMade=0;
 // Serialize once: malformed input is not a transient provider failure.
 let payload;try{payload=JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:tool,arguments:args}});}catch{throw new CloudError('MCP_REQUEST_INVALID');}
 for(let attempt=1;attempt<=(read?policy.attempts:1);attempt++){
  try{
   const remaining=policy.totalBudgetMs-(now()-started);if(read&&remaining<policy.minimumAttemptMs)throw new CloudError('MCP_RECOVERY_EXPIRED');
   let r;try{attemptsMade++;r=await request('https://malvadash.com/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},redirect:'error',signal:AbortSignal.timeout(Math.min(policy.attemptTimeoutMs,read?remaining:policy.attemptTimeoutMs)),body:payload});}catch(cause){const e=new CloudError('MCP_UNAVAILABLE');e.providerCategory=['TimeoutError','AbortError'].includes(cause?.name)?'timeout':'network';throw e;}
   if(!r.ok){
    const e=new CloudError(r.status===401?'MCP_AUTH_FAILED':r.status===403?'MCP_FORBIDDEN':r.status===429?'MCP_RATE_LIMITED':r.status>=400&&r.status<500&&r.status!==408?'MCP_REQUEST_FAILED':'MCP_UNAVAILABLE');
    e.providerStatus=r.status;e.providerCategory=r.status===429?'rate-limit':r.status===401||r.status===403?'permission':r.status===408?'timeout':r.status<500?'validation':'unspecified';
    const retry=retryDelay(r.headers.get('Retry-After'),now());if(retry!==null)e.retryAfterMs=Math.min(3600000,retry);
    try{await r.body?.cancel();}catch{}throw e;
   }
   let body;try{body=await r.text();}catch(cause){const e=new CloudError('MCP_UNAVAILABLE');e.providerCategory=['TimeoutError','AbortError'].includes(cause?.name)?'timeout':'network';throw e;}
   if(new TextEncoder().encode(body).length>16000000)throw new CloudError('MCP_SOURCE_LIMIT');let json;
   try{json=JSON.parse(body);}catch{for(const line of body.split('\n'))if(line.startsWith('data: ')){try{const x=JSON.parse(line.slice(6));if(x.id)json=x;}catch{}}}
   if(!json||json.error||!json.result)throw new CloudError('MCP_PROTOCOL');const data=unpackMcp(json.result);
   if(failures.length)try{onRecovery?.({tool,transportAttempts:attemptsMade,elapsedMs:Math.max(0,now()-started),failures});}catch{}
   return data;
  }catch(error){
   error.transportAttempts=attemptsMade;error.elapsedMs=Math.max(0,now()-started);
   const delay=error.retryAfterMs??policy.backoffMs,remaining=policy.totalBudgetMs-error.elapsedMs;
   if(!read||attempt>=policy.attempts||!transient(error)||delay>policy.maximumWaitMs||remaining-delay<policy.minimumAttemptMs)throw error;
   failures.push(safeMcpDiagnostic(error));await sleep(delay);
  }
 }
}
/** Bounded data source. Read methods cannot accept a financial tool. */
export function cloudMalvaClient(db){return {async read(tool,args={}){if(!cloudReadTools.includes(tool))throw new CloudError('MCP_TOOL_NOT_ALLOWED');return db.rpc('malvaMcp',{tool,args});},async dispatch(command,execution){if(!cloudWriteTools.includes(command?.tool))throw new CloudError('MCP_TOOL_NOT_ALLOWED');return db.rpc('malvaMcp',{tool:command.tool,args:command.arguments,execution});}};}
