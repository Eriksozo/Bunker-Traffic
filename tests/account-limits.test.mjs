import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAccountPanel,normalizeMetaAccount,metaAccountFields} from '../lib/account-limits.mjs';

// Synthetic fixtures only.
const now=Date.parse('2026-11-07T20:00:00Z');
const malva=(accountId,label,{status='active',spendToday=0,spend7d=0,active=0,changedAt=null}={})=>({id:'u-'+accountId,label,accountId,provider:'meta',
 registered:{name:'Pessoa',street:'Rua'},access:[{name:'Alguém'}],token:{secret:'nunca'},
 meta:{statusKind:status,statusChangedAt:changedAt,balance:12.5,spendCap:0,adsRunning:3,dailyLimit:null},usage:{spendToday,spend7d,activeCampaigns:active}});
const graph=(id,limit,spend,status=1,currency='USD')=>({account_id:id,name:'X',account_status:status,currency,adtrust_dsl:limit,timezone_name:'America/Sao_Paulo',...(spend===undefined?{}:{insights:{data:[{spend:String(spend)}]}})});

test('Meta fields: limit, today spend and status; missing limit stays N/D, missing insights is zero spend',()=>{
 assert.match(metaAccountFields,/adtrust_dsl/);assert.match(metaAccountFields,/insights\.date_preset\(today\)\{spend\}/);
 assert.deepEqual([normalizeMetaAccount(graph('111',321.06,120.5)).dailyLimit,normalizeMetaAccount(graph('111',321.06,120.5)).todaySpend],[321.06,120.5]);
 assert.equal(normalizeMetaAccount(graph('111',-1,10)).dailyLimit,null);
 assert.equal(normalizeMetaAccount(graph('111',50)).todaySpend,0);
 assert.equal(normalizeMetaAccount(graph('act_222',50,1)).accountId,'222');
 assert.equal(normalizeMetaAccount({account_id:'abc'}),null);
 assert.equal(normalizeMetaAccount(graph('333',50,1,2)).status,'disabled');
});
test('Panel joins Malva projects with Meta by account id, flags near-limit and recent falls, and drops personal data',()=>{
 const projects=[{id:'p1',name:'John',items:[malva('111','CA 0001 USD Fbflix',{spendToday:900,spend7d:5000,active:4}),malva('222','α Alfa Rent - Livre 001',{status:'disabled',changedAt:'2026-11-07T10:00:00Z'})]},
  {id:'p2',name:'Nico',items:[malva('111','CA 0001 USD Fbflix',{spendToday:100,spend7d:300,active:1}),malva('333','CA FbMax 9',{})]}];
 const panel=buildAccountPanel({projects,meta:[graph('111',321.06,290),graph('999',100,1)],now});
 assert.equal(panel.metaConnected,true);assert.equal(panel.rows.length,3,'Meta-only account 999 is ignored');
 const a=panel.rows.find(r=>r.accountId==='111');
 assert.deepEqual(a.projects,['John','Nico']);assert.equal(a.group,'FB Flix');assert.equal(a.dailyLimit,321.06);assert.equal(a.usedPct,90.3);assert.deepEqual(a.alerts,['Perto do limite diário']);
 assert.equal(a.runningLabel,'Rodando · John, Nico');assert.equal(a.spendTodayBrl,900,'account-level spend is never summed across projects');
 const b=panel.rows.find(r=>r.accountId==='222');assert.equal(b.statusLabel,'Desabilitada');assert.ok(b.alerts.includes('Caiu nas últimas 24h'));assert.equal(b.dailyLimit,null);assert.equal(b.limitSource,'N/D');
 const c=panel.rows.find(r=>r.accountId==='333');assert.equal(c.group,'FB Max');assert.ok(c.alerts.includes('Ativa sem gasto em 7 dias'));
 assert.equal(panel.rows[0].accountId,'111','active accounts first, highest use first');
 const json=JSON.stringify(panel);for(const leak of ['Pessoa','Rua','Alguém','nunca'])assert.equal(json.includes(leak),false);
 assert.deepEqual(panel.counts,{total:3,active:2,running:1,disabled:1,nearLimit:1,withLimit:1,listed:3});
});
test('Without the Meta token the panel still works and every limit is N/D',()=>{
 const panel=buildAccountPanel({projects:[{id:'p',name:'John',items:[malva('111','CA 1',{spendToday:1,spend7d:1,active:1})]}],meta:null,metaError:'META_TOKEN_MISSING',now});
 assert.equal(panel.metaConnected,false);assert.equal(panel.metaError,'META_TOKEN_MISSING');assert.equal(panel.rows[0].dailyLimit,null);assert.equal(panel.rows[0].usedPct,null);assert.equal(panel.rows[0].todaySpend,null);
});
test('Limit reached is distinct from near the limit; other providers are ignored',()=>{
 const panel=buildAccountPanel({projects:[{id:'p',name:'John',items:[malva('111','CA 1',{spendToday:1,spend7d:1,active:1}),{...malva('444','K'),provider:'kwai'}]}],meta:[graph('111',100,100)],now});
 assert.equal(panel.rows.length,1);assert.deepEqual(panel.rows[0].alerts,['Limite diário atingido']);
});

test('Meta reads keep the token in the header, page by cursor and return only fixed error codes',async()=>{
 const {readMetaAccounts}=await import('../lib/account-limits.mjs');
 const calls=[];const pages=[{data:[{account_id:'1'}],paging:{cursors:{after:'C1'},next:'https://graph.facebook.com/x?access_token=NAO'}},{data:[{account_id:'2'}],paging:{cursors:{after:'C2'}}}];
 const fake=async(url,init)=>{calls.push({url,auth:init.headers.Authorization});return {ok:true,status:200,json:async()=>pages[calls.length-1]};};
 const rows=await readMetaAccounts(fake,'tok-123');
 assert.deepEqual(rows.map(r=>r.account_id),['1','2']);assert.equal(calls.length,2);
 assert.ok(calls.every(c=>!c.url.includes('tok-123')&&!c.url.includes('access_token')));assert.ok(calls.every(c=>c.auth==='Bearer tok-123'));
 assert.match(calls[1].url,/after=C1/);
 await assert.rejects(readMetaAccounts(fake,''),{code:'META_TOKEN_MISSING'});
 await assert.rejects(readMetaAccounts(async()=>({ok:false,status:400,json:async()=>({error:{code:190,message:'token tok-123 expirou'}})}),'tok-123'),e=>e.code==='META_190'&&!String(e.message).includes('tok-123'));
 await assert.rejects(readMetaAccounts(async()=>{throw new Error('falhou em https://graph?access_token=tok-123');},'tok-123'),e=>e.code==='META_NETWORK'&&!String(e.message).includes('tok-123'));
});

test('Shared accounts are attributed by each project own campaign spend; old disabled accounts are counted but not listed',async()=>{
 const {runningAccounts}=await import('../lib/account-limits.mjs');
 const state={config:{p1:{projectName:'Gabe'},p2:{projectName:'Leandro'}},snapshots:[
  {projectId:'p2',level:'campaign',period:'today',rows:[{provider:'meta',adAccountId:'u-111',spend:50}]},
  {projectId:'p1',level:'campaign',period:'7d',rows:[{provider:'meta',adAccountId:'u-111',spend:0}]}]};
 const running=runningAccounts(state);assert.deepEqual([...running.Leandro],['u-111']);assert.equal(running.Gabe.size,0);
 const projects=[{id:'p1',name:'Gabe',items:[malva('111','CA 1137 - BRL Fbflix',{spendToday:900,spend7d:5000,active:4})]},{id:'p2',name:'Leandro',items:[malva('111','CA 1137 - BRL Fbflix',{spendToday:900,spend7d:5000,active:4}),malva('555','CA velha',{status:'disabled',changedAt:'2026-10-01T00:00:00Z'})]}];
 const panel=buildAccountPanel({projects,running,meta:null,now});
 assert.equal(panel.rows.find(r=>r.accountId==='111').runningLabel,'Rodando · Leandro','paused Gabe does not run in the shared account');
 assert.equal(panel.counts.total,2);assert.equal(panel.counts.listed,1);assert.equal(panel.rows.some(r=>r.accountId==='555'),false);
});
test('A field Meta retired is dropped and the page read again; the limit stays N/D',async()=>{
 const {readMetaAccounts,metaAccountFields}=await import('../lib/account-limits.mjs');const calls=[];
 const fetchImpl=async url=>{const f=new URL(url).searchParams.get('fields');calls.push(f);
  if(f.includes('adtrust_dsl'))return {ok:false,status:400,json:async()=>({error:{code:100,message:'(#100) Tried accessing nonexisting field (adtrust_dsl)'}})};
  return {ok:true,status:200,json:async()=>({data:[{account_id:'123456',name:'CA',account_status:1,currency:'USD',insights:{data:[{spend:'12'}]}}]})};};
 const out=await readMetaAccounts(fetchImpl,'t');
 assert.equal(out.length,1);assert.deepEqual(out.dropped,['adtrust_dsl']);assert.equal(calls.length,2);
 assert.ok(calls[1].includes('insights.date_preset(today){spend}'),'the insights expansion is kept intact');assert.ok(metaAccountFields.includes('adtrust_dsl'));
});
