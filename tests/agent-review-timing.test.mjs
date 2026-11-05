import test from 'node:test';
import assert from 'node:assert/strict';
import {agentReviewTiming} from '../lib/agent-review-timing.mjs';
import {cloudAnalysisContext,runCloudAnalyst} from '../lib/cloud-analysis.mjs';
import {agentReportView} from '../lib/agent-report-view.mjs';
const now=Date.parse('2026-11-05T15:01:00Z'),base={enabled:true,intervalMinutes:15,start:'06:00',end:'20:00',weekdays:[0,1,2,3,4,5,6],timezone:'America/Sao_Paulo'};
test('Saved review cadence reaches the model without becoming a new schedule, minimum test age or delivery promise',()=>{
 const state={config:{p:{projectName:'John',testHours:24}},cadence:{...base},snapshots:[],jobs:[],paused:false},before=structuredClone(state),c=cloudAnalysisContext(state,{id:'round',project:'p'},[],'traffic',now);
 assert.equal(c.reviewTiming.intervalMinutes,15);assert.equal(c.reviewTiming.observedAt,new Date(now).toISOString());assert.equal(c.reviewTiming.nextScheduledWindowAt,'2026-11-05T15:15:00.000Z');assert.equal(c.config.testHours,24);assert.match(c.reviewTiming.label,/15 min/);assert.match(c.reviewTiming.label,/São Paulo/);assert.deepEqual(state,before);assert.equal(c.reviewTiming.autoExecute,undefined);
});
test('Custom minutes, hours, selected weekdays and each saved timezone retain their exact scheduling meaning',()=>{
 for(const intervalMinutes of [5,15,90,120]){const s={cadence:{...base,intervalMinutes,weekdays:[4]}},t=agentReviewTiming(s,now);assert.equal(t.intervalMinutes,intervalMinutes);assert.deepEqual(t.weekdays,[4]);assert.ok(t.nextScheduledWindowAt);}
 const at=Date.parse('2026-11-05T10:01:00Z'),a=agentReviewTiming({cadence:{...base,start:'08:00',timezone:'America/Boa_Vista'}},at),b=agentReviewTiming({cadence:{...base,start:'08:00'}},at);assert.equal(a.nextScheduledWindowAt,'2026-11-05T12:00:00.000Z');assert.equal(b.nextScheduledWindowAt,'2026-11-05T11:00:00.000Z');
 const weekend=agentReviewTiming({cadence:{...base,weekdays:[1]}},now);assert.equal(weekend.nextScheduledWindowAt,'2026-11-09T09:00:00.000Z');
});
test('Pause, disabled automatic work, invalid controls and inherited defaults never imply active or immediate reviews',()=>{
 for(const state of [{cadence:base,paused:true},{cadence:{...base,enabled:false}}]){const t=agentReviewTiming(state,now);assert.equal(t.nextScheduledWindowAt,null);assert.notEqual(t.mode,'scheduled');}
 for(const patch of [{intervalMinutes:7},{start:'06:07'},{weekdays:[]},{timezone:'Wrong/Zone'}]){const t=agentReviewTiming({cadence:{...base,...patch}},now);assert.equal(t.available,false);assert.equal(t.intervalMinutes,null);assert.equal(t.nextScheduledWindowAt,null);}
 assert.equal(agentReviewTiming({},NaN).available,false);const inherited=agentReviewTiming({},now);assert.equal(inherited.source,'default');assert.match(inherited.label,/padrão/);
});
test('Rendered report metadata follows current controls while preserving the authored historical text verbatim',()=>{
 const state={cadence:{...base},snapshots:[]},message={project:'p',summary:{decision:'Observar',reason:'Conferir aquisição.',nextStep:'Reavaliar em sete dias.'}},before=structuredClone(message);
 const a=agentReportView(state,message,[],now);assert.equal(a.summary.nextStep,message.summary.nextStep);assert.equal(a.reviewTiming.intervalMinutes,15);
 state.cadence.intervalMinutes=5;state.paused=true;const b=agentReportView(state,message,[],now);assert.equal(b.reviewTiming.mode,'paused');assert.equal(b.reviewTiming.nextScheduledWindowAt,null);assert.deepEqual(message,before);assert.equal(state.jobs,undefined);assert.equal(b.canApprove,undefined);
});
test('An actual model request receives review timing separately from history and must describe evidence rather than inventing a new schedule',async()=>{
 const state={config:{p:{projectName:'Example'}},snapshots:[],jobs:[],cadence:{...base}},context=cloudAnalysisContext(state,{id:'r',project:'p'},[],'traffic',now);let req;
 await runCloudAnalyst({run:async(_m,r)=>{req=r;return {response:{decision:'Investigar',reason:'Sem dados de aquisição.',nextStep:'Conferir novas compras na próxima rodada elegível.',text:'O prazo de maturação não altera a agenda.',suggestions:[],question:null,reflection:{lesson:'Conferir a aquisição.',uncertainty:'Sem números atuais.',nextCheck:'Conferir novas compras.',citations:[],peerChecks:[]}}};}},'traffic',context);
 const delivered=JSON.parse(req.messages[1].content).context;assert.equal(delivered.reviewTiming.intervalMinutes,15);assert.match(req.messages[0].content,/não confundir análise histórica de 7 dias/i);assert.match(req.messages[0].content,/não suspende a checagem/i);assert.deepEqual(state.cadence,base);
});
