import {storage} from '@/lib/storage';
import {readState} from '@/lib/state';
import {readMalvaSource,MalvaReadError} from '@/lib/malva-api-read.mjs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return Response.json({error:'Entre no Bunker.'},{status:401});
 try{const body=await req.text();if(body.length>12000)return new Response(null,{status:413});const {state}=await readState();return Response.json(await readMalvaSource(storage(),state,JSON.parse(body)),{headers:{'Cache-Control':'private, no-store'}});}
 catch(e){return Response.json({error:e instanceof MalvaReadError?e.code:'MALVA_READ_FAILED'},{status:e instanceof MalvaReadError?e.status:503,headers:{'Cache-Control':'no-store'}});}
}
