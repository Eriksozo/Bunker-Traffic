import {readSuggestionHistory} from '@/lib/state';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
 if(!req.headers.get('oai-authenticated-user-id'))return json({error:'Entre com sua conta ChatGPT.'},401);
 try{const u=new URL(req.url);return json(await readSuggestionHistory(u.searchParams.get('project')||'',Number(u.searchParams.get('limit')||10),u.searchParams.get('cursor')));}catch(e:any){return json({error:e.message||'Histórico de sugestões indisponível.'},400);}
}
