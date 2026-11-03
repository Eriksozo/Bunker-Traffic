import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareAuth,withSessionCookies} from '../lib/cloudflare-auth.mjs';
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
test('expired owner access rotates both secure cookies and validates identity again',async(t)=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{
  calls.push(url);
  if(url.endsWith('/user'))return calls.length===1?new Response(null,{status:401}):Response.json({id:'owner-id',email:env.BUNKER_OWNER_EMAIL,email_confirmed_at:'2026-11-03'});
  return Response.json({access_token:'renewed',refresh_token:'rotated'});
 });
 const request=await cloudflareAuth(new Request('https://bunker.example/api/state',{headers:{cookie:'bunker_access=expired; bunker_refresh=refresh'}}),env);
 assert.ok(request instanceof Request);assert.equal(request.headers.get('oai-authenticated-user-id'),'owner-id');
 const response=withSessionCookies(request,new Response('ok'));
 assert.match(response.headers.get('set-cookie'),/bunker_access=renewed; HttpOnly; Secure; SameSite=Lax/);
 assert.match(response.headers.get('set-cookie'),/bunker_refresh=rotated/);assert.equal(calls.length,3);
});
test('confirmed non-owner session still cannot enter or obtain owner cookies',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'other',email:'other@example.com',email_confirmed_at:'2026-11-03'}));
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/session',{method:'POST',headers:{Origin:'https://bunker.example','Content-Type':'application/json'},body:JSON.stringify({access_token:'other-token'})}),env);
 assert.equal(r.status,403);assert.equal(r.headers.has('set-cookie'),false);
});
test('owner callback accepts a consumed JSON body and sets both session cookies',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'owner',email:env.BUNKER_OWNER_EMAIL,email_confirmed_at:'2026-11-03'}));
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/session',{method:'POST',headers:{Origin:'https://bunker.example','Content-Type':'application/json'},body:JSON.stringify({access_token:'owner-token',refresh_token:'owner-refresh'})}),env);
 assert.equal(r.status,204);assert.match(r.headers.get('set-cookie'),/bunker_access=owner-token/);assert.match(r.headers.get('set-cookie'),/bunker_refresh=owner-refresh/);
});
test('agent credential cannot enter the private storage gateway',async()=>{
 const r=await cloudflareAuth(new Request('https://bunker.example/internal/storage',{method:'POST',headers:{Authorization:'Bearer agent-test'},body:'{}'}),{...env,BUNKER_STORAGE_TOKEN:'storage-test'});
 assert.equal(r.status,401);
});
