import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareAuth} from '../lib/cloudflare-auth.mjs';

// Synthetic credentials only.
const secret='w'.repeat(40),project='proj-aaaa';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',BUNKER_OWNER_EMAIL:'owner@example.com',BUNKER_AGENT_TOKEN:'agent-test',MALVA_WEBHOOK_SECRET:secret};
const forged={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com','X-Bunker-Companion':'owner','x-bunker-owner-device':'mac-touchid:x','x-bunker-webhook':'malva','x-bunker-webhook-project':'other'};
const internal=['oai-authenticated-user-id','oai-authenticated-user-email','x-bunker-companion','x-bunker-owner-device','x-bunker-webhook','x-bunker-webhook-project'];

test('Static assets pass without identity and never carry forged internal headers', async () => {
 for(const path of ['/_next/static/a.js','/fonts/x.woff2','/favicon.svg']){
  const r=await cloudflareAuth(new Request('https://b.example'+path,{headers:forged}),env);
  assert.ok(r instanceof Request,path);for(const h of internal)assert.equal(r.headers.has(h),false,path+' '+h);
 }
});

test('Malformed webhook addresses fail before the body is read', async () => {
 const post=(path,init={})=>cloudflareAuth(new Request('https://b.example/api/webhooks/malva/'+path,{method:'POST',body:'{}',...init}),env);
 assert.equal((await post(`${secret}/${project}`,{method:'GET',body:undefined})).status,405);
 assert.equal((await post(`${secret}`)).status,400,'project id is required');
 assert.equal((await post(`${secret}/${project}/extra`)).status,400);
 assert.equal((await post(`${secret}/ab`)).status,400,'too short to be a Malva id');
 assert.equal((await post(`${secret}/..%2F..%2Fadmin`)).status,400,'encoded traversal is not an id');
 assert.equal((await post(`%E0%A4%A/${project}`)).status,401,'bad escape is just not the secret');
 assert.equal((await post(`${'w'.repeat(39)}/${project}`)).status,401,'near-miss secret');
 assert.equal((await post(`${secret.toUpperCase()}/${project}`)).status,401);
 assert.equal((await post(`${secret}/${project}`,{headers:{'content-length':'64001'}})).status,413);
 const big=await post(`${secret}/${project}`,{body:'x'.repeat(64001)});assert.equal(big.status,413);
});

test('A valid webhook is forwarded with only the boundary\'s own project header', async () => {
 const r=await cloudflareAuth(new Request(`https://b.example/api/webhooks/malva/${secret}/${project}`,{method:'POST',body:'{"a":1}',headers:{...forged,cookie:'bunker_access=x',authorization:'Bearer agent-test'}}),env);
 assert.ok(r instanceof Request);assert.equal(new URL(r.url).pathname,'/api/webhooks/malva','secret leaves the path');
 assert.equal(r.headers.get('x-bunker-webhook-project'),project);assert.equal(r.headers.get('x-bunker-webhook'),'malva');
 for(const h of ['cookie','authorization','oai-authenticated-user-id','x-bunker-companion','x-bunker-owner-device'])assert.equal(r.headers.has(h),false,h);
});

test('The webhook stays closed when its secret is short, missing or reused from another credential', async () => {
 const call=e=>cloudflareAuth(new Request(`https://b.example/api/webhooks/malva/${secret}/${project}`,{method:'POST',body:'{}'}),e);
 assert.equal((await call({...env,MALVA_WEBHOOK_SECRET:undefined})).status,503);
 assert.equal((await call({...env,MALVA_WEBHOOK_SECRET:'short'})).status,503);
 for(const k of ['BUNKER_AGENT_TOKEN','BUNKER_CLAUDE_AGENT_TOKEN','BUNKER_STORAGE_TOKEN','BUNKER_COMPANION_TOKEN','SUPABASE_SERVICE_ROLE_KEY'])assert.equal((await call({...env,[k]:secret})).status,503,k);
});

test('Owner device route: GET refused, no key fails closed, garbage body is a fixed error', async () => {
 assert.equal((await cloudflareAuth(new Request('https://b.example/api/companion/owner'),env)).status,405);
 const none=await cloudflareAuth(new Request('https://b.example/api/companion/owner',{method:'POST',body:'{}'}),env);
 assert.equal(none.status,503);
 const bad=await cloudflareAuth(new Request('https://b.example/api/companion/owner',{method:'POST',body:'not json'}),{...env,BUNKER_OWNER_DEVICE_KEY:'x'.repeat(60)});
 assert.ok([401,503].includes(bad.status));const j=await bad.json();assert.match(j.code,/^OWNER_DEVICE_[A-Z_]+$/);
});
