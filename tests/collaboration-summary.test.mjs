import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgentSummary} from '../lib/agent-summary.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';
import {autonomyTools} from '../lib/autonomy-tools.ts';

const now=Date.parse('2026-11-02T16:10:00.000Z'),iso=n=>new Date(n).toISOString();
const short={decision:'Revisar o conjunto sem vendas.',reason:'A perda está concentrada nessa instância.',nextStep:'Conferir a proposta exata antes de aprovar.'};
function fixture(){
 const row={externalId:'campaign-a',adAccountId:'account-a',name:'Campanha de vendas',provider:'Meta'};
 const job={id:'collection-a',project:'project-a',status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-1000)};
 const state={paused:false,config:{'project-a':{projectName:'Projeto A'}},jobs:[job],agents:{'project-a':{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:'project-a',period,level:'campaign',complete:true,from:'2026-10-26',to:'2026-11-03',timezone:'America/Boa_Vista',source:'Malva MCP',fetchedAt:iso(now-2000),lastSyncAt:null,rows:[structuredClone(row)]}))};
 const round=ensureCollaboration(state,job,now),claim=claimCollaboration(state,{roundId:round.id,agentId:'traffic',executionRef:'real-traffic-worker',clientId:'claim-traffic'},now);
 const args={roundId:round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'traffic-conclusion',toAgent:'creative',kind:'conclusion',text:'Parecer original.\n\nFonte: /private/tmp/source.json\nIDs e métricas permanecem no registro técnico.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:iso(now-2000)}]};
 return {state,round,args};
}

// Legacy stored requests use this pre-summary integrity format. It is not an approval.
function legacyFingerprint(args){
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
 const s=canonical({claimId:args.claimId,executionRef:args.executionRef,toAgent:args.toAgent,kind:args.kind||'message',text:args.text,evidenceRefs:args.evidenceRefs,replyTo:args.replyTo||null,...(args.requiresReply===undefined?{}:{requiresReply:args.requiresReply})});
 let a=2166136261,b=3335557771;
 for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),2246822519);}
 return 'v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}

test('Optional summaries normalize only the three bounded non-empty display fields',()=>{
 assert.equal(normalizeAgentSummary(undefined),null);
 const input={decision:' d ',reason:' r ',nextStep:' n '},before=structuredClone(input);
 assert.deepEqual(normalizeAgentSummary(input),{decision:'d',reason:'r',nextStep:'n'});
 assert.deepEqual(input,before);
 const atLimit={decision:'d'.repeat(240),reason:'r'.repeat(480),nextStep:'n'.repeat(240)};
 assert.deepEqual(normalizeAgentSummary(atLimit),atLimit);
});

test('Malformed summaries and unexpected keys are rejected instead of becoming optional',()=>{
 const invalid=[null,[],[short],'summary',1,true,{},new Date(),{...short,extra:'unexpected'},Object.create(short)];
 for(const key of ['decision','reason','nextStep']){
  const missing={...short};delete missing[key];invalid.push(missing);
  for(const value of ['', '   ',null,1,[],{}])invalid.push({...short,[key]:value});
  invalid.push({...short,[key]:'x'.repeat(key==='reason'?481:241)});
 }
 const symbol={...short};symbol[Symbol('extra')]='hidden';invalid.push(symbol);
 for(const value of invalid)assert.throws(()=>normalizeAgentSummary(value),/Resumo/);
});

test('A real authored conclusion stores a short summary without rewriting its raw report or granting authority',()=>{
 const {state,round,args}=fixture(),request={...args,summary:{...short}};
 const result=postCollaboration(state,request,now+1);
 assert.equal(result.text,args.text);assert.deepEqual(result.summary,short);assert.deepEqual(result.evidenceRefs,args.evidenceRefs);
 assert.equal(result.fromAgent,'traffic');assert.equal(round.stages[0].status,'Concluída');
 assert.equal(state.proposals.length,0);assert.equal(state.executions,undefined);
 request.summary.reason='Client mutation after sending';assert.equal(result.summary.reason,short.reason);
});

test('Legacy messages keep their exact old fingerprint and remain replayable without a summary',()=>{
 const {state,args}=fixture(),result=postCollaboration(state,args,now+1),saved=structuredClone(result);
 assert.equal(result.requestFingerprint,legacyFingerprint(args));assert.equal(Object.hasOwn(result,'summary'),false);
 assert.equal(postCollaboration(state,{...args,summary:undefined},now+10000000).id,result.id);
 assert.deepEqual(state.collaborationMessages,[saved]);
 assert.throws(()=>postCollaboration(state,{...args,summary:short},now+2),/clientId/);
 assert.deepEqual(state.collaborationMessages,[saved]);
});

test('Replays preserve summary and text; changing or removing a summary cannot reuse its clientId',()=>{
 const {state,args}=fixture(),request={...args,summary:{...short}},result=postCollaboration(state,request,now+1),saved=structuredClone(result);
 assert.equal(postCollaboration(state,request,now+10000000).id,result.id);
 for(const key of ['decision','reason','nextStep'])assert.throws(()=>postCollaboration(state,{...request,summary:{...short,[key]:'Different summary'}},now+2),/clientId/);
 assert.throws(()=>postCollaboration(state,args,now+2),/clientId/);
 assert.throws(()=>postCollaboration(state,{...request,text:'Different raw report'},now+2),/clientId/);
 assert.deepEqual(state.collaborationMessages,[saved]);
});

test('Invalid summaries cannot finish a stage, append a message or partially mutate state',()=>{
 const {state,args}=fixture(),before=structuredClone(state);
 for(const summary of [null,[],{...short,decision:' '},{...short,reason:'r'.repeat(481)},{...short,approval:true}]){
  assert.throws(()=>postCollaboration(state,{...args,summary},now+1),/Resumo/);
  assert.deepEqual(state,before);
 }
 const wrongLease={...args,claimId:'invented',summary:short};assert.throws(()=>postCollaboration(state,wrongLease,now+1),/Reserva/);assert.deepEqual(state,before);
});

test('MCP advertises an optional strict summary with the same field limits and meaningful non-whitespace pattern',()=>{
 const input=autonomyTools.find(t=>t.name==='bunker_colaboracao').inputSchema,schema=input.properties.summary;
 assert.equal(input.required.includes('summary'),false);assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.required,['decision','reason','nextStep']);assert.deepEqual(Object.keys(schema.properties),schema.required);
 for(const [key,max] of [['decision',240],['reason',480],['nextStep',240]]){
  const field=schema.properties[key];assert.equal(field.maxLength,max);assert.equal(field.minLength,1);
  assert.equal(new RegExp(field.pattern).test('   '),false);assert.equal(new RegExp(field.pattern).test('a'),true);
 }
});
