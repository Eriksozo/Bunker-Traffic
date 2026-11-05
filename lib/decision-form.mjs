/** Shared, side-effect-free guards for the decision editor. Server authorization
 * remains authoritative; these checks never grant provider execution. */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const budgetActions=new Set(['increase','reduce']);
const actions=new Set([...budgetActions,'keep','pause']);
export function decisionPercent(draft){
 if(!budgetActions.has(draft?.action)||typeof draft.percent!=='string')return null;
 const value=draft.percent.trim();
 if(!/^\d+(?:[.,]\d+)?$/.test(value))return null;
 const number=Number(value.replace(',','.'));return finite(number)?number:null;
}
export function validDecisionPercent(draft){
 if(!actions.has(draft?.action))return false;
 if(!budgetActions.has(draft.action))return true;
 const value=decisionPercent(draft);
 return value!==null&&value>0&&(draft.action==='increase'?value<=1000:value<100);
}
export function decisionBudgetAfter(before,action,percent){
 if(!finite(before)||before<=0||!finite(percent)||!budgetActions.has(action))return null;
 return Math.round((before*(1+(action==='increase'?1:-1)*percent/100)+Number.EPSILON)*100)/100;
}
export function decisionDraftError(card,draft){
 if(!validDecisionPercent(draft))return 'Informe um percentual válido: aumento até 1.000%; redução menor que 100%.';
 if(budgetActions.has(draft.action)){
  const row=card?.row||{},after=decisionBudgetAfter(row.dailyBudget,draft.action,decisionPercent(draft));
  if(row.lifetimeBudget>0||after===null||after<=0||after>1e9||after===row.dailyBudget)return 'A variação precisa gerar um novo orçamento diário válido em centavos.';
 }
 return null;
}
export function exactDecisionProposal(card,draft,now=Date.now()){
 if(!finite(now)||decisionDraftError(card,draft)||card?.analysisStale||card?.liveDrift||card?.monitor?.requiresReview)return null;
 const proposal=card?.proposal,p=proposal?.payload||{},row=card?.row||{},expiry=Date.parse(proposal?.expiresAt);
 if(!proposal||proposal.status!=='Aguardando aprovação'||typeof proposal.signature!=='string'||!proposal.signature.trim()||!Number.isSafeInteger(proposal.version)||proposal.version<1||!Number.isFinite(expiry)||expiry<=now||proposal.project!==card.project||p.level!=='campaign'||!row.externalId||!row.adAccountId||!row.budgetCurrency||!row.provider||p.objectId!==row.externalId||p.adAccountId!==row.adAccountId||p.currency!==row.budgetCurrency||p.provider!==row.provider)return null;
 const after=decisionBudgetAfter(row.dailyBudget,draft.action,decisionPercent(draft));
 if(budgetActions.has(draft.action)&&p.action==='budget'&&p.before?.dailyBudget===row.dailyBudget&&after!==null&&p.after?.dailyBudget===after&&p.budgetOwner==='CBO')return proposal;
 if(draft.action==='pause'&&p.action==='status'&&row.status==='ACTIVE'&&p.before?.status===row.status&&p.after?.status==='PAUSED')return proposal;
 return null;
}
/** A source replacement must never silently rebase a draft onto new money. */
export function sameDecisionSession(session,card){return !!session&&!!card&&session.id===card.id&&session.signature===card.signature;}

/** Observations use ISO strings; incident markers can also use epoch milliseconds. */
export function decisionTimestamp(value){
 const timestamp=typeof value==='number'?value:typeof value==='string'&&value.trim()?Date.parse(value):NaN;
 return Number.isFinite(timestamp)&&Math.abs(timestamp)<=8640000000000000?timestamp:NaN;
}
