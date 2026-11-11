import test from 'node:test';
import assert from 'node:assert/strict';
import {buildObservations,labelObservation,learnableMoves,foldDay,teamFeatures,obsColumns,obsRow,binCells,hourSlot,budgetBand,observationPolicy} from '../lib/team-observations.mjs';
import {playbookStore,runPlaybookShadow} from '../lib/playbook-runner.mjs';
import {teamActions,exclusionCounts,outsideLabel,ownerLabel} from '../lib/team-learning.mjs';
import {memoryStorage,iso,dayStart,TZ,people,pid} from './helpers/playbook-fixtures.mjs';

// Synthetic fixtures only: invented people, projects, accounts and amounts.
const P='proj-1',D='2026-11-09',NOW=dayStart(D)+14*3600000;// 14:00 local
const row=(id,name,m={},extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc-1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},
 dailyBudget:200,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,spend:150,revenue:0,revenueNet:0,adCosts:0,productCost:0,saleTax:0,frontOrders:0,orders:0,checkouts:1,impressions:1000,linkClicks:20,...m,...extra});
const base={projectId:P,level:'campaign',source:'Malva MCP',timezone:TZ,complete:true};
function state({rows,now=NOW,age=5*60000}={}){
 const from=iso(dayStart(D)),closed=(period,days,r)=>({...base,period,from:iso(dayStart(D)-days*86400000),to:from,fetchedAt:iso(now-3600000),lastSyncAt:iso(now-3600000),rows:r});
 const old=[row('m1','Madura',{spend:300,revenueNet:600,frontOrders:3,orders:3})];
 return {config:{[P]:{projectName:'Projeto Um'}},snapshots:[{...base,period:'today',from,to:iso(dayStart(D)+86400000),fetchedAt:iso(now-age),lastSyncAt:iso(now-age),rows:rows||[
  row('t1','09/11 - [TESTE] A',{spend:180,checkouts:0}),row('m1','Madura',{spend:250,revenueNet:150,frontOrders:1,orders:1}),
  row('w1','[AQUECIMENTO] perfil'),row('p1','Pausada',{},{status:'PAUSED',effectiveStatus:'PAUSED'}),row('k1','Kwai',{},{provider:'kwai'})]},
  closed('yesterday',1,old),closed('3d',3,old.map(r=>({...r,spend:900,revenueNet:1800}))),closed('7d',7,old.map(r=>({...r,spend:2100,revenueNet:4200})))]};
}
const move=(who,kind,obj,at,over={})=>({id:'mv-'+who+obj+at,day:D,project:P,who:'team',name:people[who].name,person:pid(who),role:'team',kind,at:iso(at),adAccountId:'acc-1',objectId:obj,ctx:{},...over});

test('Observations: one row per ACTIVE Meta sales campaign, warm-up / paused / Kwai out, N/D kept null',()=>{
 const ob=buildObservations(state(),{project:P,params:{ticketFront:100},now:NOW});
 assert.ok(ob);assert.equal(ob.key,`pb:obs:${D}:${P}:14`);
 const rows=ob.value.rows.map(r=>obsRow(ob.value.cols,r));
 assert.deepEqual(rows.map(r=>r.obj),['t1','m1']);
 const [t,m]=rows;
 assert.equal(t.stage,'first-day');assert.equal(t.test,true);assert.equal(t.front,0);assert.equal(t.ticket,100);
 assert.equal(t.roi3,null,'no closed 3 days for a new test: N/D, never 0');assert.equal(t.roiY,null);
 assert.equal(m.stage,'mature');assert.equal(m.roi3,2);assert.equal(m.label,null,'labels come 90 min later');
 assert.deepEqual(ob.value.cols,[...obsColumns]);
 assert.ok(JSON.stringify(ob.value).length/rows.length<500,'compact positional rows');
});

test('Freshness: a today cut older than 30 min observes nothing (the Sombra\'s own rule)',()=>{
 assert.equal(buildObservations(state({age:31*60000}),{project:P,now:NOW}),null);
 assert.equal(buildObservations(state(),{project:'other',now:NOW}),null);
});

test('Hourly cap: at most one observation per project per hour, on the pass that is due',async()=>{
 const storage=memoryStorage(),store=playbookStore(storage),input=t=>({state:state({now:t}),liveItems:[],events:[],now:t,projects:[{project:P,params:{},day:D}],fixed:[]});
 const a=await runPlaybookShadow(store,input(NOW),{deadline:Date.now()+1000});
 assert.equal(a.ok,true);assert.equal(a.obs,1);
 assert.equal((await runPlaybookShadow(store,input(NOW+10*60000),{deadline:Date.now()+1000})).obs,0,'same hour');
 assert.equal((await runPlaybookShadow(store,input(NOW+50*60000),{deadline:Date.now()+1000})).obs,0,'next clock hour but only 50 min later');
 assert.equal((await runPlaybookShadow(store,input(NOW+60*60000),{deadline:Date.now()+1000})).obs,1,'an hour later');
 assert.deepEqual([...storage.map.keys()].filter(k=>k.startsWith('pb:obs:')).sort(),[`pb:obs:${D}:${P}:14`,`pb:obs:${D}:${P}:15`]);
 const stale=await runPlaybookShadow(store,{...input(NOW+3*3600000),state:state({now:NOW+3*3600000,age:40*60000})},{deadline:Date.now()+1000});
 assert.equal(stale.obs,0,'stale source: no observation');
});

test('Labels after 90 min: the first move on the campaign, `manter` only with someone at the desk, else unlabeled',()=>{
 const ob=buildObservations(state(),{project:P,params:{ticketFront:100},now:NOW}).value;
 assert.equal(labelObservation(ob,[],{now:NOW+80*60000}),null,'not due before 90 min');
 const none=labelObservation(ob,[],{now:NOW+91*60000});
 assert.deepEqual(none.rows.map(r=>obsRow(ob.cols,r).label),['unlabeled','unlabeled'],'nobody acted in the project: never `manter`');
 const pause=move('ana','pause','t1',NOW+20*60000),elsewhere=move('bruno','reduce','zz',NOW-30*60000,{budget:{step:-0.2}});
 const l=labelObservation(ob,learnableMoves([pause,elsewhere],P),{now:NOW+91*60000}),rows=l.rows.map(r=>obsRow(ob.cols,r));
 assert.deepEqual([rows[0].label,rows[0].person,rows[0].lead],['pause',pid('ana'),20]);
 assert.equal(rows[1].label,'manter','Bruno was at the desk 30 min before: the team looked at m1 and kept it');
 const late=labelObservation(ob,learnableMoves([move('ana','pause','t1',NOW+100*60000)],P),{now:NOW+3*3600000});
 assert.equal(obsRow(ob.cols,late.rows[0]).label,'unlabeled','a move after 90 min is not this reading\'s, and it is not presence either');
 // Outside the Malva Dash (no attributed profile) is neither a label nor presence.
 const outside=move('ana','pause','t1',NOW+20*60000,{name:outsideLabel,outside:true,person:'outside'});
 assert.deepEqual(labelObservation(ob,learnableMoves([outside],P),{now:NOW+91*60000}).rows.map(r=>obsRow(ob.cols,r).label),['unlabeled','unlabeled']);
 assert.equal(labelObservation(l,[pause],{now:NOW+2*3600000}),null,'already labelled rows keep their label');
});

test('The Bunk is never a label: its order\'s echo is excluded; an ambiguous echo is quarantined',()=>{
 const st={...state(),proposals:[{id:'p-xb',createdBy:'bunk',autonomyOrder:true,project:P,payload:{adAccountId:'acc-1',objectId:'t1',action:'status',before:{status:'ACTIVE'},after:{status:'PAUSED'}}}],
  executions:[{id:'xb',proposalId:'p-xb',status:'Confirmada',submittedAt:iso(NOW+19*60000),confirmedAt:iso(NOW+19.5*60000)}]};
 const attr=(over)=>({key:'history:'+P+':'+over.eventId,project:P,adAccountId:'acc-1',objectId:'t1',name:'09/11 - [TESTE] A',field:'status',before:'ACTIVE',after:'PAUSED',currency:'BRL',automatic:false,source:'malva',matched:true,feedVersion:2,
  actor:'Dono Teste',actorInfo:{key:'malva:fake-owner',kind:'malva',name:'Dono Teste',profile:null,app:null},...over});
 const exact=teamActions({attributions:[attr({eventId:'e1',at:iso(NOW+19.2*60000)})],state:st,ownerNames:['Dono Teste'],now:NOW+3*3600000});
 assert.deepEqual(exact.actions,[]);assert.deepEqual(exact.excluded.map(x=>x.reason),['bunk']);
 // Same kind of move by the owner connection 2 h after the Bunk order (outside the exact window): never learned.
 const near=teamActions({attributions:[attr({eventId:'e2',at:iso(NOW+2*3600000)})],state:st,ownerNames:['Dono Teste'],now:NOW+4*3600000});
 assert.deepEqual(near.actions,[]);assert.equal(exclusionCounts(near.excluded).quarantined,1);
 assert.deepEqual(exclusionCounts(near.excluded).byReason,{'possible-bunk-echo':1});
 // A named manager doing the same move is still hers, and labels the reading.
 const ana=teamActions({attributions:[attr({eventId:'e3',at:iso(NOW+2*3600000),actor:'Ana Souza',actorInfo:{key:people.ana.key,kind:'malva',name:'Ana Souza'}})],state:st,ownerNames:['Dono Teste'],now:NOW+4*3600000});
 assert.deepEqual(ana.actions.map(a=>[a.who,a.person,a.kind]),[['team',pid('ana'),'pause']]);
 const ob=buildObservations(state({now:NOW+100*60000}),{project:P,now:NOW+100*60000}).value;
 assert.equal(obsRow(ob.cols,labelObservation(ob,learnableMoves([...exact.actions,...near.actions],P),{now:NOW+4*3600000}).rows[0]).label,'unlabeled');
});

test('Launch tools, Meta, automations and create/delete are never labels and are counted apart',()=>{
 const a=(eventId,over)=>({key:'history:'+P+':'+eventId,eventId,project:P,adAccountId:'acc-1',objectId:'t1',name:'c',field:'status',before:'ACTIVE',after:'PAUSED',currency:'BRL',at:iso(NOW-3600000),automatic:false,source:'meta',matched:true,actor:outsideLabel,...over});
 const out=teamActions({attributions:[
  a('l1',{actorInfo:{key:'fora',kind:'outside',name:outsideLabel,profile:'Malva',app:'Malva Epidemia'}}),
  a('l2',{actorInfo:{key:'fora',kind:'outside',name:outsideLabel,profile:'Erik Fictício',app:'Eagle Traffic'}}),
  a('m1',{actorInfo:{key:'fora',kind:'outside',name:outsideLabel,profile:'Meta',app:null}}),
  a('s1',{actor:'Meta',actorInfo:{key:'sistema',kind:'system',name:'Meta'}}),
  a('au',{actor:'Automação: corta CPA',actorInfo:{key:'automacao:fake',kind:'automation',name:'Automação: corta CPA'}}),
  a('dl',{after:'DELETED'}),a('cr',{before:null,after:'ACTIVE'}),
 ],state:state(),ownerNames:['Dono Teste'],now:NOW});
 assert.deepEqual(out.actions,[]);
 assert.deepEqual(exclusionCounts(out.excluded).byReason,{'launch-tool':2,meta:2,automation:1,'create-delete':2});
});

test('Daily bins: moves first, `manter` runs merged, people counts per kind, closed results, caps',()=>{
 const ob=buildObservations(state(),{project:P,params:{ticketFront:100},now:NOW}).value;
 const ob2={...buildObservations(state({now:NOW+3600000}),{project:P,params:{ticketFront:100},now:NOW+3600000}).value};
 const pause=move('ana','pause','t1',NOW+3600000+20*60000),bruno=move('bruno','reduce','zz',NOW+30*60000,{budget:{step:-0.2},minute:14*60+30});
 const moves=learnableMoves([pause,bruno],P);
 const l1=labelObservation(ob,moves,{now:NOW+5*3600000}),l2=labelObservation(ob2,moves,{now:NOW+5*3600000});
 const bin=foldDay({day:D,project:P,observations:[l1,l2],moves:[pause,bruno],base:{campaigns:10,loss:4,profit:5},excluded:{bunk:1},now:NOW+12*3600000});
 const cells=binCells(bin);
 assert.equal(cells[0].label,'pause','moves first');
 assert.deepEqual([bin.people[pid('ana')].pause,bin.people[pid('bruno')].reduce],[1,1]);
 assert.deepEqual(bin.steps.reduce.map(s=>s[0]),[-0.2]);
 assert.deepEqual(bin.base,[10,4,5]);assert.deepEqual(bin.excluded,{bunk:1});
 assert.ok(Object.keys(bin.y).length>=1,'closed yesterday per campaign seen that day');
 assert.equal(bin.caseRefs.find(c=>c.objectId==='t1').campaign,'09/11 - [TESTE] A','case refs carry the campaign name kept in the executor');
 assert.equal(bin.caseRefs.find(c=>c.objectId==='zz').campaign,null,'a campaign never read stays N/D');
 assert.ok(JSON.stringify(bin).length<=observationPolicy.binMaxBytes);
 // Size cap: an oversized day still fits by dropping cells, never by failing.
 const many=Array.from({length:30},(_,h)=>({...ob,at:iso(NOW+h*60000),rows:Array.from({length:300},(_,i)=>{const r=[...ob.rows[1]];r[1]='m'+i;r[2]='x'.repeat(60);r[obsColumns.indexOf('label')]='manter';r[obsColumns.indexOf('spend')]=h*10+i;return r;})}));
 const big=foldDay({day:D,project:P,observations:many,moves:[],now:NOW});
 assert.ok(JSON.stringify(big).length<=observationPolicy.binMaxBytes&&big.cells.length<=observationPolicy.maxCellsPerBin);
});

test('Shared features: hour slots, budget bands per currency, N/D never invented',()=>{
 assert.deepEqual([0,29,30,539,540,659,660,779,780,959,960,1199,1200,1439].map(hourSlot),['00-0030','00-0030','0030-09','0030-09','09-11','09-11','11-13','11-13','13-16','13-16','16-20','16-20','20-24','20-24']);
 assert.equal(hourSlot(null),null);
 assert.deepEqual([budgetBand(150,'BRL'),budgetBand(5000,'brl'),budgetBand(75,'USD'),budgetBand(75,'EUR'),budgetBand(null,'BRL')],['BRL:0','BRL:4','USD:1',null,null]);
 const f=teamFeatures(row('x','sem fonte',{spend:null,revenueNet:null}),{windows:{},aligned:false,stage:null,test:false,now:NOW,timezone:TZ});
 for(const k of ['spend','roiT','roiY','roi3','roi7','roiS','ticket','capShare'])assert.equal(f[k],null,k);
 assert.equal(teamFeatures(row('y','lifetime',{},{dailyBudget:null,lifetimeBudget:900}),{windows:{},aligned:true,stage:'mature',test:false,now:NOW,timezone:TZ}).budget,null,'lifetime budget: no daily budget feature');
 assert.equal(ownerLabel,'Você');
});
