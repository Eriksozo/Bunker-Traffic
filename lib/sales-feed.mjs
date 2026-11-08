/** Real-time sales from a Malva outbound webhook (owner request of 2026-11-07). A sale is information only:
 * it never proposes, approves or executes anything. Only the amount, currency, product, campaign label, project
 * and time are kept; buyer data (name, e-mail, phone, document, address) is never read into the feed.
 * The Malva payload shape is not documented here, so fields are looked up defensively and missing ones stay N/D. */
export const salesFeedLimits=Object.freeze({bodyBytes:64000,keep:40,text:120});
const str=(v,max=salesFeedLimits.text)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):null;
const num=v=>{const n=typeof v==='string'&&v.trim()!==''?Number(v.replace(',','.')):v;return typeof n==='number'&&Number.isFinite(n)?n:null;};
const pick=(o,paths)=>{for(const p of paths){let v=o;for(const k of p.split('.')){v=v&&typeof v==='object'?v[k]:undefined;}if(v!==undefined&&v!==null&&v!=='')return v;}return null;};

const refund=/refund|reembols|chargeback|estorn|cancel/i,paid=/paid|approved|aprovad|pago|purchase|compra|sale|venda|order|complete/i;

/** Normalized sale, or null when the body is not a paid sale (refunds and other topics are ignored). */
export function normalizeSale(body,now=Date.now()){
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const d=body.data&&typeof body.data==='object'?body.data:body;
 const topic=str(pick(body,['topic','event','type','name']))||str(pick(d,['status','event','type']))||'';
 const status=str(pick(d,['status','order.status','payment.status']))||'';
 if(refund.test(topic)||refund.test(status))return null;
 if(topic&&!paid.test(topic)&&!(status&&paid.test(status)))return null;
 const amount=num(pick(d,['amount','value','total','price','revenue','order.amount','order.total','order.value','payment.amount','commission.value']));
 if(amount===null||amount<=0||amount>1e7)return null;
 const atRaw=str(pick(d,['paidAt','approvedAt','createdAt','created_at','at','timestamp','order.paidAt']),40),at=Number.isFinite(Date.parse(atRaw||''))?new Date(Date.parse(atRaw)).toISOString():new Date(now).toISOString();
 const items=Array.isArray(d.items)?d.items:Array.isArray(d.products)?d.products:[];
 const order=str(pick(d,['orderId','order_id','order.id','id','transaction','transactionId']),80);
 return {amount:Math.round(amount*100)/100,currency:(str(pick(d,['currency','order.currency']),3)||'').toUpperCase()||null,
  product:str(pick(d,['product.name','productName','offer.name','offerName']))||str(items[0]?.name)||null,
  campaign:str(pick(d,['utm_campaign','utm.campaign','utms.utm_campaign','tracking.utm_campaign','attribution.campaign','campaign.name','campaign'])),
  project:str(pick(d,['projectId','project.id','project']),80),at,orderRef:order};
}

/** SHA-256 of the order id (first 16 hex): dedupes retries without keeping the order id itself. */
export async function orderRef(id){
 if(!id)return null;const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)));
 return [...h.slice(0,8)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** Adds a sale to the recent list: newest first, no duplicate order, bounded. */
export function addSale(list,sale){
 const prev=Array.isArray(list)?list:[];
 if(sale.orderRef&&prev.some(s=>s.orderRef===sale.orderRef))return {list:prev,added:false};
 return {list:[sale,...prev].slice(0,salesFeedLimits.keep),added:true};
}

/** What the notch gets: the recent sales of a scope (projects are matched by Malva project id). */
export function salesView(list,{project='all',now=Date.now()}={}){
 const recent=(Array.isArray(list)?list:[]).filter(s=>project==='all'||!s.project||s.project===project);
 const since=now-3600000;
 return {recent:recent.slice(0,10).map(({orderRef:_o,...s})=>s),lastHour:recent.filter(s=>Date.parse(s.at)>=since).length};
}
