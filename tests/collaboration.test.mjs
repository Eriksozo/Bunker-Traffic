import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureCollaboration,collaborationPlan,compactCollaboration,claimCollaboration,postCollaboration,submitProposal,reviewProposal,collaborationLimits} from '../lib/collaboration.mjs';

const start=Date.parse('2026-11-02T16:00:00Z'),now=start+10*60000;
function fixture(options={}){
 const row={id:'22222222-2222-4222-8222-222222222222',externalId:'campaign-1',adAccountId:'account-1',provider:'Meta',name:'Campanha validada',accountName:'Conta local',budgetCurrency:'USD',dailyBudget:300,lifetimeBudget:null,status:'ACTIVE',spend:500,frontOrders:6,...options.row};
 const job={id:'job-1',project:'project-1',status:'Concluída',startedAt:new Date(start).toISOString(),completedAt:new Date(now).toISOString()};
 const state={paused:false,config:{'project-1':{projectName:'Projeto local',targetRoas:2}},jobs:[job],agents:{'project-1':{jobId:'job-1'}},snapshots:['7d','3d','yesterday','today'].map((period,i)=>({projectId:'project-1',period,level:'campaign',complete:true,from:'2026-10-26',to:'2026-11-02',timezone:'America/Boa_Vista',source:'Malva MCP',fetchedAt:new Date(start+(i+1)*60000).toISOString(),lastSyncAt:null,rows:[structuredClone(row)]}))};
 const ref={period:'today',level:'campaign',adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:state.snapshots.at(-1).fetchedAt};
 return {state,job,ref};
}
function claim(state,round,agentId,offset=0,extra={}){return claimCollaboration(state,{roundId:round.id,agentId,executionRef:'connected-run-'+agentId,clientId:'claim-'+agentId,...extra},now+offset);}
function conclude(state,round,agentId,ref,offset=0){const lease=claim(state,round,agentId,offset);return postCollaboration(state,{roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'conclusion-'+agentId,toAgent:agentId==='ops'?'traffic':agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Conclusão conferida de '+agentId,evidenceRefs:[ref]},now+offset+1);}
function ready(options={}){const f=fixture(options),round=ensureCollaboration(f.state,f.job,now);const opinions=['traffic','creative','budget'].map((agentId,i)=>conclude(f.state,round,agentId,f.ref,i*1000));const lease=claim(f.state,round,'ops',4000);return {...f,round,opinions,lease};}
function proposalArgs(f,extra={}){return {roundId:f.round.id,claimId:f.lease.claimId,executionRef:f.lease.executionRef,clientId:'proposal-1',expiresAt:new Date(now+60*60000).toISOString(),payload:{title:'Aumentar campanha validada',reason:'Aquisição recorrente e nova após os ajustes.',action:'budget',level:'campaign',provider:'Meta',adAccountId:'account-1',objectId:'campaign-1',objectName:'Campanha validada',accountName:'Conta local',currency:'USD',budgetOwner:'CBO',before:{dailyBudget:300},after:{dailyBudget:600},opinionRefs:f.opinions.map(m=>m.id),evidenceRefs:[f.ref],risks:['Reavaliar novas vendas após a alteração.']},...extra};}
function proposal(){const f=ready(),args=proposalArgs(f);const p=submitProposal(f.state,args,now+5000);return {...f,p,args};}
function peer(f,agentId,decision='approve',extra={}){const lease=claim(f.state,f.round,agentId,6000,{proposalId:f.p.id,clientId:'peer-claim-'+agentId,executionRef:'peer-run-'+agentId});return reviewProposal(f.state,{id:f.p.id,version:f.p.version,signature:f.p.signature,decision,comment:'Parecer independente '+agentId,clientId:'review-'+agentId,claimId:lease.claimId,executionRef:lease.executionRef,...extra},{kind:'agent',agentId},now+7000);}
function ownerArgs(f,extra={}){return {id:f.p.id,version:f.p.version,signature:f.p.signature,decision:'approve',comment:'Aprovo somente esta alteração exata.',clientId:'owner-approve',...extra};}

test('Only a completed collection with four complete campaign windows can start; frozen metadata survives refresh',()=>{
 for(const mutate of [f=>f.job.status='Em análise',f=>f.state.snapshots.pop(),f=>f.state.snapshots[0].complete=false,f=>f.state.snapshots[0].fetchedAt=new Date(start-1).toISOString(),f=>f.state.snapshots[0].source='manual']){
  const f=fixture();mutate(f);assert.throws(()=>ensureCollaboration(f.state,f.job,now));assert.equal(f.state.collaborationRounds?.length,0);
 }
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now),cut=structuredClone(round.sourceCut);
 assert.equal(ensureCollaboration(f.state,f.job,now).id,round.id);assert.equal(round.stages.length,4);assert.equal(round.sourceCut.length,4);
 f.state.snapshots[0].rows[0].spend+=1;assert.deepEqual(round.sourceCut,cut);assert.throws(()=>claim(f.state,round,'traffic'),/fonte congelada mudou/);assert.equal(collaborationPlan(f.state,now).rounds[0].status,'Bloqueada');
});

test('A failed/cancelled refresh keeps the exact last successful cut usable, without accepting an active successor or partial imports',()=>{
 for(const status of ['Falhou','Cancelada']){
  const f=fixture(),round=ensureCollaboration(f.state,f.job,now),later={id:'unsuccessful-refresh',project:f.job.project,status,startedAt:new Date(now+1000).toISOString()};
  f.state.jobs.unshift(later);f.state.agents[f.job.project].jobId=later.id;
  const lease=claim(f.state,round,'traffic',2000);assert.equal(lease.agentId,'traffic');assert.equal(round.sourceCut.at(-1).fetchedAt,f.ref.fetchedAt);
  assert.equal(collaborationPlan(f.state,now+2000).rounds[0].blocked,null);
 }
 for(const status of ['Pendente','Em análise','Concluída']){
  const f=fixture(),round=ensureCollaboration(f.state,f.job,now),later={id:'later-active-or-successful',project:f.job.project,status,createdAt:new Date(now+1000).toISOString()};
  f.state.jobs.unshift(later);assert.throws(()=>claim(f.state,round,'traffic',2000),/rodada nova/);
 }
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now),later={id:'failed-with-partial-import',project:f.job.project,status:'Falhou',startedAt:new Date(now+1000).toISOString()};
 f.state.jobs.unshift(later);f.state.agents[f.job.project].jobId=later.id;f.state.snapshots[0].rows[0].dailyBudget=999;
 assert.throws(()=>claim(f.state,round,'traffic',2000),/fonte congelada mudou/);
});

test('Claims enforce role order, a real execution reference, exclusive lease and fencing after expiration',()=>{
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now);
 assert.throws(()=>claim(f.state,round,'budget'),/sequência/);assert.throws(()=>claim(f.state,round,'traffic',0,{executionRef:''}),/execução conectada/);
 const first=claim(f.state,round,'traffic');assert.equal(claim(f.state,round,'traffic').claimId,first.claimId);
 assert.throws(()=>claim(f.state,round,'traffic',1,{executionRef:'different',clientId:'other'}),/reservada/);
 const old=structuredClone(first),next=claim(f.state,round,'traffic',collaborationLimits.leaseMs,{executionRef:'next-run',clientId:'next-claim'});assert.equal(next.attempt,2);assert.notEqual(next.claimId,old.claimId);
 assert.throws(()=>postCollaboration(f.state,{roundId:round.id,claimId:old.claimId,executionRef:old.executionRef,clientId:'late',toAgent:'creative',text:'Resposta atrasada',evidenceRefs:[f.ref]},now+collaborationLimits.leaseMs+1),/Reserva/);
 assert.equal(f.state.collaborationMessages.length,0);
});

test('Messages derive authorship from claim, require exact project evidence and are immutable under retries',()=>{
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now),lease=claim(f.state,round,'traffic');
 const args={roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'message',fromAgent:'ops',toAgent:'creative',text:'Confira se o front sustenta o retorno.',evidenceRefs:[f.ref]};
 assert.throws(()=>postCollaboration(f.state,{...args,evidenceRefs:[{...f.ref,adAccountId:'other'}]},now),/fonte congelada/);
 assert.throws(()=>postCollaboration(f.state,{...args,evidenceRefs:[]},now),/referências/);
 const message=postCollaboration(f.state,args,now);assert.equal(message.fromAgent,'traffic');
 assert.equal(postCollaboration(f.state,args,now+10000000).id,message.id);assert.equal(f.state.collaborationMessages.length,1);
 assert.throws(()=>postCollaboration(f.state,{...args,text:'Mensagem sobrescrita'},now+1),/clientId/);assert.equal(message.text,args.text);
});

test('Only a persisted evidence-backed conclusion finishes a stage; replies must address received messages',()=>{
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now),lease=claim(f.state,round,'traffic');
 const message=postCollaboration(f.state,{roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'question',toAgent:'creative',text:'Aquisição suficiente?',evidenceRefs:[f.ref]},now);
 assert.throws(()=>claim(f.state,round,'creative'),/sequência/);conclude(f.state,round,'traffic',f.ref);
 const creative=claim(f.state,round,'creative',1000),args={roundId:round.id,claimId:creative.claimId,executionRef:creative.executionRef,clientId:'reply',toAgent:'traffic',text:'Front conferido.',evidenceRefs:[f.ref],replyTo:message.id};
 assert.equal(postCollaboration(f.state,args,now+1001).replyTo,message.id);
 assert.throws(()=>postCollaboration(f.state,{...args,clientId:'bad-reply',replyTo:'other-round'},now+1002),/recebida/);
});

test('A later role can ask a completed role and a new real execution replies without reopening conclusions',()=>{
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now);conclude(f.state,round,'traffic',f.ref);conclude(f.state,round,'creative',f.ref,1000);
 const budget=claim(f.state,round,'budget',2000),question=postCollaboration(f.state,{roundId:round.id,claimId:budget.claimId,executionRef:budget.executionRef,clientId:'budget-question',toAgent:'traffic',text:'Lia, houve front novo após o aumento?',evidenceRefs:[f.ref]},now+2001);
 conclude(f.state,round,'budget',f.ref,2002);const conclusions=structuredClone(round.stages.slice(0,3));
 const args={roundId:round.id,agentId:'traffic',executionRef:'connected-followup-Lia',clientId:'discussion-Lia',replyTo:question.id};
 const replyClaim=claimCollaboration(f.state,args,now+3000);assert.equal(replyClaim.replyTo,question.id);assert.equal(claimCollaboration(f.state,args,now+3001).claimId,replyClaim.claimId);
 assert.ok(collaborationPlan(f.state,now+3001).rounds[0].discussionPending.some(m=>m.id===question.id));
 const reply=postCollaboration(f.state,{roundId:round.id,claimId:replyClaim.claimId,executionRef:replyClaim.executionRef,clientId:'Lia-answer',replyTo:question.id,toAgent:'budget',text:'Sim, conferi o front novo na janela de hoje.',evidenceRefs:[f.ref]},now+3002);
 assert.equal(reply.fromAgent,'traffic');assert.equal(reply.executionRef,'connected-followup-Lia');assert.equal(round.discussionClaims.traffic.responseId,reply.id);
 assert.deepEqual(round.stages.slice(0,3),conclusions);assert.equal(round.stages[3].status,'Pendente');
 assert.ok(!collaborationPlan(f.state,now+3002).rounds[0].discussionPending.some(m=>m.id===question.id));
 assert.deepEqual(collaborationPlan(f.state,now+3002).rounds[0].discussionPending,[]);
 assert.throws(()=>claimCollaboration(f.state,{...args,clientId:'duplicate-answer'},now+3003),/resposta imutável/);
 const followClaim=claimCollaboration(f.state,{roundId:round.id,agentId:'budget',executionRef:'real-Theo-followup',clientId:'followup-claim',replyTo:reply.id},now+4000);
 const followup=postCollaboration(f.state,{roundId:round.id,claimId:followClaim.claimId,executionRef:followClaim.executionRef,clientId:'followup-question',replyTo:reply.id,toAgent:'traffic',kind:'message',requiresReply:true,text:'Confirme também a janela dessa aquisição.',evidenceRefs:[f.ref]},now+4001);
 assert.deepEqual(collaborationPlan(f.state,now+4001).rounds[0].discussionPending.map(m=>m.id),[followup.id]);
 // Old persisted responses also stop the conversation without a new requiresReply field.
 delete reply.requiresReply;followup.requiresReply=false;assert.deepEqual(collaborationPlan(f.state,now+4002).rounds[0].discussionPending,[]);
});

test('Discussion claims fence expired workers, enforce reply destination and cannot write another conclusion',()=>{
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now),traffic=claim(f.state,round,'traffic');
 const question=postCollaboration(f.state,{roundId:round.id,claimId:traffic.claimId,executionRef:traffic.executionRef,clientId:'question',toAgent:'budget',text:'Theo, confirme a moeda nativa.',evidenceRefs:[f.ref]},now);
 const args={roundId:round.id,agentId:'budget',executionRef:'budget-discussion',clientId:'discussion',replyTo:question.id};
 for(const changes of [{agentId:'creative'},{replyTo:'other-round-message'},{proposalId:'not-a-proposal'}])assert.throws(()=>claimCollaboration(f.state,{...args,...changes},now+1));
 const first=claimCollaboration(f.state,args,now+1),post={roundId:round.id,claimId:first.claimId,executionRef:first.executionRef,clientId:'response',replyTo:question.id,toAgent:'traffic',text:'Moeda confirmada na leitura.',evidenceRefs:[f.ref]};
 assert.throws(()=>claimCollaboration(f.state,{...args,clientId:'competitor',executionRef:'competing-run'},now+2),/reservada/);
 assert.throws(()=>postCollaboration(f.state,{...post,kind:'conclusion'},now+2),/conclusões anteriores/);
 assert.throws(()=>postCollaboration(f.state,{...post,replyTo:'another-message'},now+2),/resposta exata/);
 assert.throws(()=>postCollaboration(f.state,{...post,toAgent:'creative'},now+2),/voltar ao autor/);
 const next=claimCollaboration(f.state,{...args,clientId:'next-attempt',executionRef:'fresh-discussion'},now+collaborationLimits.leaseMs+1);assert.equal(next.attempt,2);
 assert.throws(()=>postCollaboration(f.state,post,now+collaborationLimits.leaseMs+2),/Reserva/);
 postCollaboration(f.state,{...post,claimId:next.claimId,executionRef:next.executionRef},now+collaborationLimits.leaseMs+2);assert.equal(f.state.collaborationMessages.length,2);assert.equal(round.stages[2].status,'Pendente');
});

test('Proposal uses actual persisted perspectives and exact native budget scope, never supplied fake opinions',()=>{
 const f=ready(),args=proposalArgs(f);
 for(const payload of [{...args.payload,opinionRefs:['fake-1','fake-2','fake-3']},{...args.payload,currency:'BRL'},{...args.payload,before:{dailyBudget:1500}},{...args.payload,budgetOwner:'ABO'},{...args.payload,adAccountId:'other'},{...args.payload,provider:'Other'}])assert.throws(()=>submitProposal(f.state,{...args,payload},now+5000));
 assert.throws(()=>submitProposal(f.state,{...args,expiresAt:new Date(now+25*3600000).toISOString()},now+5000),/24 horas/);
 const p=submitProposal(f.state,args,now+5000);assert.equal(p.payload.currency,'USD');assert.deepEqual(p.payload.before,{dailyBudget:300});assert.equal(p.status,'Em revisão');assert.equal(submitProposal(f.state,args,now+5001).id,p.id);
 args.payload.after.dailyBudget=1500;assert.equal(p.payload.after.dailyBudget,600);assert.throws(()=>submitProposal(f.state,args,now+5002),/outra proposta/);
});

test('Approval requires independent budget and acquisition reviews; agent cannot approve as owner',()=>{
 const f=proposal();assert.throws(()=>reviewProposal(f.state,ownerArgs(f),{kind:'owner',id:'owner-local'},now+6000),/pareceres/);
 assert.throws(()=>claim(f.state,f.round,'ops',6000,{proposalId:f.p.id,clientId:'self-review'}),/não aceita revisão/);
 peer(f,'creative');assert.equal(f.p.status,'Em revisão');peer(f,'budget');assert.equal(f.p.status,'Aguardando aprovação');
 assert.throws(()=>reviewProposal(f.state,ownerArgs(f),{kind:'agent',agentId:'traffic'},now+8000),/revisão independente/);
 reviewProposal(f.state,ownerArgs(f),{kind:'owner',id:'owner-local'},now+8000);assert.equal(f.p.status,'Aprovada');assert.equal(f.p.approvedSignature,f.p.signature);assert.equal(f.p.appliedAt,undefined);
 const frozen=structuredClone(f.p);reviewProposal(f.state,ownerArgs(f),{kind:'owner',id:'owner-local'},now+9000);assert.deepEqual(f.p,frozen);
 assert.throws(()=>reviewProposal(f.state,ownerArgs(f,{decision:'reject',clientId:'new-decision'}),{kind:'owner',id:'owner-local'},now+9000),/imutável/);
});

test('Owner direct approval gets an audit note; agent approval, rejection and revision still require written rationale',()=>{
 const f=proposal();assert.throws(()=>peer(f,'traffic','approve',{comment:''}),/Comentário/);peer(f,'traffic');peer(f,'budget');
 for(const decision of ['reject','revise'])assert.throws(()=>reviewProposal(f.state,ownerArgs(f,{decision,comment:'',clientId:'empty-'+decision}),{kind:'owner',id:'owner-local'},now+8000),/Comentário/);
 reviewProposal(f.state,ownerArgs(f,{comment:''}),{kind:'owner',id:'owner-local'},now+8000);assert.equal(f.p.status,'Aprovada');assert.equal(f.p.reviews.at(-1).comment,'Versão exibida aprovada pelo dono.');
});

test('Owner approval is bound to version, content, current source, active project and expiration',()=>{
 for(const change of [f=>f.p.payload.after.dailyBudget=900,f=>f.state.snapshots.at(-1).rows[0].dailyBudget=999,f=>f.state.config['project-1'].targetRoas=3,f=>f.state.agents['project-1'].jobId='new-job',f=>f.state.paused=true]){
  const f=proposal();peer(f,'traffic');peer(f,'budget');change(f);assert.throws(()=>reviewProposal(f.state,ownerArgs(f),{kind:'owner',id:'owner-local'},now+8000));assert.notEqual(f.p.status,'Aprovada');
 }
 const f=proposal();peer(f,'traffic');peer(f,'budget');
 assert.throws(()=>reviewProposal(f.state,ownerArgs(f,{version:2}),{kind:'owner',id:'owner-local'},now+8000),/Versão/);
 assert.throws(()=>reviewProposal(f.state,ownerArgs(f),{kind:'owner',id:'owner-local'},now+2*3600000),/expirada/);
 assert.equal(collaborationPlan(f.state,now+2*3600000).proposals[0].status,'Expirada');
});

test('Refusal and requested revision append immutable history; a replacement has fresh identity and approval',()=>{
 const f=proposal();peer(f,'traffic');peer(f,'budget');
 reviewProposal(f.state,ownerArgs(f,{decision:'revise',comment:'Reduza o aumento para 50%.',clientId:'request-change'}),{kind:'owner',id:'owner-local'},now+8000);
 const previous=structuredClone(f.p);assert.equal(f.p.status,'Revisão solicitada');
 const args=proposalArgs(f,{clientId:'proposal-2',supersedes:f.p.id});args.payload.after.dailyBudget=450;
 const next=submitProposal(f.state,args,now+9000);assert.equal(next.version,2);assert.notEqual(next.signature,f.p.signature);assert.equal(next.status,'Em revisão');assert.equal(next.reviews.length,0);assert.deepEqual(f.p,previous);
 assert.throws(()=>submitProposal(f.state,{...args,clientId:'fork'},now+9001),/substituta/);
});

test('Pause blocks real agent work and queue bounds reject growth without dropping pending records',()=>{
 const f=fixture(),round=ensureCollaboration(f.state,f.job,now);f.state.paused=true;
 assert.equal(collaborationPlan(f.state,now).rounds[0].nextAgent,null);assert.throws(()=>claim(f.state,round,'traffic'),/pausado/);f.state.paused=false;
 const lease=claim(f.state,round,'traffic');const args={roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,toAgent:'creative',text:'Pergunta com evidência.',evidenceRefs:[f.ref]};
 for(let i=0;i<collaborationLimits.questionsPerRound;i++)postCollaboration(f.state,{...args,clientId:'question-'+i},now+i);
 const before=structuredClone(f.state.collaborationMessages);assert.throws(()=>postCollaboration(f.state,{...args,clientId:'question-overflow'},now+100),/Limite/);assert.deepEqual(f.state.collaborationMessages,before);
 // Capacity affects new work, never removes durable questions or old pending rounds.
 const base=structuredClone(round);while(f.state.collaborationRounds.length<collaborationLimits.rounds)f.state.collaborationRounds.push({...structuredClone(base),id:'legacy-'+f.state.collaborationRounds.length,jobId:'legacy-job-'+f.state.collaborationRounds.length});
 const job={...f.job,id:'job-2'};f.state.jobs.push(job);assert.throws(()=>ensureCollaboration(f.state,job,now),/nenhum registro pendente/);assert.equal(f.state.collaborationRounds.length,collaborationLimits.rounds);
});

test('A completed operations stage never represents an external change and replayed conclusions stay unique',()=>{
 const f=ready(),message=conclude(f.state,f.round,'ops',f.ref,5000);assert.equal(f.round.status,'Concluída');assert.equal(f.state.proposals.length,0);assert.equal(message.fromAgent,'ops');
 assert.equal(f.state.collaborationMessages.filter(m=>m.kind==='conclusion').length,4);assert.equal(f.state.snapshots.at(-1).rows[0].dailyBudget,300);
});

test('Compaction archives settled history atomically and keeps two recent closed rounds for each project',()=>{
 const f=fixture(),base=ensureCollaboration(f.state,f.job,now);
 for(let i=1;i<=5;i++){
  const old={...structuredClone(base),id:'settled-'+i,jobId:'previous-'+i,status:'Concluída',createdAt:new Date(now-i*3600000).toISOString()};
  f.state.collaborationRounds.push(old);f.state.collaborationMessages.push({id:'message-'+i,roundId:old.id,text:'Histórico completo '+i});
 }
 const compacted=compactCollaboration(f.state,now);assert.equal(compacted.state,f.state);assert.equal(compacted.archives.length,3);
 assert.deepEqual(f.state.collaborationRounds.map(r=>r.id),[base.id,'settled-1','settled-2']);assert.equal(f.state.collaborationMessages.length,2);
 const archived=compacted.archives.find(a=>a.key==='collaboration:settled-3');assert.equal(archived.payload.round.status,'Fonte substituída');assert.equal(archived.payload.messages[0].text,'Histórico completo 3');
 assert.equal(compactCollaboration(f.state,now+1).archives.length,0);
});

test('Compaction moves suggestions only with their removed round and keeps connected batches intact',()=>{
 const f=fixture(),base=ensureCollaboration(f.state,f.job,now);
 for(let i=1;i<=5;i++)f.state.collaborationRounds.push({...structuredClone(base),id:'settled-'+i,jobId:'previous-'+i,status:'Concluída',createdAt:new Date(now-i*3600000).toISOString()});
 const suggestion=(id,roundId,extra={})=>({id,roundId,project:'project-1',clientId:'client-'+id,requestFingerprint:'digest-'+id,...extra});
 f.state.cardSuggestions=[
  suggestion('solo','settled-3'),
  suggestion('complete-a','settled-3',{batchReceipt:{clientId:'complete-batch',recordIds:['complete-a','complete-b']},batchReceipts:[{clientId:'complete-retry',recordIds:['complete-a','complete-b']}]}),
  suggestion('complete-b','settled-3'),
  suggestion('retained','settled-1'),
  suggestion('linked','settled-4',{batchReceipt:{clientId:'cross-round',recordIds:['linked','retained']}}),
  suggestion('chained','settled-5',{batchReceipt:{clientId:'chained-batch',recordIds:['chained','linked']}}),
  suggestion('missing','settled-3',{batchReceipt:{clientId:'incomplete-batch',recordIds:['missing','absent-record']}})
 ];
 const originals=structuredClone(f.state.cardSuggestions),result=compactCollaboration(f.state,now),moved=result.archives.flatMap(a=>a.payload.cardSuggestions);
 assert.deepEqual(moved,originals.slice(0,3));assert.deepEqual(f.state.cardSuggestions,originals.slice(3));
 assert.ok(!f.state.collaborationRounds.some(r=>r.id==='settled-3'));assert.ok(f.state.collaborationRounds.some(r=>r.id==='settled-1'));
 assert.deepEqual(result.archives.find(a=>a.payload.round.id==='settled-4').payload.cardSuggestions,[]);
 assert.deepEqual(result.archives.find(a=>a.payload.round.id==='settled-5').payload.cardSuggestions,[]);
});

test('Compaction never archives pending valid collaboration, review, owner approval or unexpired approved action',()=>{
 const f=proposal();peer(f,'traffic');peer(f,'budget');reviewProposal(f.state,ownerArgs(f),{kind:'owner',id:'owner-local'},now+8000);
 // Three newer settled entries would otherwise push this round outside the history buffer.
 for(let i=0;i<3;i++)f.state.collaborationRounds.unshift({...structuredClone(f.round),id:'closed-'+i,jobId:'unknown-'+i,status:'Concluída',createdAt:new Date(now+10000+i).toISOString()});
 f.state.agents['project-1'].jobId='new-job';
 const before=structuredClone(f.p.reviews),first=compactCollaboration(f.state,now+20000);
 assert.ok(f.state.collaborationRounds.some(r=>r.id===f.round.id));assert.equal(first.archives.length,1);assert.equal(f.p.status,'Aprovada');assert.deepEqual(f.p.reviews,before);
 const expired=compactCollaboration(f.state,now+2*3600000);assert.ok(expired.archives.some(a=>a.payload.round.id===f.round.id));assert.equal(expired.archives.find(a=>a.payload.round.id===f.round.id).payload.proposals[0].status,'Aprovada');assert.ok(f.p.authorizationExpiredAt);
 const pending=proposal();assert.equal(compactCollaboration(pending.state,now+20000).archives.length,0);assert.equal(pending.p.status,'Em revisão');
 peer(pending,'traffic');peer(pending,'budget');assert.equal(compactCollaboration(pending.state,now+21000).archives.length,0);assert.equal(pending.p.status,'Aguardando aprovação');
});

test('Activation context derives the native budget owner from the frozen source and is sealed into approval',()=>{
 const f=ready({row:{status:'PAUSED'}}),args=proposalArgs(f);
 Object.assign(args.payload,{action:'status',before:{status:'PAUSED'},after:{status:'ACTIVE'},activationBudget:{dailyBudget:999999}});
 const p=submitProposal(f.state,args,now+5000);assert.equal(p.payload.activationBudget.dailyBudget,300);assert.equal(p.payload.activationBudget.id,'22222222-2222-4222-8222-222222222222');assert.equal(p.payload.activationBudget.budgetOwner,'CBO');
 const g={...f,p};peer(g,'traffic');peer(g,'budget');p.payload.activationBudget.dailyBudget=9000;
 assert.throws(()=>reviewProposal(f.state,ownerArgs(g),{kind:'owner',id:'owner-local'},now+8000),/Conteúdo da proposta mudou/);
 const lifetime=ready({row:{status:'PAUSED',dailyBudget:null,lifetimeBudget:5000}}),lifeArgs=proposalArgs(lifetime);Object.assign(lifeArgs.payload,{action:'status',before:{status:'PAUSED'},after:{status:'ACTIVE'}});
 const life=submitProposal(lifetime.state,lifeArgs,now+5000);assert.equal(life.payload.activationBudget.lifetimeBudget,5000);assert.equal(life.payload.activationBudget.dailyBudget,null);
});

test('Activation cannot be proposed with missing owner UUID, ambiguous money or unknown financial owner',()=>{
 for(const changes of [{id:undefined},{dailyBudget:null},{dailyBudget:300,lifetimeBudget:5000}]){
  const f=ready({row:{status:'PAUSED',...changes}}),args=proposalArgs(f);Object.assign(args.payload,{action:'status',before:{status:'PAUSED'},after:{status:'ACTIVE'}});
  assert.throws(()=>submitProposal(f.state,args,now+5000),/Ativação|Proprietário/);assert.equal(f.state.proposals.length,0);
 }
});

test('Four perspectives can conclude an empty complete collection without fabricating object evidence or financial proposals',()=>{
 const f=fixture();for(const s of f.state.snapshots)s.rows=[];
 const round=ensureCollaboration(f.state,f.job,now),refs=f.state.snapshots.map(s=>({period:s.period,level:s.level,fetchedAt:s.fetchedAt,empty:true})),opinions=[];let lease,lastArgs,last;
 for(const [i,agentId] of ['traffic','creative','budget','ops'].entries()){
  lease=claim(f.state,round,agentId,i*1000);lastArgs={roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'empty-conclusion-'+agentId,toAgent:agentId==='ops'?'traffic':agentId==='traffic'?'creative':agentId==='creative'?'budget':'ops',kind:'conclusion',text:'Consulta completa sem linhas no recorte; métricas de retorno N/D. Nenhuma proposta financeira.',evidenceRefs:refs};
  last=postCollaboration(f.state,lastArgs,now+i*1000+1);if(agentId!=='ops')opinions.push(last);
  for(const ref of last.evidenceRefs){assert.equal(ref.empty,true);assert.equal(ref.externalId,undefined);assert.equal(ref.adAccountId,undefined);}
 }
 assert.equal(round.status,'Concluída');assert.ok(round.stages.every(s=>s.status==='Concluída'));assert.equal(f.state.proposals.length,0);
 assert.equal(postCollaboration(f.state,lastArgs,now+5000).id,last.id);assert.equal(f.state.collaborationMessages.length,4);
 const args=proposalArgs({...f,round,lease,opinions});args.payload.evidenceRefs=refs;
 assert.throws(()=>submitProposal(f.state,args,now+5000),/leitura de hoje do objeto exato/);assert.equal(f.state.proposals.length,0);
});

test('Empty evidence rejects nonempty, incomplete, replaced, foreign or differently timestamped source cuts',()=>{
 for(const change of ['nonempty','incomplete','foreign-source','foreign-ref','wrong-time','wrong-level','fake-account','fake-object','invalid-marker']){
  const f=fixture();if(change!=='nonempty')for(const s of f.state.snapshots)s.rows=[];
  const round=ensureCollaboration(f.state,f.job,now),lease=claim(f.state,round,'traffic'),ref={period:'today',level:'campaign',fetchedAt:f.state.snapshots.at(-1).fetchedAt,empty:true};
  if(change==='incomplete')f.state.snapshots.at(-1).complete=false;
  if(change==='foreign-source')f.state.snapshots.at(-1).projectId='another-project';
  if(change==='foreign-ref')ref.projectId='another-project';
  if(change==='wrong-time')ref.fetchedAt=new Date(Date.parse(ref.fetchedAt)+1).toISOString();
  if(change==='wrong-level')ref.level='ad';
  if(change==='fake-account')ref.adAccountId='invented-account';
  if(change==='fake-object')ref.externalId='invented-object';
  if(change==='invalid-marker')ref.empty='true';
  assert.throws(()=>postCollaboration(f.state,{roundId:round.id,claimId:lease.claimId,executionRef:lease.executionRef,clientId:'invalid-empty-'+change,toAgent:'creative',kind:'conclusion',text:'Sem linhas no recorte.',evidenceRefs:[ref]},now+1));assert.equal(f.state.collaborationMessages.length,0);
 }
});
