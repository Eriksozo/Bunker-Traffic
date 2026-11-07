import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingAttributions,attributionRequest,matchAttributions,usableAttributions,attributionKey,attributionPolicy} from '../lib/change-attribution.mjs';

const now=Date.parse('2026-11-07T15:00:00Z'),iso=h=>new Date(now-h*3600000).toISOString();
const change=(id,objectId,hoursAgo,changes,project='p')=>({id,project,adAccountId:'act',objectId,observedAt:iso(hoursAgo),previousObservedAt:iso(hoursAgo+0.25),changes,before:{budgetCurrency:'USD'},after:{budgetCurrency:'USD'}});
const state=()=>({config:{p:{projectName:'P'}},paused:false,campaignChanges:[
 change('c1','o1',1,[{field:'status',before:'ACTIVE',after:'PAUSED'},{field:'effectiveStatus',before:'ACTIVE',after:'PAUSED'}]),
 change('c2','o1',2,[{field:'dailyBudget',before:200,after:400}]),
 change('c3','o2',3,[{field:'dailyBudget',before:100,after:150}]),
 change('c4','o3',100,[{field:'dailyBudget',before:1,after:2}]),
 change('c5','o4',1,[{field:'dailyBudget',before:1,after:2}],'zz'),
],decisionHistory:[]});

test('pending attribution groups recent changes per campaign, skips duplicates, old, foreign and known ones',()=>{
 const s=state(),groups=pendingAttributions(s,new Map(),now);
 assert.deepEqual(groups.map(g=>g.objectId),['o1','o2']);
 assert.deepEqual(groups[0].changes.map(c=>c.field),['status','dailyBudget']);
 assert.equal(groups[0].currency,'USD');
 const known=new Map([[attributionKey('c3','dailyBudget'),{checkedAt:iso(1),actor:null}]]);
 assert.deepEqual(pendingAttributions(s,known,now).map(g=>g.objectId),['o1']);
 assert.deepEqual(pendingAttributions(s,new Map([[attributionKey('c3','dailyBudget'),{checkedAt:iso(7),actor:null}]]),now).map(g=>g.objectId),['o1','o2']);
 s.decisionHistory=[{objectId:'o2',adAccountId:'act',field:'dailyBudget',before:100,after:150,occurredAt:iso(3.1),actor:{name:'Ana'}}];
 assert.deepEqual(pendingAttributions(s,new Map(),now).map(g=>g.objectId),['o1']);
 assert.equal(pendingAttributions({...s,paused:true},new Map(),now).length,0);
 assert.equal(pendingAttributions(s,new Map(),now,1).length,1);
});

test('the Malva request covers the days around the observation in the project timezone',()=>{
 const g=pendingAttributions(state(),new Map(),now)[0];
 assert.deepEqual(attributionRequest(g,'America/Sao_Paulo',now),{projectId:'p',objectId:'o1',provider:['meta'],who:'all',limit:100,preset:'custom',from:'2026-11-06',to:'2026-11-07'});
});

test('matching keeps the actor of the same transition in the window and never guesses',()=>{
 const g=pendingAttributions(state(),new Map(),now)[0];
 const item=(id,category,from,to,hoursAgo,actor,automatic=false)=>({id,at:iso(hoursAgo),category,automatic,actor,source:'meta',object:{level:'campaign',externalId:'o1'},values:{from,to,field:category==='budget'?'dailyBudget':'status'}});
 const page={items:[item('e1','status','ACTIVE','PAUSED',1.1,{name:'Jorge Raimundo'}),item('e2','budget',200,400,2.1,null,true),item('e3','budget',200,400,30,{name:'Outro'})]};
 const out=matchAttributions(g,page,now);
 assert.equal(out[0].actor,'Jorge Raimundo');assert.equal(out[0].eventId,'e1');assert.equal(out[0].matched,true);
 assert.equal(out[1].actor,'Regra automática');assert.equal(out[1].eventId,'e2');
 const none=matchAttributions(g,{items:[item('e9','budget',200,999,2.1,{name:'X'})]},now);
 assert.equal(none[1].matched,false);assert.equal(none[1].actor,null);assert.equal(none[0].matched,false);
 assert.deepEqual(usableAttributions(out,now).map(e=>e.actor),['Jorge Raimundo','Regra automática']);
 assert.equal(usableAttributions(out,now+(attributionPolicy.retentionDays+1)*86400000).length,0);
});
