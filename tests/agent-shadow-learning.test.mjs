import test from 'node:test';
import assert from 'node:assert/strict';
import {agentLearningContext,agentLearningInterpretation,learningStats,learningRecords,mergeLearning,learningPolicy} from '../lib/shadow-learning.mjs';
import {shadowRulePolicy} from '../lib/autonomy-shadow.mjs';
import {compactCloudContext} from '../lib/cloud-analysis.mjs';
import {modelPacketView} from '../lib/cloud-packet-economy.mjs';
import {learningInputReceipt} from '../lib/learning-input-receipt.mjs';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';

// Synthetic fixtures only (invented projects, campaigns and people).
const NOW=Date.parse('2026-11-12T15:00:00Z'),P='p1',V=shadowRulePolicy.version;
const cut=(over={})=>({id:'e',rule:'bad-day-reduce',project:P,adAccountId:'a1',objectId:'c1',day:'2026-11-10',action:'budget',before:{dailyBudget:100},after:{dailyBudget:80},firstAt:'2026-11-10T15:00:00Z',ruleVersion:V,firstMetrics:{spend:120},grade:{verdict:'acertou',basis:'next',next:{roi:0.5}},...over});
const summary=()=>{
 const recs=learningRecords(Array.from({length:6},(_,i)=>cut({id:'r'+i,objectId:'c'+i,grade:{verdict:i<4?'acertou':'errou',basis:'next'}})));
 const team={kind:'team',day:'2026-11-11',project:P,actions:{t1:{id:'t1',day:'2026-11-11',project:P,who:'team',name:'Ana Souza',kind:'pause',at:'2026-11-11T15:00:00Z',objectId:'x1',ctx:{since:{spend:60,checkouts:0,frontOrders:0,orders:0,revenueNet:0},today:{spend:60}},guard:{level:'watch',pauseAt:99,limit:110,basis:'low-ic'},shadow:{flagged:true,cutFlagged:true,leadMin:30}}}};
 return learningStats([...Object.values(mergeLearning(new Map(),recs,{now:NOW}).put),team],{now:NOW,names:{[P]:'Projeto Um'},coverage:{[P]:['2026-11-11T15','2026-11-11T14']}});
};

test('The analysts get the Sombra memory of their project, as a bounded reading that is never an instruction',()=>{
 const s=summary(),c=agentLearningContext(s,{project:P,now:NOW});
 assert.equal(c.interpretation,agentLearningInterpretation);
 assert.match(c.interpretation,/nunca instrução, limiar, meta, teto, aprovação ou autorização/);
 const r=c.rules.find(x=>x.rule==='bad-day-reduce');
 assert.deepEqual([r.thisProject.graded,r.thisProject.right,r.allProjects.graded],[6,4,6]);
 assert.ok(r.thisProject.low>0&&r.thisProject.high<1,'with its honest range');
 assert.deepEqual(c.team,['Pausas de campanhas novas sem venda (30 dias): Ana 1 · mediana R$60.','A Sombra apontou antes 1 de 1 cortes da equipe em 7 dias (mediana 30 min antes).']);
 assert.deepEqual([c.anticipation.cuts,c.anticipation.aheadOfTeam,c.blindSpots.cuts],[1,1,0]);
 assert.ok(new TextEncoder().encode(JSON.stringify(c)).length<6000,'a few KB at most');
 assert.ok(!/garant|100%|certeza/.test(JSON.stringify(c)),'no promise of certainty');
 assert.equal(agentLearningContext(s,{project:'other',now:NOW}).rules.length,1,'another project gets only the rule-wide score');
 assert.equal(agentLearningContext(s,{project:'other',now:NOW}).rules[0].thisProject,null);
 assert.equal(agentLearningContext(s,{project:P,now:NOW+learningPolicy.agentMaxAgeMs+60000}),null,'stale memory: nothing');
 assert.equal(agentLearningContext({...s,version:1},{project:P,now:NOW}),null,'other memory version: nothing');
 assert.equal(agentLearningContext({...s,ruleVersion:V-1},{project:P,now:NOW}),null,'memory of other rules: nothing');
 assert.equal(agentLearningContext(null,{project:P,now:NOW}),null);
 assert.equal(agentLearningContext(s,{project:'',now:NOW}),null);
 // Where the Sombra was not watching, anticipation and blind spots are N/D, never 0; the depth of the memory is stated.
 assert.deepEqual([c.anticipation.watchedHours,c.blindSpots.watchedHours],[2,2]);
 const other=agentLearningContext(s,{project:'other',now:NOW});
 assert.deepEqual([other.anticipation,other.blindSpots],[null,null]);
 assert.equal(c.anticipation.previousWeek,null,'the week before was not watched: N/D');
 assert.deepEqual([c.memory.sombraFrom,c.memory.sombraDays,c.memory.teamFrom,c.memory.teamActions30d],['2026-11-10',1,'2026-11-11',1]);
 // An edge over picking any campaign is never claimed from a small sample.
 const st2=learningStats(Object.values(mergeLearning(new Map(),learningRecords(Array.from({length:6},(_,i)=>cut({id:'q'+i,objectId:'q'+i}))),{now:NOW,bases:[{day:'2026-11-11',project:P,campaigns:4,loss:1,profit:3}]}).put),{now:NOW});
 const v=agentLearningContext(st2,{project:P,now:NOW}).rules[0].thisProject.vsAnyCampaign;
 assert.deepEqual([v.graded,v.chanceBetter,typeof v.edgeClaim,typeof v.low],[6,null,'string','number']);
});

test('For the analysts the owner is "o dono" and threshold proposals are structured, not approved',()=>{
 const pause=(i,who='team')=>({id:'t'+i,day:'2026-11-0'+(8+i%3),project:P,who,name:who==='owner'?'Você':'Ana Souza',kind:'pause',at:'2026-11-0'+(8+i%3)+'T15:00:00Z',objectId:'x'+i,
  ctx:{since:{spend:50+i,checkouts:0,frontOrders:0,orders:0,revenueNet:0},today:{spend:50+i}},guard:{level:'watch',pauseAt:99,limit:110,basis:'low-ic'},shadow:{flagged:false,cutFlagged:false}});
 const team={kind:'team',day:'x',project:P,actions:Object.fromEntries([...Array.from({length:5},(_,i)=>pause(i)),pause(9,'owner')].map(a=>[a.id,a]))};
 const st=learningStats([team],{now:NOW,names:{[P]:'Projeto Um'},coverage:{[P]:['2026-11-11T15']}});
 const c=agentLearningContext(st,{project:P,now:NOW});
 assert.ok(c.team.some(l=>/o dono 1/.test(l)),'the owner is named, never "Você"');
 assert.ok(!JSON.stringify(c).includes('Você')&&!/vocês|seu sim/.test(JSON.stringify(c)),'no second person addressed to the model');
 assert.equal(c.openProposals.length,1);
 const p=c.openProposals[0];
 assert.deepEqual([p.status,p.pauses,p.campaigns,p.days,p.sombraPauseAtNow,p.proposedPauseAt],['não aprovada: decisão do dono',6,6,3,99,55]);
 assert.match(c.interpretation,/"o dono" é o proprietário, nunca o analista; nenhum parecer de agente aprova ou põe proposta em vigor/);
});

test('Under packet pressure the Sombra reading shrinks, then steps aside first, and never displaces what the analysts already got',()=>{
 const sl={...agentLearningContext(summary(),{project:P,now:NOW}),openProposals:['x'.repeat(700),'y'.repeat(700)],lessons:['z'.repeat(400)]};
 const campaign={target:{adAccountId:'a1',externalId:'1'},windows:{today:{spend:100}},hierarchy:[]};
 const base={campaigns:[campaign],coverage:{individuallyPrioritized:1},priorOpinions:[],shadowLearning:sl};
 const full=new TextEncoder().encode(JSON.stringify(base)).length;
 const roomy=compactCloudContext(base,full+500);
 assert.deepEqual(roomy.shadowLearning,sl,'fits: delivered whole');
 const tight=compactCloudContext(base,full-1000);
 assert.equal(tight.shadowLearning.shortened,true);
 assert.equal(tight.shadowLearning.openProposals,undefined);assert.ok(tight.shadowLearning.rules.length>0,'scores stay');
 const tighter=compactCloudContext(base,new TextEncoder().encode(JSON.stringify({...base,shadowLearning:undefined})).length+200);
 assert.equal(tighter.shadowLearning,undefined);assert.equal(tighter.coverage.deferredShadowLearning,true);
 assert.deepEqual(tighter.campaigns[0],campaign,'campaign evidence untouched');
 assert.ok(base.shadowLearning.openProposals,'the input is never changed');
 // With agent memory in the packet, the Sombra reading leaves before any memory entry is trimmed.
 const withMemory={...base,agentMemory:{episodes:[{lesson:'a'.repeat(300)},{lesson:'b'.repeat(300)}]}};
 const noSl=new TextEncoder().encode(JSON.stringify({...withMemory,shadowLearning:undefined})).length;
 const out=compactCloudContext(withMemory,noSl+100);
 assert.equal(out.shadowLearning,undefined);assert.equal(out.agentMemory.episodes.length,2,'memory untouched');assert.equal(out.coverage.omittedAgentMemory,undefined);
 // The pattern review the analysts used to receive stays: the Sombra reading gives way first.
 const withReview={...base,learningReview:{entry:{knowledgeId:'k1'},cases:['r'.repeat(600)]}};
 const fitsWithout=new TextEncoder().encode(JSON.stringify(modelPacketView({...withReview,shadowLearning:undefined}))).length;
 const kept=compactCloudContext(withReview,fitsWithout+200);
 assert.ok(kept.learningReview,'pattern review kept');assert.equal(kept.coverage.deferredLearningReview,undefined);
 // The deferral mark is bookkeeping for the receipt: never sent, never counted.
 assert.equal(tighter.coverage.deferredShadowLearning,true);
 assert.equal(modelPacketView(tighter).coverage.deferredShadowLearning,undefined);
});

test('The receipt says whether the Sombra reading reached the model',()=>{
 const sl=agentLearningContext(summary(),{project:P,now:NOW});
 const got=learningInputReceipt({project:P,role:'traffic',agentMemory:{},shadowLearning:sl}).shadowLearning;
 assert.deepEqual([got.delivered,got.ruleVersion,got.rules,got.teamLines,got.shortened],[true,V,1,2,false]);
 assert.ok(typeof got.fingerprint==='string'&&got.fingerprint.length>8);
 assert.deepEqual(learningInputReceipt({project:P,role:'traffic',agentMemory:{},coverage:{deferredShadowLearning:true}}).shadowLearning,{delivered:false,deferred:true});
 assert.deepEqual(learningInputReceipt({project:P,role:'traffic',agentMemory:{}}).shadowLearning,{delivered:false,deferred:false});
});

// Round fixture (same shape as tests/cloud-executor.test.mjs).
const project='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',internal='33333333-3333-4333-8333-333333333333';
const iso=t=>new Date(t).toISOString();
function fixture(){
 const now=Date.now(),start=Date.parse(iso(now).slice(0,10)+'T00:00:00Z'),row={id:internal,externalId:'123',adAccountId:account,provider:'meta',name:'Sales',accountName:'Example',budgetCurrency:'USD',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',level:'campaign',spend:100,revenueNet:200,frontOrders:2};
 const job={id:'job',project,status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)};
 const state={config:{[project]:{projectName:'Example'}},jobs:[job],agents:{[project]:{jobId:'job'}},collaborationRounds:[],collaborationMessages:[],proposals:[],executions:[],snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Example',period,level:'campaign',source:'Malva MCP',complete:true,from:iso(start-({today:0,yesterday:1,'3d':3,'7d':7}[period])*86400000),to:iso(start+(period==='today'?86400000:0)),timezone:'UTC',fetchedAt:iso(now-1000),lastSyncAt:null,rows:[structuredClone(row)]}))};
 ensureCollaboration(state,job);return state;
}
const memory=initial=>{let state=initial;return {get state(){return state;},write:async fn=>{const draft=structuredClone(state),r=await fn(draft,1);state=draft;return r;}};};
const modelMock=seen=>({run:async(_m,request)=>{seen.push(request);const b=JSON.parse(request.messages[1].content),r=b.reflectionRequirements;return {response:{campaignReadings:b.evidenceSelection.campaignExamples.map(c=>({...c,assessment:'observe',reason:'Conferir aquisição desta campanha.'})),memoryReview:b.memoryReviewRequirements.required?{reference:b.memoryReviewRequirements.options[0].reference,stance:'adapt',reason:'Conferir a aquisição atual após a edição, sem repetir a lição automaticamente.',evidenceIndices:[0]}:null,decision:'Observar',reason:'Aguardar aquisição nova',nextStep:'Comparar período fechado',text:'Uma campanha priorizada foi analisada.',reflection:{lesson:'Conferir os dados da própria fonte.',uncertainty:'Efeito ainda não medido.',nextCheck:'Comparar novas vendas.',citations:b.evidenceSelection.reflectionExamples.slice(0,1),peerChecks:r.requiredPeerRoles.map(role=>({messageId:r.peerConclusions.find(p=>p.role===role).messageId,stance:'inconclusive',reason:'Não há resultado medido novo.'}))},suggestions:[],question:null}};}});

test('A real stage packet carries the Sombra reading, the prompt frames it, and the receipt records it',async()=>{
 const store=memory(fixture()),seen=[],asked=[];
 const reading={...agentLearningContext(summary(),{project:P,now:NOW}),at:new Date().toISOString()};
 const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{dispatch:async()=>{throw Error('No action authorized');}},ai:modelMock(seen),
  ops:{shadowLearning:async(_s,id)=>{asked.push(id);return reading;}}});
 assert.equal((await engine.step()).kind,'stage');
 assert.deepEqual(asked,[project]);
 const packet=JSON.parse(seen[0].messages[1].content).context;
 assert.equal(packet.shadowLearning.interpretation,agentLearningInterpretation);
 assert.deepEqual(packet.shadowLearning.team,reading.team);
 assert.match(seen[0].messages[0].content,/shadowLearning é a leitura determinística da Sombra do Bunk/);
 assert.match(seen[0].messages[0].content,/não é entrada de agentMemory \(não cite em memoryReview\)/);
 const message=store.state.collaborationMessages.find(m=>m.kind==='conclusion');
 assert.equal(message.learningInputs.shadowLearning.delivered,true);
 assert.equal(store.state.proposals.length,0,'a reading never becomes a proposal');
});

test('Without the Sombra reading (missing or failing) the analysts still run, and the receipt says so',async()=>{
 for(const shadowLearning of [async()=>null,async()=>{throw Error('DO down');},undefined]){
  const store=memory(fixture()),seen=[];
  const engine=createCloudEngine({read:async()=>({state:structuredClone(store.state),revision:1}),write:store.write,source:{dispatch:async()=>{throw Error('No action authorized');}},ai:modelMock(seen),ops:shadowLearning?{shadowLearning}:{}});
  assert.equal((await engine.step()).kind,'stage');
  assert.equal(JSON.parse(seen[0].messages[1].content).context.shadowLearning,undefined);
  assert.equal(store.state.collaborationMessages.find(m=>m.kind==='conclusion').learningInputs.shadowLearning.delivered,false);
 }
});
