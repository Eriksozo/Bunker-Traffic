import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastCampaign,campaignHistoryTrend} from '../lib/campaign-forecast.mjs';
const now=Date.parse('2026-11-04T12:00:00Z'),stamp=delta=>new Date(now+delta).toISOString();
function setup(){
 const card={project:'p',row:{adAccountId:'a',externalId:'c',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'USD',dailyBudget:500},observedRow:{status:'ACTIVE',effectiveStatus:'ACTIVE'},liveStale:false,liveAt:stamp(-1000),liveToday:{from:'2026-11-04T00:00:00Z',to:'2026-11-05T00:00:00Z',timezone:'UTC'},windows:{'7d':{from:'2026-10-28T00:00:00Z',to:'2026-11-04T00:00:00Z',timezone:'UTC',spend:1000,frontOrders:60},'3d':{from:'2026-11-01T00:00:00Z',to:'2026-11-04T00:00:00Z',timezone:'UTC',spend:300,frontOrders:30}}};
 const history=Array.from({length:6},(_,i)=>({day:new Date(Date.parse('2026-10-29T00:00:00Z')+i*86400000).toISOString().slice(0,10),spend:100,orders:5,revenueNet:150+i*20,profit:-10+i*20}));
 const item={target:{projectId:'p',adAccountId:'a',objectId:'c',timezone:'UTC'},snapshot:{source:'Malva MCP',currency:'BRL',timezone:'UTC',from:'2026-10-29',to:'2026-11-04',fetchedAt:stamp(0),lastSyncAt:null,rows:[...history,{day:'2026-11-04',spend:50,orders:2,revenueNet:90,profit:30}]}};
 return {card,item,state:{},now};
}
test('Conditional scenarios preserve actuals, correct remaining-day pacing and paired financial anchors',()=>{
 const input=setup(),before=JSON.stringify(input),p=forecastCampaign(input);assert.equal(p.status,'scenario');assert.equal(p.scenarios.length,3);assert.equal(p.scenarios[1].spend,100);assert.equal(p.canExecute,false);assert.equal(p.historyDays,6);assert.equal(p.confidence,'Limitada · modelo experimental');assert.ok(p.warnings.some(w=>w.includes('upsells')));assert.equal(JSON.stringify(input),before);
 for(const s of p.scenarios){assert.ok(s.orders>=p.observed.orders);assert.ok(s.revenueNet>=p.observed.revenueNet);assert.equal(s.roas,s.revenueNet/s.spend);assert.ok(s.spend>=p.observed.spend);assert.equal(s.probability,undefined);assert.equal(s.roi,undefined);}
 assert.ok(p.scenarios[0].profit<=p.scenarios[1].profit&&p.scenarios[1].profit<=p.scenarios[2].profit);
});
test('Trend uses disjoint 3d and previous 4d acquisition rather than adding overlapping windows',()=>{
 const {card}=setup(),t=campaignHistoryTrend(card);assert.equal(t.kind,'improving');assert.ok(t.change<-50);card.windows['3d'].frontOrders=3;assert.equal(campaignHistoryTrend(card).kind,'unknown');
});
test('Duplicate, impossible, stale or misaligned windows never become an acquisition trend',()=>{
 for(const modify of [c=>c.windows['7d'].frontOrders=10,c=>c.windows['7d'].spend=100,c=>c.windows['3d'].to='2026-11-03T00:00:00Z',c=>c.windows['7d'].from='2026-10-20T00:00:00Z']){const {card}=setup();modify(card);assert.equal(campaignHistoryTrend(card).kind,'unknown');}
});
test('Unknown fields stay unavailable, never manufactured zeros',()=>{
 for(const field of ['spend','orders','revenueNet','profit']){const x=setup();x.item.snapshot.rows.at(-1)[field]=null;const p=forecastCampaign(x);assert.equal(p.status,'unavailable');assert.equal(p.scenarios.length,0);}
});
test('Cold start, tiny spend and insufficient history withhold forecasts',()=>{
 for(const mode of ['early','tiny','history','orders']){const x=setup();if(mode==='early'){x.now=Date.parse('2026-11-04T01:00:00Z');x.card.liveAt=x.item.snapshot.fetchedAt=new Date(x.now).toISOString();}if(mode==='tiny')x.item.snapshot.rows.at(-1).spend=1;if(mode==='history')x.item.snapshot.rows=x.item.snapshot.rows.slice(-3);if(mode==='orders')x.item.snapshot.rows.forEach(r=>r.orders=0);assert.equal(forecastCampaign(x).status,'unavailable');}
});
test('Recent changes, unreviewed native drift and matching incidents suspend extrapolation',()=>{
 for(const mode of ['edit','native','incident']){const x=setup();if(mode==='edit')x.state.campaignChanges=[{project:'p',adAccountId:'a',objectId:'c',observedAt:stamp(-10000)}];if(mode==='native')x.card.liveDrift={changes:[{field:'dailyBudget'}]};if(mode==='incident')x.state.incidents=[{project:'p',status:'Em retomada',scope:{}}];assert.equal(forecastCampaign(x).status,'unavailable');}
});
test('Same Meta id in another account/project cannot borrow either history or incident',()=>{
 for(const field of ['projectId','adAccountId','objectId']){const x=setup();x.item.target[field]='foreign';assert.equal(forecastCampaign(x).status,'unavailable');}
 const x=setup();x.state.incidents=[{project:'p',status:'Em retomada',scope:{accountIds:['foreign']}}];x.state.campaignChanges=[{project:'foreign',adAccountId:'a',objectId:'c',observedAt:stamp(-1000)}];assert.equal(forecastCampaign(x).status,'scenario');
});
test('Freshness, source, confirmed status, currency and pause are enforced independently',()=>{
 for(const mutate of [x=>x.item.snapshot.fetchedAt=stamp(-301000),x=>x.card.liveAt=stamp(-301000),x=>x.item.snapshot.fetchedAt=stamp(1000),x=>x.item.snapshot.source='other',x=>x.item.snapshot.currency='USD',x=>x.item.target.timezone='America/Sao_Paulo',x=>x.card.observedRow.status='PAUSED',x=>x.card.observedRow.accountStatus={active:false},x=>x.state.paused=true,x=>x.error='Failed to fetch']){const x=setup();mutate(x);assert.equal(forecastCampaign(x).status,'unavailable');}
});
test('Day rollover, invalid and duplicate daily dates never reuse yesterday as today',()=>{
 for(const mutate of [x=>x.item.snapshot.to='2026-11-03',x=>x.item.snapshot.rows.push({...x.item.snapshot.rows[0]}),x=>x.item.snapshot.rows[0].day='2026-10-99',x=>x.card.liveToday.to='2026-11-04T00:00:00Z']){const x=setup();mutate(x);assert.equal(forecastCampaign(x).status,'unavailable');}
});
test('Days without spend are not zero-efficiency failures or extra history',()=>{
 const x=setup();x.item.snapshot.rows[0].spend=0;const p=forecastCampaign(x);assert.equal(p.historyDays,5);assert.equal(p.status,'scenario');assert.ok(p.scenarios.every(s=>s.referenceDay!==x.item.snapshot.rows[0].day));
});
test('Losses and zero sales remain possible scenarios, never forced to profitability',()=>{
 const x=setup();x.item.snapshot.rows.forEach(r=>{r.revenueNet=0;r.profit=-r.spend-5;});x.item.snapshot.rows.at(-1).orders=0;const p=forecastCampaign(x);assert.equal(p.status,'scenario');assert.ok(p.scenarios.every(s=>s.profit<0&&s.revenueNet===0&&s.roas===0));
});
test('DST uses the real 25-hour local day without assuming workstation timezone',()=>{
 const x=setup();x.now=Date.parse('2026-10-25T11:00:00Z');x.card.liveAt=x.item.snapshot.fetchedAt=new Date(x.now).toISOString();
 x.card.liveToday.from='2026-10-24T22:00:00Z';x.card.liveToday.to='2026-10-25T23:00:00Z';
 x.card.liveToday.timezone=x.item.target.timezone=x.item.snapshot.timezone='Europe/Paris';
 const shifted=d=>new Date(Date.parse(d+'T00:00:00Z')-10*86400000).toISOString().slice(0,10);
 x.item.snapshot.from=shifted(x.item.snapshot.from);x.item.snapshot.to=shifted(x.item.snapshot.to);x.item.snapshot.rows.forEach(r=>r.day=shifted(r.day));
 const p=forecastCampaign(x);assert.equal(p.status,'scenario');assert.ok(Math.abs(p.scenarios[0].spend-50*25/13)<.00001);
});
