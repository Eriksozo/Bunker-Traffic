import {executorControl} from '@/lib/executor-control';
export const dynamic='force-dynamic';
export async function GET(req:Request){if(!req.headers.get('oai-authenticated-user-id'))return new Response(null,{status:401});try{return Response.json(await executorControl({action:'status'}),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Executor da nuvem indisponível.'},{status:503});}}
export async function POST(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return new Response(null,{status:401});if(req.headers.get('origin')!==new URL(req.url).origin)return new Response(null,{status:403});
 try{const raw=await req.text();if(raw.length>200)return new Response(null,{status:413});const input=JSON.parse(raw);if(Object.keys(input).length!==1||!['check','enable','pause','tick'].includes(input.action))return new Response(null,{status:400});return Response.json(await executorControl(input),{headers:{'Cache-Control':'no-store'}});}catch(e:any){return Response.json({error:e.message||'Ação não confirmada.'},{status:503});}
}
