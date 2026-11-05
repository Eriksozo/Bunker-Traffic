import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionPercent,validDecisionPercent,decisionBudgetAfter,decisionDraftError,exactDecisionProposal,sameDecisionSession,decisionTimestamp} from '../lib/decision-form.mjs';
const now=Date.parse('2026-11-05T14:00:00Z');
function fixture(){
 const draft={action:'reduce',percent:'20',reason:''};
 const card={id:'card',signature:'context',project:'project',row:{externalId:'campaign',adAccountId:'account',provider:'Meta',budgetCurrency:'USD',dailyBudget:100,status:'ACTIVE'},proposal:{id:'proposal',status:'Aguardando aprovação',signature:'sealed',version:1,expiresAt:new Date(now+60000).toISOString(),project:'project',payload:{level:'campaign',provider:'Meta',objectId:'campaign',adAccountId:'account',currency:'USD',action:'budget',budgetOwner:'CBO',before:{dailyBudget:100},after:{dailyBudget:80}}}};
 return {card,draft};
}
test('Editor accepts decimal comma and exact computed percentages without scientific or hexadecimal coercion',()=>{
 for(const [percent,value] of [['20',20],[' 20,5 ',20.5],['19.99947761594393',19.99947761594393]])assert.equal(decisionPercent({action:'reduce',percent}),value);
 for(const percent of ['', ' ', '0x20','1e2','Infinity','NaN','20%','1,2,3',null,20])assert.equal(decisionPercent({action:'reduce',percent}),null);
 for(const percent of ['0','100','-1'])assert.equal(validDecisionPercent({action:'reduce',percent}),false);
 assert.equal(validDecisionPercent({action:'increase',percent:'1000'}),true);
 assert.equal(validDecisionPercent({action:'increase',percent:'1000.01'}),false);
 assert.equal(validDecisionPercent({action:'unknown',percent:'20'}),false);
 assert.equal(validDecisionPercent({action:'keep',percent:''}),true);
});
test('Budget preview rejects rounded no-ops, zero, lifetime budgets and over-limit results before saving',()=>{
 const {card,draft}=fixture();assert.equal(decisionDraftError(card,draft),null);assert.equal(decisionBudgetAfter(100,'reduce',20),80);
 for(const [before,action,percent] of [[.01,'reduce','20'],[.01,'reduce','99'],[1e9,'increase','100']])assert.ok(decisionDraftError({...card,row:{...card.row,dailyBudget:before}},{action,percent}));
 assert.ok(decisionDraftError({...card,row:{...card.row,lifetimeBudget:500}},draft));
 for(const before of [null,0,-1,Infinity,NaN,'100'])assert.equal(decisionBudgetAfter(before,'reduce',20),null);
});
test('Exact approval fails closed on invalid expiry, unsafe version, identity drift and partial financial matches',()=>{
 const {card,draft}=fixture();assert.equal(exactDecisionProposal(card,draft,now),card.proposal);
 for(const patch of [{expiresAt:'broken'},{expiresAt:null},{expiresAt:new Date(now).toISOString()},{version:0},{version:1.5},{version:Number.MAX_SAFE_INTEGER+1},{signature:' '},{status:'Em revisão'},{project:'other'}])assert.equal(exactDecisionProposal({...card,proposal:{...card.proposal,...patch}},draft,now),null);
 for(const patch of [{objectId:'other'},{adAccountId:'other'},{currency:'BRL'},{provider:'Kwai'},{level:'adset'},{budgetOwner:'ABO'},{before:{dailyBudget:99}},{after:{dailyBudget:79}}])assert.equal(exactDecisionProposal({...card,proposal:{...card.proposal,payload:{...card.proposal.payload,...patch}}},draft,now),null);
 for(const patch of [{analysisStale:true},{liveDrift:{}},{monitor:{requiresReview:true}}])assert.equal(exactDecisionProposal({...card,...patch},draft,now),null);
 assert.equal(exactDecisionProposal(card,{action:'keep',percent:''},now),null);
 assert.equal(exactDecisionProposal(card,draft,NaN),null);
});
test('Exact proposals with a cent-rounded percentage still match the native amount',()=>{
 const {card,draft}=fixture();card.row.dailyBudget=765.72;card.proposal.payload.before.dailyBudget=765.72;card.proposal.payload.after.dailyBudget=612.58;
 draft.percent=String(Math.abs((612.58/765.72-1)*100));assert.equal(exactDecisionProposal(card,draft,now),card.proposal);
});
test('Pause approval requires active status and exact account, with no budget command',()=>{
 const {card}=fixture(),draft={action:'pause',percent:''};card.proposal.payload.action='status';card.proposal.payload.before={status:'ACTIVE'};card.proposal.payload.after={status:'PAUSED'};
 assert.equal(exactDecisionProposal(card,draft,now),card.proposal);
 assert.equal(exactDecisionProposal({...card,row:{...card.row,status:'PAUSED'}},draft,now),null);
});
test('Source replacements invalidate editor sessions; unchanged reads preserve the selection',()=>{
 const {card}=fixture(),session={id:card.id,signature:card.signature};
 assert.equal(sameDecisionSession(session,structuredClone(card)),true);
 assert.equal(sameDecisionSession(session,{...card,signature:'new-data'}),false);
 assert.equal(sameDecisionSession(session,{...card,id:'another-account-card'}),false);
 assert.equal(sameDecisionSession(session,null),false);
});


test('Incident epoch timestamps and ISO source times display the same valid instant',()=>{
 assert.equal(decisionTimestamp(now),now);assert.equal(decisionTimestamp(new Date(now).toISOString()),now);assert.equal(decisionTimestamp(0),0);
 for(const value of [null,undefined,'',' ','broken',Infinity,NaN,8640000000000001])assert.ok(Number.isNaN(decisionTimestamp(value)));
});
