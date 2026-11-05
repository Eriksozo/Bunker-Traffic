import {recordOutcome,knowledgeLimits} from './knowledge.mjs';
import {assessLearningOutcome} from './learning-cycle.mjs';
import {readConfirmedProposalExecution} from './decision-resolution.mjs';
import {fingerprint} from './collaboration.mjs';
import {proposalLearningEnrollment} from './learning-enrollment.mjs';

const arr=x=>Array.isArray(x)?x:[],time=x=>Date.parse(x||''),day=86400000;
const metrics=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders'];
export const autonomousLearningPolicy=Object.freeze({version:1,maxCasesPerUnit:2,maxAttempts:300,maxApplications:100,maximumAgeDays:30,providerWrites:false});
function observations(state,p,now){
 const target=p.payload,rows=[];
 for(const s of arr(state.snapshots)){
  if(s.projectId!==p.project||s.level!=='campaign'||s.source!=='Malva MCP'||s.complete!==true||s.currency&&s.currency!=='BRL'||s.metricsCurrency&&s.metricsCurrency!=='BRL')continue;
  const matches=arr(s.rows).filter(r=>r.adAccountId===target.adAccountId&&r.externalId===target.objectId);
  if(matches.length===1)rows.push({...s,metrics:Object.fromEntries(metrics.map(k=>[k,matches[0][k]])),reference:'snapshot:'+fingerprint({project:p.project,account:target.adAccountId,object:target.objectId,from:s.from,to:s.to,fetchedAt:s.fetchedAt})});
 }
 for(const m of arr(state.knowledgeMeasurements))if(m.project===p.project&&m.level==='campaign'&&m.externalId===target.objectId&&m.adAccountId===target.adAccountId&&m.source==='Malva MCP'&&m.complete===true)rows.push({...m,metrics:Object.fromEntries(metrics.map(k=>[k,m.metrics?.[k]])),reference:m.reference||'measurement:'+m.id});
 const valid=rows.filter(s=>[s.from,s.to,s.fetchedAt].every(x=>Number.isFinite(time(x)))&&time(s.to)-time(s.from)===day&&time(s.to)<=time(s.fetchedAt)&&time(s.fetchedAt)<=now&&metrics.every(k=>Number.isFinite(s.metrics[k])&&s.metrics[k]>=0)&&Number.isInteger(s.metrics.frontOrders)&&s.metrics.spend>0&&(s.lastSyncAt==null||Number.isFinite(time(s.lastSyncAt))&&time(s.lastSyncAt)>=time(s.to)&&time(s.lastSyncAt)<=now)&&typeof s.timezone==='string'&&s.timezone);
 // Newer attribution may update an existing day, but a conflicting exact read
 // cannot be selected merely by source order.
 const grouped=new Map();for(const r of valid){const key=JSON.stringify([r.from,r.to,r.timezone]);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
 return [...grouped.values()].flatMap(g=>{g.sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt));const newest=g.filter(r=>r.fetchedAt===g[0].fetchedAt);return new Set(newest.map(r=>JSON.stringify(r.metrics))).size===1?[g[0]]:[];});
}
/** Read-only plan: daily before/after comparisons, not a new collection slot. */
export function autonomousLearningPlan(state,project=null,now=Date.now()){
 if(project==='all')project=null;
 const ready=[],waiting=[],seen=new Set(),proposals=arr(state.proposals).filter(p=>(!project||p.project===project)&&state.config?.[p.project]&&p.payload?.level==='campaign'&&String(p.payload?.provider).toLowerCase()==='meta');
 const confirmed=proposals.map(p=>({p,e:readConfirmedProposalExecution(state,p,now)})).filter(x=>x.e&&now-time(x.e.confirmedAt)<=autonomousLearningPolicy.maximumAgeDays*day).sort((a,b)=>time(b.e.confirmedAt)-time(a.e.confirmedAt));
 for(const {p,e} of confirmed.slice(0,autonomousLearningPolicy.maxApplications)){
  if(seen.has(p.id))continue;seen.add(p.id);
  if(arr(state.knowledgeOutcomes).some(o=>o.project===p.project&&o.proposalId===p.id))continue;
  const rows=observations(state,p,now),at=time(e.confirmedAt),pairs=[];
  for(const b of rows.filter(r=>time(r.to)<=at))for(const a of rows.filter(r=>time(r.from)>=at&&r.timezone===b.timezone))pairs.push({b,a});
  pairs.sort((x,y)=>time(y.b.to)-time(x.b.to)||time(x.a.from)-time(y.a.from));
  const pair=pairs[0];
  if(!pair){waiting.push({project:p.project,proposalId:p.id,reason:'Aguardando dias fechados comparáveis antes e depois, com gasto e aquisição informados.'});continue;}
  const sources=[pair.b,pair.a].map((s,i)=>({system:'Malva MCP',reference:s.reference,observedAt:s.fetchedAt,from:s.from,to:s.to,summary:i?'Dia fechado posterior à aplicação conferida.':'Dia fechado anterior à aplicação conferida.'}));
  const enrollment=proposalLearningEnrollment(state,p,now);
  const entry={project:p.project,objectId:p.payload.objectId,adAccountId:p.payload.adAccountId,proposalId:p.id,...(enrollment?{knowledgeId:enrollment.knowledgeId}:{}),before:{from:pair.b.from,to:pair.b.to,metrics:pair.b.metrics},after:{from:pair.a.from,to:pair.a.to,metrics:pair.a.metrics},sources,summary:'Comparação automática de dias fechados da aplicação conferida. Associação temporal; não demonstra causalidade.'};
  const key=fingerprint({entry:{project:entry.project,objectId:entry.objectId,adAccountId:entry.adAccountId,proposalId:entry.proposalId,before:entry.before,after:entry.after,timezone:pair.b.timezone,knowledgeId:entry.knowledgeId||null,knowledgeRevision:enrollment?.knowledgeRevision||null},execution:{id:e.id,version:e.proposalVersion,signature:e.proposalSignature,confirmedAt:e.confirmedAt},changes:arr(state.campaignChanges).filter(c=>c.project===p.project&&c.adAccountId===p.payload.adAccountId&&c.objectId===p.payload.objectId),incidents:arr(state.incidents).filter(i=>i.project===p.project),history:arr(state.decisionHistory).filter(h=>h.project===p.project&&h.adAccountId===p.payload.adAccountId&&h.objectId===p.payload.objectId)});
  if(arr(state.learningAttempts).some(a=>a.project===p.project&&a.fingerprint===key)){waiting.push({project:p.project,proposalId:p.id,reason:'A última comparação tinha limitações; aguardar evidência nova antes de tentar novamente.'});continue;}
  if(arr(state.knowledgeOutcomes).length>=knowledgeLimits.outcomes||arr(state.learningAttempts).length>=autonomousLearningPolicy.maxAttempts){waiting.push({project:p.project,proposalId:p.id,reason:'Capacidade do histórico atingida; preservar e arquivar antes de novas medições.'});continue;}
  ready.push({project:p.project,proposalId:p.id,fingerprint:key,entry});
 }
 return {version:1,paused:!!state.paused,ready:state.paused?[]:ready.slice(0,Math.min(autonomousLearningPolicy.maxCasesPerUnit,Math.max(0,autonomousLearningPolicy.maxAttempts-arr(state.learningAttempts).length),Math.max(0,knowledgeLimits.outcomes-arr(state.knowledgeOutcomes).length))),readyCount:ready.length,waiting:waiting.slice(0,30),waitingCount:waiting.length,truncated:confirmed.length>autonomousLearningPolicy.maxApplications,policy:autonomousLearningPolicy};
}
/** Atomic within the caller's central CAS. No source call, approval or ad write. */
export function processAutonomousLearning(state,now=Date.now()){
 const plan=autonomousLearningPlan(state,null,now);if(state.paused||!plan.ready.length)return {kind:'learning',recorded:0,limited:0};
 const staged=structuredClone(state);let recorded=0,limited=0;
 for(const work of plan.ready){
  const candidate=structuredClone(staged);
  try{
   const outcome=recordOutcome(candidate,work.entry,new Date(now).toISOString()),proof=assessLearningOutcome(candidate,outcome,now);
   if(!proof.verified)throw Error('LEARNING_EVIDENCE_LIMITED');
   staged.knowledgeOutcomes=candidate.knowledgeOutcomes;recorded++;
   staged.learningAttempts=[...arr(staged.learningAttempts),{id:crypto.randomUUID(),project:work.project,proposalId:work.proposalId,fingerprint:work.fingerprint,status:'Medido',outcomeId:outcome.id,at:new Date(now).toISOString()}];
  }catch{
   limited++;staged.learningAttempts=[...arr(staged.learningAttempts),{id:crypto.randomUUID(),project:work.project,proposalId:work.proposalId,fingerprint:work.fingerprint,status:'Evidência insuficiente',code:'LEARNING_EVIDENCE_LIMITED',at:new Date(now).toISOString()}];
  }
 }
 state.knowledgeOutcomes=staged.knowledgeOutcomes;state.learningAttempts=staged.learningAttempts;
 return {kind:'learning',recorded,limited,providerWrites:0};
}
