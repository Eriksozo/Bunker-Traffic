import test from 'node:test';
import assert from 'node:assert/strict';
import {nameDateOffset,newCampaignStage,first24hGuard,first24hPolicy} from '../lib/first-24h.mjs';

// Synthetic fixtures only.
const now=Date.parse('2026-11-08T02:00:00Z'); // 23:00 of 07/11 in America/Sao_Paulo
const row=(name,extra={})=>({externalId:'c1',adAccountId:'a1',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0,impressions:0,...extra});

test('Name dates resolve against the local day, including the year boundary',()=>{
 assert.equal(nameDateOffset('08/11 - [CBO] X',now),1);
 assert.equal(nameDateOffset('07/11 - [CBO] X',now),0);
 assert.equal(nameDateOffset('+06/11 [TESTE]',now),-1);
 assert.equal(nameDateOffset('2026_10_17 X',now),null);
 assert.equal(nameDateOffset('31/12 X',Date.parse('2027-01-01T15:00:00Z')),-1);
 assert.equal(nameDateOffset('01/01 X',Date.parse('2026-12-31T15:00:00Z')),1);
 assert.equal(nameDateOffset('32/13 X',now),null);
});
test('Overnight scheduling: dated ahead without delivery is scheduled, never "no delivery"',()=>{
 const s=newCampaignStage(row('08/11 - [ABO] - [LEAN] - [COSTCAP] - [1-3-1]'),{},{now});
 assert.equal(s.stage,'scheduled');assert.equal(s.startsOn,'08/11');
 assert.equal(newCampaignStage(row('07/11 - [CBO] X'),{},{now}).stage,'first-day');
 assert.equal(newCampaignStage(row('07/11 - [CBO] X'),{},{now}).awaitingDelivery,true);
 assert.equal(newCampaignStage(row('07/11 - [ENGAJAMENTO]'),{},{now}),null);
 assert.equal(newCampaignStage(row('25/11 - [CBO] longe'),{},{now}),null,'beyond the schedule horizon');
});
test('Earlier spend wins over a renamed date; older non-test campaigns are not new',()=>{
 const spent={...row('07/11 - [CBO] X'),spend:120};
 assert.equal(newCampaignStage({...row('07/11 - [CBO] X'),spend:30},{'7d':spent},{now}),null);
 assert.equal(newCampaignStage({...row('20/10 - [CBO] [ESCALA]'),spend:30},{},{now,noSpendPeriods:['7d','3d','yesterday']}),null);
 assert.equal(newCampaignStage({...row('20/10 - [CBO] [TESTE] X'),spend:30},{},{now,noSpendPeriods:['7d','3d','yesterday']}).stage,'first-day');
 const y={...row('06/11 - [CBO] X'),spend:70};
 assert.equal(newCampaignStage({...row('06/11 - [CBO] X'),spend:20},{yesterday:y,'3d':y,'7d':y},{now}).stage,'second-day');
});
test('Guard: the owner ceiling applies to 0 and 1 IC; 2+ IC uses the project threshold; a sale clears it',()=>{
 const g=(spend,checkouts,params={},sales=0)=>first24hGuard({spend,checkouts,frontOrders:sales,orders:sales,revenueNet:sales*297},params);
 assert.equal(first24hPolicy.lowIcSpendLimitBrl,110);
 assert.deepEqual([g(60,0).level,g(80,0).level,g(99,1).level,g(110,1).level],['watch','alert','pause','over']);
 assert.equal(g(150,2).level,'watch');assert.equal(g(150,2).limit,null);
 assert.equal(g(210,2,{pauseTestMinSpend:200}).level,'over');
 assert.equal(g(150,1,{},1).level,'sold');
 assert.equal(g(0,0).level,'waiting');
 assert.equal(g(100,null).basis,'ic-unknown');
 assert.equal(first24hGuard({spend:200,checkouts:0,frontOrders:null,orders:null,revenueNet:null}).level,'watch','unknown sales stay N/D, never zero');
});
