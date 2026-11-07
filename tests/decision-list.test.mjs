import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionList,decisionListMetrics} from '../lib/decision-list.mjs';
const card=(name,spend,extra={})=>({id:name,row:{name,dailyBudget:100,budgetCurrency:'BRL'},liveToday:{spend},windows:{'3d':{roas:2,frontOrders:3}},...extra});
test('the list puts exact approvals first, then team suggestions, then campaigns in review',()=>{
 const columns=[{id:'analysis',cards:[card('review big',900)]},{id:'suggestions',cards:[card('suggest',10)]},{id:'approval',cards:[card('approve',1)]}];
 assert.deepEqual(decisionList(columns).map(r=>[r.stage,r.card.id]),[['approval','approve'],['suggestions','suggest'],['analysis','review big']]);
});
test('inside a stage, higher spend today comes first and missing spend goes last',()=>{
 const columns=[{id:'suggestions',cards:[card('b',null),card('a',50),card('c',300),card('d',50)]}];
 assert.deepEqual(decisionList(columns).map(r=>r.card.id),['c','a','d','b']);
});
test('metrics keep absent values as null, take today only from the current reading and flag a stale one',()=>{
 assert.deepEqual(decisionListMetrics({row:{},windows:{today:{spend:99,frontOrders:4}}}),{spendToday:null,frontToday:null,liveStale:false,dailyBudget:null,budgetCurrency:null,roas3d:null,front3d:null});
 const m=decisionListMetrics({row:{dailyBudget:80,budgetCurrency:'USD'},observedRow:{dailyBudget:120,budgetCurrency:'BRL'},liveToday:{spend:42,frontOrders:0},liveStale:true,windows:{today:{spend:10},'3d':{roas:1.5,frontOrders:0}}});
 assert.deepEqual(m,{spendToday:42,frontToday:0,liveStale:true,dailyBudget:120,budgetCurrency:'BRL',roas3d:1.5,front3d:0});
});
test('the list never drops or duplicates a card and tolerates malformed columns',()=>{
 const columns=[{id:'analysis',cards:[card('x',1)]},{id:'approval'},null,{id:'suggestions',cards:[card('y',2)]}];
 assert.deepEqual(decisionList(columns).map(r=>r.card.id).sort(),['x','y']);
 assert.deepEqual(decisionList(null),[]);
});
