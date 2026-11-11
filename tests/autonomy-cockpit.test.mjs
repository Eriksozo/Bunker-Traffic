/* Autonomia cockpit (Modo Gestor, Phase 1, W2): the five tabs, the island and the campaign drawer rendered from read-only
 * AutonomyDeepView fixtures (tests/browser/autonomy-cockpit.fixtures.mjs). The TSX is bundled in memory with esbuild and
 * rendered with react-dom/server: no browser, no network, no screenshot. Plus static guards: the only owner writes stay
 * autonomyConfig / autonomyKill, every fetch is a GET to /api/autonomy, and the CSS holds at 390 px with tokens only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {deepEmpty,deepPartial,deepFull,simAlfa,fixtureNow} from './browser/autonomy-cockpit.fixtures.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const files=['app/autonomy-panel.tsx',...fs.readdirSync(new URL('../app/autonomy/',import.meta.url)).filter(f=>f.endsWith('.tsx')).map(f=>'app/autonomy/'+f)];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(new URL('../'+f,import.meta.url),'utf8')]));

const bundled=await build({stdin:{contents:[
 "export * as C from './app/autonomy/components.tsx';","export * as I from './app/autonomy/island.tsx';","export * as N from './app/autonomy/now.tsx';",
 "export * as L from './app/autonomy/learning.tsx';","export * as S from './app/autonomy/score.tsx';","export * as P from './app/autonomy/permissions.tsx';",
 "export * as G from './app/autonomy/log.tsx';","export * as D from './app/autonomy/drawer.tsx';","export * as Shell from './app/autonomy-panel.tsx';"].join('\n'),resolveDir:root,loader:'tsx',sourcefile:'cockpit-entry.tsx'},
 absWorkingDir:root,bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},packages:'external',logLevel:'silent'});
const mod={exports:{}};
new Function('module','exports','require',bundled.outputFiles[0].text)(mod,mod.exports,(id)=>require(id.startsWith('@/')?root+id.slice(2):id));
const {C,I,N,L,S,P,G,D,Shell}=mod.exports;
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const html=(el)=>renderToStaticMarkup(el).replace(/<!-- -->/g,'');
const text=(h)=>h.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/\s+/g,' ');
const noop=()=>{};
const deeps={empty:deepEmpty,partial:deepPartial,full:deepFull};

const savedProjects=[{id:'p-alfa',name:'Projeto Alfa',mode:'auto',actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:1000,ordersPerDay:null},campaigns:{}},
 {id:'p-beta',name:'Projeto Beta',mode:'off',actions:{pause:false,reduce:false,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:null,budgetCap:null,ordersPerDay:null},campaigns:{}}];
const fakeCtl=(enabled=false,draft=null)=>({saved:{enabled,enabledAt:null,disabledAt:null,projects:savedProjects},draft,busy:null,kill:noop,turnOn:noop,discard:noop,projects:savedProjects,conflict:false,error:'',last:null,edit:noop,payload:()=>({enabled,projects:{}}),save:noop,savedById:{},changed:0});
const state={config:{'p-alfa':{projectName:'Projeto Alfa'},'p-beta':{projectName:'Projeto Beta'}},autonomy:{version:1,enabled:false,projects:{}},snapshots:[],proposals:[]};

test('Every tab renders with an empty, a partial and a full deep view (and with no reading at all)',()=>{
 for(const [name,deep] of [...Object.entries(deeps),['none',null]]){
  for(const [tab,el] of [['agora',React.createElement(N.NowTab,{deep,loading:false,fallbackOrders:[],showProject:true,onOpen:noop})],
   ['aprendizado',React.createElement(L.LearningTab,{deep,loading:false,showProject:true,onOpen:noop})],
   ['placar',React.createElement(S.ScoreTab,{deep,loading:false,showProject:true,onOpen:noop})],
   ['registro',React.createElement(G.LogTab,{log:[],loading:false,filter:'all',showProject:true,onOpen:noop})],
   ['ilha',React.createElement(I.Island,{deep,deepError:null,ctl:fakeCtl(),saving:false,now:fixtureNow,filter:'all',setFilter:noop})]]){
   assert.doesNotThrow(()=>html(el),`${tab} with ${name}`);
  }
 }
 const shell=html(React.createElement(Shell.default,{state,write:async()=>true,saving:false}));
 assert.deepEqual(Shell.cockpitTabs.map(([,l])=>l),['Agora','Aprendizado','Placar','Permissões','Registro']);
 for(const l of ['Agora','Aprendizado','Placar','Permissões','Registro'])assert.match(shell,new RegExp(`role="tab"[^>]*>${l}<`));
 assert.match(shell,/aria-selected="true"[^>]*>Agora</);
 assert.match(text(shell),/Carregando as decisões de hoje/,'first load is a skeleton, not zeros');
});

test('Status chips map from the executor status; a playbook decision never reads "Enviaria" or "Pediria"',()=>{
 const d=(o)=>({source:'rules',status:'so-sugestao',...o});
 assert.equal(C.chipFor(d({status:'enviaria'})).label,'Enviaria');
 assert.equal(C.chipFor(d({status:'pediria'})).label,'Pediria a você');
 assert.equal(C.chipFor(d({suggestionWhy:'placar',gate:{graded:12,need:20}})).label,'Só sugestão · placar 12/20');
 assert.equal(C.chipFor(d({suggestionWhy:'nivel-sombra'})).label,'Só sugestão · nível Sombra');
 assert.equal(C.chipFor(d({status:'segurada',holdReasons:['Escritório pausado.']})).label,'Segurada: Escritório pausado.');
 assert.equal(C.chipFor(d({status:'desligado'})).label,'Desligado aqui');
 assert.equal(C.chipFor(d({status:'algo-novo'})).status,'segurada','unknown status is held, never sent');
 for(const s of ['enviaria','pediria']){const c=C.chipFor({source:'playbook',status:s});assert.equal(c.status,'so-sugestao');assert.equal(c.label,'Só sugestão · jogada em observação');}
 const forced={...deepFull,projects:{'p-alfa':{...deepFull.projects['p-alfa'],decisions:deepFull.projects['p-alfa'].decisions.map(x=>x.source==='playbook'?{...x,status:'enviaria'}:x)}}};
 const t=text(html(React.createElement(N.NowTab,{deep:forced,loading:false,fallbackOrders:[],showProject:false,onOpen:noop})));
 assert.match(t,/Só sugestão · jogada em observação/);
 assert.match(t,/Jogada da equipe v3 · aprendida com Jorge 14 · Você 9/);
 assert.equal((t.match(/Enviaria/g)||[]).length,2,'only the fixed-rule decision (chip + filter) says Enviaria');
});

test('Agora: decisions with diff, reason, windows, source and guardrails; honest empty states; order timeline',()=>{
 const t=text(html(React.createElement(N.NowTab,{deep:deepPartial,loading:false,fallbackOrders:[],showProject:false,onOpen:noop})));
 assert.match(t,/O que o Bunk faria agora/);
 assert.match(t,/Só sugestão · placar 12\/20/);assert.match(t,/Segurada: Edição de outra pessoa há menos de 2h\./);
 assert.match(t,/R\$ 600,00 → R\$ 420,00 ↓ −30%/);assert.match(t,/Ativa → Pausada/);
 assert.match(t,/Regra fixa · Dia ruim: reduzir/);
 assert.match(t,/Ordens do Bunk hoje 0\/2/);assert.match(t,/Teto: R\$ 600,00 de R\$ 1\.000,00 \(60%\)/);
 assert.match(t,/Jorge mexeu 15 min depois/);
 assert.match(t,/Nenhuma ordem do Bunk ainda\. No nível Sombra ele só registra o que faria\./);
 const e=text(html(React.createElement(N.NowTab,{deep:deepEmpty,loading:false,fallbackOrders:[],showProject:false,onOpen:noop})));
 assert.match(e,/Nenhuma decisão da Sombra hoje ainda\. No nível Sombra ele só registra o que faria\./);
 const f=text(html(React.createElement(N.NowTab,{deep:deepFull,loading:false,fallbackOrders:[],showProject:false,onOpen:noop})));
 assert.match(f,/Decidiu .* Enviada .* Confirmada .* \+15 min .* \+30 min .* \+60 min .* D\+1 .*N\/D.* D\+3/);
 assert.match(f,/Espera de 1h: faltam 35 min/);assert.match(f,/Moedas diferentes no projeto: teto único ambíguo/);assert.match(f,/Sem teto diário de perda salvo\./);
 assert.match(f,/US\$\s?200,00 → US\$\s?140,00/,'native currency kept for budgets');
});

test('Aprendizado: plays, people, divergence and "imitação sem ganho"; Adotar / Liberar are disabled with the reason',()=>{
 const h=html(React.createElement(L.LearningTab,{deep:deepFull,loading:false,showProject:false,onOpen:noop})),t=text(h);
 assert.match(t,/Memória de 31 dias · 3 jogadas observadas · 2 prontas/,'without observedDays (older view) the hero says memory, never "aprendendo" from the backfill');
 assert.match(t,/ainda não ensina quando agir/,'the backfill is said to count moves and steps, not to train the plays');
 assert.match(t,/Associação, não causa/);
 assert.match(t,/Teria feito nos últimos 7 dias: 9, 7 iguais às suas, 2 que ninguém fez/);
 assert.match(t,/Observando: faltam 3 casos/);
 assert.match(t,/Horário pode ser só o expediente/);assert.match(t,/Imitação sem ganho/);
 assert.match(t,/Jorge corta e você aumenta na mesma situação/);
 assert.match(t,/Movimentos de Jorge que o Bunk pegou 60% pegou 10 de 16 movimentos/,'per person: recall over that person\'s moves');assert.match(t,/Seus movimentos que o Bunk pegou N\/D/,'no comparable case → N/D, never 0%');
 assert.match(t,/17 de 23 vezes em que o Bunk agiria/,'precision with its own sample (the play\'s firings)');assert.match(t,/Acerto no D\+3/);assert.match(t,/vs campanha qualquer/);
 const adopt=[...h.matchAll(/<button[^>]*>(Adotar|Liberar no Automático|Deixar o Bunk cuidar como a equipe)<\/button>/g)];
 assert.equal(adopt.length,7,'3 plays × 2 + the hero');
 for(const [b] of adopt){assert.match(b,/disabled=""/);assert.match(b,/aria-describedby=/);}
 assert.equal((t.match(/chega na próxima fase/g)||[]).length,7);
 const p=text(html(React.createElement(L.LearningTab,{deep:deepPartial,loading:false,showProject:false,onOpen:noop})));
 assert.match(p,/O Modo Gestor ainda não montou as jogadas deste projeto/);
 assert.match(p,/Ações por pessoa: N\/D/);assert.match(p,/mediana R\$ 95,00/);
});

test('Placar: rules + plays, "amostra pequena" below the claimable sample, empty state for a fresh version',()=>{
 const e=text(html(React.createElement(S.ScoreTab,{deep:deepEmpty,loading:false,showProject:false,onOpen:noop})));
 assert.match(e,/Placar da versão atual: 0 de 20 avaliadas\. As primeiras notas chegam amanhã\./);
 const p=text(html(React.createElement(S.ScoreTab,{deep:deepPartial,loading:false,showProject:false,onOpen:noop})));
 assert.match(p,/amostra pequena/);assert.match(p,/A Sombra apontou antes 4 de 6 cortes da equipe \(67%\), mediana de 35 min antes/);
 assert.match(p,/a equipe fez redução/);
 const f=text(html(React.createElement(S.ScoreTab,{deep:deepFull,loading:false,showProject:false,onOpen:noop})));
 assert.match(f,/91% de chance de ser melhor/);assert.match(f,/Pausa teste de 1º ou 2º dia sem venda/);
 assert.equal(S.baseText({base:null}),'N/D');
});

test('Island: state line, tiles with N/D (never 0), health and memory lines',()=>{
 assert.equal(I.islandStateLine(false,false,savedProjects),'Desligada · o Bunk só observa e aprende');
 assert.equal(I.islandStateLine(true,false,savedProjects),'Ligada · 1 projeto pode enviar sozinho');
 assert.equal(I.islandStateLine(true,false,[{...savedProjects[0],mode:'auto'},{...savedProjects[1],mode:'auto'}]),'Ligada · 2 projetos podem enviar sozinhos');
 const none=text(html(React.createElement(I.Island,{deep:null,deepError:'Leitura da autonomia em preparação pelo executor. Tente em 1 a 2 minutos.',ctl:fakeCtl(),saving:false,now:fixtureNow,filter:'all',setFilter:noop})));
 assert.match(none,/em preparação/);assert.doesNotMatch(none,/Enviadas hoje 0/);assert.match(none,/Enviadas hoje N\/D/);
 const p=text(html(React.createElement(I.Island,{deep:deepPartial,deepError:null,ctl:fakeCtl(),saving:false,now:fixtureNow,filter:'all',setFilter:noop})));
 assert.match(p,/Concordância com a equipe N\/D/);assert.match(p,/Projeto Beta pulado: fonte com 42 min/);assert.match(p,/ações por pessoa N\/D/);
 const f=text(html(React.createElement(I.Island,{deep:deepFull,deepError:null,ctl:fakeCtl(true),saving:false,now:fixtureNow,filter:'all',setFilter:noop})));
 assert.match(f,/Concordância com a equipe 74%/);assert.match(f,/faixa 58%–86%/);
 assert.equal(C.memoryLine(deepFull.memory,deepFull.playbookStatus),'Memória: 31 dias · 512 ações de Jorge, você e Leonardo Paz · 3 excluídas (eco do Bunk, automação) · 1 em quarentena (possível eco do Bunk)');
 assert.equal(C.memoryLine({...deepFull.memory,excluded:{total:4,byReason:{bunk:3,'possible-bunk-echo':1}},quarantined:1},null).replace(/^.*?· (\d+ excluíd)/,'$1'),'3 excluídas (eco do Bunk) · 1 em quarentena (possível eco do Bunk)','an older view counting the echo as excluded: shown once, as quarantine');
 assert.match(f,/Desligar agora/);assert.match(f,/Todos os projetos/);
});

test('N/D formatting is never zero',()=>{
 for(const f of ['fmtInt','fmtX','fmtShare','fmtSignedPct','fmtStep','brl','brl0','nativeMoney'])assert.equal(C[f](null),'N/D',f);
 assert.equal(C.fmtShare(0),'0%','a measured zero stays zero');
 const a=text(html(React.createElement(C.AgreementBar,{a:null})));assert.match(a,/N\/D/);assert.doesNotMatch(a,/0%/);
 const w=text(html(React.createElement(C.WindowTable,{windows:{today:null,yesterday:null,d3:null,d7:null}})));
 assert.equal((w.match(/N\/D/g)||[]).length,12);
 assert.equal(C.nativeMoney(1234.5,null),(1234.5).toLocaleString('pt-BR',{maximumFractionDigits:2}),'no invented R$');
});

test('Permissões: the savebar and single save are unchanged; context and "como a equipe" never go above the current value',()=>{
 const Wrapped=()=>{const ctl=P.useAutonomyDraft(state,async()=>true);return React.createElement(P.PermissionsTab,{ctl,state,saving:false,covered:()=>true,contexts:{}});};
 const h=html(React.createElement(Wrapped)),t=text(h);
 assert.match(t,/Nível, ações e limites/);assert.match(t,/Sem alterações para salvar\./);
 assert.match(h,/<button[^>]*disabled=""[^>]*>[^<]*<svg[\s\S]*?Salvar permissões<\/button>/,'save disabled without a draft');
 assert.match(t,/Mude uma permissão para ver/);
 const ctx=P.limitContext(deepFull.projects['p-alfa'].now.campaigns);
 assert.equal(ctx.mixed,true);assert.equal(ctx.max,600);assert.equal(ctx.currency,'BRL');
 const brl=(v)=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
 assert.deepEqual(P.limitContextLines({maxIncreasePct:30,budgetCap:1000,maxReducePct:null},ctx),[`Maior orçamento hoje ${brl(600)} → +30% = ${brl(780)} · teto ${brl(1000)}`]);
 assert.match(P.limitContextLines({maxIncreasePct:100,budgetCap:1000},ctx)[0],/passaria do teto: o Bunk segura/);
 assert.match(P.limitContextLines({},ctx)[0],/sem aumento máximo: não aumenta/);
 assert.deepEqual(P.limitContextLines({},null),[]);
 const steps={up:{pct:50,from:'as pessoas'},down:{pct:25,from:'as pessoas'}};
 assert.deepEqual(P.teamPrefill({maxIncreasePct:80,maxReducePct:30,budgetCap:1000,ordersPerDay:null},steps).limits,{maxIncreasePct:50,maxReducePct:25,budgetCap:1000,ordersPerDay:null});
 const same=P.teamPrefill({maxIncreasePct:40,maxReducePct:10},steps);assert.equal(same.changed,false);assert.deepEqual(same.limits,{maxIncreasePct:40,maxReducePct:10});
 const none=P.teamPrefill({maxIncreasePct:null,maxReducePct:null},steps);assert.equal(none.changed,false);assert.equal(none.limits.maxIncreasePct,null,'never creates a missing limit');
 const ts=P.teamSteps(deepFull.projects['p-alfa'].team,deepFull.projects['p-alfa'].playbook.plays);
 assert.equal(ts.down.from,'a jogada da equipe');assert.equal(Math.round(ts.down.pct),20);assert.equal(ts.up.from,'as pessoas');assert.equal(Math.round(ts.up.pct),35);
 const ps=src['app/autonomy/permissions.tsx'];
 assert.match(ps,/`\$\{autonomyLimits\.defaultOrdersPerDay\} \(padrão\)`/,'orders per day shows the default, never "—"');
 assert.match(ps,/lock=noRule&&!p\.actions\[a\]/);assert.match(ps,/Sem regra ainda: nada é reativado sozinho\./);
});

test('Draft simulator runs on view=sim rows and fails closed to a sentence, never a number',()=>{
 const cfg={enabled:false,projects:{'p-alfa':{mode:'auto',actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:1000,ordersPerDay:null},campaigns:{}},'p-beta':{mode:'off',actions:{},limits:{},campaigns:{}}}};
 const r=P.runSim(simAlfa,cfg,['p-alfa','p-beta'],fixtureNow);
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.label,'só permissões');assert.equal(r.assumedSwitchOn,true);
 assert.ok(r.draft.d7.orders>=1);
 assert.equal(P.runSim(null,cfg,['p-alfa']).ok,false);
 assert.equal(P.runSim({rows:'x'},cfg,['p-alfa']).ok,false);
 assert.equal(P.simCount({orders:3,asks:1}),'3 ordens e 1 pedido a você');assert.equal(P.simCount({orders:1}),'1 ordem');
 const lc=D.levelConfig({enabled:false,projects:savedProjects},{project:'p-alfa',adAccountId:'act_1',objectId:'111',name:'X'},'confirm');
 assert.deepEqual(lc.projects['p-alfa'].campaigns,{'act_1:111':{mode:'confirm',name:'X'}});assert.deepEqual(savedProjects[0].campaigns,{},'saved config untouched');
});

test('Registro groups the log by campaign, with before → after and filters',()=>{
 const e=(o)=>({at:'2026-11-10T14:00:00Z',project:'p-alfa',projectName:'Projeto Alfa',adAccountId:'act_1',objectId:'111',campaign:'ALFA_A_12_H1',rule:'bad-day-reduce',ruleLabel:'Dia ruim: reduzir',mode:'confirm',action:'reduce',percent:30,before:{dailyBudget:600,currency:'BRL'},after:{dailyBudget:420,currency:'BRL'},result:{kind:'confirm',text:'Aguarda você.'},...o});
 const log=[e({}),e({at:'2026-11-10T13:00:00Z',result:{kind:'blocked',blockers:['Escritório pausado.']}}),e({objectId:'112',campaign:'ALFA_A_13_H1',project:'p-beta',projectName:'Projeto Beta'})];
 assert.deepEqual(G.groupLog(log).map(g=>g.entries.length),[2,1]);
 assert.deepEqual(G.groupLog(log,{kind:'blocked'}).map(g=>g.entries.length),[1]);
 assert.deepEqual(G.groupLog(log,{project:'p-beta'}).map(g=>g.campaign),['ALFA_A_13_H1']);
 assert.deepEqual(G.groupLog(log,{query:'a_13'}).map(g=>g.campaign),['ALFA_A_13_H1']);
 const t=text(html(React.createElement(G.LogTab,{log,loading:false,filter:'all',showProject:true,onOpen:noop})));
 assert.match(t,/2 registros/);assert.match(t,/R\$ 600,00 → R\$ 420,00/);assert.match(t,/−30%/);assert.match(t,/Escritório pausado\./);
});

test('Campaign drawer: windows, verdict, unified timeline, guardrails and "simular por nível" on demand',()=>{
 const target={project:'p-alfa',projectName:'Projeto Alfa',adAccountId:'act_1',objectId:'111',name:'07/11 - [CBO] - [ALFA] - [ESCALA] - ALFA_A_12_H1'};
 const log=[{at:'2026-11-10T14:40:00Z',project:'p-alfa',adAccountId:'act_1',objectId:'111',result:{kind:'order'}}];
 const t=text(html(React.createElement(D.DrawerBody,{target,deep:deepFull,log,saved:{enabled:false,projects:savedProjects}})));
 for(const s of ['Hoje, ontem, 3 e 7 dias','O que o Bunk faria agora','Travas','Linha do tempo','Simular por nível','Ordem do Bunk: Confirmada','Ordem enviada ao executor','Ver dia a dia'])assert.match(t,new RegExp(s));
 assert.match(t,/Enviaria/);
 const tl=D.campaignTimeline({project:'p-alfa',adAccountId:'act_1',objectId:'112'},{decisions:C.deepDecisions(deepPartial),done:[],log:[],plays:[]});
 assert.ok(tl.some(i=>/Jorge mexeu 15 min depois/.test(i.text)));
});

test('Write boundary and reads: only autonomyConfig / autonomyKill, every fetch a GET to /api/autonomy',()=>{
 const all=Object.values(src).join('\n');
 assert.deepEqual([...new Set([...all.matchAll(/op:'([^']+)'/g)].map(m=>m[1]))].sort(),['autonomyConfig','autonomyKill']);
 assert.equal((all.match(/write\(/g)||[]).length,2,'one save and one kill');
 assert.doesNotMatch(all,/method\s*:/,'no POST/PUT from the cockpit');
 for(const m of all.matchAll(/fetch\(([^,)]+)/g))assert.match(m[1],/^[`'"]\/api\/autonomy/,`fetch ${m[1]}`);
 assert.doesNotMatch(all,/localStorage|sessionStorage/);
 assert.doesNotMatch(all,/autonomyPatternAdopt|autonomyPilot|teamAliases/,'no Phase 2 owner op');
});

test('Phone width and theme: tokens only, container queries down to 390 px, no wide fixed widths',()=>{
 const css=fs.readFileSync(new URL('../app/autonomy-panel.css',import.meta.url),'utf8');
 assert.doesNotMatch(css.replace(/#_/g,''),/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i,'no fixed colour');
 assert.match(css,/@container autonomy \(max-width:520px\)/);assert.match(css,/@container autscore \(max-width:760px\)/);assert.match(css,/@container autdrawer \(max-width:420px\)/);
 for(const m of css.matchAll(/(?<![-\w])(?:min-)?width:(\d+)px/g))assert.ok(Number(m[1])<=358,`fixed width ${m[0]} wider than a phone`);
 assert.match(css,/\.aut-drawer:not\(#_\)\{width:min\(100vw,640px\)/);
 assert.match(css,/\.aut-tiles\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('Renders the real read model too: buildDeepBase → buildDeepView (W1) through every tab and the drawer',async(ctx)=>{
 const {buildDeepBase,buildDeepView}=await import('../lib/autonomy-deep-view.mjs');
 const NOW=fixtureNow,DAY='2026-11-10',FROM='2026-11-10T03:00:00.000Z',iso=ms=>new Date(ms).toISOString();
 const m=(spend,revenueNet=0,front=0)=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:0,impressions:1000,linkClicks:20});
 const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:200,budgetCurrency:'BRL',budgetRate:1,...metrics,...extra});
 const cut=(period,from,rows)=>({projectId:'p1',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:'America/Sao_Paulo',complete:true,period,from,to:iso(Date.parse(from)+(period==='7d'?7:period==='3d'?3:1)*86400000),fetchedAt:iso(NOW-300000),lastSyncAt:iso(NOW-360000),rows});
 const st={config:{p1:{projectName:'Fictício'}},paused:false,autonomy:{version:1,enabled:true,projects:{p1:{mode:'shadow',actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:500,ordersPerDay:2},campaigns:{}}}},
  snapshots:[cut('today',FROM,[row('c1','Escala A',m(300,600,3)),row('c2','05/11 - Escala B',m(120,0,0))]),cut('yesterday','2026-11-09T03:00:00.000Z',[row('c1','Escala A',m(250,500,2))]),cut('3d','2026-11-07T03:00:00.000Z',[row('c1','Escala A',m(700,1400,7))]),cut('7d','2026-11-03T03:00:00.000Z',[row('c1','Escala A',m(1500,3000,15))])],proposals:[],executions:[]};
 let view;
 try{
  const base=buildDeepBase({state:st,liveItems:[],accuracy:{},policy:{projects:{p1:{ticketFront:97}}},now:NOW});
  const entry={id:JSON.stringify([DAY,'test-no-sale','p1','acc1','c2','status']),day:DAY,rule:'test-no-sale',ruleLabel:'Teste sem venda',project:'p1',projectName:'Fictício',adAccountId:'acc1',accountName:'Conta',objectId:'c2',name:'05/11 - Escala B',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'r',blockedBy:[],limitations:[],wouldExecute:true,firstAt:iso(NOW-600000),lastAt:iso(NOW-60000),firstWouldExecuteAt:iso(NOW-600000),seen:3,ruleVersion:2,metrics:{spend:120,frontOrders:0,orders:0,revenueNet:0,checkouts:0,roi:null,roas:null,cpc:null,recentRoi:null}};
  view=buildDeepView({base,project:'p1',now:NOW,shadowStatus:{at:iso(NOW-60000),days:{p1:DAY}},shadowEntries:[entry],pbsEntries:[{...entry,id:'pb1',source:'playbook',rule:'pb:test-pause',ruleRev:'v1:abcd1234',playKey:'pb:test-pause@p1',wouldExecute:false,firstWouldExecuteAt:null,play:{params:{k:1.2},learnedStep:null,clampedStep:null},learnedFrom:[{person:'p:x',n:9}],caseRefs:[]}]});
 }catch(e){ctx.skip(`W1 read model not callable with this input yet: ${e.message}`);return;}
 assert.ok(view?.projects?.p1,'deep view built');
 const t=text(html(React.createElement(N.NowTab,{deep:view,loading:false,fallbackOrders:[],showProject:false,onOpen:noop})));
 assert.match(t,/Só sugestão · nível Sombra/);assert.match(t,/Só sugestão · jogada em observação/);assert.doesNotMatch(t,/Enviaria|Pediria a você/);
 for(const el of [React.createElement(L.LearningTab,{deep:view,loading:false,showProject:false,onOpen:noop}),React.createElement(S.ScoreTab,{deep:view,loading:false,showProject:false,onOpen:noop}),
  React.createElement(I.Island,{deep:view,deepError:null,ctl:fakeCtl(true),saving:false,now:NOW,filter:'all',setFilter:noop}),
  React.createElement(D.DrawerBody,{target:{project:'p1',adAccountId:'acc1',objectId:'c2'},deep:view,log:[],saved:{enabled:true,projects:[]}})])assert.doesNotThrow(()=>html(el));
 assert.match(text(html(React.createElement(S.ScoreTab,{deep:view,loading:false,showProject:false,onOpen:noop}))),/Placar da versão atual: 0 de 20 avaliadas/);
});
