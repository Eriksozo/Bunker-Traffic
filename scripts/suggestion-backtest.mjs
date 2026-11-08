#!/usr/bin/env node
/**
 * Suggestion backtest (read-only, offline). Replays the Bunker's own suggestion engines day by day over real daily
 * campaign series and scores each suggestion against what happened next. No data lives in the repository: the
 * series are compact JSON files collected separately (Malva tracking_ad_detail, one file per campaign).
 *
 * Usage: node scripts/suggestion-backtest.mjs <dir-with-daily-json> [--proxy-front] [--json out.json]
 *
 * Each evaluation day D uses only information available at the end of D: 7d = D-7..D-1, 3d = D-3..D-1,
 * yesterday = D-1, today = D (full day). Outcome = D+1 (and D+1..D+2). Counterfactual money effects assume budget
 * changes scale the next day's result linearly: an estimate, never a measurement.
 */
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sum,candidates} from '../lib/analysis.mjs';
import {decisionContext} from '../lib/decision-context.mjs';
import {isWarmupCampaign} from '../lib/campaign-scope.mjs';

const FIELDS=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','impressions','linkClicks'];
const finite=Number.isFinite,round=n=>Math.round(n*100)/100;

/** One normalized daily row; missing stays null. */
export function dayRow(d,{proxyFront=false}={}){
 const r={date:String(d.date||d.day||'').slice(0,10)};
 for(const k of FIELDS)r[k]=finite(d[k])?d[k]:null;
 // The daily sheet has no front orders: with --proxy-front they are taken as all orders (an upper bound, upsells
 // included). Off by default: rules that need front sales then read N/D, as in production.
 if(proxyFront&&r.frontOrders===null&&finite(r.orders))r.frontOrders=r.orders;
 return r;
}
/** Sum of daily rows as one window row (null when any day lacks the field, like analysis.sum). */
export function windowRow(days){
 if(!days.length)return null;
 const o={};for(const k of FIELDS)o[k]=days.every(d=>finite(d[k]))?days.reduce((s,d)=>s+d[k],0):null;
 return o;
}
const profitOf=w=>{const s=w&&sum([w]);return s?.result??null;};
const roiOf=w=>{const s=w&&sum([w]);return s?.roi??null;};

/** Engines evaluated at the end of day D for one campaign. */
export function evaluateDay(meta,days,i,{now}={}){
 const w={'7d':windowRow(days.slice(i-7,i)),'3d':windowRow(days.slice(i-3,i)),yesterday:windowRow([days[i-1]]),today:windowRow([days[i]])};
 const base={id:meta.objectId,externalId:meta.externalId,adAccountId:meta.adAccountId,provider:'meta',level:'campaign',name:meta.name,accountName:'',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},budgetCurrency:meta.budgetCurrency,budgetRate:meta.budgetRate,dailyBudget:meta.dailyBudget,lifetimeBudget:meta.lifetimeBudget};
 const at=new Date(now).toISOString(),project=meta.projectId;
 const snapshots=Object.entries(w).filter(([,r])=>r).map(([period,r])=>({projectId:project,projectName:'p',period,level:'campaign',source:'Malva MCP',complete:true,fetchedAt:at,lastSyncAt:at,timezone:'America/Sao_Paulo',from:at,to:at,rows:[{...base,...r}]}));
 const state={config:{[project]:{projectName:'p'}},snapshots};
 const cand=candidates(state,project,now)[0]||null;
 const sums=Object.fromEntries(Object.entries(w).map(([k,r])=>[k,r?sum([r]):null]));
 const ctx=decisionContext(sums);
 const t=sums.today,recent=sums['3d'],budgetBrl=finite(meta.dailyBudget)&&meta.dailyBudget>0?meta.dailyBudget*(meta.budgetCurrency==='BRL'?1:finite(meta.budgetRate)?meta.budgetRate:NaN):NaN;
 // Shadow rule 2 (bad-day-reduce) with the full day standing in for "after 10h".
 const badDay=!!(recent&&finite(recent.roi)&&recent.roi>=1.3&&finite(budgetBrl)&&finite(t?.spend)&&t.spend>=0.3*budgetBrl&&(t.orders===0||finite(t.roi)&&t.roi<0.7));
 // Shadow rule 4 (morning-increase) with the full day standing in for "since midnight": an optimistic proxy.
 const morning=!!(t&&finite(t.orders)&&t.orders>=3&&finite(t.frontOrders)&&t.frontOrders>=2&&finite(t.roi)&&t.roi>=2.5&&finite(budgetBrl)&&t.spend>=0.25*budgetBrl);
 // Queue "O que fazer agora": a loss item when today's result is negative.
 const queueLoss=!!(t&&finite(t.result)&&t.result<0);
 const with7d=finite(sums['7d']?.result)&&finite(t?.result)?sums['7d'].result+t.result:null;
 return {date:days[i].date,windows:sums,label:cand?.decision||null,tone:cand?.tone||null,context:ctx?.kind||null,badDay,morning,queueLoss,recovers:queueLoss&&finite(with7d)&&with7d>0};
}

/** Outcome after D: next day and next two days (result in project currency, ROI). */
export function outcomeAfter(days,i){
 const n1=days[i+1]?windowRow([days[i+1]]):null,n2=days[i+2]?windowRow([days[i+1],days[i+2]]):null;
 return {next:{spend:n1?.spend??null,result:profitOf(n1),roi:roiOf(n1)},next2:{spend:n2?.spend??null,result:profitOf(n2),roi:roiOf(n2)}};
}

/** Scoring of one suggestion family against the next day. */
export function score(points,{kind}){
 const valid=points.filter(p=>finite(p.outcome.next.result)&&p.outcome.next.spend>0);
 const good=valid.filter(p=>kind==='cut'?p.outcome.next.result<0:p.outcome.next.result>0);
 const winnersHit=kind==='cut'?valid.filter(p=>finite(p.outcome.next.roi)&&p.outcome.next.roi>=1.2):[];
 return {n:points.length,scored:valid.length,precision:valid.length?round(good.length/valid.length):null,
  cutWinners:kind==='cut'?winnersHit.length:undefined,
  nextResult:round(valid.reduce((s,p)=>s+p.outcome.next.result,0))};
}

function load(dir,opts={}){
 const out=[];
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.json'))){
  const m=JSON.parse(readFileSync(join(dir,f),'utf8'));if(m.error||!Array.isArray(m.daily))continue;
  if(isWarmupCampaign(m.name))continue;
  const days=m.daily.map(d=>dayRow(d,opts)).filter(d=>d.date).sort((a,b)=>a.date.localeCompare(b.date));
  out.push({meta:m,days});
 }
 return out;
}

export function backtest(series){
 const points=[];
 for(const {meta,days} of series){
  for(let i=7;i<days.length-1;i++){
   if(!(days[i].spend>0))continue;
   const now=Date.parse(days[i].date+'T23:59:00-03:00');
   points.push({campaign:meta.objectId,project:meta.projectId,name:meta.name,...evaluateDay(meta,days,i,{now}),outcome:outcomeAfter(days,i)});
  }
 }
 return points;
}

if(import.meta.url===`file://${process.argv[1]}`){
 const dir=process.argv[2];if(!dir){console.error('uso: node scripts/suggestion-backtest.mjs <dir> [--json out.json]');process.exit(1);}
 const points=backtest(load(dir,{proxyFront:process.argv.includes('--proxy-front')}));
 const by=(f)=>points.filter(f);
 const report={points:points.length,
  label:Object.fromEntries([...new Set(points.map(p=>p.label))].map(l=>[l,score(by(p=>p.label===l),{kind:/perda|pausa|redução/i.test(l||'')?'cut':'keep'})])),
  context:Object.fromEntries([...new Set(points.map(p=>p.context))].map(c=>[String(c),score(by(p=>p.context===c),{kind:'cut'})])),
  badDayReduce:score(by(p=>p.badDay),{kind:'cut'}),morningIncrease:score(by(p=>p.morning),{kind:'scale'}),
  queueLoss:score(by(p=>p.queueLoss),{kind:'cut'}),queueLossRecovers:score(by(p=>p.recovers),{kind:'cut'}),queueLossNoHistory:score(by(p=>p.queueLoss&&!p.recovers),{kind:'cut'})};
 console.log(JSON.stringify(report,null,1));
 const i=process.argv.indexOf('--json');if(i>0)writeFileSync(process.argv[i+1],JSON.stringify(points));
}
