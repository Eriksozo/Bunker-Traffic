import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastCampaign} from '../lib/campaign-forecast.mjs';
import {projectPace,budgetPace} from '../lib/budget-pace.mjs';

// Synthetic fixtures only. Day starts at local midnight in São Paulo; readings at 06:00 local (6h elapsed).
const tz='America/Sao_Paulo',from='2026-11-09T03:00:00.000Z',hour=h=>Date.parse(from)+h*3600000,iso=h=>new Date(hour(h)).toISOString();

function forecastInput({budget=100,currency='BRL',rate,observed={},todaySpend=100}={}){
 const now=hour(6);
 const card={project:'p',row:{adAccountId:'a',externalId:'c',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:currency,dailyBudget:budget,...(rate===undefined?{}:{budgetRate:rate})},observedRow:{status:'ACTIVE',effectiveStatus:'ACTIVE',...observed},liveStale:false,liveAt:new Date(now-1000).toISOString(),liveToday:{from,to:'2026-11-10T03:00:00.000Z',timezone:tz},windows:{}};
 const history=Array.from({length:6},(_,i)=>({day:new Date(Date.parse('2026-11-03T00:00:00Z')+i*86400000).toISOString().slice(0,10),spend:100,orders:3,revenueNet:150,profit:20}));
 const item={target:{projectId:'p',adAccountId:'a',objectId:'c',timezone:tz},snapshot:{source:'Malva MCP',currency:'BRL',timezone:tz,from:'2026-11-03',to:'2026-11-09',fetchedAt:new Date(now).toISOString(),lastSyncAt:null,rows:[...history,{day:'2026-11-09',spend:todaySpend,orders:3,revenueNet:150,profit:20}]}};
 return {card,item,state:{},now};
}

test('Forecast: a daily budget already reached adds no remaining spend (was R$ 400 projected on R$ 100)',()=>{
 const p=forecastCampaign(forecastInput({budget:100}));
 assert.equal(p.status,'scenario');assert.equal(p.dailyBudget,100);assert.match(p.reason,/Orçamento do dia atingido/);
 for(const s of p.scenarios){assert.equal(s.spend,100);assert.equal(s.orders,3);assert.equal(s.profit,20);assert.equal(s.revenueNet,150);}
 assert.equal(p.canExecute,false);
});

test('Forecast: remaining spend is capped at what is left of a known BRL daily budget',()=>{
 const p=forecastCampaign(forecastInput({budget:250}));
 assert.equal(p.status,'scenario');for(const s of p.scenarios)assert.equal(s.spend,250);
 assert.ok(p.warnings.some(w=>/limitado ao orçamento diário/.test(w)));assert.doesNotMatch(p.reason,/atingido/);
});

test('Forecast: a budget in another currency is capped only through a valid budgetRate',()=>{
 const converted=forecastCampaign(forecastInput({budget:50,currency:'USD',rate:5}));
 assert.equal(converted.dailyBudget,250);for(const s of converted.scenarios)assert.equal(s.spend,250);
 for(const rate of [undefined,0,-1,NaN]){const p=forecastCampaign(forecastInput({budget:50,currency:'USD',rate}));assert.equal(p.status,'scenario');assert.equal(p.dailyBudget,null);for(const s of p.scenarios)assert.equal(s.spend,400);}
});

test('Forecast: unknown or ample budget keeps the plain pace (no cap, no note); observed row budget wins',()=>{
 for(const budget of [null,0,-5,NaN]){const p=forecastCampaign(forecastInput({budget}));assert.equal(p.dailyBudget,null);for(const s of p.scenarios)assert.equal(s.spend,400);assert.ok(!p.warnings.some(w=>/limitado/.test(w)));}
 const ample=forecastCampaign(forecastInput({budget:1000}));
 assert.equal(ample.dailyBudget,1000);for(const s of ample.scenarios)assert.equal(s.spend,400);assert.ok(!ample.warnings.some(w=>/limitado/.test(w)));
 assert.match(ample.reason,/Se o ritmo de gasto observado continuar/);
 const live=forecastCampaign(forecastInput({budget:1000,observed:{dailyBudget:200,budgetCurrency:'BRL'}}));
 assert.equal(live.dailyBudget,200);for(const s of live.scenarios)assert.equal(s.spend,200);
});

const row=(id,spend,dailyBudget,extra={})=>({externalId:id,adAccountId:'acc',level:'campaign',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget,budgetCurrency:'BRL',spend,...extra});
const snap=(p,rows,h=6,over={})=>({projectId:p,period:'today',level:'campaign',source:'Malva MCP',complete:true,from,timezone:tz,fetchedAt:iso(h),rows,...over});
const cfg={a:{projectName:'A',currency:'BRL'},b:{projectName:'B',currency:'BRL'}};

test('Pace: a spent budget projects what was spent, and the combined line adds that, not the uncapped pace',()=>{
 const st={config:cfg,snapshots:[snap('a',[row('x',100,100)]),snap('b',[row('y',150,1000)])]};
 const a=projectPace(st,'a',hour(6));
 assert.equal(a.status,'spent');assert.equal(a.projected,100);assert.equal(a.spend,100);assert.equal(a.exhaustsAt,null);
 const all=budgetPace(st,'all',hour(6));
 assert.equal(all.budget,1100);assert.equal(all.spend,250);assert.equal(all.projected,700);assert.equal(all.status,'under');assert.equal(all.leftoverPct,36);
 const only=budgetPace({config:{a:cfg.a},snapshots:[snap('a',[row('x',120,100)])]},'all',hour(6));
 assert.equal(only.status,'spent');assert.equal(only.projected,120);
});

test('Pace: an incomplete or non-Malva today reading stays N/D, never an alert',()=>{
 for(const over of [{complete:false},{complete:undefined},{source:'Manual'},{source:undefined}]){
  const p=projectPace({config:{p:{projectName:'P',currency:'BRL'}},snapshots:[snap('p',[row('x',100,1000)],12,over)]},'p',hour(12));
  assert.equal(p.status,'nd');assert.equal(p.alert,undefined);assert.equal(p.projected,null);assert.equal(p.budget,null);assert.equal(p.spend,null);assert.equal(p.known,0);
 }
 // A newer incomplete reading does not replace the latest complete one.
 const p=projectPace({config:{p:{projectName:'P',currency:'BRL'}},snapshots:[snap('p',[row('x',500,1000)],12),snap('p',[row('x',100,1000)],13,{complete:false})]},'p',hour(13));
 assert.equal(p.at,iso(12));assert.equal(p.spend,500);assert.equal(p.status,'on');
});

test('Pace: normal on, under and exhausts readings are unchanged',()=>{
 const st=rows=>({config:{p:{projectName:'P',currency:'BRL'}},snapshots:[snap('p',rows,12)]});
 const on=projectPace(st([row('x',500,1000)]),'p',hour(12));assert.equal(on.status,'on');assert.equal(on.projected,1000);
 const under=projectPace(st([row('x',200,1000)]),'p',hour(12));assert.equal(under.status,'under');assert.equal(under.projected,400);assert.equal(under.leftoverPct,60);assert.equal(under.alert,'under');
 const fast=projectPace(st([row('x',800,1000)]),'p',hour(12));assert.equal(fast.status,'exhausts');assert.equal(fast.projected,1600);assert.equal(fast.exhaustsAt,iso(15));assert.equal(fast.alert,'early');
});
