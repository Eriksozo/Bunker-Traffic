// iPhone alerts through Pushover (owner request of 08/11/2026: "uma forma de o Bunk conseguir me avisar no meu iphone").
// The Cloudflare executor calls this right after it rewrites the notch summary, so the phone hears the same four kinds
// the Mac would ring for, also with the Mac asleep: loss to review, proposal waiting for the owner, owner order
// confirmed/failed/to verify, and budget pace (once a day per project and kind). Read-only: it never approves,
// executes or links an action; tapping opens the private Bunker. Without PUSHOVER_TOKEN and PUSHOVER_USER it is off.
export const phonePolicy=Object.freeze({version:1,seenLimit:400,maxPerRun:5,lossGrowth:1.5,timeoutMs:8000,
 endpoint:'https://api.pushover.net/1/messages.json',url:'https://bunker-traffic.erik-iplou.workers.dev',timezone:'America/Boa_Vista'});

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clip=(v,n)=>typeof v==='string'?(v.length>n?v.slice(0,n-1)+'…':v):'';
export function money(value,currency='BRL'){
 if(!finite(value))return 'N/D';
 const code=typeof currency==='string'&&currency.length===3?currency.toUpperCase():'BRL';
 try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency:code,maximumFractionDigits:Math.abs(value)>=1000?0:2}).format(value);}catch{return 'N/D';}
}
/** The Bunker's day (Boa Vista), as the notch uses: at 21:00 in Brazil the UTC date already flips. */
export function bunkerDay(now){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:phonePolicy.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return parts;
}
function clock(iso){
 const t=Date.parse(iso||'');if(!Number.isFinite(t))return 'N/D';
 return new Intl.DateTimeFormat('pt-BR',{timeZone:phonePolicy.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(t));
}
const statusName=s=>({ACTIVE:'ativa',PAUSED:'pausada'})[String(s||'').toUpperCase()]||(s?String(s).toLowerCase():'N/D');
function orderChange(o){
 if(o.action==='status')return 'Pausar · '+statusName(o.before?.status)+' → '+statusName(o.after?.status);
 const b=o.before?.dailyBudget,a=o.after?.dailyBudget;
 const verb=!finite(a)||!finite(b)?'Orçamento':a>b?'Aumentar':a<b?'Reduzir':'Orçamento';
 return verb+' · '+money(b,o.currency)+' → '+money(a,o.currency)+'/dia';
}
function paceBase(p){
 const missing=p.unknown>0?' · '+p.unknown+' sem orçamento':'';
 return money(p.spend,p.currency)+' de '+money(p.budget,p.currency)+' orçados · '+(p.known||0)+' camp.'+missing;
}
function paceWarning(p){
 const name=p.name||'Projeto';
 if(p.alert==='early')return {title:'Orçamento de '+name+' acaba às '+clock(p.exhaustsAt),message:paceBase(p)+' · no ritmo atual'};
 if(p.alert==='under')return {title:name+' gastando abaixo do ritmo',message:(finite(p.leftoverPct)?p.leftoverPct+'% abaixo do ritmo · ':'')+paceBase(p)};
 return null;
}
const lossId=q=>(q.adAccountId||'')+':'+(q.campaignId||q.campaign||'');
// Window (today partial / 3 complete days) and basis (result = prejuízo / revenue = receita abaixo da mídia) are part of
// the key: different measures are never called growth of one another. As in the notch (one ring per campaign,
// whatever the period), a key of the same campaign under another window/basis, or the old key without them, is only a
// quiet baseline: it rings again, as 'Perda para revisar', only at 1.5× that baseline.
const lossWindows=['today','3d'],lossBases=['result','revenue'];
const lossWindow=p=>p==='today'?'hoje':p==='3d'?'em 3 dias completos':null;
// "hoje" is one day: yesterday's today loss is never the base of "Perda cresceu" today (day of the Brazilian projects).
const lossDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const lossKey=(id,p,b,d=null)=>[id,lossWindows.includes(p)?(p==='today'&&d?'today@'+d:p):null,lossBases.includes(b)?b:null].filter(Boolean).join(':');
const lossRelated=(id,d)=>{const keys=[null,'3d','today'].flatMap(p=>[null,...lossBases].map(b=>lossKey(id,p,b)));if(d)keys.push(...[null,...lossBases].map(b=>lossKey(id,'today',b,d)));return keys;};
function lossText(q){
 const v=money(q.amount),w=lossWindow(q.period);
 const t=q.basis==='result'?v+' de prejuízo':q.basis==='revenue'?'receita '+v+' abaixo da mídia':v;
 return w?t+' '+w:t;
}
// Owner order receipts go first, as in the notch: order, approval, loss, pace.
const kindRank={order:0,approval:1,loss:2,pace:3};

/** Title of an order alert; a Bunk autonomy order (`by:'bunk'`) says so first (docs/autonomy-policy.md). */
export function orderAlertTitle(o){
 const base=o.stage==='confirmed'?'ordem confirmada na Meta':o.stage==='failed'?'ordem não enviada':'ordem enviada: conferir na Meta';
 return o.by==='bunk'?'Bunk (autonomia): '+base:base[0].toUpperCase()+base.slice(1);
}

/**
 * New phone alerts for this summary, against what the phone already heard (`ledger.seen`: key → value). Pure.
 * First call (no ledger) only primes: nothing that already existed rings. A loss rings once and again only when it
 * grows to 1.5× the amount it had when it rang (the notch's dismissal rule): 'Perda cresceu' only in the same window and
 * basis; the rest ring once per key.
 * `present` lists every key this summary produces (sent or not), so the ledger trim never forgets what is still shown.
 */
export function phoneAlerts(summary,ledger,{now=Date.now()}={}){
 const seen={...(ledger?.seen||{})},primed=ledger?.primed===true,day=bunkerDay(now),fresh=[],present=[];
 const push=(key,value,alert)=>{fresh.push({key,value,...alert});};
 for(const a of summary?.approvals?.items||[]){
  const key='ap:'+a.id;present.push(key);if(seen[key])continue;
  push(key,1,{kind:'approval',title:'Proposta aguardando você',message:(a.project?a.project+' · ':'')+(clip(a.title,200)||'Proposta exata')});
 }
 for(const q of summary?.queue||[]){
  if(q.kind!=='loss')continue;
  const ld=lossDay(now),id='lo:'+lossId(q),key=lossKey(id,q.period,q.basis,ld),amount=finite(q.amount)?Math.abs(q.amount):null;
  const same=seen[key]!==undefined,others=lossRelated(id,ld).filter(k=>k!==key&&seen[k]!==undefined);present.push(key);
  // Another window/basis (or the old key) is only a baseline: its highest amount, never claimed as growth.
  let before=seen[key];if(!same&&others.length){present.push(...others);before=Math.max(...others.map(k=>finite(seen[k])?seen[k]:Infinity));}
  if(before!==undefined&&!(finite(before)&&amount!==null&&amount>=before*phonePolicy.lossGrowth))continue;
  push(key,amount??1,{kind:'loss',title:same?'Perda cresceu':'Perda para revisar',
   message:[q.project,clip(q.campaign,160)||'Campanha',lossText(q)].filter(Boolean).join(' · ')});
 }
 for(const o of summary?.orders||[]){
  if(!['confirmed','failed','verify'].includes(o.stage))continue;
  const key='or:'+o.id+':'+o.stage;present.push(key);if(seen[key])continue;
  const title=orderAlertTitle(o);
  push(key,1,{kind:'order',title,message:[clip(o.campaign,160)||'Campanha',orderChange(o),o.reason?clip(o.reason,200):null].filter(Boolean).join(' · ')});
 }
 for(const p of summary?.pace?.byProject||[]){
  if(!p.alert)continue;
  const key='pace:'+(p.project||'')+':'+p.alert+':'+day,w=paceWarning(p);present.push(key);if(seen[key]||!w)continue;
  push(key,1,{kind:'pace',...w});
 }
 fresh.sort((a,b)=>kindRank[a.kind]-kindRank[b.kind]);
 return {primed,fresh,present};
}

/** Keeps the ledger bounded: keys the summary still shows stay, the oldest of the rest go first. */
export function rememberSent(ledger,sent,{now=Date.now(),keep=[]}={}){
 const seen={...(ledger?.seen||{})};
 for(const a of sent)seen[a.key]=a.value;
 let keys=Object.keys(seen);
 if(keys.length>phonePolicy.seenLimit){const must=new Set([...keep,...sent.map(a=>a.key)]);
  const drop=keys.filter(k=>!must.has(k)).slice(0,keys.length-phonePolicy.seenLimit);for(const k of drop)delete seen[k];}
 return {...(ledger||{}),version:phonePolicy.version,primed:true,seen,at:new Date(now).toISOString()};
}

/** One Pushover message. Returns {ok} or {ok:false,retry,code}; never throws and never echoes the credentials. */
export async function sendPushover(fetchFn,{token,user},alert){
 const body=new URLSearchParams({token,user,title:clip(alert.title,250),message:clip(alert.message,1024)||alert.title,
  url:phonePolicy.url,url_title:'Abrir o Bunker',priority:'0'});
 try{
  const res=await fetchFn(phonePolicy.endpoint,{method:'POST',body,signal:AbortSignal.timeout(phonePolicy.timeoutMs)});
  if(res.ok)return {ok:true};
  // 4xx: bad token/user or invalid message — retrying would repeat the refusal. 429/5xx: try again next run.
  return {ok:false,retry:res.status===429||res.status>=500,code:'PUSHOVER_'+res.status};
 }catch{return {ok:false,retry:true,code:'PUSHOVER_NETWORK'};}
}

/**
 * The executor's step: compute, send at most `maxPerRun`, remember what went out (and what was refused for good).
 * A retryable failure stays unsent and is tried on the next summary; nothing is ever sent twice on purpose.
 */
export async function deliverPhoneAlerts({summary,ledger,credentials,fetchFn=fetch,now=Date.now()}){
 const {primed,fresh,present}=phoneAlerts(summary,ledger,{now});
 const keep=present;
 if(!primed)return {ledger:rememberSent(ledger,fresh,{now,keep}),sent:0,primedNow:true};
 const done=[];let error=null,sent=0;
 for(const alert of fresh.slice(0,phonePolicy.maxPerRun)){
  const r=await sendPushover(fetchFn,credentials,alert);
  if(r.ok){done.push(alert);sent++;continue;}
  error=r.code;
  if(!r.retry)done.push(alert);
  else break;
 }
 const next=rememberSent(ledger,done,{now,keep});
 return {ledger:{...next,sent:(ledger?.sent||0)+sent,lastSentAt:sent?new Date(now).toISOString():ledger?.lastSentAt||null,lastError:error??(sent?null:ledger?.lastError??null),lastErrorAt:error?new Date(now).toISOString():ledger?.lastErrorAt||null},sent,pending:fresh.length-done.length};
}
