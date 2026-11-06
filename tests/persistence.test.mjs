import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {commitPersistedState,readPersistedState,centralByteLimit} from '../lib/persistence.mjs';
import {reportsQuery,reportPage} from '../lib/report-archive.mjs';
import {ensureCollaboration,claimCollaboration} from '../lib/collaboration.mjs';
import {randomBytes} from 'node:crypto';
import {hydrateCoreState} from '../lib/core-storage.mjs';
import {suggestionHistoryQuery,suggestionHistoryPage} from '../lib/suggestion-history.mjs';

function adapter(database){
 return {prepare(sql){return {sql,params:[],bind(...params){return {sql,params,async first(){return database.prepare(sql).get(...params);},async all(){return {success:true,results:database.prepare(sql).all(...params)};}};}};},async batch(statements){database.exec('BEGIN');try{const results=statements.map(s=>({meta:{changes:Number(database.prepare(s.sql).run(...(s.params||[])).changes)}}));database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
}
function db(){const d=new DatabaseSync(':memory:');for(const migration of ['0000_flashy_madame_web.sql','0001_medical_typhoid_mary.sql'])d.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));return {d,api:adapter(d)};}
function empty(){return {snapshots:[],config:{project:{projectName:'QA'}},tasks:[],decisions:[],jobs:[],messages:[],reports:[],events:[],paused:false};}
function snapshot(period='today',rows=1){return {projectId:'project',projectName:'QA',period,level:'campaign',from:'2026-10-26T04:00:00Z',to:'2026-11-02T04:00:00Z',timezone:'America/Boa_Vista',fetchedAt:'2026-11-02T12:01:00Z',lastSyncAt:null,source:'Malva MCP',complete:true,rows:Array.from({length:rows},(_,i)=>({externalId:'campaign-'+i,adAccountId:'account',name:'Criativo '+i+' versão validada '.repeat(20),provider:'meta',budgetCurrency:'USD',dailyBudget:100,status:'ACTIVE',spend:50,frontOrders:1}))};}

test('Legacy state is readable; a large full snapshot persists below the byte limit without dropping a row',async()=>{
 const {d,api}=db(),state=empty();state.snapshots=[snapshot('7d',2800),snapshot('3d',2800)];
 assert.ok(new TextEncoder().encode(JSON.stringify(state)).length>centralByteLimit);
 d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('central',JSON.stringify(empty()),4,'2026-11-02T12:00:00Z');
 assert.deepEqual((await readPersistedState(api,empty)).state,empty());
 const result=await commitPersistedState(api,state,4),read=await readPersistedState(api,empty);
 assert.equal(result.revision,5);assert.deepEqual(read.state,result.state);assert.equal(read.state.snapshots[0].rows.length,2800);
 assert.equal(read.storage.format,'gzip-base64-v1');assert.ok(read.storage.storedBytes<centralByteLimit);
 assert.equal(read.storage.expandedSnapshotBytes,new TextEncoder().encode(JSON.stringify(state.snapshots)).length);d.close();
});
test('A stale concurrent writer cannot replace the central row or archive rejected reports',async()=>{
 const {d,api}=db(),first=empty();first.snapshots=[snapshot()];first.reports=[{id:'approved',project:'project',createdAt:'2026-11-02T12:00:00Z',text:'persisted'}];
 await commitPersistedState(api,first,0);
 const stale=empty();stale.snapshots=[snapshot('today',2)];stale.reports=[{id:'rejected',project:'project',createdAt:'2026-11-02T12:01:00Z',text:'not accepted'}];
 await assert.rejects(commitPersistedState(api,stale,0),/CONFLICT/);
 const read=await readPersistedState(api,empty);assert.equal(read.revision,1);assert.equal(read.state.snapshots[0].rows.length,1);
 const q=reportsQuery('project',10),reports=reportPage(d.prepare(q.sql).all(...q.params),10);assert.deepEqual(reports.items.map(r=>r.id),['approved']);d.close();
});
test('An archive failure rolls back the packed snapshot and central revision together',async()=>{
 const {d,api}=db();await commitPersistedState(api,empty(),0);d.exec('DROP TABLE bunker_reports');
 const candidate=empty();candidate.snapshots=[snapshot()];await assert.rejects(commitPersistedState(api,candidate,1),/no such table/);
 const read=await readPersistedState(api,empty);assert.equal(read.revision,1);assert.deepEqual(read.state.snapshots,[]);d.close();
});

test('Suggestion archives and central removal commit together, including batch receipts and conflict rollback',async()=>{
 const {d,api}=db();await commitPersistedState(api,empty(),0);
 const candidate=empty(),at=Date.now();candidate.collaborationRounds=Array.from({length:3},(_,i)=>({id:'round-'+i,jobId:'settled-job-'+i,project:'project',status:'Concluída',createdAt:new Date(at-i*3600000).toISOString(),stages:[]}));
 candidate.cardSuggestions=[{id:'suggestion-a',roundId:'round-2',project:'project',clientId:'single-a',requestFingerprint:'immutable-a',requestAliases:[{clientId:'alias-a',requestFingerprint:'immutable-alias'}],batchReceipt:{clientId:'batch',requestFingerprint:'batch-digest',recordIds:['suggestion-a','suggestion-b']},batchReceipts:[{clientId:'batch-retry',requestFingerprint:'retry-digest',recordIds:['suggestion-a','suggestion-b']}]},{id:'suggestion-b',roundId:'round-2',project:'project',clientId:'single-b',requestFingerprint:'immutable-b'}];
 const originals=structuredClone(candidate.cardSuggestions);
 await assert.rejects(commitPersistedState(api,structuredClone(candidate),0),/CONFLICT/);
 assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key LIKE 'collaboration:%'").get().n,0);assert.equal((await readPersistedState(api,empty)).revision,1);
 d.exec("CREATE TRIGGER reject_archive BEFORE INSERT ON bunker_records WHEN NEW.key LIKE 'collaboration:%' BEGIN SELECT RAISE(ABORT,'archive refused'); END;");
 await assert.rejects(commitPersistedState(api,structuredClone(candidate),1),/archive refused/);assert.equal((await readPersistedState(api,empty)).revision,1);assert.equal((await readPersistedState(api,empty)).state.cardSuggestions,undefined);
 d.exec('DROP TRIGGER reject_archive');
 const saved=await commitPersistedState(api,structuredClone(candidate),1),read=await readPersistedState(api,empty),archive=JSON.parse(d.prepare('SELECT payload FROM bunker_records WHERE key=?').get('collaboration:round-2').payload);
 assert.equal(saved.revision,2);assert.deepEqual(read.state.cardSuggestions,[]);assert.deepEqual(archive.cardSuggestions,originals);assert.equal(archive.round.id,'round-2');d.close();
});
test('492 orphan suggestions migrate losslessly with CAS rollback, archive rollback and idempotent follow-up',async()=>{
 const {d,api}=db(),initial=empty();await commitPersistedState(api,initial,0);
 const state=empty();state.collaborationRounds=[{id:'live',project:'project',jobId:'none',createdAt:new Date().toISOString(),status:'Pendente',stages:[]}];
 state.cardSuggestions=Array.from({length:497},(_,i)=>({id:'s-'+i,project:'project',roundId:i<492?'orphan-'+Math.floor(i/12):'live',clientId:'client-'+i,requestFingerprint:'digest-'+i,requestAliases:[{clientId:'alias-'+i,requestFingerprint:'alias-digest-'+i}],createdAt:'2026-11-03T12:00:00Z'}));
 const originals=structuredClone(state.cardSuggestions.slice(0,492));state.cardSuggestions[0].batchReceipt={clientId:'batch',requestFingerprint:'batch-digest',recordIds:originals.slice(0,12).map(s=>s.id)};originals[0]=structuredClone(state.cardSuggestions[0]);
 const candidate=structuredClone(state);
 await assert.rejects(commitPersistedState(api,structuredClone(candidate),0),/CONFLICT/);assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key GLOB 'suggestions:*'").get().n,0);
 d.exec("CREATE TRIGGER reject_orphan BEFORE INSERT ON bunker_records WHEN NEW.key GLOB 'suggestions:*' BEGIN SELECT RAISE(ABORT,'journal refused'); END;");
 await assert.rejects(commitPersistedState(api,structuredClone(candidate),1),/journal refused/);assert.equal((await readPersistedState(api,empty)).revision,1);assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key GLOB 'suggestions:*'").get().n,0);d.exec('DROP TRIGGER reject_orphan');
 await commitPersistedState(api,structuredClone(candidate),1);const read=await readPersistedState(api,empty);assert.deepEqual(read.state.cardSuggestions,candidate.cardSuggestions.slice(492));
 let cursor=null,recovered=[];do{const q=suggestionHistoryQuery('project',7,cursor),p=suggestionHistoryPage(d.prepare(q.sql).all(...q.params),q);recovered.push(...p.items.flatMap(i=>i.cardSuggestions));cursor=p.nextCursor;}while(cursor);
 assert.deepEqual(recovered.sort((a,b)=>a.id.localeCompare(b.id)),originals.sort((a,b)=>a.id.localeCompare(b.id)));const count=d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key GLOB 'suggestions:*'").get().n;
 await commitPersistedState(api,read.state,read.revision);assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key GLOB 'suggestions:*'").get().n,count);assert.equal((await readPersistedState(api,empty)).state.cardSuggestions.length,5);d.close();
});
test('Commit nonce fences same-revision writers at the same timestamp without leaking metadata or multiplying RPC bytes',async(t)=>{
 const {d,api}=db(),NativeDate=globalThis.Date,at='2026-11-03T17:50:00.000Z';
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return NativeDate.parse(at);}};
 try{
  const state=empty();state.tasks=[{id:'realistic-packed-size',text:randomBytes(710000).toString('base64')}];
  state.cardSuggestions=Array.from({length:492},(_,i)=>({id:'s-'+i,project:'project',roundId:'orphan-'+i,clientId:'c-'+i,requestFingerprint:'digest-'+i,createdAt:at}));
  let batchBytes=0;const measured={...api,async batch(statements){batchBytes=new TextEncoder().encode(JSON.stringify(statements)).length;return api.batch(statements);}};
  await commitPersistedState(measured,structuredClone(state),0);assert.ok(batchBytes<32*1024*1024,'RPC should not contain 492 copies of central');t.diagnostic('492 journals, serialized RPC bytes: '+batchBytes);
  const savedRow=d.prepare('SELECT payload,updated_at FROM bunker_records WHERE key=?').get('central'),saved=JSON.parse(savedRow.payload);assert.match(saved._commitToken,/^[a-f0-9-]{36}$/);assert.equal(savedRow.updated_at,at);
  const read=await readPersistedState(api,empty);assert.equal(read.state._commitToken,undefined);assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key GLOB 'suggestions:*'").get().n,492);
  const rejected=empty();rejected.cardSuggestions=[{id:'rejected',project:'project',roundId:'rejected-round'}];
  await assert.rejects(commitPersistedState(api,rejected,0),/CONFLICT/);assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key GLOB 'suggestions:*'").get().n,492);
  assert.equal(d.prepare('SELECT payload FROM bunker_records WHERE key=?').get('central').payload,savedRow.payload);assert.equal((await readPersistedState(api,empty)).state._commitToken,undefined);
 }finally{globalThis.Date=NativeDate;d.close();}
});
test('Frozen collaboration fingerprints survive storage encoding and decoding',async()=>{
 const {d,api}=db(),state=empty(),startedAt='2026-11-02T12:00:00Z',completedAt='2026-11-02T12:02:00Z';
 state.snapshots=['7d','3d','yesterday','today'].map(p=>snapshot(p));state.jobs=[{id:'job',project:'project',status:'Concluída',startedAt,completedAt}];state.agents={project:{jobId:'job'}};
 const round=ensureCollaboration(state,state.jobs[0],Date.parse(completedAt)),cut=structuredClone(round.sourceCut);
 await commitPersistedState(api,state,0);const read=await readPersistedState(api,empty);
 assert.deepEqual(read.state.collaborationRounds[0].sourceCut,cut);
 const claim=claimCollaboration(read.state,{roundId:round.id,agentId:'traffic',executionRef:'real-test-run',clientId:'test-claim'},Date.parse(completedAt)+1000);assert.equal(claim.agentId,'traffic');d.close();
});
test('Incompressible data above the stored-byte ceiling still fails before writing',async()=>{
 const {d,api}=db(),state=empty();state.tasks=[{id:'large',text:randomBytes(1400000).toString('base64')}];
 await assert.rejects(commitPersistedState(api,state,0),error=>error.code==='STORAGE_LIMIT');
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_records').get().n,0);d.close();
});
test('Large real journal structures persist losslessly without hiding reports from the SQL archive',async()=>{
 const {d,api}=db(),state=empty();state.snapshots=[snapshot('today',100)];
 state.knowledgeMeasurements=Array.from({length:1800},(_,i)=>({id:'measurement-'+i,project:'project',objectId:'campaign-'+i,metrics:{spend:103.77,frontOrders:3},evidenceRefs:Array.from({length:12},(_,j)=>({period:'7d',level:'campaign',adAccountId:'account',externalId:'campaign-'+j,fetchedAt:'2026-11-03T10:20:00Z'}))}));
 state.ownerChoices=[{id:'choice',action:'keep',createdAt:'2026-11-03T10:20:00Z'}];state.executions=[{id:'sent',status:'Verificação necessária',submittedAt:'2026-11-03T10:20:00Z'}];
 state.reports=[{id:'report',project:'project',createdAt:'2026-11-03T10:20:00Z',text:'Relatório que continua consultável.'}];
 assert.ok(new TextEncoder().encode(JSON.stringify(state)).length>centralByteLimit);
 const saved=await commitPersistedState(api,state,0),read=await readPersistedState(api,empty);assert.deepEqual(read.state,saved.state);assert.equal(read.storage.format,'gzip-base64-v2');assert.ok(read.storage.storedBytes<centralByteLimit);
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_reports').get().n,1);
 await assert.rejects(commitPersistedState(api,empty(),0),/CONFLICT/);assert.deepEqual((await readPersistedState(api,empty)).state,read.state);d.close();
});

function splitFixture(){const state=empty();state.tasks=[{id:'journal',text:randomBytes(675000).toString('base64')}];state.snapshots=[snapshot()];state.snapshots[0].rows[0].name=randomBytes(675000).toString('base64');return state;}
test('Snapshot blobs remove the combined row ceiling without raising either codec limit or losing financial seals',async()=>{
 const {d,api}=db(),state=splitFixture();state.executions=[{id:'sent',status:'Verificação necessária',submittedAt:'2026-11-03T10:20:00Z'}];state.ownerChoices=[{id:'choice',signature:'exact-owner-proof'}];
 const result=await commitPersistedState(api,state,0),read=await readPersistedState(api,empty);
 assert.deepEqual(read.state,result.state);assert.equal(read.storage.format,'gzip-base64-v3');
 const rows=d.prepare('SELECT key,payload FROM bunker_records').all();assert.equal(rows.length,2);assert.ok(rows.every(r=>Buffer.byteLength(r.payload)<centralByteLimit));assert.ok(rows.reduce((n,r)=>n+Buffer.byteLength(r.payload),0)>centralByteLimit);
 const stored=JSON.parse(rows.find(r=>r.key==='central').payload);delete stored._commitToken;
 // The Supabase financial bridge hydrates only the core. Its authorization
 // proofs must remain available without resolving observation blobs.
 const authorized=await hydrateCoreState(stored);assert.deepEqual(authorized.executions,state.executions);assert.deepEqual(authorized.ownerChoices,state.ownerChoices);
 await commitPersistedState(api,{...read.state,paused:true},read.revision);assert.equal(d.prepare("SELECT COUNT(*) n FROM bunker_records WHERE key LIKE 'snapshots:%'").get().n,1,'unchanged sources deduplicate across journal writes');d.close();
});
test('A losing CAS never writes source blobs, and a source-write failure rolls back the central revision',async()=>{
 const {d,api}=db();await commitPersistedState(api,empty(),0);const before=(await readPersistedState(api,empty)).state;
 const state=splitFixture();await assert.rejects(commitPersistedState(api,state,0),/CONFLICT/);assert.equal(d.prepare("SELECT COUNT(*) n FROM bunker_records WHERE key LIKE 'snapshots:%'").get().n,0);
 d.exec("CREATE TRIGGER refuse_source BEFORE INSERT ON bunker_records WHEN NEW.key LIKE 'snapshots:%' BEGIN SELECT RAISE(ABORT,'source refused'); END;");
 await assert.rejects(commitPersistedState(api,state,1),/source refused/);assert.equal((await readPersistedState(api,empty)).revision,1);assert.deepEqual((await readPersistedState(api,empty)).state,before);d.close();
});
test('Missing, tampered or misdirected blobs fail closed and never become an empty source',async()=>{
 const {d,api}=db();await commitPersistedState(api,splitFixture(),0);
 const original=d.prepare("SELECT key,payload FROM bunker_records WHERE key LIKE 'snapshots:%'").get();
 d.prepare('DELETE FROM bunker_records WHERE key=?').run(original.key);await assert.rejects(readPersistedState(api,empty),e=>e.code==='STORAGE_INTEGRITY');
 d.prepare('INSERT INTO bunker_records VALUES (?,?,1,?)').run(original.key,original.payload,'now');
 const blob=JSON.parse(original.payload);blob.snapshotStorage.digest='sha256:'+'0'.repeat(64);d.prepare('UPDATE bunker_records SET payload=? WHERE key=?').run(JSON.stringify(blob),original.key);
 await assert.rejects(readPersistedState(api,empty),e=>e.code==='STORAGE_INTEGRITY');
 const central=JSON.parse(d.prepare("SELECT payload FROM bunker_records WHERE key='central'").get().payload);central.snapshotStorage.key='central';d.prepare("UPDATE bunker_records SET payload=? WHERE key='central'").run(JSON.stringify(central));await assert.rejects(readPersistedState(api,empty),e=>e.code==='STORAGE_INTEGRITY');d.close();
});
