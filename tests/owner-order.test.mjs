import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCards,recordOwnerChoice} from '../lib/decision-cards.mjs';
import {ensureCollaboration,approvedExecutionProposal} from '../lib/collaboration.mjs';
import {isManualDecision} from '../lib/decision-intent.mjs';
import {autonomousWorkPlan} from '../lib/autonomous-work.mjs';
import {companionCards} from '../lib/companion-cards.mjs';

// Synthetic fixture (tests/owner-applied.test.mjs) with real closed-window boundaries, as the executor's financial fence requires.
const now=Date.parse('2026-11-02T20:00:00Z'),date=n=>new Date(n).toISOString(),project='11111111-1111-4111-8111-111111111111';
function fixture(){
 const base={id:'22222222-2222-4222-8222-222222222222',externalId:'meta-campaign',adAccountId:'account',provider:'Meta',name:'01/11 [CBO] [TESTE] Example',accountName:'USD account',budgetCurrency:'USD',budgetRate:5.4,dailyBudget:100,lifetimeBudget:null,status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},spend:100,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:2,impressions:1000,linkClicks:20,refundedRevenue:0};
 const job={id:'collection',project,status:'Concluída',startedAt:date(now-60000),completedAt:date(now-1000)};
 const state={config:{[project]:{projectName:'Test',targetRoas:2,dailyCap:1000}},jobs:[job],agents:{[project]:{jobId:job.id}},snapshots:['7d','3d','yesterday','today'].map(period=>({projectId:project,projectName:'Test',period,level:'campaign',source:'Malva MCP',complete:true,from:{today:'2026-11-02T03:00:00.000Z',yesterday:'2026-11-01T03:00:00.000Z','3d':'2026-10-30T03:00:00.000Z','7d':'2026-10-26T03:00:00.000Z'}[period],to:period==='today'?'2026-11-03T03:00:00.000Z':'2026-11-02T03:00:00.000Z',timezone:'America/Sao_Paulo',fetchedAt:date(now-2000),lastSyncAt:date(now-5000),rows:[structuredClone(base)]})),paused:false};
 ensureCollaboration(state,job,now);return state;
}
const card=s=>buildDecisionCards(s,project,now)[0];
const order=(s,extra={})=>{const c=card(s);return recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'order-1',ownerOrder:true,...extra},'mac-touchid:test',now);};

test('An owner order becomes an approved exact proposal the executor accepts, without agent opinions',()=>{
 const s=fixture(),r=order(s);
 assert.equal(r.status,'Autorizado');assert.equal(r.ownerOrder,true);assert.equal(r.intentOnly,false);
 const p=s.proposals.find(x=>x.id===r.proposalId);
 assert.equal(p.status,'Aprovada');assert.equal(p.createdBy,'owner');assert.equal(p.payload.ownerOrder,true);assert.deepEqual(p.payload.opinionRefs,[]);
 assert.deepEqual(p.payload.before,{status:'ACTIVE'});assert.deepEqual(p.payload.after,{status:'PAUSED'});assert.equal(p.payload.currency,'USD');
 assert.equal(p.reviews.length,1);assert.equal(p.reviews[0].actor,'owner');
 assert.doesNotThrow(()=>approvedExecutionProposal(s,{proposalId:p.id,version:p.version,signature:p.signature},now+1000));
 assert.equal(isManualDecision({op:'cardDecision',ownerOrder:true}),false,'gets the live drift and contingency checks');
 const plan=autonomousWorkPlan(s,{},now+1000);
 assert.ok(plan.ready.some(w=>w.kind==='execution'&&w.proposalId===p.id),'the Cloudflare executor picks it up');
});

test('Budget orders carry the exact new value; replays do not duplicate',()=>{
 const s=fixture(),c=card(s),args={project,cardId:c.id,signature:c.signature,choice:'reduce',percent:20,clientId:'order-r',ownerOrder:true};
 const r=recordOwnerChoice(s,args,'mac-touchid:test',now),p=s.proposals.find(x=>x.id===r.proposalId);
 assert.deepEqual(p.payload.before,{dailyBudget:100});assert.deepEqual(p.payload.after,{dailyBudget:80});assert.equal(p.payload.action,'budget');assert.equal(p.payload.budgetOwner,'CBO');
 assert.equal(recordOwnerChoice(s,args,'mac-touchid:test',now).id,r.id);assert.equal(s.proposals.length,1);
 const up=fixture(),u=card(up),ur=recordOwnerChoice(up,{project,cardId:u.id,signature:u.signature,choice:'increase',percent:35,clientId:'order-i',ownerOrder:true},'mac-touchid:test',now);
 assert.equal(up.proposals.find(x=>x.id===ur.proposalId).payload.after.dailyBudget,135);
});

test('Fences stay: keep, paused office, stale reading, warmup-free scope and a live proposal block the order',()=>{
 assert.throws(()=>order(fixture(),{choice:'keep',clientId:'k'}),/Manter/);
 const paused=fixture();paused.paused=true;assert.throws(()=>order(paused),/pausado/);
 const stale=fixture(),c=card(stale);assert.throws(()=>recordOwnerChoice(stale,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'s',ownerOrder:true},'mac-touchid:test',now+2*3600000),/não permitem|mudou/);
 const twice=fixture();order(twice);const c2=card(twice);assert.throws(()=>recordOwnerChoice(twice,{project,cardId:c2.id,signature:c2.signature,choice:'reduce',percent:10,clientId:'order-2',ownerOrder:true},'mac-touchid:test',now),/decisão registrada|proposta em andamento/);
 assert.throws(()=>order(fixture(),{applied:true}),/não se combina/);
 assert.throws(()=>order(fixture(),{approveExact:true}),/não se combina/);
});

test('An order may follow a pending "Pedir à equipe" intent',()=>{
 const s=fixture(),c=card(s);
 const intent=recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'reduce',percent:20,clientId:'intent'},'mac-touchid:test',now);
 assert.equal(intent.status,'Pendente de revisão');
 const r=order(s,{clientId:'after-intent'});
 assert.equal(r.status,'Autorizado');assert.equal(r.reconsidersChoiceId,intent.id);
});

test('The notch sees which orders run now; team opinions inform but do not block',()=>{
 const s=fixture(),view=companionCards(s,{project,adAccountId:'account',objectId:'meta-campaign'},1,now),c=view.cards[0];
 assert.equal(c.orderActions.pause,true);assert.equal(c.orderActions.keep,false);
 assert.ok(c.blockedReasons.some(r=>/Faltam pareceres/.test(r)),'the team gap is still shown');
 assert.ok(!c.orderBlockers.some(r=>/Faltam pareceres|Meta de retorno|Teto diário/.test(r)));
 order(s);const after=companionCards(s,{project,adAccountId:'account',objectId:'meta-campaign'},2,now).cards[0];
 assert.equal(after.orderActions.reduce,false);assert.ok(after.orderBlockers.some(r=>/proposta em andamento/.test(r)));
});

test('Only the Mac (Touch ID) may give a direct order; a web session cannot',()=>{
 const s=fixture(),c=card(s);
 assert.throws(()=>recordOwnerChoice(s,{project,cardId:c.id,signature:c.signature,choice:'pause',clientId:'web',ownerOrder:true},'owner@example.com',now),/Touch ID/);
 assert.equal(s.proposals?.length??0,0);
});
