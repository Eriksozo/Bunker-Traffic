import {currentLiveSnapshot} from './live-display.mjs';
import {campaignNativeDrift} from './campaign-observation.mjs';
import {sum} from './analysis.mjs';
import {decisionContext} from './decision-context.mjs';

const rows=value=>Array.isArray(value)?value:[];
const nowTime=value=>typeof value==='number'?value:Date.parse(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const title='Mudança detectada · aguardando releitura';
const closed=['7d','3d','yesterday'];
const metaCampaign=row=>row&&typeof row.adAccountId==='string'&&row.adAccountId.length>0&&typeof row.externalId==='string'&&row.externalId.length>0&&row.level==='campaign'&&String(row.provider||'').toLowerCase()==='meta';
const sameObject=(a,b)=>metaCampaign(a)&&metaCampaign(b)&&a.adAccountId===b.adAccountId&&a.externalId===b.externalId;
function analysisWindow(card){
 const window=card.windows?.today,cut=rows(card.sourceCut).find(source=>source.period==='today'&&(!source.level||source.level==='campaign'));
 return {from:window?.from??cut?.from,to:window?.to??cut?.to,timezone:window?.timezone??cut?.timezone};
}
const sameWindow=(a,b)=>Number.isFinite(time(a.from))&&Number.isFinite(time(a.to))&&time(a.from)===time(b.from)&&time(a.to)===time(b.to);
function staleAnalysis(card,at){
 const fetched=time(card.sourceAt),window=analysisWindow(card),from=time(window.from),to=time(window.to);
 const todayCut=rows(card.sourceCut).find(source=>source.period==='today'&&source.level==='campaign'),completeCut=todayCut?.complete===true&&todayCut.source==='Malva MCP';
 // A complete spent-filter read can legitimately omit an idle/paused object.
 // That is not an expired analysis; its missing metrics and financial guards
 // remain unchanged and must never be filled with invented zeroes.
 if(!card.windows?.today&&!completeCut||!Number.isFinite(fetched)||fetched>at+5000||at-fetched>3600000||!Number.isFinite(from)||!Number.isFinite(to)||from>at||to<=at||from>=to)return true;
 if(window.timezone){
  try{const day=new Intl.DateTimeFormat('en-CA',{timeZone:window.timezone,year:'numeric',month:'2-digit',day:'2-digit'});if(day.format(new Date(from))!==day.format(new Date(at)))return true;}catch{return true;}
 }
 return false;
}
function latestLive(card,items,at){
 const snapshots=rows(items).map(item=>({item,snapshot:currentLiveSnapshot(item,card.project,undefined,at)})).filter(entry=>entry.snapshot&&time(entry.snapshot.fetchedAt)<=at).sort((a,b)=>time(b.snapshot.fetchedAt)-time(a.snapshot.fetchedAt));
 if(!snapshots.length)return null;
 const newest=snapshots[0],sourceAt=time(card.sourceAt);
 // The newest read must not regress analysis presentation or fill a missing
 // current object with a row from an older cache entry.
 if(Number.isFinite(sourceAt)&&time(newest.snapshot.fetchedAt)<sourceAt)return null;
 const matches=newest.snapshot.rows.filter(candidate=>sameObject(card.row,candidate));
 return matches.length===1?{...newest,row:matches[0]}:null;
}
function contextFor(card,liveToday){
 if(!liveToday||!closed.every(period=>Number.isFinite(time(card.windows?.[period]?.to))&&time(card.windows[period].to)===time(liveToday.from)))return null;
 return decisionContext({...card.windows,today:liveToday});
}
function materialChanges(card,live,liveToday){
 if(!live)return [];
 const beforeWindow=analysisWindow(card),afterWindow=live.snapshot,changes=[];
 if(!sameWindow(beforeWindow,afterWindow)||beforeWindow.timezone&&afterWindow.timezone&&beforeWindow.timezone!==afterWindow.timezone){
  if(Number.isFinite(time(beforeWindow.from))&&Number.isFinite(time(beforeWindow.to)))changes.push({field:'todayWindow',before:beforeWindow,after:{from:afterWindow.from,to:afterWindow.to,timezone:afterWindow.timezone}});
  return changes;
 }
 // Metrics can be compared only within one exact day window and after a newer
 // observation. Orders/upsells are deliberately not interpreted as new front.
 if(!card.windows?.today||time(live.snapshot.fetchedAt)<=time(card.sourceAt))return changes;
 for(const field of ['frontOrders','refundedOrders','refundedRevenue']){
  const before=finite(card.row[field])?card.row[field]:card.windows?.today?.[field],after=live.row[field];
  // Normal acquisition growth does not obsolete a reviewed observation-only
  // recommendation. Regime changes below, refunds, decreases and every exact
  // financial proposal still require a new assessment.
  if(field==='frontOrders'&&card.suggestion?.origin==='team'&&card.suggestion.action==='keep'&&!card.proposal&&finite(before)&&finite(after)&&after>before)continue;
  if(finite(before)&&finite(after)&&before!==after)changes.push({field,before,after});
 }
 const regimes=[{field:'roi',threshold:1},...(finite(card.targetRoas)&&card.targetRoas>0?[{field:'roas',threshold:card.targetRoas}]:[])];
 for(const {field,threshold} of regimes){const before=card.windows?.today?.[field],after=liveToday[field];if(finite(before)&&finite(after)&&(before>=threshold)!==(after>=threshold))changes.push({field,before,after,threshold});}
 return changes;
}
function currentContext(card,items,at){
 const live=latestLive(card,items,at),liveToday=live?{...sum([live.row]),from:live.snapshot.from,to:live.snapshot.to,timezone:live.snapshot.timezone,fetchedAt:live.snapshot.fetchedAt}:null;
 return {live,liveToday,analysisStale:staleAnalysis(card,at)};
}
function driftFor(card,context,at){
 const {live,liveToday,analysisStale}=context,native=live?campaignNativeDrift(card.row,live.row):[],material=materialChanges(card,live,liveToday),reasons=[];
 if(analysisStale)reasons.push('A análise tem mais de 60 minutos ou a janela de hoje não corresponde mais ao dia atual.');
 if(native.length)reasons.push('Status, orçamento ou moeda nativa mudaram desde a análise.');
 if(material.some(change=>change.field==='todayWindow'))reasons.push('A janela do dia mudou; os períodos fechados precisam ser atualizados.');
 if(material.some(change=>['frontOrders','refundedOrders','refundedRevenue'].includes(change.field)))reasons.push('Novas vendas front ou reembolsos mudaram o resultado observado.');
 if(material.some(change=>['roi','roas'].includes(change.field)))reasons.push('O retorno cruzou o equilíbrio ou a meta configurada desde a análise.');
 if(!reasons.length)return null;
 return {kind:analysisStale?'analysis-stale':native.length?'native':'context',at:live?.snapshot.fetchedAt||new Date(at).toISOString(),title:analysisStale?'Análise vencida · aguardando releitura':title,changes:native,materialChanges:material,reasons,...(live?{observedRow:structuredClone(live.row)}:{})};
}

/** Display observations invalidate stale context, never alter sealed analysis,
 * authorize a choice, create a proposal or confirm a financial execution. */
export function campaignLiveDrift(card,items,now=Date.now()){
 const at=nowTime(now);if(!card||typeof card.project!=='string'||!card.row||!Number.isFinite(at))return null;
 return driftFor(card,currentContext(card,items,at),at);
}

/** Decorate presentation only. Original seals, sources and windows stay exact. */
export function decorateCampaignCard(card,items,now=Date.now()){
 const at=nowTime(now);if(!card||typeof card.project!=='string'||!card.row||!Number.isFinite(at))return card;
 const context=currentContext(card,items,at),{live,liveToday,analysisStale}=context,drift=driftFor(card,context,at);
 const result={...card,...(live?{observedRow:structuredClone(live.row)}:{}),liveToday,liveAt:live?.snapshot.fetchedAt||null,liveStale:!live||!!live.item.error||at-time(live.snapshot.fetchedAt)>300000,analysisStale,displayContext:contextFor(card,liveToday),liveDrift:drift?{kind:drift.kind,at:drift.at,title:drift.title,changes:drift.changes,materialChanges:drift.materialChanges,reasons:drift.reasons}:null};
 if(!drift)return result;
 const reason=drift.reasons.join(' ')+' Aguardar nova análise dos quatro períodos e pareceres antes de decidir.';
 return {...result,suggestion:{action:'keep',percent:null,reason,origin:'diagnostic'},teamReady:false,teamOpinions:[],proposal:null,actionable:{increase:false,reduce:false,pause:false,keep:false},blockedReasons:[...new Set([...rows(card.blockedReasons),reason])]};
}
