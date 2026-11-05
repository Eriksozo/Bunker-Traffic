import {CloudError} from './cloud-malva.mjs';
import {fingerprint} from './collaboration.mjs';
import {importDecisionHistory,decisionCardLimits} from './decision-cards.mjs';
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||''),pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!=null).map(k=>[k,o[k]]));
export const historyLearningPolicy=Object.freeze({version:1,pagesPerUnit:3,itemsPerPage:100,maximumBufferedEvents:3000,maximumChanges:10000,maximumScopes:5000,providerWrites:false});
export const historyLearningKey=(project,account,object)=>JSON.stringify([project,account,object]);
const localDay=(n,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(n);
const shifted=(day,offset)=>new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const signature=record=>fingerprint({scope:record?.scope||null,pending:record?.pending||null});
function itemOf(raw,row,cut,now){
 if(!raw||typeof raw.id!=='string'||!Number.isFinite(at(raw.at))||at(raw.at)>now||String(raw.account?.provider).toLowerCase()!=='meta'||raw.account?.id!==row.adAccountId||raw.account.currency!==row.budgetCurrency)throw new CloudError('SOURCE_HISTORY_IDENTITY');
 const o=raw.object;if(!o||!['campaign','adset','ad'].includes(o.level)||(o.level==='campaign'?o.externalId!==row.externalId:o.campaign?.externalId!==row.externalId))throw new CloudError('SOURCE_HISTORY_IDENTITY');
 if(at(raw.at)>=cut)return null;
 const values=pick(raw.values,['kind','field','currency']);for(const key of ['from','to'])if(raw.values?.[key]===null||['string','number'].includes(typeof raw.values?.[key]))values[key]=raw.values[key];
 const item={...pick(raw,['id','at','source','eventType','category','automatic','metaText','rawTruncated']),actor:raw.actor?pick(raw.actor,['key','id','name','kind','type','profile']):null,account:pick(raw.account,['id','label','accountId','currency','provider']),object:{...pick(o,['level','externalId','name','objectId']),campaign:o.campaign?pick(o.campaign,['externalId','name','objectId']):null,adset:o.adset?pick(o.adset,['externalId','name','objectId']):null},values,echo:typeof raw.echo==='boolean'?raw.echo:raw.echo?pick(raw.echo,['at','actorName','app']):null};
 if(new TextEncoder().encode(JSON.stringify(item)).length>8000)throw new CloudError('SOURCE_HISTORY_LIMIT');return item;
}
function pageOf(raw,project,row,cut,now,expected){
 if(!Array.isArray(raw?.items)||raw.items.length>100||raw.timezone!==project.timezone||raw.period?.timezone!==project.timezone||(raw.nextCursor!==null&&raw.nextCursor!==undefined&&typeof raw.nextCursor!=='string'))throw new CloudError('SOURCE_HISTORY_IDENTITY');
 const period={from:raw.period.from??null,to:raw.period.to??null};if(expected&&JSON.stringify(period)!==JSON.stringify(expected))throw new CloudError('SOURCE_HISTORY_PERIOD_CHANGED');
 for(let i=1;i<raw.items.length;i++)if(at(raw.items[i].at)>at(raw.items[i-1].at))throw new CloudError('SOURCE_HISTORY_ORDER');
 return {period,items:raw.items.map(e=>itemOf(e,row,cut,now)).filter(Boolean),nextCursor:raw.nextCursor||null};
}
/** Read-only, bounded pagination. A live first page also preserves current edit context during backfill. */
export async function collectHistoryLearning(client,project,row,previous=null,{now=Date.now}={}){
 const cut=now(),request=previous?.scope?{preset:'custom',from:shifted(localDay(at(previous.scope.to),project.timezone),-1),to:localDay(cut,project.timezone)}:{anytime:true};
 const args={projectId:project.id,objectId:row.externalId,provider:['meta'],who:'all',limit:100,...request};
 const fresh=pageOf(await client.read('tracking_ad_changes',args),project,row,cut,now());
 const binding={project:project.id,adAccountId:row.adAccountId,externalId:row.externalId,timezone:project.timezone};
 if(previous?.pending&&Object.entries(binding).some(([k,v])=>previous.pending[k]!==v))throw new CloudError('SOURCE_HISTORY_IDENTITY');
 const work=previous?.pending?structuredClone(previous.pending):{...binding,request,cutAt:new Date(cut).toISOString(),period:fresh.period,items:[],nextCursor:null,pages:0,cursors:[]};
 let calls=1;
 const append=page=>{
  if(work.items.length&&page.items.length&&at(page.items[0].at)>at(work.items.at(-1).at))throw new CloudError('SOURCE_HISTORY_ORDER');
  const known=new Map(work.items.map(e=>[e.id,fingerprint(e)]));
  for(const item of page.items){const same=known.get(item.id);if(same&&same!==fingerprint(item))throw new CloudError('SOURCE_HISTORY_CONFLICT');if(!same){work.items.push(item);known.set(item.id,fingerprint(item));}}
  if(work.items.length>historyLearningPolicy.maximumBufferedEvents)throw new CloudError('SOURCE_HISTORY_LIMIT');
  work.pages++;work.nextCursor=page.nextCursor;if(page.nextCursor){if(work.cursors.includes(page.nextCursor))throw new CloudError('SOURCE_HISTORY_CURSOR');work.cursors.push(page.nextCursor);}
 };
 if(!previous?.pending)append(fresh);
 while(work.nextCursor&&calls<historyLearningPolicy.pagesPerUnit){
  const response=await client.read('tracking_ad_changes',{projectId:project.id,objectId:row.externalId,provider:['meta'],who:'all',limit:100,...work.request,cursor:work.nextCursor});calls++;
  append(pageOf(response,project,row,at(work.cutAt),now(),work.period));
 }
 const complete=!work.nextCursor,fetchedAt=new Date(now()).toISOString();
 const from=work.period.from||new Date(work.items.length?Math.min(...work.items.map(e=>at(e.at))):at(work.cutAt)-1).toISOString();
 return {...binding,inputFingerprint:signature(previous),fetchedAt,calls,research:{items:fresh.items,nextCursor:fresh.nextCursor,returnedCount:fresh.items.length,truncated:!!fresh.nextCursor},pending:complete?null:work,batch:complete?{from,to:work.cutAt,fetchedAt,events:work.items,pages:work.pages,complete:true}:null,coverage:{complete,pages:work.pages,buffered:work.items.length,lookback:work.request.anytime?'provider-anytime-up-to-400-days':'incremental',returnedItemsOnly:!!work.request.anytime}};
}
const statuses=new Set(['ACTIVE','PAUSED','PROCESSING','PENDING','IN_PROCESS','DELETED','ARCHIVED','ELIMINADO','WITH_ISSUES','DISAPPROVED','CAMPAIGN_PAUSED','ADSET_PAUSED','PENDING_REVIEW','PENDING_BILLING_INFO']);
function financial(item){
 if(item.object.level!=='campaign')return null;
 const field=item.values.field;
 if(item.category==='budget'&&['dailyBudget','daily_budget','budget'].includes(field)&&[item.values.from,item.values.to].every(v=>Number.isFinite(v)&&v>=0&&v<=1e9)&&item.values.from!==item.values.to)return item;
 if(item.category==='status'&&typeof item.values.from==='string'&&typeof item.values.to==='string'&&statuses.has(item.values.from.toUpperCase())&&statuses.has(item.values.to.toUpperCase())&&item.values.from.toUpperCase()!==item.values.to.toUpperCase())return item;
 return null;
}
function mergedIntervals(intervals,range){
 const out=[];for(const w of [...intervals,range].sort((a,b)=>at(a.from)-at(b.from))){const last=out.at(-1);if(last&&at(w.from)<=at(last.to)){if(at(w.to)>at(last.to))last.to=w.to;}else out.push({from:w.from,to:w.to});}return out;
}
/** Bunker-only mutation. An incomplete cursor never becomes complete ledger coverage. */
export function persistHistoryLearning(state,result,now=Date.now()){
 const key=historyLearningKey(result.project,result.adAccountId,result.externalId),prior=state.historyLearning?.scopes?.[key];
 if(!state.config?.[result.project]||signature(prior)!==result.inputFingerprint)return {status:'Releitura necessária'};
 const learning=structuredClone(state.historyLearning||{version:1,scopes:{},changes:[]});
 if(!prior&&Object.keys(learning.scopes).length>=historyLearningPolicy.maximumScopes)return {status:'Capacidade do histórico atingida'};
 const buffered=Object.values(learning.scopes).reduce((n,s)=>n+(s.pending?.items?.length||0),0)-(prior?.pending?.items?.length||0)+(result.pending?.items?.length||0);
 if(buffered>historyLearningPolicy.maximumBufferedEvents)return {status:'Capacidade de paginação atingida'};
 const record={project:result.project,adAccountId:result.adAccountId,externalId:result.externalId,timezone:result.timezone,scope:prior?.scope||null,intervals:prior?.intervals||[],pending:result.pending,lastCheckAt:result.fetchedAt,coverage:result.coverage,status:result.batch?'Completo no recorte consultado':'Paginação pendente'};
 let imported=0,enriched=0;
 if(result.batch){
  const batch=result.batch,candidate=structuredClone(state),financialEvents=batch.events.map(financial).filter(Boolean),before=fingerprint(state.decisionHistory||[]),known=new Set([...(state.decisionHistory||[]),...(state.decisionHistoryImports||[]).flatMap(r=>r.observations||[])].map(e=>JSON.stringify([e.eventKey,e.eventFingerprint])));
  for(let offset=0;offset<financialEvents.length;offset+=decisionCardLimits.historyPerImport){
   const receipt=importDecisionHistory(candidate,{entry:{project:result.project,from:batch.from,to:batch.to,fetchedAt:batch.fetchedAt,complete:true,pagination:{complete:true,nextCursor:null},events:financialEvents.slice(offset,offset+decisionCardLimits.historyPerImport)}},now);
   imported+=receipt.inserted;enriched+=receipt.enriched||0;
   receipt.observations=receipt.observations.filter(e=>!known.has(JSON.stringify([e.eventKey,e.eventFingerprint])));
   receipt.duplicateObservationsOmitted=receipt.received-receipt.observations.length;receipt.duplicateIdsOmitted=receipt.duplicateEventIds.length;receipt.duplicateEventIds=[];
   receipt.collection={campaign:result.externalId,adAccountId:result.adAccountId,pages:batch.pages,sourceEvents:batch.events.length,supportedEvents:financialEvents.length,selection:'campaign-daily-budget-and-status'};
  }
  const existingIds=new Set(arr(state.decisionHistory).map(e=>e.id));
  for(const event of arr(candidate.decisionHistory))if(!existingIds.has(event.id)){event.measurementOwner='history-learning';event.ingestedBy='cloudflare';}
  const changes=new Map(arr(learning.changes).map(e=>[e.key,e]));
  for(const event of batch.events){const change={key:JSON.stringify([result.project,event.id]),project:result.project,eventId:event.id,adAccountId:result.adAccountId,campaignExternalId:result.externalId,objectExternalId:event.object.externalId,level:event.object.level,category:event.category,at:event.at,source:event.source,...financial(event)?{field:event.category==='status'?'status':'dailyBudget',before:event.category==='status'?event.values.from.toUpperCase():event.values.from,after:event.category==='status'?event.values.to.toUpperCase():event.values.to}:{}};const old=changes.get(change.key);if(old&&JSON.stringify(old)!==JSON.stringify(change))throw new CloudError('SOURCE_HISTORY_CONFLICT');changes.set(change.key,change);}
  if(changes.size>historyLearningPolicy.maximumChanges)return {status:'Capacidade do histórico atingida'};
  if(fingerprint(candidate.decisionHistory||[])!==before){state.decisionHistory=candidate.decisionHistory;state.decisionHistoryImports=candidate.decisionHistoryImports;}
  learning.changes=[...changes.values()];record.scope={from:batch.from,to:batch.to,fetchedAt:batch.fetchedAt,pages:batch.pages};record.intervals=mergedIntervals(record.intervals,record.scope);record.financialEvents=financialEvents.length;record.otherEvents=batch.events.length-financialEvents.length;
 }
 learning.scopes[key]=record;state.historyLearning=learning;return {status:record.status,inserted:imported,enriched,pages:result.coverage.pages,buffered:result.coverage.buffered};
}

/** Optional archival learning must not discard a separately verified twelve-cut collection. */
export function storeHistoryCollection(state,result,now=Date.now()){
 const key=historyLearningKey(result.project,result.adAccountId,result.externalId);
 try{const saved=persistHistoryLearning(state,result,now);if(saved.status.startsWith('Capacidade'))throw new CloudError('SOURCE_HISTORY_CAPACITY');if(state.historyLearning?.failures?.[key]&&['Completo no recorte consultado','Paginação pendente'].includes(saved.status))delete state.historyLearning.failures[key];return saved;}
 catch(error){
  const prior=state.historyLearning||{version:1,scopes:{},changes:[]},failures={...prior.failures};
  if(!failures[key]&&Object.keys(failures).length>=historyLearningPolicy.maximumScopes)return {status:'Capacidade de pendências atingida'};
  const code=/^SOURCE_HISTORY_[A-Z_]+$/.test(error.code||'')?error.code:'SOURCE_HISTORY_IMPORT_FAILED';
  failures[key]={project:result.project,adAccountId:result.adAccountId,externalId:result.externalId,at:new Date(now).toISOString(),code,...(error.eventId?{eventId:error.eventId}:{}),fields:arr(error.fields).filter(k=>['eventId','project','adAccountId','nativeAccountId','objectId','name','accountName','phase','field','before','after','occurredAt','actor','source','echo','nativeEcho','automatic','currency'].includes(k))};
  state.historyLearning={...prior,failures};return {status:'Histórico requer conciliação',code,fields:failures[key].fields};
 }
}
