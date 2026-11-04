import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {dailyDataAction} from '../lib/campaign-daily-data.mjs';
import {BUNKER_DAILY_TOOL,DAILY_CHECK_INTERVAL_MS,DailyRelay,DailySyncError,dailyPublicError,dailyRange,dailySnapshot,validateDailyPending,waitWithDaily} from '../scripts/local-daily-sync.mjs';
import {BUNKER_TOOL,BUNKER_COMPAT_TOOL,CodexMcpClient,MALVA_TOOLS,POLL_INTERVAL_MS} from '../scripts/local-live-sync.mjs';

const SITE='appgprj_test',WORKSPACE='44444444-4444-4444-8444-444444444444';
const NOW=Date.parse('2026-11-03T13:00:00.000Z'),PROJECT={id:'55555555-5555-4555-8555-555555555555',name:'John',timezone:'America/Sao_Paulo',currency:'BRL'};
const TARGET={projectId:PROJECT.id,projectName:PROJECT.name,adAccountId:'11111111-1111-4111-8111-111111111111',objectId:'900000000000000001',internalObjectId:'22222222-2222-4222-8222-222222222222',timezone:PROJECT.timezone};
const clone=value=>structuredClone(value),iso=value=>new Date(value).toISOString();
function item(target=TARGET){const range=dailyRange(NOW,target.timezone);return {target:clone(target),range:{from:range.from,to:range.to},revision:3,interestUntil:iso(NOW+120000),nextDueAt:iso(NOW-1000),status:'Pendente',snapshot:{sentinel:'prior actual cache'}};}
function detail(target=TARGET){const range=dailyRange(NOW,target.timezone);return {
  row:{id:target.internalObjectId,projectId:target.projectId,projectName:target.projectName,adAccountId:target.adAccountId,externalId:target.objectId,provider:'meta',level:'campaign',dailyBudget:200,budgetCurrency:'USD'},
  provider:'meta',level:'campaign',externalId:target.objectId,currency:'BRL',
  daily:range.days.map((day,i)=>({day,spend:i?100:0,orders:i?2:0,cpa:i?50:null,revenueNet:i?250:0,profit:i?140:0,roas:i?2.5:null,roi:i?2.3:null,impressions:1000})),
  dailyRange:{from:range.from,to:range.to,extended:false},period:{preset:'custom',timezone:target.timezone,from:range.start,to:range.end,days:range.days,previous:{private:'not projected'}},
  assets:[{url:'https://private.example/video?token=secret'}],pixels:['private'],hourly:[{secret:true}],transcript:'private',freshAt:'not a detail source field',
};}
class FakeClient{
  constructor(items=[item()]){this.items=clone(items);this.calls=[];this.clock=NOW;this.paused=false;this.workspace=WORKSPACE;this.projects=[PROJECT];this.site=SITE;}
  async ensureReady(options){this.calls.push({ready:clone(options)});if(options.source&&this.sourceUnavailable)throw new Error('private bearer secret');}
  pending(){return {siteProjectId:this.site,paused:this.paused,items:this.paused?[]:clone(this.items.filter(i=>Date.parse(i.interestUntil)>this.clock&&Date.parse(i.nextDueAt)<=this.clock))};}
  async callTool(server,tool,args){
    this.calls.push({server,tool,args:clone(args)});
    if(server==='malva'){
      if(tool==='workspace_whoami')return {workspace:{id:this.workspace}};
      if(tool==='tracking_list_projects')return {items:clone(this.projects)};
      assert.equal(tool,'tracking_ad_detail');this.onDetail?.(args);return this.detailHandler?this.detailHandler(args):detail(this.items.find(i=>i.target.internalObjectId===args.objectId).target);
    }
    assert.equal(server,'codex_apps');assert.equal(tool,BUNKER_DAILY_TOOL);
    if(args.action==='pending')return this.pending();
    const entry=this.items.find(i=>i.target.projectId===args.projectId&&i.target.adAccountId===args.adAccountId&&i.target.objectId===args.objectId);
    if(args.action==='read')return {siteProjectId:this.site,paused:this.paused,item:clone(entry)};
    assert.ok(['import','failure'].includes(args.action));assert.equal(args.expectedRevision,entry.revision);assert.equal(this.paused,false);
    if(args.action==='import'){
      if(this.importTimeout)throw new Error('private ambiguous response');
      if(!this.skipPersist){const s=args.snapshot,d=s.detail;entry.snapshot={source:s.source,fetchedAt:s.fetchedAt,lastSyncAt:null,timezone:d.period.timezone,currency:d.currency,from:d.dailyRange.from,to:d.dailyRange.to,rows:clone(d.daily)};entry.revision++;entry.nextDueAt=iso(this.clock+60000);entry.error=null;}
      return {siteProjectId:this.site,paused:false,ok:true,item:clone(entry),revision:this.skipPersist?entry.revision+1:entry.revision};
    }
    entry.revision++;entry.error=clone(args.error);entry.nextDueAt=iso(this.clock+60000);return {siteProjectId:this.site,paused:false,ok:true,item:clone(entry),revision:entry.revision};
  }
}
const relay=client=>new DailyRelay({client,workspaceId:WORKSPACE,siteId:SITE,now:()=>client.clock});
const writes=client=>client.calls.filter(c=>['import','failure'].includes(c.args?.action));

test('seven-day range includes today in the project timezone and handles DST',()=>{
  const r=dailyRange(NOW,PROJECT.timezone);assert.equal(r.from,'2026-10-28');assert.equal(r.to,'2026-11-03');assert.equal(r.days.length,7);assert.equal(r.start,'2026-10-28T03:00:00.000Z');assert.equal(r.end,'2026-11-04T03:00:00.000Z');
  const dst=dailyRange(Date.parse('2026-11-02T15:00:00Z'),'America/New_York');assert.equal(Date.parse(dst.end)-Date.parse(dst.start),169*3600000);
  assert.throws(()=>dailyRange(NOW,'Invalid/Zone'),{code:'SOURCE_INVALID'});
});
test('only an interested due campaign is queried, by internal UUID with the exact traffic range',async()=>{
  const client=new FakeClient();client.onDetail=()=>{client.clock+=125;};assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:0});
  const query=client.calls.find(c=>c.tool==='tracking_ad_detail');assert.deepEqual(query.args,{projectId:PROJECT.id,objectId:TARGET.internalObjectId,sales:'traffic',preset:'custom',from:'2026-10-28',to:'2026-11-03'});
  const save=writes(client)[0];assert.equal(save.args.expectedRevision,3);assert.equal(save.args.snapshot.fetchedAt,iso(NOW+125));assert.equal(save.args.snapshot.detail.row.budgetCurrency,undefined);
  assert.deepEqual(Object.keys(save.args.snapshot.detail),['row','provider','level','externalId','daily','dailyRange','period','currency']);
  assert.equal(JSON.stringify(save.args).includes('secret'),false);assert.equal(JSON.stringify(save.args).includes('impressions'),false);assert.equal(client.items[0].snapshot.lastSyncAt,null);
  assert.deepEqual([...new Set(client.calls.filter(c=>c.server==='malva').map(c=>c.tool))],['workspace_whoami','tracking_list_projects','tracking_ad_detail']);assert.equal(client.calls.at(-1).args.action,'read');
});
test('pause and an empty queue do not call the source or write anything',async()=>{
  for(const paused of [true,false]){const client=new FakeClient(paused?[item()]:[]);client.paused=paused;assert.deepEqual(await relay(client).runOnce(),{paused,imported:0,failed:0});assert.equal(client.calls.some(c=>c.server==='malva'),false);assert.deepEqual(writes(client),[]);}
});
test('expired interest and future nextDueAt are not collected',async()=>{
  for(const patch of [{interestUntil:iso(NOW)},{nextDueAt:iso(NOW+1)}]){const client=new FakeClient([{...item(),...patch}]);assert.equal((await relay(client).runOnce()).imported,0);assert.equal(client.calls.some(c=>c.server==='malva'),false);}
});
test('pending contract rejects foreign site, duplicates, malformed IDs, old ranges and oversize queues',()=>{
  const valid={siteProjectId:SITE,paused:false,items:[item()]};assert.equal(validateDailyPending(valid,SITE,NOW),valid);
  assert.throws(()=>validateDailyPending({...valid,siteProjectId:'foreign'},SITE,NOW),{code:'SOURCE_IDENTITY'});
  assert.throws(()=>validateDailyPending({...valid,items:[item(),item()]},SITE,NOW),{code:'SOURCE_INVALID'});
  assert.throws(()=>validateDailyPending({...valid,items:[{...item(),target:{...TARGET,internalObjectId:'external-id'}}]},SITE,NOW),{code:'SOURCE_INVALID'});
  assert.throws(()=>validateDailyPending({...valid,items:[{...item(),range:{from:'2026-10-27',to:'2026-11-02'}}]},SITE,NOW),{code:'SOURCE_STALE'});
  assert.throws(()=>validateDailyPending({...valid,items:Array.from({length:21},()=>item())},SITE,NOW),{code:'SOURCE_LIMIT'});
});
test('workspace and project identity failures preserve the cache and never query campaign details',async()=>{
  for(const mode of ['workspace','project','name','timezone']){const client=new FakeClient();if(mode==='workspace')client.workspace='foreign';else client.projects=[{...PROJECT,...(mode==='project'?{id:'33333333-3333-4333-8333-333333333333'}:mode==='name'?{name:'Other'}:{timezone:'America/Boa_Vista'})}];
    if(mode==='workspace')await assert.rejects(relay(client).runOnce(),{code:'SOURCE_IDENTITY'});else assert.equal((await relay(client).runOnce()).failed,1);
    assert.equal(client.calls.some(c=>c.tool==='tracking_ad_detail'),false);assert.deepEqual(client.items[0].snapshot,{sentinel:'prior actual cache'});assert.equal(writes(client)[0].args.action,'failure');assert.equal(writes(client)[0].args.error.code,'SOURCE_IDENTITY');
  }
});
test('detail identity and performance currency are checked before import',async()=>{
  for(const change of [d=>{d.row.adAccountId='foreign';},d=>{d.row.id=TARGET.objectId;},d=>{d.row.projectId='foreign';},d=>{d.provider='google';},d=>{d.level='ad';},d=>{d.externalId='other';},d=>{d.currency='USD';}]){
    const client=new FakeClient();client.detailHandler=()=>{const d=detail();change(d);return d;};assert.equal((await relay(client).runOnce()).failed,1);assert.equal(writes(client).some(c=>c.args.action==='import'),false);assert.deepEqual(client.items[0].snapshot,{sentinel:'prior actual cache'});
  }
});
test('exact day range, no extension, unique days and finite metric values are mandatory',()=>{
  for(const change of [d=>{d.daily[0].day=d.daily[1].day;},d=>{d.dailyRange.extended=true;},d=>{d.period.days.reverse();},d=>{d.period.from='2026-10-28T04:00:00.000Z';},d=>{d.daily[0].spend='0';},d=>{d.daily[0].orders=1.5;}]){const d=detail();change(d);assert.throws(()=>dailySnapshot(d,item(),PROJECT,NOW),DailySyncError);}
  const source=detail();source.daily[0].profit=-100;source.daily[0].roi=null;const snap=dailySnapshot(source,item(),PROJECT,NOW);assert.equal(snap.expected.rows[0].profit,-100);assert.equal(snap.expected.rows[0].roi,null);assert.equal(snap.expected.rows[0].spend,0);
});
test('omitted metrics or days remain N/D and unordered daily rows are normalized without inventing zeroes',()=>{
  const d=detail();d.daily.shift();delete d.daily[0].roi;d.daily.reverse();delete d.currency;
  const expected=dailySnapshot(d,item(),PROJECT,NOW).expected;assert.deepEqual(expected.rows.map(r=>r.day),dailyRange(NOW,PROJECT.timezone).days);assert.equal(expected.currency,null);
  assert.deepEqual(expected.rows[0],{day:'2026-10-28',spend:null,orders:null,cpa:null,revenueNet:null,profit:null,roas:null,roi:null});assert.equal(expected.rows[1].spend,100);assert.equal(expected.rows[1].roi,null);
  const empty=detail();empty.daily=[];assert.ok(dailySnapshot(empty,item(),PROJECT,NOW).expected.rows.every(r=>r.spend===null&&r.orders===null));
});
test('source errors are sanitized and preserve the prior snapshot',async()=>{
  const client=new FakeClient();client.detailHandler=()=>{throw new Error('Bearer private-token https://secret');};assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:0,failed:1});assert.equal(client.items[0].error.code,'MALVA_UNAVAILABLE');assert.equal(JSON.stringify(writes(client)).includes('private-token'),false);assert.deepEqual(client.items[0].snapshot,{sentinel:'prior actual cache'});
  assert.equal(dailyPublicError(new Error('secret')).message.includes('secret'),false);
});
test('pause, revised request and expired interest during collection prevent cache writes',async()=>{
  for(const mode of ['pause','revision','expired']){const client=new FakeClient();client.onDetail=()=>{if(mode==='pause')client.paused=true;else if(mode==='revision')client.items[0].revision++;else client.clock+=120001;};const result=await relay(client).runOnce();assert.equal(result.imported,0);assert.deepEqual(writes(client),[]);}
});
test('a day rollover never imports the response into the new day',async()=>{
  const client=new FakeClient();client.onDetail=()=>{client.clock=Date.parse('2026-11-04T03:00:01Z');};assert.equal((await relay(client).runOnce()).failed,1);assert.equal(writes(client).some(c=>c.args.action==='import'),false);
});
test('ambiguous or unpersisted imports are never retried or replaced by failure writes',async()=>{
  for(const mode of ['timeout','unpersisted']){const client=new FakeClient();if(mode==='timeout')client.importTimeout=true;else client.skipPersist=true;const result=await relay(client).runOnce();assert.equal(result.imported,0);assert.equal(result.failed,1);assert.equal(writes(client).length,1);assert.equal(writes(client)[0].args.action,'import');}
});
test('failure for one campaign does not prevent another requested campaign from updating',async()=>{
  const second={...TARGET,objectId:'900000000000000002',internalObjectId:'33333333-3333-4333-8333-333333333333'},client=new FakeClient([item(),item(second)]);client.detailHandler=args=>{if(args.objectId===TARGET.internalObjectId)throw new Error('unavailable');return detail(second);};assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:1});assert.equal(client.items[0].error.code,'MALVA_UNAVAILABLE');assert.equal(client.items[1].snapshot.rows.length,7);
});
test('overlapping laps cannot dispatch duplicate source requests',async()=>{
  const client=new FakeClient([]),r=relay(client);let release;client.ensureReady=()=>new Promise(resolve=>{release=resolve;});const pending=r.runOnce();await assert.rejects(r.runOnce(),{code:'MCP_UNAVAILABLE'});release();await pending;assert.equal(client.calls.some(c=>c.server==='malva'),false);
});
test('ten-second daily checks stay sequential while campaign collection targets fifteen seconds',async()=>{
  let clock=0,active=0,max=0;const checks=[],sleeps=[];await waitWithDaily(POLL_INTERVAL_MS,{clock:()=>clock,wait:async ms=>{sleeps.push(ms);clock+=ms;},runDaily:async()=>{active++;max=Math.max(max,active);checks.push(clock);clock+=200;await Promise.resolve();active--;}});assert.equal(DAILY_CHECK_INTERVAL_MS,10000);assert.equal(POLL_INTERVAL_MS,15000);assert.deepEqual(checks,[10000]);assert.equal(clock,15000);assert.equal(max,1);assert.ok(sleeps.every(ms=>ms<=10000));
});
test('shutdown during the wait stops demand checks immediately',async()=>{
  const controller=new AbortController();let checks=0,clock=0;await waitWithDaily(60000,{signal:controller.signal,clock:()=>clock,wait:async ms=>{clock+=ms;controller.abort();},runDaily:async()=>{checks++;}});assert.equal(checks,0);
});
test('MCP client allows only the daily read/cache actions and uses a fixed compatibility envelope',async()=>{
  const client=new CodexMcpClient();client.start=async()=>{};client.threadId='test';const dispatches=[];
  client.request=async(method,params)=>{if(method==='mcpServerStatus/list')return {data:[{name:'codex_apps',runtimeStatus:'connected',tools:{[BUNKER_COMPAT_TOOL]:{}}},{name:'malva',runtimeStatus:'connected',tools:Object.fromEntries(MALVA_TOOLS.map(t=>[t,{}]))}]};dispatches.push({method,...params});return {structuredContent:{ok:true}};};
  await client.ensureReady();for(const action of ['pending','read','import','failure']){await client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action});const d=dispatches.at(-1);assert.equal(d.tool,BUNKER_COMPAT_TOOL);assert.deepEqual(d.arguments,{id:'daily-data',status:'Pendente',revision:0,note:JSON.stringify({action})});}
  for(const action of ['request','approve','execute'])await assert.rejects(client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action}),{code:'TOOL_NOT_ALLOWED'});
  await assert.rejects(client.callTool('malva','tracking_campaign_budget',{}),{code:'TOOL_NOT_ALLOWED'});assert.equal(dispatches.length,4);assert.ok(MALVA_TOOLS.includes('tracking_ad_detail'));
});
test('native daily tool is selected when published and startup is coalesced across callers',async()=>{
  const client=new CodexMcpClient();let starts=0,release;client.startSession=async()=>{starts++;await new Promise(resolve=>{release=resolve;});client.threadId='test';client.child={};};const a=client.start(),b=client.start();assert.equal(starts,1);release();await Promise.all([a,b]);
  let sent;client.request=async(method,params)=>{if(method==='mcpServerStatus/list')return {data:[{name:'codex_apps',runtimeStatus:'connected',tools:{[BUNKER_TOOL]:{},[BUNKER_DAILY_TOOL]:{},[BUNKER_COMPAT_TOOL]:{}}},{name:'malva',runtimeStatus:'connected',tools:Object.fromEntries(MALVA_TOOLS.map(t=>[t,{}]))}]};sent=params;return {structuredContent:{ok:true}};};await client.ensureReady();await client.callTool('codex_apps',BUNKER_DAILY_TOOL,{action:'pending'});assert.equal(sent.tool,BUNKER_DAILY_TOOL);assert.deepEqual(sent.arguments,{action:'pending'});
});
test('relay projection round-trips through the real daily backend without changing sealed analysis or approval state',async()=>{
  const database=new DatabaseSync(':memory:');database.exec('CREATE TABLE bunker_records (key TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL)');
  const db={prepare(sql){return {bind(...args){return {async first(){return database.prepare(sql).get(...args);},async all(){return {success:true,results:database.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(database.prepare(sql).run(...args).changes)}};}};}};}};
  const s={paused:false,config:{[PROJECT.id]:{projectName:PROJECT.name}},snapshots:[{projectId:PROJECT.id,source:'Malva MCP',complete:true,level:'campaign',period:'today',timezone:PROJECT.timezone,fetchedAt:iso(NOW),rows:[detail().row]}],proposals:[{id:'approved',signature:'sealed',status:'Aprovada'}],ownerChoices:[{id:'keep',action:'keep'}]},before=JSON.stringify(s);
  const ids={projectId:TARGET.projectId,adAccountId:TARGET.adAccountId,objectId:TARGET.objectId};
  try{
    await dailyDataAction(db,s,{action:'request',...ids},NOW);
    const client=new FakeClient(),original=client.callTool.bind(client);client.callTool=async(server,tool,args)=>{if(server==='malva')return original(server,tool,args);client.calls.push({server,tool,args:clone(args)});assert.equal(tool,BUNKER_DAILY_TOOL);return {siteProjectId:SITE,...await dailyDataAction(db,s,args,client.clock)};};
    client.detailHandler=()=>{const d=detail();d.daily.reverse();d.daily.splice(2,1);delete d.daily[0].roi;delete d.currency;return d;};
    assert.deepEqual(await relay(client).runOnce(),{paused:false,imported:1,failed:0});
    const saved=await dailyDataAction(db,s,{action:'read',...ids},NOW);assert.equal(saved.item.snapshot.rows.length,7);assert.equal(saved.item.snapshot.currency,null);assert.ok(saved.item.snapshot.rows.some(r=>r.spend===null));assert.equal(JSON.stringify(s),before);
  }finally{database.close();}
});
