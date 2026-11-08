/**
 * Ad-account panel: which accounts run which project, today's spend against the daily spending
 * limit Meta sets for each account, balance and alerts. Read-only, built from:
 * - Malva tracking_ad_accounts per configured project (status, balance, project usage);
 * - Meta Graph `/me/adaccounts` with a read-only token (`adtrust_dsl` and today's spend in the account currency).
 * Personal data from Malva (registered address, people with access, tokens) never enters the panel.
 */
export const accountPanelPolicy=Object.freeze({version:6,refreshMs:30*60000,maxAccounts:250,nearLimit:0.8,graphVersion:'v23.0',
 // Older Graph versions still served by Meta, tried in order only for the daily limit when the current one refuses it.
 limitFallback:Object.freeze(['v25.0','v24.0','v23.0','v22.0'])});
export const metaAccountFields='account_id,name,account_status,disable_reason,currency,adtrust_dsl,timezone_name,insights.date_preset(today){spend}';
const metaStatus=Object.freeze({1:'active',2:'disabled',3:'unsettled',7:'risk-review',8:'pending-settlement',9:'grace-period',100:'pending-closure',101:'closed',201:'active',202:'closed'});
export const statusLabels=Object.freeze({active:'Ativa',disabled:'Desabilitada',unsettled:'Pagamento pendente','risk-review':'Em análise de risco','pending-settlement':'Acerto pendente','grace-period':'Carência','pending-closure':'Fechando',closed:'Fechada'});
const finite=Number.isFinite,arr=v=>Array.isArray(v)?v:[];
const num=v=>{const n=typeof v==='string'?Number(v):v;return finite(n)?n:null;};
const text=(v,max=160)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):null;

/** Meta Graph account → panel fields. A negative or missing `adtrust_dsl` means no limit reported (N/D). */
export function normalizeMetaAccount(raw){
 const accountId=text(String(raw?.account_id??'').replace(/^act_/,''),40);if(!accountId||!/^\d+$/.test(accountId))return null;
 const limit=num(raw.adtrust_dsl),spend=num(arr(raw.insights?.data)[0]?.spend);
 return {accountId,name:text(raw.name),status:metaStatus[raw.account_status]||null,currency:text(raw.currency,3),timezone:text(raw.timezone_name,64),
  // Graph omits an empty insights edge: no row today means no spend registered by Meta today.
  dailyLimit:limit!==null&&limit>0?limit:null,todaySpend:spend??0,disableReason:num(raw.disable_reason)};
}

/**
 * Reads every ad account the read-only token sees. The token travels only in the Authorization header;
 * paging uses the `after` cursor (never a `next` URL that could carry credentials). Errors are fixed codes.
 * Fields Meta reports as nonexistent are dropped (listed in `result.dropped`). When that field is the daily limit,
 * the same field is read alone from the older versions in `limitFallback` and joined by account id
 * (`result.limitVersion` names the version that answered, `result.limitTried` the codes of those that refused).
 * @param {(url:string,init:any)=>Promise<any>} fetchImpl @param {string} token @param {{version?:string,maxPages?:number,limitFallback?:readonly string[]}} [options]
 */
export async function readMetaAccounts(fetchImpl,token,{version=accountPanelPolicy.graphVersion,maxPages=8,limitFallback=accountPanelPolicy.limitFallback}={}){
 const out=await readMetaPages(fetchImpl,token,version,metaAccountFields,maxPages);
 let limitVersion=null;const limitTried=[];
 if(out.dropped.includes('adtrust_dsl'))for(const v of arr(limitFallback)){
  if(v===version||!/^v\d{1,2}\.\d$/.test(v))continue;
  let limits;try{limits=await readMetaPages(fetchImpl,token,v,'account_id,adtrust_dsl',maxPages,false);}catch(e){limitTried.push({version:v,code:e?.code||'META_FAILED'});continue;}
  const byId=new Map(limits.map(r=>[String(r?.account_id??'').replace(/^act_/,''),r?.adtrust_dsl]));
  for(const r of out){const l=byId.get(String(r?.account_id??'').replace(/^act_/,''));if(l!==undefined)r.adtrust_dsl=l;}
  limitVersion=v;break;
 }
 return Object.assign(out,{limitVersion,limitTried});
}

async function readMetaPages(fetchImpl,token,version,fieldList,maxPages,allowDrop=true){
 if(typeof token!=='string'||!token.trim())throw Object.assign(new Error('META_TOKEN_MISSING'),{code:'META_TOKEN_MISSING'});
 if(!/^v\d{1,2}\.\d$/.test(version))throw Object.assign(new Error('META_VERSION_INVALID'),{code:'META_VERSION_INVALID'});
 const out=[],dropped=[];let after=null,fields=fieldList.split(/,(?![^{]*})/);
 for(let page=0;page<maxPages;page++){
  const qs=new URLSearchParams({fields:fields.join(','),limit:'100'});if(after)qs.set('after',after);
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/me/adaccounts?${qs}`,{headers:{Authorization:'Bearer '+token.trim()}});}catch{throw Object.assign(new Error('META_NETWORK'),{code:'META_NETWORK'});}
  let body=null;try{body=await response.json();}catch{body=null;}
  // A field Meta retired (e.g. adtrust_dsl in v26) is dropped and the same page read again; the rest stays.
  const gone=/nonexisting field \((\w+)\)/.exec(body?.error?.message||'')?.[1];
  if(allowDrop&&body?.error&&num(body.error.code)===100&&gone&&fields.includes(gone)&&gone!=='account_id'&&dropped.length<3){fields=fields.filter(f=>f!==gone);dropped.push(gone);page--;continue;}
  if(!response.ok||body?.error){const c=num(body?.error?.code),e=body?.error;throw Object.assign(new Error('META_ERROR'),{code:c?`META_${c}`:`META_HTTP_${response.status}`,
   // Graph text with long numbers masked (ids), never the token: lets the owner see why Meta refused.
   diagnostic:e&&typeof e==='object'?{code:c,subcode:num(e.error_subcode),message:typeof e.message==='string'?e.message.replace(/\d{5,}/g,'#').slice(0,180):null}:null});}
  out.push(...arr(body?.data));
  after=typeof body?.paging?.cursors?.after==='string'&&body?.paging?.next?body.paging.cursors.after:null;
  if(!after)break;
 }
 return Object.assign(out,{dropped});
}

const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
/**
 * Panel search: account name (accents and case ignored) or account id (with or without `act_`).
 * Every word typed must match the name, or be digits contained in the id.
 * @param {{name?:string|null,accountId?:string}} row @param {string} query
 */
export function accountMatches(row,query){
 const q=fold(query);if(!q)return true;const name=fold(row?.name),id=String(row?.accountId??'');
 return q.split(/\s+/).every(w=>name.includes(w)||(/^(act_)?\d+$/.test(w)&&id.includes(w.replace(/^act_/,''))));
}

const groupOf=name=>/fb\s*flix/i.test(name||'')?'FB Flix':/alfa\s*rent/i.test(name||'')?'Alfa Rent':/fb\s*max/i.test(name||'')?'FB Max':'Outras';
const malvaStatus=kind=>kind==='active'?'active':kind==='disabled'?'disabled':kind||null;

/**
 * Joins Malva (per configured Meta project) with Meta (token reads) by the numeric account id.
 * Only accounts that belong to a configured project appear; Meta-only accounts are ignored.
 * Malva `usage` is the whole account's spend, so in a shared account it cannot say which project runs there.
 * `running` (project name → Malva account ids with campaign spend in that project's own sources) decides that;
 * without it, the account-level usage is the fallback.
 * @param {{projects?:Array<{id:string,name:string,items:any[]}>,running?:Record<string,Set<string>|string[]>|null,meta?:any[]|null,metaError?:string|null,now?:number}} input
 */
export function buildAccountPanel({projects=[],running=null,meta=null,metaError=null,now=Date.now()}={}){
 const byId=new Map();
 for(const p of arr(projects))for(const a of arr(p.items)){
  if(a?.provider!=='meta')continue;const accountId=text(String(a.accountId??''),40);if(!accountId)continue;
  const usage=a.usage||{},m=a.meta||{},row=byId.get(accountId)||{accountId,name:text(a.label),group:groupOf(a.label),projects:[],status:malvaStatus(m.statusKind),statusChangedAt:text(m.statusChangedAt,40),balance:num(m.balance),spendCap:num(m.spendCap),adsRunning:num(m.adsRunning),spend7dBrl:null,spendTodayBrl:null};
  const own=running?.[p.name],runs=own?(own instanceof Set?own.has(a.id):arr(own).includes(a.id)):!running&&(num(usage.spendToday)>0||num(usage.spend7d)>0||num(usage.activeCampaigns)>0);
  if(runs&&!row.projects.includes(p.name))row.projects.push(p.name);
  // Account-level values: the same in every project that lists the account, never summed.
  if(num(usage.spendToday)!==null)row.spendTodayBrl=Math.max(row.spendTodayBrl??0,num(usage.spendToday));
  if(num(usage.spend7d)!==null)row.spend7dBrl=Math.max(row.spend7dBrl??0,num(usage.spend7d));
  byId.set(accountId,row);
 }
 const metaById=new Map(arr(meta).map(normalizeMetaAccount).filter(Boolean).map(r=>[r.accountId,r]));
 const rows=[...byId.values()].map(r=>{
  const mm=metaById.get(r.accountId),status=mm?.status||r.status,limit=mm?.dailyLimit??null,spend=mm?mm.todaySpend:null;
  const used=limit&&finite(spend)?spend/limit:null,changed=Date.parse(r.statusChangedAt||'');
  const alerts=[];
  if(used!==null&&used>=accountPanelPolicy.nearLimit)alerts.push(used>=1?'Limite diário atingido':'Perto do limite diário');
  if(status&&status!=='active'&&finite(changed)&&now-changed<=86400000)alerts.push('Caiu nas últimas 24h');
  if(status==='active'&&!r.projects.length)alerts.push('Ativa sem gasto em 7 dias');
  return {...r,status,statusLabel:statusLabels[status]||'N/D',currency:mm?.currency||null,timezone:mm?.timezone||null,dailyLimit:limit,todaySpend:spend,usedPct:used===null?null:Math.round(used*1000)/10,
   limitSource:mm?'Meta':'N/D',runningLabel:status==='active'?(r.projects.length?'Rodando · '+r.projects.join(', '):'Sem gasto'):statusLabels[status]||'N/D',alerts};
 }).sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1)||(b.usedPct??-1)-(a.usedPct??-1)||a.group.localeCompare(b.group)||String(a.name).localeCompare(String(b.name)));
 const active=rows.filter(r=>r.status==='active');
 // Counters cover every account; the stored list keeps all active ones and only recent falls of the rest.
 const recent=r=>{const t=Date.parse(r.statusChangedAt||'');return finite(t)&&now-t<=7*86400000;};
 const kept=rows.filter(r=>r.status==='active'||recent(r)).slice(0,accountPanelPolicy.maxAccounts);
 return {version:accountPanelPolicy.version,generatedAt:new Date(now).toISOString(),metaConnected:Array.isArray(meta),metaError:metaError||null,
  counts:{total:rows.length,active:active.length,running:active.filter(r=>r.projects.length).length,disabled:rows.filter(r=>r.status==='disabled').length,nearLimit:rows.filter(r=>r.alerts.some(a=>/limite/.test(a))).length,withLimit:rows.filter(r=>r.dailyLimit!==null).length,listed:kept.length},
  rows:kept};
}

/**
 * Malva account ids with campaign spend (today or last 7 days) in each project's own analysis sources.
 * @param {any} state @returns {Record<string,Set<string>>}
 */
export function runningAccounts(state){
 /** @type {Record<string,Set<string>>} */
 const out={};
 for(const [project,cfg] of Object.entries(state?.config||{})){
  const ids=new Set();
  for(const s of arr(state?.snapshots))if(s.projectId===project&&s.level==='campaign'&&['today','7d'].includes(s.period))for(const r of arr(s.rows))if(r?.provider==='meta'&&num(r.spend)>0&&r.adAccountId)ids.add(r.adAccountId);
  out[cfg?.projectName||project]=ids;
 }
 return out;
}
