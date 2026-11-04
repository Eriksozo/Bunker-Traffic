import test from 'node:test';
import assert from 'node:assert/strict';
import {postEditObservation,validateResearchDetail} from '../lib/cloud-research.mjs';
const row={id:'internal',externalId:'123',adAccountId:'account',projectId:'project',provider:'meta',level:'campaign'},project={id:'project',timezone:'America/Sao_Paulo',currency:'BRL'};
function fixture(){return {history:{truncated:true,items:[{id:'budget',category:'budget',at:'2026-11-04T14:14:00.000Z',object:{level:'campaign',externalId:'123'}}]},detail:{intraday:{currency:'BRL',fetchedAt:'2026-11-04T16:30:00.000Z',period:{timezone:project.timezone,from:'2026-11-04T03:00:00.000Z',to:'2026-11-05T03:00:00.000Z',days:['2026-11-04']},hourly:Array.from({length:24},(_,hour)=>({hour,spend:hour,orders:1,revenueNet:20,profit:20-hour}))}}};}
test('post-edit reading excludes the straddling edit hour, open hour and all pre-edit acquisition',()=>{
 const f=fixture(),before=structuredClone(f);f.detail.intraday.hourly[11].spend=10000;f.detail.intraday.hourly[13].spend=10000;
 const result=postEditObservation(f,row);assert.equal(result.available,true);assert.equal(result.hours,1);assert.equal(result.spend,12);assert.equal(result.orders,1);assert.equal(result.profit,8);assert.equal(result.frontOrders,null);assert.equal(result.from,'2026-11-04T15:00:00.000Z');assert.equal(result.to,'2026-11-04T16:00:00.000Z');assert.equal(result.historyIncomplete,true);assert.equal(result.causality,'Não demonstrada');assert.equal(f.history.items[0].at,before.history.items[0].at);
});
test('multi-day hourly aggregates, absent currencies and partial hours never become post-edit evidence',()=>{
 const f=fixture();f.detail.intraday.period.days.push('2026-11-03');assert.equal(postEditObservation(f,row).available,false);
 for(const mutate of [x=>delete x.detail.intraday.currency,x=>x.history.items[0].at='2026-11-04T16:14:00Z',x=>x.detail.intraday.hourly.splice(12,1),x=>x.detail.intraday.hourly.push({...x.detail.intraday.hourly[12]}),x=>x.detail.intraday.hourly[12].orders=null,x=>x.history.items[0].object.externalId='other',x=>x.detail.intraday.fetchedAt='2026-11-05T16:00:00Z']){const input=fixture();mutate(input);assert.equal(postEditObservation(input,row).available,false);}
 assert.equal(postEditObservation({detail:{hourly:fixture().detail.intraday.hourly}},row).available,false);
});
test('latest observed creative/status changes reset the eligible subset without claiming causal improvement',()=>{
 const f=fixture();f.history.items.push({category:'creative',at:'2026-11-04T15:10:00.000Z',object:{level:'campaign',externalId:'123'}});
 assert.equal(postEditObservation(f,row).available,false);
 f.detail.intraday.fetchedAt='2026-11-04T17:30:00.000Z';const result=postEditObservation(f,row);assert.equal(result.available,true);assert.equal(result.lastObservedEditAt,'2026-11-04T15:10:00.000Z');assert.equal(result.spend,13);assert.equal(result.frontOrders,null);
});
test('research identity and reporting currency must match the actual campaign/project',()=>{
 const detail={row:{...row},currency:'BRL',period:{timezone:project.timezone}};assert.equal(validateResearchDetail(detail,row,project),detail);
 for(const bad of [{...detail,row:{...row,adAccountId:'foreign'}},{...detail,row:{...row,projectId:'foreign'}},{...detail,row:{...row,externalId:'foreign'}},{...detail,currency:'USD'},{...detail,period:{timezone:'UTC'}}])assert.throws(()=>validateResearchDetail(bad,row,project),e=>e.code==='SOURCE_RESEARCH_IDENTITY');
});
