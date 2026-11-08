import test from 'node:test';
import assert from 'node:assert/strict';
import {activityLog,metaSystemActor} from '../lib/campaign-activity.mjs';
// Synthetic campaign reads: only states Meta itself sets get Meta as the author.
const change=(id,field,before,after,at)=>({id,project:'p',adAccountId:'a',objectId:'c',name:'C',accountName:'CA',observedAt:at,previousObservedAt:new Date(Date.parse(at)-600000).toISOString(),changes:[{field,before,after}],before:{budgetCurrency:'USD'},after:{budgetCurrency:'USD'}});
test('processing and review transitions are Meta; a pause or budget read without history keeps no invented author',()=>{
 assert.equal(metaSystemActor({field:'effectiveStatus',before:'ACTIVE',after:'in_process'}),'Meta');
 assert.equal(metaSystemActor({field:'status',before:'processing',after:'ACTIVE'}),'Meta');
 assert.equal(metaSystemActor({field:'status',before:'ACTIVE',after:'PAUSED'}),null);
 assert.equal(metaSystemActor({field:'dailyBudget',before:10,after:20}),null);
 const state={campaignChanges:[
  change('1','effectiveStatus','ACTIVE','IN_PROCESS','2026-11-07T13:40:00.000Z'),
  change('2','effectiveStatus','IN_PROCESS','ACTIVE','2026-11-07T14:20:00.000Z'),
  change('3','status','ACTIVE','PAUSED','2026-11-07T15:00:00.000Z')]};
 const log=activityLog(state,{now:Date.parse('2026-11-07T16:00:00.000Z')});
 const by=Object.fromEntries(log.map(e=>[e.id.split(':')[1],e]));
 // Active ↔ in process is Meta applying an edit: neither an extra entry nor a false activation.
 assert.equal(by['1'],undefined);assert.equal(by['2'],undefined);
 assert.equal(by['3'].actor,null);assert.match(by['3'].source,/autor não informado/);
 const review=activityLog({campaignChanges:[change('4','effectiveStatus','ACTIVE','PENDING_REVIEW','2026-11-07T15:30:00.000Z')]},{now:Date.parse('2026-11-07T16:00:00.000Z')});
 assert.equal(review.length,1);assert.equal(review[0].actor,'Meta','review and other Meta states stay visible');
});
test('A budget edit followed by Meta processing shows once, with the person who edited',()=>{
 const state={changeAttributions:[{key:'k1',project:'p',adAccountId:'a',objectId:'c',name:'C',field:'dailyBudget',before:92.72,after:185.44,currency:'USD',at:'2026-11-08T02:27:10.000Z',actor:'Gestor X'},
  {key:'k2',project:'p',adAccountId:'a',objectId:'c',name:'C',field:'effectiveStatus',before:'ACTIVE',after:'IN_PROCESS',at:'2026-11-08T02:27:12.000Z',actor:'Meta'}]};
 const log=activityLog(state,{now:Date.parse('2026-11-08T02:30:00.000Z')});
 assert.deepEqual(log.map(e=>[e.action,e.actor]),[['increase','Gestor X']]);
});
