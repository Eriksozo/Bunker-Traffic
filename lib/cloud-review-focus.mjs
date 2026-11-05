import {CloudError} from './cloud-malva.mjs';
/** A financial review concerns the exact proposal, never whichever row is first in a batch. */
export function cloudReviewFocus(state,project,focus,proposal){
 const p=proposal?.payload;
 if(proposal?.project!==project||!['campaign','adset','ad'].includes(p?.level)||!p.adAccountId||!p.objectId)throw new CloudError('CLOUD_REVIEW_TARGET');
 const targets=(state.snapshots||[]).filter(s=>s.projectId===project&&s.period==='today'&&s.level===p.level&&s.source==='Malva MCP'&&s.complete===true).flatMap(s=>s.rows||[]).filter(r=>r.adAccountId===p.adAccountId&&r.externalId===p.objectId&&r.provider==='meta');
 if(targets.length!==1)throw new CloudError('CLOUD_REVIEW_TARGET');
 const parent=p.level==='campaign'?targets[0].externalId:targets[0].campaignExternalId;
 const parents=focus.filter(r=>r.adAccountId===p.adAccountId&&r.externalId===parent);
 if(parents.length!==1)throw new CloudError('CLOUD_REVIEW_TARGET');
 return parents;
}
/** Preserve original peer messages in storage; declare readings omitted from this target-only packet. */
export function scopeCloudReviewContext(context,proposal,requestedParents,state){
 const parents=new Set(context.campaigns.map(c=>JSON.stringify([c.target.adAccountId,c.target.externalId])));
 for(const opinion of context.priorOpinions||[])if(Array.isArray(opinion.campaignReadings)){
  const count=opinion.campaignReadings.length;opinion.campaignReadings=opinion.campaignReadings.filter(r=>parents.has(JSON.stringify([r.adAccountId,r.externalId])));
  opinion.omittedCampaignReadings=(opinion.omittedCampaignReadings||0)+count-opinion.campaignReadings.length;
 }
 const missing=[];
 if(proposal.payload.level!=='campaign')for(const period of ['7d','3d','yesterday','today']){
  const targets=(state?.snapshots||[]).filter(s=>s.projectId===proposal.project&&s.period===period&&s.level===proposal.payload.level&&s.source==='Malva MCP'&&s.complete===true).flatMap(s=>s.rows||[]).filter(r=>r.adAccountId===proposal.payload.adAccountId&&r.externalId===proposal.payload.objectId&&r.provider==='meta'&&parents.has(JSON.stringify([r.adAccountId,r.campaignExternalId])));
  if(targets.length>1)throw new CloudError('CLOUD_REVIEW_TARGET');
  if(!targets.length){missing.push(period);continue;}
  const campaign=context.campaigns.find(c=>c.target.adAccountId===targets[0].adAccountId&&c.target.externalId===targets[0].campaignExternalId),h=campaign?.hierarchy?.find(h=>h.period===period&&h.level===proposal.payload.level);
  if(!h)throw new CloudError('CLOUD_REVIEW_TARGET');
  if(!h.rows.some(r=>r.adAccountId===targets[0].adAccountId&&r.externalId===targets[0].externalId))h.rows.push(structuredClone(targets[0]));
 }
 context.coverage||={};context.coverage.proposalReview={proposalId:proposal.id,version:proposal.version,level:proposal.payload.level,adAccountId:proposal.payload.adAccountId,externalId:proposal.payload.objectId,requestedParents,reviewedParents:context.campaigns.length,otherBatchTargetsNotReviewed:true,...(missing.length?{targetPeriodsNotObserved:missing}:{})};
 return context;
}
