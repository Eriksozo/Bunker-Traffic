/** Compact read-only summary for the Mac companion (notch and menu bar).
 * Built from the saved central only: no provider call, no write, no secret, no approval. */
import {pendingCampaignCandidates} from './decision-flow.mjs';
import {dailyComparison,actionQueue,pausedAfterAnalysis} from './daily-brief.mjs';
import {activityLog,activitySummary} from './campaign-activity.mjs';
import {ALL_PROJECTS} from './project-scope.mjs';
import {sum} from './analysis.mjs';
import {budgetPace} from './budget-pace.mjs';
import {ownerOrderReceipts} from './owner-orders.mjs';

const arr=value=>Array.isArray(value)?value:[];
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const agentNames=Object.freeze({traffic:'Lia',creative:'Nina',budget:'Theo',ops:'Cai'});
export const companionLimits=Object.freeze({queue:5,activity:12,messages:8,hours:24});
const clip=(value,max)=>typeof value==='string'?(value.length>max?value.slice(0,max-1)+'…':value):null;

/** A closed window absent from a verified complete spent-only cut had no spend there.
 * Sales are not observed by such a cut, so orders, ROAS and ROI stay N/D. Any other absence stays N/D. */
const windowOf=(row,noSpend=false)=>{if(!row)return noSpend?{spend:0,roas:null,roi:null,frontOrders:null,cpaFront:null,noSpend:true}:null;const t=sum([row]);return {spend:t.spend,roas:t.roas,roi:t.roi,frontOrders:t.frontOrders,cpaFront:t.cpaFront};};
/** Drill-down for the notch: the four windows, native budget and status, and this campaign's latest changes. */
function campaignDetail(c,events){
 const row=c.row,mine=events.filter(e=>e.adAccountId===row.adAccountId&&e.objectId===row.externalId).slice(0,4);
 return {projectId:row.projectId,malvaObjectId:typeof row.id==='string'?row.id:null,status:row.effectiveStatus||row.status||null,dailyBudget:Number.isFinite(row.dailyBudget)?row.dailyBudget:null,budgetCurrency:row.budgetCurrency||null,
  reason:clip(c.reason,280),windows:Object.fromEntries(['today','yesterday','3d','7d'].map(p=>[p,windowOf(c.windows?.[p],p!=='today'&&arr(c.noSpendPeriods).includes(p))])),
  changes:activityItems(mine)};
}
function queueItems(candidates,events,now){
 return actionQueue(candidates,{limit:companionLimits.queue,now,pausedKeys:pausedAfterAnalysis(candidates,{events})}).items.map(item=>{const row=item.candidate.row;return {kind:item.kind,campaign:clip(row.name,160),account:clip(row.accountName,120),project:clip(row.projectName,80),adAccountId:row.adAccountId,campaignId:row.externalId,decision:item.candidate.decision,period:item.period,basis:item.basis,amount:item.amount,spend:item.spend,roas:item.roas,roas7d:item.comparison,detail:campaignDetail(item.candidate,events)};});
}
/** One line per configured project for the notch scoreboard (always all projects, whatever the current scope). */
export function projectBoard(state,now=Date.now()){
 return Object.entries(state.config||{}).map(([id,c])=>{
  const today=dailyComparison(state,id),candidates=pendingCampaignCandidates(state,id,now),events=activityLog(state,{project:id,since:now-companionLimits.hours*3600000,now});
  const queue=actionQueue(candidates,{limit:50,now,pausedKeys:pausedAfterAnalysis(candidates,{events})}),changes=events.length;
  const approvals=arr(state.proposals).filter(p=>p.project===id&&p.status==='Aguardando aprovação'&&!(time(p.expiresAt)<=now)).length;
  return {id,name:c?.projectName||id,spend:today.today?.spend??null,roas:today.today?.roas??null,roi:today.today?.roi??null,roasYesterday:today.yesterday?.roas??null,approvals,losses:queue.items.filter(i=>i.kind==='loss').length,changes};
 }).sort((a,b)=>(b.spend??-1)-(a.spend??-1));
}
function activityItems(events){
 return events.slice(0,companionLimits.activity).map(e=>({action:e.action,field:e.field,before:e.before,after:e.after,percent:e.percent,currency:e.currency,at:e.at,from:e.from,actor:e.origin==='bunker'?'Bunker · aprovado por você':e.actor,origin:e.origin,campaign:clip(e.name,160),account:clip(e.accountName,120),campaignId:e.objectId}));
}

/** One project, or every configured project when `project` is ALL_PROJECTS. */
export function companionSummary(state,{project=ALL_PROJECTS,now=Date.now(),executor=null,board=null}={}){
 const config=state?.config||{},projects=Object.entries(config).map(([id,c])=>({id,name:c?.projectName||id})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 if(project!==ALL_PROJECTS&&!Object.hasOwn(config,project))throw Error('Projeto não configurado.');
 const inScope=p=>project===ALL_PROJECTS||p===project;
 const candidates=pendingCampaignCandidates(state,project,now);
 const events=activityLog(state,{project,since:now-companionLimits.hours*3600000,now});
 const approvals=arr(state.proposals).filter(p=>inScope(p.project)&&p.status==='Aguardando aprovação'&&!(time(p.expiresAt)<=now));
 const messages=arr(state.collaborationMessages).filter(m=>inScope(m.project)&&Number.isFinite(time(m.createdAt))).sort((a,b)=>time(b.createdAt)-time(a.createdAt)).slice(0,companionLimits.messages)
  .map(m=>({agent:agentNames[m.fromAgent]||m.fromAgent,role:m.fromAgent,to:agentNames[m.toAgent]||m.toAgent||null,kind:m.kind,decision:clip(m.summary?.decision,240),text:clip(m.summary?.reason||m.text,320),at:m.createdAt,project:config[m.project]?.projectName||m.project}));
 const analysis=arr(state.snapshots).filter(s=>inScope(s.projectId)&&s.level==='campaign'&&s.period==='today').map(s=>s.fetchedAt).filter(v=>Number.isFinite(time(v))).sort().at(-1)||null;
 return {
  version:1,generatedAt:new Date(now).toISOString(),project,projectName:project===ALL_PROJECTS?'Todos os projetos':config[project]?.projectName||project,projects,
  paused:!!state.paused,analysisAt:analysis,
  today:dailyComparison(state,project),
  pace:budgetPace(state,project,now),
  orders:ownerOrderReceipts(state,{project,now}),
  queue:queueItems(candidates,events,now),queueSize:candidates.length,
  board:Array.isArray(board)?board:projectBoard(state,now),
  approvals:{count:approvals.length,items:approvals.slice(0,5).map(p=>({id:p.id,title:clip(p.payload?.title,200),project:config[p.project]?.projectName||p.project,expiresAt:p.expiresAt||null}))},
  activity:{hours:companionLimits.hours,summary:activitySummary(events),recent:activityItems(events)},
  agents:{recent:messages},
  executor:executor?{enabled:!!executor.enabled,paused:!!executor.paused,lastPulseAt:executor.lastPulseAt||null,lastError:executor.lastError||null,recentFailures:arr(executor.history).filter(h=>h.kind==='failure'&&now-time(h.at)<=3600000).length}:null,
  notice:'Somente leitura. Decidir e aprovar continua no Bunker, com a confirmação exata.'
 };
}
