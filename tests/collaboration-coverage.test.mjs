import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureCollaboration,claimCollaboration,postCollaboration,compactCollaboration,collaborationLimits} from '../lib/collaboration.mjs';
import {buildDecisionCards,recordCardSuggestion,decisionCardLimits} from '../lib/decision-cards.mjs';

const at=Date.parse('2026-11-03T10:20:00Z');
function fixture(){
 const rows=Array.from({length:26},(_,i)=>({id:'internal-'+i,externalId:'campaign-'+i,adAccountId:'account-1',provider:'Meta',name:'Campanha '+i,accountName:'Conta',budgetCurrency:'BRL',dailyBudget:300,status:'ACTIVE',spend:100,frontOrders:2}));
 const job={id:'job',project:'project',status:'Concluída',startedAt:new Date(at-10000).toISOString(),completedAt:new Date(at-1000).toISOString()};
 const state={paused:false,config:{project:{projectName:'Projeto',targetRoas:2}},jobs:[job],agents:{project:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:'project',period,level:'campaign',source:'Malva MCP',complete:true,from:'2026-11-03T03:00:00Z',to:'2026-11-04T03:00:00Z',timezone:'America/Sao_Paulo',fetchedAt:new Date(at-2000).toISOString(),rows:structuredClone(rows)}))};
 const refs=rows.map(row=>({period:'today',level:'campaign',adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:state.snapshots[3].fetchedAt}));
 return {state,job,refs,round:ensureCollaboration(state,job,at)};
}
function args(f,role,refs=f.refs){
 const claim=claimCollaboration(f.state,{roundId:f.round.id,agentId:role,executionRef:'worker-'+role,clientId:'claim-'+role},at);
 return {roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'conclude-'+role,toAgent:role==='traffic'?'creative':role==='creative'?'budget':'ops',kind:'conclusion',text:'Revisão das campanhas listadas nas fontes completas.',evidenceRefs:refs};
}
test('all campaigns beyond the former twenty-reference limit receive three real opinions',()=>{
 const f=fixture();
 for(const role of ['traffic','creative','budget'])postCollaboration(f.state,args(f,role),at+1);
 const cards=buildDecisionCards(f.state,'project',at+2);
 assert.equal(cards.length,26);assert.ok(cards.every(card=>card.teamReady&&card.teamOpinions.length===3));
});
test('larger coverage still rejects an unknown campaign and duplicate evidence atomically',()=>{
 for(const refs of [f=>[...f.refs,{...f.refs[0],externalId:'absent'}],f=>[...f.refs,f.refs[0]]]){
  const f=fixture();assert.throws(()=>postCollaboration(f.state,args(f,'traffic',refs(f)),at+1));assert.equal(f.state.collaborationMessages.length,0);
 }
 const f=fixture();assert.throws(()=>postCollaboration(f.state,args(f,'traffic',Array(collaborationLimits.evidenceRefs+1).fill(f.refs[0])),at+1),/referências/);
 assert.equal(f.state.collaborationMessages.length,0);
});
test('a bulk OPS rereview updates every scoped card once and rolls back the whole batch on an invalid item',()=>{
 const f=fixture();for(const role of ['traffic','creative','budget'])postCollaboration(f.state,args(f,role),at+1);
 const claim=claimCollaboration(f.state,{roundId:f.round.id,agentId:'ops',executionRef:'worker-ops',clientId:'claim-ops'},at+2);
 const items=f.refs.map(ref=>({objectId:ref.externalId,adAccountId:ref.adAccountId,action:'keep',reason:'Acompanhar a aquisição atual antes de outro ajuste.',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}));
 const request={roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'batch-ops',payload:{items}};
 const invalid={...request,payload:{items:[items[0],{...items[1],objectId:'foreign'}]}};
 assert.throws(()=>recordCardSuggestion(f.state,invalid,at+3),/três pareceres/);assert.equal(f.state.cardSuggestions,undefined);
 assert.throws(()=>recordCardSuggestion(f.state,{...request,payload:{items:[items[0],items[0]]}},at+3),/repetida/);
 const first=recordCardSuggestion(f.state,request,at+3);assert.equal(first.count,26);assert.equal(f.state.cardSuggestions.length,26);
 const replay=recordCardSuggestion(f.state,request,at+4);assert.deepEqual(replay.records.map(r=>r.id),first.records.map(r=>r.id));assert.equal(f.state.cardSuggestions.length,26);
 for(const changed of [items.slice(0,1),[...items,{...items[0],objectId:'added'}],[items[1],items[0],...items.slice(2)]])assert.throws(()=>recordCardSuggestion(f.state,{...request,payload:{items:changed}},at+4),/outro lote/);
 assert.throws(()=>recordCardSuggestion(f.state,{...request,clientId:undefined},at+4),/clientId/);
 assert.equal(f.state.cardSuggestions.length,26);
 assert.ok(buildDecisionCards(f.state,'project',at+4).every(card=>card.suggestion.origin==='team'&&card.teamReady));
 assert.equal(f.state.ownerChoices,undefined);assert.equal(f.state.executions,undefined);assert.deepEqual(f.state.proposals,[]);
});

test('new batch transport IDs reuse exact suggestions without overwriting either batch receipt',()=>{
 const f=fixture();for(const role of ['traffic','creative','budget'])postCollaboration(f.state,args(f,role),at+1);
 const claim=claimCollaboration(f.state,{roundId:f.round.id,agentId:'ops',executionRef:'worker-ops',clientId:'claim-ops'},at+2);
 const items=f.refs.map(ref=>({objectId:ref.externalId,adAccountId:ref.adAccountId,action:'keep',reason:'Acompanhar antes de outro ajuste.',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)}));
 const request={roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'first-batch',payload:{items}},first=recordCardSuggestion(f.state,request,at+3),receipt=structuredClone(first.records[0].batchReceipt);
 const duplicate={...request,clientId:'second-batch'},second=recordCardSuggestion(f.state,duplicate,at+4);
 assert.deepEqual(second.records.map(r=>r.id),first.records.map(r=>r.id));assert.equal(f.state.cardSuggestions.length,26);
 assert.deepEqual(f.state.cardSuggestions[0].batchReceipt,receipt);assert.equal(f.state.cardSuggestions[0].batchReceipts[0].clientId,'second-batch');
 assert.equal(f.state.cardSuggestions[0].requestAliases[0].clientId,'second-batch:0');
 for(const req of [request,duplicate])assert.deepEqual(recordCardSuggestion(f.state,req,at+5).records.map(r=>r.id),first.records.map(r=>r.id));
 const before=structuredClone(f.state);assert.throws(()=>recordCardSuggestion(f.state,{...duplicate,payload:{items:items.slice(1)}},at+6),/outro lote/);assert.deepEqual(f.state,before);
 assert.throws(()=>recordCardSuggestion(f.state,{...request,clientId:'bad-reused-batch',payload:{items:[items[0],{...items[1],objectId:'missing'}]}},at+6),/três pareceres/);assert.deepEqual(f.state,before);
 postCollaboration(f.state,{roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'ops-finished',toAgent:'traffic',kind:'conclusion',text:'Sugestões registradas sem executar.',evidenceRefs:f.refs},at+7);
 const originalRecords=structuredClone(f.state.cardSuggestions);
 for(let i=1;i<=3;i++)f.state.collaborationRounds.unshift({...structuredClone(f.round),id:'newer-'+i,jobId:'settled-'+i,createdAt:new Date(at+i*1000).toISOString()});
 const archived=compactCollaboration(f.state,at+5000).archives.find(a=>a.payload.round.id===f.round.id);
 assert.deepEqual(archived.payload.cardSuggestions,originalRecords);assert.deepEqual(f.state.cardSuggestions,[]);
 const compacted=structuredClone(f.state);for(const req of [request,duplicate])assert.throws(()=>recordCardSuggestion(f.state,req,at+5001),/não está disponível/);assert.deepEqual(f.state,compacted);
});

test('Batch replay receipts remain bounded without creating suggestions or overwriting existing receipts',()=>{
 const f=fixture();for(const role of ['traffic','creative','budget'])postCollaboration(f.state,args(f,role),at+1);
 const claim=claimCollaboration(f.state,{roundId:f.round.id,agentId:'ops',executionRef:'worker-ops',clientId:'claim-ops'},at+2),payload={objectId:f.refs[0].externalId,adAccountId:f.refs[0].adAccountId,action:'keep',reason:'Acompanhar antes de ajustar.',opinionRefs:f.round.stages.slice(0,3).map(s=>s.conclusionId)},request={roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'batch-0',payload:{items:[payload]}};
 const first=recordCardSuggestion(f.state,request,at+3);
 for(let i=1;i<decisionCardLimits.suggestionBatchReceipts;i++)assert.equal(recordCardSuggestion(f.state,{...request,clientId:'batch-'+i},at+3+i).records[0].id,first.records[0].id);
 const before=structuredClone(f.state);assert.equal(f.state.cardSuggestions.length,1);assert.equal(f.state.cardSuggestions[0].batchReceipts.length,decisionCardLimits.suggestionBatchReceipts-1);
 assert.throws(()=>recordCardSuggestion(f.state,{...request,clientId:'batch-overflow'},at+30),/recibos de lote/);assert.deepEqual(f.state,before);
 assert.equal(recordCardSuggestion(f.state,request,at+31).records[0].id,first.records[0].id);assert.deepEqual(f.state,before);
 const alias={roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'batch-1:0',payload};
 assert.throws(()=>recordCardSuggestion(f.state,{...alias,payload:{...payload,reason:'Changed batch item'}},at+31),/clientId/);assert.deepEqual(f.state,before);
});
