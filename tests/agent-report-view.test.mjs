import test from 'node:test';
import assert from 'node:assert/strict';
import {agentReportView} from '../lib/agent-report-view.mjs';
import {fingerprint} from '../lib/collaboration.mjs';

const now=Date.parse('2026-11-02T20:00:00.000Z'),stamp=n=>new Date(n).toISOString();
const summary={decision:'Revisar o conjunto sem vendas.',reason:'A perda está concentrada nessa instância.',nextStep:'Conferir a proposta exata antes de aprovar.'};
function row(extra={}){return {level:'campaign',externalId:'same-id',adAccountId:'account-a',name:'Campanha A',accountName:'Conta A',spend:100,revenue:250,revenueNet:200,adCosts:5,productCost:0,saleTax:0,frontOrders:3,orders:4,checkouts:8,impressions:1000,linkClicks:20,refundedRevenue:0,...extra};}
function fixture(){
 const snapshots=['3d','today'].map((period,i)=>({projectId:'project-a',period,level:'campaign',fetchedAt:stamp(now-10000+i*1000),source:'Malva MCP',complete:true,rows:[row({spend:i?20:100,revenueNet:i?40:200,frontOrders:i?1:3})]}));
 const message={id:'opinion-a',project:'project-a',roundId:'round-a',fromAgent:'traffic',kind:'conclusion',text:'Texto técnico original: manter, pausar ou aumentar depende do contexto.\nFonte /private/tmp/source.json; hash v1-original.',evidenceRefs:snapshots.map(s=>({period:s.period,level:s.level,adAccountId:'account-a',externalId:'same-id',fetchedAt:s.fetchedAt}))};
 return {state:{snapshots,proposals:[]},message};
}
function proposal(extra={}){return {id:'proposal-a',project:'project-a',roundId:'round-a',status:'Aguardando aprovação',createdAt:stamp(now-1000),expiresAt:stamp(now+60000),payload:{level:'campaign',action:'budget',objectId:'same-id',adAccountId:'account-a',objectName:'Campanha A',accountName:'Conta A',currency:'USD',before:{dailyBudget:100},after:{dailyBudget:150},reason:'Vendeu novamente após o último ajuste.',opinionRefs:['opinion-a']},...extra};}

test('Authored summaries are normalized without modifying original messages or sources',()=>{
 const {state,message}=fixture();message.summary={decision:' d ',reason:' r ',nextStep:' n '};
 const before=structuredClone({state,message}),view=agentReportView(state,message,[],now);
 assert.deepEqual(view.summary,{decision:'d',reason:'r',nextStep:'n'});assert.equal(view.plain,null);
 assert.deepEqual({state,message},before);assert.equal(view.proposals.length,0);
});

test('Missing or malformed legacy summaries do not infer keep, pause, approval or application from free text',()=>{
 for(const text of ['Manter todas.','PAUSAR agora.','Aumentei100% e apliquei.','Aprovada. Execução confirmada.'])for(const invalid of [undefined,null,[],{decision:'Pausar'}]){
  const {state,message}=fixture();message.text=text;message.summary=invalid;
  const view=agentReportView(state,message,[],now);
  assert.equal(view.summary.decision,'Análise registrada');assert.equal(view.summary.reason,'Não há ajuste proposto vinculado a este parecer.');
  assert.deepEqual(view.proposals,[]);assert.equal(view.plain,null);assert.equal(Object.hasOwn(view,'command'),false);
 }
});

test('Only structured proposals linked to this opinion, project and round appear; duplicates stay single',()=>{
 const {state,message}=fixture(),valid=proposal();
 state.proposals=[proposal({id:'foreign-project',project:'project-b'}),proposal({id:'foreign-round',roundId:'round-b'}),proposal({id:'unlinked',payload:{...valid.payload,opinionRefs:['another-opinion']}}),valid];
 const extra=[valid,proposal({id:'extra-valid'}),proposal({id:'extra-foreign',project:'project-b'})];
 const view=agentReportView(state,message,extra,now);
 assert.deepEqual(view.proposals.map(p=>p.id),['proposal-a','extra-valid']);assert.equal(view.summary.decision,'A equipe sugeriu 2 ajustes');
});

test('OPS may summarize its own round proposals without receiving opinion linkage from another project or round',()=>{
 const {state,message}=fixture();message.fromAgent='ops';
 const own=proposal({payload:{...proposal().payload,opinionRefs:['traffic','creative','budget']}});
 state.proposals=[own,proposal({id:'other-round',roundId:'round-b'}),proposal({id:'other-project',project:'project-b'})];
 assert.deepEqual(agentReportView(state,message,[],now).proposals.map(p=>p.id),['proposal-a']);
 delete message.roundId;assert.deepEqual(agentReportView(state,message,[],now).proposals,[]);
});

test('Action and native before/after values come from the proposal, not its free-text reason',()=>{
 const {state,message}=fixture(),p=proposal();p.payload.reason='Manter sem alterações.';state.proposals=[p];
 let view=agentReportView(state,message,[],now);assert.equal(view.summary.decision,'Aumentar orçamento');assert.deepEqual(view.proposals[0].before,{dailyBudget:100});assert.equal(view.proposals[0].currency,'USD');
 p.payload={...p.payload,action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'},reason:'Aumentar por causa do histórico.'};
 view=agentReportView(state,message,[],now);assert.equal(view.summary.decision,'Pausar');assert.equal(view.proposals[0].after.status,'PAUSED');
});

test('Approved proposals remain approval records rather than confirmed external application',()=>{
 const {state,message}=fixture();state.proposals=[proposal({status:'Aprovada'})];
 const view=agentReportView(state,message,[],now);
 assert.equal(view.proposals[0].status,'Aprovada');assert.match(view.summary.nextStep,/Aprovação registrada/);assert.match(view.summary.nextStep,/Confira a aplicação/);
 assert.doesNotMatch(view.summary.nextStep,/Aplicada e conferida/);assert.equal(view.proposals[0].externalApplied,undefined);
 assert.equal(state.executions,undefined);
});

test('Expired, refused, replaced or requested-revision proposals direct readers to a current analysis',()=>{
 for(const status of ['Fonte substituída','Expirada','Recusada','Revisão solicitada']){
  const {state,message}=fixture();state.proposals=[proposal({status})];assert.equal(agentReportView(state,message,[],now).summary.nextStep,'Consulte uma análise atual antes de decidir.');
 }
 const {state,message}=fixture();state.proposals=[proposal({expiresAt:stamp(now-1)})];assert.equal(agentReportView(state,message,[],now).summary.nextStep,'Consulte uma análise atual antes de decidir.');
});

test('Figures preserve individual windows and hierarchy levels instead of summing them',()=>{
 const {state,message}=fixture();
 state.snapshots.push({projectId:'project-a',period:'3d',level:'adset',fetchedAt:stamp(now-8000),source:'Malva MCP',complete:true,rows:[row({level:'adset',name:'Conjunto A',spend:9000})]});
 message.evidenceRefs.push({period:'3d',level:'adset',adAccountId:'account-a',externalId:'same-id',fetchedAt:stamp(now-8000)});
 const view=agentReportView(state,message,[],now);assert.equal(view.facts.length,1);
 const windows=view.facts[0].windows;assert.deepEqual(windows.map(w=>w.period),['3d','today']);assert.deepEqual(windows.map(w=>w.metrics.spend),[100,20]);assert.deepEqual(windows.map(w=>w.metrics.frontOrders),[3,1]);
 assert.deepEqual(windows.map(w=>w.metrics.roas),[2,2]);
});

test('A child proposal uses only that child evidence even when the same campaign ID exists in another level',()=>{
 const {state,message}=fixture();const fetchedAt=stamp(now-8000);
 state.snapshots.push({projectId:'project-a',period:'today',level:'adset',fetchedAt,source:'Malva MCP',complete:true,rows:[row({level:'adset',name:'Conjunto de teste',spend:7,frontOrders:0,revenueNet:0})]});
 message.evidenceRefs.push({period:'today',level:'adset',adAccountId:'account-a',externalId:'same-id',fetchedAt});
 state.proposals=[proposal({payload:{...proposal().payload,level:'adset',objectName:'Conjunto de teste'}})];
 const view=agentReportView(state,message,[],now);assert.equal(view.facts.length,1);assert.equal(view.facts[0].name,'Conjunto de teste');
 assert.equal(view.facts[0].windows[0].metrics,null);assert.equal(view.facts[0].windows[1].metrics.spend,7);
});

test('Evidence never borrows another account, project, period, level or refreshed timestamp',()=>{
 const mutations=[
  f=>{f.state.snapshots[1].projectId='project-b';},f=>{f.state.snapshots[1].rows[0].adAccountId='account-b';},
  f=>{f.state.snapshots[1].rows[0].externalId='different-id';},f=>{f.state.snapshots[1].period='yesterday';},
  f=>{f.state.snapshots[1].level='adset';},f=>{f.state.snapshots[1].fetchedAt=stamp(now);},
  f=>{f.state.snapshots[1].complete=false;},f=>{f.state.snapshots[1].source='Cached estimate';},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);const view=agentReportView(f.state,f.message,[],now);assert.equal(view.facts[0].windows[1].metrics,null);assert.equal(view.facts[0].windows[0].metrics.spend,100);}
});

test('An explicit foreign project in a reference cannot borrow matching local identities',()=>{
 const {state,message}=fixture();message.evidenceRefs[1].projectId='project-b';
 const view=agentReportView(state,message,[],now);assert.equal(view.facts[0].windows[1].metrics,null);assert.equal(view.historical,true);
});

test('A row that declares a different level cannot be used as exact target evidence',()=>{
 const {state,message}=fixture();state.snapshots[1].rows[0].level='adset';
 const view=agentReportView(state,message,[],now);assert.equal(view.facts[0].windows[1].metrics,null);
});

test('Historical and archived views remain read-only and keep the original report unchanged',()=>{
 const f=fixture();f.message._archived=true;f.state.proposals=[proposal({status:'Aprovada'})];
 const before=structuredClone(f),view=agentReportView(f.state,f.message,[],now);
 assert.equal(view.historical,true);assert.equal(view.proposals[0].status,'Aprovada');assert.equal(Object.hasOwn(view,'canApprove'),false);assert.equal(Object.hasOwn(view,'dispatchGranted'),false);
 assert.deepEqual(f,before);
 f.message._archived=false;f.state.snapshots=[];
 const missing=agentReportView(f.state,f.message,[],now);assert.equal(missing.historical,true);assert.deepEqual(missing.facts,[]);
});

test('Empty sources or short recorded questions never manufacture a financial recommendation',()=>{
 const {state,message}=fixture();state.snapshots=[];message.kind='message';message.text='Você conferiu novas vendas front depois do ajuste?';
 const view=agentReportView(state,message,[],now);assert.equal(view.plain,message.text);assert.equal(view.summary.decision,'Análise registrada');assert.deepEqual(view.proposals,[]);assert.deepEqual(view.facts,[]);
});

test('An explicitly replaced round stays historical even when its source timestamps and fingerprints still match',()=>{
 const {state,message}=fixture();
 state.collaborationRounds=[{id:message.roundId,project:message.project,status:'Fonte substituída',sourceCut:state.snapshots.map(s=>({period:s.period,level:s.level,fetchedAt:s.fetchedAt,fingerprint:fingerprint(s)}))}];
 const before=structuredClone({state,message}),view=agentReportView(state,message,[],now);
 assert.equal(view.historical,true);assert.equal(view.facts[0].windows[0].metrics.spend,100);assert.equal(view.facts[0].windows[1].metrics.spend,20);
 assert.deepEqual({state,message},before);assert.equal(Object.hasOwn(view,'canApprove'),false);
});

test('Changed rows cannot borrow a frozen reference merely by retaining its fetchedAt timestamp',()=>{
 const {state,message}=fixture();
 state.collaborationRounds=[{id:message.roundId,project:message.project,status:'Concluída',sourceCut:state.snapshots.map(s=>({period:s.period,level:s.level,fetchedAt:s.fetchedAt,fingerprint:fingerprint(s)}))}];
 const originalAt=state.snapshots[1].fetchedAt,initial=agentReportView(state,message,[],now);
 assert.equal(initial.historical,false);assert.equal(initial.facts[0].windows[1].metrics.spend,20);
 state.snapshots[1].rows[0].spend=9999;
 const changed=structuredClone({state,message}),view=agentReportView(state,message,[],now);
 assert.equal(state.snapshots[1].fetchedAt,originalAt);assert.equal(view.historical,true);
 assert.equal(view.facts[0].windows[1].metrics,null);assert.equal(view.facts[0].windows[0].metrics.spend,100);
 assert.deepEqual({state,message},changed);
});
