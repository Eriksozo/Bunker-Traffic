import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {playbookStore,runPlaybookShadow,runPlaybookLearning,runPlaybookBackfill,playbookRunnerPolicy} from '../lib/playbook-runner.mjs';
import {autonomyGrant,recordAutonomyOrder} from '../lib/autonomy-grant.mjs';
import {binsKey} from '../lib/team-observations.mjs';
import {memoryStorage,syntheticDays,iso,dayStart,TZ} from './helpers/playbook-fixtures.mjs';

// Modo Gestor, Phase 1 (contract §0.1 and c.11): a play decision never executes. Synthetic fixtures only.
const P='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',D='2026-11-09',NOW=dayStart(D)+15*3600000;
const row=(id,name,m={},extra={})=>({id:'bbbbbbbb-2222-4222-8222-'+id.padStart(12,'0'),externalId:id,adAccountId:'acc-1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},
 dailyBudget:400,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,spend:300,revenue:0,revenueNet:150,adCosts:0,productCost:0,saleTax:0,frontOrders:1,orders:1,checkouts:2,impressions:1000,linkClicks:20,...m,...extra});
const base={projectId:P,level:'campaign',source:'Malva MCP',timezone:TZ,complete:true};
function state(){
 const from=iso(dayStart(D)),rows=[row('1','Madura 1'),row('2','09/11 - [TESTE] A',{spend:260,revenueNet:0,frontOrders:0,orders:0,checkouts:0},{dailyBudget:100})];
 const old=[row('1','Madura 1',{spend:300,revenueNet:600,frontOrders:3,orders:3})];
 const cut=(period,days,r)=>({...base,period,from:iso(dayStart(D)-days*86400000),to:from,fetchedAt:iso(NOW-3600000),lastSyncAt:iso(NOW-3600000),rows:r});
 return {config:{[P]:{projectName:'Projeto Um'}},snapshots:[{...base,period:'today',from,to:iso(dayStart(D)+86400000),fetchedAt:iso(NOW-300000),lastSyncAt:iso(NOW-300000),rows},
  cut('yesterday',1,old),cut('3d',3,old.map(r=>({...r,spend:900,revenueNet:1800}))),cut('7d',7,old.map(r=>({...r,spend:2100,revenueNet:4200})))],
  // The owner's most permissive setting: general switch on, project in Automático, every action, generous limits.
  autonomy:{version:1,enabled:true,projects:{[P]:{mode:'auto',actions:{pause:true,reduce:true,increase:true,activate:true},limits:{maxIncreasePct:100,maxReducePct:50,budgetCap:100000,ordersPerDay:10},campaigns:{}}}},
  proposals:[],executions:[]};
}
/** Storage with fitted plays: 30 synthetic days of bins, then learning passes until the fit cycle ends. */
async function trained(){
 const {bins}=syntheticDays({days:30,from:'2026-10-10',project:P});
 const storage=memoryStorage(Object.fromEntries(bins.map(b=>[binsKey(b.day,b.project),b]))),store=playbookStore(storage);
 for(let i=0;i<20;i++){const r=await runPlaybookLearning(store,{state:state(),now:NOW+i,projects:[P],names:{[P]:'Projeto Um'},zone:()=>TZ},{deadline:Date.now()+5000});assert.equal(r.ok,true,JSON.stringify(r));if((await storage.get('pb:model'))?.fitAt&&!(await storage.get('pb:cursor')).fit)break;}
 return {storage,store};
}

test('Every pbs:* written is non-executable, and only pb:/pbs: keys are ever written',async()=>{
 const {storage,store}=await trained();
 const model=await storage.get('pb:model');assert.ok(Object.values(model.plays).some(p=>p.stage==='candidata'),'there are candidate plays to decide with');
 assert.ok(Object.values(model.plays).every(p=>['observando','candidata'].includes(p.stage)),'Phase 1 never goes past "candidata"');
 const before=new Set(storage.map.keys());
 const r=await runPlaybookShadow(store,{state:state(),liveItems:[],events:[],now:NOW,projects:[{project:P,params:{ticketFront:100},day:D}],fixed:[]},{deadline:Date.now()+1000});
 assert.equal(r.ok,true);assert.ok(r.decisions>=1);
 const pbs=[...storage.map].filter(([k])=>k.startsWith('pbs:'));assert.ok(pbs.length>=1);
 for(const [,e] of pbs)assert.deepEqual([e.wouldExecute,e.firstWouldExecuteAt,e.source,e.ruleVersion,e.role],[false,null,'playbook',null,'challenger']);
 for(const k of storage.map.keys())if(!before.has(k))assert.ok(k.startsWith('pb:')||k.startsWith('pbs:'),k);
 // Grading passes keep them so.
 await runPlaybookLearning(store,{state:state(),now:NOW+86400000,projects:[P],zone:()=>TZ},{deadline:Date.now()+3000});
 for(const [k,e] of storage.map)if(k.startsWith('pbs:'))assert.deepEqual([e.wouldExecute,e.firstWouldExecuteAt],[false,null]);
});

test('A play decision fed to the autonomy path gives act "none" and no proposal, even in Automático',async()=>{
 const {storage,store}=await trained();
 await runPlaybookShadow(store,{state:state(),liveItems:[],events:[],now:NOW,projects:[{project:P,params:{ticketFront:100},day:D}],fixed:[]},{deadline:Date.now()+1000});
 const entries=[...storage.map].filter(([k])=>k.startsWith('pbs:')).map(([,e])=>e);assert.ok(entries.length);
 for(const e of entries){
  const s=state(),g=autonomyGrant(s,e,{now:NOW,timezone:TZ});
  assert.equal(g.act,'none');assert.match(g.blockers.join(' '),/não executaria/);
  const live={row:{...row(e.objectId==='1'?'1':'2','x'),adAccountId:e.adAccountId,externalId:e.objectId},fetchedAt:iso(NOW-60000)};
  const out=recordAutonomyOrder(s,e,{live,now:NOW,timezone:TZ});
  assert.ok(out.blocked&&!out.proposal);assert.deepEqual(s.proposals,[]);
 }
 // The executor's autonomy loop only ever reads `batches` (the fixed rules) and skips anything not would-execute.
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 const at=src.indexOf(' private async autonomyAct('),act=src.slice(at,src.indexOf('\n }\n',at)+3);
 assert.match(act,/for\(const \[list,day\] of batches\)for\(const raw of list\)\{\n\s*if\(!raw\?\.wouldExecute\)continue;/);
 assert.doesNotMatch(act,/pbs:|playbook/i,'the autonomy loop never names the playbook store');
});

test('The deep view status of a play decision is never "enviaria" or "pediria"',async t=>{
 let mod;try{mod=await import('../lib/autonomy-deep-view.mjs');}catch{t.skip('lib/autonomy-deep-view.mjs not present (W1)');return;}
 if(typeof mod.decisionStatus!=='function'){t.skip('decisionStatus not exported yet (W1)');return;}
 const {storage,store}=await trained();
 await runPlaybookShadow(store,{state:state(),liveItems:[],events:[],now:NOW,projects:[{project:P,params:{ticketFront:100},day:D}],fixed:[]},{deadline:Date.now()+1000});
 const s=state();
 for(const [k,e] of storage.map){if(!k.startsWith('pbs:'))continue;
  for(const variant of [e,{...e,blockedBy:[]},{...e,wouldExecute:true,firstWouldExecuteAt:iso(NOW)}]){
   const st=mod.decisionStatus(variant,{base:{config:null,paused:false,orders:[]},config:s.autonomy,log:[{shadowId:e.id,result:{kind:'order'},proposalId:'x'}],now:NOW,timezone:TZ});
   assert.ok(!['enviaria','pediria'].includes(st.status),st.status);
  }}
});

test('Static: the runner imports only pure modules; no W3 module names the execution path',()=>{
 const read=f=>fs.readFileSync(new URL('../lib/'+f,import.meta.url),'utf8');
 const importsOf=src=>[...src.matchAll(/(?:import|export)[^'"]*?from\s*['"]\.\/([^'"]+)\.mjs['"]/g)].map(m=>m[1]);
 const allowed=['manager-playbook','playbook-eval','team-observations','campaign-context','autonomy-shadow','shadow-learning','team-learning','learning-math','activity-history','analysis','partial-day'];
 const forbidden=['autonomy-grant','collaboration','execution','decision-contingency','owner-direct-order','owner-orders','cloud-engine','cloud-dispatch-guard','persistence','storage','supabase-storage','cloud-malva'];
 const runner=importsOf(read('playbook-runner.mjs'));
 assert.ok(runner.length>0);for(const m of runner)assert.ok(allowed.includes(m),'runner imports '+m);
 for(const f of ['playbook-runner.mjs','manager-playbook.mjs','playbook-eval.mjs','team-observations.mjs','campaign-context.mjs']){
  const src=read(f);for(const m of importsOf(src))assert.ok(!forbidden.includes(m),`${f} imports ${m}`);
  assert.doesNotMatch(src,/\b(autonomyGrant|recordAutonomyOrder|assertAutonomyGrant|decisionContingency|executionClaim|executionPrepare|executionSubmit|authorizeCloudDispatch|bunker_importar|setAlarm|deleteAll|transaction)\s*\(/,f);
  assert.doesNotMatch(src,/structuredClone\(state|JSON\.parse\(JSON\.stringify\(state/,f+' never clones the state');
 }
 assert.equal(playbookRunnerPolicy.enabled,true);assert.ok(Object.isFrozen(playbookRunnerPolicy));
});

test('Static: hook A runs after the autonomy step, and nothing is added to the fixed-rule batches after the loop',t=>{
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 const start=src.indexOf(' private async storeShadow('),body=src.slice(start,src.indexOf('\n private async ',start+10));
 const hook=Math.max(body.indexOf('this.playbookShadow('),body.indexOf('runPlaybookShadow('));
 if(hook<0){t.skip('hook A not wired yet (W1)');return;}
 const act=body.indexOf('this.autonomyAct(');assert.ok(act>0&&hook>act,'hook A after autonomyAct');
 const lastPush=body.lastIndexOf('batches.push(');assert.ok(lastPush<act,'batches are complete before autonomyAct and the hook');
 assert.doesNotMatch(body.slice(act),/batches\s*(=|\.push|\.unshift|\.splice)/);
});

test('Store facade: pb:/pbs: only, bounded batches, a required listing limit, no transaction/alarm',async()=>{
 const storage=memoryStorage({'shadow:x':1,'learn:2026-11-09:p:team':{actions:{}},'autonomyLog':[]}),s=playbookStore(storage);
 const denied=async(fn,label)=>{await assert.rejects(fn,e=>e.code==='PLAYBOOK_STORE_DENIED',label);};
 await denied(()=>s.put({'shadow:x':2}),'put shadow');await denied(()=>s.put({'autonomy':{}}),'put autonomy');await denied(()=>s.put({learningSummary:{}}),'put summary');
 await denied(()=>s.put({'learn:2026-11-09:p:team':{}}),'team shards are read-only');
 await denied(()=>s.delete(['attr:x']),'delete attr');await denied(()=>s.get('autonomyLog'),'get autonomyLog');
 await denied(()=>s.list({prefix:'shadow:',limit:10}),'list shadow');await denied(()=>s.list({prefix:'pbs:'}),'list without limit');
 await denied(()=>s.list({prefix:'pbs:',limit:500}),'list over a page');await denied(()=>s.list({prefix:'pbs:',limit:5,end:'shadow:'}),'range outside');
 await denied(()=>s.put(Object.fromEntries(Array.from({length:101},(_,i)=>['pb:x'+i,1]))),'put > 100');
 await denied(()=>s.put({'pb:big':'x'.repeat(playbookRunnerPolicy.maxValueBytes+1)}),'value too large');
 for(const k of ['transaction','deleteAll','setAlarm','sync','getAlarm'])assert.equal(s[k],undefined,k);
 assert.ok(Object.isFrozen(s));
 assert.deepEqual(await s.get('learn:2026-11-09:p:team'),{actions:{}},'exact team shard: read only');
 await s.put({'pb:ok':1});assert.equal(storage.map.get('pb:ok'),1);assert.equal(storage.map.get('shadow:x'),1);
});

test('Failures never throw and never touch anything outside pb:/pbs: (error contract)',async()=>{
 const broken={get:async()=>{throw Object.assign(Error('boom'),{code:'X'});},put:async()=>{throw Error('disk');},delete:async()=>{},list:async()=>new Map()};
 const s=playbookStore(broken);
 const a=await runPlaybookShadow(s,{state:state(),liveItems:[],events:[],now:NOW,projects:[{project:P,day:D}]},{deadline:Date.now()+500});
 assert.equal(a.ok,false);assert.match(a.code,/^PLAYBOOK_[A-Z_]{1,40}$/);assert.ok(a.error.length<=160);
 const b=await runPlaybookLearning(s,{state:state(),now:NOW,projects:[P]},{deadline:Date.now()+500});assert.equal(b.ok,false);
 const c=await runPlaybookBackfill(s,{read:async()=>({})},{projects:[{id:P,timezone:TZ}],now:NOW},{deadline:Date.now()+500});assert.equal(c.ok,false);
 assert.deepEqual((await runPlaybookShadow(s,null,{deadline:Date.now()})).code,'PLAYBOOK_BAD_INPUT');
 assert.equal((await runPlaybookLearning(s,{},{deadline:Date.now()})).code,'PLAYBOOK_BAD_INPUT');
 // A raw storage handed by mistake still cannot be written outside the prefixes.
 const storage=memoryStorage(),wrapped=playbookStore(storage);
 await runPlaybookShadow(wrapped,{state:state(),liveItems:[],events:[],now:NOW,projects:[{project:P,day:D}]},{deadline:Date.now()+500});
 assert.ok([...storage.map.keys()].every(k=>k.startsWith('pb:')||k.startsWith('pbs:')));
});
