import {z} from 'zod';
import {isWarmupCampaign} from './campaign-scope.mjs';
const arr=x=>Array.isArray(x)?x:[],at=x=>Date.parse(x||''),roles=['traffic','creative','budget','ops'];
export const campaignCoveragePolicy=Object.freeze({version:1,maximumTargets:6,prioritySlots:4,rotationSlots:2,maximumRecords:5000,providerWrites:false});
export const campaignCoverageKey=(project,account,object)=>JSON.stringify([project,account,object]);
const metrics=['spend','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','linkClicks','impressions','dailyBudget'];
const citation=z.object({period:z.enum(['7d','3d','yesterday','today']),level:z.enum(['campaign','adset','ad']),externalId:z.string().min(1),metric:z.enum(metrics),value:z.number().finite()}).strict();
export const campaignReadingSchema=z.object({adAccountId:z.string().min(1),externalId:z.string().min(1),assessment:z.enum(['observe','investigate','candidate']),reason:z.string().trim().min(1).max(240),citations:z.array(citation).max(2)}).strict();
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
const numeric=r=>r&&metrics.some(m=>Number.isFinite(r[m]));
const err=(code,reading,reason)=>{throw Object.assign(Error(code),{code,...(reading&&reason?{readingFailure:{adAccountId:reading.adAccountId,externalId:reading.externalId,reason}}:{})});};
export function eligibleCampaigns(state,project){
 const rows=arr(arr(state.snapshots).find(s=>s.projectId===project&&s.period==='today'&&s.level==='campaign')?.rows).filter(r=>r.provider==='meta'&&r.status==='ACTIVE'&&Number.isFinite(r.spend)&&r.spend>0&&!isWarmupCampaign(r.name));
 if(new Set(rows.map(key)).size!==rows.length)err('CLOUD_COVERAGE_IDENTITY');return rows;
}
/** Keep the original four priority slots and reserve two for the least recently completed review. */
export function selectLearningFocus(state,project){
 const rows=eligibleCampaigns(state,project),selected=[],ranked=rows.slice().sort((a,b)=>b.spend-a.spend||key(a).localeCompare(key(b))),loss=ranked.filter(r=>r.revenueNet!=null&&r.revenueNet<r.spend),positive=ranked.filter(r=>r.revenueNet!=null&&r.revenueNet>=r.spend);
 const add=r=>{if(r&&!selected.some(x=>key(x)===key(r)))selected.push(r);};
 for(let i=0;i<Math.max(loss.length,positive.length)&&selected.length<campaignCoveragePolicy.prioritySlots;i++)for(const r of [loss[i],positive[i]])if(selected.length<campaignCoveragePolicy.prioritySlots)add(r);
 for(const r of ranked)if(selected.length<campaignCoveragePolicy.prioritySlots)add(r);
 const remaining=ranked.filter(r=>!selected.some(x=>key(x)===key(r))).sort((a,b)=>{
  const ca=state.campaignReviewCoverage?.[campaignCoverageKey(project,a.adAccountId,a.externalId)],cb=state.campaignReviewCoverage?.[campaignCoverageKey(project,b.adAccountId,b.externalId)];
  return (Number.isFinite(at(ca?.lastCompletedAt))?at(ca.lastCompletedAt):0)-(Number.isFinite(at(cb?.lastCompletedAt))?at(cb.lastCompletedAt):0)||b.spend-a.spend||key(a).localeCompare(key(b));
 });
 for(const r of remaining)if(selected.length<campaignCoveragePolicy.maximumTargets)add(r);
 // Compaction may retain just the prefix. Put the oldest verified review first
 // across both priority and rotation slots so neither group starves forever.
 return selected.sort((a,b)=>{const ca=state.campaignReviewCoverage?.[campaignCoverageKey(project,a.adAccountId,a.externalId)],cb=state.campaignReviewCoverage?.[campaignCoverageKey(project,b.adAccountId,b.externalId)];return (Number.isFinite(at(ca?.lastCompletedAt))?at(ca.lastCompletedAt):0)-(Number.isFinite(at(cb?.lastCompletedAt))?at(cb.lastCompletedAt):0)||b.spend-a.spend||key(a).localeCompare(key(b));});
}
/** IDs stay fixed for the admitted job; new role contributions must not change the next role's targets. */
export function learningFocus(state,project){
 const research=state.cloudResearch?.[project],job=state.agents?.[project]?.jobId;
 if(research?.focusPolicy===campaignCoveragePolicy.version&&research.jobId===job){
  const rows=arr(arr(state.snapshots).find(s=>s.projectId===project&&s.period==='today'&&s.level==='campaign')?.rows),frozen=arr(research.focus);
  if(frozen.length>campaignCoveragePolicy.maximumTargets||new Set(frozen.map(key)).size!==frozen.length)err('CLOUD_COVERAGE_IDENTITY');
  return frozen.map(target=>{const matching=rows.filter(r=>key(r)===key(target)&&r.provider==='meta'&&!isWarmupCampaign(r.name));if(matching.length!==1)err('CLOUD_COVERAGE_IDENTITY');return matching[0];});
 }
 return selectLearningFocus(state,project);
}
function checkReading(reading,windows,hierarchy,role){
 const seen=new Set();for(const c of reading.citations){
  const id=JSON.stringify([c.period,c.level,c.externalId,c.metric]);if(seen.has(id))err('CLOUD_CAMPAIGN_READING_EVIDENCE',reading,'duplicate_citation');seen.add(id);
  const row=c.level==='campaign'?windows[c.period]:arr(hierarchy).filter(h=>h.period===c.period&&h.level===c.level).flatMap(h=>arr(h.rows)).find(r=>r.externalId===c.externalId&&r.adAccountId===reading.adAccountId);
  if(!row||(c.level==='campaign'&&c.externalId!==reading.externalId)||!Number.isFinite(row[c.metric])||row[c.metric]!==c.value)err('CLOUD_CAMPAIGN_READING_EVIDENCE',reading,'citation_not_in_packet');
 }
 const hasNumbers=Object.values(windows).some(numeric),hasChild=arr(hierarchy).some(h=>arr(h.rows).some(numeric));
 if(hasNumbers&&!reading.citations.length)err('CLOUD_CAMPAIGN_READING_EVIDENCE',reading,'numeric_citation_required');
 if(role==='creative'&&hasChild&&!reading.citations.some(c=>c.level!=='campaign'))err('CLOUD_CAMPAIGN_READING_EVIDENCE',reading,'child_citation_required');
 if(!hasNumbers&&(reading.assessment!=='investigate'||reading.citations.length))err('CLOUD_CAMPAIGN_READING_EVIDENCE',reading,'missing_numbers_require_investigate');
}
export function validateCampaignReadings(value,context,role){
 if(value===undefined&&!context.campaignReviewPolicy)return null;
 if(value===undefined)err('CLOUD_CAMPAIGN_READING_REQUIRED');
 const parsed=z.array(campaignReadingSchema).max(campaignCoveragePolicy.maximumTargets).parse(value),targets=arr(context.campaigns);
 if(parsed.length!==targets.length||new Set(parsed.map(key)).size!==parsed.length)err('CLOUD_CAMPAIGN_READING_REQUIRED');
 for(const reading of parsed){const c=targets.find(c=>key(c.target)===key(reading));if(!c)err('CLOUD_CAMPAIGN_READING_SCOPE');checkReading(reading,c.windows||{},c.hierarchy,role);}
 return parsed;
}
/** Revalidate every number against the round's frozen source, independent of generated prose. */
export function normalizeCampaignReadings(value,{state,round,role,evidenceRefs}){
 if(value===undefined)return null;
 const parsed=z.array(campaignReadingSchema).max(campaignCoveragePolicy.maximumTargets).parse(value);
 if(new Set(parsed.map(key)).size!==parsed.length)err('CLOUD_CAMPAIGN_READING_REQUIRED');
 for(const reading of parsed){
  const windows={},hierarchy=[];
  for(const cut of arr(round.sourceCut)){
   const snapshot=arr(state.snapshots).find(s=>s.projectId===round.project&&s.period===cut.period&&s.level===cut.level&&s.fetchedAt===cut.fetchedAt);if(!snapshot?.complete)continue;
   if(cut.level==='campaign')windows[cut.period]=arr(snapshot.rows).find(r=>key(r)===key(reading));
   else hierarchy.push({period:cut.period,level:cut.level,rows:arr(snapshot.rows).filter(r=>r.adAccountId===reading.adAccountId&&r.campaignExternalId===reading.externalId)});
  }
  if(!Object.values(windows).some(r=>r&&r.provider==='meta'&&!isWarmupCampaign(r.name))||!arr(evidenceRefs).some(r=>r.level==='campaign'&&r.adAccountId===reading.adAccountId&&r.externalId===reading.externalId))err('CLOUD_CAMPAIGN_READING_SCOPE');
  checkReading(reading,windows,hierarchy,role);
 }
 return parsed;
}
/** A valid contribution records its own author only; completion needs all four in the same frozen round. */
export function recordCampaignCoverage(state,message,round){
 if(message.kind!=='conclusion'||!roles.includes(message.fromAgent)||!arr(message.campaignReadings).length)return;
 state.campaignReviewCoverage||={};
 for(const reading of message.campaignReadings){
  const k=campaignCoverageKey(round.project,reading.adAccountId,reading.externalId),prior=state.campaignReviewCoverage[k];
  if(!prior&&Object.keys(state.campaignReviewCoverage).length>=campaignCoveragePolicy.maximumRecords){state.campaignReviewCapacity={at:message.createdAt,status:'Capacidade atingida; cobertura adicional não registrada'};continue;}
  const record={...prior,project:round.project,adAccountId:reading.adAccountId,externalId:reading.externalId,roles:{...prior?.roles,[message.fromAgent]:{messageId:message.id,roundId:round.id,sourceHash:round.sourceHash,at:message.createdAt,assessment:reading.assessment}}};
  if(roles.every(role=>record.roles[role]?.roundId===round.id&&record.roles[role]?.sourceHash===round.sourceHash)){record.lastCompletedAt=message.createdAt;record.completedRoundId=round.id;record.completedSourceHash=round.sourceHash;}
  state.campaignReviewCoverage[k]=record;
 }
}
export function campaignCoveragePlan(state,project){
 const projects=project&&project!=='all'?[project]:Object.keys(state.config||{}),rows=projects.flatMap(p=>eligibleCampaigns(state,p).map(r=>({...r,project:p}))),known=rows.map(r=>state.campaignReviewCoverage?.[campaignCoverageKey(r.project,r.adAccountId,r.externalId)]);
 return {version:1,eligible:rows.length,reviewed:known.filter(r=>r?.lastCompletedAt).length,waiting:known.filter(r=>!r?.lastCompletedAt).length,oldestCompletedAt:known.map(r=>r?.lastCompletedAt).filter(Boolean).sort()[0]||null,capacity:state.campaignReviewCapacity||null,policy:campaignCoveragePolicy,interpretation:'Cobertura de pareceres numéricos dos quatro papéis na mesma rodada; não é taxa de acerto nem análise atual de todo o projeto.'};
}

/** Exact examples from each final packet target; not authored opinions or presumed results. */
export function campaignReadingRequirements(context,role){
 return arr(context.campaigns).map(c=>{
  const child=[];for(const h of arr(c.hierarchy))for(const row of arr(h.rows))if(row.adAccountId===c.target.adAccountId)child.push({row,period:h.period,level:h.level});
  const childRequired=role==='creative'&&child.some(x=>numeric(x.row)),source=childRequired?child:['today','yesterday','3d','7d'].filter(p=>c.windows?.[p]).map(p=>({row:c.windows[p],period:p,level:'campaign'})),examples=[];
  for(const item of source)for(const metric of ['frontOrders','spend','checkouts','dailyBudget','revenueNet'])if(Number.isFinite(item.row[metric])&&examples.length<2)examples.push({period:item.period,level:item.level,externalId:item.level==='campaign'?c.target.externalId:item.row.externalId,metric,value:item.row[metric]});
  return {adAccountId:c.target.adAccountId,externalId:c.target.externalId,childCitationRequired:childRequired,numericCitationRequired:Object.values(c.windows||{}).some(numeric),examples};
 });
}
