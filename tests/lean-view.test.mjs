import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {packHistoryState,hydrateHistoryState,leanHistory} from '../lib/history-storage.mjs';

// Owner report of 10/11/2026: the executor object was reset for memory every few minutes; one full copy of the central
// is ~40 MB in a 128 MB object. Display readers get a lean copy without the heavy history. Synthetic fixtures only.
const now=Date.parse('2026-11-10T12:00:00Z');
const store=()=>{const rows=new Map();return {rows,fetched:[],fetch:async function(keys){this.fetched.push(...keys);return keys.filter(k=>rows.has(k)).map(k=>({key:k,payload:rows.get(k)}));},put(archives){for(const a of archives)rows.set(a.key,JSON.stringify(a.payload));}};};
const change=(i,field)=>({key:JSON.stringify(['p1','ev'+i]),project:'p1',eventId:'ev'+i,adAccountId:'a1',campaignExternalId:'c1',objectExternalId:'c1',level:'ad',category:'status',at:'2026-11-0'+(1+i%9)+'T10:00:00.000Z',source:'malva',...(field?{field:'status',before:'ACTIVE',after:'PAUSED'}:{})});
const logical=()=>({config:{p1:{projectName:'P'}},paused:false,
 historyLearning:{version:1,scopes:{s:{project:'p1'}},failures:{},changes:Array.from({length:40},(_,i)=>change(i,i%4===0))},
 decisionHistoryOutcomes:[{id:'o1',project:'p1',summary:'s',observedAt:'2026-11-05T00:00:00Z',request:{big:'x'.repeat(300)},before:{v:1},after:{v:2}}],
 decisionHistory:Array.from({length:130},(_,i)=>({id:'d'+i,project:'p1',eventKey:'k'+i})),
 decisionHistoryImports:Array.from({length:45},(_,i)=>({id:'i'+i,observations:[]})),
 campaignChanges:Array.from({length:3},(_,i)=>({id:'cc'+i,project:'p1'})),
 externalHistoryMeasurements:Array.from({length:5},(_,i)=>({id:'m'+i}))});

test('A lean read loads only the display journals and keeps every index',async()=>{
 const db=store(),input=logical(),packed=await packHistoryState(input,now);db.put(packed.archives);
 const lean=await hydrateHistoryState(packed.state,k=>db.fetch(k),{lean:true});
 assert.deepEqual(lean.decisionHistory,input.decisionHistory,'decision history identical');
 assert.deepEqual(lean.campaignChanges,input.campaignChanges,'campaign changes identical');
 assert.equal(lean.historyLearning.changes,undefined,'the change ledger stays in its records');
 assert.ok(lean.historyLearning.changesStorage.entries.length>0,'its index stays');
 assert.deepEqual(lean.historyLearning.scopes,input.historyLearning.scopes);
 assert.equal(lean.decisionHistoryOutcomes[0].request,undefined,'outcome evidence stays in its record');
 assert.equal(lean.decisionHistoryOutcomes[0].summary,'s','outcome summary stays');
 assert.equal(lean.decisionHistoryImports,undefined);assert.equal(lean.externalHistoryMeasurements,undefined);
 assert.deepEqual(Object.keys(lean.journalStorage.journals).sort(),['decisionHistoryImports','externalHistoryMeasurements']);
 assert.ok(db.fetched.every(k=>k.startsWith('history-journal:')),'no ledger or outcome record fetched');
 assert.equal(lean.historyStorage.lean,true);
 assert.deepEqual(leanHistory.journals,['decisionHistory','campaignChanges']);
});

test('A lean state is never committed: marked, spread or unmarked, the pack refuses it',async()=>{
 const db=store(),packed=await packHistoryState(logical(),now);db.put(packed.archives);
 const lean=await hydrateHistoryState(packed.state,k=>db.fetch(k),{lean:true});
 for(const candidate of [lean,{...lean},(({historyStorage,...rest})=>rest)(lean),(({historyStorage,journalStorage,...rest})=>rest)(lean)])
  await assert.rejects(packHistoryState(candidate,now),e=>e.code==='STORAGE_INTEGRITY');
});

test('A lean read fails closed on a missing or altered display journal',async()=>{
 const db=store(),packed=await packHistoryState(logical(),now);db.put(packed.archives);
 const key=packed.state.journalStorage.journals.decisionHistory[0].key,missing=store();missing.put(packed.archives.filter(a=>a.key!==key));
 await assert.rejects(hydrateHistoryState(packed.state,k=>missing.fetch(k),{lean:true}),e=>e.code==='STORAGE_INTEGRITY');
 const unknown={...packed.state,journalStorage:{version:1,journals:{reports:[]}}};
 await assert.rejects(hydrateHistoryState(unknown,k=>db.fetch(k),{lean:true}),e=>e.code==='STORAGE_INTEGRITY');
});

// Static audit: no module reachable from the display readers of the executor touches what a lean read leaves out
// (the module that only shares item validators, cloud-history-learning, is reached through activity-history; its
// functions that read the ledger are never called by these readers, which this test pins by name).
test('No display reader of the executor reaches the fields a lean read leaves out',()=>{
 const roots=['companion-summary','autonomy-shadow','first-24h','shadow-learning','team-learning','meta-display','campaign-activity','live-data','cloud-collector','account-limits','owner-applied','change-watch','owner-orders','autonomy-grant','owner-order-live','decision-contingency','sales-feed','phone-alerts','change-attribution','activity-history'];
 const seen=new Set(),lib=new URL('../lib/',import.meta.url).pathname;
 const walk=f=>{if(seen.has(f))return;seen.add(f);const src=fs.readFileSync(f,'utf8');for(const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g)){const p=path.resolve(path.dirname(f),m[1]);for(const c of [p,p+'.mjs',p+'.ts'])if(fs.existsSync(c)&&fs.statSync(c).isFile()){walk(c);break;}}};
 for(const r of roots)walk(path.join(lib,r+'.mjs'));
 const omitted=/\b(historyLearning|decisionHistoryOutcomes|decisionHistoryImports|externalHistoryMeasurements)\b/;
 const direct=roots.filter(r=>omitted.test(fs.readFileSync(path.join(lib,r+'.mjs'),'utf8')));
 assert.deepEqual(direct,[],'no display reader names an omitted field');
 const reached=[...seen].filter(f=>omitted.test(fs.readFileSync(f,'utf8'))).map(f=>path.basename(f)).sort();
 // Reached only as libraries of item helpers: activity-history imports historyItemOf/financialHistoryItem.
 const ah=fs.readFileSync(path.join(lib,'activity-history.mjs'),'utf8');
 assert.match(ah,/import \{historyItemOf,financialHistoryItem\} from '\.\/cloud-history-learning\.mjs'/);
 assert.ok(reached.every(f=>['cloud-history-learning.mjs','decision-cards.mjs','knowledge.mjs','decision-history-outcomes.mjs','external-adjustment-sequence.mjs','external-learning.mjs','history-storage.mjs'].includes(f)),reached.join(','));
 const exec=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.doesNotMatch(exec,omitted,'the executor itself never reads them');
});

// The analysis unit keeps only {snapshots, collaborationRounds, collaborationMessages} of its read during the model wait
// (lib/cloud-engine.mjs); the functions that check the answer against it must read nothing else from the state.
test('The answer checks read only the part of the read kept during the model wait',()=>{
 const body=(file,name)=>{const src=fs.readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),i=src.indexOf('export function '+name+'(');assert.ok(i>=0,name);const next=src.indexOf('\nexport ',i+1);const fn=src.slice(i,next<0?undefined:next);return fn.slice(fn.indexOf('{'));};
 const allowed=new Set(['snapshots','collaborationRounds','collaborationMessages']);
 for(const [file,name] of [['campaign-learning-coverage.mjs','normalizeCampaignReadings'],['agent-development.mjs','normalizeAgentReflection'],['cloud-analysis.mjs','cloudEvidence']]){
  const b=body(file,name),used=[...b.matchAll(/\bstate\??\.([A-Za-z]+)/g)].map(m=>m[1]);
  assert.ok(used.length,name+' reads the state');
  assert.deepEqual(used.filter(f=>!allowed.has(f)),[],name+' reads only the kept fields');
  assert.doesNotMatch(b,/[A-Za-z_]\((?:[^()]*,)?\s*state\s*[,)]/,name+' passes the state to no other function');
 }
});

// Modo Gestor (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md): the read model reads only the state the Sombra pass holds and
// DO keys; it never names a field a lean read leaves out, and its builders never mutate a shared (frozen) view.
test('The Modo Gestor read model stays within the lean display copy',async()=>{
 const lib=new URL('../lib/',import.meta.url).pathname,omitted=/\b(historyLearning|decisionHistoryOutcomes|decisionHistoryImports|externalHistoryMeasurements)\b/;
 for(const f of ['autonomy-deep-view.mjs','autonomy-simulate.mjs'])assert.doesNotMatch(fs.readFileSync(path.join(lib,f),'utf8'),omitted,f);
 const {buildDeepBase,buildDeepView,autonomyCompanion}=await import('../lib/autonomy-deep-view.mjs');
 const freeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))freeze(v);}return o;};
 const s=freeze({config:{p1:{projectName:'P'}},paused:false,autonomy:{version:1,enabled:true,projects:{p1:{mode:'shadow',actions:{},limits:{},campaigns:{}}}},snapshots:[{projectId:'p1',period:'today',level:'campaign',complete:true,timezone:'America/Sao_Paulo',from:'2026-11-10T03:00:00.000Z',fetchedAt:'2026-11-10T11:55:00.000Z',rows:[{externalId:'c1',adAccountId:'a1',name:'Escala',level:'campaign',provider:'meta',status:'ACTIVE',spend:10,dailyBudget:100,budgetCurrency:'BRL'}]}],proposals:[],executions:[]});
 assert.doesNotThrow(()=>{const base=buildDeepBase({state:s,liveItems:[],accuracy:{},policy:{},now});buildDeepView({base:freeze(base),project:'all',now});autonomyCompanion({base,project:'all',now});});
});
