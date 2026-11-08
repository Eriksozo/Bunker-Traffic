/** Real-time sales from a Malva outbound webhook (owner request of 2026-11-07). A sale is information only:
 * it never proposes, approves or executes anything. Only the amount, currency, product, campaign label, project
 * and time are kept; buyer data (name, e-mail, phone, document, address) is never read into the feed.
 * The Malva payload shape is not documented here, so fields are looked up defensively and missing ones stay N/D. */
export const salesFeedLimits=Object.freeze({bodyBytes:64000,keep:40,text:120});
const str=(v,max=salesFeedLimits.text)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):null;
const num=v=>{const n=typeof v==='string'&&v.trim()!==''?Number(v.replace(',','.')):v;return typeof n==='number'&&Number.isFinite(n)?n:null;};
const pick=(o,paths)=>{for(const p of paths){let v=o;for(const k of p.split('.')){v=v&&typeof v==='object'?v[k]:undefined;}if(v!==undefined&&v!==null&&v!=='')return v;}return null;};

// Payment evidence must be explicit. Any negative word in any status-like field wins (pending, unpaid, refund…);
// a generic topic such as "order.created" or a bare amount is never evidence of a paid sale.
const negative=/unpaid|pend|aguard|await|waiting|process|refus|recus|reject|rejeit|reprov|declin|denied|negad|fail|falh|error|erro\b|invalid|block|bloque|suspen|hold|expir|abandon|refund|reembols|estorn|chargeback|cancel|disput|contest|void|revers|partial/;
// A negation in front of a positive word is negative: not_approved, nao_pago, unconfirmed, incomplete, disapproved.
const negated=/(not|nao|non|no|un|in|dis|des)[_ .-]?(paid|pag|approv|aprov|complet|conclu|confirm)/;
const positive=new Set(['paid','approved','aprovado','aprovada','pago','paga','completed','concluido','concluida','confirmed','confirmado','confirmada']);
const plain=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const statusPaths={body:['topic','event','type','status','order.status','payment.status'],data:['topic','event','type','status','order.status','payment.status','paymentStatus','payment_status','transaction.status','financial_status']};
const statusFields=(body,d)=>[...statusPaths.body.map(p=>pick(body,[p])),...(d===body?[]:statusPaths.data.map(p=>pick(d,[p]))),...(d===body?statusPaths.data.map(p=>pick(d,[p])):[])].filter(v=>typeof v==='string'&&v.trim()).map(plain);

/** 'paid' only with an explicit paid status or topic and no negative status; otherwise the reason it is not a sale. */
export function paymentEvidence(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return {paid:false,reason:'formato'};
 const d=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;
 if([body,d,d.order,d.payment].some(o=>o&&typeof o==='object'&&o.paid===false))return {paid:false,reason:'não pago'};
 const values=statusFields(body,d);
 if(values.some(v=>negative.test(v)||negated.test(v)))return {paid:false,reason:'não pago'};
 if(!values.some(v=>v.split(/[^a-z0-9]+/).some(t=>positive.has(t))))return {paid:false,reason:'sem prova de pagamento'};
 return {paid:true};
}

/** Every project id the payload carries, in the envelope and in data (and its order); more than one distinct value
 * is ambiguous. A project given as an object without an id is ignored, not guessed. */
const projectPaths=['projectId','project_id','project.id','project'];
const projectIds=(body,d)=>[...new Set([body,d,d&&typeof d.order==='object'?d.order:null].filter(Boolean).flatMap(o=>projectPaths.map(p=>pick(o,[p]))).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim().slice(0,80)))];

/** Normalized sale, or null when the body is not a paid sale (refunds, pending, unpaid and other topics are ignored). */
export function normalizeSale(body,now=Date.now()){
 if(!paymentEvidence(body).paid)return null;
 const d=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;
 const amount=num(pick(d,['amount','value','total','price','revenue','order.amount','order.total','order.value','payment.amount','commission.value']));
 if(amount===null||amount<=0||amount>1e7)return null;
 const atRaw=str(pick(d,['paidAt','approvedAt','createdAt','created_at','at','timestamp','order.paidAt']),40),at=Number.isFinite(Date.parse(atRaw||''))?new Date(Date.parse(atRaw)).toISOString():new Date(now).toISOString();
 const items=Array.isArray(d.items)?d.items:Array.isArray(d.products)?d.products:[];
 const order=str(pick(d,['orderId','order_id','order.id','id','transaction','transactionId']),80);
 const projects=projectIds(body,d);
 return {amount:Math.round(amount*100)/100,currency:(str(pick(d,['currency','order.currency']),3)||'').toUpperCase()||null,
  product:str(pick(d,['product.name','productName','offer.name','offerName']))||str(items[0]?.name)||null,
  campaign:str(pick(d,['utm_campaign','utm.campaign','utms.utm_campaign','tracking.utm_campaign','attribution.campaign','campaign.name','campaign'])),
  project:projects.length===1?projects[0]:projects.length?'ambiguous':null,at,orderRef:order};
}

export const projectPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/;
/** Ties a sale to the project of the webhook address. The address is the authority: a payload that names another
 * project, or several, is refused; a sale without an order id is refused because a retry could not be recognized. */
export function bindSale(sale,project){
 if(typeof project!=='string'||!projectPattern.test(project))return {error:'projeto ausente no endereço'};
 if(!sale)return {error:'não é venda paga'};
 if(sale.project==='ambiguous')return {error:'projeto ambíguo no pedido'};
 if(sale.project&&sale.project!==project)return {error:'projeto do pedido diferente do endereço'};
 if(!sale.orderRef)return {error:'pedido sem identificação'};
 return {sale:{...sale,project}};
}

/** SHA-256 of project + order id (first 16 hex): dedupes retries per project without keeping the order id itself. */
export async function orderRef(id,project=''){
 if(!id)return null;const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(project+'\u0000'+id)));
 return [...h.slice(0,8)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** Adds a sale to the recent list: newest first, no duplicate order within a project, bounded. */
export function addSale(list,sale){
 const prev=Array.isArray(list)?list:[];
 if(sale.orderRef&&prev.some(s=>s.orderRef===sale.orderRef&&s.project===sale.project))return {list:prev,added:false};
 return {list:[sale,...prev].slice(0,salesFeedLimits.keep),added:true};
}

/** What the notch gets: the recent sales of a scope (projects are matched by Malva project id; a sale without a
 * project never reaches a project view). */
export function salesView(list,{project='all',now=Date.now()}={}){
 const recent=(Array.isArray(list)?list:[]).filter(s=>project==='all'||(typeof s.project==='string'&&s.project===project));
 const since=now-3600000;
 return {recent:recent.slice(0,10).map(({orderRef:_o,...s})=>s),lastHour:recent.filter(s=>Date.parse(s.at)>=since).length};
}
