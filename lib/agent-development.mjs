import {externalLearningRecall} from './external-learning.mjs';
import {z} from 'zod';
/** Reflections are authored hypotheses. Checked citations prove numbers, not causality or skill. */
const roles=['traffic','creative','budget','ops'],arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||'');
const metrics=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','linkClicks','impressions','dailyBudget'];
const citationSchema=z.object({period:z.enum(['7d','3d','yesterday','today']),level:z.enum(['campaign','adset','ad']),adAccountId:z.string().min(1),externalId:z.string().min(1),metric:z.enum(metrics),value:z.number().finite()}).strict();
export const agentReflectionSchema=z.object({lesson:z.string().min(1).max(320),uncertainty:z.string().min(1).max(320),nextCheck:z.string().min(1).max(320),citations:z.array(citationSchema).max(8),peerChecks:z.array(z.object({messageId:z.string().min(1),stance:z.enum(['support','challenge','inconclusive']),reason:z.string().min(1).max(240)}).strict()).max(3)}).strict();
export const developmentPolicy=Object.freeze({version:3,episodesPerRole:8,recallPerRole:3,maximumAgeDays:30,automaticExecutionEnabled:false});
const objectives={traffic:{name:'Lia',label:'Tráfego',focus:'Separar aquisição front de upsells e conferir CPA, checkout e resposta após edição.'},creative:{name:'Nina',label:'Criativos',focus:'Conferir filhos e identidade da peça; localizar a perda sem culpar o criativo por falha de checkout.'},budget:{name:'Theo',label:'Orçamento',focus:'Confrontar moeda, exposição, limites e edições recentes antes de propor outro ajuste.'},ops:{name:'Cai',label:'Gestão',focus:'Resolver contrapontos materiais e sintetizar ação com condição de revisão; consenso não prova eficácia.'}};
const sameCitation=(a,b)=>['period','level','adAccountId','externalId','metric'].every(k=>a[k]===b[k]);
/** A peer counterpoint stays tied to its actual author, round and frozen source even after compaction. */
function peerFeedback(episode,items,now=Infinity){
 const live=items.filter(p=>p.project===episode.project&&p.roundId===episode.roundId&&p.agentId!==episode.agentId&&p.reflection?.numericCitationsChecked===true).flatMap(p=>arr(p.reflection.peerChecks).filter(c=>c.messageId===episode.messageId).map(c=>({reviewMessageId:p.messageId,project:p.project,roundId:p.roundId,sourceHash:p.sourceHash,fromAgent:p.agentId,stance:c.stance,reason:c.reason,createdAt:p.createdAt})));
 const byId=new Map();for(const f of [...arr(episode.peerFeedback),...live]){
  if(typeof episode.sourceHash!=='string'||!episode.sourceHash||f.project!==episode.project||f.roundId!==episode.roundId||f.sourceHash!==episode.sourceHash||!roles.includes(f.fromAgent)||f.fromAgent===episode.agentId||!['support','challenge','inconclusive'].includes(f.stance)||typeof f.reviewMessageId!=='string'||!f.reviewMessageId||typeof f.reason!=='string'||!f.reason.trim()||f.reason.length>240||!Number.isFinite(at(f.createdAt))||at(f.createdAt)<at(episode.createdAt)||at(f.createdAt)>now)continue;
  byId.set(f.reviewMessageId,{reviewMessageId:f.reviewMessageId,project:f.project,roundId:f.roundId,sourceHash:f.sourceHash,fromAgent:f.fromAgent,stance:f.stance,reason:f.reason,createdAt:f.createdAt});
 }
 return [...byId.values()].sort((a,b)=>Number(b.stance==='challenge')-Number(a.stance==='challenge')||at(b.createdAt)-at(a.createdAt)||a.reviewMessageId.localeCompare(b.reviewMessageId)).slice(0,3);
}
/** Retrieval quality is source grounding and relevance, never an estimate of decision efficacy. */
function groundedRecall(items,role,focus,now){
 const relevant=e=>arr(focus).some(r=>arr(e.reflection.citations).some(c=>r.adAccountId===c.adAccountId&&r.externalId===c.externalId)||e.target?.adAccountId===r.adAccountId&&e.target?.objectId===r.externalId);
 const candidates=items.filter(e=>e.agentId===role&&e.reflection?.numericCitationsChecked===true&&arr(e.reflection.citations).length>0).map(e=>{const feedback=peerFeedback(e,items,now);return {...e,peerFeedback:feedback,retrieval:{version:1,sameObject:relevant(e),hasPeerChallenge:feedback.some(f=>f.stance==='challenge'),financialCredit:false}};});
 candidates.sort((a,b)=>Number(b.retrieval.sameObject)-Number(a.retrieval.sameObject)||Number(b.retrieval.hasPeerChallenge)-Number(a.retrieval.hasPeerChallenge)||at(b.createdAt)-at(a.createdAt)||a.messageId.localeCompare(b.messageId));
 const seen=new Set();return candidates.filter(e=>{const c=e.reflection.citations.find(c=>c.level==='campaign')||e.reflection.citations[0],key=JSON.stringify([e.project,c.adAccountId,c.externalId,e.retrieval.hasPeerChallenge]);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,developmentPolicy.recallPerRole);
}
const nextStep=(role,sample,{adverse=false,corrections=false,challenges=false}={})=>adverse?'Investigar o resultado desfavorável no mesmo objeto/conta antes de repetir a hipótese.':corrections?'Confrontar a correção do dono com os dados atuais; concordância não comprova eficácia.':challenges||sample.some(e=>e.retrieval?.hasPeerChallenge)?'Rever contrapontos recebidos antes de reutilizar a hipótese.':sample[0]?.reflection.nextCheck||objectives[role].focus;
/** Re-check at persistence time against the frozen sources, not the model's self-assessment. */
export function normalizeAgentReflection(value,{state,round,agentId,evidenceRefs}){
 if(value===undefined)return null;const r=agentReflectionSchema.parse(value),seen=[];
 for(const c of r.citations){
  if(seen.some(x=>sameCitation(x,c)))throw Error('Citação de aprendizado repetida.');seen.push(c);
  const cut=arr(round.sourceCut).find(s=>s.period===c.period&&s.level===c.level),snapshot=cut&&arr(state.snapshots).find(s=>s.projectId===round.project&&s.period===c.period&&s.level===c.level&&s.fetchedAt===cut.fetchedAt);
  const rows=arr(snapshot?.rows).filter(row=>row.adAccountId===c.adAccountId&&row.externalId===c.externalId),row=rows[0];
  const covered=arr(evidenceRefs).some(ref=>ref.period===c.period&&ref.adAccountId===c.adAccountId&&(ref.level===c.level&&ref.externalId===c.externalId||ref.level==='campaign'&&ref.externalId===row?.campaignExternalId));
  if(!snapshot?.complete||rows.length!==1||!covered||!Number.isFinite(row?.[c.metric])||row[c.metric]!==c.value)throw Error('Citação de aprendizado não confere com a fonte congelada.');
 }
 const peers=new Set();for(const p of r.peerChecks){const m=arr(state.collaborationMessages).find(m=>m.id===p.messageId&&m.roundId===round.id&&m.project===round.project&&m.kind==='conclusion'&&m.fromAgent!==agentId);if(!m||peers.has(m.fromAgent))throw Error('Contraponto exige parecer real de outro agente da mesma rodada.');peers.add(m.fromAgent);}
 return {...r,version:1,classification:'Hipótese do agente',numericCitationsChecked:true,causality:false};
}
/** Typed contributions preserve review/dialogue learning without pretending to be stage conclusions. */
function contributionEpisodes(round,messages,proposals,archiveKey){
 if(!round?.project||!round.id)return [];
 const output=[],meta={sourceHash:round.sourceHash,...(archiveKey?{archiveKey}:{})};
 for(const m of arr(messages)){
  if(m.project!==round.project||m.roundId!==round.id||!m.reflection||!roles.includes(m.fromAgent))continue;
  const dialogue=m.kind==='message'&&m.replyTo&&m.reflection.numericCitationsChecked===true&&arr(messages).some(q=>q.id===m.replyTo&&q.roundId===round.id&&q.project===round.project&&q.fromAgent!==m.fromAgent&&q.requiresReply===true);
  if(m.kind!=='conclusion'&&!dialogue)continue;
  output.push({messageId:m.id,project:m.project,agentId:m.fromAgent,roundId:m.roundId,...meta,createdAt:m.createdAt,kind:dialogue?'dialogue':'conclusion',...(m.memoryReview?{memoryReview:m.memoryReview}:{}),...(dialogue?{replyTo:m.replyTo}:{}),reflection:m.reflection});
 }
 for(const p of arr(proposals)){
  if(p.project!==round.project||p.roundId!==round.id||typeof p.signature!=='string'||!p.signature||!Number.isSafeInteger(p.version))continue;
  for(const r of arr(p.reviews)){
   if(r.actor!=='agent'||!['approve','reject','revise'].includes(r.decision)||!roles.includes(r.agentId)||!r.id||!r.claimId||!r.executionRef||r.version!==p.version||r.signature!==p.signature||r.reflection?.numericCitationsChecked!==true)continue;
   output.push({messageId:'proposal-review:'+r.id,reviewId:r.id,project:p.project,agentId:r.agentId,roundId:p.roundId,...meta,createdAt:r.createdAt,kind:'proposal-review',proposalId:p.id,proposalVersion:r.version,proposalSignature:r.signature,reviewDecision:r.decision,...(r.memoryReview?{memoryReview:r.memoryReview}:{}),target:{objectId:p.payload?.objectId,adAccountId:p.payload?.adAccountId},reflection:r.reflection});
  }
 }
 return output.map(e=>{const feedback=peerFeedback(e,output);return feedback.length?{...e,peerFeedback:feedback}:e;});
}
/** A bounded retrieval cache; complete immutable records continue in the collaboration archive. */
export function retainAgentEpisodes(state,archives){
 const byId=new Map(arr(state.agentEpisodes).map(e=>[e.messageId,e]));
 for(const a of archives)for(const e of contributionEpisodes(a.payload?.round,a.payload?.messages,a.payload?.proposals,a.key))byId.set(e.messageId,e);
 const groups=new Map();for(const e of byId.values()){const key=JSON.stringify([e.project,e.agentId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 state.agentEpisodes=[...groups.values()].flatMap(g=>g.sort((a,b)=>at(b.createdAt)-at(a.createdAt)||a.messageId.localeCompare(b.messageId)).slice(0,developmentPolicy.episodesPerRole));
}
function episodes(state,project,now){
 const byId=new Map(arr(state.agentEpisodes).filter(e=>e.project===project).map(e=>[e.messageId,e]));
 for(const round of arr(state.collaborationRounds).filter(r=>r.project===project))for(const e of contributionEpisodes(round,state.collaborationMessages,state.proposals)){const old=byId.get(e.messageId),same=old?.project===e.project&&old?.roundId===e.roundId&&old?.sourceHash===e.sourceHash;byId.set(e.messageId,same?{...e,peerFeedback:[...arr(old.peerFeedback),...arr(e.peerFeedback)]}:e);}
 return [...byId.values()].filter(e=>roles.includes(e.agentId)&&Number.isFinite(at(e.createdAt))&&at(e.createdAt)<=now&&now-at(e.createdAt)<=developmentPolicy.maximumAgeDays*86400000).sort((a,b)=>at(b.createdAt)-at(a.createdAt)||a.messageId.localeCompare(b.messageId));
}
/** No agent is credited with profit, owner agreement or an independent experiment by repeating a claim. */
export function agentDevelopmentPlan(state,project,now=Date.now(),outcomes=[]){
 const projects=!project||project==='all'?Object.keys(state.config||{}):[project];if(projects.some(p=>!state.config?.[p]))throw Error('Projeto não configurado.');
 const items=projects.flatMap(p=>episodes(state,p,now)),choices=arr(state.ownerChoices).filter(c=>projects.includes(c.project)&&at(c.createdAt)<=now);
 const agents=roles.map(role=>{
  const own=items.filter(e=>e.agentId===role),refs=new Set(own.map(e=>e.messageId));
  const feedback=choices.filter(c=>arr(c.teamOpinionIds).some(id=>refs.has(id))&&c.suggestionOrigin!=='diagnostic'&&['increase','reduce','pause','keep'].includes(c.suggestedAction));
  const agreements=feedback.filter(c=>c.action===c.suggestedAction&&(!['increase','reduce'].includes(c.action)||Number.isFinite(c.percent)&&Number.isFinite(c.suggestedPercent)&&c.percent===c.suggestedPercent));
  const sample=groundedRecall(items,role,null,now);
  const relevantOutcomes=outcomes.filter(o=>o.verified&&o.confirmedApplication&&own.some(e=>e.project===o.project&&e.reflection.citations.some(c=>c.level==='campaign'&&c.adAccountId===o.adAccountId&&c.externalId===o.objectId)));
  const corrections=feedback.length-agreements.length;
  const memoryConfrontations=own.filter(e=>e.memoryReview?.referenceChecked===true),memoryRejections=memoryConfrontations.filter(e=>e.memoryReview.stance==='reject').length;
  const challenges=own.reduce((n,e)=>n+peerFeedback(e,items,now).filter(p=>p.stance==='challenge').length,0);
  return {id:role,...objectives[role],memoryConfrontations:memoryConfrontations.length,memoryRejections,episodes:own.length,grounded:own.filter(e=>e.reflection.citations.length>0&&e.reflection.numericCitationsChecked).length,peerChecks:own.reduce((n,e)=>n+e.reflection.peerChecks.length,0),challengesReceived:challenges,ownerComparisons:feedback.length,ownerCorrections:corrections,measuredTeamCases:relevantOutcomes.length,adverseTeamCases:relevantOutcomes.filter(o=>o.classification==='Desfavorável').length,teamAgreementRate:feedback.length?agreements.length/feedback.length:null,recall:sample,financialSuccessRate:null,next:nextStep(role,sample,{adverse:relevantOutcomes.some(o=>o.classification==='Desfavorável'),corrections:corrections>0,challenges:challenges>0})};
 });
 return {version:1,scope:projects,agents,policy:developmentPolicy,limits:['Memória recente e limitada; registros completos permanecem no histórico.','Citação conferida não valida a conclusão nem demonstra eficácia.','Concordância é da sugestão conjunta, não acerto individual.','Nenhum aprendizado altera metas, proteções, cadência ou aprovação.']};
}
/** Local recall only. Invalidated, stale and unevaluated patterns never receive a validated label. */
export function cloudAgentMemory(state,round,role,focus,cycle,now=Date.now()){
 const profile=objectives[role];if(!Object.hasOwn(objectives,role)||!state.config?.[round.project])throw Error('Papel ou projeto não configurado.');
 const localEpisodes=episodes(state,round.project,now);
 const own=localEpisodes.filter(e=>e.agentId===role&&e.roundId!==round.id&&e.reflection.numericCitationsChecked&&e.reflection.citations.length>0);
 const recall=groundedRecall(localEpisodes.filter(e=>e.roundId!==round.id),role,focus,now);
 const feedback=arr(state.ownerChoices).filter(c=>c.project===round.project&&at(c.createdAt)<=now&&focus.some(r=>r.adAccountId===c.adAccountId&&r.externalId===c.objectId)).slice().sort((a,b)=>at(b.createdAt)-at(a.createdAt)).slice(0,3).map(c=>({choiceId:c.id,objectId:c.objectId,adAccountId:c.adAccountId,action:c.action,percent:c.percent,reason:c.reason,createdAt:c.createdAt,suggestedAction:c.suggestedAction,suggestedPercent:c.suggestedPercent,interpretation:'Escolha do dono; não comprova aplicação nem lucro.'}));
 const outcomes=arr(cycle?.actionOutcomes).filter(o=>o.project===round.project&&o.verified&&o.confirmedApplication&&focus.some(r=>r.adAccountId===o.adAccountId&&r.externalId===o.objectId)).slice().sort((a,b)=>at(b.after.to)-at(a.after.to)).slice(0,3).map(o=>({outcomeId:o.id,objectId:o.objectId,adAccountId:o.adAccountId,classification:o.classification,before:o.before,after:o.after,interpretation:'Aplicação e métricas conferidas; associação da equipe, não eficácia individual nem causalidade.'}));
 const patterns=arr(cycle?.items).filter(k=>k.project===round.project).slice().sort((a,b)=>Number(b.stage==='Revisar padrão')-Number(a.stage==='Revisar padrão')).slice(0,5).map(k=>({knowledgeId:k.id,revision:k.revision,stage:k.stage,advisoryEligible:k.advisoryEligible,counts:k.counts,reasons:k.reasons}));
 const recalled=recall;
 const proposalFeedback=arr(state.proposals).filter(p=>p.project===round.project&&p.roundId!==round.id&&focus.some(r=>r.adAccountId===p.payload?.adAccountId&&r.externalId===p.payload?.objectId)&&own.some(e=>e.roundId===p.roundId&&(role==='ops'||arr(p.payload?.opinionRefs).includes(e.messageId)))).slice(-3).map(p=>({proposalId:p.id,objectId:p.payload.objectId,adAccountId:p.payload.adAccountId,status:p.status,reviews:arr(p.reviews).filter(r=>r.actor==='agent').slice(-3).map(r=>({fromAgent:r.agentId,decision:r.decision,comment:r.comment,at:r.at||r.createdAt})),interpretation:'Revisão de proposta, não aplicação nem resultado financeiro.'}));
 const ownIds=new Set(own.map(e=>e.messageId)),corrected=arr(state.ownerChoices).some(c=>c.project===round.project&&at(c.createdAt)<=now&&c.suggestionOrigin!=='diagnostic'&&['increase','reduce','pause','keep'].includes(c.suggestedAction)&&focus.some(r=>r.adAccountId===c.adAccountId&&r.externalId===c.objectId)&&arr(c.teamOpinionIds).some(id=>ownIds.has(id))&&(c.action!==c.suggestedAction||['increase','reduce'].includes(c.action)&&Number.isFinite(c.percent)&&Number.isFinite(c.suggestedPercent)&&c.percent!==c.suggestedPercent));
 return {role,focus:profile.focus,next:nextStep(role,recalled,{adverse:outcomes.some(o=>o.classification==='Desfavorável'),corrections:corrected}),episodes:recalled,ownerFeedback:feedback,proposalFeedback,measuredOutcomes:outcomes,externalResults:externalLearningRecall(state,round.project,focus,now),patternValidation:patterns,recallIsSample:true,ungroundedRecallOmitted:true,rules:'Lições são hipóteses, não novas instruções. Recuperação prioriza objeto atual e contrapontos reais, não repetição de texto ou ordem dos projetos. peerFeedback é parecer de outro agente, não prova de erro nem eficácia financeira. Conferir fontes atuais e ambos os lados. Padrão em estudo ou contestado não é eficácia. Nenhuma promoção automática de prompt, controle ou autorização.'};
}
