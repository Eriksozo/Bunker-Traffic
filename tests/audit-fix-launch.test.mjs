import test from 'node:test';
import assert from 'node:assert/strict';
import {testLaunchContext} from '../lib/test-launch.mjs';
import {nameDateOffset,newCampaignStage} from '../lib/first-24h.mjs';

const now=Date.parse('2026-11-07T15:00:00Z'); // 07/11 12:00 BRT
const row=name=>({provider:'meta',level:'campaign',name,adAccountId:'act_1',externalId:'c1',effectiveStatus:'ACTIVE',status:'ACTIVE',spend:150,frontOrders:0,orders:0,revenueNet:0});

test('a "+DD/MM" or non-space separated name dated today gets the same priority review as "DD/MM "',()=>{
 for(const name of ['07/11 [TESTE] X','+07/11 [TESTE] X','07/11-[TESTE] X','  +07/11 [TESTE] X']){
  const c=testLaunchContext(row(name),{},{now});
  assert.equal(c.eligible,true,name);assert.equal(c.priority,true,name);assert.equal(c.basis,'name-unconfirmed',name);
  assert.equal(c.canExecute,false);assert.equal(c.automaticPause,false);
  assert.equal(newCampaignStage(row(name),{},{now})?.stage,'first-day',name);
 }
});

test('namedToday matches nameDateOffset()===0 for every name form, including invalid and other days',()=>{
 const names=['07/11 [TESTE] X','+07/11 [TESTE] X','07/11-[TESTE] X','07/11','+07/11','07/11/2026 [TESTE]','071/1 [TESTE]','06/11 [TESTE] X','+08/11 [TESTE] X','32/11 [TESTE]','07/13 [TESTE]','[TESTE] 07/11','++07/11 [TESTE]','x07/11 [TESTE]'];
 for(const name of names){
  const c=testLaunchContext(row(name.includes('TESTE')?name:`${name} [TESTE]`),{},{now});
  const n=name.includes('TESTE')?name:`${name} [TESTE]`;
  assert.equal(c.basis==='name-unconfirmed',nameDateOffset(n,now)===0,n);
 }
});

test('a "+DD/MM" name never overrides earlier spend, and N/D history with no name date stays ineligible',()=>{
 const r=row('+07/11 [TESTE] X');
 const prior=testLaunchContext(r,{yesterday:{...r,spend:20,frontOrders:0}},{now});
 assert.equal(prior.eligible,false);
 const unnamed=testLaunchContext(row('[TESTE] X'),{},{now});
 assert.equal(unnamed.eligible,false);assert.equal(unnamed.priority,false);
});

test('a "+DD/MM" name dated yesterday is not read as today',()=>{
 const c=testLaunchContext(row('+06/11 [TESTE] X'),{},{now});
 assert.equal(c.eligible,false);
});
