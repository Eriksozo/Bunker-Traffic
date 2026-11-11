import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateGrant,simulateCaveats} from '../lib/autonomy-simulate.mjs';
import {simColumns} from '../lib/autonomy-deep-view.mjs';
import {autonomyView} from '../lib/autonomy-grant.mjs';

// Draft simulator (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, a.7). Synthetic rows only.
const NOW=Date.parse('2026-11-10T18:00:00Z'),P='p1',iso=ms=>new Date(ms).toISOString(),H=3600000;
const deepFreeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);}return o;};
const r=(o)=>{const x={id:'id-'+o.objectId+'-'+(o.day||'2026-11-10')+'-'+(o.rule||'test-no-sale'),day:'2026-11-10',rule:'test-no-sale',adAccountId:'acc1',objectId:'c1',campaign:'Camp',action:'status',beforeBudget:null,afterBudget:null,currency:null,afterStatus:'PAUSED',wouldExecute:true,alertOnly:false,firstWouldExecuteAt:iso(NOW-H),verdict:null,winnerCut:false,...o};return simColumns.map(c=>x[c]??null);};
const draft=(mode='auto',extra={})=>({enabled:false,projects:{[P]:{mode,actions:{pause:true,reduce:true,increase:true,activate:false},limits:{maxIncreasePct:30,maxReducePct:30,budgetCap:1000,ordersPerDay:2},campaigns:{},...extra}}});
const saved=autonomyView({config:{[P]:{projectName:'Fictício'}},autonomy:{version:1,enabled:true,projects:{[P]:{mode:'shadow',actions:{pause:true,reduce:false,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:null,budgetCap:null,ordersPerDay:2},campaigns:{}}}}});
const sim=(rows,extra={})=>({v:1,at:iso(NOW),project:P,timezone:'America/Sao_Paulo',today:'2026-11-10',columns:[...simColumns],rows,seedOrders:[],saved,truncated:0,...extra});

test('Draft vs saved: the draft allows what the saved Sombra level only records',()=>{
 const rows=[r({objectId:'c1',verdict:'acertou'}),r({objectId:'c2',day:'2026-11-08',firstWouldExecuteAt:iso(NOW-50*H),verdict:'errou'}),
  r({objectId:'c3',action:'budget',rule:'bad-day-reduce',beforeBudget:200,afterBudget:160,currency:'BRL',afterStatus:null,verdict:'acertou',winnerCut:true}),
  r({objectId:'c4',wouldExecute:false,firstWouldExecuteAt:null}),r({objectId:'c5',alertOnly:true})];
 const out=simulateGrant(sim(rows),draft(),{now:NOW,projectIds:[P]});
 assert.equal(out.ok,true);assert.equal(out.label,'só permissões');assert.equal(out.assumedSwitchOn,true,'the draft has the switch off: assumed on');
 assert.deepEqual(out.draft.today,{orders:2,asks:0,held:{}});
 assert.deepEqual(out.draft.d7,{orders:3,asks:0,right:2,wrong:1,open:0,winnersCut:1,held:{}},'never-would-execute and alert-only rows are not candidates');
 assert.equal(out.saved.d7.orders,0);assert.deepEqual(out.saved.d7.held,{'Nível Sombra: só registra o que faria.':3});
 assert.deepEqual(out.caveats,[...simulateCaveats]);
 const confirm=simulateGrant(sim(rows),draft('confirm'),{now:NOW,projectIds:[P]});
 assert.deepEqual([confirm.draft.d7.orders,confirm.draft.d7.asks],[0,3],'Confirmar asks, never sends');
});

test('Block reasons are the grant\'s own strings; limits and cooldown accumulate as live',()=>{
 const rows=[r({objectId:'c1',firstWouldExecuteAt:iso(NOW-3*H)}),r({objectId:'c1',rule:'new-sale-loss',firstWouldExecuteAt:iso(NOW-2.5*H)}),r({objectId:'c1',rule:'no-delivery',firstWouldExecuteAt:iso(NOW-1*H)}),
  r({objectId:'c2',action:'budget',rule:'morning-increase',beforeBudget:500,afterBudget:750,currency:'BRL',afterStatus:null}),
  r({objectId:'c3',action:'budget',rule:'bad-day-reduce',beforeBudget:500,afterBudget:400,currency:'BRL',afterStatus:null})];
 const out=simulateGrant(sim(rows),draft('auto',{actions:{pause:true,reduce:false,increase:true,activate:false}}),{now:NOW,projectIds:[P]});
 const held=out.draft.today.held;
 assert.equal(held['Outra ordem do Bunk nesta campanha há menos de 1h.'],1,'the 2nd pause on c1 30 min later waits the cooldown');
 assert.equal(held['Limite de 2 ordens do Bunk por campanha hoje atingido.'],undefined);
 assert.equal(held['Aumento de 50% acima do máximo de 30%.'],1);
 assert.equal(held['Reduzir orçamento não permitido neste projeto.'],1);
 assert.equal(out.draft.today.orders,2,'two pauses on c1, 2 h apart: the limit of 2 is reached, not exceeded');
 const one=simulateGrant(sim(rows),draft('auto',{limits:{maxIncreasePct:60,maxReducePct:30,budgetCap:1000,ordersPerDay:1}}),{now:NOW,projectIds:[P]});
 assert.equal(one.draft.today.held['Limite de 1 ordem do Bunk por campanha hoje atingido.'],2,'both later pauses on c1');
 // A real order seeds the limits; the row it came from is replayed instead of counted twice.
 const seeded=simulateGrant(sim([r({objectId:'c9',firstWouldExecuteAt:iso(NOW-H)})],{seedOrders:[{id:'real',project:P,createdAt:iso(NOW-20*60000),payload:{adAccountId:'acc1',objectId:'c9',shadowId:'other'}}]}),draft(),{now:NOW,projectIds:[P]});
 assert.equal(seeded.draft.today.held['Outra ordem do Bunk nesta campanha há menos de 1h.'],undefined,'the seed is after the row: no cooldown yet when the row fired');
 const again=simulateGrant(sim([r({objectId:'c9',firstWouldExecuteAt:iso(NOW-H)})],{seedOrders:[{id:'real',project:P,createdAt:iso(NOW-H),payload:{adAccountId:'acc1',objectId:'c9',shadowId:'id-c9-2026-11-10-test-no-sale'}}]}),draft(),{now:NOW,projectIds:[P]});
 assert.equal(again.draft.today.orders,1,'its own real order is not a seed: replayed once');
});

test('Invalid drafts are refused with the config message; the function is pure',()=>{
 const bad=simulateGrant(sim([]),{enabled:true,projects:{zz:{mode:'auto'}}},{now:NOW,projectIds:[P]});
 assert.deepEqual(bad,{ok:false,error:'Projeto não configurado no Bunker.'});
 assert.equal(simulateGrant(null,draft(),{now:NOW,projectIds:[P]}).ok,false);
 const input=deepFreeze(sim([r({objectId:'c1'})])),d=deepFreeze(draft());
 const a=simulateGrant(input,d,{now:NOW,projectIds:[P]}),b=simulateGrant(input,d,{now:NOW,projectIds:[P]});
 assert.deepEqual(a,b,'same input, same output');
 const future=simulateGrant(sim([r({objectId:'c1',firstWouldExecuteAt:iso(NOW+H)})]),draft(),{now:NOW,projectIds:[P]});
 assert.equal(future.draft.d7.orders,0,'nothing after the simulation instant');
 const src=fs.readFileSync(new URL('../lib/autonomy-simulate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/Date\.now\(|fetch\(|storage|recordAutonomyOrder|setAutonomyConfig|localStorage/,'no clock, I/O or write');
});
