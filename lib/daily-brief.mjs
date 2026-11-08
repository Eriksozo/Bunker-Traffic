/** Daily reading aids. Presentation only: no score here authorizes or proposes a budget/status change. */
import {testLaunchContext,isTestCampaign} from './test-launch.mjs';
import {sum,rowsFor} from './analysis.mjs';
import {projectScope,ALL_PROJECTS} from './project-scope.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const windowRows=(state,project,period)=>project===ALL_PROJECTS?projectScope(state,project,period).rows:rowsFor(state,project,period);

/** Ratios only: today's partial spend or revenue is not comparable with a closed day, but ROAS, ROI and CPA are. */
export function dailyComparison(state,project){
 const read=period=>{const rows=windowRows(state,project,period);if(!rows.length)return null;const t=sum(rows);return {roas:t.roas,roi:t.roi,cpaFront:t.cpaFront,spend:t.spend};};
 const today=read('today'),yesterday=read('yesterday'),week=read('7d'),recent=read('3d');
 const delta=(key,base)=>finite(today?.[key])&&finite(base?.[key])&&base[key]!==0?(today[key]-base[key])/Math.abs(base[key]):null;
 return {today,yesterday,week,recent,deltas:Object.fromEntries(['roas','roi','cpaFront'].map(key=>[key,{yesterday:delta(key,yesterday),week:delta(key,week)}]))};
}

/** Money at stake from what was actually read. Missing cost components never become a profit claim. */
function exposure(totals){
 if(!totals||!finite(totals.spend)||totals.spend<=0)return null;
 if(finite(totals.result))return {basis:'result',value:totals.result};
 if(finite(totals.revenueNet))return {basis:'revenue',value:totals.revenueNet-totals.spend};
 return null;
}

/**
 * Balance of each window (result when costs are known, otherwise revenue minus media), so a loss read today is
 * shown next to yesterday, 3 and 7 complete days. 7d and 3d end yesterday and never include today, so "7d + hoje"
 * adds disjoint days. A sum only exists when both sides use the same basis; anything missing stays N/D (null).
 * verdict: 'recovers' when today is negative but 7d + hoje is still positive; 'negative' when the sum is negative
 * too; null when it cannot be read.
 */
export function campaignBalance(c){
 const at=p=>{const w=c?.windows?.[p];return w?exposure(sum([w])):null;};
 const windows={today:at('today'),yesterday:at('yesterday'),'3d':at('3d'),'7d':at('7d')};
 const plus=(a,b)=>a&&b&&a.basis===b.basis?{basis:a.basis,value:Math.round((a.value+b.value)*100)/100}:null;
 const with7d=plus(windows['7d'],windows.today),with3d=plus(windows['3d'],windows.today);
 const round=w=>w&&{basis:w.basis,value:Math.round(w.value*100)/100};
 const verdict=windows.today&&windows.today.value<0&&with7d?(with7d.value>0?'recovers':'negative'):null;
 return {today:round(windows.today),yesterday:round(windows.yesterday),'3d':round(windows['3d']),'7d':round(windows['7d']),with7d,with3d,verdict};
}

/**
 * At most `limit` active campaigns worth opening first: the largest losses read today (or in the last 3 days
 * when today has no spend) and the clearest profitable candidates. Young tests with a verified no-sale spend signal stay visible; paused objects stay out.
 */
const youngHours=24;
/** Under 24h of delivery (or no closed window at all when the start is unknown) is identified separately; first-day no-sale losses still require review. */
export function isYoungTest(c,now=Date.now()){
 if(!isTestCampaign(c.row?.name))return false;
 const started=Date.parse(c.row?.deliveryStartedAt||c.row?.startAt||'');
 if(Number.isFinite(started))return now-started<youngHours*3600000;
 return !c.windows?.yesterday&&!c.recent&&!c.week;
}
const objectKey=(project,account,object)=>JSON.stringify([project,account,object]);
const statusOf=value=>typeof value==='string'?value.toUpperCase():null;
/**
 * The queue reads status from the last full analysis. A newer status change (manager log with author/time,
 * observed reading or the live display) supersedes it, so a campaign paused after the analysis leaves the queue
 * and a later reactivation brings it back. Older or foreign records never hide a campaign.
 * @param {any[]} candidates
 * @param {{events?:any[],liveRows?:any[]}} [sources]
 * @returns {Set<string>}
 */
export function pausedAfterAnalysis(candidates,{events=[],liveRows=[]}={}){
 const latest=new Map();
 const note=(key,at,status)=>{const t=Date.parse(at||'');if(!Number.isFinite(t)||!status)return;const prior=latest.get(key);if(!prior||t>prior.t)latest.set(key,{t,status});};
 for(const e of Array.isArray(events)?events:[])if(['pause','activate','status'].includes(e?.action)&&['status','effectiveStatus'].includes(e?.field||'status'))note(objectKey(e.project,e.adAccountId,e.objectId),e.at,statusOf(e.after));
 for(const r of Array.isArray(liveRows)?liveRows:[])note(objectKey(r?.projectId,r?.adAccountId,r?.externalId),r?.fetchedAt,statusOf(r?.effectiveStatus||r?.status));
 const keys=new Set();
 for(const c of Array.isArray(candidates)?candidates:[]){
  const row=c?.row;if(!row)continue;const key=objectKey(row.projectId,row.adAccountId,row.externalId),seen=latest.get(key),analysed=Date.parse(row.sourceAt||'');
  if(seen&&Number.isFinite(analysed)&&seen.t>analysed&&seen.status!=='ACTIVE')keys.add(key);
 }
 return keys;
}
export function actionQueue(candidates,{limit=5,opportunities=2,now=Date.now(),pausedKeys=new Set()}={}){
 const superseded=candidates.filter(c=>pausedKeys.has(objectKey(c.row?.projectId,c.row?.adAccountId,c.row?.externalId)));
 const live=candidates.filter(c=>c.row?.effectiveStatus==='ACTIVE'&&c.row?.accountStatus?.active!==false&&!superseded.includes(c));
 const launch=c=>testLaunchContext(c.row,c.windows,{now,noSpendPeriods:c.noSpendPeriods});
 const priorityTests=live.filter(c=>launch(c).priority);
 const young=live.filter(c=>!priorityTests.includes(c)&&(c.decision==='Teste protegido'||isYoungTest(c,now))),active=live.filter(c=>!young.includes(c));
 const losses=[],gains=[];
 for(const c of active){
  const today=c.windows?.today?sum([c.windows.today]):null,recent=c.recent||null,todayExposure=exposure(today),recentExposure=exposure(recent);
  if(todayExposure&&todayExposure.value<0||!todayExposure&&recentExposure&&recentExposure.value<0){
   const source=todayExposure&&todayExposure.value<0?{period:'today',...todayExposure,totals:today}:{period:'3d',...recentExposure,totals:recent};
   losses.push({kind:'loss',testLaunch:launch(c),candidate:c,balance:campaignBalance(c),period:source.period,basis:source.basis,amount:-source.value,roas:source.totals.roas,spend:source.totals.spend,comparison:c.week?.roas??null,score:source.period==='today'?-source.value:-source.value/3});
  }else if(c.tone==='green'&&recentExposure&&recentExposure.value>0){
   gains.push({kind:'opportunity',candidate:c,balance:campaignBalance(c),period:'3d',basis:recentExposure.basis,amount:recentExposure.value,roas:recent.roas,spend:recent.spend,comparison:c.week?.roas??null,score:recentExposure.value/3});
  }
 }
 const byScore=(a,b)=>Number(!!b.testLaunch?.priority)-Number(!!a.testLaunch?.priority)||b.score-a.score||String(a.candidate.id).localeCompare(String(b.candidate.id));
 const chosenGains=gains.sort(byScore).slice(0,Math.min(opportunities,limit));
 const chosenLosses=losses.sort(byScore).slice(0,limit-chosenGains.length);
 return {items:[...chosenLosses,...chosenGains],pausedSinceAnalysis:superseded.length,considered:active.length,protectedTests:young.length,priorityTests:priorityTests.length,losses:losses.length,opportunities:gains.length};
}

export const campaignStatusFilters=Object.freeze({active:'Ativas',paused:'Pausadas',all:'Todas'});
export function matchesStatus(status,filter){
 if(filter==='all')return true;
 return filter==='active'?status==='ACTIVE':status!=='ACTIVE';
}

/** Column values used by the campaigns table and its sorting. Missing stays null and always sorts last. */
export function campaignColumns(c){
 const today=c.windows?.today?sum([c.windows.today]):null,yesterday=c.windows?.yesterday?sum([c.windows.yesterday]):null;
 return {name:c.row?.name||'',todaySpend:today?.spend??null,todayRoas:today?.roas??null,yesterdayRoas:yesterday?.roas??null,weekSpend:c.week?.spend??null,weekRoas:c.week?.roas??null,recentRoas:c.recent?.roas??null,weekFront:c.week?.frontOrders??null};
}
export function sortCampaigns(list,key,direction='desc'){
 if(!key)return list;
 const sign=direction==='asc'?1:-1;
 return list.map((c,index)=>({c,index,value:campaignColumns(c)[key]})).sort((a,b)=>{
  const missingA=a.value===null||a.value===undefined||a.value==='',missingB=b.value===null||b.value===undefined||b.value==='';
  if(missingA!==missingB)return missingA?1:-1;
  if(missingA)return a.index-b.index;
  const order=typeof a.value==='string'?a.value.localeCompare(b.value,'pt-BR'):a.value-b.value;
  return order*sign||a.index-b.index;
 }).map(x=>x.c);
}

/** Remembered per browser only; a value that no longer exists falls back to the caller default. */
export function rememberedChoice(raw,allowed,fallback){return typeof raw==='string'&&allowed.includes(raw)?raw:fallback;}
