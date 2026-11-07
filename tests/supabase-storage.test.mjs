import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseStorage} from '../lib/supabase-storage.mjs';
test('Postgres transport keeps credentials server side and maps CAS without interpolating SQL',async()=>{
 const calls=[];const db=new SupabaseStorage({url:'https://example.supabase.co',key:'server-test-key',fetch:async(url,request)=>{calls.push({url,request});return Response.json({rows:[],changes:1});}});
 const sql='UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?';
 const result=await db.prepare(sql).bind('{"safe":true}',8,'now','central',7).run();
 assert.equal(result.meta.changes,1);assert.deepEqual(JSON.parse(calls[0].request.body),{operation:'cas',input:{key:'central',payload:'{"safe":true}',expected:7,updated_at:'now'}});
 assert.equal(calls[0].url,'https://example.supabase.co/rest/v1/rpc/bunker_store');
 assert.throws(()=>db.prepare('DROP TABLE bunker_records').operation());
});
test('central CAS and archives use a single RPC and preserve a failed CAS',async()=>{
 let sent;const db=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async(_,r)=>{sent=JSON.parse(r.body);return Response.json({changes:0});}});
 const first=db.prepare('UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?').bind('{}',2,'now','central',1);
 const archive=db.prepare('INSERT INTO bunker_records WHERE EXISTS').bind('suggestions:x','{}',1,'now','central',2,'token');
 const result=await db.batch([first,archive]);assert.equal(result[0].meta.changes,0);assert.equal(sent.operation,'commit');assert.equal(sent.input.archives[0].immutable,true);
});
test('missing credentials and provider failures never become empty successful reads',async()=>{
 assert.throws(()=>new SupabaseStorage({url:'http://example.com',key:'secret'}));
 const db=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async()=>new Response('private details',{status:503})});
 await assert.rejects(db.prepare('SELECT payload FROM bunker_records WHERE key=?').bind('central').first(),/503/);
});
test('revision polling requests only revision metadata while full reads retain the payload',async()=>{
 const calls=[];const db=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async(_,r)=>{calls.push(JSON.parse(r.body));return Response.json({rows:[{key:'central',revision:9,updated_at:'now'}]});}});
 const head=await db.prepare('SELECT revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first();
 assert.equal(head.revision,9);assert.equal(calls[0].input.projection,'revision');
 await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first();assert.equal(calls[1].input.projection,undefined);
});
test('direct Malva RPC uses the edge function and preserves sanitized actionable errors',async()=>{
 let call;const db=new SupabaseStorage({url:'https://example.supabase.co',key:'server-test',fetch:async(url,r)=>{call={url,r};return Response.json({error:'MALVA_KEY_FORMAT_INVALID'},{status:503});}});
 await assert.rejects(db.rpc('malvaRead',{section:'projects'}),e=>e.code==='MALVA_KEY_FORMAT_INVALID');assert.equal(call.url,'https://example.supabase.co/functions/v1/malva-read');assert.deepEqual(JSON.parse(call.r.body),{section:'projects'});
});
test('Órbita RPC reaches only its server bridge and preserves credential failures without leaking details',async()=>{
 let call;const db=new SupabaseStorage({url:'https://example.supabase.co',key:'server-test',fetch:async(url,r)=>{call={url,r};return Response.json({error:'ORBITA_AUTH_FAILED'},{status:502});}});
 await assert.rejects(db.rpc('orbitaMcp',{tool:'quem_sou_eu',args:{}}),e=>e.code==='ORBITA_AUTH_FAILED');assert.equal(call.url,'https://example.supabase.co/functions/v1/orbita-mcp');assert.deepEqual(JSON.parse(call.r.body),{tool:'quem_sou_eu',args:{}});
 const relay=new SupabaseStorage({gateway:'https://bunker.example/internal/storage',key:'server-test',fetch:async(url,r)=>{call={url,r};return Response.json({});}});await relay.rpc('orbitaMcp',{tool:'quem_sou_eu',args:{}});assert.deepEqual(JSON.parse(call.r.body),{operation:'orbitaMcp',input:{tool:'quem_sou_eu',args:{}}});
});
test('storage failures keep a correlatable diagnostic without payload, keys, SQL details, URL or credentials',async()=>{
 const warnings=[],warn=console.warn;console.warn=m=>warnings.push(String(m));
 try{
  const db=new SupabaseStorage({url:'https://example.supabase.co',key:'sb_secret_private_value',fetch:async()=>new Response(JSON.stringify({code:'57014',message:'canceling statement due to statement timeout',details:'row central payload secret-value'}),{status:500,headers:{'cf-ray':'a568d8f5c80c772a-GIG','Content-Type':'application/json'}})});
  const error=await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('snapshots:'+'a'.repeat(64)).first().then(()=>null,e=>e);
  assert.match(error.message,/Falha no armazenamento Supabase \(500\)/);
  assert.deepEqual({...error.storage,ms:0},{op:'get',keyClasses:['snapshots'],keyCount:1,ms:0,status:500,pgCode:'57014',requestId:'a568d8f5c80c772a-GIG'});
  const exposed=JSON.stringify(error.storage)+warnings.join('\n');
  assert.doesNotMatch(exposed,/sb_secret_|secret-value|aaaaaaaa|example\.supabase|canceling statement|payload/);
  assert.equal(JSON.parse(warnings[0]).event,'bunker_storage_failure');
 }finally{console.warn=warn;}
});
test('transport failures use fixed messages, keep safe metadata and never retry',async()=>{
 const warnings=[],warn=console.warn;console.warn=m=>warnings.push(String(m));
 try{
  let calls=0;const timeout=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async()=>{calls++;throw new DOMException('timed out at https://example.supabase.co?apikey=sb_secret_raw','TimeoutError');}});
  const t=await timeout.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first().then(()=>null,e=>e);
  assert.equal(t.message,'Tempo esgotado no armazenamento.');assert.equal(t.storage.transport,'timeout');assert.equal(t.storage.op,'get');assert.deepEqual(t.storage.keyClasses,['central']);assert.equal(calls,1);
  const network=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async()=>{throw new TypeError('connect ECONNREFUSED https://example.supabase.co token=sb_secret_raw');}});
  const n=await network.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('live:p').first().then(()=>null,e=>e);
  assert.equal(n.message,'Falha de rede no armazenamento.');assert.equal(n.storage.transport,'network');assert.deepEqual(n.storage.keyClasses,['live']);
  const {runtimeFailure}=await import('../lib/cloud-failure-diagnostics.mjs');
  const exposed=JSON.stringify([t.message,n.message,t.storage,n.storage,runtimeFailure({history:[]},t),runtimeFailure({history:[]},n)])+warnings.join('\n');
  assert.doesNotMatch(exposed,/sb_secret_|ECONNREFUSED|example\.supabase|apikey|token=/);
 }finally{console.warn=warn;}
});
test('a successful status with an undecodable body fails safely and is measured through decoding',async()=>{
 const warnings=[],warn=console.warn,now=Date.now;console.warn=m=>warnings.push(JSON.parse(m));
 try{
  let t=1000;Date.now=()=>t;
  const db=new SupabaseStorage({url:'https://example.supabase.co',key:'sb_secret_value',fetch:async()=>{t+=100;return new Response('<html>proxy https://example.supabase.co sb_secret_value payload-fragment',{status:200,headers:{'cf-ray':'a568d8f5c80c772a-GIG'}});}});
  const json=Response.prototype.json;Response.prototype.json=async function(){t+=2400;return json.call(this);};
  let error;try{error=await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first().then(()=>null,e=>e);}finally{Response.prototype.json=json;}
  assert.equal(error.message,'Resposta inválida do armazenamento.');
  assert.deepEqual(error.storage,{op:'get',keyClasses:['central'],keyCount:1,ms:2500,status:200,transport:'decode',requestId:'a568d8f5c80c772a-GIG'});
  const {runtimeFailure}=await import('../lib/cloud-failure-diagnostics.mjs');const r=runtimeFailure({history:[]},error);
  assert.doesNotMatch(JSON.stringify([r,warnings]),/sb_secret_|example\.supabase|payload-fragment|html|Unexpected token/);
  assert.equal(r.lastFailure.storage.transport,'decode');
 }finally{console.warn=warn;Date.now=now;}
});
test('slow successful operations are reported once, with body decoding included in the duration',async()=>{
 const warnings=[],warn=console.warn,now=Date.now,json=Response.prototype.json;console.warn=m=>warnings.push(JSON.parse(m));
 try{
  let t=1000;Date.now=()=>t;
  Response.prototype.json=async function(){t+=1900;return json.call(this);};
  const slow=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async()=>{t+=200;return Response.json({rows:[]},{headers:{'sb-request-id':'0b6c0c2e-3b61-4a5e-9a51-2f6a8f0c1d22'}});}});
  await slow.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first();
  Response.prototype.json=json;
  const fast=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async()=>{t+=50;return Response.json({rows:[]});}});
  await fast.prepare('SELECT revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first();
  const slowEvents=warnings.filter(w=>w.event==='bunker_storage_slow');
  assert.equal(slowEvents.length,1);assert.equal(slowEvents[0].ms,2100);assert.equal(slowEvents[0].requestId,'0b6c0c2e-3b61-4a5e-9a51-2f6a8f0c1d22');
 }finally{console.warn=warn;Date.now=now;Response.prototype.json=json;}
});
test('storage diagnostic sanitizer accepts only the known vocabulary and request id formats',async()=>{
 const {safeStorageDiagnostic}=await import('../lib/supabase-storage.mjs');
 assert.equal(safeStorageDiagnostic({op:'get; drop table'}),null);assert.equal(safeStorageDiagnostic({op:'deleteAll'}),null);
 assert.deepEqual(safeStorageDiagnostic({op:'commit',keyClasses:['central','central','snapshots:abc','project','x'.repeat(30)],pgCode:'bad code',requestId:'https://secret',status:999,ms:12.4,transport:'retry',payload:'secret'}),{op:'commit',keyClasses:['central'],ms:12});
 for(const id of ['a568d8f5c80c772a-GIG','0b6c0c2e-3b61-4a5e-9a51-2f6a8f0c1d22'])assert.equal(safeStorageDiagnostic({op:'get',requestId:id}).requestId,id);
 for(const id of ['req_123456789','A568D8F5C80C772A-GIG','a568d8f5c80c772a-gig','0b6c0c2e3b614a5e9a512f6a8f0c1d22','sb_secret_abcdefgh'])assert.equal(safeStorageDiagnostic({op:'get',requestId:id}).requestId,undefined);
 const db=new SupabaseStorage({url:'https://example.supabase.co',key:'test',fetch:async()=>new Response('{}',{status:500,headers:{'cf-ray':'not-a-ray'}})});
 const warn=console.warn;console.warn=()=>{};
 try{const e=await db.prepare('SELECT key,payload,revision,updated_at FROM bunker_records WHERE key IN (?,?,?)').bind('creative:p','unknownprefix:p','central').all().then(()=>null,e=>e);
  assert.deepEqual(e.storage.keyClasses,['central','creative','other']);assert.equal(e.storage.keyCount,3);assert.equal(e.storage.requestId,undefined);}finally{console.warn=warn;}
});
