import test from 'node:test';
import assert from 'node:assert/strict';
import {failOwnerQuestion,ownerQuestionAttempts,ownerQuestionParked,countsTowardOwnerQuestionLimit} from '../lib/owner-question-limit.mjs';
import {agentPresence} from '../lib/office.mjs';

const at=Date.parse('2026-11-08T12:00:00Z');
const base=()=>({config:{p:{projectName:'John'}},collaborationRounds:[{id:'r1',project:'p'}],jobs:[],agents:{},messages:[{id:'q1',project:'p',agentId:'ops',status:'Pendente'},{id:'q2',project:'p',agentId:'ops',status:'Pendente'},{id:'old',project:'p',status:'Respondida'}],ownerQuestionFailures:{old:{messageId:'old',roundId:'r1',attempts:2}}});

test('only deterministic model failures count, up to the cap, with fixed metadata; answered questions leave the list',()=>{
 const s=base(),secret='private-model-text-mvk_do_not_store';
 assert.equal(failOwnerQuestion(s,'q1','p','r1','CLOUD_AI_UNAVAILABLE',at),null,'a provider outage never parks a question');
 assert.equal(failOwnerQuestion(s,'q1','p','r1',undefined,at),null);
 for(let i=0;i<5;i++)failOwnerQuestion(s,'q1','p','r1','CLOUD_AI_INVALID',at+i,{phase:'json',reason:'invalid_final_json',shape:'trailing_text',raw:secret});
 assert.equal(s.ownerQuestionFailures.q1.attempts,ownerQuestionAttempts,'never above the cap');
 assert.equal(s.ownerQuestionFailures.q1.modelFailure.shape,'trailing_text');
 assert.equal(s.ownerQuestionFailures.old,undefined,'an answered question leaves the list');
 failOwnerQuestion(s,'q2','p','r1','CLOUD_REFLECTION_CITATION',at);
 assert.equal(s.ownerQuestionFailures.q2.attempts,1);assert.equal(s.ownerQuestionFailures.q2.modelFailure,undefined,'model metadata only for format failures');
 assert.equal(s.ownerQuestionFailures.q1.attempts,3,'other pending questions are kept');
 assert.doesNotMatch(JSON.stringify(s.ownerQuestionFailures),/private-model|do_not_store/);
 for(const c of ['CLOUD_AI_INVALID','CLOUD_CONTEXT_LIMIT','CLOUD_AI_SCOPE','CLOUD_MEMORY_REVIEW_EVIDENCE'])assert.equal(countsTowardOwnerQuestionLimit(c),true,c);
 for(const c of ['CLOUD_AI_UNAVAILABLE','CLOUD_REVISION_CONFLICT','CLOUD_CLAIM_CHANGED',null,'x'])assert.equal(countsTowardOwnerQuestionLimit(c),false,String(c));
});

test('a parked question renews with a new round and the office says it plainly instead of "Na fila"',()=>{
 const s=base();for(let i=0;i<3;i++)failOwnerQuestion(s,'q1','p','r1','CLOUD_AI_INVALID',at);
 s.messages=s.messages.filter(m=>m.id!=='q2');
 assert.equal(ownerQuestionParked(s,s.messages[0]),true);
 const parked=agentPresence(s,'p','ops',at);assert.equal(parked.label,'Sem resposta');assert.match(parked.detail,/3 tentativas/);
 s.collaborationRounds=[{id:'r2',project:'p'}];
 assert.equal(ownerQuestionParked(s,s.messages[0]),false,'a new collection round tries again');
 assert.equal(agentPresence(s,'p','ops',at).label,'Na fila');
 failOwnerQuestion(s,'q1','p','r2','CLOUD_AI_INVALID',at);assert.equal(s.ownerQuestionFailures.q1.attempts,1,'attempts restart in the new round');
});
