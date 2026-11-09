/** Presentation only: one prioritized list built from the same kanban stages.
 * Ordering never grants authorization; every action still passes the card's own checks. */
const stageRank={approval:0,suggestions:1,analysis:2};
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Key figures shown side by side. "Today" comes only from the current reading (liveToday),
 * like the board's live scenario; the frozen analysis day is never relabelled as today.
 * Missing values stay null (rendered as N/D), never zero. */
export function decisionListMetrics(card){
 const row=card?.observedRow||card?.row||{},today=card?.liveToday||{},recent=card?.windows?.['3d']||{};
 return {
  spendToday:finite(today.spend)?today.spend:null,
  frontToday:finite(today.frontOrders)?today.frontOrders:null,
  liveStale:!!(card?.liveToday&&(card.liveStale||card.liveSourceStale)),
  dailyBudget:finite(row.dailyBudget)?row.dailyBudget:null,
  budgetCurrency:typeof row.budgetCurrency==='string'?row.budgetCurrency:null,
  roas3d:finite(recent.roas)?recent.roas:null,
  front3d:finite(recent.frontOrders)?recent.frontOrders:null,
 };
}

/** Flatten kanban columns: ready-to-approve first, then team suggestions, then campaigns still in review.
 * Inside a stage, higher spend today comes first so money at stake is seen before the rest. */
export function decisionList(columns){
 const rows=[];
 for(const column of Array.isArray(columns)?columns:[])for(const card of Array.isArray(column?.cards)?column.cards:[])rows.push({card,stage:column.id,metrics:decisionListMetrics(card)});
 const name=row=>String((row.card.observedRow||row.card.row||{}).name||'');
 // Ordering only: without a live reading the analysis day's spend still ranks the money at stake (the label stays N/D).
 const stake=row=>row.metrics.spendToday??(finite(row.card?.windows?.today?.spend)?row.card.windows.today.spend:-1);
 const urgent=row=>row.card?.testLaunch?.priority===true?1:0;
 return rows.sort((a,b)=>(stageRank[a.stage]??9)-(stageRank[b.stage]??9)||urgent(b)-urgent(a)||stake(b)-stake(a)||name(a).localeCompare(name(b),'pt-BR'));
}
