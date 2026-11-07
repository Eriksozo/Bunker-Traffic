import {learningCyclePlan,recordLearningReview,learningPolicy} from './learning-cycle.mjs';
import {knowledgeLimits} from './knowledge.mjs';
const learningError=code=>Object.assign(new Error(code),{code});
const roles=['traffic','creative','budget'],arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||''),pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
export const learningPeerPolicy=Object.freeze({version:2,maxCasesPerPacket:8,maxPatternsPerUnit:1,additionalModelCalls:0,providerWrites:false,hypothesisCritiquesPerProject:15});
const authorOf=k=>k?.agentOrigin?.kind==='cloud-reflection'?k.agentOrigin.agentId:null;
const critiqueRule='Crítica prévia: este padrão ainda não tem resultado medido. Confronte a hipótese, de outro papel ou sem autor, com os dados atuais desta rodada sob a sua função. Use challenge quando os dados atuais a contradizem ou ela é vaga demais para testar; inconclusive quando faltam dados. A crítica fica registrada à parte: não muda o estágio do padrão, não valida, não aprova e não libera execução.';
/** Before any measured case exists, a different role may critique a hypothesis using current data. Never support, never a stage change. */
function hypothesisPacket(state,cycle,project,role){
 const critiques=arr(state.learningReviews).filter(r=>r.phase==='hypothesis'&&r.project===project);
 if(critiques.length>=learningPeerPolicy.hypothesisCritiquesPerProject)return null;
 const sources=new Map(arr(state.knowledge).filter(k=>k.project===project).map(k=>[k.id,k]));
 const open=cycle.items.filter(k=>{const source=sources.get(k.id);return source&&source.status!=='Invalidado'&&k.stage==='Em estudo'&&k.counts.verified===0&&authorOf(source)!==role&&!k.critiques.some(r=>r.agentId===role);});
 open.sort((a,b)=>a.critiques.length-b.critiques.length||Number(!authorOf(sources.get(a.id)))-Number(!authorOf(sources.get(b.id)))||String(sources.get(b.id).updatedAt).localeCompare(String(sources.get(a.id).updatedAt))||a.id.localeCompare(b.id));
 const item=open[0];if(!item)return null;
 const knowledge=sources.get(item.id);
 return {role,phase:'hypothesis',entry:{...item.reviewRequest.entry},topic:item.topic,claim:knowledge.claim,author:authorOf(knowledge),status:knowledge.status,sources:arr(knowledge.sources).slice(0,5).map(s=>pick(s,['system','reference','observedAt','from','to','summary'])),stage:item.stage,counts:item.counts,reasons:item.reasons,priorCritiques:item.critiques.map(r=>({agentId:r.agentId,verdict:r.verdict,reason:r.reason})),cases:[],casePacketComplete:true,omittedCases:0,supportAllowed:false,policy:learningPeerPolicy,rule:critiqueRule};
}
/** A single project-scoped review of measured evidence, never an approval or a generated case. */
export function learningPeerPacket(state,project,role,now=Date.now()){
 if(state.paused||!roles.includes(role)||arr(state.learningReviews).length>=learningPolicy.maximumReviews)return null;
 const cycle=learningCyclePlan(state,project,now);
 const eligible=cycle.items.filter(k=>k.counts.verified>0&&!k.reviews.some(r=>r.agentId===role));
 eligible.sort((a,b)=>Number(b.stage==='Revisar padrão')-Number(a.stage==='Revisar padrão')||b.counts.adverse-a.counts.adverse||a.id.localeCompare(b.id));
 const item=eligible[0];if(!item)return hypothesisPacket(state,cycle,project,role);
 const knowledge=arr(state.knowledge).find(k=>k.project===project&&k.id===item.id);
 const ordered=item.cases.slice().sort((a,b)=>Number(b.classification==='Desfavorável')-Number(a.classification==='Desfavorável')||Number(!b.verified)-Number(!a.verified)||String(a.id).localeCompare(String(b.id)));
 const cases=ordered.slice(0,learningPeerPolicy.maxCasesPerPacket).map(c=>{
  const measured=cycle.actionOutcomes.find(o=>o.id===c.id&&o.verified);
  return {...c,...measured?{confirmedApplication:measured.confirmedApplication,before:pick(measured.before,['from','to','fetchedAt','lastSyncAt','timezone','metrics']),after:pick(measured.after,['from','to','fetchedAt','lastSyncAt','timezone','metrics'])}:{}};
 });
 const complete=cases.length===item.cases.length;
 const sourceClock=Math.max(...arr(knowledge.sources).map(s=>at(s.observedAt))),maximumAge=knowledgeLimits.staleDays*86400000;
 const recent=at(knowledge.updatedAt)<=now&&now-sourceClock<=maximumAge&&cases.every(c=>!c.verified||now-at(c.after.to)<=maximumAge);
 return {role,phase:'evidence',entry:{...item.reviewRequest.entry},topic:item.topic,claim:knowledge.claim,stage:item.stage,counts:item.counts,reasons:item.reasons,cases,casePacketComplete:complete,omittedCases:item.cases.length-cases.length,supportAllowed:complete&&item.counts.unverifiable===0&&knowledge.status!=='Invalidado'&&recent,policy:learningPeerPolicy,rule:'Revisar estes resultados, não concordância com o dono. Support não valida causalidade nem libera execução. Com amostra incompleta, caso não verificável ou hipótese invalidada, usar challenge/inconclusive; não afirmar revisão integral.'};
}
/** Save only the exact model-authored verdict from the packet actually seen. Recheck within the central CAS. */
export function persistLearningPeerReview(state,args,review,packet,now=Date.now()){
 if(!review)return {status:'Sem revisão elegível'};
 const same=packet&&['knowledgeId','knowledgeRevision','evidenceFingerprint'].every(k=>packet.entry[k]===review[k]);
 if(!same||packet.entry.project!==args.project||packet.role!==args.agentId||!roles.includes(args.agentId))throw learningError('CLOUD_LEARNING_REVIEW_SCOPE');
 const critique=packet.phase==='hypothesis';
 if(critique&&(packet.author===args.agentId||review.verdict==='support'))throw learningError(review.verdict==='support'?'CLOUD_LEARNING_REVIEW_UNSUPPORTED':'CLOUD_LEARNING_REVIEW_SCOPE');
 const clientId='cloud-learning:'+args.claimId+':'+review.knowledgeId;
 const request={roundId:args.roundId,claimId:args.claimId,executionRef:args.executionRef,clientId,...(critique?{phase:'hypothesis'}:{}),entry:{project:args.project,...review}};
 if(arr(state.learningReviews).some(r=>r.clientId===clientId)){const saved=recordLearningReview(state,request,now);return {status:'Registrada',id:saved.id,knowledgeId:saved.knowledgeId,verdict:saved.verdict};}
 const current=learningCyclePlan(state,args.project,now).items.find(k=>k.id===review.knowledgeId);
 if(state.paused||!current||current.revision!==review.knowledgeRevision||current.evidenceFingerprint!==review.evidenceFingerprint||critique&&current.counts.verified>0)return {status:'Releitura necessária'};
 if(critique&&arr(state.learningReviews).filter(r=>r.phase==='hypothesis'&&r.project===args.project).length>=learningPeerPolicy.hypothesisCritiquesPerProject)return {status:'Limite de críticas prévias do projeto'};
 if(arr(state.learningReviews).length>=learningPolicy.maximumReviews)return {status:'Histórico de revisões cheio'};
 if(review.verdict==='support'&&!packet.supportAllowed)throw learningError('CLOUD_LEARNING_REVIEW_UNSUPPORTED');
 const saved=recordLearningReview(state,request,now);
 return {status:'Registrada',id:saved.id,knowledgeId:saved.knowledgeId,verdict:saved.verdict,...(critique?{phase:'hypothesis'}:{})};
}
