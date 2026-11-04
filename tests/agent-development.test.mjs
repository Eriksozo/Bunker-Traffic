import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgentReflection,retainAgentEpisodes,agentDevelopmentPlan,cloudAgentMemory} from '../lib/agent-development.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration,compactCollaboration} from '../lib/collaboration.mjs';
import {runCloudAnalyst,validateCloudReflection,cloudAnalysisContext,compactCloudContext} from '../lib/cloud-analysis.mjs';
const now=Date.parse('2026-11-04T16:00:00Z'),iso=x=>new Date(x).toISOString();
const citation={period:'today',level:'campaign',adAccountId:'a',externalId:'c',metric:'spend',value:309.83};
const reflection=()=>({lesson:'Uma venda isolada não sustenta aquisição.',uncertainty:'Atribuição pode mudar.',nextCheck:'Conferir novas compras após a edição.',citations:[{...citation}],peerChecks:[]});
function fixture(){
 const state={config:{p:{projectName:'Example'},q:{projectName:'Other'}},snapshots:[],jobs:[],ownerChoices:[]};
 for(const period of ['7d','3d','yesterday','today'])for(const level of ['campaign','adset','ad'])state.snapshots.push({projectId:'p',projectName:'Example',period,level,source:'Malva MCP',complete:true,from:iso(now-86400000),to:iso(now+3600000),timezone:'UTC',fetchedAt:iso(now-1000),rows:[{externalId:level==='campaign'?'c':level,adAccountId:'a',campaignExternalId:level==='campaign'?null:'c',spend:309.83,frontOrders:0,orders:1,provider:'meta',status:'ACTIVE',name:'Sales'}]});
 const job={id:'job',project:'p',status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-2000)};state.jobs.push(job);const round=ensureCollaboration(state,job,now),refs=[{...citation,fetchedAt:iso(now-1000)}];delete refs[0].metric;delete refs[0].value;
 return {state,round,refs};
}
function contribute(f,role,body=reflection()){
 const c=claimCollaboration(f.state,{roundId:f.round.id,agentId:role,executionRef:'actual-'+role,clientId:'claim-'+role},now);
 const args={roundId:f.round.id,claimId:c.claimId,executionRef:c.executionRef,toAgent:role==='ops'?'traffic':'ops',kind:'conclusion',clientId:'msg-'+role,text:'Parecer com evidência, sem eficácia presumida.',evidenceRefs:f.refs,reflection:body};
 return {message:postCollaboration(f.state,args,now),args};
}
test('reflection validates raw numbers and child-parent evidence; it never credits a financial outcome',()=>{
 const f=fixture(),r=normalizeAgentReflection(reflection(),{...f,agentId:'traffic',evidenceRefs:f.refs});assert.equal(r.numericCitationsChecked,true);assert.equal(r.causality,false);assert.equal(r.classification,'Hipótese do agente');
 const child=reflection();child.citations[0]={...citation,level:'ad',externalId:'ad'};assert.doesNotThrow(()=>normalizeAgentReflection(child,{...f,agentId:'creative',evidenceRefs:f.refs}));
});
test('invented, rounded, null, duplicate, foreign-account and unreferenced numbers are rejected',()=>{
 const f=fixture();for(const edit of [r=>r.citations[0].value=310,r=>r.citations[0].value=0,r=>r.citations[0].adAccountId='other',r=>r.citations.push({...citation}),r=>{r.citations[0].metric='frontOrders';r.citations[0].value=1;}]){const r=reflection();edit(r);assert.throws(()=>normalizeAgentReflection(r,{...f,agentId:'traffic',evidenceRefs:f.refs}));}
 f.state.snapshots.find(s=>s.level==='campaign'&&s.period==='today').rows[0].frontOrders=null;const r=reflection();r.citations[0]={...citation,metric:'frontOrders',value:0};assert.throws(()=>normalizeAgentReflection(r,{...f,agentId:'traffic',evidenceRefs:f.refs}));assert.throws(()=>normalizeAgentReflection(reflection(),{...f,agentId:'traffic',evidenceRefs:[]}));
});
test('peer critique binds a real other author in the same round and rejects fictional consensus',()=>{
 const f=fixture(),m=contribute(f,'traffic').message,r=reflection();r.peerChecks=[{messageId:m.id,stance:'challenge',reason:'Falta separar front de pedidos.'}];assert.doesNotThrow(()=>normalizeAgentReflection(r,{...f,agentId:'creative',evidenceRefs:f.refs}));
 assert.throws(()=>normalizeAgentReflection(r,{...f,agentId:'traffic',evidenceRefs:f.refs}));r.peerChecks[0].messageId='invented';assert.throws(()=>normalizeAgentReflection(r,{...f,agentId:'budget',evidenceRefs:f.refs}));
});
test('authored reflection follows immutable claim ownership and idempotency',()=>{
 const f=fixture(),{message,args}=contribute(f,'traffic');assert.equal(postCollaboration(f.state,args,now).id,message.id);assert.throws(()=>postCollaboration(f.state,{...args,reflection:{...reflection(),lesson:'Different'}},now));assert.equal(f.state.collaborationMessages.length,1);assert.equal(message.fromAgent,'traffic');assert.equal(f.state.proposals.length,0);
});
test('rejected reflection cannot partially conclude a stage or persist a false memory',()=>{
 const f=fixture(),r=reflection();r.citations[0].value=999;assert.throws(()=>contribute(f,'traffic',r));assert.equal(f.round.stages[0].status,'Em análise');assert.equal(f.state.collaborationMessages.length,0);assert.equal(f.state.agentEpisodes,undefined);
});
test('individual recall stays project/role-scoped and unknown financial efficacy remains N/D',()=>{
 const f=fixture();contribute(f,'traffic');const plan=agentDevelopmentPlan(f.state,'p',now);assert.equal(plan.agents[0].grounded,1);assert.equal(plan.agents[1].grounded,0);assert.ok(plan.agents.every(a=>a.financialSuccessRate===null));assert.ok(agentDevelopmentPlan(f.state,'q',now).agents.every(a=>!a.episodes));assert.throws(()=>agentDevelopmentPlan(f.state,'missing',now));
 const memory=cloudAgentMemory(f.state,{...f.round,id:'next'},'traffic',[{adAccountId:'a',externalId:'c'}],{items:[]},now);assert.equal(memory.episodes.length,1);assert.equal(cloudAgentMemory(f.state,f.round,'traffic',[],null,now).episodes.length,0);
});
test('a challenged lesson is recalled with the actual peer counterexample, not converted into consensus',()=>{
 const f=fixture(),m=contribute(f,'traffic').message,r=reflection();r.peerChecks=[{messageId:m.id,stance:'challenge',reason:'Uma venda não prova recorrência.'}];contribute(f,'creative',r);
 const recall=cloudAgentMemory(f.state,{...f.round,id:'next'},'traffic',[{adAccountId:'a',externalId:'c'}],null,now);assert.equal(recall.episodes[0].peerFeedback[0].stance,'challenge');assert.equal(recall.episodes[0].peerFeedback[0].fromAgent,'creative');assert.match(recall.episodes[0].peerFeedback[0].reason,/recorrência/);assert.match(recall.next,/contrapontos/);
});
test('future and old episodes are excluded and repeated campaign copies do not fill retrieval',()=>{
 const f=fixture(),m=contribute(f,'traffic').message;f.state.collaborationMessages=Array.from({length:8},(_,i)=>({...m,id:'repeat'+i}));f.state.collaborationMessages.push({...m,id:'future',createdAt:iso(now+1000)},{...m,id:'old',createdAt:iso(now-31*86400000)});const a=agentDevelopmentPlan(f.state,'p',now).agents[0];assert.equal(a.episodes,8);assert.equal(a.recall.length,1);
});
test('archive cache is bounded and original immutable evidence is preserved',()=>{
 const f=fixture(),m=contribute(f,'traffic').message,archives=Array.from({length:20},(_,i)=>({key:'collaboration:r'+i,payload:{round:{sourceHash:'hash'+i},messages:[{...m,id:'msg'+i,createdAt:iso(now-i*1000)}]}})),before=JSON.stringify(archives);retainAgentEpisodes(f.state,archives);assert.equal(f.state.agentEpisodes.length,8);assert.equal(JSON.stringify(archives),before);retainAgentEpisodes(f.state,archives);assert.equal(f.state.agentEpisodes.length,8);
 assert.equal(agentDevelopmentPlan(f.state,'p',now).agents[0].episodes,9); // one live plus eight archived, by message identity
});
test('normal collaboration compaction preserves reflection in both durable archive and role recall',()=>{
 const f=fixture();for(const r of ['traffic','creative','budget','ops'])contribute(f,r);const original=f.round;for(let i=0;i<2;i++)f.state.collaborationRounds.push({...structuredClone(original),id:'newer'+i,jobId:'j'+i,createdAt:iso(now+i+1),stages:structuredClone(original.stages)});
 const result=compactCollaboration(f.state,now+100);assert.equal(result.archives.length,1);assert.equal(result.archives[0].payload.messages[0].reflection.citations[0].value,309.83);assert.equal(f.state.agentEpisodes.length,4);
});
test('owner feedback is explicitly team alignment and never personal financial success',()=>{
 const f=fixture(),m=contribute(f,'traffic').message;f.state.ownerChoices=[{id:'choice',project:'p',createdAt:iso(now),teamOpinionIds:[m.id],action:'reduce',suggestedAction:'reduce',percent:30,suggestedPercent:20,suggestionOrigin:'team'}];const a=agentDevelopmentPlan(f.state,'p',now).agents[0];assert.equal(a.teamAgreementRate,0);assert.equal(a.financialSuccessRate,null);assert.equal(a.ownerComparisons,1);
});
test('unknown reflection keys cannot smuggle config or automatic execution permissions',()=>{
 const f=fixture();for(const extra of [{autoExecute:true},{config:{dailyCap:999}},{agentId:'ops'}])assert.throws(()=>normalizeAgentReflection({...reflection(),...extra},{...f,agentId:'traffic',evidenceRefs:f.refs}));
});
const output=()=>({decision:'Conter',reason:'Conferir perda',nextStep:'Conferir fontes',text:'Aguardar aprovação exata.',suggestions:[{adAccountId:'a',objectId:'c',action:'reduce',percent:20,reason:'Perda'}],question:null,reflection:reflection()});
function packet(){return {campaigns:[{target:{adAccountId:'a',externalId:'c'},windows:{today:{spend:309.83}},hierarchy:[]}],priorOpinions:['traffic','creative','budget'].map(role=>({id:role,kind:'conclusion',fromAgent:role})),agentMemory:{role:'ops'}};}
test('synthesis without all three independent peer checks is held, not silently approved',()=>{
 const c=packet(),out=output();validateCloudReflection(out,c,'ops');assert.equal(out.suggestions.length,0);out.reflection.peerChecks=c.priorOpinions.map(m=>({messageId:m.id,stance:'support',reason:'Conferido neste escopo.'}));out.suggestions=output().suggestions;validateCloudReflection(out,c,'ops');assert.equal(out.suggestions.length,1);
});
test('material challenge, unanswered question or unknown peer verdict holds financial suggestions',()=>{
 for(const mode of ['challenge','inconclusive','pending','question']){const c=packet(),out=output();out.reflection.peerChecks=c.priorOpinions.map(m=>({messageId:m.id,stance:'support',reason:'Conferido.'}));if(mode==='pending')c.priorOpinions.push({id:'q',kind:'message',requiresReply:true});else if(mode==='question')out.question={toAgent:'traffic',text:'Conferir aquisição?'};else out.reflection.peerChecks[0].stance=mode;validateCloudReflection(out,c,'ops');assert.equal(out.suggestions.length,0);}
});
test('model citations must belong to the bounded packet, not an omitted child or another campaign',()=>{
 const c=packet();for(const edit of [r=>r.citations[0].value=310,r=>r.citations[0].externalId='omitted',r=>r.citations.push({...citation})]){const out=output();edit(out.reflection);assert.throws(()=>validateCloudReflection(out,c,'ops'));}
});
test('cloud reflection is required when memory protocol is enabled; legacy packets stay readable',async()=>{
 const out=output();delete out.reflection;out.suggestions=[];let request;const ai={run:async(_m,r)=>{request=r;return {response:out};}};await assert.rejects(runCloudAnalyst(ai,'ops',packet()),e=>e.code==='CLOUD_REFLECTION_MISSING');assert.ok(request.response_format.json_schema.required.includes('reflection'));assert.doesNotThrow(()=>validateCloudReflection(out,{campaigns:[]},'traffic'));
});
test('pattern validation labels remain separate from hypotheses, and choices from unrelated objects are not recalled',()=>{
 const f=fixture();f.state.ownerChoices=[{id:'local',project:'p',objectId:'c',adAccountId:'a',createdAt:iso(now),action:'pause'},{id:'foreign',project:'q',objectId:'c',adAccountId:'a',createdAt:iso(now),action:'increase'},{id:'unrelated',project:'p',objectId:'other',adAccountId:'a',createdAt:iso(now),action:'increase'}];const cycle={items:[{id:'k',project:'p',stage:'Revisar padrão',advisoryEligible:false,reasons:['Desfavorável'],counts:{adverse:1}}]};const c=cloudAgentMemory(f.state,f.round,'traffic',[{adAccountId:'a',externalId:'c'}],cycle,now);assert.equal(c.ownerFeedback.length,1);assert.equal(c.ownerFeedback[0].choiceId,'local');assert.equal(c.patternValidation[0].advisoryEligible,false);
});
test('memory compaction declares omissions and preserves current observation values',()=>{
 const c=packet();c.agentMemory={episodes:Array.from({length:3},(_,i)=>({id:i,lesson:'x'.repeat(3000)})),ownerFeedback:[],patternValidation:[]};const out=compactCloudContext(c,5000);assert.equal(out.campaigns[0].windows.today.spend,309.83);assert.equal(out.coverage.omittedAgentMemory.episodes,2);assert.equal(c.agentMemory.episodes.length,3);
});
