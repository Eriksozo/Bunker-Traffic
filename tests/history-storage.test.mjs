import test from 'node:test';
import assert from 'node:assert/strict';
import {packHistoryState,hydrateHistoryState,historyKeys,historyView,storagePressure,historyStorageLimits,sharedChangeText} from '../lib/history-storage.mjs';
import {historyLearningPolicy} from '../lib/cloud-history-learning.mjs';
import {commitPersistedState,readPersistedState} from '../lib/persistence.mjs';
import {database} from './helpers/e2e-scenario.mjs';

// Synthetic fixtures only.
const P='11111111-1111-4111-8111-111111111111',Q='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-11-08T06:00:00Z');
const day=n=>new Date(now-n*86400000).toISOString();
const change=(i,project,ago,fin=false,extra={})=>({key:JSON.stringify([project,'e'+i]),project,eventId:'e'+i,adAccountId:'acc',campaignExternalId:'c1',objectExternalId:'o'+i,level:fin?'campaign':'ad',category:fin?'budget':'status',at:day(ago),source:'meta',...(fin?{field:'dailyBudget',before:100,after:120}:{}),...extra});
const outcome=(id,keys=[])=>({id,clientId:'c-'+id,request:JSON.stringify({eventKey:'k'+id,windows:'x'.repeat(500)}),project:P,eventId:'e',before:{rows:[{spend:1}]},after:{rows:[{spend:2}]},beforeMetrics:{roi:1},otherChangeKeys:keys,classification:'Inconclusivo'});
const store=()=>{const rows=new Map();return {rows,fetch:async keys=>keys.filter(k=>rows.has(k)).map(k=>({key:k,payload:rows.get(k)})),put:archives=>{for(const a of archives)rows.set(a.key,JSON.stringify(a.payload));}};};
const canon=s=>({...s,historyLearning:{...s.historyLearning,changes:s.historyLearning.changes.slice().sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key))}});

test('Round trip is exact: ledger and measured-result evidence come back identical', async () => {
 const logical={historyLearning:{version:1,scopes:{s:{a:1}},failures:{},changes:[change(1,P,1),change(2,Q,2,true),change(3,P,1,false,{key:'custom-key'}),change(4,P,0)]},decisionHistoryOutcomes:[outcome('o1'),{id:'legacy',classification:'x'}],other:{keep:true}};
 const db=store(),packed=await packHistoryState(logical,now);db.put(packed.archives);
 assert.equal(packed.state.historyLearning.changes,undefined,'the ledger left the central state');
 assert.equal(packed.state.decisionHistoryOutcomes[0].request,undefined);assert.ok(packed.state.decisionHistoryOutcomes[0].partsStorage.key.startsWith('history-outcome:'));
 assert.deepEqual(packed.state.decisionHistoryOutcomes[1],{id:'legacy',classification:'x'},'a result without evidence fields stays as it is');
 const back=await hydrateHistoryState(packed.state,db.fetch);
 const {historyStorage,...rest}=back;
 assert.equal(JSON.stringify(rest),JSON.stringify(canon(logical)),'byte-identical, ledger in canonical order, outcome keys in original order');
 assert.deepEqual(historyStorage.known.sort(),historyKeys(packed.state).sort());
});

test('Unchanged records are not resent; a new change writes only its own group', async () => {
 const logical={historyLearning:{changes:[change(1,P,1),change(2,P,3)]},decisionHistoryOutcomes:[outcome('o1')]};
 const db=store(),first=await packHistoryState(logical,now);db.put(first.archives);
 const read=await hydrateHistoryState(first.state,db.fetch);
 assert.equal((await packHistoryState(read,now)).archives.length,0,'nothing new to write');
 read.historyLearning.changes.push(change(9,P,1));
 const next=await packHistoryState(read,now);
 assert.equal(next.archives.length,1,'only the group of that day changes');
 assert.equal(next.state.historyLearning.changesStorage.entries.find(e=>e.key===next.archives[0].key).day,day(1).slice(0,10));
});

test('Old non-financial groups go cold (kept, listed, not loaded); budget/status and cited changes stay hot', async () => {
 const old=historyStorageLimits.hotDays+2,cited=change(7,P,old+1);
 const logical={historyLearning:{changes:[change(1,P,old),change(2,P,old,true),change(3,P,1),cited]},decisionHistoryOutcomes:[outcome('o1',[cited.key])]};
 const db=store(),packed=await packHistoryState(logical,now);db.put(packed.archives);
 assert.equal(packed.stats.coldGroups,1);assert.equal(packed.state.historyLearning.changesArchive.length,1);
 const coldKey=packed.state.historyLearning.changesArchive[0].key;assert.ok(db.rows.has(coldKey),'cold group is stored, never dropped');
 const back=await hydrateHistoryState(packed.state,db.fetch);
 assert.deepEqual(back.historyLearning.changes.map(c=>c.eventId).sort(),['e2','e3','e7']);
 assert.equal(back.historyLearning.changesArchive[0].key,coldKey,'archive index survives the read');
 const again=await packHistoryState(back,now);assert.equal(again.state.historyLearning.changesArchive.length,1,'no duplicate archive entry');
 assert.equal(again.archives.length,0);
});

test('A missing, altered or foreign record fails closed instead of reading as an empty history', async () => {
 const logical={historyLearning:{changes:[change(1,P,1)]},decisionHistoryOutcomes:[outcome('o1')]};
 const db=store(),packed=await packHistoryState(logical,now);db.put(packed.archives);
 const [ledgerKey]=packed.state.historyLearning.changesStorage.entries.map(e=>e.key);
 const missing=store();missing.put(packed.archives.filter(a=>a.key!==ledgerKey));
 await assert.rejects(hydrateHistoryState(packed.state,missing.fetch),e=>e.code==='STORAGE_INTEGRITY');
 const swappedRow=store();swappedRow.put(packed.archives);const outcomeKey=packed.state.decisionHistoryOutcomes[0].partsStorage.key;
 swappedRow.rows.set(ledgerKey,swappedRow.rows.get(outcomeKey));
 await assert.rejects(hydrateHistoryState(packed.state,swappedRow.fetch),e=>e.code==='STORAGE_INTEGRITY','a valid record under the wrong key');
 const corrupt=store();corrupt.put(packed.archives);const env=JSON.parse(corrupt.rows.get(ledgerKey));env.data=env.data.slice(0,-8)+'AAAAAAAA';corrupt.rows.set(ledgerKey,JSON.stringify(env));
 await assert.rejects(hydrateHistoryState(packed.state,corrupt.fetch),e=>e.code==='STORAGE_INTEGRITY','corrupted bytes');
 const swapped=structuredClone(packed.state);swapped.decisionHistoryOutcomes[0].id='other';
 await assert.rejects(hydrateHistoryState(swapped,db.fetch),e=>e.code==='STORAGE_INTEGRITY');
 const badKey=structuredClone(packed.state);badKey.historyLearning.changesStorage.entries[0].key='central';
 await assert.rejects(hydrateHistoryState(badKey,db.fetch),e=>e.code==='STORAGE_INTEGRITY');
});

test('Large groups split below the per-record limit and reassemble', async () => {
 const many=Array.from({length:4000},(_,i)=>change(i,P,1,false,{metaText:'y'.repeat(300)}));
 const db=store(),packed=await packHistoryState({historyLearning:{changes:many}},now);db.put(packed.archives);
 assert.ok(packed.archives.length>1);for(const a of packed.archives)assert.ok(JSON.stringify(a.payload).length<=historyStorageLimits.maxBlobBytes+1000);
 assert.equal((await hydrateHistoryState(packed.state,db.fetch)).historyLearning.changes.length,4000);
});

test('Through the real persistence path: one transaction, central shrinks, read is identical and needs no resend', async () => {
 const db=database(),changes=Array.from({length:3000},(_,i)=>change(i,i%2?P:Q,i%20,i%9===0,{metaText:'z'.repeat(200)}));
 const state={config:{},snapshots:[],jobs:[],agents:{},reports:[],historyLearning:{version:1,scopes:{},changes},decisionHistoryOutcomes:Array.from({length:40},(_,i)=>outcome('o'+i,[changes[i].key]))};
 const saved=await commitPersistedState(db.api,state,0);
 const read=await readPersistedState(db.api,()=>({}));
 assert.deepEqual(read.state,saved.state,'what the commit returns is what the next read returns');
 assert.equal(read.state.historyLearning.changes.length,3000);assert.equal(read.state.decisionHistoryOutcomes[5].request,state.decisionHistoryOutcomes[5].request);
 assert.ok(read.storage.storedBytes<200000,'central keeps only indexes and summaries');
 assert.equal(read.storage.history.hotChanges,3000);assert.equal(read.storage.pressure.warning,false);
 const second=await commitPersistedState(db.api,read.state,read.revision);
 assert.deepEqual((await readPersistedState(db.api,()=>({}))).state,second.state);
});

test('Storage pressure warns at 85% of the central limit or of the hot ledger ceiling', () => {
 assert.equal(storagePressure({storedBytes:1000,limitBytes:2000,hotChanges:10,maximumChanges:100}).warning,false);
 const c=storagePressure({storedBytes:1700,limitBytes:2000,hotChanges:10,maximumChanges:100});assert.equal(c.warning,true);assert.match(c.message,/recusa gravações/);
 const l=storagePressure({storedBytes:10,limitBytes:2000,hotChanges:96,maximumChanges:100});assert.equal(l.critical,true);assert.match(l.message,/aprendizado pausa/);
 assert.equal(historyView(null,null),null);
});

test('Review fixes: an older writer\'s inline changes merge back; archived windows match the campaign by UTC day', async () => {
 const {archivedWindow}=await import('../lib/history-storage.mjs');
 const db=store(),packed=await packHistoryState({historyLearning:{changes:[change(1,P,1)]}},now);db.put(packed.archives);
 const mixed=structuredClone(packed.state);mixed.historyLearning.changes=[change(2,P,0),change(1,P,1)];
 const back=await hydrateHistoryState(mixed,db.fetch);
 assert.deepEqual(back.historyLearning.changes.map(c=>c.eventId).sort(),['e1','e2'],'nothing hidden, no duplicate');
 await assert.rejects(packHistoryState({historyLearning:{changesStorage:{},changes:[]}},now),e=>e.code==='STORAGE_INTEGRITY');
 const old=historyStorageLimits.hotDays+3,coldPack=await packHistoryState({historyLearning:{changes:[change(5,P,old)]}},now),hl=coldPack.state.historyLearning,d=day(old);
 assert.deepEqual(hl.changesArchive[0].campaigns,['acc|c1']);
 assert.equal(archivedWindow(hl,P,'acc','c1',d.slice(0,10)+'T00:00:00-03:00',d),true);
 assert.equal(archivedWindow(hl,P,'acc','other',d,d),false,'another campaign of the project is not limited');
 assert.equal(archivedWindow(hl,P,'acc','c1',day(2),day(1)),false);
});

test('The loaded ledger shares its repeated text: same content, same order, same types', async () => {
 // Owner report of 2026-11-12 ("Histórico de mudanças em 90% do teto"): only the memory of a read changes.
 assert.deepEqual([...sharedChangeText],['adAccountId','campaignExternalId','objectExternalId','level','category','source','at','field','before','after']);
 for(const identity of ['key','eventId','project'])assert.equal(sharedChangeText.includes(identity),false,identity+' stays one per change');
 const at=day(1),status=(i,project,from,to)=>change(i,project,1,false,{level:'campaign',category:'status',at,field:'status',before:from,after:to});
 const changes=[];
 for(let i=0;i<40;i++)changes.push(change(i,i%2?P:Q,1+i%3,false,{campaignExternalId:'c'+i%4,objectExternalId:'o'+i%5,category:['status','bid','targeting'][i%3]}));
 for(let i=40;i<50;i++)changes.push(status(i,P,i%2?'ACTIVE':'PAUSED',i%2?'PAUSED':'ACTIVE'));
 for(let i=50;i<60;i++)changes.push(change(i,Q,2,true,{before:100,after:100+i}));
 changes.push(change(60,P,1,false,{key:'custom-key',objectExternalId:null,note:{nested:'kept'}}));
 const logical={historyLearning:{version:1,scopes:{},changes}},db=store(),packed=await packHistoryState(logical,now);db.put(packed.archives);
 const back=await hydrateHistoryState(packed.state,db.fetch),{historyStorage,...rest}=back;
 assert.equal(JSON.stringify(rest),JSON.stringify(canon(logical)),'byte-identical to the logical ledger');
 for(const c of back.historyLearning.changes){
  assert.deepEqual(Object.keys(c).slice(0,2),['key','project'],'key order of a loaded change');
  if(c.field==='dailyBudget'){assert.equal(typeof c.before,'number');assert.equal(typeof c.after,'number');}
 }
 assert.equal(back.historyLearning.changes.find(c=>c.key==='custom-key').objectExternalId,null,'a non-text value passes through untouched');
 // A second commit of what was read writes nothing: the shared text is the same text.
 const again=await packHistoryState(back,now);
 assert.equal(again.archives.length,0);assert.deepEqual(again.state.historyLearning.changesStorage,packed.state.historyLearning.changesStorage);
});

test('The hot ledger ceiling follows the measured memory of one loaded change', () => {
 // 507 bytes per change before the shared text, 357 after (real ledger of 26,990 changes, 2026-11-12).
 const before=507,after=357,previous=30000;
 assert.equal(historyLearningPolicy.maximumChanges,42000);
 assert.ok(historyLearningPolicy.maximumChanges*after<=previous*before,'the new ceiling holds no more memory than the old one');
 assert.equal(storagePressure({storedBytes:0,limitBytes:1,hotChanges:26990,maximumChanges:historyLearningPolicy.maximumChanges}).warning,false,'the ledger of the report is below the warning');
 assert.equal(storagePressure({storedBytes:0,limitBytes:1,hotChanges:35700,maximumChanges:historyLearningPolicy.maximumChanges}).warning,true,'the warning returns at 85% of the new ceiling');
});
