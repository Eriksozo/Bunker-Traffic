/**
 * Campaign reading context shared by the Sombra (lib/autonomy-shadow.mjs) and the Modo Gestor playbook
 * (lib/manager-playbook.mjs). Extracted from autonomy-shadow.mjs with no behaviour change (golden test
 * tests/autonomy-shadow.test.mjs): which today cut to trust, the closed windows aligned with it, the previous analysis cut
 * after midnight, and the common blocks a playbook decision inherits (2 h edit by someone else, ACTIVE Meta sales only,
 * warm-up out, partial day). Pure: no provider call, no write, no approval, no dispatch.
 */
import {sum} from './analysis.mjs';
import {isTestCampaign,verifiedNoSpendPeriods} from './test-launch.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {newCampaignStage,nameDateOffset} from './first-24h.mjs';
import {partialDayHold,partialDayReason} from './partial-day.mjs';

/** Same values as shadowPolicy (lib/autonomy-shadow.mjs; a test pins the equality). */
export const contextPolicy=Object.freeze({version:1,sourceAgeMs:30*60000,managerEditGuardMs:2*3600000});
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};

/** The single complete campaign-level snapshot of a project and period, or null (none, or ambiguous). */
export function closedSnapshot(state,project,period){const list=arr(state?.snapshots).filter(s=>s.projectId===project&&s.period===period&&s.level==='campaign'&&s.complete===true);return list.length===1?list[0]:null;}
const snapshot=closedSnapshot;

/** Freshest trustworthy today row: live cut when newer and within the age limit, else the analysis cut. */
export function todayRows(state,project,liveItem,now){
 const analysis=snapshot(state,project,'today'),live=liveItem?.snapshot;
 // After midnight a cut of the day that just ended is not today's: it would read yesterday's totals as "hoje" and the day
 // before as "ontem". The night pass reads that cut as yesterday (previousCut) once the new day's live cut exists.
 const zone=s=>s.timezone||analysis?.timezone||'America/Sao_Paulo',ofToday=s=>localDay(time(s.from),zone(s))===localDay(now,zone(s));
 const fresh=s=>s&&ofToday(s)&&s.complete===true&&s.projectId===project&&s.period==='today'&&s.level==='campaign'&&finite(time(s.fetchedAt))&&now-time(s.fetchedAt)<=contextPolicy.sourceAgeMs&&time(s.fetchedAt)<=now+300000&&finite(time(s.lastSyncAt))&&now-time(s.lastSyncAt)<=contextPolicy.sourceAgeMs;
 const useLive=fresh(live)&&live.from===analysis?.from&&(!analysis||time(live.fetchedAt)>=time(analysis.fetchedAt));
 // After midnight, before the first analysis of the new day: the live cut is today's, the closed windows are not.
 if(fresh(live)&&(!analysis||time(live.from)>time(analysis.from)))return {rows:arr(live.rows),fetchedAt:live.fetchedAt,lastSyncAt:live.lastSyncAt,from:live.from,timezone:live.timezone||analysis?.timezone,kind:'live-only',aligned:false};
 const source=useLive?live:fresh(analysis)?analysis:null;
 return source?{rows:arr(source.rows),fetchedAt:source.fetchedAt,lastSyncAt:source.lastSyncAt,from:source.from,timezone:source.timezone||analysis?.timezone,kind:useLive?'live':'analysis',aligned:true}:null;
}

/** Live-only window after midnight: the last analysis cut of the day that just ended (its "today", read up to its sync
 * time) and the closed windows that analysis carried (they end where that cut starts). */
export function previousCut(state,project,today,now){
 const c=snapshot(state,project,'today');
 if(!c||!(Math.abs(time(today.from)-time(c.from)-86400000)<=3600000)||!finite(time(c.lastSyncAt))||now-time(c.lastSyncAt)>7*3600000)return null;
 const old=p=>{const s=snapshot(state,project,p);return s&&Math.abs(time(s.to)-time(c.from))<=60000?s:null;};
 return {rows:arr(c.rows),from:c.from,at:c.lastSyncAt,yesterday:old('yesterday'),'7d':old('7d')};
}
/** Closed rows of one object. Live-only: "yesterday" is the previous analysis cut; 3d/7d only when that analysis proves
 * no earlier spend (they then equal yesterday); `d2` is the day before yesterday (see launchPrior). */
export function rowWindows(state,project,today,closed,prev,row){
 const find=s=>arr(s?.rows).find(x=>key(x)===key(row))||null;
 if(today.aligned)return {windows:{'7d':find(closed['7d']),'3d':find(closed['3d']),yesterday:find(closed.yesterday)},d2:undefined};
 if(!prev)return {windows:{'7d':null,'3d':null,yesterday:null},d2:null};
 const y=find(prev),none=verifiedNoSpendPeriods(state.snapshots,project,row,prev.from),r7=find(prev['7d']),d2=find(prev.yesterday);
 const before=y&&(r7?finite(r7.spend)&&r7.spend===0:none.includes('7d'))?y:null;
 return {windows:{'7d':before,'3d':before,yesterday:y},d2:d2||(none.includes('yesterday')?0:null)};
}

// ---------------------------------------------------------------------------------------------------------------------
// Additions for the Modo Gestor (not used by evaluateShadow).

/**
 * Stage of a campaign for the playbook: 'first-day' / 'second-day' (lib/first-24h.mjs newCampaignStage), 'young' (3rd or
 * 4th day by the date in its name, or no spend before the closed 3 days), 'mature', or null when N/D (scheduled, or no
 * date and no closed windows). `test`: the [TESTE] naming (lib/test-launch.mjs).
 * @param {any} row today's row @param {{yesterday?:any,'3d'?:any,'7d'?:any}} windows closed rows (null = not aligned)
 * @param {{now:number,timezone?:string,noSpendPeriods?:string[]}} options
 */
export function campaignStage(row,windows,{now,timezone='America/Sao_Paulo',noSpendPeriods=[]}={}){
 const test=isTestCampaign(row?.name);
 const w=windows||{},fresh=newCampaignStage(row,{...w,today:row},{now,timezone,noSpendPeriods});
 if(fresh?.stage==='first-day'||fresh?.stage==='second-day')return {stage:fresh.stage,test};
 if(fresh?.stage==='scheduled')return {stage:null,test};
 const offset=nameDateOffset(row?.name,now,timezone);
 if(offset!==null&&offset<=-2&&offset>=-3)return {stage:'young',test};
 if(offset!==null&&offset<=-4)return {stage:'mature',test};
 const d3=w['3d'],d7=w['7d'];
 if(d3&&d7&&finite(d3.spend)&&finite(d7.spend)){
  if(d7.spend>0&&d7.spend-d3.spend<0.01)return {stage:'young',test};
  if(d7.spend-d3.spend>=0.01)return {stage:'mature',test};
 }
 return {stage:null,test};
}

/** ACTIVE Meta sales campaign at campaign level, warm-up/engagement out (the Sombra's own filter). */
export function activeSalesRow(row){
 if(row?.provider!=='meta'||row.level!=='campaign'||isWarmupCampaign(row.name))return false;
 return row.status==='ACTIVE'&&row.effectiveStatus==='ACTIVE'&&row.accountStatus?.active!==false;
}

/** The latest edit by anyone but the Bunker on this campaign within the 2 h guard (evaluateShadow's `recentEdit`). */
export function recentOtherEdit(events,project,row,now){
 return arr(events).find(e=>e.project===project&&e.origin!=='bunker'&&finite(time(e.at))&&now-time(e.at)<=contextPolicy.managerEditGuardMs&&e.adAccountId===row?.adAccountId&&e.objectId===row?.externalId)||null;
}

/** Budget edits of today (local day) on this campaign by anyone, the Bunker included, newest first. */
export function todayBudgetEdits(events,project,row,now,timezone){
 const todayKey=localDay(now,timezone);
 return arr(events).filter(e=>e.project===project&&(e.action==='increase'||e.action==='reduce')&&finite(time(e.at))&&time(e.at)<=now+300000&&localDay(time(e.at),timezone)===todayKey&&e.adAccountId===row?.adAccountId&&e.objectId===row?.externalId).sort((a,b)=>time(b.at)-time(a.at));
}

/** Partial-day hold (lib/partial-day.mjs) of one campaign: only a closed yesterday counts (aligned windows). */
export function partialDayOf(windows,{aligned,today,ticketFront=null}){
 const w=windows||{};
 const h=partialDayHold({yesterday:aligned&&w.yesterday?sum([w.yesterday]):null,today:today?sum([today]):null,week:w['7d']?sum([w['7d']]):null},{ticketFront});
 return {...h,reason:h.hold?partialDayReason(h):null};
}

/** One reading of a project for the playbook: the trusted today cut, its closed windows and the previous cut. */
export function projectReading(state,project,liveItem,now){
 const today=todayRows(state,project,liveItem,now);if(!today)return null;
 const closed=today.aligned?Object.fromEntries(['7d','3d','yesterday'].map(p=>[p,snapshot(state,project,p)])):{};
 const prev=previousCut(state,project,today,now);
 return {today,closed,prev,timezone:today.timezone||'America/Sao_Paulo'};
}
