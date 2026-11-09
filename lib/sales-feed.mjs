/** Real-time sales from a Malva outbound webhook (owner request of 2026-11-07). A sale is information only:
 * it never proposes, approves or executes anything. Only the amount, currency, product, campaign label, project
 * and time are kept; buyer data (name, e-mail, phone, document, address) is never read into the feed.
 * The Malva payload shape is not documented here, so fields are looked up defensively and missing ones stay N/D. */
export const salesFeedLimits=Object.freeze({bodyBytes:64000,keep:40,seen:1000,text:120});
const str=(v,max=salesFeedLimits.text)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):null;
// Text amounts: plain ("297", "297,00", "49.9", "1297.000"), Brazilian ("R$ 1.297,00", "1.297.000") or with both
// separators ("1,297.00"). A lone separator before three digits after 1-3 digits ("1.297", "1,297") is thousands or
// decimal: ambiguous, so N/D instead of a misread value. Anything else unparseable is N/D too, never 0.
const grouped=(int,sep,dec)=>(dec!==undefined||int.split(sep).length>2)?Number(int.split(sep).join('')+'.'+(dec||'0')):NaN;
const amountText=v=>{const s=v.trim().replace(/^R\$\s*/i,'');let m;
 if(/^\d+$/.test(s))return Number(s);
 if((m=/^(\d+)[.,](\d{1,2})$/.exec(s)||/^(\d{4,}|0)[.,](\d{3})$/.exec(s)))return Number(m[1]+'.'+m[2]);
 if((m=/^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s)))return grouped(m[1],'.',m[2]);
 if((m=/^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(s)))return grouped(m[1],',',m[2]);
 return NaN;};
const num=v=>{const n=typeof v==='string'?amountText(v):v;return typeof n==='number'&&Number.isFinite(n)?n:null;};
// Order ids may come as numbers; they are kept as text, never as a measure.
const ref=(v,max)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?String(v):str(v,max);
const pick=(o,paths)=>{for(const p of paths){let v=o;for(const k of p.split('.')){v=v&&typeof v==='object'?v[k]:undefined;}if(v!==undefined&&v!==null&&v!=='')return v;}return null;};

// Payment evidence must be explicit. Any negative word in any status-like field wins (pending, unpaid, refund,
// chargedback/charged_back, devolvido, protested, overdue/vencido, delayed, under analysis…);
// a generic topic such as "order.created" or a bare amount is never evidence of a paid sale.
const negative=/unpaid|pend|aguard|await|waiting|process|refus|recus|reject|rejeit|reprov|declin|denied|negad|fail|falh|error|erro\b|invalid|block|bloque|suspen|hold|expir|abandon|refund|reembols|estorn|charged?[_ .-]?back|devol|protest|overdue|past[_ .-]?due|vencid|atrasad|delay|inadimpl|analis|analys|no[_ .-]?funds|insufficien|insuficien|cancel|disput|contest|void|revers|partial/;
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

const atPaths=['paidAt','paid_at','approvedAt','approved_at','order.paidAt','order.paid_at','order.approvedAt','payment.paidAt','payment.paid_at','payment.approvedAt','createdAt','created_at','at','timestamp'];
/** Normalized sale, or null when the body is not a paid sale (refunds, pending, unpaid and other topics are ignored). */
export function normalizeSale(body,now=Date.now()){
 if(!paymentEvidence(body).paid)return null;
 const d=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;
 const amount=num(pick(d,['amount','value','total','price','revenue','order.amount','order.total','order.value','payment.amount','commission.value']));
 if(amount===null||amount<=0||amount>1e7)return null;
 // A payment time ahead of the receiving clock (beyond small skew) is not trusted: the sale counts as received now.
 // Payment time wins over creation time: the first parseable one in this order.
 const atRaw=atPaths.map(p=>str(pick(d,[p]),40)).find(v=>v&&Number.isFinite(Date.parse(v))),atMs=Date.parse(atRaw||''),at=new Date(Number.isFinite(atMs)&&atMs<=now+300000?atMs:now).toISOString();
 const items=Array.isArray(d.items)?d.items:Array.isArray(d.products)?d.products:[];
 const order=ref(pick(d,['orderId','order_id','order.id','id','transaction','transactionId']),80);
 const projects=projectIds(body,d),currency=(str(pick(d,['currency','order.currency']),10)||'').toUpperCase();
 return {amount:Math.round(amount*100)/100,currency:/^[A-Z]{3}$/.test(currency)?currency:null,
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

/** The stored feed is the array of the last 40 sales shown, carrying `seen`: [project, orderRef, atMs] of the last
 * 1000 sales, newest first, so a retry after 40 other sales is still recognized and the last-hour count is not capped
 * at the rows shown. `seen` is an own property of the array (kept by the Durable Object's structured clone, ~70 KB at
 * most); a feed stored before it existed, or that lost it, falls back to its rows. */
const seenOf=list=>Array.isArray(list?.seen)?list.seen.filter(e=>Array.isArray(e)&&e.length===3):(Array.isArray(list)?list:[]).filter(s=>s&&typeof s==='object').map(s=>[s.project??null,s.orderRef??null,Date.parse(s.at)]);
/** Adds a sale to the recent list: newest first, no duplicate order within a project, bounded. */
export function addSale(list,sale){
 const prev=Array.isArray(list)?list:[],seen=seenOf(prev),project=sale.project??null;
 if(sale.orderRef&&(seen.some(e=>e[1]===sale.orderRef&&e[0]===project)||prev.some(s=>s?.orderRef===sale.orderRef&&(s.project??null)===project)))return {list:prev,added:false};
 const next=[sale,...prev].slice(0,salesFeedLimits.keep),t=Date.parse(sale.at);
 next.seen=[[project,sale.orderRef??null,Number.isFinite(t)?t:null],...seen].slice(0,salesFeedLimits.seen);
 return {list:next,added:true};
}

/** What the notch gets: the recent sales of a scope (projects are matched by Malva project id; a sale without a
 * project never reaches a project view). */
export function salesView(list,{project='all',now=Date.now()}={}){
 const mine=p=>project==='all'||(typeof p==='string'&&p===project);
 const recent=(Array.isArray(list)?list:[]).filter(s=>s&&typeof s==='object'&&mine(s.project));
 const since=now-3600000;
 return {recent:recent.slice(0,10).map(({orderRef:_o,...s})=>s),lastHour:seenOf(list).filter(e=>mine(e[0])&&e[2]>=since).length};
}
