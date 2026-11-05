/** Observational comparisons for externally observed changes, never causal proof. */
import {sum} from './analysis.mjs';
const metrics=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','impressions','linkClicks'];
const clone=x=>JSON.parse(JSON.stringify(x));
const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
function text(x,label,max=1200){if(typeof x!=='string'||!x.trim()||x.length>max)throw Error(label+' inválido.');return x.trim();}
function observation(input,event,project,now,label){
 if(!input||input.source!=='Malva MCP'||input.complete!==true||input.level!=='campaign'||input.projectId!==project)throw Error(label+': leitura completa de campanha Malva obrigatória.');
 const from=time(input.from),to=time(input.to),fetchedAt=time(input.fetchedAt),sync=input.lastSyncAt==null?fetchedAt:time(input.lastSyncAt);
 if(![from,to,fetchedAt,sync].every(Number.isFinite)||from>=to||to>fetchedAt||fetchedAt>now||sync<to||sync>now)throw Error(label+': janela não fechada ou sincronização insuficiente.');
 if(!Array.isArray(input.rows)||input.rows.length!==1)throw Error(label+': informe somente a campanha exata.');
 const row=input.rows[0];
 if(row.externalId!==event.objectId||row.adAccountId!==event.adAccountId||String(row.provider).toLowerCase()!=='meta'||row.budgetCurrency!==event.currency)throw Error(label+': campanha, conta ou moeda diverge do evento.');
 for(const k of metrics)if(typeof row[k]!=='number'||!Number.isFinite(row[k])||row[k]<0)throw Error(label+': métrica ausente ou inválida: '+k);
 for(const k of ['frontOrders','orders','checkouts','impressions','linkClicks'])if(!Number.isInteger(row[k]))throw Error(label+': contagem inválida.');
 if(input.metricsCurrency!==undefined&&!/^[A-Z]{3}$/.test(input.metricsCurrency))throw Error(label+': moeda das métricas inválida.');
 return {source:'Malva MCP',complete:true,projectId:project,level:'campaign',from:new Date(from).toISOString(),to:new Date(to).toISOString(),fetchedAt:new Date(fetchedAt).toISOString(),lastSyncAt:input.lastSyncAt??null,timezone:text(input.timezone,'Fuso',100),...(input.metricsCurrency?{metricsCurrency:input.metricsCurrency}:{}),rows:[clone(row)]};
}
function sameObject(a,b){const aa=a.nativeAccountId||a.nativeAdAccountId,bb=b.nativeAccountId||b.nativeAdAccountId;return a.objectId===b.objectId&&(aa&&bb?aa===bb:a.adAccountId===b.adAccountId);}
function providerObserved(event){return String(event.source).toLowerCase()==='meta'||!!event.nativeEcho||!!event.echoMetadata||!!event.attachedEcho||!!event.raw?.echo||!!event.originObservations?.some(x=>x.nativeEcho||String(x.source).toLowerCase()==='meta');}
function storedObservation(state,value){
 const row=value.rows[0],sameMetrics=r=>r&&metrics.every(k=>r[k]===row[k]);
 const snapshot=(state.snapshots||[]).some(s=>s.projectId===value.projectId&&s.source==='Malva MCP'&&s.complete===true&&s.level==='campaign'&&s.from===value.from&&s.to===value.to&&s.fetchedAt===value.fetchedAt&&s.timezone===value.timezone&&(!value.metricsCurrency||(s.metricsCurrency||s.currency)===value.metricsCurrency)&&s.rows?.some(r=>r.externalId===row.externalId&&r.adAccountId===row.adAccountId&&r.budgetCurrency===row.budgetCurrency&&String(r.provider).toLowerCase()==='meta'&&sameMetrics(r)));
 const retained=[...(state.knowledgeMeasurements||[]),...(state.externalHistoryMeasurements||[])].some(m=>m.project===value.projectId&&m.source==='Malva MCP'&&m.complete===true&&m.level==='campaign'&&m.externalId===row.externalId&&m.adAccountId===row.adAccountId&&m.from===value.from&&m.to===value.to&&m.fetchedAt===value.fetchedAt&&m.timezone===value.timezone&&(!value.metricsCurrency||m.metricsCurrency===value.metricsCurrency&&m.budgetCurrency===row.budgetCurrency&&String(m.provider).toLowerCase()==='meta')&&sameMetrics(m.metrics));
 if(!snapshot&&!retained)throw Error('As métricas e a janela precisam conferir com uma leitura Malva já salva ou medição preservada.');
}
export function recordDecisionHistoryOutcome(state,args,now=Date.now()){
 const at=typeof now==='number'?now:Date.parse(now),entry=args.entry,clientId=text(args.clientId,'clientId',150);
 if(!Number.isFinite(at)||!entry||typeof entry!=='object')throw Error('Comparação inválida.');
 const prior=state.decisionHistoryOutcomes||[];
 if(!Array.isArray(prior))throw Error('Arquivo de resultados inválido.');
 const digest=JSON.stringify(entry),replay=prior.find(x=>x.clientId===clientId);
 if(replay){if(replay.request!==digest)throw Error('clientId já utilizado por outra comparação.');return replay;}
 const event=(state.decisionHistory||[]).find(x=>entry.eventKey?x.eventKey===entry.eventKey:x.id===entry.eventId);
 if(!event||event.sourceSystem!=='Malva MCP')throw Error('Evento Malva observado não encontrado.');
 const project=text(entry.project,'Projeto',250);
 if(event.project!==project||!state.config?.[project])throw Error('Compare no projeto original do evento preservado.');
 const before=observation(entry.before,event,project,at,'Antes'),after=observation(entry.after,event,project,at,'Depois'),occurredAt=time(event.occurredAt);
 storedObservation(state,before);storedObservation(state,after);
 if(!Number.isFinite(occurredAt)||time(before.to)>occurredAt||time(after.from)<occurredAt||time(before.to)>time(after.from))throw Error('As janelas precisam ficar antes e depois da ação, sem sobreposição.');
 if(time(before.to)-time(before.from)!==time(after.to)-time(after.from))throw Error('Compare janelas de igual duração.');
 if(before.timezone!==after.timezone)throw Error('Use o mesmo fuso nas duas janelas.');
 if(before.metricsCurrency!==after.metricsCurrency)throw Error('Use a mesma moeda das métricas nas duas janelas.');
 const competing=(state.decisionHistory||[]).filter(x=>x.id!==event.id&&sameObject(x,event)&&time(x.occurredAt)>time(before.from)&&time(x.occurredAt)<time(after.to));
 const a=sum(before.rows),b=sum(after.rows),limits=[];
 if(!providerObserved(event))limits.push('A aplicação do evento externo ainda não possui confirmação da Meta nas fontes preservadas.');
 if(competing.length)limits.push('Há outras alterações observadas na mesma campanha entre as janelas.');
 const echoes=[event.nativeEcho,...(event.originObservations||[]).map(o=>o.nativeEcho)].filter(Boolean);
 const otherChanges=(state.historyLearning?.changes||[]).filter(c=>c.project===project&&c.adAccountId===event.adAccountId&&c.campaignExternalId===event.objectId&&c.eventId!==event.eventId&&time(c.at)>time(before.from)&&time(c.at)<time(after.to)&&!echoes.some(e=>c.source==='meta'&&c.at===e.at&&c.objectExternalId===event.objectId&&c.field===event.field&&c.before===event.before&&c.after===event.after));
 if(otherChanges.length)limits.push('O histórico completo registra outras mudanças na campanha ou em seus filhos entre as janelas.');
 if(Object.values(state.historyLearning?.scopes||{}).some(s=>s.project===project&&s.adAccountId===event.adAccountId&&s.externalId===event.objectId&&s.pending))limits.push('A releitura do histórico desta campanha ainda tem paginação pendente.');
 const incidents=(state.incidents||[]).filter(e=>{const scope=e.scope,applies=!scope||(!(scope.accountIds||[]).length&&!(scope.objectIds||[]).length)||(scope.accountIds||[]).includes(event.adAccountId)||(scope.objectIds||[]).some(o=>o.adAccountId===event.adAccountId&&o.objectId===event.objectId);const closed=e.status==='Encerrado'?time(e.updatedAt||e.reportedAt):Infinity;return e.project===project&&applies&&time(e.createdAt||e.reportedAt)<time(after.to)&&closed>time(before.from);});
 if(Object.values(state.historyLearning?.failures||{}).some(f=>f.project===project&&f.adAccountId===event.adAccountId&&f.externalId===event.objectId))limits.push('O histórico deste objeto possui divergência pendente de conciliação.');
 if(incidents.length)limits.push('Há incidente operacional no mesmo escopo entre as janelas.');
 if(!(a.spend>0&&b.spend>0)||a.roi===null||b.roi===null)limits.push('Investimento ou retorno insuficiente para comparar eficiência nas duas janelas.');
 let classification='Inconclusivo';
 if(!limits.length){if(b.roi>a.roi&&b.result>a.result&&b.frontOrders>=a.frontOrders)classification='Favorável';else if(b.roi<a.roi&&b.result<a.result)classification='Desfavorável';else limits.push('Os sinais financeiros e de aquisição não melhoraram ou pioraram de forma consistente.');}
 if(prior.length>=500)throw Error('Limite de comparações atingido. Exporte o histórico; nenhum resultado foi apagado.');
 const record={id:crypto.randomUUID(),clientId,request:digest,project,eventId:event.id,eventKey:event.eventKey,objectId:event.objectId,adAccountId:event.adAccountId,sourceSystem:'Malva MCP',before,after,beforeMetrics:a,afterMetrics:b,classification,limits,competingEventIds:competing.map(x=>x.id),otherChangeKeys:otherChanges.map(c=>c.key),incidentIds:incidents.map(i=>i.id).filter(Boolean),summary:entry.summary?text(entry.summary,'Resumo',2500):'',observedAt:new Date(at).toISOString(),causality:'Associação temporal; causalidade não demonstrada',executionByBunker:false};
 state.decisionHistoryOutcomes=[...prior,record];return record;
}
