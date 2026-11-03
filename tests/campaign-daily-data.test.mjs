import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dailyDataAction,parseDailyDataEnvelope,campaignDailyLimits} from '../lib/campaign-daily-data.mjs';

const now=Date.parse('2026-11-03T14:00:00.000Z');
const internal='11111111-1111-4111-8111-111111111111';
const ids={projectId:'john',adAccountId:'account-a',objectId:'campaign-1'};
const row=(patch={})=>({id:internal,externalId:ids.objectId,adAccountId:ids.adAccountId,projectId:'john',provider:'meta',level:'campaign',name:'Nome repetido',accountName:'Conta A',status:'ACTIVE',budgetCurrency:'USD',dailyBudget:100,...patch});
function state(){return {config:{john:{projectName:'John'},nico:{projectName:'Nico'}},snapshots:[{projectId:'john',projectName:'John',source:'Malva MCP',level:'campaign',period:'today',complete:true,timezone:'America/Sao_Paulo',fetchedAt:'2026-11-03T13:00:00.000Z',rows:[row(),row({id:'22222222-2222-4222-8222-222222222222',adAccountId:'account-b'})]}],paused:false,ownerChoices:[{id:'owner',action:'keep'}],proposals:[{id:'approved',status:'Aprovada',signature:'exact-seal'}],executions:[{id:'sent',status:'Verificação necessária'}],cadence:{start:'08:00',end:'20:00'}};}
function db(){
 const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../drizzle/0000_flashy_madame_web.sql',import.meta.url),'utf8'));
 const api={prepare(sql){return {bind(...args){return {async first(){return d.prepare(sql).get(...args);},async all(){return {success:true,results:d.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(d.prepare(sql).run(...args).changes)}};}};}};}};
 return {d,api};
}
const call=(api,s,action,extra={},at=now)=>dailyDataAction(api,s,{action,...(action==='pending'?{}:ids),...extra},at);
const envelope=input=>({id:'daily-data',status:'Pendente',revision:0,note:JSON.stringify(input)});
function source(at=now,patch={}){
 return {source:'Malva MCP',fetchedAt:new Date(at).toISOString(),detail:{row:row(),provider:'meta',level:'campaign',externalId:ids.objectId,currency:'BRL',dailyRange:{from:'2026-10-28',to:'2026-11-03',extended:false},period:{preset:'custom',timezone:'America/Sao_Paulo',from:'2026-10-28T03:00:00.000Z',to:'2026-11-04T03:00:00.000Z',days:['2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02','2026-11-03']},daily:[{day:'2026-11-03',spend:100,orders:2,frontOrders:1,cpa:50,revenueNet:180,profit:45,roas:1.8,roi:155/110}],...patch}};
}

test('compatibility accepts only the display contract and never financial commands or caller-supplied target metadata',()=>{
 for(const input of [{action:'pending'},{action:'read',...ids},{action:'request',...ids},{action:'import',...ids,expectedRevision:1,snapshot:source()},{action:'failure',...ids,expectedRevision:1,error:{code:'MALVA_UNAVAILABLE'}}])assert.deepEqual(parseDailyDataEnvelope(envelope(input)),input);
 const bad=[null,[],{},envelope(null),envelope({action:'executionSubmit'}),envelope({action:'pending',projectId:'john'}),envelope({action:'read',...ids,internalObjectId:internal}),envelope({action:'request',...ids,timezone:'UTC'}),envelope({action:'import',...ids,expectedRevision:0,snapshot:source()}),{...envelope({action:'pending'}),revision:1},{...envelope({action:'pending'}),id:'central'},{...envelope({action:'pending'}),status:'Concluída'},{...envelope({action:'pending'}),note:'{bad'},{...envelope({action:'pending'}),budget:100}];
 for(const args of bad)assert.throws(()=>parseDailyDataEnvelope(args),e=>e.code==='DAILY_INVALID_REQUEST');
 assert.throws(()=>parseDailyDataEnvelope({...envelope({action:'pending'}),note:'á'.repeat(40001)}),e=>e.code==='DAILY_LIMIT');
});

test('request derives exact account/project/Meta UUID and timezone without modifying central journals or approvals',async()=>{
 const {d,api}=db(),s=state(),before=JSON.stringify(s);d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('central',before,99,new Date(now).toISOString());
 const missing=await call(api,s,'read');assert.equal(missing.item.status,'idle');assert.equal(missing.item.snapshot,null);assert.equal(missing.item.revision,0);
 const first=await call(api,s,'request');assert.equal(first.item.target.internalObjectId,internal);assert.equal(first.item.target.timezone,'America/Sao_Paulo');assert.deepEqual(first.item.range,{from:'2026-10-28',to:'2026-11-03'});assert.equal(first.item.status,'pending');assert.equal(first.revision,1);
 const other=await call(api,s,'request',{adAccountId:'account-b'});assert.equal(other.item.target.internalObjectId,'22222222-2222-4222-8222-222222222222');assert.notDeepEqual(other.item.target,first.item.target);
 for(const change of [{projectId:'nico'},{adAccountId:'absent'},{objectId:'same-name-is-not-an-id'}])await assert.rejects(call(api,s,'request',change));
 const pending=await call(api,s,'pending');assert.equal(pending.items.length,2);assert.ok(pending.items.every(i=>!('dailyBudget' in i.target)&&!('status' in i.target)));
 assert.equal(JSON.stringify(s),before);const central=d.prepare("SELECT payload,revision FROM bunker_records WHERE key='central'").get();assert.equal(central.payload,before);assert.equal(central.revision,99);assert.equal(d.prepare("SELECT COUNT(*) n FROM bunker_records WHERE key NOT LIKE 'daily:%' AND key!='central'").get().n,0);d.close();
});

test('target resolution rejects unknown providers, duplicate identities, missing UUIDs and ambiguous project timezones',async()=>{
 for(const mutate of [s=>s.snapshots[0].rows[0].provider='google',s=>delete s.snapshots[0].rows[0].id,s=>s.snapshots[0].rows.push(row()),s=>s.snapshots[0].rows[0].projectId='nico',s=>s.snapshots[0].complete=false,s=>s.snapshots[0].source='fixture',s=>s.snapshots[0].level='ad',s=>s.snapshots.push({...s.snapshots[0],timezone:'UTC'})]){
  const {d,api}=db(),s=state();mutate(s);await assert.rejects(call(api,s,'request'),e=>['DAILY_TARGET_UNAVAILABLE','DAILY_TIMEZONE_UNCONFIRMED'].includes(e.code));assert.equal(d.prepare('SELECT COUNT(*) n FROM bunker_records').get().n,0);d.close();
 }
});

test('a newly confirmed internal Malva UUID gets its own request without reusing or removing the prior daily cache',async()=>{
 const {d,api}=db(),s=state();await call(api,s,'request');const original=await call(api,s,'import',{expectedRevision:1,snapshot:source()}),prior=d.prepare("SELECT * FROM bunker_records WHERE key LIKE 'daily:%'").get();
 const nextId='33333333-3333-4333-8333-333333333333';s.snapshots[0].rows[0].id=nextId;s.snapshots[0].fetchedAt=new Date(now+1000).toISOString();
 const read=await call(api,s,'read',{},now+2000);assert.equal(read.item.target.internalObjectId,nextId);assert.equal(read.item.snapshot,null);assert.equal(read.item.revision,0);
 const requested=await call(api,s,'request',{},now+2000);assert.equal(requested.item.revision,1);assert.equal(requested.item.target.objectId,original.item.target.objectId);assert.equal(requested.item.snapshot,null);
 const pending=await call(api,s,'pending',{},now+2000);assert.equal(pending.items.length,1);assert.equal(pending.items[0].target.internalObjectId,nextId);assert.deepEqual(d.prepare('SELECT * FROM bunker_records WHERE key=?').get(prior.key),prior);assert.equal(d.prepare('SELECT COUNT(*) n FROM bunker_records').get().n,2);d.close();
});

test('request coalesces repeated opens and extends interest without rescheduling a successful refresh',async()=>{
 const {d,api}=db(),s=state();const first=await call(api,s,'request');
 for(const delta of [0,1000,30000,60000]){const again=await call(api,s,'request',{},now+delta);assert.equal(again.revision,first.revision);assert.equal(again.unchanged,true);}
 const saved=await call(api,s,'import',{expectedRevision:1,snapshot:source(now+1000)},now+1000);assert.equal(saved.item.nextDueAt,new Date(now+61000).toISOString());
 assert.equal((await call(api,s,'pending',{},now+60999)).items.length,0);assert.equal((await call(api,s,'pending',{},now+61000)).items.length,1);
 const renewed=await call(api,s,'request',{},now+70000);assert.equal(renewed.item.interestUntil,new Date(now+190000).toISOString());assert.equal(renewed.item.nextDueAt,saved.item.nextDueAt);assert.deepEqual(renewed.item.snapshot,saved.item.snapshot);
 assert.equal((await call(api,s,'pending',{},now+190000)).items.length,0);assert.equal(d.prepare("SELECT COUNT(*) n FROM bunker_records WHERE key LIKE 'daily:%'").get().n,1);d.close();
});

test('concurrent modal requests coalesce instead of creating duplicate work or dropping the winning request',async()=>{
 const {d,api}=db(),s=state();const results=await Promise.all([call(api,s,'request'),call(api,s,'request')]);assert.ok(results.every(result=>result.item.revision===1));assert.equal(results.filter(result=>result.unchanged).length,1);assert.equal((await call(api,s,'pending')).items.length,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM bunker_records').get().n,1);d.close();
});

test('pending is bounded, due-only, pause-aware and cannot dispatch orphan or stale-day source targets',async()=>{
 const {d,api}=db(),s=state();s.snapshots[0].rows=Array.from({length:25},(_,i)=>row({externalId:'campaign-'+i}));
 for(let i=0;i<25;i++)await call(api,s,'request',{objectId:'campaign-'+i});
 assert.equal((await call(api,s,'pending')).items.length,campaignDailyLimits.pending);
 const count=d.prepare('SELECT COUNT(*) n FROM bunker_records').get().n;
 s.paused=true;assert.deepEqual(await call(api,s,'pending'),{paused:true,items:[]});s.paused=false;
 const noTargets=structuredClone(s);noTargets.snapshots=[];assert.equal((await call(api,noTargets,'pending')).items.length,0);
 assert.equal((await call(api,s,'pending',{},Date.parse('2026-11-04T03:00:01Z'))).items.length,0);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM bunker_records').get().n,count);d.close();
});

test('import retains only the daily display whitelist; absent days, metrics, currency and source sync remain unknown',async()=>{
 const {d,api}=db(),s=state(),before=JSON.stringify(s);await call(api,s,'request');
 const snap=source();snap.lastSyncAt='2026-11-03T14:00:00Z';snap.detail.currency=undefined;snap.detail.transcript='PRIVATE';snap.detail.row.token='PRIVATE';snap.detail.daily[0].frontOrders=99;snap.detail.daily[0].secret='PRIVATE';delete snap.detail.daily[0].roi;
 const result=await call(api,s,'import',{expectedRevision:1,snapshot:snap}),saved=result.item.snapshot;
 assert.equal(result.item.status,'ready');assert.equal(result.revision,2);assert.equal(saved.lastSyncAt,null);assert.equal(saved.currency,null);assert.equal(saved.rows.length,7);assert.deepEqual(saved.rows[0],{day:'2026-10-28',spend:null,orders:null,cpa:null,revenueNet:null,profit:null,roas:null,roi:null});
 assert.equal(saved.rows[6].orders,2);assert.equal(saved.rows[6].cpa,50);assert.equal(saved.rows[6].roi,null);assert.equal(saved.rows[6].profit,45);assert.equal('frontOrders' in saved.rows[6],false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(d.prepare("SELECT payload FROM bunker_records WHERE key LIKE 'daily:%'").get().payload.includes('PRIVATE'),false);assert.equal(JSON.stringify(s),before);d.close();
});

test('identity, period, fuso, future, stale and malformed daily readings are rejected without overwriting cache',async()=>{
 const mutations=[x=>x.source='fixture',x=>x.fetchedAt=new Date(now+1).toISOString(),x=>x.fetchedAt=new Date(now-300001).toISOString(),x=>x.detail.row=null,x=>x.detail.row.id='22222222-2222-4222-8222-222222222222',x=>x.detail.row.projectId='nico',x=>x.detail.row.adAccountId='account-b',x=>x.detail.row.externalId='other',x=>x.detail.row.provider='google',x=>x.detail.provider='google',x=>x.detail.level='adset',x=>x.detail.externalId='other',x=>x.detail.period.timezone='America/Boa_Vista',x=>x.detail.period.from='2026-10-28T04:00:00Z',x=>x.detail.period.to='2026-11-04T04:00:00Z',x=>x.detail.period.days.pop(),x=>x.detail.dailyRange.from='2026-10-27',x=>x.detail.daily.push({...x.detail.daily[0]}),x=>x.detail.daily[0].day='2026-10-27',x=>x.detail.daily[0].spend=-1,x=>x.detail.daily[0].orders=1.5,x=>x.detail.daily[0].cpa=-1,x=>x.detail.daily[0].roi=Infinity,x=>x.detail.currency='not-currency'];
 for(const mutate of mutations){const {d,api}=db(),s=state();await call(api,s,'request');const before=d.prepare("SELECT * FROM bunker_records WHERE key LIKE 'daily:%'").get();const snap=source();mutate(snap);await assert.rejects(call(api,s,'import',{expectedRevision:1,snapshot:snap}),e=>['DAILY_INVALID_SNAPSHOT','DAILY_STALE_SNAPSHOT'].includes(e.code));assert.deepEqual(d.prepare("SELECT * FROM bunker_records WHERE key LIKE 'daily:%'").get(),before);d.close();}
});

test('source results require a real requested target and the same current day window',async()=>{
 const {d,api}=db(),s=state();await assert.rejects(call(api,s,'import',{expectedRevision:1,snapshot:source()}),e=>e.code==='DAILY_NO_REQUEST');await call(api,s,'request');
 const later=Date.parse('2026-11-04T03:01:00Z');await assert.rejects(call(api,s,'import',{expectedRevision:1,snapshot:source(later)},later),e=>e.code==='DAILY_NO_REQUEST');assert.equal(d.prepare('SELECT COUNT(*) n FROM bunker_records').get().n,1);d.close();
});

test('monotonic snapshots, exact replay and cache CAS reject stale or competing writers',async()=>{
 const {d,api}=db(),s=state();await call(api,s,'request');const first=await call(api,s,'import',{expectedRevision:1,snapshot:source(now+1000)},now+1000);assert.equal(first.revision,2);
 const replay=await call(api,s,'import',{expectedRevision:1,snapshot:source(now+1000)},now+2000);assert.equal(replay.unchanged,true);assert.equal(replay.revision,2);
 await assert.rejects(call(api,s,'import',{expectedRevision:2,snapshot:source()},now+2000),e=>e.code==='DAILY_STALE_SNAPSHOT');
 const different=source(now+1000);different.detail.daily[0].orders=3;await assert.rejects(call(api,s,'import',{expectedRevision:2,snapshot:different},now+2000),e=>e.code==='DAILY_CONFLICT');
 const a=source(now+3000),b=source(now+4000);const results=await Promise.allSettled([call(api,s,'import',{expectedRevision:2,snapshot:a},now+4000),call(api,s,'import',{expectedRevision:2,snapshot:b},now+4000)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='DAILY_CONFLICT').length,1);d.close();
});

test('failure is sanitized, preserves the last series and cannot hide a newer successful response',async()=>{
 const {d,api}=db(),s=state();await call(api,s,'request');const saved=await call(api,s,'import',{expectedRevision:1,snapshot:source()}),failed=await call(api,s,'failure',{expectedRevision:2,error:{code:'MALVA_UNAVAILABLE',message:'PRIVATE token at https://secret'}},now+1000);
 assert.deepEqual(failed.item.snapshot,saved.item.snapshot);assert.equal(failed.item.lastSuccessAt,saved.item.lastSuccessAt);assert.equal(failed.item.status,'error');assert.equal(failed.item.error.message.includes('PRIVATE'),false);assert.equal(failed.revision,3);
 await assert.rejects(call(api,s,'failure',{expectedRevision:2,error:{code:'MALVA_UNAVAILABLE'}}),e=>e.code==='DAILY_CONFLICT');await assert.rejects(call(api,s,'failure',{expectedRevision:3,error:{code:'ARBITRARY_RAW_ERROR'}}),e=>e.code==='DAILY_INVALID_REQUEST');
 const recovered=await call(api,s,'import',{expectedRevision:3,snapshot:source(now+2000)},now+2000);assert.equal(recovered.item.error,null);assert.equal(recovered.item.status,'ready');assert.equal((await call(api,s,'read',{},now+303000)).item.status,'stale');d.close();
});

test('pause preserves cached reads while blocking all source-result and interest writes',async()=>{
 const {d,api}=db(),s=state();await call(api,s,'request');await call(api,s,'import',{expectedRevision:1,snapshot:source()});const before=d.prepare("SELECT * FROM bunker_records WHERE key LIKE 'daily:%'").get();s.paused=true;
 for(const [action,extra] of [['request',{}],['import',{expectedRevision:2,snapshot:source(now+1000)}],['failure',{expectedRevision:2,error:{code:'MCP_UNAVAILABLE'}}]])await assert.rejects(call(api,s,action,extra,now+1000),e=>e.code==='DAILY_PAUSED');
 const read=await call(api,s,'read');assert.equal(read.paused,true);assert.equal(read.item.status,'paused');assert.ok(read.item.snapshot);assert.deepEqual(d.prepare("SELECT * FROM bunker_records WHERE key LIKE 'daily:%'").get(),before);d.close();
});

test('seven local calendar days across DST use explicit project boundaries rather than seven UTC durations',async()=>{
 const {d,api}=db(),s=state(),at=Date.parse('2026-11-01T20:00:00Z');s.snapshots[0].timezone='America/New_York';s.snapshots[0].fetchedAt='2026-11-01T19:00:00Z';const req=await call(api,s,'request',{},at);assert.deepEqual(req.item.range,{from:'2026-10-26',to:'2026-11-01'});
 const snap=source(at);snap.detail.period={timezone:'America/New_York',from:'2026-10-26T04:00:00Z',to:'2026-11-02T05:00:00Z'};snap.detail.dailyRange={from:'2026-10-26',to:'2026-11-01'};snap.detail.daily=[{day:'2026-11-01',spend:100,orders:2,cpa:50}];const saved=await call(api,s,'import',{expectedRevision:1,snapshot:snap},at);assert.equal(saved.item.snapshot.rows[6].day,'2026-11-01');assert.equal(saved.item.snapshot.timezone,'America/New_York');assert.equal(saved.item.snapshot.rows[6].revenueNet,null);d.close();
});

test('size and corrupt-record guards do not truncate rows or dispatch untrusted records',async()=>{
 const {d,api}=db(),s=state();await call(api,s,'request');const huge=source();huge.detail.extra='á'.repeat(campaignDailyLimits.recordBytes);await assert.rejects(call(api,s,'import',{expectedRevision:1,snapshot:huge}),e=>e.code==='DAILY_LIMIT');
 const key=d.prepare("SELECT key FROM bunker_records WHERE key LIKE 'daily:%'").get().key;d.prepare('UPDATE bunker_records SET payload=? WHERE key=?').run('{bad',key);await assert.rejects(call(api,s,'read'),e=>e.code==='DAILY_CACHE_INVALID');assert.deepEqual((await call(api,s,'pending')).items,[]);d.close();
});
