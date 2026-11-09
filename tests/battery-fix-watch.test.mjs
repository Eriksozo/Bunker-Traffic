import test from 'node:test';
import assert from 'node:assert/strict';
import {newChanges,orderPulse,pulseToast} from '../lib/change-watch.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import {ownerAppliedVerification,ownerAppliedDiverges} from '../lib/owner-applied.mjs';
import {activityLog} from '../lib/campaign-activity.mjs';

const NOW=Date.parse('2026-11-09T17:00:00Z'),iso=t=>new Date(t).toISOString();

test('Change watch: same-second edits in a new order on the next look replay nothing', () => {
 const t=iso(NOW-5000),A={id:'A',at:t},B={id:'B',at:t},old={id:'old',at:iso(NOW-60000)};
 const first=newChanges(old,[A,B,old]);
 assert.deepEqual(first.fresh.map(x=>x.id),['A','B']);
 assert.deepEqual(newChanges(first.head,[B,A,old]).fresh,[]);
 assert.deepEqual(newChanges(first.head,[A,B,old]).fresh,[]);
});

test('Change watch: a new edit in the head second, listed after the head, is reported once', () => {
 const t=iso(NOW-5000),A={id:'A',at:t},B={id:'B',at:t};
 const first=newChanges({id:'old',at:iso(NOW-60000)},[A]);
 const second=newChanges(first.head,[A,B]);
 assert.deepEqual(second.fresh.map(x=>x.id),['B']);
 assert.deepEqual(newChanges(second.head,[B,A]).fresh,[]);
 // A head without same-second peers keeps its plain shape.
 assert.deepEqual(newChanges(null,[{id:'x',at:iso(NOW)},{id:'y',at:iso(NOW-1000)}]).head,{id:'x',at:iso(NOW)});
});

test('Change watch stream with ties: every edit that reaches the window is reported exactly once', () => {
 let seed=11;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
 for(let run=0;run<200;run++){
  const edits=[],count=new Map();let t=NOW-3600000,head={id:'base',at:iso(t-1000)};
  for(let tick=0;tick<15;tick++){
   if(rnd()<0.7){t+=rnd()<0.5?0:1000;edits.push({id:'e'+edits.length,at:iso(t)});}
   const list=edits.slice(-6).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||(rnd()<0.5?-1:1));
   const r=newChanges(head,list);head=r.head;for(const e of r.fresh)count.set(e.id,(count.get(e.id)||0)+1);
  }
  for(const e of edits)assert.equal(count.get(e.id),1,e.id+' reported once');
 }
});

test('Order pulse: describes the receipt whose stage changed, not the newest', () => {
 const rec=[{id:'n',stage:'queued',project:'p',campaign:'Fictícia Nova',label:'Na fila do executor',at:iso(NOW)},{id:'o',stage:'checking',project:'p',campaign:'Fictícia Antiga',at:iso(NOW-60000)}];
 const a=orderPulse({version:1},rec,'',NOW);
 assert.equal(a.pulse.last.campaign,'Fictícia Nova','first look: newest receipt');
 const b=orderPulse(a.pulse,[rec[0],{...rec[1],stage:'confirmed',label:'Confirmada na Meta',confirmedAt:iso(NOW)}],a.sig,NOW);
 assert.equal(b.pulse.version,3);
 assert.deepEqual([b.pulse.last.campaign,b.pulse.last.stage,b.pulse.last.label],['Fictícia Antiga','confirmed','Confirmada na Meta']);
 const c=orderPulse(b.pulse,[{id:'z',stage:'queued',project:'p',campaign:'Fictícia Z',label:'Na fila do executor',at:iso(NOW)},...rec],b.sig,NOW);
 assert.equal(c.pulse.last.campaign,'Fictícia Z','a new receipt moves the pulse');
});

test('Order pulse: a receipt leaving the 24h window does not move the pulse', () => {
 const mk=(id,h)=>({id,project:'p',createdBy:'owner',ownerOrder:true,status:'Aprovada',createdAt:iso(NOW-h*3600000),expiresAt:iso(NOW-h*3600000+900000),payload:{action:'status',objectName:'Fictícia '+id,before:{status:'ACTIVE'},after:{status:'PAUSED'},liveTarget:{id:'z'}}});
 const s={config:{p:{}},proposals:[mk('a',1),mk('b',23.99)],executions:[{proposalId:'a',status:'Confirmada',claimedAt:iso(NOW),confirmedAt:iso(NOW-3500000)},{proposalId:'b',status:'Confirmada',claimedAt:iso(NOW),confirmedAt:iso(NOW-86000000)}]};
 const t0=orderPulse({version:5},ownerOrderReceipts(s,{now:NOW}),'',NOW);assert.equal(t0.pulse.version,6);
 const t1=orderPulse(t0.pulse,ownerOrderReceipts(s,{now:NOW+120000}),t0.sig,NOW+120000);
 assert.equal(t1.pulse,null);assert.equal(t1.sig,'a:confirmed');
});

test('Web toast: an order pulse names the order stage; an edit keeps its sentence', () => {
 assert.equal(pulseToast({kind:'order',campaign:'Fictícia 1',stage:'confirmed',label:'Confirmada na Meta'}),'Sua ordem: Confirmada na Meta · Fictícia 1');
 assert.doesNotMatch(pulseToast({kind:'order',campaign:'Fictícia 1',label:'Na fila do executor'}),/orçamento|Alguém/);
 assert.equal(pulseToast({campaign:'Fictícia 2',actor:'Gestor Fictício',field:'status',after:'PAUSED'}),'Gestor Fictício pausou Fictícia 2');
 assert.equal(pulseToast({campaign:'Fictícia 3',field:'dailyBudget',after:90}),'Alguém mudou o orçamento de Fictícia 3');
 assert.doesNotMatch(pulseToast({kind:'sale',campaign:'Fictícia 4'}),/orçamento/);
 assert.equal(pulseToast({kind:'live',projects:['p']}),'');assert.equal(pulseToast(null),'');
});

test('Já fiz (budget): a reading with daily budget N/D stays A conferir', () => {
 const appliedAt=NOW-600000,choice={id:'x',appliedByOwner:true,appliedAt:iso(appliedAt),project:'p',adAccountId:'act_f',objectId:'obj_f',action:'reduce',after:{dailyBudget:80}};
 const st=b=>({snapshots:[{projectId:'p',period:'today',level:'campaign',complete:true,fetchedAt:iso(appliedAt+120000),lastSyncAt:iso(appliedAt+100000),rows:[{adAccountId:'act_f',externalId:'obj_f',status:'ACTIVE',dailyBudget:b}]}]});
 for(const b of [null,undefined,'80']){const v=ownerAppliedVerification(st(b),choice);assert.equal(v.status,'A conferir');assert.equal(v.observed.dailyBudget,null);assert.equal(ownerAppliedDiverges(st(b),choice),false);}
 assert.equal(ownerAppliedVerification(st(100),choice).status,'Divergente','a finite different value still diverges');
 assert.equal(ownerAppliedVerification(st(80),choice).status,'Conferida');
});

test('Activity: a confirmed Bunker order with no Malva twin names its campaign and account from the proposal', () => {
 const s={config:{p:{projectName:'Fictício'}},proposals:[{id:'pr1',project:'p',payload:{action:'status',adAccountId:'act_f',objectId:'obj_f',objectName:'Campanha Fictícia 1',accountName:'Conta Fictícia',before:{status:'ACTIVE'},after:{status:'PAUSED'}}}],
  executions:[{id:'ex1',proposalId:'pr1',project:'p',status:'Confirmada',confirmedAt:iso(NOW-60000)}]};
 const [e]=activityLog(s,{now:NOW});
 assert.deepEqual([e.name,e.accountName,e.action,e.origin],['Campanha Fictícia 1','Conta Fictícia','pause','bunker']);
 const bare=structuredClone(s);delete bare.proposals[0].payload.objectName;delete bare.proposals[0].payload.accountName;
 const [b]=activityLog(bare,{now:NOW});assert.equal(b.name,null);assert.equal(b.accountName,null);
});
