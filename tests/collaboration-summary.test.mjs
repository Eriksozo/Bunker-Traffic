import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgentSummary} from '../lib/agent-summary.mjs';
import {ensureCollaboration,claimCollaboration,postCollaboration} from '../lib/collaboration.mjs';
import {autonomyTools} from '../lib/autonomy-tools.ts';

const now=Date.parse('2026-11-02T16:10:00.000Z'),iso=n=>new Date(n).toISOString();
const short={decision:'Revisar o conjunto sem vendas.',reason:'A perda está concentrada nessa instância.',nextStep:'Conferir a proposta exata antes de aprovar.'};
function fixture(){
 const row={externalId:'campaign-a',adAccountId:'account-a',name:'Campanha de vendas',provider:'Meta'};
 const job={id:'collection-a',project:'project-a',status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-1000)};
 const state={paused:false,config:{'project-a':{projectName:'Projeto A'}},jobs:[job],agents:{'project-a':{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:'project-a',period,level:'campaign',complete:true,from:'2026-10-26',to:'2026-11-03',timezone:'America/Boa_Vista',source:'Malva MCP',fetchedAt:iso(now-2000),lastSyncAt:null,rows:[structuredClone(row)]}))};
 const round=ensureCollaboration(state,job,now),claim=claimCollaboration(state,{roundId:round.id,agentId:'traffic',executionRef:'real-traffic-worker',clientId:'claim-traffic'},now);
 const args={roundId:round.id,claimId:claim.claimId,executionRef:claim.executionRef,clientId:'traffic-conclusion',toAgent:'creative',kind:'conclusion',text:'Parecer original.\n\nFonte: /private/tmp/source.json\nIDs e métricas permanecem no registro técnico.',evidenceRefs:[{period:'today',level:'campaign',adAccountId:row.adAccountId,externalId:row.externalId,fetchedAt:iso(now-2000)}]};
 return {state,round,args};
}

// Legacy stored requests use this pre-summary integrity format. It is not an approval.
function legacyFingerprint(args){
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
 const s=canonical({claimId:args.claimId,executionRef:args.executionRef,toAgent:args.toAgent,kind:args.kind||'message',text:args.text,evidenceRefs:args.evidenceRefs,replyTo:args.replyTo||null,...(args.requiresReply===undefined?{}:{requiresReply:args.requiresReply})});
 let a=2166136261,b=3335557771;
 for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),2246822519);}
 return 'v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}

test('Optional summaries normalize only the three bounded non-empty display fields',()=>{
 assert.equal(normalizeAgentSummary(undefined),null);
 const input={decision:' d ',reason:' r ',nextStep:' n '},before=structuredClone(input);
 assert.deepEqual(normalizeAgentSummary(input),{decision:'d',reason:'r',nextStep:'n'});
 assert.deepEqual(input,before);
 const atLimit={decision:'d'.repeat(240),reason:'r'.repeat(480),nextStep:'n'.repeat(240)};
 assert.deepEqual(normalizeAgentSummary(atLimit),atLimit);
});

test('Malformed summaries and unexpected keys are rejected instead of becoming optional',()=>{
 const invalid=[null,[],[short],'summary',1,true,{},new Date(),{...short,extra:'unexpected'},Object.create(short)];
 for(const key of ['decision','reason','nextStep']){
  const missing={...short};delete missing[key];invalid.push(missing);
  for(const value of ['', '   ',null,1,[],{}])invalid.push({...short,[key]:value});
  invalid.push({...short,[key]:'x'.repeat(key==='reason'?481:241)});
 }
 const symbol={...short};symbol[Symbol('extra')]='hidden';invalid.push(symbol);
 for(const value of invalid)assert.throws(()=>normalizeAgentSummary(value),/Resumo/);
});

test('A real authored conclusion stores a short summary without rewriting its raw report or granting authority',()=>{
 const {state,round,args}=fixture(),request={...args,summary:{...short}};
 const result=postCollaboration(state,request,now+1);
 assert.equal(result.text,args.text);assert.deepEqual(result.summary,short);assert.deepEqual(result.evidenceRefs,args.evidenceRefs);
 assert.equal(result.fromAgent,'traffic');assert.equal(round.stages[0].status,'Concluída');
 assert.equal(state.proposals.length,0);assert.equal(state.executions,undefined);
 request.summary.reason='Client mutation after sending';assert.equal(result.summary.reason,short.reason);
});

test('Legacy messages keep their exact old fingerprint and remain replayable without a summary',()=>{
 const {state,args}=fixture(),result=postCollaboration(state,args,now+1),saved=structuredClone(result);
 assert.equal(result.requestFingerprint,legacyFingerprint(args));assert.equal(Object.hasOwn(result,'summary'),false);
 assert.equal(postCollaboration(state,{...args,summary:undefined},now+10000000).id,result.id);
 assert.deepEqual(state.collaborationMessages,[saved]);
 assert.throws(()=>postCollaboration(state,{...args,summary:short},now+2),/clientId/);
 assert.deepEqual(state.collaborationMessages,[saved]);
});

test('Replays preserve summary and text; changing or removing a summary cannot reuse its clientId',()=>{
 const {state,args}=fixture(),request={...args,summary:{...short}},result=postCollaboration(state,request,now+1),saved=structuredClone(result);
 assert.equal(postCollaboration(state,request,now+10000000).id,result.id);
 for(const key of ['decision','reason','nextStep'])assert.throws(()=>postCollaboration(state,{...request,summary:{...short,[key]:'Different summary'}},now+2),/clientId/);
 assert.throws(()=>postCollaboration(state,args,now+2),/clientId/);
 assert.throws(()=>postCollaboration(state,{...request,text:'Different raw report'},now+2),/clientId/);
 assert.deepEqual(state.collaborationMessages,[saved]);
});

test('Invalid summaries cannot finish a stage, append a message or partially mutate state',()=>{
 const {state,args}=fixture(),before=structuredClone(state);
 for(const summary of [null,[],{...short,decision:' '},{...short,reason:'r'.repeat(481)},{...short,approval:true}]){
  assert.throws(()=>postCollaboration(state,{...args,summary},now+1),/Resumo/);
  assert.deepEqual(state,before);
 }
 const wrongLease={...args,claimId:'invented',summary:short};assert.throws(()=>postCollaboration(state,wrongLease,now+1),/Reserva/);assert.deepEqual(state,before);
});

test('MCP advertises an optional strict summary with the same field limits and meaningful non-whitespace pattern',()=>{
 const input=autonomyTools.find(t=>t.name==='bunker_colaboracao').inputSchema,schema=input.properties.summary;
 assert.equal(input.required.includes('summary'),false);assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.required,['decision','reason','nextStep']);assert.deepEqual(Object.keys(schema.properties),schema.required);
 for(const [key,max] of [['decision',240],['reason',480],['nextStep',240]]){
  const field=schema.properties[key];assert.equal(field.maxLength,max);assert.equal(field.minLength,1);
  assert.equal(new RegExp(field.pattern).test('   '),false);assert.equal(new RegExp(field.pattern).test('a'),true);
 }
});

// ── Modo Gestor: the notch `autonomy` block (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, b). Synthetic fixtures only. ──
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as deepView from '../lib/autonomy-deep-view.mjs';
import * as shadowLibMg from '../lib/autonomy-shadow.mjs';
const MG_NOW=Date.parse('2026-11-10T15:00:00Z'),MG_DAY='2026-11-10',MG_P='p1',mgIso=ms=>new Date(ms).toISOString();
const mgRow=(id,spend)=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta',name:'Camp '+id,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:200,budgetCurrency:'BRL',budgetRate:1,spend,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:0,impressions:1000,linkClicks:20});
const mgState=()=>({config:{[MG_P]:{projectName:'Fictício'},p2:{projectName:'Outro'}},paused:false,
 autonomy:{version:1,enabled:false,projects:{[MG_P]:{mode:'shadow',actions:{pause:true,reduce:false,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:null,budgetCap:null,ordersPerDay:2},campaigns:{'acc1:c2':{mode:'off',name:'x'}}},p2:{mode:'off',actions:{pause:false,reduce:false,increase:false,activate:false},limits:{ordersPerDay:2},campaigns:{}}}},
 snapshots:[{projectId:MG_P,projectName:'Fictício',period:'today',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true,from:'2026-11-10T03:00:00.000Z',to:'2026-11-11T03:00:00.000Z',fetchedAt:mgIso(MG_NOW-300000),lastSyncAt:mgIso(MG_NOW-360000),rows:[mgRow('c1',150),mgRow('c2',90)]}],proposals:[],executions:[]});
const mgEntry=(id,extra={})=>({id:JSON.stringify([MG_DAY,'test-no-sale',MG_P,'acc1',id,'status']),day:MG_DAY,rule:'test-no-sale',ruleLabel:'r',project:MG_P,projectName:'Fictício',adAccountId:'acc1',accountName:'Conta',objectId:id,name:'Camp '+id,action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',blockedBy:[],limitations:[],wouldExecute:true,firstAt:mgIso(MG_NOW-600000),lastAt:mgIso(MG_NOW-60000),firstWouldExecuteAt:mgIso(MG_NOW-600000),ruleVersion:2,metrics:{spend:150},...extra});
const mgPbView={v:1,at:mgIso(MG_NOW),playbook:{fitAt:null,state:'com-candidatas',plays:[
 {id:'pb:test-pause',key:'pb:test-pause@'+MG_P,rev:'v1:a',stage:'candidata',sentence:'Pausar teste sem venda depois de 1,2 ticket gasto (aprendido com a equipe)',support:{moves:12},agreement:{precision:0.74,recall:0.6,n:19}},
 {id:'pb:night-raise',key:'pb:night-raise@'+MG_P,rev:'v1:b',stage:'observando',sentence:'Aumentar na virada',support:{moves:30},agreement:{precision:0,n:0}},
 {id:'pb:bad-day-cut',key:'pb:bad-day-cut@'+MG_P,rev:'v1:c',stage:'candidata',sentence:'Cortar em dia ruim',support:{moves:9},agreement:{precision:0.5,n:4,fired:6}},
 {id:'pb:x',key:'pb:x@'+MG_P,rev:'v1:d',stage:'observando',sentence:'Outra',support:{moves:1},agreement:{n:0}}],divergences:[]},
 people:[{person:'owner',name:'Você',agreement:{precision:null,recall:0.8,n:10}},{person:'p:j',name:'Jorge',agreement:{precision:null,recall:0.6,n:0}}],scorePlays:{}};
const mgCompiled=ts.transpileModule(fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function mgExecutor(store,deepModule){
 const mods={'autonomy-deep-view':deepModule,'autonomy-shadow':shadowLibMg,'autonomy-grant':await import('../lib/autonomy-grant.mjs'),'companion-summary':await import('../lib/companion-summary.mjs'),'change-attribution':await import('../lib/change-attribution.mjs'),
  'daily-series':await import('../lib/daily-series.mjs'),'meta-display':await import('../lib/meta-display.mjs'),'shadow-learning':await import('../lib/shadow-learning.mjs'),'sales-feed':await import('../lib/sales-feed.mjs')};
 const storage={get:async k=>Array.isArray(k)?new Map(k.filter(x=>x in store).map(x=>[x,store[x]])):store[k],list:async({prefix})=>new Map(Object.entries(store).filter(([k])=>k.startsWith(prefix))),put:async(k,v)=>{if(typeof k==='object')Object.assign(store,k);else store[k]=v;},delete:async()=>{},setAlarm:async()=>{}};
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 const exports={};vm.runInNewContext(mgCompiled,{exports,require:name=>name==='cloudflare:workers'?{DurableObject}:Object.entries(mods).find(([k])=>name.endsWith('/'+k+'.mjs'))?.[1]||{},Date,Response,Intl,Map,Set,setInterval,clearInterval,setTimeout,clearTimeout,structuredClone,TextEncoder});
 const e=new exports.BunkerCloudExecutor({storage},{});e.phoneAlerts=async()=>{};return e;
}
const mgStore=()=>({autonomyDeepBase:deepView.buildDeepBase({state:mgState(),liveItems:[],accuracy:{},policy:{projects:{[MG_P]:{}}},now:MG_NOW}),['pb:view:'+MG_P]:mgPbView,'pb:view':{v:1,agreement:{precision:0.74,n:19}},
 autonomyLog:[],shadowStatus:{at:mgIso(MG_NOW-60000),day:MG_DAY,days:{[MG_P]:MG_DAY,p2:MG_DAY}}});
const withNowMg=async(t,fn)=>{const real=Date.now;Date.now=()=>t;try{return await fn();}finally{Date.now=real;}};
const plain=v=>JSON.parse(JSON.stringify(v));

test('Modo Gestor: every notch summary carries the autonomy block, ≤6 KB, pilot null, N/D agreement null',async()=>{
 const store=mgStore(),e=await mgExecutor(store,deepView),entries=[mgEntry('c1'),mgEntry('c2'),mgEntry('c9',{day:'2026-11-09'})];
 await withNowMg(MG_NOW,()=>e.storeCompanion(mgState(),entries));
 const all=plain(store['companion:all'].autonomy),one=plain(store['companion:'+MG_P].autonomy);
 assert.equal(all.v,1);assert.equal(all.enabled,false);
 assert.deepEqual(all.projects.map(p=>[p.id,p.mode,p.exceptions,p.pilot]),[[MG_P,'shadow',1,null],['p2','off',0,null]]);
 assert.deepEqual(one.projects.map(p=>p.id),[MG_P],'a project summary carries that project only');
 assert.deepEqual(all.projects[0].today,{decisions:2,enviaria:0,pediria:0,soSugestao:1,segurada:0,ordersCreated:0,ordersConfirmed:0},'today only: one Sombra-level suggestion, one campaign switched off');
 assert.deepEqual(all.projects[0].plays.map(p=>[p.id,p.stage,p.agreement,p.n]),[['pb:test-pause','candidata',0.74,19],['pb:bad-day-cut','candidata',0.5,6],['pb:night-raise','observando',null,0]],'candidates first, by support; N/D stays null; n is the precision\'s own sample (fired) when known');
 assert.ok(all.projects[0].plays.every(p=>p.label.length<=60));
 assert.deepEqual(all.projects[0].people,[{person:'owner',name:'Você',agreement:0.8,n:10,metric:'recall'},{person:'p:j',name:'Jorge',agreement:null,n:0,metric:'recall'}],'per person: the share of that person\'s moves a play caught, never a precision');
 assert.deepEqual(all.island,{observing:['Fictício'],agreement:0.74,n:19},'projects off are not "observing"');
 const recent=store['companion:all'].shadow.recent;
 assert.deepEqual(plain(all.campaigns),recent.map(r=>({projectId:r.projectId,adAccountId:r.adAccountId,objectId:r.objectId,mode:r.objectId==='c2'?'off':'shadow'})));
 for(const k of ['companion:all','companion:'+MG_P,'companion:p2'])assert.ok(new TextEncoder().encode(JSON.stringify(store[k].autonomy)).length<=6000,k);
});

test('Modo Gestor: a failing block builder leaves every summary exactly as before, without the key',async()=>{
 const good=mgStore(),bad=mgStore(),entries=[mgEntry('c1')];
 await withNowMg(MG_NOW,async()=>{await (await mgExecutor(good,deepView)).storeCompanion(mgState(),entries);await (await mgExecutor(bad,{...deepView,autonomyCompanion:()=>{throw Error('bug');}})).storeCompanion(mgState(),entries);});
 for(const k of ['companion:all','companion:'+MG_P,'companion:p2']){
  assert.equal('autonomy' in bad[k],false,k+': key omitted, never null');
  const {autonomy:_,...rest}=good[k];assert.deepEqual(plain(bad[k]),plain(rest),k+': the rest is unchanged');
 }
 const noBase=mgStore();delete noBase.autonomyDeepBase;
 await withNowMg(MG_NOW,async()=>(await mgExecutor(noBase,deepView)).storeCompanion(mgState(),entries));
 assert.equal('autonomy' in noBase['companion:all'],false,'no deep base yet: no block');
});

test('Modo Gestor: the block shrinks people, then plays, to stay under 6 KB',()=>{
 const s=mgState(),ids=Array.from({length:8},(_,i)=>'q'+i);for(const id of ids)s.config[id]={projectName:'Projeto '+'y'.repeat(70)+id};
 const base=deepView.buildDeepBase({state:s,liveItems:[],accuracy:{},policy:{},now:MG_NOW}),long='x'.repeat(900);
 const pbViews=Object.fromEntries(ids.map(id=>[id,{...mgPbView,people:Array.from({length:4},(_,i)=>({person:'p:'+i,name:long,agreement:{precision:0.5,n:3}}))}]));
 const out=deepView.autonomyCompanion({base,project:'all',now:MG_NOW,pbViews,entries:[],days:{}});
 assert.ok(out.projects.every(p=>p.name.length<=80&&p.people.every(x=>x.name.length<=80)),'names are bounded');
 assert.ok(new TextEncoder().encode(JSON.stringify(out)).length<=6000);
 assert.ok(out.projects.every(p=>p.people.length<=1),'people cut first');
});
