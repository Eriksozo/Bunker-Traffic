import test from 'node:test';
import assert from 'node:assert/strict';
import {learningCyclePlan,recordLearningReview} from '../lib/learning-cycle.mjs';
import {recordKnowledge,recordOutcome} from '../lib/knowledge.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';
import {recordDecisionHistoryOutcome} from '../lib/decision-history-outcomes.mjs';
const now=Date.parse('2026-11-03T20:00:00Z'),iso=n=>new Date(n).toISOString();
function fixture(n=5){
 const s={config:{p:{projectName:'John',targetRoas:2},q:{projectName:'Nico'}},snapshots:[],decisions:[],jobs:[],events:[],ownerChoices:[],knowledge:[]};
 const registered='2026-10-20T00:00:00.000Z';
 const k=recordKnowledge(s,{project:'p',topic:'Reavaliar aquisição e exposição',claim:'Hipótese contextual em teste, não regra de orçamento.',confidence:0.8,sources:[{system:'Malva MCP',reference:'initial',observedAt:registered,summary:'Contexto observado.'}]},registered);
 for(let i=0;i<n;i++)add(s,k,i);
 return {s,k};
}
function add(s,k,i,{name='Escala',objectId='c'+i,adAccountId='a'+i,adverse=false,proposal=true}={}){
 const day=Date.parse('2026-10-23T00:00:00Z')+Math.floor(i/2)*86400000,beforeFrom=iso(day),beforeTo=iso(day+86400000),afterFrom=iso(day+2*86400000),afterTo=iso(day+3*86400000),appliedAt=iso(day+36*3600000);
 const b={spend:100,revenueNet:150,adCosts:0,productCost:0,saleTax:0,frontOrders:2,orders:2,checkouts:6,impressions:1000,linkClicks:20},a={...b,revenueNet:adverse?50:220,frontOrders:adverse?1:3};
 const sources=[];
 for(const [key,from,to,metrics] of [['before',beforeFrom,beforeTo,b],['after',afterFrom,afterTo,a]]){
  const fetchedAt=iso(now-1000),row={externalId:objectId,adAccountId,provider:'Meta',budgetCurrency:'BRL',name,...metrics};
  s.snapshots.push({projectId:'p',source:'Malva MCP',complete:true,level:'campaign',from,to,fetchedAt,lastSyncAt:fetchedAt,timezone:'America/Boa_Vista',rows:[row]});
  sources.push({system:'Malva MCP',reference:key+i,observedAt:fetchedAt,from,to,summary:'Métricas conferidas.'});
 }
 const proposalId='decision'+i;if(proposal)s.decisions.push({id:proposalId,project:'p',objectId,adAccountId,status:'Aplicada pelo operador',appliedAt});
 return recordOutcome(s,{project:'p',objectId,adAccountId,proposalId:proposal?proposalId:undefined,knowledgeId:k.id,before:{from:beforeFrom,to:beforeTo,metrics:b},after:{from:afterFrom,to:afterTo,metrics:a},sources,summary:'Sinais comparados sem inferir causalidade.'},iso(now));
}
function round(s){
 const job={id:'job',project:'p',status:'Concluída',startedAt:iso(now-600000),completedAt:iso(now-60000)};s.jobs=[job];
 for(const period of ['7d','3d','yesterday','today'])s.snapshots.push({projectId:'p',source:'Malva MCP',period,level:'campaign',complete:true,from:iso(now-86400000),to:iso(now+3600000),fetchedAt:iso(now-120000),timezone:'America/Boa_Vista',rows:[{externalId:'current',adAccountId:'local',provider:'Meta'}]});
 return ensureCollaboration(s,job,now);
}
function review(s,r,role,verdict='support',extra={}){
 const lease=claimCollaboration(s,{roundId:r.id,agentId:role,executionRef:'worker-'+role,clientId:'claim-'+role},now);
 const item=learningCyclePlan(s,'p',now).items[0],args={roundId:r.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'review-'+role,entry:{project:'p',knowledgeId:item.id,knowledgeRevision:item.revision,evidenceFingerprint:item.evidenceFingerprint,verdict,reason:'Revisão dos sinais, contradições e limites.'},...extra};
 return {args,record:recordLearningReview(s,args,now)};
}
function conclude(s,r,role){const c=r.stages.find(c=>c.agentId===role);postCollaboration(s,{roundId:r.id,claimId:c.claimId,executionRef:c.executionRef,clientId:'done-'+role,toAgent:'ops',kind:'conclusion',text:'Perspectiva conferida.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:'local',externalId:'current',fetchedAt:iso(now-120000)}]},now);}
test('reading is pure, project-scoped and never interprets notes or self-confidence as validated success',()=>{
 const {s}=fixture(0),before=structuredClone(s),p=learningCyclePlan(s,'p',now);assert.equal(p.stats.advisory,0);assert.equal(p.items[0].stage,'Em estudo');assert.equal(p.stats.agreementRate,null);assert.equal(learningCyclePlan(s,'q',now).items.length,0);assert.throws(()=>learningCyclePlan(s,'missing',now),/configurado/);assert.deepEqual(s,before);assert.equal(p.policy.automaticExecutionEnabled,false);
});
test('closed exact measurements and confirmed applications seal revision and prospective origin',()=>{
 const {s,k}=fixture(),o=s.knowledgeOutcomes[0],p=learningCyclePlan(s,'p',now);assert.equal(o.knowledgeRevision,1);assert.equal(o.knowledgeRegisteredAt,k.updatedAt);assert.equal(p.items[0].counts.prospective,5);assert.equal(p.items[0].counts.days,3);assert.equal(p.items[0].stage,'Em validação');assert.equal(p.items[0].advisoryEligible,false);
});
test('two actual independent roles review exact evidence before it can support suggestions',()=>{
 const {s}=fixture(),r=round(s),controls=structuredClone(s.config);review(s,r,'traffic');conclude(s,r,'traffic');review(s,r,'creative');conclude(s,r,'creative');review(s,r,'budget');
 assert.equal(learningCyclePlan(s,'p',now).items[0].stage,'Apoio às sugestões');assert.deepEqual(s.config,controls);assert.equal(s.proposals.length,0);assert.equal(s.executions,undefined);
});
test('opposing evidence immediately fences old support; evidence changes require fresh peer reviews',()=>{
 const {s,k}=fixture(),r=round(s);review(s,r,'traffic');conclude(s,r,'traffic');review(s,r,'creative');conclude(s,r,'creative');review(s,r,'budget');assert.equal(learningCyclePlan(s,'p',now).stats.advisory,1);
 add(s,k,6,{adverse:true});const p=learningCyclePlan(s,'p',now).items[0];assert.equal(p.stage,'Revisar padrão');assert.equal(p.counts.adverse,1);assert.equal(p.reviews.length,0);
});
test('no independent evidence inflation through repeated objects, old cases, legacy metadata or text revisions',()=>{
 const {s,k}=fixture(1);for(let i=1;i<5;i++)add(s,k,i*2,{objectId:'c0',adAccountId:'a0'});assert.equal(learningCyclePlan(s,'p',now).items[0].counts.independent,1);
 for(const outcome of s.knowledgeOutcomes)delete outcome.knowledgeRegisteredAt;assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,0);
 recordKnowledge(s,{...k,id:k.id,expectedRevision:1,claim:'Nova hipótese com outro contexto.'},iso(now));assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,0);
});
test('incomplete sources, unequal windows, competing changes, incidents and warmup never pass validation',()=>{
 for(const mutate of [s=>s.snapshots[0].rows[0].spend=999,s=>s.knowledgeOutcomes[0].after.metrics.frontOrders=null,s=>s.snapshots[0].fetchedAt='2026-10-23T00:01:00Z',s=>s.decisionHistory=[{project:'p',objectId:'c0',adAccountId:'a0',occurredAt:'2026-10-25T04:00:00Z'}],s=>s.campaignChanges=[{project:'p',objectId:'c0',adAccountId:'a0',observedAt:'2026-10-25T04:00:00Z'}],s=>s.incidents=[{project:'p',createdAt:'2026-10-23T12:00:00Z',status:'Em retomada'}],s=>s.snapshots[0].rows[0].name='[ENGAJAMENTO]']){
  const {s}=fixture(1);mutate(s);assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,0);
 }
});
test('observation without confirmed application is useful for study but not prospective validation',()=>{
 const {s,k}=fixture(0);add(s,k,0,{proposal:false});assert.equal(learningCyclePlan(s,'p',now).items[0].counts.verified,1);assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,0);
});
test('peer reviews require exact current claim/project/role, preserve retries and reject altered replay',()=>{
 const {s}=fixture(),r=round(s),{args,record}=review(s,r,'traffic');assert.equal(record.agentId,'traffic');assert.equal(recordLearningReview(s,args,now+9999999).id,record.id);assert.equal(s.learningReviews.length,1);
 assert.throws(()=>recordLearningReview(s,{...args,entry:{...args.entry,reason:'overwrite'}},now),/clientId/);
 assert.throws(()=>recordLearningReview(s,{...args,clientId:'other',claimId:'fake'},now),/Reserva/);
 assert.throws(()=>recordLearningReview(s,{...args,clientId:'other',entry:{...args.entry,project:'q'}},now),/outro projeto/);
 assert.throws(()=>recordLearningReview(s,{...args,clientId:'other',entry:{...args.entry,evidenceFingerprint:'fake'}},now),/CONFLICT/);
 assert.throws(()=>recordLearningReview(s,{...args,clientId:'other',entry:{...args.entry,autoExecute:true}},now),/Campo/);
 assert.throws(()=>recordLearningReview(s,{...args,clientId:'other'},now+10000000),/expirada/);
});
test('diagnostic fallback and incomparable choices are excluded from owner agreement denominator',()=>{
 const {s}=fixture(0);s.ownerChoices=[{project:'p',createdAt:iso(now),action:'reduce',percent:20,suggestedAction:'reduce',suggestedPercent:20},{project:'p',createdAt:iso(now),action:'keep',suggestedAction:'keep',suggestionOrigin:'diagnostic'},{project:'q',createdAt:iso(now),action:'pause',suggestedAction:'pause'}];
 const stats=learningCyclePlan(s,'p',now).stats;assert.equal(stats.comparableChoices,1);assert.equal(stats.agreementRate,1);assert.equal(stats.advisory,0);
});
test('externally confirmed comparisons can be linked without claiming execution by Bunker',()=>{
 const {s,k}=fixture(0),o=add(s,k,0,{proposal:false}),b=s.snapshots[0],a=s.snapshots[1];
 s.decisionHistory=[{id:'external',eventKey:'native',sourceSystem:'Malva MCP',source:'Meta',project:'p',objectId:'c0',adAccountId:'a0',currency:'BRL',occurredAt:'2026-10-24T12:00:00Z'}];
 const observed=recordDecisionHistoryOutcome(s,{clientId:'external-read',entry:{project:'p',eventId:'external',before:b,after:a}},now);assert.equal(observed.classification,'Favorável');
 s.knowledgeOutcomes=[];
 const linked=recordOutcome(s,{project:'p',objectId:'c0',adAccountId:'a0',knowledgeId:k.id,historyOutcomeId:observed.id,before:o.before,after:o.after,sources:o.sources,summary:'Comparação externa, sem causalidade.'},iso(now));
 assert.equal(linked.proposalId,null);assert.equal(linked.historyOutcomeId,observed.id);assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,1);
 s.decisionHistory[0].source='Malva';assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,0);
});

test('changed source clocks, different timezones and a closed incident are handled by exact window',()=>{
 for(const mutate of [s=>s.snapshots[0].lastSyncAt='2026-10-23T00:00:00Z',s=>s.snapshots[0].timezone='America/Sao_Paulo']){
  const {s}=fixture(1);mutate(s);assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,0);
 }
 const {s}=fixture(1);s.incidents=[{project:'p',createdAt:'2026-10-20T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z',status:'Encerrado'}];assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,1);
 s.incidents=[{project:'p',createdAt:'2026-10-24T00:00:00Z',status:'Em retomada',scope:{accountIds:['unrelated'],objectIds:[]}}];assert.equal(learningCyclePlan(s,'p',now).items[0].counts.prospective,1);
});
test('a reviewer challenge blocks support without altering the hypothesis or removing prior reviews',()=>{
 const {s}=fixture(),r=round(s);review(s,r,'traffic');conclude(s,r,'traffic');review(s,r,'creative');conclude(s,r,'creative');const {args}=review(s,r,'budget');
 recordLearningReview(s,{...args,clientId:'critic',entry:{...args.entry,verdict:'challenge',reason:'Investigar outra variável antes de repetir o padrão.'}},now+1);
 const item=learningCyclePlan(s,'p',now+1).items[0];assert.equal(item.stage,'Revisar padrão');assert.equal(s.learningReviews.length,4);assert.equal(s.knowledge[0].status,'Hipótese');
});
test('an expired or invalidated pattern never gains advisory eligibility from a confident narrative',()=>{
 const {s}=fixture(),r=round(s);review(s,r,'traffic');conclude(s,r,'traffic');review(s,r,'creative');conclude(s,r,'creative');review(s,r,'budget');assert.equal(learningCyclePlan(s,'p',now).stats.advisory,1);
 assert.equal(learningCyclePlan(s,'p',now+40*86400000).stats.advisory,0);s.knowledge[0].status='Invalidado';assert.equal(learningCyclePlan(s,'p',now).items[0].stage,'Revisar padrão');
});
