import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerOrderReceipts,ownerOrderReceiptLimits} from '../lib/owner-orders.mjs';

const now=Date.parse('2026-11-08T15:00:00.000Z'),iso=t=>new Date(t).toISOString();
const order=(id,over={})=>({id,project:'p1',ownerOrder:true,createdBy:'owner',createdAt:iso(now-60000),expiresAt:iso(now+3000000),
 payload:{objectName:'Camp '+id,accountName:'Conta',action:'budget',currency:'BRL',before:{dailyBudget:100,status:'ACTIVE'},after:{dailyBudget:80,status:'ACTIVE'}},...over});
const state=(proposals,executions=[])=>({config:{p1:{projectName:'Gabe'},p2:{projectName:'John'}},proposals,executions});

test('Every executor status maps to its receipt stage and label', () => {
 const cases=[[null,'queued'],['Reservada','checking'],['Preparada','checking'],['Enviada','sent'],['Confirmada','confirmed'],['Verificação necessária','verify'],['Falhou','checking']];
 for(const [status,stage] of cases){
  const s=state([order('a')],status?[{proposalId:'a',status,claimedAt:iso(now-30000),reason:'leitura divergente'}]:[]);
  const [r]=ownerOrderReceipts(s,{now});
  assert.equal(r.stage,stage,String(status));assert.equal(typeof r.label,'string');assert.ok(r.label.length>0);
  assert.equal(r.reason,['failed','verify'].includes(stage)?'leitura divergente':null,'reason only for failed/verify');
  if(status==='Falhou')assert.match(r.label,/nova tentativa/,'a failure before dispatch with attempts left is still pending');
 }
});

test('An approved order past its validity with no execution shows as expired, never queued', () => {
 const [r]=ownerOrderReceipts(state([order('a',{expiresAt:iso(now-1)})]),{now});
 assert.equal(r.stage,'expired');assert.equal(r.label,'Expirou sem execução');
});

test('The newest execution attempt decides the stage', () => {
 const s=state([order('a')],[{proposalId:'a',status:'Falhou',claimedAt:iso(now-50000)},{proposalId:'a',status:'Confirmada',claimedAt:iso(now-10000),confirmedAt:iso(now-5000),submittedAt:iso(now-8000)}]);
 const [r]=ownerOrderReceipts(s,{now});
 assert.equal(r.stage,'confirmed');assert.equal(r.confirmedAt,iso(now-5000));assert.equal(r.sentAt,iso(now-8000));
});

test('Only owner orders of the last day, newest first, capped, and filtered by project', () => {
 const many=Array.from({length:12},(_,i)=>order('o'+i,{createdAt:iso(now-i*60000)}));
 const others=[order('team',{ownerOrder:false}),order('agent',{createdBy:'ops'}),order('old',{createdAt:iso(now-25*3600000)}),order('bad',{createdAt:'ontem'}),order('john',{project:'p2'})];
 const list=ownerOrderReceipts(state([...others,...many]),{now});
 assert.equal(list.length,ownerOrderReceiptLimits.max);
 assert.equal(list[0].id,'o0');
 assert.ok(!list.some(r=>['team','agent','old','bad'].includes(r.id)));
 const times=list.map(r=>Date.parse(r.at));assert.deepEqual(times,[...times].sort((a,b)=>b-a));
 const john=ownerOrderReceipts(state([...others,...many]),{project:'p2',now});
 assert.deepEqual(john.map(r=>[r.id,r.projectName]),[['john','John']]);
});

test('Receipt fields: live source, N/D stays null, long reasons are cut', () => {
 const p=order('a',{payload:{action:'status',before:{},after:{status:'PAUSED'},liveTarget:{dailyBudget:100}}});
 const [r]=ownerOrderReceipts(state([p],[{proposalId:'a',status:'Verificação necessária',claimedAt:iso(now),reason:'x'.repeat(500)}]),{now});
 assert.equal(r.source,'live');assert.equal(r.currency,null);assert.equal(r.campaign,null);
 assert.deepEqual(r.before,{dailyBudget:null,status:null});assert.equal(r.after.status,'PAUSED');
 assert.equal(r.reason.length,240);
 const [n]=ownerOrderReceipts(state([order('b')],[{proposalId:'b',status:'Verificação necessária',claimedAt:iso(now),reason:{code:1}}]),{now});
 assert.equal(n.reason,null,'non-text reason is not shown');assert.equal(n.source,'analysis');
});

test('Missing or malformed state never throws', () => {
 assert.deepEqual(ownerOrderReceipts(undefined),[]);assert.deepEqual(ownerOrderReceipts({}),[]);
 const [r]=ownerOrderReceipts({proposals:[order('a')]},{now});assert.equal(r.projectName,'p1');assert.equal(r.stage,'queued');
});

test('A pre-dispatch attempt whose lease ran out never keeps saying "checking"', () => {
 const run=(order,exec)=>ownerOrderReceipts(state([order],[{proposalId:order.id,claimedAt:iso(now-700000),...exec}]),{now})[0];
 const expired=run(order('a',{expiresAt:iso(now-1000)}),{status:'Reservada',attempt:1,leaseUntil:iso(now-100000)});
 assert.equal(expired.stage,'expired','authorization gone: it will not run');
 const exhausted=run(order('b'),{status:'Preparada',attempt:3,leaseUntil:iso(now-1)});
 assert.equal(exhausted.stage,'failed','notch tone/alerts already know "failed"');
 assert.match(exhausted.label,/tentativas esgotadas/);assert.match(exhausted.reason,/nada foi enviado/);
 assert.equal(run(order('c'),{status:'Reservada',attempt:1,leaseUntil:iso(now-1)}).stage,'checking','a reclaim is still possible');
 assert.equal(run(order('d'),{status:'Reservada',attempt:3,leaseUntil:iso(now+60000)}).stage,'checking','live lease');
 assert.equal(run(order('e',{expiresAt:iso(now-1000)}),{status:'Reservada',submittedAt:iso(now-5000),leaseUntil:iso(now-1)}).stage,'sent','after dispatch only verification');
});
