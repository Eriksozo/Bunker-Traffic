import {authenticateServer} from './server-auth.mjs';
import {callOrbitaMcp,OrbitaError} from './cloud-orbita.mjs';
const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(!await authenticateServer(req,{service:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',secretKeys:Deno.env.get('SUPABASE_SECRET_KEYS')}))return result({error:'ORBITA_SERVER_AUTH_REQUIRED'},401);
 if(req.method!=='POST')return result({error:'Method not allowed'},405);
 try{
  const raw=await req.text();if(raw.length>20000)throw new OrbitaError('ORBITA_REQUEST_LIMIT');const input=JSON.parse(raw);
  if(Object.keys(input).some(k=>!['tool','args'].includes(k)))throw new OrbitaError('ORBITA_TOOL_NOT_ALLOWED');
  return result(await callOrbitaMcp({key:Deno.env.get('Orbita_token'),tool:input.tool,args:input.args}));
 }catch(error){return result({error:error instanceof OrbitaError?error.code:'ORBITA_BRIDGE_FAILED'},502);}
});
