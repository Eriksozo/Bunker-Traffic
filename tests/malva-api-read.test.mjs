import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMalvaReader,malvaPeriods,malvaPath,validateMalvaRequest,readMalvaSource} from '../lib/malva-api-read.mjs';
const project={id:'11111111-1111-4111-8111-111111111111',name:'Example',timezone:'America/Sao_Paulo',currency:'BRL'},account='22222222-2222-4222-8222-222222222222';
const at=Date.parse('2026-11-04T15:00:00Z'),input={section:'campaigns',projectId:project.id,period:'four'};
function harness({invalid,stale=false}={}){let calls=[],count=0;const reader=createMalvaReader({key:'mvk_private-test-key',now:()=>at,fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/projects'))return Response.json([project]);count++;const q=new URL(url).searchParams,range={from:q.get('from'),to:q.get('to')};return Response.json({period:{timezone:project.timezone,days:[range.from,range.to]},level:'campaign',salesScope:{kind:'traffic'},currency:'BRL',rows:[{projectId:project.id,projectName:project.name,externalId:'123',name:'Example',adAccountId:account,provider:'meta',level:'campaign',spend:123,secret:'must-be-omitted',...invalid}],totals:{spend:123},lastSyncAt:'2026-11-04T14:50:00Z'},{headers:{'x-malva-fresh-at':'2026-11-04T14:59:59Z','x-malva-cache':stale?'stale':'fresh'}});}});return {reader,calls,count:()=>count};}
test('four windows close before today in the source timezone; handles local rollover',()=>{
 assert.deepEqual(malvaPeriods(at,project.timezone),{today:{from:'2026-11-04',to:'2026-11-04'},yesterday:{from:'2026-11-03',to:'2026-11-03'},'3d':{from:'2026-11-01',to:'2026-11-03'},'7d':{from:'2026-10-28',to:'2026-11-03'}});
 assert.equal(malvaPeriods(Date.parse('2026-11-04T01:00:00Z'),project.timezone).today.from,'2026-11-03');
});
test('parallel identical agent calls coalesce exact reads, retain source clocks and compact rows',async()=>{
 const h=harness(),[a,b]=await Promise.all([h.reader(input),h.reader(input)]);assert.equal(h.calls.length,5);assert.deepEqual(a,b);assert.equal(a.results.length,4);assert.equal(a.source,'Malva API');assert.equal(a.results[0].sourceFreshAt,'2026-11-04T14:59:59Z');assert.equal(a.results[0].data.lastSyncAt,'2026-11-04T14:50:00Z');assert.equal(a.results[0].data.rows[0].secret,undefined);
 await h.reader(input);assert.equal(h.calls.length,5);for(const c of h.calls){assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');assert.match(c.url,/^https:\/\/malvadash.com\/api\/v1\//);}
});
test('stale origin response remains explicitly stale and is not cached as fresh',async()=>{
 const h=harness({stale:true}),r=await h.reader(input);assert.equal(r.results[0].sourceCache,'stale');await h.reader(input);assert.equal(h.count(),8);
});
test('input forbids writes, arbitrary paths, malformed selectors and fabricated scopes',()=>{
 for(const v of [{...input,method:'DELETE'},{section:'events',projectId:project.id},{section:'https://evil.example'}, {...input,projectId:'../other'}, {...input,period:'custom',from:'2026-11-04',to:'2026-10-04'},{...input,objectId:'1/notes'},{section:'ad-accounts',projectId:project.id,period:'today'}])assert.throws(()=>validateMalvaRequest(v));
});
test('key scope, configured project and provider/identity are checked separately',async()=>{
 const h=harness();await assert.rejects(h.reader({...input,projectId:account}),e=>e.code==='MALVA_PROJECT_OUT_OF_SCOPE');assert.equal(h.count(),0);
 for(const invalid of [{projectId:account},{projectName:'Other'},{provider:'google'},{adAccountId:'bad'},{level:'ad'}])await assert.rejects(harness({invalid}).reader(input),e=>e.code==='MALVA_IDENTITY_INVALID');
 let calls=0;const db={rpc:async()=>{calls++;return {source:'Malva API',project};}},state={config:{[project.id]:{projectName:'Example'}},paused:true};assert.equal((await readMalvaSource(db,state,input)).project.id,project.id);assert.equal(state.paused,true);await assert.rejects(readMalvaSource(db,{config:{}},input));assert.equal(calls,1);await assert.rejects(readMalvaSource(db,{config:{[project.id]:{projectName:'Wrong'}}},input));
});
test('network/key/rate errors expose codes only and never echo provider text or key',async()=>{
 for(const [status,code] of [[401,'MALVA_KEY_INVALID'],[403,'MALVA_SCOPE_DENIED'],[429,'MALVA_RATE_LIMITED'],[500,'MALVA_UNAVAILABLE']]){
 const reader=createMalvaReader({key:'mvk_test-secret',fetch:async()=>new Response('test-secret',{status})});await assert.rejects(reader({section:'projects'}),e=>e.code===code&&!e.message.includes('test-secret'));
 }
});
test('edge deployment source stays identical and enforces service-only auth without browser CORS',()=>{
 assert.equal(readFileSync(new URL('../supabase/functions/malva-read/malva-api-read.mjs',import.meta.url),'utf8'),readFileSync(new URL('../lib/malva-api-read.mjs',import.meta.url),'utf8'));
 const source=readFileSync(new URL('../supabase/functions/malva-read/index.ts',import.meta.url),'utf8');assert.match(source,/SUPABASE_SERVICE_ROLE_KEY/);assert.match(source,/crypto.subtle.digest/);assert.match(source,/req.method!==\x27POST\x27/);assert.doesNotMatch(source,/Access-Control-Allow-Origin/);
});

test('secret pasted as a curl header is normalized without disclosing it; non-API key is rejected before fetch',async()=>{
 let calls=0,header;const read=createMalvaReader({key:' Authorization: Bearer mvk_example ',fetch:async(_url,opts)=>{calls++;header=opts.headers.Authorization;return Response.json([]);}});await read({section:'projects'});assert.equal(header,'Bearer mvk_example');
 const invalid=createMalvaReader({key:'mcp_wrong_kind',fetch:async()=>{calls++;}});await assert.rejects(invalid({section:'projects'}),e=>e.code==='MALVA_KEY_FORMAT_INVALID');assert.equal(calls,1);
});

test('detail uses internal UUID; hierarchy filters use platform parent IDs at the right level',()=>{
 assert.doesNotThrow(()=>validateMalvaRequest({section:'ad-detail',projectId:project.id,objectId:account}));
 assert.throws(()=>validateMalvaRequest({...input,objectId:'123'}));
 assert.throws(()=>validateMalvaRequest({...input,level:'adset',adsetId:'123'}));
 const q={...input,period:'today',level:'ad',campaignId:'111',adsetId:'222',objectId:'333'};assert.doesNotThrow(()=>validateMalvaRequest(q));
 const url=new URL('https://malvadash.com'+malvaPath(q,{from:'2026-11-04',to:'2026-11-04'}));assert.equal(url.searchParams.get('adId'),'333');assert.equal(url.searchParams.get('campaignId'),'111');assert.equal(url.searchParams.get('adsetId'),'222');
});
