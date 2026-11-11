import test from 'node:test';
import assert from 'node:assert/strict';
import {playTemplates,templateOf,fitPlay,examplesFromBins,shrinkParams,versionPlay,evaluatePlaybook,matchPlay,divergences,playSentence,playbookPolicy,holds} from '../lib/manager-playbook.mjs';
import {cellOf} from '../lib/team-observations.mjs';
import {syntheticDays,iso,dayStart,TZ,pid,shift} from './helpers/playbook-fixtures.mjs';

// Synthetic fixtures only (tests/helpers/playbook-fixtures.mjs): invented people, projects, campaigns and amounts.
const FIT='2026-10-31',P='proj-1';
const fit=(id,opts={},fitDay=FIT,extra={})=>{const {bins}=syntheticDays(opts);return {bins,f:fitPlay(templateOf(id),bins,{project:opts.project||P,fitDay,...extra})};};

test('Fitting is deterministic: same bins (in any order) give the same play, bit for bit',()=>{
 const {bins}=syntheticDays({});
 const a=fitPlay(templateOf('pb:bad-day-cut'),bins,{project:P,fitDay:FIT}),b=fitPlay(templateOf('pb:bad-day-cut'),[...bins].reverse(),{project:P,fitDay:FIT});
 assert.deepEqual(a,b);
 assert.deepEqual(JSON.stringify(fitPlay(templateOf('pb:test-pause'),bins,{project:P,fitDay:FIT})),JSON.stringify(fitPlay(templateOf('pb:test-pause'),structuredClone(bins),{project:P,fitDay:FIT})));
});

test('The fit follows what the people did: test pauses near 2 tickets, cuts −20% after the afternoon',()=>{
 const t=fit('pb:test-pause').f,c=fit('pb:bad-day-cut').f;
 assert.equal(t.stage,'candidata');assert.ok(t.params.k>=1.5&&t.params.k<=2.25,String(t.params.k));
 assert.deepEqual(t.learnedFrom.map(p=>p.person),[pid('ana')]);assert.ok(t.learnedFrom[0].params,'8+ moves: her own fit is shown');
 assert.equal(c.stage,'candidata');assert.deepEqual(c.step,{median:-0.2,p25:-0.2,p75:-0.2});
 assert.ok(c.params.h>=12&&c.params.h<=14,String(c.params.h));assert.ok(c.params.r<=0.9,String(c.params.r));
 assert.ok(!c.flags.includes('horario-expediente'),'the hour really matters here: kept');
 assert.match(playSentence('pb:bad-day-cut',c.params,c.step,c.generalized),/^Reduzir 20% a partir das 1\dh com ROI de hoje abaixo de 0,\d+/);
 assert.ok(playSentence('pb:morning-batch-raise',{h1:9,h2:11,r1:2,f:2,r3:1.3},{median:0.5}).length<=playbookPolicy.sentenceMax);
});

test('Minimum support: no fit below 8 moves, 4 campaigns and 3 days ("faltam N casos")',()=>{
 const few=fit('pb:test-pause',{days:2,campaigns:4},'2026-10-03').f;
 assert.deepEqual([few.stage,few.reason,few.support.moves,few.support.missing],['observando','poucos-casos',4,4]);
 assert.equal(few.raw,null);assert.deepEqual(few.params,{k:null},'no threshold is ever shown without support');
 const none=fit('pb:night-raise').f;assert.deepEqual([none.stage,none.support.moves,none.support.missing],['observando',0,8]);
});

test('Bootstrap stability: a threshold that moves under resampling keeps the play in observation',()=>{
 const noisy=fit('pb:test-pause',{pauseJitter:1}).f;
 assert.equal(noisy.stage,'observando');assert.equal(noisy.reason,'instavel');assert.ok(noisy.spread.k>playbookPolicy.maxSpread);
 assert.ok(fit('pb:test-pause').f.spread.k<=playbookPolicy.maxSpread);
});

test('Hour caution: an hour window that does not matter is generalized, with the caveat chip',()=>{
 const any=fit('pb:bad-day-cut',{brunoFromHour:8}).f;
 assert.deepEqual([any.params.h,any.generalized,any.flags.includes('horario-expediente')],[null,['h'],true]);
 assert.doesNotMatch(playSentence('pb:bad-day-cut',any.params,any.step,any.generalized),/a partir das/);
});

test('Per person vs consensus: own fits from 8+ moves; consensus shrunk toward the other projects (weight 10)',()=>{
 const a=fit('pb:test-pause',{project:'proj-1',testPauseTickets:2}).f,b=fit('pb:test-pause',{project:'proj-2',testPauseTickets:4,seed:11}).f;
 const t=templateOf('pb:test-pause'),shrunk=shrinkParams(t,a,[b]);
 const m=a.support.moves,w=playbookPolicy.shrinkWeight,expected=Math.round(((m*a.raw.k+w*b.raw.k)/(m+w))/0.25)*0.25;
 assert.equal(shrunk.k,expected);assert.ok(shrunk.k>=a.raw.k&&shrunk.k<=b.raw.k);
 assert.deepEqual(shrinkParams(t,a,[]),a.raw,'alone: no pool, no shrinkage');
 const small=fit('pb:test-pause',{days:4,campaigns:8}).f;
 const pulled=shrinkParams(t,small,[b]);assert.ok(Math.abs(pulled.k-b.raw.k)<Math.abs(small.raw.k-b.raw.k),'a small project is pulled harder');
 const bad=fit('pb:bad-day-cut',{days:6,campaigns:6}).f;
 assert.ok(bad.learnedFrom.every(p=>p.n>=8||p.params===null),'a person below 8 moves is counted, never fitted');
});

test('Conflict: one person raises where another cuts (≥3 each): no play, a Divergência card',()=>{
 const {bins,f}=fit('pb:bad-day-cut',{withCarla:true},FIT,{names:{[pid('bruno')]:'Bruno Lima',[pid('carla')]:'Carla Dias'}});
 const d=divergences(bins,{fitDay:FIT,names:{[pid('bruno')]:'Bruno Lima',[pid('carla')]:'Carla Dias'}});
 assert.ok(d.length>0);assert.match(d[0].text,/Carla Dias costuma aumentar .* Bruno Lima costuma cortar/);
 assert.ok(f.flags.includes('divergencia'));assert.notEqual(f.stage,'candidata');
 assert.ok(d.every(x=>x.people.every(p=>p.n>=3)));
});

test('Decay and dormancy: recent cases weigh more; no case in 14 days means dormindo',()=>{
 const {bins}=syntheticDays({});
 const set=examplesFromBins(bins,templateOf('pb:test-pause'),{fitDay:FIT});
 const byAge=age=>set.ex.find(e=>e.pos&&e.age===age);
 const e1=byAge(1),e22=byAge(22);assert.ok(e1&&e22);
 assert.ok(Math.abs((e22.w/e1.w)-0.5**(21/21))<0.2,'half-life of 21 days');
 assert.ok(set.ex.every(e=>e.age>=1&&e.age<=60),'60-day window, days before the fit only');
 const dormant=fit('pb:test-pause',{noMovesAfter:'2026-10-12'}).f;
 assert.ok(dormant.flags.includes('dormindo'));assert.equal(dormant.stage,'observando');
});

test('"Imitação sem ganho": cuts whose next day made money (vs the day base) are flagged',()=>{
 const {bins}=syntheticDays({});
 // Every cut campaign made money the next day, while 60% of campaigns lost money that day.
 const byDay=new Map(bins.map(b=>[b.day,b]));
 for(const b of bins){b.base=[10,6,3];for(const c of b.cells){const o=Object.fromEntries(b.cols.map((k,i)=>[k,c[i]]));if(o.label!=='reduce')continue;const d2=byDay.get(shift(b.day,2));if(d2)d2.y[o.camp]=[1.6,150,300];}}
 const f=fitPlay(templateOf('pb:bad-day-cut'),bins,{project:P,fitDay:FIT});
 assert.ok(f.outcome.d1.n>=5);assert.equal(f.outcome.d1.rate,0);assert.equal(f.outcome.base,0.6);
 assert.ok(f.flags.includes('imitacao-sem-ganho'));
 // The other way round (cuts followed by losses) is not flagged.
 for(const b of bins)for(const k of Object.keys(b.y))b.y[k]=[0.4,-150,300];
 assert.ok(!fitPlay(templateOf('pb:bad-day-cut'),bins,{project:P,fitDay:FIT}).flags.includes('imitacao-sem-ganho'));
});

test('Winner cuts (ROI ≥ 1.2 before the cut) on more than 20% of the cases block the play',()=>{
 const f=fit('pb:bad-day-cut',{brunoCutsWinners:true}).f;
 assert.ok(f.outcome.winnersShare>playbookPolicy.winnerCutShare);assert.ok(f.flags.includes('cortes-em-vencedoras'));
 assert.ok(fit('pb:bad-day-cut').f.outcome.winnersShare<=playbookPolicy.winnerCutShare);
});

test('Refit: inside the frozen version\'s range nothing changes; outside it a challenger appears, the champion stays',()=>{
 const now=Date.parse('2026-11-01T12:00:00Z'),f=fit('pb:bad-day-cut').f;
 const v1=versionPlay(null,f,{now});assert.equal(v1.current.version,1);assert.match(v1.current.rev,/^v1:[0-9a-z]{8}$/);
 const same=versionPlay(v1,{...f,params:{...f.params}},{now:now+6*3600000});
 assert.equal(same.current.rev,v1.current.rev);assert.equal(same.challenger,null);assert.equal(same.drift,false);
 const moved={...f,params:{...f.params,r:f.params.r+1}};
 const ch=versionPlay(v1,moved,{now:now+6*3600000});
 assert.deepEqual(ch.current,v1.current,'the champion is unchanged');assert.equal(ch.challenger.version,2);assert.equal(ch.drift,true);
 const again=versionPlay(ch,moved,{now:now+12*3600000});assert.equal(again.challenger.rev,ch.challenger.rev,'the same challenger, not a new one each refit');
 const later=versionPlay(again,moved,{now:now+30*86400000});
 assert.equal(later.current.rev,v1.current.rev,'owner Q5: the version in use never changes by itself, even after 30 days');
 assert.equal(later.challenger.rev,ch.challenger.rev,'the challenger keeps waiting for "Atualizar"');assert.equal(later.promoted,undefined);
 assert.ok(later.versions.length<=10);
});

// --- Decisions now (Sombra shape) ---------------------------------------------------------------------------------
const D='2026-11-09',NOW=dayStart(D)+15*3600000;
const row=(id,name,m={},extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc-1',accountName:'Conta',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},
 dailyBudget:400,budgetCurrency:'BRL',budgetRate:1,lifetimeBudget:null,spend:300,revenue:0,revenueNet:150,adCosts:0,productCost:0,saleTax:0,frontOrders:1,orders:1,checkouts:2,impressions:1000,linkClicks:20,...m,...extra});
const base={projectId:P,level:'campaign',source:'Malva MCP',timezone:TZ,complete:true};
function state(rows,{closedRows=null,age=5*60000}={}){
 const from=iso(dayStart(D)),cut=(period,days,r)=>({...base,period,from:iso(dayStart(D)-days*86400000),to:from,fetchedAt:iso(NOW-3600000),lastSyncAt:iso(NOW-3600000),rows:r});
 const old=closedRows||rows.map(r=>({...r,spend:300,revenueNet:600}));
 return {config:{[P]:{projectName:'Projeto Um'}},snapshots:[{...base,period:'today',from,to:iso(dayStart(D)+86400000),fetchedAt:iso(NOW-age),lastSyncAt:iso(NOW-age),rows},
  cut('yesterday',1,old),cut('3d',3,old.map(r=>({...r,spend:900,revenueNet:1800}))),cut('7d',7,old.map(r=>({...r,spend:2100,revenueNet:4200})))]};
}
const play={id:'pb:bad-day-cut',project:P,key:'pb:bad-day-cut@'+P,stage:'candidata',rev:'v1:abcdefgh',version:1,params:{h:13,r:0.85,k:2,r3:1.2},step:{median:-0.2},generalized:[],learnedFrom:[{person:pid('bruno'),name:'Bruno Lima',n:40}],caseRefs:[],sentence:'Reduzir 20% …'};
const ev=(st,opts={})=>evaluatePlaybook(st,{project:P,now:NOW,params:{ticketFront:100},plays:[play],...opts});

test('Decisions keep the Sombra shape, are never executable and carry the play fields',()=>{
 const out=ev(state([row('m1','Madura 1')]));
 assert.equal(out.decisions.length,1);const d=out.decisions[0];
 for(const k of ['project','projectName','adAccountId','accountName','objectId','malvaObjectId','name','launchDay','newCampaign','metrics','rule','ruleLabel','action','before','after','reason','blockedBy','limitations'])assert.ok(k in d,k);
 assert.deepEqual([d.wouldExecute,d.alertOnly,d.source,d.role,d.wouldFire,d.rule,d.playKey,d.ruleRev],[false,false,'playbook','challenger',true,'pb:bad-day-cut','pb:bad-day-cut@'+P,'v1:abcdefgh']);
 assert.deepEqual([d.action,d.before.dailyBudget,d.after.dailyBudget,d.after.currency],['budget',400,320,'BRL']);
 assert.equal(d.cut.kind,'analysis');assert.ok(!('firstWouldExecuteAt' in d)||d.firstWouldExecuteAt===null);
 assert.match(d.reason,/^Jogada da equipe v1 \(aprendida com Bruno Lima 40\): ROI de hoje 0,5/);
 // The owner's saved limit clamps the step, never upward.
 const clamped=ev(state([row('m1','Madura 1')]),{limits:{maxReducePct:15}}).decisions[0];
 assert.deepEqual([clamped.play.learnedStep,clamped.play.clampedStep,clamped.after.dailyBudget],[-0.2,-0.15,340]);
 assert.equal(ev(state([row('m1','Madura 1')]),{limits:{maxReducePct:50}}).decisions[0].play.clampedStep,-0.2,'a looser limit never raises the step');
 // A fixed rule on the same campaign and move this pass: noted ("a regra fixa tem prioridade").
 assert.equal(ev(state([row('m1','Madura 1')]),{fixed:[{project:P,adAccountId:'acc-1',objectId:'m1',rule:'bad-day-reduce',action:'budget',before:{dailyBudget:400},after:{dailyBudget:320}}]}).decisions[0].sameAsRule,'bad-day-reduce');
});

test('Inherited common blocks: 2 h edit, partial day, warm-up, non-ACTIVE, Kwai, stale cut, N/D',()=>{
 const events=[{project:P,adAccountId:'acc-1',objectId:'m1',action:'increase',actor:'Ana Souza',at:iso(NOW-30*60000),origin:'history'}];
 assert.match(ev(state([row('m1','Madura 1')]),{events}).decisions[0].blockedBy.join(' '),/Edição de Ana Souza há menos de 2h/);
 assert.equal(ev(state([row('m1','Madura 1')]),{events:[{...events[0],origin:'bunker'}]}).decisions[0].blockedBy.length,0,'the Bunker\'s own edit is not a manager edit');
 // Partial day: profitable yesterday and less than one ticket spent today holds a cut.
 const pd=state([row('m1','Madura 1',{spend:80,revenueNet:20})]);
 const lowPlay={...play,params:{...play.params,k:0.5}};
 const held=evaluatePlaybook(pd,{project:P,now:NOW,params:{ticketFront:100},plays:[lowPlay]}).decisions[0];
 assert.ok(held);assert.match(held.blockedBy.join(' '),/Ontem fechou com lucro/);assert.equal(held.wouldFire,false);
 for(const r of [row('w1','[AQUECIMENTO] perfil'),row('p1','Pausada',{},{status:'PAUSED',effectiveStatus:'PAUSED'}),row('k1','Kwai',{},{provider:'kwai'}),row('l1','Vitalício',{},{dailyBudget:null,lifetimeBudget:5000})])
  assert.equal(ev(state([r])).decisions.length,0,r.name);
 const stale=ev(state([row('m1','Madura 1')],{age:40*60000}));assert.equal(stale.decisions.length,0);assert.match(stale.skipped,/vencida/);
 // N/D never satisfies a condition: without closed windows (3-day ROI N/D) the play stays silent.
 const nd=state([row('m1','Madura 1')]);nd.snapshots=nd.snapshots.filter(s=>s.period==='today');
 assert.equal(ev(nd).decisions.length,0);
 assert.equal(holds('>=',null,1),false);assert.equal(holds('<',undefined,1),false);assert.equal(holds('>=',2,null),true);
 assert.equal(matchPlay(templateOf('pb:test-pause'),{k:1},cellOf({stage:'first-day',test:true,front:null,spend:500,ticket:100})),false,'front N/D is not "no sale"');
 // Only candidate plays decide; Phase 1 plays never go past "candidata".
 assert.equal(ev(state([row('m1','Madura 1')]),{plays:[{...play,stage:'observando'}]}).decisions.length,0);
 assert.ok(playTemplates.every(t=>t.id.startsWith('pb:')));
});

test('CPU bound: six plays fitted on a 60-day fixture stay within the predicate budget per group',()=>{
 const {bins}=syntheticDays({days:60,from:'2026-09-01',campaigns:16});
 const counter={n:0},t0=performance.now();
 for(const t of playTemplates)fitPlay(t,bins,{project:P,fitDay:'2026-10-31',counter});
 const ms=performance.now()-t0;
 assert.ok(counter.n/playTemplates.length<200000,String(counter.n));
 assert.ok(ms<3000,`${Math.round(ms)} ms for 6 groups`);
});

test('A divergence card names the play it blocks',async()=>{
 const {playbookStore,runPlaybookLearning}=await import('../lib/playbook-runner.mjs');
 const {memoryStorage}=await import('./helpers/playbook-fixtures.mjs');
 const {binsKey}=await import('../lib/team-observations.mjs');
 const {bins}=syntheticDays({withCarla:true});const storage=memoryStorage(Object.fromEntries(bins.map(b=>[binsKey(b.day,b.project),b]))),store=playbookStore(storage);
 const st={config:{[P]:{projectName:'Projeto Um'}},snapshots:[]};
 for(let i=0;i<10;i++){await runPlaybookLearning(store,{state:st,now:Date.parse('2026-11-01T15:00:00Z')+i,projects:[P],zone:()=>TZ},{deadline:Date.now()+5000});if(storage.map.get('pb:model')?.fitAt&&!storage.map.get('pb:cursor').fit)break;}
 const v=storage.map.get('pb:view:'+P);assert.ok(v.playbook.divergences.length>0);
 assert.ok(v.playbook.divergences.some(d=>d.playId==='pb:bad-day-cut'),JSON.stringify(v.playbook.divergences.map(d=>d.playId)));
 assert.ok(v.playbook.divergences.every(d=>/Carla Dias|Bruno Lima/.test(d.text)),'names come from the bins kept in the executor');
});

test('Backfilled steps (owner Q11) feed the play\'s step, never its conditions; the night raise takes only 00:00–00:30 ones',async()=>{
 const {bins}=syntheticDays({});const base=fitPlay(templateOf('pb:bad-day-cut'),bins,{project:P,fitDay:FIT});
 const withBf=bins.map(b=>({...b,steps:{...b.steps,reduce:[...b.steps.reduce,...Array.from({length:6},()=>[-0.5,pid('bruno'),1,15*60])]}}));
 const f=fitPlay(templateOf('pb:bad-day-cut'),withBf,{project:P,fitDay:FIT});
 assert.equal(base.step.median,-0.2);assert.equal(f.step.median,-0.5,'six backfilled −50% a day outweigh one live −20%');
 assert.deepEqual(f.params,base.params,'the thresholds come only from readings');assert.ok(f.stepFromBackfill>0);
 const {playCorpus}=await import('../lib/manager-playbook.mjs'),c=playCorpus({fitDay:FIT,templates:[templateOf('pb:night-raise')]});
 c.add({...bins[5],steps:{increase:[[0.5,'p:x',1,10],[0.2,'p:x',1,600],[0.3,'p:x',0,10],[0.4,'p:x',1,null]],reduce:[]}});
 assert.deepEqual(c.extraSteps(templateOf('pb:night-raise')).map(([s])=>s),[0.5],'night: backfilled, flagged and timed in the first 30 min');
});

test('Bins are measured in UTF-8 bytes, with a margin under the store cap',async()=>{
 const {fitBin,utf8Bytes,observationPolicy}=await import('../lib/team-observations.mjs');
 const name='Ação çãõ é — '.repeat(5);
 const bin={v:1,day:FIT,project:P,cols:['label','camp','name'],persons:[],cells:Array.from({length:4000},(_,i)=>['manter','c'+i,name]),people:{},steps:{increase:[],reduce:[]},y:{},caseRefs:[]};
 assert.ok(JSON.stringify(bin).length<new TextEncoder().encode(JSON.stringify(bin)).length,'accents: more bytes than characters');
 const out=fitBin(bin);assert.ok(utf8Bytes(out)<=observationPolicy.binSafeBytes&&observationPolicy.binSafeBytes<100000);assert.ok(out.truncated>0);
 assert.equal(fitBin({...bin,cells:bin.cells.slice(0,10)}).truncated,undefined,'a bin that fits is untouched');
});
