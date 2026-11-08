/**
 * First 24 hours of a new Meta campaign (docs/first-24h-protocol.md).
 * Identifies scheduled and newly launched campaigns (tests or not) and applies the owner's ceiling:
 * a new campaign with 0 or 1 checkout (IC) and no sale must not spend the low-IC ceiling (R$110 by default).
 * Pure: reading aid and shadow input only. Never a proposal, an approval or a provider command.
 */
import {isWarmupCampaign} from './campaign-scope.mjs';
import {isTestCampaign} from './test-launch.mjs';

/** Owner decision of 07/11/2026. A project may lower the ceiling in the private policy (`first24hLowIcLimit`). */
export const first24hPolicy=Object.freeze({version:1,lowIcSpendLimitBrl:110,lowIcMaxCheckouts:1,alertShare:0.7,pauseShare:0.9,scheduleHorizonDays:14});
export const first24hStages=Object.freeze({scheduled:'Programada',firstDay:'Primeiras 24h',secondDay:'2º dia'});
const CLOSED=['7d','3d','yesterday'],finite=Number.isFinite,time=v=>Date.parse(v||'');
const round2=n=>Math.round(n*100)/100;
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};

/**
 * Days between the leading DD/MM of a campaign name and the local day: 1 = tomorrow, 0 = today, -1 = yesterday.
 * The year is the one closest to today (handles December/January). A name date is a hint, never proof.
 * @returns {number|null}
 */
export function nameDateOffset(name,now=Date.now(),timezone='America/Sao_Paulo'){
 const m=/^\s*\+?(\d{2})\/(\d{2})(?![\d/])/.exec(String(name||''));if(!m)return null;
 const dd=Number(m[1]),mm=Number(m[2]),today=localDay(now,timezone);
 if(!today||mm<1||mm>12||dd<1||dd>31)return null;
 const [y,mo,d]=today.split('-').map(Number),base=Date.UTC(y,mo-1,d);let best=null;
 for(const year of [y-1,y,y+1]){
  const t=Date.UTC(year,mm-1,dd);if(new Date(t).getUTCDate()!==dd)continue;
  const offset=Math.round((t-base)/86400000);if(best===null||Math.abs(offset)<Math.abs(best))best=offset;
 }
 return best;
}
const dayLabel=(offset,now,timezone)=>{const d=localDay(now+offset*86400000,timezone);return d?`${d.slice(8,10)}/${d.slice(5,7)}`:null;};

/**
 * Stage of a campaign in its launch: 'scheduled' (dated ahead, no delivery yet), 'first-day' (first spend today,
 * or dated today without earlier spend), 'second-day' (first spend yesterday) or null (older or unknown).
 * Earlier spend always wins over a renamed date. Malva does not send start dates today, so the basis says what supports it.
 * @param {any} row today's campaign row
 * @param {Record<string,any>} [windows] closed rows of the same object: 7d, 3d, yesterday
 * @param {{now?:number,timezone?:string,noSpendPeriods?:string[]}} [options]
 */
export function newCampaignStage(row,windows={},{now=Date.now(),timezone='America/Sao_Paulo',noSpendPeriods=[]}={}){
 if(!row||row.level&&row.level!=='campaign'||row.provider&&row.provider!=='meta'||isWarmupCampaign(row.name))return null;
 const same=r=>r&&r.adAccountId===row.adAccountId&&r.externalId===row.externalId;
 const hist=Object.fromEntries(CLOSED.map(p=>[p,same(windows?.[p])?windows[p]:null])),noSpend=new Set(Array.isArray(noSpendPeriods)?noSpendPeriods:[]);
 const spentIn=p=>!!hist[p]&&finite(hist[p].spend)&&hist[p].spend>0;
 const zeroIn=p=>hist[p]?finite(hist[p].spend)&&hist[p].spend===0:noSpend.has(p);
 const offset=nameDateOffset(row.name,now,timezone),startsAt=time(row.startAt),delivered=time(row.deliveryStartedAt);
 const live=finite(row.spend)&&row.spend>0||finite(row.impressions)&&row.impressions>0,priorSpend=CLOSED.some(spentIn);
 const out=(stage,basis,extra={})=>({version:first24hPolicy.version,stage,label:stage==='scheduled'?first24hStages.scheduled:stage==='first-day'?first24hStages.firstDay:first24hStages.secondDay,basis,nameOffset:offset,...extra});
 if(!live&&!priorSpend){
  if(finite(startsAt)&&startsAt>now)return out('scheduled','schedule',{startsAt:row.startAt});
  if(offset!==null&&offset>=1&&offset<=first24hPolicy.scheduleHorizonDays)return out('scheduled','name',{startsOn:dayLabel(offset,now,timezone)});
 }
 if(finite(delivered)&&delivered<=now){
  const ageHours=(now-delivered)/3600000;
  return ageHours<24?out('first-day','delivery',{ageHours:round2(ageHours)}):ageHours<48?out('second-day','delivery',{ageHours:round2(ageHours)}):null;
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
 * Where a new campaign stands against its ceiling. `totals` is the spend since launch (today, or yesterday + today on day 2).
 * Levels: waiting (no spend), sold (acquisition), watch, alert (≥70% of the ceiling), pause (≥90%: stop before crossing it),
 * over (ceiling crossed). With 2+ IC and no sale the project's private threshold applies, paused at the threshold itself.
 * @param {{spend?:number|null,checkouts?:number|null,frontOrders?:number|null,orders?:number|null,revenueNet?:number|null}} totals
 * @param {any} [params] private per-project policy
 */
export function first24hGuard(totals,params={}){
 const p=params||{},spend=totals?.spend,ic=totals?.checkouts;
 const known=['frontOrders','orders','revenueNet'].every(k=>finite(totals?.[k]));
 if(known&&(totals.frontOrders>0||totals.orders>0||totals.revenueNet>0))return {level:'sold',limit:null,pauseAt:null,basis:'sale',spend:finite(spend)?round2(spend):null,checkouts:finite(ic)?ic:null};
 if(!finite(spend)||spend<=0)return {level:'waiting',limit:null,pauseAt:null,basis:'no-spend',spend:finite(spend)?spend:null,checkouts:finite(ic)?ic:null};
 const ceiling=finite(p.first24hLowIcLimit)&&p.first24hLowIcLimit>0?Math.min(p.first24hLowIcLimit,first24hPolicy.lowIcSpendLimitBrl):first24hPolicy.lowIcSpendLimitBrl;
 let limit,basis,pauseAt;
 if(finite(ic)&&ic<=first24hPolicy.lowIcMaxCheckouts){
  limit=ic===0&&finite(p.pauseTestMinSpendNoCheckout)&&p.pauseTestMinSpendNoCheckout>0?Math.min(ceiling,p.pauseTestMinSpendNoCheckout):ceiling;
  basis='low-ic';pauseAt=round2(limit*first24hPolicy.pauseShare);
 }else if(finite(ic)){
  limit=finite(p.pauseTestMinSpend)&&p.pauseTestMinSpend>0?p.pauseTestMinSpend:null;basis='project';pauseAt=limit;
 }else{limit=ceiling;basis='ic-unknown';pauseAt=round2(limit*first24hPolicy.pauseShare);}
 const level=!known?'watch':limit===null?'watch':spend>=limit?'over':spend>=pauseAt?'pause':spend>=limit*first24hPolicy.alertShare?'alert':'watch';
 return {level,limit,pauseAt,basis,spend:round2(spend),checkouts:finite(ic)?ic:null,salesKnown:known};
}

/** Short pt-BR line for cards and the notch. */
export function first24hReason(stage,guard){
 const ic=guard.checkouts===null?'IC N/D':`${guard.checkouts} IC`,spend=`R$${guard.spend}`;
 const head=stage?.stage==='second-day'?'Campanha nova no 2º dia (gasto desde o início)':'Campanha nova nas primeiras 24h';
 if(guard.level==='sold')return `${head}: ${spend} com venda. Seguir o acompanhamento normal.`;
 if(guard.basis==='project')return guard.limit===null?`${head}: ${spend}, ${ic}, 0 venda. Limiar do projeto para 2+ IC não definido.`:`${head}: ${spend}, ${ic}, 0 venda (limiar do projeto R$${guard.limit}).`;
 return `${head}: ${spend}, ${ic}, 0 venda. Teto R$${guard.limit} com até 1 IC; pausa a partir de R$${guard.pauseAt}.`;
}
