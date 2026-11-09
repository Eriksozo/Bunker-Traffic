/**
 * Long memory of the Sombra (owner request of 09/11/2026: "o Bunk deve ficar mais inteligente a cada dia com tudo o
 * que ele está acompanhando"). The shadow keeps its decisions for 7 days (shadowPolicy.retentionDays) and its score
 * gate only ever saw those days. This module keeps, for `learningPolicy.retentionDays`:
 * - a compact record of every decision already graded by the real next day;
 * - every manager/owner move the shadow did not see coming ("ponto cego");
 * - the base of each project and day: share of active campaigns that lost / made money (what "doing nothing" scores).
 *
 * From that memory, per rule and rule × project: hits, misses, an honest 95% range (Wilson), a recency-weighted
 * accuracy (half-life), a small-sample estimate pulled toward the rule's own rate (empirical Bayes), the edge over the
 * base and the chance the rule beats it (Jeffreys Beta posterior), the last 7 days against the 7 before, the spend at
 * decision of right vs wrong cuts, and short lessons for the owner. Method and external references:
 * docs/autonomy-policy.md, "Memória da Sombra".
 *
 * Pure and read-only: no provider call, no proposal, no approval, no dispatch. A lesson is a reading for the owner,
 * never a change of threshold: thresholds change only by an explicit owner decision (docs/autonomy-policy.md).
 */
import {sum} from './analysis.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {shadowRulePolicy,shadowRules} from './autonomy-shadow.mjs';

export const learningPolicy=Object.freeze({version:1,retentionDays:90,maxRecordsPerShard:400,maxMissesPerShard:200,
 halfLifeDays:21,recentDays:7,z:1.96,priorStrength:10,missLookbackMs:36*3600000,missLeadMs:5*60000,minGradedLesson:6,
 baseMinCampaigns:3,beatsBaseSure:0.9,summaryEveryMs:10*60000,summaryMaxAgeMs:60*60000,maxLessons:8});

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const text=v=>typeof v==='string'&&v.length>0;
const dayRe=/^\d{4}-\d{2}-\d{2}$/;
const pct=x=>finite(x)?Math.round(x*100):null;
const round3=x=>finite(x)?Math.round(x*1000)/1000:null;
const brl=x=>'R$'+Math.round(x).toLocaleString('pt-BR');
const localDay=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};
const dayIndex=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const median=list=>{const s=list.filter(finite).sort((a,b)=>a-b);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const isCut=kind=>kind==='pause'||kind==='reduce';

/** Short stable id (FNV-1a based, 53 bits) so a day shard stays small. */
export function shortId(value){
 let h1=0x811c9dc5,h2=0x01000193;const s=String(value);
 for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,0x01000193)>>>0;h2=Math.imul(h2^c,0x5bd1e995)>>>0;}
 return ((h2&0x1fffff)*0x100000000+h1).toString(36);
}

// Regularized incomplete beta I_x(a,b) (Lanczos log-gamma + Lentz continued fraction, Numerical Recipes 6.4).
function logGamma(z){
 const g=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
 if(z<0.5)return Math.log(Math.PI/Math.sin(Math.PI*z))-logGamma(1-z);
 z-=1;let x=0.99999999999980993;for(let i=0;i<8;i++)x+=g[i]/(z+i+1);const t=z+7.5;
 return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x);
}
function betaFraction(a,b,x){
 const tiny=1e-30;let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<tiny)d=tiny;d=1/d;let h=d;
 for(let m=1;m<=300;m++){
  const m2=2*m;let aa=m*(b-m)*x/((a+m2-1)*(a+m2));
  d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;h*=d*c;
  aa=-(a+m)*(a+b+m)*x/((a+m2)*(a+m2+1));
  d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;const del=d*c;h*=del;
  if(Math.abs(del-1)<1e-12)break;
 }
 return h;
}
/** CDF of Beta(a,b) at x. */
export function betaCdf(x,a,b){
 if(!(a>0&&b>0)||!finite(x))return NaN;if(x<=0)return 0;if(x>=1)return 1;
 const front=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log(1-x));
 return x<(a+1)/(a+b+2)?front*betaFraction(a,b,x)/a:1-front*betaFraction(b,a,1-x)/b;
}
/** Chance that the true hit rate beats `base`, given k hits in n (Jeffreys prior Beta(½,½)). */
export function chanceAbove(k,n,base){
 if(!(n>0)||!finite(base))return null;return round3(1-betaCdf(Math.min(1,Math.max(0,base)),k+0.5,n-k+0.5));
}

/** Wilson score interval for k hits in n (95% by default). */
export function wilson(k,n,z=learningPolicy.z){
 if(!(n>0))return {low:null,high:null};
 const p=k/n,z2=z*z,den=1+z2/n,center=(p+z2/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
 return {low:round3(Math.max(0,center-half)),high:round3(Math.min(1,center+half))};
}

/** Kind of move of a shadow entry: pause, activate, increase or reduce. */
export function entryKind(e){
 if(e?.action==='status')return e.after?.status==='PAUSED'?'pause':'activate';
 const b=e?.before?.dailyBudget,a=e?.after?.dailyBudget;return finite(a)&&finite(b)?(a>b?'increase':'reduce'):null;
}

/**
 * Compact records of shadow decisions whose grade is final ("acertou", "errou" or "parou"; "N/D" stays open).
 * `manager`: 'before' when the manager acted before the decision could execute (the Bunk was late or only warned),
 * 'after' when he followed an executable decision. Only identifiers and numbers: no name is needed to learn.
 */
export function learningRecords(entries,{version=shadowRulePolicy.version}={}){
 const out=[];
 for(const e of arr(entries)){
  const verdict=e?.grade?.verdict;
  if(!['acertou','errou','parou'].includes(verdict)||!text(e.day)||!dayRe.test(e.day)||!text(e.rule)||!text(e.project))continue;
  const kind=entryKind(e);if(!kind)continue;
  const exec=time(e.firstWouldExecuteAt),mAt=time(e.manager?.at);
  const manager=!e.manager?null:finite(exec)&&finite(mAt)&&mAt>exec?'after':'before';
  const spend=e.metrics?.spend,basisRoi=(e.grade?.basis==='day'?e.grade?.day:e.grade?.next)?.roi;
  out.push({id:shortId(e.id||JSON.stringify([e.day,e.rule,e.project,e.adAccountId,e.objectId,e.action])),day:e.day,rule:e.rule,project:e.project,kind,verdict,
   // The day the verdict reads: D itself for the night increase (it acts on D), D+1 for everything else.
   target:e.grade?.basis==='day'||e.rule==='night-increase'?e.day:shiftDay(e.day,1),
   winnerCut:e.grade?.winnerCut===true,wouldExecute:!!e.firstWouldExecuteAt,manager,owner:!!e.owner,
   spend:finite(spend)?Math.round(spend*100)/100:null,roi:finite(basisRoi)?round3(basisRoi):null,launchDay:finite(e.launchDay)?e.launchDay:null,v:version});
 }
 return out;
}

/**
 * Base of each project and day from complete closed "yesterday" windows (Malva): of the active Meta campaigns with
 * spend that day (warm-up out), how many lost and how many made money. It is what "doing nothing" scores: a cut is
 * right on a losing day, an increase on a profitable one, so a rule only adds something above this share.
 */
export function dailyBases(snapshots){
 const out=new Map();
 for(const s of arr(snapshots)){
  if(s?.period!=='yesterday'||s.level!=='campaign'||s.complete!==true||s.source!=='Malva MCP'||!text(s.projectId))continue;
  const t=time(s.from);if(!finite(t))continue;const day=localDay(t,s.timezone);if(!day)continue;
  let campaigns=0,loss=0,profit=0;
  for(const row of arr(s.rows)){
   if(row?.provider&&row.provider!=='meta')continue;if(isWarmupCampaign(row?.name))continue;
   const r=sum([row]);if(!(finite(r.spend)&&r.spend>0)||!finite(r.result))continue;
   campaigns++;if(r.result<0)loss++;else if(r.result>0)profit++;
  }
  if(campaigns)out.set(`${s.projectId}|${day}`,{day,project:s.projectId,campaigns,loss,profit});
 }
 return [...out.values()];
}

/**
 * Manager or owner cuts and raises the shadow did not see coming: a pause, reduce or increase by a person (never the
 * Bunker's own confirmed execution, never Meta's processing) on an object with no shadow entry of the same kind from
 * `missLookbackMs` before up to `missLeadMs` after it. Alert-only entries count as seen (the Bunk did warn). Only
 * settled moves (older than `missLeadMs`) count, so a decision made a minute later is never called late.
 * @param {any[]} entries shadow entries @param {any[]} events activity log (lib/campaign-activity.mjs)
 * @param {{projects?:string[]|Set<string>|null,timezoneOf?:(project:string)=>string|undefined,now?:number}} [options]
 */
export function blindSpots(entries,events,{projects=null,timezoneOf=()=>undefined,now=Date.now()}={}){
 const scope=projects?new Set(projects):null,out=[],byObject=new Map(),okey=e=>JSON.stringify([e.project,e.adAccountId??null,e.objectId]);
 for(const e of arr(entries)){const k=okey(e);if(!byObject.has(k))byObject.set(k,[]);byObject.get(k).push(e);}
 for(const x of arr(events)){
  if(!['pause','reduce','increase'].includes(x?.action)||x.origin==='bunker'||x.actor==='Meta')continue;
  if(!text(x.project)||(scope&&!scope.has(x.project))||!text(x.objectId))continue;
  const at=time(x.at);if(!finite(at)||at+learningPolicy.missLeadMs>now)continue;
  const seen=arr(byObject.get(okey(x))).some(e=>entryKind(e)===x.action&&time(e.firstAt)>=at-learningPolicy.missLookbackMs&&time(e.firstAt)<=at+learningPolicy.missLeadMs);
  if(seen)continue;
  const day=localDay(at,timezoneOf(x.project));if(!day)continue;
  out.push({id:shortId('miss:'+(x.id||JSON.stringify([x.project,x.adAccountId,x.objectId,x.action,x.at]))),day,project:x.project,kind:x.action,
   by:x.origin==='owner'?'owner':'manager',at:new Date(at).toISOString(),adAccountId:x.adAccountId??null,objectId:x.objectId,name:typeof x.name==='string'?x.name.slice(0,120):null});
 }
 return out;
}

/** Storage key of one day × project shard of the memory. */
export const learningKey=(day,project)=>`learn:${day}:${project}`;
/** Day of a memory key, or null. */
export const learningKeyDay=key=>{const d=String(key).split(':')[1];return dayRe.test(d)?d:null;};
/** Keys a batch of records, misses and bases touches (read them before mergeLearning). */
export const learningKeys=(...lists)=>[...new Set(lists.flatMap(l=>arr(l)).filter(x=>text(x?.day)&&text(x?.project)).map(x=>learningKey(x.day,x.project)))];

/**
 * Upserts records, misses and bases into their day × project shards. `existing`: Map or object key → stored shard (only
 * the touched keys need to be read). Returns the shards that changed and, from `keys`, those past retention.
 */
/** @param {Map<string,any>|Record<string,any>} existing @param {any[]} records @param {any[]} misses @param {{now?:number,bases?:any[],keys?:string[]}} [options] */
export function mergeLearning(existing,records,misses,{now=Date.now(),bases=[],keys=[]}={}){
 const cut=dayIndex(localDay(now,'America/Sao_Paulo'))-learningPolicy.retentionDays;
 const shards=new Map(),changed=new Set();
 const shard=(day,project)=>{const k=learningKey(day,project);if(!shards.has(k)){const old=existing instanceof Map?existing.get(k):existing?.[k];shards.set(k,{day,project,records:{...(old?.records||{})},misses:{...(old?.misses||{})},base:old?.base||null});}return [k,shards.get(k)];};
 const put=(bag,item,cap,k)=>{const old=bag[item.id];if(old&&JSON.stringify(old)===JSON.stringify(item))return;if(!old&&Object.keys(bag).length>=cap)return;bag[item.id]=item;changed.add(k);};
 for(const r of arr(records)){if(!text(r?.day)||dayIndex(r.day)<cut)continue;const [k,s]=shard(r.day,r.project);put(s.records,r,learningPolicy.maxRecordsPerShard,k);}
 // A miss counts once: a later decision on the same object does not erase that the Bunk was late then.
 for(const m of arr(misses)){if(!text(m?.day)||dayIndex(m.day)<cut)continue;const [k,s]=shard(m.day,m.project);if(s.misses[m.id])continue;put(s.misses,m,learningPolicy.maxMissesPerShard,k);}
 for(const b of arr(bases)){if(!text(b?.day)||dayIndex(b.day)<cut)continue;const [k,s]=shard(b.day,b.project);const next={campaigns:b.campaigns,loss:b.loss,profit:b.profit};if(JSON.stringify(s.base)!==JSON.stringify(next)){s.base=next;changed.add(k);}}
 const drop=arr(keys).filter(k=>{const d=learningKeyDay(k);return !!d&&dayIndex(d)<cut;});
 return {put:Object.fromEntries([...changed].map(k=>[k,shards.get(k)])),drop};
}

function tally(list,{todayIdx,prior=null,baseOf}){
 const graded=list.filter(r=>r.verdict==='acertou'||r.verdict==='errou'),right=graded.filter(r=>r.verdict==='acertou').length,n=graded.length;
 let wr=0,wn=0;for(const r of graded){const w=Math.pow(0.5,Math.max(0,todayIdx-dayIndex(r.day))/learningPolicy.halfLifeDays);wn+=w;if(r.verdict==='acertou')wr+=w;}
 const recent=graded.filter(r=>todayIdx-dayIndex(r.day)<learningPolicy.recentDays),before=graded.filter(r=>{const a=todayIdx-dayIndex(r.day);return a>=learningPolicy.recentDays&&a<2*learningPolicy.recentDays;});
 const rate=l=>l.length?round3(l.filter(r=>r.verdict==='acertou').length/l.length):null;
 // Against the base: only decisions whose target day has a known base, so both sides read the same days.
 const based=graded.map(r=>[r,baseOf(r)]).filter(([,b])=>finite(b)),bk=based.filter(([r])=>r.verdict==='acertou').length;
 const expected=based.length?based.reduce((s,[,b])=>s+b,0)/based.length:null;
 const cuts=graded.filter(r=>isCut(r.kind)),m=learningPolicy.priorStrength,pr=finite(prior)?prior:null;
 return {graded:n,right,wrong:n-right,accuracy:n?round3(right/n):null,...wilson(right,n),
  weighted:wn>0?round3(wr/wn):null,
  // Small samples pulled toward the rule's overall rate (a prior worth `priorStrength` decisions).
  shrunk:pr===null||!n?null:round3((right+m*pr)/(n+m)),
  base:{graded:based.length,accuracy:based.length?round3(bk/based.length):null,expected:round3(expected),
   edge:based.length?round3(bk/based.length-expected):null,chanceBetter:based.length?chanceAbove(bk,based.length,expected):null},
  stopped:list.filter(r=>r.verdict==='parou').length,winnersCut:graded.filter(r=>r.winnerCut).length,
  recent:{graded:recent.length,accuracy:rate(recent)},previous:{graded:before.length,accuracy:rate(before)},
  managerBefore:list.filter(r=>r.manager==='before').length,managerAfter:list.filter(r=>r.manager==='after').length,owner:list.filter(r=>r.owner).length,
  spendRight:median(cuts.filter(r=>r.verdict==='acertou').map(r=>r.spend)),spendWrong:median(cuts.filter(r=>r.verdict==='errou').map(r=>r.spend))};
}

/**
 * Score of every rule from the memory: overall, per project, against the base and for the current rule version.
 * @param {any[]} shards stored `learn:` values @param {{now?:number,names?:Record<string,string>}} [options] names: project id → name
 */
export function learningStats(shards,{now=Date.now(),names={}}={}){
 const todayIdx=dayIndex(localDay(now,'America/Sao_Paulo'));
 const records=[],misses=[],seen=new Set(),seenMiss=new Set(),bases=new Map();
 for(const s of arr(shards)){
  for(const r of Object.values(s?.records||{}))if(!seen.has(r.id)){seen.add(r.id);records.push(r);}
  for(const x of Object.values(s?.misses||{}))if(!seenMiss.has(x.id)){seenMiss.add(x.id);misses.push(x);}
  if(s?.base&&s.base.campaigns>=learningPolicy.baseMinCampaigns&&text(s.day)&&text(s.project))bases.set(`${s.project}|${s.day}`,s.base);
 }
 const baseOf=r=>{const b=bases.get(`${r.project}|${r.target}`);if(!b)return null;return (isCut(r.kind)?b.loss:b.profit)/b.campaigns;};
 const days=[...new Set(records.map(r=>r.day).concat(misses.map(m=>m.day)))].sort();
 const rules={};
 for(const rule of Object.keys(shadowRules)){
  const list=records.filter(r=>r.rule===rule);if(!list.length)continue;
  const all=tally(list,{todayIdx,baseOf}),current=tally(list.filter(r=>r.v===shadowRulePolicy.version),{todayIdx,baseOf});
  const projects={};for(const p of [...new Set(list.map(r=>r.project))])projects[p]=tally(list.filter(r=>r.project===p),{todayIdx,prior:all.accuracy,baseOf});
  rules[rule]={label:shadowRules[rule],...all,currentVersion:{version:shadowRulePolicy.version,graded:current.graded,right:current.right,accuracy:current.accuracy,low:current.low,high:current.high,base:current.base},projects};
 }
 const recentMiss=misses.filter(m=>todayIdx-dayIndex(m.day)<learningPolicy.recentDays);
 const missBy={};for(const m of recentMiss){const b=missBy[m.project]||(missBy[m.project]={pause:0,reduce:0,increase:0,owner:0,manager:0});b[m.kind]++;b[m.by]++;}
 const graded=records.filter(r=>r.verdict==='acertou'||r.verdict==='errou'),right=graded.filter(r=>r.verdict==='acertou').length;
 const stats={version:learningPolicy.version,at:new Date(now).toISOString(),
  memory:{days:days.length,from:days[0]||null,to:days.at(-1)||null,records:records.length,misses:misses.length,bases:bases.size,retentionDays:learningPolicy.retentionDays},
  overall:{graded:graded.length,right,accuracy:graded.length?round3(right/graded.length):null,...wilson(right,graded.length)},rules,
  blindSpots:{days:learningPolicy.recentDays,total:recentMiss.length,byProject:missBy,recent:[...recentMiss].sort((a,b)=>time(b.at)-time(a.at)).slice(0,10)}};
 return {...stats,lessons:learningLessons(stats,{names})};
}

/**
 * Accuracy the score gate reads (same shape as ruleAccuracy): the memory of the current rule version, so the owner's
 * "60% with 20+ graded decisions" is no longer cut to the last 7 days. `fallback` (the 7-day count) wins while the
 * memory is still smaller. The base fields ride along for display; the owner's gate itself is unchanged.
 */
/** @param {any} stats @param {string} rule @param {any} [fallback] @returns {any} */
export function gateAccuracy(stats,rule,fallback=null){
 const c=stats?.rules?.[rule]?.currentVersion;
 if(!c||!(c.graded>0)||(fallback&&fallback.graded>c.graded))return fallback;
 return {graded:c.graded,right:c.right,accuracy:c.accuracy,low:c.low,high:c.high,base:c.base||null,source:'memory'};
}

/** Short lessons in pt-BR for the owner, strongest evidence first. Readings, never a change of threshold. */
export function learningLessons(stats,{names={}}={}){
 const out=[],min=learningPolicy.minGradedLesson,name=p=>names[p]||'projeto';
 const range=t=>t.low===null?'':` (faixa provável ${pct(t.low)}–${pct(t.high)}%)`;
 for(const [rule,t] of Object.entries(stats?.rules||{})){
  const label=t.label||rule,b=t.base||{};
  if(b.graded>=min&&finite(b.chanceBetter)){
   if(b.chanceBetter>=learningPolicy.beatsBaseSure)out.push({weight:3,kind:'vantagem',rule,text:`${label}: acerta ${pct(b.accuracy)}% contra ${pct(b.expected)}% de não fazer nada, em ${b.graded} decisões (${b.chanceBetter>0.99?'mais de 99':pct(b.chanceBetter)}% de chance de ser melhor).`});
   else if(b.chanceBetter<0.5)out.push({weight:5,kind:'sem-vantagem',rule,text:`${label}: acerta ${pct(b.accuracy)}%, mas não fazer nada acertaria ${pct(b.expected)}% nos mesmos dias (${b.graded} decisões). Ainda sem vantagem.`});
  }
  if(t.graded>=min&&t.high!==null&&t.high<0.5)out.push({weight:5,kind:'fraca',rule,text:`${label}: acerta pouco, ${t.right} de ${t.graded}${range(t)}. Vale revisar o limiar com o dono.`});
  if(t.winnersCut>=2&&t.winnersCut*4>=t.graded)out.push({weight:4,kind:'vencedor',rule,text:`${label}: cortou ${t.winnersCut} campanhas que deram ROI ≥ 1,2 no dia seguinte.`});
  if(t.recent.graded>=8&&t.previous.graded>=8&&finite(t.recent.accuracy)&&finite(t.previous.accuracy)&&Math.abs(t.recent.accuracy-t.previous.accuracy)>=0.15){
   const up=t.recent.accuracy>t.previous.accuracy;out.push({weight:up?1:4,kind:up?'melhorou':'piorou',rule,text:`${label}: ${up?'melhorou':'piorou'} de ${pct(t.previous.accuracy)}% para ${pct(t.recent.accuracy)}% nos últimos 7 dias.`});}
  if(t.managerBefore>=3&&t.managerBefore>t.managerAfter)out.push({weight:4,kind:'atrasada',rule,text:`${label}: o gestor agiu antes da Sombra em ${t.managerBefore} casos (depois dela em ${t.managerAfter}).`});
  if((rule==='test-no-sale'||rule==='new-sale-loss')&&finite(t.spendWrong)&&finite(t.spendRight)&&t.wrong>=3)out.push({weight:2,kind:'gasto',rule,text:`${label}: pausas que erraram tinham gasto mediano de ${brl(t.spendWrong)}; as que acertaram, ${brl(t.spendRight)}.`});
  for(const [p,s] of Object.entries(t.projects||{}))if(s.graded>=min&&s.high!==null&&s.high<0.5&&!(t.high!==null&&t.high<0.5))out.push({weight:4,kind:'projeto',rule,project:p,text:`${label} em ${name(p)}: ${s.right} de ${s.graded}${range(s)}, abaixo da regra no geral (${pct(t.accuracy)}%).`});
 }
 for(const [p,b] of Object.entries(stats?.blindSpots?.byProject||{})){
  const cuts=b.pause+b.reduce;if(cuts<2)continue;
  out.push({weight:5,kind:'ponto-cego',project:p,text:`${name(p)}: ${cuts} cortes de gestor/dono sem aviso antes da Sombra em 7 dias (${b.pause} pausas, ${b.reduce} reduções). Ponto cego a revisar.`});
 }
 return out.sort((a,b)=>b.weight-a.weight).slice(0,learningPolicy.maxLessons).map(({weight:_,...l})=>l);
}

/** Compact view for the notch and the companion summary of one scope ('all' or a project id). */
export function learningBrief(stats,{project='all'}={}){
 if(!stats?.memory)return null;
 let graded=0,right=0;
 for(const t of Object.values(stats.rules||{})){const s=project==='all'?t:t.projects?.[project];if(s){graded+=s.graded;right+=s.right;}}
 const b=project==='all'?null:stats.blindSpots?.byProject?.[project];
 const misses=project==='all'?stats.blindSpots?.total||0:b?b.pause+b.reduce+b.increase:0;
 const lessons=arr(stats.lessons).filter(l=>project==='all'||!l.project||l.project===project).slice(0,3).map(l=>l.text);
 return {at:stats.at,days:stats.memory.days,from:stats.memory.from,graded,right,accuracy:graded?round3(right/graded):null,...wilson(right,graded),blindSpots:misses,lessons};
}
