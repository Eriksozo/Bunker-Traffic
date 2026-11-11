/**
 * Modo Gestor (W3), storage orchestration of the playbook (contract docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md §c). The
 * executor (W1) calls three hooks, each inside its own try/catch:
 * - A `runPlaybookShadow`, every Sombra pass: hourly observations and the play decisions of this reading (`pbs:*`);
 * - B `runPlaybookLearning`, each long-memory pass: labels, daily bins, grades, retention, fitting, replay, views;
 * - C `runPlaybookBackfill`, heavy pulse only: ≤2 read-only Malva pages of the 30-day backfill.
 * Phase 1 (zero execution risk): a play decision always has `wouldExecute:false`; nothing here reaches the autonomy
 * grant, a proposal, an order or a dispatch, and nothing writes outside the `pb:` / `pbs:` keys of the executor's own
 * storage (the store facade refuses anything else). Runner functions never throw: errors come back as
 * `{ok:false, code:'PLAYBOOK_*', error}`. Bounded by unit caps first and by the wall-clock deadline at each await.
 */
import {shadowOutcomes} from './autonomy-shadow.mjs';
import {backfillTeamHistory} from './activity-history.mjs';
import {twoProportionZ} from './learning-math.mjs';
import {backfillMoves,exclusionCounts,excludeReasons,personResolver} from './team-learning.mjs';
import {buildObservations,labelObservation,learnableMoves,foldDay,fitBin,obsKey,binsKey,backfillDayKey,localDayOf,shiftDay,observationPolicy} from './team-observations.mjs';
import {playTemplates,templateOf,playCorpus,fitPlayFrom,shrinkParams,versionPlay,playSentence,evaluatePlaybook} from './manager-playbook.mjs';
import {mergePlaybook,gradePlaybook,pbsKey,pbsId,pbsDayPrefix,scoreAccumulate,scoreFinalize,replayDayFrom,replayAgreement,personAgreement,wouldHave,forcePlaybookFields} from './playbook-eval.mjs';

export const playbookRunnerPolicy=Object.freeze({
 version:1,enabled:true,
 shadowBudgetMs:250,learnBudgetMs:2500,backfillBudgetMs:8000,
 maxCampaignsPerPass:600,maxGroupsPerFit:2,maxPredicateEvals:200000,listPage:128,
 obsEveryMs:3600000,labelAfterMs:90*60000,fitEveryMs:6*3600000,fitLocalHour:2,
 backfillProjectsPerPulse:1,backfillPagesPerPulse:2,backfillDays:30,backfillRetryMs:15*60000,
 pbsMaxEntries:2000,pbsRetentionDays:7,obsRetentionDays:21,binsRetentionDays:90,replayRetentionDays:30,versionsKept:10,
 maxValueBytes:100000,modelMaxBytes:60000,
 // Memory bounds of hook B (128 MB isolate): bins are streamed a few at a time (never all decoded at once), ≤60 per call,
 // and fitting / replay run only on the heavy pulse's learning pass (never between pulses, never during a model wait).
 binChunk:6,binDays:60,foldedDays:31,obsIndexDays:3});
const R=playbookRunnerPolicy;
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||''),text=v=>typeof v==='string'&&v.length>0;
const iso=n=>new Date(n).toISOString();
const bytes=v=>{try{return new TextEncoder().encode(JSON.stringify(v)).length;}catch{return Infinity;}};
const pbErr=(code,message='')=>Object.assign(new Error(code+(message?': '+message:'')),{code});
const allowed=k=>typeof k==='string'&&(k.startsWith('pb:')||k.startsWith('pbs:'));
const teamShardKey=/^learn:\d{4}-\d{2}-\d{2}:[^:]+:team$/;
const localHour=(at,timezone)=>{try{return Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(at));}catch{return null;}};
const chunks=(list,n)=>{const out=[];for(let i=0;i<list.length;i+=n)out.push(list.slice(i,i+n));return out;};
const asMap=got=>{const m=new Map();if(got&&typeof got[Symbol.iterator]==='function'&&typeof got.get==='function'){for(const [k,v] of got)m.set(k,v);}else if(got&&typeof got==='object')for(const [k,v] of Object.entries(got))m.set(k,v);return m;};

/**
 * Storage facade (contract c.2): `pb:` / `pbs:` keys only (plus read-only exact `learn:<day>:<p>:team` keys), bounded
 * batches, a required listing limit, and no transaction, deleteAll, alarm or sync. Anything else throws
 * PLAYBOOK_STORE_DENIED.
 * @param {any} storage the executor's Durable Object storage
 */
export function playbookStore(storage){
 const deny=why=>{throw pbErr('PLAYBOOK_STORE_DENIED',why);};
 const f={
  async get(keys){
   const list=Array.isArray(keys)?keys:[keys];
   if(!list.length)return Array.isArray(keys)?new Map():undefined;
   if(list.length>128)deny('get > 128');
   for(const k of list)if(!(allowed(k)||teamShardKey.test(String(k))))deny('get '+String(k).slice(0,40));
   if(!Array.isArray(keys))return storage.get(keys);
   return asMap(await storage.get(list));
  },
  async put(entries){
   if(!entries||typeof entries!=='object'||Array.isArray(entries))deny('put shape');
   const list=Object.entries(entries);if(list.length>100)deny('put > 100');
   for(const [k,v] of list){if(!allowed(k))deny('put '+String(k).slice(0,40));const max=k==='pb:model'?R.modelMaxBytes:R.maxValueBytes;if(bytes(v)>max)deny('value too large '+k.slice(0,40));}
   if(list.length)await storage.put(Object.fromEntries(list));
  },
  async delete(keys){
   const list=arr(keys);if(list.length>128)deny('delete > 128');for(const k of list)if(!allowed(k))deny('delete '+String(k).slice(0,40));
   if(list.length)await storage.delete(list);
  },
  async list(opts={}){
   const {prefix,start,startAfter,end,limit}=opts||{};
   if(!text(prefix)||!allowed(prefix))deny('list prefix');
   if(!(Number.isInteger(limit)&&limit>0&&limit<=R.listPage))deny('list limit');
   for(const k of [start,startAfter,end])if(k!==undefined&&!allowed(k))deny('list range');
   const o={prefix,limit};if(start!==undefined)o.start=start;if(startAfter!==undefined)o.startAfter=startAfter;if(end!==undefined)o.end=end;
   return asMap(await storage.list(o));
  },
 };
 return Object.freeze(f);
}

/** Error result (contract c.7). */
function failure(e){
 const code=/^PLAYBOOK_[A-Z_]{1,40}$/.test(e?.code||'')?e.code:'PLAYBOOK_FIT_FAILED';
 return {ok:false,code,error:(String(e?.name||'Error').slice(0,40)+': '+String(e?.message||'')).slice(0,160)};
}
async function writeStatus(store,stage,result,now){
 try{const prev=await store.get('pb:status'),last={...(prev?.last||{})};
  last[stage]={at:iso(now),ok:result.ok===true,...(stage==='backfill'?{calls:result.calls||0}:{})};
  await store.put({'pb:status':{v:1,at:iso(now),ok:result.ok===true,stage,...(result.code?{code:result.code}:{}),...(result.error?{error:result.error}:{}),...(finite(result.ms)?{ms:result.ms}:{}),partial:!!result.partial,last}});
 }catch{/* best effort */}
}
const disabled=()=>({ok:true,skipped:true,code:'PLAYBOOK_DISABLED'});
const zoneOf=(state,liveItems,project)=>arr(liveItems).find(i=>i?.projectId===project)?.snapshot?.timezone||arr(state?.snapshots).find(s=>s?.projectId===project&&s.timezone)?.timezone||'America/Sao_Paulo';
/** The owner's saved autonomy limits of a project, read from the state in hand (never the grant module). */
function ownerLimits(state,project){
 const l=state?.autonomy?.projects?.[project]?.limits;if(!l||typeof l!=='object')return {limits:null,cap:null};
 return {limits:{maxIncreasePct:finite(l.maxIncreasePct)?l.maxIncreasePct:null,maxReducePct:finite(l.maxReducePct)?l.maxReducePct:null},cap:finite(l.budgetCap)&&l.budgetCap>0?l.budgetCap:null};
}

// ---------------------------------------------------------------------------------------------------------------------
// Hook A: every Sombra pass.

/**
 * Observations (at most one per project per hour, on the trusted today cut) and the play decisions of this reading,
 * merged into today's exact `pbs:` keys with the people's reactions (shadowOutcomes). Never touches `batches`.
 * @param {ReturnType<typeof playbookStore>} store
 * @param {{state:any,liveItems?:any[],events?:any[],meta?:any,now:number,projects:{project:string,params?:any,day:string}[],fixed?:any[]}} input
 * @param {{deadline:number}} options
 */
export async function runPlaybookShadow(store,input,{deadline}={deadline:Date.now()+R.shadowBudgetMs}){
 if(!R.enabled)return disabled();
 const started=Date.now();let result;
 try{
  if(!input||typeof input!=='object'||!input.state||!Array.isArray(input.projects)||!finite(input.now))throw pbErr('PLAYBOOK_BAD_INPUT');
  const {state,liveItems=[],events=[],now}=input,fixed=arr(input.fixed).flatMap(b=>Array.isArray(b)?(Array.isArray(b[0])?b[0]:b):b&&typeof b==='object'?[b]:[]);
  const projects=input.projects.filter(p=>text(p?.project)&&state?.config?.[p.project]).slice(0,40);
  let evaluated=0,obsCount=0,decisions=0,written=0,partial=false,skippedObs=0;
  // 1. Observations: which hours already have one comes from the small `pb:obs-index` (never the observation values).
  const plan=projects.map(p=>{const tz=zoneOf(state,liveItems,p.project),h=localHour(now,tz),day=localDayOf(now,tz);return {...p,tz,hour:h,obsDay:day,key:obsKey(day,p.project,h)};});
  let index=obsIndexOf(plan.length?await store.get('pb:obs-index'):null);
  for(const p of plan){
   if(Date.now()>deadline){partial=true;break;}
   const last=index.last[p.project],lastAt=time(last?.at);
   if(indexHas(index,p.project,p.obsDay,p.hour,'w')||last?.key===p.key||(finite(lastAt)&&now-lastAt<R.obsEveryMs-5*60000))continue;
   const {cap}=ownerLimits(state,p.project),params=p.params||{};
   const ob=buildObservations(state,{project:p.project,liveItem:arr(liveItems).find(i=>i?.projectId===p.project)||null,events,params,now,budgetCap:finiteCap(params.budgetCap,cap)});
   if(!ob||!ob.value.rows.length)continue;
   if(evaluated+ob.value.rows.length>R.maxCampaignsPerPass){partial=true;break;}
   evaluated+=ob.value.rows.length;
   // Each project's observation goes in its own write, with the index: one oversize project never blocks the others.
   const before=JSON.stringify(index);indexMark(index,p.project,p.obsDay,p.hour,'w');index.last[p.project]={key:ob.key,at:ob.value.at};
   try{await store.put({[ob.key]:ob.value,'pb:obs-index':indexPrune(index)});obsCount++;}
   catch(e){index=JSON.parse(before);if(e?.code!=='PLAYBOOK_STORE_DENIED')throw e;skippedObs++;}
  }
  // 2–3. Play decisions of the candidate plays, merged into today's exact keys (get by id, never a listing).
  const model=await store.get('pb:model'),plays=Object.values(model?.plays||{});
  if(plays.some(p=>p?.stage==='candidata'))for(const p of projects){
   if(Date.now()>deadline||evaluated>=R.maxCampaignsPerPass){partial=true;break;}
   const mine=plays.filter(x=>x?.project===p.project&&x.stage==='candidata');if(!mine.length)continue;
   // A refit's challenger runs next to the frozen version, under its own rev, so it gets its own score (never swapped
   // in: the version in use changes only with the owner's "Atualizar", a later phase).
   const next=mine.filter(x=>x.challenger&&typeof x.challenger.rev==='string'&&x.challenger.params&&typeof x.challenger.params==='object')
    .map(x=>({...x,params:x.challenger.params,step:x.challenger.step??x.step,rev:x.challenger.rev,version:x.challenger.version??null,versionRole:'next',sentence:playSentence(x.id,x.challenger.params,x.challenger.step??x.step,x.generalized||[])}));
   const {limits,cap}=ownerLimits(state,p.project),params=p.params||{};
   const out=evaluatePlaybook(state,{project:p.project,liveItem:arr(liveItems).find(i=>i?.projectId===p.project)||null,events,params,now,plays:[...mine,...next],fixed,limits,budgetCap:finiteCap(params.budgetCap,cap)});
   evaluated+=arr(state?.snapshots).find(s=>s?.projectId===p.project&&s.period==='today')?.rows?.length||0;
   if(!out.decisions.length)continue;decisions+=out.decisions.length;
   const ids=[...new Set(out.decisions.map(d=>pbsKey(pbsId(p.day,d))))],prior=new Map();
   for(const c of chunks(ids,128)){const got=await store.get(c);for(const [k,v] of got)if(v)prior.set(k.slice(4),v);}
   const merged=mergePlaybook(prior,out.decisions,{now,day:p.day});
   const reacted=shadowOutcomes(merged,events).map(forcePlaybookFields);
   const changed=reacted.filter(e=>JSON.stringify(prior.get(e.id))!==JSON.stringify(e)).map(e=>[pbsKey(e.id),e]);
   for(const c of chunks(changed,100)){await store.put(Object.fromEntries(c));written+=c.length;}
  }
  result={ok:true,ms:Date.now()-started,obs:obsCount,decisions,written,partial,...(skippedObs?{oversize:skippedObs}:{})};
 }catch(e){result={...failure(e),ms:Date.now()-started};}
 await writeStatus(store,'shadow',result,input?.now||Date.now());
 return result;
}
/** `pb:obs-index`: per project, the last observation and the local hours written / labelled of the last days. */
function obsIndexOf(v){const x=v&&typeof v==='object'?v:{};return {v:1,last:x.last&&typeof x.last==='object'?{...x.last}:{},days:x.days&&typeof x.days==='object'?JSON.parse(JSON.stringify(x.days)):{}};}
function indexHas(ix,p,day,hour,k){return arr(ix.days?.[p]?.[day]?.[k]).includes(Number(hour));}
function indexMark(ix,p,day,hour,k){const d=((ix.days[p]=ix.days[p]||{})[day]=ix.days[p][day]||{w:[],l:[]});d[k]=arr(d[k]);if(!d[k].includes(Number(hour)))d[k].push(Number(hour));}
function indexPrune(ix){for(const p of Object.keys(ix.days)){const keep=Object.keys(ix.days[p]).sort().slice(-R.obsIndexDays);ix.days[p]=Object.fromEntries(keep.map(d=>[d,ix.days[p][d]]));}return ix;}
const finiteCap=(a,b)=>{const x=finite(a)&&a>0?a:null,y=finite(b)&&b>0?b:null;return x!==null&&y!==null?Math.min(x,y):x??y;};

// ---------------------------------------------------------------------------------------------------------------------
// Hook B: each long-memory pass.

/**
 * Labels, daily bins, grades, retention, fitting, replay and views, resumable through `pb:cursor` and stopping at the
 * deadline or the unit caps (≤ maxGroupsPerFit fit groups and ≤ maxPredicateEvals predicate evaluations per call).
 * @param {ReturnType<typeof playbookStore>} store
 * @param {{state:any,now:number,team?:any[],teamKeys?:string[],bases?:any[],coverage?:any,ownerNames?:string[],zone?:(p:string)=>string,projects?:string[],names?:Record<string,string>}} input
 * @param {{deadline:number}} options
 */
export async function runPlaybookLearning(store,input,{deadline}={deadline:Date.now()+R.learnBudgetMs}){
 if(!R.enabled)return disabled();
 const started=Date.now();let result;
 try{
  if(!input||typeof input!=='object'||!input.state||!finite(input.now))throw pbErr('PLAYBOOK_BAD_INPUT');
  const {state,now}=input,projects=arr(input.projects).filter(p=>text(p)&&state?.config?.[p]).sort().slice(0,40);
  const zone=p=>{try{return (typeof input.zone==='function'?input.zone(p):null)||'America/Sao_Paulo';}catch{return 'America/Sao_Paulo';}};
  const names=input.names&&typeof input.names==='object'?input.names:{},ownerNames=arr(input.ownerNames);
  const counter={n:0},late=()=>Date.now()>deadline;
  const out={labeled:0,binned:0,graded:0,deleted:0,fitted:false,replayed:false,partial:false,oversize:[]};
  const cursor={v:1,...((await store.get('pb:cursor'))||{})},heavy=input.heavy!==false;
  const peopleDoc=(await store.get('pb:people'))||{v:1,people:{},days:{}};let peopleChanged=false;
  // People's recent moves (the exact team shards this pass touched, plus this pass's moves): labels, proxies, opposites.
  const shardKeys=[...new Set(arr(input.teamKeys).filter(k=>teamShardKey.test(String(k))))].slice(0,128);
  const shards=shardKeys.length?await store.get(shardKeys):new Map(),movesBy=new Map(),seenMove=new Set(),raw=[];
  for(const s of shards.values())for(const a of Object.values(s?.actions||{}))raw.push(a);
  for(const a of arr(input.team))raw.push(a);
  // One identity per person: a move stored before the actor key (no `person`) takes the key-based id of the same name.
  const resolve=personResolver(raw,Object.entries(peopleDoc.people||{}).map(([pid,x])=>[pid,x?.name]));
  const withPerson=a=>a&&!a.person?{...a,person:resolve(a)}:a;
  const addMove=a=>{if(!a?.id||seenMove.has(a.id+'|'+a.project))return;seenMove.add(a.id+'|'+a.project);if(!movesBy.has(a.project))movesBy.set(a.project,[]);movesBy.get(a.project).push(withPerson(a));};
  for(const a of raw)addMove(a);
  const learnable=new Map(projects.map(p=>[p,learnableMoves(movesBy.get(p)||[],p)]));
  const allMoves=[...learnable.values()].flat();

  // 1. Labels: today's and yesterday's observations of each project, once 90 min old. Only the hours the index says were
  // written and not labelled yet are read (exact keys), never a listing of every observation value.
  const obsIndex=obsIndexOf(await store.get('pb:obs-index'));
  for(const p of projects){
   if(late()){out.partial=true;break;}
   const today=localDayOf(now,zone(p));
   for(const day of [shiftDay(today,-1),today]){
    const d=obsIndex.days?.[p]?.[day];if(!d)continue;
    const due=arr(d.w).filter(h=>!arr(d.l).includes(h));if(!due.length)continue;
    const got=await store.get(due.map(h=>obsKey(day,p,h))),puts={};let marked=false;
    for(const h of due){
     const k=obsKey(day,p,h),obs=got.get(k);
     if(!obs||obs.labeledAt){indexMark(obsIndex,p,day,h,'l');marked=true;continue;}
     if(now<time(obs.at)+observationPolicy.labelAfterMs)continue;
     const l=labelObservation(obs,learnable.get(p),{now});if(l){puts[k]=l;out.labeled++;}
     indexMark(obsIndex,p,day,h,'l');marked=true;
    }
    if(marked)await safePut(store,{...puts,'pb:obs-index':indexPrune(obsIndex)},out);
   }
  }
  // 2. Bases of closed days (lib/shadow-learning.mjs dailyBases), kept until their bin exists.
  const pendingBases={...(cursor.pendingBases||{})};
  for(const b of arr(input.bases))if(text(b?.project)&&text(b?.day)&&projects.includes(b.project))pendingBases[b.project+'|'+b.day]={campaigns:b.campaigns,loss:b.loss,profit:b.profit};
  // 3. Fold closed days into bins: yesterday once its last readings are labelled, older unfolded days, backfilled days.
  const folded={...(cursor.folded||{})},bfStates=projects.length?await store.get(projects.map(p=>'pb:backfill:'+p)):new Map();
  let liveExcluded=null;
  const exclusionsOf=()=>{if(!liveExcluded){const r=backfillMoves(state.changeAttributions||[],{state,ownerNames});liveExcluded=r.excluded;}return liveExcluded;};
  let folds=0;
  for(const p of projects){
   if(late()||folds>=4){out.partial=out.partial||folds>=4;break;}
   const tz=zone(p),today=localDayOf(now,tz),yesterday=shiftDay(today,-1),f=folded[p]||{},bfDays=bfStates.get('pb:backfill:'+p)?.days||{};
   const labelsDone=now-startOfLocalDay(now,tz)>=R.labelAfterMs+5*60000;
   const want=[];
   // Yesterday first (the day that just closed), then older days newest first.
   for(let i=1;i<=30;i++){const d=shiftDay(today,-i);if(d===yesterday&&!labelsDone)continue;const bfAt=bfDays[d];if(!f[d]||(bfAt&&time(bfAt)>time(f[d])))want.push(d);}
   for(const d of want){
    if(late()||folds>=4){out.partial=true;break;}
    const bin=await foldOne(store,{state,project:p,day:d,tz,ownerNames,pendingBases,exclusionsOf,now,withPerson,out});
    folded[p]={...(folded[p]||{}),[d]:iso(now)};folds++;out.binned++;
    if(bin){updatePeople(peopleDoc,p,bin);peopleChanged=true;delete pendingBases[p+'|'+d];}
   }
   // Keep only the folded days the fold step still looks at (the last 30 days): the cursor stays small.
   const cutoff=shiftDay(today,-R.foldedDays);folded[p]=Object.fromEntries(Object.entries(folded[p]||{}).filter(([d])=>d>=cutoff));
  }
  // Bases that arrived after their bin: written into it.
  for(const [k,b] of Object.entries(pendingBases)){
   if(late())break;const [p,d]=k.split('|');if(!folded[p]?.[d])continue;
   const bin=await store.get(binsKey(d,p));if(bin&&!bin.base&&b.campaigns>0){await safePut(store,{[binsKey(d,p)]:fitBin({...bin,base:[b.campaigns,b.loss||0,b.profit||0]})},out);}
   delete pendingBases[k];
  }
  // 4. Grades of play decisions (paged listing; a full cycle feeds the per-version score).
  let gradeAcc=cursor.gradeAcc||{},gradeAfter=cursor.gradeAfter,cycleDone=false,pages=0,pbsCount=cursor.pbsCount||0;
  while(!late()&&pages<4){
   const page=await store.list({prefix:'pbs:',limit:R.listPage,...(gradeAfter?{startAfter:gradeAfter}:{})});pages++;
   const entries=[...page.values()].filter(e=>e&&e.source==='playbook');
   if(entries.length){const g=gradePlaybook(entries,{snapshots:state.snapshots,moves:allMoves,now});
    const changed=g.filter((e,i)=>JSON.stringify(e)!==JSON.stringify(entries[i])).map(e=>[pbsKey(e.id),e]);
    for(const c of chunks(changed,100))await safePut(store,Object.fromEntries(c),out);out.graded+=changed.length;
    gradeAcc=scoreAccumulate(gradeAcc,g,{now});}
   pbsCount+=page.size;
   if(page.size<R.listPage){cycleDone=true;break;}
   gradeAfter=[...page.keys()].pop();
  }
  let scores=cursor.scores||{};
  if(cycleDone){scores=gradeAcc;cursor.lastPbsCount=pbsCount;gradeAcc={};gradeAfter=undefined;pbsCount=0;}else out.partial=true;
  // 5. Retention (oldest first, by range listing), at most hourly.
  if(!late()&&(!finite(time(cursor.retentionAt))||now-time(cursor.retentionAt)>=3600000)){
   const day0=localDayOf(now,'America/Sao_Paulo');
   const ranges=[['pbs:',pbsDayPrefix(shiftDay(day0,-R.pbsRetentionDays))],['pb:obs:','pb:obs:'+shiftDay(day0,-R.obsRetentionDays)],['pb:bins:','pb:bins:'+shiftDay(day0,-R.binsRetentionDays)],['pb:bf:','pb:bf:'+shiftDay(day0,-R.binsRetentionDays)]];
   for(const [prefix,end] of ranges){if(late())break;const old=await store.list({prefix,end,limit:R.listPage});const keys=[...old.keys()];if(keys.length){await store.delete(keys);out.deleted+=keys.length;}}
   // Entry cap: the oldest play decisions beyond 2000 go first.
   const over=(cursor.lastPbsCount||0)-R.pbsMaxEntries;
   if(over>0&&!late()){const old=await store.list({prefix:'pbs:',limit:Math.min(R.listPage,over)});const keys=[...old.keys()];if(keys.length){await store.delete(keys);out.deleted+=keys.length;cursor.lastPbsCount-=keys.length;}}
   cursor.retentionAt=iso(now);
  }
  // 6–7. Fitting (a cycle over play × project groups) and the forward-only replay, one project's bins at a time, streamed
  // a few bins per read (never all of them decoded): only on the heavy pulse's pass (`heavy`), never between pulses.
  const model=(await store.get('pb:model'))||{v:1,fitAt:null,fitDay:null,plays:{},divergences:{}};
  let fit=cursor.fit||null,modelChanged=false,replayStore=null,versionsOut=null;
  // An older cursor kept the fits inline: such a cycle restarts (fits now live in pb:fits:<p>).
  if(fit&&(!Array.isArray(fit.queue)||fit.fits))fit=null;
  const fitDay=localDayOf(now,'America/Sao_Paulo'),hour=localHour(now,'America/Sao_Paulo');
  const due=!model.fitAt||now-time(model.fitAt)>=R.fitEveryMs||hour===R.fitLocalHour&&model.fitHourDay!==fitDay;
  if(!fit&&due&&projects.length&&heavy)fit={at:iso(now),day:fitDay,queue:projects.flatMap(p=>playTemplates.map(t=>[p,t.id])),projects:[...projects]};
  const replay=cursor.replay||{};
  const nextReplay=p=>{const tz=zone(p),today=localDayOf(now,tz),yesterday=shiftDay(today,-1),first=shiftDay(today,-R.replayRetentionDays),last=replay[p];const d=last&&last>=first?shiftDay(last,1):first;return d<=yesterday?d:null;};
  const heavyProject=heavy?(fit?.queue?.[0]?.[0]||projects.find(p=>nextReplay(p))||null):null;
  if(heavyProject&&!late()){
   const tz=zone(heavyProject),today=localDayOf(now,tz);
   if(fit&&fit.queue.length&&fit.queue[0][0]===heavyProject){
    const groups=[];for(const g of fit.queue){if(g[0]!==heavyProject||groups.length>=R.maxGroupsPerFit)break;groups.push(g);}
    const fitsKey='pb:fits:'+heavyProject,stored=await store.get(fitsKey);
    const doc=stored&&stored.at===fit.at?{...stored,fits:{...(stored.fits||{})}}:{v:1,at:fit.at,project:heavyProject,fits:{},divergences:null};
    const corpus=playCorpus({fitDay:fit.day,templates:groups.map(([,tid])=>templateOf(tid)).filter(Boolean),divergence:!Array.isArray(doc.divergences)});
    if(!(await streamBins(store,heavyProject,daysBefore(fit.day,R.binDays),b=>corpus.add(b),late)))out.partial=true;
    else{
     if(!Array.isArray(doc.divergences))doc.divergences=corpus.divergences({names:corpus.personNames});
     let n=0;
     for(const [p,tid] of groups){
      if(n>0&&counter.n>R.maxPredicateEvals*0.4){out.partial=true;break;}
      const template=templateOf(tid),r=template?fitPlayFrom(template,corpus,{project:p,fitDay:fit.day,names:corpus.personNames,counter,divs:doc.divergences}):null;
      if(r)doc.fits[tid]=compactFit(r);
      fit.queue.shift();n++;out.fitted=true;
     }
     await safePut(store,{[fitsKey]:doc},out);
     if(!fit.queue.length){
      // End of the cycle: every project's fits of this cycle, then consensus, versions and the model.
      const fkeys=arr(fit.projects).map(p=>'pb:fits:'+p).slice(0,128),fdocs=fkeys.length?await store.get(fkeys):new Map(),fits={},divs={};
      for(const [k,v] of fdocs){if(!v||v.at!==fit.at)continue;const p=k.slice('pb:fits:'.length);divs[p]=arr(v.divergences);for(const [tid,f] of Object.entries(v.fits||{}))fits[tid+'@'+p]=f;}
      const vkeys=[...new Set(Object.keys(fits).map(k=>'pb:versions:'+k.split('@')[1]))].slice(0,128),vstored=vkeys.length?await store.get(vkeys):new Map();
      const versions={};for(const [k,v] of vstored)for(const [tid,x] of Object.entries(v?.plays||{}))versions[tid+'@'+k.slice('pb:versions:'.length)]=x;
      versionsOut=finishFit(model,{...fit,fits,divergences:divs},now,versions);modelChanged=true;fit=null;}
    }
   }else{
    const rd=nextReplay(heavyProject);
    if(rd&&counter.n<R.maxPredicateEvals){
     // One day per call: fitted on the bins before it (streamed), tested on its own bin only.
     const corpus=playCorpus({fitDay:rd,templates:playTemplates,divergence:false,outcome:false});
     if(!(await streamBins(store,heavyProject,daysBefore(rd,R.binDays),b=>corpus.add(b),late))||late())out.partial=true;
     else{
      const test=await store.get(binsKey(rd,heavyProject));
      replayStore=(await store.get('pb:replay'))||{v:1,days:{}};
      const res=test?replayDayFrom(corpus,test,{project:heavyProject,day:rd,counter}):{};
      replayStore.days[heavyProject]={...(replayStore.days[heavyProject]||{}),[rd]:res};
      replay[heavyProject]=rd;out.replayed=true;
     }
    }
   }
  }
  if(replayStore){
   const first=shiftDay(localDayOf(now,'America/Sao_Paulo'),-R.replayRetentionDays);
   for(const p of Object.keys(replayStore.days))replayStore.days[p]=Object.fromEntries(Object.entries(replayStore.days[p]).filter(([d])=>d>=first));
   while(bytes(replayStore)>R.maxValueBytes){const all=Object.entries(replayStore.days).flatMap(([p,d])=>Object.keys(d).map(day=>[p,day])).sort((a,b)=>a[1].localeCompare(b[1]));if(!all.length)break;delete replayStore.days[all[0][0]][all[0][1]];}
   replayStore.at=iso(now);await safePut(store,{'pb:replay':replayStore},out);
  }
  if(modelChanged){
   await safePut(store,{'pb:model':model},out);
   const byProject={};for(const [key,v] of Object.entries(versionsOut||{})){const p=key.split('@')[1];(byProject[p]=byProject[p]||{})[key.split('@')[0]]=v;}
   const vputs={};for(const [p,v] of Object.entries(byProject))vputs['pb:versions:'+p]={v:1,at:iso(now),plays:v};
   if(Object.keys(vputs).length)await safePut(store,vputs,out);
  }
  if(peopleChanged){peopleDoc.at=iso(now);trimPeople(peopleDoc,now);await safePut(store,{'pb:people':peopleDoc},out);}
  // 8. Views for the deep view and the companion (rebuilt when something changed, else at most every 10 min).
  const viewDue=modelChanged||out.replayed||cycleDone||peopleChanged||!finite(time(cursor.viewAt))||now-time(cursor.viewAt)>=10*60000;
  if(viewDue&&!late()){
   const rp=replayStore||(await store.get('pb:replay'))||{days:{}};
   await writeViews(store,{model,replay:rp,people:peopleDoc,scores,bfStates,projects,names,now,exclusionsOf,zone,fitPending:!!fit,out});
   cursor.viewAt=iso(now);
  }
  await safePut(store,{'pb:cursor':{...cursor,v:1,at:iso(now),pendingBases:Object.fromEntries(Object.entries(pendingBases).slice(-60)),folded,gradeAcc,gradeAfter,pbsCount,scores,fit,replay}},out);
  const {oversize,...rest}=out;
  result={ok:true,ms:Date.now()-started,...rest,...(oversize?.length?{oversize:oversize.slice(0,10)}:{}),evals:counter.n};
 }catch(e){result={...failure(e),ms:Date.now()-started};}
 await writeStatus(store,'learning',result,input?.now||Date.now());
 return result;
}
/** Local midnight of `now` in `tz` (any offset): `now` minus the local time of day. */
function startOfLocalDay(now,tz){
 try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz||'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return now-((Number(p.hour)*60+Number(p.minute))*60+Number(p.second))*1000-(now%1000);}catch{return now;}
}

/** One closed day of one project into its bin: labelled observations, people's moves (live and backfilled), exclusions. */
async function foldOne(store,{state,project,day,tz,ownerNames,pendingBases,exclusionsOf,now,withPerson=a=>a,out=null}){
 const obsKeys=[];for(let h=0;h<24;h++)obsKeys.push(obsKey(day,project,h));
 const observations=[];for(const c of chunks(obsKeys,8)){const got=await store.get(c);for(const v of got.values())if(v)observations.push(v);}
 const got=await store.get([`learn:${day}:${project}:team`,backfillDayKey(day,project),binsKey(day,project)]);
 const shard=got.get(`learn:${day}:${project}:team`),bf=got.get(backfillDayKey(day,project)),old=got.get(binsKey(day,project));
 const live=Object.values(shard?.actions||{}).filter(a=>a?.project===project&&a.day===day).map(withPerson);
 const back=bf?backfillMoves(bf.events,{state,ownerNames,timezone:tz}):{moves:[],excluded:[]};
 const ex=new Map();for(const x of [...exclusionsOf().filter(x=>x.project===project&&x.at&&localDayOf(time(x.at),tz)===day),...back.excluded])if(x?.id)ex.set(x.id,x.reason);
 const excluded={};for(const r of ex.values())if(excludeReasons.includes(r))excluded[r]=(excluded[r]||0)+1;
 if(!observations.length&&!live.length&&!back.moves.length&&!ex.size)return null;
 let bin=foldDay({day,project,observations,moves:live,backfillMoves:back.moves.filter(m=>m.day===day),base:pendingBases[project+'|'+day]||(old?.base?{campaigns:old.base[0],loss:old.base[1],profit:old.base[2]}:null),excluded,now});
 // A refold after the readings aged out (21 days) never loses the cells of the first fold.
 if(old&&(old.obs||0)>observations.length)bin=fitBin({...bin,cols:old.cols,cells:old.cells,persons:old.persons,campaigns:old.campaigns,y:old.y,obs:old.obs});
 await safePut(store,{[binsKey(day,project)]:bin},out);
 return bin;
}
/** pb:people: who acted, by day and project (memory depth, people's moves, exclusions), 90 days. */
function updatePeople(doc,project,bin){
 doc.people=doc.people||{};doc.days=doc.days||{};
 const m={};for(const [pid,x] of Object.entries(bin.people||{})){const n=(x.pause||0)+(x.reduce||0)+(x.increase||0)+(x.activate||0);m[pid]=n;
  const cur=doc.people[pid]||{name:x.name,role:x.role,firstAt:bin.day,lastAt:bin.day};doc.people[pid]={name:x.name||cur.name,role:x.role||cur.role,firstAt:cur.firstAt<bin.day?cur.firstAt:bin.day,lastAt:cur.lastAt>bin.day?cur.lastAt:bin.day};}
 (doc.days[project]=doc.days[project]||{})[bin.day]={m,x:bin.excluded||{},bf:bin.bf||0,moves:bin.moves||0,o:bin.obs||0};
}
function trimPeople(doc,now){
 const cutoff=shiftDay(localDayOf(now,'America/Sao_Paulo'),-R.binsRetentionDays);
 for(const p of Object.keys(doc.days||{}))doc.days[p]=Object.fromEntries(Object.entries(doc.days[p]).filter(([d])=>d>=cutoff));
 for(const [pid,x] of Object.entries(doc.people||{}))if(x.lastAt<cutoff)delete doc.people[pid];
 // Moves of each person over the kept 90 days (contract c.8 `moves`).
 const moves={};for(const d of Object.values(doc.days||{}))for(const x of Object.values(d))for(const [pid,n] of Object.entries(x.m||{}))moves[pid]=(moves[pid]||0)+n;
 for(const [pid,x] of Object.entries(doc.people||{}))x.moves=moves[pid]||0;
}
const compactFit=f=>({id:f.id,project:f.project,fitDay:f.fitDay,stage:f.stage,reason:f.reason||null,params:f.params,raw:f.raw,generalized:f.generalized,score:f.score,spread:f.spread,range:f.range,stable:f.stable??null,
 step:f.step,support:f.support,learnedFrom:f.learnedFrom.slice(0,8),outcome:f.outcome,flags:f.flags,
 // Case refs travel lean in the model (≤3, person names resolved when the view is built).
 caseRefs:arr(f.caseRefs).slice(0,3).map(({name:_n,...c})=>c),divergences:arr(f.divergences).slice(0,10)});
/** End of a fitting cycle: consensus shrinkage across projects, versions (frozen version vs challenger), the model. */
function finishFit(model,fit,now,stored={}){
 const plays={},versions={...stored};
 for(const [key,f] of Object.entries(fit.fits)){
  const template=templateOf(f.id),others=Object.values(fit.fits).filter(o=>o.id===f.id&&o.project!==f.project);
  const shrunk=f.raw?shrinkParams(template,f,others):f.params,fitted={...f,params:shrunk};
  let drift=false,challenger=null,current=null;
  // A play gets a version once it has a fit (enough cases); below the support it is only "Observando: faltam N casos".
  if(f.raw){const r=versionPlay(versions[key]||null,fitted,{now});versions[key]={current:r.current,challenger:r.challenger,versions:r.versions.slice(-R.versionsKept)};drift=r.drift;current=r.current;challenger=r.challenger;}
  const use=current||{rev:null,version:0,params:shrunk,step:f.step,generalized:f.generalized};
  const diff=challenger?template.params.map(p=>({param:p.name,from:use.params?.[p.name]??null,to:challenger.params?.[p.name]??null})).filter(d=>d.from!==d.to):[];
  plays[key]={id:f.id,project:f.project,key,stage:f.stage,reason:f.reason,rev:use.rev,version:use.version||0,params:use.params,step:use.step,generalized:use.generalized||[],
   sentence:playSentence(f.id,use.params,use.step,use.generalized||[]),learnedFrom:f.learnedFrom,support:f.support,flags:[...f.flags,...(drift&&!f.flags.includes('drift')?['drift']:[])],
   challenger:challenger?{rev:challenger.rev,version:challenger.version??null,params:challenger.params,step:challenger.step??null,diff}:null,caseRefs:f.caseRefs,outcome:f.outcome,score:f.score,fitDay:f.fitDay,divergences:arr(f.divergences)};
 }
 model.v=1;model.plays=plays;delete model.versions;model.divergences=fit.divergences;model.fitAt=fit.at;model.fitDay=fit.day;model.fitHourDay=localHour(time(fit.at),'America/Sao_Paulo')===R.fitLocalHour?fit.day:model.fitHourDay||null;
 return versions;
}
/**
 * `pb:model` under its cap, never a failed write: case refs out, then the people's own params, the divergences, the
 * challengers' diffs, and at last the least supported observed plays (the candidates are kept first).
 */
function shrinkModel(m){
 const max=R.modelMaxBytes,fits=x=>bytes(x)<=max;if(fits(m))return m;
 const x={...m,plays:Object.fromEntries(Object.entries(m.plays||{}).map(([k,p])=>[k,{...p,caseRefs:[]}]))};if(fits(x))return x;
 x.plays=Object.fromEntries(Object.entries(x.plays).map(([k,p])=>[k,{...p,learnedFrom:arr(p.learnedFrom).slice(0,4).map(l=>({...l,params:null}))}]));if(fits(x))return x;
 x.plays=Object.fromEntries(Object.entries(x.plays).map(([k,p])=>[k,{...p,divergences:[],challenger:p.challenger?{...p.challenger,diff:[]}:null}]));
 x.divergences=Object.fromEntries(Object.entries(x.divergences||{}).map(([p,d])=>[p,arr(d).slice(0,3)]));if(fits(x))return x;
 const order=Object.entries(x.plays).sort(([ka,a],[kb,b])=>(b.stage==='candidata')-(a.stage==='candidata')||(b.support?.moves||0)-(a.support?.moves||0)||ka.localeCompare(kb));
 while(order.length&&!fits(x)){const [k]=order.pop();delete x.plays[k];x.truncated=(x.truncated||0)+1;}
 return fits(x)?x:null;
}
/** `pb:people` under the cap: the oldest days go first (memory depth shrinks, the write never fails). */
function shrinkPeople(doc){
 if(bytes(doc)<=R.maxValueBytes)return doc;const x={...doc,days:JSON.parse(JSON.stringify(doc.days||{}))};
 const all=Object.entries(x.days).flatMap(([p,d])=>Object.keys(d).map(day=>[p,day])).sort((a,b)=>a[1].localeCompare(b[1])||a[0].localeCompare(b[0]));
 while(all.length&&bytes(x)>R.maxValueBytes){const n=Math.max(1,Math.ceil(all.length*0.05));for(const [p,day] of all.splice(0,n))delete x.days[p][day];}
 return bytes(x)<=R.maxValueBytes?x:null;
}
/** `pb:cursor` under the cap: running scores (rebuilt by the next grading cycle) and old folded days go first. */
function shrinkCursor(c){
 if(bytes(c)<=R.maxValueBytes)return c;const x={...c,gradeAcc:{},gradeAfter:undefined,pbsCount:0};if(bytes(x)<=R.maxValueBytes)return x;
 x.scores={};x.pendingBases={};if(bytes(x)<=R.maxValueBytes)return x;
 x.folded=Object.fromEntries(Object.entries(x.folded||{}).map(([p,d])=>[p,Object.fromEntries(Object.entries(d).sort(([a],[b])=>b.localeCompare(a)).slice(0,7))]));
 return bytes(x)<=R.maxValueBytes?x:null;
}
/** A `pb:view:<p>` under the cap: case refs, then fewer plays, people and divergences. */
function shrinkView(v){
 if(bytes(v)<=R.maxValueBytes||!v?.playbook)return bytes(v)<=R.maxValueBytes?v:null;
 const x={...v,playbook:{...v.playbook,plays:arr(v.playbook.plays).map(p=>({...p,caseRefs:[]}))}};if(bytes(x)<=R.maxValueBytes)return x;
 x.playbook.plays=x.playbook.plays.slice(0,6);x.playbook.divergences=arr(x.playbook.divergences).slice(0,3);if(bytes(x)<=R.maxValueBytes)return x;
 x.people=arr(x.people).slice(0,3);x.playbook.plays=x.playbook.plays.slice(0,3).map(p=>({...p,learnedFrom:arr(p.learnedFrom).slice(0,3)}));
 return bytes(x)<=R.maxValueBytes?x:null;
}
/**
 * Every runner write goes through here: a value over its cap is shrunk to fit (per key), and one that still cannot fit is
 * skipped and named in `out.oversize`, never thrown. So a size denial can never make a pass fail at the same put and redo
 * its expensive work in a loop.
 */
async function safePut(store,entries,out){
 const ok={};
 for(const [k,v] of Object.entries(entries||{})){
  const max=k==='pb:model'?R.modelMaxBytes:R.maxValueBytes;let val=v;
  if(bytes(val)>max)val=k==='pb:model'?shrinkModel(val):k==='pb:people'?shrinkPeople(val):k==='pb:cursor'?shrinkCursor(val):k.startsWith('pb:view:')?shrinkView(val):k.startsWith('pb:bins:')?fitBin(val):null;
  if(val===null||val===undefined||bytes(val)>max){if(out&&Array.isArray(out.oversize))out.oversize.push(k.slice(0,60));continue;}
  ok[k]=val;
 }
 for(const c of chunks(Object.entries(ok),100))await store.put(Object.fromEntries(c));
}
/** The local days before `day`, oldest first (`n` of them). */
const daysBefore=(day,n)=>{const out=[];for(let i=n;i>=1;i--)out.push(shiftDay(day,-i));return out;};
/** Streams one project's bins of `days` in chunks of `binChunk` (each chunk dropped before the next read). False when late. */
async function streamBins(store,project,days,each,late){
 for(const c of chunks(days.map(d=>binsKey(d,project)),R.binChunk)){
  if(late())return false;
  const got=await store.get(c);
  for(const k of c){const v=got.get(k);if(v)each(v);}
 }
 return true;
}

/** pb:view and pb:view:<p> (contract a.4 memory/agreement, a.5 Playbook, people agreement, scorePlays). */
async function writeViews(store,{model,replay,people,scores,bfStates,projects,names,now,exclusionsOf,zone,fitPending,out=null}){
 const day0=localDayOf(now,'America/Sao_Paulo'),since30=shiftDay(day0,-30),since7=shiftDay(day0,-7);
 const days=Object.values(people?.days||{}).flatMap(d=>Object.keys(d)).sort();
 const counts={},excluded={};
 for(const d of Object.values(people?.days||{}))for(const [day,x] of Object.entries(d)){
  if(day<since30)continue;for(const [pid,n] of Object.entries(x.m||{}))counts[pid]=(counts[pid]||0)+n;for(const [r,n] of Object.entries(x.x||{}))excluded[r]=(excluded[r]||0)+n;}
 // Today's exclusions (not folded yet), recomputed from the edit feed in hand.
 const todayEx=exclusionCounts(exclusionsOf().filter(x=>x.at&&localDayOf(time(x.at),zone(x.project||''))===localDayOf(now,zone(x.project||''))));
 for(const [r,n] of Object.entries(todayEx.byReason))excluded[r]=(excluded[r]||0)+n;
 // A possible Bunk echo is quarantined, shown once as such: it is not in the excluded total nor in its reasons.
 const quarantined=excluded['possible-bunk-echo']||0;delete excluded['possible-bunk-echo'];
 const exc={total:Object.values(excluded).reduce((a,b)=>a+b,0),byReason:excluded,quarantined};
 // Days the Bunk itself watched the campaigns (folded readings), apart from days known only from the Malva backfill.
 const observed=Object.values(people?.days||{}).flatMap(d=>Object.entries(d).filter(([,x])=>(x?.o||0)>0).map(([day])=>day)).sort();
 const peopleMoves=Object.entries(counts).map(([person,moves])=>({person,name:person==='owner'?'Você':people.people?.[person]?.name||'Pessoa da equipe',role:people.people?.[person]?.role||(person==='owner'?'owner':'team'),moves}))
  .sort((a,b)=>b.moves-a.moves||a.person.localeCompare(b.person)).slice(0,8);
 const backfill={};for(const p of projects){const b=bfStates.get('pb:backfill:'+p);if(b)backfill[p]={complete:b.complete===true,from:b.from||null,to:b.to||null,moves:b.moves||0,at:b.at||null};}
 const replayDays=(p,tid,from)=>Object.entries(replay?.days?.[p]||{}).filter(([d])=>d>=from).sort(([a],[b])=>a.localeCompare(b)).map(([,x])=>x?.[tid]).filter(Boolean);
 const allSeven=projects.flatMap(p=>playTemplates.flatMap(t=>replayDays(p,t.id,since7)));
 const span=list=>list.length?Math.max(1,Math.round((Date.parse(day0)-Date.parse(list[0]))/86400000)+1):0;
 const memory={days:span(days),from:days[0]||null,observedDays:span(observed),observedFrom:observed[0]||null,peopleMoves,excluded:{total:exc.total,byReason:exc.byReason},quarantined:exc.quarantined,backfill};
 const puts={'pb:view':{v:1,at:iso(now),memory,agreement:replayAgreement(allSeven)}};
 // Scores of every play version: the one in use, and its challenger (run in the Sombra under its own rev).
 const scoreAll=scoreFinalize(scores,{stageOf:k=>model?.plays?.[k]?.stage==='candidata'?'candidata':'observando',labelOf:k=>model?.plays?.[k]?.sentence||null,revOf:k=>model?.plays?.[k]?.rev||null,challengerOf:k=>model?.plays?.[k]?.challenger?.rev||null});
 for(const p of projects){
  const mine=Object.values(model?.plays||{}).filter(x=>x?.project===p);
  const plays=mine.map(x=>{
   const rd=replayDays(p,x.id,shiftDay(day0,-R.replayRetentionDays)),r7=replayDays(p,x.id,since7);
   // "A equipe mudou o jeito" (spec §3.3): agreement of the last 7 days ≥15 pp below the 7 before, unlikely noise (|z| ≥ 1.96).
   const prev7=Object.entries(replay?.days?.[p]||{}).filter(([d])=>d>=shiftDay(day0,-14)&&d<since7).map(([,v])=>v?.[x.id]).filter(Boolean);
   const now7=replayAgreement(r7),before7=replayAgreement(prev7),fired=l=>l.reduce((a,d)=>a+(d.fired||0),0),agree=l=>l.reduce((a,d)=>a+(d.agree||0),0);
   const z=twoProportionZ(agree(r7),fired(r7),agree(prev7),fired(prev7));
   const drifted=finite(now7.precision)&&finite(before7.precision)&&before7.precision-now7.precision>=0.15&&finite(z)&&z<=-1.96;
   return {id:x.id,key:x.key,rev:x.rev,version:x.version,role:'challenger',stage:x.stage==='candidata'?'candidata':'observando',
    // Why a play is still only observed (manager-playbook fitPlay): poucos-casos · instavel · divergencia · dormindo · sem-acerto.
    reason:x.stage==='candidata'?null:typeof x.reason==='string'?x.reason:null,sentence:x.sentence,params:x.params,
    step:x.step?{median:x.step.median,p25:x.step.p25??null,p75:x.step.p75??null}:null,
    learnedFrom:arr(x.learnedFrom).map(l=>({person:l.person,name:l.person==='owner'?'Você':people.people?.[l.person]?.name||(l.name&&l.name!==l.person?l.name:'Pessoa da equipe'),n:l.n,params:l.params||null})),
    support:x.support,agreement:replayAgreement(rd),outcome:x.outcome?{d1:x.outcome.d1,d3:x.outcome.d3,base:x.outcome.base}:{d1:null,d3:null,base:null},
    wouldHave7d:wouldHave(r7),flags:[...new Set([...arr(x.flags),...(drifted?['drift']:[])])],challenger:x.challenger?{rev:x.challenger.rev,version:x.challenger.version??null,diff:arr(x.challenger.diff),score:scoreAll[x.key]?.challenger||null}:null,caseRefs:arr(x.caseRefs).slice(0,5).map(c=>({...c,name:c.person==='owner'?'Você':people.people?.[c.person]?.name||c.name||null})),adoptable:false,adoptHint:'chega na próxima fase'};
  }).sort((a,b)=>(b.stage==='candidata')-(a.stage==='candidata')||b.support.moves-a.support.moves||a.id.localeCompare(b.id)).slice(0,12);
  const persons=Object.keys(people?.people||{}).filter(pid=>people.days?.[p]&&Object.values(people.days[p]).some(x=>x.m?.[pid]));
  const pdays=Object.values(replay?.days?.[p]||{}).flatMap(x=>Object.values(x||{}));
  const scorePlays=Object.fromEntries(Object.entries(scoreAll).filter(([k])=>k.endsWith('@'+p)));
  const divs=arr(model?.divergences?.[p]).slice(0,10).map(d=>({...d,playId:mine.find(x=>arr(x.divergences).includes(d.id))?.id||null,people:arr(d.people).map(x=>({...x,name:x.person==='owner'?'Você':people.people?.[x.person]?.name||x.name}))}));
  // Agreement of this project's plays over the last 7 replayed days (the island tile under a project filter), same as pb:view's.
  const agreement=replayAgreement(playTemplates.flatMap(t=>replayDays(p,t.id,since7)));
  puts['pb:view:'+p]={v:1,at:iso(now),agreement,playbook:{fitAt:model?.fitAt||null,nextFitAt:model?.fitAt?iso(time(model.fitAt)+R.fitEveryMs):null,
   state:!plays.length?'sem-dados':plays.some(x=>x.stage==='candidata')?'com-candidatas':'observando',plays,divergences:divs,fitting:fitPending},
   people:persons.map(pid=>({person:pid,name:pid==='owner'?'Você':people.people[pid]?.name||'Pessoa da equipe',agreement:personAgreement(pdays,pid)})).slice(0,8),scorePlays,projectName:names[p]||p};
 }
 await safePut(store,puts,out);
}

// ---------------------------------------------------------------------------------------------------------------------
// Hook C: heavy pulse only.

/**
 * One step of the 30-day read-only backfill for one project (contract c.5): ≤2 `tracking_ad_changes` reads through the
 * given `source` (the executor wraps it so no other tool, and no third read, can go through), events stored per local day
 * in `pb:bf:<day>:<p>`, and the cursor advanced only after those writes. A Malva error keeps the cursor and records
 * `failedAt`/`code`; when every project is complete it makes zero calls.
 * @param {ReturnType<typeof playbookStore>} store @param {{read:(tool:string,args:any)=>Promise<any>}} source
 * @param {{projects:{id:string,name?:string,timezone:string}[],now:number,stillEnabled?:()=>Promise<boolean>|boolean}} input
 */
export async function runPlaybookBackfill(store,source,input,{deadline}={deadline:Date.now()+R.backfillBudgetMs}){
 if(!R.enabled)return disabled();
 const started=Date.now();let result,picked=null,prev=null,calls=0;
 try{
  if(!input||typeof input!=='object'||!Array.isArray(input.projects)||!finite(input.now)||typeof source?.read!=='function')throw pbErr('PLAYBOOK_BAD_INPUT');
  const counted={read:(tool,args)=>{calls++;return source.read(tool,args);}};
  const now=input.now,list=input.projects.filter(p=>text(p?.id)&&text(p?.timezone)).slice(0,40);
  const states=list.length?await store.get(list.map(p=>'pb:backfill:'+p.id)):new Map();
  const open=list.map(p=>({p,s:states.get('pb:backfill:'+p.id)||null})).filter(({s})=>s?.complete!==true&&!(s?.failedAt&&now-time(s.failedAt)<R.backfillRetryMs))
   .sort((a,b)=>(time(a.s?.at)||0)-(time(b.s?.at)||0)||a.p.id.localeCompare(b.p.id));
  if(!open.length||Date.now()>deadline){result={ok:true,calls:0,project:null,moves:0,complete:!open.length,partial:open.length>0};}
  else{
   picked=open[0].p;prev=open[0].s;
   const {failedAt:_f,code:_c,...clean}=prev||{};
   const r=await backfillTeamHistory(counted,picked,prev?clean:null,{now:()=>now,days:R.backfillDays,pages:R.backfillPagesPerPulse,stillEnabled:typeof input.stillEnabled==='function'?input.stillEnabled:()=>true});
   const byDay=new Map();for(const e of r.events){const d=localDayOf(time(e.at),picked.timezone);if(!d)continue;if(!byDay.has(d))byDay.set(d,[]);byDay.get(d).push(compactEvent(e));}
   const keys=[...byDay.keys()].map(d=>backfillDayKey(d,picked.id)),existing=keys.length?await store.get(keys):new Map(),puts={},days={...(prev?.days||{})};
   for(const [d,events] of byDay){
    const k=backfillDayKey(d,picked.id),old=existing.get(k),merged=new Map(arr(old?.events).map(e=>[e.eventId,e]));for(const e of events)merged.set(e.eventId,e);
    let value={v:1,day:d,project:picked.id,at:iso(now),events:[...merged.values()].sort((a,b)=>time(a.at)-time(b.at)||String(a.eventId).localeCompare(String(b.eventId)))};
    while(bytes(value)>R.maxValueBytes&&value.events.length){value={...value,events:value.events.slice(0,Math.floor(value.events.length*0.9)),full:true};}
    puts[k]=value;days[d]=iso(now);
   }
   for(const c of chunks(Object.entries(puts),100))await store.put(Object.fromEntries(c));
   const state={...r.state,days};delete state.failedAt;delete state.code;
   await store.put({['pb:backfill:'+picked.id]:state});
   result={ok:true,calls:r.calls,project:picked.id,moves:r.events.length,complete:r.complete,partial:!r.complete};
  }
 }catch(e){
  const code=e?.code==='PLAYBOOK_SOURCE_DENIED'||e?.code==='PLAYBOOK_STORE_DENIED'||e?.code==='PLAYBOOK_BAD_INPUT'?e.code:/^ACTIVITY_HISTORY_/.test(e?.code||'')?'PLAYBOOK_BACKFILL_IDENTITY':'PLAYBOOK_BACKFILL_READ';
  result={...failure({...e,code,name:e?.name,message:e?.message}),ms:Date.now()-started,calls};
  if(picked)try{await store.put({['pb:backfill:'+picked.id]:{...(prev||{v:1,project:picked.id,timezone:picked.timezone,complete:false}),failedAt:iso(input.now),code}});}catch{/* best effort */}
 }
 await writeStatus(store,'backfill',result,input?.now||Date.now());
 return result;
}
/** A backfilled edit as stored (activityEvent shape, trimmed): who, when, the move, the campaign. */
const compactEvent=e=>({key:e.key,eventId:e.eventId,project:e.project,adAccountId:e.adAccountId,objectId:e.objectId,name:typeof e.name==='string'?e.name.slice(0,60):null,field:e.field,before:e.before,after:e.after,currency:e.currency||null,at:e.at,actor:e.actor??null,automatic:e.automatic===true,actorInfo:e.actorInfo||null});
