/**
 * Modo Gestor (W3), evaluation of the playbook (spec §3.4): the Sombra-shaped store of play decisions (`pbs:*`, kept
 * apart from the fixed rules), their grades (the same D+1 verdict as the Sombra, plus D+3, pause proxies and opposite
 * moves), the score of each play version, and the forward-only replay against what the people did.
 * Pure: no provider call, no write, no approval, no dispatch. A play decision never executes: `wouldExecute:false` and
 * `firstWouldExecuteAt:null` are forced on every entry, and nothing here can produce a proposal or an order.
 */
import {shadowGrades} from './autonomy-shadow.mjs';
import {sum} from './analysis.mjs';
import {wilson,shortId} from './learning-math.mjs';
import {playCorpus,fitTemplate,matchPlay,decisionKind,playTemplates,playbookPolicy} from './manager-playbook.mjs';
import {binCells,localDayOf,shiftDay,labelKinds} from './team-observations.mjs';

export const playbookEvalPolicy=Object.freeze({version:1,maxEntries:2000,retentionDays:7,pauseProxyMs:48*3600000,oppositeMs:12*3600000,provavelAcertoRoi:1,
 recentDays:7,replayDays:30,maxReplayCases:20});
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const r3=n=>finite(n)?Math.round(n*1000)/1000:null;
const cutKinds=new Set(['pause','reduce']),raiseKinds=new Set(['increase','activate']);
const dayIndex=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
const quantile=(list,q)=>{const s=list.filter(finite).sort((a,b)=>a-b);if(!s.length)return null;const i=(s.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);};

/** The `pbs:` storage id of a play decision: the mergeShadow id scheme, under its own prefix. */
export const pbsId=(day,d)=>JSON.stringify([day,d.versionRole==='next'?d.rule+'@next':d.rule,d.project,d.adAccountId,d.objectId,d.action]);
export const pbsKey=id=>'pbs:'+id;
/** Prefix of one local day of play decisions (`pbs:["YYYY-MM-DD"`). */
export const pbsDayPrefix=day=>'pbs:'+JSON.stringify([day]).slice(0,-1);

/** The fields Phase 1 forces on every stored play decision, whatever came in. */
export function forcePlaybookFields(e){
 return {...e,wouldExecute:false,firstWouldExecuteAt:null,ruleVersion:null,source:'playbook',alertOnly:false,role:'challenger'};
}
/**
 * Upserts this pass's play decisions into their stored entries (same identity and first-sighting rules as mergeShadow):
 * the first time a decision appeared each day is kept; once it fired (nothing blocking), its before/after stay those of
 * that moment. Only the given prior entries are touched (the runner reads today's exact keys).
 * @param {Map<string,any>|any[]} prior entries by id (or a list) @param {any[]} decisions @param {{now:number,day:string}} options
 * @returns {any[]} the merged entries of `decisions` (new or changed ones), forced
 */
export function mergePlaybook(prior,decisions,{now,day}){
 const at=new Date(now).toISOString(),byId=prior instanceof Map?prior:new Map(arr(prior).map(e=>[e.id,e])),out=new Map();
 for(const d of arr(decisions)){
  const id=pbsId(day,d),old=out.get(id)||byId.get(id);
  const next=old?{...old,...d,...(old.firstFiredAt?{before:old.before,after:old.after,play:old.play??d.play}:{}),id,day,firstAt:old.firstAt,lastAt:at,firstFiredAt:old.firstFiredAt||(d.wouldFire?at:null),seen:(old.seen||1)+1,firstMetrics:old.firstMetrics??null,manager:old.manager??null,owner:old.owner??null,grade:old.grade??null}
   :{...d,id,day,firstAt:at,lastAt:at,firstFiredAt:d.wouldFire?at:null,seen:1,firstMetrics:d.metrics||null,manager:null,owner:null,grade:null};
  out.set(id,forcePlaybookFields(next));
 }
 return [...out.values()];
}

/**
 * Grades of play decisions: the Sombra's own D+1 verdict (shadowGrades, unchanged), plus, on `pbs:*` only (contract d.8):
 * - `grade.d3`: the closed 3 days after the decision (D+1..D+3; D..D+2 for a night raise), once Malva's ~72 h settle;
 * - `grade.pauseProxy` for a pause someone did make: 'revertida' (a person reactivated within 48 h: wrong) or, when it
 *   held 48 h with a pre-pause ROI below 1, 'provavel-acerto' (labelled as such, never counted as right); else null;
 * - `grade.opposite`: a person did the opposite within 12 h (the play said cut and someone raised, or the reverse).
 * @param {any[]} entries @param {{snapshots:any[],moves?:any[],now:number}} options moves: people's learnable moves (team-learning)
 */
export function gradePlaybook(entries,{snapshots,moves=[],now}){
 // The night raise acts on the day it fires (00:00–00:30), like the Sombra's night increase: graded by that same day.
 const graded=shadowGrades(arr(entries).map(e=>({...e,firstWouldExecuteAt:null,alertOnly:false,...(e?.rule==='pb:night-raise'?{rule:'night-increase'}:{})})),snapshots)
  .map((g,i)=>arr(entries)[i]?.rule==='pb:night-raise'?{...g,rule:'pb:night-raise'}:g);
 const d3s=arr(snapshots).filter(s=>s?.period==='3d'&&s.level==='campaign'&&s.complete===true&&s.source==='Malva MCP');
 const byObj=new Map();for(const m of arr(moves)){if(!m?.objectId)continue;const k=String(m.objectId);if(!byObj.has(k))byObj.set(k,[]);byObj.get(k).push(m);}
 for(const l of byObj.values())l.sort((a,b)=>time(a.at)-time(b.at)||String(a.id).localeCompare(String(b.id)));
 return graded.map(e=>{
  if(!e?.day)return forcePlaybookFields(e);
  const kind=decisionKind(e),grade={...(e.grade||{})},start=time(e.firstAt),list=byObj.get(String(e.objectId))||[];
  if(!grade.d3){
   const from=e.rule==='pb:night-raise'?e.day:shiftDay(e.day,1);
   const s=d3s.find(x=>x.projectId===e.project&&localDayOf(time(x.from),x.timezone)===from&&Math.abs(time(x.to)-time(x.from)-3*86400000)<=3600000);
   if(s){const row=arr(s.rows).find(r=>r?.adAccountId===e.adAccountId&&r?.externalId===e.objectId),m=row?sum([row]):null;
    if(!m)grade.d3={spend:0,result:null,roi:null,verdict:'parou'};
    else if(finite(m.spend)&&(!(m.spend>0)||finite(m.result))){const cut=cutKinds.has(kind);grade.d3={spend:Math.round(m.spend*100)/100,result:finite(m.result)?Math.round(m.result*100)/100:null,roi:r3(m.roi),verdict:!(m.spend>0)?'parou':(cut?m.result<0:m.result>0)?'acertou':'errou'};}}
  }
  if(kind==='pause'&&grade.pauseProxy==null){
   const paused=[e.manager,e.owner].filter(x=>x&&finite(time(x.at))).sort((a,b)=>time(a.at)-time(b.at))[0];
   if(paused){const pAt=time(paused.at),back=list.find(m=>m.kind==='activate'&&time(m.at)>pAt&&time(m.at)<=pAt+playbookEvalPolicy.pauseProxyMs);
    const roi=e.firstMetrics?.roi??e.metrics?.roi;
    if(back)grade.pauseProxy='revertida';else if(now>=pAt+playbookEvalPolicy.pauseProxyMs)grade.pauseProxy=finite(roi)&&roi<playbookEvalPolicy.provavelAcertoRoi?'provavel-acerto':null;
    if(grade.pauseProxy===undefined)delete grade.pauseProxy;}
  }
  if(grade.opposite===undefined||grade.opposite===null&&now<start+playbookEvalPolicy.oppositeMs){
   const want=cutKinds.has(kind)?raiseKinds:raiseKinds.has(kind)?cutKinds:null;
   const o=want&&list.find(m=>want.has(m.kind)&&time(m.at)>=start&&time(m.at)<=start+playbookEvalPolicy.oppositeMs);
   if(o)grade.opposite={person:o.person||null,name:o.name||null,kind:o.kind,at:o.at};else if(now>=start+playbookEvalPolicy.oppositeMs)grade.opposite=null;
  }
  return forcePlaybookFields({...e,grade:Object.keys(grade).length?grade:e.grade??null});
 });
}

/** The verdict a play decision is reported with: D+3 when final, else D+1; a reverted pause is wrong. */
export function reportedVerdict(e){
 const g=e?.grade;if(!g)return null;if(g.pauseProxy==='revertida')return 'errou';
 const v3=g.d3?.verdict;if(v3==='acertou'||v3==='errou')return v3;
 return g.verdict==='acertou'||g.verdict==='errou'?g.verdict:null;
}
/**
 * Score of each play version (`playKey` × `ruleRev`) over the stored decisions, in the fixed rules' RuleScore shape
 * (contract a.5): graded, right, accuracy with a 95% range, the last 7 days vs the 7 before, winner cuts.
 * `stage` is the play stage (Phase 1: 'observando' | 'candidata'), passed in by the caller.
 * @param {any[]} entries @param {{now:number,stageOf?:(playKey:string)=>string,labelOf?:(playKey:string)=>string|null,revOf?:(playKey:string)=>string|null}} options
 */
export function playScores(entries,{now,stageOf=()=>'observando',labelOf=()=>null,revOf=()=>null}){
 return scoreFinalize(scoreAccumulate({},entries,{now}),{stageOf,labelOf,revOf});
}
/** Adds a page of stored play decisions to running per-version counters (a listing can be scored page by page). */
export function scoreAccumulate(acc,entries,{now}){
 const today=localDayOf(now,'America/Sao_Paulo'),ti=dayIndex(today||'1970-01-01'),out=acc&&typeof acc==='object'?acc:{};
 for(const e of arr(entries)){
  if(e?.source!=='playbook'||!e.playKey)continue;const k=e.playKey+'|'+(e.ruleRev||'');
  if(!out[k])out[k]={playKey:e.playKey,rev:e.ruleRev||null,graded:0,right:0,winnersCut:0,recent:[0,0],previous:[0,0],revertida:0,provavelAcerto:0,opposite:0,entries:0};
  const a=out[k],v=reportedVerdict(e),age=ti-dayIndex(e.day);a.entries++;
  if(e.grade?.pauseProxy==='provavel-acerto')a.provavelAcerto++;if(e.grade?.pauseProxy==='revertida')a.revertida++;if(e.grade?.opposite)a.opposite++;
  if(v){a.graded++;if(v==='acertou')a.right++;if(e.grade?.winnerCut)a.winnersCut++;const t=age<playbookEvalPolicy.recentDays?a.recent:age<2*playbookEvalPolicy.recentDays?a.previous:null;if(t){t[0]++;if(v==='acertou')t[1]++;}}
 }
 return out;
}
/**
 * RuleScore per play (current version only when `revOf` knows it). The challenger's own score (`challengerOf` gives its
 * rev) rides along as `challenger:{rev, graded, right, accuracy, low, high}`, never mixed with the version in use.
 */
export function scoreFinalize(acc,{stageOf=()=>'observando',labelOf=()=>null,revOf=()=>null,challengerOf=()=>null}={}){
 const out={},next={};
 for(const a of Object.values(acc||{})){
  const cur=revOf(a.playKey),ch=challengerOf(a.playKey);
  if(ch&&a.rev===ch&&a.rev!==cur){next[a.playKey]={rev:a.rev,graded:a.graded,right:a.right,accuracy:a.graded?r3(a.right/a.graded):null,...wilson(a.right,a.graded)};continue;}
  if(cur&&a.rev!==cur)continue;
  out[a.playKey]={rev:a.rev,label:labelOf(a.playKey),graded:a.graded,right:a.right,accuracy:a.graded?r3(a.right/a.graded):null,...wilson(a.right,a.graded),base:null,chanceBetter:null,
   trend:{recent:{graded:a.recent[0],accuracy:a.recent[0]?r3(a.recent[1]/a.recent[0]):null},previous:{graded:a.previous[0],accuracy:a.previous[0]?r3(a.previous[1]/a.previous[0]):null}},
   winnersCut:a.winnersCut,stage:stageOf(a.playKey),gate:null,proxy:{revertida:a.revertida,provavelAcerto:a.provavelAcerto},opposite:a.opposite,entries:a.entries};
 }
 for(const [k,c] of Object.entries(next))if(out[k])out[k].challenger=c;
 return out;
}

/**
 * Forward-only replay of one day (spec §3.4 `replayAgreement`): each template is fitted only on the bins of days before
 * `day` (no bootstrap), then tested on that day's cells. Never reads a later bin: bins dated `day` or after are ignored for
 * the fit, and only `day` is tested. A template whose training set is below the play's minimum support (8 moves, 4
 * campaigns, 3 days) is not evaluable that day (`fit:false`) and counts in no agreement. Per template: fired and agreeing
 * units (a move, or a campaign-day without a move), team moves and how many the play caught, lead time, opposite moves,
 * and per person.
 * @param {any[]} bins this project's bins @param {{project:string,day:string,counter?:{n:number},templates?:any[]}} options
 */
export function replayDay(bins,{project,day,counter={n:0},templates=playTemplates}){
 const test=arr(bins).find(b=>b?.project===project&&b.day===day);if(!test)return {};
 const corpus=playCorpus({fitDay:day,templates,divergence:false,outcome:false});
 for(const b of arr(bins).filter(b=>b?.project===project&&b.day<day).sort((a,c)=>String(a.day).localeCompare(String(c.day))))corpus.add(b);
 return replayDayFrom(corpus,test,{project,day,counter,templates});
}
/** replayDay on a playCorpus fed with the bins of the days before `day` (the runner's streaming path) and the test bin. */
export function replayDayFrom(corpus,test,{project,day,counter={n:0},templates=playTemplates}){
 const out={};if(!test||test.project!==project||test.day!==day||corpus?.fitDay!==day)return out;
 const cells=binCells(test),P=playbookPolicy;
 for(const t of templates){
  const set=corpus.examples(t.id);
  if(set.moves<P.minMoves||set.campaigns<P.minCampaigns||set.days<P.minDays){const pos=new Set(cells.filter(c=>c.label===t.kind).map(c=>c.mv||c.camp));if(pos.size)out[t.id]={fired:0,agree:0,moves:pos.size,caught:0,lead:null,opposite:0,manter:0,people:{},fit:false};continue;}
  const fit=fitTemplate(t,set,{seed:[t.id,project,day,'replay'].join('|'),counter,bootstrap:false});
  const params=Object.fromEntries(t.params.map((p,i)=>[p.name,fit.theta[i]]));
  const fired=new Map(),moves=new Map(),people={};
  for(const c of cells){
   if(c.label===t.kind&&c.mv){if(!moves.has(c.mv))moves.set(c.mv,{person:c.person,caught:false,lead:null});}
   if(c.person&&labelKinds.includes(c.label)){people[c.person]=people[c.person]||{moves:new Set(),caught:new Set(),fired:new Set(),agree:new Set()};if(c.label===t.kind)people[c.person].moves.add(c.mv);}
   if(!matchPlay(t,params,c))continue;counter.n++;
   const unit=c.mv||('c:'+c.camp);
   if(!fired.has(unit))fired.set(unit,{label:c.label,person:c.person});
   if(c.label===t.kind&&c.mv){const m=moves.get(c.mv);m.caught=true;if(finite(c.lead))m.lead=Math.max(m.lead??-Infinity,c.lead);}
   if(c.person&&people[c.person]&&labelKinds.includes(c.label)){people[c.person].fired.add(unit);if(c.label===t.kind)people[c.person].agree.add(unit);}
  }
  for(const [mv,m] of moves)if(m.caught&&m.person&&people[m.person])people[m.person].caught.add(mv);
  const units=[...fired.values()],cut=cutKinds.has(t.kind);
  const leads=[...moves.values()].filter(m=>m.caught&&finite(m.lead)).map(m=>m.lead);
  out[t.id]={fired:units.length,agree:units.filter(u=>u.label===t.kind).length,moves:moves.size,caught:[...moves.values()].filter(m=>m.caught).length,
   lead:leads.length?quantile(leads,0.5):null,leads:leads.slice(0,playbookEvalPolicy.maxReplayCases),
   opposite:units.filter(u=>(cut?raiseKinds:cutKinds).has(u.label)).length,manter:units.filter(u=>u.label==='manter').length,fit:true,
   people:Object.fromEntries(Object.entries(people).map(([p,x])=>[p,[x.moves.size,x.caught.size,x.fired.size,x.agree.size]]))};
 }
 return out;
}
const evaluable=d=>d&&d.fit!==false;

/**
 * Agreement over replayed days (contract a.4 `Agreement`): precision ("Concorda com vocês") = agreeing / fired units,
 * recall ("Cobertura") = caught / team moves, lead ("Antecedência", median minutes), opposite share of fired, Wilson range
 * of the precision. Two sample sizes, each with its own rate: `fired` (the precision's and the range's denominator: the
 * times the play would have acted) and `n` (the team moves, the recall's). Days that were not evaluable (training set
 * under the minimum support) count in neither. A rate is null when its own denominator is 0.
 * @param {any[]} days replayDay results of one template (one per day)
 */
export function replayAgreement(days){
 let fired=0,agree=0,moves=0,caught=0,opposite=0;const leads=[];
 for(const d of arr(days)){if(!evaluable(d))continue;fired+=d.fired||0;agree+=d.agree||0;moves+=d.moves||0;caught+=d.caught||0;opposite+=d.opposite||0;leads.push(...arr(d.leads));}
 if(!moves&&!fired)return {precision:null,recall:null,leadMin:null,opposite:null,low:null,high:null,n:0,fired:0,agree:0};
 const w=fired?wilson(agree,fired):{low:null,high:null};
 return {precision:fired?r3(agree/fired):null,recall:moves?r3(caught/moves):null,leadMin:leads.length?quantile(leads,0.5):null,opposite:fired?r3(opposite/fired):null,low:w.low,high:w.high,n:moves,fired,agree};
}
/**
 * Agreement of the plays with one person: of that person's moves, how many a play caught (recall, "pegou X de Y
 * movimentos seus"). No per-person precision: quiet `manter` cells carry no person, so a play's firings cannot be split by
 * who was at the desk, and a precision over only that person's moves would overstate it.
 */
export function personAgreement(days,person){
 let moves=0,caught=0;
 for(const d of arr(days)){if(!evaluable(d))continue;const x=d?.people?.[person];if(!x)continue;moves+=x[0];caught+=x[1];}
 if(!moves)return {precision:null,recall:null,leadMin:null,opposite:null,low:null,high:null,n:0,fired:0,agree:0,caught:0};
 const w=wilson(caught,moves);return {precision:null,recall:r3(caught/moves),leadMin:null,opposite:null,low:w.low,high:w.high,n:moves,fired:0,agree:0,caught};
}
/** "Teria feito nos últimos 7 dias": fired units, the ones equal to a team move, and the ones nobody made. */
export function wouldHave(days){
 let total=0,same=0,nobody=0,any=false;for(const d of arr(days)){if(!evaluable(d))continue;any=true;total+=d.fired||0;same+=d.agree||0;nobody+=d.manter||0;}
 return any?{total,sameAsTeam:same,nobodyDid:nobody}:null;
}
/** Short id of a replay unit (tests). */
export const unitId=(day,unit)=>shortId(['unit',day,unit]);
