/* Autonomia do Bunk: battery of the owner's flows (owner request of 12/11/2026, "100 baterias de teste").
 * Levels and campaigns with their own level, what is in force, the campaign list (live reading, scheduled, paused),
 * the draft and the save bar, the requests of the level Confirmar (executor list → web → notch), the Automático order
 * path and its retries, and the wiring of the executor, the web and the notch.
 * Synthetic data only: no real project, account, campaign or value. Nothing here calls a provider or sends an order. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {modeRank,modeCopy,effectiveModeOf,redundantExceptions,exceptionDrift,usableActions,actionsSentence,levelOutcome,islandLines,turnOnSummary,foreignProjectTag,exceptionRows,
 setCampaignModes,removeCampaigns,addCampaigns,pickerReading,deliveryNote,currencyGroups,isMixedCurrency,draftChanges,saveStateView,pendingAsks,openAsks,waitingText} from '../lib/autonomy-ui.mjs';
import {autonomyModes,modeLabels,effectiveMode,setAutonomyConfig,killAutonomy,autonomyGrant,recordAutonomyOrder,unsentAutonomyOrder,autonomyAskEntry,mergeAutonomyAsks,autonomyLimits,
 autonomyLogEntry,mergeAutonomyLog,campaignKey,assertAutonomyGrant} from '../lib/autonomy-grant.mjs';
import {evaluateShadow} from '../lib/autonomy-shadow.mjs';
import {buildDeepBase,autonomyCompanion,deepViewPolicy} from '../lib/autonomy-deep-view.mjs';
import {pruneDirectOrders} from '../lib/owner-direct-order.mjs';
import {overlayMetaRow} from '../lib/meta-display.mjs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const now=Date.parse('2026-11-12T17:00:00Z'),iso=ms=>new Date(ms).toISOString();   // 14:00 America/Sao_Paulo
const P1='11111111-1111-4111-8111-111111111111',P2='55555555-5555-4555-8555-555555555555',ACC='33333333-3333-4333-8333-333333333333',ACC2='44444444-4444-4444-8444-444444444444';
const key=(id,acc=ACC)=>campaignKey(acc,id);
const actions=(o={})=>({pause:true,reduce:false,increase:false,activate:false,...o}),limits=(o={})=>({maxIncreasePct:null,maxReducePct:null,budgetCap:null,ordersPerDay:5,...o});
const proj=(o={})=>({id:P1,name:'Alfa',mode:'shadow',actions:actions(),limits:limits(),campaigns:{},...o});

/* ---------- 1. Levels and campaigns with their own level ---------- */
test('01 levels rank off < shadow < confirm < auto; an unknown level ranks as Sombra',()=>{
 assert.deepEqual(autonomyModes.map(modeRank),[0,1,2,3]);assert.equal(modeRank('turbo'),1);assert.equal(modeRank(undefined),1);
});
test('02 every level has one visible line and none promises an alert that the level does not give',()=>{
 for(const m of autonomyModes)assert.ok(modeCopy[m]&&modeCopy[m].length>20,m);
 assert.doesNotMatch(modeCopy.shadow,/avisa|pede a voc/i);assert.match(modeCopy.confirm,/Touch ID/);assert.match(modeCopy.auto,/sem pedir/);
});
test('03 a campaign without its own level follows the project',()=>{
 assert.deepEqual(effectiveModeOf(proj({mode:'auto'}),key('1')),{mode:'auto',source:'project',redundant:false});
});
test('04 a campaign with its own level passes over the project, up or down',()=>{
 const p=proj({mode:'shadow',campaigns:{[key('1')]:{mode:'auto',name:'A'},[key('2')]:{mode:'off',name:'B'}}});
 assert.equal(effectiveModeOf(p,key('1')).mode,'auto');assert.equal(effectiveModeOf(p,key('2')).mode,'off');assert.equal(effectiveModeOf(p,key('1')).source,'campaign');
});
test('05 the screen rule and the judge agree for every project level × campaign level',()=>{
 for(const pm of autonomyModes)for(const cm of [...autonomyModes,null]){
  const campaigns=cm?{[key('1')]:{mode:cm,name:'A'}}:{},config={enabled:true,projects:{[P1]:{mode:pm,actions:actions(),limits:limits(),campaigns}}};
  assert.equal(effectiveModeOf({mode:pm,campaigns},key('1')).mode,effectiveMode(config,P1,ACC,'1'),`${pm}/${cm}`);
 }
});
test('06 an invalid campaign level is ignored, exactly as the judge ignores it',()=>{
 const campaigns={[key('1')]:{mode:'turbo',name:'A'}};
 assert.equal(effectiveModeOf({mode:'confirm',campaigns},key('1')).mode,'confirm');
 assert.equal(effectiveMode({projects:{[P1]:{mode:'confirm',campaigns}}},P1,ACC,'1'),'confirm');
});
test('07 the owner\'s case: project in Automático with 17 campaigns in Automático changes nothing',()=>{
 const campaigns=Object.fromEntries(Array.from({length:17},(_,i)=>[key(String(i)),{mode:'auto',name:'T'+i}]));
 const p=proj({mode:'auto',campaigns});
 assert.equal(redundantExceptions(p).length,17);assert.deepEqual(exceptionDrift(p),{above:[],below:[],same:Object.keys(campaigns)});
});
test('08 lowering the project keeps those 17 campaigns in Automático: they now sit above the project',()=>{
 const campaigns=Object.fromEntries(Array.from({length:17},(_,i)=>[key(String(i)),{mode:'auto',name:'T'+i}]));
 const d=exceptionDrift(proj({mode:'shadow',campaigns}));
 assert.equal(d.above.length,17);assert.equal(d.same.length,0);
 assert.equal(effectiveMode({projects:{[P1]:{mode:'shadow',campaigns}}},P1,ACC,'3'),'auto','the judge keeps them in Automático');
});
test('09 drift separates above, below and same',()=>{
 const p=proj({mode:'confirm',campaigns:{[key('1')]:{mode:'auto'},[key('2')]:{mode:'off'},[key('3')]:{mode:'confirm'},[key('4')]:{mode:'shadow'}}});
 const d=exceptionDrift(p);assert.deepEqual([d.above,d.below,d.same],[[key('1')],[key('2'),key('4')],[key('3')]]);
});
test('10 a project never configured is Sombra and has no campaign above it',()=>{
 assert.deepEqual(exceptionDrift({}),{above:[],below:[],same:[]});assert.equal(effectiveModeOf({},key('1')).mode,'shadow');
});

/* ---------- 2. What is in force right now ---------- */
test('11 Desligado and Sombra never act and need nothing',()=>{
 assert.deepEqual([levelOutcome({mode:'off'}).label,levelOutcome({mode:'shadow'}).label],['Não mexe','Só observa']);
 assert.equal(levelOutcome({mode:'off',enabled:false}).inForce,true);assert.equal(levelOutcome({mode:'shadow'}).acts,'none');
});
test('12 Automático with the switch on and Pausar on is in force and sends',()=>{
 const o=levelOutcome({enabled:true,mode:'auto',actions:actions(),limits:limits()});
 assert.deepEqual([o.acts,o.inForce,o.label,o.tone],['sends',true,'Valendo: age sozinho','good']);
});
test('13 Confirmar with the switch on is in force and asks',()=>{
 const o=levelOutcome({enabled:true,mode:'confirm',actions:actions(),limits:limits()});
 assert.deepEqual([o.acts,o.inForce,o.label],['asks',true,'Valendo: pede a você']);
});
test('14 the switch off stops Automático AND Confirmar (the 11/11 case), and the screen says why',()=>{
 for(const mode of ['confirm','auto']){const o=levelOutcome({enabled:false,mode,actions:actions(),limits:limits()});assert.equal(o.inForce,false);assert.match(o.reasons.join(' '),/interruptor geral/);assert.match(o.label,/parado/);}
 const s={config:{[P1]:{projectName:'Alfa'}},paused:false,proposals:[],executions:[],events:[]};
 setAutonomyConfig(s,{enabled:false,projects:{[P1]:{mode:'confirm',actions:actions(),limits:limits(),campaigns:{}}}},'web:owner',now-1000);
 const g=autonomyGrant(s,{id:'d',rule:'test-no-sale',project:P1,adAccountId:ACC,objectId:'1',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},blockedBy:[],wouldExecute:true},{now});
 assert.equal(g.act,'none');assert.match(g.blockers.join(' '),/interruptor geral/,'the judge holds the request too');
});
test('15 a paused office stops both levels',()=>{
 assert.match(levelOutcome({enabled:true,paused:true,mode:'auto',actions:actions(),limits:limits()}).reasons.join(' '),/pausado/);
});
test('16 a project the Bunk does not evaluate is never in force',()=>{
 const o=levelOutcome({enabled:true,mode:'auto',actions:actions(),limits:limits(),covered:false});assert.equal(o.inForce,false);assert.match(o.reasons.join(' '),/não avalia/);
});
test('17 Automático with no action on does nothing and says so',()=>{
 const o=levelOutcome({enabled:true,mode:'auto',actions:actions({pause:false}),limits:limits()});assert.equal(o.inForce,false);assert.match(o.reasons.join(' '),/Nenhuma ação/);
});
test('18 reduce and increase only count with their limits',()=>{
 assert.deepEqual(usableActions(actions({reduce:true,increase:true}),limits()),['pause']);
 assert.deepEqual(usableActions(actions({pause:false,reduce:true}),limits({maxReducePct:20})),['reduce']);
 assert.deepEqual(usableActions(actions({pause:false,increase:true}),limits({maxIncreasePct:50})),[],'increase needs the cap too');
 assert.deepEqual(usableActions(actions({increase:true}),limits({maxIncreasePct:50,budgetCap:900})),['pause','increase']);
});
test('19 reactivation never counts as an action that runs',()=>{
 assert.deepEqual(usableActions({pause:false,reduce:false,increase:false,activate:true},limits()),[]);
});
test('20 the plain sentence of the owner\'s setup: only pause, 5 orders a day',()=>{
 assert.equal(actionsSentence(actions(),limits()),'Pausa; não reduz; não aumenta; até 5 ordens por campanha por dia.');
});
test('21 the sentence names the missing limit instead of promising the action',()=>{
 const t=actionsSentence(actions({reduce:true,increase:true}),limits({maxIncreasePct:50,ordersPerDay:null}));
 assert.match(t,/não reduz \(falta a redução máxima\)/);assert.match(t,/não aumenta \(falta o teto\)/);assert.match(t,/até 2 ordens/);
});
test('22 the sentence with every limit set',()=>{
 assert.equal(actionsSentence(actions({reduce:true,increase:true}),limits({maxIncreasePct:50,maxReducePct:20,budgetCap:900,ordersPerDay:1})),'Pausa; reduz até 20%; aumenta até 50% com teto de 900; até 1 ordem por campanha por dia.');
});

/* ---------- 3. The island: where the Bunk acts, asks and watches ---------- */
const view=(enabled,projects)=>({enabled,projects});
test('23 switch off with nothing above Sombra: the Bunk only observes',()=>{
 const l=islandLines(view(false,[proj()]));assert.equal(l.headline,'Desligada: o Bunk só observa e aprende');assert.equal(l.stopped,false);assert.deepEqual(l.observes,['Alfa']);
});
test('24 switch off with Confirmar or Automático saved: nothing is sent NOR asked, and it is flagged',()=>{
 const l=islandLines(view(false,[proj({mode:'confirm'})]));assert.equal(l.stopped,true);assert.match(l.headline,/nem pedido a você/);
});
test('25 a Sombra project with campaigns in Automático counts as acting (the old line said "observando")',()=>{
 const l=islandLines(view(true,[proj({campaigns:{[key('1')]:{mode:'auto'},[key('2')]:{mode:'auto'},[key('3')]:{mode:'confirm'}}})]));
 assert.deepEqual(l.sends,['Alfa (2 campanhas)']);assert.deepEqual(l.asks,['Alfa (1 campanha)']);assert.match(l.headline,/age sozinho em Alfa \(2 campanhas\)/);
});
test('26 switch on with nothing to act on says so',()=>{
 assert.match(islandLines(view(true,[proj()])).headline,/nenhum projeto ou campanha/);
});
test('27 projects are listed by what they do',()=>{
 const l=islandLines(view(true,[proj({mode:'auto'}),proj({id:P2,name:'Beta',mode:'confirm'}),proj({id:'p3',name:'Gama',mode:'off'}),proj({id:'p4',name:'Delta'})]));
 assert.deepEqual([l.sends,l.asks,l.off,l.observes],[['Alfa'],['Beta'],['Gama'],['Delta']]);
});
test('28 turning on lists the exact powers, per project, and skips projects that would not act',()=>{
 const lines=turnOnSummary(view(false,[proj({mode:'auto'}),proj({id:P2,name:'Beta'}),proj({id:'p3',name:'Gama',campaigns:{[key('9')]:{mode:'confirm'}}})]));
 assert.equal(lines.length,2);assert.match(lines[0],/^Alfa: age sozinho em o projeto inteiro\. Pausa;/);assert.match(lines[1],/^Gama: pede a você em 1 campanha\./);
});
test('29 nothing to turn on gives no line',()=>{assert.deepEqual(turnOnSummary(view(false,[proj(),proj({id:P2,mode:'off'})])),[]);});
test('30 a project doing both is one line with both',()=>{
 assert.match(turnOnSummary(view(false,[proj({mode:'confirm',campaigns:{[key('1')]:{mode:'auto'}}})]))[0],/age sozinho em 1 campanha e pede a você em o projeto inteiro/);
});

/* ---------- 4. Campaigns with their own level: what the list shows ---------- */
const entry=(id,o={})=>[key(id,o.acc||ACC),{key:key(id,o.acc||ACC),name:o.name||'C'+id,status:o.status===undefined?'active':o.status,statusLabel:o.label||'Ativa',accountName:o.account||'Conta Um',accountId:o.acc||ACC}];
const reading=(...entries)=>({known:true,byKey:new Map(entries)});
test('31 an active campaign stays in the main list',()=>{
 const r=exceptionRows(proj({campaigns:{[key('1')]:{mode:'auto',name:'A'}}}),reading(entry('1')));
 assert.deepEqual([r.live.length,r.parked.length,r.live[0].status,r.live[0].account],[1,0,'active','Conta Um']);
});
test('32 a paused campaign leaves the main list at once, and its level stays saved',()=>{
 const p=proj({campaigns:{[key('1')]:{mode:'confirm',name:'A'},[key('2')]:{mode:'confirm',name:'B'}}});
 const r=exceptionRows(p,reading(entry('1'),entry('2',{status:'paused',label:'Pausada'})));
 assert.deepEqual(r.live.map(x=>x.key),[key('1')]);assert.deepEqual(r.parked.map(x=>[x.key,x.mode]),[[key('2'),'confirm']]);assert.equal(Object.keys(p.campaigns).length,2,'the draft is untouched');
});
test('33 archived and deleted campaigns are parked too',()=>{
 const r=exceptionRows(proj({campaigns:{[key('1')]:{mode:'auto'}}}),reading(entry('1',{status:'inactive',label:'Arquivada'})));assert.equal(r.parked.length,1);
});
test('34 a campaign out of today\'s reading is parked and labelled',()=>{
 const r=exceptionRows(proj({campaigns:{[key('1')]:{mode:'auto',name:'A'},[key('2')]:{mode:'auto',name:'B'}}}),reading(entry('1')));
 assert.deepEqual(r.parked.map(x=>[x.key,x.status,x.statusLabel]),[[key('2'),'absent','Fora da leitura de hoje']]);
});
test('35 without today\'s reading nothing is hidden: every campaign stays in the list',()=>{
 const r=exceptionRows(proj({campaigns:{[key('1')]:{mode:'auto'},[key('2')]:{mode:'off'}}}),{known:false,byKey:new Map()});
 assert.deepEqual([r.live.length,r.parked.length,r.known],[2,0,false]);assert.equal(r.live[0].status,null);
});
test('36 rows equal to the project are flagged "sem efeito"; rows above it are flagged',()=>{
 const r=exceptionRows(proj({mode:'confirm',campaigns:{[key('1')]:{mode:'confirm'},[key('2')]:{mode:'auto'},[key('3')]:{mode:'off'}}}),reading(entry('1'),entry('2'),entry('3')));
 assert.deepEqual([r.same,r.above],[[key('1')],[key('2')]]);
});
test('37 the same name in two accounts is told apart by the account',()=>{
 const name='11/11 - [CBO] - [NICO] - [TESTE] - NICO_A_121_H1';
 const r=exceptionRows(proj({campaigns:{[key('1')]:{mode:'confirm',name},[key('1',ACC2)]:{mode:'confirm',name}}}),reading(entry('1',{account:'Conta Um'}),entry('1',{acc:ACC2,account:'Conta Dois'})));
 assert.deepEqual(r.live.map(x=>[x.account,x.duplicateName]),[['Conta Dois',true],['Conta Um',true]]);
});
test('38 a campaign named for another configured project is pointed out (John inside Nico)',()=>{
 const projects=[{id:P1,name:'Nico'},{id:P2,name:'John'}];
 assert.equal(foreignProjectTag('11/11 - [CBO] - [JOHN] - [TESTE] - JHON_A_405_H1',projects[0],projects),'John');
 assert.equal(foreignProjectTag('11/11 - [CBO] - [NICO] - [TESTE] - NICO_A_121_H1',projects[0],projects),null);
 assert.equal(foreignProjectTag('11/11 - [CBO] - [NICO] - [JOHN]',projects[0],projects),null,'its own tag wins');
 assert.equal(foreignProjectTag('JHON_A_405_H1',projects[0],projects),null,'only a bracket tag counts');
 assert.equal(foreignProjectTag('[Jóhn] x',projects[0],projects),'John','accents and case ignored');
});
test('39 the foreign mark reaches the row',()=>{
 const r=exceptionRows({id:P1,name:'Nico',mode:'confirm',campaigns:{[key('1')]:{mode:'confirm',name:'[JOHN] teste'}}},reading(entry('1')),{projects:[{id:P1,name:'Nico'},{id:P2,name:'John'}]});
 assert.deepEqual(r.foreign,[key('1')]);assert.equal(r.live[0].foreign,'John');
});
test('40 rows are ordered by account, then name, the same way every time',()=>{
 const p=proj({campaigns:{[key('3')]:{mode:'auto',name:'T 10'},[key('1')]:{mode:'auto',name:'T 2'},[key('2',ACC2)]:{mode:'auto',name:'A'}}});
 const r=exceptionRows(p,reading(entry('3'),entry('1'),entry('2',{acc:ACC2,account:'Conta Um'})));
 assert.deepEqual(r.live.map(x=>x.name),['A','T 2','T 10']);
});
test('41 an unknown saved level shows as Sombra, as the judge treats it',()=>{
 assert.equal(exceptionRows(proj({campaigns:{[key('1')]:{mode:'turbo'}}}),reading(entry('1'))).live[0].mode,'shadow');
});
test('42 300 campaigns are split without losing any',()=>{
 const campaigns={},entries=[];for(let i=0;i<300;i++){campaigns[key(String(i))]={mode:'auto',name:'T'+i};entries.push(entry(String(i),{status:i%3?'active':'paused'}));}
 const r=exceptionRows(proj({campaigns}),reading(...entries));assert.equal(r.live.length+r.parked.length,300);assert.equal(r.parked.length,100);assert.equal(r.total,300);
});

/* ---------- 5. Changing many at once ---------- */
test('43 "mudar todas para" changes only the listed campaigns',()=>{
 const before={[key('1')]:{mode:'off',name:'A'},[key('2')]:{mode:'off',name:'B'}},after=setCampaignModes(before,[key('1')],'auto');
 assert.deepEqual(after,{[key('1')]:{mode:'auto',name:'A'},[key('2')]:{mode:'off',name:'B'}});assert.equal(before[key('1')].mode,'off','input untouched');
});
test('44 an invalid level or an unknown campaign changes nothing',()=>{
 const c={[key('1')]:{mode:'off',name:'A'}};assert.deepEqual(setCampaignModes(c,[key('1')],'turbo'),c);assert.deepEqual(setCampaignModes(c,[key('9')],'auto'),c);
});
test('45 removing the 17 redundant campaigns leaves the others',()=>{
 const campaigns=Object.fromEntries(Array.from({length:17},(_,i)=>[key(String(i)),{mode:'auto'}]));campaigns[key('99')]={mode:'off'};
 const p=proj({mode:'auto',campaigns});assert.deepEqual(removeCampaigns(campaigns,redundantExceptions(p)),{[key('99')]:{mode:'off'}});
});
test('46 "trazer para o nível do projeto" removes exactly the campaigns above it',()=>{
 const p=proj({mode:'shadow',campaigns:{[key('1')]:{mode:'auto'},[key('2')]:{mode:'off'},[key('3')]:{mode:'confirm'}}});
 const next={...p,campaigns:removeCampaigns(p.campaigns,exceptionDrift(p).above)};
 assert.deepEqual(Object.keys(next.campaigns),[key('2')]);assert.equal(exceptionDrift(next).above.length,0);
});
test('47 clearing the paused ones removes only the parked rows',()=>{
 const p=proj({campaigns:{[key('1')]:{mode:'auto'},[key('2')]:{mode:'auto'},[key('3')]:{mode:'auto'}}});
 const r=exceptionRows(p,reading(entry('1'),entry('2',{status:'paused'})));
 assert.deepEqual(Object.keys(removeCampaigns(p.campaigns,r.parked.map(x=>x.key))),[key('1')]);
});
test('48 adding campaigns uses the level the owner picked',()=>{
 assert.deepEqual(addCampaigns({},[{key:key('1'),name:'A'},{key:key('2'),name:'B'}],'auto'),{[key('1')]:{mode:'auto',name:'A'},[key('2')]:{mode:'auto',name:'B'}});
});
test('49 adding never overwrites a campaign that already has a level',()=>{
 assert.deepEqual(addCampaigns({[key('1')]:{mode:'off',name:'A'}},[{key:key('1'),name:'A'}],'auto'),{[key('1')]:{mode:'off',name:'A'}});
});
test('50 adding without a level, or with an invalid one, never raises anything: Desligado',()=>{
 assert.equal(addCampaigns({},[{key:key('1'),name:'A'}])[key('1')].mode,'off');assert.equal(addCampaigns({},[{key:key('1'),name:'A'}],'turbo')[key('1')].mode,'off');
});

/* ---------- 6. The campaign list: live reading, scheduled campaigns, other days ---------- */
const TZ='America/Sao_Paulo';
const snap=(rows,at,o={})=>({projectId:P1,level:'campaign',period:'today',timezone:TZ,fetchedAt:iso(at),rows,...o});
const crow=(id,o={})=>({externalId:id,adAccountId:ACC,provider:'meta',level:'campaign',name:'C'+id,status:'ACTIVE',spend:0,impressions:0,...o});
test('51 the live reading wins: a campaign created after the analysis appears (the owner\'s 12/11 uploads)',()=>{
 const r=pickerReading({analysis:snap([crow('1',{spend:50})],now-4*3600000),live:snap([crow('1',{spend:80}),crow('2')],now-60000),now});
 assert.equal(r.source,'live');assert.equal(r.at,iso(now-60000));assert.deepEqual(r.rows.map(x=>[x.externalId,x.spend]),[['1',80],['2',0]]);
});
test('52 a campaign only in the analysis is kept; the newest row wins for the others',()=>{
 const r=pickerReading({analysis:snap([crow('1'),crow('3',{status:'PAUSED'})],now-3600000),live:snap([crow('1',{status:'PAUSED'})],now-60000),now});
 assert.deepEqual(r.rows.map(x=>[x.externalId,x.status]).sort(),[['1','PAUSED'],['3','PAUSED']]);
});
test('53 without a live reading the analysis of today is used and labelled',()=>{
 const r=pickerReading({analysis:snap([crow('1')],now-3600000),live:null,now});assert.equal(r.source,'analysis');assert.equal(r.rows.length,1);
});
test('54 yesterday\'s reading is never shown as today\'s (the "leitura de hoje às 18:01" after midnight)',()=>{
 const r=pickerReading({analysis:snap([crow('1')],now-24*3600000),live:null,now});assert.deepEqual([r.rows.length,r.source,r.stale],[0,null,true]);
});
test('55 a live reading from another day is ignored and the analysis of today used',()=>{
 const r=pickerReading({analysis:snap([crow('1')],now-3600000),live:snap([crow('2')],now-30*3600000),now});assert.deepEqual(r.rows.map(x=>x.externalId),['1']);
});
test('56 no reading at all is an empty, non-stale list',()=>{assert.deepEqual(pickerReading({now}),{rows:[],at:null,source:null,currency:null,timezone:null,stale:false});});
test('57 a malformed reading is ignored instead of breaking the list',()=>{
 assert.equal(pickerReading({analysis:{level:'ad',period:'today',rows:[],fetchedAt:iso(now)},live:{level:'campaign',period:'today',rows:'x',fetchedAt:iso(now)},now}).rows.length,0);
});
test('58 the same campaign in two accounts is two rows',()=>{
 assert.equal(pickerReading({live:snap([crow('1'),crow('1',{adAccountId:ACC2})],now-1000),now}).rows.length,2);
});
test('59 a campaign scheduled on Meta for later is marked "Programada" with its start',()=>{
 const n=deliveryNote(crow('1',{name:'12/11 - [CBO] - [ALFA] - [TESTE] - A',startAt:iso(now+5*3600000)}),{now,timezone:TZ});
 assert.equal(n.kind,'scheduled');assert.match(n.label,/^Programada · começa /);
});
test('60 the Meta start read for display (metaLive.startTime) is enough to mark it',()=>{
 const row=overlayMetaRow(crow('120000000000000001',{name:'Teste A'}),{id:'120000000000000001',status:'ACTIVE',startTime:iso(now+2*3600000)},{metaAt:now,fetchedAt:now-60000,sameDay:true});
 assert.equal(row.metaLive.startTime,iso(now+2*3600000));assert.equal(deliveryNote(row,{now,timezone:TZ}).kind,'scheduled');
});
test('61 a campaign dated tomorrow in its name is scheduled even without the Meta start',()=>{
 assert.equal(deliveryNote(crow('1',{name:'13/11 - [CBO] - [ALFA] - [TESTE] - A'}),{now,timezone:TZ}).kind,'scheduled');
});
test('62 an active campaign with nothing delivered today is "Sem entrega ainda"',()=>{
 assert.deepEqual(deliveryNote(crow('1',{name:'Escala antiga'}),{now,timezone:TZ}),{kind:'no-delivery',label:'Sem entrega ainda'});
});
test('63 delivering, paused and warm-up campaigns get no note',()=>{
 assert.equal(deliveryNote(crow('1',{spend:10}),{now}),null);assert.equal(deliveryNote(crow('1',{impressions:5}),{now}),null);
 assert.equal(deliveryNote(crow('1',{status:'PAUSED'}),{now}),null);assert.equal(deliveryNote(crow('1',{name:'[ENGAJAMENTO] perfil'}),{now}),null);assert.equal(deliveryNote(null),null);
});
test('64 the list offers a "Programadas ou sem entrega" filter and reads the live cache',()=>{
 const src=read('app/autonomy/permissions.tsx');
 assert.match(src,/chip\('noDelivery','Programadas ou sem entrega'/);assert.match(src,/pickerReading\(\{analysis,live:currentLiveSnapshot\(liveItem,p\.id,undefined,at\),now:at\}\)/);
 assert.match(read('app/bunker.tsx'),/<AutonomyPanel state=\{state\} write=\{write\} saving=\{saving\} liveItems=\{live\.data\?\.items\|\|null\}/);
});

/* ---------- 7. Currencies ---------- */
const camp=(budget,currency)=>({budget:{dailyBudget:budget,currency}});
test('65 one currency plus campaigns without a known currency is NOT mixed (false alarm fixed)',()=>{
 const g=currencyGroups([camp(100,'BRL'),camp(50,null),camp(80,'BRL')]);assert.equal(isMixedCurrency(g),false);assert.deepEqual(g.map(x=>[x.currency,x.count,x.maxBudget]),[['BRL',2,100],[null,1,50]]);
});
test('66 two real currencies are mixed, each with its own largest budget',()=>{
 const g=currencyGroups([camp(600,'USD'),camp(800,'BRL'),camp(900,'BRL')]);assert.equal(isMixedCurrency(g),true);assert.deepEqual(g.map(x=>[x.currency,x.maxBudget]),[['BRL',900],['USD',600]]);
});
test('67 campaigns without a daily budget are left out; no campaign is no group',()=>{
 assert.deepEqual(currencyGroups([{budget:{dailyBudget:null,currency:'BRL'}},{}]),[]);assert.equal(isMixedCurrency([]),false);assert.deepEqual(currencyGroups(null),[]);
});
test('68 an invalid currency code is treated as unknown, never as a currency',()=>{
 assert.equal(isMixedCurrency(currencyGroups([camp(1,'BRL'),camp(2,'reais')])),false);
});

/* ---------- 8. The draft and the save bar ---------- */
test('69 no draft: nothing to save',()=>{assert.deepEqual(saveStateView({}),{tone:'info',text:'Sem alterações para salvar.',canSave:false});});
test('70 an open draft says it is not in force yet and can be saved (the "Não salvo" on John)',()=>{
 const v=saveStateView({draft:true,changed:1});assert.equal(v.canSave,true);assert.match(v.text,/1 projeto com alterações não salvas\. Nada disso vale até você salvar\./);
});
test('71 a draft equal to the saved permissions cannot be saved',()=>{assert.equal(saveStateView({draft:true,changed:0}).canSave,false);});
test('72 a limit out of range blocks the save and says what to fix',()=>{
 const v=saveStateView({draft:true,changed:2,invalid:true});assert.equal(v.canSave,false);assert.match(v.text,/Corrija os limites/);
});
test('73 a conflict with another session blocks the save and keeps the draft',()=>{
 const v=saveStateView({draft:true,changed:1,conflict:true});assert.equal(v.canSave,false);assert.match(v.text,/outra sessão/);
});
test('74 a failed save says the old permissions still apply and allows trying again',()=>{
 const v=saveStateView({draft:true,changed:1,last:'failed',error:'Sem conexão.'});assert.equal(v.canSave,true);assert.match(v.text,/Sem conexão\./);assert.match(v.text,/o que vale ainda é o que estava salvo/);
});
test('75 while saving nothing can be clicked twice',()=>{assert.deepEqual(saveStateView({draft:true,changed:1,busy:true}),{tone:'busy',text:'Salvando…',canSave:false});});
test('76 after saving, the bar says whether it is really in force',()=>{
 assert.equal(saveStateView({last:'saved',enabled:true}).text,'Permissões salvas e valendo agora.');
 assert.match(saveStateView({last:'saved',enabled:false}).text,/autonomia está desligada: nada é enviado nem pedido/);
});
test('77 the bar lists what changes: level, action, limit and campaigns',()=>{
 const saved=[proj()],draft=[proj({mode:'auto',actions:actions({reduce:true}),limits:limits({maxReducePct:20}),campaigns:{[key('1')]:{mode:'off',name:'A'}}})];
 const c=draftChanges(saved,draft);assert.equal(c.lines.length,1);
 for(const t of ['nível Sombra → Automático','Reduzir orçamento ligado','redução máxima não definido → 20','1 campanha ganha nível próprio'])assert.ok(c.lines[0].includes(t),t);
 assert.equal(c.raises,true);
});
test('78 lowering a level, turning an action off or lowering a limit does not raise power',()=>{
 const saved=[proj({mode:'auto',actions:actions({reduce:true}),limits:limits({maxReducePct:30})})];
 assert.equal(draftChanges(saved,[proj({mode:'confirm',actions:actions(),limits:limits({maxReducePct:20})})]).raises,false);
});
test('79 moving one campaign up raises power; removing a restrictive level raises it too',()=>{
 assert.equal(draftChanges([proj({campaigns:{[key('1')]:{mode:'off'}}})],[proj({campaigns:{[key('1')]:{mode:'auto'}}})]).raises,true);
 assert.equal(draftChanges([proj({mode:'auto',campaigns:{[key('1')]:{mode:'off'}}})],[proj({mode:'auto',campaigns:{}})]).raises,true,'the campaign goes back to Automático');
 assert.equal(draftChanges([proj({mode:'auto',campaigns:{[key('1')]:{mode:'auto'}}})],[proj({mode:'auto',campaigns:{}})]).raises,false,'removing a redundant level changes nothing');
});
test('80 an unchanged project gives no line; a project missing from the saved list is ignored',()=>{
 assert.deepEqual(draftChanges([proj()],[proj()]),{lines:[],raises:false});assert.deepEqual(draftChanges([],[proj({mode:'auto'})]),{lines:[],raises:false});
});
test('81 the draft survives leaving the tab, asks before closing the page and never uses browser storage',()=>{
 const src=read('app/autonomy/permissions.tsx');
 assert.match(src,/let draftMemory:Draft\|null=null;/);assert.match(src,/useState<Draft\|null>\(draftMemory\)/);assert.match(src,/addEventListener\('beforeunload',warn\)/);
 assert.doesNotMatch(src,/localStorage|sessionStorage/);
});
test('82 saving is refused with a limit out of range, and the save still goes only through autonomyConfig',()=>{
 const src=read('app/autonomy/permissions.tsx');
 assert.match(src,/const bad=projects\.find\(hasIssue\);if\(bad\)\{setError\(/);assert.match(src,/write\(\{op:'autonomyConfig',config:payload\(enabled\)\}\)/);
 assert.equal((src.match(/write\(/g)||[]).length,2,'one save and one kill');
});

/* ---------- 9. Level Confirmar: the request reaches the owner ---------- */
const decision=(o={})=>({id:JSON.stringify(['2026-11-12','test-no-sale',P1,ACC,'120000000000000001','status']),rule:'test-no-sale',ruleLabel:'Teste sem venda',project:P1,projectName:'Alfa',adAccountId:ACC,objectId:'120000000000000001',
 name:'12/11 - [CBO] - [ALFA] - [TESTE] - A',accountName:'Conta Um',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'Sem venda depois do teto.',blockedBy:[],wouldExecute:true,...o});
const stateWith=(mode,{enabled=true,campaigns={},projectMode=null}={})=>{const s={config:{[P1]:{projectName:'Alfa'},[P2]:{projectName:'Beta'}},paused:false,proposals:[],executions:[],events:[]};
 setAutonomyConfig(s,{enabled,projects:{[P1]:{mode:projectMode||mode,actions:actions({reduce:true}),limits:limits({maxReducePct:30,ordersPerDay:2}),campaigns}}},'web:owner',now-3600000);return s;};
test('83 Confirmar with the switch on asks and never orders',()=>{
 const s=stateWith('confirm'),g=autonomyGrant(s,decision(),{now});assert.deepEqual([g.mode,g.act,g.action],['confirm','confirm','pause']);
 assert.deepEqual(recordAutonomyOrder(s,decision(),{live:{row:{},fetchedAt:iso(now)},now}).blocked,['Modo da campanha não é Automático.']);assert.equal(s.proposals.length,0);
});
test('84 the request carries the exact change and nothing secret',()=>{
 const a=autonomyAskEntry(decision(),{action:'pause',percent:null},now);
 assert.deepEqual(Object.keys(a).sort(),['account','action','adAccountId','after','at','before','campaign','id','objectId','percent','project','projectName','reason','rule','ruleLabel']);
 assert.equal(a.id,decision().id);assert.equal(a.at,iso(now));assert.deepEqual([a.before.status,a.after.status],['ACTIVE','PAUSED']);
});
test('85 a request re-seen every minute keeps its first time, so it alerts once',()=>{
 const first=autonomyAskEntry(decision(),{action:'pause',percent:null},now),again=autonomyAskEntry(decision(),{action:'pause',percent:null},now+60000);
 const list=mergeAutonomyAsks([first],[again],[P1]);assert.equal(list.length,1);assert.equal(list[0].at,iso(now));
});
test('86 when the rule drops the decision the request closes (the owner paused it himself)',()=>{
 assert.deepEqual(mergeAutonomyAsks([autonomyAskEntry(decision(),{action:'pause',percent:null},now)],[],[P1]),[]);
});
test('87 a project the pass did not evaluate keeps its requests',()=>{
 const a=autonomyAskEntry(decision({project:P2}),{action:'pause',percent:null},now);
 assert.equal(mergeAutonomyAsks([a],[],[P1]).length,1);assert.equal(mergeAutonomyAsks([a],[],[P1,P2]).length,0);assert.equal(mergeAutonomyAsks([a],[],null).length,0,'no list of evaluated projects: only this pass counts');
});
test('88 requests are newest first, without duplicates, and bounded',()=>{
 const many=Array.from({length:60},(_,i)=>autonomyAskEntry(decision({id:'d'+i}),{action:'pause',percent:null},now+i*1000));
 const list=mergeAutonomyAsks([],[...many,many[0]],[P1]);assert.equal(list.length,autonomyLimits.keepAsks);assert.equal(list[0].id,'d59');
 assert.deepEqual(mergeAutonomyAsks('x',[null,{id:5}],[P1]),[]);
});
test('89 the web shows the executor\'s open requests, newest first, only with the switch on',()=>{
 const asks=[autonomyAskEntry(decision({id:'a'}),{action:'pause',percent:null},now-10*60000),autonomyAskEntry(decision({id:'b',action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:80,currency:'BRL'}}),{action:'reduce',percent:20},now-60000)];
 const open=openAsks({asks,log:[]},{enabled:true,now});
 assert.deepEqual(open.map(x=>[x.id,x.actionLabel,x.ageMinutes]),[['b','Reduzir orçamento',1],['a','Pausar',10]]);
 assert.deepEqual(openAsks({asks,log:[]},{enabled:false,now}),[],'switch off: nothing is asked');
});
test('90 the project filter of the tab applies to the requests',()=>{
 const asks=[autonomyAskEntry(decision({id:'a'}),{action:'pause',percent:null},now),autonomyAskEntry(decision({id:'b',project:P2}),{action:'pause',percent:null},now)];
 assert.deepEqual(openAsks({asks},{enabled:true,now,project:P2}).map(x=>x.id),['b']);assert.equal(openAsks({asks},{enabled:true,now}).length,2);
});
test('91 an older executor without the list falls back to today\'s "confirm" lines of the log',()=>{
 const g={mode:'confirm',action:'pause',percent:null},line=(d,kind,at)=>autonomyLogEntry(d,g,{kind},at);
 const log=[line(decision({id:'x'}),'confirm',now-5*60000),line(decision({id:'y'}),'confirm',now-26*3600000),line(decision({id:'z'}),'blocked',now-60000)];
 assert.deepEqual(openAsks({log},{enabled:true,now}).map(x=>x.id),['x']);
});
test('92 a request that became an order, or that the rule no longer proposes, stops waiting',()=>{
 const g={mode:'confirm',action:'pause',percent:null},log=[autonomyLogEntry(decision({id:'x'}),g,{kind:'order'},now-60000),autonomyLogEntry(decision({id:'x'}),g,{kind:'confirm'},now-120000),autonomyLogEntry(decision({id:'w'}),g,{kind:'confirm'},now-120000)];
 assert.deepEqual(pendingAsks(log,{now}).map(x=>x.id),['w']);
 assert.deepEqual(pendingAsks(log,{now,decisions:[{id:'w',status:'segurada'}]}),[]);assert.deepEqual(pendingAsks(log,{now,decisions:[{id:'w',status:'pediria'}]}).map(x=>x.stillCurrent),[true]);
});
test('93 the log never repeats the same request line',()=>{
 const g={mode:'confirm',action:'pause',percent:null},a=autonomyLogEntry(decision(),g,{kind:'confirm'},now),b=autonomyLogEntry(decision(),g,{kind:'confirm'},now+60000);
 assert.equal(mergeAutonomyLog([a],[b]).length,1);assert.equal(pendingAsks(mergeAutonomyLog([a],[b]),{now:now+120000}).length,1);
});
test('94 waiting time reads plainly',()=>{
 assert.deepEqual([waitingText(0),waitingText(5),waitingText(59),waitingText(125),waitingText(60*50),waitingText(null)],['agora','há 5 min','há 59 min','há 2 h','há 2 dias','horário N/D']);
});
const deepBase=(mode,enabled=true,campaigns={})=>buildDeepBase({state:{config:{p1:{projectName:'Alfa'}},paused:false,autonomy:{version:1,enabled,projects:{p1:{mode,actions:actions(),limits:limits(),campaigns}}},snapshots:[],proposals:[],executions:[]},liveItems:[],accuracy:{},policy:{projects:{p1:{ticketFront:97}}},now});
const ask=(id,o={})=>({id,at:iso(now-60000),project:'p1',projectName:'Alfa',adAccountId:'acc1',objectId:'c'+id,campaign:'Campanha '+id,action:'pause',percent:null,ruleLabel:'Teste sem venda',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',...o});
test('95 the notch block publishes the open requests with the ids it needs to open the order',()=>{
 const out=autonomyCompanion({base:deepBase('confirm'),project:'all',now,asks:[ask('1'),ask('2',{action:'reduce',percent:20})]});
 assert.equal(out.asksTotal,2);assert.deepEqual(out.asks.map(a=>[a.id,a.projectId,a.adAccountId,a.objectId,a.action,a.percent]),[['1','p1','acc1','c1','pause',null],['2','p1','acc1','c2','reduce',20]]);
 assert.deepEqual(Object.keys(out.asks[0]).sort(),['action','adAccountId','at','campaign','id','objectId','percent','projectId','projectName','ruleLabel']);
});
test('96 no request is published with the switch off, or once the campaign left Confirmar',()=>{
 assert.deepEqual(autonomyCompanion({base:deepBase('confirm',false),project:'all',now,asks:[ask('1')]}).asks,[]);
 assert.deepEqual(autonomyCompanion({base:deepBase('auto'),project:'all',now,asks:[ask('1')]}).asks,[]);
 assert.deepEqual(autonomyCompanion({base:deepBase('confirm',true,{'acc1:c1':{mode:'off',name:'x'}}),project:'all',now,asks:[ask('1')]}).asks,[]);
 assert.deepEqual(autonomyCompanion({base:deepBase('shadow',true,{'acc1:c1':{mode:'confirm',name:'x'}}),project:'all',now,asks:[ask('1')]}).asks.map(a=>a.id),['1'],'a campaign with its own Confirmar asks inside a Sombra project');
});
test('97 the notch block stays small: at most 5 requests, the total kept, broken entries skipped',()=>{
 const out=autonomyCompanion({base:deepBase('confirm'),project:'all',now,asks:[...Array.from({length:12},(_,i)=>ask(String(i))),null,{id:7},ask('x',{project:'outro'})]});
 assert.equal(out.asks.length,deepViewPolicy.companionAsks);assert.equal(out.asksTotal,12);assert.ok(JSON.stringify(out).length<=deepViewPolicy.companionMaxBytes);
});
test('98 the notch decodes the requests, alerts once per request, counts them and opens the order prefilled',()=>{
 const lossy=read('mac/BunkerNotch/Sources/BunkerNotch/SummaryLossy.swift'),store=read('mac/BunkerNotch/Sources/BunkerNotch/Store.swift'),views=read('mac/BunkerNotch/Sources/BunkerNotch/NotchViews.swift'),model=read('mac/BunkerNotch/Sources/BunkerNotch/Summary.swift');
 assert.match(lossy,/case v, at, enabled, projects, campaigns, island, asks, asksTotal/);assert.match(lossy,/extension Summary\.AutonomyAsk: Decodable/);
 assert.match(store,/for a in s\.autonomy\?\.asks \?\? \[\] where !seen\.contains\("ask:" \+ a\.id\)/);assert.match(store,/"Bunk pede sua confirmação"/);
 assert.match(store,/\(s\.autonomy\?\.asks \?\? \[\]\)\.map \{ "ask:" \+ \$0\.id \}/,'kept when the alert memory is trimmed: no second ring');
 assert.match(store,/s\.autonomy\?\.asksTotal \?\? s\.autonomy\?\.asks\.count \?\? 0/,'counted on the collapsed notch');
 assert.match(views,/SectionHeader\(title: "Bunk pede a você"/);assert.match(views,/AdjustTarget\(project: a\.projectId, adAccountId: a\.adAccountId, campaignId: a\.objectId, name: a\.campaign, preset: preset\)/);
 assert.match(model,/guard action == "increase" \|\| action == "reduce", let percent, OwnerAdjust\.validPercent\(action, percent\) else \{ return nil \}/,'an activation or a percent out of range opens nothing');
});
test('99 the executor keeps the request list in the Confirmar branch and never creates an order there',()=>{
 const src=read('worker/cloud-executor.ts'),branch=src.slice(src.indexOf("if(g.act==='confirm'){"),src.indexOf("const live=liveOrderRow("));
 assert.match(branch,/asks\.push\(autonomyAskEntry\(d,g,now\)\);continue;\}/);assert.doesNotMatch(branch,/recordAutonomyOrder|this\.write\(/);
 assert.match(src,/mergeAutonomyAsks\(await this\.ctx\.storage\.get<any\[\]>\('autonomyAsks'\)\|\|\[\],asks,evaluated\)/);
 assert.match(src,/acting:false\}\);await this\.ctx\.storage\.delete\('autonomyAsks'\);return;\}/,'no acting level: the list is cleared');
 assert.match(src,/asks:\(await this\.ctx\.storage\.get<any\[\]>\('autonomyAsks'\)\|\|\[\]\)\.slice\(0,40\)/,'the web reads it');assert.match(src,/asks:val\('autonomyAsks'\)\|\|\[\]/,'the notch block reads it');
});

/* ---------- 10. Level Automático: one order, and what happens when it never leaves ---------- */
const mrow=(o={})=>({id:'22222222-2222-4222-8222-222222222222',externalId:'120000000000000001',adAccountId:ACC,provider:'meta',name:decision().name,accountName:'Conta Um',budgetCurrency:'BRL',dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',accountStatus:{active:true},...o});
const liveAt=at=>({row:mrow(),fetchedAt:iso(at-60000)});
const order=(s,at=now,d=decision())=>recordAutonomyOrder(s,d,{live:liveAt(at),now:at});
test('100 Automático creates one approved exact order for the decision',()=>{
 const s=stateWith('auto'),out=order(s);assert.ok(out.proposal,JSON.stringify(out.blocked));
 assert.deepEqual([out.proposal.status,out.proposal.createdBy,out.proposal.payload.shadowId,out.proposal.payload.after.status],['Aprovada','bunk',decision().id,'PAUSED']);
 assert.match(autonomyGrant(s,decision(),{now:now+1000}).blockers.join(' '),/já virou ordem/);
});
test('101 an order still valid, reserved, sent, to verify, confirmed or applied always counts: never a second order',()=>{
 const s=stateWith('auto'),p=order(s).proposal,later=now+11*60000;
 assert.equal(unsentAutonomyOrder(s,p,now+60000),false,'still valid');
 for(const e of [{status:'Enviada',submittedAt:iso(now+1000)},{status:'Verificação necessária',submittedAt:iso(now+1000)},{status:'Confirmada'},{status:'Falhou',submittedAt:iso(now+1000)},{status:'Reservada',leaseUntil:iso(later+60000)},{status:'Preparada',leaseUntil:iso(later+60000)}]){
  s.executions=[{id:'e',proposalId:p.id,...e}];assert.equal(unsentAutonomyOrder(s,p,later),false,e.status);
  assert.match(autonomyGrant(s,decision(),{now:later}).blockers.join(' '),/já virou ordem/,e.status);
 }
 s.executions=[];p.execution={status:'Enviada',submittedAt:iso(now+1000)};assert.equal(unsentAutonomyOrder(s,p,later),false,'the copy on the proposal counts');
 delete p.execution;p.appliedAt=iso(now+2000);assert.equal(unsentAutonomyOrder(s,p,later),false,'applied');
});
test('102 an order that expired without ever being sent frees the decision (saving a permission no longer blocks the day)',()=>{
 const s=stateWith('auto'),p=order(s).proposal,later=now+11*60000;
 assert.equal(unsentAutonomyOrder(s,p,later),true);
 const g=autonomyGrant(s,decision(),{now:later});assert.deepEqual([g.act,g.blockers],['auto',[]]);
 const again=order(s,later);assert.ok(again.proposal,JSON.stringify(again.blocked));assert.notEqual(again.proposal.id,p.id);
});
test('103 an order that failed before any dispatch, with an expired lease, frees it too',()=>{
 const s=stateWith('auto'),p=order(s).proposal,later=now+11*60000;
 s.executions=[{id:'e1',proposalId:p.id,status:'Falhou'},{id:'e2',proposalId:p.id,status:'Reservada',leaseUntil:iso(now+60000)}];
 assert.equal(unsentAutonomyOrder(s,p,later),true);assert.equal(autonomyGrant(s,decision(),{now:later}).act,'auto');
});
test('104 unsent orders do not use the day\'s count or the 1h pause between orders',()=>{
 const s=stateWith('auto');order(s);order(s,now+11*60000);
 const other=decision({id:'outra-decisao',rule:'bad-day-reduce',action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:80,currency:'BRL'}});
 assert.deepEqual(autonomyGrant(s,other,{now:now+22*60000}).blockers,[],'2 unsent orders of a 2-a-day limit, 11 min ago');
});
test('105 a dispatched order still holds the count and the pause between orders',()=>{
 const s=stateWith('auto'),p=order(s).proposal;s.executions=[{id:'e',proposalId:p.id,status:'Confirmada',submittedAt:iso(now+1000)}];
 const other=decision({id:'outra',rule:'bad-day-reduce',action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:80,currency:'BRL'}});
 assert.match(autonomyGrant(s,other,{now:now+20*60000}).blockers.join(' '),/menos de 1h/);
});
test('106 after 3 orders that expired unsent the Bunk stops trying that decision for the day',()=>{
 const s=stateWith('auto');for(let i=0;i<autonomyLimits.maxUnsentRetries;i++)assert.ok(order(s,now+i*11*60000).proposal,'attempt '+i);
 const g=autonomyGrant(s,decision(),{now:now+autonomyLimits.maxUnsentRetries*11*60000});assert.equal(g.act,'none');assert.match(g.blockers.join(' '),/venceram sem envio hoje/);
});
test('107 read models without the executions list count every order, as before',()=>{
 const p={id:'x',expiresAt:iso(now-1000)};assert.equal(unsentAutonomyOrder({},p,now),false);assert.equal(unsentAutonomyOrder({executions:[]},{id:'x'},now),false,'no valid expiry');
 assert.equal(unsentAutonomyOrder({executions:[]},p,now),true);
});
test('108 saving any permission still voids an order that was not sent yet',()=>{
 const s=stateWith('auto'),p=order(s).proposal;assert.doesNotThrow(()=>assertAutonomyGrant(s,p));
 setAutonomyConfig(s,{enabled:true,projects:{[P1]:{mode:'auto',actions:actions({reduce:true}),limits:limits({maxReducePct:25,ordersPerDay:2}),campaigns:{}}}},'web:owner',now+60000);
 assert.throws(()=>assertAutonomyGrant(s,p),/Permissões da autonomia mudaram/);
});
test('109 switching off or leaving Automático voids the order as well',()=>{
 const s=stateWith('auto'),p=order(s).proposal;killAutonomy(s,'web:owner',now+1000);assert.throws(()=>assertAutonomyGrant(s,p),/desligada/);
 const s2=stateWith('auto'),p2=order(s2).proposal;s2.autonomy.projects[P1].campaigns[key('120000000000000001')]={mode:'confirm',name:'x'};
 assert.throws(()=>assertAutonomyGrant(s2,p2),/mudaram|fora do modo/);
});
test('110 week-old finished Bunk orders are pruned before a new one, and an unconfirmed dispatch is never removed',()=>{
 const s=stateWith('auto'),old=order(s,now-8*86400000).proposal,at2=now-8*86400000+3600000*2;
 const pending=recordAutonomyOrder(s,decision({id:'p2',objectId:'120000000000000002'}),{live:{row:mrow({id:'22222222-2222-4222-8222-222222222223',externalId:'120000000000000002'}),fetchedAt:iso(at2-60000)},now:at2});
 assert.equal(pending.blocked,undefined,JSON.stringify(pending.blocked));
 s.executions=[{id:'e1',proposalId:old.id,status:'Confirmada',submittedAt:iso(now-8*86400000)},{id:'e2',proposalId:pending.proposal.id,status:'Verificação necessária',submittedAt:iso(now-8*86400000)}];
 pruneDirectOrders(s,now);
 assert.deepEqual(s.proposals.map(p=>p.id),[pending.proposal.id]);assert.deepEqual(s.executions.map(e=>e.id),['e2']);
 const src=read('worker/cloud-executor.ts');assert.match(src,/pruneDirectOrders\(s,Date\.now\(\)\);\n\s*return recordAutonomyOrder\(s,d,\{live,now:Date\.now\(\),timezone\}\);/);
});
test('111 Desligado on one campaign holds it inside an Automático project; Automático on one campaign acts inside a Sombra project',()=>{
 const held=stateWith('auto',{campaigns:{[key('120000000000000001')]:{mode:'off',name:'x'}}});
 assert.equal(autonomyGrant(held,decision(),{now}).act,'none');assert.match(order(held).blocked.join(' '),/Desligado/);
 const own=stateWith('auto',{projectMode:'shadow',campaigns:{[key('120000000000000001')]:{mode:'auto',name:'x'}}});
 assert.equal(autonomyGrant(own,decision(),{now}).act,'auto');assert.ok(order(own).proposal);
});
test('112 a new campaign with no level of its own inherits the project (the reliable way to cover new uploads)',()=>{
 const s=stateWith('auto'),fresh=decision({id:'novo',objectId:'120000000000000777',name:'12/11 - [CBO] - [ALFA] - [TESTE] - NOVA'});
 assert.deepEqual([autonomyGrant(s,fresh,{now}).mode,autonomyGrant(s,fresh,{now}).act],['auto','auto']);
});

/* ---------- 11. End to end: a 12/11 test campaign from the reading to the order or the request ---------- */
const sm=(spend,o={})=>({spend,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:0,impressions:spend>0?1000:0,linkClicks:spend>0?20:0,...o});
const srow=(id,name,metrics,extra={})=>({id:'22222222-2222-4222-8222-22222222'+id,externalId:'12000000000000'+id,adAccountId:ACC,accountName:'Conta Um',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,...metrics,...extra});
function shadowState(today,mode,opts={}){
 const b={projectId:P1,projectName:'Alfa',level:'campaign',source:'Malva MCP',timezone:TZ,complete:true},cut=(period,from)=>({...b,period,from,to:'2026-11-12T03:00:00.000Z',fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows:[]});
 const s={config:{[P1]:{projectName:'Alfa'}},paused:false,proposals:[],executions:[],events:[],snapshots:[{...b,period:'today',from:'2026-11-12T03:00:00.000Z',to:'2026-11-13T03:00:00.000Z',fetchedAt:iso(now-300000),lastSyncAt:iso(now-480000),rows:today},cut('7d','2026-11-05T03:00:00.000Z'),cut('3d','2026-11-09T03:00:00.000Z'),cut('yesterday','2026-11-11T03:00:00.000Z')]};
 setAutonomyConfig(s,{enabled:opts.enabled!==false,projects:{[P1]:{mode,actions:actions(),limits:limits(),campaigns:opts.campaigns||{}}}},'web:owner',now-3600000);return s;
}
const params={pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:300};
const passOf=s=>evaluateShadow(s,{project:P1,params,now}).decisions.map(d=>({...d,id:JSON.stringify(['2026-11-12',d.rule,d.project,d.adAccountId,d.objectId,d.action])}));
const hot=srow('0001','12/11 - [CBO] - [ALFA] - [TESTE] - A',sm(130));
test('113 a 12/11 test with spend past the ceiling and no sale: the Sombra would pause it',()=>{
 const d=passOf(shadowState([hot],'shadow')).filter(x=>x.rule==='test-no-sale');
 assert.equal(d.length,1);assert.deepEqual([d[0].wouldExecute,d[0].blockedBy.length,d[0].after.status],[true,0,'PAUSED']);
});
test('114 …in Automático, with only Pausar on, that becomes one approved pause order',()=>{
 const s=shadowState([hot],'auto'),d=passOf(s).find(x=>x.rule==='test-no-sale'),g=autonomyGrant(s,d,{now});
 assert.deepEqual([g.act,g.action,g.blockers],['auto','pause',[]]);
 const out=recordAutonomyOrder(s,d,{live:{row:hot,fetchedAt:iso(now-60000)},now});assert.ok(out.proposal,JSON.stringify(out.blocked));
 assert.deepEqual([out.proposal.payload.action,out.proposal.payload.after.status,out.proposal.payload.objectId],['status','PAUSED',hot.externalId]);
});
test('115 …in Confirmar it becomes a request for the owner, with the same exact change, and no order',()=>{
 const s=shadowState([hot],'confirm'),d=passOf(s).find(x=>x.rule==='test-no-sale'),g=autonomyGrant(s,d,{now});
 assert.equal(g.act,'confirm');const a=autonomyAskEntry(d,g,now),open=openAsks({asks:mergeAutonomyAsks([],[a],[P1])},{enabled:true,now});
 assert.deepEqual([open.length,open[0].actionLabel,open[0].objectId,open[0].campaign],[1,'Pausar',hot.externalId,hot.name]);assert.equal(s.proposals.length,0);
});
test('116 …with the switch off there is no order and no request, in either level',()=>{
 for(const mode of ['auto','confirm']){const s=shadowState([hot],mode,{enabled:false}),d=passOf(s).find(x=>x.rule==='test-no-sale'),g=autonomyGrant(s,d,{now});assert.equal(g.act,'none',mode);assert.match(g.blockers.join(' '),/interruptor geral/);}
});
test('117 …in Sombra or Desligado nothing is asked or sent',()=>{
 for(const mode of ['shadow','off']){const s=shadowState([hot],mode),d=passOf(s).find(x=>x.rule==='test-no-sale');assert.equal(autonomyGrant(s,d,{now}).act,'none',mode);}
});
test('118 a test still under the ceiling gives no executable decision: the Bunk waits',()=>{
 const s=shadowState([srow('0002','12/11 - [CBO] - [ALFA] - [TESTE] - B',sm(40))],'auto');
 assert.equal(passOf(s).some(x=>x.rule==='test-no-sale'&&x.wouldExecute),false);
});
test('119 a test that already sold is not paused by the no-sale rule',()=>{
 const s=shadowState([srow('0003','12/11 - [CBO] - [ALFA] - [TESTE] - C',sm(400,{revenue:297,revenueNet:297,frontOrders:1,orders:1,checkouts:6}))],'auto');
 assert.equal(passOf(s).some(x=>x.rule==='test-no-sale'),false);
});
test('120 with Pausar off the same decision is held and the reason names the action',()=>{
 const s=shadowState([hot],'auto');s.autonomy.projects[P1].actions.pause=false;
 const g=autonomyGrant(s,passOf(s).find(x=>x.rule==='test-no-sale'),{now});assert.equal(g.act,'none');assert.match(g.blockers.join(' '),/Pausar não permitido/);
});
test('121 a scheduled 12/11 campaign that has not started yet gives no decision, and can already get its level',()=>{
 const later=srow('0004','12/11 - [CBO] - [ALFA] - [TESTE] - D',sm(0),{startAt:iso(now+3*3600000)});
 const s=shadowState([later],'shadow',{campaigns:{[campaignKey(ACC,later.externalId)]:{mode:'auto',name:later.name}}});
 assert.equal(passOf(s).some(x=>x.wouldExecute),false);assert.equal(effectiveMode(s.autonomy,P1,ACC,later.externalId),'auto');
 assert.equal(deliveryNote(later,{now,timezone:TZ}).kind,'scheduled');
});

/* ---------- 12. The screen itself ---------- */
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const bundled=await build({stdin:{contents:["export * as P from './app/autonomy/permissions.tsx';","export * as A from './app/autonomy/asks.tsx';","export * as I from './app/autonomy/island.tsx';"].join('\n'),resolveDir:root,loader:'tsx',sourcefile:'battery-entry.tsx'},
 absWorkingDir:root,bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},packages:'external',logLevel:'silent'});
const mod={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(mod,mod.exports,id=>require(id.startsWith('@/')?root+id.slice(2):id));
const {P,A,I}=mod.exports,React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const text=el=>renderToStaticMarkup(el).replace(/<!-- -->/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/\s+/g,' ');
const uiState=(mode,enabled,campaigns={})=>{const s={config:{[P1]:{projectName:'Alfa'}},paused:false,proposals:[],snapshots:[]};setAutonomyConfig(s,{enabled,projects:{[P1]:{mode,actions:actions(),limits:limits(),campaigns}}},'web:owner',now-1000);return s;};
const tab=(state)=>{const W=()=>{const ctl=P.useAutonomyDraft(state,async()=>true);return React.createElement(P.PermissionsTab,{ctl,state,saving:false,covered:()=>true,contexts:{}});};return text(React.createElement(W));};
test('122 the tab explains the three rules in plain words',()=>{
 const t=tab(uiState('shadow',false));
 for(const s of ['Você escolhe quanto o Bunk pode fazer','O nível do projeto vale para todas as campanhas de vendas dele, inclusive as que você subir depois.','Uma campanha com nível próprio passa por cima do nível do projeto.','Nada vale antes de salvar.'])assert.ok(t.includes(s),s);
 assert.doesNotMatch(t,/Prepara e avisa/);
});
test('123 each project shows whether its level is in force',()=>{
 assert.match(tab(uiState('auto',true)),/Valendo: age sozinho/);assert.match(tab(uiState('confirm',true)),/Valendo: pede a você/);
 assert.match(tab(uiState('auto',false)),/Automático parado/);assert.match(tab(uiState('confirm',false)),/Confirmar parado/);assert.match(tab(uiState('shadow',true)),/Só observa/);
});
test('124 the project line counts campaigns with their own level and those above the project',()=>{
 assert.match(tab(uiState('shadow',true,{[key('1')]:{mode:'auto',name:'A'},[key('2')]:{mode:'off',name:'B'}})),/2 campanhas com nível próprio \(1 acima do projeto\)/);
});
test('125 no draft: the save button is disabled and the bar says there is nothing to save',()=>{
 const W=()=>{const ctl=P.useAutonomyDraft(uiState('shadow',false),async()=>true);return React.createElement(P.PermissionsTab,{ctl,state:uiState('shadow',false),saving:false,covered:()=>true,contexts:{}});};
 const h=renderToStaticMarkup(React.createElement(W));assert.match(h,/<button[^>]*disabled=""[^>]*>[^<]*<svg[\s\S]*?Salvar permissões<\/button>/);assert.match(h,/Sem alterações para salvar\./);
});
test('126 "Aguardando você" lists each request with the change, the rule, the wait and how to execute; empty shows nothing',()=>{
 assert.equal(renderToStaticMarkup(React.createElement(A.AsksCard,{asks:[],showProject:false,onOpen(){}})),'');
 const asks=openAsks({asks:[autonomyAskEntry(decision(),{action:'pause',percent:null},now-5*60000),autonomyAskEntry(decision({id:'b',action:'budget',before:{dailyBudget:100,currency:'BRL'},after:{dailyBudget:80,currency:'BRL'}}),{action:'reduce',percent:20},now-60000)]},{enabled:true,now});
 const t=text(React.createElement(A.AsksCard,{asks,showProject:true,onOpen(){}}));
 for(const s of ['Aguardando você','2 pedidos do Bunk','nível Confirmar','O Bunk não envia estes pedidos','Touch ID','Pausar','Ativa → Pausada','Reduzir orçamento','R$ 100,00 → R$ 80,00','−20%','Teste sem venda','Alfa · há 5 min','Ver campanha'])assert.ok(t.includes(s),s+' :: '+t);
});
test('127 the island says that with the switch off Confirmar does not ask either',()=>{
 const ctl=(state)=>{let out;const W=()=>{out=P.useAutonomyDraft(state,async()=>true);return React.createElement(I.Island,{deep:null,deepError:null,ctl:out,saving:false,now,filter:'all',setFilter(){}});};return text(React.createElement(W));};
 assert.match(ctl(uiState('confirm',false)),/não envia nada e também não pede nada a você/);assert.match(ctl(uiState('confirm',false)),/Confirmar salvo \(parado\) em: Alfa/);
 assert.match(ctl(uiState('confirm',true)),/pede a você em “Aguardando você”/);assert.match(ctl(uiState('auto',true)),/Age sozinho em: Alfa/);
});
test('128 the campaign list never preselects a level and the old "começam Desligado" default is gone',()=>{
 const src=read('app/autonomy/permissions.tsx');
 assert.doesNotMatch(src,/começa[m]? Desligado/);assert.match(src,/<option value="">Escolher nível…<\/option>/);assert.match(src,/title=\{!n\?'Marque ao menos uma campanha\.':!level\?'Escolha o nível das campanhas marcadas\.':undefined\}/);
 assert.match(src,/<h3 className="ds-eyebrow">Campanhas com nível próprio<\/h3>/);assert.match(src,/pausadas ou fora da leitura de hoje/);assert.match(src,/<option value="follow">Seguir o projeto/);
});
test('129 the Sombra coverage list holds only projects it really evaluates (a disabled one no longer hides the warning)',()=>{
 const src=read('worker/cloud-executor.ts');
 assert.match(src,/if\(!base\|\|base\.enabled===false\)continue;/);assert.match(src,/covered\.push\(project\);batches\.push\(\[out\.decisions,out\.day\|\|fallbackDay,project,out\.skipped\|\|null\]\);/);assert.match(src,/days,projects:covered,evaluated:decisions\.length/);
});
test('130 the only owner writes of the whole tab are still the permissions save and the switch off',()=>{
 const all=['app/autonomy-panel.tsx',...fs.readdirSync(new URL('../app/autonomy/',import.meta.url)).filter(f=>f.endsWith('.tsx')).map(f=>'app/autonomy/'+f)].map(read).join('\n');
 assert.deepEqual([...new Set([...all.matchAll(/op:'([^']+)'/g)].map(m=>m[1]))].sort(),['autonomyConfig','autonomyKill']);assert.doesNotMatch(all,/method\s*:/);
 for(const m of all.matchAll(/fetch\(([^,)]+)/g))assert.match(m[1],/^[`'"]\/api\/autonomy/);
});
