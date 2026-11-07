import {normalizeAgentReflection} from './agent-development.mjs';
import {recordKnowledge,knowledgeLimits} from './knowledge.mjs';
import {fingerprint} from './collaboration.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {researchHypothesisFingerprint} from './research-hypothesis-reference.mjs';
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||''),roles=['traffic','creative','budget','ops'];
const labels={traffic:'Tráfego',creative:'Criativos',budget:'Orçamento',ops:'Gestão'};
export const automaticHypothesisPolicy=Object.freeze({version:1,activePerRole:2,revisionRequiresExplicitMemoryConfrontation:true,additionalModelCalls:0,providerWrites:false});
const failure=()=>Object.assign(Error('Origem da hipótese automática não conferida.'),{code:'CLOUD_HYPOTHESIS_SOURCE'});
function locked(state,k){return k.status!=='Hipótese'||k.confidence!==0||k.revision!==k.agentOrigin.lastRecordedRevision||arr(k.supportCases).length>0||['learningEnrollments','knowledgeOutcomes','learningReviews'].some(key=>arr(state[key]).some(x=>x.project===k.project&&x.knowledgeId===k.id&&x.phase!=='hypothesis'));}
export function automaticHypothesisPlan(state,project=null){
 const items=arr(state.knowledge).filter(k=>(!project||k.project===project)&&k.agentOrigin?.kind==='cloud-reflection'),active=items.filter(k=>k.status!=='Invalidado');
 return {policy:automaticHypothesisPolicy,registered:items.length,roles:roles.map(agentId=>({agentId,registered:items.filter(k=>k.agentOrigin.agentId===agentId).length,active:active.filter(k=>k.agentOrigin.agentId===agentId).length,protected:active.filter(k=>k.agentOrigin.agentId===agentId&&locked(state,k)).length})),interpretation:'Hipóteses de pesquisa autorais; registro ou revisão não é validação financeira. A revisão depende de contraponto explícito e dados atuais, sem mudar a cadência.'};
}
/** Called in the same CAS as an actual cloud conclusion, after its role, sources and numbers were validated. */
export function registerAgentHypothesis(state,messageId,now=Date.now()){
 const m=arr(state.collaborationMessages).find(m=>m.id===messageId),r=m&&arr(state.collaborationRounds).find(r=>r.id===m.roundId&&r.project===m.project),stage=r?.stages.find(s=>s.agentId===m.fromAgent);
 if(!Number.isFinite(now)||!m||!r||!roles.includes(m.fromAgent)||m.kind!=='conclusion'||stage?.status!=='Concluída'||stage.conclusionId!==m.id||stage.claimId!==m.claimId||stage.executionRef!==m.executionRef||!state.config?.[m.project]||!m.model?.name||!m.model.policy||m.learningInputs?.project!==m.project||m.learningInputs?.role!==m.fromAgent||!r.sourceHash||fingerprint(r.sourceCut)!==r.sourceHash||!Number.isFinite(at(m.createdAt))||at(m.createdAt)>now)throw failure();
 const previous=arr(state.knowledge).find(k=>k.project===m.project&&k.agentOrigin?.latestMessageId===m.id);
 if(previous){if(previous.agentOrigin.sourceHash!==r.sourceHash)throw failure();return {status:'Já registrada',knowledgeId:previous.id,revision:previous.revision};}
 if(state.paused)return {status:'Pausada'};
 if(now-at(m.createdAt)>300000||fingerprint(state.config[m.project])!==r.configFingerprint)throw failure();
 if(!m.reflection?.numericCitationsChecked||!arr(m.reflection.citations).length)return {status:'Sem evidência numérica para hipótese'};
 const raw=Object.fromEntries(['lesson','uncertainty','nextCheck','citations','peerChecks'].map(k=>[k,m.reflection[k]]));
 let reflection;try{reflection=normalizeAgentReflection(raw,{state,round:r,agentId:m.fromAgent,evidenceRefs:m.evidenceRefs});}catch{throw failure();}
 const sources=[{system:'Bunker',reference:'conclusion:'+m.id,observedAt:m.createdAt,summary:'Reflexão autoral do agente; hipótese sem eficácia financeira medida.'}],locators=[];
 for(const c of reflection.citations){
  const cut=arr(r.sourceCut).find(s=>s.period===c.period&&s.level===c.level),snapshot=cut&&arr(state.snapshots).find(s=>s.projectId===m.project&&s.period===c.period&&s.level===c.level&&s.fetchedAt===cut.fetchedAt);
  if(!snapshot||fingerprint(snapshot)!==cut.fingerprint||!Number.isFinite(at(snapshot.fetchedAt))||at(snapshot.fetchedAt)>at(m.createdAt)||snapshot.source!=='Malva MCP')throw failure();
  const row=snapshot.rows.find(x=>x.adAccountId===c.adAccountId&&x.externalId===c.externalId),parents=c.level==='campaign'?[row]:arr(state.snapshots).find(s=>s.projectId===m.project&&s.period===c.period&&s.level==='campaign')?.rows?.filter(x=>x.adAccountId===c.adAccountId&&x.externalId===row?.campaignExternalId);
  if(row?.provider!=='meta'||parents?.length!==1)throw failure();
  if(isWarmupCampaign(row.name)||isWarmupCampaign(parents[0].name))return {status:'Aquecimento fora do aprendizado de vendas'};
  const locator={project:m.project,period:c.period,level:c.level,adAccountId:c.adAccountId,externalId:c.externalId,metric:c.metric,value:c.value,fetchedAt:snapshot.fetchedAt,from:snapshot.from,to:snapshot.to,timezone:snapshot.timezone??null};locators.push(locator);
  const reference='snapshot:'+fingerprint([m.project,c.period,c.level,snapshot.fetchedAt]);
  if(!sources.some(s=>s.reference===reference))sources.push({system:'Malva MCP',reference,observedAt:snapshot.fetchedAt,summary:'Métricas brutas citadas na reflexão; janela parcial não é fechamento nem caso financeiro validado.'});
 }
 const content=fingerprint({lesson:raw.lesson,uncertainty:raw.uncertainty,nextCheck:raw.nextCheck,scope:locators.map(c=>[c.adAccountId,c.externalId,c.level,c.metric]).sort()}),own=arr(state.knowledge).filter(k=>k.project===m.project&&k.agentOrigin?.kind==='cloud-reflection'&&k.agentOrigin.agentId===m.fromAgent).sort((a,b)=>at(b.updatedAt)-at(a.updatedAt));
 const same=own.find(k=>k.status!=='Invalidado'&&k.agentOrigin.lastRecordedRevision===k.revision&&k.agentOrigin.contentFingerprint===content);
 if(same)return {status:'Hipótese já existente',knowledgeId:same.id,revision:same.revision};
 if(own.some(k=>!Number.isFinite(at(k.updatedAt))||at(k.updatedAt)>now))throw failure();
 const active=own.filter(k=>k.status!=='Invalidado'),review=m.memoryReview;
 const confronted=active.find(k=>review?.referenceChecked===true&&review.sourceType==='research-hypothesis'&&review.sourceId===k.id&&['adapt','reject'].includes(review.stance)&&review.currentEvidenceCount>0&&arr(m.learningInputs.researchHypotheses).some(e=>e.id===k.id&&e.project===m.project&&e.agentId===m.fromAgent&&e.revision===k.revision&&e.researchFingerprint===researchHypothesisFingerprint(k)&&e.sourceFingerprint===review.sourceFingerprint));
 if(active.length&&!confronted)return {status:'Aguardando confronto da hipótese',knowledgeId:active[0].id};
 const existing=confronted&&!locked(state,confronted)&&arr(confronted.revisions).length<knowledgeLimits.revisions?confronted:null;
 if(!existing&&active.length>=automaticHypothesisPolicy.activePerRole)return {status:'Hipóteses aguardam revisão',active:active.length};
 if(!existing&&arr(state.knowledge).length>=knowledgeLimits.entries)return {status:'Base de hipóteses cheia'};
 const input={project:m.project,...(existing?{id:existing.id,expectedRevision:existing.revision}:{}),topic:'Hipótese de '+labels[m.fromAgent],claim:'Lição a investigar: '+reflection.lesson+'\nIncerteza: '+reflection.uncertainty+'\nPróxima conferência: '+reflection.nextCheck,status:'Hipótese',confidence:0,supportCases:[],sources};
 const saved=recordKnowledge(state,input,new Date(now).toISOString());
 saved.agentOrigin={version:1,kind:'cloud-reflection',agentId:m.fromAgent,firstMessageId:existing?.agentOrigin.firstMessageId||m.id,latestMessageId:m.id,roundId:r.id,sourceHash:r.sourceHash,lastRecordedRevision:saved.revision,contentFingerprint:content,citations:locators,peerChecks:structuredClone(reflection.peerChecks),...(confronted?{reconsideration:{knowledgeId:confronted.id,knowledgeRevision:confronted.revision,stance:review.stance,reason:review.reason,sourceFingerprint:review.sourceFingerprint}}:{}),financialConfidence:'Não medida; zero é somente o valor inicial obrigatório do registro.'};
 saved.revisions.at(-1).agentOrigin=structuredClone(saved.agentOrigin);
 return {status:existing?'Hipótese revisada':'Hipótese registrada',knowledgeId:saved.id,revision:saved.revision,financiallyValidated:false};
}
