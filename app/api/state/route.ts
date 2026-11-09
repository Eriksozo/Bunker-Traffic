import {assertCurrentDecisionContext} from '@/lib/live-state';
import {readState,readRevision,commit,apply} from '@/lib/state';
import {ownerAutonomy} from '@/lib/autonomy';
// Autonomy permissions: written only here, by the signed owner (never by an MCP agent).
import {setAutonomyConfig,killAutonomy} from '@/lib/autonomy-grant.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const signed=(req:Request)=>!!req.headers.get('oai-authenticated-user-id');
export async function GET(req:Request){if(!signed(req))return response({error:'Entre com sua conta ChatGPT.',signIn:'/signin-with-chatgpt?return_to=%2F'},401);try{return response(new URL(req.url).searchParams.get('revisionOnly')==='1'?await readRevision():await readState());}catch{return response({error:'A base de dados ainda não está disponível.'},503);}}
export async function POST(req:Request){
 if(!signed(req))return response({error:'Entre com sua conta ChatGPT.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return response({error:'Origem não autorizada.'},403);
 try{const body=await req.text();if(body.length>1500000)return response({error:'Arquivo acima de 1,5 MB.'},413);const input=JSON.parse(body);const cur=await readState();if(input.revision!==cur.revision)return response({error:'Os dados mudaram em outra sessão. Atualize e tente novamente.'},409);if(input.op==='autonomyConfig'||input.op==='autonomyKill'){const owner='web:'+req.headers.get('oai-authenticated-user-id');if(input.op==='autonomyConfig')setAutonomyConfig(cur.state,input.config,owner);else killAutonomy(cur.state,owner);return response(await commit(cur.state,cur.revision));}if(['reviewBatch','collaborationRun','proposalReview','cardDecision','cardReopen','incidentReport','incidentUpdate'].includes(input.op)){await assertCurrentDecisionContext(cur.state,input);ownerAutonomy(cur.state,input,req.headers.get('oai-authenticated-user-id')!);return response(await commit(cur.state,cur.revision));}return response(await commit(apply(cur.state,input),cur.revision));}
 catch(e:any){return response({error:e.message==='CONFLICT'?'Os dados mudaram. Atualize antes de salvar.':e.name==='ZodError'?'Confira o formato e os campos dos dados.':e.message||'Não foi possível salvar.'},e.message==='CONFLICT'?409:400);}}
