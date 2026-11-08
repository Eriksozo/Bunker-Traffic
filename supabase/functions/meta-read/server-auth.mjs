/** Accept only server credentials Supabase itself injected for this project. */
export async function authenticateServer(request,{service,secretKeys}){
 const candidates=[request.headers.get('apikey')||'',request.headers.get('Authorization')?.replace(/^Bearer /,'')||''].filter(Boolean);
 let modern=[];try{modern=Object.values(JSON.parse(secretKeys||'{}')).filter(x=>typeof x==='string'&&x.startsWith('sb_secret_'));}catch{}
 const allowed=[service,...modern].filter(Boolean);if(!service||!candidates.length)return false;
 const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 let valid=false;for(const a of candidates)for(const b of allowed){const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];valid=valid||diff===0;}return valid;
}
