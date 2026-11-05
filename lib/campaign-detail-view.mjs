import {candidates,rowKey,sum,periods} from './analysis.mjs';
import {currentLiveSnapshot} from './live-display.mjs';

const time=value=>typeof value==='string'?Date.parse(value):NaN;
const same=(a,b)=>a&&b&&rowKey(a)===rowKey(b)&&String(a.provider||'').toLowerCase()===String(b.provider||'').toLowerCase();
function currentDay(snapshot,now){
 if(!snapshot||snapshot.complete!==true||snapshot.source!=='Malva MCP'||time(snapshot.from)>now||time(snapshot.to)<=now||!Number.isFinite(time(snapshot.from))||!Number.isFinite(time(snapshot.to))||!Number.isFinite(time(snapshot.fetchedAt))||time(snapshot.fetchedAt)>now)return false;
 try{const day=new Intl.DateTimeFormat('en-CA',{timeZone:snapshot.timezone});return day.format(time(snapshot.from))===day.format(now);}catch{return false;}
}

/** Re-resolve an open detail by identity on every refresh. Observations are
 * display-only: never modify analysis windows, decisions or financial seals. */
export function campaignDetailView(selection,state,items=[],period='today',now=Date.now()){
 if(!selection?.row)return null;
 const matches=candidates(state,selection.row.projectId,now).filter(candidate=>same(candidate.row,selection.row));
 const analysis=matches.length===1?matches[0]:selection,project=selection.row.projectId;
 /** @type {Record<string, any>} */
 const cuts={};
 for(const p of periods){
  const sources=(state.snapshots||[]).filter(snapshot=>snapshot.projectId===project&&snapshot.level==='campaign'&&snapshot.period===p&&snapshot.rows?.filter(row=>same({...row,projectId:project},selection.row)).length===1).sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt));
  cuts[p]=sources[0]||null;
 }
 const newest=items.map(item=>({item,snapshot:currentLiveSnapshot(item,project,undefined,now)})).filter(entry=>entry.snapshot&&time(entry.snapshot.fetchedAt)<=now).sort((a,b)=>time(b.snapshot.fetchedAt)-time(a.snapshot.fetchedAt))[0];
 const liveMatches=newest?.snapshot.rows.filter(row=>same({...row,projectId:project},selection.row))||[];
 const live=newest&&liveMatches.length===1&&(!cuts.today||time(newest.snapshot.fetchedAt)>=time(cuts.today.fetchedAt))?{...newest,row:liveMatches[0]}:null;
 const analysisToday=currentDay(cuts.today,now)?analysis.windows?.today:null;
 const today=live?sum([live.row]):analysisToday?sum([analysisToday]):sum([]);
 const todaySource=live?.snapshot||(analysisToday?cuts.today:null);
 /** @type {Record<string, any>} */
 const metrics={};for(const p of periods)metrics[p]=p==='today'?today:analysis.windows?.[p]?sum([analysis.windows[p]]):sum([]);
 const source=period==='today'?todaySource:cuts[period],sourceTime=time(source?.lastSyncAt),fetched=time(source?.fetchedAt);
 return {analysis,row:live?.row?{...live.row,projectId:project,projectName:analysis.row.projectName}:analysis.row,metrics,selectedMetrics:metrics[period]||sum([]),source,
  live:period==='today'&&!!live,analysisMissing:matches.length!==1,
  unavailable:!source,stale:!source||!Number.isFinite(fetched)||now-fetched>300000||!Number.isFinite(sourceTime)||sourceTime>fetched||now-sourceTime>900000||!!(period==='today'&&live?.item.error),
  confirmedEmpty:period==='today'&&!!todaySource&&today.spend===0&&today.frontOrders===0&&today.orders===0&&today.revenueNet===0};
}
