import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudReviewFocus,scopeCloudReviewContext} from '../lib/cloud-review-focus.mjs';
const p={id:'proposal',project:'p',version:2,payload:{level:'campaign',adAccountId:'a',objectId:'c2'}};
function fixture(){const focus=[{externalId:'c1',adAccountId:'a',provider:'meta'},{externalId:'c2',adAccountId:'a',provider:'meta'},{externalId:'c2',adAccountId:'other',provider:'meta'}];return {focus,state:{snapshots:[{projectId:'p',period:'today',level:'campaign',source:'Malva MCP',complete:true,rows:structuredClone(focus)},{projectId:'p',period:'today',level:'ad',source:'Malva MCP',complete:true,rows:[{externalId:'ad1',adAccountId:'a',campaignExternalId:'c2',provider:'meta'}]}]}};}
test('Proposal reviews retain the exact parent including children and account identity, without altering the batch',()=>{
 const {state,focus}=fixture(),before=structuredClone({state,focus});assert.deepEqual(cloudReviewFocus(state,'p',focus,p),[focus[1]]);assert.deepEqual(cloudReviewFocus(state,'p',focus,{...p,payload:{...p.payload,level:'ad',objectId:'ad1'}}),[focus[1]]);assert.deepEqual({state,focus},before);
});
test('Unknown, ambiguous, cross-project and unsealed proposal targets cannot borrow another campaign context',()=>{
 for(const mutate of [f=>f.proposal.project='q',f=>f.proposal.payload.objectId='unknown',f=>f.proposal.payload.adAccountId='wrong',f=>f.state.snapshots[0].complete=false,f=>f.state.snapshots[0].rows.push({...f.focus[1]}),f=>f.focus.splice(1,1),f=>f.state.snapshots[1].rows[0].campaignExternalId='unknown']){
  const f={...fixture(),proposal:structuredClone(p)};if(mutate.toString().includes('snapshots[1]'))f.proposal.payload={...p.payload,level:'ad',objectId:'ad1'};mutate(f);assert.throws(()=>cloudReviewFocus(f.state,'p',f.focus,f.proposal),e=>e.code==='CLOUD_REVIEW_TARGET');
 }
});
test('Target-scoped peer readings preserve summaries and explicitly record the omitted batch readings',()=>{
 const context={campaigns:[{target:{adAccountId:'a',externalId:'c2'},windows:{today:{spend:100}},hierarchy:[]}],priorOpinions:[{id:'real-peer',summary:{decision:'Conferir aquisição'},campaignReadings:[{adAccountId:'a',externalId:'c1'},{adAccountId:'a',externalId:'c2'},{adAccountId:'other',externalId:'c2'}]}]};
 scopeCloudReviewContext(context,p,6);assert.deepEqual(context.priorOpinions[0].campaignReadings,[{adAccountId:'a',externalId:'c2'}]);assert.equal(context.priorOpinions[0].omittedCampaignReadings,2);assert.equal(context.priorOpinions[0].summary.decision,'Conferir aquisição');assert.equal(context.coverage.proposalReview.reviewedParents,1);assert.equal(context.coverage.proposalReview.requestedParents,6);assert.equal(context.coverage.proposalReview.version,2);
});

test('A child proposal keeps the exact child even below the top-spend sample and marks absent periods as unknown',()=>{
 const {state}=fixture(),proposal={...p,payload:{...p.payload,level:'ad',objectId:'ad1'}},context={campaigns:[{target:{adAccountId:'a',externalId:'c2'},hierarchy:[{period:'today',level:'ad',total:5,rows:Array.from({length:4},(_,i)=>({adAccountId:'a',externalId:'top-'+i,spend:100}))}]}]};
 state.snapshots[1].rows[0].spend=1;const before=structuredClone(state);scopeCloudReviewContext(context,proposal,6,state);const h=context.campaigns[0].hierarchy[0];assert.equal(h.rows.length,5);assert.equal(h.rows[4].externalId,'ad1');assert.equal(h.rows[4].spend,1);assert.deepEqual(context.coverage.proposalReview.targetPeriodsNotObserved,['7d','3d','yesterday']);assert.deepEqual(state,before);
});
