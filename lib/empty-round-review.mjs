import {fingerprint,collaborationPlan} from './collaboration.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {learningPeerPacket} from './learning-peer-review.mjs';
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||'');
/** A system observation, never a fabricated opinion or an owner keep decision. */
export function emptyRoundEligibility(state,round,now=Date.now()){
 if(!round||state.paused||round.systemReview||round.stages.some(s=>s.status!=='Pendente'||s.attempt||s.claimId)||arr(state.collaborationMessages).some(m=>m.roundId===round.id)||arr(state.proposals).some(p=>p.roundId===round.id))return false;
 const job=arr(state.jobs).find(j=>j.id===round.jobId&&j.project===round.project&&j.status==='Concluída');if(!job)return false;
 if(collaborationPlan(state,now).rounds.find(r=>r.roundId===round.id)?.blocked)return false;
 const cuts=arr(round.sourceCut);if(cuts.length!==12)return false;
 for(const period of ['7d','3d','yesterday','today'])for(const level of ['campaign','adset','ad']){
  const cut=cuts.find(c=>c.period===period&&c.level===level),source=arr(state.snapshots).find(s=>s.projectId===round.project&&s.period===period&&s.level===level);
  if(!cut||!source?.complete||source.source!=='Malva MCP'||fingerprint(source)!==cut.fingerprint||!Number.isFinite(at(source.fetchedAt))||at(source.fetchedAt)>now||now-at(source.fetchedAt)>=3600000)return false;
 }
 const today=arr(state.snapshots).find(s=>s.projectId===round.project&&s.period==='today'&&s.level==='campaign');
 if(today.analysisScope?.kind!=='meta-operating-cohort'||!['activeComplete','spentComplete','trackedComplete'].every(k=>today.analysisScope[k]===true))return false;
 const sales=arr(today.rows).filter(r=>!isWarmupCampaign(r.name));
 if(sales.some(r=>r.provider!=='meta'||typeof r.status!=='string'||!Number.isFinite(r.spend)||r.spend<0||r.status==='ACTIVE'&&r.spend>0))return false;
 if(['traffic','creative','budget'].some(role=>learningPeerPacket(state,round.project,role,now)))return false;
 return true;
}
export function closeEmptyRound(state,roundId,now=Date.now()){
 const round=arr(state.collaborationRounds).find(r=>r.id===roundId);if(!emptyRoundEligibility(state,round,now))return {status:'Releitura necessária'};
 const checkedAt=new Date(now).toISOString();round.systemReview={kind:'no-eligible-campaigns',at:checkedAt,sourceHash:round.sourceHash,author:'system',scope:'Meta ativas com gasto; aquecimento excluído',reason:'Não há campanha elegível para uma nova análise individual nesta fonte. Não houve parecer de agente, recomendação de manter ou decisão do dono.'};
 round.status='Sem campanhas elegíveis';round.completedAt=checkedAt;round.updatedAt=checkedAt;
 for(const stage of round.stages){stage.status='Dispensada';stage.dispensedAt=checkedAt;stage.reason='Triagem do sistema: sem alvo elegível. Não é parecer concluído.';}
 return {status:round.status,roundId,project:round.project,modelCalls:0,providerWrites:false};
}
