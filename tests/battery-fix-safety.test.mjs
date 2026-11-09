import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDecisionCards,recordOwnerChoice,assertSignedOrder} from '../lib/decision-cards.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
import {liveOrderRow} from '../lib/owner-order-live.mjs';
import {readMetaAccounts,redactGraphText} from '../lib/account-limits.mjs';

// Invented fixture only (no real campaign, account or amount).
const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111',owner='mac-touchid:fixture';
function fixture(){
 const base={id:'22222222-2222-4222-8222-222222222222',externalId:'fixture-campaign',adAccountId:'fixture-account',provider:'meta',name:'Fixture campaign',accountName:'Fixture account',budgetCurrency:'USD',budgetRate:5,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:2,impressions:1000,linkClicks:20,refundedRevenue:0};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Fixture',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Fixture',period,level:'campaign',source:'Malva MCP',complete:true,from:{today:'2026-11-02T03:00:00.000Z',yesterday:'2026-11-01T03:00:00.000Z','3d':'2026-10-30T03:00:00.000Z','7d':'2026-10-26T03:00:00.000Z'}[period],to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]})),paused:false};
 ensureCollaboration(state,job,now);return state;
}
const today=s=>s.snapshots.find(x=>x.period==='today');
const liveAt=(s,at,change)=>liveOrderRow([{projectId:project,error:null,snapshot:{...today(s),fetchedAt:date(at-60000),rows:today(s).rows.map(r=>({...r,...change}))}}],project,'fixture-account','fixture-campaign',at);
const cardAt=(s,at)=>buildDecisionCards(s,project,at)[0];
const ask=(s,at,extra,opts)=>{const c=cardAt(s,at);return recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,clientId:'fixture-order-'+Math.random().toString(36).slice(2,10),ownerOrder:true,...extra},owner,at,opts);};
const changed=e=>e.code==='DIRECT_ORDER_CHANGED'&&/mudou/.test(e.message);

test('#38 reduce: the notch showed 100 → 80, the live value moved to 300 before signing → refused, nothing approved', () => {
 const s=fixture(),live=liveAt(s,now,{dailyBudget:300});
 assert.throws(()=>ask(s,now,{choice:'reduce',percent:20,expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'},after:{dailyBudget:80}},{live}),e=>changed(e)&&e.detail.dailyBudget===300);
 assert.equal((s.proposals||[]).filter(p=>p.ownerOrder).length,0);assert.equal((s.ownerChoices||[]).length,0);
});

test('#38 increase: the notch showed 100 → 150, the live value moved to 1000 → refused', () => {
 const s=fixture(),live=liveAt(s,now,{dailyBudget:1000});
 assert.throws(()=>ask(s,now,{choice:'increase',percent:50,expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'},after:{dailyBudget:150}},{live}),changed);
 assert.equal((s.proposals||[]).filter(p=>p.ownerOrder).length,0);
});

test('#38 the signed value still matches: the order runs exactly what the owner saw (live and analysis)', () => {
 const later=now+2*3600000,s=fixture(),live=liveAt(s,later,{dailyBudget:120});
 const r=ask(s,later,{choice:'reduce',percent:25,expected:{status:'ACTIVE',dailyBudget:120,currency:'USD'},after:{dailyBudget:90}},{live});
 const p=s.proposals.find(x=>x.id===r.proposalId);assert.equal(r.status,'Autorizado');assert.deepEqual(p.payload.before,{dailyBudget:120});assert.deepEqual(p.payload.after,{dailyBudget:90});
 const a=fixture(),ra=ask(a,now,{choice:'increase',percent:50,expected:{status:'ACTIVE',dailyBudget:100,currency:'usd'},after:{dailyBudget:150.0000001}});
 assert.deepEqual(a.proposals.find(x=>x.id===ra.proposalId).payload.after,{dailyBudget:150});
});

test('#38 a different new budget, status or currency than the one signed is refused', () => {
 assert.throws(()=>ask(fixture(),now,{choice:'reduce',percent:20,expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'},after:{dailyBudget:70}}),changed);
 assert.throws(()=>ask(fixture(),now,{choice:'pause',expected:{status:'PAUSED',dailyBudget:100,currency:'USD'}}),changed);
 assert.throws(()=>ask(fixture(),now,{choice:'reduce',percent:20,expected:{status:'ACTIVE',dailyBudget:100,currency:'BRL'}}),changed);
 assert.throws(()=>ask(fixture(),now,{choice:'reduce',percent:20,expected:{status:'ACTIVE',dailyBudget:null,currency:'USD'}}),changed,'a missing shown budget is N/D, never a pass');
 const s=fixture(),r=ask(s,now,{choice:'pause',expected:{status:'ACTIVE',dailyBudget:null,currency:'USD'}});
 assert.deepEqual(s.proposals.find(x=>x.id===r.proposalId).payload.after,{status:'PAUSED'},'pause compares status and currency only');
});

test('#38 older Mac without expected: a budget order is refused when the live base differs from the card, never re-based', () => {
 const s=fixture(),live=liveAt(s,now,{dailyBudget:300});
 assert.throws(()=>ask(s,now,{choice:'reduce',percent:20},{live}),changed);
 const plain=fixture(),r=ask(plain,now,{choice:'reduce',percent:20});
 assert.deepEqual(plain.proposals.find(x=>x.id===r.proposalId).payload.after,{dailyBudget:80},'no drift: same behaviour as before');
 const p=fixture(),rp=ask(p,now,{choice:'pause'},{live:liveAt(p,now,{dailyBudget:300})});
 assert.equal(rp.status,'Autorizado','a pause of an ACTIVE campaign has no budget to drift');
});

test('#39 Graph error text that echoes the credential is redacted before it is stored or returned', async () => {
 const token='EAAfixtureSYNTHETICtoken123';
 for(const message of [`Malformed access token ${token}`,`Invalid token: Bearer ${token}`,`bad url ?access_token=${token}&x=1`]){
  let e;try{await readMetaAccounts(async()=>({ok:false,status:400,json:async()=>({error:{code:190,message}})}),token);}catch(x){e=x;}
  assert.equal(e.code,'META_190');assert.ok(!JSON.stringify(e.diagnostic).includes(token),message);assert.match(e.diagnostic.message,/\[redacted\]/);
 }
 assert.equal(redactGraphText('Other EAAanotherSyntheticValue99 here','x'),'Other [redacted] here','token-shaped strings go even when not the configured value');
 assert.equal(redactGraphText('Bearer abc.def',null),'Bearer [redacted]');
 assert.equal(redactGraphText('Unsupported get request for 12345',token),'Unsupported get request for 12345','other text unchanged (digit masking is applied after)');
 assert.equal(readFileSync(new URL('../supabase/functions/meta-read/account-limits.mjs',import.meta.url),'utf8'),readFileSync(new URL('../lib/account-limits.mjs',import.meta.url),'utf8'));
});

test('#38 the refusal shows a missing currency as N/D, never blank or null', () => {
 const s=fixture(),live=liveAt(s,now,{dailyBudget:300,budgetCurrency:null});
 assert.throws(()=>ask(s,now,{choice:'reduce',percent:20,expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'},after:{dailyBudget:80}},{live}),/não permitem/,'a live row without currency never reaches signing');
 assert.throws(()=>assertSignedOrder({expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'}},'reduce',{status:'ACTIVE',dailyBudget:300,budgetCurrency:null},{dailyBudget:100},{dailyBudget:240}),e=>changed(e)&&/atual: 300 N\/D\/dia, status ACTIVE/.test(e.message)&&!/null|undefined/.test(e.message)&&e.detail.currency===null);
 assert.throws(()=>assertSignedOrder({},'reduce',{status:null,dailyBudget:null,budgetCurrency:''},{dailyBudget:100},{dailyBudget:null}),e=>changed(e)&&/atual: N\/D N\/D\/dia, status N\/D/.test(e.message));
});

test('#39 follow-up: the Meta live diagnostic never keeps the token, on any Graph error code',async()=>{
 const {readMetaAccountCampaigns}=await import('../lib/meta-live.mjs');
 const token='EAAGfixtureTOKENabcXYZ123';
 const fetchImpl=async()=>new Response(JSON.stringify({error:{code:100,message:`Invalid parameter for ${token} Bearer ${token} access_token=${token}`}}),{status:400});
 const out=await readMetaAccountCampaigns(fetchImpl,token,[{account:'act_12345',ids:['12345678']}]);
 assert.ok(out.diagnostic&&!JSON.stringify(out).includes(token)&&!/EAA[A-Za-z0-9]{8,}/.test(JSON.stringify(out)),'no token text in the result');
});
