/** Dedicated Órbita server transport. It can only read production metadata. */
export const orbitaReadTools=Object.freeze(['quem_sou_eu','listar_cadastros','listar_producoes','listar_lateralizacoes']);
export class OrbitaError extends Error{constructor(code){super(code);this.code=code;}}
export async function callOrbitaMcp({key,tool,args={},fetch:request=globalThis.fetch}){
 if(!orbitaReadTools.includes(tool)||!args||typeof args!=='object'||Array.isArray(args))throw new OrbitaError('ORBITA_TOOL_NOT_ALLOWED');
 key=typeof key==='string'?key.trim().replace(/^Bearer\s+/i,''):'';
 if(!key||key.length>4000||/[\r\n]/.test(key))throw new OrbitaError('ORBITA_KEY_REQUIRED');
 let r;try{r=await request('https://dashops.forallsales.com.br/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:tool,arguments:args}})});}catch{throw new OrbitaError('ORBITA_UNAVAILABLE');}
 if(!r.ok)throw new OrbitaError(r.status===401||r.status===403?'ORBITA_AUTH_FAILED':r.status===429?'ORBITA_RATE_LIMITED':'ORBITA_UNAVAILABLE');
 const body=await r.text();if(new TextEncoder().encode(body).length>4000000)throw new OrbitaError('ORBITA_SOURCE_LIMIT');let json;
 try{json=JSON.parse(body);}catch{for(const line of body.split('\n'))if(line.startsWith('data: ')){try{const item=JSON.parse(line.slice(6));if(item.id)json=item;}catch{}}}
 if(!json?.result||json.error||json.result.isError)throw new OrbitaError('ORBITA_PROTOCOL');
 let data=json.result.structuredContent;
 if(data==null)try{data=JSON.parse(json.result.content?.find(c=>c.type==='text')?.text);}catch{throw new OrbitaError('ORBITA_PROTOCOL');}
 if(!data||typeof data!=='object'||data.error||data.ok===false)throw new OrbitaError('ORBITA_PROTOCOL');
 return data;
}
export function cloudOrbitaClient(db){return {async read(tool,args={}){if(!orbitaReadTools.includes(tool))throw new OrbitaError('ORBITA_TOOL_NOT_ALLOWED');return db.rpc('orbitaMcp',{tool,args});}};}
