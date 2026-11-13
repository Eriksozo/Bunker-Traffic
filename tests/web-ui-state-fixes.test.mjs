/* Web UI state fixes (presentation only): the Cards view resets per project, the Confirmar read keeps loading / failure /
 * last success apart, the report history keeps older pages on a refresh, the campaign name is a focusable button and the
 * Escritório asks for the exact confirmation before approving. TSX rendered in memory with esbuild + react-dom/server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {cardsViewFor,cardsViewKey} from '../lib/decision-cards-view.mjs';
import {asksView,autonomyRemoteBody,createRemoteReader,remoteReadError,remoteReadFailure,remoteReadInitial,remoteReadStart,remoteReadSuccess} from '../lib/autonomy-remote-read.mjs';
import {appendReportPage,mergeFirstReportPage,reportListEmpty} from '../lib/report-history-list.mjs';
import {proposalApprovalFreeze,proposalApprovalView,sameApprovalTarget} from '../lib/proposal-approval-view.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const bundled=await build({stdin:{contents:["export * as A from './app/autonomy/asks.tsx';","export * as Ap from './app/proposal-approval.tsx';"].join('\n'),resolveDir:root,loader:'tsx',sourcefile:'web-fixes-entry.tsx'},
 absWorkingDir:root,bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},packages:'external',logLevel:'silent'});
const mod={exports:{}};
new Function('module','exports','require',bundled.outputFiles[0].text)(mod,mod.exports,id=>require(id.startsWith('@/')?root+id.slice(2):id));
const {A,Ap}=mod.exports;
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const text=el=>renderToStaticMarkup(el).replace(/<!-- -->/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const noop=()=>{};

/* ---------- 1. Cards view per project ---------- */
test('cards view: A→B clears search, tab, filters and the history search',()=>{
 let v=cardsViewFor(null,{project:'A',initialSearch:'',initialTab:'cards'});
 v={...v,search:'ONLY_CAMPAIGN_A',tab:'history',actionFilter:'pause',statusFilter:'paused',historyQuery:'ONLY_CAMPAIGN_A'};
 const same=cardsViewFor(v,{project:'A',initialSearch:'',initialTab:'cards'});
 assert.equal(same,v,'same project keeps the owner\'s own search');
 const b=cardsViewFor(v,{project:'B',initialSearch:'',initialTab:'cards'});
 assert.deepEqual([b.search,b.tab,b.actionFilter,b.statusFilter,b.historyQuery],['','cards','all','all','']);
});
test('cards view: all projects → one client restarts the view',()=>{
 const all={...cardsViewFor(null,{project:'__all__'}),search:'x',tab:'learning'};
 const one=cardsViewFor(all,{project:'p-gabe'});
 assert.equal(one.search,'');assert.equal(one.tab,'cards');assert.notEqual(one.key,all.key);
});
test('cards view: a valid deep link opens with its search and tab, an invalid tab falls back',()=>{
 const d=cardsViewFor({...cardsViewFor(null,{project:'A'}),search:'old'},{project:'B',initialSearch:'120200001',initialTab:'history'});
 assert.deepEqual([d.search,d.tab,d.historyQuery],['120200001','history','120200001']);
 assert.equal(cardsViewFor(null,{project:'B',initialTab:'bogus'}).tab,'cards');
 assert.notEqual(cardsViewKey('B','1','cards'),cardsViewKey('B','1','history'));
});
test('cards view: the component derives search/tab/filters from the view and keys the history by it; approval freeze untouched',()=>{
 const src=read('app/decision-cards.tsx');
 assert.match(src,/const view=cardsViewFor\(storedView,viewContext\);if\(view!==storedView\)setView\(view\);/);
 assert.match(src,/<DecisionHistory key=\{view\.key\}[^>]*initialQuery=\{view\.historyQuery\}/);
 assert.doesNotMatch(src,/useState\(initialSearch\)|useState<'cards'\|'history'\|'learning'>\(initialTab\)/);
 assert.match(src,/approvalCard=approval&&cards\.find\(card=>card\.id===approval\.cardId&&card\.signature===approval\.signature\)/,'a card being confirmed stays pinned to its id and signature');
 assert.match(src,/localStorage\.getItem\('bunker\.decisionLayout'\)/,'layout preference kept');
});

/* ---------- 2. Confirmar requests read ---------- */
const ask={id:'a1',at:'2026-11-13T10:00:00Z',project:'p1',projectName:'Alfa',adAccountId:'acc',objectId:'c1',campaign:'Camp',action:'pause'};
test('Confirmar read: first fetch 500 is unavailable, never zero requests',()=>{
 const r=remoteReadFailure(remoteReadStart(remoteReadInitial()),remoteReadError({status:500}),1);
 const v=asksView(r,{enabled:true,now:2});
 assert.equal(v.status,'unavailable');assert.equal(v.asks,null);assert.match(r.error,/HTTP 500/);
 const t=text(React.createElement(A.AsksCard,{asks:v.asks,read:v,showProject:false,onOpen:noop}));
 assert.match(t,/pedidos indisponíveis/);assert.match(t,/número de pedidos é desconhecido/);assert.doesNotMatch(t,/\b0 pedidos?\b/);
});
test('Confirmar read: network error is unavailable; first load is loading, not empty',()=>{
 const r=remoteReadFailure(remoteReadInitial(),remoteReadError({network:true}),1);
 assert.equal(asksView(r,{enabled:true}).status,'unavailable');assert.equal(r.error,'Executor da nuvem indisponível.');
 const l=asksView(remoteReadInitial(),{enabled:true});assert.equal(l.status,'loading');assert.equal(l.asks,null);
 assert.match(text(React.createElement(A.AsksCard,{asks:null,read:l,showProject:false,onOpen:noop})),/Lendo os pedidos/);
 assert.equal(autonomyRemoteBody(null),null);assert.equal(autonomyRemoteBody([1]),null);
});
test('Confirmar read: success after failure shows the list; failure after success keeps it with the last success date',()=>{
 const t0=Date.parse('2026-11-13T10:05:00Z');
 let r=remoteReadFailure(remoteReadInitial(),'x',t0-1000);
 r=remoteReadSuccess(autonomyRemoteBody(goodBody({asks:[ask]})),t0);
 let v=asksView(r,{enabled:true,now:t0});assert.equal(v.status,'ok');assert.equal(v.stale,false);assert.deepEqual(v.asks.map(a=>a.id),['a1']);
 r=remoteReadFailure(remoteReadStart(r),remoteReadError({status:503}),t0+60000);
 assert.equal(r.data.asks.length,1,'a failure never wipes good data');assert.equal(r.lastSuccessAt,t0);
 v=asksView(r,{enabled:true,now:t0+60000});assert.equal(v.status,'ok');assert.equal(v.stale,true);assert.equal(v.lastSuccessAt,t0);
 const h=text(React.createElement(A.AsksCard,{asks:v.asks,read:v,showProject:false,onOpen:noop}));
 assert.match(h,/1 pedido do Bunk/);assert.match(h,/leitura de \d{2}\/\d{2}\/\d{4}/);
 const zero=asksView(remoteReadFailure(remoteReadSuccess(autonomyRemoteBody(goodBody()),t0),'falhou',t0+1),{enabled:true});
 assert.match(text(React.createElement(A.AsksCard,{asks:zero.asks,read:zero,showProject:false,onOpen:noop})),/nenhum pedido aberto na última leitura confirmada · leitura de/);
 assert.equal(asksView(r,{enabled:false}).status,'off','switch off asks nothing');
});
test('Confirmar read: the panel keeps the read separate, offers a reread and no longer drops non-OK responses',()=>{
 const src=read('app/autonomy-panel.tsx');
 assert.doesNotMatch(src,/r\.ok\?r\.json\(\):null/);assert.doesNotMatch(src,/\.catch\(\(\)=>\{\}\)/);
 assert.match(src,/Ler de novo/);assert.match(src,/loading=\{read\.loading&&!remote\}/);
 assert.match(src,/asksView\(read,/);
 // The panel reads through the single-flight reader with an abort signal; no per-poll sequence that discards slow answers.
 assert.match(src,/createRemoteReader\(\{request:signal=>fetch\('\/api\/autonomy',\{cache:'no-store',signal\}\)/);
 assert.doesNotMatch(src,/readSeq/);assert.match(src,/r\.dispose\(\)/);
});

/* ---------- 2b. Confirmar read: the executor's contract and the single-flight reader (review of 13/11) ---------- */
const goodBody=(extra={})=>({shadowProjects:null,shadowAt:null,status:null,log:[],asks:[],...extra});
test('Confirmar read: a malformed body is a failure that keeps the last good reading; asks absent is N/D, never zero',()=>{
 for(const bad of [{},{error:'unexpected'},{asks:'not-array'},{...goodBody(),asks:'not-array'},{...goodBody(),log:'x'},{log:[]},
  {...goodBody(),shadowProjects:'p'},{...goodBody(),status:'ok'},{...goodBody(),asks:[{}]},{...goodBody(),error:null}])
  assert.equal(autonomyRemoteBody(bad),null,JSON.stringify(bad));
 assert.deepEqual(autonomyRemoteBody(goodBody({asks:[ask]})).asks.map(a=>a.id),['a1']);
 assert.deepEqual(autonomyRemoteBody(goodBody({shadowProjects:['p1'],status:{ok:true}})).shadowProjects,['p1']);
 // Older executor without asks: valid log, but the requests count is unknown.
 const legacy=autonomyRemoteBody({shadowProjects:null,shadowAt:null,status:null,log:[]});
 assert.equal(legacy.asks,null);
 const v=asksView(remoteReadSuccess(legacy,1),{enabled:true,now:2});
 assert.equal(v.status,'unavailable');assert.equal(v.asks,null);assert.match(v.error,/não trouxe os pedidos/);
 assert.doesNotMatch(text(React.createElement(A.AsksCard,{asks:v.asks,read:v,showProject:false,onOpen:noop})),/\b0 pedidos?\b|nenhum pedido/);
});

/** Fake timers and a fetch whose answers the test releases by hand. */
function harness({timeoutMs=45000}={}){
 let clock=0,state=remoteReadInitial();const timers=new Map();let nextId=1;const calls=[];
 const fake={setTimeout:(fn,ms)=>{const id=nextId++;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>{timers.delete(id);}};
 const advance=async ms=>{clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}await new Promise(r=>setImmediate(r));};
 const request=signal=>new Promise((resolve,reject)=>{const call={signal,resolve,reject,aborted:false};signal.addEventListener('abort',()=>{call.aborted=true;reject(Object.assign(Error('aborted'),{name:'AbortError'}));});calls.push(call);});
 const reader=createRemoteReader({request,update:fn=>{state=fn(state);},now:()=>clock,timers:fake,timeoutMs});
 const respond=async(call,body,status=200)=>{call.resolve({ok:status>=200&&status<300,status,json:async()=>body});await new Promise(r=>setImmediate(r));};
 return {reader,calls,respond,advance,get state(){return state;},get clock(){return clock;},timers};
}
test('Confirmar reader: a valid answer at 31 s lands; the 30 s poll joins the attempt instead of starting another',async()=>{
 const h=harness();
 for(let round=0;round<3;round++){
  void h.reader.load();const call=h.calls.at(-1);
  await h.advance(30000);void h.reader.load(); // the poll fires while the answer is still on its way
  assert.equal(h.calls.length,round+1,'no overlapping request');
  await h.advance(1000);await h.respond(call,goodBody({asks:[ask]}));
  assert.equal(h.state.loading,false);assert.equal(h.state.error,null);assert.deepEqual(h.state.data.asks.map(a=>a.id),['a1']);
  assert.equal(h.state.lastSuccessAt,h.clock,'answered at 31 s, shown');
  assert.equal(h.timers.size,0,'timeout cleared');
 }
});
test('Confirmar reader: a hung request is aborted at the timeout, keeps the good reading, and the next load retries',async()=>{
 const h=harness();
 void h.reader.load();await h.respond(h.calls[0],goodBody({asks:[ask]}));const ok=h.state.lastSuccessAt;
 void h.reader.load();const hung=h.calls[1];
 await h.advance(45000);
 assert.equal(hung.aborted,true);assert.equal(h.reader.busy,false);
 assert.match(h.state.error,/passou de 45 s/);assert.equal(h.state.data.asks.length,1,'good reading kept');assert.equal(h.state.lastSuccessAt,ok);
 void h.reader.load();assert.equal(h.calls.length,3,'retry after the timeout');
 await h.respond(h.calls[2],goodBody());assert.equal(h.state.error,null);assert.deepEqual(h.state.data.asks,[]);
});
test('Confirmar reader: malformed 200, non-OK and network failures keep the last good reading; nothing lands after dispose',async()=>{
 const h=harness();
 void h.reader.load();await h.respond(h.calls[0],goodBody({asks:[ask]}));
 void h.reader.load();await h.respond(h.calls[1],{error:'unexpected'});
 assert.match(h.state.error,/formato inesperado/);assert.equal(h.state.data.asks.length,1);
 void h.reader.load();await h.respond(h.calls[2],{asks:'not-array'});assert.match(h.state.error,/formato inesperado/);
 void h.reader.load();await h.respond(h.calls[3],{},500);assert.match(h.state.error,/HTTP 500/);assert.equal(h.state.data.asks.length,1);
 void h.reader.load();h.calls[4].reject(Error('offline'));await new Promise(r=>setImmediate(r));
 assert.equal(h.state.error,'Executor da nuvem indisponível.');assert.equal(h.state.data.asks.length,1);
 void h.reader.load();const late=h.calls[5],before=h.state;h.reader.dispose();
 assert.equal(late.aborted,true);assert.equal(h.timers.size,0);
 await h.respond(late,goodBody());assert.equal(h.state,before,'no update after dispose');
});

/* ---------- 3. Report history ---------- */
const rep=i=>({id:'r'+String(i).padStart(3,'0'),project:'p1',createdAt:new Date(Date.UTC(2026,10,1)+i*3600000).toISOString(),title:'R'+i});
const page=(from,to,cursor)=>({items:Array.from({length:from-to+1},(_,k)=>rep(from-k)),nextCursor:cursor});
test('report history: a refresh with no new report keeps 40 items and the cursor',()=>{
 let l=mergeFirstReportPage(reportListEmpty(),'p1',page(60,41,'c20'));
 l=appendReportPage(l,'p1',page(40,21,'c40'));assert.equal(l.items.length,40);assert.equal(l.cursor,'c40');
 const r=mergeFirstReportPage(l,'p1',page(60,41,'c20'));
 assert.equal(r.items.length,40);assert.equal(r.cursor,'c40');assert.equal(r.added,0);
});
test('report history: a refresh with new reports merges by id, dedupes and signals them',()=>{
 let l=mergeFirstReportPage(reportListEmpty(),'p1',page(60,41,'c20'));l=appendReportPage(l,'p1',page(40,21,'c40'));
 const r=mergeFirstReportPage(l,'p1',page(62,43,'c20b'));
 assert.equal(r.added,2);assert.equal(r.items.length,42);assert.equal(new Set(r.items.map(x=>x.id)).size,42);
 assert.equal(r.items[0].id,'r062');assert.equal(r.items.at(-1).id,'r021');assert.equal(r.cursor,'c40');
 const again=appendReportPage(r,'p1',{items:[rep(21),rep(20)],nextCursor:null});assert.equal(again.items.filter(x=>x.id==='r021').length,1);
});
test('report history: project change starts again; a row gone from the first page range leaves; older pages stay',()=>{
 let l=mergeFirstReportPage(reportListEmpty(),'p1',page(60,41,'c20'));l=appendReportPage(l,'p1',page(40,21,'c40'));
 const other=mergeFirstReportPage(l,'p2',{items:[{...rep(1),project:'p2'}],nextCursor:null});
 assert.equal(other.items.length,1);assert.equal(other.cursor,null);
 assert.equal(appendReportPage(l,'p2',page(5,1,null)),l,'an older page of another project is ignored');
 const fresh=page(60,41,'c20');fresh.items=fresh.items.filter(x=>x.id!=='r050');fresh.items.push(rep(40));
 const r=mergeFirstReportPage(l,'p1',fresh);
 assert.ok(!r.items.some(x=>x.id==='r050'));assert.ok(r.items.some(x=>x.id==='r021'));assert.equal(r.cursor,'c40');
 const whole=mergeFirstReportPage(l,'p1',{items:[rep(60)],nextCursor:null});assert.deepEqual(whole.items.map(x=>x.id),['r060'],'no next page: the response is the whole history');
});
test('report history: the effect resets pagination only on a project change',()=>{
 const src=read('app/report-history.tsx');
 assert.match(src,/if\(loadedProject\.current!==project\)\{[^}]*setList\(reportListEmpty\(\)\);\}/);
 assert.match(src,/setList\(old=>mergeFirstReportPage\(old,project,d\)\)/);assert.doesNotMatch(src,/setItems\(d\.items\)/);
});

/* ---------- 4. Campaign name button ---------- */
test('campaign row: the name is a focusable button with keyboard focus style; the row click stays',()=>{
 const src=read('app/bunker.tsx');
 assert.match(src,/<tr key=\{c\.id\} onClick=\{\(\)=>setSelected\(c\)\} className="clickable">/);
 assert.match(src,/<button type="button" className="campaign-open" aria-label=\{'Analisar campanha '\+c\.row\.name[^}]*\} onClick=\{event=>\{event\.stopPropagation\(\);setSelected\(c\);\}\}>\{c\.row\.name\}<\/button>/);
 assert.match(read('app/malva-theme.css'),/\.campaign-open:focus-visible \{ outline:var\(--ds-focus-width\) solid var\(--ds-focus\)/);
});

/* ---------- 5. Escritório exact confirmation ---------- */
const proposal={id:'p-1',version:3,signature:'sig',status:'Aguardando aprovação',expiresAt:'2026-11-13T20:00:00Z',payload:{action:'budget',level:'campaign',objectId:'1202',objectName:'Camp X',accountName:'Conta Y',adAccountId:'act_9',provider:'meta',currency:'USD',before:{dailyBudget:100},after:{dailyBudget:80}}};
test('Escritório: the confirmation shows account, object, version, currency and before/after',()=>{
 const v=proposalApprovalView(proposal);
 assert.deepEqual([v.kind,v.currency,v.before,v.after,v.changePercent,v.version],['budget','USD',100,80,-20,3]);
 const t=text(React.createElement(Ap.ProposalApprovalSummary,{view:v}));
 for(const s of ['Camp X','Conta Y','act_9','1202','Versão 3','Moeda USD','Diário atual · USD','US$ 100,00','US$ 80,00','−20%'])assert.ok(t.includes(s),s);
 const st=proposalApprovalView({...proposal,payload:{...proposal.payload,action:'status',currency:undefined,before:{status:'ACTIVE'},after:{status:'PAUSED'}}});
 assert.match(text(React.createElement(Ap.ProposalApprovalSummary,{view:st})),/Ativo .* Pausado/);
 assert.equal(proposalApprovalView({...proposal,payload:{...proposal.payload,currency:'??'}}).currency,null,'never guessed');
});
test('Escritório: the confirmation is frozen to the version it was opened for',()=>{
 const f=proposalApprovalFreeze(proposal);
 assert.ok(sameApprovalTarget(f,proposal));
 assert.ok(!sameApprovalTarget(f,{...proposal,version:4}));assert.ok(!sameApprovalTarget(f,{...proposal,signature:'other'}));
 assert.ok(!sameApprovalTarget(f,{...proposal,payload:{...proposal.payload,after:{dailyBudget:50}}}));
 assert.ok(!sameApprovalTarget(proposalApprovalFreeze({...proposal,signature:undefined}),{...proposal,signature:undefined}),'unsigned never confirms');
});
test('Escritório: "Aprovar ajuste" opens the confirmation; only "Autorizar execução" calls the existing review',()=>{
 const src=read('app/collaboration-panel.tsx'),ui=read('app/proposal-approval.tsx');
 assert.match(src,/onClick=\{\(\)=>\{setChoice\(null\);setChanged\(false\);setFreeze\(approval\.freeze\);\}\}>/);
 assert.equal((src.match(/onReview\(proposal,'approve'/g)||[]).length,1);
 assert.match(src,/freeze&&freezeCurrent&&<ProposalApprovalDialog/);
 assert.match(ui,/disabled=\{!confirmed\|\|busy\|\|!canAuthorize\}/);assert.match(ui,/Confirmação da ação exata/);
 assert.match(src,/op:'proposalReview',id:proposal\.id,version:proposal\.version,signature:proposal\.signature,decision,comment,clientId/,'same backend call');
});
