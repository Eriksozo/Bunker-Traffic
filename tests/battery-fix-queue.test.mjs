import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {companionSummary} from '../lib/companion-summary.mjs';
import {activityLog} from '../lib/campaign-activity.mjs';
import {pausedAfterAnalysis,statusAfterAnalysis,liveStatusRows,actionQueue,queueCandidates,objectKey,dailyComparison,dayBound,withoutStaleToday} from '../lib/daily-brief.mjs';

// Battery fixes for the "O que fazer agora" queue (web + notch). Synthetic fixtures only: ids, names and values are invented.
const NOW=Date.parse('2026-11-09T17:00:00Z'); // 14:00 America/Sao_Paulo
const iso=ms=>new Date(ms).toISOString();
const m=(spend,net,front=1)=>({spend,revenue:net,revenueNet:net,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:2,impressions:1000,linkClicks:10,refundedRevenue:0});
const row=(id,extra={})=>({id:'00000000-0000-4000-8000-'+String(id).padStart(12,'0'),externalId:'x'+id,adAccountId:'act_9',accountName:'Conta Teste',name:'Campanha Teste '+id,level:'campaign',provider:'meta',effectiveStatus:'ACTIVE',status:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',lifetimeBudget:null,deliveryStartedAt:'2026-10-01T00:00:00Z',...extra});
const ranges={today:['2026-11-09T03:00:00.000Z','2026-11-10T03:00:00.000Z'],yesterday:['2026-11-08T03:00:00.000Z','2026-11-09T03:00:00.000Z'],'3d':['2026-11-06T03:00:00.000Z','2026-11-09T03:00:00.000Z'],'7d':['2026-11-02T03:00:00.000Z','2026-11-09T03:00:00.000Z']};
const snap=(period,rows,{fetchedAt=NOW-600000,lastSyncAt=NOW-660000}={})=>({projectId:'p',projectName:'Projeto Teste',period,level:'campaign',source:'Malva MCP',complete:true,timezone:'America/Sao_Paulo',from:ranges[period][0],to:ranges[period][1],fetchedAt:iso(fetchedAt),lastSyncAt:lastSyncAt===null?null:iso(lastSyncAt),rows});
const losing=(id,extra={})=>{const r=row(id,extra);return {today:{...r,...m(500,200)},yesterday:{...r,...m(400,300)},'3d':{...r,...m(1200,800)},'7d':{...r,...m(3000,2000)}};};
function stateOf(camps,todayCut={}){
 return {config:{p:{projectName:'Projeto Teste'}},paused:false,ownerChoices:[],decisions:[],proposals:[],executions:[],decisionHistory:[],collaborationMessages:[],
  snapshots:['today','yesterday','3d','7d'].map(p=>snap(p,camps.map(c=>c[p]),p==='today'?todayCut:{}))};
}
const liveItem=(rows,{fetchedAt=NOW-30000,lastSyncAt=NOW-45000}={})=>({projectId:'p',lastSuccessAt:iso(fetchedAt),snapshot:snap('today',rows,{fetchedAt,lastSyncAt})});
function confirmedPause(state,r,at){
 state.proposals.push({id:'o1',project:'p',status:'Aprovada',createdBy:'owner',ownerOrder:true,directOrder:true,roundId:null,createdAt:iso(at-30000),expiresAt:iso(at+900000),
  payload:{action:'status',level:'campaign',adAccountId:r.adAccountId,objectId:r.externalId,objectName:r.name,accountName:r.accountName,currency:'BRL',before:{status:'ACTIVE'},after:{status:'PAUSED'},liveTarget:{id:r.id}}});
 state.executions.push({id:'e1',proposalId:'o1',project:'p',status:'Confirmada',claimedAt:iso(at-20000),submittedAt:iso(at-10000),confirmedAt:iso(at)});
 return state;
}
const history=(r,after,at)=>({id:'h-'+after+at,project:'p',adAccountId:r.adAccountId,objectId:r.externalId,name:r.name,field:'status',before:after==='ACTIVE'?'PAUSED':'ACTIVE',after,occurredAt:iso(at),actor:'Gestor Teste',currency:'BRL'});
const names=out=>out.queue.map(q=>q.campaign);
const cand=(r,sourceAt)=>[{id:'c',row:{...r,projectId:'p',sourceAt:iso(sourceAt)},windows:{today:{...r,...m(400,100)}},tone:'red'}];

test('#13 Meta applying an edit (IN_PROCESS/PROCESSING) is not a pause: the losing campaign stays in the queue',()=>{
 const r=row(1),c=cand(r,NOW-20*60000),k=objectKey('p','act_9','x1');
 for(const effectiveStatus of ['IN_PROCESS','PROCESSING']){
  const live=[{...r,projectId:'p',effectiveStatus,fetchedAt:iso(NOW-30000),lastSyncAt:iso(NOW-60000)}];
  const keys=pausedAfterAnalysis(c,{liveRows:live}),q=actionQueue(c,{now:NOW,pausedKeys:keys});
  assert.deepEqual([keys.size,q.items.length,q.pausedSinceAnalysis],[0,1,0],effectiveStatus);
 }
 // A status event into IN_PROCESS is not a pause either.
 assert.equal(pausedAfterAnalysis(c,{events:[{project:'p',adAccountId:'act_9',objectId:'x1',action:'status',field:'effectiveStatus',before:'PAUSED',after:'IN_PROCESS',at:iso(NOW-60000)}]}).size,0);
 // Unchanged: PAUSED in either field, or another non-active state, still takes it off.
 for(const extra of [{status:'PAUSED'},{effectiveStatus:'PAUSED'},{effectiveStatus:'CAMPAIGN_PAUSED'},{effectiveStatus:'WITH_ISSUES'}])
  assert.ok(pausedAfterAnalysis(c,{liveRows:[{...r,projectId:'p',...extra,fetchedAt:iso(NOW-30000),lastSyncAt:iso(NOW-60000)}]}).has(k),JSON.stringify(extra));
});

test('#14 the web queue dates live rows by their origin sync like the notch (lastSyncAt kept)',()=>{
 const r=row(2),rows=liveStatusRows([liveItem([{...r,...m(500,200)}],{fetchedAt:NOW-30000,lastSyncAt:NOW-600000})],NOW);
 assert.equal(rows.length,1);assert.equal(rows[0].lastSyncAt,iso(NOW-600000));assert.equal(rows[0].fetchedAt,iso(NOW-30000));assert.equal(rows[0].projectId,'p');
 // Confirmed pause at NOW-2min, Malva cache synced at NOW-10min but fetched NOW-30s: the pause stays.
 const events=[{project:'p',adAccountId:'act_9',objectId:'x2',action:'pause',field:'status',after:'PAUSED',at:iso(NOW-120000),origin:'bunker'}];
 assert.ok(pausedAfterAnalysis(cand(r,NOW-20*60000),{events,liveRows:rows}).has(objectKey('p','act_9','x2')));
 const web=readFileSync(new URL('../app/daily-brief.tsx',import.meta.url),'utf8');
 assert.match(web,/liveStatusRows\(liveItems,now\)/,'the web queue uses the shared mapping that keeps lastSyncAt');
 assert.doesNotMatch(web,/fetchedAt:s\.fetchedAt\}\)/,'no local mapping that drops lastSyncAt');
});

test('#24 a live ACTIVE reading whose origin sync is unknown never undoes a confirmed pause',()=>{
 const camp=losing(3),s=confirmedPause(stateOf([camp]),row(3),NOW-120000);
 const live=[liveItem([{...row(3),...m(510,200)}],{fetchedAt:NOW-10000,lastSyncAt:null})];
 assert.deepEqual(names(companionSummary(s,{project:'p',now:NOW,live})),[]);
 const missing=liveItem([{...row(3),...m(510,200)}],{fetchedAt:NOW-10000});delete missing.snapshot.lastSyncAt;
 assert.deepEqual(names(companionSummary(s,{project:'p',now:NOW,live:[missing]})),[]);
 // A known origin sync after the pause still reads as a reactivation.
 assert.deepEqual(names(companionSummary(s,{project:'p',now:NOW,live:[liveItem([{...row(3),...m(510,200)}],{fetchedAt:NOW-10000,lastSyncAt:NOW-20000})]})),['Campanha Teste 3']);
 // A PAUSED live row with an unknown origin still hides it (dated by its fetch).
 const c=cand(row(3),NOW-20*60000);
 assert.equal(pausedAfterAnalysis(c,{liveRows:[{...row(3),projectId:'p',status:'PAUSED',effectiveStatus:'PAUSED',fetchedAt:iso(NOW-10000),lastSyncAt:null}]}).size,1);
});

test('#25 after local midnight the previous day analysis is not shown as today (N/D) in queue, summary and board',()=>{
 const s=stateOf([losing(4)],{fetchedAt:Date.parse('2026-11-10T02:50:00Z'),lastSyncAt:Date.parse('2026-11-10T02:49:00Z')});
 const before=companionSummary(s,{project:'p',now:Date.parse('2026-11-10T02:55:00Z')}); // 23:55 local, same day
 assert.equal(before.queue[0].period,'today');assert.equal(before.today.today.spend,500);assert.equal(before.board[0].spend,500);
 const out=companionSummary(s,{project:'p',now:Date.parse('2026-11-10T03:20:00Z')}); // 00:20 local, next day
 assert.equal(out.today.today,null,'no reading of the new day yet: N/D');
 assert.equal(out.today.deltas.roas.yesterday,null);
 assert.equal(out.board[0].spend,null);assert.equal(out.board[0].roas,null);
 assert.equal(out.pace.today??out.pace.status??'nd','nd');
 for(const q of out.queue){assert.notEqual(q.period,'today');assert.equal(q.detail.windows.today,null,'today window N/D, never 0');}
 const all=companionSummary(s,{now:Date.parse('2026-11-10T03:20:00Z')});
 assert.equal(all.today.today,null);assert.ok(all.queue.every(q=>q.period!=='today'));
});

test('#26 a pause seen in a live reading newer than the analysis survives the day change until a newer ACTIVE',()=>{
 const s=stateOf([losing(5),losing(6)],{fetchedAt:Date.parse('2026-11-10T02:30:00Z'),lastSyncAt:Date.parse('2026-11-10T02:29:00Z')});
 const live=[liveItem([{...row(5,{status:'PAUSED',effectiveStatus:'PAUSED'}),...m(520,200)},{...row(6),...m(500,200)}],{fetchedAt:Date.parse('2026-11-10T02:58:00Z'),lastSyncAt:Date.parse('2026-11-10T02:57:30Z')})];
 assert.deepEqual(names(companionSummary(s,{project:'p',now:Date.parse('2026-11-10T02:59:00Z'),live})),['Campanha Teste 6']);
 const t=Date.parse('2026-11-10T03:01:00Z'),after=companionSummary(s,{project:'p',now:t,live});
 // Final review: after local midnight the old analysis is not today's, so the queue waits for the new day's analysis.
 assert.deepEqual(names(after),[],'no loss from the previous day labeled hoje or 3 dias');
 // The pause itself is not day-bound: the 23:58 reading still marks campaign 5 paused at 00:01 (until a newer ACTIVE).
 const cands=[5,6].map(id=>({row:{...row(id),projectId:'p',sourceAt:'2026-11-10T02:30:00.000Z'}})),k5=objectKey('p','act_9','x5');
 assert.ok(statusAfterAnalysis(cands,{liveRows:liveStatusRows(live,t)}).paused.has(k5),'still paused at 00:01');
 s.decisionHistory.push(history(row(5),'ACTIVE',Date.parse('2026-11-10T03:00:30Z')));
 const back=statusAfterAnalysis(cands,{events:activityLog(structuredClone(s),{project:'p',now:t}),liveRows:liveStatusRows(live,t)});
 assert.ok(!back.paused.has(k5),'a newer ACTIVE brings it back');
 // A snapshot that was never a live reading (fetched after its own day) still does not count.
 const odd={projectId:'p',snapshot:{...live[0].snapshot,fetchedAt:'2026-11-10T03:00:30.000Z'}};
 assert.deepEqual(liveStatusRows([odd],Date.parse('2026-11-10T03:01:00Z')),[]);
});

test('#27 a campaign paused at analysis time and reactivated afterwards comes back to the queue',()=>{
 const s=stateOf([losing(7,{status:'PAUSED',effectiveStatus:'PAUSED'}),losing(8)]);
 assert.deepEqual(names(companionSummary(s,{project:'p',now:NOW})),['Campanha Teste 8'],'control: paused at analysis time');
 s.decisionHistory.push(history(row(7),'ACTIVE',NOW-120000));
 const live=[liveItem([{...row(7),...m(520,200)},{...row(8),...m(500,200)}],{fetchedAt:NOW-10000,lastSyncAt:NOW-20000})];
 const out=companionSummary(s,{project:'p',now:NOW,live});
 assert.ok(names(out).includes('Campanha Teste 7'));assert.ok(out.board[0].losses>=2);
 // Direct: the newest record after the analysis says ACTIVE.
 const c=cand(row(7,{status:'PAUSED',effectiveStatus:'PAUSED'}),NOW-20*60000),k=objectKey('p','act_9','x7');
 const st=statusAfterAnalysis(c,{events:[{project:'p',adAccountId:'act_9',objectId:'x7',action:'activate',field:'status',before:'PAUSED',after:'ACTIVE',at:iso(NOW-60000)}]});
 assert.ok(st.reactivated.has(k));assert.equal(st.paused.size,0);
 assert.equal(actionQueue(c,{now:NOW}).items.length,0,'without the newer record it stays out');
 assert.equal(actionQueue(c,{now:NOW,reactivatedKeys:st.reactivated}).items.length,1);
 // Older reactivation, unknown-origin ACTIVE live row, or a mid-edit IN_PROCESS never bring it back.
 assert.equal(statusAfterAnalysis(c,{events:[{project:'p',adAccountId:'act_9',objectId:'x7',action:'activate',field:'status',after:'ACTIVE',at:iso(NOW-3600000)}]}).reactivated.size,0);
 assert.equal(statusAfterAnalysis(c,{liveRows:[{...row(7),projectId:'p',fetchedAt:iso(NOW-10000),lastSyncAt:null}]}).reactivated.size,0);
 assert.equal(statusAfterAnalysis(c,{liveRows:[{...row(7,{effectiveStatus:'IN_PROCESS'}),projectId:'p',fetchedAt:iso(NOW-10000),lastSyncAt:iso(NOW-20000)}]}).reactivated.size,0);
 // An inactive account stays out even when reactivated.
 const inactive=cand(row(7,{status:'PAUSED',effectiveStatus:'PAUSED',accountStatus:{active:false}}),NOW-20*60000);
 assert.equal(actionQueue(inactive,{now:NOW,reactivatedKeys:new Set([k])}).items.length,0);
});

test('#28 queueSize ("X de Y na fila") drops the campaign paused after the analysis',()=>{
 const s=stateOf([losing(9),losing(10)]);
 const before=companionSummary(s,{project:'p',now:NOW});
 assert.deepEqual([before.queue.length,before.queueSize],[2,2]);
 const out=companionSummary(confirmedPause(structuredClone(s),row(9),NOW-60000),{project:'p',now:NOW});
 assert.deepEqual(names(out),['Campanha Teste 10']);assert.equal(out.queueSize,1);
});

test('#28 review: queueSize counts only what the queue can list (analysis PAUSED or inactive account never counts; reactivated does)',()=>{
 const s=stateOf([losing(11,{status:'PAUSED',effectiveStatus:'PAUSED'}),losing(12),losing(13,{accountStatus:{active:false}})]);
 const out=companionSummary(s,{project:'p',now:NOW});
 assert.deepEqual(names(out),['Campanha Teste 12']);assert.equal(out.queueSize,1,'"1 de 1 na fila"');
 s.decisionHistory.push(history(row(11),'ACTIVE',NOW-120000));
 const live=[liveItem([{...row(11),...m(520,200)},{...row(12),...m(500,200)}],{fetchedAt:NOW-10000,lastSyncAt:NOW-20000})];
 const back=companionSummary(s,{project:'p',now:NOW,live});
 assert.ok(names(back).includes('Campanha Teste 11'));assert.equal(back.queueSize,2);
 // Same set as actionQueue: paused after the analysis, inactive row or inactive account never counts.
 const c=[...cand(row(14),NOW-20*60000),...cand(row(15,{effectiveStatus:'PAUSED'}),NOW-20*60000),...cand(row(16,{accountStatus:{active:false}}),NOW-20*60000),...cand(row(17),NOW-20*60000)];
 const k=id=>objectKey('p','act_9','x'+id);
 assert.deepEqual(queueCandidates(c).map(x=>x.row.externalId),['x14','x17']);
 assert.deepEqual(queueCandidates(c,{pausedKeys:new Set([k(17)]),reactivatedKeys:new Set([k(15),k(16)])}).map(x=>x.row.externalId),['x14','x15']);
});

test('#25 review: the web "Hoje em 1 minuto" uses the same midnight N/D rule as the notch',()=>{
 const s=stateOf([losing(18)],{fetchedAt:Date.parse('2026-11-10T02:50:00Z'),lastSyncAt:Date.parse('2026-11-10T02:49:00Z')});
 const late=Date.parse('2026-11-10T02:55:00Z'),next=Date.parse('2026-11-10T03:20:00Z'); // 23:55 and 00:20 local
 assert.equal(dayBound(s,late),s,'same day: unchanged');assert.equal(dailyComparison(dayBound(s,late),'p').today.spend,500);
 const cmp=dailyComparison(dayBound(s,next),'p');
 assert.equal(cmp.today,null,'N/D, never 0');assert.equal(cmp.deltas.roas.yesterday,null);
 // Final review: the old analysis' closed windows end where the stale today starts, so its 'ontem' is the day before yesterday.
 assert.equal(cmp.yesterday,null,'never the day before yesterday shown as ontem');
 const c=[{id:'c',row:{...row(18),projectId:'p',sourceAt:iso(late)},windows:{today:{...row(18),...m(500,200)},'3d':{...row(18),...m(1200,800)}},recent:{...m(1200,800),roas:0.67},tone:'red'}];
 assert.ok(withoutStaleToday(s,c,late)[0].windows.today,'same day: today window kept');
 const stripped=withoutStaleToday(s,c,next);
 assert.equal(stripped[0].windows.today,undefined);assert.equal(stripped[0].windows['3d'],undefined,'no switch to a 3-day window that misses the day that just ended');assert.ok(c[0].windows.today,'input not mutated');
 assert.equal(actionQueue(stripped,{now:next}).items.length,0,'the loss waits for the new day analysis instead of ringing again as 3 dias');
 const web=readFileSync(new URL('../app/daily-brief.tsx',import.meta.url),'utf8');
 assert.match(web,/dailyComparison\(dayBound\(state,/,'web comparison is day-bound');
 assert.match(web,/withoutStaleToday\(state,candidates,now\)/,'web queue drops the stale today window');
});
