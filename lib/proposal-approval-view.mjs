/** The exact confirmation shown in the Escritório before the owner approves a proposal, the same presentation as the
 * Cards' "Autorizar esta execução?" (account, object, version, currency, before → after, validity). Web only and
 * presentation only: it never decides whether a proposal may be approved (the panel's existing checks and the backend
 * stay authoritative) and it never turns an intention into an approval. The freeze pins the confirmation to the exact
 * proposal version the owner opened: any change closes it instead of approving something else. */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const text=value=>typeof value==='string'&&value.trim()?value:null;

/** @param {any} proposal */
export function proposalApprovalFreeze(proposal){
 const p=proposal?.payload||{};
 return {id:proposal?.id??null,version:proposal?.version??null,signature:proposal?.signature??null,
  target:JSON.stringify([p.provider??null,p.adAccountId??null,p.level??null,p.objectId??null,p.action??null,p.currency??null,p.before??null,p.after??null])};
}

/** True only when the proposal on screen is still exactly the one the confirmation was opened for.
 * @param {ReturnType<typeof proposalApprovalFreeze>|null} freeze @param {any} proposal */
export function sameApprovalTarget(freeze,proposal){
 if(!freeze||!proposal||freeze.id===null||freeze.signature===null)return false;
 const now=proposalApprovalFreeze(proposal);
 return now.id===freeze.id&&now.version===freeze.version&&now.signature===freeze.signature&&now.target===freeze.target;
}

/**
 * The rows of the confirmation. Missing values stay null (shown as N/D), never guessed.
 * @param {any} proposal
 */
export function proposalApprovalView(proposal){
 const p=proposal?.payload||{},before=p.before||{},after=p.after||{},budget=p.action==='budget';
 const changePercent=budget&&finite(before.dailyBudget)&&before.dailyBudget>0&&finite(after.dailyBudget)?Math.round((after.dailyBudget/before.dailyBudget-1)*1000)/10:null;
 return {
  freeze:proposalApprovalFreeze(proposal),
  campaign:text(p.objectName),level:text(p.level),objectId:text(p.objectId)??(finite(p.objectId)?String(p.objectId):null),
  accountName:text(p.accountName),adAccountId:text(p.adAccountId),provider:text(p.provider),
  version:finite(proposal?.version)?proposal.version:null,
  kind:budget?'budget':'status',
  currency:budget&&typeof p.currency==='string'&&/^[A-Z]{3}$/.test(p.currency)?p.currency:null,
  before:budget?(finite(before.dailyBudget)?before.dailyBudget:null):text(before.status),
  after:budget?(finite(after.dailyBudget)?after.dailyBudget:null):text(after.status),
  changePercent,
  expiresAt:text(proposal?.expiresAt),
 };
}
