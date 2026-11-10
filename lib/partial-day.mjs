/**
 * Partial day after a profitable yesterday (owner context of 10/11/2026, a manager's note paraphrased:
 * profit yesterday, half a ticket spent today, no reason to touch; no real values here).
 * A campaign whose closed yesterday has a known profit and that has spent less than one ticket today has no sale signal
 * yet: today's missing sale is not evidence. Cuts and pauses that would rest on today are held while today's spend stays
 * under one ticket and is still covered by yesterday's profit (yesterday plus today stays positive even with no sale yet).
 * The cover keeps the owner's decision of 08/11/2026: a day-2 test that sold yesterday with a thin profit and burned more
 * than that today without a sale is still held to the first-24h ceiling. Increases are not touched here, and a first-day
 * test (no yesterday) never qualifies, so the test-launch protocol keeps its priority review from the first day.
 *
 * Ticket: the project's front ticket from the private policy (BRL) when present; otherwise the campaign's own 7-day cost
 * per front sale, the spend one sale usually takes there. Neither known: N/D, nothing is held.
 * Pure: no provider call, no write, no approval.
 */
export const partialDayPolicy=Object.freeze({version:1,minTickets:1});
const finite=Number.isFinite,round2=n=>Math.round(n*100)/100;

/** `yesterday`, `today`, `week`: totals from lib/analysis.mjs `sum` (BRL metrics), or null when the window is absent. */
export function partialDayHold({yesterday=null,today=null,week=null}={},{ticketFront=null}={}){
 const ticket=finite(ticketFront)&&ticketFront>0?{value:round2(ticketFront),source:'project'}
  :finite(week?.spend)&&week.spend>0&&finite(week?.frontOrders)&&week.frontOrders>0?{value:round2(week.spend/week.frontOrders),source:'cpa7d'}:null;
 const yesterdayResult=finite(yesterday?.result)?round2(yesterday.result):null,todaySpend=finite(today?.spend)?round2(today.spend):null;
 const spentTickets=ticket&&todaySpend!==null?round2(todaySpend/ticket.value):null;
 const covered=yesterdayResult!==null&&yesterdayResult>0&&todaySpend!==null&&todaySpend<=yesterdayResult;
 const hold=covered&&spentTickets!==null&&spentTickets<partialDayPolicy.minTickets;
 return {version:partialDayPolicy.version,yesterdayResult,yesterdayRoi:finite(yesterday?.roi)?round2(yesterday.roi):null,todaySpend,ticket:ticket?.value??null,ticketSource:ticket?.source??null,spentTickets,coveredByYesterday:covered,hold};
}

/** Short pt-BR reason for a held cut or pause. */
export function partialDayReason(h){
 return `Ontem fechou com lucro de R$${h.yesterdayResult} e hoje gastou R$${h.todaySpend}, ${h.spentTickets} ticket (ticket R$${h.ticket}${h.ticketSource==='cpa7d'?', custo por venda front de 7 dias':''}): hoje ainda não tem sinal de venda e o lucro de ontem cobre o gasto de hoje. Segurar corte ou pausa até o gasto de hoje passar de 1 ticket ou do lucro de ontem.`;
}
