import test from 'node:test';
import assert from 'node:assert/strict';
import {selectLearningFocus,learningFocus,campaignCoverageKey,campaignCoveragePlan,validateCampaignReadings,normalizeCampaignReadings,recordCampaignCoverage,campaignCoveragePolicy,campaignReadingRequirements} from '../lib/campaign-learning-coverage.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';
import {runCloudAnalyst,compactCloudContext} from '../lib/cloud-analysis.mjs';
const now=Date.parse('2026-11-05T18:00:00Z'),iso=n=>new Date(n).toISOString();
function fixture(n=12){
 const rows=Array.from({length:n},(_,i)=>({id:'internal'+i,externalId:'c'+i,adAccountId:'a',name:'[TESTE] Sales '+i,provider:'meta',status:'ACTIVE',spend:1000-i*50,revenueNet:i%2?2000:10,frontOrders:i%2?4:0}));
 const state={config:{p:{projectName:'John'},q:{projectName:'Other'}},agents:{p:{jobId:'job'}},jobs:[{id:'job',project:'p',status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-5000)}],snapshots:[]};
 for(const period of ['7d','3d','yesterday','today'])for(const level of ['campaign','adset','ad'])state.snapshots.push({projectId:'p',projectName:'John',source:'Malva MCP',complete:true,period,level,from:iso(now-86400000),to:iso(now+86400000),timezone:'UTC',fetchedAt:iso(now-1000),rows:level==='campaign'?structuredClone(rows):rows.map(r=>({...r,externalId:r.externalId+'-'+level,campaignExternalId:r.externalId}))});
 return {state,rows,round:ensureCollaboration(state,state.jobs[0],now)};
}
function reading(row={externalId:'c0',adAccountId:'a',spend:1000}){return {adAccountId:row.adAccountId,externalId:row.externalId,assessment:'observe',reason:'Comparar novas vendas depois da edição.',citations:[{period:'today',level:'campaign',externalId:row.externalId,metric:'spend',value:row.spend}]};}
function context(rows){return {campaignReviewPolicy:campaignCoveragePolicy,campaigns:rows.map(r=>({target:r,windows:{today:r},hierarchy:[]}))};}
function credit(state,round,rows,t=now){for(const role of ['traffic','creative','budget','ops'])recordCampaignCoverage(state,{id:role+t,kind:'conclusion',fromAgent:role,campaignReadings:rows.map(reading),createdAt:iso(t)},round);}
test('Four priority targets remain while two rotation targets progressively cover smaller campaigns',()=>{
 const f=fixture(),first=selectLearningFocus(f.state,'p');assert.equal(first.length,6);assert.deepEqual(first.slice(0,4).map(r=>r.externalId),['c0','c1','c2','c3']);assert.deepEqual(first.slice(4).map(r=>r.externalId),['c4','c5']);
 const seen=new Set();for(let i=0;i<5;i++){const focus=selectLearningFocus(f.state,'p');focus.forEach(r=>seen.add(r.externalId));credit(f.state,{...f.round,id:'round'+i},focus,now+i*1000);}assert.equal(seen.size,12);assert.equal(campaignCoveragePlan(f.state,'p').reviewed,12);
});
test('Frozen job focus survives new review credits, and the next job rotates from completed evidence',()=>{
 const f=fixture(),first=selectLearningFocus(f.state,'p');f.state.cloudResearch={p:{jobId:'job',focusPolicy:1,focus:first.map(r=>({adAccountId:r.adAccountId,externalId:r.externalId}))}};credit(f.state,f.round,first);
 assert.deepEqual(learningFocus(f.state,'p'),first);f.state.agents.p.jobId='next';assert.notDeepEqual(learningFocus(f.state,'p').map(r=>r.externalId),first.map(r=>r.externalId));
});
test('Partial, different-round and discussion contributions never count as four-role completion',()=>{
 const f=fixture(),m={id:'traffic',kind:'conclusion',fromAgent:'traffic',campaignReadings:[reading(f.rows[0])],createdAt:iso(now)};recordCampaignCoverage(f.state,m,f.round);for(const role of ['creative','budget','ops'])recordCampaignCoverage(f.state,{...m,id:role,fromAgent:role},{...f.round,id:'different'});assert.equal(campaignCoveragePlan(f.state,'p').reviewed,0);recordCampaignCoverage(f.state,{...m,id:'traffic-next'},{...f.round,id:'different'});assert.equal(campaignCoveragePlan(f.state,'p').reviewed,1);
 const original=f.state.campaignReviewCoverage[campaignCoverageKey('p','a','c0')].lastCompletedAt;recordCampaignCoverage(f.state,{...m,id:'later-message',kind:'message',createdAt:iso(now+1000)},f.round);assert.equal(f.state.campaignReviewCoverage[campaignCoverageKey('p','a','c0')].lastCompletedAt,original);
});
test('Warmup, Kwai, zero-spend, paused and foreign-project campaigns do not enter rotation or counts',()=>{
 const f=fixture(6),s=f.state.snapshots.find(s=>s.level==='campaign'&&s.period==='today');Object.assign(s.rows[0],{name:'[ENGAJAMENTO] Warmup'});s.rows[1].provider='kwai';s.rows[2].spend=0;s.rows[3].status='PAUSED';assert.equal(selectLearningFocus(f.state,'p').length,2);assert.equal(campaignCoveragePlan(f.state,'p').eligible,2);assert.equal(selectLearningFocus(f.state,'q').length,0);
});
test('Every supplied target needs an authored reading with exact numbers; omission and cross-account facts fail',()=>{
 const f=fixture(2),c=context(f.rows),valid=f.rows.map(reading);assert.equal(validateCampaignReadings(valid,c,'traffic').length,2);
 for(const mutate of [r=>r.pop(),r=>r.push(r[0]),r=>r[1]=r[0],r=>r[0].adAccountId='foreign',r=>r[0].citations[0].value=999,r=>r[0].citations=[],r=>r[0].citations[0].externalId='c1']){const r=structuredClone(valid);mutate(r);assert.throws(()=>validateCampaignReadings(r,c,'traffic'));}
 assert.throws(()=>validateCampaignReadings(undefined,c,'traffic'),e=>e.code==='CLOUD_CAMPAIGN_READING_REQUIRED');
});
test('Creative readings must cite a real numeric child; missing data cannot become a candidate',()=>{
 const f=fixture(1),c=context(f.rows),r=reading(f.rows[0]);c.campaigns[0].hierarchy=[{period:'today',level:'ad',rows:[{externalId:'ad',adAccountId:'a',spend:25}]}];assert.throws(()=>validateCampaignReadings([r],c,'creative'));r.citations=[{period:'today',level:'ad',externalId:'ad',metric:'spend',value:25}];assert.doesNotThrow(()=>validateCampaignReadings([r],c,'creative'));
 const empty=context([{externalId:'empty',adAccountId:'a'}]),unknown={adAccountId:'a',externalId:'empty',assessment:'candidate',reason:'Fonte ausente.',citations:[]};assert.throws(()=>validateCampaignReadings([unknown],empty,'traffic'));unknown.assessment='investigate';assert.doesNotThrow(()=>validateCampaignReadings([unknown],empty,'traffic'));
});
test('Real authored contributions retain readings, validate the frozen sources and bind retry content',()=>{
 const f=fixture(1),claim=claimCollaboration(f.state,{roundId:f.round.id,agentId:'traffic',executionRef:'actual-traffic',clientId:'claim'},now),args={roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,kind:'conclusion',toAgent:'ops',clientId:'actual',text:'Leitura numérica desta campanha.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:'a',externalId:'c0',fetchedAt:iso(now-1000)}],campaignReadings:[reading(f.rows[0])]};
 const m=postCollaboration(f.state,args,now);assert.equal(m.campaignReadings[0].citations[0].value,1000);assert.equal(postCollaboration(f.state,args,now).id,m.id);assert.throws(()=>postCollaboration(f.state,{...args,campaignReadings:[{...reading(f.rows[0]),reason:'Different content'}]},now));assert.equal(campaignCoveragePlan(f.state,'p').reviewed,0);
});
test('Unverified campaign readings cannot conclude a stage, mutate coverage or inherit another campaign citation',()=>{
 const f=fixture(1),claim=claimCollaboration(f.state,{roundId:f.round.id,agentId:'traffic',executionRef:'actual-traffic',clientId:'claim'},now),r=reading(f.rows[0]);r.citations[0].value=0;const before=structuredClone(f.state);assert.throws(()=>postCollaboration(f.state,{roundId:f.round.id,claimId:claim.claimId,executionRef:claim.executionRef,kind:'conclusion',toAgent:'ops',clientId:'bad',text:'Incorrect fact',evidenceRefs:[{period:'today',level:'campaign',adAccountId:'a',externalId:'c0',fetchedAt:iso(now-1000)}],campaignReadings:[r]},now));assert.deepEqual(f.state,before);
});
test('Model schema requires exactly the final packet targets and does not fabricate missing campaign readings',async()=>{
 const f=fixture(2),c={...context(f.rows),priorOpinions:[]},out={decision:'Observar',reason:'Conferir resposta',nextStep:'Comparar aquisição',text:'Duas campanhas no pacote.',suggestions:[],question:null};let req;
 await assert.rejects(runCloudAnalyst({run:async(_m,r)=>{req=r;return {response:out};}},'traffic',c),e=>e.code==='CLOUD_CAMPAIGN_READING_REQUIRED');assert.equal(req.response_format.json_schema.properties.campaignReadings.minItems,2);assert.ok(req.response_format.json_schema.required.includes('campaignReadings'));assert.equal(req.max_tokens,3200);
 const valid=await runCloudAnalyst({run:async()=>({response:{...out,campaignReadings:f.rows.map(reading)}})},'traffic',c);assert.equal(valid.campaignReadings.length,2);
});
test('Compaction declares deferred targets and removes corresponding peer readings, preserving full original records',()=>{
 const f=fixture(6),c=context(f.rows);for(const campaign of c.campaigns)campaign.hierarchy=[{period:'today',level:'ad',total:3,rows:Array.from({length:3},()=>({externalId:'ad',adAccountId:'a',name:'x'.repeat(400)}))}];c.priorOpinions=[{id:'peer',fromAgent:'traffic',kind:'conclusion',campaignReadings:f.rows.map(reading)}];const bounded=compactCloudContext(c,4500);assert.ok(bounded.campaigns.length<6);assert.equal(bounded.priorOpinions[0].campaignReadings.length,bounded.campaigns.length);assert.ok(bounded.priorOpinions[0].omittedCampaignReadings>0);assert.equal(c.priorOpinions[0].campaignReadings.length,6);
});
test('Coverage survives message archival and capacity limits preserve existing evidence',()=>{
 const f=fixture(1);credit(f.state,f.round,f.rows);const old=f.state.campaignReviewCoverage[campaignCoverageKey('p','a','c0')];f.state.collaborationMessages=[];assert.equal(campaignCoveragePlan(f.state,'p').reviewed,1);
 for(let i=1;i<5000;i++)f.state.campaignReviewCoverage['bounded-'+i]={};recordCampaignCoverage(f.state,{id:'new',kind:'conclusion',fromAgent:'traffic',createdAt:iso(now),campaignReadings:[reading({externalId:'new',adAccountId:'a',spend:1})]},f.round);assert.equal(Object.keys(f.state.campaignReviewCoverage).length,5000);assert.ok(f.state.campaignReviewCapacity);assert.deepEqual(f.state.campaignReviewCoverage[campaignCoverageKey('p','a','c0')],old);
});

test('Per-campaign requirements expose exact current facts and a creative child citation with scoped failure feedback',async()=>{
 const f=fixture(2),c=context(f.rows);c.campaigns[0].hierarchy=[{period:'today',level:'ad',rows:[{adAccountId:'a',externalId:'actual-child',frontOrders:0,spend:25.123456}]}];
 const requirements=campaignReadingRequirements(c,'creative');assert.equal(requirements[0].childCitationRequired,true);assert.deepEqual(requirements[0].examples[0],{period:'today',level:'ad',externalId:'actual-child',metric:'frontOrders',value:0});assert.equal(requirements[1].childCitationRequired,false);
 const bad=f.rows.map(reading);assert.throws(()=>validateCampaignReadings(bad,c,'creative'),e=>e.readingFailure.externalId==='c0'&&e.readingFailure.adAccountId==='a'&&e.readingFailure.reason==='child_citation_required');bad[0].citations=requirements[0].examples;assert.doesNotThrow(()=>validateCampaignReadings(bad,c,'creative'));
 let req;await runCloudAnalyst({run:async(_m,r)=>{req=r;return {response:{decision:'Observar',reason:'Conferir resposta',nextStep:'Comparar aquisição',text:'Leitura dos dois alvos.',suggestions:[],question:null,campaignReadings:bad}}}},'creative',c);
 const body=JSON.parse(req.messages[1].content);assert.deepEqual(body.campaignReadingRequirements,requirements);const schema=req.response_format.json_schema.properties.campaignReadings.items;assert.deepEqual(schema.properties.externalId.enum,['c0','c1']);assert.equal(schema.properties.citations.minItems,1);
});

test('When actual packet capacity is one, priorities and rotation both receive complete authored reviews over successive rounds',()=>{
 const f=fixture(12),seen=new Set();for(let i=0;i<24;i++){const focus=selectLearningFocus(f.state,'p');for(const id of ['c0','c1','c2','c3'])assert.ok(focus.some(r=>r.externalId===id));const actual=focus.slice(0,1);seen.add(actual[0].externalId);credit(f.state,{...f.round,id:'bounded'+i},actual,now+i*1000);}assert.equal(seen.size,12);assert.equal(campaignCoveragePlan(f.state,'p').reviewed,12);
});
