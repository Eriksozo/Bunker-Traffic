/**
 * Long memory of the Sombra (owner request of 09/11/2026: "o Bunk deve ficar mais inteligente a cada dia com tudo o
 * que ele está acompanhando"). The Sombra keeps its decisions for 7 days (shadowPolicy.retentionDays). This module keeps,
 * for `learningPolicy.retentionDays`, in Durable Object shards `learn:<day>:<project>`:
 * - a compact record of every decision already graded by the real next day, with the rule version it was born under;
 * - the base of each project and day: of the active Meta campaigns that already ran the day before (the only ones a
 *   decision could be about), the share that lost and that made money. It is what picking any campaign scores: a cut is
 *   right on a losing day, a raise on a profitable one, so a rule only adds something above that share.
 * People's own moves live in `learn:<day>:<project>:team` (lib/team-learning.mjs); blind spots come from there.
 *
 * Per rule and rule × project: hits, misses, an honest 95% range (Wilson), a recency-weighted accuracy (half-life), a
 * small-sample estimate pulled toward the rule's own rate (empirical Bayes), the edge over picking any campaign and the
 * chance the rule picks better (Jeffreys Beta posterior), the last 7 days against the 7 before, distinct campaigns behind
 * the numbers, who acted first (manager, Sombra blocked, Sombra executable), and short lessons for the owner.
 * Method and external references: docs/autonomy-policy.md, "Memória da Sombra".
 *
 * Pure and read-only. A lesson is a reading for the owner, never a change of threshold. The owner's score gate keeps its
 * own 7-day count (ruleAccuracy): the memory may only keep a rule as a suggestion, never open it earlier (gateAccuracy).
 */
import {sum} from './analysis.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {shadowRulePolicy,shadowRules,entryRuleVersion} from './autonomy-shadow.mjs';
import {shortId,betaCdf,chanceAbove,wilson,entryKind,isCutKind,getFrom,coveredAt,twoProportionZ} from './learning-math.mjs';
import {teamStats,teamLines,teamPolicy,ownerLabel} from './team-learning.mjs';

export {shortId,betaCdf,chanceAbove,wilson,entryKind,isCutKind};
export const learningPolicy=Object.freeze({version:2,baseVersion:2,retentionDays:90,maxRecordsPerShard:400,minSpendCases:3,minTrendGraded:15,
 halfLifeDays:21,recentDays:7,z:1.96,priorStrength:10,minGradedLesson:6,minEdgeGraded:10,minCampaignsClaim:5,minDaysClaim:3,
 baseMinCampaigns:3,beatsBaseSure:0.9,summaryEveryMs:10*60000,summaryMaxAgeMs:60*60000,gateMaxAgeMs:2*60*60000,maxLessons:8});

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const text=v=>typeof v==='string'&&v.length>0;
const dayRe=/^\d{4}-\d{2}-\d{2}$/;
const pct=x=>finite(x)?Math.round(x*100):null;
const round3=x=>finite(x)?Math.round(x*1000)/1000:null;
const brl=x=>'R$'+Math.round(x).toLocaleString('pt-BR');
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
const localDay=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};
const dayIndex=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const median=list=>{const s=list.filter(finite).sort((a,b)=>a-b);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const okey=(project,account,object)=>JSON.stringify([project,account??null,object]);

/**
 * Compact records of Sombra decisions whose grade is final ("acertou", "errou" or "parou"; "N/D" stays open).
 * `rv`: the rule version the entry was born under (entryRuleVersion; null when unknown: never counted as current).
 * `manager`: 'before' (he acted before the Sombra first pointed it out), 'blocked' (the Sombra pointed it out first but
 * could not execute yet) or 'after' (he followed an executable decision). `spend`: Malva spend of the first flag.
 */
export function learningRecords(entries){
 const out=[];
 for(const e of arr(entries)){
  const verdict=e?.grade?.verdict;
  if(!['acertou','errou','parou'].includes(verdict)||!text(e.day)||!dayRe.test(e.day)||!text(e.rule)||!text(e.project))continue;
  const kind=entryKind(e);if(!kind)continue;
  const exec=time(e.firstWouldExecuteAt),mAt=time(e.manager?.at),first=time(e.firstAt);
  const manager=!e.manager?null:finite(exec)&&finite(mAt)&&mAt>exec?'after':finite(mAt)&&finite(first)&&mAt>first?'blocked':'before';
  const spend=e.firstMetrics?.spend,basisRoi=(e.grade?.basis==='day'?e.grade?.day:e.grade?.next)?.roi;
  out.push({id:shortId(e.id||[e.day,e.rule,e.project,e.adAccountId,e.objectId,e.action]),day:e.day,rule:e.rule,project:e.project,kind,verdict,
   // The day the verdict reads: D itself for the night increase (it acts on D), D+1 for everything else.
   target:e.grade?.basis==='day'||e.rule==='night-increase'?e.day:shiftDay(e.day,1),
   obj:shortId(['obj',e.project,e.adAccountId??null,e.objectId]),nat:shortId(['nat',e.day,e.rule,String(e.objectId??''),e.action]),
   winnerCut:e.grade?.winnerCut===true,wouldExecute:!!e.firstWouldExecuteAt,manager,owner:!!e.owner,
   spend:finite(spend)?Math.round(spend*100)/100:null,roi:finite(basisRoi)?round3(basisRoi):null,launchDay:finite(e.launchDay)?e.launchDay:null,
   rv:entryRuleVersion(e)});
 }
 return out;
}

/**
 * Base of each project and day from complete closed "yesterday" windows (Malva): of the active Meta campaigns that
 * spent that day AND before it (3d spend above yesterday's: a first-spend campaign cannot be the object of a decision
 * graded by that day), warm-up out, how many lost and how many made money. Without an aligned 3d window: no base.
 */
export function dailyBases(snapshots){
 const out=new Map(),list=arr(snapshots);
 for(const s of list){
  if(s?.period!=='yesterday'||s.level!=='campaign'||s.complete!==true||s.source!=='Malva MCP'||!text(s.projectId))continue;
  const t=time(s.from);if(!finite(t))continue;const day=localDay(t,s.timezone);if(!day)continue;
  const d3s=list.filter(x=>x?.projectId===s.projectId&&x.period==='3d'&&x.level==='campaign'&&x.complete===true&&x.source==='Malva MCP'&&time(x.to)===time(s.to));
  if(d3s.length!==1)continue;
  const d3=new Map(arr(d3s[0].rows).map(r=>[okey(s.projectId,r?.adAccountId,r?.externalId),r]));
  let campaigns=0,loss=0,profit=0;
  for(const row of arr(s.rows)){
   if(row?.provider&&row.provider!=='meta')continue;if(isWarmupCampaign(row?.name))continue;
   const r=sum([row]);if(!(finite(r.spend)&&r.spend>0)||!finite(r.result))continue;
   const before=d3.get(okey(s.projectId,row.adAccountId,row.externalId));
   if(!before||!finite(before.spend)||before.spend-r.spend<0.01)continue;
   campaigns++;if(r.result<0)loss++;else if(r.result>0)profit++;
  }
  if(campaigns)out.set(`${s.projectId}|${day}`,{day,project:s.projectId,campaigns,loss,profit});
 }
 return [...out.values()];
}

/** Objects the Sombra evaluates, from the snapshots: Meta campaign rows outside warm-up. */
export function shadowObjects(snapshots){
 const out=new Set();
 for(const s of arr(snapshots)){
  if(s?.level!=='campaign'||!text(s.projectId))continue;
  for(const r of arr(s.rows))if((r?.provider||'meta')==='meta'&&(!r.level||r.level==='campaign')&&text(r.externalId)&&!isWarmupCampaign(r.name))out.add(okey(s.projectId,r.adAccountId,r.externalId));
 }
 return out;
}

/** Storage key of one day × project shard of the memory. */
export const learningKey=(day,project)=>`learn:${day}:${project}`;
/** Day of a memory key, or null. */
export const learningKeyDay=key=>{const d=String(key).split(':')[1];return dayRe.test(d)?d:null;};
/** Keys a batch of records and bases touches (read them before mergeLearning). */
export const learningKeys=(...lists)=>[...new Set(lists.flatMap(l=>arr(l)).filter(x=>text(x?.day)&&text(x?.project)).map(x=>learningKey(x.day,x.project)))];

/**
 * Upserts records and bases into their day × project shards. `existing`: Map (any realm) or object key → stored shard
 * (only the touched keys need to be read). A base is kept from its first reading, the same one that froze the grades
 * (shadowGrades freezes at first read). Returns the shards that changed and, from `keys`, those past retention.
 * @param {any} existing @param {any[]} records @param {{now?:number,bases?:any[],keys?:string[]}} [options]
 */
export function mergeLearning(existing,records,{now=Date.now(),bases=[],keys=[]}={}){
 const cut=dayIndex(localDay(now,'America/Sao_Paulo'))-learningPolicy.retentionDays;
 const shards=new Map(),changed=new Set();
 const shard=(day,project)=>{const k=learningKey(day,project);if(!shards.has(k)){const old=getFrom(existing,k);shards.set(k,{day,project,records:{...(old?.records||{})},base:old?.base||null,bv:old?.bv??null,...(old?.full?{full:true}:{})});}return [k,shards.get(k)];};
 for(const r of arr(records)){
  if(!text(r?.day)||dayIndex(r.day)<cut)continue;const [k,s]=shard(r.day,r.project),old=s.records[r.id];
  if(old&&JSON.stringify(old)===JSON.stringify(r))continue;
  // A full shard is flagged once (never rewritten every pass): the summary says the memory missed decisions that day.
  if(!old&&Object.keys(s.records).length>=learningPolicy.maxRecordsPerShard){if(!s.full){s.full=true;changed.add(k);}continue;}
  s.records[r.id]=r;changed.add(k);
 }
 // A base of an older definition (before the 3d filter) is replaced once by the current one, then frozen.
 for(const b of arr(bases)){if(!text(b?.day)||dayIndex(b.day)<cut)continue;const [k,s]=shard(b.day,b.project);if(s.base&&s.bv===learningPolicy.baseVersion)continue;s.base={campaigns:b.campaigns,loss:b.loss,profit:b.profit};s.bv=learningPolicy.baseVersion;changed.add(k);}
 const drop=arr(keys).filter(k=>{const d=learningKeyDay(k);return !!d&&dayIndex(d)<cut;});
 return {put:Object.fromEntries([...changed].map(k=>[k,shards.get(k)])),drop};
}

function tally(list,{todayIdx,prior=null,baseOf}){
 const graded=list.filter(r=>r.verdict==='acertou'||r.verdict==='errou'),right=graded.filter(r=>r.verdict==='acertou').length,n=graded.length;
 let wr=0,wn=0;for(const r of graded){const w=Math.pow(0.5,Math.max(0,todayIdx-dayIndex(r.day))/learningPolicy.halfLifeDays);wn+=w;if(r.verdict==='acertou')wr+=w;}
 const recent=graded.filter(r=>todayIdx-dayIndex(r.day)<learningPolicy.recentDays),before=graded.filter(r=>{const a=todayIdx-dayIndex(r.day);return a>=learningPolicy.recentDays&&a<2*learningPolicy.recentDays;});
 const rate=l=>l.length?round3(l.filter(r=>r.verdict==='acertou').length/l.length):null;
 // Against picking any campaign: only decisions whose target day has a known base, so both sides read the same days.
 const based=graded.map(r=>[r,baseOf(r)]).filter(([,b])=>finite(b)),bk=based.filter(([r])=>r.verdict==='acertou').length;
 const expected=based.length?based.reduce((s,[,b])=>s+b,0)/based.length:null;
 const cuts=graded.filter(r=>isCutKind(r.kind)),m=learningPolicy.priorStrength,pr=finite(prior)?prior:null;
 const distinct=l=>new Set(l.map(r=>r.obj||r.id)).size;
 return {graded:n,right,wrong:n-right,accuracy:n?round3(right/n):null,...wilson(right,n),campaigns:distinct(graded),days:new Set(graded.map(r=>r.target)).size,
  weighted:wn>0?round3(wr/wn):null,
  // Small samples pulled toward the rule's overall rate (a prior worth `priorStrength` decisions).
  shrunk:pr===null||!n?null:round3((right+m*pr)/(n+m)),
  base:{graded:based.length,accuracy:based.length?round3(bk/based.length):null,...wilson(bk,based.length),expected:round3(expected),
   edge:based.length?round3(bk/based.length-expected):null,chanceBetter:based.length?chanceAbove(bk,based.length,expected):null,
   campaigns:distinct(based.map(([r])=>r)),days:new Set(based.map(([r])=>r.target)).size},
  stopped:list.filter(r=>r.verdict==='parou').length,winnersCut:graded.filter(r=>r.winnerCut).length,winnersCutCampaigns:distinct(graded.filter(r=>r.winnerCut)),
  spendCases:{right:cuts.filter(r=>r.verdict==='acertou'&&finite(r.spend)).length,wrong:cuts.filter(r=>r.verdict==='errou'&&finite(r.spend)).length},
  recentRight:recent.filter(r=>r.verdict==='acertou').length,previousRight:before.filter(r=>r.verdict==='acertou').length,
  recent:{graded:recent.length,accuracy:rate(recent)},previous:{graded:before.length,accuracy:rate(before)},
  managerBefore:list.filter(r=>r.manager==='before').length,managerBlocked:list.filter(r=>r.manager==='blocked').length,managerAfter:list.filter(r=>r.manager==='after').length,owner:list.filter(r=>r.owner).length,
  spendRight:median(cuts.filter(r=>r.verdict==='acertou').map(r=>r.spend)),spendWrong:median(cuts.filter(r=>r.verdict==='errou').map(r=>r.spend))};
}

/**
 * Cuts by a person (owner or manager) the Sombra had not pointed out (no Sombra cut of either kind on the object active
 * in the 36 h before): blind spots, from the team moves (lib/team-learning.mjs), only where the Sombra was evaluating
 * the project in that hour (`coverage`: hours with a Sombra pass). Raises it did not propose are counted apart.
 */
function blindSpotsOf(teamActions,{todayIdx,coverage}){
 const covered=a=>coveredAt(coverage,a.project,a.at);
 const recent=arr(teamActions).filter(a=>todayIdx-dayIndex(a.day)<learningPolicy.recentDays&&covered(a)&&(a.who==='owner'||a.who==='team'));
 const cuts=recent.filter(a=>isCutKind(a.kind)&&!a.shadow?.cutFlagged&&!a.shadow?.flagged),raises=recent.filter(a=>a.kind==='increase'&&!a.shadow?.flagged);
 const byProject={},bucket=p=>byProject[p]||(byProject[p]={pause:0,reduce:0,increase:0,owner:0,manager:0});
 for(const a of cuts){const b=bucket(a.project);b[a.kind]++;b[a.who==='owner'?'owner':'manager']++;}
 for(const a of raises)bucket(a.project).increase++;
 return {days:learningPolicy.recentDays,total:cuts.length,increases:raises.length,byProject,
  recent:cuts.sort((a,b)=>time(b.at)-time(a.at)).slice(0,10).map(a=>({day:a.day,project:a.project,kind:a.kind,by:a.who==='owner'?'owner':'manager',at:a.at,adAccountId:a.adAccountId,objectId:a.objectId}))};
}

/**
 * Score of every rule from the memory: overall, per project, against the base and for the current rule version;
 * plus the team's patterns (lib/team-learning.mjs) and the blind spots that come from them.
 * @param {any[]} shards stored `learn:` values (Sombra and team shards)
 * @param {{now?:number,names?:Record<string,string>,coverage?:Record<string,string[]>,paramsOf?:(project:string)=>any}} [options]
 *   names: project id → name; coverage: project id → hour stamps with a Sombra pass; paramsOf: current private params
 *   (proposals compare with the pause point in force now)
 */
export function learningStats(shards,{now=Date.now(),names={},coverage={},paramsOf=()=>({})}={}){
 const todayIdx=dayIndex(localDay(now,'America/Sao_Paulo'));
 const records=[],seen=new Set(),bases=new Map(),team=[],teamShards=[];
 for(const s of arr(shards)){
  if(s?.kind==='team'){teamShards.push(s);for(const a of Object.values(s.actions||{}))team.push(a);continue;}
  for(const r of Object.values(s?.records||{}))if(!seen.has(r.id)){seen.add(r.id);records.push(r);}
  if(s?.base&&s.bv===learningPolicy.baseVersion&&s.base.campaigns>=learningPolicy.baseMinCampaigns&&text(s.day)&&text(s.project))bases.set(`${s.project}|${s.day}`,s.base);
 }
 const baseOf=r=>{const b=bases.get(`${r.project}|${r.target}`);if(!b)return null;return (isCutKind(r.kind)?b.loss:b.profit)/b.campaigns;};
 const days=[...new Set(records.map(r=>r.day))].sort(),dayBy={};
 for(const r of records)(dayBy[r.project]||=new Set()).add(r.day);
 const rules={},current={},byProjects=(list,all)=>{const out={};for(const p of [...new Set(list.map(r=>r.project))])out[p]=tally(list.filter(r=>r.project===p),{todayIdx,prior:all.accuracy,baseOf});return out;};
 // Rule-wide numbers count one campaign-day decision once even when two projects share the campaign (a miss wins);
 // each project's own numbers keep its copy.
 const native=list=>{const m=new Map();for(const r of list){const k=r.nat||r.id,o=m.get(k);if(!o||o.verdict!=='errou'&&r.verdict==='errou')m.set(k,r);}return [...m.values()];};
 for(const rule of Object.keys(shadowRules)){
  const own=records.filter(r=>r.rule===rule);if(!own.length)continue;const list=native(own);
  const all=tally(list,{todayIdx,baseOf}),curList=list.filter(r=>r.rv===shadowRulePolicy.version),cur=tally(curList,{todayIdx,baseOf});
  rules[rule]={label:shadowRules[rule],...all,currentVersion:{version:shadowRulePolicy.version,graded:cur.graded,right:cur.right,accuracy:cur.accuracy,low:cur.low,high:cur.high,base:cur.base},projects:byProjects(own,all)};
  // Lessons, the notch line and any advice read only the decisions of the rules in force.
  const curOwn=own.filter(r=>r.rv===shadowRulePolicy.version);
  if(curList.length)current[rule]={label:shadowRules[rule],...cur,projects:byProjects(curOwn,cur)};
 }
 const graded=records.filter(r=>r.verdict==='acertou'||r.verdict==='errou'),right=graded.filter(r=>r.verdict==='acertou').length;
 const stats={version:learningPolicy.version,ruleVersion:shadowRulePolicy.version,at:new Date(now).toISOString(),
  memory:{days:days.length,from:days[0]||null,to:days.at(-1)||null,records:records.length,bases:bases.size,teamActions:team.length,retentionDays:learningPolicy.retentionDays,
   byProject:Object.fromEntries(Object.entries(dayBy).map(([p,set])=>{const d=[...set].sort();return [p,{days:d.length,from:d[0]}];}))},
  overall:{graded:graded.length,right,accuracy:graded.length?round3(right/graded.length):null,...wilson(right,graded.length)},rules,current,
  full:shards.filter(s=>s?.full).length,
  blindSpots:blindSpotsOf(team,{todayIdx,coverage}),team:teamStats(teamShards,{now,names,coverage,paramsOf})};
 const projectIds=[...new Set([...records.map(r=>r.project),...Object.keys(stats.blindSpots.byProject)])];
 const projectLessons=Object.fromEntries(projectIds.map(p=>[p,learningLessons({
  rules:Object.fromEntries(Object.entries(current).filter(([,t])=>t.projects?.[p]).map(([r,t])=>[r,{...t.projects[p],label:t.label,projects:{}}])),
  blindSpots:{byProject:stats.blindSpots.byProject[p]?{[p]:stats.blindSpots.byProject[p]}:{}}},{names,scope:p})]));
 return {...stats,lessons:learningLessons({rules:current,blindSpots:stats.blindSpots},{names}),projectLessons};
}

/**
 * What the owner's score gate reads (same shape as ruleAccuracy). The 7-day count of the current rule version
 * (`fallback`, ruleAccuracy) decides as before; the long memory only vetoes: with 20+ graded decisions of the current
 * version below 60%, the rule stays a suggestion even after a good week. It never opens the gate earlier. When the week
 * passes but the memory is missing, from another rule or memory version, or older than `gateMaxAgeMs`, the rule stays a
 * suggestion ('memory-unavailable'). Accuracy is the exact ratio (no rounding).
 * @param {any} stats @param {string} rule @param {any} [fallback] @param {{now?:number}} [options] @returns {any}
 */
export function gateAccuracy(stats,rule,fallback=null,{now=Date.now()}={}){
 const min=shadowRulePolicy.badDayMinGraded,need=shadowRulePolicy.badDayMinAccuracy;
 const proven=a=>!!a&&a.graded>=min&&a.right/a.graded>=need;
 if(!proven(fallback))return fallback;
 // Fails closed: with the week proven, a missing, foreign or stale memory keeps the rule a suggestion for this pass
 // (storeLearning rebuilds it at the end of the same pass). Age never lifts a veto.
 const age=now-time(stats?.at);
 if(!stats||stats.version!==learningPolicy.version||stats.ruleVersion!==shadowRulePolicy.version||!(age>=0&&age<=learningPolicy.gateMaxAgeMs))
  return {graded:fallback.graded,right:fallback.right,accuracy:null,source:'memory-unavailable'};
 const c=stats.rules?.[rule]?.currentVersion;
 if(c&&c.version===shadowRulePolicy.version&&c.graded>=min&&c.right/c.graded<need)return {graded:c.graded,right:c.right,accuracy:c.right/c.graded,source:'memory'};
 return fallback;
}

/**
 * Short lessons in pt-BR for the owner, strongest evidence first. Readings, never a change of threshold. A claim of edge
 * needs enough decisions, campaigns and days, and always carries its range.
 * @param {any} stats @param {{names?:Record<string,string>,scope?:string|null}} [options] scope: a project id for project lessons
 */
export function learningLessons(stats,{names={},scope=null}={}){
 const out=[],min=learningPolicy.minGradedLesson,name=p=>names[p]||'projeto';
 const range=t=>t.low===null||t.low===undefined?'':` (faixa provável ${pct(t.low)}–${pct(t.high)}%)`;
 const where=scope?` em ${name(scope)}`:'';
 for(const [rule,t] of Object.entries(stats?.rules||{})){
  const label=(t.label||rule)+where,b=t.base||{},verb=rule.endsWith('-increase')?'aumentar':'cortar';
  const enough=x=>x.graded>=learningPolicy.minEdgeGraded&&x.campaigns>=learningPolicy.minCampaignsClaim&&x.days>=learningPolicy.minDaysClaim;
  if(finite(b.chanceBetter)&&finite(b.accuracy)&&enough(b)&&b.accuracy>=0.5&&b.chanceBetter>=learningPolicy.beatsBaseSure)
   out.push({weight:3,kind:'vantagem',rule,text:`${label}: acerta ${pct(b.accuracy)}%${range(b)} contra ${pct(b.expected)}% de ${verb} uma campanha qualquer do projeto no mesmo dia, em ${b.graded} decisões de ${b.campaigns} campanhas (chance de escolher melhor: ${b.chanceBetter>=0.95?'95% ou mais':pct(b.chanceBetter)+'%'}).`});
  else if(finite(b.chanceBetter)&&b.graded>=min&&b.chanceBetter<0.5)
   out.push({weight:5,kind:'sem-vantagem',rule,text:`${label}: acerta ${pct(b.accuracy)}%, e ${verb} uma campanha qualquer do projeto no mesmo dia acertaria ${pct(b.expected)}% (${b.graded} decisões). Ainda sem vantagem.`});
  if(t.graded>=min&&t.campaigns>=3&&t.high!==null&&t.high<0.5)out.push({weight:5,kind:'fraca',rule,text:`${label}: erra mais do que acerta, ${t.right} de ${t.graded}${range(t)}. Vale revisar o limiar com o dono.`});
  if(t.winnersCut>=2&&t.winnersCut*4>=t.graded)out.push({weight:4,kind:'vencedor',rule,text:`${label}: apontou corte em ${plural(t.winnersCut,'decisão','decisões')} (${plural(t.winnersCutCampaigns||t.winnersCut,'campanha','campanhas')}) que deram ROI ≥ 1,2 no dia seguinte.`});
  // A trend only when the two weeks differ beyond noise (two-proportion test at 95%).
  const z=t.recent.graded>=learningPolicy.minTrendGraded&&t.previous.graded>=learningPolicy.minTrendGraded?twoProportionZ(t.recentRight,t.recent.graded,t.previousRight,t.previous.graded):null;
  if(finite(z)&&Math.abs(z)>=1.96){
   const up=z>0;out.push({weight:up?1:4,kind:up?'melhorou':'piorou',rule,text:`${label}: ${up?'melhorou':'piorou'} de ${pct(t.previous.accuracy)}% (${t.previous.graded} decisões) para ${pct(t.recent.accuracy)}% (${t.recent.graded}) nos últimos 7 dias.`});}
  const first=t.managerAfter+t.managerBlocked;
  if(t.managerBefore>=3&&t.managerBefore>first)out.push({weight:4,kind:'atrasada',rule,text:`${label}: a equipe agiu antes de a Sombra apontar em ${t.managerBefore} casos (a Sombra apontou antes em ${first}).`});
  else if(t.managerBlocked>=3&&t.managerBlocked>=t.managerBefore)out.push({weight:2,kind:'antecipou',rule,text:`${label}: a Sombra apontou antes da equipe em ${first} casos, ${t.managerBlocked} deles ainda só como sugestão.`});
  if((rule==='test-no-sale'||rule==='new-sale-loss')&&finite(t.spendWrong)&&finite(t.spendRight)&&t.spendCases?.right>=learningPolicy.minSpendCases&&t.spendCases?.wrong>=learningPolicy.minSpendCases)out.push({weight:2,kind:'gasto',rule,text:`${label}: quando a Sombra apontou, as pausas que erraram tinham gasto do dia (Malva) mediano de ${brl(t.spendWrong)}; as que acertaram, ${brl(t.spendRight)}.`});
  if(!scope)for(const [p,s] of Object.entries(t.projects||{}))if(s.graded>=min&&s.campaigns>=3&&s.high!==null&&s.high<0.5&&!(t.high!==null&&t.high<0.5))out.push({weight:4,kind:'projeto',rule,project:p,text:`${t.label||rule} em ${name(p)}: ${s.right} de ${s.graded}${range(s)}, abaixo da regra no geral (${pct(t.accuracy)}%).`});
 }
 const blind=Object.entries(stats?.blindSpots?.byProject||{}).map(([p,b])=>[p,b,b.pause+b.reduce]).filter(([,,c])=>c>=2).sort((a,b)=>b[2]-a[2]);
 if(scope&&blind.length){const [p,b,c]=blind[0];out.push({weight:5,kind:'ponto-cego',project:p,text:`${name(p)}: ${plural(c,'corte','cortes')} de gestor ou seu sem aviso antes da Sombra em 7 dias (${plural(b.pause,'pausa','pausas')}, ${plural(b.reduce,'redução','reduções')}). Ponto cego a revisar.`});}
 else if(blind.length)out.push({weight:5,kind:'ponto-cego',text:`Cortes de gestor ou seus sem aviso antes da Sombra (7 dias): ${blind.slice(0,4).map(([p,,c])=>`${name(p)} ${c}`).join(', ')}. Ponto cego a revisar.`});
 return out.sort((a,b)=>b.weight-a.weight).slice(0,learningPolicy.maxLessons).map(({weight:_,...l})=>l);
}

/** Compact view for the notch and the companion summary of one scope ('all' or a project id): strings and numbers only. */
export function learningBrief(stats,{project='all'}={}){
 if(!stats?.memory)return null;
 let graded=0,right=0;
 for(const t of Object.values(stats.current||{})){const s=project==='all'?t:t.projects?.[project];if(s){graded+=s.graded;right+=s.right;}}
 const mem=project==='all'?stats.memory:stats.memory.byProject?.[project]||{days:0,from:null};
 const b=project==='all'?null:stats.blindSpots?.byProject?.[project];
 const misses=project==='all'?stats.blindSpots?.total||0:b?b.pause+b.reduce:0;
 const lessons=(project==='all'?arr(stats.lessons):arr(stats.projectLessons?.[project])).slice(0,3).map(l=>l.text);
 const proposals=arr(stats.team?.proposals).filter(p=>project==='all'||p.project===project).slice(0,teamPolicy.maxProposals).map(p=>p.text);
 return {at:stats.at,days:Number.isInteger(mem.days)?mem.days:0,from:mem.from||null,graded,right,accuracy:graded?round3(right/graded):null,...wilson(right,graded),blindSpots:misses,
  lessons,team:teamLines(stats.team,{project}),proposals,ownerLabel};
}
