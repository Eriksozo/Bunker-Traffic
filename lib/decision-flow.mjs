import {candidates} from './analysis.mjs';
import {decisionQueue} from './decision-reconsider.mjs';

const campaignKey=(project,row)=>[project,row?.adAccountId,row?.externalId].every(value=>typeof value==='string'&&value.length>0)?JSON.stringify([project,row.adAccountId,row.externalId]):null;

/** Keep every decision entry point on the same pending campaign queue.
 * Metrics, owner history and financial authorizations remain unchanged.
 */
export function pendingCampaignCandidates(state,project='all',now=Date.now()){
 const pending=new Set(decisionQueue(state,project,now).map(card=>campaignKey(card.project,card.row)).filter(key=>key!==null));
 return candidates(state,project,now).filter(candidate=>{
  const key=campaignKey(candidate.row?.projectId,candidate.row);
  return key!==null&&pending.has(key);
 });
}
