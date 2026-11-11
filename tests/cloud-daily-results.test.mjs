import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {requestCloudDaily} from '../lib/cloud-daily-results.mjs';
import {dailyDataAction} from '../lib/campaign-daily-data.mjs';
import {dailyRange} from '../scripts/local-daily-sync.mjs';

const at=Date.parse('2026-11-05T10:00:00.000Z'),projectId='11111111-1111-4111-8111-111111111111',adAccountId='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const target={projectId,adAccountId,objectId:'120247772471730658'},project={id:projectId,name:'John',timezone:'America/Sao_Paulo',currency:'BRL'};
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE bunker_records(key TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');
 const db={prepare(query){return {bind(...params){return {async first(){return sql.prepare(query).get(...params);},async all(){return {success:true,results:sql.prepare(query).all(...params)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...params).changes)}};}};}};}};
 const row={id,projectId,projectName:'John',adAccountId,externalId:target.objectId,provider:'meta',level:'campaign'};
 const state={paused:false,config:{[projectId]:{projectName:'John'}},snapshots:[{projectId,source:'Malva MCP',complete:true,level:'campaign',period:'today',fetchedAt:new Date(at-1000).toISOString(),timezone:project.timezone,rows:[row]}],proposals:[{id:'sealed',status:'Aprovada'}],ownerChoices:[{action:'keep'}]};
 const r=dailyRange(at,project.timezone),detail={row,provider:'meta',level:'campaign',externalId:target.objectId,currency:'BRL',dailyRange:{from:r.from,to:r.to,extended:false},period:{preset:'custom',timezone:project.timezone,from:r.start,to:r.end,days:r.days},daily:[{day:r.to,spend:0,orders:0,cpa:null,revenueNet:0,profit:0,roas:null,roi:null}]};
 const calls=[],source={async read(tool,args){calls.push({tool,args});if(tool==='workspace_whoami')return {workspace:{id:'workspace'},platforms:[{platform:'tracking',read:true}]};if(tool==='tracking_list_projects')return {items:[project]};if(tool==='tracking_ad_detail')return detail;throw Error('Financial tool is forbidden');}};
 const options={db,source,target,readState:async()=>state,now:()=>at};
 return {sql,db,state,detail,calls,source,options};
}

test('cloud detail fetches and caches the exact daily series without altering central decisions',async()=>{
 const f=fixture(),before=structuredClone(f.state),result=await requestCloudDaily(f.options);
 assert.equal(result.item.status,'ready');assert.equal(result.item.snapshot.rows.length,7);
 assert.equal(result.item.snapshot.rows.at(-1).spend,0);assert.equal(result.item.snapshot.rows[0].spend,null);
 const call=f.calls.find(c=>c.tool==='tracking_ad_detail');assert.equal(call.args.objectId,id);assert.equal(call.args.preset,'custom');assert.equal(call.args.projectId,projectId);
 assert.deepEqual(f.state,before);assert.equal(f.sql.prepare('SELECT count(*) n FROM bunker_records').get().n,1);f.sql.close();
});

test('reopening a fresh daily cache does not repeat source reads',async()=>{
 const f=fixture();await requestCloudDaily(f.options);const n=f.calls.length;
 const second=await requestCloudDaily(f.options);assert.equal(second.item.status,'ready');assert.equal(f.calls.length,n);f.sql.close();
});

test('a project pause prevents collection, and a pause during a read prevents import',async()=>{
 const f=fixture();f.state.paused=true;
 await assert.rejects(requestCloudDaily(f.options),{code:'DAILY_PAUSED'});assert.equal(f.calls.length,0);
 f.state.paused=false;const original=f.source.read;f.source.read=async(tool,args)=>{const result=await original(tool,args);if(tool==='tracking_ad_detail')f.state.paused=true;return result;};
 const result=await requestCloudDaily(f.options);assert.equal(result.paused,true);assert.equal(result.item.snapshot,null);f.sql.close();
});

test('a same-name result from another account is rejected, never imported as zero',async()=>{
 const f=fixture();f.detail.row={...f.detail.row,adAccountId:'other'};
 const result=await requestCloudDaily(f.options);assert.equal(result.item.status,'error');assert.equal(result.item.error.code,'SOURCE_IDENTITY');assert.equal(result.item.snapshot,null);f.sql.close();
});

test('a source outage preserves the last daily values with a failure state',async()=>{
 const f=fixture();await requestCloudDaily(f.options);
 f.options.now=()=>at+61000;f.source.read=async()=>{throw Error('private token must never be exposed');};
 const result=await requestCloudDaily(f.options);assert.equal(result.item.status,'error');assert.equal(result.item.snapshot.rows.at(-1).spend,0);
 assert.equal(JSON.stringify(result).includes('private token'),false);f.sql.close();
});

test('an ambiguous save is reconciled with a read without retrying or adding a failure',async()=>{
 const f=fixture(),prepare=f.db.prepare;let saves=0;
 f.db.prepare=query=>{const statement=prepare(query);return {bind(...args){const bound=statement.bind(...args);if(query.startsWith('UPDATE'))return {...bound,async run(){saves++;const result=await bound.run();throw Error('response lost after write');}};return bound;}};};
 const result=await requestCloudDaily(f.options);assert.equal(saves,1);assert.equal(result.item.status,'ready');assert.equal(result.item.error,null);f.sql.close();
});

test('another cache revision during collection cannot be overwritten by the first reader',async()=>{
 const f=fixture(),original=f.source.read;
 f.source.read=async(tool,args)=>{const result=await original(tool,args);if(tool==='tracking_ad_detail')await dailyDataAction(f.db,f.state,{action:'failure',...target,expectedRevision:1,error:{code:'SOURCE_STALE'}},at);return result;};
 const result=await requestCloudDaily(f.options);assert.equal(result.item.revision,2);assert.equal(result.item.error.code,'SOURCE_STALE');assert.equal(result.item.snapshot,null);f.sql.close();
});

test('IC of each day comes from the exact campaign row; another account, period or a failed day stays N/D',async()=>{
 const f=fixture(),r=dailyRange(at,project.timezone),original=f.source.read;
 f.detail.daily=[{day:r.to,spend:120,orders:1,impressions:4000,linkClicks:60},{day:r.days[5],spend:90,orders:0,impressions:3000,linkClicks:30},{day:r.days[4],spend:50,orders:0}];
 f.source.read=async(tool,args)=>{
  if(tool!=='tracking_campaigns')return original(tool,args);
  f.calls.push({tool,args});const day=args.from,row={id,adAccountId,externalId:target.objectId,level:'campaign',provider:'meta',checkouts:day===r.to?6:day===r.days[5]?3:2};
  if(day===r.days[3])throw Error('outage');
  return {period:{timezone:project.timezone,days:[day]},rows:day===r.days[5]?[{...row,adAccountId:'another-account'}]:[row]};
 };
 const rows=(await requestCloudDaily(f.options)).item.snapshot.rows,today=rows[6],yesterday=rows[5];
 assert.equal(today.checkouts,6);assert.equal(today.costPerCheckout,20);assert.equal(today.cpc,2);assert.equal(today.cpm,30);
 assert.equal(yesterday.checkouts,null);assert.equal(yesterday.costPerCheckout,null);assert.equal(yesterday.cpc,3);
 assert.equal(rows[4].checkouts,2);assert.equal(rows[3].checkouts,null);assert.equal(rows[3].spend,null);
 const asks=f.calls.filter(c=>c.tool==='tracking_campaigns');assert.equal(asks.length,7);
 for(const c of asks){assert.equal(c.args.from,c.args.to);assert.deepEqual(c.args.campaignIds,[target.objectId]);assert.deepEqual(c.args.accountIds,[adAccountId]);assert.equal(c.args.sales,'traffic');}
 f.sql.close();
});
