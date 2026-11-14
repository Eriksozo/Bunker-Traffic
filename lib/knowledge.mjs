import {recordDecisionHistoryOutcome} from './decision-history-outcomes.mjs';
/** Project-scoped observations. This module never queries or changes an external system. */
/** Preserved measurements (curadoria of 14/11/2026): the single global ceiling of 1,200 stopped every collection once
 * reached. Measurements are no longer refused: the loaded ("hot") set is bounded per project and the rest moves, whole and
 * unchanged, to the cold archive (lib/measurement-archive.mjs), stored and indexed but not loaded on every read.
 * `hotMeasurementsPerProject`/`hotMeasurementDays`: what stays loaded beyond the pinned ones (see measurement-archive).
 * `readsPerMeasurement`: later identical reads kept on one measurement before a new one is opened. */
export const knowledgeLimits=Object.freeze({entries:120,revisions:30,sources:12,cases:40,outcomes:120,hotMeasurementsPerProject:200,hotMeasurementDays:14,readsPerMeasurement:24,staleDays:30});
/** Every Malva read of a measurement: its first fetch and the later identical ones (`reads`). */
export function measurementReads(m){return [m?.fetchedAt,...(Array.isArray(m?.reads)?m.reads.map(r=>r?.fetchedAt):[])].filter(v=>typeof v==='string');}
/** The newest read of a measurement (its first fetch or a later identical read). */
export function measurementLastRead(m){return measurementReads(m).reduce((a,b)=>Date.parse(b)>Date.parse(a)?b:a,m?.fetchedAt);}
/** True when `fetchedAt` is one of the reads behind this measurement (exact instant). */
export function measurementReadAt(m,fetchedAt){const t=Date.parse(fetchedAt);return Number.isFinite(t)&&measurementReads(m).some(v=>Date.parse(v)===t);}
const systems=new Set(['Malva MCP','Órbita MCP','Bunker']);
const statuses=new Set(['Hipótese','Corroborado','Invalidado']);
const metricNames=new Set(['spend','revenue','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','refundedOrders','refundedRevenue','impressions','linkClicks','video3s','videoPlays']);
const forbidden=new Set(['config','targetRoas','dailyCap','lossCap','testHours','cpcMax','cpmMax','icMax','cadence','paused','autoTune','autoExecute','controls','gates','targets']);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const clone=value=>JSON.parse(JSON.stringify(value));
function text(value,name,max=1600){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${name} inválido.`);return value.trim();}
function clock(value){const parsed=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(parsed))throw new Error('Instante de registro inválido.');return {time:parsed,iso:new Date(parsed).toISOString()};}
function timestamp(value,name,now){const parsed=Date.parse(value);if(typeof value!=='string'||!Number.isFinite(parsed)||!/^\d{4}-\d{2}-\d{2}T/.test(value)||parsed>now)throw new Error(`${name} inválido ou no futuro.`);return new Date(parsed).toISOString();}
function projectOf(state,id){const project=text(id,'Projeto',200);if(!own(state.config,project))throw new Error('Projeto não configurado.');return project;}
function assertObservation(input){for(const key of Object.keys(input||{}))if(forbidden.has(key))throw new Error('Aprendizados não podem alterar metas, controles ou regras fundamentais.');}
function windowOf(value,name,now){if(!value||typeof value!=='object')throw new Error(`${name} ausente.`);const from=timestamp(value.from,`${name}: início`,now),to=timestamp(value.to,`${name}: fim`,now);if(Date.parse(from)>=Date.parse(to))throw new Error(`${name}: janela inválida.`);return {from,to};}
function sourcesOf(values,now){
 if(!Array.isArray(values)||!values.length||values.length>knowledgeLimits.sources)throw new Error('Informe de 1 a 12 fontes rastreáveis.');
 const sources=values.map(value=>{
  if(!value||!systems.has(value.system))throw new Error('Sistema de origem inválido.');
  const source={system:value.system,reference:text(value.reference,'Referência',600),observedAt:timestamp(value.observedAt,'Data da evidência',now),summary:text(value.summary,'Resumo da evidência',800)};
  if(value.from!==undefined||value.to!==undefined)Object.assign(source,windowOf(value,'Fonte',now));
  return source;
 });
 const keys=new Set();for(const source of sources){const key=JSON.stringify([source.system,source.reference,source.observedAt,source.from,source.to]);if(keys.has(key))throw new Error('Fonte duplicada.');keys.add(key);}
 return sources;
}
function casesOf(values,sources,now){
 if(values===undefined)return [];
 if(!Array.isArray(values)||values.length>knowledgeLimits.cases)throw new Error('Limite de casos de suporte atingido.');
 const seen=new Set(),cases=[];
 for(const value of values){const item={objectId:text(value.objectId,'Objeto do caso',200),...windowOf(value,'Caso',now),reference:text(value.reference,'Referência do caso',600)};
  if(!sources.some(source=>source.reference===item.reference&&source.from===item.from&&source.to===item.to))throw new Error('Cada caso precisa apontar para uma fonte da mesma janela.');
  // Renaming a reference cannot turn one object/window into independent evidence.
  const key=JSON.stringify([item.objectId,item.from,item.to]);if(!seen.has(key)){seen.add(key);cases.push(item);}
 }
 return cases;
}
function independentCount(cases){
 // Different objects count independently; repeated windows of one object must not overlap.
 const accepted=[];for(const item of cases){if(!accepted.some(other=>other.objectId===item.objectId&&Date.parse(item.from)<Date.parse(other.to)&&Date.parse(other.from)<Date.parse(item.to)))accepted.push(item);}
 return accepted.length;
}
function audit(entry,now,kind='Registro',detail){return {revision:entry.revision,at:now,kind,claim:entry.claim,status:entry.status,confidence:entry.confidence,topic:entry.topic,sources:clone(entry.sources),supportCases:clone(entry.supportCases),...(detail?{detail}:{} )};}

const retainedExecutionStatuses=new Set(['Reservada','Preparada','Enviada','Verificação necessária','Confirmada']);
function measurementTargets(state){
 const targets=[];
 const add=(proposal,externalId,adAccountId,level)=>{if(typeof externalId==='string'&&own(state.config,proposal.project))targets.push({project:proposal.project,externalId,adAccountId:adAccountId||null,level:level||null,proposalId:proposal.id});};
 for(const proposal of state.proposals||[])if(proposal.status==='Aprovada'||retainedExecutionStatuses.has(proposal.execution?.status))add(proposal,proposal.payload?.objectId,proposal.payload?.adAccountId,proposal.payload?.level);
 for(const proposal of state.decisions||[])if(['Aprovada','Aplicada pelo operador'].includes(proposal.status))add(proposal,proposal.objectId,proposal.adAccountId,proposal.level);
 // Externally observed actions are measurement targets, not owner approvals.
 // Retain only campaign observations already imported from the Malva ledger.
 for(const observed of state.decisionHistory||[])if(observed.measurementOwner!=='history-learning'&&observed.sourceSystem==='Malva MCP'&&(observed.humanObserved||observed.field==='dailyBudget')&&observed.objectId&&observed.adAccountId&&Number.isFinite(Date.parse(observed.occurredAt))&&own(state.config,observed.project))targets.push({project:observed.project,externalId:observed.objectId,adAccountId:observed.adAccountId,level:'campaign',proposalId:'history:'+observed.id,historyAt:Date.parse(observed.occurredAt)});
 // Confirmed execution journals survive proposal compaction and still identify the exact target.
 for(const execution of state.executions||[])if(retainedExecutionStatuses.has(execution.status)){
  const proposal=(state.proposals||[]).find(item=>item.id===execution.proposalId&&item.project===execution.project),row=execution.preflight?.row||execution.readback?.row;
  add({project:execution.project,id:execution.proposalId},proposal?.payload?.objectId||row?.externalId,proposal?.payload?.adAccountId||row?.adAccountId,proposal?.payload?.level||execution.preflight?.level||execution.readback?.level);
 }
 return targets;
}
const measurementKey=value=>JSON.stringify([value.project,value.adAccountId,value.externalId,value.level,value.from,value.to,value.fetchedAt]);
const windowKey=value=>JSON.stringify([value.project,value.adAccountId,value.externalId,value.level,value.from,value.to]);
/**
 * Call before snapshot replacement and again before compaction. Measurements are never evicted.
 * A new read of a window whose newest preserved read has exactly the same metrics is the same evidence read again: it is
 * kept as one more entry of `reads` ({fetchedAt,lastSyncAt}) on that measurement, not as a new measurement (14/11/2026:
 * 931 of the 1,200 preserved measurements were such repeats). Different metrics, another account or another window open
 * a new measurement. Ids, keys, first fetches and metrics of existing measurements never change.
 */
export function retainKnowledgeMeasurements(state,now=new Date().toISOString()){
 const at=clock(now),targets=measurementTargets(state),prior=state.knowledgeMeasurements||[];
 if(!Array.isArray(prior))throw new Error('Arquivo de medições inválido.');
 const measurements=clone(prior),byKey=new Map(measurements.map(item=>[item.key||measurementKey(item),item]));
 // Every read already preserved (first fetches and repeats), and the newest measurement of each window. Archived
 // measurements are never of a window still present in the snapshots (lib/measurement-archive.mjs), so these suffice.
 const readKeys=new Set(),latest=new Map();
 for(const m of measurements){
  for(const t of measurementReads(m))readKeys.add(windowKey(m)+'|'+Date.parse(t));
  const w=windowKey(m),prev=latest.get(w);if(!prev||Date.parse(measurementLastRead(m))>Date.parse(measurementLastRead(prev)))latest.set(w,m);
 }
 // The one-cut-per-side rule of external actions also counts archived cuts (their index keeps [proposalId, from, to]).
 const archivedCuts=(Array.isArray(state.knowledgeMeasurementArchive?.segments)?state.knowledgeMeasurementArchive.segments:[]).flatMap(s=>Array.isArray(s?.history)?s.history.map(h=>({project:s.project,proposalId:h[0],from:h[1],to:h[2],adAccountId:h[3],externalId:h[4]})):[]);
 const indexed=new Map();for(const target of targets){const key=JSON.stringify([target.project,target.externalId]);if(!indexed.has(key))indexed.set(key,[]);indexed.get(key).push(target);}
 for(const snapshot of state.snapshots||[]){
  const from=Date.parse(snapshot.from),to=Date.parse(snapshot.to),fetchedAt=Date.parse(snapshot.fetchedAt);
  if(snapshot.source!=='Malva MCP'||snapshot.complete!==true||!own(state.config,snapshot.projectId)||![from,to,fetchedAt].every(Number.isFinite)||from>=to||to>at.time||fetchedAt>at.time||fetchedAt<to)continue;
  for(const row of snapshot.rows||[]){
   if(typeof row.externalId!=='string'||typeof row.adAccountId!=='string')continue;
   const matching=(indexed.get(JSON.stringify([snapshot.projectId,row.externalId]))||[]).filter(target=>{
    if(target.adAccountId&&target.adAccountId!==row.adAccountId||target.level&&target.level!==snapshot.level)return false;
    if(!target.historyAt)return true;
    // One closed daily cut on each side per external action. Never preserve an
    // overlapping action day or repeated hourly copies as independent evidence.
    if(to-from!==86400000||from<target.historyAt&&to>target.historyAt)return false;
    const before=to<=target.historyAt;
    const side=m=>before?Date.parse(m.to)<=target.historyAt:Date.parse(m.from)>=target.historyAt;
    return !measurements.some(m=>m.project===snapshot.projectId&&m.externalId===row.externalId&&m.adAccountId===row.adAccountId&&m.proposalIds?.includes(target.proposalId)&&side(m))
     &&!archivedCuts.some(c=>c.project===snapshot.projectId&&c.externalId===row.externalId&&c.adAccountId===row.adAccountId&&c.proposalId===target.proposalId&&side(c));
   });if(!matching.length)continue;
   const metrics={};for(const name of metricNames)if(typeof row[name]==='number'&&Number.isFinite(row[name])&&row[name]>=0)metrics[name]=row[name];if(!Object.keys(metrics).length)continue;
   const value={project:snapshot.projectId,adAccountId:row.adAccountId,externalId:row.externalId,level:snapshot.level,from:new Date(from).toISOString(),to:new Date(to).toISOString(),fetchedAt:new Date(fetchedAt).toISOString()};
   const key=measurementKey(value),proposalIds=[...new Set(matching.map(target=>target.proposalId).filter(Boolean))],existing=byKey.get(key);
   if(existing){if(JSON.stringify(existing.metrics)!==JSON.stringify(metrics))throw new Error('Medição já preservada diverge da mesma leitura; não substituir evidência.');existing.proposalIds=[...new Set([...(existing.proposalIds||[]),...proposalIds])];continue;}
   const w=windowKey(value),readKey=w+'|'+fetchedAt,newest=latest.get(w);
   // Already preserved as a repeat of an earlier measurement: the same read, nothing new to keep.
   if(readKeys.has(readKey)){const owner=measurements.find(m=>windowKey(m)===w&&measurementReadAt(m,value.fetchedAt));if(owner&&JSON.stringify(owner.metrics)!==JSON.stringify(metrics))throw new Error('Medição já preservada diverge da mesma leitura; não substituir evidência.');if(owner)owner.proposalIds=[...new Set([...(owner.proposalIds||[]),...proposalIds])];continue;}
   if(newest&&JSON.stringify(newest.metrics)===JSON.stringify(metrics)&&fetchedAt>Date.parse(measurementLastRead(newest))&&(newest.reads?.length||0)<knowledgeLimits.readsPerMeasurement&&(newest.timezone||null)===(snapshot.timezone||null)){
    newest.reads=[...(Array.isArray(newest.reads)?newest.reads:[]),{fetchedAt:value.fetchedAt,lastSyncAt:snapshot.lastSyncAt||null}];
    newest.proposalIds=[...new Set([...(newest.proposalIds||[]),...proposalIds])];readKeys.add(readKey);continue;
   }
   // No ceiling here: the storage commit moves what is not needed loaded to the cold archive (never refuses evidence).
   const measurement={id:crypto.randomUUID(),key,...value,source:'Malva MCP',complete:true,metrics,proposalIds,timezone:snapshot.timezone||null,lastSyncAt:snapshot.lastSyncAt||null,capturedAt:at.iso};
   measurement.reference=`measurement:${measurement.id}`;measurements.push(measurement);byKey.set(key,measurement);
   readKeys.add(readKey);latest.set(w,measurement);
  }
 }
 state.knowledgeMeasurements=measurements;return measurements;
}

/** Mutates state.knowledge only after all validation, and returns the saved entry. */
export function recordKnowledge(state,input,now=new Date().toISOString()){
 assertObservation(input);const at=clock(now),project=projectOf(state,input.project);
 const entries=state.knowledge||[];
 if(!Array.isArray(entries))throw new Error('Base de aprendizados inválida.');
 const existing=input.id?entries.find(entry=>entry.id===input.id):null;
 if(input.id&&!existing)throw new Error('Aprendizado não encontrado.');
 if(existing&&existing.project!==project)throw new Error('Aprendizado pertence a outro projeto.');
 if(existing&&input.expectedRevision!==existing.revision)throw new Error('CONFLICT: releia a revisão do aprendizado.');
 if(!existing&&entries.length>=knowledgeLimits.entries)throw new Error('Limite de 120 aprendizados atingido; nenhum registro foi descartado.');
 if(existing&&(existing.revisions||[]).length>=knowledgeLimits.revisions)throw new Error('Limite de revisões atingido; preserve e exporte o histórico antes de continuar.');
 const sources=sourcesOf(input.sources,at.time),supportCases=casesOf(input.supportCases,sources,at.time),status=input.status||'Hipótese';
 if(!statuses.has(status))throw new Error('Status de aprendizado inválido.');
 if(status==='Corroborado'&&independentCount(supportCases)<2)throw new Error('Corroborado exige ao menos dois casos independentes com fonte e janela.');
 if(typeof input.confidence!=='number'||!Number.isFinite(input.confidence)||input.confidence<0||input.confidence>1)throw new Error('Confiança deve estar entre 0 e 1.');
 const entry={id:existing?.id||crypto.randomUUID(),project,topic:text(input.topic,'Tema',160),claim:text(input.claim,'Observação'),status,confidence:input.confidence,sources,supportCases,createdAt:existing?.createdAt||at.iso,updatedAt:at.iso,revision:(existing?.revision||0)+1,revisions:clone(existing?.revisions||[])};
 if(existing?.agentOrigin)entry.agentOrigin=clone(existing.agentOrigin);
 entry.revisions.push({...audit(entry,at.iso),...(entry.agentOrigin?{agentOrigin:clone(entry.agentOrigin)}:{})});
 if(existing)entries[entries.indexOf(existing)]=entry;else entries.push(entry);
 state.knowledge=entries;return entry;
}

/** No controls are inferred from observations; stale items remain visible with explicit flags. */
export function readKnowledgePlan(state,projectId,now=new Date().toISOString()){
 const project=projectOf(state,projectId),at=clock(now);
 const items=(state.knowledge||[]).filter(entry=>entry.project===project).map(entry=>{
  const latest=Math.max(...(entry.sources||[]).map(source=>Date.parse(source.observedAt)).filter(Number.isFinite));
  const ageDays=Number.isFinite(latest)?Math.max(0,(at.time-latest)/86400000):null,stale=ageDays===null||ageDays>knowledgeLimits.staleDays;
  const flags=[];if(stale)flags.push('Evidência antiga: consultar fontes atuais antes de decidir.');if(entry.status==='Hipótese')flags.push('Hipótese: ainda exige confirmação independente.');if(entry.status==='Invalidado')flags.push('Invalidado: não usar como fundamento de decisão.');
  const {revisions,...summary}=clone(entry);return {...summary,ageDays:ageDays===null?null:Math.floor(ageDays),stale,flags};
 }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
 return {project,items,freshCount:items.filter(item=>!item.stale&&item.status!=='Invalidado').length,staleCount:items.filter(item=>item.stale).length,policy:'Observações por projeto. Não alteram metas, gates, orçamento ou cadência. Correlação após ajuste não demonstra causalidade.'};
}

function outcomeWindow(state,project,objectId,adAccountId,value,sources,name,now){
 const window=windowOf(value,name,now),metrics=value.metrics;
 if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||!Object.keys(metrics).length||Object.keys(metrics).length>metricNames.size)throw new Error(`${name}: métricas ausentes.`);
 for(const [key,number] of Object.entries(metrics))if(!metricNames.has(key)||typeof number!=='number'||!Number.isFinite(number)||number<0)throw new Error(`${name}: métrica inválida.`);
 const snapshots=(state.snapshots||[]).filter(snapshot=>snapshot.projectId===project&&snapshot.source==='Malva MCP'&&snapshot.complete===true&&Date.parse(snapshot.from)===Date.parse(window.from)&&Date.parse(snapshot.to)===Date.parse(window.to)&&sources.some(source=>source.system==='Malva MCP'&&Date.parse(source.observedAt)===Date.parse(snapshot.fetchedAt)&&source.from===window.from&&source.to===window.to));
 const matches=snapshots.flatMap(snapshot=>(snapshot.rows||[]).filter(row=>row.externalId===objectId&&(!adAccountId||row.adAccountId===adAccountId)).map(row=>({snapshot,row})));
 for(const measurement of [...(state.knowledgeMeasurements||[]),...(state.externalHistoryMeasurements||[])]){
  // The cited read may be the measurement's first fetch or one of its later identical reads (`reads`).
  const cited=sources.find(source=>source.system==='Malva MCP'&&measurementReadAt(measurement,source.observedAt)&&source.from===window.from&&source.to===window.to);
  if(measurement.project!==project||measurement.source!=='Malva MCP'||measurement.complete!==true||measurement.externalId!==objectId||(adAccountId&&measurement.adAccountId!==adAccountId)||Date.parse(measurement.from)!==Date.parse(window.from)||Date.parse(measurement.to)!==Date.parse(window.to)||!cited)continue;
  const read=Date.parse(cited.observedAt)===Date.parse(measurement.fetchedAt)?null:(measurement.reads||[]).find(r=>Date.parse(r?.fetchedAt)===Date.parse(cited.observedAt));
  matches.push({snapshot:read?{...measurement,fetchedAt:read.fetchedAt,lastSyncAt:read.lastSyncAt}:measurement,row:{...measurement.metrics,adAccountId:measurement.adAccountId},measurementId:measurement.id});
 }
 if(!matches.length)throw new Error(`${name}: falta leitura Malva completa e verificável do objeto/janela.`);
 if(new Set(matches.map(match=>match.row.adAccountId)).size>1)throw new Error(`${name}: informe a conta para desambiguar o objeto.`);
 const match=matches.find(({row})=>Object.entries(metrics).every(([key,value])=>typeof row[key]==='number'&&row[key]===value));
 if(!match)throw new Error(`${name}: métricas não conferem com a leitura salva.`);
 return {...window,metrics:clone(metrics),fetchedAt:match.snapshot.fetchedAt,timezone:match.snapshot.timezone||null,lastSyncAt:match.snapshot.lastSyncAt||null,adAccountId:match.row.adAccountId,...(match.measurementId?{measurementId:match.measurementId}: {})};
}
/** A measured association is append-only and never changes an approved proposal or its result. */
export function recordOutcome(state,input,now=new Date().toISOString()){
 assertObservation(input);const at=clock(now),project=projectOf(state,input.project),outcomes=state.knowledgeOutcomes||[];
 if(!Array.isArray(outcomes)||outcomes.length>=knowledgeLimits.outcomes)throw new Error('Limite de resultados atingido; nenhum resultado foi descartado.');
 const objectId=text(input.objectId,'Objeto',200),adAccountId=input.adAccountId===undefined?null:text(input.adAccountId,'Conta',200),sources=sourcesOf(input.sources,at.time);
 let proposal=null;if(input.proposalId){
  const current=(state.proposals||[]).find(item=>item.id===input.proposalId&&item.project===project),legacy=(state.decisions||[]).find(item=>item.id===input.proposalId&&item.project===project);if(!current&&!legacy)throw new Error('Proposta não encontrada neste projeto.');
  if(current){if(current.status!=='Aprovada'||current.execution?.status!=='Confirmada'||!current.execution.confirmedAt)throw new Error('Resultado de proposta exige aplicação aprovada e conferida.');const appliedAt=timestamp(current.execution.confirmedAt,'Aplicação confirmada',at.time);if(current.appliedAt&&Date.parse(current.appliedAt)!==Date.parse(appliedAt)||current.executionConfirmedAt&&Date.parse(current.executionConfirmedAt)!==Date.parse(appliedAt))throw new Error('Datas de confirmação da proposta divergem.');proposal={...current,objectId:current.payload?.objectId,adAccountId:current.payload?.adAccountId,appliedAt};}
  else{if(legacy.status!=='Aplicada pelo operador'||!legacy.appliedAt)throw new Error('Resultado de proposta exige aplicação aprovada e conferida.');timestamp(legacy.appliedAt,'Aplicação',at.time);proposal=legacy;}
  if(proposal.objectId!==objectId)throw new Error('Objeto diverge da proposta aplicada.');if(adAccountId&&proposal.adAccountId&&proposal.adAccountId!==adAccountId)throw new Error('Conta diverge da proposta aplicada.');
 }
 let historyComparison=null;
 if(input.historyOutcomeId){
  if(proposal)throw Error('Informe aplicação Bunker ou evento externo, não os dois.');
  const stored=(state.decisionHistoryOutcomes||[]).find(o=>o.id===input.historyOutcomeId&&o.project===project);
  if(!stored)throw Error('Comparação externa não encontrada neste projeto.');
  let request;try{request=JSON.parse(stored.request);}catch{throw Error('Comparação externa sem pedido preservado.');}
  historyComparison=recordDecisionHistoryOutcome({...state,decisionHistoryOutcomes:[]},{clientId:'revalidate:'+stored.id,entry:request},at.time);
  if(historyComparison.objectId!==objectId||adAccountId&&historyComparison.adAccountId!==adAccountId||historyComparison.limits.length)throw Error('Comparação externa sem aplicação ou sinais conciliados.');
 }
 const knowledge=input.knowledgeId?(state.knowledge||[]).find(entry=>entry.id===input.knowledgeId&&entry.project===project):null;if(input.knowledgeId&&!knowledge)throw new Error('Aprendizado não encontrado neste projeto.');
 const before=outcomeWindow(state,project,objectId,adAccountId,input.before,sources,'Antes',at.time),after=outcomeWindow(state,project,objectId,adAccountId,input.after,sources,'Depois',at.time);
 if(historyComparison){
  for(const [name,window] of [['before',before],['after',after]]){
   const saved=historyComparison[name];if(saved.from!==window.from||saved.to!==window.to||Object.entries(window.metrics).some(([key,value])=>saved.rows[0][key]!==value))throw Error('Métricas divergem da comparação externa.');
  }
 }
 if(Date.parse(before.to)>Date.parse(after.from))throw new Error('As janelas antes/depois não podem se sobrepor.');
 if(proposal&&(Date.parse(before.to)>Date.parse(proposal.appliedAt)||Date.parse(after.from)<Date.parse(proposal.appliedAt)))throw new Error('Janelas não delimitam a aplicação confirmada.');
 if(before.adAccountId!==after.adAccountId)throw new Error('As janelas precisam medir o mesmo objeto na mesma conta.');
 if(proposal?.adAccountId&&proposal.adAccountId!==before.adAccountId)throw new Error('Conta das medições diverge da proposta aplicada.');
 if(outcomes.some(outcome=>outcome.project===project&&outcome.objectId===objectId&&outcome.adAccountId===before.adAccountId&&outcome.before.from===before.from&&outcome.before.to===before.to&&outcome.after.from===after.from&&outcome.after.to===after.to))throw new Error('Resultado já registrado para o mesmo objeto e janelas.');
 const comparisonLimitations=['O resultado posterior, isoladamente, não demonstra efeito causal da alteração.'];
 if(Date.parse(before.to)-Date.parse(before.from)!==Date.parse(after.to)-Date.parse(after.from))comparisonLimitations.push('Janelas com durações diferentes: totais não são diretamente comparáveis.');
 const outcome={id:crypto.randomUUID(),project,objectId,adAccountId:before.adAccountId,proposalId:proposal?.id||null,proposalVersion:proposal?.version||null,executionId:proposal?.execution?.id||null,appliedAt:proposal?.appliedAt||(historyComparison?(state.decisionHistory||[]).find(e=>e.id===historyComparison.eventId)?.occurredAt:null)||null,historyOutcomeId:input.historyOutcomeId||null,knowledgeId:knowledge?.id||null,knowledgeRevision:knowledge?.revision||null,knowledgeRegisteredAt:knowledge?.updatedAt||null,before,after,sources,summary:text(input.summary,'Resumo do resultado'),causality:'Não demonstrada',comparisonLimitations,createdAt:at.iso};
 state.knowledgeOutcomes=[...outcomes,outcome];return outcome;
}
