import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {packSnapshotState,hydrateSnapshotState,snapshotStorageLimits} from '../lib/snapshot-storage.mjs';
import {ensureCollaboration,collaborationPlan} from '../lib/collaboration.mjs';

const now=Date.parse('2026-11-02T12:30:00.000Z');
function fixture(rows=1){
 const job={id:'job',project:'nico',status:'Concluída',startedAt:'2026-11-02T12:00:00.000Z',completedAt:'2026-11-02T12:20:00.000Z'};
 const state={snapshots:['7d','3d','yesterday','today'].map((period,index)=>({projectId:'nico',projectName:'Nico · São Luís',period,level:'campaign',from:'2026-11-01T03:00:00.000Z',to:'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:`2026-11-02T12:0${index}:00.000Z`,lastSyncAt:null,source:'Malva MCP',complete:true,rows:Array.from({length:rows},(_,i)=>({id:'internal-'+i,externalId:'campaign-'+i,adAccountId:'account',accountName:'Conta ção 🌱',name:'Anúncio '+i+' · pré-escala '+('aquisição e retorno · '.repeat(12)),provider:'meta',level:'campaign',status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:103.78,budgetCurrency:'USD',spend:77.01,revenueNet:211.22,frontOrders:2,orders:3,checkouts:11,note:null}))})),config:{nico:{projectName:'Nico',targetRoas:null}},jobs:[job],agents:{nico:{jobId:'job'}},events:[],reports:[{id:'report',project:'nico',text:'Relatório preservado'}],ownerChoices:[{id:'choice',project:'nico',action:'keep'}],executions:[{id:'execution',status:'Verificação necessária',submittedAt:'2026-11-02T11:00:00.000Z'}]};
 return {state,job};
}
function frozen(value){if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))frozen(item);}return value;}
function envelopeFor(raw,extra={}){
 return {snapshots:[],snapshotStorage:{kind:'bunker-snapshots',version:1,encoding:'gzip-base64',digest:'sha256:'+createHash('sha256').update(raw).digest('hex'),rawBytes:raw.byteLength,snapshotCount:0,rowCount:0,data:gzipSync(raw).toString('base64'),...extra}};
}

test('Legacy state and empty snapshots remain readable without storage metadata',async()=>{
 const {state}=fixture(),original=JSON.stringify(state);assert.deepEqual(await hydrateSnapshotState(state),state);assert.equal(JSON.stringify(state),original);
 const empty={snapshots:[],reports:[]};assert.deepEqual(await hydrateSnapshotState(await packSnapshotState(empty)),empty);
});
test('Packing and hydration preserve the exact logical JSON and never mutate frozen inputs',async()=>{
 const {state}=fixture();frozen(state);const json=JSON.stringify(state),packed=await packSnapshotState(state);assert.equal(JSON.stringify(state),json);assert.deepEqual(packed.snapshots,[]);assert.equal(packed.snapshotStorage.snapshotCount,4);assert.equal(packed.snapshotStorage.rowCount,4);assert.equal(packed.snapshotStorage.rawBytes,new TextEncoder().encode(JSON.stringify(state.snapshots)).byteLength);
 frozen(packed);const stored=JSON.stringify(packed),hydrated=await hydrateSnapshotState(packed);assert.equal(JSON.stringify(hydrated),json);assert.equal(JSON.stringify(packed),stored);assert.ok(!Object.hasOwn(hydrated,'snapshotStorage'));
});
test('A full hierarchy above the old central limit fits without dropping, rounding or merging rows',async()=>{
 const {state}=fixture(1200);const original=JSON.stringify(state);assert.ok(new TextEncoder().encode(original).byteLength>1750000);
 const packed=await packSnapshotState(state);assert.ok(new TextEncoder().encode(JSON.stringify(packed)).byteLength<1750000);const hydrated=await hydrateSnapshotState(packed);assert.equal(JSON.stringify(hydrated),original);assert.equal(hydrated.snapshots.reduce((n,s)=>n+s.rows.length,0),4800);assert.equal(hydrated.snapshots[3].rows[1199].dailyBudget,103.78);
});
test('Frozen-source collaboration fingerprints and pending execution journals survive storage roundtrip',async()=>{
 const {state,job}=fixture(10);const round=ensureCollaboration(state,job,now),original=JSON.stringify(state);
 const restored=await hydrateSnapshotState(await packSnapshotState(state));assert.equal(JSON.stringify(restored),original);assert.equal(restored.collaborationRounds[0].sourceHash,round.sourceHash);assert.equal(collaborationPlan(restored,now).rounds[0].blocked,null);assert.deepEqual(restored.executions,state.executions);assert.deepEqual(restored.ownerChoices,state.ownerChoices);
});
test('Unknown, missing or mixed storage formats fail closed instead of becoming empty readings',async()=>{
 const packed=await packSnapshotState(fixture().state);
 for(const change of [s=>{s.snapshotStorage=null;},s=>{delete s.snapshotStorage.data;},s=>{s.snapshotStorage.version=2;},s=>{s.snapshotStorage.encoding='deflate';},s=>{s.snapshotStorage.kind='other';},s=>{s.snapshots=[{rows:[]}];},s=>{delete s.snapshots;}]){const bad=structuredClone(packed);change(bad);await assert.rejects(hydrateSnapshotState(bad),/Leituras armazenadas inválidas/);}
 await assert.rejects(hydrateSnapshotState({reports:[]}),/Leituras armazenadas inválidas/);await assert.rejects(packSnapshotState(packed),/estado lógico esperado/);
});
test('Content tampering, metadata changes and partial gzip fail integrity checks',async()=>{
 const packed=await packSnapshotState(fixture().state);
 for(const change of [s=>{s.snapshotStorage.digest='sha256:'+'0'.repeat(64);},s=>{s.snapshotStorage.rawBytes++;},s=>{s.snapshotStorage.rowCount++;},s=>{s.snapshotStorage.snapshotCount--;},s=>{s.snapshotStorage.data=s.snapshotStorage.data.slice(0,-8);},s=>{s.snapshotStorage.data='?'.repeat(4);},s=>{s.snapshotStorage.data=s.snapshotStorage.data.slice(0,-4)+'AAAA';}]){const bad=structuredClone(packed);change(bad);await assert.rejects(hydrateSnapshotState(bad),/Leituras armazenadas inválidas/);}
});
test('Expansion is bounded by the declared size before collecting a decompressed body',async()=>{
 const packed=await packSnapshotState(fixture(100).state);packed.snapshotStorage.rawBytes=2;await assert.rejects(hydrateSnapshotState(packed),/tamanho inconsistente/);
 for(const patch of [{rawBytes:snapshotStorageLimits.maxRawBytes+1},{rawBytes:-1},{rowCount:snapshotStorageLimits.maxRows+1},{snapshotCount:snapshotStorageLimits.maxSnapshots+1},{data:'A'.repeat(snapshotStorageLimits.maxEncodedChars+4)}]){const bad={...packed,snapshotStorage:{...packed.snapshotStorage,...patch}};await assert.rejects(hydrateSnapshotState(bad),/Leituras armazenadas inválidas/);}
});
test('Valid gzip and matching digest cannot admit malformed UTF-8, JSON or snapshot shapes',async()=>{
 const invalidUtf8=Buffer.from([91,0xc3,0x28,93]);
 for(const raw of [invalidUtf8,Buffer.from('{broken'),Buffer.from('{}'),Buffer.from('[{"complete":true}]')])await assert.rejects(hydrateSnapshotState(envelopeFor(raw)),/Leituras armazenadas inválidas/);
});
test('Packing refuses incomplete snapshots and excessive counts rather than silently truncating',async()=>{
 for(const snapshots of [null,[{complete:true}],Array.from({length:snapshotStorageLimits.maxSnapshots+1},()=>({rows:[]})),[{rows:Array(snapshotStorageLimits.maxRowsPerSnapshot+1).fill({})}],Array.from({length:34},()=>({rows:Array(3000).fill({})}))])await assert.rejects(packSnapshotState({snapshots}),/Leituras armazenadas inválidas/);
});
test('Packing enforces the raw byte ceiling before attempting compression',async()=>{
 const state={snapshots:[{rows:[{name:'á'.repeat(Math.ceil(snapshotStorageLimits.maxRawBytes/2))}]}]};await assert.rejects(packSnapshotState(state),/tamanho das leituras acima do limite/);
});
