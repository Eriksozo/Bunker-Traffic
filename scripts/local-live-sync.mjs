#!/usr/bin/env node
/** Deterministic, display-only Malva -> Bunker relay. No turns, models or source writes. */
import {spawn} from 'node:child_process';
import {open, readFile, unlink, mkdir, link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {bundleSchema, validTimeZone} from '../lib/snapshot-schema.mjs';
import {BUNKER_DAILY_TOOL,DAILY_CHECK_INTERVAL_MS,DailyRelay,dailyPublicError,waitWithDaily} from './local-daily-sync.mjs';

export const MALVA_TOOLS=Object.freeze(['workspace_whoami','tracking_list_projects','tracking_campaigns','tracking_ad_accounts','tracking_ad_detail']);
export const BUNKER_TOOL='bunker_otimiza_o_de_campanhas.bunker_dados_atuais';
export const BUNKER_COMPAT_TOOL='bunker_otimiza_o_de_campanhas.bunker_atualizar_rodada';
export const POLL_INTERVAL_MS=60_000;
const MAX_ROWS=3000, MAX_BYTES=1_450_000, MAX_SOURCE_CALLS=500, MAX_MESSAGE_BYTES=20_000_000;
const UTC_INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES=Object.freeze({
  MALVA_UNAVAILABLE:'Não foi possível consultar a origem Malva.',
  SOURCE_IDENTITY:'A identidade do espaço ou projeto não confere com a configuração.',
  SOURCE_INVALID:'A origem retornou dados incompatíveis com o contrato de leitura.',
  SOURCE_INCOMPLETE:'A leitura não cobriu todas as campanhas; o cache anterior foi preservado.',
  SOURCE_STALE:'A leitura da origem venceu ou o dia mudou durante a coleta.',
  SOURCE_LIMIT:'A leitura excede o limite; nenhuma campanha foi descartada.',
  BUNKER_UNAVAILABLE:'Não foi possível consultar o Bunker.',
  BUNKER_IDENTITY:'A conexão Bunker não corresponde ao site esperado.',
  BUNKER_WRITE_UNCONFIRMED:'O resultado da gravação do cache não foi confirmado.',
  MCP_UNAVAILABLE:'A conexão MCP não está pronta.',
  MCP_TIMEOUT:'A conexão MCP excedeu o tempo de espera.',
  MCP_PROTOCOL:'A conexão MCP retornou uma resposta inválida.',
  TOOL_NOT_ALLOWED:'Ferramenta fora da lista permitida para este executor.',
  LIVE_PAUSED:'O Bunker está pausado; a última leitura foi preservada.',
  LIVE_CONFLICT:'O cache mudou durante a coleta; a leitura concorrente foi preservada.',
  LIVE_STALE_SNAPSHOT:'Já existe uma leitura mais recente no cache.',
  LIVE_TIMEZONE_UNCONFIRMED:'O fuso deste projeto ainda não foi confirmado no Bunker.',
  LIVE_INVALID_PROJECT:'O projeto não está configurado no Bunker.',
  LIVE_INVALID_SNAPSHOT:'O Bunker recusou uma leitura incompatível com o contrato.',
  LIVE_INVALID_REQUEST:'O Bunker recusou o pedido de sincronização.',
  LIVE_LIMIT:'O limite do cache foi excedido; nenhuma linha foi descartada.',
  LIVE_READ_FAILED:'Não foi possível ler o cache do Bunker.',
  LIVE_CACHE_INVALID:'O cache do Bunker precisa de conferência.',
  ALREADY_RUNNING:'Já existe um executor local ativo.',
  LOCK_INVALID:'O arquivo de controle está inconsistente; confira o processo antes de remover o lock.',
  SHUTDOWN:'O executor está encerrando.',
  INVALID_OPTIONS:'Parâmetros do executor inválidos.',
});
export class SyncError extends Error{constructor(code){super(MESSAGES[code]||MESSAGES.MCP_PROTOCOL);this.code=Object.hasOwn(MESSAGES,code)?code:'MCP_PROTOCOL';}}
const fail=code=>{throw new SyncError(code);};
export function publicError(error,fallback='MALVA_UNAVAILABLE'){
  const code=error instanceof SyncError?error.code:fallback;
  return {code,message:MESSAGES[code]||MESSAGES.MALVA_UNAVAILABLE};
}
const instant=value=>typeof value==='string'&&UTC_INSTANT.test(value)&&Number.isFinite(Date.parse(value));
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const rowKey=row=>JSON.stringify([row.adAccountId,row.externalId]);

/** Deliberately ignores remote error prose and never logs credentials, URLs or raw payloads. */
export function unpackToolResult(result){
  if(!isObject(result))fail('MCP_PROTOCOL');
  if(result.isError){
    const structuredCode=result.structuredContent?.error?.code??result.structuredContent?.code;
    if(Object.hasOwn(MESSAGES,structuredCode))fail(structuredCode);
    const texts=(result.content||[]).filter(c=>c?.type==='text').map(c=>c.text).join(' ');
    const code=Object.keys(MESSAGES).filter(c=>c.startsWith('LIVE_')).find(c=>texts.includes(c));
    fail(code||'MCP_UNAVAILABLE');
  }
  let data=result.structuredContent;
  if(data===undefined||data===null){
    const texts=(result.content||[]).filter(c=>c?.type==='text');
    if(texts.length!==1)fail('MCP_PROTOCOL');
    try{data=JSON.parse(texts[0].text);}catch{fail('MCP_PROTOCOL');}
  }
  if(!isObject(data))fail('MCP_PROTOCOL');
  if(typeof data.code==='string'&&(data.status!==undefined||data.message!==undefined))fail(Object.hasOwn(MESSAGES,data.code)?data.code:'MCP_UNAVAILABLE');
  if(data.ok===false||data.error){
    const code=typeof data.error==='object'?data.error?.code:data.code;
    fail(Object.hasOwn(MESSAGES,code)?code:'MCP_UNAVAILABLE');
  }
  return data;
}

/** This process never sends turn/start and therefore never invokes a model. */
export class CodexMcpClient{
  constructor({codexBin='codex',spawnImpl=spawn,timeoutMs=60_000,startupTimeoutMs=60_000}={}){
    this.codexBin=codexBin;this.spawnImpl=spawnImpl;this.timeoutMs=timeoutMs;this.startupTimeoutMs=startupTimeoutMs;
    this.pending=new Map();this.seq=0;this.child=null;this.threadId=null;this.buffer='';
  }
  async start(){
    if(this.threadId&&this.child)return;
    if(this.startPromise)return this.startPromise;
    const pending=this.startSession();this.startPromise=pending;
    try{await pending;}finally{if(this.startPromise===pending)this.startPromise=null;}
  }
  async startSession(){
    const args=['app-server','--stdio','-c',`mcp_servers.malva.enabled_tools=${JSON.stringify(MALVA_TOOLS)}`];
    // Credentials stay inside the CLI's supported auth machinery, never extracted or copied.
    const child=this.child=this.spawnImpl(this.codexBin,args,{stdio:['pipe','pipe','pipe'],env:process.env});
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{if(this.child===child)this.receive(chunk);});
    child.stderr.resume(); // Native diagnostics can contain private paths; never forward them.
    child.on('error',()=>{if(this.child===child)this.disconnected('MCP_UNAVAILABLE');});
    child.on('exit',()=>{if(this.child===child)this.disconnected('MCP_UNAVAILABLE');});
    await this.request('initialize',{clientInfo:{name:'bunker-local-live-sync',version:'1.0.0'},capabilities:{experimentalApi:true}});
    this.send({jsonrpc:'2.0',method:'initialized',params:{}});
    const result=await this.request('thread/start',{cwd:tmpdir(),ephemeral:true,sandbox:'read-only',approvalPolicy:'never'});
    if(typeof result?.thread?.id!=='string')fail('MCP_PROTOCOL');
    this.threadId=result.thread.id;
  }
  send(message){
    if(!this.child?.stdin?.writable)fail('MCP_UNAVAILABLE');
    this.child.stdin.write(JSON.stringify(message)+'\n');
  }
  request(method,params){
    return new Promise((resolveRequest,reject)=>{
      const id=++this.seq;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new SyncError('MCP_TIMEOUT'));},this.timeoutMs);
      this.pending.set(id,{resolve:resolveRequest,reject,timer});
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  receive(chunk){
    this.buffer+=chunk;
    if(Buffer.byteLength(this.buffer)>MAX_MESSAGE_BYTES){this.disconnected('MCP_PROTOCOL');this.close();return;}
    let end;
    while((end=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
      let message;try{message=JSON.parse(line);}catch{this.disconnected('MCP_PROTOCOL');this.close();return;}
      const pending=this.pending.get(message.id);
      if(pending){
        clearTimeout(pending.timer);this.pending.delete(message.id);
        if(message.error)pending.reject(new SyncError('MCP_PROTOCOL'));else pending.resolve(message.result);
      }else if(message.id!==undefined&&message.method){
        // Never accept tool approval, elicitation, or a dynamic tool request on the user's behalf.
        try{this.send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Unattended read-only relay does not accept server requests.'}});}catch{}
      }
    }
  }
  disconnected(code){
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new SyncError(code));}
    this.pending.clear();this.threadId=null;this.ready=false;this.sourceReady=false;
  }
  async ensureReady({source=true}={}){
    await this.start();const deadline=Date.now()+this.startupTimeoutMs;
    while(Date.now()<deadline){
      const servers=[];let cursor;
      do{
        const page=await this.request('mcpServerStatus/list',{threadId:this.threadId,detail:'toolsAndAuthOnly',limit:100,...(cursor?{cursor}:{})});
        if(!Array.isArray(page?.data))fail('MCP_PROTOCOL');servers.push(...page.data);cursor=page.nextCursor;
        if(servers.length>1000)fail('MCP_PROTOCOL');
      }while(cursor);
      const malva=servers.find(s=>s.name==='malva'),bunker=servers.find(s=>s.name==='codex_apps');
      if(bunker?.runtimeStatus==='connected'){
        this.bunkerTransportTool=Object.hasOwn(bunker.tools||{},BUNKER_TOOL)?BUNKER_TOOL:Object.hasOwn(bunker.tools||{},BUNKER_COMPAT_TOOL)?BUNKER_COMPAT_TOOL:null;
        this.dailyTransportTool=Object.hasOwn(bunker.tools||{},BUNKER_DAILY_TOOL)?BUNKER_DAILY_TOOL:Object.hasOwn(bunker.tools||{},BUNKER_COMPAT_TOOL)?BUNKER_COMPAT_TOOL:null;
        if(!this.bunkerTransportTool)fail('MCP_UNAVAILABLE');
        this.ready=true;
        this.sourceReady=malva?.runtimeStatus==='connected'&&MALVA_TOOLS.every(t=>Object.hasOwn(malva.tools||{},t));
        if(!source||this.sourceReady)return;
      }
      if([bunker,...(source?[malva]:[])].some(s=>['failed','disabled'].includes(s?.runtimeStatus)))fail('MCP_UNAVAILABLE');
      await delay(500);
    }
    fail('MCP_UNAVAILABLE');
  }
  async callTool(server,tool,args){
    if(!(server==='malva'&&MALVA_TOOLS.includes(tool)||server==='codex_apps'&&[BUNKER_TOOL,BUNKER_DAILY_TOOL].includes(tool)))fail('TOOL_NOT_ALLOWED');
    if(server==='codex_apps'&&!(tool===BUNKER_DAILY_TOOL?['read','pending','import','failure']:['read','import','failure']).includes(args?.action))fail('TOOL_NOT_ALLOWED');
    if(!this.threadId||!this.ready||server==='malva'&&!this.sourceReady)fail('MCP_UNAVAILABLE');
    const selected=tool===BUNKER_DAILY_TOOL?this.dailyTransportTool:this.bunkerTransportTool;
    if(server==='codex_apps'&&tool===BUNKER_DAILY_TOOL&&!selected)fail('MCP_UNAVAILABLE');
    const compatibility=server==='codex_apps'&&selected===BUNKER_COMPAT_TOOL;
    const transportTool=compatibility?BUNKER_COMPAT_TOOL:tool;
    const transportArgs=compatibility?{id:tool===BUNKER_DAILY_TOOL?'daily-data':'live-data',status:'Pendente',revision:0,note:JSON.stringify(args)}:args;
    return unpackToolResult(await this.request('mcpServer/tool/call',{threadId:this.threadId,server,tool:transportTool,arguments:transportArgs}));
  }
  close(){this.ready=false;this.disconnected('SHUTDOWN');const child=this.child;this.child=null;this.buffer='';if(child){child.stdin?.end();child.kill('SIGTERM');}}
}

function localParts(time,timezone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));}
const localDay=p=>`${p.year}-${p.month}-${p.day}`;
function midnight(day,timezone){
  const base=Date.parse(day+'T00:00:00Z');let time=base;
  for(let n=0;n<5;n++){
    const p=localParts(time,timezone),asUTC=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    const candidate=base-(asUTC-time);if(candidate===time)break;time=candidate;
  }
  const p=localParts(time,timezone);
  if(localDay(p)!==day||p.hour!=='00'||p.minute!=='00'||p.second!=='00')fail('SOURCE_INVALID');
  return new Date(time).toISOString();
}
export function todayRange(now,timezone){
  if(!validTimeZone(timezone)||!Number.isFinite(+new Date(now)))fail('SOURCE_INVALID');
  const day=localDay(localParts(+new Date(now),timezone)),next=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  return {day,from:midnight(day,timezone),to:midnight(next,timezone),timezone};
}

const STRING_FIELDS=['id','externalId','name','level','adAccountId','accountName','provider','status','effectiveStatus','budgetCurrency','campaignExternalId','adsetExternalId','startAt','deliveryStartedAt'];
const NUMBER_FIELDS=['budgetRate','dailyBudget','lifetimeBudget','spend','revenue','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','refundedOrders','refundedRevenue','impressions','linkClicks','video3s','videoPlays'];
export function mapCampaignRow(raw,project,accountIds){
  if(!isObject(raw)||raw.projectId!==project.id||raw.projectName!==project.name||raw.level!=='campaign'||raw.provider!=='meta')fail('SOURCE_IDENTITY');
  if(![raw.externalId,raw.adAccountId,raw.name,raw.accountName].every(v=>typeof v==='string'&&v.trim()))fail('SOURCE_INVALID');
  if(accountIds&&!accountIds.has(raw.adAccountId))fail('SOURCE_IDENTITY');
  const row={};
  for(const key of STRING_FIELDS)if(raw[key]!==undefined)row[key]=raw[key];
  for(const key of NUMBER_FIELDS){
    const value=raw[key];
    if(value!==undefined&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)))fail('SOURCE_INVALID');
    if(value!==undefined)row[key]=value;
  }
  if(raw.accountStatus!==undefined){
    if(!isObject(raw.accountStatus)||typeof raw.accountStatus.active!=='boolean')fail('SOURCE_INVALID');
    row.accountStatus={active:raw.accountStatus.active,...(typeof raw.accountStatus.label==='string'?{label:raw.accountStatus.label}:{})};
  }
  // No currency conversion, derived counters, fallback front orders or metadata copying.
  return row;
}
function uniqueRows(rows){const ids=new Set();for(const r of rows){const id=rowKey(r);if(ids.has(id))fail('SOURCE_INCOMPLETE');ids.add(id);}return rows;}
export function reportTotal(report){
  if(!Array.isArray(report?.rows)||report.rows.length>100)fail('SOURCE_INVALID');
  const truncated=report.truncated;
  if(truncated===undefined||truncated===null||truncated===false)return report.rows.length;
  if(Number.isInteger(truncated)&&truncated>=report.rows.length)return truncated;
  if(!isObject(truncated)||!Number.isInteger(truncated.shown)||!Number.isInteger(truncated.total)||truncated.shown!==report.rows.length||truncated.total<truncated.shown)fail('SOURCE_INVALID');
  return truncated.total;
}
export function validateReport(report,project,range,now,accountIds){
  if(!isObject(report)||report.level!=='campaign'||report.salesScope?.kind!=='traffic'||report.currency!==project.currency)fail('SOURCE_INVALID');
  if(report.period?.timezone!==project.timezone||report.period?.from!==range.from||report.period?.to!==range.to||JSON.stringify(report.period?.days)!==JSON.stringify([range.day]))fail('SOURCE_INVALID');
  if(!instant(report.freshAt)||Date.parse(report.freshAt)>now||now-Date.parse(report.freshAt)>300_000)fail('SOURCE_STALE');
  if(report.lastSyncAt!==undefined&&report.lastSyncAt!==null&&(!instant(report.lastSyncAt)||Date.parse(report.lastSyncAt)>Date.parse(report.freshAt)))fail('SOURCE_INVALID');
  const total=reportTotal(report),rows=uniqueRows(report.rows.map(row=>mapCampaignRow(row,project,accountIds)));
  if(total>MAX_ROWS)fail('SOURCE_LIMIT');
  return {total,rows,freshAt:report.freshAt,lastSyncAt:report.lastSyncAt??null};
}
export function snapshotFromReports(reports,project,range,now){
  if(!Array.isArray(reports)||!reports.length)fail('SOURCE_INCOMPLETE');
  const rows=uniqueRows(reports.flatMap(r=>r.rows));if(rows.length>MAX_ROWS)fail('SOURCE_LIMIT');
  rows.sort((a,b)=>(b.spend??-Infinity)-(a.spend??-Infinity)||rowKey(a).localeCompare(rowKey(b)));
  const oldest=values=>values.reduce((a,b)=>Date.parse(a)<=Date.parse(b)?a:b);
  const fetchedAt=oldest(reports.map(r=>r.freshAt));
  const lastSyncAt=reports.some(r=>r.lastSyncAt===null)?null:oldest(reports.map(r=>r.lastSyncAt));
  if(todayRange(now,project.timezone).day!==range.day||now-Date.parse(fetchedAt)>300_000)fail('SOURCE_STALE');
  const snapshot={projectId:project.id,projectName:project.name,period:'today',from:range.from,to:range.to,timezone:project.timezone,fetchedAt,lastSyncAt,source:'Malva MCP',level:'campaign',complete:true,rows};
  if(Buffer.byteLength(JSON.stringify(snapshot))>MAX_BYTES)fail('SOURCE_LIMIT');
  if(!bundleSchema.safeParse({snapshots:[snapshot]}).success)fail('SOURCE_INVALID');
  return snapshot;
}

/** Operational cohort only: active, spent, and exact IDs from the last live read.
 * This does not claim coverage of every inactive campaign in account history. */
export async function collectProject(client,project,{now=Date.now,trackedRows=[],wait=delay}={}){
  const range=todayRange(now(),project.timezone);let calls=0;
  const query=async(status,accountIds,campaignIds)=>{
    if(++calls>MAX_SOURCE_CALLS)fail('SOURCE_LIMIT');
    const report=await client.callTool('malva','tracking_campaigns',{projectId:project.id,level:'campaign',sales:'traffic',provider:['meta'],status,accountStatus:'all',preset:'custom',from:range.day,to:range.day,limit:100,...(accountIds?{accountIds}:{}),...(campaignIds?{campaignIds}:{})});
    // A small source/local clock lead can settle before validation. Never admit
    // a future read, extend its five-minute age limit, or wait for large skew.
    const skew=Date.parse(report?.freshAt)-now();if(skew>0&&skew<=1000)await wait(skew+25);
    return validateReport(report,project,range,now(),accountIds?new Set(accountIds):undefined);
  };
  let accounts;
  const accountIds=async()=>{
    if(accounts)return accounts;
    const result=await client.callTool('malva','tracking_ad_accounts',{projectId:project.id});
    if(!Array.isArray(result?.items))fail('SOURCE_INVALID');
    const ids=result.items.filter(a=>a?.provider==='meta').map(a=>a.id);
    if(!ids.length||ids.length>3000||ids.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(ids).size!==ids.length)fail('SOURCE_INCOMPLETE');
    accounts=ids;return ids;
  };
  const completeStatus=async status=>{
    const first=await query(status);if(first.total===first.rows.length)return [first];
    const ids=await accountIds();if(first.rows.some(row=>!ids.includes(row.adAccountId)))fail('SOURCE_INCOMPLETE');
    const parts=[];
    const partition=async selected=>{
      const part=await query(status,selected);
      if(part.total===part.rows.length){parts.push(part);return;}
      if(selected.length===1)fail('SOURCE_INCOMPLETE');
      const mid=Math.ceil(selected.length/2);await partition(selected.slice(0,mid));await partition(selected.slice(mid));
    };
    const mid=Math.ceil(ids.length/2);await partition(ids.slice(0,mid));if(mid<ids.length)await partition(ids.slice(mid));
    const all=uniqueRows(parts.flatMap(p=>p.rows)),keys=new Set(all.map(rowKey));
    if(all.length!==first.total||first.rows.some(row=>!keys.has(rowKey(row))))fail('SOURCE_INCOMPLETE');
    return [{...first,rows:[]},...parts];
  };
  if(!Array.isArray(trackedRows)||trackedRows.length>MAX_ROWS)fail('SOURCE_LIMIT');
  const tracked=new Map();
  for(const row of trackedRows){
    if(!isObject(row)||row.provider!=='meta'||row.level!=='campaign'||typeof row.externalId!=='string'||!row.externalId.trim()||typeof row.adAccountId!=='string'||!UUID.test(row.adAccountId)||row.projectId!==undefined&&row.projectId!==project.id||row.projectName!==undefined&&row.projectName!==project.name)fail('SOURCE_IDENTITY');
    tracked.set(rowKey(row),{adAccountId:row.adAccountId,externalId:row.externalId});
  }
  const reports=[...await completeStatus('active'),...await completeStatus('spent')],groups=new Map(),covered=new Set(reports.flatMap(report=>report.rows.map(rowKey)));
  // Complete active/spent reads already cover these exact tracked identities.
  // Only the remainder needs an all-status lookup, including newly paused rows.
  for(const [id,row] of tracked){if(covered.has(id))continue;if(!groups.has(row.adAccountId))groups.set(row.adAccountId,[]);groups.get(row.adAccountId).push(row.externalId);}
  for(const [account,ids] of groups)for(let offset=0;offset<ids.length;offset+=50){
    const selected=ids.slice(offset,offset+50),part=await query('all',[account],selected),allowed=new Set(selected);
    if(part.total!==part.rows.length||part.total>selected.length)fail('SOURCE_INCOMPLETE');
    if(part.rows.some(row=>!allowed.has(row.externalId)))fail('SOURCE_IDENTITY');
    reports.push(part);
  }
  const union=new Map();
  for(const report of reports)for(const row of report.rows){
    const id=rowKey(row),previous=union.get(id);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(row))fail('SOURCE_INCOMPLETE');
    union.set(id,row);
  }
  const snapshot=snapshotFromReports([{...reports[0],rows:[...union.values()]},...reports.map(report=>({...report,rows:[]}))],project,range,now());
  return {...snapshot,coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:tracked.size}};
}

export function validateLiveState(state,siteId){
  if(!isObject(state)||state.siteProjectId!==siteId)fail('BUNKER_IDENTITY');
  if(typeof state.paused!=='boolean'||!Array.isArray(state.projects)||!Array.isArray(state.items)||state.projects.length>500)fail('MCP_PROTOCOL');
  const ids=new Set(),items=new Map();
  for(const p of state.projects){if(!UUID.test(p?.projectId)||typeof p.projectName!=='string'||!p.projectName.trim()||ids.has(p.projectId)||p.trackedTargets!==undefined&&!Array.isArray(p.trackedTargets))fail('MCP_PROTOCOL');ids.add(p.projectId);}
  for(const item of state.items){if(!ids.has(item?.projectId)||items.has(item.projectId)||!Number.isInteger(item.revision)||item.revision<0)fail('MCP_PROTOCOL');items.set(item.projectId,item);}
  if(items.size!==ids.size)fail('MCP_PROTOCOL');return state;
}
export function validateSourceIdentity(who,listed,workspaceId){
  if(who?.workspace?.id!==workspaceId||!Array.isArray(listed?.items))fail('SOURCE_IDENTITY');
  const ids=new Set();
  for(const p of listed.items){if(!UUID.test(p?.id)||ids.has(p.id)||typeof p.name!=='string'||!validTimeZone(p.timezone)||typeof p.currency!=='string')fail('SOURCE_IDENTITY');ids.add(p.id);}
  return new Map(listed.items.filter(p=>!p.archivedAt).map(p=>[p.id,p]));
}
const canonical=value=>JSON.stringify(value,(_key,item)=>isObject(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
export function confirmImport(state,projectId,snapshot,revision){
  const item=state.items.find(i=>i.projectId===projectId);
  const expected=bundleSchema.safeParse({snapshots:[snapshot]}),observed=bundleSchema.safeParse({snapshots:[item?.snapshot]});
  if(!Number.isInteger(revision)||!Number.isInteger(item?.revision)||item.revision<revision||!expected.success||!observed.success||item?.snapshot?.fetchedAt!==snapshot.fetchedAt||canonical(expected.data.snapshots[0])!==canonical(observed.data.snapshots[0]))fail('BUNKER_WRITE_UNCONFIRMED');
  return item;
}

export class LiveRelay{
  constructor({client,workspaceId,siteId,now=Date.now,log=()=>{},serviceDaily=async()=>{}}){this.client=client;this.workspaceId=workspaceId;this.siteId=siteId;this.now=now;this.log=log;this.serviceDaily=serviceDaily;this.running=false;}
  async yieldToDaily(){
    // A project cycle can last minutes. Yield only between projects, after the
    // preceding cache transaction has finished, and never race the MCP client.
    try{await this.serviceDaily();}catch(error){this.log({event:'daily_boundary_unavailable',code:dailyPublicError(error).code});}
  }
  async read(){return validateLiveState(await this.client.callTool('codex_apps',BUNKER_TOOL,{action:'read'}),this.siteId);}
  async identities(){
    const who=await this.client.callTool('malva','workspace_whoami',{});
    if(who?.workspace?.id!==this.workspaceId)fail('SOURCE_IDENTITY');
    const listed=await this.client.callTool('malva','tracking_list_projects',{});
    return validateSourceIdentity(who,listed,this.workspaceId);
  }
  async check(){
    await this.client.ensureReady({source:false});const state=await this.read();
    if(state.paused)return {paused:true,projects:state.projects.length,sourceChecked:false};
    await this.client.ensureReady({source:true});
    const projects=await this.identities();
    for(const p of state.projects)if(projects.get(p.projectId)?.name!==p.projectName)fail('SOURCE_IDENTITY');
    return {paused:false,projects:state.projects.length,sourceChecked:true};
  }
  async recordFailure(project,revision,error){
    const latest=await this.read();if(latest.paused)return;
    const item=latest.items.find(i=>i.projectId===project.projectId);
    if(!latest.projects.some(p=>p.projectId===project.projectId&&p.projectName===project.projectName)||item?.revision!==revision)return;
    await this.client.callTool('codex_apps',BUNKER_TOOL,{action:'failure',projectId:project.projectId,expectedRevision:revision,error:publicError(error)});
  }
  async runOnce(){
    if(this.running)fail('ALREADY_RUNNING');this.running=true;
    try{
      await this.client.ensureReady({source:false});const state=await this.read();
      if(state.paused){this.log({event:'paused'});return {paused:true,imported:0,failed:0};}
      let source;
      try{await this.client.ensureReady({source:true});source=await this.identities();}catch(error){
        for(const p of state.projects){try{await this.recordFailure(p,state.items.find(i=>i.projectId===p.projectId).revision,error);}catch{}}
        throw error;
      }
      let imported=0,failed=0;
      for(const project of state.projects){
        await this.yieldToDaily();
        const before=await this.read();if(before.paused)return {paused:true,imported,failed};
        if(!before.projects.some(p=>p.projectId===project.projectId&&p.projectName===project.projectName))continue;
        const priorItem=before.items.find(i=>i.projectId===project.projectId),revision=priorItem.revision;
        let snapshot;
        try{
          const p=source.get(project.projectId);if(!p||p.name!==project.projectName)fail('SOURCE_IDENTITY');
          const cachedRows=priorItem.snapshot?.rows===undefined?[]:priorItem.snapshot.rows,targets=before.projects.find(p=>p.projectId===project.projectId).trackedTargets||[];
          if(!Array.isArray(cachedRows)||!Array.isArray(targets))fail('SOURCE_INVALID');
          snapshot=await collectProject(this.client,p,{now:this.now,trackedRows:[...cachedRows,...targets]});
        }catch(error){
          failed++;this.log({event:'project_failed',projectId:project.projectId,code:publicError(error).code});
          try{await this.recordFailure(project,revision,error);}catch(recordError){this.log({event:'failure_record_unconfirmed',projectId:project.projectId,code:publicError(recordError,'BUNKER_UNAVAILABLE').code});}
          continue;
        }
        const latest=await this.read();if(latest.paused)return {paused:true,imported,failed};
        const current=latest.items.find(i=>i.projectId===project.projectId);
        if(!latest.projects.some(p=>p.projectId===project.projectId&&p.projectName===project.projectName)||current?.revision!==revision){this.log({event:'cache_changed',projectId:project.projectId});continue;}
        try{
          const result=await this.client.callTool('codex_apps',BUNKER_TOOL,{action:'import',projectId:project.projectId,snapshot,expectedRevision:revision});
          if(result.ok!==true||result.item?.projectId!==project.projectId||!Number.isInteger(result.revision))fail('BUNKER_WRITE_UNCONFIRMED');
          const observed=confirmImport(await this.read(),project.projectId,snapshot,result.revision);
          imported++;this.log({event:'project_synced',projectId:project.projectId,rows:snapshot.rows.length,fetchedAt:snapshot.fetchedAt,lastSyncAt:snapshot.lastSyncAt,revision:observed.revision});
        }catch(error){
          failed++;this.log({event:'cache_write_unconfirmed',projectId:project.projectId,code:publicError(error,'BUNKER_WRITE_UNCONFIRMED').code});
          // An ambiguous import is never resent, nor overwritten by a failure record.
        }
      }
      return {paused:false,imported,failed};
    }finally{this.running=false;}
  }
}

/** PID+nonce file, restrictive permissions, stale-process recovery; no credentials on disk. */
export async function acquireLock(file,{pid=process.pid,isAlive=other=>{try{process.kill(other,0);return true;}catch(error){return error.code!=='ESRCH';}}}={}){
  await mkdir(dirname(file),{recursive:true,mode:0o700});const token=randomUUID(),candidate=file+'.'+token+'.tmp';
  // Publish a fully written inode atomically: a crash cannot leave an empty owned lock.
  const handle=await open(candidate,'wx',0o600);
  try{await handle.writeFile(JSON.stringify({pid,token,startedAt:new Date().toISOString()}));await handle.sync();}finally{await handle.close();}
  try{
    for(let attempt=0;attempt<3;attempt++){
      try{await link(candidate,file);}catch(error){
        if(error.code!=='EEXIST')throw new SyncError('ALREADY_RUNNING');
        let old;try{old=JSON.parse(await readFile(file,'utf8'));}catch{fail('LOCK_INVALID');}
        if(!Number.isInteger(old.pid)||old.pid<1||typeof old.token!=='string')fail('LOCK_INVALID');
        if(isAlive(old.pid))fail('ALREADY_RUNNING');
        try{const again=JSON.parse(await readFile(file,'utf8'));if(again.token!==old.token)continue;await unlink(file);}catch(error){if(error.code!=='ENOENT')fail('ALREADY_RUNNING');}
        continue;
      }
      return async()=>{try{const current=JSON.parse(await readFile(file,'utf8'));if(current.token===token)await unlink(file);}catch{}};
    }
    fail('ALREADY_RUNNING');
  }finally{try{await unlink(candidate);}catch{}}
}
export function parseOptions(argv){
  const options={once:false,check:false,codexBin:process.env.BUNKER_CODEX_BIN||'codex',lockFile:join(tmpdir(),`bunker-malva-live-sync-${process.getuid?.()??'user'}.lock`)};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];if(arg==='--once')options.once=true;else if(arg==='--check')options.check=true;
    else if(['--workspace-id','--site-id','--codex-bin','--lock-file'].includes(arg)){
      const value=argv[++i];if(!value||value.startsWith('--'))fail('INVALID_OPTIONS');
      options[{'--workspace-id':'workspaceId','--site-id':'siteId','--codex-bin':'codexBin','--lock-file':'lockFile'}[arg]]=value;
    }else fail('INVALID_OPTIONS');
  }
  if(!UUID.test(options.workspaceId||'')||!/^appgprj_[a-zA-Z0-9]+$/.test(options.siteId||'')||options.once&&options.check)fail('INVALID_OPTIONS');
  options.lockFile=resolve(options.lockFile);return options;
}
/** One shared, bounded queue reader across project boundaries and idle checks. */
export function createDailyService({daily,signal,clock=()=>performance.now(),log=()=>{}}){
  let backoff=POLL_INTERVAL_MS,retryAt=0,nextCheckAt=0,running=false;
  return async()=>{
    if(signal?.aborted||running||clock()<retryAt||clock()<nextCheckAt)return {failed:0};
    running=true;nextCheckAt=clock()+DAILY_CHECK_INTERVAL_MS;
    try{const result=await daily.runOnce();backoff=POLL_INTERVAL_MS;return result;}
    catch(error){log({event:'daily_unavailable',code:dailyPublicError(error).code});retryAt=clock()+backoff;backoff=Math.min(backoff*2,300_000);return {failed:1};}
    finally{running=false;}
  };
}
export async function main(argv=process.argv.slice(2)){
  const log=entry=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...entry})+'\n');
  let release,client;const controller=new AbortController();
  const stop=()=>{controller.abort();client?.close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    const options=parseOptions(argv);release=await acquireLock(options.lockFile);client=new CodexMcpClient({codexBin:options.codexBin});
    const daily=new DailyRelay({...options,client,log}),runDaily=createDailyService({daily,signal:controller.signal,log});
    const relay=new LiveRelay({...options,client,log,serviceDaily:runDaily});
    if(options.check){log({event:'check_complete',...await relay.check()});return 0;}
    let backoff=POLL_INTERVAL_MS;
    while(!controller.signal.aborted){
      let failed=0;failed+=(await runDaily()).failed;
      const cycleStarted=performance.now();let nextCycleAt=cycleStarted+POLL_INTERVAL_MS;
      try{failed+=(await relay.runOnce()).failed;backoff=POLL_INTERVAL_MS;}
      catch(error){if(controller.signal.aborted)break;log({event:'sync_unavailable',code:publicError(error).code});client.close();nextCycleAt=performance.now()+backoff;backoff=Math.min(backoff*2,300_000);failed++;}
      if(controller.signal.aborted)break;failed+=(await runDaily()).failed;
      if(options.once)return failed?1:0;
      try{await waitWithDaily(Math.max(0,nextCycleAt-performance.now()),{runDaily,signal:controller.signal,wait:delay});}catch{break;}
    }
    return 0;
  }catch(error){log({event:'executor_stopped',code:publicError(error,'MCP_UNAVAILABLE').code});return 1;}
  finally{client?.close();if(release)await release();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
