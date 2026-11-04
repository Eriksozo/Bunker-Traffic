import {storage} from '@/lib/storage';
import {readState} from '@/lib/state';
import {readCreativeData} from '@/lib/creative-data.mjs';
import {readLiveData} from '@/lib/live-data.mjs';
import hosting from '../../../.openai/hosting.json';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request){
 if(!req.headers.get('oai-authenticated-user-id'))return response({error:'Entre com sua conta ChatGPT.',signIn:'/signin-with-chatgpt?return_to=%2F'},401);
 try{const {state}=await readState();const [live,creative]=await Promise.all([readLiveData(storage(),state),readCreativeData(storage(),state).catch(()=>({items:[],error:'A leitura Órbita está indisponível.'}))]);return response({...live,creativeItems:creative.items,creativeError:'error' in creative?creative.error:undefined,siteProjectId:hosting.project_id});}catch{return response({error:'Não foi possível ler os dados atuais. As leituras de análise foram preservadas.'},503);}
}
