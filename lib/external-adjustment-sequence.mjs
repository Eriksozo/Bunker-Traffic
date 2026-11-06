/** Context for observed manager decisions. A sequence is never an isolated treatment or efficacy claim. */
import {isWarmupCampaign} from './campaign-scope.mjs';
export const externalSequencePolicy=Object.freeze({version:1,maximumSteps:6,maximumOtherChanges:4,providerWrites:false});
const arr=x=>Array.isArray(x)?x:[],at=x=>typeof x==='string'?Date.parse(x):NaN;
const short=(x,n=250)=>typeof x==='string'&&x.length>0&&x.length<=n?x:null;
// Kept identical to the historical comparison's existing application-evidence predicate.
export function metaApplicationObserved(event){return String(event.source).toLowerCase()==='meta'||!!event.nativeEcho||!!event.echoMetadata||!!event.attachedEcho||!!event.raw?.echo||!!event.originObservations?.some(x=>x.nativeEcho||String(x.source).toLowerCase()==='meta');}
function actor(value){
 if(typeof value==='string')return short(value);
 if(!value||Array.isArray(value)||typeof value!=='object')return null;
 const entries=Object.entries(value).filter(([k,v])=>['key','id','name','kind','type','profile'].includes(k)&&short(v));return entries.length?Object.fromEntries(entries):null;
}
function uniqueMatch(rows,key,value){const matches=rows.filter(r=>r?.[key]===value);return matches.length===1?matches[0]:null;}
function stepOf(event,anchor,from,to,now){
 const time=at(event?.occurredAt);
 if(event?.sourceSystem!=='Malva MCP'||event.project!==anchor.project||event.adAccountId!==anchor.adAccountId||event.objectId!==anchor.objectId||event.currency!==anchor.currency||isWarmupCampaign(event.name)||!short(event.id)||!short(event.eventKey,600)||!Number.isFinite(time)||time<=from||time>=to||time>now||!short(event.source,150))return null;
 let action;
 if(event.field==='dailyBudget'){
  if(![event.before,event.after].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9)||event.before===event.after||!/^[A-Z]{3}$/.test(event.currency||''))return null;
  action=event.after>event.before?'increase':'reduce';
 }else if(event.field==='status'){
  if(!short(event.before,80)||!short(event.after,80)||event.before===event.after)return null;
  action=event.before==='ACTIVE'&&event.after==='PAUSED'?'pause':event.before==='PAUSED'&&event.after==='ACTIVE'?'activate':'status';
 }else return null;
 if(action!==event.action)return null;
 return {historyId:event.id,eventId:short(event.eventId),eventKey:event.eventKey,occurredAt:event.occurredAt,selectedEvent:event.id===anchor.id,action,field:event.field,before:event.before,after:event.after,currency:event.currency??null,actor:actor(event.actor),source:event.source,humanObserved:event.humanObserved===true,automatic:typeof event.automatic==='boolean'?event.automatic:null,metaApplicationObserved:metaApplicationObserved(event)};
}
/** Called only after revalidating the comparison against stored source windows. Pure, bounded and project/account exact. */
export function externalAdjustmentSequence(state,event,comparison,now=Date.now()){
 if(!event||!comparison)return null;
 const from=at(comparison?.before?.from),to=at(comparison?.after?.to);
 if(!Number.isFinite(now)||!Number.isFinite(from)||!Number.isFinite(to)||from>=to||to>now||comparison?.project!==event.project||comparison.eventId!==event.id||comparison.adAccountId!==event.adAccountId||comparison.objectId!==event.objectId)return null;
 const ids=[...new Set([event.id,...arr(comparison.competingEventIds)])],steps=[];let unavailable=0;
 for(const id of ids){const row=uniqueMatch(arr(state.decisionHistory),'id',id),step=row&&stepOf(row,event,from,to,now);if(step)steps.push(step);else unavailable++;}
 const selected=steps.find(s=>s.selectedEvent),nearest=steps.filter(s=>!s.selectedEvent).sort((a,b)=>Math.abs(at(a.occurredAt)-at(event.occurredAt))-Math.abs(at(b.occurredAt)-at(event.occurredAt))||a.eventKey.localeCompare(b.eventKey));
 const shown=[...(selected?[selected]:[]),...nearest.slice(0,externalSequencePolicy.maximumSteps-(selected?1:0))].sort((a,b)=>at(a.occurredAt)-at(b.occurredAt)||a.eventKey.localeCompare(b.eventKey));
 const changes=[],keys=[...new Set(arr(comparison.otherChangeKeys))];let unavailableChanges=0;
 // Raw source descriptors stay separate: they can overlap ledger events and must not be added to the action count.
 for(const key of keys){
  const c=uniqueMatch(arr(state.historyLearning?.changes),'key',key),time=at(c?.at);
  if(!c||c.project!==event.project||c.adAccountId!==event.adAccountId||c.campaignExternalId!==event.objectId||!['campaign','adset','ad'].includes(c.level)||!short(c.objectExternalId)||!short(c.category,80)||!short(c.source,150)||!Number.isFinite(time)||time<=from||time>=to||time>now){unavailableChanges++;continue;}
  changes.push({key:c.key,at:c.at,level:c.level,objectId:c.objectExternalId,category:c.category,source:c.source});
 }
 changes.sort((a,b)=>Math.abs(at(a.at)-at(event.occurredAt))-Math.abs(at(b.at)-at(event.occurredAt))||a.key.localeCompare(b.key));const shownChanges=changes.slice(0,externalSequencePolicy.maximumOtherChanges).sort((a,b)=>at(a.at)-at(b.at)||a.key.localeCompare(b.key));
 const times=shown.map(s=>at(s.occurredAt)),hasTimeTies=new Set(times).size!==times.length;
 return {version:1,from:comparison.before.from,to:comparison.after.to,timezone:comparison.before.timezone,selection:'selected-event-and-nearest-observed-edits',steps:shown,otherChanges:shownChanges,coverage:{kind:'comparison-referenced-items-only',knownSteps:steps.length,shownSteps:shown.length,omittedSteps:steps.length-shown.length,unavailableReferences:unavailable,knownOtherChanges:changes.length,shownOtherChanges:shownChanges.length,omittedOtherChanges:changes.length-shownChanges.length,unavailableOtherChanges:unavailableChanges,selectedEventAvailable:!!selected,hasTimeTies},incidentCount:arr(comparison.incidentIds).length,financialClassification:comparison.classification,causality:'Não demonstrada',rule:'Sequência observada no projeto/conta, não efeito isolado nem cobertura de todo o histórico. Não somar descritores brutos às ações; podem representar o mesmo evento. Horários iguais não comprovam ordem. Orçamentos mantêm a moeda nativa; não converter ou compor percentuais. Ausências e omissões não são zero. Incidente ou múltiplos ajustes mantém a comparação inconclusiva; nenhum crédito ao Bunker.'};
}
