import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignLiveDrift,decorateCampaignCard} from '../lib/campaign-live-context.mjs';
import {sum} from '../lib/analysis.mjs';

const now=Date.parse('2026-11-03T16:00:00.000Z'),from='2026-11-03T04:00:00.000Z',to='2026-11-04T04:00:00.000Z',timezone='America/Boa_Vista';
const row={externalId:'campaign',adAccountId:'account',level:'campaign',provider:'meta',name:'Campanha John',status:'PAUSED',effectiveStatus:'PAUSED',dailyBudget:100,budgetCurrency:'BRL',spend:100,revenueNet:200,adCosts:0,productCost:0,saleTax:0,frontOrders:2,orders:3,refundedOrders:0,refundedRevenue:0,linkClicks:40,checkouts:5};
const card=()=>({id:'card',project:'john',row:structuredClone(row),signature:'sealed',sourceAt:'2026-11-03T15:00:00.000Z',sourceCut:[{period:'today',level:'campaign',from,to,timezone,fetchedAt:'2026-11-03T15:00:00.000Z'}],windows:{today:{...sum([row]),from,to},'7d':{spend:500,roi:1.5,to:from},'3d':{spend:300,roi:1.3,to:from},yesterday:{spend:200,roi:1.1,to:from}},teamReady:true,teamOpinions:[{id:'opinion'}],proposal:{id:'proposal'},suggestion:{action:'increase',percent:20,origin:'proposal'},actionable:{increase:true,reduce:true,pause:true,keep:true},blockedReasons:[]});
const item=(patch={})=>({projectId:'john',snapshot:{projectId:'john',source:'Malva MCP',period:'today',level:'campaign',complete:true,timezone,from,to,fetchedAt:'2026-11-03T15:59:00.000Z',rows:[{...row,status:'ACTIVE',effectiveStatus:'ACTIVE'}],...patch}});

test('new front alone preserves a reviewed keep, while refunds, native changes and financial proposals remain fenced',()=>{
 const c=card();c.suggestion={action:'keep',origin:'team',reason:'Observar aquisição nova.'};c.proposal=null;
 const newer=item({rows:[{...row,frontOrders:3}]});const d=decorateCampaignCard(c,[newer],now);assert.equal(d.liveDrift,null);assert.equal(d.liveToday.frontOrders,3);assert.equal(d.teamReady,true);
 for(const patch of [{frontOrders:1},{frontOrders:3,refundedOrders:1},{frontOrders:3,revenueNet:90},{frontOrders:3,status:'ACTIVE',effectiveStatus:'ACTIVE'}])assert.ok(campaignLiveDrift(c,[item({rows:[{...row,...patch}]})],now));
 c.proposal={id:'exact-pending'};assert.ok(campaignLiveDrift(c,[newer],now));c.proposal=null;c.suggestion={action:'pause',origin:'team'};assert.ok(campaignLiveDrift(c,[newer],now));
});

test('a fresh complete today cut does not become perpetually stale because an idle campaign has no spent row',()=>{
 const c=card();c.windows.today=null;c.sourceCut[0].complete=true;c.sourceCut[0].source='Malva MCP';c.actionable={increase:false,reduce:false,pause:false,keep:true};
 const decorated=decorateCampaignCard(c,[item({rows:[{...row,spend:0,frontOrders:0}]})],now);
 assert.equal(decorated.analysisStale,false);assert.equal(decorated.liveDrift,null);assert.equal(decorated.windows.today,null);assert.equal(decorated.teamReady,true);
 assert.deepEqual(decorated.actionable,{increase:false,reduce:false,pause:false,keep:true});
 c.sourceCut[0].complete=false;assert.equal(decorateCampaignCard(c,[],now).analysisStale,true);
 c.sourceCut[0].complete=true;c.sourceAt='2026-11-03T14:59:59Z';assert.equal(decorateCampaignCard(c,[],now).analysisStale,true);
});

test('newer status and metrics display while original references and sealed values remain untouched',()=>{
 const input=card(),before=structuredClone(input),cache=item({rows:[{...row,status:'ACTIVE',effectiveStatus:'ACTIVE',spend:150,frontOrders:3}]}),cacheBefore=structuredClone(cache),decorated=decorateCampaignCard(input,[cache],now);
 assert.equal(decorated.observedRow.status,'ACTIVE');assert.equal(decorated.liveToday.spend,150);assert.equal(decorated.liveToday.frontOrders,3);assert.equal(decorated.liveAt,cache.snapshot.fetchedAt);assert.equal(decorated.liveStale,false);assert.equal(decorated.analysisStale,false);
 assert.equal(decorated.row,input.row);assert.equal(decorated.signature,input.signature);assert.equal(decorated.sourceCut,input.sourceCut);assert.equal(decorated.windows,input.windows);assert.equal(decorated.sourceAt,input.sourceAt);
 assert.equal(decorated.liveDrift.kind,'native');assert.equal(decorated.liveDrift.title,'Mudança detectada · aguardando releitura');assert.equal(decorated.liveDrift.at,cache.snapshot.fetchedAt);
 assert.deepEqual(input,before);assert.deepEqual(cache,cacheBefore);
});
test('any drift disables every choice and removes old opinions and proposals for reanalysis',()=>{
 const decorated=decorateCampaignCard(card(),[item()],now);
 assert.deepEqual(decorated.actionable,{increase:false,reduce:false,pause:false,keep:false});assert.equal(decorated.proposal,null);assert.equal(decorated.suggestion.origin,'diagnostic');assert.equal(decorated.teamReady,false);assert.deepEqual(decorated.teamOpinions,[]);assert.match(decorated.blockedReasons.at(-1),/quatro períodos/);
});
test('unchanged native values still produce current presentation without invalidating a stable regime',()=>{
 const c=card(),live=item({rows:[{...row,spend:120,linkClicks:50}]});
 assert.equal(campaignLiveDrift(c,[live],now),null);const decorated=decorateCampaignCard(c,[live],now);
 assert.notEqual(decorated,c);assert.equal(decorated.liveToday.spend,120);assert.equal(decorated.liveToday.linkClicks,50);assert.equal(decorated.observedRow.dailyBudget,100);assert.equal(decorated.proposal,c.proposal);assert.equal(decorated.suggestion,c.suggestion);assert.equal(decorated.teamOpinions,c.teamOpinions);assert.equal(decorated.row,c.row);assert.equal(decorated.windows,c.windows);
});
test('known budget and currency changes remain available in native changes for the execution guard',()=>{
 const c=card();assert.deepEqual(campaignLiveDrift(c,[item({rows:[{...row,dailyBudget:150}]})],now).changes,[{field:'dailyBudget',before:100,after:150}]);assert.deepEqual(campaignLiveDrift(c,[item({rows:[{...row,budgetCurrency:'USD'}]})],now).changes,[{field:'budgetCurrency',before:'BRL',after:'USD'}]);
});
test('new front and refund counters invalidate context; orders and upsells alone are not new front',()=>{
 for(const patch of [{frontOrders:3},{refundedOrders:1},{refundedRevenue:20}]){const drift=campaignLiveDrift(card(),[item({rows:[{...row,...patch}]})],now);assert.equal(drift.kind,'context');assert.equal(drift.materialChanges[0].field,Object.keys(patch)[0]);assert.deepEqual(drift.changes,[]);}
 assert.equal(campaignLiveDrift(card(),[item({rows:[{...row,orders:9,revenueNet:250}]})],now),null);
});
test('ROI equilibrium and configured ROAS target crossings require context review in either direction',()=>{
 const c=card();let drift=campaignLiveDrift(c,[item({rows:[{...row,revenueNet:90}]})],now);assert.equal(drift.kind,'context');assert.equal(drift.materialChanges.find(c=>c.field==='roi').threshold,1);
 c.windows.today.roi=0.9;drift=campaignLiveDrift(c,[item({rows:[row]})],now);assert.ok(drift.materialChanges.some(c=>c.field==='roi'));
 const roas=card();roas.targetRoas=1.8;drift=campaignLiveDrift(roas,[item({rows:[{...row,revenueNet:170}]})],now);assert.ok(drift.materialChanges.some(c=>c.field==='roas'&&c.threshold===1.8));
 delete roas.targetRoas;assert.equal(campaignLiveDrift(roas,[item({rows:[{...row,revenueNet:170}]})],now),null);
});
test('missing values remain unknown and cannot invent front, refunds or ROI changes',()=>{
 const c=card();c.row.frontOrders=undefined;c.row.refundedOrders=undefined;c.row.refundedRevenue=undefined;c.windows.today.frontOrders=null;c.windows.today.refundedRevenue=null;c.windows.today.roi=null;c.windows.today.roas=null;c.targetRoas=2;
 const decorated=decorateCampaignCard(c,[item({rows:[{...row,frontOrders:6,refundedOrders:2,refundedRevenue:30,revenueNet:80}]})],now);assert.equal(decorated.liveDrift,null);assert.equal(decorated.liveToday.frontOrders,6);
 const missing=decorateCampaignCard(card(),[item({rows:[{...row,frontOrders:undefined,revenueNet:undefined,adCosts:undefined}]})],now);assert.equal(missing.liveToday.frontOrders,null);assert.equal(missing.liveToday.roi,null);assert.equal(missing.liveDrift,null);
 const noToday=card();noToday.windows.today=null;const absent=decorateCampaignCard(noToday,[item({rows:[{...row,frontOrders:6}]})],now);assert.equal(absent.analysisStale,true);assert.ok(!absent.liveDrift.materialChanges.some(change=>change.field==='frontOrders'));
});
test('stale analysis blocks even without cache and the exact 60-minute boundary remains usable',()=>{
 const c=card();assert.equal(campaignLiveDrift(c,[],now),null);const before=structuredClone(c);c.sourceAt='2026-11-03T14:59:59.999Z';
 const decorated=decorateCampaignCard(c,[],now);assert.equal(decorated.analysisStale,true);assert.equal(decorated.liveDrift.kind,'analysis-stale');assert.equal(decorated.liveToday,null);assert.equal(decorated.liveAt,null);assert.equal(decorated.proposal,null);assert.equal(decorated.actionable.increase,false);assert.equal(before.row.status,c.row.status);
});
test('midnight never reuses old analysis or closed windows for current-day presentation',()=>{
 const c=card(),oldFrom='2026-11-02T04:00:00.000Z';c.windows.today={...c.windows.today,from:oldFrom,to:from};c.sourceCut=[{period:'today',from:oldFrom,to:from,timezone}];
 const decorated=decorateCampaignCard(c,[item({rows:[row]})],now);assert.equal(decorated.analysisStale,true);assert.equal(decorated.liveDrift.kind,'analysis-stale');assert.ok(decorated.liveDrift.materialChanges.some(change=>change.field==='todayWindow'));assert.equal(decorated.displayContext,null);assert.equal(decorated.liveToday.from,from);
 assert.equal(campaignLiveDrift(card(),[item()],Date.parse(to)).kind,'analysis-stale');
});
test('material performance is compared only inside the same exact today window',()=>{
 const c=card();c.windows.today={...c.windows.today,from:'2026-11-03T05:00:00.000Z'};
 const drift=campaignLiveDrift(c,[item({rows:[{...row,frontOrders:10,revenueNet:20}]})],now);assert.ok(drift.materialChanges.some(change=>change.field==='todayWindow'));assert.ok(!drift.materialChanges.some(change=>['frontOrders','roi'].includes(change.field)));
});
test('display context uses live today only when all three closed windows end at its start',()=>{
 const c=card(),cache=item({rows:[{...row,revenueNet:90}]});let decorated=decorateCampaignCard(c,[cache],now);assert.equal(decorated.displayContext.kind,'mixed-return');assert.equal(decorated.displayContext.title,'Hoje fraco, histórico rentável');
 for(const period of ['7d','3d','yesterday']){const invalid=structuredClone(c);invalid.windows[period].to='2026-11-02T04:00:00.000Z';assert.equal(decorateCampaignCard(invalid,[cache],now).displayContext,null);}
});
test('cache age and errors mark presentation stale without silently changing the analysis',()=>{
 const c=card(),error={...item({rows:[row]}),error:{code:'SOURCE_UNAVAILABLE'}};assert.equal(decorateCampaignCard(c,[error],now).liveStale,true);
 const old=item({rows:[row],fetchedAt:'2026-11-03T15:54:59.999Z'});assert.equal(decorateCampaignCard(c,[old],now).liveStale,true);assert.equal(decorateCampaignCard(c,[old],now).analysisStale,false);
 assert.equal(decorateCampaignCard(c,[item({rows:[row],fetchedAt:'2026-11-03T15:55:00.000Z'})],now).liveStale,false);assert.equal(decorateCampaignCard(c,[],now).liveStale,true);
});
test('project/account/provider/level and unique newest identity fence presentation and drift',()=>{
 const c=card();for(const patch of [{projectId:'gabe'},{rows:[{...row,adAccountId:'another',status:'ACTIVE'}]},{rows:[{...row,externalId:'another',status:'ACTIVE'}]},{rows:[{...row,provider:'google',status:'ACTIVE'}]},{rows:[{...row,level:'adset',status:'ACTIVE'}]},{rows:[]},{rows:[{...row,status:'ACTIVE'},{...row,status:'ACTIVE'}]}]){assert.equal(campaignLiveDrift(c,[item(patch)],now),null);assert.equal(decorateCampaignCard(c,[item(patch)],now).liveToday,null);}
 assert.equal(campaignLiveDrift(c,[{...item(),projectId:'gabe'}],now),null);
 const foreignCard=card();foreignCard.row.provider='google';assert.equal(decorateCampaignCard(foreignCard,[item()],now).liveToday,null);
});
test('older, partial, historical, future and wrong-day cache cannot regress presentation',()=>{
 const c=card();for(const patch of [{fetchedAt:'2026-11-03T14:59:00.000Z'},{complete:false},{period:'7d'},{level:'ad'},{source:'Other'},{fetchedAt:'2026-11-02T15:59:00.000Z'},{fetchedAt:'2026-11-03T16:00:01.000Z'},{timezone:'invalid'}])assert.equal(decorateCampaignCard(c,[item(patch)],now).liveToday,null);
 const equal=decorateCampaignCard(c,[item({fetchedAt:c.sourceAt,rows:[row]})],now);assert.equal(equal.liveToday.spend,100);assert.equal(equal.liveDrift,null);
});
test('newest complete cache wins; absence cannot fill from an older read and native return removes drift',()=>{
 const c=card(),old=item({fetchedAt:'2026-11-03T15:30:00.000Z'}),newer=item({rows:[row]});
 assert.equal(campaignLiveDrift(c,[old,newer],now),null);assert.equal(campaignLiveDrift(c,[old,item({rows:[]})],now),null);assert.equal(decorateCampaignCard(c,[old,item({rows:[]})],now).observedRow,undefined);
 assert.equal(campaignLiveDrift(null,[old],now),null);assert.equal(decorateCampaignCard(null,[old],now),null);
});
