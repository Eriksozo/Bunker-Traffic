import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {collectionFailure,failureCause,persistSteps,runtimeFailure} from '../lib/cloud-failure-diagnostics.mjs';
import {validateAnalysisBundle} from '../lib/analysis-validation.mjs';
import {updateRun} from '../lib/agent-state.ts';

// Curadoria of 14/11/2026: a plain Error in the persist phase became CLOUD_COLLECTION_FAILED with nothing else. The
// diagnostic now names the safe sub-step and a static cause; it never carries the message, a value, a name or a key.
// Synthetic data only; no provider is called.
const SECRET='mck_LEAKED_TOKEN_123 sb_secret_abcdef eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload Campanha Secreta R$ 9.876,54 act_998877';
const leaks=value=>/mck_|sb_secret_|eyJhbGci|Campanha Secreta|9\.876|998877/.test(JSON.stringify(value));
const iso=n=>new Date(n).toISOString(),at=Date.parse('2026-11-14T15:00:00Z');

test('failureCause: each local message the Bunker throws maps to a static cause, the message never travels',()=>{
 const cases=[
  ['Leitura anterior à base salva. Consulte novamente o Malva.','base-older'],
  ['A mesma data de consulta possui conteúdo diferente.','base-same-time-different'],
  ['Data de consulta ou sincronização no futuro.','clock-future'],
  ['Conferência da campanha indisponível fora da coleta.','unavailable-check-time'],
  ['Campanha indisponível sem identidade previamente acompanhada.','unavailable-identity'],
  ['Janela duplicada no mesmo lote de análise.','duplicate-window'],
  ['Escopo operacional exige o lote analítico independente com quatro períodos e três níveis.','scope-incomplete'],
  ['As janelas fechadas não terminam no início do dia atual.','financial-period'],
  ['Rodada incompleta: faltam quatro leituras completas posteriores ao início.','conclude-readings-before-start'],
  ['Reserva expirada: solicite uma nova rodada.','conclude-lease-expired'],
  ['Rodada substituída: outra reserva controla este projeto.','conclude-replaced'],
  ['Leituras armazenadas inválidas: tamanho compactado acima do limite.','snapshot-codec','encoded-limit'],
  ['Leituras armazenadas inválidas: tamanho das leituras acima do limite.','snapshot-codec','raw-limit'],
  ['Leituras armazenadas inválidas: quantidade de linhas.','snapshot-codec','row-count'],
  ['Limite de armazenamento da central atingido. Nenhum dado foi descartado.','storage-limit','central'],
  ['Limite de 1200 medições atingido; nenhuma evidência necessária foi descartada. Exporte o arquivo antes de continuar.','knowledge-measurement-limit'],
  ['Limite de medições do projeto atingido; nenhuma evidência necessária foi descartada. Exporte o arquivo antes de continuar.','knowledge-measurement-limit'],
  ['Medição já preservada diverge da mesma leitura; não substituir evidência.','knowledge-measurement-diverges'],
 ];
 // The CAS loss is exactly "CONFLICT" (lib/persistence.mjs).
 assert.equal(failureCause(Error('CONFLICT')).cause,'revision-conflict');
 for(const [message,cause,detail] of cases){
  const out=failureCause(Error(message+' '+SECRET));
  assert.equal(out.cause,cause,message);assert.equal(out.causeDetail,detail,message);assert.equal(out.errorKind,'Error');
  assert.equal(leaks(out),false,message);
 }
 // Unknown text (with a secret) stays unclassified; the error kind comes from a fixed list.
 assert.deepEqual(failureCause(new TypeError(SECRET)),{cause:'unclassified',errorKind:'TypeError'});
 assert.deepEqual(failureCause(new RangeError('Invalid string length')),{cause:'unclassified',errorKind:'RangeError'});
 const odd=Error(SECRET);odd.name=SECRET;assert.deepEqual(failureCause(odd),{cause:'unclassified',errorKind:'other'});
 assert.deepEqual(failureCause(SECRET),{cause:'unclassified',errorKind:'non-error'});
 assert.deepEqual(failureCause(Object.assign(Error(SECRET),{code:'STORAGE_INTEGRITY'})),{cause:'coded',errorKind:'Error'});
 // collectionFailure keeps only allowlisted steps.
 assert.equal(collectionFailure(Error('x'),{project:'p',jobId:'j',phase:'persist',step:'import'},at).step,'import');
 assert.equal('step' in collectionFailure(Error('x'),{project:'p',jobId:'j',phase:'persist',step:SECRET},at),false);
 assert.deepEqual(persistSteps,['read','reservation','priority','history','import','learning','research','conclude','commit']);
});

test('the real validators feed recognized causes (no message drift): base older, future sync, conclusion before start',()=>{
 const snap=(fetchedAt,lastSyncAt=null)=>({projectId:'p',projectName:'P',period:'today',level:'campaign',source:'Malva MCP',complete:true,timezone:'UTC',from:'2026-11-14T00:00:00Z',to:'2026-11-15T00:00:00Z',fetchedAt,lastSyncAt,rows:[]});
 const thrown=fn=>{try{fn();}catch(e){return e;}assert.fail('expected a throw');};
 assert.equal(failureCause(thrown(()=>validateAnalysisBundle({snapshots:[snap(iso(at-60000))]},{snapshots:[snap(iso(at))]},at))).cause,'base-older');
 assert.equal(failureCause(thrown(()=>validateAnalysisBundle({snapshots:[snap(iso(at-60000),iso(at))]},{snapshots:[]},at))).cause,'clock-future');
 const s={config:{p:{projectName:'P'}},paused:false,agents:{p:{jobId:'j'}},jobs:[{id:'j',project:'p',status:'Em análise',startedAt:new Date().toISOString()}],snapshots:[],reports:[]};
 assert.equal(failureCause(thrown(()=>updateRun(s,s.jobs[0],'Concluída','x'))).cause,'conclude-readings-before-start');
});

/** The real engine, one collection, with the persist write failing at a chosen sub-step. */
async function persistFailure(mode){
 const project='11111111-1111-4111-8111-111111111111';
 let state={config:{[project]:{projectName:'Example'}},paused:false,cadence:{enabled:false},jobs:[{id:'reserved',project,executor:'cloudflare',status:'Em análise',startedAt:iso(at-1000)}],agents:{[project]:{jobId:'reserved'}},snapshots:[],collaborationRounds:[],proposals:[],executions:[],reports:[]};
 const initialSnapshots=structuredClone(state.snapshots);let writes=0;
 const source={read:async(tool,a)=>{
  if(tool==='workspace_whoami')return {workspace:{id:'w'},platforms:[{platform:'tracking',read:true}]};
  if(tool==='tracking_list_projects')return {items:[{id:project,name:'Example',timezone:'UTC',currency:'BRL'}]};
  if(tool==='tracking_ad_accounts')return {items:[]};
  if(tool==='tracking_campaigns')return {level:a.level,salesScope:{kind:'traffic'},currency:'BRL',freshAt:iso(at),lastSyncAt:null,period:{timezone:'UTC',from:a.from+'T00:00:00.000Z',to:iso(Date.parse(a.to+'T00:00:00Z')+86400000),days:a.from===a.to?[a.from]:[a.from,a.to]},rows:[]};
  throw Error('Unexpected source');
 }};
 const ops={
  importBundle:()=>{if(mode==='import')throw Error('Leitura anterior à base salva. Consulte novamente o Malva. '+SECRET);},
  updateRun:(_s,j,status,note)=>{if(status==='Concluída'&&mode==='conclude')throw Error('Rodada incompleta: faltam quatro leituras completas posteriores ao início. '+SECRET);if(status==='Concluída'&&mode==='unknown')throw new TypeError("Cannot read properties of undefined (reading '"+SECRET+"')");j.status=status;j.note=note;},
 };
 const engine=createCloudEngine({read:async()=>({state:structuredClone(state),revision:1}),
  write:async fn=>{writes++;if(writes===1&&mode==='read')throw Error('Leituras armazenadas inválidas: integridade do conteúdo. '+SECRET);const draft=structuredClone(state),out=await fn(draft,1);
   // The storage commit runs after the callback (worker/cloud-executor.ts write → commitPersistedState).
   if(writes===1&&mode==='commit')throw Error('Leituras armazenadas inválidas: tamanho compactado acima do limite. '+SECRET);state=draft;return out;},
  source,ops,now:()=>at});
 let error;try{await engine.step();}catch(e){error=e;}
 return {error,state,initialSnapshots};
}

test('engine: a persist failure names the sub-step and cause, keeps old data, and leaks nothing',async()=>{
 const expected={read:['read','snapshot-codec','other'],import:['import','base-older',undefined],conclude:['conclude','conclude-readings-before-start',undefined],commit:['commit','snapshot-codec','encoded-limit'],unknown:['conclude','unclassified',undefined]};
 for(const [mode,[step,cause,detail]] of Object.entries(expected)){
  const {error,state,initialSnapshots}=await persistFailure(mode);
  assert.equal(error?.code,'CLOUD_COLLECTION_FAILED',mode);
  const d=error.collectionFailure;
  assert.equal(d.phase,'persist',mode);assert.equal(d.step,step,mode);assert.equal(d.cause,cause,mode);assert.equal(d.causeDetail,detail,mode);
  assert.equal(d.errorKind,mode==='unknown'?'TypeError':'Error',mode);
  assert.deepEqual(state.snapshots,initialSnapshots,mode+': no partial write');
  assert.equal(state.jobs[0].status,'Falhou',mode);
  assert.match(state.jobs[0].note,new RegExp('etapa persist · subetapa '+step+' · causa '+cause),mode);
  assert.equal(state.cloudCollectionFailures.at(-1).step,step,mode);
  // Nothing from the original message reaches the journal, the job note, the thrown error or the runtime status.
  for(const v of [state.cloudCollectionFailures,state.jobs[0].note,error.message,d,runtimeFailure({},error,at)])assert.equal(leaks(v),false,mode);
 }
});
