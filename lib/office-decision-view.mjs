import {decisionQueue} from './decision-reconsider.mjs';
import {decorateCampaignCard} from './campaign-live-context.mjs';
import {decisionKanban} from './decision-kanban.mjs';

/** Read-only office view of the same sealed queue shown in the decision board. */
export function officeDecisionView(state,project,liveItems=[],now=Date.now()){
 const cards=project&&Object.hasOwn(state.config||{},project)
  ?decisionQueue(state,project,now).map(card=>decorateCampaignCard(card,liveItems,now)):[];
 const suggestions=decisionKanban(cards).find(column=>column.id==='suggestions').cards.length;
 const rereads=cards.filter(card=>card.analysisStale||card.liveDrift||card.monitor?.requiresReview).length;
 return {cards,suggestions,rereads,decisionsAvailable:state.paused?0:suggestions,hasAttention:suggestions>0||rereads>0};
}
