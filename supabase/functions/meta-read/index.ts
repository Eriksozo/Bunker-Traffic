// Read-only Meta bridge for the Cloudflare executor (docs/connections.md). The token stays in this function's
// secret `Meta_Acess_Token`; only GET requests to the Graph API; only campaign schedule and today's delivery.
import {authenticateServer} from './server-auth.mjs';
import {readMetaCampaigns} from './meta-live.mjs';
const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(!await authenticateServer(req,{service:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',secretKeys:Deno.env.get('SUPABASE_SECRET_KEYS')}))return result({error:'META_SERVER_AUTH_REQUIRED'},401);
 if(req.method!=='POST')return result({error:'META_METHOD_NOT_ALLOWED'},405);
 try{
  const raw=await req.text();if(raw.length>20000)return result({error:'META_REQUEST_LIMIT'},400);
  const input=JSON.parse(raw);
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='ids')||!Array.isArray(input.ids))return result({error:'META_REQUEST_INVALID'},400);
  return result({at:new Date().toISOString(),...await readMetaCampaigns(fetch,Deno.env.get('Meta_Acess_Token')||'',input.ids)});
 }catch(error){const code=typeof (error as any)?.code==='string'&&/^META_[A-Z0-9_]+$/.test((error as any).code)?(error as any).code:'META_BRIDGE_FAILED';return result({error:code},502);}
});
