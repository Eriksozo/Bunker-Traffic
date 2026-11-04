/** Dedicated server MCP transport. No desktop, browser cookies or GPT session. */
export const cloudReadTools=Object.freeze(['workspace_whoami','tracking_list_projects','tracking_campaigns','tracking_ad_accounts','tracking_ad_detail','tracking_ad_changes','tracking_ad_changes_latest']);
export const cloudWriteTools=Object.freeze(['tracking_set_ad_budget','tracking_set_ad_status']);
export class CloudError extends Error{constructor(code){super(code);this.code=code;}}
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
export async function callRemoteMcp({key,tool,args={},fetch:request=globalThis.fetch}){
 key=typeof key==='string'?key.trim().replace(/^Bearer\s+/i,''):'';
 if(!key.startsWith('mck_'))throw new CloudError('MCP_KEY_REQUIRED');
 if(![...cloudReadTools,...cloudWriteTools].includes(tool))throw new CloudError('MCP_TOOL_NOT_ALLOWED');
 let r;try{r=await request('https://malvadash.com/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:tool,arguments:args}})});}catch{throw new CloudError('MCP_UNAVAILABLE');}
 if(!r.ok)throw new CloudError(r.status===401?'MCP_AUTH_FAILED':r.status===429?'MCP_RATE_LIMITED':'MCP_UNAVAILABLE');
 const body=await r.text();if(new TextEncoder().encode(body).length>16000000)throw new CloudError('MCP_SOURCE_LIMIT');let json;
 try{json=JSON.parse(body);}catch{for(const line of body.split('\n'))if(line.startsWith('data: ')){try{const x=JSON.parse(line.slice(6));if(x.id)json=x;}catch{}}}
 if(!json||json.error||!json.result)throw new CloudError('MCP_PROTOCOL');return unpackMcp(json.result);
}
/** Bounded data source. Read methods cannot accept a financial tool. */
export function cloudMalvaClient(db){return {async read(tool,args={}){if(!cloudReadTools.includes(tool))throw new CloudError('MCP_TOOL_NOT_ALLOWED');return db.rpc('malvaMcp',{tool,args});},async dispatch(command,execution){if(!cloudWriteTools.includes(command?.tool))throw new CloudError('MCP_TOOL_NOT_ALLOWED');return db.rpc('malvaMcp',{tool:command.tool,args:command.arguments,execution});}};}
