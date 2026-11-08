import {env} from 'cloudflare:workers';
import {assertCurrentDecisionContext} from '@/lib/live-state';
import {readState,commit} from '@/lib/state';
import {ownerAutonomy} from '@/lib/autonomy';
import {ownerDeviceOps} from '@/lib/owner-device.mjs';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
/** Owner decision signed with Touch ID on the Mac. The Cloudflare boundary verified the
 * signature and forwards only the signed input. Same rules as the web card: an intent asks
 * the team; only an exact proposal already reviewed by the agents can be approved. */
export async function POST(req:Request){
 const owner=req.headers.get('x-bunker-owner-device');
 if((env as any).BUNKER_HOST!=='cloudflare'||req.headers.get('x-bunker-companion')!=='owner'||!owner?.startsWith('mac-touchid:'))return response({error:'Acesso não autorizado.'},401);
 try{
  const input=JSON.parse(await req.text());
  if(!ownerDeviceOps.includes(input?.op))return response({error:'Ação não permitida pelo Mac.'},403);
  const cur=await readState() as any;
  if(input.revision!==cur.revision)return response({error:'Os dados mudaram desde que você abriu. Confira de novo e confirme.',code:'CONFLICT'},409);
  const context:any=await assertCurrentDecisionContext(cur.state,input);
  const record=ownerAutonomy(cur.state,input,owner,{live:context?.live||null});
  const saved=await commit(cur.state,cur.revision) as any;
  const proposal=input.op==='proposalReview'?record:null;
  return response({ok:true,revision:saved?.revision??null,op:input.op,status:proposal?proposal.status:record?.status??null,id:record?.id??null});
 }catch(e:any){return response({error:e.message==='CONFLICT'?'Os dados mudaram. Confira de novo e confirme.':e.message||'Não foi possível registrar.'},e.message==='CONFLICT'?409:400);}
}
export async function GET(){return response({error:'Use POST assinado pelo Mac.'},405);}
