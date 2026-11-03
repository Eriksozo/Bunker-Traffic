/** On-demand, display-only daily results. Never changes analysis or approvals. */
import {validTimeZone} from './snapshot-schema.mjs';

export const campaignDailyLimits=Object.freeze({interestMs:120000,refreshMs:60000,freshnessMs:300000,pending:20,recordBytes:80000});
const encoder=new TextEncoder(),copy=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/,UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const metrics=['spend','orders','cpa','revenueNet','profit','roas','roi'];
const messages=Object.freeze({
 DAILY_INVALID_REQUEST:'Pedido de resultado diário inválido.',
 DAILY_TARGET_UNAVAILABLE:'A campanha exata ainda não tem identidade confirmada nas fontes do Bunker.',
 DAILY_TIMEZONE_UNCONFIRMED:'O fuso deste projeto precisa ser confirmado pelas fontes do Malva.',
 DAILY_PAUSED:'O escritório está pausado. A última série foi preservada.',
 DAILY_NO_REQUEST:'Não existe pedido de resultado diário para esta campanha e janela.',
 DAILY_CONFLICT:'O resultado diário mudou. Releia a revisão antes de gravar.',
 DAILY_STALE_SNAPSHOT:'A série recebida venceu ou existe uma leitura mais recente.',
 DAILY_INVALID_SNAPSHOT:'A identidade, o período ou os valores da série diária não conferem.',
 DAILY_CACHE_INVALID:'O cache diário está inconsistente e precisa de conferência.',
 DAILY_LIMIT:'O resultado diário excede o limite de armazenamento. Nenhum dado foi descartado.',
 DAILY_READ_FAILED:'Não foi possível ler os resultados diários.',
 MALVA_UNAVAILABLE:'Não foi possível consultar o resultado diário no Malva.',
 SOURCE_IDENTITY:'A identidade da campanha ou do projeto não foi confirmada na origem.',
 SOURCE_INVALID:'A origem retornou um resultado diário incompatível.',
 SOURCE_INCOMPLETE:'A origem não confirmou a cobertura do período solicitado.',
 SOURCE_STALE:'A leitura da origem venceu ou o dia mudou durante a consulta.',
 SOURCE_LIMIT:'A resposta da origem excede o limite da consulta diária.',
 MCP_UNAVAILABLE:'A conexão de leitura do Malva não está disponível.',
 MCP_TIMEOUT:'A consulta ao resultado diário excedeu o tempo de espera.',
});
const failureCodes=new Set(['MALVA_UNAVAILABLE','SOURCE_IDENTITY','SOURCE_INVALID','SOURCE_INCOMPLETE','SOURCE_STALE','SOURCE_LIMIT','MCP_UNAVAILABLE','MCP_TIMEOUT']);
function fail(code){const error=new Error(messages[code]||messages.DAILY_INVALID_REQUEST);error.code=code;throw error;}
const label=value=>typeof value==='string'&&!!value.trim()&&value.length<=2500;
const instant=value=>typeof value==='string'&&UTC.test(value)&&Number.isFinite(Date.parse(value));
function clock(value){const time=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(time))fail('DAILY_INVALID_REQUEST');return {time,iso:new Date(time).toISOString()};}
function bounded(value){if(encoder.encode(JSON.stringify(value)).byteLength>campaignDailyLimits.recordBytes)fail('DAILY_LIMIT');}
function inputOf(input){
 if(!object(input)||!['read','request','pending','import','failure'].includes(input.action))fail('DAILY_INVALID_REQUEST');
 const fields={pending:['action'],read:['action','projectId','adAccountId','objectId'],request:['action','projectId','adAccountId','objectId'],import:['action','projectId','adAccountId','objectId','expectedRevision','snapshot'],failure:['action','projectId','adAccountId','objectId','expectedRevision','error']}[input.action];
 if(Object.keys(input).some(key=>!fields.includes(key)))fail('DAILY_INVALID_REQUEST');
 if(input.action!=='pending'&&![input.projectId,input.adAccountId,input.objectId].every(label))fail('DAILY_INVALID_REQUEST');
 if(['import','failure'].includes(input.action)&&(!Number.isInteger(input.expectedRevision)||input.expectedRevision<1))fail('DAILY_INVALID_REQUEST');
 bounded(input);return input;
}
export function parseDailyDataEnvelope(args){
 if(!object(args)||args.id!=='daily-data'||args.status!=='Pendente'||args.revision!==0||typeof args.note!=='string'||Object.keys(args).some(key=>!['id','status','revision','note'].includes(key)))fail('DAILY_INVALID_REQUEST');
 if(encoder.encode(args.note).byteLength>campaignDailyLimits.recordBytes)fail('DAILY_LIMIT');
 let input;try{input=JSON.parse(args.note);}catch{fail('DAILY_INVALID_REQUEST');}return inputOf(input);
}
function dayAt(time,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));}
function addDays(day,amount){return new Date(Date.parse(day+'T12:00:00Z')+amount*86400000).toISOString().slice(0,10);}
function validDay(day){return typeof day==='string'&&DAY.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;}
function daysOf(range){if(!validDay(range?.from)||!validDay(range?.to)||addDays(range.from,6)!==range.to)fail('DAILY_INVALID_SNAPSHOT');return Array.from({length:7},(_,i)=>addDays(range.from,i));}
function rangeAt(time,timezone){const to=dayAt(time,timezone);return {from:addDays(to,-6),to};}
/** Earliest instant on a local day; also handles 23/25-hour DST days. */
function dayStart(day,timezone){
 let low=Date.parse(day+'T00:00:00Z')-36*3600000,high=low+72*3600000;
 while(high-low>1){const middle=Math.floor((low+high)/2);if(dayAt(middle,timezone)<day)low=middle;else high=middle;}
 if(dayAt(high,timezone)!==day)fail('DAILY_INVALID_SNAPSHOT');return high;
}
function targetOf(state,input){
 const config=state?.config;if(!object(config)||!own(config,input.projectId)||!label(config[input.projectId]?.projectName))fail('DAILY_TARGET_UNAVAILABLE');
 const snapshots=(Array.isArray(state.snapshots)?state.snapshots:[]).filter(s=>s?.projectId===input.projectId&&s.source==='Malva MCP'&&s.complete===true&&s.level==='campaign'&&['7d','3d','yesterday','today'].includes(s.period)&&instant(s.fetchedAt)&&Array.isArray(s.rows));
 const zones=new Set(snapshots.map(s=>s.timezone));if(zones.size!==1||!validTimeZone([...zones][0]))fail('DAILY_TIMEZONE_UNCONFIRMED');
 const matches=[];
 for(const s of snapshots){
  const rows=s.rows.filter(row=>row?.adAccountId===input.adAccountId&&row.externalId===input.objectId&&row.level==='campaign'&&String(row.provider||'').toLowerCase()==='meta'&&(row.projectId===undefined||row.projectId===input.projectId));
  if(rows.length>1)fail('DAILY_TARGET_UNAVAILABLE');if(rows.length)matches.push({row:rows[0],at:Date.parse(s.fetchedAt)});
 }
 matches.sort((a,b)=>b.at-a.at);const latest=matches[0];
 if(!latest||!UUID.test(latest.row.id||'')||matches.some(m=>m.at===latest.at&&m.row.id!==latest.row.id))fail('DAILY_TARGET_UNAVAILABLE');
 return {projectId:input.projectId,projectName:config[input.projectId].projectName,adAccountId:input.adAccountId,objectId:input.objectId,internalObjectId:latest.row.id,timezone:[...zones][0]};
}
function keyOf(target,range){return 'daily:'+JSON.stringify([target.projectId,target.adAccountId,target.objectId,target.internalObjectId,range.from,range.to,target.timezone]);}
function sameTarget(a,b){return ['projectId','projectName','adAccountId','objectId','internalObjectId','timezone'].every(key=>a?.[key]===b?.[key]);}
function sameRange(a,b){return a?.from===b?.from&&a?.to===b?.to;}
function empty(target,range){return {target,range,snapshot:null,error:null,requestedAt:null,interestUntil:null,nextDueAt:null,lastAttemptAt:null,lastSuccessAt:null,revision:0};}
function numeric(value,key){
 if(value===null||value===undefined)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12||['spend','orders','cpa'].includes(key)&&value<0||key==='orders'&&!Number.isInteger(value))fail('DAILY_INVALID_SNAPSHOT');
 return value;
}
function normalizedRows(daily,range){
 if(!Array.isArray(daily)||daily.length>7)fail('DAILY_INVALID_SNAPSHOT');const days=daysOf(range),rows=new Map();
 for(const input of daily){if(!object(input)||!days.includes(input.day)||rows.has(input.day))fail('DAILY_INVALID_SNAPSHOT');rows.set(input.day,{day:input.day,...Object.fromEntries(metrics.map(key=>[key,numeric(input[key],key)]))});}
 // A missing source day remains explicitly unknown, never an invented zero.
 return days.map(day=>rows.get(day)||{day,...Object.fromEntries(metrics.map(key=>[key,null]))});
}
function snapshotOf(input,target,range,now){
 if(!object(input)||input.source!=='Malva MCP'||!instant(input.fetchedAt))fail('DAILY_INVALID_SNAPSHOT');
 const fetched=Date.parse(input.fetchedAt);if(fetched>now)fail('DAILY_INVALID_SNAPSHOT');if(now-fetched>campaignDailyLimits.freshnessMs)fail('DAILY_STALE_SNAPSHOT');
 const detail=input.detail,row=detail?.row;
 if(!object(detail)||!object(row)||row.id!==target.internalObjectId||row.projectId!==target.projectId||row.adAccountId!==target.adAccountId||row.externalId!==target.objectId||row.level!=='campaign'||String(row.provider||'').toLowerCase()!=='meta'||String(detail.provider||'').toLowerCase()!=='meta'||detail.level!=='campaign'||detail.externalId!==target.objectId)fail('DAILY_INVALID_SNAPSHOT');
 if(!sameRange(detail.dailyRange,range)||!sameRange(rangeAt(fetched,target.timezone),range))fail('DAILY_INVALID_SNAPSHOT');
 const period=detail.period,days=daysOf(range);
 if(!object(period)||period.timezone!==target.timezone||!instant(period.from)||!instant(period.to)||Date.parse(period.from)!==dayStart(range.from,target.timezone)||Date.parse(period.to)!==dayStart(addDays(range.to,1),target.timezone))fail('DAILY_INVALID_SNAPSHOT');
 if(period.days!==undefined&&(!Array.isArray(period.days)||period.days.length!==7||period.days.some((day,i)=>day!==days[i])))fail('DAILY_INVALID_SNAPSHOT');
 const currency=detail.currency??null;if(currency!==null&&(typeof currency!=='string'||!currency.match(/^[A-Z]{3}$/)))fail('DAILY_INVALID_SNAPSHOT');
 const normalized={source:'Malva MCP',fetchedAt:new Date(fetched).toISOString(),lastSyncAt:null,timezone:target.timezone,currency,from:range.from,to:range.to,rows:normalizedRows(detail.daily,range)};
 bounded(normalized);return normalized;
}
function validateStoredSnapshot(s,target,range){
 if(!object(s)||s.source!=='Malva MCP'||!instant(s.fetchedAt)||s.lastSyncAt!==null||s.timezone!==target.timezone||!sameRange(s,range)||s.currency!==null&&!/^[A-Z]{3}$/.test(s.currency)||!Array.isArray(s.rows)||s.rows.length!==7)fail('DAILY_CACHE_INVALID');
 const normalized={source:s.source,fetchedAt:s.fetchedAt,lastSyncAt:null,timezone:s.timezone,currency:s.currency,from:s.from,to:s.to,rows:normalizedRows(s.rows,range)};
 if(JSON.stringify(s)!==JSON.stringify(normalized))fail('DAILY_CACHE_INVALID');return normalized;
}
function decode(row,target,range){
 if(!row)return empty(target,range);let item;
 try{
  item=JSON.parse(row.payload);if(!object(item)||!sameTarget(item.target,target)||!sameRange(item.range,range)||!Number.isInteger(row.revision)||row.revision<1)fail('DAILY_CACHE_INVALID');
  for(const key of ['requestedAt','interestUntil','nextDueAt','lastAttemptAt','lastSuccessAt'])if(item[key]!==null&&!instant(item[key]))fail('DAILY_CACHE_INVALID');
  if(item.snapshot!==null)validateStoredSnapshot(item.snapshot,target,range);
  if(item.error!==null&&(!object(item.error)||!failureCodes.has(item.error.code)||item.error.message!==messages[item.error.code]||!instant(item.error.at)))fail('DAILY_CACHE_INVALID');
  if(Object.keys(item).some(k=>!['target','range','snapshot','error','requestedAt','interestUntil','nextDueAt','lastAttemptAt','lastSuccessAt'].includes(k)))fail('DAILY_CACHE_INVALID');
 }catch(error){if(error?.code==='DAILY_LIMIT')throw error;fail('DAILY_CACHE_INVALID');}
 return {...item,revision:row.revision};
}
async function load(db,target,range){return decode(await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key=?').bind(keyOf(target,range)).first(),target,range);}
async function save(db,item,expected,at){
 const record=copy(item);delete record.revision;const payload=JSON.stringify(record);bounded(record);const key=keyOf(item.target,item.range);
 const query=expected===0?db.prepare('INSERT OR IGNORE INTO bunker_records (key,payload,revision,updated_at) VALUES (?,?,?,?)').bind(key,payload,1,at):db.prepare('UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?').bind(payload,expected+1,at,key,expected);
 const result=await query.run();if(!result.meta?.changes)fail('DAILY_CONFLICT');return {...record,revision:expected+1};
}
function view(item,paused,now){
 const active=Date.parse(item.interestUntil||'')>now,stale=!!item.snapshot&&(now-Date.parse(item.snapshot.fetchedAt)>campaignDailyLimits.freshnessMs||!sameRange(rangeAt(now,item.target.timezone),item.range));
 return {...copy(item),status:paused?'paused':item.error?'error':!item.snapshot?active?'pending':'idle':stale?'stale':'ready',stale,refreshPending:!paused&&active&&Date.parse(item.nextDueAt||'')<=now};
}
async function pending(db,state,at){
 if(state.paused===true)return {paused:true,items:[]};
 // Bounded output and prefix-scoped SQL; records never choose arbitrary tools.
 const query="SELECT key,payload,revision,updated_at FROM bunker_records WHERE key LIKE 'daily:%' AND json_valid(payload) AND json_extract(payload,'$.interestUntil')>? AND json_extract(payload,'$.nextDueAt')<=? ORDER BY json_extract(payload,'$.nextDueAt'),key LIMIT ?";
 const result=await db.prepare(query).bind(at.iso,at.iso,campaignDailyLimits.pending).all();if(result.success===false||!Array.isArray(result.results))fail('DAILY_READ_FAILED');
 const items=[];
 for(const row of result.results){
  try{const raw=JSON.parse(row.payload),target=targetOf(state,raw.target),range=rangeAt(at.time,target.timezone);if(row.key!==keyOf(target,range))continue;const item=decode(row,target,range);if(Date.parse(item.interestUntil)>at.time&&Date.parse(item.nextDueAt)<=at.time)items.push(view(item,false,at.time));}catch{ /* Unconfigured, stale-day or corrupt records cannot dispatch source reads. */ }
 }
 return {paused:false,items};
}
export async function dailyDataAction(db,state,input,now=Date.now()){
 inputOf(input);const at=clock(now);if(input.action==='pending')return pending(db,state,at);
 const target=targetOf(state,input),range=rangeAt(at.time,target.timezone),current=await load(db,target,range),paused=state.paused===true;
 if(input.action==='read')return {paused,item:view(current,paused,at.time)};
 if(paused)fail('DAILY_PAUSED');
 if(input.action==='request'){
  // Repeated opens/polls share one request and do not invalidate an in-flight
  // CAS every few seconds. Renew interest only in its final minute.
  let observed=current;
  for(let attempt=0;attempt<2;attempt++){
   if(Date.parse(observed.interestUntil||'')>=at.time+campaignDailyLimits.refreshMs)return {paused:false,unchanged:true,item:view(observed,false,at.time),revision:observed.revision};
   try{const item=await save(db,{...observed,requestedAt:observed.requestedAt||at.iso,interestUntil:new Date(at.time+campaignDailyLimits.interestMs).toISOString(),nextDueAt:observed.nextDueAt||at.iso},observed.revision,at.iso);return {ok:true,paused:false,item:view(item,false,at.time),revision:item.revision};}
   catch(error){if(error?.code!=='DAILY_CONFLICT'||attempt)throw error;observed=await load(db,target,range);}
  }
 }
 if(!current.revision)fail('DAILY_NO_REQUEST');
 if(input.action==='import'){
  const snapshot=snapshotOf(input.snapshot,target,range,at.time),prior=Date.parse(current.snapshot?.fetchedAt||''),fetched=Date.parse(snapshot.fetchedAt);
  if(fetched<Date.parse(current.requestedAt))fail('DAILY_STALE_SNAPSHOT');
  if(Number.isFinite(prior)&&fetched<=prior){if(fetched===prior&&JSON.stringify(snapshot)===JSON.stringify(current.snapshot))return {ok:true,paused:false,unchanged:true,item:view(current,false,at.time),revision:current.revision};fail(fetched<prior?'DAILY_STALE_SNAPSHOT':'DAILY_CONFLICT');}
  if(input.expectedRevision!==current.revision)fail('DAILY_CONFLICT');
  const item=await save(db,{...current,snapshot,error:null,lastAttemptAt:at.iso,lastSuccessAt:at.iso,nextDueAt:new Date(at.time+campaignDailyLimits.refreshMs).toISOString()},current.revision,at.iso);
  return {ok:true,paused:false,item:view(item,false,at.time),revision:item.revision};
 }
 if(input.expectedRevision!==current.revision)fail('DAILY_CONFLICT');
 if(!object(input.error)||!failureCodes.has(input.error.code))fail('DAILY_INVALID_REQUEST');
 const error={code:input.error.code,message:messages[input.error.code],at:at.iso};
 const item=await save(db,{...current,error,lastAttemptAt:at.iso,nextDueAt:new Date(at.time+campaignDailyLimits.refreshMs).toISOString()},current.revision,at.iso);
 return {ok:true,paused:false,item:view(item,false,at.time),revision:item.revision};
}
