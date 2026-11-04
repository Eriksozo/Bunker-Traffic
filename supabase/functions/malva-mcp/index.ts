import {authenticateServer} from './server-auth.mjs';
import {callRemoteMcp,cloudReadTools,cloudWriteTools,CloudError} from './cloud-malva.mjs';
import {authorizeCloudDispatch} from './cloud-dispatch-guard.mjs';
import {hydrateCoreState} from './core-storage.mjs';
const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!await authenticateServer(req,{service,secretKeys:Deno.env.get('SUPABASE_SECRET_KEYS')}))return result({error:'MCP_SERVER_AUTH_REQUIRED'},401);
 if(req.method!=='POST')return result({error:'Method not allowed'},405);
 try{
  const body=await req.text();if(body.length>20000)throw new CloudError('MCP_REQUEST_LIMIT');const input=JSON.parse(body),{tool,args={}}=input;
  if(![...cloudReadTools,...cloudWriteTools].includes(tool)||!args||typeof args!=='object'||Array.isArray(args))throw new CloudError('MCP_TOOL_NOT_ALLOWED');
  const rpc=async(operation:string,input:unknown)=>{const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/bunker_store',{method:'POST',headers:{apikey:service,'Content-Type':'application/json'},body:JSON.stringify({operation,input}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new CloudError('MCP_JOURNAL_FAILED');return r.json();};
  if(cloudWriteTools.includes(tool)){
   // A second independent fence in front of the provider: verify the persisted
   // exact owner approval and submitted command, then atomically burn a receipt.
   const proof=input.execution;if(!proof?.id||!proof?.submitClientId)throw new CloudError('MCP_APPROVAL_REQUIRED');
   const rows=await rpc('get',{keys:['central']}),stored=JSON.parse(rows.rows?.[0]?.payload||'null');if(!stored)throw new CloudError('MCP_APPROVAL_REQUIRED');delete stored._commitToken;
   const state=await hydrateCoreState(stored),authorized=authorizeCloudDispatch(state,input),e=state.executions.find((e:any)=>e.id===authorized.executionId),p=state.proposals.find((p:any)=>p.id===authorized.proposalId);
   const key='dispatch:'+e.id,at=new Date().toISOString(),receipt=await rpc('cas',{key,payload:JSON.stringify({executionId:e.id,proposalId:p.id,command:e.command,at,dispatchConsumed:true}),expected:0,updated_at:at});
   if(receipt.changes!==1)return result({dispatchGranted:false,verificationOnly:true});
  }
  const key=Deno.env.get('MALVA_MCP')||Deno.env.get('MALVA_API');
  return result(await callRemoteMcp({key,tool,args}));
 }catch(e){return result({error:e instanceof CloudError?e.code:'MCP_BRIDGE_FAILED'},502);}
});
