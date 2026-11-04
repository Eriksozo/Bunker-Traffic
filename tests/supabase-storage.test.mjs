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
