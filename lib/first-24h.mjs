/**
 * First 24 hours of a new Meta campaign (docs/first-24h-protocol.md).
 * Identifies scheduled and newly launched campaigns (tests or not) and applies the owner's ceiling:
 * a new campaign with 0 or 1 checkout (IC) and no sale must not spend the low-IC ceiling (R$110 by default).
 * Pure: reading aid and shadow input only. Never a proposal, an approval or a provider command.
 */
import {isWarmupCampaign} from './campaign-scope.mjs';
import {isTestCampaign} from './test-launch.mjs';

/** Owner decision of 07/11/2026. A project may lower the ceiling in the private policy (`first24hLowIcLimit`). */
export const first24hPolicy=Object.freeze({version:1,lowIcSpendLimitBrl:110,lowIcMaxCheckouts:1,alertShare:0.7,pauseShare:0.9,scheduleHorizonDays:14,nameAheadDays:60});
export const first24hStages=Object.freeze({scheduled:'Programada',firstDay:'Primeiras 24h',secondDay:'2º dia'});
const CLOSED=['7d','3d','yesterday'],finite=Number.isFinite,time=v=>Date.parse(v||'');
const round2=n=>Math.round(n*100)/100;
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};

/**
 * Days between the leading DD/MM of a campaign name and the local day: 1 = tomorrow, 0 = today, -1 = yesterday.
 * The year is the latest one not beyond `nameAheadDays` (60) ahead (handles December/January): a date further ahead
 * reads as last year's (01/05 on 09/11 is 192 days ago), while 29/11 or 24/12 still read ahead so the no-delivery rule
 * keeps treating them as dated ahead. Scheduling by name still needs `scheduleHorizonDays`. A name date is a hint, never proof.
 * @returns {number|null}
 */
export function nameDateOffset(name,now=Date.now(),timezone='America/Sao_Paulo'){
 const m=/^\s*\+?(\d{2})\/(\d{2})(?![\d/])/.exec(String(name||''));if(!m)return null;
 const dd=Number(m[1]),mm=Number(m[2]),today=localDay(now,timezone);
 if(!today||mm<1||mm>12||dd<1||dd>31)return null;
 const [y,mo,d]=today.split('-').map(Number),base=Date.UTC(y,mo-1,d);let best=null;
 for(const year of [y-1,y,y+1]){
  const t=Date.UTC(year,mm-1,dd);if(new Date(t).getUTCDate()!==dd)continue;
  const offset=Math.round((t-base)/86400000);if(offset<=first24hPolicy.nameAheadDays&&(best===null||offset>best))best=offset;
 }
 return best;
}
const startLabel=(at,timezone)=>{try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));return `${p.day}/${p.month} ${p.hour}:${p.minute}`;}catch{return null;}};
const dayLabel=(offset,now,timezone)=>{const d=localDay(now+offset*86400000,timezone);return d?`${d.slice(8,10)}/${d.slice(5,7)}`:null;};

/**
 * Stage of a campaign in its launch: 'scheduled' (dated ahead, no delivery yet), 'first-day' (first spend today,
 * or dated today without earlier spend), 'second-day' (first spend yesterday) or null (older or unknown).
 * `spansYesterday`: a first day by the Meta schedule or delivery that began before today's local midnight, so its
 * spend since launch is yesterday + today (as on the second day).
 * Earlier spend always wins over a renamed date. Malva does not send start dates today, so the basis says what supports it.
 * @param {any} row today's campaign row
 * @param {Record<string,any>} [windows] closed rows of the same object: 7d, 3d, yesterday
 * @param {{now?:number,timezone?:string,noSpendPeriods?:string[]}} [options]
 */
export function newCampaignStage(row,windows={},{now=Date.now(),timezone='America/Sao_Paulo',noSpendPeriods=[]}={}){
 if(!row||row.level&&row.level!=='campaign'||row.provider&&String(row.provider).toLowerCase()!=='meta'||isWarmupCampaign(row.name))return null;
 const same=r=>r&&r.adAccountId===row.adAccountId&&r.externalId===row.externalId;
 const hist=Object.fromEntries(CLOSED.map(p=>[p,same(windows?.[p])?windows[p]:null])),noSpend=new Set(Array.isArray(noSpendPeriods)?noSpendPeriods:[]);
 const spentIn=p=>!!hist[p]&&finite(hist[p].spend)&&hist[p].spend>0;
 const zeroIn=p=>hist[p]?finite(hist[p].spend)&&hist[p].spend===0:noSpend.has(p);
 const offset=nameDateOffset(row.name,now,timezone),startsAt=time(row.startAt),delivered=time(row.deliveryStartedAt);
 const live=finite(row.spend)&&row.spend>0||finite(row.impressions)&&row.impressions>0,priorSpend=CLOSED.some(spentIn);
 // A first day counted from the real start can cross local midnight: callers then add yesterday's closed spend.
 const spans=t=>localDay(t,timezone)!==localDay(now,timezone)?{spansYesterday:true}:{};
 const out=(stage,basis,extra={})=>({version:first24hPolicy.version,stage,label:stage==='scheduled'?first24hStages.scheduled:stage==='first-day'?first24hStages.firstDay:first24hStages.secondDay,basis,nameOffset:offset,...extra});
 if(!live&&!priorSpend){
  if(finite(startsAt)&&startsAt>now)return out('scheduled','schedule',{startsAt:row.startAt,startsOn:startLabel(startsAt,timezone)});
  // A real Meta start already past wins over a name dated ahead (renamed campaign): the name schedules only without it.
  if(!finite(startsAt)&&offset!==null&&offset>=1&&offset<=first24hPolicy.scheduleHorizonDays)return out('scheduled','name',{startsOn:dayLabel(offset,now,timezone)});
 }
 // Real schedule (Meta start_time / created_time): the 24h count starts at the later of the two.
 const created=time(row.createdAt),began=finite(startsAt)?Math.max(startsAt,finite(created)?created:-Infinity):NaN;
 if(!finite(delivered)&&finite(began)&&began<=now){
  const ageHours=(now-began)/3600000;
  if(ageHours<24)return out('first-day','schedule',{ageHours:round2(ageHours),startsAt:row.startAt,...spans(began)});
  if(ageHours<48)return out('second-day','schedule',{ageHours:round2(ageHours),startsAt:row.startAt});
  if(!isTestCampaign(row.name))return null;
 }
 if(finite(delivered)&&delivered<=now){
  const ageHours=(now-delivered)/3600000;
  return ageHours<24?out('first-day','delivery',{ageHours:round2(ageHours),...spans(delivered)}):ageHours<48?out('second-day','delivery',{ageHours:round2(ageHours)}):null;
 }
 // Outside tests, a reactivated older campaign is not "new": the name must date it from the last days.
 const test=isTestCampaign(row.name),recentName=offset!==null&&offset>=-2&&offset<=0;
 if(!priorSpend){
  if(live&&(offset===0||offset===-1&&zeroIn('yesterday')))return out('first-day','name');
  if(live&&test&&CLOSED.every(zeroIn))return out('first-day','first-spend');
  if(!live&&offset===0)return out('first-day','name-awaiting',{awaitingDelivery:true});
  return null;
 }
 const y=hist.yesterday,d3=hist['3d'],d7=hist['7d'];
 if((test||recentName)&&spentIn('yesterday')&&d3&&d7&&Math.abs(d3.spend-y.spend)<0.01&&Math.abs(d7.spend-y.spend)<0.01)return out('second-day','first-spend-yesterday');
 return null;
}

/**
 * Where a new campaign stands against its ceiling. `totals` is the spend since launch (today, or yesterday + today on day 2
 * and on a first day with `spansYesterday`).
 * Levels: waiting (no spend), sold (acquisition), watch, alert (≥70% of the ceiling), pause (≥90%: stop before crossing it),
 * over (ceiling crossed). With 2+ IC and no sale the project's private threshold applies, paused at the threshold itself.
 * @param {{spend?:number|null,checkouts?:number|null,frontOrders?:number|null,orders?:number|null,revenueNet?:number|null}} totals
 * @param {any} [params] private per-project policy
 */
export function first24hGuard(totals,params={}){
 const p=params||{},spend=totals?.spend,ic=totals?.checkouts;
 // Any known sale (front, order or revenue > 0) is a sale even with another field N/D; "0 venda" needs all three known.
 const fields=['frontOrders','orders','revenueNet'],known=fields.every(k=>finite(totals?.[k])),anySale=fields.some(k=>finite(totals?.[k])&&totals[k]>0);
 // A purchase Meta already sees counts as a sale signal before the checkout reaches the Malva.
 if(finite(totals?.metaPurchases)&&totals.metaPurchases>0)return {level:'sold',limit:null,pauseAt:null,basis:'meta-sale',spend:finite(spend)?round2(spend):null,checkouts:finite(ic)?ic:null};
 if(anySale)return {level:'sold',limit:null,pauseAt:null,basis:'sale',spend:finite(spend)?round2(spend):null,checkouts:finite(ic)?ic:null};
 if(!finite(spend)||spend<=0)return {level:'waiting',limit:null,pauseAt:null,basis:'no-spend',spend:finite(spend)?spend:null,checkouts:finite(ic)?ic:null};
 const ceiling=finite(p.first24hLowIcLimit)&&p.first24hLowIcLimit>0?Math.min(p.first24hLowIcLimit,first24hPolicy.lowIcSpendLimitBrl):first24hPolicy.lowIcSpendLimitBrl;
 let limit,basis,pauseAt,noCheckoutLimit=false;
 if(finite(ic)&&ic<=first24hPolicy.lowIcMaxCheckouts){
  limit=ic===0&&finite(p.pauseTestMinSpendNoCheckout)&&p.pauseTestMinSpendNoCheckout>0?Math.min(ceiling,p.pauseTestMinSpendNoCheckout):ceiling;
  basis='low-ic';pauseAt=round2(limit*first24hPolicy.pauseShare);noCheckoutLimit=limit<ceiling;
 }else if(finite(ic)){
  limit=finite(p.pauseTestMinSpend)&&p.pauseTestMinSpend>0?p.pauseTestMinSpend:null;basis='project';pauseAt=limit;
 }else{limit=ceiling;basis='ic-unknown';pauseAt=round2(limit*first24hPolicy.pauseShare);}
 const level=!known?'watch':limit===null?'watch':spend>=limit?'over':spend>=pauseAt?'pause':spend>=limit*first24hPolicy.alertShare?'alert':'watch';
 return {level,limit,pauseAt,basis,spend:round2(spend),checkouts:finite(ic)?ic:null,salesKnown:known,...(noCheckoutLimit?{noCheckoutLimit:true}:{})};
}

/** Short pt-BR line for cards and the notch. */
export function first24hReason(stage,guard){
 // Unknown sales stay N/D: never write "0 venda" without a complete sales reading.
 const ic=guard.checkouts===null?'IC N/D':`${guard.checkouts} IC`,spend=finite(guard.spend)?`R$${guard.spend}`:'gasto N/D',sale=guard.salesKnown===false?'venda N/D':'0 venda';
 // todayOnly: it sold before today and sells nothing today, so today alone is held to the ceiling.
 const head=guard.todayOnly?`Campanha nova ${stage?.stage==='second-day'?'no 2º dia':'nas primeiras 24h'}: vendeu ontem, hoje sem venda (gasto de hoje)`:stage?.stage==='second-day'?'Campanha nova no 2º dia (gasto desde o início)':'Campanha nova nas primeiras 24h';
 if(guard.level==='sold')return `${head}: ${spend} com venda. Seguir o acompanhamento normal.`;
 if(guard.level==='waiting'||guard.spend===null)return `${head}: ${finite(guard.spend)?'sem gasto ainda':'gasto N/D'}.`;
 if(guard.basis==='project')return guard.limit===null?`${head}: ${spend}, ${ic}, ${sale}. Limiar do projeto para 2+ IC não definido.`:`${head}: ${spend}, ${ic}, ${sale} (limiar do projeto R$${guard.limit}).`;
 return `${head}: ${spend}, ${ic}, ${sale}. Teto R$${guard.limit} com ${guard.noCheckoutLimit?'0':'até 1'} IC; pausa a partir de R$${guard.pauseAt}.`;
}

/**
 * Overlays the live Meta read on today's Malva row, for the first-24h logic only (never stored, never in the central).
 * - startAt/createdAt: Meta schedule when the Malva did not send it.
 * - spend: Meta today's spend converted with the row's own rate, only when it is ahead of the Malva and the Meta day
 *   is the project's local day (account in another timezone would mix days).
 * - checkouts: the larger of both (more IC never pushes toward a pause); purchases kept apart as `metaPurchases`.
 * @param {any} row @param {{at?:string,items?:Record<string,any>}|null} meta @param {{now?:number,timezone?:string,maxAgeMs?:number}} [options]
 */
export function overlayMetaLive(row,meta,{now=Date.now(),timezone='America/Sao_Paulo',maxAgeMs=600000}={}){
 const m=meta?.items?.[row?.externalId];
 if(!m||!finite(time(meta.at))||now-time(meta.at)>maxAgeMs)return row;
 const out={...row,metaLive:{at:meta.at,spend:m.spend,currency:m.currency,checkouts:m.checkouts,purchases:m.purchases,day:m.day}};
 if(!row.startAt&&m.startTime)out.startAt=m.startTime;
 if(!row.createdAt&&m.createdTime)out.createdAt=m.createdTime;
 const sameDay=!m.day||m.day===localDay(now,timezone);
 if(!sameDay)return out;
 const cur=String(m.currency||'').toUpperCase(),rate=cur==='BRL'?1:cur&&cur===String(row.budgetCurrency||'').toUpperCase()&&finite(row.budgetRate)&&row.budgetRate>0?row.budgetRate:NaN;
 const spendBrl=finite(m.spend)&&finite(rate)?round2(m.spend*rate):NaN;
 if(finite(spendBrl)&&(!finite(row.spend)||spendBrl>row.spend)){out.spend=spendBrl;out.metaLive.spendUsed=true;}
 if(finite(m.impressions)&&(!finite(row.impressions)||m.impressions>row.impressions))out.impressions=m.impressions;
 if(finite(m.checkouts)&&(!finite(row.checkouts)||m.checkouts>row.checkouts))out.checkouts=m.checkouts;
 if(finite(m.purchases))out.metaPurchases=m.purchases;
 return out;
}

/**
 * Campaign ids worth a live Meta read: dated from 2 days ago up to the schedule horizon first, then tests,
 * then campaigns without a date in the name (could be scheduled). Older dated campaigns are not new by definition.
 * @param {any[]} items live cache items ({projectId,snapshot:{rows,timezone}}) @param {{now?:number,limit?:number,exclude?:Set<string>}} [options]
 * @returns {Array<{id:string,adAccountId:string}>} campaign id and the Malva account id that owns it
 */
export function metaLiveCandidates(items,{now=Date.now(),limit=200,exclude=new Set()}={}){
 const scored=new Map();
 for(const item of Array.isArray(items)?items:[]){
  const s=item?.snapshot,timezone=s?.timezone||'America/Sao_Paulo';
  for(const r of Array.isArray(s?.rows)?s.rows:[]){
   if(r?.level!=='campaign'||r.provider&&String(r.provider).toLowerCase()!=='meta'||r.status!=='ACTIVE'||isWarmupCampaign(r.name)||typeof r.externalId!=='string'||!/^\d{6,25}$/.test(r.externalId)||exclude.has(r.externalId))continue;
   const offset=nameDateOffset(r.name,now,timezone);
   const score=offset!==null&&offset>=-2&&offset<=first24hPolicy.scheduleHorizonDays?0:isTestCampaign(r.name)?1:offset===null?2:null;
   if(score===null)continue;
   if(typeof r.adAccountId!=='string'||!r.adAccountId)continue;
   const prev=scored.get(r.externalId);if(!prev||score<prev.score)scored.set(r.externalId,{score,spend:finite(r.spend)?r.spend:0,adAccountId:r.adAccountId});
  }
 }
 return [...scored].sort((a,b)=>a[1].score-b[1].score||b[1].spend-a[1].spend||a[0].localeCompare(b[0])).slice(0,limit).map(([id,v])=>({id,adAccountId:v.adAccountId}));
}

/**
 * Groups candidate campaigns by Meta ad account using the Malva → Meta account links (account panel).
 * Unknown links and accounts Meta refused recently are left out; at most `maxAccounts` accounts.
 * @param {Array<{id:string,adAccountId:string}>} picks @param {Record<string,string>} links @param {{skip?:Set<string>,maxAccounts?:number}} [options]
 */
export function groupMetaAccounts(picks,links,{skip=new Set(),maxAccounts=40}={}){
 const out=new Map();
 for(const p of Array.isArray(picks)?picks:[]){
  const acc=String(links?.[p.adAccountId]||'').replace(/^act_/,'');if(!/^\d{5,25}$/.test(acc)||skip.has(acc))continue;
  if(!out.has(acc)){if(out.size>=maxAccounts)continue;out.set(acc,[]);}
  out.get(acc).push(p.id);
 }
 return [...out].map(([account,ids])=>({account,ids}));
}
