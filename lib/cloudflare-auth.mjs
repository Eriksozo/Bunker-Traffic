const cookie=(request,name)=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const noStore={'Cache-Control':'no-store','Content-Type':'text/html; charset=utf-8'};
const html=(body,status=200)=>new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bunker · Acesso</title><style>body{background:#121016;color:#efecf4;font:16px system-ui;max-width:420px;margin:12vh auto;padding:24px}input,button{font:inherit;padding:12px;border-radius:9px;margin:8px 0;width:100%;box-sizing:border-box}button{background:#8b5cf6;color:white;border:0}a{color:#c4b5fd}</style>'+body+'</html>',{status,headers:noStore});
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rotatedSessions=new WeakMap();
function sessionCookies(tokens){return ['bunker_access='+tokens.access_token+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3500',...(tokens.refresh_token?['bunker_refresh='+tokens.refresh_token+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000']:[])];}
export function withSessionCookies(request,response){const cookies=rotatedSessions.get(request);if(!cookies)return response;const headers=new Headers(response.headers);for(const value of cookies)headers.append('Set-Cookie',value);return new Response(response.body,{status:response.status,headers});}
async function user(request,env){
 let token=cookie(request,'bunker_access'),rotated;
 let r=token?await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)}):null;
 if(!r?.ok){
  const refresh=cookie(request,'bunker_refresh');if(!refresh)return null;
  const refreshed=await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000)});
  if(!refreshed.ok)return null;rotated=await refreshed.json();token=rotated.access_token;if(!token)return null;
  r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
 }
 if(!r.ok)return null;const u=await r.json();if(rotated)u._sessionCookies=sessionCookies(rotated);
 return u.email_confirmed_at&&u.email?.toLowerCase()===env.BUNKER_OWNER_EMAIL?.toLowerCase()?u:null;
}
async function sameSecret(a,b){
 if(!a||!b)return false;
 const hash=async x=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)));
 const [x,y]=await Promise.all([hash(a),hash(b)]);let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0;
}
function directAccess(env){
 try{
  const url=new URL(env.BUNKER_DIRECT_ACCESS_URL);
  if(url.protocol==='https:'&&url.hostname.endsWith('.chatgpt.site')&&!url.username&&!url.password&&!url.port&&url.pathname==='/'&&!url.search&&!url.hash)return url.href;
 }catch{/* An absent or invalid optional destination retains owner email login. */}
 return null;
}
/** Authentication boundary for hosting outside Sites. Never trust visitor-supplied OAI headers. */
export async function cloudflareAuth(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/health')return Response.json({service:'bunker-traffic',configured:!!(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY&&env.SUPABASE_SERVICE_ROLE_KEY&&env.BUNKER_OWNER_EMAIL)},{headers:{'Cache-Control':'no-store'}});
 if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY||!env.BUNKER_OWNER_EMAIL)return html('<h1>Bunker</h1><p>Configuração do servidor em andamento.</p>',503);
 if(path==='/internal/storage'){
  if(request.method!=='POST'||!await sameSecret(request.headers.get('authorization')?.replace(/^Bearer /,''),env.BUNKER_STORAGE_TOKEN))return new Response(null,{status:401});
  const body=await request.text();if(body.length>4000000)return new Response(null,{status:413});
  let parsed;try{parsed=JSON.parse(body);}catch{return new Response(null,{status:400});}
  const importing=parsed.operation==='migrationImport';
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+(importing?'bunker_import_rows':'bunker_store'),{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:importing?JSON.stringify({input:parsed.input}):body,signal:AbortSignal.timeout(30000)});
  return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(path==='/signin-with-chatgpt'||path==='/auth/login'){
  const direct=directAccess(env);
  if(direct&&!url.searchParams.has('email')&&!url.searchParams.has('signedout'))return new Response(null,{status:303,headers:{Location:direct,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  return html('<h1>Entrar no Bunker</h1><p>O acesso é exclusivo do proprietário.</p>'+(direct?'<p><a href="/auth/login">Abrir com minha sessão do ChatGPT →</a></p><p>Ou entrar por e-mail neste endereço:</p>':'')+'<form method="post" action="/auth/email"><label>E-mail<input name="email" type="email" required autocomplete="email"></label><button>Receber link de acesso</button></form>');
 }
 if(path.startsWith('/auth/')||path==='/signout-with-chatgpt'){
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return new Response('Origem inválida',{status:403});
  if(path==='/auth/email'&&request.method==='POST'){
   const body=await request.formData(),email=String(body.get('email')||'').trim().toLowerCase();
   if(email!==env.BUNKER_OWNER_EMAIL.toLowerCase())return html('<p>Acesso indisponível para este endereço.</p>',403);
   const r=await fetch(env.SUPABASE_URL+'/auth/v1/otp?redirect_to='+encodeURIComponent(url.origin+'/auth/callback'),{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,create_user:true}),signal:AbortSignal.timeout(15000)});
   return r.ok?html('<h1>Confira seu e-mail</h1><p>Abra o link para entrar no Bunker.</p>'):html('<p>Não foi possível enviar o acesso. Tente novamente em alguns minutos.</p>',503);
  }
  if(path==='/auth/callback')return html(`<h1>Confirmando acesso…</h1><script>const p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'','/auth/callback');fetch('/auth/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:p.get('access_token'),refresh_token:p.get('refresh_token')})}).then(r=>{if(!r.ok)throw Error();location.replace('/')}).catch(()=>document.body.innerHTML='<p>Link inválido ou expirado. <a href="/auth/login">Entrar novamente</a></p>')</script>`);
  if(path==='/auth/session'&&request.method==='POST'){
   const raw=await request.text();if(raw.length>16000)return new Response(null,{status:413});
   let tokens;try{tokens=JSON.parse(raw);}catch{return new Response(null,{status:400});}
   if(typeof tokens.access_token!=='string'||tokens.access_token.length>8000)return new Response(null,{status:400});
   const probe=new Request(url.origin,{headers:{cookie:'bunker_access='+tokens.access_token}});const u=await user(probe,env);if(!u)return new Response(null,{status:403});
   const headers=new Headers({'Cache-Control':'no-store'});for(const value of sessionCookies(tokens))headers.append('Set-Cookie',value);
   return new Response(null,{status:204,headers});
  }
  if(path==='/signout-with-chatgpt'||path==='/auth/logout'){
   if(request.method!=='POST')return html('<form method="post" action="/auth/logout"><button>Sair</button></form>');
   const token=cookie(request,'bunker_access');if(token)await fetch(env.SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token}});
   const headers=new Headers({Location:'/auth/login?signedout=1'});for(const name of ['bunker_access','bunker_refresh'])headers.append('Set-Cookie',name+'=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');return new Response(null,{status:303,headers});
  }
  return new Response('Não encontrado',{status:404});
 }
 if(path==='/mcp'){
  if(!await sameSecret(request.headers.get('authorization')?.replace(/^Bearer /,''),env.BUNKER_AGENT_TOKEN))return Response.json({error:'Agente não autenticado'},{status:401});
  return new Request(request,{headers:cleanHeaders(request)});
 }
 if(path.startsWith('/_next/')||path.startsWith('/fonts/')||path==='/favicon.svg')return new Request(request,{headers:cleanHeaders(request)});
 const u=await user(request,env);
 if(!u)return path.startsWith('/api/')?Response.json({error:'Entre no Bunker.',signIn:'/auth/login'},{status:401}):Response.redirect(url.origin+'/auth/login',303);
 const headers=cleanHeaders(request);headers.set('oai-authenticated-user-id',u.id);headers.set('oai-authenticated-user-email',u.email);
 const verified=new Request(request,{headers});if(u._sessionCookies)rotatedSessions.set(verified,u._sessionCookies);return verified;
}
function cleanHeaders(request){const headers=new Headers(request.headers);for(const k of [...headers.keys()])if(k.startsWith('oai-authenticated-user-'))headers.delete(k);return headers;}
