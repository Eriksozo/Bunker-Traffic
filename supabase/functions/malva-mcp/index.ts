import {authenticateServer} from './server-auth.mjs';
import {callRemoteMcp,cloudReadTools,cloudWriteTools,CloudError,safeMcpDiagnostic} from './cloud-malva.mjs';
import {authorizeCloudDispatch} from './cloud-dispatch-guard.mjs';
import {hydrateCoreState} from './core-storage.mjs';
const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 let requestedTool='',requestShape:Record<string,unknown>={};
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!await authenticateServer(req,{service,secretKeys:Deno.env.get('SUPABASE_SECRET_KEYS')}))return result({error:'MCP_SERVER_AUTH_REQUIRED'},401);
 if(req.method!=='POST')return result({error:'Method not allowed'},405);
 try{
  const body=await req.text();if(body.length>20000)throw new CloudError('MCP_REQUEST_LIMIT');const input=JSON.parse(body),{tool,args={}}=input;requestedTool=tool;requestShape={level:typeof args?.level==='string'&&['account','campaign','adset','ad'].includes(args.level)?args.level:null,status:typeof args?.status==='string'&&['all','active','spent','paused','rejected'].includes(args.status)?args.status:null,accountCount:Array.isArray(args?.accountIds)?args.accountIds.length:0,parentCount:Array.isArray(args?.campaignIds)?args.campaignIds.length:0,qLength:typeof args?.q==='string'?args.q.length:0};
  if(![...cloudReadTools,...cloudWriteTools].includes(tool)||!args||typeof args!=='object'||Array.isArray(args))throw new CloudError('MCP_TOOL_NOT_ALLOWED');
  const rpc=async(operation:string,input:unknown)=>{const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/bunker_store',{method:'POST',headers:{apikey:service,'Content-Type':'application/json'},body:JSON.stringify({operation,input}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new CloudError('MCP_JOURNAL_FAILED');return r.json();};
  if(cloudWriteTools.includes(tool)){
   // A second independent fence in front of the provider: verify the persisted
   // exact owner approval, the autonomy permission still in force and the submitted
   // command, then burn a receipt tied to the central revision that was verified:
   // the RPC locks the central at that revision and inserts the receipt in one
   // transaction, so a pause or revocation committed after this read refuses it.
   // A refused receipt is never retried here: the order goes to verification.
   const proof=input.execution;if(!proof?.id||!proof?.submitClientId)throw new CloudError('MCP_APPROVAL_REQUIRED');
   const rows=await rpc('get',{keys:['central']}),row=rows.rows?.[0],stored=JSON.parse(row?.payload||'null'),centralRevision=Number(row?.revision);if(!stored||!Number.isSafeInteger(centralRevision)||centralRevision<1)throw new CloudError('MCP_APPROVAL_REQUIRED');delete stored._commitToken;
   const state=await hydrateCoreState(stored),authorized=authorizeCloudDispatch(state,input),e=state.executions.find((e:any)=>e.id===authorized.executionId),p=state.proposals.find((p:any)=>p.id===authorized.proposalId);
   const key='dispatch:'+e.id,at=new Date().toISOString(),receipt=await rpc('cas',{key,payload:JSON.stringify({executionId:e.id,proposalId:p.id,command:e.command,at,dispatchConsumed:true,centralRevision}),expected:0,updated_at:at,centralRevision});
   if(receipt.changes!==1)return result({dispatchGranted:false,verificationOnly:true});
  }
  const key=Deno.env.get('MALVA_MCP')||Deno.env.get('MALVA_API');
  return result(await callRemoteMcp({key,tool,args,onRecovery:recovery=>console.info(JSON.stringify({event:'mcp_read_recovered',...recovery}))}));
 }catch(e){const diagnostic=e instanceof CloudError?safeMcpDiagnostic(e):{};if(e instanceof CloudError&&cloudReadTools.includes(requestedTool))console.warn(JSON.stringify({event:'mcp_read_failure',tool:requestedTool,code:e.code,...diagnostic,requestShape}));return result({error:e instanceof CloudError?e.code:'MCP_BRIDGE_FAILED',diagnostic},502);}
});
