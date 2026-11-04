/** Read-only adapter shared by Supabase and Bunker. No arbitrary URL or provider mutation. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS=new Set(['projects','campaigns','ad-accounts','ad-changes','ad-detail']);
const FIELDS=['id','projectId','projectName','externalId','name','level','adAccountId','accountName','provider','status','effectiveStatus','accountStatus','budgetCurrency','budgetRate','dailyBudget','lifetimeBudget','campaignExternalId','adsetExternalId','startAt','deliveryStartedAt','spend','revenue','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','refundedOrders','refundedRevenue','impressions','linkClicks','video3s','videoPlays','cpc','cpm','ctr','cpaFront','costPerCheckout','roas','roi','profit'];
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
export class MalvaReadError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new MalvaReadError(code,status);};
export function validateMalvaRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['section','projectId','level','period','from','to','accountId','objectId','status','since','cursor'].includes(k)))fail('MALVA_REQUEST_INVALID');
 const {section,projectId}=input;if(!SECTIONS.has(section))fail('MALVA_REQUEST_INVALID');
 if(section==='projects'){if(Object.keys(input).length!==1)fail('MALVA_REQUEST_INVALID');return {...input};}
 if(!UUID.test(projectId||''))fail('MALVA_PROJECT_INVALID');
 if(input.accountId!==undefined&&!UUID.test(input.accountId))fail('MALVA_REQUEST_INVALID');
 if(input.objectId!==undefined&&(typeof input.objectId!=='string'||!/^\d{1,25}$/.test(input.objectId)))fail('MALVA_REQUEST_INVALID');
 if(input.level!==undefined&&!['campaign','adset','ad'].includes(input.level))fail('MALVA_REQUEST_INVALID');
 if(input.status!==undefined&&!['all','active','spent','paused','rejected'].includes(input.status))fail('MALVA_REQUEST_INVALID');
 if(input.period!==undefined&&!['today','yesterday','3d','7d','four','custom'].includes(input.period))fail('MALVA_REQUEST_INVALID');
 for(const k of ['from','to'])if(input[k]!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(input[k])||new Date(input[k]+'T00:00:00Z').toISOString().slice(0,10)!==input[k]))fail('MALVA_REQUEST_INVALID');
 if(input.period==='custom'&&(!input.from||!input.to||input.from>input.to||(Date.parse(input.to)-Date.parse(input.from))/86400000>365))fail('MALVA_REQUEST_INVALID');
 if(input.period!=='custom'&&(input.from!==undefined||input.to!==undefined))fail('MALVA_REQUEST_INVALID');
 if(['ad-changes','ad-detail'].includes(section)&&!input.objectId)fail('MALVA_REQUEST_INVALID');
 if(input.since!==undefined&&(section!=='ad-changes'||typeof input.since!=='string'||!Number.isFinite(Date.parse(input.since))||input.since.length>30))fail('MALVA_REQUEST_INVALID');
 if(input.cursor!==undefined&&(section!=='ad-changes'||typeof input.cursor!=='string'||input.cursor.length>2000))fail('MALVA_REQUEST_INVALID');
 if(section==='ad-accounts'&&Object.keys(input).some(k=>!['section','projectId'].includes(k)))fail('MALVA_REQUEST_INVALID');
 if(section==='ad-changes'&&Object.keys(input).some(k=>!['section','projectId','objectId','since','cursor'].includes(k)))fail('MALVA_REQUEST_INVALID');
 if(section!=='campaigns'&&input.period==='four')fail('MALVA_REQUEST_INVALID');
 return {...input};
}
const dayAt=(at,timezone)=>{let p;try{p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));}catch{fail('MALVA_IDENTITY_INVALID',502);}const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}`;};
export function malvaPeriods(at,timezone){const today=dayAt(at,timezone),shift=n=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);return {today:{from:today,to:today},yesterday:{from:shift(1),to:shift(1)},'3d':{from:shift(3),to:shift(1)},'7d':{from:shift(7),to:shift(1)}};}
export function malvaPath(input,range){
 const q=new URLSearchParams(),base='/projects/'+encodeURIComponent(input.projectId);
 if(input.section==='projects')return '/projects';
 if(input.section==='ad-accounts')return base+'/ad-accounts';
 if(input.section==='ad-changes'){q.set('objectId',input.objectId);q.set('limit','100');if(input.since)q.set('since',input.since);if(input.cursor)q.set('cursor',input.cursor);return base+'/ad-changes?'+q;}
 q.set('sales','traffic');q.set('preset','custom');q.set('from',range.from);q.set('to',range.to);
 if(input.section==='ad-detail')return base+'/ad-objects/'+encodeURIComponent(input.objectId)+'?'+q;
 q.set('level',input.level||'campaign');q.set('provider','meta');q.set('accountStatus','all');q.set('status',input.status||'all');if(input.accountId)q.append('accountId',input.accountId);
 if(input.objectId)q.set(({campaign:'campaignId',adset:'adsetId',ad:'adId'})[input.level||'campaign'],input.objectId);
 return base+'/campaigns?'+q;
}
function compactReport(data,project,input,range){
 if(!data||typeof data!=='object'||!Array.isArray(data.rows)||data.rows.length>3000||data.level!==(input.level||'campaign')||data.salesScope?.kind!=='traffic'||data.currency!==project.currency||data.period?.timezone!==project.timezone||data.period?.days?.[0]!==range.from||data.period?.days?.at(-1)!==range.to)fail('MALVA_SOURCE_INVALID',502);
 const ids=new Set();const rows=data.rows.map(row=>{
  const key=JSON.stringify([row.adAccountId,row.externalId]);
  if(row.projectId!==project.id||row.projectName!==project.name||row.level!==data.level||row.provider!=='meta'||!UUID.test(row.adAccountId||'')||typeof row.externalId!=='string'||ids.has(key)||input.accountId&&row.adAccountId!==input.accountId||input.objectId&&row.externalId!==input.objectId)fail('MALVA_IDENTITY_INVALID',502);
  ids.add(key);return Object.fromEntries(FIELDS.filter(k=>own(row,k)).map(k=>[k,row[k]]));
 });
 return {...data,rows};
}
/** Per-isolate bounded request coalescing. Source clocks are never replaced by cache clocks. */
export function createMalvaReader({key,fetch:request=globalThis.fetch,now=Date.now}={}){
 // Secrets pasted from a curl header may carry whitespace, quotes or Bearer.
 key=typeof key==='string'?key.trim().replace(/^Authorization:\s*/i,'').replace(/^Bearer\s+/i,'').replace(/^([\"'])(.*)\1$/s,'$2').trim():key;
 const cache=new Map(),inflight=new Map();let windowStart=0,used=0;
 async function get(path,ttl=2000){
  if(!key)fail('MALVA_NOT_CONFIGURED',503);if(!key.startsWith('mvk_'))fail('MALVA_KEY_FORMAT_INVALID',503);const cached=cache.get(path);if(cached&&now()-cached.storedAt<ttl)return {...cached.value,cacheHit:true};if(inflight.has(path))return inflight.get(path);
  if(now()-windowStart>=60000){windowStart=now();used=0;}if(++used>240)fail('MALVA_RATE_LIMITED',429);
  const work=(async()=>{const start=now();let response;try{response=await request('https://malvadash.com/api/v1'+path,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json','x-malva-wait':'400'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('MALVA_UNAVAILABLE',503);}
   if(!response.ok)fail(response.status===429?'MALVA_RATE_LIMITED':response.status===401?'MALVA_KEY_INVALID':response.status===403?'MALVA_SCOPE_DENIED':'MALVA_UNAVAILABLE',response.status===429?429:502);
   const text=await response.text();if(new TextEncoder().encode(text).byteLength>12000000)fail('MALVA_SOURCE_LIMIT',502);let data;try{data=JSON.parse(text);}catch{fail('MALVA_SOURCE_INVALID',502);}
   const sourceFreshAt=response.headers.get('x-malva-fresh-at'),sourceCache=response.headers.get('x-malva-cache');
   const value={data,readAt:new Date(now()).toISOString(),sourceFreshAt,sourceCache,durationMs:Math.max(0,now()-start),cacheHit:false};
   if(sourceCache!=='stale'){if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(path,{storedAt:now(),value});}return value;
  })();inflight.set(path,work);try{return await work;}finally{inflight.delete(path);}
 }
 return async raw=>{
  const input=validateMalvaRequest(raw),started=now(),listed=await get('/projects',30000);
  if(!Array.isArray(listed.data)||listed.data.some(p=>!UUID.test(p?.id||'')||typeof p.name!=='string'||typeof p.currency!=='string'))fail('MALVA_IDENTITY_INVALID',502);
  if(input.section==='projects')return {source:'Malva API',...listed,projects:listed.data,data:undefined};
  const project=listed.data.find(p=>p.id===input.projectId);if(!project)fail('MALVA_PROJECT_OUT_OF_SCOPE',403);
  const periods=malvaPeriods(now(),project.timezone),names=input.period==='four'?['7d','3d','yesterday','today']:[input.period||'today'];
  const results=await Promise.all(names.map(async period=>{const range=period==='custom'?{from:input.from,to:input.to}:periods[period],r=await get(malvaPath(input,range));return {period,...r,data:input.section==='campaigns'?compactReport(r.data,project,input,range):r.data};}));
  return {source:'Malva API',project,section:input.section,readAt:new Date(now()).toISOString(),durationMs:Math.max(0,now()-started),results,notice:'Leitura não autoriza ajustes. 7d/3d/ontem são fechados; hoje é parcial. sourceFreshAt e lastSyncAt são relógios da origem; readAt não os substitui.'};
 };
}
/** Configured-project boundary, shared by owner API and private agent MCP. */
export async function readMalvaSource(db,state,raw){
 const input=validateMalvaRequest(raw);
 if(input.section!=='projects'&&!state.config?.[input.projectId])fail('MALVA_PROJECT_NOT_CONFIGURED',403);
 if(typeof db.rpc!=='function')fail('MALVA_BRIDGE_UNAVAILABLE',503);
 let result;try{result=await db.rpc('malvaRead',input);}catch(e){fail(typeof e.code==='string'&&/^MALVA_[A-Z_]+$/.test(e.code)?e.code:'MALVA_BRIDGE_UNAVAILABLE',503);}
 if(!result||result.source!=='Malva API'||input.section!=='projects'&&(result.project?.id!==input.projectId||result.project?.name!==state.config[input.projectId].projectName))fail('MALVA_IDENTITY_INVALID',502);
 return result;
}
