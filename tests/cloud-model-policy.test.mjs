import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudModelPolicy,cloudModelContent,cloudProductionModelPolicy} from '../lib/cloud-model-policy.mjs';
import {runCloudAnalyst,compactCloudContext,cloudAnalysisContext} from '../lib/cloud-analysis.mjs';
import {createCloudEngine} from '../lib/cloud-engine.mjs';
import {ensureCollaboration} from '../lib/collaboration.mjs';
const envelope=value=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const value={decision:'Observar',reason:'Aguardar aquisição nova.',nextStep:'Comparar novas compras.',text:'Amostra analisada sem executar ação.',suggestions:[],question:null};
test('Model policies are a fixed allowlist; wide content uses only the complete final assistant message',()=>{
 const p=cloudModelPolicy('wide');assert.equal(cloudProductionModelPolicy,'wide');assert.equal(p.model,'@cf/openai/gpt-oss-120b');assert.equal(p.contextBytes,160000);assert.ok(p.retryContextBytes<p.contextBytes);assert.equal(cloudModelContent(envelope(value),p),JSON.stringify(value));
 for(const id of ['https://external.test','constructor','__proto__'])assert.throws(()=>cloudModelPolicy(id),e=>e.code==='CLOUD_AI_POLICY');
 for(const response of [{response:value},{choices:[{finish_reason:'length',message:{role:'assistant',content:JSON.stringify(value).slice(0,-1)}}]},{choices:[{finish_reason:'stop',message:{role:'assistant',reasoning_content:JSON.stringify(value)}}]},{choices:[{finish_reason:'stop',message:{role:'tool',content:JSON.stringify(value)}}]},{choices:[{finish_reason:'stop',message:{role:'assistant',content:''}}]}])assert.throws(()=>cloudModelContent(response,p),e=>e.code==='CLOUD_AI_INVALID');
});
test('Wide generation keeps schema validation and rejects foreign targets, malformed final JSON and unknown policies',async()=>{
 const context={campaigns:[{target:{adAccountId:'a',externalId:'c'}}]};let calls=0;
 const ai={run:async(model,request)=>{calls++;assert.equal(model,cloudModelPolicy('wide').model);assert.equal(request.max_tokens,4400);assert.equal(request.response_format.type,'json_schema');return envelope(value);}};
 const out=await runCloudAnalyst(ai,'traffic',context,'wide');assert.equal(out.modelPolicy,'wide');assert.equal(out.analysisTargets.length,1);
 await assert.rejects(runCloudAnalyst(ai,'traffic',context,'unknown'),e=>e.code==='CLOUD_AI_POLICY');assert.equal(calls,1);
 await assert.rejects(runCloudAnalyst({run:async()=>envelope({...value,suggestions:[{adAccountId:'foreign',objectId:'c',action:'pause',percent:null,reason:'Wrong account'}]})},'ops',context,'wide'),e=>e.code==='CLOUD_AI_SCOPE');
 await assert.rejects(runCloudAnalyst({run:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'not-json',reasoning_content:JSON.stringify(value)}}]})},'traffic',context,'wide'),e=>e.code==='CLOUD_AI_INVALID');
});
test('The production model packet reaches all six campaigns and four roles without legacy pre-compaction or provider writes',async()=>{
 const now=Date.now(),iso=n=>new Date(n).toISOString(),start=Date.parse(iso(now).slice(0,10)+'T00:00:00Z'),project='p',rows=Array.from({length:6},(_,i)=>({id:'internal-'+i,externalId:'campaign-'+i,adAccountId:'account-'+i,provider:'meta',level:'campaign',name:'Sales '+i,accountName:'Account '+i,status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:1000,budgetCurrency:'BRL',spend:100+i,revenueNet:200+i,adCosts:5,productCost:0,saleTax:0,frontOrders:2,orders:3,checkouts:8}));
 let state={config:{p:{projectName:'Example'}},jobs:[{id:'job',project,status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)}],agents:{p:{jobId:'job'}},snapshots:[],collaborationRounds:[],collaborationMessages:[],proposals:[],executions:[]};
 for(const period of ['today','yesterday','3d','7d'])for(const level of ['campaign','adset','ad'])state.snapshots.push({projectId:project,projectName:'Example',period,level,source:'Malva MCP',complete:true,from:iso(start-({today:0,yesterday:1,'3d':3,'7d':7}[period])*86400000),to:iso(start+(period==='today'?86400000:0)),timezone:'UTC',fetchedAt:iso(now-1000),rows:rows.map(r=>level==='campaign'?{...r}:{...r,level,externalId:level+'-'+r.externalId,campaignExternalId:r.externalId})});
 const round=ensureCollaboration(state,state.jobs[0],now);state.cloudResearch={p:{jobId:'job',details:rows.map(r=>({adAccountId:r.adAccountId,externalId:r.externalId,detail:{notes:('Distinct synthetic research context for '+r.externalId+'. ').repeat(200)}}))}};
 const context=cloudAnalysisContext(state,round,rows,'traffic');context.campaignReviewPolicy={version:1};assert.ok(compactCloudContext(context).campaigns.length<6);assert.equal(compactCloudContext(context,160000).campaigns.length,6);
 let calls=0;const ai={run:async(model,request)=>{calls++;assert.equal(model,cloudModelPolicy('wide').model);assert.equal(request.max_tokens,6400);const b=JSON.parse(request.messages[1].content),r=b.reflectionRequirements;assert.equal(b.context.campaigns.length,6);return envelope({...value,campaignReadings:b.evidenceSelection.campaignExamples.map(c=>({...c,assessment:'observe',reason:'Conferir aquisição no próprio objeto.'})),reflection:{lesson:'Conferir aquisição e dados atuais.',uncertainty:'Resultado futuro não medido.',nextCheck:'Comparar novas compras após edição.',citations:b.evidenceSelection.reflectionExamples.slice(0,1),peerChecks:r.peerConclusions.map(p=>({messageId:p.messageId,stance:'inconclusive',reason:'Sem resultado posterior comprovado.'}))}});}};
 const engine=createCloudEngine({modelPolicy:cloudProductionModelPolicy,read:async()=>({state:structuredClone(state),revision:1}),write:async fn=>{const next=structuredClone(state),out=await fn(next,1);state=next;return out;},source:{dispatch:async()=>{throw Error('No approval');}},ai,ops:{}});
 for(let i=0;i<4;i++){const out=await engine.step();assert.equal(out.kind,'stage');assert.equal(out.prioritized,6);assert.equal(out.deferredTargets,0);assert.equal(out.model,'Workers AI gpt-oss-120b');}
 assert.equal(calls,4);assert.equal(state.collaborationMessages.filter(m=>m.kind==='conclusion').length,4);for(const m of state.collaborationMessages.filter(m=>m.kind==='conclusion')){assert.equal(m.analysisCoverage.reviewed,6);assert.equal(m.model.policy,'wide');assert.equal(m.campaignReadings.length,6);}assert.equal(state.proposals.length,0);assert.equal(state.executions.length,0);
});
test('a reply to a teammate question gets the stage output cap; other non-stage calls keep the smaller cap',async()=>{
 const {cloudOutputTokens}=await import('../lib/cloud-analysis.mjs');const wide=cloudModelPolicy('wide'),legacy=cloudModelPolicy('legacy');
 assert.equal(cloudOutputTokens(wide,{campaignReviewPolicy:{}}),6400);assert.equal(cloudOutputTokens(wide,{receivedQuestion:{id:'m1'}}),6400);assert.equal(cloudOutputTokens(wide,{}),4400);
 assert.equal(cloudOutputTokens(legacy,{receivedQuestion:{id:'m1'}}),3200);assert.equal(cloudOutputTokens(legacy,{}),2200);
 let request;const reply={...value,campaignReadings:[]};
 await runCloudAnalyst({run:async(_m,r)=>{request=r;return envelope(reply);}},'ops',{project:'p',campaigns:[],receivedQuestion:{id:'m1',fromAgent:'traffic',text:'Qual o risco?'}},'wide');
 assert.equal(request.max_tokens,6400);
});

test('only the retry right after a cut changes sampling, never the cap; other failures and policies keep the base',async()=>{
 const {cloudGenerationParams}=await import('../lib/cloud-analysis.mjs');
 const wide=cloudModelPolicy('wide'),legacy=cloudModelPolicy('legacy'),stage={campaignReviewPolicy:{}};
 assert.deepEqual(cloudGenerationParams(wide,stage),{maxTokens:6400,temperature:0.1,topP:null,adjustment:null});
 assert.deepEqual(cloudGenerationParams(wide,stage,'output_truncated'),{maxTokens:6400,temperature:1,topP:1,adjustment:'after_output_truncated'});
 for(const other of ['invalid_final_json','invalid_schema','foreign',null])assert.equal(cloudGenerationParams(wide,stage,other).adjustment,null,String(other));
 assert.deepEqual(cloudGenerationParams(legacy,stage,'output_truncated'),{maxTokens:3200,temperature:0.1,topP:null,adjustment:null});
 assert.equal(cloudGenerationParams(wide,{},'output_truncated').maxTokens,4400);
 // The failure of a retried attempt records the sampling that was actually sent.
 const {runCloudAnalyst}=await import('../lib/cloud-analysis.mjs');
 await assert.rejects(runCloudAnalyst({run:async()=>({choices:[{finish_reason:'length',message:{role:'assistant',content:''}}]})},'traffic',{campaigns:[]},'wide',{retryAfter:'output_truncated'}),e=>e.modelFailure.maxTokens===4400&&e.modelFailure.temperature===1&&e.modelFailure.adjustment==='after_output_truncated');
 await assert.rejects(runCloudAnalyst({run:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{'}}]})},'traffic',{campaigns:[]},'wide'),e=>e.modelFailure.temperature===0.1&&e.modelFailure.adjustment===undefined);
});

test('a cut that is one complete JSON object plus only whitespace is the full answer; anything else stays truncated',async()=>{
 const {cloudModelContent,completeBeforeWhitespace}=await import('../lib/cloud-model-policy.mjs');
 const wide=cloudModelPolicy('wide'),json=JSON.stringify({decision:'Observar',reason:'Motivo.',nextStep:'Comparar.',text:'Texto.',suggestions:[],question:null});
 const cut=(content,role='assistant')=>({choices:[{finish_reason:'length',message:{role,content}}],usage:{completion_tokens:6400}});
 for(const tail of [' '.repeat(5000),'\n'.repeat(3000),' \t\n'.repeat(900),''])assert.equal(cloudModelContent(cut(json+tail),wide),json,JSON.stringify(tail.slice(0,3)));
 const refused=[json.slice(0,-1)+' '.repeat(5000),json+' Obrigado.'+' '.repeat(3000),'[1,2]'+' '.repeat(3000),'```json\n'+json+'\n```'+' '.repeat(3000),'<|channel|>final<|message|>'+json+' '.repeat(3000),json+json+' '.repeat(100),'Resposta: '+json+' '.repeat(3000),'   ',null];
 for(const c of refused)assert.throws(()=>cloudModelContent(cut(c),wide),e=>e.modelFailure.reason==='output_truncated',String(c).slice(0,30));
 assert.throws(()=>cloudModelContent(cut(json+' '.repeat(10),'tool'),wide),e=>e.modelFailure.reason==='output_truncated','only the assistant message');
 assert.equal(completeBeforeWhitespace('{"a":1}  '),true);assert.equal(completeBeforeWhitespace('{"a":1'),false);assert.equal(completeBeforeWhitespace('null'),false);
 // The analysis records the recovery; a normal stop does not.
 const {runCloudAnalyst}=await import('../lib/cloud-analysis.mjs');
 const ok=await runCloudAnalyst({run:async()=>cut(json+' '.repeat(6000))},'traffic',{campaigns:[]},'wide');
 assert.equal(ok.decision,'Observar');assert.equal(ok.generationProfile.recovered,'trailing_whitespace');
 const normal=await runCloudAnalyst({run:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:json}}]})},'traffic',{campaigns:[]},'wide');
 assert.equal(normal.generationProfile.recovered,undefined);
});
