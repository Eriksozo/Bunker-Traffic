import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHistoryLearning,persistHistoryLearning,historyLearningKey} from '../lib/cloud-history-learning.mjs';
import {collectExternalLearning,persistExternalLearning,externalLearningRecall,externalLearningCandidates} from '../lib/external-learning.mjs';
import {retainKnowledgeMeasurements} from '../lib/knowledge.mjs';
import {historyNow as now,historyProject as project,historyRow as row,historyEvent} from './fixtures/history-learning.mjs';
const date=n=>new Date(n).toISOString();
async function setup({echo=true,extra=[]}={}){
 const event=historyEvent(3,{echo:echo?{at:historyEvent(3).at,actorName:'Meta'}:null});const s={config:{p:{projectName:'John'},q:{projectName:'Other'}},snapshots:[{projectId:'p',level:'campaign',rows:[row]}],paused:false};
 const h=await collectHistoryLearning({read:async()=>({items:[event,...extra].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),nextCursor:null,timezone:'UTC',period:{from:'2026-10-01T00:00:00Z',to:'2026-11-06T00:00:00Z',timezone:'UTC'}})},project,row,null,{now:()=>now});persistHistoryLearning(s,h,now);return s;
}
function source({mutate}={}){const calls=[];return {calls,read:async(t,a)=>{calls.push({tool:t,...a});assert.equal(t,'tracking_campaigns');const before=a.from==='2026-11-01',d=Date.parse(a.from+'T00:00:00Z'),r={level:'campaign',salesScope:{kind:'traffic'},currency:'BRL',period:{days:[a.from],from:date(d),to:date(d+86400000),timezone:'UTC'},freshAt:date(now-1000),lastSyncAt:date(now-60000),truncated:true,rows:[{...row,spend:100,revenueNet:before?150:250,adCosts:4,productCost:0,saleTax:0,frontOrders:before?2:3,orders:before?5:8,checkouts:4,impressions:1000,linkClicks:20}]};mutate?.(r,a);return r;}};}
test('Automatic comparisons read exact front counts, preserve source and native currencies, and never execute',async()=>{
 const s=await setup(),c=source(),before=structuredClone(s.config),r=await collectExternalLearning(c,s,project,{now:()=>now});assert.equal(r.status,'Lida');assert.equal(c.calls.length,2);assert.deepEqual(c.calls.map(c=>c.from),['2026-11-01','2026-11-03']);assert.deepEqual(c.calls[0].accountIds,['a']);assert.equal(c.calls[0].status,'all');const saved=persistExternalLearning(s,r,now);assert.equal(saved.status,'Favorável');assert.equal(s.externalHistoryMeasurements.length,2);assert.equal(s.knowledgeMeasurements,undefined);assert.equal(s.decisionHistoryOutcomes[0].afterMetrics.frontOrders,3);assert.equal(s.decisionHistoryOutcomes[0].afterMetrics.orders,8);assert.equal(s.decisionHistoryOutcomes[0].after.metricsCurrency,'BRL');assert.equal(s.executions,undefined);assert.deepEqual(s.config,before);
 const recall=externalLearningRecall(s,'p',[row],now);assert.equal(recall.length,1);assert.equal(recall[0].retrospectiveOnly,true);assert.equal(recall[0].executionByBunker,false);assert.equal(recall[0].actor.name,'Gestor');assert.equal(externalLearningRecall(s,'q',[row],now).length,0);
});
test('Other manager failures, child edits, pending pagination and checkout incidents cannot appear as wins',async()=>{
 const child=historyEvent(2,{category:'creative',object:{level:'ad',externalId:'child',campaign:{externalId:'c'}},values:{field:'video',from:'old',to:'new'}});
 for(const kind of ['unconfirmed','child','incident','zero']){const s=await setup({echo:kind!=='unconfirmed',extra:kind==='child'?[child]:[]});if(kind==='incident')s.incidents=[{id:'checkout',project:'p',status:'Ativo',createdAt:'2026-11-01T12:00:00Z'}];const c=source({mutate:r=>{if(kind==='zero'&&r.period.days[0]==='2026-11-03')Object.assign(r.rows[0],{spend:0,revenueNet:0,frontOrders:0});}}),r=await collectExternalLearning(c,s,project,{now:()=>now});assert.equal(persistExternalLearning(s,r,now).status,'Inconclusivo');assert.ok(s.decisionHistoryOutcomes[0].limits.length);}
 const s=await setup(),r=await collectExternalLearning(source({mutate:r=>{if(r.period.days[0]==='2026-11-03')r.rows[0].revenueNet=20;}}),s,project,{now:()=>now});assert.equal(persistExternalLearning(s,r,now).status,'Desfavorável');assert.equal(externalLearningRecall(s,'p',[row],now)[0].classification,'Desfavorável');
});
test('Missing front, unknown sync, wrong scope/currencies and stale windows yield explicit failures without zeros',async()=>{
 for(const mutate of [r=>delete r.rows[0].frontOrders,r=>r.lastSyncAt='bad',r=>r.lastSyncAt=null,r=>r.rows[0].adAccountId='wrong',r=>r.rows[0].projectId='q',r=>r.rows[0].budgetCurrency='BRL',r=>r.currency='USD',r=>r.freshAt=date(now-600000),r=>r.lastSyncAt='2026-10-01T00:00:00Z']){
  const s=await setup(),r=await collectExternalLearning(source({mutate}),s,project,{now:()=>now});assert.equal(r.status,'Leitura indisponível');persistExternalLearning(s,r,now);assert.equal(s.decisionHistoryOutcomes,undefined);assert.equal(s.externalHistoryMeasurements,undefined);assert.equal(externalLearningCandidates(s,project,now+1000).length,0);
 }
});
test('Polling unchanged metrics adds no case, measurement or skill; actual metric change appends evidence',async()=>{
 const s=await setup(),first=await collectExternalLearning(source(),s,project,{now:()=>now});persistExternalLearning(s,first,now);const snapshot=structuredClone(s.decisionHistoryOutcomes),t=now+86400000+1;
 const updatedSource=()=>source({mutate:r=>{r.freshAt=date(t-1000);r.lastSyncAt=date(t-1000);}});
 const same=await collectExternalLearning(updatedSource(),s,project,{now:()=>t});assert.equal(persistExternalLearning(s,same,t).status,'Sem mudança nas evidências');assert.deepEqual(s.decisionHistoryOutcomes,snapshot);assert.equal(s.externalHistoryMeasurements.length,2);
 const t2=t+86400000+1,changed=await collectExternalLearning(source({mutate:r=>{r.freshAt=date(t2-1000);r.lastSyncAt=date(t2-1000);if(r.period.days[0]==='2026-11-03')r.rows[0].revenueNet=20;}}),s,project,{now:()=>t2});assert.equal(persistExternalLearning(s,changed,t2).status,'Desfavorável');assert.equal(s.decisionHistoryOutcomes.length,2);assert.equal(externalLearningRecall(s,'p',[row],t2)[0].classification,'Desfavorável');
});
test('Concurrent proof changes, new pending pages, pause and future check timestamp prevent stale publication',async()=>{
 for(const mutate of [s=>s.paused=true,s=>s.historyLearning.scopes[historyLearningKey('p','a','c')].pending={nextCursor:'more'},s=>s.incidents=[{project:'p',createdAt:date(now-1000)}],s=>s.externalLearningChecks={other:{},[s.decisionHistory[0].eventKey]:{lastCheckedAt:date(now)}}]){
  const s=await setup(),r=await collectExternalLearning(source(),s,project,{now:()=>now});mutate(s);const before=structuredClone(s);assert.equal(persistExternalLearning(s,r,now).status,'Releitura necessária');assert.deepEqual(s,before);
 }
 const s=await setup(),r=await collectExternalLearning(source(),s,project,{now:()=>now});r.checkedAt=date(now+1000);assert.equal(persistExternalLearning(s,r,now).status,'Releitura necessária');
});
test('History gaps and warmup campaigns never become completed examples',async()=>{
 const s=await setup();s.historyLearning.scopes[historyLearningKey('p','a','c')].intervals=[];const r=await collectExternalLearning(source(),s,project,{now:()=>now});assert.equal(r.code,'SOURCE_EXTERNAL_HISTORY_GAP');s.snapshots[0].rows[0]={...row,name:'[ENGAJAMENTO] Aquecimento'};assert.equal(externalLearningCandidates(s,project,now).length,0);
});
test('Automatic history does not consume approved-execution measurement capacity',async()=>{
 const s=await setup();s.snapshots=[{projectId:'p',source:'Malva MCP',complete:true,level:'campaign',from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',fetchedAt:date(now-1000),rows:[{...row,spend:50,revenueNet:70,frontOrders:1}]}];retainKnowledgeMeasurements(s,date(now));assert.equal(s.knowledgeMeasurements.length,0);
 s.proposals=[{id:'approved',project:'p',status:'Aprovada',payload:{objectId:'c',adAccountId:'a',level:'campaign'}}];retainKnowledgeMeasurements(s,date(now));assert.equal(s.knowledgeMeasurements.length,1);assert.deepEqual(s.knowledgeMeasurements[0].proposalIds,['approved']);
});

test('All four role memories receive external evidence without counting it as personal efficacy',async()=>{
 const {cloudAgentMemory}=await import('../lib/agent-development.mjs'),{externalLearningPlan}=await import('../lib/external-learning.mjs');
 const s=await setup(),r=await collectExternalLearning(source(),s,project,{now:()=>now});persistExternalLearning(s,r,now);
 for(const role of ['traffic','creative','budget','ops']){const m=cloudAgentMemory(s,{id:'new-round',project:'p'},role,[row],{items:[],actionOutcomes:[]},now);assert.equal(m.externalResults.length,1);assert.equal(m.measuredOutcomes.length,0);assert.equal(m.episodes.length,0);assert.equal(m.externalResults[0].executionByBunker,false);}
 const plan=externalLearningPlan(s);assert.equal(plan.completedScopes,1);assert.equal(plan.comparisons,1);assert.equal(plan.favorable,1);assert.equal(plan.policy.providerWrites,false);
});

test('A quarantined history conflict prevents reusing old coverage as fresh learning evidence',async()=>{
 const s=await setup(),r=await collectExternalLearning(source(),s,project,{now:()=>now});s.historyLearning.failures={[historyLearningKey('p','a','c')]:{project:'p',adAccountId:'a',externalId:'c',code:'SOURCE_HISTORY_CONFLICT'}};assert.equal(externalLearningCandidates(s,project,now).length,0);assert.equal(persistExternalLearning(s,r,now).status,'Releitura necessária');assert.equal(s.decisionHistoryOutcomes,undefined);
});

test('External window diagnostics distinguish clock, identity and bounds failures without weakening validation',async()=>{
 const {externalWindowIssues}=await import('../lib/external-learning.mjs');
 const valid={level:'campaign',salesScope:{kind:'traffic'},currency:project.currency,period:{timezone:project.timezone,days:['2026-11-01'],from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z'},freshAt:date(now-1000),lastSyncAt:date(now-1000)};
 assert.deepEqual(externalWindowIssues(valid,project,'2026-11-01',now),[]);
 assert.deepEqual(externalWindowIssues({...valid,freshAt:date(now+1)},project,'2026-11-01',now),['freshAtFuture']);
 assert.deepEqual(externalWindowIssues({...valid,lastSyncAt:null},project,'2026-11-01',now),['syncMissing']);
 assert.deepEqual(externalWindowIssues({...valid,currency:'foreign'},project,'2026-11-01',now),['metricsCurrency']);
 assert.ok(externalWindowIssues({...valid,period:{...valid.period,to:null}},project,'2026-11-01',now).includes('boundsMissing'));
 const s=await setup(),r=await collectExternalLearning(source({mutate:r=>{r.freshAt=date(now+200);}}),s,project,{now:()=>now,wait:async()=>{}});
 assert.equal(r.code,'SOURCE_EXTERNAL_WINDOW');assert.deepEqual(r.windowFailure.issues,['freshAtFuture']);assert.equal(r.windowFailure.sourceClock.freshAt,date(now+200));persistExternalLearning(s,r,now);
 assert.deepEqual(s.externalLearningChecks[r.eventKey].windowFailure,r.windowFailure);assert.equal(s.decisionHistoryOutcomes,undefined);assert.equal(s.externalHistoryMeasurements,undefined);
 assert.equal(JSON.stringify(r.windowFailure).includes('revenue'),false);assert.equal(JSON.stringify(r.windowFailure).includes('token'),false);
});
test('A bounded asynchronous wait matures the original 726ms source clock before storing and recalling a comparison',async()=>{
 const s=await setup(),c=source({mutate:r=>{r.freshAt=date(now+726);}});let clock=now,waits=[];
 const r=await collectExternalLearning(c,s,project,{now:()=>clock,wait:async ms=>{waits.push(ms);clock=Math.max(clock,now+ms);}});
 assert.equal(r.status,'Lida');assert.equal(c.calls.length,2);assert.ok(waits.length>0&&waits.length<=2);assert.ok(waits.every(n=>n>0&&n<=1000));assert.equal(r.before.fetchedAt,date(now+726));assert.equal(r.after.fetchedAt,date(now+726));assert.equal(persistExternalLearning(s,r,clock).status,'Favorável');assert.equal(s.externalHistoryMeasurements.length,2);assert.equal(externalLearningRecall(s,'p',[row],clock)[0].executionByBunker,false);assert.equal(s.executions,undefined);
});
test('A frozen clock, excess skew and unrelated source failures never become successful observations',async()=>{
 for(const kind of ['frozen','excess','currency','timezone','sync']){
  const s=await setup();let calls=0,clock=now;
  const c=source({mutate:r=>{r.freshAt=date(now+(kind==='excess'?1001:726));if(kind==='currency')r.currency='foreign';if(kind==='timezone')r.period.timezone='foreign';if(kind==='sync')r.lastSyncAt=null;}});
  const result=await collectExternalLearning(c,s,project,{now:()=>clock,wait:async ms=>{calls++;if(kind!=='frozen')clock+=ms;}});
  assert.equal(result.code,'SOURCE_EXTERNAL_WINDOW');assert.equal(c.calls.length,2);if(kind==='frozen')assert.ok(calls>0);else assert.equal(calls,0);persistExternalLearning(s,result,clock);assert.equal(s.externalHistoryMeasurements,undefined);assert.equal(s.decisionHistoryOutcomes,undefined);
 }
});
test('Measurement policy version revisits an old failed check only inside candidate selection, preserving the old journal',async()=>{
 const s=await setup(),work=externalLearningCandidates(s,project,now)[0];s.externalLearningChecks={[work.event.eventKey]:{project:'p',eventKey:work.event.eventKey,evidenceVersion:'old-measurement-policy',lastCheckedAt:date(now),status:'Leitura indisponível',code:'SOURCE_EXTERNAL_WINDOW'}};
 const before=structuredClone(s.externalLearningChecks);assert.equal(externalLearningCandidates(s,project,now).length,1);assert.deepEqual(s.externalLearningChecks,before);s.paused=true;assert.equal(externalLearningCandidates(s,project,now).length,0);
});
