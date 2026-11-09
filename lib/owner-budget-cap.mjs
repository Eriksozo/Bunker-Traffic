/** The owner's daily-budget ceiling for one campaign (owner decision of 09/11/2026: "Yes, check the cap").
 *
 * The same ceiling the Sombra uses for its increase rules (`budgetCaps[adAccountId]`, else `budgetCap`, from the
 * private policy with the owner's layer), in the campaign's native currency. Hand-typed owner orders (direct order and
 * card order) are held to it: an increase whose new daily budget passes it is refused before anything is recorded.
 * Reductions and pauses are never limited. No ceiling configured → no limit (as before), shown as such.
 *
 * Pure: the route parses the policy from the Worker secrets; nothing here reads or prints them. */
const finite=Number.isFinite;

/** @param {any} policy parsed private policy (ownerShadowPolicy output) @param {string} project @param {string} adAccountId */
export function ownerBudgetCap(policy,project,adAccountId){
 const p=policy?.projects?.[project];if(!p||typeof p!=='object')return null;
 const byAccount=p.budgetCaps&&typeof p.budgetCaps==='object'?p.budgetCaps[adAccountId]:undefined;
 const v=finite(byAccount)&&byAccount>0?byAccount:p.budgetCap;
 return finite(v)&&v>0?v:null;
}

/** Largest whole percent increase that stays within the ceiling (0 when the budget is already at or above it). */
export function maxIncreasePercent(before,cap){
 if(!finite(before)||before<=0||!finite(cap)||cap<=0||before>=cap)return 0;
 return Math.min(1000,Math.floor((cap/before-1)*100+1e-9));
}

const money=v=>v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

/** Null when the change is within the ceiling (or is not an increase, or there is no ceiling); else the refusal text. */
export function capRefusal({cap,before,after,currency}){
 if(!finite(cap)||!finite(after)||!finite(before)||after<=before||after<=cap+0.0005)return null;
 const unit=typeof currency==='string'&&currency?' '+currency:'',max=maxIncreasePercent(before,cap);
 return {cap,maxPercent:max,message:`Acima do seu teto de orçamento diário (${money(cap)}${unit}). `+(max>=1?`Aumento máximo agora: ${max}%.`:'O orçamento atual já está no teto: só reduzir ou pausar.')};
}

/** What the notch shows next to "Executar agora". */
export function capView(cap,before,currency){
 return finite(cap)?{dailyBudget:cap,currency:typeof currency==='string'?currency:null,maxIncreasePercent:finite(before)&&before>0?maxIncreasePercent(before,cap):null}:null;
}
