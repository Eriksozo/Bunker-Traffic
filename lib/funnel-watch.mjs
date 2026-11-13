// VIGIA: the funnel watched 24 hours (owner request of 13/11/2026, slide "VIGIA: o funil vigiado 24 horas").
// For each configured Meta project (Gabe, John, Leandro, Murilo, Nico, Ronald) the Cloudflare executor, inside the pulse
// it already runs (no new cron or daemon), reads the funnel every 10 minutes and posts to a Discord channel when:
//  - there is no approved sale for 3 hours or more while the traffic is spending ("Murilo: sem venda há 4h"), with the
//    three checks of the slide: the pages answer, the checkout is being opened, the traffic is running;
//  - a front page of the funnel does not answer (two reads in a row);
//  - the vTurb counts 3 or more conversions today than the checkout approved ("as vendas não batem": webhook);
//  - and, after a "sem venda" alert, when sales come back.
// Owner decisions of 13/11/2026: 3 h for every project, no quiet hours (it only rings "sem venda" while spending),
// mismatch from 3 sales. Read-only: it never pauses, activates or changes a budget, never proposes or approves anything,
// and carries no buyer data (the Malva bridge strips it before it leaves Supabase). Without DISCORD_VIGIA_WEBHOOK it
// keeps reading and shows what it would send in the executor status, but sends nothing.
import {isWarmupCampaign} from './campaign-scope.mjs';
import {currentLiveSnapshot} from './live-display.mjs';

export const vigiaPolicy=Object.freeze({version:1,noSaleHours:3,repeatHours:3,mismatchMin:3,mismatchStep:3,
 readMs:10*60000,historyMs:8*3600000,liveMaxAgeMs:20*60000,trafficLookbackMs:60*60000,trafficMinGapMs:20*60000,
 pageTimeoutMs:8000,maxPages:3,pageFailRuns:2,maxPerRun:6,seenLimit:400,previewLimit:10,timezone:'America/Sao_Paulo',
 username:'VIGIA',footer:'Só leitura: o VIGIA nunca pausa, ativa nem mexe em orçamento.'});
export const vigiaColors=Object.freeze({warn:0xE3B341,bad:0xDA3633,good:0x2EA043,info:0x6E7681});

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
/** "4h", "1h20", "35 min". */
export function span(ms){
 if(!finite(ms)||ms<0)return 'N/D';
 const m=Math.floor(ms/60000),h=Math.floor(m/60),r=m%60;
 return h?(r?h+'h'+String(r).padStart(2,'0'):h+'h'):m+' min';
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
  const title=quietMs===null?name+': sem venda nos últimos 3 dias':name+': sem venda há '+hours+'h';
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
  else lines.push('Funil de pé: confira as campanhas e a oferta no Bunker.');
  out.push({kind:'nosale',key:'ns:'+project.id+':'+(orders.lastSaleAt||'none')+':'+bucket,open:project.id,saleAt:orders.lastSaleAt||null,title,lines,color:vigiaColors.warn});
 }
 for(const p of pages)if(p.ok===false&&(failRuns[p.url]||0)>=vigiaPolicy.pageFailRuns){
  out.push({kind:'page',key:'pg:'+project.id+':'+p.url+':'+localDay(now),pageKey:project.id+'|'+p.url,title:name+': página fora do ar',
   lines:[shortUrl(p.url)+' '+(p.status?'respondeu '+p.status:'não respondeu ('+p.code+')')+' em '+vigiaPolicy.pageFailRuns+' leituras seguidas.','Tráfego rodando '+mark(traffic.running)+' · Confere a página e o domínio.'],color:vigiaColors.bad});
 }
 // vTurb against the orders the checkout delivered today, of any status: the vTurb also counts Pix generated and not
 // paid (13/11, Gabe: 11 vTurb, 9 orders, 1 approved, webhook receiving), which is not a webhook failure.
 const vt=video?.vturbConversions,od=orders?.ordersToday,ap=orders?.approvedToday;
 if(finite(vt)&&finite(od)&&vt-od>=vigiaPolicy.mismatchMin){
  const level=Math.floor((vt-od-vigiaPolicy.mismatchMin)/vigiaPolicy.mismatchStep);
  out.push({kind:'mismatch',key:'mm:'+project.id+':'+localDay(now)+':'+level,title:name+': as vendas não batem',
   lines:['O vTurb marcou '+vt+' venda'+(vt===1?'':'s')+' hoje e o checkout registrou '+od+' pedido'+(od===1?'':'s')+(finite(ap)?' ('+ap+' aprovado'+(ap===1?'':'s')+')':'')+'. Confira o webhook.',
    hookAt!==null?'Último aviso do checkout: '+clock(hookAt,tz)+(localDay(hookAt)!==localDay(now)?' de '+localDay(hookAt).split('-').reverse().slice(0,2).join('/'):'')+'.':'Nenhum aviso do checkout registrado.'],color:vigiaColors.bad});
 }
 return {signals:out,status:{name,lastSaleAt:orders?.lastSaleAt??null,noSaleMs:noSaleFor,approvedToday:ap??null,ordersToday:od??null,vturbConversions:vt??null,
  spendToday:sample?.spend??null,trafficRunning:traffic.running,pageOk,checkoutOpen,checkoutLastEventAt:checkout?.lastEventAt??null,
  pages:pages.map(p=>({url:p.url,ok:p.ok,status:p.status??null,code:p.code??null,failRuns:failRuns[p.url]||0}))}};
}
const shortUrl=u=>{try{const x=new URL(u);return x.host+(x.pathname==='/'?'':x.pathname);}catch{return u;}};

/** The alerts to send now against the ledger: new signals, "voltou a vender" after an alerted no-sale, "página voltou"
 * after an alerted page, and the one-time "VIGIA ligado". Pure. */
export function vigiaAlerts(evaluations,ledger,{now=Date.now(),projects=[]}={}){
 const seen=ledger?.seen||{},open={...(ledger?.open||{})},downPages={...(ledger?.downPages||{})},fresh=[],present=[];
 if(!ledger?.hello)fresh.push({kind:'hello',key:'hello',title:'VIGIA ligado',color:vigiaColors.info,
  lines:['Vigiando '+projects.map(p=>p.name).join(', ')+' a cada 10 minutos.','Avisa aqui: sem venda há '+vigiaPolicy.noSaleHours+'h com o tráfego rodando (conferindo páginas, checkout e tráfego), página fora do ar e vTurb × checkout com diferença de '+vigiaPolicy.mismatchMin+' vendas ou mais.']});
 for(const e of evaluations){
  for(const s of e.signals){present.push(s.key);if(!seen[s.key])fresh.push(s);}
  const id=e.project.id,last=time(e.status.lastSaleAt);
  if(open[id]&&last!==null&&last>(time(open[id].lastSaleAt)??0)){
   fresh.push({kind:'recovered',key:'rc:'+id+':'+e.status.lastSaleAt,title:e.project.name+': voltou a vender',color:vigiaColors.good,
    lines:['Venda às '+clock(last)+(open[id].lastSaleAt?', depois de '+span(last-time(open[id].lastSaleAt))+' sem venda.':'.')],close:id});
  }
  for(const p of e.status.pages)if(p.ok===true&&downPages[id+'|'+p.url])fresh.push({kind:'pageup',key:'pu:'+id+':'+p.url+':'+now,title:e.project.name+': página voltou',color:vigiaColors.good,lines:[shortUrl(p.url)+' respondeu '+p.status+'.'],pageUp:id+'|'+p.url});
 }
 return {fresh,present};
}

/** Ledger after the alerts that went out (or were refused for good). Bounded like the phone ledger. */
export function rememberVigia(ledger,done,{now=Date.now(),keep=[]}={}){
 const seen={...(ledger?.seen||{})},open={...(ledger?.open||{})},downPages={...(ledger?.downPages||{})};let hello=ledger?.hello||null;
 for(const a of done){
  if(a.kind==='hello')hello=new Date(now).toISOString();
  else if(a.kind==='recovered'){delete open[a.close];}
  else if(a.kind==='pageup'){delete downPages[a.pageUp];}
  else seen[a.key]=new Date(now).toISOString();
  if(a.kind==='nosale')open[a.open]={lastSaleAt:a.saleAt??null,at:new Date(now).toISOString()};
  if(a.kind==='page')downPages[a.pageKey]=new Date(now).toISOString();
 }
 const keys=Object.keys(seen);
 if(keys.length>vigiaPolicy.seenLimit){const must=new Set(keep);const drop=keys.filter(k=>!must.has(k)).sort((a,b)=>seen[a].localeCompare(seen[b])).slice(0,keys.length-vigiaPolicy.seenLimit);for(const k of drop)delete seen[k];}
 return {...(ledger||{}),seen,open,downPages,hello};
}

// ---- Discord ----

/** Only a Discord webhook address is accepted; the address itself is never logged, stored or echoed. */
export function validDiscordWebhook(url){
 try{const u=new URL(String(url||'').trim());return u.protocol==='https:'&&['discord.com','discordapp.com','ptb.discord.com','canary.discord.com'].includes(u.hostname)&&/^\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,200}\/?$/.test(u.pathname);}catch{return false;}
}
/** Embed like the slide's card: bold title, check line, colored side bar. Mentions are disabled, so a campaign or page
 * name can never ping @everyone or a role. */
export function discordPayload(alert){
 return {username:vigiaPolicy.username,allowed_mentions:{parse:[]},
  embeds:[{title:clip(alert.title,250),description:clip(arr(alert.lines).join('\n'),3500)||undefined,color:alert.color??vigiaColors.info,footer:{text:vigiaPolicy.footer}}]};
}
/** One Discord message. {ok} or {ok:false,retry,code}; never throws and never echoes the webhook address. */
export async function sendDiscord(fetchFn,url,alert){
 try{
  const res=await fetchFn(String(url).trim(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(discordPayload(alert)),signal:AbortSignal.timeout(8000)});
  try{await res.body?.cancel();}catch{}
  if(res.ok)return {ok:true};
  // 429/5xx: try again on the next read. Other 4xx (deleted webhook, invalid body): retrying would repeat the refusal.
  return {ok:false,retry:res.status===429||res.status>=500,code:'DISCORD_'+res.status};
 }catch{return {ok:false,retry:true,code:'DISCORD_NETWORK'};}
}

// ---- One VIGIA read (the executor's step) ----

const safeCode=e=>/^[A-Z][A-Z0-9_]{0,59}$/.test(e?.code||'')?e.code:'READ_FAILED';
async function settle(p){try{return {value:await p};}catch(e){return {error:safeCode(e)};}}

/**
 * Reads every configured project, evaluates, and delivers at most `maxPerRun` alerts to Discord (when configured).
 * `read(tool,args)` is the executor's Malva read client (allowlisted, buyer data stripped by the bridge).
 * Returns the next stored state; nothing here writes to the central or to any platform.
 */
export async function runVigia({projects,read,fetchFn=fetch,liveItems=[],prior=null,webhook=null,now=Date.now()}){
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
 const ledger=state.ledger||{},{fresh,present}=vigiaAlerts(evaluations,ledger,{now,projects});
 const configured=validDiscordWebhook(webhook);
 const base={...state,version:vigiaPolicy.version,history,failRuns,status,errors,lastRunAt:new Date(now).toISOString(),configured,
  preview:fresh.filter(a=>a.kind!=='hello').slice(0,vigiaPolicy.previewLimit).map(a=>({kind:a.kind,title:a.title,lines:a.lines}))};
 if(!configured)return {state:{...base,ledger,pending:fresh.length},sent:0};
 const done=[];let sent=0,error=null;
 for(const alert of fresh.slice(0,vigiaPolicy.maxPerRun)){
  const r=await sendDiscord(fetchFn,webhook,alert);
  if(r.ok){done.push(alert);sent++;continue;}
  error=r.code;if(!r.retry)done.push(alert);
  break;
 }
 const at=new Date(now).toISOString();
 return {state:{...base,ledger:rememberVigia(ledger,done,{now,keep:present}),pending:fresh.length-done.length,sent:(state.sent||0)+sent,
  lastSentAt:sent?at:state.lastSentAt||null,lastError:error??(sent?null:state.lastError??null),lastErrorAt:error?at:state.lastErrorAt||null},sent};
}

/** What the executor status shows (no webhook address, no buyer data). */
export function vigiaStatus(state){
 if(!state)return {configured:false,lastRunAt:null};
 return {configured:!!state.configured,lastRunAt:state.lastRunAt||null,sent:state.sent||0,lastSentAt:state.lastSentAt||null,lastError:state.lastError||null,lastErrorAt:state.lastErrorAt||null,
  pending:state.pending||0,hello:!!state.ledger?.hello,preview:arr(state.preview),errors:state.errors||{},projects:Object.values(state.status||{})};
}
