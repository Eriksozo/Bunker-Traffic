import test from 'node:test';
import assert from 'node:assert/strict';
import {isManualDecision,decisionIntentActions} from '../lib/decision-intent.mjs';
import {exactDecisionProposal} from '../lib/decision-form.mjs';
const card={project:'john',row:{provider:'Meta',adAccountId:'account',externalId:'campaign',budgetCurrency:'USD',dailyBudget:100,status:'ACTIVE'}};
test('Only an unapproved owner card choice is feedback; no proposal approval or execution bypasses preflight',()=>{
 assert.equal(isManualDecision({op:'cardDecision',approveExact:false}),true);
 assert.equal(isManualDecision({op:'cardDecision'}),true);
 for(const input of [null,{}, {op:'cardDecision',approveExact:true},{op:'proposalReview',decision:'approve'},{action:'executionPrepare'},{action:'executionSubmit'}])assert.equal(isManualDecision(input),false);
});
test('Expired, changed or pending analysis permits owner intent while never exposing exact approval',()=>{
 for(const patch of [{analysisStale:true},{liveDrift:{kind:'native'}},{monitor:{requiresReview:true}},{teamReady:false}]){
  const c={...card,...patch,actionable:{increase:false,reduce:false,pause:false,keep:false}};
  assert.deepEqual(decisionIntentActions(c),{increase:true,reduce:true,pause:true,keep:true});assert.equal(exactDecisionProposal(c,{action:'reduce',percent:'20'},Date.now()),null);
 }
});
test('Intention availability preserves native amount, identity, disabled-account and status guards',()=>{
 assert.deepEqual(decisionIntentActions({...card,row:{...card.row,budgetCurrency:null}}),{increase:false,reduce:false,pause:false,keep:true});
 assert.deepEqual(decisionIntentActions({...card,row:{...card.row,lifetimeBudget:100}}),{increase:false,reduce:false,pause:true,keep:true});
 assert.equal(decisionIntentActions({...card,row:{...card.row,accountStatus:{active:false}}}).increase,false);
 assert.equal(decisionIntentActions({...card,row:{...card.row,status:'PAUSED'}}).pause,false);
 for(const patch of [{provider:'Kwai'},{externalId:null},{adAccountId:null}])assert.deepEqual(decisionIntentActions({...card,row:{...card.row,...patch}}),{increase:false,reduce:false,pause:false,keep:false});
});
