/**
 * Live Meta numbers joined to the Malva live rows by campaign id (owner decision of 09/11/2026: "associar a campanha
 * da meta junto com o mcp do malva … pra atualização de dados dos números do tráfego", for the web and the notch).
 * DISPLAY ONLY: never stored in the central, never in analysis snapshots, proposals, approvals or order checks
 * (an order still rereads the Malva at prepare). Sales, revenue and orders stay the Malva's; Meta pixel IC and
 * purchases are another measure and are kept apart in `metaLive`. Missing stays N/D.
 */
import {metaBudget} from './meta-live.mjs';
import {metaLiveCandidates} from './first-24h.mjs';
import {currentLiveSnapshot} from './live-display.mjs';

export const metaDisplayPolicy=Object.freeze({version:1,maxAgeMs:10*60000});
const finite=Number.isFinite,arr=v=>Array.isArray(v)?v:[],time=v=>typeof v==='string'?Date.parse(v):NaN;
const round=(n,d)=>{const f=10**d;return Math.round(n*f)/f;};
const ratio=(a,b,scale=1,d=4)=>finite(a)&&finite(b)&&b>0?round(a/b*scale,d):null;
const STATUSES=new Set(['ACTIVE','PAUSED','ARCHIVED','DELETED']);
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};

/** Spend-based ratios recomputed with the Malva's own formulas (same as lib/analysis.mjs `sum`). */
function recompute(r){
 const out={...r},net=r.revenueNet,costs=[r.productCost,r.saleTax],known=finite(net)&&costs.every(finite);
 out.cpm=ratio(r.spend,r.impressions,1000,2);out.ctr=ratio(r.linkClicks,r.impressions);out.cpc=ratio(r.spend,r.linkClicks,1,2);
 out.roas=ratio(net,r.spend);
 out.profit=known&&finite(r.spend)&&finite(r.adCosts)?round(net-r.productCost-r.saleTax-r.spend-r.adCosts,2):null;
 out.roi=known&&finite(r.spend)&&r.spend>0&&finite(r.adCosts)?ratio(net-r.productCost-r.saleTax,r.spend+r.adCosts):null;
 out.margin=finite(out.profit)&&finite(net)&&net>0?ratio(out.profit,net):null;
 out.cpa=ratio(r.spend,r.orders,1,2);out.cpaFront=ratio(r.spend,r.frontOrders,1,2);out.costPerCheckout=ratio(r.spend,r.checkouts,1,2);
 return out;
}

/**
 * One Malva live row with the Meta read on top.
 * - status, effective status and daily budget: Meta's when its read is newer than the Malva reading (`fetchedAt`);
 * - spend (converted with the row's own rate), impressions, clicks, link clicks: Meta's when ahead, same local day only;
 *   ad costs scale with spend (the row's own share, else the reading's), unknown share → N/D;
 * - checkouts, orders, revenue: untouched (Malva).
 * @param {any} row @param {any} m Meta item (lib/meta-live.mjs normalizeMetaCampaign)
 * @param {{metaAt:number,fetchedAt:number,sameDay:boolean,adCostShare:number|null}} context
 */
export function overlayMetaRow(row,m,{metaAt,fetchedAt,sameDay,adCostShare=null}){
 if(!row||!m||String(m.id)!==String(row.externalId))return row;
 const out={...row},used={status:false,budget:false,spend:false},newer=finite(metaAt)&&(!finite(fetchedAt)||metaAt>fetchedAt);
 const cur=String(row.budgetCurrency||'').toUpperCase(),metaCur=String(m.currency||'').toUpperCase();
 const sameCurrency=!metaCur||metaCur===cur;
 if(newer&&STATUSES.has(m.status)&&(m.status!==row.status||m.effectiveStatus&&m.effectiveStatus!==row.effectiveStatus)){
  out.status=m.status;out.effectiveStatus=m.effectiveStatus||m.status;used.status=true;
 }
 const daily=sameCurrency?metaBudget(m.dailyBudgetMinor,cur):null;
 if(newer&&daily!==null&&!(row.lifetimeBudget>0)&&(!finite(row.dailyBudget)||Math.abs(daily-row.dailyBudget)>=0.005)){out.dailyBudget=daily;used.budget=true;}
 if(sameDay){
  const rate=metaCur==='BRL'?1:metaCur&&metaCur===cur&&finite(row.budgetRate)&&row.budgetRate>0?row.budgetRate:NaN;
  const spend=finite(m.spend)&&finite(rate)?round(m.spend*rate,2):NaN;
  let changed=false;
  if(finite(spend)&&(!finite(row.spend)||spend>row.spend+0.004)){
   const share=finite(row.spend)&&row.spend>0&&finite(row.adCosts)?row.adCosts/row.spend:adCostShare;
   out.spend=spend;out.spendNative=m.spend;out.adCosts=finite(share)?round(spend*share,2):null;used.spend=true;changed=true;
  }
  for(const k of ['impressions','clicks','linkClicks'])if(finite(m[k])&&(!finite(row[k])||m[k]>row[k])){out[k]=m[k];changed=true;}
  if(changed)Object.assign(out,recompute(out));
 }
 out.metaLive={at:new Date(metaAt).toISOString(),status:used.status,budget:used.budget,spend:used.spend,checkouts:finite(m.checkouts)?m.checkouts:null,purchases:finite(m.purchases)?m.purchases:null};
 return out;
}

/** A Meta read fresh enough to show (10 minutes), or null. */
export function freshMeta(meta,now=Date.now()){
 const at=time(meta?.at);return meta&&meta.items&&typeof meta.items==='object'&&finite(at)&&at<=now+60000&&now-at<=metaDisplayPolicy.maxAgeMs?{at,items:meta.items}:null;
}

/** A Malva live snapshot (today, campaign) with each matching row overlaid; `metaLiveAt` when any row matched. */
export function overlayMetaSnapshot(snapshot,meta,{now=Date.now()}={}){
 const fresh=freshMeta(meta,now);
 if(!fresh||!snapshot||snapshot.period!=='today'||snapshot.level!=='campaign'||!Array.isArray(snapshot.rows))return snapshot;
 const tz=snapshot.timezone||'America/Sao_Paulo',today=localDay(now,tz),fetchedAt=time(snapshot.fetchedAt);
 let spent=0,costs=0;for(const r of snapshot.rows)if(finite(r?.spend)&&r.spend>0&&finite(r.adCosts)){spent+=r.spend;costs+=r.adCosts;}
 const adCostShare=spent>0?costs/spent:null;let matched=0;
 const rows=snapshot.rows.map(r=>{
  const m=r?.provider&&String(r.provider).toLowerCase()!=='meta'?null:fresh.items[r?.externalId];if(!m)return r;
  matched++;return overlayMetaRow(r,m,{metaAt:fresh.at,fetchedAt,sameDay:!!today&&(!m.day||m.day===today),adCostShare});
 });
 return matched?{...snapshot,rows,metaLiveAt:new Date(fresh.at).toISOString(),metaLiveRows:matched}:snapshot;
}

/** Live items (lib/live-data.mjs) with their snapshots overlaid. The input is never changed. */
export function overlayMetaItems(items,meta,{now=Date.now()}={}){
 if(!freshMeta(meta,now))return arr(items);
 return arr(items).map(i=>i?.snapshot?{...i,snapshot:overlayMetaSnapshot(i.snapshot,meta,{now})}:i);
}

/**
 * Campaigns to read on Meta: the first-24h candidates first (new and scheduled), then every other active Meta
 * campaign of the live readings, most spend first. Display reads include warm-up campaigns (numbers only).
 * @returns {Array<{id:string,adAccountId:string}>}
 */
export function metaLiveTargets(items,{now=Date.now(),limit=600}={}){
 const first=metaLiveCandidates(items,{now,limit}),seen=new Set(first.map(p=>p.id)),rest=[];
 for(const item of arr(items))for(const r of arr(item?.snapshot?.rows)){
  if(r?.level!=='campaign'||r.provider&&String(r.provider).toLowerCase()!=='meta'||r.status!=='ACTIVE'||typeof r.externalId!=='string'||!/^\d{6,25}$/.test(r.externalId)||typeof r.adAccountId!=='string'||!r.adAccountId||seen.has(r.externalId))continue;
  seen.add(r.externalId);rest.push({id:r.externalId,adAccountId:r.adAccountId,spend:finite(r.spend)?r.spend:0});
 }
 rest.sort((a,b)=>b.spend-a.spend||a.id.localeCompare(b.id));
 return [...first,...rest.map(({id,adAccountId})=>({id,adAccountId}))].slice(0,limit);
}

/**
 * For the notch's day numbers only (today's totals, scoreboard, pace): the central state with each project's "today"
 * campaign cut replaced by its live reading (Malva + Meta) when that reading is current and newer than the analysis.
 * The queue, the cards and every decision keep the analysis state.
 */
export function liveTodayState(state,items,{now=Date.now()}={}){
 const snapshots=arr(state?.snapshots);let swapped=0;
 const live=new Map();
 for(const id of Object.keys(state?.config||{})){
  const analysis=snapshots.filter(s=>s.projectId===id&&s.period==='today'&&s.level==='campaign').sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt))[0]||null;
  const s=currentLiveSnapshot(arr(items).find(i=>i?.projectId===id),id,analysis,now);
  if(s)live.set(id,{...s,liveDisplay:true});
 }
 if(!live.size)return state;
 const out=snapshots.filter(s=>!(live.has(s.projectId)&&s.period==='today'&&s.level==='campaign'));
 for(const s of live.values()){out.push(s);swapped++;}
 return swapped?{...state,snapshots:out}:state;
}

/** Live row per campaign key (`project:account:campaign`) from current live readings, for the notch's details. */
export function liveRowIndex(items,{now=Date.now()}={}){
 const map=new Map();
 for(const item of arr(items)){
  const s=currentLiveSnapshot(item,item?.projectId,undefined,now);if(!s)continue;
  for(const r of arr(s.rows))if(r?.adAccountId&&r.externalId)map.set(`${item.projectId}:${r.adAccountId}:${r.externalId}`,{row:r,fetchedAt:s.fetchedAt,metaLiveAt:s.metaLiveAt||null});
 }
 return map;
}
