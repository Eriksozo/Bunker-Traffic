import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHistoryLearning,persistHistoryLearning,historyLearningKey} from '../lib/cloud-history-learning.mjs';
import {importDecisionHistory} from '../lib/decision-cards.mjs';
import {historyNow,historyProject,historyRow,historyEvent} from './fixtures/history-learning.mjs';
const page=(items,nextCursor=null)=>({items,nextCursor,timezone:'UTC',period:{from:null,to:null,timezone:'UTC'}});
const base=()=>({config:{p:{projectName:'John'}},snapshots:[],proposals:[],executions:[],paused:false});
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
