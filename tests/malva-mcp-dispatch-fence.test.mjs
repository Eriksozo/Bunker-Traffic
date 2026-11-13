import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setAutonomyConfig,recordAutonomyOrder,killAutonomy} from '../lib/autonomy-grant.mjs';
import {claimExecution,prepareExecution,submitExecution} from '../lib/execution.mjs';

// Curadoria of 13/11/2026 (P1): the real Edge handler (supabase/functions/malva-mcp/index.ts), transpiled in memory,
// with Deno and every network call replaced by fakes. The RPC fake models the contract of
// supabase/migrations/20261113183051_dispatch_receipt_central_fence.sql: a `dispatch:` receipt with `centralRevision`
// is inserted only while the central is still at that revision. Synthetic data only; no provider is ever reached.
const root=new URL('../',import.meta.url),require=createRequire(import.meta.url),ts=require('typescript');
const project='11111111-1111-4111-8111-111111111111',acct='33333333-3333-4333-8333-333333333333',objectId='120000000000000001';
const iso=t=>new Date(t).toISOString();
function fixture(){
 const now=Date.now(),row={id:'22222222-2222-4222-8222-222222222222',externalId:objectId,adAccountId:acct,provider:'meta',name:'Synthetic sales',accountName:'Synthetic',budgetCurrency:'BRL',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',accountStatus:{active:true}};
 const config={enabled:true,projects:{[project]:{mode:'auto',actions:{pause:true,reduce:true,increase:true,activate:false},limits:{maxIncreasePct:50,maxReducePct:30,budgetCap:500,ordersPerDay:2},campaigns:{}}}};
 const state={config:{[project]:{projectName:'Synthetic'}},paused:false,proposals:[],executions:[],events:[]};
 setAutonomyConfig(state,config,'web:synthetic',now-10000);
 const p=recordAutonomyOrder(state,{id:'synthetic',project,adAccountId:acct,objectId,action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:130,currency:'BRL'},rule:'synthetic',wouldExecute:true,blockedBy:[]},{live:{row,fetchedAt:iso(now-5000)},now:now-5000}).proposal;
 const e=claimExecution(state,{proposalId:p.id,version:p.version,signature:p.signature,clientId:'claim',executionRef:'synthetic'},now-4000),lease={id:e.id,claimId:e.claimId,executionRef:e.executionRef};
 const prepared=prepareExecution(state,{...lease,clientId:'prepare',observation:{source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:iso(now-3000),rows:[row]}},now-3000);
 assert.equal(submitExecution(state,{...lease,clientId:'submit'},now-2000).dispatchGranted,true);
 return {state,input:{tool:prepared.command.tool,args:prepared.command.arguments,execution:{id:e.id,submitClientId:e.submitClientId}}};
}

let handler;
const env={SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_URL:'https://synthetic.invalid',MALVA_MCP:'mck_synthetic',SUPABASE_SECRET_KEYS:'{}'};
async function loadHandler(){
 if(handler)return handler;
 globalThis.Deno={env:{get:n=>env[n]},serve:fn=>{handler=fn;}};
 const url=new URL('supabase/functions/malva-mcp/index.ts',root),raw=await fs.readFile(url,'utf8');
 const source=raw.replace(/from\s+(['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from '${new URL(p,url).href}'`);
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 return handler;
}

/** Runs one request. `onAcquire` runs right before the receipt transaction (an owner commit racing it). `lockWait`
 * advances every clock while the receipt waits for the central lock. `legacySql` models the previous definition
 * (20261113183051), which ignores the deadlines: only the handler's own check then stands between them and the provider. */
async function run(f,{onAcquire=null,receipts=new Set(),provider=()=>Response.json({jsonrpc:'2.0',id:'x',result:{structuredContent:{ok:true}}}),omitRevision=false,lockWait=0,legacySql=false,inputs=[]}={}){
 const h=await loadHandler(),original=globalThis.fetch,realNow=Date.now;let revision=11,providerCalls=0,offset=0;const trace=[];
 Date.now=()=>realNow()+offset;
 globalThis.fetch=async(url,options={})=>{
  if(String(url)==='https://synthetic.invalid/rest/v1/rpc/bunker_store'){
   const {operation,input}=JSON.parse(options.body);trace.push(operation);inputs.push({operation,input});
   if(operation==='get')return Response.json({rows:[{key:'central',payload:JSON.stringify(f.state),...(omitRevision?{}:{revision}),updated_at:iso(Date.now())}]});
   if(operation==='cas'){
    if(onAcquire){onAcquire(f.state);revision++;onAcquire=null;}
    offset+=lockWait;
    // The migration's contract: lock the central at the verified revision, then, with the database clock after the
    // lock, check both deadlines; then insert the receipt once.
    assert.ok(Number.isSafeInteger(input.centralRevision),'the receipt carries the verified central revision');
    assert.ok(input.key.startsWith('dispatch:')&&input.expected===0);
    if(input.centralRevision!==revision)return Response.json({changes:0,conflict:'central'});
    if(!legacySql){
     const payload=JSON.parse(input.payload),db=Date.now();
     if(typeof input.authorizationValidUntil!=='string'||typeof input.preflightValidUntil!=='string'||payload.authorizationValidUntil!==input.authorizationValidUntil||payload.preflightValidUntil!==input.preflightValidUntil)return Response.json({changes:0,conflict:'deadline'});
     if(db>=Date.parse(input.authorizationValidUntil)||db>Date.parse(input.preflightValidUntil))return Response.json({changes:0,conflict:'expired'});
    }
    if(receipts.has(input.key))return Response.json({changes:0});
    receipts.add(input.key);return Response.json({changes:1});
   }
   throw Error('unexpected RPC '+operation);
  }
  if(String(url).startsWith('https://malvadash.com/')){providerCalls++;return provider();}
  throw Error('NETWORK_DISABLED');
 };
 try{
  const response=await h(new Request('https://synthetic.invalid/functions/v1/malva-mcp',{method:'POST',headers:{Authorization:'Bearer synthetic-service'},body:JSON.stringify(f.input)}));
  return {status:response.status,body:await response.json(),providerCalls,trace,receipts};
 }finally{globalThis.fetch=original;Date.now=realNow;}
}

test('Edge fence: a valid current order is dispatched once',async()=>{
 const r=await run(fixture());
 assert.equal(r.status,200);assert.equal(r.providerCalls,1);assert.deepEqual(r.trace,['get','cas']);
});

test('Edge fence: pause, autonomy off or a permission change committed between the central read and the receipt → zero provider calls',async()=>{
 const changes={pause:s=>{s.paused=true;},kill:s=>{killAutonomy(s,'web:owner');},
  permission:s=>{const c=structuredClone(s.autonomy);c.projects[project].limits.budgetCap=110;setAutonomyConfig(s,c,'web:owner');}};
 for(const [name,change] of Object.entries(changes)){
  const r=await run(fixture(),{onAcquire:change});
  assert.equal(r.providerCalls,0,name);assert.deepEqual(r.body,{dispatchGranted:false,verificationOnly:true},name);
  assert.deepEqual(r.trace,['get','cas'],name+': no second read, no retry');
 }
});

test('Edge fence: replay and provider timeout never resend; a central without revision is refused',async()=>{
 const f=fixture(),receipts=new Set();
 assert.equal((await run(f,{receipts})).providerCalls,1);
 const again=await run(f,{receipts});
 assert.equal(again.providerCalls,0);assert.deepEqual(again.body,{dispatchGranted:false,verificationOnly:true});
 const slow=await run(fixture(),{provider:()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});}});
 assert.equal(slow.providerCalls,1,'one attempt, the executor verifies');assert.equal(slow.status,502);
 const bare=await run(fixture(),{omitRevision:true});
 assert.equal(bare.providerCalls,0);assert.equal(bare.body.error,'MCP_APPROVAL_REQUIRED');assert.deepEqual(bare.trace,['get']);
});

// Curadoria of 13/11/2026, residual 4: the authorization is checked at one instant, then the receipt may wait for the lock.
test('Edge fence: the receipt carries both deadlines, the same in the RPC input and in the stored payload',async()=>{
 const f=fixture(),inputs=[],r=await run(f,{inputs});
 assert.equal(r.providerCalls,1);
 const cas=inputs.find(i=>i.operation==='cas').input,payload=JSON.parse(cas.payload),p=f.state.proposals[0],e=f.state.executions[0];
 assert.equal(cas.authorizationValidUntil,new Date(Date.parse(p.expiresAt)).toISOString());
 assert.equal(cas.preflightValidUntil,new Date(Date.parse(e.preflight.fetchedAt)+120000).toISOString());
 assert.equal(payload.authorizationValidUntil,cas.authorizationValidUntil);assert.equal(payload.preflightValidUntil,cas.preflightValidUntil);
 assert.equal(payload.centralRevision,cas.centralRevision);
});

test('Edge fence: a lock wait that outlives the pre-check or the approval → no receipt, zero provider calls, no retry',async()=>{
 const preflight=await run(fixture(),{lockWait:130000});
 assert.equal(preflight.providerCalls,0);assert.deepEqual(preflight.body,{dispatchGranted:false,verificationOnly:true});
 assert.deepEqual(preflight.trace,['get','cas']);assert.equal(preflight.receipts.size,0);
 const f=fixture();f.state.proposals[0].expiresAt=iso(Date.now()+10000);
 const approval=await run(f,{lockWait:20000});
 assert.equal(approval.providerCalls,0);assert.deepEqual(approval.body,{dispatchGranted:false,verificationOnly:true});
 assert.deepEqual(approval.trace,['get','cas']);assert.equal(approval.receipts.size,0);
 const shortWait=await run(fixture(),{lockWait:5000});
 assert.equal(shortWait.providerCalls,1,'a wait inside both deadlines still dispatches once');
});

test('Edge fence: under the previous SQL (no deadline check) the handler itself refuses an expired order after the receipt',async()=>{
 const r=await run(fixture(),{lockWait:130000,legacySql:true});
 assert.equal(r.receipts.size,1,'the receipt was burned: the order goes to verification');
 assert.equal(r.providerCalls,0);assert.deepEqual(r.body,{dispatchGranted:false,verificationOnly:true});assert.deepEqual(r.trace,['get','cas']);
});

test('the deadline migration checks both deadlines with the database clock after the lock, before the insert; grants unchanged',async()=>{
 const sql=await fs.readFile(new URL('supabase/migrations/20261113204326_dispatch_receipt_deadline_fence.sql',root),'utf8');
 const lock=sql.indexOf("for update"),check=sql.indexOf("clock_timestamp()>=(input->>'authorizationValidUntil')::timestamptz"),insert=sql.indexOf("insert into public.bunker_records(key,payload,revision,updated_at)");
 assert.ok(lock>0&&check>lock&&insert>check,'lock → deadline check → receipt insert');
 assert.match(sql,/clock_timestamp\(\)>\(input->>'preflightValidUntil'\)::timestamptz/);
 assert.match(sql,/return jsonb_build_object\('changes',0,'conflict','expired'\);/);
 assert.match(sql,/return jsonb_build_object\('changes',0,'conflict','deadline'\);/);
 assert.match(sql,/\(input->>'payload'\)::jsonb->>'authorizationValidUntil'\) is distinct from input->>'authorizationValidUntil'/);
 assert.doesNotMatch(sql.slice(lock,insert),/\bnow\(\)/,'the transaction-start clock is not used for the deadline');
 assert.doesNotMatch(sql.replace(/--.*$/gm,''),/\bhttp|net\.|pg_net/i,'no HTTP call inside the transaction');
 assert.match(sql,/revoke all on function public\.bunker_store\(text,jsonb\) from public,anon,authenticated;\ngrant execute on function public\.bunker_store\(text,jsonb\) to service_role;/);
 // Outside the fenced branch the definition is the previous one, byte for byte.
 const previous=await fs.readFile(new URL('supabase/migrations/20261113183051_dispatch_receipt_central_fence.sql',root),'utf8');
 const body=s=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'));
 assert.equal(body(sql).replace(/   -- Deadlines, after the lock[\s\S]*?'expired'\);\n   end if;\n/,''),body(previous));
});

test('the migration locks the central at the verified revision inside the receipt transaction; grants unchanged',async()=>{
 const sql=await fs.readFile(new URL('supabase/migrations/20261113183051_dispatch_receipt_central_fence.sql',root),'utf8');
 assert.match(sql,/input \? 'centralRevision'/);
 assert.match(sql,/perform 1 from public\.bunker_records where key='central' and revision=\(input->>'centralRevision'\)::bigint for update;/);
 assert.match(sql,/if not found then return jsonb_build_object\('changes',0,'conflict','central'\); end if;/);
 assert.match(sql,/input->>'key' not like 'dispatch:%'/);
 assert.match(sql,/revoke all on function public\.bunker_store\(text,jsonb\) from public,anon,authenticated;\ngrant execute on function public\.bunker_store\(text,jsonb\) to service_role;/);
 assert.ok(sql.indexOf("for update")<sql.indexOf("insert into public.bunker_records(key,payload,revision,updated_at)"),'lock before the receipt insert');
});
