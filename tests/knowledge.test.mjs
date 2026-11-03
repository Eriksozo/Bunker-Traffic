import test from 'node:test';
import assert from 'node:assert/strict';
import {recordKnowledge,readKnowledgePlan,recordOutcome,retainKnowledgeMeasurements,knowledgeLimits} from '../lib/knowledge.mjs';
const now='2026-11-02T18:00:00.000Z';
const state=()=>({config:{john:{targetRoas:2},nico:{targetRoas:2.5}},decisions:[],knowledge:[],snapshots:[]});
const source=(reference='read-a',from='2026-10-29T00:00:00.000Z',to='2026-10-30T00:00:00.000Z')=>({system:'Malva MCP',reference,observedAt:'2026-11-02T17:00:00.000Z',from,to,summary:'Aquisição observada na leitura conferida.'});
const input=()=>({project:'john',topic:'Aquisição front',claim:'Compras front se repetiram em mais de uma janela.',confidence:0.6,sources:[source()],supportCases:[{objectId:'campaign-a',from:source().from,to:source().to,reference:'read-a'}]});

test('knowledge isolates configured projects and never writes controls or historical decisions',()=>{
 const s=state();s.decisions.push({id:'approved',project:'john',status:'Aprovada',after:1000});const decision=structuredClone(s.decisions),config=structuredClone(s.config);
 const entry=recordKnowledge(s,input(),now);assert.equal(entry.status,'Hipótese');assert.equal(entry.revision,1);assert.equal(readKnowledgePlan(s,'nico',now).items.length,0);assert.equal(readKnowledgePlan(s,'john',now).items.length,1);
 assert.deepEqual(s.decisions,decision);assert.deepEqual(s.config,config);
 assert.throws(()=>recordKnowledge(s,{...input(),project:'missing'},now),/não configurado/);
 assert.throws(()=>recordKnowledge(s,{...input(),project:'nico',id:entry.id,expectedRevision:1},now),/outro projeto/);
 assert.throws(()=>recordKnowledge(s,{...input(),targetRoas:0.5},now),/não podem alterar/);
 assert.throws(()=>readKnowledgePlan(s,'__proto__',now),/não configurado/);
});

test('corroboration needs two independent object/windows, not renamed duplicate references',()=>{
 const s=state(),one=input();assert.throws(()=>recordKnowledge(s,{...one,status:'Corroborado'},now),/dois casos independentes/);
 const duplicate={...one,sources:[source('read-a'),source('read-b')],supportCases:[...one.supportCases,{...one.supportCases[0],reference:'read-b'}],status:'Corroborado'};
 assert.throws(()=>recordKnowledge(s,duplicate,now),/dois casos independentes/);
 const overlap=source('overlap','2026-10-29T12:00:00.000Z','2026-10-30T12:00:00.000Z');
 assert.throws(()=>recordKnowledge(s,{...one,status:'Corroborado',sources:[source(),overlap],supportCases:[...one.supportCases,{objectId:'campaign-a',reference:'overlap',from:overlap.from,to:overlap.to}]},now),/dois casos independentes/);
 const second=source('next','2026-10-30T00:00:00.000Z','2026-10-31T00:00:00.000Z');
 const e=recordKnowledge(s,{...one,status:'Corroborado',sources:[source(),second],supportCases:[...one.supportCases,{objectId:'campaign-a',reference:'next',from:second.from,to:second.to}]},now);assert.equal(e.status,'Corroborado');assert.equal(e.supportCases.length,2);
});

test('updates append immutable revisions, reject stale writes, and expose stale evidence',()=>{
 const s=state(),e=recordKnowledge(s,input(),now),audit=structuredClone(e.revisions[0]);
 assert.throws(()=>recordKnowledge(s,{...input(),id:e.id,expectedRevision:0},now),/CONFLICT/);
 const updated=recordKnowledge(s,{...input(),id:e.id,expectedRevision:1,claim:'O novo resultado contradiz a observação.',status:'Invalidado'},now);
 assert.deepEqual(updated.revisions[0],audit);assert.equal(updated.revisions.length,2);assert.equal(updated.status,'Invalidado');
 const old=state(),data=input();data.sources=[{...source(),observedAt:'2026-09-01T00:00:00.000Z'}];recordKnowledge(old,data,now);const plan=readKnowledgePlan(old,'john',now);assert.equal(plan.staleCount,1);assert.equal(plan.items[0].stale,true);assert.ok(plan.items[0].flags.some(x=>x.includes('antiga')));assert.ok(!('revisions' in plan.items[0]));
 assert.throws(()=>recordKnowledge(s,{...input(),sources:[{...source(),observedAt:'2027-01-01T00:00:00.000Z'}]},now),/futuro/);
 assert.throws(()=>recordKnowledge(s,{...input(),sources:[]},now),/fontes rastreáveis/);
});

test('capacity rejects new facts without silent eviction but permits existing fact revisions',()=>{
 const s=state();for(let i=0;i<knowledgeLimits.entries;i++)recordKnowledge(s,{...input(),claim:`Observação número ${i}`},now);
 const first=s.knowledge[0];assert.throws(()=>recordKnowledge(s,input(),now),/120 aprendizados/);assert.equal(s.knowledge.length,120);assert.equal(s.knowledge[0].id,first.id);
 recordKnowledge(s,{...input(),id:first.id,expectedRevision:1,claim:'Revisão com novas evidências.'},now);assert.equal(s.knowledge.length,120);assert.equal(s.knowledge[0].revision,2);
});

function outcomeSetup(){
 const s=state(),beforeSource=source('before','2026-10-28T00:00:00.000Z','2026-10-29T00:00:00.000Z'),afterSource=source('after','2026-10-30T00:00:00.000Z','2026-10-31T00:00:00.000Z');
 for(const [src,spend,frontOrders] of [[beforeSource,400,2],[afterSource,500,4]])s.snapshots.push({projectId:'john',source:'Malva MCP',complete:true,level:'campaign',from:src.from,to:src.to,fetchedAt:src.observedAt,rows:[{externalId:'campaign-a',adAccountId:'account-john',spend,frontOrders}]});
 s.decisions.push({id:'decision-a',project:'john',objectId:'campaign-a',status:'Aplicada pelo operador',appliedAt:'2026-10-29T12:00:00.000Z'});
 return {s,data:{project:'john',objectId:'campaign-a',proposalId:'decision-a',before:{from:beforeSource.from,to:beforeSource.to,metrics:{spend:400,frontOrders:2}},after:{from:afterSource.from,to:afterSource.to,metrics:{spend:500,frontOrders:4}},sources:[beforeSource,afterSource],summary:'A aquisição aumentou na janela posterior; há outras variáveis em jogo.'}};
}

test('outcomes require stored verified measurements and approved execution; no causal inference',()=>{
 const {s,data}=outcomeSetup(),decisions=structuredClone(s.decisions);const outcome=recordOutcome(s,data,now);
 assert.equal(outcome.causality,'Não demonstrada');assert.equal(outcome.before.metrics.frontOrders,2);assert.equal(outcome.after.metrics.frontOrders,4);assert.deepEqual(s.decisions,decisions);
 assert.throws(()=>recordOutcome(s,data,now),/já registrado/);
 const rejected=outcomeSetup();rejected.s.decisions[0].status='Aprovada';assert.throws(()=>recordOutcome(rejected.s,rejected.data,now),/aplicação aprovada e conferida/);
 const forged=outcomeSetup();forged.data.after.metrics.frontOrders=9;assert.throws(()=>recordOutcome(forged.s,forged.data,now),/não conferem/);assert.equal(forged.s.knowledgeOutcomes,undefined);
 const wrong=outcomeSetup();wrong.data.project='nico';assert.throws(()=>recordOutcome(wrong.s,wrong.data,now),/neste projeto/);
 const incomplete=outcomeSetup();incomplete.s.snapshots[1].complete=false;assert.throws(()=>recordOutcome(incomplete.s,incomplete.data,now),/verificável/);
});

test('outcome association is optional; object/account/window ambiguities and unverifiable sources fail',()=>{
 const optional=outcomeSetup();delete optional.data.proposalId;assert.equal(recordOutcome(optional.s,optional.data,now).proposalId,null);
 const missing=outcomeSetup();missing.data.sources[1].observedAt='2026-11-02T16:00:00.000Z';assert.throws(()=>recordOutcome(missing.s,missing.data,now),/verificável/);
 const ambiguous=outcomeSetup();ambiguous.s.snapshots[0].rows.push({...ambiguous.s.snapshots[0].rows[0],adAccountId:'other-account'});assert.throws(()=>recordOutcome(ambiguous.s,ambiguous.data,now),/desambiguar/);
 const overlap=outcomeSetup();overlap.s.decisions[0].appliedAt='2026-10-28T12:00:00.000Z';assert.throws(()=>recordOutcome(overlap.s,overlap.data,now),/delimitam/);
 const accounts=outcomeSetup();accounts.s.snapshots[1].rows[0].adAccountId='another-account';assert.throws(()=>recordOutcome(accounts.s,accounts.data,now),/mesma conta/);
});

test('retained before/after survives snapshot replacement and accepts only confirmed new proposals',()=>{
 const {s,data}=outcomeSetup(),[before,after]=s.snapshots,confirmedAt=s.decisions[0].appliedAt;
 s.decisions=[];s.proposals=[{id:'new-proposal',project:'john',status:'Aprovada',payload:{objectId:'campaign-a',adAccountId:'account-john',level:'campaign'}}];data.proposalId='new-proposal';
 s.snapshots=[before];retainKnowledgeMeasurements(s,now);assert.equal(s.knowledgeMeasurements.length,1);
 const preserved=structuredClone(s.knowledgeMeasurements[0]);
 // Import replaces the source slot. The prior metrics are no longer in live snapshots.
 s.snapshots=[after];retainKnowledgeMeasurements(s,now);assert.equal(s.knowledgeMeasurements.length,2);assert.deepEqual(s.knowledgeMeasurements[0],preserved);
 assert.throws(()=>recordOutcome(s,data,now),/aplicação aprovada e conferida/);
 s.proposals[0].execution={status:'Enviada',confirmedAt};assert.throws(()=>recordOutcome(s,data,now),/aplicação aprovada e conferida/);
 s.proposals[0].execution={status:'Verificação necessária',confirmedAt};assert.throws(()=>recordOutcome(s,data,now),/aplicação aprovada e conferida/);
 s.proposals[0].execution={status:'Confirmada',confirmedAt};s.proposals[0].appliedAt=confirmedAt;s.proposals[0].executionConfirmedAt=confirmedAt;
 // Even the after can now leave the live buffer; both measurements remain verifiable.
 s.snapshots=[];const outcome=recordOutcome(s,data,now);assert.equal(outcome.before.metrics.spend,400);assert.equal(outcome.after.metrics.frontOrders,4);assert.equal(outcome.before.measurementId,preserved.id);
 const forged=structuredClone(data);forged.after.metrics.frontOrders=99;assert.throws(()=>recordOutcome(s,forged,now),/não conferem/);
 const rounded=structuredClone(data);rounded.after.metrics.spend+=1e-8;assert.throws(()=>recordOutcome(s,rounded,now),/não conferem/);
});

test('measurement retention is exact-once, closed-window, scoped, and restricted to approved targets',()=>{
 const {s}=outcomeSetup();s.decisions=[];s.proposals=[{id:'approved',project:'john',status:'Aprovada',payload:{objectId:'campaign-a',adAccountId:'account-john',level:'campaign'}}];
 s.snapshots.push({...s.snapshots[0],projectId:'nico'}, {...s.snapshots[0],complete:false}, {...s.snapshots[0],to:'2026-11-03T00:00:00.000Z'}, {...s.snapshots[0],rows:[{...s.snapshots[0].rows[0],externalId:'other-object'}]});
 retainKnowledgeMeasurements(s,now);assert.equal(s.knowledgeMeasurements.length,2);assert.ok(s.knowledgeMeasurements.every(m=>m.project==='john'&&m.externalId==='campaign-a'&&m.proposalIds.includes('approved')));
 const ids=s.knowledgeMeasurements.map(m=>m.id);retainKnowledgeMeasurements(s,now);assert.deepEqual(s.knowledgeMeasurements.map(m=>m.id),ids);
 const original=structuredClone(s.knowledgeMeasurements);s.snapshots[0].rows[0].spend=999;assert.throws(()=>retainKnowledgeMeasurements(s,now),/diverge/);assert.deepEqual(s.knowledgeMeasurements,original);
 const pending=outcomeSetup();pending.s.decisions[0].status='Proposta';retainKnowledgeMeasurements(pending.s,now);assert.equal(pending.s.knowledgeMeasurements.length,0);
});

test('measurement capacity refuses new readings without evicting existing action evidence',()=>{
 const s=state();s.proposals=[{id:'approved',project:'john',status:'Aprovada',payload:{objectId:'one',adAccountId:'account',level:'campaign'}}];
 const day=86400000,start=Date.parse('2020-01-01T00:00:00.000Z');
 for(let i=0;i<knowledgeLimits.measurements;i++)s.snapshots.push({projectId:'john',source:'Malva MCP',complete:true,level:'campaign',from:new Date(start+i*day).toISOString(),to:new Date(start+(i+1)*day).toISOString(),fetchedAt:now,rows:[{externalId:'one',adAccountId:'account',spend:i}]});
 retainKnowledgeMeasurements(s,now);assert.equal(s.knowledgeMeasurements.length,1200);const first=structuredClone(s.knowledgeMeasurements[0]);
 s.snapshots.push({...s.snapshots[0],from:'2025-01-01T00:00:00.000Z',to:'2025-01-02T00:00:00.000Z'});assert.throws(()=>retainKnowledgeMeasurements(s,now),/1200 medições/);assert.equal(s.knowledgeMeasurements.length,1200);assert.deepEqual(s.knowledgeMeasurements[0],first);
});

test('External history retains only a closed daily cut on each side, never action-day or hourly clones',()=>{
 const observed={id:'external-observed',project:'p',objectId:'c',adAccountId:'a',occurredAt:'2026-11-01T16:00:00.000Z',sourceSystem:'Malva MCP',humanObserved:true,field:'dailyBudget'};
 const make=(from,to,fetchedAt)=>({projectId:'p',period:'yesterday',level:'campaign',complete:true,source:'Malva MCP',from,to,fetchedAt,timezone:'America/Sao_Paulo',rows:[{externalId:'c',adAccountId:'a',spend:100,revenueNet:200,adCosts:4,frontOrders:2}]});
 const s={config:{p:{projectName:'P'}},decisionHistory:[observed],snapshots:[make('2026-11-01T03:00:00.000Z','2026-11-02T03:00:00.000Z','2026-11-03T12:00:00.000Z')]};
 retainKnowledgeMeasurements(s,'2026-11-03T15:00:00.000Z');assert.equal(s.knowledgeMeasurements.length,0);
 s.snapshots=[make('2026-10-31T03:00:00.000Z','2026-11-01T03:00:00.000Z','2026-11-03T12:00:00.000Z'),make('2026-11-02T03:00:00.000Z','2026-11-03T03:00:00.000Z','2026-11-03T12:00:00.000Z')];
 retainKnowledgeMeasurements(s,'2026-11-03T15:00:00.000Z');assert.equal(s.knowledgeMeasurements.length,2);
 s.snapshots=s.snapshots.map(x=>({...x,fetchedAt:'2026-11-03T13:00:00.000Z'}));retainKnowledgeMeasurements(s,'2026-11-03T15:00:00.000Z');assert.equal(s.knowledgeMeasurements.length,2);
});
