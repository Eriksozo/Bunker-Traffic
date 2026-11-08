/**
 * Live Meta read for new campaigns (docs/first-24h-protocol.md, docs/connections.md).
 * Owner decision of 08/11/2026: the `Meta_Acess_Token` secret in Supabase reads, READ-ONLY (GET), the schedule
 * (start_time, created_time) and today's delivery (spend, impressions, IC, purchases) of the campaigns the Bunker watches.
 * Never writes to Meta: actions keep going through the Malva after the owner's approval.
 * The same file runs in the `meta-read` Edge Function (copy kept identical by a test).
 * Read per ad account (`/act_<id>/campaigns`): the `ids=` multi-object read is deprecated by Meta since v26.0.
 */
export const metaLivePolicy=Object.freeze({version:4,graphVersion:'v26.0',maxIds:200,maxAccounts:40,maxPages:3,maxRequests:60,refreshMs:120000,maxAgeMs:600000,skipMs:6*3600000});
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite;
const num=v=>{const n=typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;return finite(n)?n:null;};
const fail=code=>Object.assign(new Error(code),{code});
const CHECKOUT=['offsite_conversion.fb_pixel_initiate_checkout','initiate_checkout','omni_initiated_checkout','onsite_web_initiate_checkout'];
const PURCHASE=['offsite_conversion.fb_pixel_purchase','purchase','omni_purchase','onsite_web_purchase'];
// The same event is reported under several action types: take the largest, never the sum.
const action=(list,types)=>{let best=null;for(const a of arr(list))if(types.includes(a?.action_type)){const v=num(a.value);if(v!==null)best=best===null?v:Math.max(best,v);}return best;};
export const metaCampaignFields='id,status,effective_status,start_time,created_time,stop_time,insights.date_preset(today){date_start,spend,impressions,actions,account_currency}';
export const metaBasicFields='id,status,effective_status,start_time,created_time,stop_time';
/** Graph error text without numbers that could be ids (never carries the token). */
const diagnostic=e=>e&&typeof e==='object'?{code:num(e.code),subcode:num(e.error_subcode),type:typeof e.type==='string'?e.type.slice(0,40):null,message:typeof e.message==='string'?e.message.replace(/\d{5,}/g,'#').slice(0,180):null}:null;

/** Campaign and account ids are numeric strings; anything else is refused before any request. */
export function cleanMetaIds(ids){
 const out=[...new Set(arr(ids).filter(v=>typeof v==='string'&&/^\d{6,25}$/.test(v)))];
 if(out.length>metaLivePolicy.maxIds)throw fail('META_TOO_MANY_IDS');
 return out;
}
/** [{account,ids}] grouped and bounded: at most 40 accounts and 200 campaigns in all. */
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
  day:i?.date_start||null,spend:i?num(i.spend):0,impressions:i?num(i.impressions):0,currency:i?.account_currency||null,
  checkouts:i?action(i.actions,CHECKOUT)??0:0,purchases:i?action(i.actions,PURCHASE)??0:0,hasInsights:!!i};
}

/**
 * Reads the active campaigns of each ad account (GET /act_<id>/campaigns, up to 3 pages) and keeps only the
 * requested ids. GET only; the token goes in the Authorization header. If the insights expansion is refused,
 * the schedule fields are still read. An account the token cannot read is returned in `skippedAccounts`.
 * Errors become fixed codes (META_190, META_100_33, META_HTTP_400…); the Graph text is kept with numbers masked.
 * @param {typeof fetch} fetchImpl @param {string} token @param {Array<{account:string,ids:string[]}>} accounts
 */
export async function readMetaAccountCampaigns(fetchImpl,token,accounts,{version=metaLivePolicy.graphVersion}={}){
 if(typeof token!=='string'||!token.trim())throw fail('META_TOKEN_MISSING');
 if(!/^v\d{1,2}\.\d$/.test(version))throw fail('META_VERSION_INVALID');
 const list=cleanMetaAccounts(accounts),items=[],errors=[],skippedAccounts=[];let requests=0,fields=metaCampaignFields,diag=null,downgraded=false;
 const get=async(account,f,after)=>{
  requests++;
  const qs=new URLSearchParams({fields:f,effective_status:JSON.stringify(['ACTIVE','IN_PROCESS','WITH_ISSUES']),limit:'100'});if(after)qs.set('after',after);
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/act_${account}/campaigns?${qs}`,{method:'GET',headers:{Authorization:'Bearer '+token.trim()}});}catch{return {network:true};}
  let body=null;try{body=await response.json();}catch{body=null;}
  if(!response.ok||body?.error){const c=num(body?.error?.code),sub=num(body?.error?.error_subcode);return {c,code:c?`META_${c}${sub?'_'+sub:''}`:`META_HTTP_${response.status}`,error:body?.error};}
  return {body};
 };
 for(const {account,ids} of list){
  const wanted=new Set(ids);let after=null;
  for(let page=0;page<metaLivePolicy.maxPages;page++){
   if(requests>=metaLivePolicy.maxRequests){errors.push('META_REQUEST_BUDGET');break;}
   let r=await get(account,fields,after);
   // The insights expansion refused once: fall back to schedule fields for every account.
   if(r.c===100&&fields===metaCampaignFields&&!downgraded){diag=diag||diagnostic(r.error);const b=await get(account,metaBasicFields,after);if(b.body){fields=metaBasicFields;downgraded=true;errors.push('META_INSIGHTS_REJECTED');r=b;}}
   if(r.network){errors.push('META_NETWORK');break;}
   if(r.code){if(r.c===190)throw fail(r.code);errors.push(r.code);diag=diag||diagnostic(r.error);if([100,10,200,270,283,294].includes(r.c))skippedAccounts.push(account);break;}
   for(const node of arr(r.body?.data))if(node&&wanted.has(String(node.id))){items.push(normalizeMetaCampaign(node));wanted.delete(String(node.id));}
   after=typeof r.body?.paging?.cursors?.after==='string'&&r.body?.paging?.next?r.body.paging.cursors.after:null;
   if(!after||!wanted.size)break;
  }
 }
 return {version:metaLivePolicy.version,items,skippedAccounts,requests,errors:[...new Set(errors)],diagnostic:diag,fields:fields===metaCampaignFields?'full':'basic'};
}
