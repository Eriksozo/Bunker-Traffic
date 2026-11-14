import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {validateAnalysisBundle} from '../lib/analysis-validation.mjs';
import {retainKnowledgeMeasurements,recordOutcome,knowledgeLimits,measurementReadAt} from '../lib/knowledge.mjs';
import {commitPersistedState,readPersistedState} from '../lib/persistence.mjs';
import {archiveColdMeasurements,loadArchivedMeasurements,measurementArchivePolicy} from '../lib/measurement-archive.mjs';
import {learningObservations} from '../lib/learning-outcomes.mjs';

// Curadoria of 14/11/2026. Live cause: the first instrumented failure (John, persist/commit) was the global ceiling of
// 1,200 preserved measurements (931 of them repeats of the same window with identical metrics). Synthetic data only:
// in-memory SQLite, every source read faked, no provider and no order.
const now=Date.parse('2026-11-14T15:00:00Z'),iso=v=>new Date(v).toISOString(),day=86400000,mid=Date.parse('2026-11-14T00:00:00Z');
const ids={gabe:'11111111-1111-4111-8111-111111111111',john:'22222222-2222-4222-8222-222222222222',nico:'33333333-3333-4333-8333-333333333333',leandro:'44444444-4444-4444-8444-444444444444',murilo:'55555555-5555-4555-8555-555555555555',ronald:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const acct='66666666-6666-4666-8666-666666666666',acct2='77777777-7777-4777-8777-777777777777';
const row={id:'88888888-8888-4888-8888-888888888888',externalId:'123456',adAccountId:acct,accountName:'Synthetic',projectId:ids.gabe,projectName:'Gabe',provider:'meta',level:'campaign',name:'Synthetic',status:'ACTIVE',effectiveStatus:'ACTIVE',budgetCurrency:'BRL',dailyBudget:100,spend:0};
const yesterday={from:iso(mid-day),to:iso(mid)};
const measure=(n,project,extra={})=>{const from=iso(Date.parse('2026-01-01T00:00:00Z')+n*day),to=iso(Date.parse(from)+day),fetchedAt=iso(Date.parse(to)+3600000);const m={id:'past-'+n,project,adAccountId:acct,externalId:'past-'+project.slice(0,4),level:'campaign',from,to,fetchedAt,source:'Malva MCP',complete:true,metrics:{spend:n},proposalIds:['approved-'+project.slice(0,4)],timezone:'UTC',lastSyncAt:null,capturedAt:fetchedAt,...extra};m.key=JSON.stringify([m.project,m.adAccountId,m.externalId,m.level,m.from,m.to,m.fetchedAt]);m.reference='measurement:'+m.id;return m;};
/** `plan`: [[project, count], …]; default is the real distribution of 14/11 (John 732, Gabe 184, Nico 151, Leandro 68, Murilo 65). */
function past(plan=[['john',732],['gabe',184],['nico',151],['leandro',68],['murilo',65]]){const out=[];let n=0;for(const [name,count] of plan)for(let i=0;i<count;i++,n++)out.push(measure(n,ids[name]));return out;}
function base({plan,second=false}={}){
 const old={projectId:ids.gabe,projectName:'Gabe',source:'Malva MCP',complete:true,period:'yesterday',level:'campaign',...yesterday,timezone:'UTC',fetchedAt:iso(now-3600000),lastSyncAt:null,rows:[{...row}]};
 const oldM={id:'old',project:ids.gabe,adAccountId:acct,externalId:row.externalId,level:'campaign',...yesterday,fetchedAt:old.fetchedAt,source:'Malva MCP',complete:true,metrics:{spend:0},proposalIds:['approved-gabe'],timezone:'UTC',lastSyncAt:null,capturedAt:old.fetchedAt};
 oldM.key=JSON.stringify([ids.gabe,acct,row.externalId,'campaign',old.from,old.to,old.fetchedAt]);oldM.reference='measurement:old';
 const measurements=past(plan);measurements[measurements.findIndex(m=>m.project===ids.gabe)]=oldM;
 return {config:Object.fromEntries(Object.entries(ids).map(([k,v])=>[v,{projectName:k[0].toUpperCase()+k.slice(1)}])),paused:false,cadence:{enabled:false},snapshots:[old],
  jobs:[{id:'job',project:ids.gabe,executor:'cloudflare',status:'Em análise',startedAt:iso(now-5000)}],agents:{[ids.gabe]:{jobId:'job'}},reports:[],tasks:[],messages:[],events:[],executions:[],proposals:[],collaborationRounds:[],
  decisions:[{id:'approved-gabe',project:ids.gabe,objectId:row.externalId,adAccountId:acct,level:'campaign',status:'Aprovada'},...(second?[{id:'approved-gabe-2',project:ids.gabe,objectId:row.externalId,adAccountId:acct2,level:'campaign',status:'Aprovada'}]:[])],knowledgeMeasurements:measurements};
}
function sqlite(state){
 const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE bunker_records (key TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT); CREATE TABLE bunker_reports (id TEXT PRIMARY KEY,project TEXT,created_at TEXT,payload TEXT)');
 d.prepare('INSERT INTO bunker_records VALUES (?,?,?,?)').run('central',JSON.stringify(state),1,iso(now));
 return {d,db:{prepare(sql){return {sql,params:[],bind(...params){return {sql,params,async first(){return d.prepare(sql).get(...params);},async all(){return {results:d.prepare(sql).all(...params)};}};}};},async batch(statements){d.exec('BEGIN');try{const out=statements.map(s=>({meta:{changes:Number(d.prepare(s.sql).run(...(s.params||[])).changes)}}));d.exec('COMMIT');return out;}catch(e){d.exec('ROLLBACK');throw e;}}}};
}
const recordsOf=d=>keys=>keys.map(k=>d.prepare('SELECT key,payload FROM bunker_records WHERE key=?').get(k)).filter(Boolean);
async function collect({newSpend,plan,second=false,conflict=false}){
 const before=base({plan,second}),{d,db}=sqlite(before);let state=before,rev=1,writes=0;
 const source={read:async(tool,a)=>{
  if(tool==='workspace_whoami')return {workspace:{id:'synthetic'},platforms:[{platform:'tracking',read:true}]};
  if(tool==='tracking_list_projects')return {items:[{id:ids.gabe,name:'Gabe',timezone:'UTC',currency:'BRL'}]};
  if(tool==='tracking_ad_accounts')return {items:[{id:acct,provider:'meta',accountId:'555555555555'},...(second?[{id:acct2,provider:'meta',accountId:'555555555556'}]:[])]};
  assert.equal(tool,'tracking_campaigns');
  const y=iso(mid-day).slice(0,10),rows=a.level==='campaign'&&[iso(mid).slice(0,10),y].includes(a.from)?[{...row,spend:a.from===y?newSpend:0},...(second?[{...row,id:'99999999-9999-4999-8999-999999999999',adAccountId:acct2,spend:a.from===y?newSpend:0}]:[])]:[];
  return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(now-1000),lastSyncAt:iso(now-1500),period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to)+day),days:a.from===a.to?[a.from]:[a.from,a.to]},rows};
 }};
 let failure=null;
 const engine=createCloudEngine({read:async()=>({state:structuredClone(state),revision:rev}),
  write:async fn=>{writes++;const draft=structuredClone(state);try{if(conflict&&writes===1)throw Error('CONFLICT');const out=await fn(draft,rev);const saved=await commitPersistedState(db,draft,rev);state=saved.state;rev=saved.revision;return out;}catch(e){failure=e.message;throw e;}},
  source,now:()=>now,ops:{importBundle:(s,bundle)=>{const parsed=validateAnalysisBundle(bundle,s,now);retainKnowledgeMeasurements(s,iso(now));for(const x of parsed.snapshots){s.snapshots=s.snapshots.filter(c=>!(c.projectId===x.projectId&&c.period===x.period&&c.level===x.level));s.snapshots.push(x);}},updateRun:(_s,j,status,note)=>{j.status=status;j.note=note;}}});
 let out;try{out=await engine.step();}catch(e){out={code:e.code,...e.collectionFailure};}
 const stored=(await readPersistedState(db,{})).state,cold=await loadArchivedMeasurements(stored.knowledgeMeasurementArchive,recordsOf(d));
 const records=d.prepare("SELECT count(*) n FROM bunker_records WHERE key LIKE 'history-measurements:%'").get().n;d.close();
 return {out,stored,cold,all:[...stored.knowledgeMeasurements,...cold],records,failure,before};
}
const evidence=['id','key','project','adAccountId','externalId','level','from','to','fetchedAt','metrics','reference','timezone','lastSyncAt','capturedAt'];
const same=(a,b)=>evidence.every(k=>JSON.stringify(a?.[k])===JSON.stringify(b?.[k]));
const hotPerProject=list=>list.reduce((m,x)=>m.set(x.project,(m.get(x.project)||0)+1),new Map());

test('real distribution (1,200) + an identical new read: the collection concludes, all 1,200 kept exactly, hot set bounded',async()=>{
 const r=await collect({newSpend:0});
 assert.equal(r.out.kind,'collection',JSON.stringify(r.out)+' '+r.failure);assert.equal(r.stored.jobs[0].status,'Concluída');
 assert.equal(r.all.length,1200,'the repeat is a read of the same measurement');assert.equal(new Set(r.all.map(m=>m.id)).size,1200);
 for(const m of r.before.knowledgeMeasurements)assert.ok(same(r.all.find(x=>x.id===m.id),m),'kept exactly: '+m.id);
 const old=r.all.find(m=>m.id==='old');assert.equal(old.reads.length,1);assert.equal(old.reads[0].lastSyncAt,iso(now-1500));assert.equal(measurementReadAt(old,old.reads[0].fetchedAt),true);
 assert.ok(r.stored.knowledgeMeasurements.some(m=>m.id==='old'),'the window still in the snapshots stays loaded');
 for(const n of hotPerProject(r.stored.knowledgeMeasurements).values())assert.ok(n<=knowledgeLimits.hotMeasurementsPerProject);
 assert.ok(r.records>0);assert.equal(r.stored.knowledgeMeasurementArchive.segments.reduce((n,s)=>n+s.count,0),r.cold.length);
});

test('1,200 in the SAME project + new distinct metrics: concludes with a new measurement; the 1,200 stay exact (overflow is safe)',async()=>{
 const r=await collect({newSpend:7,plan:[['gabe',1200]]});
 assert.equal(r.out.kind,'collection',JSON.stringify(r.out)+' '+r.failure);
 assert.equal(r.all.length,1201);for(const m of r.before.knowledgeMeasurements)assert.ok(same(r.all.find(x=>x.id===m.id),m),m.id);
 const fresh=r.all.find(m=>!r.before.knowledgeMeasurements.some(x=>x.id===m.id));assert.equal(fresh.metrics.spend,7);assert.ok(r.stored.knowledgeMeasurements.includes?.(fresh)||r.stored.knowledgeMeasurements.some(m=>m.id===fresh.id));
 assert.ok(hotPerProject(r.stored.knowledgeMeasurements).get(ids.gabe)<=knowledgeLimits.hotMeasurementsPerProject);
});

test('the same object in two accounts stays two measurements',async()=>{
 const r=await collect({newSpend:7,second:true});
 assert.equal(r.out.kind,'collection',JSON.stringify(r.out)+' '+r.failure);
 const fresh=r.all.filter(m=>!r.before.knowledgeMeasurements.some(x=>x.id===m.id));
 assert.deepEqual(fresh.map(m=>m.adAccountId).sort(),[acct,acct2].sort());assert.ok(fresh.every(m=>m.metrics.spend===7&&m.externalId===row.externalId));
});

test('idempotent retention and archiving; a lost CAS writes no record and changes nothing',async()=>{
 const s=base();s.snapshots.push({...s.snapshots[0],period:'3d',fetchedAt:iso(now-60000)});retainKnowledgeMeasurements(s,iso(now));
 const once=structuredClone(s.knowledgeMeasurements);retainKnowledgeMeasurements(s,iso(now));assert.deepEqual(s.knowledgeMeasurements,once);
 const a=structuredClone(s),b=structuredClone(s),ra=await archiveColdMeasurements(a,now),rb=await archiveColdMeasurements(b,now);
 assert.deepEqual(ra.records.map(x=>x.key),rb.records.map(x=>x.key),'same content, same addresses');
 assert.equal((await archiveColdMeasurements(a,now)).archived,0,'a second pass archives nothing');
 // The real compare-and-swap: a stale revision commits nothing, and no archive record lands without its central.
 const stale=base(),{d,db}=sqlite(stale);d.prepare("UPDATE bunker_records SET revision=2 WHERE key='central'").run();
 await assert.rejects(commitPersistedState(db,structuredClone(stale),1),/CONFLICT/);
 assert.equal(d.prepare("SELECT count(*) n FROM bunker_records WHERE key LIKE 'history-measurements:%'").get().n,0);
 assert.equal(JSON.parse(d.prepare("SELECT payload FROM bunker_records WHERE key='central'").get().payload).knowledgeMeasurements.length,1200);d.close();
 // In the engine: the collection that lost the CAS saves nothing of its own; its failure note may archive, losing nothing.
 const r=await collect({newSpend:0,conflict:true});
 assert.equal(r.out.code,'CLOUD_REVISION_CONFLICT');assert.equal(r.stored.jobs[0].status,'Falhou');
 assert.equal(r.all.length,1200);for(const m of r.before.knowledgeMeasurements)assert.ok(same(r.all.find(x=>x.id===m.id),m),m.id);
 assert.equal(r.all.find(m=>m.id==='old').reads,undefined,'the new read of the losing collection was not saved');
});

test('memory: worst case of six projects × 1,200 measurements × the maximum repeat reads keeps a bounded hot set',async()=>{
 const s={config:{},snapshots:[],knowledgeMeasurements:[]};let n=0;
 for(const p of Object.values(ids)){s.config[p]={projectName:'P'};for(let i=0;i<1200;i++,n++)s.knowledgeMeasurements.push(measure(n,p,{reads:Array.from({length:knowledgeLimits.readsPerMeasurement},(_,k)=>({fetchedAt:iso(Date.parse('2026-01-01T00:00:00Z')+n*day+2*3600000+k*60000),lastSyncAt:null}))}));}
 const total=JSON.stringify(s.knowledgeMeasurements).length,r=await archiveColdMeasurements(s,now),hot=JSON.stringify(s.knowledgeMeasurements).length;
 assert.equal(r.archived+s.knowledgeMeasurements.length,7200);
 for(const c of hotPerProject(s.knowledgeMeasurements).values())assert.ok(c<=knowledgeLimits.hotMeasurementsPerProject);
 // Hot JSON ≤ projects × hot cap × the largest measurement allowed (1 KB evidence + 24 reads): about 3.5 MB at worst.
 assert.ok(hot<=6*knowledgeLimits.hotMeasurementsPerProject*3000,`hot ${hot} bytes`);assert.ok(hot<total/5,`hot ${hot} of ${total}`);
 assert.ok(r.records.every(x=>JSON.stringify(x.payload).length<measurementArchivePolicy.maxSegmentBytes*2));
});

test('pins: windows in the snapshots, cited results and recent confirmed applications stay loaded',async()=>{
 const s={config:{[ids.john]:{projectName:'John'}},knowledgeMeasurements:past([['john',400]]),snapshots:[],knowledgeOutcomes:[],executions:[],proposals:[]};
 const [w,c,l]=[s.knowledgeMeasurements[10],s.knowledgeMeasurements[20],s.knowledgeMeasurements[30]];
 s.snapshots.push({projectId:ids.john,from:w.from,to:w.to,rows:[]});
 s.knowledgeOutcomes.push({id:'o',after:{measurementId:c.id}});
 l.proposalIds=['confirmed-p'];s.executions.push({proposalId:'confirmed-p',status:'Confirmada',confirmedAt:iso(Date.parse(l.to)+day)});
 await archiveColdMeasurements(s,Date.parse(l.to)+3*day);
 for(const m of [w,c,l])assert.ok(s.knowledgeMeasurements.some(x=>x.id===m.id),m.id);
});

test('exact archived references: loaded on demand, an old result revalidates through outcomeWindow, missing or altered records fail closed',async()=>{
 const s={config:{john:{projectName:'John'}},decisions:[{id:'decision-a',project:'john',objectId:'campaign-a',status:'Aplicada pelo operador',appliedAt:'2026-10-29T12:00:00.000Z'}],knowledge:[],snapshots:[]};
 const b={from:'2026-10-28T00:00:00.000Z',to:'2026-10-29T00:00:00.000Z'},a={from:'2026-10-30T00:00:00.000Z',to:'2026-10-31T00:00:00.000Z'};
 const snap=(w,fetchedAt,spend,frontOrders)=>({projectId:'john',source:'Malva MCP',complete:true,level:'campaign',...w,fetchedAt,rows:[{externalId:'campaign-a',adAccountId:'account-john',spend,frontOrders}]});
 s.snapshots=[snap(b,'2026-11-02T16:00:00.000Z',400,2),snap(a,'2026-11-02T16:00:00.000Z',500,4)];retainKnowledgeMeasurements(s,'2026-11-02T18:00:00.000Z');
 s.snapshots=[snap(b,'2026-11-02T16:30:00.000Z',400,2),snap(a,'2026-11-02T16:30:00.000Z',500,4)];retainKnowledgeMeasurements(s,'2026-11-02T18:00:00.000Z');
 assert.equal(s.knowledgeMeasurements.length,2);
 // Months later: windows gone from the snapshots, nothing cites them → both move to the archive.
 s.snapshots=[];const original=structuredClone(s.knowledgeMeasurements),out=await archiveColdMeasurements(s,Date.parse('2027-03-01T00:00:00Z'));
 assert.equal(out.archived,2);assert.deepEqual(s.knowledgeMeasurements,[]);
 const records=new Map(out.records.map(x=>[x.key,JSON.stringify(x.payload)])),fetch=keys=>keys.filter(k=>records.has(k)).map(k=>({key:k,payload:records.get(k)}));
 const loaded=await loadArchivedMeasurements(s.knowledgeMeasurementArchive,fetch,{project:'john',externalId:'campaign-a'});
 assert.deepEqual(loaded,original,'exact ids, fetches, repeat reads and metrics');
 assert.deepEqual(await loadArchivedMeasurements(s.knowledgeMeasurementArchive,fetch,{project:'john',externalId:'campaign-a',...a}),original.filter(m=>m.from===a.from));
 const src=(ref,w,observedAt)=>({system:'Malva MCP',reference:ref,observedAt,...w,summary:'Leitura conferida.'});
 const data=observedAt=>({project:'john',objectId:'campaign-a',proposalId:'decision-a',before:{...b,metrics:{spend:400,frontOrders:2}},after:{...a,metrics:{spend:500,frontOrders:4}},sources:[src('before',b,observedAt),src('after',a,observedAt)],summary:'Comparação sem causalidade.'});
 const withLoaded={...structuredClone(s),knowledgeMeasurements:loaded};
 assert.equal(recordOutcome(structuredClone(withLoaded),data('2026-11-02T16:30:00.000Z'),'2027-03-01T00:00:00.000Z').after.fetchedAt,'2026-11-02T16:30:00.000Z');
 assert.equal(recordOutcome(structuredClone(withLoaded),data('2026-11-02T16:00:00.000Z'),'2027-03-01T00:00:00.000Z').before.fetchedAt,'2026-11-02T16:00:00.000Z');
 assert.throws(()=>recordOutcome(structuredClone(withLoaded),data('2026-11-02T16:15:00.000Z'),'2027-03-01T00:00:00.000Z'),/falta leitura/);
 const key=s.knowledgeMeasurementArchive.segments[0].key;
 await assert.rejects(loadArchivedMeasurements(s.knowledgeMeasurementArchive,keys=>fetch(keys).filter(r=>r.key!==key)),e=>e.code==='STORAGE_INTEGRITY');
 const forged=JSON.parse(records.get(key));forged.rawBytes+=1;
 await assert.rejects(loadArchivedMeasurements(s.knowledgeMeasurementArchive,keys=>fetch(keys).map(r=>r.key===key?{key,payload:JSON.stringify(forged)}:r)),e=>e.code==='STORAGE_INTEGRITY');
});

test('an archived external-action cut still counts: retention does not open a second cut on the same side',async()=>{
 const observed={id:'ext',project:'p',objectId:'c',adAccountId:'a',occurredAt:'2026-11-01T16:00:00.000Z',sourceSystem:'Malva MCP',humanObserved:true,field:'dailyBudget'};
 const make=(from,to,fetchedAt,spend)=>({projectId:'p',period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',from,to,fetchedAt,timezone:'America/Sao_Paulo',rows:[{externalId:'c',adAccountId:'a',spend}]});
 const s={config:{p:{projectName:'P'}},decisionHistory:[observed],snapshots:[make('2026-10-31T03:00:00.000Z','2026-11-01T03:00:00.000Z','2026-11-03T12:00:00.000Z',100)]};
 retainKnowledgeMeasurements(s,'2026-11-03T15:00:00.000Z');assert.equal(s.knowledgeMeasurements.length,1);
 s.snapshots=[];await archiveColdMeasurements(s,Date.parse('2027-01-01T00:00:00Z'));assert.equal(s.knowledgeMeasurements.length,0);
 assert.deepEqual(s.knowledgeMeasurementArchive.segments[0].history.map(h=>h[0]),['history:ext']);
 s.snapshots=[make('2026-10-30T03:00:00.000Z','2026-10-31T03:00:00.000Z','2026-11-03T12:30:00.000Z',90)];
 retainKnowledgeMeasurements(s,'2026-11-03T15:00:00.000Z');assert.equal(s.knowledgeMeasurements.length,0,'the before side already has its cut, archived');
});

test('a newer repeat read with unknown sync keeps lastSyncAt null (never the first fetch’s sync)',()=>{
 const m={id:'m',project:'p',adAccountId:'a',externalId:'c',level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-10T00:00:00Z',to:'2026-11-11T00:00:00Z',fetchedAt:'2026-11-12T10:00:00Z',lastSyncAt:'2026-11-12T09:00:00Z',timezone:'UTC',
  metrics:{spend:100,revenueNet:200,adCosts:1,productCost:10,saleTax:5,frontOrders:2,orders:2,checkouts:4,impressions:1000,linkClicks:20},reads:[{fetchedAt:'2026-11-13T10:00:00Z',lastSyncAt:null}]};
 const out=learningObservations({snapshots:[],knowledgeMeasurements:[m]},{project:'p',payload:{objectId:'c',adAccountId:'a'}},Date.parse('2026-11-14T11:00:00Z'));
 assert.equal(out.length,1);assert.equal(out[0].fetchedAt,'2026-11-13T10:00:00Z');assert.equal(out[0].lastSyncAt,null);
 m.reads[0].lastSyncAt='2026-11-13T09:00:00Z';
 assert.equal(learningObservations({snapshots:[],knowledgeMeasurements:[m]},{project:'p',payload:{objectId:'c',adAccountId:'a'}},Date.parse('2026-11-14T11:00:00Z'))[0].lastSyncAt,'2026-11-13T09:00:00Z');
});
