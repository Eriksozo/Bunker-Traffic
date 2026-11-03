import test from 'node:test';
import assert from 'node:assert/strict';
import {officeAgents,isWalkable,planWalk,nearestAgent,agentPresence,officePresencePlan,officeMessageTarget,retainOfficeMessages,assertOfficeQueueCapacity,answerOfficeMessage} from '../lib/office.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal,collaborationLimits} from '../lib/collaboration.mjs';
const spawn={x:500,y:300};
function assertRoute(from,route){let last=from;assert.ok(route.length);for(const point of route){assert.ok(isWalkable(point),JSON.stringify(point));assert.equal(Math.abs(point.x-last.x)+Math.abs(point.y-last.y),20);last=point;}return last;}
test('Every role is reachable through a room doorway without crossing a desk or partition',()=>{
 for(const agent of officeAgents){const target={x:agent.x,y:agent.y+40},route=planWalk(spawn,target);assert.deepEqual(assertRoute(spawn,route),target);assert.ok(route.some(point=>[260,340].includes(point.y)&&[220,240,260,740,760,780].includes(point.x)));}
 const left={x:240,y:240},right={x:760,y:240},route=planWalk(left,right);assert.deepEqual(assertRoute(left,route),right);assert.ok(route.some(point=>point.y===300||point.y===280));
});
test('A blocked click ends on a reachable safe tile and invalid coordinates never move the visitor',()=>{
 const route=planWalk(spawn,{x:240,y:120}),last=assertRoute(spawn,route);assert.notDeepEqual(last,{x:240,y:120});assert.ok(isWalkable(last));assert.equal(isWalkable({x:500,y:100}),false);assert.equal(isWalkable({x:240,y:120}),false);
 for(const point of [{x:Infinity,y:300},{x:NaN,y:10},{x:-1,y:300},{x:1001,y:300}])assert.deepEqual(planWalk(spawn,point),[]);
 assert.deepEqual(planWalk({x:500,y:100},{x:240,y:240}),[]);
});
test('Proximity chooses the nearest role only within interaction range',()=>{
 assert.equal(nearestAgent(spawn),null);assert.equal(nearestAgent({x:240,y:240})?.id,'traffic');assert.equal(nearestAgent({x:760,y:500})?.id,'ops');assert.equal(nearestAgent({x:240,y:240},30),null);
});
test('Old collection success is not presented as a currently connected or working agent',()=>{
 const state={agents:{p:{status:'Concluída',lastSuccessAt:'2026-11-02T12:00:00Z'}},jobs:[],messages:[]};assert.equal(agentPresence(state,'p','traffic').label,'Aguardando pedidos');
});
test('Queue presence belongs only to the matching project and addressed role; pause takes precedence',()=>{
 const state={messages:[{project:'p',agentId:'creative',status:'Pendente'},{project:'other',agentId:'traffic',status:'Pendente'},{project:'p',agentId:'traffic',status:'Respondida'}],jobs:[]};
 assert.equal(agentPresence(state,'p','creative').label,'Na fila');assert.equal(agentPresence(state,'p','traffic').label,'Aguardando pedidos');assert.equal(agentPresence({...state,paused:true},'p','creative').label,'Pausado');
});
test('Only the current unexpired project collection can show Em coleta',()=>{
 const now=Date.parse('2026-11-02T17:00:00Z'),active={id:'current',project:'p',status:'Em análise',startedAt:'2026-11-02T16:40:00Z'},base={jobs:[active],messages:[],agents:{p:{jobId:'current'}}};
 assert.equal(agentPresence(base,'p','budget',now).label,'Em coleta');assert.equal(agentPresence(base,'other','budget',now).label,'Aguardando pedidos');
 for(const startedAt of ['2026-11-02T16:15:00Z','2026-11-02T17:01:00Z','bad'])assert.notEqual(agentPresence({...base,jobs:[{...active,startedAt}]},'p','budget',now).label,'Em coleta');
 assert.notEqual(agentPresence({...base,agents:{p:{jobId:'new'}}},'p','budget',now).label,'Em coleta');
});
test('Addressed messages use catalog identity; legacy messages remain compatible',()=>{
 assert.deepEqual(officeMessageTarget(undefined,'p',{}),{});
 assert.deepEqual(officeMessageTarget('traffic','p',{p:{}}),{agentId:'traffic',agentName:'Lia',agentRole:'Analista de tráfego'});
 for(const id of ['fake','',null,{},'constructor'])assert.throws(()=>officeMessageTarget(id,'p',{p:{}}),/agente válido/);
 assert.throws(()=>officeMessageTarget('traffic','other',{p:{}}),/projeto válido/);
});

test('An eighty-first pending question is refused without losing any work already queued',()=>{
 const pending=Array.from({length:80},(_,i)=>({id:'pending-'+i,status:'Pendente'}));assert.throws(()=>assertOfficeQueueCapacity(pending),/80 perguntas pendentes/);assert.doesNotThrow(()=>assertOfficeQueueCapacity(pending.slice(0,79)));
 const mixed=[{id:'done',status:'Respondida'},...pending];assert.deepEqual(retainOfficeMessages(mixed).map(m=>m.id),pending.map(m=>m.id));
 const legacy=[...pending,{id:'legacy-extra',status:'Pendente'}];assert.equal(retainOfficeMessages(legacy).length,81);assert.throws(()=>assertOfficeQueueCapacity(legacy));
});
test('Only oldest answered history is pruned and pending questions keep their original list order',()=>{
 const messages=Array.from({length:90},(_,i)=>({id:i,status:i%10===0?'Pendente':'Respondida'})),kept=retainOfficeMessages(messages);
 assert.equal(kept.length,80);assert.deepEqual(kept.filter(m=>m.status==='Pendente').map(m=>m.id),messages.filter(m=>m.status==='Pendente').map(m=>m.id));assert.deepEqual(kept.map(m=>m.id),[...kept.map(m=>m.id)].sort((a,b)=>a-b));assert.ok(kept.some(m=>m.id===1));assert.ok(!kept.some(m=>m.id===89));
});
test('Answer retries preserve the first delivered text, time, and addressed role',()=>{
 const message={id:'question',project:'p',agentId:'creative',agentName:'Nina',agentRole:'Curadora de criativos',status:'Pendente'};
 assert.equal(answerOfficeMessage(message,'Resposta conferida','2026-11-02T17:00:00Z'),true);const accepted=structuredClone(message);
 assert.equal(answerOfficeMessage(message,'Uma resposta de outra tentativa','2026-11-02T18:00:00Z'),false);assert.deepEqual(message,accepted);assert.equal(message.agentId,'creative');
});

const presenceNow=Date.parse('2026-11-02T17:00:00Z');
function collaborationFixture(){
 const job={id:'presence-job',project:'p',status:'Concluída',startedAt:new Date(presenceNow-10*60000).toISOString(),completedAt:new Date(presenceNow-60000).toISOString()};
 const row={externalId:'campaign-1',adAccountId:'account-1',name:'Campanha de teste',accountName:'Conta de teste',provider:'Meta',budgetCurrency:'USD',dailyBudget:100,status:'ACTIVE'};
 const state={config:{p:{projectName:'Projeto',targetRoas:2}},jobs:[job],agents:{p:{jobId:job.id}},messages:[],snapshots:['7d','3d','yesterday','today'].map((period,index)=>({projectId:'p',period,level:'campaign',complete:true,from:'2026-10-26',to:'2026-11-02',timezone:'America/Boa_Vista',source:'Malva MCP',fetchedAt:new Date(presenceNow-(5-index)*60000).toISOString(),lastSyncAt:null,rows:[structuredClone(row)]}))};
 const ref={period:'today',level:'campaign',adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:state.snapshots.at(-1).fetchedAt};
 const round=ensureCollaboration(state,job,presenceNow);return {state,round,ref};
}
function presenceClaim(f,agentId,extra={}){return claimCollaboration(f.state,{roundId:f.round.id,agentId,executionRef:'execution-'+agentId,clientId:'claim-'+agentId,...extra},presenceNow);}
function presenceConclude(f,agentId){const lease=presenceClaim(f,agentId);return postCollaboration(f.state,{roundId:f.round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'conclude-'+agentId,toAgent:agentId==='ops'?'traffic':'ops',kind:'conclusion',text:'Parecer verificado.',evidenceRefs:[f.ref]},presenceNow+1);}
function presenceProposal(){
 const f=collaborationFixture(),opinions=['traffic','creative','budget'].map(id=>presenceConclude(f,id)),lease=presenceClaim(f,'ops');
 const proposal=submitProposal(f.state,{roundId:f.round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'proposal',expiresAt:new Date(presenceNow+15*60000).toISOString(),payload:{title:'Aumentar verba',reason:'Aquisição recorrente.',action:'budget',level:'campaign',provider:'Meta',adAccountId:'account-1',objectId:'campaign-1',currency:'USD',budgetOwner:'CBO',before:{dailyBudget:100},after:{dailyBudget:150},opinionRefs:opinions.map(m=>m.id),evidenceRefs:[f.ref],risks:[]}},presenceNow+2);
 presenceConclude(f,'ops');return {...f,proposal};
}
test('Only a valid claimed collaboration stage shows its specific role as Em análise',()=>{
 const f=collaborationFixture();assert.equal(agentPresence(f.state,'p','traffic',presenceNow).label,'Aguardando pedidos');const claim=presenceClaim(f,'traffic');
 const plan=officePresencePlan(f.state,'p',presenceNow);assert.equal(agentPresence(f.state,'p','traffic',presenceNow,plan).label,'Em análise');assert.equal(agentPresence(f.state,'p','budget',presenceNow,plan).label,'Aguardando pedidos');assert.equal(agentPresence(f.state,'other','traffic',presenceNow,plan).label,'Aguardando pedidos');
 assert.notEqual(agentPresence(f.state,'p','traffic',presenceNow+collaborationLimits.leaseMs).label,'Em análise');
 for(const change of [c=>c.startedAt=new Date(presenceNow+1).toISOString(),c=>c.executionRef='',c=>c.claimId='']){const bad=structuredClone(f.state);change(bad.collaborationRounds[0].stages[0]);assert.notEqual(agentPresence(bad,'p','traffic',presenceNow).label,'Em análise');}
 assert.equal(claim.status,'Em análise');assert.equal(agentPresence({...f.state,paused:true},'p','traffic',presenceNow,plan).label,'Pausado');
});
test('Real discussion claims show analysis until their addressed reply is persisted',()=>{
 const f=collaborationFixture(),lease=presenceClaim(f,'traffic');const message=postCollaboration(f.state,{roundId:f.round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'question',toAgent:'creative',text:'Confira a aquisição deste criativo.',evidenceRefs:[f.ref]},presenceNow+1);
 const reply=presenceClaim(f,'creative',{replyTo:message.id,clientId:'discussion'});assert.equal(agentPresence(f.state,'p','creative',presenceNow+2).label,'Em análise');
 postCollaboration(f.state,{roundId:f.round.id,claimId:reply.claimId,executionRef:reply.executionRef,clientId:'reply',toAgent:'traffic',replyTo:message.id,text:'Aquisição conferida na fonte.',evidenceRefs:[f.ref]},presenceNow+3);
 assert.notEqual(agentPresence(f.state,'p','creative',presenceNow+4).label,'Em análise');
});
test('Independent review leases and owner-approval waiting reflect real proposal state',()=>{
 const f=presenceProposal(),review=presenceClaim(f,'budget',{proposalId:f.proposal.id,clientId:'budget-review'});assert.equal(agentPresence(f.state,'p','budget',presenceNow+3).label,'Em análise');
 reviewProposal(f.state,{id:f.proposal.id,version:f.proposal.version,signature:f.proposal.signature,decision:'approve',comment:'Orçamento conferido.',clientId:'budget-opinion',claimId:review.claimId,executionRef:review.executionRef},{kind:'agent',agentId:'budget'},presenceNow+4);
 const traffic=presenceClaim(f,'traffic',{proposalId:f.proposal.id,clientId:'traffic-review'});
 reviewProposal(f.state,{id:f.proposal.id,version:f.proposal.version,signature:f.proposal.signature,decision:'approve',comment:'Aquisição conferida.',clientId:'traffic-opinion',claimId:traffic.claimId,executionRef:traffic.executionRef},{kind:'agent',agentId:'traffic'},presenceNow+5);
 assert.equal(agentPresence(f.state,'p','ops',presenceNow+6).label,'Aguardando aprovação');assert.notEqual(agentPresence(f.state,'p','budget',presenceNow+6).label,'Em análise');
 assert.notEqual(agentPresence(f.state,'p','ops',Date.parse(f.proposal.expiresAt)).label,'Aguardando aprovação');
 for(const mutate of [s=>s.config.p.targetRoas=3,s=>s.snapshots[0].rows[0].dailyBudget=999,s=>s.agents.p.jobId='replacement']){const stale=structuredClone(f.state);mutate(stale);assert.notEqual(agentPresence(stale,'p','ops',presenceNow+6).label,'Aguardando aprovação');}
});
