import {readReports} from '@/lib/state';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return response({error:'Entre com sua conta ChatGPT.'},401);
 const url=new URL(req.url),project=url.searchParams.get('project')||'',limit=Number(url.searchParams.get('limit')||20),cursor=url.searchParams.get('cursor');
 try{return response(await readReports(project,limit,cursor));}
 catch(e:any){const message=e.message||'';const invalid=/projeto válido|Limite de relatórios|Cursor de relatório/.test(message);return response({error:invalid?message:'Não foi possível carregar o histórico de relatórios.'},invalid?400:503);}
}
