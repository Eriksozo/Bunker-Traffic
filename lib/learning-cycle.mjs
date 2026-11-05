/** Evidence-based feedback, not model training or financial authorization. */
import {recordOutcome,readKnowledgePlan} from './knowledge.mjs';
import {sum} from './analysis.mjs';
import {fingerprint,assertCollaborationWorker} from './collaboration.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {agentDevelopmentPlan} from './agent-development.mjs';
const arr=x=>Array.isArray(x)?x:[],time=x=>Date.parse(x||''),clone=x=>JSON.parse(JSON.stringify(x));
export const learningPolicy=Object.freeze({version:1,minimumCases:5,minimumProspectiveCases:5,minimumDays:3,minimumFavorableRate:0.8,maximumReviews:600,automaticExecutionEnabled:false});
const metricNames=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders'];
function scope(state,project){if(!Object.prototype.hasOwnProperty.call(state.config||{},project))throw Error('Projeto não configurado.');}
export function assessLearningOutcome(state,outcome,now=Date.now()){
 try{
  // Revalidate the original evidence without mutating or trusting saved labels.
  const copy={...state,knowledgeOutcomes:[]};
  const v=recordOutcome(copy,{project:outcome.project,objectId:outcome.objectId,adAccountId:outcome.adAccountId,proposalId:outcome.proposalId||undefined,historyOutcomeId:outcome.historyOutcomeId||undefined,knowledgeId:outcome.knowledgeId,before:outcome.before,after:outcome.after,sources:outcome.sources,summary:outcome.summary},new Date(now).toISOString());
  const b=v.before,a=v.after;
  if(metricNames.some(k=>!Number.isFinite(b.metrics[k])||!Number.isFinite(a.metrics[k])))throw Error('Métricas financeiras ou aquisição ausentes.');
  if(time(b.to)-time(b.from)!==time(a.to)-time(a.from))throw Error('Janelas de duração diferente.');
  if([b,a].some(w=>time(w.to)>time(w.fetchedAt))||time(a.to)>now||time(b.to)>time(a.from))throw Error('Janela incompleta.');
  if(!b.timezone||b.timezone!==a.timezone)throw Error('Fuso ausente ou divergente.');
  try{new Intl.DateTimeFormat('en',{timeZone:b.timezone});}catch{throw Error('Fuso inválido.');}
  if([b,a].some(w=>w.lastSyncAt!==null&&(!Number.isFinite(time(w.lastSyncAt))||time(w.lastSyncAt)<time(w.to)||time(w.lastSyncAt)>now)))throw Error('Sincronização insuficiente para fechar a janela.');
  const history=arr(state.decisionHistory).filter(e=>e.project===v.project&&e.objectId===v.objectId&&e.adAccountId===v.adAccountId&&time(e.occurredAt)>time(b.from)&&time(e.occurredAt)<time(a.to));
  if(history.some(e=>!v.appliedAt||Math.abs(time(e.occurredAt)-time(v.appliedAt))>60000))throw Error('Outra alteração observada entre as janelas.');
  if(arr(state.campaignChanges).some(e=>e.project===v.project&&e.objectId===v.objectId&&e.adAccountId===v.adAccountId&&time(e.observedAt||e.detectedAt)>time(b.from)&&time(e.observedAt||e.detectedAt)<time(a.to)&&(!v.appliedAt||Math.abs(time(e.observedAt||e.detectedAt)-time(v.appliedAt))>60000)))throw Error('Mudança externa requer conciliação.');
  if(arr(state.incidents).some(e=>{const applies=!e.scope||(!arr(e.scope.accountIds).length&&!arr(e.scope.objectIds).length)||arr(e.scope.accountIds).includes(v.adAccountId)||arr(e.scope.objectIds).some(x=>x.adAccountId===v.adAccountId&&x.objectId===v.objectId);const closed=e.status==='Encerrado'?time(e.updatedAt||e.reportedAt):Infinity;return e.project===v.project&&applies&&time(e.createdAt||e.reportedAt)<time(a.to)&&closed>time(b.from);} ))throw Error('Incidente do projeto entre as janelas.');
  const row=arr(state.snapshots).filter(s=>s.projectId===v.project&&s.level==='campaign').flatMap(s=>arr(s.rows)).find(r=>r.externalId===v.objectId&&r.adAccountId===v.adAccountId);
  if(isWarmupCampaign(row?.name||''))throw Error('Aquecimento não é caso de otimização de vendas.');
  const before=sum([b.metrics]),after=sum([a.metrics]);
  if(before.roi===null||after.roi===null||!b.metrics.spend||!a.metrics.spend)throw Error('Exposição insuficiente para comparar.');
  // Agreement of economic and acquisition signals, not ROI alone.
  const favorable=after.roi>before.roi&&after.result>before.result&&after.frontOrders>=before.frontOrders;
  const adverse=after.roi<before.roi&&after.result<before.result;
  return {id:outcome.id,project:v.project,objectId:v.objectId,adAccountId:v.adAccountId,before:b,after:a,classification:favorable?'Favorável':adverse?'Desfavorável':'Inconclusivo',verified:true,confirmedApplication:!!v.appliedAt,createdAt:outcome.createdAt,knowledgeRevision:outcome.knowledgeRevision??null,knowledgeRegisteredAt:outcome.knowledgeRegisteredAt??null};
 }catch(error){return {id:outcome.id,verified:false,limitation:error.message,classification:'Não verificável'};}
}
function independent(cases){
 // One campaign/account per version. Repeated hourly copies never inflate n.
 const seen=new Set();return cases.slice().sort((a,b)=>time(a.after.to)-time(b.after.to)||String(a.id).localeCompare(String(b.id))).filter(c=>{const key=JSON.stringify([c.project,c.adAccountId,c.objectId]);if(seen.has(key))return false;seen.add(key);return true;});
}
/** @param {string|null} [project] */
export function learningCyclePlan(state,project=null,now=Date.now()){
 if(project==='all')project=null;if(project)scope(state,project);if(!Number.isFinite(now))throw Error('Relógio inválido.');
 const projects=project?[project]:Object.keys(state.config||{}),knowledge=projects.flatMap(p=>readKnowledgePlan(state,p,new Date(now).toISOString()).items);
 const choices=arr(state.ownerChoices).filter(c=>projects.includes(c.project)&&time(c.createdAt)<=now),eligibleChoices=choices.filter(c=>c.suggestionOrigin!=='diagnostic'&&['increase','reduce','pause','keep'].includes(c.action)&&['increase','reduce','pause','keep'].includes(c.suggestedAction));
 const agreements=eligibleChoices.filter(c=>c.action===c.suggestedAction&&(!['increase','reduce'].includes(c.action)||Number.isFinite(c.percent)&&Number.isFinite(c.suggestedPercent)&&Math.abs(c.percent-c.suggestedPercent)<0.0001));
 const items=knowledge.map(k=>{
  const outcomes=arr(state.knowledgeOutcomes).filter(o=>o.project===k.project&&o.knowledgeId===k.id),cases=outcomes.map(o=>assessLearningOutcome(state,o,now));
  const verified=cases.filter(c=>c.verified),unique=independent(verified),prospective=independent(verified.filter(c=>c.confirmedApplication&&c.knowledgeRevision===k.revision&&c.knowledgeRegisteredAt===k.updatedAt&&time(c.before.from)>=time(k.updatedAt)));
  const positives=prospective.filter(c=>c.classification==='Favorável').length,negative=verified.filter(c=>c.knowledgeRevision===k.revision&&c.classification==='Desfavorável').length;
  const distinctDays=new Set(prospective.map(c=>c.after.from.slice(0,10))).size,rate=prospective.length?positives/prospective.length:null;
  const evidenceFingerprint=fingerprint({knowledge:{id:k.id,project:k.project,revision:k.revision,claim:k.claim,status:k.status,sources:k.sources},cases,policy:learningPolicy});
  const reviews=arr(state.learningReviews).filter(r=>r.project===k.project&&r.knowledgeId===k.id&&r.evidenceFingerprint===evidenceFingerprint&&time(r.createdAt)<=now);
  const latest=new Map();for(const r of reviews)if(!latest.has(r.agentId)||time(r.createdAt)>=time(latest.get(r.agentId).createdAt))latest.set(r.agentId,r);
  const current=[...latest.values()],budget=current.find(r=>r.agentId==='budget'&&r.verdict==='support'),analyst=current.find(r=>['traffic','creative'].includes(r.agentId)&&r.verdict==='support'&&r.executionRef!==budget?.executionRef);
  const peerReady=!!budget&&!!analyst,challenged=current.some(r=>r.verdict==='challenge');
  const enough=unique.length>=learningPolicy.minimumCases&&prospective.length>=learningPolicy.minimumProspectiveCases&&distinctDays>=learningPolicy.minimumDays&&rate>=learningPolicy.minimumFavorableRate;
  const latestMeasurement=Math.max(...verified.map(c=>time(c.after.to)));
  const evidenceOld=verified.length>0&&now-latestMeasurement>30*86400000;
  const safe=k.status!=='Invalidado'&&!k.stale&&!evidenceOld&&!negative&&!challenged;
  const stage=!safe?'Revisar padrão':enough&&peerReady?'Apoio às sugestões':verified.length?'Em validação':'Em estudo';
  const reasons=[];
  if(k.status==='Invalidado')reasons.push('Padrão invalidado.');if(k.stale||evidenceOld)reasons.push('Evidência antiga: renovar antes de usar.');if(negative)reasons.push(`${negative} resultado(s) desfavorável(is): investigar antes de reutilizar.`);if(challenged)reasons.push('Há contestação de um revisor.');
  if(!enough)reasons.push('Falta validação posterior ao registro: cinco campanhas distintas em três dias, com sinais favoráveis em pelo menos quatro.');
  if(!peerReady)reasons.push('Falta revisão independente de orçamento e tráfego ou criativos sobre esta evidência.');
  return {id:k.id,project:k.project,topic:k.topic,revision:k.revision,stage,reviewRequest:{action:'learningReview',entry:{project:k.project,knowledgeId:k.id,knowledgeRevision:k.revision,evidenceFingerprint},requiresActiveClaim:true},advisoryEligible:stage==='Apoio às sugestões',evidenceFingerprint,counts:{recorded:cases.length,verified:verified.length,independent:unique.length,prospective:prospective.length,favorable:positives,adverse:negative,inconclusive:prospective.filter(c=>c.classification==='Inconclusivo').length,unverifiable:cases.filter(c=>!c.verified).length,days:distinctDays},favorableRate:rate,reasons,reviews:current.map(({id,agentId,verdict,reason,createdAt})=>({id,agentId,verdict,reason,createdAt})),cases:cases.map(c=>({id:c.id,objectId:c.objectId,adAccountId:c.adAccountId,verified:c.verified,classification:c.classification,limitation:c.limitation,prospective:prospective.some(p=>p.id===c.id)})),next:negative||challenged?'Investigar contradições e revisar a hipótese.':verified.length?'Comparar casos novos e pedir revisão independente.':'Medir antes e depois com fontes completas.'};
 });
 const actionOutcomes=arr(state.knowledgeOutcomes).filter(o=>projects.includes(o.project)).map(o=>assessLearningOutcome(state,o,now));
 const linkedId=c=>arr(state.choiceLinks).find(l=>l.choiceId===c.id)?.proposalId||c.proposalId;
 const pending=choices.filter(c=>['increase','reduce','pause'].includes(c.action)&&!arr(state.knowledgeOutcomes).some(o=>o.project===c.project&&o.proposalId&&o.proposalId===linkedId(c)));
 return {version:1,project,development:agentDevelopmentPlan(state,project,now,actionOutcomes),policy:learningPolicy,actionOutcomes,steps:[{role:'traffic',label:'Lia registra contexto e hipótese'},{role:'creative',label:'Nina confere aquisição e criativo'},{role:'budget',label:'Theo confronta exposição e resultado'},{role:'ops',label:'Cai consolida, mede e pede nova revisão'}],stats:{patterns:items.length,advisory:items.filter(i=>i.advisoryEligible).length,needsReview:items.filter(i=>i.stage==='Revisar padrão').length,ownerChoices:choices.length,comparableChoices:eligibleChoices.length,agreements:agreements.length,agreementRate:eligibleChoices.length?agreements.length/eligibleChoices.length:null,pendingOutcome:pending.length,verifiedOutcomes:actionOutcomes.filter(o=>o.verified).length,measuredApplications:actionOutcomes.filter(o=>o.verified&&o.confirmedApplication).length},items,backlog:pending.slice(0,30).map(c=>({choiceId:c.id,project:c.project,objectId:c.objectId,adAccountId:c.adAccountId,proposalId:linkedId(c)||null,action:c.action,next:'Conferir aplicação antes de medir resultado; escolha não comprova execução.'})),readRequest:{action:'learningRead',projectId:project||undefined},limits:['Associação temporal não comprova causalidade.','Concordância com o dono não é taxa de lucro.','Os mínimos são critérios operacionais, não promessa estatística de acerto.','Padrões não mudam metas, cadência, proteções nem exigência de aprovação.']};
}
/** Review authorship comes from the active connected stage, never input role. */
export function recordLearningReview(state,args,now=Date.now()){
 const input=args.entry;if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Revisão de aprendizado inválida.');
 const allowed=new Set(['project','knowledgeId','knowledgeRevision','evidenceFingerprint','verdict','reason']);for(const key of Object.keys(input))if(!allowed.has(key))throw Error('Campo não permitido na revisão de aprendizado.');
 if(state.learningReviews!==undefined&&!Array.isArray(state.learningReviews))throw Error('Histórico de revisões inválido.');
 const prior=arr(state.learningReviews),request=fingerprint({roundId:args.roundId,claimId:args.claimId,executionRef:args.executionRef,entry:input});
 if(typeof args.clientId!=='string'||!args.clientId.trim()||args.clientId.length>150)throw Error('clientId inválido.');
 const replay=prior.find(r=>r.clientId===args.clientId);if(replay){if(replay.request!==request)throw Error('clientId já utilizado por outra revisão.');return replay;}
 const worker=assertCollaborationWorker(state,args,now);if(worker.project!==input.project)throw Error('Aprendizado pertence a outro projeto.');
 if(!['traffic','creative','budget'].includes(worker.agentId))throw Error('Gestão não pode revisar o próprio aprendizado.');
 const item=learningCyclePlan(state,input.project,now).items.find(i=>i.id===input.knowledgeId);
 if(!item||item.revision!==input.knowledgeRevision||item.evidenceFingerprint!==input.evidenceFingerprint)throw Error('CONFLICT: releia o aprendizado e as evidências.');
 if(!['support','challenge','inconclusive'].includes(input.verdict)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1600)throw Error('Parecer e motivo são obrigatórios.');
 if(input.verdict==='support'&&!item.counts.verified)throw Error('Apoio exige ao menos um resultado verificável.');
 if(prior.length>=learningPolicy.maximumReviews)throw Error('Limite de revisões atingido; nenhum histórico foi removido.');
 const record={id:crypto.randomUUID(),project:input.project,knowledgeId:item.id,knowledgeRevision:item.revision,evidenceFingerprint:item.evidenceFingerprint,verdict:input.verdict,reason:input.reason.trim(),agentId:worker.agentId,executionRef:args.executionRef,roundId:args.roundId,claimId:args.claimId,clientId:args.clientId,request,createdAt:new Date(now).toISOString()};
 state.learningReviews=[...prior,record];return clone(record);
}
