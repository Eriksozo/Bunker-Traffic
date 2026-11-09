/**
 * Live Meta read (docs/first-24h-protocol.md, docs/connections.md).
 * Owner decision of 08/11/2026: the `Meta_Acess_Token` secret in Supabase reads, READ-ONLY (GET), the schedule
 * (start_time, created_time) and today's delivery (spend, impressions, IC, purchases) of the campaigns the Bunker watches.
 * Owner decision of 09/11/2026 ("associar a campanha da meta junto com o mcp do malva … pra atualização de dados dos
 * números do tráfego", web and notch): the same read covers every active Meta campaign of the configured projects,
 * plus status, daily budget and clicks, joined to the Malva row by campaign id for display only.
 * Never writes to Meta: actions keep going through the Malva after the owner's approval.
 * The same file runs in the `meta-read` Edge Function (copy kept identical by a test).
 * Read per ad account (`/act_<id>/campaigns`): the `ids=` multi-object read is deprecated by Meta since v26.0.
 */
// Up to 600 campaigns in 160 accounts, 8 accounts at a time; ids no longer in the active listing (just paused, for
// example) are read one by one, at most `maxDirect`. A Meta rate-limit answer stops the reads for `backoffMs`.
export const metaLivePolicy=Object.freeze({version:6,graphVersion:'v26.0',maxIds:600,maxAccounts:160,maxPages:3,maxRequests:260,maxDirect:40,concurrency:8,refreshMs:60000,maxAgeMs:600000,skipMs:6*3600000,backoffMs:10*60000});
/** Graph codes for "too many calls": the caller waits `backoffMs` before reading again. */
export const metaRateCodes=Object.freeze([4,17,32,613,80000,80001,80002,80003,80004,80005,80006,80008,80009,80014]);
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite;
const num=v=>{const n=typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;return finite(n)?n:null;};
const fail=code=>Object.assign(new Error(code),{code});
const CHECKOUT=['offsite_conversion.fb_pixel_initiate_checkout','initiate_checkout','omni_initiated_checkout','onsite_web_initiate_checkout'];
const PURCHASE=['offsite_conversion.fb_pixel_purchase','purchase','omni_purchase','onsite_web_purchase'];
// The same event is reported under several action types: take the largest, never the sum.
const action=(list,types)=>{let best=null;for(const a of arr(list))if(types.includes(a?.action_type)){const v=num(a.value);if(v!==null)best=best===null?v:Math.max(best,v);}return best;};
export const metaCampaignFields='id,status,effective_status,start_time,created_time,stop_time,daily_budget,lifetime_budget,insights.date_preset(today){date_start,spend,impressions,clicks,inline_link_clicks,actions,account_currency}';
export const metaBasicFields='id,status,effective_status,start_time,created_time,stop_time,daily_budget,lifetime_budget';
// Graph budgets are in the currency's minor unit; these currencies have none (Meta's currency offset 1).
const NO_MINOR=new Set(['CLP','COP','CRC','HUF','ISK','IDR','JPY','KRW','PYG','TWD','VND']);
/** Graph minor-unit budget → major unit of the account currency, or null (unknown currency, zero or missing). */
export const metaBudget=(v,currency)=>{const n=num(v);if(n===null||n<=0)return null;const c=String(currency||'').toUpperCase();return /^[A-Z]{3}$/.test(c)?NO_MINOR.has(c)?n:n/100:null;};
/** Graph error text without numbers that could be ids, with the token and token-shaped text redacted. */
// Graph text may echo the credential: drop the token itself and anything token-shaped (same rule as account-limits).
const redact=(text,token)=>{let t=String(text??'');const k=typeof token==='string'?token.trim():'';if(k.length>=8)t=t.split(k).join('[redacted]');return t.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/(access_token|token)=[^&\s"']+/gi,'$1=[redacted]').replace(/EAA[A-Za-z0-9_-]{8,}/g,'[redacted]');};
const diagnostic=(e,token)=>e&&typeof e==='object'?{code:num(e.code),subcode:num(e.error_subcode),type:typeof e.type==='string'?e.type.slice(0,40):null,message:typeof e.message==='string'?redact(e.message,token).replace(/\d{5,}/g,'#').slice(0,180):null}:null;

/** Campaign and account ids are numeric strings; anything else is refused before any request. */
export function cleanMetaIds(ids){
 const out=[...new Set(arr(ids).filter(v=>typeof v==='string'&&/^\d{6,25}$/.test(v)))];
 if(out.length>metaLivePolicy.maxIds)throw fail('META_TOO_MANY_IDS');
 return out;
}
/** [{account,ids}] grouped and bounded: at most `maxAccounts` accounts and `maxIds` campaigns in all. */
export function cleanMetaAccounts(accounts){
 const byAccount=new Map();
 for(const a of arr(accounts)){const acc=typeof a?.account==='string'?a.account.replace(/^act_/,''):'';if(!/^\d{5,25}$/.test(acc))continue;const set=byAccount.get(acc)||new Set();for(const id of cleanMetaIds(a.ids))set.add(id);if(set.size)byAccount.set(acc,set);}
 if(byAccount.size>metaLivePolicy.maxAccounts)throw fail('META_TOO_MANY_ACCOUNTS');
 if([...byAccount.values()].reduce((n,s)=>n+s.size,0)>metaLivePolicy.maxIds)throw fail('META_TOO_MANY_IDS');
 return [...byAccount].map(([account,set])=>({account,ids:[...set]}));
}

/** One campaign node from the Graph API as the Bunker needs it. Missing values stay null (N/D), never zero. */
export function normalizeMetaCampaign(node){
 const i=arr(node?.insights?.data)[0]||null;
 return {id:String(node?.id||''),status:node?.status||null,effectiveStatus:node?.effective_status||null,startTime:node?.start_time||null,createdTime:node?.created_time||null,stopTime:node?.stop_time||null,
  // No insights row today means no delivery today: spend 0 only when the campaign node itself was read.
  day:i?.date_start||null,spend:i?num(i.spend):0,impressions:i?num(i.impressions):0,clicks:i?num(i.clicks):0,linkClicks:i?num(i.inline_link_clicks)??0:0,currency:i?.account_currency||null,
  // The budget's currency is the account's: known only with today's insights (or the caller's own account currency).
  dailyBudget:metaBudget(node?.daily_budget,i?.account_currency),lifetimeBudget:metaBudget(node?.lifetime_budget,i?.account_currency),
  dailyBudgetMinor:num(node?.daily_budget),lifetimeBudgetMinor:num(node?.lifetime_budget),
  checkouts:i?action(i.actions,CHECKOUT)??0:0,purchases:i?action(i.actions,PURCHASE)??0:0,hasInsights:!!i};
}

/**
 * Reads the active campaigns of each ad account (GET /act_<id>/campaigns, up to 3 pages, `concurrency` accounts at a
 * time) and keeps only the requested ids; requested ids the listing did not return (paused since, for example) are read
 * one by one (GET /<id>, at most `maxDirect`). GET only; the token goes in the Authorization header. If the insights
 * expansion is refused, the schedule fields are still read. An account the token cannot read is returned in
 * `skippedAccounts`; a rate-limit answer sets `rateLimited` and stops new requests.
 * Errors become fixed codes (META_190, META_100_33, META_HTTP_400…); the Graph text is kept with numbers masked.
 * @param {typeof fetch} fetchImpl @param {string} token @param {Array<{account:string,ids:string[]}>} accounts
 */
export async function readMetaAccountCampaigns(fetchImpl,token,accounts,{version=metaLivePolicy.graphVersion}={}){
 if(typeof token!=='string'||!token.trim())throw fail('META_TOKEN_MISSING');
 if(!/^v\d{1,2}\.\d$/.test(version))throw fail('META_VERSION_INVALID');
 const list=cleanMetaAccounts(accounts),items=[],errors=[],skippedAccounts=[],leftovers=[];let requests=0,fields=metaCampaignFields,diag=null,rateLimited=false,expired=null;
 const call=async(path,qs)=>{
  requests++;
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/${path}?${qs}`,{method:'GET',headers:{Authorization:'Bearer '+token.trim()}});}catch{return {network:true};}
  let body=null;try{body=await response.json();}catch{body=null;}
  if(!response.ok||body?.error){const c=num(body?.error?.code),sub=num(body?.error?.error_subcode);if(metaRateCodes.includes(c))rateLimited=true;if(c===190)expired=`META_${c}${sub?'_'+sub:''}`;return {c,code:c?`META_${c}${sub?'_'+sub:''}`:`META_HTTP_${response.status}`,error:body?.error};}
  return {body};
 };
 const list1=(account,f,after)=>{const qs=new URLSearchParams({fields:f,effective_status:JSON.stringify(['ACTIVE','IN_PROCESS','WITH_ISSUES']),limit:'100'});if(after)qs.set('after',after);return call(`act_${account}/campaigns`,qs);};
 const stop=()=>rateLimited||expired!==null;
 const readAccount=async({account,ids})=>{
  const wanted=new Set(ids);let after=null,listed=false;
  for(let page=0;page<metaLivePolicy.maxPages;page++){
   if(stop())return;
   if(requests>=metaLivePolicy.maxRequests){errors.push('META_REQUEST_BUDGET');return;}
   const used=fields;let r=await list1(account,used,after);
   // The insights expansion refused: fall back to schedule fields for every account (also one already in flight).
   if(r.c===100&&used===metaCampaignFields){diag=diag||diagnostic(r.error,token);const b=await list1(account,metaBasicFields,after);if(b.body){fields=metaBasicFields;errors.push('META_INSIGHTS_REJECTED');r=b;}}
   if(r.network){errors.push('META_NETWORK');return;}
   if(r.code){if(r.c===190)return;errors.push(r.code);diag=diag||diagnostic(r.error,token);if([100,10,200,270,283,294].includes(r.c))skippedAccounts.push(account);return;}
   listed=true;
   for(const node of arr(r.body?.data))if(node&&wanted.has(String(node.id))){items.push(normalizeMetaCampaign(node));wanted.delete(String(node.id));}
   after=typeof r.body?.paging?.cursors?.after==='string'&&r.body?.paging?.next?r.body.paging.cursors.after:null;
   if(!after||!wanted.size)break;
  }
  // Only for an account the token could list: every page read and the id still missing.
  if(listed&&!after)for(const id of wanted)leftovers.push(id);
 };
 const queue=[...list];
 await Promise.all(Array.from({length:Math.min(metaLivePolicy.concurrency,queue.length)},async()=>{while(queue.length&&!stop())await readAccount(queue.shift());}));
 if(expired)throw fail(expired);
 const direct=leftovers.slice(0,metaLivePolicy.maxDirect);if(leftovers.length>direct.length)errors.push('META_DIRECT_LIMIT');
 const one=async id=>{
  if(stop()||requests>=metaLivePolicy.maxRequests)return;
  const used=fields;let r=await call(id,new URLSearchParams({fields:used}));
  if(r.c===100&&used===metaCampaignFields){const b=await call(id,new URLSearchParams({fields:metaBasicFields}));if(b.body)r=b;}
  if(r.body&&String(r.body.id)===id)items.push(normalizeMetaCampaign(r.body));else if(r.code&&r.c!==190)errors.push(r.code);
 };
 const dq=[...direct];
 await Promise.all(Array.from({length:Math.min(metaLivePolicy.concurrency,dq.length)},async()=>{while(dq.length&&!stop())await one(dq.shift());}));
 if(expired)throw fail(expired);
 if(rateLimited)errors.push('META_RATE_LIMIT');
 return {version:metaLivePolicy.version,items,skippedAccounts,requests,direct:direct.length,rateLimited,errors:[...new Set(errors)],diagnostic:diag,fields:fields===metaCampaignFields?'full':'basic'};
}
