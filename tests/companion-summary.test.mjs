import test from 'node:test';
import assert from 'node:assert/strict';
import {companionSummary,companionLimits} from '../lib/companion-summary.mjs';

const now=Date.parse('2026-11-07T15:00:00Z'),iso=h=>new Date(now-h*3600000).toISOString();
const m=(spend,net,front=1)=>({spend,revenue:net,revenueNet:net,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders:front,checkouts:2,impressions:1000,linkClicks:10,refundedRevenue:0});
const snap=(projectId,period,rows)=>({projectId,projectName:projectId.toUpperCase(),period,level:'campaign',source:'Malva MCP',complete:true,timezone:'UTC',from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z',fetchedAt:iso(0.2),lastSyncAt:iso(0.25),rows});
const row=id=>({externalId:id,adAccountId:'act',accountName:'Conta',name:'Campanha '+id,level:'campaign',provider:'meta',effectiveStatus:'ACTIVE',status:'ACTIVE',accountStatus:{active:true},deliveryStartedAt:'2026-10-01T00:00:00Z'});
function state(){
 return {config:{p:{projectName:'Projeto P'},q:{projectName:'Projeto Q'}},paused:false,ownerChoices:[],decisions:[],snapshots:[snap('p','today',[{...row('c1'),...m(500,200)}]),snap('p','yesterday',[{...row('c1'),...m(400,500)}]),snap('p','7d',[{...row('c1'),...m(3000,4000)}]),snap('p','3d',[{...row('c1'),...m(1200,1300)}])],
  proposals:[{id:'pr1',project:'p',status:'Aguardando aprovação',expiresAt:iso(-1),payload:{title:'Conta · Reduzir 20%'}},{id:'pr2',project:'p',status:'Aguardando aprovação',expiresAt:iso(1)},{id:'pr3',project:'q',status:'Aprovada'}],
  decisionHistory:[{id:'h',project:'p',projects:['p'],adAccountId:'act',objectId:'c1',name:'Campanha c1',field:'dailyBudget',before:1000,after:700,occurredAt:iso(2),actor:{name:'Ana'},currency:'BRL'}],
  collaborationMessages:[{id:'m1',project:'p',fromAgent:'creative',toAgent:'ops',kind:'conclusion',text:'x'.repeat(900),summary:{decision:'Observar',reason:'Front caiu.'},createdAt:iso(1)}]};
}
test('summary is read-only, scoped, bounded and carries no secrets or full texts',()=>{
 const s=state(),before=JSON.stringify(s),out=companionSummary(s,{project:'p',now,executor:{enabled:true,lastPulseAt:iso(0.01),history:[{kind:'failure',at:iso(0.5)},{kind:'failure',at:iso(3)},{kind:'idle',at:iso(0.1)}],secret:'never'}});
 assert.equal(JSON.stringify(s),before);
 assert.equal(out.projectName,'Projeto P');assert.deepEqual(out.projects.map(p=>p.name),['Projeto P','Projeto Q']);
 assert.equal(out.approvals.count,1);assert.equal(out.approvals.items[0].title,'Conta · Reduzir 20%');
 assert.equal(out.activity.summary.reduce.count,1);assert.equal(out.activity.recent[0].actor,'Ana');assert.equal(out.activity.recent[0].percent,-30);
 assert.equal(out.agents.recent[0].agent,'Nina');assert.equal(out.agents.recent[0].text,'Front caiu.');
 assert.equal(out.executor.recentFailures,1);assert.equal(out.executor.secret,undefined);
 assert.ok(out.queue.length<=companionLimits.queue);assert.equal(out.queue[0]?.campaign,'Campanha c1');
 assert.ok(!JSON.stringify(out).includes('x'.repeat(400)));
 assert.match(out.notice,/Somente leitura/);
});
test('all projects scope and unknown project',()=>{
 const out=companionSummary(state(),{now});assert.equal(out.project,'all');assert.equal(out.approvals.count,1);assert.equal(out.executor,null);
 assert.throws(()=>companionSummary(state(),{project:'zzz',now}),/Projeto não configurado/);
});
test('project board lists every project and queue items carry the campaign drill-down',()=>{
 const s=state(),out=companionSummary(s,{project:'p',now});
 assert.deepEqual(out.board.map(b=>b.name),['Projeto P','Projeto Q']);
 const p=out.board[0];assert.equal(p.spend,500);assert.equal(p.roas,0.4);assert.equal(p.roasYesterday,1.25);assert.equal(p.approvals,1);assert.equal(p.changes,1);
 const d=out.queue[0].detail;assert.equal(d.projectId,'p');assert.equal(d.status,'ACTIVE');assert.equal(d.windows.today.spend,500);assert.equal(d.windows['7d'].roas,4000/3000);assert.equal(d.changes[0].actor,'Ana');
 assert.deepEqual(companionSummary(s,{project:'p',now,board:[{id:'x'}]}).board,[{id:'x'}]);
});
