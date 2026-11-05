import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {callRemoteMcp,cloudReadTools,cloudWriteTools,safeMcpDiagnostic,mcpReadRecoveryPolicy} from '../lib/cloud-malva.mjs';
import {SupabaseStorage} from '../lib/supabase-storage.mjs';
import {collectionFailure} from '../lib/cloud-failure-diagnostics.mjs';
const success=data=>Response.json({jsonrpc:'2.0',id:'response',result:{structuredContent:data}});
function clock(){let at=100000;const sleeps=[];return {now:()=>at,advance:ms=>at+=ms,sleeps,sleep:async ms=>{sleeps.push(ms);at+=ms;}};}
test('One transient read failure recovers exact data and arguments without refreshing source timestamps',async()=>{
 const c=clock(),calls=[],events=[],data={freshAt:'2026-11-05T21:00:00Z',lastSyncAt:'2026-11-05T20:50:00Z',items:[{externalId:'real',spend:0}]},args={projectId:'project',level:'campaign',from:'2026-11-04',to:'2026-11-04'};
 const out=await callRemoteMcp({key:'mck_test',tool:'tracking_campaigns',args,...c,onRecovery:e=>events.push(e),fetch:async(url,request)=>{calls.push({url,payload:JSON.parse(request.body)});c.advance(100);return calls.length===1?new Response('private provider detail',{status:503}):success(data);}});
 assert.deepEqual(out,data);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1].payload.params.arguments,args);assert.deepEqual(c.sleeps,[500]);assert.equal(events.length,1);assert.equal(events[0].transportAttempts,2);assert.equal(events[0].failures[0].providerStatus,503);assert.equal(events[0].elapsedMs,700);assert.doesNotMatch(JSON.stringify(events),/private|mck_/);
});
test('Every allowed read can recover once; every financial command is sent at most once, including timeouts and body failures',async()=>{
 for(const tool of cloudReadTools){const c=clock();let calls=0;const out=await callRemoteMcp({key:'mck_test',tool,...c,fetch:async()=>++calls===1?new Response(null,{status:502}):success({ok:true})});assert.deepEqual(out,{ok:true});assert.equal(calls,2);}
 for(const tool of cloudWriteTools)for(const fail of [()=>new Response('private',{status:503}),()=>{throw new DOMException('private mck_secret','TimeoutError');},()=>({ok:true,text:async()=>{throw Error('private');}})]){const c=clock();let calls=0;await assert.rejects(callRemoteMcp({key:'mck_test',tool,...c,fetch:async()=>{calls++;return fail();}}));assert.equal(calls,1);assert.deepEqual(c.sleeps,[]);}
});
test('Authentication, permissions, input errors, malformed data and nontransient tool errors are never retried',async()=>{
 for(const status of [400,401,403,404,422]){const c=clock();let calls=0;await assert.rejects(callRemoteMcp({key:'mck_test',tool:'workspace_whoami',...c,fetch:async()=>{calls++;return new Response('secret provider text',{status});}}),e=>e.providerStatus===status&&!e.message.includes('secret'));assert.equal(calls,1);assert.deepEqual(c.sleeps,[]);}
 for(const result of [()=>Response.json({jsonrpc:'2.0',id:'response',result:{isError:true,structuredContent:{error:{code:'validation',status:500,message:'invalid input'}}}}),()=>new Response('not json'),()=>Response.json({jsonrpc:'2.0',error:{message:'private'}})]){const c=clock();let calls=0;await assert.rejects(callRemoteMcp({key:'mck_test',tool:'tracking_campaigns',...c,fetch:async()=>{calls++;return result();}}));assert.equal(calls,1);}
 const c=clock();let calls=0;const circular={};circular.self=circular;await assert.rejects(callRemoteMcp({key:'mck_test',tool:'tracking_campaigns',args:circular,...c,fetch:async()=>{calls++;}}),e=>e.code==='MCP_REQUEST_INVALID');assert.equal(calls,0);
});
test('Retry-After is respected and a long throttle window is preserved without an immediate retry',async()=>{
 for(const [header,delay] of [['2',2000],[new Date(103000).toUTCString(),3000],['0',0]]){const c=clock();let calls=0;await callRemoteMcp({key:'mck_test',tool:'workspace_whoami',...c,fetch:async()=>++calls===1?new Response(null,{status:429,headers:{'Retry-After':header}}):success({identity:true})});assert.equal(calls,2);assert.deepEqual(c.sleeps,[delay]);}
 const c=clock();let calls=0;await assert.rejects(callRemoteMcp({key:'mck_test',tool:'workspace_whoami',...c,fetch:async()=>{calls++;return new Response(null,{status:429,headers:{'Retry-After':'30'}});}}),e=>e.code==='MCP_RATE_LIMITED'&&e.retryAfterMs===30000&&e.transportAttempts===1);assert.equal(calls,1);assert.deepEqual(c.sleeps,[]);
});
test('Recovery has a fixed total budget and never begins a second fetch when that budget is exhausted',async()=>{
 const c=clock();let calls=0;await assert.rejects(callRemoteMcp({key:'mck_test',tool:'tracking_campaigns',...c,fetch:async()=>{calls++;c.advance(25500);throw new DOMException('late','TimeoutError');}}),e=>e.transportAttempts===1&&e.providerCategory==='timeout');assert.equal(calls,1);assert.deepEqual(c.sleeps,[]);
 const d=clock();calls=0;await assert.rejects(callRemoteMcp({key:'mck_test',tool:'tracking_campaigns',...d,sleep:async()=>d.advance(30000),fetch:async()=>{calls++;throw TypeError('private');}}),e=>e.code==='MCP_RECOVERY_EXPIRED'&&e.transportAttempts===1);assert.equal(calls,1);assert.equal(mcpReadRecoveryPolicy.totalBudgetMs<30000,true);
});
test('Two failed reads preserve only safe diagnostic facts through storage and the collection journal',async()=>{
 const c=clock();let calls=0,providerError;try{await callRemoteMcp({key:'mck_test',tool:'tracking_campaigns',...c,fetch:async()=>{calls++;return new Response('private mck_secret',{status:503});}});}catch(e){providerError=e;}assert.equal(calls,2);const diagnostic=safeMcpDiagnostic(providerError);
 const db=new SupabaseStorage({url:'https://example.supabase.co',key:'server-test',fetch:async()=>Response.json({error:providerError.code,diagnostic:{...diagnostic,providerCode:'mck_sensitive',providerFields:['q','secret'],message:'private',headers:{Authorization:'mck_secret'}}},{status:502})});
 await assert.rejects(db.rpc('malvaMcp',{tool:'tracking_campaigns',args:{}}),e=>{const journal=collectionFailure(e,{project:'p',jobId:'j',phase:'campaigns'},100000);assert.equal(journal.providerStatus,503);assert.equal(journal.transportAttempts,2);assert.equal(journal.elapsedMs,500);assert.deepEqual(journal.providerFields,['q']);assert.equal(journal.providerCode,undefined);assert.doesNotMatch(JSON.stringify(journal),/secret|private|mck_/);return true;});
});
test('Network and body-read failures recover only reads; diagnostic sinks cannot change successful source data',async()=>{
 for(const fail of [()=>{throw TypeError('private details');},()=>({ok:true,text:async()=>{throw new DOMException('private','TimeoutError');}})]){const c=clock();let calls=0;const out=await callRemoteMcp({key:'mck_test',tool:'workspace_whoami',...c,onRecovery:()=>{throw Error('logging failed');},fetch:async()=>++calls===1?fail():success({identity:true})});assert.equal(calls,2);assert.deepEqual(out,{identity:true});}
 assert.equal(readFileSync(new URL('../lib/cloud-malva.mjs',import.meta.url),'utf8'),readFileSync(new URL('../supabase/functions/malva-mcp/cloud-malva.mjs',import.meta.url),'utf8'));
});
