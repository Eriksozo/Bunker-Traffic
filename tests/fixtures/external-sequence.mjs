import {collectHistoryLearning,persistHistoryLearning} from '../../lib/cloud-history-learning.mjs';
import {collectExternalLearning,persistExternalLearning,externalLearningRecall} from '../../lib/external-learning.mjs';
import {historyNow as now,historyProject as project,historyRow as row,historyEvent} from './history-learning.mjs';
export {now,project,row};
export async function sequenceFixture(){
 const root=historyEvent(3),t=Date.parse(root.at),events=[root,
  historyEvent(3,{id:'scale-again',at:new Date(t+3600000).toISOString(),values:{kind:'money',field:'daily_budget',currency:'USD',from:120,to:180}}),
  historyEvent(3,{id:'reduce-later',at:new Date(t+2*3600000).toISOString(),values:{kind:'money',field:'daily_budget',currency:'USD',from:180,to:90}}),
  historyEvent(3,{id:'pause-later',at:new Date(t+3*3600000).toISOString(),category:'status',values:{kind:'status',field:'status',currency:'USD',from:'ACTIVE',to:'PAUSED'}}),
  historyEvent(3,{id:'child-edit',at:new Date(t+1800000).toISOString(),category:'creative',object:{level:'ad',externalId:'child',campaign:{externalId:'c'}},values:{kind:'text',field:'video',from:'old',to:'new'}})
 ];
 const state={config:{p:{projectName:'John'},q:{projectName:'Other'}},snapshots:[{projectId:'p',level:'campaign',rows:[row]}],paused:false};
 const history=await collectHistoryLearning({read:async()=>({items:events.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),nextCursor:null,timezone:'UTC',period:{from:'2026-10-01T00:00:00Z',to:'2026-11-06T00:00:00Z',timezone:'UTC'}})},project,row,null,{now:()=>now});persistHistoryLearning(state,history,now);
 const source={read:async(tool,a)=>{if(tool!=='tracking_campaigns')throw Error('No new history read expected');const before=a.from==='2026-11-01',start=Date.parse(a.from+'T00:00:00Z');return {level:'campaign',salesScope:{kind:'traffic'},currency:'BRL',period:{days:[a.from],from:new Date(start).toISOString(),to:new Date(start+86400000).toISOString(),timezone:'UTC'},freshAt:new Date(now-1000).toISOString(),lastSyncAt:new Date(now-60000).toISOString(),rows:[{...row,spend:100,revenueNet:before?150:250,adCosts:4,productCost:0,saleTax:0,frontOrders:before?2:3,orders:before?5:8,checkouts:4,impressions:1000,linkClicks:20}]};}};
 const result=await collectExternalLearning(source,state,project,{now:()=>now}),saved=persistExternalLearning(state,result,now);
 if(saved.status!=='Inconclusivo')throw Error('The synthetic sequence must not become a favorable isolated action');
 const recall=externalLearningRecall(state,'p',[row],now)[0],comparison=state.decisionHistoryOutcomes[0],event=state.decisionHistory.find(e=>e.id===comparison.eventId);
 return {state,comparison,event,recall};
}
