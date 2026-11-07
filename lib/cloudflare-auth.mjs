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
/** Dedicated Claude agent credential: accepted only by the /mcp branch, never by storage or owner routes. A short or reused value fails closed. */
async function claudeAgent(presented,env){
 const own=env.BUNKER_CLAUDE_AGENT_TOKEN;
 if(typeof own!=='string'||own.length<32)return false;
 if(await sameSecret(own,env.BUNKER_AGENT_TOKEN)||await sameSecret(own,env.BUNKER_STORAGE_TOKEN)||await sameSecret(own,env.SUPABASE_SERVICE_ROLE_KEY))return false;
 return sameSecret(presented,own);
}
/** Mac companion credential: GET /api/companion only, read-only, never owner identity. Short or reused values fail closed. */
async function companionAgent(presented,env){
 const own=env.BUNKER_COMPANION_TOKEN;
 if(typeof own!=='string'||own.length<32)return false;
 for(const other of [env.BUNKER_AGENT_TOKEN,env.BUNKER_CLAUDE_AGENT_TOKEN,env.BUNKER_STORAGE_TOKEN,env.SUPABASE_SERVICE_ROLE_KEY])if(await sameSecret(own,other))return false;
 return sameSecret(presented,own);
}
/** Why Supabase refused to send the sign-in e-mail, in plain words. Only the status and Supabase's error code are read; no e-mail or token is logged. */
export async function otpFailure(response){
 if(!response)return {code:'network',status:503,message:'A Supabase não respondeu a tempo. Tente de novo em alguns minutos.'};
 let body={};try{body=await response.clone().json();}catch{/* Only known structured fields are inspected. */}
 const raw=String(body?.error_code||body?.code||body?.error||''),code=/^[a-z][a-z0-9_]{0,59}$/.test(raw)?raw:'';
 if(response.status===429||/rate_limit/i.test(code)){
  const header=response.headers.get('retry-after'),reported=String(body?.msg||body?.message||'').match(/after\s+(\d{1,5})\s+seconds?\b/i);
  const seconds=header&&/^\d+$/.test(header)?Number(header):reported?Number(reported[1]):60;
  const retryAfter=Number.isSafeInteger(seconds)&&seconds>0&&seconds<=86400?seconds:60;
  const wait=retryAfter<120?`${retryAfter} segundos`:retryAfter<3600?`${Math.ceil(retryAfter/60)} minutos`:`${Math.ceil(retryAfter/3600)} hora(s)`;
  if(!reported&&!(header&&/^\d+$/.test(header)))return {code:code||'rate_limit',status:429,retryAfter,message:'Limite de envio de e-mails da Supabase atingido. O serviço não informou quando libera novos envios. Confira a caixa de spam e use o último link recebido; evite pedidos repetidos.'};
  return {code:code||'rate_limit',status:429,retryAfter,message:`Limite de envio de e-mails da Supabase atingido. Aguarde ${wait} antes de pedir outro link. Confira também a caixa de spam; se já recebeu um link válido, use o último e-mail.`};
 }
 if(response.status===422||response.status===400)return {code:code||'rejected',status:400,message:'A Supabase recusou o pedido de acesso ('+(code||response.status)+'). A configuração de login precisa ser conferida.'};
 return {code:code||'unavailable',status:503,message:'A Supabase está indisponível agora ('+response.status+'). Tente de novo em alguns minutos.'};
}
/** Resend cooldown survives navigation in this viewer. It is UX only: Supabase remains authoritative. */
function emailPage({email='',message='',sent=false,cooldown=0,status=200,direct=null}={}){
 const seconds=Number.isSafeInteger(cooldown)&&cooldown>0&&cooldown<=86400?cooldown:0;
 const response=html('<h1>'+(sent?'Confira seu e-mail':'Entrar no Bunker')+'</h1><p>'+(message?escape(message):'O acesso é exclusivo do proprietário.')+'</p>'+(direct?'<p><a href="/auth/login">Abrir com minha sessão do ChatGPT →</a></p>':'')+'<form id="bunker-email-form" method="post" action="/auth/email"><label>E-mail<input name="email" type="email" required autocomplete="email" value="'+escape(email)+'"></label><button id="bunker-email-submit">Receber link de acesso</button><p id="bunker-email-wait" role="status" aria-live="polite"></p></form><script>(()=>{const f=document.getElementById("bunker-email-form"),b=document.getElementById("bunker-email-submit"),hint=document.getElementById("bunker-email-wait"),key="bunker.auth.emailAfter";let until=Date.now()+'+seconds+'*1000,pending=false;try{const prior=Number(sessionStorage.getItem(key));if(Number.isFinite(prior)&&prior>Date.now()&&prior<Date.now()+86400000)until=Math.max(until,prior);sessionStorage.setItem(key,String(until));}catch{}function tick(){if(pending)return;const left=Math.max(0,Math.ceil((until-Date.now())/1000));b.disabled=left>0;b.textContent=left?"Aguarde "+left+"s":"Receber link de acesso";hint.textContent=left?"Evite novos pedidos: um link anterior pode continuar válido.":"";}f.addEventListener("submit",event=>{if(pending||Date.now()<until){event.preventDefault();return;}pending=true;b.disabled=true;b.textContent="Enviando…";try{sessionStorage.setItem(key,String(Date.now()+60000));}catch{}});tick();setInterval(tick,1000);})();</script>',status);
 if(status===429)response.headers.set('Retry-After',String(seconds||3600));
 response.headers.set('Referrer-Policy','same-origin');return response;
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
  if(parsed.operation==='cloudExecutor'){
   if(!env.BUNKER_EXECUTOR||!['status','check','enable','pause','tick','attribution'].includes(parsed.input?.action))return Response.json({error:'CLOUD_EXECUTOR_UNAVAILABLE'},{status:503});
   return env.BUNKER_EXECUTOR.getByName('primary').fetch('https://bunker-internal/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.input)});
  }
  const importing=parsed.operation==='migrationImport',malva=['malvaRead','malvaMcp','orbitaMcp'].includes(parsed.operation);
  const r=await fetch(env.SUPABASE_URL+(malva?'/functions/v1/'+(parsed.operation==='orbitaMcp'?'orbita-mcp':parsed.operation==='malvaMcp'?'malva-mcp':'malva-read'):'/rest/v1/rpc/'+(importing?'bunker_import_rows':'bunker_store')),{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,...(malva?{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}:{}),'Content-Type':'application/json'},body:malva?JSON.stringify(parsed.input):importing?JSON.stringify({input:parsed.input}):body,signal:AbortSignal.timeout(30000)});
  return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(path==='/signin-with-chatgpt'||path==='/auth/login'){
  const direct=directAccess(env);
  if(direct&&!url.searchParams.has('email')&&!url.searchParams.has('signedout'))return new Response(null,{status:303,headers:{Location:direct,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  return emailPage({direct});
 }
 if(path.startsWith('/auth/')||path==='/signout-with-chatgpt'){
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return new Response('Origem inválida',{status:403});
  if(path==='/auth/email'&&request.method==='POST'){
   const body=await request.formData(),email=String(body.get('email')||'').trim().toLowerCase();
   if(email!==env.BUNKER_OWNER_EMAIL.toLowerCase())return html('<p>Acesso indisponível para este endereço.</p>',403);
   let r;try{r=await fetch(env.SUPABASE_URL+'/auth/v1/otp?redirect_to='+encodeURIComponent(url.origin+'/auth/callback'),{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,create_user:true}),signal:AbortSignal.timeout(15000)});}catch{r=null;}
   if(r?.ok)return emailPage({email,sent:true,cooldown:60,message:'Pedido aceito pelo serviço de login. Abra o último e-mail do Bunker, inclusive no spam, copie o link e cole no notch. Se não chegar, aguarde o intervalo antes de reenviar.'});
   const reason=await otpFailure(r);console.warn(JSON.stringify({event:'auth_email_failed',status:r?.status??null,code:reason.code}));
   return emailPage({message:reason.message,cooldown:reason.retryAfter||0,status:reason.status});
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
  const presented=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!await sameSecret(presented,env.BUNKER_AGENT_TOKEN)&&!await claudeAgent(presented,env))return Response.json({error:'Agente não autenticado'},{status:401});
  return new Request(request,{headers:cleanHeaders(request)});
 }
 if(path==='/api/companion'&&request.method==='GET'&&request.headers.get('authorization')){
  if(!await companionAgent(request.headers.get('authorization')?.replace(/^Bearer /,''),env))return Response.json({error:'Credencial do app não autorizada.'},{status:401});
  const headers=cleanHeaders(request);headers.delete('authorization');headers.set('x-bunker-companion','read');return new Request(request,{headers});
 }
 if(path.startsWith('/_next/')||path.startsWith('/fonts/')||path==='/favicon.svg')return new Request(request,{headers:cleanHeaders(request)});
 const u=await user(request,env);
 if(!u)return path.startsWith('/api/')?Response.json({error:'Entre no Bunker.',signIn:'/auth/login'},{status:401}):Response.redirect(url.origin+'/auth/login',303);
 const headers=cleanHeaders(request);headers.set('oai-authenticated-user-id',u.id);headers.set('oai-authenticated-user-email',u.email);
 const verified=new Request(request,{headers});if(u._sessionCookies)rotatedSessions.set(verified,u._sessionCookies);return verified;
}
function cleanHeaders(request){const headers=new Headers(request.headers);for(const k of [...headers.keys()])if(k.startsWith('oai-authenticated-user-')||k==='x-bunker-companion')headers.delete(k);return headers;}
