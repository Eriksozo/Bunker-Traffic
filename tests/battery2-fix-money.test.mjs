import test from 'node:test';
import assert from 'node:assert/strict';
import {recordDirectOrder,pruneDirectOrders,directOrderBudget} from '../lib/owner-direct-order.mjs';
import {claimExecution,prepareExecution,submitExecution,confirmExecution,failExecution,executionLimits} from '../lib/execution.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';

const date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111',owner='mac-touchid:0123456789abcdef';
const row=(i=1,c={})=>({id:'22222222-2222-4222-8222-'+String(i).padStart(12,'0'),externalId:'1200000000'+String(i).padStart(8,'0'),adAccountId:'33333333-3333-4333-8333-333333333333',provider:'meta',name:'C'+i,accountName:'Acc',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',accountStatus:{active:true},...c});
const obs=(r,at)=>({source:'Malva MCP',complete:true,projectId:project,level:'campaign',fetchedAt:date(at),rows:[r]});
const fresh=()=>({config:{[project]:{projectName:'T'}},paused:false,proposals:[],executions:[]});
const order=(s,i,input,at)=>{const r=row(i);return recordDirectOrder(s,{op:'ownerDirectOrder',revision:0,project,adAccountId:r.adAccountId,objectId:r.externalId,expected:{status:'ACTIVE',dailyBudget:100,currency:'USD'},...input},owner,{live:{row:r,fetchedAt:date(at-1000)},now:at});};

test('A failure before dispatch with attempts left stays pending: the receipt does not say "Não enviada" and a second order waits',()=>{
 const s=fresh(),now=Date.parse('2026-11-08T12:00:00Z');
 const a=order(s,1,{clientId:'notch-A-000001',action:'increase',percent:50,after:{dailyBudget:150}},now);
 const e=claimExecution(s,{proposalId:a.id,version:1,signature:a.signature,clientId:'c1',executionRef:'cf:x'},now+1000);
 failExecution(s,{id:e.id,claimId:e.claimId,executionRef:'cf:x',clientId:'f1',reason:'pre-dispatch failure'},now+2000);
 const [r]=ownerOrderReceipts(s,{now:now+3000});
 assert.equal(r.stage,'checking');assert.match(r.label,/nova tentativa/);assert.notEqual(r.label,'Não enviada');
 assert.throws(()=>order(s,1,{clientId:'notch-B-000001',action:'pause'},now+60000),e=>e.code==='DIRECT_ORDER_PENDING');
});

test('Attempts exhausted or the order expired: the receipt is final and a new order is accepted',()=>{
 const s=fresh(),now=Date.parse('2026-11-08T12:00:00Z');
 const a=order(s,1,{clientId:'notch-A-000002',action:'pause'},now);
 s.executions.unshift({id:'e',proposalId:a.id,status:'Falhou',attempt:executionLimits.attempts,claimedAt:date(now+1000),leaseUntil:date(now+1000)});
 const [r]=ownerOrderReceipts(s,{now:now+2000});assert.equal(r.stage,'failed');assert.match(r.label,/esgotadas/);
 assert.equal(order(s,1,{clientId:'notch-B-000002',action:'pause'},now+3000).status,'Aprovada');
 const t=fresh(),b=order(t,2,{clientId:'notch-C-000003',action:'pause'},now);
 t.executions.unshift({id:'e2',proposalId:b.id,status:'Falhou',attempt:1,claimedAt:date(now+1000),leaseUntil:date(now+1000)});
 assert.equal(ownerOrderReceipts(t,{now:now+16*60000})[0].stage,'expired');
});

test('Pruned direct orders take their executions with them: the executor limit is not filled by orphans',()=>{
 const s=fresh();let t=Date.parse('2026-01-01T12:00:00Z');
 for(let i=0;i<executionLimits.max;i++){
  t+=2*3600000;const r=row(i),p=order(s,i,{clientId:'notch-owner-'+String(i).padStart(8,'0'),action:'pause'},t);
  const e=claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'c'+i,executionRef:'cf'},t+1000),L={id:e.id,claimId:e.claimId,executionRef:'cf'};
  prepareExecution(s,{...L,clientId:'p'+i,observation:obs(r,t+1500)},t+2000);submitExecution(s,{...L,clientId:'s'+i},t+2500);
  confirmExecution(s,{id:e.id,executionRef:'cf',clientId:'k'+i,observation:obs(row(i,{status:'PAUSED'}),t+3000)},t+3500);
 }
 s.executions.push({id:'team',proposalId:'round-proposal',status:'Confirmada'});
 t+=8*24*3600000;pruneDirectOrders(s,t);
 assert.equal(s.proposals.length,0);assert.deepEqual(s.executions.map(e=>e.id),['team'],'only executions of other proposals stay');
 const p=order(s,999,{clientId:'notch-owner-new00001',action:'pause'},t);
 assert.equal(claimExecution(s,{proposalId:p.id,version:1,signature:p.signature,clientId:'cnew',executionRef:'cf'},t+1000).status,'Reservada');
});

test('A direct order budget above the accepted ceiling is refused',()=>{
 assert.throws(()=>directOrderBudget(5e8,'increase',1000),e=>e.code==='DIRECT_ORDER_PERCENT');
 assert.equal(directOrderBudget(100,'increase',50),150);
});

test('The owner route answers a resent order from its receipt before any live read or contingency check',async()=>{
 const src=await import('node:fs').then(fs=>fs.readFileSync(new URL('../app/api/companion/owner/route.ts',import.meta.url),'utf8'));
 const replay=src.indexOf('p.clientId===input.clientId'),live=src.indexOf('readLiveData(storage()'),guard=src.indexOf('decisionContingency({');
 assert.ok(replay>0&&replay<live&&replay<guard,'replay check comes first');
 assert.doesNotMatch(src,/'Contingência: '\+guard\.blockers/);
});
