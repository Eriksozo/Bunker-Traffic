import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  BUNKER_TOOL,BUNKER_COMPAT_TOOL,MALVA_TOOLS,POLL_INTERVAL_MS,CodexMcpClient,LiveRelay,SyncError,acquireLock,
  todayRange,unpackToolResult,publicError,mapCampaignRow,reportTotal,validateReport,
  snapshotFromReports,collectProject,validateLiveState,validateSourceIdentity,parseOptions,confirmImport,createDailyService,
} from '../scripts/local-live-sync.mjs';

const SITE='appgprj_test',WORKSPACE='44444444-4444-4444-8444-444444444444';
const PROJECT={id:'55555555-5555-4555-8555-555555555555',name:'John',timezone:'America/Sao_Paulo',currency:'BRL'};
const SECOND={...PROJECT,id:'66666666-6666-4666-8666-666666666666',name:'Nico'};
const ACCOUNT=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const NOW=Date.parse('2026-11-03T00:38:00.000Z'),FRESH='2026-11-03T00:37:59.900Z';
const range=todayRange(NOW,PROJECT.timezone),clone=v=>structuredClone(v);
function row(i=1,account=ACCOUNT[0],project=PROJECT){return {
  id:`internal-${i}`,projectId:project.id,projectName:project.name,level:'campaign',externalId:`campaign-${i}`,name:`Campanha ${i}`,
  adAccountId:account,accountName:'Conta de teste',provider:'meta',status:'PAUSED',effectiveStatus:'PAUSED',
  budgetCurrency:'USD',budgetRate:5.4378,dailyBudget:4500,lifetimeBudget:null,campaignExternalId:null,adsetExternalId:null,
  accountStatus:{active:true,label:'Ativa'},spend:2755.93,revenue:831.6,revenueNet:775.82,adCosts:110.24,productCost:0,saleTax:0,
  frontOrders:3,orders:5,checkouts:159,refundedOrders:0,refundedRevenue:0,impressions:24508,linkClicks:1048,video3s:14859,videoPlays:23735,
};}
function report(rows=[row()],project=PROJECT,extra={}){return {
  freshAt:FRESH,period:{preset:'custom',timezone:project.timezone,from:range.from,to:range.to,days:[range.day]},
  salesScope:{kind:'traffic'},level:'campaign',currency:project.currency,rows,lastSyncAt:'2026-11-03T00:29:41.293Z',accounts:137,...extra,
};}
function state(projects=[PROJECT]){return {siteProjectId:SITE,paused:false,pollIntervalSeconds:60,
  projects:projects.map(p=>({projectId:p.id,projectName:p.name})),
  items:projects.map(p=>({projectId:p.id,revision:7,snapshot:{sentinel:'previous actual cache'},lastAttemptAt:null,lastSuccessAt:FRESH,error:null})),
};}
class FakeClient{
  constructor(projects=[PROJECT]){this.projects=projects;this.state=state(projects);this.calls=[];this.reads=0;}
  async ensureReady(options){this.calls.push({ready:options});if(options?.source&&this.sourceUnavailable)throw new SyncError('MALVA_UNAVAILABLE');}
  async callTool(server,tool,args){
    this.calls.push({server,tool,args:clone(args)});
    if(server==='malva'){
      if(tool==='workspace_whoami')return {workspace:{id:WORKSPACE}};
      if(tool==='tracking_list_projects')return {items:clone(this.projects)};
      if(tool==='tracking_campaigns')return this.reportHandler?this.reportHandler(args):report([row(1,ACCOUNT[0],this.projects.find(p=>p.id===args.projectId))],this.projects.find(p=>p.id===args.projectId));
      if(tool==='tracking_ad_accounts')return {items:ACCOUNT.map(id=>({id,provider:'meta'}))};
    }
    assert.equal(server,'codex_apps');assert.equal(tool,BUNKER_TOOL);
    if(args.action==='read'){this.reads++;this.onRead?.(this.reads);return clone(this.state);}
    const item=this.state.items.find(i=>i.projectId===args.projectId);
    assert.equal(args.expectedRevision,item.revision);item.revision++;
    if(args.action==='import'){item.snapshot=clone(args.snapshot);item.error=null;}
    else if(args.action==='failure'){item.error=clone(args.error);}
    else assert.fail('Unexpected write');
    return {ok:true,item:clone(item),revision:item.revision};
  }
}
function relay(client){return new LiveRelay({client,workspaceId:WORKSPACE,siteId:SITE,now:()=>NOW});}

test('explicit project-day range stays on yesterday UTC and handles DST day lengths',()=>{
  assert.deepEqual(range,{day:'2026-11-02',from:'2026-11-02T03:00:00.000Z',to:'2026-11-03T03:00:00.000Z',timezone:'America/Sao_Paulo'});
  const spring=todayRange('2026-03-08T15:00:00Z','America/New_York'),fall=todayRange('2026-11-01T15:00:00Z','America/New_York');
  assert.equal(Date.parse(spring.to)-Date.parse(spring.from),23*3600000);
  assert.equal(Date.parse(fall.to)-Date.parse(fall.from),25*3600000);
  assert.throws(()=>todayRange(NOW,'Invalid/Zone'),{code:'SOURCE_INVALID'});
});
test('MCP structured and JSON text results are decoded without leaking remote error prose',()=>{
  assert.deepEqual(unpackToolResult({structuredContent:{projects:[]}}),{projects:[]});
  assert.deepEqual(unpackToolResult({content:[{type:'text',text:'{"rows":[]}'}]}),{rows:[]});
  assert.deepEqual(unpackToolResult({structuredContent:null,content:[{type:'text',text:'{"rows":[]}'}]}),{rows:[]});
  assert.throws(()=>unpackToolResult({isError:true,content:[{type:'text',text:'token=secret LIVE_PAUSED https://private'}]}),e=>e.code==='LIVE_PAUSED'&&!e.message.includes('secret'));
  assert.throws(()=>unpackToolResult({isError:true,structuredContent:{error:{code:'LIVE_CONFLICT',message:'private prose'}},content:[]}),{code:'LIVE_CONFLICT'});
  assert.throws(()=>unpackToolResult({structuredContent:{status:403,code:'unknown',message:'secret'}}),{code:'MCP_UNAVAILABLE'});
  assert.equal(publicError(new Error('bearer sensitive')).message.includes('sensitive'),false);
});
test('mapper preserves source values, native budgets, zeroes, nulls and front/upsell distinction',()=>{
  const raw=row(),mapped=mapCampaignRow({...raw,spendNative:506.81,thumbnailUrl:'private-url'},PROJECT);
  for(const key of ['dailyBudget','budgetCurrency','budgetRate','spend','frontOrders','orders','productCost','lifetimeBudget'])assert.equal(mapped[key],raw[key]);
  assert.equal(Object.hasOwn(mapped,'spendNative'),false);assert.equal(Object.hasOwn(mapped,'thumbnailUrl'),false);
  const missing=mapCampaignRow({...raw,frontOrders:undefined},PROJECT);assert.equal(Object.hasOwn(missing,'frontOrders'),false);
  assert.throws(()=>mapCampaignRow({...raw,spend:'2755.93'},PROJECT),{code:'SOURCE_INVALID'});
});
test('foreign project, wrong provider, wrong account partition and duplicates are rejected',()=>{
  for(const changed of [{projectId:SECOND.id},{projectName:'Other'},{provider:'google'}])assert.throws(()=>mapCampaignRow({...row(),...changed},PROJECT),{code:'SOURCE_IDENTITY'});
  assert.throws(()=>mapCampaignRow(row(),PROJECT,new Set([ACCOUNT[1]])),{code:'SOURCE_IDENTITY'});
  assert.throws(()=>validateReport(report([row(),row()]),PROJECT,range,NOW),{code:'SOURCE_INCOMPLETE'});
  assert.equal(validateReport(report([row(1),row(1,ACCOUNT[1])]),PROJECT,range,NOW).rows.length,2);
});
test('scope, timezone, boundaries, stale data and future source sync cannot masquerade as current data',()=>{
  for(const changed of [
    {salesScope:{kind:'all'}},{currency:'USD'},{period:{...report().period,timezone:'America/Boa_Vista'}},
    {period:{...report().period,to:'2026-11-02T23:59:59Z'}},
  ])assert.throws(()=>validateReport(report(undefined,PROJECT,changed),PROJECT,range,NOW),{code:'SOURCE_INVALID'});
  for(const freshAt of ['2026-11-03T00:30:00.000Z','2026-11-03T00:38:00.001Z'])assert.throws(()=>validateReport(report(undefined,PROJECT,{freshAt}),PROJECT,range,NOW),{code:'SOURCE_STALE'});
  assert.throws(()=>validateReport(report(undefined,PROJECT,{lastSyncAt:'2026-11-03T00:38:00.000Z'}),PROJECT,range,NOW),{code:'SOURCE_INVALID'});
});
test('lastSyncAt null stays unknown and an observed empty report is a valid complete zero-row read',()=>{
  const validated=validateReport(report([],PROJECT,{lastSyncAt:null}),PROJECT,range,NOW);
  const s=snapshotFromReports([validated],PROJECT,range,NOW);
  assert.equal(s.lastSyncAt,null);assert.equal(s.fetchedAt,FRESH);assert.equal(s.complete,true);assert.deepEqual(s.rows,[]);
  assert.throws(()=>snapshotFromReports([validated],PROJECT,range,Date.parse(range.to)),{code:'SOURCE_STALE'});
});
test('truncation count is verified; a malformed or oversized total is never guessed',()=>{
  assert.equal(reportTotal(report([row()],PROJECT,{truncated:{shown:1,total:150}})),150);
  assert.equal(reportTotal(report([row()],PROJECT,{truncated:150})),150);
  for(const truncated of [{shown:2,total:150},{shown:1,total:0},true,0])assert.throws(()=>reportTotal(report([row()],PROJECT,{truncated})),{code:'SOURCE_INVALID'});
  assert.throws(()=>validateReport(report([row()],PROJECT,{truncated:{shown:1,total:3001}}),PROJECT,range,NOW),{code:'SOURCE_LIMIT'});
});
test('complete operational reads use explicit Meta/traffic/active-spent range and preserve source clock',async()=>{
  const client=new FakeClient();const s=await collectProject(client,PROJECT,{now:()=>NOW});
  const queries=client.calls.filter(c=>c.tool==='tracking_campaigns');
  assert.deepEqual(queries.map(c=>c.args),['active','spent'].map(status=>({projectId:PROJECT.id,level:'campaign',sales:'traffic',provider:['meta'],status,accountStatus:'all',preset:'custom',from:'2026-11-02',to:'2026-11-02',limit:100})));
  assert.equal(s.fetchedAt,FRESH);assert.equal(client.calls.some(c=>c.tool==='tracking_ad_accounts'),false);
  assert.deepEqual(s.coverage,{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:0});
});
test('a small source clock lead waits for local time before the unchanged strict validation',async()=>{
  const client=new FakeClient(),future=new Date(NOW+50).toISOString(),waits=[];let clock=NOW;
  client.reportHandler=()=>report([row()],PROJECT,{freshAt:future});
  const snapshot=await collectProject(client,PROJECT,{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.deepEqual(waits,[75]);assert.equal(clock,NOW+75);assert.equal(snapshot.fetchedAt,future);assert.equal(snapshot.complete,true);
  assert.throws(()=>validateReport(report([row()],PROJECT,{freshAt:future}),PROJECT,range,NOW),{code:'SOURCE_STALE'});
});
test('large future clock skew and a read older than five minutes fail without waiting',async()=>{
  for(const freshAt of [new Date(NOW+1001).toISOString(),new Date(NOW-300001).toISOString()]){
    const client=new FakeClient(),waits=[];client.reportHandler=()=>report([row()],PROJECT,{freshAt});
    await assert.rejects(collectProject(client,PROJECT,{now:()=>NOW,wait:async ms=>waits.push(ms)}),{code:'SOURCE_STALE'});assert.deepEqual(waits,[]);
  }
});
test('zero-spend active campaigns and zero-spend paused tracked campaigns remain in the operational snapshot',async()=>{
  const client=new FakeClient(),rows=[{...row(1),status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0},{...row(2),status:'PAUSED',effectiveStatus:'PAUSED',spend:0}];
  client.reportHandler=args=>report(args.status==='active'?[rows[0]]:args.status==='spent'?[]:rows.filter(r=>args.accountIds.includes(r.adAccountId)&&args.campaignIds.includes(r.externalId)));
  const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[rows[1]]});
  assert.equal(snapshot.complete,true);assert.equal(snapshot.rows.length,2);
  assert.deepEqual(snapshot.rows.map(r=>({externalId:r.externalId,status:r.status,effectiveStatus:r.effectiveStatus,spend:r.spend})),rows.map(r=>({externalId:r.externalId,status:r.status,effectiveStatus:r.effectiveStatus,spend:r.spend})));
  const tracked=client.calls.find(c=>c.tool==='tracking_campaigns'&&c.args.status==='all').args;assert.deepEqual(tracked.accountIds,[ACCOUNT[0]]);assert.deepEqual(tracked.campaignIds,['campaign-2']);assert.equal(snapshot.coverage.trackedCount,1);
});
test('more than 100 campaigns are covered by disjoint account partitions without double-counting',async()=>{
  const rows=Array.from({length:150},(_,i)=>row(i,ACCOUNT[Math.floor(i/50)])),client=new FakeClient();
  client.reportHandler=args=>{
    const all=args.accountIds?rows.filter(r=>args.accountIds.includes(r.adAccountId)):rows;
    return report(all.slice(0,100),PROJECT,all.length>100?{truncated:{shown:100,total:all.length}}:{});
  };
  const s=await collectProject(client,PROJECT,{now:()=>NOW});
  assert.equal(s.rows.length,150);assert.equal(new Set(s.rows.map(r=>JSON.stringify([r.adAccountId,r.externalId]))).size,150);
  assert.equal(s.complete,true);assert.equal(client.calls.filter(c=>c.tool==='tracking_campaigns').length,6);
});
test('one account above 100 in active or spent fails explicitly instead of inventing complete coverage',async()=>{
  for(const status of ['active','spent']){
    const client=new FakeClient(),rows=Array.from({length:101},(_,i)=>row(i));
    client.reportHandler=args=>{const all=args.status!==status||args.accountIds&&!args.accountIds.includes(ACCOUNT[0])?[]:rows;return report(all.slice(0,100),PROJECT,all.length>100?{truncated:{shown:100,total:101}}:{});};
    await assert.rejects(collectProject(client,PROJECT,{now:()=>NOW}),{code:'SOURCE_INCOMPLETE'});
  }
});
test('776 historical campaigns never trigger a broad all-state query or a false full-history claim',async()=>{
  const client=new FakeClient(),historical=Array.from({length:776},(_,i)=>({...row(i),status:i<4?'ACTIVE':'PAUSED',effectiveStatus:i<4?'ACTIVE':'PAUSED',spend:0}));
  client.reportHandler=args=>{
    if(args.status==='active')return report(historical.slice(0,4));if(args.status==='spent')return report([]);
    assert.equal(args.status,'all');assert.ok(args.campaignIds?.length>0);return report(historical.filter(r=>args.accountIds.includes(r.adAccountId)&&args.campaignIds.includes(r.externalId)));
  };
  const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[historical[10]]});
  assert.equal(snapshot.rows.length,5);assert.equal(snapshot.complete,true);assert.deepEqual(snapshot.coverage,{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:true,trackedCount:1});
  assert.equal(client.calls.some(c=>c.tool==='tracking_ad_accounts'),false);assert.equal(client.calls.some(c=>c.tool?.includes('budget')||c.tool?.includes('set_ad_status')),false);
});
test('tracked IDs are grouped by exact account and bounded batches without treating old values as current',async()=>{
  const client=new FakeClient(),tracked=Array.from({length:103},(_,i)=>({...row(i,i<101?ACCOUNT[0]:ACCOUNT[1]),spend:0}));
  client.reportHandler=args=>{if(args.status!=='all')return report([]);assert.ok(args.campaignIds.length<=50);return report(tracked.filter(r=>args.accountIds.includes(r.adAccountId)&&args.campaignIds.includes(r.externalId)).map(r=>({...r,status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:2000})));};
  const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:tracked});
  assert.equal(snapshot.coverage.trackedCount,103);assert.equal(snapshot.rows.length,103);assert.ok(snapshot.rows.every(r=>r.status==='ACTIVE'&&r.dailyBudget===2000));
  assert.deepEqual(client.calls.filter(c=>c.args?.status==='all').map(c=>c.args.campaignIds.length),[50,50,1,2]);
});
test('tracked identities already covered by complete active or spent reads are not queried a second time',async()=>{
  const client=new FakeClient(),active={...row(1),status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0},spent=row(2);
  client.reportHandler=args=>{assert.notEqual(args.status,'all');return report(args.status==='active'?[active]:[spent]);};
  const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[active,spent,active]});
  assert.equal(snapshot.rows.length,2);assert.equal(snapshot.coverage.trackedCount,2);assert.equal(snapshot.coverage.trackedComplete,true);assert.deepEqual(client.calls.filter(c=>c.tool==='tracking_campaigns').map(c=>c.args.status),['active','spent']);
});
test('a tracked campaign that left active and spent still receives an exact all-status read showing its pause',async()=>{
  const client=new FakeClient(),previous={...row(1),status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0},paused={...previous,status:'PAUSED',effectiveStatus:'PAUSED'};
  client.reportHandler=args=>report(args.status==='all'?[paused]:[]);
  const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[previous]});
  assert.equal(snapshot.rows.length,1);assert.equal(snapshot.rows[0].status,'PAUSED');assert.equal(snapshot.rows[0].spend,0);assert.equal(snapshot.coverage.trackedCount,1);
  assert.deepEqual(client.calls.find(c=>c.args?.status==='all').args.campaignIds,['campaign-1']);
});
test('identical cohort overlaps deduplicate, while conflicting metadata or financial values fail',async()=>{
  for(const conflict of [null,'dailyBudget','name']){
    const client=new FakeClient(),r=row();client.reportHandler=args=>report([{...r,...(args.status==='spent'&&conflict?{[conflict]:conflict==='dailyBudget'?1:'Different'}:{})}],PROJECT,args.status==='active'?{freshAt:'2026-11-03T00:37:57.000Z',lastSyncAt:'2026-11-03T00:29:40.000Z'}:{});
    if(conflict)await assert.rejects(collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[r]}),{code:'SOURCE_INCOMPLETE'});
    else{const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[r]});assert.equal(snapshot.rows.length,1);assert.equal(snapshot.fetchedAt,'2026-11-03T00:37:57.000Z');assert.equal(snapshot.lastSyncAt,'2026-11-03T00:29:40.000Z');}
  }
});
test('a tracked campaign absent from a complete exact-ID query is not invented as paused or deleted',async()=>{
  const client=new FakeClient();client.reportHandler=()=>report([]);
  const snapshot=await collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[row()]});assert.deepEqual(snapshot.rows,[]);assert.equal(snapshot.coverage.trackedCount,1);assert.equal(snapshot.coverage.trackedComplete,true);
});
test('truncated tracked reads and foreign returned IDs cannot claim cohort coverage',async()=>{
  for(const mode of ['truncated','foreign']){
    const client=new FakeClient();client.reportHandler=args=>args.status==='all'?mode==='truncated'?report([row()],PROJECT,{truncated:{shown:1,total:2}}):report([row(999)]):report([]);
    await assert.rejects(collectProject(client,PROJECT,{now:()=>NOW,trackedRows:[row(),row(2)]}),{code:mode==='truncated'?'SOURCE_INCOMPLETE':'SOURCE_IDENTITY'});
  }
});
test('count drift during account partitioning cannot falsely mark coverage complete',async()=>{
  const client=new FakeClient(),rows=Array.from({length:150},(_,i)=>row(i,ACCOUNT[Math.floor(i/50)]));
  client.reportHandler=args=>{let all=args.accountIds?rows.filter(r=>args.accountIds.includes(r.adAccountId)):rows;if(args.accountIds)all=all.filter(r=>r.externalId!=='campaign-149');return report(all.slice(0,100),PROJECT,all.length>100?{truncated:{shown:100,total:150}}:{});};
  await assert.rejects(collectProject(client,PROJECT,{now:()=>NOW}),{code:'SOURCE_INCOMPLETE'});
});
test('site and workspace identities are pinned, with unique configured projects/revisions',()=>{
  assert.equal(validateLiveState(state(),SITE).siteProjectId,SITE);
  assert.throws(()=>validateLiveState(state(),'appgprj_other'),{code:'BUNKER_IDENTITY'});
  assert.throws(()=>validateLiveState({...state(),items:[]},SITE),{code:'MCP_PROTOCOL'});
  assert.throws(()=>validateSourceIdentity({workspace:{id:'other'}},{items:[PROJECT]},WORKSPACE),{code:'SOURCE_IDENTITY'});
  assert.equal(validateSourceIdentity({workspace:{id:WORKSPACE}},{items:[PROJECT]},WORKSPACE).get(PROJECT.id).name,'John');
});
test('global pause reads only the Bunker, without source collection or any write',async()=>{
  const client=new FakeClient();client.state.paused=true;
  assert.deepEqual(await relay(client).runOnce(),{paused:true,imported:0,failed:0});
  assert.equal(client.calls.some(c=>c.server==='malva'),false);
  assert.deepEqual(client.calls.filter(c=>c.args?.action).map(c=>c.args.action),['read']);
});
test('success imports only the live cache using the exact project revision',async()=>{
  const client=new FakeClient();assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:0});
  const write=client.calls.find(c=>c.args?.action==='import');assert.equal(write.args.expectedRevision,7);assert.equal(write.args.snapshot.rows.length,1);
  assert.equal(client.calls.some(c=>c.tool?.includes('budget')||c.tool?.includes('status')),false);
  assert.equal(client.calls.at(-1).args.action,'read');
});
test('relay tracks the most recently read live cache campaign IDs without importing analysis snapshots',async()=>{
  const client=new FakeClient();client.state.items[0].snapshot={rows:[row(1)]};
  client.onRead=n=>{if(n===2){client.state.items[0].snapshot={rows:[row(2)]};client.state.items[0].revision++;}};
  client.reportHandler=args=>report(args.status==='all'?[{...row(2),status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0}]:[]);
  assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:0});
  const query=client.calls.find(c=>c.args?.status==='all');assert.deepEqual(query.args.campaignIds,['campaign-2']);assert.deepEqual(query.args.accountIds,[ACCOUNT[0]]);
  const write=client.calls.find(c=>c.args?.action==='import');assert.equal(write.args.expectedRevision,8);assert.equal(write.args.snapshot.coverage.trackedCount,1);
  assert.ok(client.calls.filter(c=>c.server==='codex_apps').every(c=>c.tool===BUNKER_TOOL));
});
test('latest project trackedTargets retain paused zero-spend campaigns and duplicate targets are queried once',async()=>{
  const client=new FakeClient(),active={...row(1),status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0},paused={...row(2),spend:0};
  const target=i=>({provider:'meta',level:'campaign',adAccountId:ACCOUNT[0],externalId:`campaign-${i}`});
  client.state.items[0].snapshot={rows:[active]};client.state.projects[0].trackedTargets=[target(999)];
  client.onRead=n=>{if(n===2)client.state.projects[0].trackedTargets=[target(1),target(2),target(2)];};
  client.reportHandler=args=>report(args.status==='active'?[active]:args.status==='spent'?[]:[active,paused].filter(r=>args.campaignIds.includes(r.externalId)));
  assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:0});
  const query=client.calls.find(c=>c.args?.status==='all').args;assert.deepEqual(query.campaignIds,['campaign-2']);
  const snapshot=client.state.items[0].snapshot;assert.equal(snapshot.coverage.trackedCount,2);assert.equal(snapshot.rows.find(r=>r.externalId==='campaign-2').status,'PAUSED');assert.equal(snapshot.rows.find(r=>r.externalId==='campaign-2').spend,0);
});
test('tracked targets from another project are rejected without an import or source budget write',async()=>{
  const client=new FakeClient();client.state.projects[0].trackedTargets=[{provider:'meta',level:'campaign',adAccountId:ACCOUNT[0],externalId:'campaign-2',projectId:SECOND.id}];
  assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:0,failed:1});assert.equal(client.state.items[0].error.code,'SOURCE_IDENTITY');
  assert.equal(client.calls.some(c=>c.args?.action==='import'||c.tool?.includes('budget')),false);
});
test('malformed tracked target arrays and rows fail instead of fabricating empty coverage',async()=>{
  for(const trackedTargets of ['invalid',{}])assert.throws(()=>validateLiveState({...state(),projects:[{...state().projects[0],trackedTargets}]},SITE),{code:'MCP_PROTOCOL'});
  const client=new FakeClient();client.state.projects[0].trackedTargets=[{}];assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:0,failed:1});assert.equal(client.state.items[0].error.code,'SOURCE_IDENTITY');assert.equal(client.calls.some(c=>c.args?.action==='import'),false);
  for(const rows of [null,false,'invalid',{}]){const cached=new FakeClient();cached.state.items[0].snapshot={rows};assert.deepEqual(await relay(cached).runOnce(),{paused:false,imported:0,failed:1});assert.equal(cached.state.items[0].error.code,'SOURCE_INVALID');assert.equal(cached.calls.some(c=>c.args?.action==='import'),false);}
});
test('readback compares normalized full snapshot, same fetchedAt and at least the submitted revision',async()=>{
  const client=new FakeClient();await relay(client).runOnce();const snapshot=client.state.items[0].snapshot;
  assert.equal(confirmImport(client.state,PROJECT.id,snapshot,8).revision,8);
  const reordered=clone(client.state);reordered.items[0].snapshot=Object.fromEntries(Object.entries(snapshot).reverse());
  reordered.items[0].snapshot.rows=snapshot.rows.map(r=>Object.fromEntries(Object.entries(r).reverse()));
  assert.equal(confirmImport(reordered,PROJECT.id,snapshot,8).revision,8);
  for(const change of [s=>{s.items[0].revision=7;},s=>{s.items[0].snapshot.rows[0].spend++;},s=>{s.items[0].snapshot.fetchedAt='2026-11-03T00:37:58.000Z';}]){
    const different=clone(client.state);change(different);assert.throws(()=>confirmImport(different,PROJECT.id,snapshot,8),{code:'BUNKER_WRITE_UNCONFIRMED'});
  }
});
test('a successful write response without matching persisted readback is not reported as synced or retried',async()=>{
  const client=new FakeClient(),original=client.callTool.bind(client);let imports=0;
  client.callTool=async(server,tool,args)=>{if(args?.action==='import'){imports++;return {ok:true,item:{projectId:PROJECT.id},revision:8};}return original(server,tool,args);};
  const result=await relay(client).runOnce();assert.equal(result.imported,0);assert.equal(result.failed,1);assert.equal(imports,1);
  assert.equal(client.calls.some(c=>c.args?.action==='failure'),false);
});
test('source failure preserves the previous snapshot and does not prevent another project update',async()=>{
  const client=new FakeClient([PROJECT,SECOND]);
  client.reportHandler=args=>{if(args.projectId===PROJECT.id)throw new Error('private token in source error');return report([row(1,ACCOUNT[1],SECOND)],SECOND);};
  assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:1});
  assert.deepEqual(client.state.items[0].snapshot,{sentinel:'previous actual cache'});
  assert.equal(client.state.items[0].error.code,'MALVA_UNAVAILABLE');assert.equal(JSON.stringify(client.state).includes('private token'),false);
  assert.equal(client.state.items[1].snapshot.projectId,SECOND.id);
});
test('source readiness failure can still be recorded through the ready Bunker connection',async()=>{
  const client=new FakeClient();client.sourceUnavailable=true;
  await assert.rejects(relay(client).runOnce(),{code:'MALVA_UNAVAILABLE'});
  assert.deepEqual(client.state.items[0].snapshot,{sentinel:'previous actual cache'});
  assert.equal(client.state.items[0].error.code,'MALVA_UNAVAILABLE');assert.equal(client.calls.some(c=>c.server==='malva'),false);
});
test('pause or concurrent cache change between collection and import prevents writing',async()=>{
  for(const pause of [true,false]){
    const client=new FakeClient();client.onRead=n=>{if(n===3){if(pause)client.state.paused=true;else client.state.items[0].revision++;}};
    await relay(client).runOnce();assert.equal(client.calls.some(c=>['import','failure'].includes(c.args?.action)),false);
  }
});
test('ambiguous import timeout is never retried or replaced by a failure record',async()=>{
  const client=new FakeClient(),original=client.callTool.bind(client);let imports=0;
  client.callTool=async(server,tool,args)=>{if(args?.action==='import'){imports++;throw new SyncError('MCP_TIMEOUT');}return original(server,tool,args);};
  assert.equal((await relay(client).runOnce()).failed,1);assert.equal(imports,1);
  assert.equal(client.calls.some(c=>c.args?.action==='failure'),false);
});
test('overlapping laps are rejected instead of duplicating reads/writes',async()=>{
  const client=new FakeClient(),r=relay(client);let release;
  client.ensureReady=()=>new Promise(resolve=>{release=resolve;});const first=r.runOnce();
  await assert.rejects(r.runOnce(),{code:'ALREADY_RUNNING'});
  client.state.paused=true;release();await first;
});
test('client refuses all source mutation tools and arbitrary Bunker actions before dispatch',async()=>{
  const client=new CodexMcpClient();client.ready=true;client.sourceReady=true;client.threadId='test';let sent=0;client.request=async()=>{sent++;return {structuredContent:{}};};
  for(const [server,tool,args] of [['malva','tracking_campaign_budget',{}],['codex_apps','bunker_ler',{}],['codex_apps',BUNKER_TOOL,{action:'approve'}]])await assert.rejects(client.callTool(server,tool,args),{code:'TOOL_NOT_ALLOWED'});
  client.sourceReady=false;await assert.rejects(client.callTool('malva',MALVA_TOOLS[0],{}),{code:'MCP_UNAVAILABLE'});assert.equal(sent,0);
});
test('client checks live runtime connection state, not just a cached tool catalog',async()=>{
  const client=new CodexMcpClient();client.start=async()=>{};client.threadId='test';let inventoryCalls=0;
  client.request=async()=>{inventoryCalls++;return {data:[{name:'codex_apps',runtimeStatus:'connected',tools:{[BUNKER_TOOL]:{}}},{name:'malva',runtimeStatus:'disabled',tools:Object.fromEntries(MALVA_TOOLS.map(t=>[t,{}]))}]};};
  await client.ensureReady({source:false});assert.equal(client.ready,true);assert.equal(client.sourceReady,false);
  await assert.rejects(client.ensureReady({source:true}),{code:'MCP_UNAVAILABLE'});assert.equal(inventoryCalls,2);
});
test('native Bunker live tool is preferred when both catalog entries exist',async()=>{
  const client=new CodexMcpClient();client.start=async()=>{};client.threadId='test';let sent;
  client.request=async(method,params)=>{
    if(method==='mcpServerStatus/list')return {data:[{name:'codex_apps',runtimeStatus:'connected',tools:{[BUNKER_TOOL]:{},[BUNKER_COMPAT_TOOL]:{}}},{name:'malva',runtimeStatus:'connected',tools:Object.fromEntries(MALVA_TOOLS.map(t=>[t,{}]))}]};
    sent={method,...params};return {structuredContent:{result:'read'}};
  };
  await client.ensureReady();await client.callTool('codex_apps',BUNKER_TOOL,{action:'read'});
  assert.equal(sent.tool,BUNKER_TOOL);assert.deepEqual(sent.arguments,{action:'read'});
});
test('old catalog uses only the fixed live-data envelope on the same private Bunker MCP',async()=>{
  const client=new CodexMcpClient();client.start=async()=>{};client.threadId='test';const dispatches=[];
  client.request=async(method,params)=>{
    if(method==='mcpServerStatus/list')return {data:[{name:'codex_apps',runtimeStatus:'connected',tools:{[BUNKER_COMPAT_TOOL]:{}}},{name:'malva',runtimeStatus:'connected',tools:Object.fromEntries(MALVA_TOOLS.map(t=>[t,{}]))}]};
    dispatches.push({method,...params});return {structuredContent:{ok:true}};
  };
  await client.ensureReady();
  for(const input of [{action:'read'},{action:'import',projectId:PROJECT.id,snapshot:{test:true},expectedRevision:7},{action:'failure',projectId:PROJECT.id,expectedRevision:7,error:{code:'SOURCE_INVALID',message:'test'}}]){
    await client.callTool('codex_apps',BUNKER_TOOL,input);const sent=dispatches.at(-1);
    assert.equal(sent.method,'mcpServer/tool/call');assert.equal(sent.server,'codex_apps');assert.equal(sent.tool,BUNKER_COMPAT_TOOL);
    assert.deepEqual(sent.arguments,{id:'live-data',status:'Pendente',revision:0,note:JSON.stringify(input)});
  }
  await assert.rejects(client.callTool('codex_apps',BUNKER_COMPAT_TOOL,{id:'some-other-entry',status:'Concluída'}),{code:'TOOL_NOT_ALLOWED'});
  await assert.rejects(client.callTool('codex_apps',BUNKER_TOOL,{action:'approve'}),{code:'TOOL_NOT_ALLOWED'});
  assert.equal(dispatches.length,3);
});
test('singleton rejects a second live instance, releases only its own lock and recovers stale PID',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bunker-relay-test-')),file=join(dir,'executor.lock');
  try{
    const release=await acquireLock(file);await assert.rejects(acquireLock(file),{code:'ALREADY_RUNNING'});
    await release();await writeFile(file,JSON.stringify({pid:9999999,token:'stale'}));
    const recovered=await acquireLock(file,{isAlive:()=>false});assert.notEqual(JSON.parse(await readFile(file,'utf8')).token,'stale');await recovered();
    await writeFile(file,'');await assert.rejects(acquireLock(file),{code:'LOCK_INVALID'});assert.equal(await readFile(file,'utf8'),'');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI pins site/workspace and offers only check, once or a fixed 60-second loop',()=>{
  const options=parseOptions(['--workspace-id',WORKSPACE,'--site-id',SITE,'--check']);assert.equal(options.check,true);assert.equal(POLL_INTERVAL_MS,60000);
  for(const args of [[],['--workspace-id',WORKSPACE],['--workspace-id',WORKSPACE,'--site-id',SITE,'--once','--check'],['--workspace-id',WORKSPACE,'--site-id',SITE,'--tool','arbitrary']])assert.throws(()=>parseOptions(args),{code:'INVALID_OPTIONS'});
});
test('a three-minute live cycle services daily demand between projects without parallel source calls',async()=>{
  const projects=Array.from({length:6},(_,i)=>({...PROJECT,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:'Project '+i})),client=new FakeClient(projects);
  let clock=NOW,sourceRunning=false;const trace=[],dailyChecks=[];
  client.reportHandler=async args=>{
    assert.equal(sourceRunning,false);sourceRunning=true;
    try{await Promise.resolve();const p=projects.find(p=>p.id===args.projectId);if(args.status==='active'){clock+=30000;trace.push('project:'+p.name);}return report([row(1,ACCOUNT[0],p)],p,{freshAt:new Date(clock).toISOString()});}
    finally{sourceRunning=false;}
  };
  const serviceDaily=createDailyService({clock:()=>clock,daily:{async runOnce(){assert.equal(sourceRunning,false);dailyChecks.push(clock);trace.push('daily');await Promise.resolve();return {paused:false,imported:0,failed:0};}}});
  const r=new LiveRelay({client,workspaceId:WORKSPACE,siteId:SITE,now:()=>clock,serviceDaily});
  assert.deepEqual(await r.runOnce(),{paused:false,imported:6,failed:0});
  assert.equal(clock-NOW,180000);assert.equal(dailyChecks.length,6);assert.deepEqual(dailyChecks.map(at=>at-NOW),[0,30000,60000,90000,120000,150000]);
  assert.ok(trace.indexOf('daily',trace.indexOf('project:Project 0'))<trace.indexOf('project:Project 1'));
  assert.equal(client.calls.filter(c=>c.args?.action==='import').length,6);assert.equal(POLL_INTERVAL_MS,60000);
});
test('daily boundary failure is independent from live source failures and does not starve later projects',async()=>{
  const client=new FakeClient([PROJECT,SECOND]),events=[],boundaries=[];
  client.reportHandler=args=>{if(args.projectId===PROJECT.id)throw new Error('source unavailable');return report([row(1,ACCOUNT[1],SECOND)],SECOND);};
  const r=new LiveRelay({client,workspaceId:WORKSPACE,siteId:SITE,now:()=>NOW,log:e=>events.push(e),serviceDaily:async()=>{boundaries.push(true);throw new Error('private daily error');}});
  assert.deepEqual(await r.runOnce(),{paused:false,imported:1,failed:1});assert.equal(boundaries.length,2);assert.equal(events.filter(e=>e.event==='daily_boundary_unavailable').length,2);assert.equal(JSON.stringify(events).includes('private daily error'),false);assert.equal(client.state.items[1].snapshot.projectId,SECOND.id);
});
test('daily service throttles boundary checks, backs off independently and never overlaps runs',async()=>{
  let clock=0,runs=0,release,fail=false;const controller=new AbortController(),events=[];
  const service=createDailyService({clock:()=>clock,signal:controller.signal,log:e=>events.push(e),daily:{async runOnce(){runs++;if(runs===1)await new Promise(resolve=>{release=resolve;});if(fail)throw new Error('private');return {failed:0};}}});
  const first=service();assert.deepEqual(await service(),{failed:0});assert.equal(runs,1);release();await first;
  clock=9999;await service();assert.equal(runs,1);clock=10000;fail=true;assert.deepEqual(await service(),{failed:1});assert.equal(runs,2);
  clock=69999;await service();assert.equal(runs,2);clock=70000;fail=false;await service();assert.equal(runs,3);
  controller.abort();clock=100000;await service();assert.equal(runs,3);assert.equal(events.length,1);assert.equal(JSON.stringify(events).includes('private'),false);
});
