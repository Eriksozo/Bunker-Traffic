/** On-demand, read-only campaign-day relay. Reuses the existing MCP client. */
import {validTimeZone} from '../lib/snapshot-schema.mjs';
import {withDailyRatios} from '../lib/campaign-daily-data.mjs';

export const BUNKER_DAILY_TOOL='bunker_otimiza_o_de_campanhas.bunker_dados_diarios';
export const DAILY_CHECK_INTERVAL_MS=10_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const METRICS=['spend','orders','cpa','revenueNet','profit','roas','roi','impressions','linkClicks','checkouts'];
// Counts: never negative, always whole. IC (checkouts) is not in the detail's day series; the caller may pass it per day.
const COUNTS=['orders','impressions','linkClicks','checkouts'];
const MESSAGES=Object.freeze({
  MALVA_UNAVAILABLE:'Não foi possível consultar o resultado por dia no Malva.',
  SOURCE_IDENTITY:'A identidade da campanha, conta ou projeto não confere.',
  SOURCE_INVALID:'A origem retornou dados diários incompatíveis.',
  SOURCE_INCOMPLETE:'A origem não retornou os sete dias completos do recorte solicitado.',
  SOURCE_STALE:'O dia ou a solicitação mudou durante a consulta.',
  SOURCE_LIMIT:'A consulta diária excedeu os limites permitidos.',
  MCP_UNAVAILABLE:'A conexão da consulta diária não está disponível.',
  MCP_TIMEOUT:'A consulta diária excedeu o tempo de espera.',
});
export class DailySyncError extends Error{constructor(code){super(MESSAGES[code]||MESSAGES.MCP_UNAVAILABLE);this.code=Object.hasOwn(MESSAGES,code)?code:'MCP_UNAVAILABLE';}}
const fail=code=>{throw new DailySyncError(code);};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const instant=value=>typeof value==='string'&&UTC.test(value)&&Number.isFinite(Date.parse(value));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const same=(a,b)=>canonical(a)===canonical(b);
const key=target=>JSON.stringify([target.projectId,target.adAccountId,target.objectId]);
export function dailyPublicError(error){const code=Object.hasOwn(MESSAGES,error?.code)?error.code:'MALVA_UNAVAILABLE';return {code,message:MESSAGES[code]};}
function day(value){return typeof value==='string'&&DATE.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function shifted(value,days){return new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
function localParts(value,timezone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));}
function localDay(now,timezone){const p=localParts(now,timezone);return `${p.year}-${p.month}-${p.day}`;}
function midnight(value,timezone){
  const base=Date.parse(value+'T00:00:00Z');let time=base;
  for(let n=0;n<5;n++){const p=localParts(time,timezone),asUTC=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second),next=base-(asUTC-time);if(next===time)break;time=next;}
  const p=localParts(time,timezone);if(`${p.year}-${p.month}-${p.day}`!==value||p.hour!=='00'||p.minute!=='00'||p.second!=='00')fail('SOURCE_INVALID');
  return new Date(time).toISOString();
}
export function dailyRange(now,timezone){
  if(!validTimeZone(timezone)||!Number.isFinite(now))fail('SOURCE_INVALID');
  const to=localDay(now,timezone),from=shifted(to,-6),days=Array.from({length:7},(_,i)=>shifted(from,i));
  return {from,to,days,start:midnight(from,timezone),end:midnight(shifted(to,1),timezone)};
}
function validateItem(item,now){
  const t=item?.target,r=item?.range;
  if(!object(t)||![t.projectId,t.adAccountId,t.internalObjectId].every(id=>typeof id==='string'&&UUID.test(id))||typeof t.objectId!=='string'||!t.objectId.trim()||t.objectId.length>200||typeof t.projectName!=='string'||!t.projectName.trim()||!validTimeZone(t.timezone)||!object(r)||!day(r.from)||!day(r.to)||!Number.isInteger(item.revision)||item.revision<0)fail('SOURCE_INVALID');
  const expected=dailyRange(now,t.timezone);
  if(r.from!==expected.from||r.to!==expected.to)fail('SOURCE_STALE');
  if(!instant(item.interestUntil)||Date.parse(item.interestUntil)<=now||!instant(item.nextDueAt)||Date.parse(item.nextDueAt)>now)fail('SOURCE_STALE');
  return item;
}
export function validateDailyPending(value,siteId,now){
  if(!object(value)||value.siteProjectId!==siteId||typeof value.paused!=='boolean'||!Array.isArray(value.items))fail('SOURCE_IDENTITY');
  if(value.items.length>20)fail('SOURCE_LIMIT');
  if(value.paused){if(value.items.length)fail('SOURCE_INVALID');return value;}
  const seen=new Set();for(const item of value.items){validateItem(item,now);const id=key(item.target);if(seen.has(id))fail('SOURCE_INVALID');seen.add(id);}
  return value;
}
function sourceProjects(who,listed,workspaceId){
  if(who?.workspace?.id!==workspaceId||!Array.isArray(listed?.items))fail('SOURCE_IDENTITY');
  const projects=new Map();for(const p of listed.items){if(!UUID.test(p?.id)||projects.has(p.id)||typeof p.name!=='string'||!p.name.trim()||!validTimeZone(p.timezone)||!/^[A-Z]{3}$/.test(p.currency||''))fail('SOURCE_IDENTITY');projects.set(p.id,p);}
  return projects;
}
function projectFor(item,projects){const project=projects.get(item.target.projectId);if(!project||project.archivedAt||project.name!==item.target.projectName||project.timezone!==item.target.timezone)fail('SOURCE_IDENTITY');return project;}
/** Projection excludes assets, transcript, pixels, hourly data and native budgets. */
export function dailySnapshot(detail,item,project,now,{checkouts=null}={}){
  validateItem(item,now);const t=item.target,r=dailyRange(now,t.timezone),row=detail?.row;
  if(!object(detail)||detail.provider!=='meta'||detail.level!=='campaign'||detail.externalId!==t.objectId||!object(row)||row.id!==t.internalObjectId||row.projectId!==t.projectId||row.adAccountId!==t.adAccountId||row.externalId!==t.objectId||row.provider!=='meta'||row.level!=='campaign'||row.projectName!==undefined&&row.projectName!==t.projectName)fail('SOURCE_IDENTITY');
  const currency=detail.currency??null;
  if(currency!==null&&currency!==project.currency||detail.period?.timezone!==t.timezone||detail.period?.preset!=='custom'||detail.period?.from!==r.start||detail.period?.to!==r.end||!same(detail.period?.days,r.days)||detail.dailyRange?.from!==r.from||detail.dailyRange?.to!==r.to||detail.dailyRange?.extended!==false)fail('SOURCE_INVALID');
  if(!Array.isArray(detail.daily)||detail.daily.length>7)fail('SOURCE_INCOMPLETE');
  const rows=new Map();for(const entry of detail.daily){
    if(!object(entry)||!r.days.includes(entry.day)||rows.has(entry.day))fail('SOURCE_INCOMPLETE');
    const values={day:entry.day};for(const field of METRICS){const value=(field==='checkouts'&&checkouts?checkouts.get(entry.day):entry[field])??null;if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))fail('SOURCE_INVALID');if(['spend','cpa',...COUNTS].includes(field)&&value!==null&&value<0||COUNTS.includes(field)&&value!==null&&!Number.isInteger(value))fail('SOURCE_INVALID');values[field]=value;}
    rows.set(entry.day,values);
  }
  // A day absent from the response is unknown, never an observed zero day.
  const days=r.days.map(value=>rows.get(value)||{day:value,...Object.fromEntries(METRICS.map(field=>[field,null]))});
  const projected={row:Object.fromEntries(['id','projectId','level','externalId','adAccountId','provider'].map(field=>[field,row[field]])),provider:'meta',level:'campaign',externalId:t.objectId,daily:days,dailyRange:{from:r.from,to:r.to,extended:false},period:{preset:'custom',timezone:t.timezone,from:r.start,to:r.end,days:r.days},currency};
  return {snapshot:{source:'Malva MCP',fetchedAt:new Date(now).toISOString(),detail:projected},expected:{source:'Malva MCP',fetchedAt:new Date(now).toISOString(),lastSyncAt:null,timezone:t.timezone,currency,from:r.from,to:r.to,rows:days.map(withDailyRatios)}};
}
function samePending(a,b){return !!b&&a.revision===b.revision&&same(a.target,b.target)&&same(a.range,b.range);}
function itemRead(value,item,siteId){if(!object(value)||value.siteProjectId!==siteId||typeof value.paused!=='boolean')fail('MCP_UNAVAILABLE');if(value.item&&!same(value.item.target,item.target))fail('SOURCE_IDENTITY');return value;}
export class DailyRelay{
  constructor({client,workspaceId,siteId,now=Date.now,log=()=>{}}){this.client=client;this.workspaceId=workspaceId;this.siteId=siteId;this.now=now;this.log=log;this.running=false;}
  async pending(){return validateDailyPending(await this.client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action:'pending'}),this.siteId,this.now());}
  async read(item){const t=item.target;return itemRead(await this.client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action:'read',projectId:t.projectId,adAccountId:t.adAccountId,objectId:t.objectId}),item,this.siteId);}
  async current(item){const pending=await this.pending();return {paused:pending.paused,item:pending.items.find(candidate=>key(candidate.target)===key(item.target))};}
  async recordFailure(item,error){const current=await this.current(item);if(current.paused||!samePending(item,current.item))return;const t=item.target;await this.client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action:'failure',projectId:t.projectId,adAccountId:t.adAccountId,objectId:t.objectId,expectedRevision:item.revision,error:dailyPublicError(error)});}
  async runOnce(){
    if(this.running)fail('MCP_UNAVAILABLE');this.running=true;
    try{
      await this.client.ensureReady({source:false});const queued=await this.pending();
      if(queued.paused||!queued.items.length)return {paused:queued.paused,imported:0,failed:0};
      let projects;
      try{await this.client.ensureReady({source:true});const who=await this.client.callTool('malva','workspace_whoami',{}),listed=await this.client.callTool('malva','tracking_list_projects',{});projects=sourceProjects(who,listed,this.workspaceId);}catch(error){for(const item of queued.items){try{await this.recordFailure(item,error);}catch{}}throw error;}
      let imported=0,failed=0;
      for(const item of queued.items){
        const current=await this.current(item);if(current.paused)return {paused:true,imported,failed};if(!samePending(item,current.item))continue;
        let payload;
        try{
          const project=projectFor(item,projects),raw=await this.client.callTool('malva','tracking_ad_detail',{projectId:item.target.projectId,objectId:item.target.internalObjectId,sales:'traffic',preset:'custom',from:item.range.from,to:item.range.to});
          payload=dailySnapshot(raw,item,project,this.now());
        }catch(error){failed++;this.log({event:'daily_source_failed',projectId:item.target.projectId,objectId:item.target.objectId,code:dailyPublicError(error).code});try{await this.recordFailure(item,error);}catch{}continue;}
        const latest=await this.current(item);if(latest.paused)return {paused:true,imported,failed};if(!samePending(item,latest.item))continue;
        const t=item.target;
        try{
          const result=await this.client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action:'import',projectId:t.projectId,adAccountId:t.adAccountId,objectId:t.objectId,expectedRevision:item.revision,snapshot:payload.snapshot});
          if(result?.siteProjectId!==this.siteId||result?.ok!==true||!Number.isInteger(result.revision)||result.revision<=item.revision||!same(result.item?.target,t))fail('MCP_UNAVAILABLE');
          const observed=await this.read(item);
          if(!observed.item||observed.item.revision<result.revision||!same(observed.item.snapshot,payload.expected))fail('MCP_UNAVAILABLE');
          imported++;this.log({event:'daily_synced',projectId:t.projectId,objectId:t.objectId,revision:observed.item.revision,fetchedAt:payload.snapshot.fetchedAt});
        }catch(error){failed++;this.log({event:'daily_write_unconfirmed',projectId:t.projectId,objectId:t.objectId,code:dailyPublicError(error).code});/* Never resend an ambiguous import or replace it with failure. */}
      }
      return {paused:false,imported,failed};
    }finally{this.running=false;}
  }
}

/** Sequential checks during the existing live wait; never starts another client. */
export async function waitWithDaily(milliseconds,{runDaily,signal,wait,clock=()=>performance.now()}={}){
  const until=clock()+Math.max(0,milliseconds);
  while(!signal?.aborted&&clock()<until){await wait(Math.min(DAILY_CHECK_INTERVAL_MS,until-clock()),undefined,{signal});if(signal?.aborted)return;if(clock()<until)await runDaily();}
}
