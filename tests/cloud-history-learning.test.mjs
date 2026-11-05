import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHistoryLearning,persistHistoryLearning,historyLearningKey} from '../lib/cloud-history-learning.mjs';
import {importDecisionHistory} from '../lib/decision-cards.mjs';
import {historyNow,historyProject,historyRow,historyEvent} from './fixtures/history-learning.mjs';
const page=(items,nextCursor=null)=>({items,nextCursor,timezone:'UTC',period:{from:null,to:null,timezone:'UTC'}});
const base=()=>({config:{p:{projectName:'John'}},snapshots:[],proposals:[],executions:[],paused:false});
const boundedPage=(items=[],nextCursor=null)=>({items,nextCursor,timezone:'UTC',period:{from:'2026-11-01T00:00:00.000Z',to:'2026-11-04T00:00:00.000Z',timezone:'UTC'}});
test('An explicit closed history window proves its empty beginning without extending its end to collection time',async()=>{
 const state=base(),calls=[],client={read:async(_t,a)=>{calls.push(a);return boundedPage([historyEvent(3)]);}};
 const range={from:'2026-11-01',to:'2026-11-03'},result=await collectHistoryLearning(client,historyProject,historyRow,null,{now:()=>historyNow,range});assert.equal(result.batch.from,'2026-11-01T00:00:00.000Z');assert.equal(result.batch.to,'2026-11-04T00:00:00.000Z');assert.equal(calls[0].anytime,undefined);assert.equal(calls[0].who,'all');assert.equal(calls[0].from,range.from);persistHistoryLearning(state,result,historyNow);assert.equal(state.historyLearning.scopes[historyLearningKey('p','a','c')].intervals[0].to,result.batch.to);
 const empty=await collectHistoryLearning({read:async()=>boundedPage()},historyProject,historyRow,null,{now:()=>historyNow,range});assert.equal(empty.batch.events.length,0);assert.equal(empty.batch.from,result.batch.from);assert.equal(empty.batch.to,result.batch.to);
});
test('Repairing older history preserves the newer incremental cursor and unions only proven intervals',async()=>{
 const state=base(),initial=await collectHistoryLearning({read:async()=>page([historyEvent(3)])},historyProject,historyRow,null,{now:()=>historyNow});persistHistoryLearning(state,initial,historyNow);const key=historyLearningKey('p','a','c'),prior=structuredClone(state.historyLearning.scopes[key].scope);
 const repair=await collectHistoryLearning({read:async()=>boundedPage([historyEvent(3)])},historyProject,historyRow,state.historyLearning.scopes[key],{now:()=>historyNow+1000,range:{from:'2026-11-01',to:'2026-11-03'}});persistHistoryLearning(state,repair,historyNow+1000);assert.deepEqual(state.historyLearning.scopes[key].scope,prior);assert.equal(state.historyLearning.scopes[key].intervals[0].from,repair.batch.from);assert.equal(state.historyLearning.scopes[key].intervals[0].to,prior.to);assert.equal(state.decisionHistory.length,1);
});
test('A range repair rejects absent or changed bounds, future days and out-of-window source events',async()=>{
 for(const mutate of [p=>p.period.from=null,p=>p.period.to=null,p=>p.period.from='2026-11-02T00:00:00Z',p=>p.items=[historyEvent(5)]])await assert.rejects(collectHistoryLearning({read:async()=>{const p=boundedPage();mutate(p);return p;}},historyProject,historyRow,null,{now:()=>historyNow,range:{from:'2026-11-01',to:'2026-11-03'}}),e=>e.code==='SOURCE_HISTORY_RANGE');
 for(const range of [{from:'2026-11-04',to:'2026-11-03'},{from:'2026-11-01',to:'2026-11-05'}])await assert.rejects(collectHistoryLearning({read:async()=>{throw Error('Must not read');}},historyProject,historyRow,null,{now:()=>historyNow,range}),e=>e.code==='SOURCE_HISTORY_RANGE');
});
test('Maximum history pagination resumes across jobs and imports only after the final page',async()=>{
 const requests=[],client={read:async(t,a)=>{requests.push(a);return page([historyEvent(Number(a.cursor||1))],Number(a.cursor||1)<5?String(Number(a.cursor||1)+1):null);}},s=base();
 const first=await collectHistoryLearning(client,historyProject,historyRow,null,{now:()=>historyNow});assert.equal(first.calls,3);assert.equal(first.pending.items.length,3);assert.equal(first.batch,null);persistHistoryLearning(s,first,historyNow);assert.equal(s.decisionHistory,undefined);
 const key=historyLearningKey('p','a','c'),second=await collectHistoryLearning(client,historyProject,historyRow,s.historyLearning.scopes[key],{now:()=>historyNow+1000});assert.equal(second.calls,3);assert.equal(second.research.items[0].id,'e1');assert.equal(second.batch.events.length,5);assert.equal(second.pending,null);persistHistoryLearning(s,second,historyNow+1000);assert.equal(s.decisionHistory.length,5);assert.equal(s.decisionHistory[0].measurementOwner,'history-learning');assert.equal(s.historyLearning.scopes[key].intervals[0].from,historyEvent(5).at);assert.equal(requests[3].cursor,undefined);assert.equal(requests[4].cursor,'4');assert.deepEqual(s.executions,[]);
});
test('Repeated reads keep a single action and receipt; later native echo adds provenance only',async()=>{
 const s=base();let echo=null;const c={read:async()=>page([historyEvent(2,{echo})])};
 let r=await collectHistoryLearning(c,historyProject,historyRow,null,{now:()=>historyNow});persistHistoryLearning(s,r,historyNow);const original=structuredClone(s.decisionHistory[0]);
 const key=historyLearningKey('p','a','c');r=await collectHistoryLearning(c,historyProject,historyRow,s.historyLearning.scopes[key],{now:()=>historyNow+1000});persistHistoryLearning(s,r,historyNow+1000);assert.equal(s.decisionHistoryImports.length,1);
 echo={at:historyEvent(2).at,actorName:'Meta'};r=await collectHistoryLearning(c,historyProject,historyRow,s.historyLearning.scopes[key],{now:()=>historyNow+2000});const saved=persistHistoryLearning(s,r,historyNow+2000);assert.equal(saved.enriched,1);assert.equal(s.decisionHistory.length,1);assert.equal(s.decisionHistory[0].nativeEcho,null);assert.equal(s.decisionHistory[0].originObservations.length,2);assert.equal(s.decisionHistory[0].id,original.id);assert.equal(s.decisionHistory[0].before,100);
});
test('Late echo cannot conceal changed amounts, actor, object or timestamps',()=>{
 const s=base(),e=historyEvent(2,{echo:null}),entry={project:'p',from:historyEvent(3).at,to:new Date(historyNow).toISOString(),fetchedAt:new Date(historyNow).toISOString(),complete:true,pagination:{complete:true,nextCursor:null},events:[e]};importDecisionHistory(s,{entry},historyNow);
 for(const alter of [e=>e.values.to=999,e=>e.actor.name='Other',e=>e.object.externalId='other',e=>e.at=historyEvent(1).at]){const changed=structuredClone(e);changed.echo={at:e.at};alter(changed);const before=structuredClone(s);assert.throws(()=>importDecisionHistory(s,{entry:{...entry,events:[changed]}},historyNow));assert.deepEqual(s,before);}
});
test('Read scope rejects wrong account, currency, descendant, timezone, order, cursor cycles and divergent pages',async()=>{
 for(const mutate of [p=>p.items[0].account.id='foreign',p=>p.items[0].account.currency='BRL',p=>p.items[0].object={level:'ad',externalId:'ad',campaign:{externalId:'foreign'}},p=>p.timezone='America/Sao_Paulo',p=>p.items=[historyEvent(3),historyEvent(1)],p=>p.nextCursor='repeat']){
  const c={read:async()=>{const p=page([historyEvent(2)]);mutate(p);return p;}};await assert.rejects(collectHistoryLearning(c,historyProject,historyRow,null,{now:()=>historyNow}));
 }
});
test('Descendant edits remain confounders and do not become campaign budget actions',async()=>{
 const s=base(),child=historyEvent(3,{category:'creative',object:{level:'ad',externalId:'ad',campaign:{externalId:'c'}},values:{kind:'text',field:'video',from:'old',to:'new'}}),r=await collectHistoryLearning({read:async()=>page([historyEvent(2),child])},historyProject,historyRow,null,{now:()=>historyNow});persistHistoryLearning(s,r,historyNow);assert.equal(s.decisionHistory.length,1);assert.equal(s.historyLearning.changes.length,2);assert.equal(s.historyLearning.changes[1].level,'ad');assert.equal(s.historyLearning.changes[1].category,'creative');
});
test('Incremental window overlaps prior completion and stale writers preserve current history',async()=>{
 const s=base(),calls=[],c={read:async(_t,a)=>{calls.push(a);return page([historyEvent(2)]);}},r=await collectHistoryLearning(c,historyProject,historyRow,null,{now:()=>historyNow});persistHistoryLearning(s,r,historyNow);const key=historyLearningKey('p','a','c');await collectHistoryLearning(c,historyProject,historyRow,s.historyLearning.scopes[key],{now:()=>historyNow+86400000});assert.equal(calls[1].preset,'custom');assert.equal(calls[1].from,'2026-11-04');assert.equal(calls[1].to,'2026-11-06');const before=structuredClone(s);assert.equal(persistHistoryLearning(s,r,historyNow).status,'Releitura necessária');assert.deepEqual(s,before);
});

test('Automatic reread preserves a native actor profile imported earlier, avoiding a false same-ID conflict',async()=>{
 const s=base(),event=historyEvent(2,{source:'meta',automatic:true,actor:{key:'system',name:'Meta',kind:'system',profile:'Dash'},category:'status',values:{kind:'status',from:'processing',to:'active'},echo:null});
 importDecisionHistory(s,{entry:{project:'p',from:historyEvent(3).at,to:new Date(historyNow).toISOString(),fetchedAt:new Date(historyNow).toISOString(),complete:true,pagination:{complete:true,nextCursor:null},events:[event]}},historyNow);
 const prior=structuredClone(s.decisionHistory[0]),r=await collectHistoryLearning({read:async()=>page([event])},historyProject,historyRow,null,{now:()=>historyNow+1000});const saved=persistHistoryLearning(s,r,historyNow+1000);assert.equal(saved.inserted,0);assert.equal(s.decisionHistory.length,1);assert.equal(s.decisionHistory[0].actor.profile,'Dash');assert.deepEqual(s.decisionHistory[0],prior);
});

test('Divergent optional history is explicitly quarantined without replacing prior ledger or losing analytic data',async()=>{
 const {storeHistoryCollection}=await import('../lib/cloud-history-learning.mjs'),s=base();let e=historyEvent(2);const c={read:async()=>page([e])};let r=await collectHistoryLearning(c,historyProject,historyRow,null,{now:()=>historyNow});storeHistoryCollection(s,r,historyNow);const ledger=structuredClone(s.decisionHistory),scope=structuredClone(s.historyLearning.scopes),snapshots=s.snapshots;
 e=historyEvent(2,{values:{kind:'money',field:'daily_budget',currency:'USD',from:100,to:999}});const key=historyLearningKey('p','a','c');r=await collectHistoryLearning(c,historyProject,historyRow,s.historyLearning.scopes[key],{now:()=>historyNow+1000});assert.equal(storeHistoryCollection(s,r,historyNow+1000).status,'Histórico requer conciliação');assert.deepEqual(s.decisionHistory,ledger);assert.deepEqual(s.historyLearning.scopes,scope);assert.equal(s.snapshots,snapshots);assert.deepEqual(s.historyLearning.failures[key].fields,['after']);
 e=historyEvent(2);r=await collectHistoryLearning(c,historyProject,historyRow,s.historyLearning.scopes[key],{now:()=>historyNow+2000});storeHistoryCollection(s,r,historyNow+2000);assert.equal(s.historyLearning.failures[key],undefined);assert.equal(s.decisionHistory.length,1);
});
