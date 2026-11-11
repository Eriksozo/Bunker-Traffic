import {executorControl} from '@/lib/executor-control';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const fail=(error:string,status:number)=>Response.json({error},{status,headers});
/**
 * Read-only: what the Bunk's autonomy did or held back (log kept by the Cloudflare executor). Signed owner only.
 * `?view=deep&project=<id|all>`: the Modo Gestor read model; `?view=sim&project=<id>`: rows for the draft simulator
 * (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, a.1). Both are owner web session only: the notch credential is refused.
 */
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return new Response(null,{status:401});
 const url=new URL(req.url),view=url.searchParams.get('view');
 if(view===null){
  try{return Response.json(await executorControl({action:'autonomy'}),{headers});}
  catch{return fail('Executor da nuvem indisponível.',503);}
 }
 if(view!=='deep'&&view!=='sim')return fail('Visão desconhecida.',400);
 if(req.headers.has('x-bunker-companion'))return fail('Somente na sessão do dono.',403);
 const project=url.searchParams.get('project')||'';
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(project))return fail('Projeto inválido.',400);
 if(view==='sim'&&project==='all')return fail('Escolha um projeto.',400);
 const input={action:'autonomy',view,project};
 let out:any;
 try{out=await executorControl(input);}catch{return fail('Executor da nuvem indisponível.',503);}
 if(typeof out?.invalid==='string')return fail(out.invalid,400);
 const body=view==='deep'?out?.deep:out?.sim;
 if(!body)return fail('Leitura da autonomia em preparação pelo executor. Tente em 1 a 2 minutos.',503);
 return Response.json(body,{headers});
}
