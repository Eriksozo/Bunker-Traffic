import {executorControl} from '@/lib/executor-control';
export const dynamic='force-dynamic';
/** Read-only: what the Bunk's autonomy did or held back (log kept by the Cloudflare executor). Signed owner only. */
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return new Response(null,{status:401});
 try{return Response.json(await executorControl({action:'autonomy'}),{headers:{'Cache-Control':'private, no-store'}});}
 catch{return Response.json({error:'Executor da nuvem indisponível.'},{status:503});}
}
