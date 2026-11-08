/** Owner direct order from the live reading (owner request of 2026-11-07, "ordem direta com leitura ao vivo").
 * When the four-window analysis is older than an hour (e.g. at night, outside the collection cadence), the order
 * may take its "before" value from the live campaign reading of the last few minutes instead. Safety still comes
 * from the executor: prepare reads Malva again and refuses if the current value differs, then one submit and a
 * reread. Contingency (including the project daily cap when set) still applies. Read-only helpers. */
export const liveOrderLimits=Object.freeze({freshMs:10*60000});
const time=v=>typeof v==='string'?Date.parse(v):NaN;

/** The campaign's row in a fresh, complete, error-free live reading of its project, or null. */
export function liveOrderRow(items,project,adAccountId,objectId,now=Date.now()){
 const item=(Array.isArray(items)?items:[]).find(i=>i?.projectId===project);
 const s=item?.snapshot;if(!s||item.error||s.complete!==true||s.level!=='campaign'||s.source!=='Malva MCP')return null;
 const at=time(s.fetchedAt);if(!Number.isFinite(at)||at>now+5000||now-at>liveOrderLimits.freshMs)return null;
 const rows=(s.rows||[]).filter(r=>r.adAccountId===adAccountId&&r.externalId===objectId);
 return rows.length===1?{row:rows[0],fetchedAt:s.fetchedAt}:null;
}

/** Which orders the live row allows: pause needs ACTIVE; budget needs a native daily budget of its own;
 * an increase also needs an active ad account. The office pause blocks everything. */
export function liveOrderActions(live,{paused=false}={}){
 const r=live?.row,none={increase:false,reduce:false,pause:false,keep:false};if(!r||paused)return none;
 const native=/^[A-Z]{3}$/.test(String(r.budgetCurrency||'')),daily=Number.isFinite(r.dailyBudget)&&r.dailyBudget>0&&!(r.lifetimeBudget>0);
 const meta=String(r.provider||'').toLowerCase()==='meta';
 return {increase:meta&&native&&daily&&r.accountStatus?.active!==false,reduce:meta&&native&&daily,pause:meta&&native&&r.status==='ACTIVE',keep:false};
}

/** What the executor compares at prepare for a live order (instead of the analysis row). */
export function liveTarget(row){return {id:typeof row.id==='string'?row.id:null,dailyBudget:row.dailyBudget??null,lifetimeBudget:row.lifetimeBudget??null,status:row.status??null};}
