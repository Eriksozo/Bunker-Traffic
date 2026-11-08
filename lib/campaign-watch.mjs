import {testLaunchContext,verifiedNoSpendPeriods} from './test-launch.mjs';
import {currentLiveSnapshot} from './live-display.mjs';
import {campaignNativeDrift} from './campaign-observation.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {sum} from './analysis.mjs';
import {newCampaignStage,first24hGuard,first24hReason} from './first-24h.mjs';

const list=v=>Array.isArray(v)?v:[],time=v=>Date.parse(v||''),finite=Number.isFinite;
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
const meta=r=>r?.level==='campaign'&&String(r.provider).toLowerCase()==='meta'&&typeof r.adAccountId==='string'&&!!r.adAccountId&&typeof r.externalId==='string'&&!!r.externalId;
const periods=['7d','3d','yesterday','today'];
const compare=(a,b)=>a.priority-b.priority||(b.attention||0)-(a.attention||0)||a.projectId.localeCompare(b.projectId)||a.id.localeCompare(b.id);
export const campaignWatchLimits=Object.freeze({cacheAgeMs:300000,sourceAgeMs:900000,analysisAgeMs:3600000,signals:100});
function index(rows){const map=new Map();for(const row of list(rows).filter(meta)){const k=key(row);map.set(k,map.has(k)?null:row);}return map;}
const sameDay=(a,b)=>a?.from===b?.from&&a?.to===b?.to&&a?.timezone===b?.timezone;
const sourceOk=(s,p)=>s?.projectId===p&&s.level==='campaign'&&s.source==='Malva MCP'&&s.complete===true&&Array.isArray(s.rows);
const recent=(v,now,age)=>finite(time(v))&&time(v)<=now&&now-time(v)<=age;
const localDay=(t,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(t);}catch{return null;}};
// A first-day stage that began before local midnight already spent part of its 24h yesterday (same start as newCampaignStage).
function spansYesterday(fresh,row,at,timezone='America/Sao_Paulo'){
 if(fresh?.stage!=='first-day')return false;if(typeof fresh.spansYesterday==='boolean')return fresh.spansYesterday;
 const startsAt=time(row.startAt),created=time(row.createdAt);
 const began=fresh.basis==='delivery'?time(row.deliveryStartedAt):fresh.basis==='schedule'&&finite(startsAt)?Math.max(startsAt,finite(created)?created:-Infinity):NaN;
 const day=finite(began)&&began<=at?localDay(began,timezone):null,today=localDay(at,timezone);
 return !!day&&!!today&&day<today;
}
/** Observation priorities, never provider commands or financial recommendations.
 * All counters cover the returned active/spent/tracked cohort, not its archive.
 * Recomputing this pure view creates no messages, claims, choices or history. */
export function campaignWatchPlan(state,feed={},now=Date.now(),page={}){
 const projects=[],signals=[],due=new Set(list(feed.due).map(d=>d.project));
 const at=typeof now==='number'?now:time(now);
 for(const [projectId,config] of Object.entries(state.config||{})){
  const items=list(feed.items).filter(i=>i.projectId===projectId),item=items.length===1?items[0]:null;
  const snapshot=item?.snapshot,s=currentLiveSnapshot(item,projectId,undefined,at);
  const usable=!!s&&!item.error&&recent(s.fetchedAt,at,campaignWatchLimits.cacheAgeMs);
  const sourceFresh=usable&&recent(s.lastSyncAt,at,campaignWatchLimits.sourceAgeMs);
  const cuts=periods.map(period=>{const a=list(state.snapshots).filter(x=>sourceOk(x,projectId)&&x.period===period);return a.length===1?a[0]:null;});
  const maps=cuts.map(c=>index(c?.rows)),known=new Map();
  for(const map of maps)for(const [k,r] of map)if(r&&!known.has(k))known.set(k,r);
  const ownRows=list(s?.rows).filter(r=>r?.projectId===undefined||r.projectId===projectId),foreign=list(s?.rows).length-ownRows.length;
  const observed=index(ownRows),eligible=ownRows.filter(r=>meta(r)&&!isWarmupCampaign(r.name)),warmup=ownRows.filter(r=>meta(r)&&isWarmupCampaign(r.name)).length;
  const currentKeys=new Set(eligible.map(key));
  const missing=[...known].filter(([k,r])=>!isWarmupCampaign(r.name)&&!observed.has(k));
  const completeScope=usable&&!missing.length&&!foreign&&s.coverage?.kind==='active-spent-tracked'&&s.coverage.activeComplete===true&&s.coverage.spentComplete===true&&s.coverage.trackedComplete===true;
  const summary={projectId,projectName:config.projectName,observed:eligible.length,warmup,known: [...known.values()].filter(r=>!isWarmupCampaign(r.name)).length,withoutAnalysis:0,newCampaigns:{scheduled:0,firstDay:0,secondDay:0},missing:missing.length,needsReview:0,signalCount:0,preview:/** @type {any[]} */([]),collectedAt:snapshot?.fetchedAt||null,sourceAt:snapshot?.lastSyncAt||null,sourceFresh,scopeComplete:!!completeScope,scope:'Ativas, com gasto hoje e IDs já acompanhados; histórico inativo fora desse recorte.',eligible:!state.paused&&due.has(projectId),paused:!!state.paused};
  const add=(kind,priority,title,reason,row,extra={})=>{
   const objectId=row?.externalId||null,adAccountId=row?.adAccountId||null;
   // A stable object/reason key avoids generating a new incident per cent spent.
   signals.push({id:JSON.stringify([projectId,adAccountId,objectId,kind]),projectId,projectName:config.projectName,objectId,adAccountId,name:row?.name||config.projectName,accountName:row?.accountName||null,kind,priority,attention:row?(row.spend>0?4:0)+(row.effectiveStatus==='ACTIVE'?2:0)+(row.accountStatus?.active===false?-8:0):0,title,reason,observedAt:s?.fetchedAt||null,sourceAt:s?.lastSyncAt||null,requiresFourPeriods:true,canExecute:false,...extra});summary.signalCount++;
  };
  if(!usable)add('source',0,'Conferir a atualização',item?.error?.message||'Não há uma coleta completa e recente do dia atual. A última leitura não comprova o cenário de agora.');
  else{
   if(!sourceFresh)add('source-clock',0,'Conferir o relógio do Malva',s.lastSyncAt?'A coleta chegou, mas a sincronização da origem tem mais de 15 minutos. Desempenho novo não será interpretado como atual.':'A origem não informou quando sincronizou. A coleta recente não prova dados instantâneos.');
   if(!completeScope||missing.length)add('coverage',0,'Conciliar a cobertura',missing.length?`${missing.length} campanhas conhecidas não retornaram. Conferir IDs; ausência não significa pausa ou exclusão.`:'A leitura não declarou cobertura completa de ativas, gasto e IDs acompanhados.');
   for(const row of eligible){
    const k=key(row);if(!observed.get(k))continue;
    const windows=Object.fromEntries(periods.map((p,i)=>[p,p==='today'?row:maps[i].get(k)])),noSpendPeriods=verifiedNoSpendPeriods(cuts.slice(0,3).filter(Boolean),projectId,row,s.from);
    const launch=testLaunchContext(row,windows,{now:at,timezone:s.timezone,noSpendPeriods});
    const fresh=newCampaignStage(row,windows,{now:at,timezone:s.timezone,noSpendPeriods});
    if(fresh)summary.newCampaigns[fresh.stage==='scheduled'?'scheduled':fresh.stage==='first-day'?'firstDay':'secondDay']++;
    const before=maps[3].get(k),analysis=cuts[3],fallback=known.get(k);
    if(analysis&&time(s.fetchedAt)<time(analysis.fetchedAt))continue;
    // First 24h (any new campaign, test or not): the owner's ceiling with 0–1 IC and no sale.
    const guard=fresh&&fresh.stage!=='scheduled'?first24hGuard((fresh.stage==='second-day'||spansYesterday(fresh,row,at,s.timezone??undefined))&&windows.yesterday?sum([windows.yesterday,row]):sum([row]),config.first24h||{}):null;
    const first24h=sourceFresh&&!!guard&&['alert','pause','over'].includes(guard.level);
    if(first24h)add('first-24h',1,guard.level==='alert'?'Primeiras 24h · perto do teto':'Primeiras 24h · teto sem venda',first24hReason(fresh,guard)+' Conferir checkout, atribuição e último ajuste; proposta de pausa exige aprovação do dono.',row,{newCampaign:{...fresh,...guard}});
    if(sourceFresh&&launch.priority&&!first24h)add('new-test-risk',1,'Teste novo sem vendas','Revisar gasto e aquisição no primeiro dia; menos de 24h não retira o teste do acompanhamento. Conferir programação, checkout, atribuição e últimos ajustes antes de propor pausa.',row,{testLaunch:launch});

    if(!fallback){summary.withoutAnalysis++;summary.needsReview++;add('new',row.accountStatus?.active===false?6:row.spend>0?1:5,'Campanha sem análise','Esta campanha retornou no acompanhamento, mas não tem análise na base. Isso não comprova criação recente. Conferir aptidão da conta, criação e proteção de teste antes de sugerir.',row);continue;}
    const drift=campaignNativeDrift(before||fallback,row);
    if(drift.length){summary.needsReview++;add('edited',1,'Rever após ajuste','Status, orçamento ou moeda diferem da análise. Conferir histórico e resultado após a edição antes de repetir ajustes.',row,{changes:drift});continue;}
    const aligned=cuts.every(c=>c&&recent(c.fetchedAt,at,campaignWatchLimits.analysisAgeMs)&&c.timezone===s.timezone)&&sameDay(analysis,s)&&cuts.slice(0,3).every(c=>c.to===s.from);
    if(!aligned||!before){summary.needsReview++;add('reread',4,'Atualizar os quatro períodos','A base está vencida, incompleta ou ainda corresponde a outro dia. Acompanhamento de hoje não renova a análise.',row);continue;}
    if(!sourceFresh||time(s.fetchedAt)<=time(analysis.fetchedAt)||row.status!=='ACTIVE'||row.effectiveStatus!=='ACTIVE'||row.accountStatus?.active===false)continue;
    const after=sum([row]),prior=sum([before]),closed=maps.slice(0,3).map(m=>m.get(k)),history=closed.map(r=>r?sum([r]):null),target=config.targetRoas;
    const incident=list(state.incidents).some(i=>i.project===projectId&&!['Resolvido','Encerrado'].includes(i.status)&&(!list(i.scope?.accountIds).length||i.scope.accountIds.includes(row.adAccountId))&&(!list(i.scope?.objectIds).length||i.scope.objectIds.some(o=>o.adAccountId===row.adAccountId&&o.objectId===row.externalId)));
    // Spend in a closed window proves the campaign is not new, as in testLaunchContext and newCampaignStage.
    const started=time(row.deliveryStartedAt||row.startAt),priorSpend=closed.some(r=>r&&finite(r.spend)&&r.spend>0);
    const young=!!fresh&&fresh.stage!=='scheduled'||/TESTE/i.test(row.name)&&!priorSpend&&(!finite(started)||started>at-86400000);
    const guards={testProtected:young,incident,historyProfitable:history.slice(0,2).every(m=>m&&finite(m.result)&&m.result>0)};
    // Judge the increment: a worse known result below ROI 1 counts even when the analysis had no spend (ROI N/D) or ROI was already at its floor.
    const worse=finite(after.result)&&finite(prior.result)&&after.result<prior.result&&finite(after.roi)&&after.roi<1;
    // A new campaign already flagged by its own first-day signal (24h ceiling or new test without sales) gets one alert, not two.
    const launchFlagged=first24h||sourceFresh&&launch.priority;
    if(!launchFlagged&&(finite(after.roi)&&finite(prior.roi)&&after.roi<1&&prior.roi>=1||worse&&(!finite(prior.roi)||after.roi<=prior.roi))){
     add('loss',2,'Investigar perda de eficiência',young?'Teste com menos de 24h ou idade não confirmada: observar, sem corte precoce.':incident?'Há incidente comunicado: separar o período afetado e o resultado após a retomada.':'O retorno ou o resultado piorou desde a análise. Comparar histórico, aquisição, atribuição e última edição para avaliar contenção.',row,{guards});
    }else if(finite(target)&&target>0&&finite(after.roas)&&after.roas>=target&&finite(after.roi)&&after.roi>1&&finite(row.frontOrders)&&finite(before.frontOrders)&&row.frontOrders>before.frontOrders&&history.slice(0,2).every(m=>m&&m.roas>=target&&m.roi>1)&&!young&&!incident){
     add('opportunity',3,'Reavaliar potencial de escala','Novas compras front com retorno acima da meta, apoiadas pelas janelas de 3 e 7 dias. Conferir hierarquia, compradores e resposta à última edição antes de sugerir aumento.',row,{guards});
    }
   }
  }
  // Count ambiguity as coverage failure, never silently count duplicate IDs as covered.
  const ambiguous=[...observed.values()].filter(r=>r===null).length;
  if(ambiguous){summary.scopeComplete=false;add('ambiguous',0,'Conciliar campanhas duplicadas',`${ambiguous} identidades repetidas na fonte. Não interpretar o desempenho desses objetos.`);}
  summary.observed=currentKeys.size;summary.preview=signals.filter(s=>s.projectId===projectId).sort(compare).slice(0,8);projects.push(summary);
 }
 signals.sort(compare);
 const priorityProjects=projects.slice().sort((a,b)=>Math.min(...signals.filter(s=>s.projectId===a.projectId).map(s=>s.priority),99)-Math.min(...signals.filter(s=>s.projectId===b.projectId).map(s=>s.priority),99)||a.projectId.localeCompare(b.projectId)).map(p=>p.projectId);
 const selected=page.projectId?signals.filter(s=>s.projectId===page.projectId):signals,offset=page.offset??0,limit=page.limit??campaignWatchLimits.signals;
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>campaignWatchLimits.signals||page.projectId&&!Object.hasOwn(state.config||{},page.projectId))throw Error('Página de acompanhamento inválida.');
 const nextOffset=offset+limit<selected.length?offset+limit:null;
 return {version:1,generatedAt:new Date(at).toISOString(),paused:!!state.paused,projects,signals:selected.slice(offset,offset+limit),signalCount:selected.length,totalSignalCount:signals.length,truncated:nextOffset!==null,offset,nextOffset,priorityProjects,rule:'Sinais priorizam investigação; não são sugestões aprovadas. Preservar execuções/conferências pendentes, pausa e cadência. Só uma nova análise dos quatro períodos, hierarquia e pareceres reais pode gerar proposta. Não inferir ator, causa, entrega ou lucro futuro.'};
}
