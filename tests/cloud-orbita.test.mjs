import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {callOrbitaMcp,cloudOrbitaClient} from '../lib/cloud-orbita.mjs';
import {syncCloudCreatives} from '../lib/cloud-creative-sync.mjs';
import {readCreativeData} from '../lib/creative-data.mjs';
import {creativeLearningContext} from '../lib/creative-learning-context.mjs';
const now=Date.parse('2026-11-05T21:20:00Z');
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE bunker_records(key TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');return {sql,prepare(q){return {bind(...params){return {async all(){return {success:true,results:sql.prepare(q).all(...params)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...params).changes)}};}};}};}};}
function fixture(){
 const db=database(),state={paused:false,config:{p:{projectName:'John'}},snapshots:[{projectId:'p',level:'ad',rows:[{name:'JHON_A_043_H1_V04',adAccountId:'account',campaignExternalId:'campaign'}]}],proposals:[{signature:'untouched'}],cadence:{intervalMinutes:15}},calls=[];
 const expert={id:'expert',nome:'Jhon Rodrigues',sigla:'JHON'};
 const source={async read(tool,args){calls.push({tool,args});if(tool==='quem_sou_eu')return {email:'owner@example.com',squads:[{sigla:'SQ1'}]};if(tool==='listar_cadastros')return {experts:[expert]};if(tool==='listar_producoes')return [{id:'root',expert:expert.nome,nome:'JHON_ATMOZ_KEV_043_H1',estado:'EM_TRAFEGO',ultimaMudanca:null}];if(tool==='listar_lateralizacoes')return [{id:'variant',expert:'JHON',nomeCanonico:'JHON_ATMOZ_KEV_043_H1_V04',nomeMeta:'JHON_A_043_H1_V04',etapa:'NO_AR',origemChave:'JHON_ATMOZ_KEV_043_H1'}];throw Error('Unexpected tool');}};
 return {db,state,source,calls,malva:{read:async()=>({person:{email:'owner@example.com'},workspace:{id:'workspace'}})},expectedEmail:'owner@example.com',expectedWorkspace:'workspace',readCurrent:async()=>state,now:()=>now,projectId:'p'};
}
test('Órbita bridge uses fixed endpoint, preserves exact data, handles SSE, and cannot dispatch writes',async()=>{
 let calls=0;const fetch=async(url,req)=>{calls++;assert.equal(url,'https://dashops.forallsales.com.br/api/mcp');assert.equal(req.redirect,'error');assert.equal(req.headers.Authorization,'Bearer test-key');assert.equal(JSON.parse(req.body).params.name,'quem_sou_eu');return new Response('event: message\ndata: '+JSON.stringify({id:'response',result:{content:[{type:'text',text:'{"email":"owner@example.com"}'}]}})+'\n\n');};
 assert.equal((await callOrbitaMcp({key:'test-key',tool:'quem_sou_eu',fetch})).email,'owner@example.com');
 for(const tool of ['mover_producao','registrar_resultado','tracking_set_ad_budget','tools/call'])await assert.rejects(callOrbitaMcp({key:'test-key',tool,fetch}),e=>e.code==='ORBITA_TOOL_NOT_ALLOWED');assert.equal(calls,1);
 await assert.rejects(callOrbitaMcp({key:'',tool:'quem_sou_eu',fetch}),e=>e.code==='ORBITA_KEY_REQUIRED');
 await assert.rejects(callOrbitaMcp({key:'test-key',tool:'quem_sou_eu',fetch:async()=>new Response('private provider content',{status:401})}),e=>e.code==='ORBITA_AUTH_FAILED'&&!e.message.includes('private'));
 const client=cloudOrbitaClient({rpc:async(op,input)=>({op,input})});assert.equal((await client.read('listar_cadastros',{})).op,'orbitaMcp');await assert.rejects(client.read('mover_producao'),e=>e.code==='ORBITA_TOOL_NOT_ALLOWED');
});
test('independent creative refresh reaches the actual agent context without financial or central-state mutation',async()=>{
 const f=fixture(),before=JSON.stringify(f.state);const result=await syncCloudCreatives(f);assert.equal(result.items[0].revision,1);assert.equal(result.items[0].snapshot.rows.length,2);assert.equal(f.calls.length,4);assert.equal(JSON.stringify(f.state),before);
 const context=creativeLearningContext(f.state,'p',result,[{adAccountId:'account',externalId:'campaign'}],now);assert.equal(context.available,true);assert.equal(context.financialEvidence,false);assert.equal(context.matches.length,1);assert.equal(context.matches[0].metaName,'JHON_A_043_H1_V04');assert.equal(context.matches[0].origin,'JHON_ATMOZ_KEV_043_H1');
 await syncCloudCreatives(f);assert.equal(f.calls.length,4);assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM bunker_records').get().n,1);f.db.sql.close();
});
test('wrong owner, workspace, ambiguous expert or source rows fail closed and preserve previous metadata',async()=>{
 for(const kind of ['owner','workspace','ambiguous','foreign']){
  const f=fixture();await syncCloudCreatives(f);const prior=(await readCreativeData(f.db,f.state,'p')).items[0].snapshot;f.now=()=>now+60001;
  if(kind==='owner')f.expectedEmail='other@example.com';if(kind==='workspace')f.expectedWorkspace='other';
  const original=f.source.read;f.source.read=async(tool,args)=>{const value=await original(tool,args);if(kind==='ambiguous'&&tool==='listar_cadastros')value.experts.push({...value.experts[0],id:'other'});if(kind==='foreign'&&tool==='listar_lateralizacoes')value[0].expert='NICO';return value;};
  const result=await syncCloudCreatives(f);assert.ok(result.items[0].error);assert.deepEqual(result.items[0].snapshot,prior);assert.equal(creativeLearningContext(f.state,'p',result,[],now+60001).available,false);f.db.sql.close();
 }
});
test('pause before refresh, pause before commit and concurrent replacement never overwrite the cache',async()=>{
 const f=fixture();f.state.paused=true;await syncCloudCreatives(f);assert.equal(f.calls.length,0);f.state.paused=false;f.readCurrent=async()=>({...f.state,paused:true});const out=await syncCloudCreatives(f);assert.equal(out.items[0].revision,0);f.db.sql.close();
 const g=fixture();g.readCurrent=async()=>{const first=fixture();first.db=g.db;await syncCloudCreatives(first);return g.state;};const changed=await syncCloudCreatives(g);assert.equal(changed.items[0].revision,1);assert.equal(changed.items[0].error,null);g.db.sql.close();
});
test('an uncertain import never triggers a blind retry or failure write over a successful cache update',async()=>{
 const f=fixture(),original=f.db.prepare;let writes=0;f.db.prepare=q=>{const stmt=original(q);return {bind(...params){const bound=stmt.bind(...params);return {...bound,async run(){writes++;await bound.run();throw Error('Lost acknowledgment');}};}};};await assert.rejects(syncCloudCreatives(f),/Lost acknowledgment/);assert.equal(writes,1);assert.equal((await readCreativeData(f.db,f.state,'p')).items[0].revision,1);f.db.sql.close();
});
