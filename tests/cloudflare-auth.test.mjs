import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareAuth} from '../lib/cloudflare-auth.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',BUNKER_OWNER_EMAIL:'owner@example.com',BUNKER_AGENT_TOKEN:'agent-test'};
test('unconfigured external hosting fails closed and forged Sites identity does not authenticate',async()=>{
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/api/state'),{})).status,503);
 const forged=new Request('https://bunker.example/api/state',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}});
 assert.equal((await cloudflareAuth(forged,env)).status,401);
});
test('MCP requires its separate credential and never receives visitor supplied owner headers',async()=>{
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/mcp'),env)).status,401);
 const req=new Request('https://bunker.example/mcp',{method:'POST',headers:{Authorization:'Bearer agent-test','oai-authenticated-user-id':'owner'}});
 const result=await cloudflareAuth(req,env);assert.ok(result instanceof Request);assert.equal(result.headers.has('oai-authenticated-user-id'),false);
});
test('foreign origin cannot create a login session or trigger owner email',async()=>{
 for(const path of ['/auth/session','/auth/email'])assert.equal((await cloudflareAuth(new Request('https://bunker.example'+path,{method:'POST',headers:{Origin:'https://attacker.example'}}),env)).status,403);
});
