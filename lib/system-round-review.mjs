const statuses=Object.freeze({'no-eligible-campaigns':'Sem campanhas elegíveis','unavailable-tracked-only':'Fonte pendente'});
export function systemRoundReviewKind(round){const kind=round?.systemReview?.kind;return Object.hasOwn(statuses,kind)?kind:null;}
export function closedSystemRound(round,now=Date.now()){
 const kind=systemRoundReviewKind(round),r=round?.systemReview;
 return !!kind&&round.status===statuses[kind]&&r.author==='system'&&typeof round.sourceHash==='string'&&!!round.sourceHash&&r.sourceHash===round.sourceHash&&typeof r.at==='string'&&Number.isFinite(Date.parse(r.at))&&Number.isFinite(now)&&Date.parse(r.at)<=now&&round.completedAt===r.at&&Array.isArray(round.stages)&&round.stages.length===4&&new Set(round.stages.map(s=>s.agentId)).size===4&&round.stages.every(s=>['traffic','creative','budget','ops'].includes(s.agentId)&&s.status==='Dispensada'&&!(s.attempt||0)&&!s.startedAt&&!s.completedAt&&!s.claimId&&!s.conclusionId);
}
export function systemRoundTitle(round){return systemRoundReviewKind(round)==='unavailable-tracked-only'?'Há campanhas aguardando leitura atual':'Sem campanhas elegíveis nesta leitura';}
