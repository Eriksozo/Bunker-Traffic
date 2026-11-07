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
 for(const origin of ['https://attacker.example','null',undefined])for(const path of ['/auth/session','/auth/email'])assert.equal((await cloudflareAuth(new Request('https://bunker.example'+path,{method:'POST',headers:origin?{Origin:origin}:{}}),env)).status,403);
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
test('direct entry uses the configured private Site, ignores request destinations and retains email fallback',async()=>{
 const configured={...env,BUNKER_DIRECT_ACCESS_URL:'https://private-bunker.example.chatgpt.site/'};
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/login?return_to=https://attacker.example'),configured);
 assert.equal(r.status,303);assert.equal(r.headers.get('location'),configured.BUNKER_DIRECT_ACCESS_URL);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.has('set-cookie'),false);
 const alternate=await cloudflareAuth(new Request('https://bunker.example/auth/login?email=1'),configured);
 assert.equal(alternate.status,200);assert.equal(alternate.headers.get('Referrer-Policy'),'same-origin');assert.match(await alternate.text(),/Receber link de acesso/);
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/api/state'),configured)).status,401);
});
test('invalid optional direct destinations cannot redirect a visitor or weaken authentication',async()=>{
 for(const url of ['http://private.chatgpt.site/','https://attacker.example/','https://private.chatgpt.site.evil.example/','https://user:secret@private.chatgpt.site/','https://private.chatgpt.site/?token=test','https://private.chatgpt.site/other']){
  const r=await cloudflareAuth(new Request('https://bunker.example/auth/login'),{...env,BUNKER_DIRECT_ACCESS_URL:url});assert.equal(r.status,200);assert.equal(r.headers.has('location'),false);
 }
});
test('signing out clears native cookies and stops before automatic direct entry',async()=>{
 const configured={...env,BUNKER_DIRECT_ACCESS_URL:'https://private.chatgpt.site/'};
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/logout',{method:'POST',headers:{Origin:'https://bunker.example'}}),configured);
 assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/auth/login?signedout=1');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await cloudflareAuth(new Request('https://bunker.example'+r.headers.get('location')),configured)).status,200);
});
test('private gateway sends Malva reads to service-authenticated edge function, no arbitrary URL',async(t)=>{
 let call;t.mock.method(globalThis,'fetch',async(url,options)=>{call={url,options};return Response.json({source:'Malva API'});});
 const r=await cloudflareAuth(new Request('https://bunker.example/internal/storage',{method:'POST',headers:{Authorization:'Bearer storage-test'},body:JSON.stringify({operation:'malvaRead',input:{section:'projects'}})}),{...env,BUNKER_STORAGE_TOKEN:'storage-test'});
 assert.equal(r.status,200);assert.equal(call.url,'https://example.supabase.co/functions/v1/malva-read');assert.equal(call.options.headers.Authorization,'Bearer server-test');assert.deepEqual(JSON.parse(call.options.body),{section:'projects'});
});
test('private gateway sends Órbita metadata through its separate authenticated function',async(t)=>{
 let call;t.mock.method(globalThis,'fetch',async(url,options)=>{call={url,options};return Response.json({email:'owner@example.com'});});
 const r=await cloudflareAuth(new Request('https://bunker.example/internal/storage',{method:'POST',headers:{Authorization:'Bearer storage-test'},body:JSON.stringify({operation:'orbitaMcp',input:{tool:'quem_sou_eu',args:{}}})}),{...env,BUNKER_STORAGE_TOKEN:'storage-test'});
 assert.equal(r.status,200);assert.equal(call.url,'https://example.supabase.co/functions/v1/orbita-mcp');assert.equal(call.options.headers.Authorization,'Bearer server-test');assert.deepEqual(JSON.parse(call.options.body),{tool:'quem_sou_eu',args:{}});
});
const claudeToken='claude-agent-test-0123456789abcdef0123456789';
const withClaude={...env,BUNKER_STORAGE_TOKEN:'storage-test',BUNKER_CLAUDE_AGENT_TOKEN:claudeToken};
const mcp=(token,extra={})=>new Request('https://bunker.example/mcp',{method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...extra},body:'{}'});
test('dedicated Claude credential enters MCP without owner identity while the legacy agent credential keeps working',async()=>{
 for(const token of [claudeToken,'agent-test']){
  const result=await cloudflareAuth(mcp(token,{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}),withClaude);
  assert.ok(result instanceof Request);assert.equal(result.headers.has('oai-authenticated-user-id'),false);assert.equal(result.headers.has('oai-authenticated-user-email'),false);
 }
 for(const token of [undefined,'wrong',claudeToken+'x','storage-test','server-test'])assert.equal((await cloudflareAuth(mcp(token),withClaude)).status,401);
});
test('dedicated Claude credential cannot reach storage, executor control, owner APIs or session creation',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({id:'owner',email:env.BUNKER_OWNER_EMAIL,email_confirmed_at:'2026-11-03'});});
 const auth={Authorization:'Bearer '+claudeToken};
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/internal/storage',{method:'POST',headers:auth,body:JSON.stringify({operation:'malvaMcp',input:{}})}),withClaude)).status,401);
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/internal/storage',{method:'POST',headers:auth,body:JSON.stringify({operation:'cloudExecutor',input:{action:'enable'}})}),{...withClaude,BUNKER_EXECUTOR:{getByName(){throw new Error('must not run');}}})).status,401);
 for(const path of ['/api/state','/api/collaboration','/api/cloud-executor','/']){
  const r=await cloudflareAuth(new Request('https://bunker.example'+path,{method:'POST',headers:{...auth,'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}}),withClaude);
  assert.ok(r instanceof Response);assert.ok([303,401].includes(r.status));
 }
 const session=await cloudflareAuth(new Request('https://bunker.example/auth/session',{method:'POST',headers:{...auth,Origin:'https://bunker.example','Content-Type':'application/json'},body:'{}'}),withClaude);
 assert.equal(session.status,400);assert.equal(session.headers.has('set-cookie'),false);assert.equal(calls,0);
});
test('missing, short or reused dedicated Claude credential fails closed without affecting the legacy agent',async()=>{
 const legacy='agent-legacy-0123456789abcdef0123456789abcdef',storage='storage-0123456789abcdef0123456789abcdef',service='service-0123456789abcdef0123456789abcdef';
 const base={...env,BUNKER_AGENT_TOKEN:legacy,BUNKER_STORAGE_TOKEN:storage,SUPABASE_SERVICE_ROLE_KEY:service};
 for(const value of [undefined,'','short-claude-token',legacy,storage,service]){
  const configured={...base,BUNKER_CLAUDE_AGENT_TOKEN:value};
  if(value&&value!==legacy)assert.equal((await cloudflareAuth(mcp(value),configured)).status,401);
  assert.ok((await cloudflareAuth(mcp(legacy),configured)) instanceof Request);
 }
});
const companionToken='companion-test-0123456789abcdef0123456789';
const withCompanion={...withClaude,BUNKER_COMPANION_TOKEN:companionToken};
test('Mac companion credential reads only GET /api/companion, without owner identity or its bearer downstream',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({});});
 const ok=await cloudflareAuth(new Request('https://bunker.example/api/companion?project=p',{headers:{Authorization:'Bearer '+companionToken,'oai-authenticated-user-id':'owner','x-bunker-companion':'write'}}),withCompanion);
 assert.ok(ok instanceof Request);assert.equal(ok.headers.get('x-bunker-companion'),'read');assert.equal(ok.headers.has('authorization'),false);assert.equal(ok.headers.has('oai-authenticated-user-id'),false);
 const auth={Authorization:'Bearer '+companionToken};
 for(const [path,method] of [['/mcp','POST'],['/internal/storage','POST'],['/api/state','GET'],['/api/state','POST'],['/api/companion','POST'],['/api/executor','POST']]){
  const r=await cloudflareAuth(new Request('https://bunker.example'+path,{method,headers:auth,...(method==='POST'?{body:'{}'}:{})}),withCompanion);
  assert.ok(r instanceof Response,path+' '+method);assert.ok([401,303].includes(r.status),path+' '+method);
 }
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/api/companion',{headers:{Authorization:'Bearer wrong'}}),withCompanion)).status,401);
 assert.equal(calls,0);
});
test('a forged companion header never authorizes and every reused or short companion credential fails closed',async()=>{
 const forged=await cloudflareAuth(new Request('https://bunker.example/api/companion',{headers:{'x-bunker-companion':'read'}}),withCompanion);assert.equal(forged.status,401);
 for(const value of [undefined,'','short-companion','agent-test','storage-test','server-test',claudeToken]){
  const r=await cloudflareAuth(new Request('https://bunker.example/api/companion',{headers:{Authorization:'Bearer '+(value||'x')}}),{...withClaude,BUNKER_COMPANION_TOKEN:value});
  assert.ok(r instanceof Response);assert.equal(r.status,401);
 }
});
test('a refused sign-in e-mail explains the Supabase reason without echoing the address',async(t)=>{
 const {otpFailure}=await import('../lib/cloudflare-auth.mjs');
 assert.equal((await otpFailure(new Response(JSON.stringify({error_code:'over_email_send_rate_limit'}),{status:429}))).status,429);
 assert.match((await otpFailure(new Response('{}',{status:429}))).message,/Limite de envio/);
 assert.equal((await otpFailure(new Response(JSON.stringify({error_code:'email_address_invalid'}),{status:400}))).code,'email_address_invalid');
 assert.equal((await otpFailure(new Response('oops',{status:502}))).status,503);
 assert.equal((await otpFailure(null)).code,'network');
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error_code:'over_email_send_rate_limit'}),{status:429}));
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/email',{method:'POST',headers:{Origin:'https://bunker.example','Content-Type':'application/x-www-form-urlencoded'},body:'email=owner%40example.com'}),env);
 assert.equal(r.status,429);const text=await r.text();assert.match(text,/Limite de envio/);assert.doesNotMatch(text,/owner@example/);
});


test('OTP cooldown distinguishes per-recipient seconds from hourly limits, never echoes raw messages',async(t)=>{
 const {otpFailure}=await import('../lib/cloudflare-auth.mjs');
 const perRecipient=await otpFailure(Response.json({error_code:'over_email_send_rate_limit',msg:'For security purposes, you can only request this after 59 seconds.'},{status:429}));
 assert.equal(perRecipient.retryAfter,59);assert.match(perRecipient.message,/59 segundos/);assert.doesNotMatch(perRecipient.message,/1 hora/);
 assert.equal((await otpFailure(Response.json({code:'over_email_send_rate_limit'},{status:429,headers:{'Retry-After':'120'}}))).retryAfter,120);
 assert.equal((await otpFailure(Response.json({code:'over_email_send_rate_limit'},{status:429}))).retryAfter,60);
 t.mock.method(globalThis,'fetch',async()=>Response.json({error_code:'over_email_send_rate_limit',msg:'wait after 39 seconds. private@example.com'}, {status:429}));
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/email',{method:'POST',headers:{Origin:'https://bunker.example','Content-Type':'application/x-www-form-urlencoded'},body:'email=owner%40example.com'}),env);
 assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'39');
 const body=await r.text();assert.match(body,/39 segundos/);assert.match(body,/bunker.auth.emailAfter/);assert.match(body,/b.disabled=true/);assert.doesNotMatch(body,/private@example.com/);
});

test('successful email request offers a guarded resend and does not claim delivery or grant access',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({}));
 const r=await cloudflareAuth(new Request('https://bunker.example/auth/email',{method:'POST',headers:{Origin:'https://bunker.example','Content-Type':'application/x-www-form-urlencoded'},body:'email=owner%40example.com'}),env);
 assert.equal(r.status,200);assert.equal(r.headers.has('Set-Cookie'),false);assert.equal(r.headers.get('Referrer-Policy'),'same-origin');
 const body=await r.text();assert.match(body,/Pedido aceito pelo serviço de login/);assert.match(body,/Date.now\(\)\+60\*1000/);assert.match(body,/pending=true;b.disabled=true/);
});


test('email form blocks double submit and keeps cooldown across a reload without auto-sending',async()=>{
 const {runInNewContext}=await import('node:vm');
 const html=await (await cloudflareAuth(new Request('https://bunker.example/auth/login?email=1'),env)).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 let now=100000,listener,tick;const storage=new Map();
 const form={addEventListener:(kind,handler)=>{assert.equal(kind,'submit');listener=handler;}},button={},hint={};
 const run=()=>runInNewContext(script,{document:{getElementById:id=>({'bunker-email-form':form,'bunker-email-submit':button,'bunker-email-wait':hint}[id])},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},Date:{now:()=>now},setInterval:fn=>{tick=fn;}});
 run();assert.equal(button.disabled,false);let prevented=0;
 listener({preventDefault:()=>prevented++});assert.equal(button.disabled,true);assert.equal(button.textContent,'Enviando…');
 listener({preventDefault:()=>prevented++});assert.equal(prevented,1);
 run();assert.equal(button.disabled,true);assert.match(button.textContent,/60s/);
 listener({preventDefault:()=>prevented++});assert.equal(prevented,2);
 now+=61000;tick();assert.equal(button.disabled,false);assert.equal(button.textContent,'Receber link de acesso');
});
