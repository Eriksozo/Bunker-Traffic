import {fingerprint,collaborationPlan} from './collaboration.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {learningPeerPacket} from './learning-peer-review.mjs';
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||'');
/** A system observation, never a fabricated opinion or an owner keep decision. */
export function systemRoundEligibility(state,round,now=Date.now()){
 if(!round||state.paused||round.systemReview||round.stages.some(s=>s.status!=='Pendente'||s.attempt||s.claimId)||arr(state.collaborationMessages).some(m=>m.roundId===round.id)||arr(state.proposals).some(p=>p.roundId===round.id))return false;
 const job=arr(state.jobs).find(j=>j.id===round.jobId&&j.project===round.project&&j.status==='Concluída');if(!job)return false;
 if(collaborationPlan(state,now).rounds.find(r=>r.roundId===round.id)?.blocked)return false;
 const cuts=arr(round.sourceCut);if(cuts.length!==12)return false;
 for(const period of ['7d','3d','yesterday','today'])for(const level of ['campaign','adset','ad']){
  const cut=cuts.find(c=>c.period===period&&c.level===level),source=arr(state.snapshots).find(s=>s.projectId===round.project&&s.period===period&&s.level===level);
  if(!cut||!source?.complete||source.source!=='Malva MCP'||fingerprint(source)!==cut.fingerprint||!Number.isFinite(at(source.fetchedAt))||at(source.fetchedAt)>now||now-at(source.fetchedAt)>=3600000)return false;
 }
 const today=arr(state.snapshots).find(s=>s.projectId===round.project&&s.period==='today'&&s.level==='campaign');
 if(today.analysisScope?.kind!=='meta-operating-cohort'||!['activeComplete','spentComplete'].every(k=>today.analysisScope[k]===true))return false;
 if(!Array.isArray(today.rows)||today.rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))return false;
 const sales=today.rows.filter(r=>!isWarmupCampaign(r.name));
 if(sales.some(r=>r.provider!=='meta'||typeof r.status!=='string'||!Number.isFinite(r.spend)||r.spend<0||r.status==='ACTIVE'&&r.spend>0))return false;
 if(['traffic','creative','budget'].some(role=>learningPeerPacket(state,round.project,role,now)))return false;
 const scope=today.analysisScope;if(scope.unavailableTracked!==undefined&&!Array.isArray(scope.unavailableTracked))return false;
 const missing=arr(scope.unavailableTracked);
 if(scope.trackedComplete===true&&!missing.length)return {kind:'no-eligible-campaigns',confirmedRows:today.rows.length,unavailableTrackedCount:0};
 if(scope.trackedComplete!==false||!missing.length||!Number.isSafeInteger(scope.trackedCount)||scope.trackedCount<missing.length)return false;
 const seen=new Set(),ids=new Set();for(const r of missing){
  if(!r||typeof r!=='object'||Array.isArray(r))return false;
  const key=JSON.stringify([r.adAccountId,r.externalId]);
  if(!['id','adAccountId','externalId'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=200)||r.reason!=='no-current-row'||typeof r.checkedAt!=='string'||!Number.isFinite(at(r.checkedAt))||at(r.checkedAt)<at(today.fetchedAt)||at(r.checkedAt)>now||seen.has(key)||ids.has(r.id)||today.rows.some(known=>known.id===r.id||known.adAccountId===r.adAccountId&&known.externalId===r.externalId))return false;
  seen.add(key);ids.add(r.id);
 }
 return {kind:'unavailable-tracked-only',confirmedRows:today.rows.length,unavailableTrackedCount:missing.length};
}
export function emptyRoundEligibility(state,round,now=Date.now()){return systemRoundEligibility(state,round,now)?.kind==='no-eligible-campaigns';}
export function closeSystemRound(state,roundId,now=Date.now()){
 const round=arr(state.collaborationRounds).find(r=>r.id===roundId),review=systemRoundEligibility(state,round,now);if(!review)return {status:'Releitura necessária'};
 const pending=review.kind==='unavailable-tracked-only',checkedAt=new Date(now).toISOString();
 round.systemReview={...review,at:checkedAt,sourceHash:round.sourceHash,author:'system',scope:'Meta ativas com gasto nas linhas confirmadas; aquecimento excluído',reason:pending?`${review.confirmedRows} linhas confirmadas sem campanha de vendas elegível neste recorte; ${review.unavailableTrackedCount} campanhas acompanhadas continuam sem leitura atual. Seu estado e resultado permanecem desconhecidos. Releitura na próxima coleta elegível. Não houve parecer de agente, recomendação de manter ou decisão do dono.`:'Não há campanha elegível para uma nova análise individual nesta fonte. Não houve parecer de agente, recomendação de manter ou decisão do dono.'};
 round.status=pending?'Fonte pendente':'Sem campanhas elegíveis';round.completedAt=checkedAt;round.updatedAt=checkedAt;
 for(const stage of round.stages){stage.status='Dispensada';stage.dispensedAt=checkedAt;stage.reason=pending?'Triagem do sistema: campanhas acompanhadas sem linha atual. Não é análise concluída.':'Triagem do sistema: sem alvo elegível. Não é parecer concluído.';}
 return {status:round.status,roundId,project:round.project,modelCalls:0,providerWrites:false};
}
export function closeEmptyRound(state,roundId,now=Date.now()){
 const round=arr(state.collaborationRounds).find(r=>r.id===roundId);return emptyRoundEligibility(state,round,now)?closeSystemRound(state,roundId,now):{status:'Releitura necessária'};
}
