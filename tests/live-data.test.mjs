import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {liveDataAction,readLiveData,parseLiveDataEnvelope,liveDataLimits} from '../lib/live-data.mjs';

const now=Date.parse('2026-11-03T00:00:00.000Z');
function snapshot(extra={}){return {projectId:'nico',projectName:'Nico',period:'today',level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-02T03:00:00.000Z',to:'2026-11-03T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:new Date(now-1000).toISOString(),lastSyncAt:new Date(now-30000).toISOString(),rows:[{id:'native-internal-id',externalId:'campaign',adAccountId:'account-a',accountName:'Conta A',name:'Criativo',level:'campaign',provider:'meta',budgetCurrency:'USD',dailyBudget:100,budgetRate:5,status:'ACTIVE',spend:12.3,revenueNet:30,frontOrders:1,checkouts:null}],...extra};}
function state(){return {config:{nico:{projectName:'Nico',targetRoas:null},john:{projectName:'John',targetRoas:2}},snapshots:[snapshot({period:'3d'})],paused:false,cadence:{start:'08:00',end:'20:00'},ownerChoices:[{id:'owner-choice',action:'keep'}],proposals:[{id:'approved',status:'Aprovada',signature:'exact-approved-seal'}]};}
function db(){
 const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../drizzle/0000_flashy_madame_web.sql',import.meta.url),'utf8'));
 const api={prepare(sql){return {bind(...args){return {async first(){return d.prepare(sql).get(...args);},async all(){return {success:true,results:d.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(d.prepare(sql).run(...args).changes)}};}};}};}};
 return {d,api};
}
const importSnapshot=(api,s,cut=snapshot(),expectedRevision)=>liveDataAction(api,s,{action:'import',projectId:'nico',snapshot:cut,...(expectedRevision===undefined?{}:{expectedRevision})},now);
const failure=(api,s,expectedRevision)=>liveDataAction(api,s,{action:'failure',projectId:'nico',expectedRevision,error:{code:'MALVA_UNAVAILABLE',message:'A origem não retornou uma leitura confirmada.'}},now+1000);
const envelope=input=>({id:'live-data',status:'Pendente',revision:0,note:JSON.stringify(input)});

test('Compatibility envelope preserves live-only actions and the independent project revision',()=>{
 for(const input of [{action:'read'},{action:'read',projectId:'nico'},{action:'import',projectId:'nico',snapshot:snapshot(),expectedRevision:9},{action:'failure',projectId:'nico',expectedRevision:10,error:{code:'MALVA_UNAVAILABLE',message:'Sem leitura.'}}]){
  const args=envelope(input),before=JSON.stringify(args);assert.deepEqual(parseLiveDataEnvelope(args),input);assert.equal(JSON.stringify(args),before);
 }
});
test('Compatibility envelope rejects invalid transport, arbitrary actions and financial commands',()=>{
 const invalid=[null,[],{},envelope(null),envelope([]),envelope('read'),envelope({}),envelope({action:'executionSubmit'}),envelope({action:'jobStatus'}),envelope({action:'import',dailyBudget:2000}),envelope({action:'read',op:'approve'}),{...envelope({action:'read'}),id:'central'},{...envelope({action:'read'}),status:'Concluída'},{...envelope({action:'read'}),revision:1},{...envelope({action:'read'}),revision:'0'},{...envelope({action:'read'}),note:'{broken'},{...envelope({action:'read'}),note:undefined},{...envelope({action:'read'}),budget:100}];
 for(const args of invalid)assert.throws(()=>parseLiveDataEnvelope(args),e=>e.code==='LIVE_INVALID_REQUEST');
 assert.throws(()=>parseLiveDataEnvelope({...envelope({action:'read'}),note:'á'.repeat(750001)}),e=>e.code==='LIVE_LIMIT');
});
test('Compatibility import only writes the live cache and still enforces source validation, pause and project CAS',async()=>{
 const {d,api}=db(),s=state(),before=JSON.stringify(s);d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('central',before,99,new Date(now).toISOString());
 const execute=input=>liveDataAction(api,s,parseLiveDataEnvelope(envelope(input)),now);
 const saved=await execute({action:'import',projectId:'nico',snapshot:snapshot(),expectedRevision:0});assert.equal(saved.revision,1);
 await assert.rejects(execute({action:'import',projectId:'nico',snapshot:snapshot({fetchedAt:new Date(now).toISOString()}),expectedRevision:0}),e=>e.code==='LIVE_CONFLICT');
 await assert.rejects(execute({action:'import',projectId:'nico',snapshot:snapshot({source:'other'}),expectedRevision:1}),e=>e.code==='LIVE_INVALID_SNAPSHOT');
 s.paused=true;await assert.rejects(execute({action:'failure',projectId:'nico',expectedRevision:1,error:{code:'FAILED',message:'Falhou.'}}),e=>e.code==='LIVE_PAUSED');s.paused=false;
 const central=d.prepare("SELECT payload,revision FROM bunker_records WHERE key='central'").get();assert.equal(central.payload,before);assert.equal(central.revision,99);assert.equal(JSON.stringify(s),before);assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records WHERE key NOT IN ('central','live:nico')").get().n,0);d.close();
});

test('Read lists every configured project, missing cache as unavailable, and never exposes orphaned projects',async()=>{
 const {d,api}=db(),s=state();d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('live:foreign','{}',1,new Date(now).toISOString());
 const before=JSON.stringify(s),read=await readLiveData(api,s);assert.equal(read.pollIntervalSeconds,15);assert.equal(read.paused,false);assert.deepEqual(read.projects,[{projectId:'nico',projectName:'Nico',trackedTargets:[{provider:'meta',level:'campaign',adAccountId:'account-a',externalId:'campaign'}]},{projectId:'john',projectName:'John',trackedTargets:[]}]);assert.equal(read.items.length,2);assert.ok(read.items.every(i=>i.snapshot===null&&i.error===null&&i.revision===0));assert.equal(JSON.stringify(s),before);d.close();
});

test('Tracked identities retain paused campaigns from all four analysis windows and deduplicate exact account scope',async()=>{
 const {d,api}=db(),s=state(),row=snapshot().rows[0];
 s.snapshots=['7d','3d','yesterday','today'].map((period,index)=>snapshot({period,rows:[{...row,status:'PAUSED',spend:0},...(index===0?[{...row,externalId:'yesterday-only',status:'PAUSED',spend:0},{...row,adAccountId:'account-b',status:'PAUSED'}]:[])]}));
 const before=JSON.stringify(s),read=await readLiveData(api,s,'nico');
 assert.deepEqual(read.projects[0].trackedTargets,[{provider:'meta',level:'campaign',adAccountId:'account-a',externalId:'campaign'},{provider:'meta',level:'campaign',adAccountId:'account-a',externalId:'yesterday-only'},{provider:'meta',level:'campaign',adAccountId:'account-b',externalId:'campaign'}]);
 assert.equal(read.projects[0].trackedTargets.some(target=>'spend' in target||'status' in target||'name' in target),false);assert.equal(JSON.stringify(s),before);assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_records').get().n,0);d.close();
});

test('Tracked targets isolate project, source, period, level and known Meta provider before including choices',async()=>{
 const {d,api}=db(),s=state(),base=snapshot(),row=base.rows[0];
 s.snapshots=[base,snapshot({projectId:'john',projectName:'John',rows:[{...row,externalId:'john-only'}]}),snapshot({complete:false,rows:[{...row,externalId:'partial'}]}),snapshot({source:'foreign',rows:[{...row,externalId:'wrong-source'}]}),snapshot({period:'maximum',rows:[{...row,externalId:'wrong-period'}]}),snapshot({level:'ad',rows:[{...row,externalId:'wrong-snapshot-level'}]}),snapshot({rows:[{...row,externalId:'unknown-provider',provider:undefined},{...row,externalId:'google',provider:'google_ads'},{...row,externalId:'child',level:'ad'},{...row,externalId:'foreign-row',projectId:'john'},{...row,externalId:'',adAccountId:'account-a'}]})];
 s.ownerChoices=[{project:'nico',adAccountId:'account-a',objectId:'campaign'},{project:'nico',adAccountId:'choice-account',objectId:'choice-meta',provider:'Meta'},{project:'nico',adAccountId:'choice-account',objectId:'choice-unknown'},{project:'nico',adAccountId:'choice-account',objectId:'choice-google',provider:'google_ads'},{project:'john',adAccountId:'choice-account',objectId:'john-choice',provider:'meta'},{project:'nico',adAccountId:'choice-account',objectId:'choice-child',provider:'meta',level:'ad'}];
 const read=await readLiveData(api,s),targets=id=>read.projects.find(p=>p.projectId===id).trackedTargets;
 assert.deepEqual(targets('nico').map(t=>t.externalId),['campaign','choice-meta']);assert.deepEqual(targets('john').map(t=>t.externalId),['john-only','john-choice']);d.close();
});

test('Owner-declared incident object scope adds exact campaign targets without turning account IDs into campaigns',async()=>{
 const {d,api}=db(),s=state();
 s.incidents=[{project:'nico',status:'Em retomada',scope:{accountIds:['account-only'],objectIds:[{adAccountId:'incident-a',objectId:'incident-campaign'},{adAccountId:'incident-a',objectId:'incident-campaign'},{adAccountId:'incident-b',objectId:'incident-campaign'}]}},{project:'john',scope:{objectIds:[{adAccountId:'john-account',objectId:'john-incident'}]}},{project:'unconfigured',scope:{objectIds:[{adAccountId:'hidden',objectId:'hidden'}]}}];
 const before=JSON.stringify(s),read=await liveDataAction(api,s,{action:'read'},now);
 assert.deepEqual(read.projects.find(p=>p.projectId==='nico').trackedTargets.map(t=>[t.adAccountId,t.externalId]),[['account-a','campaign'],['incident-a','incident-campaign'],['incident-b','incident-campaign']]);
 assert.equal(read.projects.length,2);assert.equal(read.projects.some(p=>p.trackedTargets.some(t=>t.externalId==='account-only')),false);assert.equal(JSON.stringify(s),before);assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_records').get().n,0);d.close();
});

test('Tracked target capacity rejects explicitly before database reads instead of returning a partial allowlist',async()=>{
 const s=state(),row=snapshot().rows[0];s.snapshots=[snapshot({rows:Array.from({length:liveDataLimits.maxTrackedTargets+1},(_,i)=>({...row,externalId:'campaign-'+i}))})];
 const before=JSON.stringify(s),neverRead={prepare(){throw Error('Database should not be touched.');}};
 await assert.rejects(readLiveData(neverRead,s,'nico'),e=>e.code==='LIVE_LIMIT'&&/Nenhum ID foi truncado/.test(e.message));assert.equal(JSON.stringify(s),before);
 s.snapshots[0].rows.pop();const {d,api}=db(),read=await readLiveData(api,s,'nico');assert.equal(read.projects[0].trackedTargets.length,liveDataLimits.maxTrackedTargets);d.close();
});
test('Import persists all rows with a per-project revision and leaves central sources, cadence and approval seals byte-identical',async()=>{
 const {d,api}=db(),s=state(),before=JSON.stringify(s);d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('central',before,41,'2026-11-02T23:59:00Z');
 const cut=snapshot();cut.rows.push({...cut.rows[0],adAccountId:'account-b',accountName:'Conta B'});
 const saved=await importSnapshot(api,s,cut,0),read=await readLiveData(api,s);
 assert.equal(saved.revision,1);assert.equal(read.items[0].snapshot.rows.length,2);assert.equal(read.items[0].snapshot.rows[0].checkouts,null);assert.equal(read.items[0].snapshot.rows[0].revenue,undefined);assert.equal(read.items[0].lastSuccessAt,new Date(now).toISOString());assert.equal(read.items[0].error,null);
 assert.equal(JSON.stringify(s),before);const central=d.prepare("SELECT payload,revision FROM bunker_records WHERE key='central'").get();assert.equal(central.payload,before);assert.equal(central.revision,41);d.close();
});
test('Validation rejects stale/future/incomplete, wrong project/name/timezone/window/level and duplicate campaign identities',async()=>{
 const mutations=[c=>c.period='yesterday',c=>c.level='ad',c=>c.source='fixture',c=>c.complete=false,c=>c.projectId='john',c=>c.projectName='Other',c=>c.timezone='UTC',c=>c.fetchedAt=new Date(now+1).toISOString(),c=>c.fetchedAt=new Date(now-300001).toISOString(),c=>c.lastSyncAt=new Date(now+1).toISOString(),c=>c.from='2026-11-02T04:00:00.000Z',c=>c.to='2026-11-04T03:00:00.000Z',c=>c.from='2026-11-02T00:00:00-03:00',c=>c.rows.push({...c.rows[0]}),c=>c.rows[0].level='adset',c=>c.rows[0].externalId='',c=>c.rows[0].projectId='john',c=>c.rows[0].projectName='John'];
 for(const mutate of mutations){const {d,api}=db(),s=state(),c=snapshot();mutate(c);await assert.rejects(importSnapshot(api,s,c));assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bunker_records").get().n,0);d.close();}
});
test('A configured project without a confirmed source timezone cannot inherit another client timezone',async()=>{
 const {d,api}=db(),s=state();await assert.rejects(liveDataAction(api,s,{action:'import',projectId:'john',snapshot:snapshot({projectId:'john',projectName:'John'})},now),e=>e.code==='LIVE_TIMEZONE_UNCONFIRMED');d.close();
});
test('The live cache is independent of central revisions but cannot overwrite a newer fetchedAt',async()=>{
 const {d,api}=db(),s=state(),first=snapshot();await importSnapshot(api,s,first,0);
 const newer=snapshot({fetchedAt:new Date(now).toISOString()});newer.rows[0].spend=15;await importSnapshot(api,s,newer,1);
 await assert.rejects(importSnapshot(api,s,first),e=>e.code==='LIVE_STALE_SNAPSHOT');assert.equal((await readLiveData(api,s)).items[0].snapshot.rows[0].spend,15);
 const retry=await importSnapshot(api,s,newer,1);assert.equal(retry.unchanged,true);assert.equal(retry.revision,2);
 const changed=structuredClone(newer);changed.rows[0].spend=16;await assert.rejects(importSnapshot(api,s,changed),e=>e.code==='LIVE_CONFLICT');d.close();
});
test('Concurrent CAS writers produce one accepted record, never a lost update',async()=>{
 const {d,api}=db(),s=state(),a=snapshot(),b=snapshot({fetchedAt:new Date(now).toISOString()});
 const results=await Promise.allSettled([importSnapshot(api,s,a,0),importSnapshot(api,s,b,0)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='LIVE_CONFLICT').length,1);assert.equal((await readLiveData(api,s)).items[0].revision,1);d.close();
});
test('Failure preserves the last successful snapshot and distinguishes absent data from an empty successful source',async()=>{
 const {d,api}=db(),s=state(),cut=snapshot();await importSnapshot(api,s,cut,0);const before=(await readLiveData(api,s)).items[0];
 const failed=await failure(api,s,1);assert.deepEqual(failed.item.snapshot,before.snapshot);assert.equal(failed.item.lastSuccessAt,before.lastSuccessAt);assert.equal(failed.item.error.code,'MALVA_UNAVAILABLE');assert.equal(failed.revision,2);
 const {d:missingDb,api:missingApi}=db(),missing=await failure(missingApi,s,0);assert.equal(missing.item.snapshot,null);assert.equal(missing.item.lastSuccessAt,null);assert.equal(missing.item.error.code,'MALVA_UNAVAILABLE');
 const recovered=await importSnapshot(api,s,snapshot({fetchedAt:new Date(now).toISOString(),rows:[]}),2);assert.deepEqual(recovered.item.snapshot.rows,[]);assert.equal(recovered.item.error,null);d.close();missingDb.close();
});
test('A delayed failure requires its own expectedRevision and cannot hide a newer successful collection',async()=>{
 const {d,api}=db(),s=state();await importSnapshot(api,s);await assert.rejects(failure(api,s,undefined),e=>e.code==='LIVE_INVALID_REQUEST');await assert.rejects(failure(api,s,0),e=>e.code==='LIVE_CONFLICT');const read=await readLiveData(api,s);assert.equal(read.items[0].revision,1);assert.equal(read.items[0].error,null);d.close();
});
test('Pause blocks import and failure writes while keeping cached data readable',async()=>{
 const {d,api}=db(),s=state();await importSnapshot(api,s);const before=d.prepare("SELECT payload,revision FROM bunker_records WHERE key='live:nico'").get();s.paused=true;
 await assert.rejects(importSnapshot(api,s,snapshot({fetchedAt:new Date(now).toISOString()})),e=>e.code==='LIVE_PAUSED');await assert.rejects(failure(api,s,1),e=>e.code==='LIVE_PAUSED');const read=await readLiveData(api,s);assert.equal(read.paused,true);assert.equal(read.items[0].revision,1);assert.deepEqual(d.prepare("SELECT payload,revision FROM bunker_records WHERE key='live:nico'").get(),before);d.close();
});
test('Day rollover rejects yesterday even when fetchedAt is still fresh; last source remains readable as stale',async()=>{
 const {d,api}=db(),s=state();await importSnapshot(api,s);const afterMidnight=Date.parse('2026-11-03T03:01:00Z'),cut=snapshot({fetchedAt:'2026-11-03T02:59:59Z',lastSyncAt:null});await assert.rejects(liveDataAction(api,s,{action:'import',projectId:'nico',snapshot:cut},afterMidnight),e=>e.code==='LIVE_INVALID_SNAPSHOT');assert.equal((await readLiveData(api,s)).items[0].snapshot.from,'2026-11-02T03:00:00.000Z');d.close();
});
test('A full local day accepts a 25-hour DST boundary rather than assuming 24 UTC hours',async()=>{
 const {d,api}=db(),s=state(),at=Date.parse('2026-11-01T20:00:00Z');s.snapshots[0].timezone='America/New_York';const cut=snapshot({timezone:'America/New_York',from:'2026-11-01T04:00:00Z',to:'2026-11-02T05:00:00Z',fetchedAt:new Date(at-1000).toISOString(),lastSyncAt:null});const result=await liveDataAction(api,s,{action:'import',projectId:'nico',snapshot:cut},at);assert.equal(result.revision,1);d.close();
});
test('Limits use UTF-8 bytes and row counts, without truncating or storing partial rows',async()=>{
 const {d,api}=db(),s=state();const huge=snapshot();huge.extra='á'.repeat(750000);await assert.rejects(importSnapshot(api,s,huge),e=>e.code==='LIVE_LIMIT');const tooMany=snapshot();tooMany.rows=Array.from({length:3001},(_,i)=>({...tooMany.rows[0],externalId:String(i)}));await assert.rejects(importSnapshot(api,s,tooMany));assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_records').get().n,0);d.close();
});
test('Corrupt cache is isolated by project and is never presented as a healthy empty source',async()=>{
 const {d,api}=db(),s=state();d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('live:nico','{broken',7,new Date(now).toISOString());const read=await readLiveData(api,s);assert.equal(read.items[0].revision,7);assert.equal(read.items[0].snapshot,null);assert.equal(read.items[0].error.code,'LIVE_CACHE_INVALID');assert.equal(read.items[1].error,null);await assert.rejects(importSnapshot(api,s),e=>e.code==='LIVE_CACHE_INVALID');d.close();
});
