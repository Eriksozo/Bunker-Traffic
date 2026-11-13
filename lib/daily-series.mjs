/**
 * Day-by-day table for the notch ("Dias" tab): Malva's day series per configured project, Meta spend and traffic
 * sales like every Bunker read. Display only: it never feeds analysis, proposals, approvals or order checks.
 * "Todos os projetos" adds the configured projects day by day; ratios are rebuilt from the sums, never averaged.
 */
export const dailySeriesPolicy=Object.freeze({version:1,refreshMs:10*60000,staleMs:40*60000,metrics:Object.freeze(['spend','orders','revenueNet','profit','adCosts','roi'])});

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>finite(v)?v:null;
const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const round=(v,d=2)=>Math.round(v*10**d)/10**d;

/** Arguments of the single Malva read per project: last 7 days including today, one point per day. */
export function dailySeriesArgs(projectId){
 return {projectId,metrics:[...dailySeriesPolicy.metrics],preset:'7d',granularity:'day',provider:['meta'],sales:'traffic'};
}

const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(Date.parse(v)).toISOString():null;
/** When the source itself was current (curadoria of 13/11/2026): the older of Malva's answer time and its last sync
 * with Meta. Unknown when Malva does not say when it synced: a fresh consultation never stands in for it. */
function sourceTime(raw){
 const fresh=instant(raw?.freshAt),sync=instant(raw?.lastSyncAt);
 if(!sync)return null;
 // A sync after the answer itself is impossible: that source time is invalid, not "very fresh".
 if(fresh&&Date.parse(sync)>Date.parse(fresh)+300000)return null;
 return fresh&&Date.parse(fresh)<Date.parse(sync)?fresh:sync;
}

/** One `tracking_series` answer → plain days. Missing numbers stay null (N/D), never zero. `sourceAt`: see sourceTime. */
export function projectDays(raw){
 const currency=typeof raw?.currency==='string'&&/^[A-Z]{3}$/.test(raw.currency)?raw.currency:null;
 const timezone=typeof raw?.period?.timezone==='string'?raw.period.timezone:null;
 const days=(Array.isArray(raw?.points)?raw.points:[]).filter(p=>dayPattern.test(p?.key||'')).slice(-14)
  .map(p=>({day:p.key,spend:num(p.spend),orders:num(p.orders),revenueNet:num(p.revenueNet),profit:num(p.profit),adCosts:num(p.adCosts),roi:num(p.roi)}));
 return {currency,timezone,days,sourceAt:sourceTime(raw)};
}

/** CPA = media / orders (all orders, upsells included, as the web daily table); ROAS = net revenue / media;
 * ROI (Malva) = (profit + media + ad fees) / (media + ad fees). Without a denominator the ratio is N/D. */
function finish(r,keepRoi){
 const cost=finite(r.spend)&&finite(r.adCosts)?r.spend+r.adCosts:null;
 const roi=keepRoi&&finite(r.roi)?r.roi:finite(r.profit)&&cost?((r.profit+cost)/cost):null;
 return {day:r.day,spend:finite(r.spend)?round(r.spend):null,orders:finite(r.orders)?r.orders:null,
  cpa:finite(r.spend)&&finite(r.orders)&&r.orders>0?round(r.spend/r.orders):null,
  revenueNet:finite(r.revenueNet)?round(r.revenueNet):null,profit:finite(r.profit)?round(r.profit):null,
  roas:finite(r.revenueNet)&&finite(r.spend)&&r.spend>0?round(r.revenueNet/r.spend,4):null,roi:finite(roi)?round(roi,4):null};
}

function civilDay(now,timezone){
 try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));return ['year','month','day'].map(t=>parts.find(p=>p.type===t)?.value).join('-');}
 catch{return null;}
}

/**
 * Notch block for one scope. `stored` is what the executor keeps: {checkedAt, projects:{[id]:{at,sourceAt,currency,timezone,days,error}}}.
 * `at` is when the Bunker consulted Malva; `sourceAt` is when the source itself was current. Freshness and the time
 * shown follow `sourceAt`: unknown, future or old source time is stale, whatever the consultation clock says.
 * A project never read leaves "all" unavailable (a partial sum would look like a smaller business); a project whose
 * latest read failed keeps its previous days and marks the block stale.
 */
export function daysSummary(stored,{project='all',config={},now=Date.now()}={}){
 const ids=project==='all'?Object.keys(config||{}):[project];
 const name=id=>config?.[id]?.projectName||id;
 const readings=ids.map(id=>({id,r:stored?.projects?.[id]}));
 const missing=readings.filter(x=>!x.r?.at||!Array.isArray(x.r.days)||!x.r.days.length).map(x=>name(x.id));
 const failing=readings.filter(x=>x.r?.error).map(x=>name(x.id));
 if(!ids.length||missing.length)return {rows:[],currency:null,today:null,at:null,stale:false,missing,failing,error:missing.length?'Sem leitura diária de '+missing.join(', '):'Sem projetos configurados'};
 const currencies=[...new Set(readings.map(x=>x.r.currency))];
 const currency=currencies.length===1?currencies[0]:null;
 const timezone=readings[0].r.timezone||'America/Sao_Paulo';
 const sources=readings.map(x=>Date.parse(x.r.sourceAt||'')),known=sources.every(t=>Number.isFinite(t)&&t<=now+300000);
 const oldest=known?Math.min(...sources):NaN;
 const today=civilDay(now,timezone);
 // Only days every project reported; a single project keeps Malva's own ROI.
 const shared=readings.map(x=>new Map(x.r.days.map(d=>[d.day,d])));
 const days=[...shared[0].keys()].filter(day=>shared.every(m=>m.has(day))&&(!today||day<=today)).sort().slice(-7);
 const add=(a,b)=>finite(a)&&finite(b)?a+b:null;
 const rows=days.map(day=>{
  const parts=shared.map(m=>m.get(day));
  if(parts.length===1)return finish(parts[0],true);
  const sum=parts.slice(1).reduce((acc,p)=>({day,spend:add(acc.spend,p.spend),orders:add(acc.orders,p.orders),revenueNet:add(acc.revenueNet,p.revenueNet),profit:add(acc.profit,p.profit),adCosts:add(acc.adCosts,p.adCosts)}),{...parts[0],day});
  const row=finish(sum,false);
  // Money summed across different currencies would be meaningless.
  return currency?row:{...row,spend:null,cpa:null,revenueNet:null,profit:null,roas:null,roi:null};
 }).reverse();
 // `checkedAt`: when the Bunker consulted (shown as "consultado", never as the source time). Malva's day series carries
 // no sync time today, so `sourceKnown` is false and the block says so instead of looking fresh.
 const checked=Math.min(...readings.map(x=>Date.parse(x.r.at)||0));
 return {rows,currency,today,at:Number.isFinite(oldest)&&oldest>0?new Date(oldest).toISOString():null,
  checkedAt:Number.isFinite(checked)&&checked>0?new Date(checked).toISOString():null,sourceKnown:known,
  stale:failing.length>0||!known||now-oldest>dailySeriesPolicy.staleMs,missing:[],failing,error:null};
}
