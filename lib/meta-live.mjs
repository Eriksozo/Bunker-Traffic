/**
 * Live Meta read for new campaigns (docs/first-24h-protocol.md, docs/connections.md).
 * Owner decision of 08/11/2026: the `Meta_Acess_Token` secret in Supabase reads, READ-ONLY (GET), the schedule
 * (start_time, created_time) and today's delivery (spend, impressions, IC, purchases) of the campaigns the Bunker watches.
 * Never writes to Meta: actions keep going through the Malva after the owner's approval.
 * The same file runs in the `meta-read` Edge Function (copy kept identical by a test).
 */
export const metaLivePolicy=Object.freeze({version:3,graphVersion:'v23.0',maxIds:200,chunk:50,maxRequests:40,refreshMs:120000,maxAgeMs:600000,skipMs:6*3600000});
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

/** Campaign ids are numeric strings; anything else is refused before any request. */
export function cleanMetaIds(ids){
 const out=[...new Set(arr(ids).filter(v=>typeof v==='string'&&/^\d{6,25}$/.test(v)))];
 if(out.length>metaLivePolicy.maxIds)throw fail('META_TOO_MANY_IDS');
 return out;
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
 * Reads up to 200 campaigns by id (50 per request). GET only; the token goes in the Authorization header.
 * In an `ids=` read, one id the token cannot see makes Meta refuse the whole request (#100): the request is split
 * in halves until each refused id is isolated and returned in `skipped`. At most 40 requests per read.
 * Errors become fixed codes (META_190, META_100_33, META_HTTP_400…), never a URL, a message or the token.
 * @param {typeof fetch} fetchImpl @param {string} token @param {string[]} ids
 */
export async function readMetaCampaigns(fetchImpl,token,ids,{version=metaLivePolicy.graphVersion}={}){
 if(typeof token!=='string'||!token.trim())throw fail('META_TOKEN_MISSING');
 if(!/^v\d{1,2}\.\d$/.test(version))throw fail('META_VERSION_INVALID');
 const list=cleanMetaIds(ids),items=[],errors=[],skipped=[];let requests=0,fields=metaCampaignFields,diag=null;
 const get=async(group,f)=>{
  requests++;
  const qs=new URLSearchParams({ids:group.join(','),fields:f});
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/?${qs}`,{method:'GET',headers:{Authorization:'Bearer '+token.trim()}});}catch{return {network:true};}
  let body=null;try{body=await response.json();}catch{body=null;}
  if(!response.ok||body?.error){const c=num(body?.error?.code),sub=num(body?.error?.error_subcode);return {c,code:c?`META_${c}${sub?'_'+sub:''}`:`META_HTTP_${response.status}`,error:body?.error};}
  return {body};
 };
 // Probe with one id: a refusal of the request itself (fields, permission) must not be mistaken for bad ids.
 if(list.length){
  let probe=await get([list[0]],fields);
  if(probe.c===190)throw fail(probe.code);
  if(probe.c===100&&list.length>1){const second=await get([list[1]],fields);if(second.c===100){
   diag=diagnostic(probe.error);
   const basic=await get([list[0]],metaBasicFields);
   if(basic.body){fields=metaBasicFields;errors.push('META_INSIGHTS_REJECTED');}
   else return {version:metaLivePolicy.version,items,skipped,requests,errors:[probe.code],diagnostic:diag,fields:'none'};
  }}
 }
 const read=async group=>{
  if(requests>=metaLivePolicy.maxRequests){errors.push('META_REQUEST_BUDGET');return;}
  const r=await get(group,fields);
  if(r.network){errors.push('META_NETWORK');return;}
  if(r.error||r.code){
   if(r.c===190)throw fail(r.code);
   if(r.c===100&&group.length>1){const half=Math.ceil(group.length/2);await read(group.slice(0,half));await read(group.slice(half));return;}
   if(r.c===100&&group.length===1){skipped.push(group[0]);errors.push(r.code);diag=diag||diagnostic(r.error);return;}
   errors.push(r.code);diag=diag||diagnostic(r.error);return;
  }
  for(const node of Object.values(r.body||{}))if(node&&typeof node==='object'&&node.id)items.push(normalizeMetaCampaign(node));
 };
 for(let i=0;i<list.length;i+=metaLivePolicy.chunk)await read(list.slice(i,i+metaLivePolicy.chunk));
 return {version:metaLivePolicy.version,items,skipped,requests,errors:[...new Set(errors)],diagnostic:diag,fields:fields===metaCampaignFields?'full':'basic'};
}
