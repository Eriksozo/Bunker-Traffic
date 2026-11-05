/** Presentation only: pending cards retain their source identity and authorization. */
export const decisionColumns=Object.freeze([
 {id:'analysis',title:'Revisão dos agentes',description:'O card informa se está na fila, em revisão ou precisa de releitura.'},
 {id:'suggestions',title:'Sugestões da equipe',description:'Confira a recomendação e escolha a ação.'},
 {id:'approval',title:'Para aprovar',description:'Propostas exatas prontas para sua confirmação.'},
]);

const actions=new Set(['increase','reduce','pause','keep']);
const needsReread=card=>!!(card.analysisStale||card.liveDrift||card.monitor?.requiresReview);

/** A diagnostic's fallback keep is never an authored recommendation. */
export function decisionSuggestion(card){
 if(!card||card.teamReady!==true||needsReread(card)||!actions.has(card.suggestion?.action))return null;
 const suggestion=card.suggestion;
 if(suggestion.origin==='team')return suggestion;
 if(suggestion.origin==='proposal'&&['Em revisão','Aguardando aprovação'].includes(card.proposal?.status))return suggestion;
 return null;
}

export function matchesDecisionFilter(card,filter='all'){
 if(filter==='all')return true;
 if(filter==='reread')return needsReread(card);
 const suggestion=decisionSuggestion(card);
 return filter==='pending'?!suggestion:suggestion?.action===filter;
}

/** An active project round is not proof that every campaign is being reviewed.
 * Show in-progress only for this exact campaign in its live claimed batch. */
export function decisionReviewState(card,state={},now=Date.now()){
 if(needsReread(card))return {id:'reread',label:'Releitura necessária',detail:'O cenário mudou ou a análise venceu. A sugestão anterior aguarda nova conferência.'};
 if(decisionSuggestion(card))return {id:'suggestion',label:'Sugestão concluída',detail:'A equipe registrou uma recomendação para este cenário.'};
 const round=(state.collaborationRounds||[]).find(r=>r.id===card.roundId&&r.project===card.project),research=state.cloudResearch?.[card.project];
 const included=round&&research?.jobId===round.jobId&&research.focus?.some(r=>r.adAccountId===card.row?.adAccountId&&r.externalId===card.row?.externalId);
 const claimed=included&&(round.stages||[]).some(stage=>stage.status==='Em análise'&&stage.claimId&&stage.executionRef&&Date.parse(stage.startedAt)<=now&&Date.parse(stage.leaseUntil)>now);
 if(!state.paused&&claimed)return {id:'reviewing',label:'Em revisão nesta rodada',detail:'Esta campanha está no lote de uma etapa com reserva de revisão vigente.'};
 return {id:'pending',label:'Na fila de revisão',detail:'Os dados foram coletados, mas ainda não há uma sugestão conjunta atual para esta campanha.'};
}

export function decisionKanban(cards,readyToApprove=(card)=>false){
 const columns=decisionColumns.map(column=>({...column,cards:[]}));
 for(const card of cards){
  const suggestion=decisionSuggestion(card),column=suggestion&&readyToApprove(card)?2:suggestion?1:0;
  columns[column].cards.push(card);
 }
 return columns;
}
