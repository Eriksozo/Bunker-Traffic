import {CloudError} from './cloud-malva.mjs';
import {fingerprint} from './collaboration.mjs';
import {historyLearningKey,collectHistoryLearning,storeHistoryCollection} from './cloud-history-learning.mjs';
import {recordDecisionHistoryOutcome} from './decision-history-outcomes.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||''),day=86400000,metrics=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','impressions','linkClicks'];
export const externalLearningPolicy=Object.freeze({version:3,maximumSourceClockWaitMs:1000,comparisonsPerJob:1,maximumMeasurements:1000,maximumChecks:500,maximumAgeDays:30,refreshHours:24,failureRetryHours:1,recallCases:3,providerWrites:false});
const localDay=(n,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(n);
const shifted=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*day).toISOString().slice(0,10);
function version(state,event,row){return fingerprint({measurementPolicy:externalLearningPolicy.version,event:{key:event.eventKey,account:event.adAccountId,object:event.objectId,field:event.field,before:event.before,after:event.after,currency:event.currency,source:event.source,nativeEcho:event.nativeEcho,origins:arr(event.originObservations).map(o=>o.eventFingerprint)},row:{id:row.id,name:row.name},changes:arr(state.historyLearning?.changes).filter(c=>c.project===event.project&&c.adAccountId===event.adAccountId&&c.campaignExternalId===event.objectId&&Math.abs(at(c.at)-at(event.occurredAt))<3*day),incidents:arr(state.incidents).filter(i=>i.project===event.project)});}
export function externalLearningCandidates(state,project,now=Date.now()){
 if(state.paused)return [];
 const today=localDay(now,project.timezone),rows=arr(state.snapshots).filter(s=>s.projectId===project.id&&s.level==='campaign').flatMap(s=>arr(s.rows)),out=[];
 for(const event of arr(state.decisionHistory)){
  if(event.project!==project.id||event.sourceSystem!=='Malva MCP'||!['increase','reduce','pause','activate'].includes(event.action)||event.automatic===true||isWarmupCampaign(event.name)||!Number.isFinite(at(event.occurredAt))||now-at(event.occurredAt)>externalLearningPolicy.maximumAgeDays*day||at(event.occurredAt)>now)continue;
  const row=rows.find(r=>r.externalId===event.objectId&&r.adAccountId===event.adAccountId&&String(r.provider).toLowerCase()==='meta');
  const scopeKey=historyLearningKey(project.id,event.adAccountId,event.objectId),scope=state.historyLearning?.scopes?.[scopeKey];if(state.historyLearning?.failures?.[scopeKey]||!row?.id||isWarmupCampaign(row.name)||!scope?.scope||scope.pending&&!scope.pending.repairRange||!event.currency)continue;
  const date=localDay(at(event.occurredAt),project.timezone),beforeDay=shifted(date,-1),afterDay=shifted(date,1);if(afterDay>=today)continue;
  if(scope.pending&&(scope.pending.request?.from!==beforeDay||scope.pending.request?.to!==afterDay))continue;
  const evidenceVersion=version(state,event,row),check=state.externalLearningChecks?.[event.eventKey],delay=scope.pending?.repairRange&&check?.code==='SOURCE_EXTERNAL_HISTORY_PENDING'?0:(check?.status==='Leitura indisponível'?externalLearningPolicy.failureRetryHours:externalLearningPolicy.refreshHours)*3600000;
  if(!check&&Object.keys(state.externalLearningChecks||{}).length>=externalLearningPolicy.maximumChecks)continue;
  if(check&&check.evidenceVersion===evidenceVersion&&now-at(check.lastCheckedAt)<delay)continue;
  out.push({event,row,beforeDay,afterDay,evidenceVersion,inputCheckFingerprint:fingerprint(check||null),checkedBefore:check?.lastCheckedAt||null});
 }
 return out.sort((a,b)=>Number(!!a.checkedBefore)-Number(!!b.checkedBefore)||Number(b.event.humanObserved)-Number(a.event.humanObserved)||at(b.event.occurredAt)-at(a.event.occurredAt));
}
async function observation(client,project,work,date,now,wait){
 const r=await client.read('tracking_campaigns',{projectId:project.id,level:'campaign',provider:['meta'],sales:'traffic',preset:'custom',from:date,to:date,status:'all',accountStatus:'all',accountIds:[work.row.adAccountId],q:Array.from(work.row.name||'').slice(0,80).join(''),limit:100});
 let received=now(),issues=externalWindowIssues(r,project,date,received);
 // Yield once for small provider clock skew, then run the unchanged strict gates.
 // Original source timestamps are retained; no tolerance or synthetic clock is used.
 if(issues.length&&issues.every(k=>k==='freshAtFuture'||k==='syncFuture')){
  const deadline=Math.max(at(r.freshAt),at(r.lastSyncAt)),delay=deadline-received;
  if(delay>0&&delay<=externalLearningPolicy.maximumSourceClockWaitMs){await wait(Math.ceil(delay));received=now();issues=externalWindowIssues(r,project,date,received);}
 }
 if(issues.length){const error=new CloudError('SOURCE_EXTERNAL_WINDOW');error.windowFailure={day:date,issues,receivedAt:new Date(received).toISOString(),sourceClock:Object.fromEntries(['freshAt','lastSyncAt','from','to'].map(k=>{const v=['from','to'].includes(k)?r.period?.[k]:r[k];return [k,Number.isFinite(at(v))?new Date(at(v)).toISOString():null];}))};throw error;}
 const matches=arr(r.rows).filter(row=>row.externalId===work.row.externalId&&row.adAccountId===work.row.adAccountId);const row=matches[0];
 if(matches.length!==1||row.id!==work.row.id||row.projectId!==project.id||row.projectName!==project.name||row.level!=='campaign'||row.provider!=='meta'||row.budgetCurrency!==work.event.currency||metrics.some(k=>!Number.isFinite(row[k])||row[k]<0)||['frontOrders','orders','checkouts','impressions','linkClicks'].some(k=>!Number.isInteger(row[k])))throw new CloudError('SOURCE_EXTERNAL_IDENTITY');
 return {source:'Malva MCP',complete:true,projectId:project.id,level:'campaign',from:r.period.from,to:r.period.to,fetchedAt:r.freshAt,lastSyncAt:r.lastSyncAt,timezone:project.timezone,metricsCurrency:r.currency,coverage:{kind:'exact-object-in-filtered-response',inventoryTruncated:!!r.truncated},rows:[structuredClone(row)]};
}
/** Only inside an already admitted collection job. No independent agenda or provider write. */
export async function collectExternalLearning(client,state,project,{now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const work=externalLearningCandidates(state,project,now())[0];if(!work)return null;
 const base={project:project.id,eventKey:work.event.eventKey,evidenceVersion:work.evidenceVersion,inputCheckFingerprint:work.inputCheckFingerprint};
 let historyRepair=null;
 try{
  const [before,after]=await Promise.all([observation(client,project,work,work.beforeDay,now,wait),observation(client,project,work,work.afterDay,now,wait)]);
  const key=historyLearningKey(project.id,work.event.adAccountId,work.event.objectId);let scope=state.historyLearning.scopes[key];
  if(scope.pending||!scope.intervals.some(w=>at(w.from)<=at(before.from)&&at(w.to)>=at(after.to))){
   historyRepair=await collectHistoryLearning(client,project,work.row,scope,{now,range:{from:work.beforeDay,to:work.afterDay}});
   const repaired=structuredClone(state),saved=storeHistoryCollection(repaired,historyRepair,now());scope=repaired.historyLearning.scopes[key];
   if(saved.status==='Paginação pendente')throw new CloudError('SOURCE_EXTERNAL_HISTORY_PENDING');
   if(saved.status!=='Completo no recorte consultado')throw new CloudError('SOURCE_EXTERNAL_HISTORY_UNVERIFIED');
  }
  if(!scope.intervals.some(w=>at(w.from)<=at(before.from)&&at(w.to)>=at(after.to)))throw new CloudError('SOURCE_EXTERNAL_HISTORY_GAP');
  return {...base,status:'Lida',before,after,...(historyRepair?{historyRepair}:{}),checkedAt:new Date(now()).toISOString()};
 }catch(error){return {...base,status:'Leitura indisponível',code:/^SOURCE_[A-Z_]+$/.test(error.code||'')?error.code:'SOURCE_EXTERNAL_UNAVAILABLE',...(historyRepair?{historyRepair}:{}),...(error.windowFailure?{windowFailure:error.windowFailure}:{}),checkedAt:new Date(now()).toISOString()};}
}
/** Fixed, nonfinancial diagnostic labels; none of these failures is silently tolerated. */
export function externalWindowIssues(r,project,date,received){
 const period=r?.period,finite=x=>Number.isFinite(at(x));
 return Object.entries({level:r?.level!=='campaign',salesScope:r?.salesScope?.kind!=='traffic',metricsCurrency:r?.currency!==project.currency,timezone:period?.timezone!==project.timezone,requestedDay:!Array.isArray(period?.days)||period.days.length!==1||period.days[0]!==date,freshAtMissing:!finite(r?.freshAt),freshAtFuture:finite(r?.freshAt)&&at(r.freshAt)>received,freshAtStale:finite(r?.freshAt)&&received-at(r.freshAt)>300000,syncMissing:!finite(r?.lastSyncAt),boundsMissing:!finite(period?.from)||!finite(period?.to),boundsOrder:finite(period?.from)&&finite(period?.to)&&at(period.from)>=at(period.to),syncBeforeClose:finite(r?.lastSyncAt)&&finite(period?.to)&&at(r.lastSyncAt)<at(period.to),syncFuture:finite(r?.lastSyncAt)&&at(r.lastSyncAt)>received,windowNotClosed:finite(period?.to)&&finite(r?.freshAt)&&at(period.to)>at(r.freshAt)}).filter(([,bad])=>bad).map(([field])=>field);
}
function preserve(state,value,eventKey){
 const r=value.rows[0],entries=arr(state.externalHistoryMeasurements),key=JSON.stringify([value.projectId,r.adAccountId,r.externalId,value.level,value.from,value.to,value.fetchedAt]),existing=entries.find(m=>m.key===key),values=Object.fromEntries(metrics.map(k=>[k,r[k]]));
 if(existing){if(JSON.stringify(existing.metrics)!==JSON.stringify(values)||existing.budgetCurrency!==r.budgetCurrency||existing.metricsCurrency!==value.metricsCurrency)throw new CloudError('SOURCE_EXTERNAL_CONFLICT');return;}
 if(entries.length>=externalLearningPolicy.maximumMeasurements)throw new CloudError('SOURCE_EXTERNAL_CAPACITY');
 state.externalHistoryMeasurements=[...entries,{id:crypto.randomUUID(),key,project:value.projectId,adAccountId:r.adAccountId,externalId:r.externalId,level:'campaign',source:'Malva MCP',complete:true,from:value.from,to:value.to,fetchedAt:value.fetchedAt,lastSyncAt:value.lastSyncAt,timezone:value.timezone,metricsCurrency:value.metricsCurrency,budgetCurrency:r.budgetCurrency,provider:'meta',metrics:values,eventKey}];
}
/** Rechecks exact scope and proof version at commit. No fabricated data or retroactive pattern enrollment. */
export function persistExternalLearning(state,result,now=Date.now()){
 if(!result)return {status:'Sem comparação elegível'};
 if(!Number.isFinite(at(result.checkedAt))||at(result.checkedAt)>now||now-at(result.checkedAt)>300000)return {status:'Releitura necessária'};
 const event=arr(state.decisionHistory).find(e=>e.project===result.project&&e.eventKey===result.eventKey),row=event&&arr(state.snapshots).filter(s=>s.projectId===event.project&&s.level==='campaign').flatMap(s=>arr(s.rows)).find(r=>r.externalId===event.objectId&&r.adAccountId===event.adAccountId);
 const old=state.externalLearningChecks?.[result.eventKey];if(!event||!row||state.paused||fingerprint(old||null)!==result.inputCheckFingerprint||version(state,event,row)!==result.evidenceVersion)return {status:'Releitura necessária'};
 const checks={...state.externalLearningChecks};if(!old&&Object.keys(checks).length>=externalLearningPolicy.maximumChecks)return {status:'Capacidade do histórico atingida'};
 let draft=structuredClone(state);
 if(result.historyRepair){
  const repair=result.historyRepair;
  if(repair.project!==result.project||repair.adAccountId!==event.adAccountId||repair.externalId!==event.objectId||!Number.isFinite(at(repair.fetchedAt))||at(repair.fetchedAt)>now||now-at(repair.fetchedAt)>300000)return {status:'Releitura necessária'};
  const saved=storeHistoryCollection(draft,repair,now);if(saved.status==='Releitura necessária')return {status:'Releitura necessária'};
  if(saved.status.startsWith('Capacidade')||saved.code==='SOURCE_HISTORY_CAPACITY'){const code='SOURCE_EXTERNAL_HISTORY_CAPACITY';if(draft.historyLearning?.failures)state.historyLearning=draft.historyLearning;state.externalLearningChecks={...checks,[result.eventKey]:{project:result.project,eventKey:result.eventKey,evidenceVersion:result.evidenceVersion,lastCheckedAt:result.checkedAt,status:'Leitura indisponível',code}};return {status:'Leitura indisponível',code};}
  // Preserve pagination and source conflicts, but never replace other central state.
  for(const k of ['historyLearning','decisionHistory','decisionHistoryImports'])if(draft[k]!==undefined)state[k]=draft[k];
 }
 const currentEvent=arr(state.decisionHistory).find(e=>e.eventKey===result.eventKey&&e.project===result.project);
 const check={project:result.project,eventKey:result.eventKey,evidenceVersion:version(state,currentEvent,row),lastCheckedAt:result.checkedAt,status:result.status};
 if(result.status!=='Lida'){checks[result.eventKey]={...check,code:result.code,...(result.windowFailure?{windowFailure:structuredClone(result.windowFailure)}:{})};state.externalLearningChecks=checks;return {status:result.status,code:result.code};}
 const scope=state.historyLearning?.scopes?.[historyLearningKey(result.project,event.adAccountId,event.objectId)];
 if(state.historyLearning?.failures?.[historyLearningKey(result.project,event.adAccountId,event.objectId)]||!scope?.scope||scope.pending||!arr(scope.intervals).some(w=>at(w.from)<=at(result.before.from)&&at(w.to)>=at(result.after.to)))return {status:'Releitura necessária'};
 const semantic=fingerprint({eventKey:result.eventKey,evidenceVersion:check.evidenceVersion,before:{from:result.before.from,to:result.before.to,timezone:result.before.timezone,currency:result.before.metricsCurrency,metrics:Object.fromEntries(metrics.map(k=>[k,result.before.rows[0][k]]))},after:{from:result.after.from,to:result.after.to,timezone:result.after.timezone,currency:result.after.metricsCurrency,metrics:Object.fromEntries(metrics.map(k=>[k,result.after.rows[0][k]]))}});
 if(old?.semantic===semantic){checks[result.eventKey]={...old,...check,status:old.status};state.externalLearningChecks=checks;return {status:'Sem mudança nas evidências',outcomeId:old.outcomeId};}
 draft=structuredClone(state);
 try{preserve(draft,result.before,result.eventKey);preserve(draft,result.after,result.eventKey);
  const saved=recordDecisionHistoryOutcome(draft,{clientId:'cloud-external:'+semantic,entry:{project:result.project,eventKey:result.eventKey,before:result.before,after:result.after,summary:'Comparação de dias fechados do ajuste observado no Malva. Aquisição front foi lida, não estimada por pedidos. Associação temporal, sem execução pelo Bunker.'}},now);
  checks[result.eventKey]={...check,status:saved.classification,semantic,outcomeId:saved.id};state.externalHistoryMeasurements=draft.externalHistoryMeasurements;state.decisionHistoryOutcomes=draft.decisionHistoryOutcomes;state.externalLearningChecks=checks;return {status:saved.classification,outcomeId:saved.id,limits:saved.limits};
 }catch(error){checks[result.eventKey]={...check,status:'Leitura indisponível',code:error.code||'SOURCE_EXTERNAL_UNVERIFIED'};state.externalLearningChecks=checks;return {status:'Leitura indisponível',code:checks[result.eventKey].code};}
}
/** Recent external examples, scoped to the original project, revalidated and never credited to a Bunker agent. */
export function externalLearningRecall(state,project,focus,now=Date.now()){
 const latest=new Map();for(const o of arr(state.decisionHistoryOutcomes).filter(o=>o.project===project&&at(o.observedAt)<=now&&now-at(o.observedAt)<=externalLearningPolicy.maximumAgeDays*day).sort((a,b)=>at(b.observedAt)-at(a.observedAt)))if(!latest.has(o.eventKey))latest.set(o.eventKey,o);
 const candidates=[];
 for(const o of [...latest.values()].slice(0,30)){
  const event=arr(state.decisionHistory).find(e=>e.id===o.eventId&&e.project===project);if(!event||isWarmupCampaign(event.name))continue;
  try{const checked=recordDecisionHistoryOutcome({...state,decisionHistoryOutcomes:[]},{clientId:'recall:'+o.id,entry:JSON.parse(o.request)},now);candidates.push({outcomeId:o.id,eventKey:o.eventKey,adAccountId:o.adAccountId,objectId:o.objectId,action:event.action,percent:event.percent,actor:event.actor,occurredAt:event.occurredAt,observedAt:o.observedAt,classification:checked.classification,limits:checked.limits,before:{from:checked.before.from,to:checked.before.to,timezone:checked.before.timezone,metricsCurrency:checked.before.metricsCurrency,metrics:checked.beforeMetrics},after:{from:checked.after.from,to:checked.after.to,timezone:checked.after.timezone,metricsCurrency:checked.after.metricsCurrency,metrics:checked.afterMetrics},relevantToFocus:focus.some(r=>r.adAccountId===o.adAccountId&&r.externalId===o.objectId),retrospectiveOnly:true,executionByBunker:false,causality:'Não demonstrada'});}catch{}
 }
 const rank={'Desfavorável':0,'Inconclusivo':1,'Favorável':2},seen=new Set();return candidates.sort((a,b)=>Number(b.relevantToFocus)-Number(a.relevantToFocus)||rank[a.classification]-rank[b.classification]||at(b.observedAt)-at(a.observedAt)).filter(o=>{const key=JSON.stringify([o.adAccountId,o.objectId]);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,externalLearningPolicy.recallCases);
}

export function externalLearningPlan(state){
 const scopes=Object.values(state.historyLearning?.scopes||{}),checks=Object.values(state.externalLearningChecks||{}),latest=new Map();
 for(const o of arr(state.decisionHistoryOutcomes).slice().sort((a,b)=>at(b.observedAt)-at(a.observedAt)))if(!latest.has(o.eventKey))latest.set(o.eventKey,o);
 return {version:1,mode:'Observação de ajustes de gestores, separada das aplicações do Bunker',scopes:scopes.length,completedScopes:scopes.filter(s=>s.scope&&!s.pending).length,pendingScopes:scopes.filter(s=>s.pending).length,observedActions:arr(state.decisionHistory).filter(e=>e.measurementOwner==='history-learning').length,comparisons:latest.size,favorable:[...latest.values()].filter(o=>o.classification==='Favorável').length,unfavorable:[...latest.values()].filter(o=>o.classification==='Desfavorável').length,inconclusive:[...latest.values()].filter(o=>o.classification==='Inconclusivo').length,sourceFailures:checks.filter(c=>c.status==='Leitura indisponível').length+Object.keys(state.historyLearning?.failures||{}).length,policy:externalLearningPolicy,limits:['Histórico consultado das campanhas priorizadas; não equivale a todo o projeto analisado individualmente.','Paginação incompleta não libera avaliação. Dias fechados podem receber ajustes tardios da origem.','Até uma comparação por coleta já devida. Sem nova agenda ou escrita no provedor.','Associação temporal não comprova causalidade nem valida hipótese criada depois do resultado.']};
}
