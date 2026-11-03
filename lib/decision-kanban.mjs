/** Presentation only: pending cards retain their source identity and authorization. */
export const decisionColumns=Object.freeze([
 {id:'analysis',title:'Em análise',description:'Aguardando conferência do contexto.'},
 {id:'suggestions',title:'Sugestões da equipe',description:'Confira a recomendação e escolha a ação.'},
 {id:'approval',title:'Para aprovar',description:'Propostas exatas prontas para sua confirmação.'},
]);

export function decisionKanban(cards,readyToApprove=(card)=>false){
 const columns=decisionColumns.map(column=>({...column,cards:[]}));
 for(const card of cards){
  const column=readyToApprove(card)?2:card.teamReady&&card.suggestion?.origin==='team'?1:0;
  columns[column].cards.push(card);
 }
 return columns;
}
