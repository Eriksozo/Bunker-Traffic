/** Owner feedback is not a financial authorization. Native shape and identity
 * remain required for a meaningful reference, even if its analysis has expired. */
export function isManualDecision(input){return input?.op==='cardDecision'&&input.approveExact!==true;}
export function decisionIntentActions(card){
 const row=card?.row||{},identity=!!card?.project&&!!row.externalId&&!!row.adAccountId&&String(row.provider||'').toLowerCase()==='meta';
 const native=/^[A-Z]{3}$/.test(row.budgetCurrency||''),daily=Number.isFinite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0);
 return {increase:identity&&native&&daily&&row.accountStatus?.active!==false,reduce:identity&&native&&daily,pause:identity&&native&&row.status==='ACTIVE',keep:identity};
}
