import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {creativeDataAction,readCreativeData,validateCreativeSnapshot} from '../lib/creative-data.mjs';
import {creativeSnapshot,expertBindings,CreativeRelay,CREATIVE_TOOL} from '../scripts/local-creative-sync.mjs';
const now=Date.parse('2026-11-03T18:00:00Z'),p={projectId:'p',projectName:'John'},binding={squad:'SQ1',expertId:'person',expertName:'Jhon Rodrigues',expertSigla:'JHON'};
function db(){const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE bunker_records (key TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');return {d,prepare(sql){return {bind(...a){return {async all(){return {success:true,results:d.prepare(sql).all(...a)};},async run(){return {meta:{changes:Number(d.prepare(sql).run(...a).changes)}};}};}};}};}
const state=()=>({config:{p:{projectName:'John'},q:{projectName:'Nico'}},paused:false,snapshots:[{frozen:'analysis'}],proposals:[{status:'Aprovada',signature:'unchanged'}],cadence:{intervalMinutes:60}});
const snapshot=()=>creativeSnapshot(p,binding,[{id:'production',expert:binding.expertName,nome:'JHON_ATMOZ_KEV_043_H1',estado:'EM_TRAFEGO',ultimaMudanca:'2026-11-02T18:00:00Z',privateCopy:'must not leave source'}],[{id:'variant',expert:'JHON',nomeCanonico:'JHON_ATMOZ_KEV_043_H1_V04_JEFE',nomeMeta:'JHON_A_043_H1_V04',origemChave:'JHON_ATMOZ_KEV_043_H1',etapa:'NO_AR',resultado:'VALIDADO',pedidoEm:'2026-11-01T18:00:00Z'}],now-1000);
test('expert identities are exact, squad-specific and never silently fuzzy-matched',()=>{
 const catalogs=[{squad:'SQ1',catalog:{experts:[{id:'person',nome:'Jhon Rodrigues',sigla:'JHON'}]}}];assert.deepEqual(expertBindings([p],catalogs).get('p'),binding);assert.equal(expertBindings([{projectId:'other',projectName:'Gabe'}],catalogs).size,0);assert.equal(expertBindings([p],[...catalogs,...catalogs]).size,0);
});
test('creative projection preserves real variant names and source clocks, excludes raw copy and does not claim completeness',()=>{
 const v=snapshot();assert.equal(v.rows[1].name,'JHON_ATMOZ_KEV_043_H1_V04_JEFE');assert.equal(v.rows[1].result,'VALIDADO');assert.equal(v.lastSyncAt,null);assert.equal(v.coverage,'returned-items-only');assert.equal(JSON.stringify(v).includes('must not leave source'),false);assert.equal(validateCreativeSnapshot(v,p,now).rows.length,2);assert.throws(()=>creativeSnapshot(p,binding,[{expert:'Someone Else'}],[],now));assert.throws(()=>validateCreativeSnapshot({...v,complete:true},p,now));
});
test('cache writes are isolated from financial/analysis state, CAS protected, source-validated and pause-aware',async()=>{
 const database=db(),s=state(),before=JSON.stringify(s);const write=entry=>creativeDataAction(database,s,{action:'import',projectId:'p',snapshot:snapshot(),...entry},now);
 const saved=await write({expectedRevision:0});assert.equal(saved.revision,1);assert.equal((await readCreativeData(database,s,'p')).items[0].snapshot.rows.length,2);assert.equal(JSON.stringify(s),before);
 await assert.rejects(write({expectedRevision:0}),/CONFLICT/);s.paused=true;await assert.rejects(write({expectedRevision:1}),/pausado/);s.paused=false;
 await assert.rejects(write({expectedRevision:1,snapshot:{...snapshot(),projectId:'q'}}),/incompatível/);
 const fail=await creativeDataAction(database,s,{action:'failure',projectId:'p',expectedRevision:1,error:{code:'ORBITA_UNAVAILABLE',message:'Fonte indisponível.'}},now+1000);assert.deepEqual(fail.item.snapshot,saved.item.snapshot);assert.ok(fail.item.error);assert.equal(database.d.prepare('SELECT COUNT(*) AS n FROM bunker_records').get().n,1);database.d.close();
});
test('ambiguous creative import never retries or writes failure over the uncertain result',async()=>{
 let writes=0,failures=0,imported=false;const s=state(),raw={siteProjectId:'site',paused:false,projects:[p],items:[{projectId:'p',revision:0,snapshot:null}]};
 const client={orbitaReady:true,ensureReady:async()=>{},callTool:async(server,tool,args)=>{
  if(server==='codex_apps'){assert.equal(tool,CREATIVE_TOOL);if(args.action==='read')return structuredClone(raw);if(args.action==='import'){writes++;imported=true;throw Error('timeout');}if(args.action==='failure'){failures++;return {};}}
  if(tool==='workspace_whoami')return {workspace:{id:'workspace'},person:{email:'owner@example.com'}};
  if(tool==='quem_sou_eu')return {email:'owner@example.com',squads:[{sigla:'SQ1'}]};
  if(tool==='listar_cadastros')return {experts:[{id:'person',nome:binding.expertName,sigla:'JHON'}]};
  if(tool==='listar_producoes')return [{id:'production',expert:binding.expertName,nome:'Root',estado:'EM_TRAFEGO',ultimaMudanca:null}];
  if(tool==='listar_lateralizacoes')return [];
  throw Error('Unexpected source call');
 }};
 const relay=new CreativeRelay({client,workspaceId:'workspace',siteId:'site',now:()=>now});const result=await relay.runOnce();assert.equal(imported,true);assert.equal(result.failed,1);assert.equal(writes,1);assert.equal(failures,0);await relay.runOnce();assert.equal(writes,1);
});
