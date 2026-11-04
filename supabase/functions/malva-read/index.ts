import {createMalvaReader,MalvaReadError} from './malva-api-read.mjs';
const read=createMalvaReader({key:Deno.env.get('MALVA_API')});
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 // Gateway validates JWT too. Constant-time server-key comparison rejects ordinary user JWTs.
 const expected=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),actual=req.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!expected||!actual)return response({error:'Unauthorized'},401);
 const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([hash(expected),hash(actual)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)return response({error:'Unauthorized'},401);
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 try{const text=await req.text();if(text.length>12000)return response({error:'MALVA_REQUEST_INVALID'},413);return response(await read(JSON.parse(text)));}
 catch(e){return response({error:e instanceof MalvaReadError?e.code:'MALVA_READ_FAILED'},e instanceof MalvaReadError?e.status:502);}
});
