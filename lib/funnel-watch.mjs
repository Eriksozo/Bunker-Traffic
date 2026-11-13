// VIGIA: the funnel watched 24 hours (owner request of 13/11/2026, slide "VIGIA: o funil vigiado 24 horas").
// For each configured Meta project (Gabe, John, Leandro, Murilo, Nico, Ronald) the Cloudflare executor, inside the pulse
// it already runs (no new cron or daemon), reads the funnel every 10 minutes and raises a signal when:
//  - there is no approved sale for 3 hours or more while the traffic is spending ("Murilo: sem venda há 4h"), with the
//    three checks of the slide: the pages answer, the checkout is being opened, the traffic is running;
//  - a front page of the funnel does not answer (two reads in a row);
//  - the vTurb counts 3 or more conversions today than the orders the checkout registered ("as vendas não batem").
// The signals go to the notch (owner's correction of 13/11/2026: "é tudo no notch e não no discord"): the executor
// keeps the current ones and merges them into the notch summary at read time; the notch alerts once per signal.
// Owner decisions of 13/11/2026: 3 h for every project, no quiet hours (it only rings "sem venda" while spending),
// mismatch from 3. Read-only: it never pauses, activates or changes a budget, never proposes or approves anything,
// sends nothing outside the Bunker and carries no buyer data (the Malva bridge strips it before it leaves Supabase).
import {isWarmupCampaign} from './campaign-scope.mjs';
import {currentLiveSnapshot} from './live-display.mjs';

export const vigiaPolicy=Object.freeze({version:1,noSaleHours:3,repeatHours:3,mismatchMin:3,mismatchStep:3,
 readMs:10*60000,historyMs:8*3600000,liveMaxAgeMs:20*60000,trafficLookbackMs:60*60000,trafficMinGapMs:20*60000,
 pageTimeoutMs:8000,maxPages:3,pageFailRuns:2,signalMaxAgeMs:40*60000,timezone:'America/Sao_Paulo'});

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const time=v=>{const t=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(t)?t:null;};
const clip=(v,n)=>typeof v==='string'?(v.length>n?v.slice(0,n-1)+'…':v):'';
const arr=v=>Array.isArray(v)?v:[];
export function money(value){
 if(!finite(value))return 'N/D';
 return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:value>=1000?0:2}).format(value);
}
export function localDay(now,timezone=vigiaPolicy.timezone){
 try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
 catch{return new Intl.DateTimeFormat('en-CA',{timeZone:vigiaPolicy.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
}
export function clock(at,timezone=vigiaPolicy.timezone){
 const t=time(at);if(t===null)return 'N/D';
 return new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(t));
}
// ---- Facts from each read (pure). Missing or malformed data stays null (N/D), never zero. ----

/** Last approved sale (`tracking_orders`, status approved, newest first), today's approved count and today's orders
 * of any status (the period totals ignore the status filter): an order of any status proves the webhook delivered. */
export function ordersFacts(today,recent=null){
 const first=r=>arr(r?.items).map(i=>time(i?.approvedAt)??time(i?.occurredAt)).find(t=>t!==null)??null;
 const last=first(today)??first(recent);
 const approved=finite(today?.totals?.approved)?today.totals.approved:null,orders=finite(today?.totals?.orders)?today.totals.orders:null;
 return {lastSaleAt:last!==null?new Date(last).toISOString():null,approvedToday:approved,ordersToday:orders,
  // A lookup that came back without a sale proves "none in that window"; a failed lookup is N/D.
  searched:recent?'3d':'today'};
}
/** Active checkout integrations and the newest webhook notice any of them received. */
export function checkoutFacts(read){
 const active=arr(read?.items).filter(i=>i&&i.active!==false);
 const last=active.map(i=>time(i.lastEventAt)).filter(t=>t!==null).sort((a,b)=>b-a)[0]??null;
 return {integrations:active.length,lastEventAt:last!==null?new Date(last).toISOString():null};
}
/** vTurb conversions today (null without a video source or count). */
export function videoFacts(read){
 const n=read?.totals?.conversions,sources=finite(read?.sources)?read.sources:null;
 return {vturbConversions:sources&&finite(n)?n:null,videoSources:sources};
}
const pageUrl=(host,path)=>{
 if(typeof host!=='string'||!/^[a-z0-9.-]{3,253}$/i.test(host)||!host.includes('.'))return null;
 const p=typeof path==='string'&&path.startsWith('/')?path:'/';
 try{const u=new URL('https://'+host.toLowerCase()+p);return u.protocol==='https:'?u.toString():null;}catch{return null;}
};
/** Visitors and checkouts today, and the front pages to probe: pages that sent people to the checkout today, most
 * visitors first (without any, the most visited). Thank-you/upsell pages never open the checkout and stay out. */
export function pageFacts(read){
 const rows=arr(read?.rows).filter(r=>r&&typeof r==='object');
 const sum=k=>rows.length&&rows.every(r=>finite(r[k]))?rows.reduce((s,r)=>s+r[k],0):null;
 const withUrl=rows.map(r=>({url:pageUrl(r.host,r.path),visitors:finite(r.visitors)?r.visitors:0,checkouts:finite(r.checkouts)?r.checkouts:0})).filter(r=>r.url);
 const byVisitors=(a,b)=>b.visitors-a.visitors;
 const sellers=withUrl.filter(r=>r.checkouts>0).sort(byVisitors);
 const front=(sellers.length?sellers:withUrl.filter(r=>r.visitors>0).sort(byVisitors)).slice(0,vigiaPolicy.maxPages);
 return {visitors:sum('visitors'),checkouts:sum('checkouts'),front};
}
/** Today's spend of the project's sales campaigns from the live Malva read of that project. Warm-up and engagement
 * campaigns stay out. A stale, incomplete or other-day read is N/D. The Meta display overlay is NOT used: on 13/11 it
 * put R$ 67 mil on a project whose Malva spend was zero (campaigns of shared ad accounts). */
export function liveSpend(items,projectId,{now=Date.now()}={}){
 const item=arr(items).find(i=>i?.projectId===projectId),s=currentLiveSnapshot(item,projectId,undefined,now);
 if(!s||now-(time(s.fetchedAt)??0)>vigiaPolicy.liveMaxAgeMs)return null;
 let spend=0;
 for(const r of s.rows){if(isWarmupCampaign(r?.name))continue;if(r?.spend===null||r?.spend===undefined)continue;if(!finite(r.spend))return null;spend+=r.spend;}
 return {spend:Math.round(spend*100)/100,at:s.fetchedAt,day:localDay(time(s.fetchedAt),s.timezone)};
}

// ---- Pages ----

/** One GET of a funnel page. 401/403/429 or a Cloudflare challenge only say the page is protected from robots: N/D,
 * never "down". 404/410/5xx, network errors and timeouts are failures. Never throws. */
export async function probePage(fetchFn,url){
 try{
  const res=await fetchFn(url,{method:'GET',redirect:'follow',headers:{'User-Agent':'BunkerVIGIA/1 (+monitoramento do proprietário)'},signal:AbortSignal.timeout(vigiaPolicy.pageTimeoutMs)});
  try{await res.body?.cancel();}catch{}
  const challenged=res.headers?.get?.('cf-mitigated')==='challenge';
  if(res.status<400)return {url,ok:true,status:res.status};
  if(challenged||[401,403,429].includes(res.status))return {url,ok:null,status:res.status};
  return {url,ok:false,status:res.status};
 }catch(e){return {url,ok:false,code:['TimeoutError','AbortError'].includes(e?.name)?'tempo esgotado':'sem resposta'};}
}

// ---- History of samples (per project), to tell "running now" and "since" ----

export function addSample(history,sample,{now=Date.now()}={}){
 const kept=arr(history).filter(s=>s&&finite(time(s.at))&&now-time(s.at)<=vigiaPolicy.historyMs&&time(s.at)<time(sample.at));
 return [...kept,sample];
}
/** The newest sample at least `gapMs` older than `at`, within `lookbackMs`, of the same local day and with a value. */
function before(history,at,key,{gapMs,lookbackMs,day}){
 const t=time(at);
 return arr(history).filter(s=>finite(s?.[key])&&s.day===day&&t-time(s.at)>=gapMs&&t-time(s.at)<=lookbackMs).sort((a,b)=>time(b.at)-time(a.at))[0]||null;
}
/** Spend moved in the last hour (sample 20–60 min old, same day). Without an old enough sample: spend today > 0 is
 * shown as "gastando hoje" (null running, not a proof that it spends now). */
export function trafficState(history,sample){
 if(!finite(sample?.spend))return {running:null,label:'N/D'};
 const prev=before(history,sample.at,'spend',{gapMs:vigiaPolicy.trafficMinGapMs,lookbackMs:vigiaPolicy.trafficLookbackMs,day:sample.day});
 if(prev)return {running:sample.spend>prev.spend,delta:Math.round((sample.spend-prev.spend)*100)/100,since:prev.at};
 return {running:sample.spend>0?null:false,today:sample.spend};
}
/** Change of a cumulative daily counter since `sinceMs`: from the newest sample of the same day at or before it, or,
 * without one, from the oldest sample after it (a shorter span, stated by `since`). */
export function deltaSince(history,sample,key,sinceMs){
 if(!finite(sample?.[key]))return null;
 const same=arr(history).filter(s=>finite(s?.[key])&&s.day===sample.day&&time(s.at)<time(sample.at));
 const base=same.filter(s=>time(s.at)<=sinceMs).sort((a,b)=>time(b.at)-time(a.at))[0]||same.filter(s=>time(s.at)>sinceMs).sort((a,b)=>time(a.at)-time(b.at))[0];
 if(!base)return null;
 return {delta:Math.max(0,sample[key]-base[key]),since:base.at};
}

// ---- Evaluation (pure) ----

const mark=v=>v===true?'✓':v===false?'✗':'?';
/** Signals of one project for this read. `pages` are this read's probes; `failRuns` counts consecutive failures. */
export function evaluateProject({project,sample,history,orders,checkout,video,pages,failRuns={},now=Date.now()}){
 const out=[],tz=vigiaPolicy.timezone,name=project.name;
 const traffic=trafficState(history,sample);
 const lastSale=time(orders?.lastSaleAt);
 const quietMs=lastSale!==null?now-lastSale:null;
 const windowMs=vigiaPolicy.noSaleHours*3600000;
 // A missing sale in the 3-day lookup counts as "no sale for 3 days"; a failed lookup (orders null) is never alerted.
 const noSaleFor=orders?(quietMs??(orders.searched==='3d'?3*86400000:null)):null;
 const pageOk=pages.length?(pages.some(p=>p.ok===false&&(failRuns[p.url]||0)>=vigiaPolicy.pageFailRuns)?false:pages.some(p=>p.ok===true)?true:null):null;
 const since=Math.max(now-windowMs,lastSale??0);
 const checkouts=deltaSince(history,sample,'checkouts',since),visitors=deltaSince(history,sample,'visitors',since);
 // An order the checkout delivered in the window (any status, e.g. a Pix generated) proves the checkout opened, also
 // when the pages' initiate-checkout counter did not move (13/11, Gabe: Pix order at 11:34 with that counter flat).
 const placed=deltaSince(history,sample,'orders',since);
 const checkoutOpen=(checkouts?.delta>0||placed?.delta>0)?true:checkouts?(visitors&&visitors.delta>=20&&(!placed||placed.delta===0)?false:null):null;
 const hookAt=time(checkout?.lastEventAt),hookSilent=checkout?.integrations>0&&checkouts&&checkouts.delta>=3&&(hookAt===null||now-hookAt>=windowMs);
 if(noSaleFor!==null&&noSaleFor>=windowMs&&traffic.running===true){
  const hours=Math.floor(noSaleFor/3600000),bucket=Math.floor(noSaleFor/(vigiaPolicy.repeatHours*3600000));
  // "aprovada": the VIGIA counts approved sales, the vTurb counts conversions of any kind (13/11 review: both read as "venda").
  const title=quietMs===null?name+': sem venda aprovada nos últimos 3 dias':name+': sem venda aprovada há '+hours+'h';
  const lines=['Página no ar '+mark(pageOk)+' · Checkout abrindo '+mark(checkoutOpen)+' · Tráfego rodando '+mark(traffic.running)];
  const facts=[];
  if(lastSale!==null)facts.push('Última venda às '+clock(lastSale,tz)+(localDay(lastSale)!==localDay(now)?' de '+localDay(lastSale).split('-').reverse().slice(0,2).join('/'):''));
  if(finite(traffic.delta))facts.push(money(traffic.delta)+' gastos na última hora');
  if(checkouts)facts.push(checkouts.delta+' checkout'+(checkouts.delta===1?'':'s')+' iniciado'+(checkouts.delta===1?'':'s')+' desde '+clock(checkouts.since,tz));
  if(placed?.delta>0)facts.push(placed.delta+' pedido'+(placed.delta===1?'':'s')+' sem pagamento desde '+clock(placed.since,tz));
  if(facts.length)lines.push(facts.join(' · '));
  // The slide's box "Ficou sem venda?": 1 pages, 2 checkout, 3 warn the team (this message). The first failed check leads.
  const down=pages.filter(p=>p.ok===false&&(failRuns[p.url]||0)>=vigiaPolicy.pageFailRuns);
  if(down.length)lines.push('Confere a página: '+down.map(p=>shortUrl(p.url)+' ('+(p.status||p.code)+')').join(', ')+'.');
  else if(hookSilent)lines.push('O checkout foi aberto e o webhook não recebe aviso desde '+(hookAt===null?'antes de hoje':clock(hookAt,tz))+'. Confira o webhook do checkout.');
  else if(checkoutOpen===false)lines.push('Gente chegando na página e ninguém iniciou checkout: confira o botão e o link do checkout.');
  // Passing checks are not proof that the funnel sells: say what was checked and what is left to look at.
  else if(pageOk===true&&checkoutOpen===true)lines.push('Página e checkout responderam, mas isso não explica a falta de venda aprovada: confira campanhas e oferta no Bunker.');
  else lines.push('Parte dos checks ficou sem leitura (?): confira página, checkout e campanhas no Bunker.');
  out.push({kind:'nosale',id:'ns:'+project.id+':'+(orders.lastSaleAt||'none')+':'+bucket,projectId:project.id,project:name,tone:'warn',title,lines,
   checks:{page:pageOk,checkout:checkoutOpen,traffic:traffic.running}});
 }
 for(const p of pages)if(p.ok===false&&(failRuns[p.url]||0)>=vigiaPolicy.pageFailRuns){
  out.push({kind:'page',id:'pg:'+project.id+':'+p.url+':'+localDay(now),projectId:project.id,project:name,tone:'bad',title:name+': página fora do ar',
   lines:[shortUrl(p.url)+' '+(p.status?'respondeu '+p.status:'não respondeu ('+p.code+')')+' em '+vigiaPolicy.pageFailRuns+' leituras seguidas.','Tráfego rodando '+mark(traffic.running)+' · Confere a página e o domínio.']});
 }
 // vTurb against the orders the checkout delivered today, of any status: the vTurb also counts Pix generated and not
 // paid (13/11, Gabe: 11 vTurb, 9 orders, 1 approved, webhook receiving), which is not a webhook failure.
 const vt=video?.vturbConversions,od=orders?.ordersToday,ap=orders?.approvedToday;
 if(finite(vt)&&finite(od)&&vt-od>=vigiaPolicy.mismatchMin){
  const level=Math.floor((vt-od-vigiaPolicy.mismatchMin)/vigiaPolicy.mismatchStep);
  // Observed, suspicion, next step (13/11 review): a difference is not proof of a webhook failure. A checkout notice
  // within the no-sale window means the webhook is receiving, so the signal is a warning; without one it is red.
  const hookRecent=hookAt!==null&&now-hookAt<windowMs,hookWhen=hookAt===null?null:clock(hookAt,tz)+(localDay(hookAt)!==localDay(now)?' de '+localDay(hookAt).split('-').reverse().slice(0,2).join('/'):'');
  out.push({kind:'mismatch',id:'mm:'+project.id+':'+localDay(now)+':'+level,projectId:project.id,project:name,tone:hookRecent?'warn':'bad',title:name+': as vendas não batem',
   lines:['O vTurb contou '+vt+' '+(vt===1?'conversão':'conversões')+' hoje e o checkout registrou '+od+' pedido'+(od===1?'':'s')+(finite(ap)?' ('+ap+' aprovado'+(ap===1?'':'s')+')':'')+'.',
    hookRecent?'O checkout avisou às '+hookWhen+', então o webhook está recebendo: a diferença pode ser Pix não pago, atraso do vTurb ou pedido que não chegou.'
     :(hookWhen?'Último aviso do checkout: '+hookWhen+'. Pode ser falha no webhook.':'Nenhum aviso do checkout registrado. Pode ser falha no webhook.'),
    'Próximo passo: compare as vendas do vTurb com os pedidos no painel do checkout'+(hookRecent?'.':' e confira o webhook.')]});
 }
 return {signals:out,status:{name,lastSaleAt:orders?.lastSaleAt??null,noSaleMs:noSaleFor,approvedToday:ap??null,ordersToday:od??null,vturbConversions:vt??null,
  spendToday:sample?.spend??null,trafficRunning:traffic.running,pageOk,checkoutOpen,checkoutLastEventAt:checkout?.lastEventAt??null,
  pages:pages.map(p=>({url:p.url,ok:p.ok,status:p.status??null,code:p.code??null,failRuns:failRuns[p.url]||0}))}};
}
const shortUrl=u=>{try{const x=new URL(u);return x.host+(x.pathname==='/'?'':x.pathname);}catch{return u;}};

const kindRank={page:0,mismatch:1,nosale:2};
/** The current signals of every project, most urgent first (page down, mismatch, then the longest without a sale). */
export function vigiaSignals(evaluations){
 return evaluations.flatMap(e=>e.signals.map(sig=>({...sig,noSaleMs:sig.kind==='nosale'?e.status.noSaleMs:null})))
  .sort((a,b)=>kindRank[a.kind]-kindRank[b.kind]||(b.noSaleMs??0)-(a.noSaleMs??0)||a.title.localeCompare(b.title))
  .map(({noSaleMs:_n,...sig})=>sig);
}

// ---- One VIGIA read (the executor's step) ----

const safeCode=e=>/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'READ_FAILED';
async function settle(p){try{return {value:await p};}catch(e){return {error:safeCode(e)};}}

/**
 * Reads every configured project and evaluates it. `read(tool,args)` is the executor's Malva read client (allowlisted,
 * buyer data stripped by the bridge). Returns the next stored state with the current signals for the notch; nothing
 * here writes to the central or to any platform, and nothing is sent anywhere.
 */
export async function runVigia({projects,read,fetchFn=fetch,liveItems=[],prior=null,now=Date.now()}){
 const state=prior?.version===vigiaPolicy.version?prior:{version:vigiaPolicy.version};
 const history={...(state.history||{})},failRuns={...(state.failRuns||{})},evaluations=[],errors={},status={};
 for(const project of projects){
  const id=project.id;
  const [today,integrations,videos,pageRead]=await Promise.all([
   settle(read('tracking_orders',{projectId:id,preset:'today',status:['approved'],limit:1})),
   settle(read('tracking_checkout_integrations',{projectId:id})),
   settle(read('tracking_videos',{projectId:id,preset:'today',limit:1})),
   settle(read('tracking_pages',{projectId:id,preset:'today',limit:30}))]);
  let recent=null;
  if(today.value&&!arr(today.value.items).length){const r=await settle(read('tracking_orders',{projectId:id,preset:'3d',status:['approved'],limit:1}));if(r.error)errors[project.name]={...(errors[project.name]||{}),orders3d:r.error};else recent=r.value;}
  const fail={};for(const [k,r] of Object.entries({orders:today,checkout:integrations,videos,pages:pageRead}))if(r.error)fail[k]=r.error;
  if(Object.keys(fail).length)errors[project.name]={...(errors[project.name]||{}),...fail};
  const orders=today.value&&(arr(today.value.items).length||recent)?ordersFacts(today.value,recent):null;
  const pf=pageRead.value?pageFacts(pageRead.value):{visitors:null,checkouts:null,front:[]};
  const probes=await Promise.all(pf.front.map(p=>probePage(fetchFn,p.url)));
  for(const p of probes)failRuns[p.url]=p.ok===false?(failRuns[p.url]||0)+1:0;
  const spend=liveSpend(liveItems,id,{now});
  const sample={at:new Date(now).toISOString(),day:spend?.day||localDay(now),spend:spend?.spend??null,visitors:pf.visitors,checkouts:pf.checkouts,approved:orders?.approvedToday??null,orders:orders?.ordersToday??null};
  const e=evaluateProject({project,sample,history:history[id],orders,checkout:integrations.value?checkoutFacts(integrations.value):null,video:videos.value?videoFacts(videos.value):null,pages:probes,failRuns,now});
  history[id]=addSample(history[id],sample,{now});
  evaluations.push({project,...e});status[id]=e.status;
 }
 // Failure counters of pages that left the funnel are forgotten.
 const live=new Set(evaluations.flatMap(e=>e.status.pages.map(p=>p.url)));for(const u of Object.keys(failRuns))if(!live.has(u))delete failRuns[u];
 const {ledger:_l,preview:_p,configured:_c,pending:_q,sent:_s,lastSentAt:_a,lastError:_e,lastErrorAt:_t,...kept}=state;
 return {state:{...kept,version:vigiaPolicy.version,history,failRuns,status,errors,lastRunAt:new Date(now).toISOString(),signals:vigiaSignals(evaluations)}};
}

/** What the notch summary carries (merged at read time): the current signals of one project or of all. Signals of a
 * read older than `signalMaxAgeMs` (executor stopped or paused) are not shown as current. */
export function vigiaView(state,{project='all',now=Date.now()}={}){
 const at=time(state?.lastRunAt);
 if(at===null)return null;
 const fresh=now-at<=vigiaPolicy.signalMaxAgeMs;
 const mine=sig=>project==='all'||sig.projectId===project;
 return {at:new Date(at).toISOString(),fresh,signals:fresh?arr(state.signals).filter(mine):[]};
}

/** What the executor status shows (no buyer data). */
export function vigiaStatus(state){
 if(!state)return {lastRunAt:null,signals:[]};
 return {lastRunAt:state.lastRunAt||null,signals:arr(state.signals),errors:state.errors||{},projects:Object.values(state.status||{})};
}
