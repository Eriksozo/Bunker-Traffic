/**
 * Learning from what people do (owner request of 09/11/2026: "toda ação que eu for fazendo, Jorge e Leonardo, ele deve ir
 * aprendendo junto para melhorar as sugestões"). Every pause, activation, daily-budget increase or reduction that the owner
 * or a manager makes on a Meta sales campaign is kept for 90 days (Durable Object, `learn:<day>:<project>:team`) with:
 * - who did it: the owner ("Você": his notch orders, "Já fiz" reports and his own Malva edits, recognized by the Malva
 *   connection's person) or a manager by the Malva name; edits made straight in the Meta manager carry no person in Malva
 *   ("Fora da Malva Dash") and are kept under that label;
 * - the numbers of that moment, Malva only (the Meta live read is display-only, CLAUDE.md), with the read time so a number
 *   read after the action is marked as such;
 * - whether the Sombra had pointed it out before, and how many minutes earlier;
 * - for a pause of a new or test campaign with no sale, where that spend stood against the Sombra's own pause point;
 * - for a budget move, the real next day (same verdict as the Sombra's grade: association, never causality).
 * From that: per-person patterns, how early the Bunk is against the team day by day, and threshold proposals the owner may
 * accept or ignore. Nothing here changes a threshold, creates a proposal record, approves or dispatches anything.
 * The Bunk never learns from itself: its automatic orders (createdBy 'bunk') and their Malva echo are left out, and so are
 * Meta's own changes, automations and moves with no known author. Names stay in the Durable Object (like the edit history
 * it reads), never in the repository.
 */
import {sum} from './analysis.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {isTestCampaign,verifiedNoSpendPeriods} from './test-launch.mjs';
import {newCampaignStage,first24hGuard} from './first-24h.mjs';
import {describeChange} from './campaign-activity.mjs';
import {ownerAppliedEvents} from './owner-applied.mjs';
import {shortId,wilson,entryKind,isCutKind,getFrom,entriesOf,coveredAt} from './learning-math.mjs';

export const teamPolicy=Object.freeze({version:1,maxActionsPerShard:200,recentDays:7,profileDays:30,trendDays:14,
 leadLookbackMs:36*3600000,leadAheadMs:5*60000,settleMs:5*60000,twinBeforeMs:2*60000,twinAfterMs:15*60000,
 nightEndMinute:30,ownerReportBeforeMs:3*3600000,ownerReportAfterMs:10*60000,contextMaxGapMs:45*60000,nativeBucketMs:2*60000,minProposal:5,minProposalCampaigns:5,minProposalDays:3,proposalGap:0.15,minBeforePoint:3,minGradedLine:3,roundTo:5,maxLines:3,maxProposals:2});
export const outsideLabel='Fora da Malva Dash';
export const ownerLabel='Você';

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const text=v=>typeof v==='string'&&v.trim().length>0;
const dayRe=/^\d{4}-\d{2}-\d{2}$/;
const r2=n=>finite(n)?Math.round(n*100)/100:null;
const r3=n=>finite(n)?Math.round(n*1000)/1000:null;
const brl=x=>'R$'+Math.round(x).toLocaleString('pt-BR');
const pct=x=>finite(x)?Math.round(x*100):null;
const localDay=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};
const localMinute=(at,timezone)=>{try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);}catch{return null;}};
const dayIndex=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const quantile=(list,q)=>{const s=list.filter(finite).sort((a,b)=>a-b);if(!s.length)return null;const i=(s.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);};
const okey=(project,account,object)=>JSON.stringify([project,account??null,object]);
const twinOf=(x,idx)=>idx.execs.get(x.id)?.p||null;
/** The move an order asked for (status PAUSED/ACTIVE, or the exact new daily budget) equals the observed edit. */
function sameTransition(p,e){
 const pay=p?.payload;if(!pay)return false;
 if(pay.action==='status')return String(pay.after?.status||'').toUpperCase()===String(e?.after||'').toUpperCase();
 return pay.action==='budget'&&finite(pay.after?.dailyBudget)&&finite(Number(e?.after))&&Math.abs(pay.after.dailyBudget-Number(e.after))<0.01;
}
const isBunk=p=>p?.createdBy==='bunk'||p?.autonomyOrder===true;
const kinds=new Set(['pause','activate','increase','reduce']);
const fieldOk=e=>e.field==='dailyBudget'||e.field==='status'||e.field==='effectiveStatus'||e.field==null;

/**
 * Executions with their proposals, by id and by Meta campaign id (to recognize the Bunker's own Malva writes). A Meta
 * campaign id is unique across projects, so an account linked to two projects finds the same order from both.
 */
export function actionIndex(state){
 const props=new Map(arr(state?.proposals).filter(p=>p?.id).map(p=>[p.id,p])),execs=new Map(),byObject=new Map();
 for(const x of arr(state?.executions)){
  if(!x?.id)continue;const p=props.get(x.proposalId)||null;execs.set(x.id,{x,p});
  const o=p?.payload?.objectId;if(!o)continue;const k=String(o);
  if(!byObject.has(k))byObject.set(k,[]);byObject.get(k).push({x,p});
 }
 return {execs,byObject};
}
/** The move an order makes: pause, activate, increase or reduce. */
const orderKind=p=>{const pay=p?.payload;if(!pay)return null;if(pay.action==='status')return String(pay.after?.status||'').toUpperCase()==='PAUSED'?'pause':'activate';
 const b=pay.before?.dailyBudget,a=pay.after?.dailyBudget;return finite(a)&&finite(b)?(a>b?'increase':'reduce'):null;};
/** Window around a dispatched execution in which its Malva echo can appear (never for an order that was not sent). */
const sentWindow=x=>{const start=time(x?.submittedAt);if(!finite(start))return null;const end=time(x.confirmedAt);return [start-teamPolicy.twinBeforeMs,(finite(end)?Math.max(end,start):start)+teamPolicy.twinAfterMs];};

const systemActor=a=>a==='Meta'||a==='Regra automática'||/^Automa[cç][aã]o\b/i.test(a);
const isOwnerName=(names,a)=>arr(names).some(n=>text(n)&&n.trim()===a);
/**
 * Modo Gestor (W3) identity. Launch tools create objects, Meta flips issues, automations run rules: none is a person's
 * decision (spec §1, real data of 09/11/2026). Matched on the Malva actor fields kept in attr:* (lib/activity-history.mjs
 * historyActorInfo), never on a hard-coded member.
 */
export const launchApps=Object.freeze(['Malva Epidemia','Eagle Traffic']);
export const excludeReasons=Object.freeze(['bunk','possible-bunk-echo','automation','meta','launch-tool','create-delete','out-of-scope','no-author']);
/** Window around a sent Bunk order in which the owner connection's same kind of move is an ambiguous echo (never learned). */
export const possibleEchoPolicy=Object.freeze({beforeMs:30*60000,afterMs:6*3600000});
const infoOf=e=>e?.actorInfo&&typeof e.actorInfo==='object'?e.actorInfo:null;
/** Exclusion of an edit by its Malva actor fields (automation, Meta itself, a launch tool), or null. */
export function actorExclusion(info){
 if(!info)return null;
 const key=text(info.key)?info.key:'',kind=text(info.kind)?info.kind:'',profile=text(info.profile)?info.profile.trim():'',app=text(info.app)?info.app.trim():'';
 if(kind==='automation'||/^automacao:/i.test(key))return 'automation';
 if(kind==='system'||key==='sistema'||profile==='Meta')return 'meta';
 if(profile==='Malva'||launchApps.includes(app))return 'launch-tool';
 return null;
}
/**
 * Stable person id (contract §0.2): 'owner', 'outside' (no attributed profile), or 'p:' + a hash of the Malva actor key;
 * an older record without a key hashes its display name. The raw key never leaves the executor's storage.
 */
export function personId({who,name,outside,key}={}){
 if(who==='owner')return 'owner';
 if(outside||name===outsideLabel)return 'outside';
 return 'p:'+shortId(text(key)?['person',key]:['person','name',String(name||'?')]);
}
const roleOf=person=>person==='owner'?'owner':person==='outside'?'outside':'team';
/**
 * One identity for old and new records (Modo Gestor): a record stored before the actor key existed has no `person`, so
 * it would hash its display name and split the person in two. Such a record takes the key-based id of the same display
 * name when exactly one key-based id is known for that name (from `actions` and from `known` [person, name] pairs);
 * an ambiguous name (two keys) keeps the name hash. Returns a function action → person id.
 * @param {any[]} actions @param {[string,string][]} [known] extra (person id, display name) pairs, e.g. pb:people
 */
export function personResolver(actions,known=[]){
 const byName=new Map(),add=(pid,name)=>{if(!text(pid)||!pid.startsWith('p:')||!text(name)||name===outsideLabel)return;if(pid===personId({who:'team',name}))return;if(!byName.has(name))byName.set(name,new Set());byName.get(name).add(pid);};
 for(const a of arr(actions))if(a?.person&&a.who==='team'&&!a.outside)add(a.person,a.name);
 for(const [pid,name] of arr(known))add(pid,name);
 return a=>{if(text(a?.person))return a.person;const id=personId({who:a?.who,name:a?.name,outside:a?.outside});if(!id.startsWith('p:'))return id;const s=byName.get(a?.name);return s&&s.size===1?[...s][0]:id;};
}
/**
 * The Bunker writes through the owner's Malva connection: an edit is an order's echo only when it is exactly the transition
 * a dispatched order asked for, inside its sent window, and (with the owner's name known) made by that connection or by
 * no named person. A named manager's identical move is always his own.
 */
function orderEcho(idx,e,ownerNames){
 const at=time(e?.at),actor=text(e?.actor)?e.actor.trim():'';
 if(arr(ownerNames).length&&actor&&actor!==outsideLabel&&!isOwnerName(ownerNames,actor))return null;
 return arr(idx?.byObject?.get(String(e?.objectId))).find(({x,p})=>{const w=sentWindow(x);return !!w&&finite(at)&&at>=w[0]&&at<=w[1]&&sameTransition(p,e);})||null;
}

/**
 * Who made one move. 'owner' (notch order, "Já fiz", the owner's own Malva edits), 'team' (a manager by name, or the
 * outside-Malva label), 'bunk' (the Bunk's automatic order or its Malva echo: never learned), 'system' (Meta, automations)
 * or 'unknown' (no author). `execution`: the Bunker execution a move or its echo belongs to.
 * @param {any} e move: origin 'bunker' (execution), 'owner' ("Já fiz") or 'history' (Malva edit)
 * @param {{ownerNames?:string[],index?:any}} [options]
 */
export function classifyActor(e,{ownerNames=[],index=null,ownerKeys=null}={}){
 const idx=index||{execs:new Map(),byObject:new Map()};
 if(e?.origin==='bunker'){
  const id=String(e.id||'').replace(/^bunker:/,''),hit=idx.execs.get(id);
  return hit&&isBunk(hit.p)?{who:'bunk',execution:id}:{who:'owner',name:ownerLabel,via:'bunker',execution:id};
 }
 if(e?.origin==='owner')return {who:'owner',name:ownerLabel,via:'notch'};
 if(e?.origin!=='history')return {who:'unknown'};
 const actor=text(e.actor)?e.actor.trim():'',info=infoOf(e);
 const ex=actorExclusion(info);if(ex)return {who:'system',excluded:ex};
 if(e.automatic===true||systemActor(actor))return {who:'system',excluded:/^Automa|Regra autom/i.test(actor)?'automation':'meta'};
 if(!actor)return {who:'unknown'};
 const twin=orderEcho(idx,e,ownerNames);
 if(twin)return isBunk(twin.p)?{who:'bunk',execution:twin.x.id}:{who:'owner',name:ownerLabel,via:'bunker',execution:twin.x.id};
 // The actor key beats the display name: a known owner key is the owner under any name; a key known to be someone
 // else's is never the owner's even under his display name.
 const keys=ownerKeys instanceof Set?ownerKeys:new Set(arr(ownerKeys)),key=text(info?.key)?info.key:'';
 const owner=key&&keys.size&&info?.kind==='malva'?keys.has(key):isOwnerName(ownerNames,actor);
 // Fail toward not learning: the owner connection's same move near a sent Bunk order that is not its exact echo.
 if((owner||actor===outsideLabel)&&possibleEcho(idx,e))return {who:'excluded',excluded:'possible-bunk-echo'};
 if(owner)return {who:'owner',name:ownerLabel,via:'malva'};
 return actor===outsideLabel?{who:'team',name:outsideLabel,outside:true}:{who:'team',name:actor};
}
/** A sent Bunk order on the same campaign and kind of move whose window (−30 min, +6 h) covers this edit. */
function possibleEcho(idx,e){
 const at=time(e?.at);if(!finite(at))return false;
 return arr(idx?.byObject?.get(String(e?.objectId))).some(({x,p})=>{
  if(!isBunk(p)||orderKind(p)!==e.action)return false;const start=time(x?.submittedAt);if(!finite(start))return false;
  const end=Math.max(finite(time(x.confirmedAt))?time(x.confirmedAt):start,start);
  return at>=start-possibleEchoPolicy.beforeMs&&at<=end+possibleEchoPolicy.afterMs;
 });
}

/** One identity per real-world move: its Malva event, its Bunker execution or its "Já fiz" report. */
export function actionId(e,cls){
 if(cls?.execution)return shortId(['act','x',cls.execution]);
 if(e?.origin==='owner')return shortId(['act','o',e.id]);
 if(e?.eventId)return shortId(['act',e.project,e.eventId]);
 return shortId(['act',e?.project,e?.adAccountId,e?.objectId,e?.action,e?.at]);
}

const latest=list=>list.sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt))[0]||null;
/**
 * Numbers of the campaign at the moment of the move, from the freshest complete today cut of the same local day (the live
 * Malva cut or the analysis one) and the closed windows that end where it starts. Null when no such cut exists.
 */
export function actionContext(state,e,{liveItem=null}={}){
 const at=time(e?.at);if(!finite(at))return null;
 const same=s=>s?.projectId===e.project&&s.period==='today'&&s.level==='campaign'&&s.complete!==false&&Array.isArray(s.rows);
 const cuts=[...arr(state?.snapshots).filter(same),...(same(liveItem?.snapshot)?[liveItem.snapshot]:[])].filter(s=>localDay(time(s.from),s.timezone)===localDay(at,s.timezone));
 const today=latest(cuts);if(!today)return null;
 // Numbers of "the moment" only from a cut read within 45 min of the move; an older cut is N/D, never the spend at the move.
 if(!(Math.abs(time(today.fetchedAt)-at)<=teamPolicy.contextMaxGapMs))return null;
 const row=arr(today.rows).find(r=>r?.adAccountId===e.adAccountId&&r?.externalId===e.objectId);if(!row)return null;
 const tz=today.timezone||'America/Sao_Paulo',start=time(today.from);
 const closed=p=>{const s=arr(state?.snapshots).filter(x=>x?.projectId===e.project&&x.period===p&&x.level==='campaign'&&x.complete===true&&time(x.to)===start);return s.length===1?arr(s[0].rows).find(r=>r?.adAccountId===e.adAccountId&&r?.externalId===e.objectId)||null:null;};
 const windows={yesterday:closed('yesterday'),'3d':closed('3d'),'7d':closed('7d')};
 const stage=newCampaignStage(row,windows,{now:at,timezone:tz,noSpendPeriods:verifiedNoSpendPeriods(state?.snapshots,e.project,row,today.from)});
 const m=sum([row]),spans=stage?.stage==='second-day'||stage?.spansYesterday===true,since=spans&&windows.yesterday?sum([windows.yesterday,row]):m;
 const view=x=>x?{spend:r2(x.spend),roi:r3(x.roi),result:r2(x.result)}:null;
 return {numbersAt:today.fetchedAt||null,afterAction:time(today.fetchedAt)>at,test:isTestCampaign(row.name),stage:stage?.stage||null,sinceSpansYesterday:!!(spans&&windows.yesterday),
  today:{spend:r2(m.spend),frontOrders:m.frontOrders,orders:m.orders,checkouts:m.checkouts,revenueNet:r2(m.revenueNet),roi:r3(m.roi),result:r2(m.result)},
  since:{spend:r2(since.spend),checkouts:since.checkouts,frontOrders:since.frontOrders,orders:since.orders,revenueNet:r2(since.revenueNet)},
  yesterday:view(windows.yesterday?sum([windows.yesterday]):null),d3:view(windows['3d']?sum([windows['3d']]):null),d7:view(windows['7d']?sum([windows['7d']]):null),
  budget:finite(row.dailyBudget)?{daily:row.dailyBudget,currency:row.budgetCurrency||null}:null};
}

/**
 * The earliest Sombra entry pointing at this move on the same object, active (first flag up to 5 min after the move, last
 * flag no older than 36 h before it). `flagged`: same kind of move; `cutFlagged`: for a cut, a Sombra cut of either kind
 * (a "reduzir" covers a pause and the other way round). `leadMin` > 0: the Sombra pointed it out that many minutes before.
 */
export function shadowRelation(byObject,e){
 const at=time(e?.at),all=arr(byObject?.get(okey(e?.project,e?.adAccountId,e?.objectId)));
 const active=x=>time(x.firstAt)<=at+teamPolicy.leadAheadMs&&time(x.lastAt||x.firstAt)>=at-teamPolicy.leadLookbackMs,early=(a,b)=>time(a.firstAt)-time(b.firstAt);
 const same=all.filter(x=>entryKind(x)===e.action&&active(x)).sort(early),cut=isCutKind(e?.action)?all.filter(x=>isCutKind(entryKind(x))&&active(x)).sort(early):[];
 const s=same[0]||cut[0];if(!s)return {flagged:false,cutFlagged:false};
 const exec=time(s.firstWouldExecuteAt);
 return {flagged:!!same[0],cutFlagged:cut.length>0,rule:s.rule||null,leadMin:Math.round((at-time(s.firstAt))/60000),executable:finite(exec)&&exec<=at,alertOnly:s.alertOnly===true};
}

/**
 * People's moves of the last `windowMs` as memory records (settled 5 min, campaign level, Meta sales campaigns of the
 * configured projects), read from the raw sources, never from the merged activity log (which folds moves of different
 * people into one another within ±3 h):
 * - the Malva edit feed (`attributions`, one record per Malva event, with its author);
 * - the owner's "Já fiz" reports, each paired with at most one edit of the same move with no person ("Fora da Malva
 *   Dash") or the owner's own name, the closest one before the tap (up to 3 h) or right after it (10 min);
 * - the owner's orders executed through the Bunker, counted by their execution (their Malva echo is skipped).
 * The Bunk's own orders and their echoes are never learned; `dropMoves` lets a later pass remove an echo that a pass with
 * an older central stored as a person's.
 * @param {{attributions?:any[],state?:any,entries?:any[],objects?:Set<string>|null,ownerNames?:string[],liveItems?:any[],paramsOf?:(project:string)=>any,now?:number,windowMs?:number}} [sources]
 */
export function teamActions({attributions=[],state=null,entries=[],objects=null,ownerNames=[],ownerKeys=[],liveItems=[],paramsOf=()=>({}),now=Date.now(),windowMs=26*3600000}={}){
 const index=actionIndex(state),configured=new Set(Object.keys(state?.config||{})),byObject=new Map(),out=[],seen=new Set(),aliases=[];
 // Owner keys: the ones given (identity known: they alone count), else the Malva keys seen under the owner's own name.
 const keys=new Set(arr(ownerKeys).filter(text));
 if(!keys.size)for(const a of arr(attributions)){const i=infoOf(a);if(i?.kind==='malva'&&text(i.key)&&text(a?.actor)&&isOwnerName(ownerNames,a.actor.trim()))keys.add(i.key);}
 const excluded=[],exclude=(a,reason)=>{if(excluded.length<3000)excluded.push({id:shortId(['ex',a.project,a.eventId||a.key||a.at]),project:a.project??null,at:a.at??null,reason});};
 for(const x of arr(entries)){const k=okey(x.project,x.adAccountId,x.objectId);if(!byObject.has(k))byObject.set(k,[]);byObject.get(k).push(x);}
 const inScope=e=>kinds.has(e?.action)&&fieldOk(e)&&text(e.project)&&configured.has(e.project)&&text(String(e.objectId??''))&&!isWarmupCampaign(e.name)&&(!objects||objects.has(okey(e.project,e.adAccountId,e.objectId)));
 const settled=at=>finite(at)&&at>=now-windowMs&&at+teamPolicy.settleMs<=now;
 const edits=[];
 for(const a of arr(attributions)){
  if(!settled(time(a?.at)))continue;
  // Creating, deleting or archiving an object is never a decision on a running campaign.
  if((a?.field==='status'||a?.field==='effectiveStatus')&&(/^(DELETED|ARCHIVED)$/i.test(String(a?.after??''))||a?.before==null&&a?.after!=null)){exclude(a,'create-delete');continue;}
  const c=describeChange({field:a?.field,before:a?.before,after:a?.after});if(!c)continue;
  const e={origin:'history',id:'attr:'+(a.key||a.eventId||''),eventId:a.eventId||null,project:a.project,adAccountId:a.adAccountId,objectId:a.objectId,name:a.name||null,actor:a.actor??null,automatic:a.automatic===true,at:a.at,currency:a.currency||null,...(infoOf(a)?{actorInfo:infoOf(a)}:{}),...c};
  if(inScope(e))edits.push(e);else if(kinds.has(e.action))exclude(e,'out-of-scope');
 }
 const reports=arr(ownerAppliedEvents(state||{})).filter(r=>inScope(r)&&settled(time(r.at))).sort((a,b)=>time(a.at)-time(b.at));
 const orders=[];
 for(const {x,p} of index.execs.values()){
  if(!p||isBunk(p)||!p.payload?.objectId)continue;const kind=orderKind(p);if(!kind||!sentWindow(x))continue;
  const echo=edits.find(e=>orderEcho(index,e,ownerNames)?.x?.id===x.id);
  const at=x.status==='Confirmada'&&finite(time(x.confirmedAt))?time(x.confirmedAt):echo?time(echo.at):NaN;if(!settled(at))continue;
  const pay=p.payload,status=pay.action==='status';
  const e={origin:'bunker',id:'bunker:'+x.id,project:p.project,adAccountId:pay.adAccountId,objectId:pay.objectId,name:pay.objectName||null,action:kind,field:status?'status':'dailyBudget',
   before:status?pay.before?.status:pay.before?.dailyBudget,after:status?pay.after?.status:pay.after?.dailyBudget,currency:pay.currency||null,at:new Date(at).toISOString()};
  if(inScope(e))orders.push(e);
 }
 // "Já fiz" ↔ its trace: same project, campaign and move; nameless or the owner's own edit; closest before, else right after.
 const used=new Set(),paired=new Map(),ownerEdits=new Set();
 for(const r of reports){
  const c=edits.filter(e=>!used.has(e)&&e.project===r.project&&String(e.objectId)===String(r.objectId)&&e.action===r.action&&(e.actor===outsideLabel||isOwnerName(ownerNames,e.actor))&&!orderEcho(index,e,ownerNames)
   &&time(e.at)>=time(r.at)-teamPolicy.ownerReportBeforeMs&&time(e.at)<=time(r.at)+teamPolicy.ownerReportAfterMs);
  const e=c.filter(x=>time(x.at)<=time(r.at)).sort((a,b)=>time(b.at)-time(a.at))[0]||c.filter(x=>time(x.at)>time(r.at)).sort((a,b)=>time(a.at)-time(b.at))[0];
  if(!e)continue;used.add(e);paired.set(r,e);ownerEdits.add(e);
  aliases.push({from:actionId(r,{}),to:actionId(e,{}),project:r.project});
  // The same native edit seen through another project (shared account) is the same owner act there.
  for(const o of edits)if(o!==e&&String(o.objectId)===String(e.objectId)&&o.action===e.action&&Math.abs(time(o.at)-time(e.at))<=2000&&(o.actor===outsideLabel||isOwnerName(ownerNames,o.actor)))ownerEdits.add(o);
 }
 const moves=[];
 for(const e of edits){
  if(ownerEdits.has(e)){moves.push([e,{who:'owner',name:ownerLabel,via:'notch'}]);continue;}
  const cls=classifyActor(e,{ownerNames,index,ownerKeys:keys});
  // An order's echo is never a move of its own: the Bunk's is not learned, the owner's counts by its execution.
  if(cls.who==='bunk')exclude(e,'bunk');else if(cls.excluded)exclude(e,cls.excluded);else if(cls.who==='unknown')exclude(e,'no-author');
  if(cls.execution||(cls.who!=='owner'&&cls.who!=='team'))continue;
  moves.push([e,cls]);
 }
 for(const r of reports)if(!paired.has(r))moves.push([r,{who:'owner',name:ownerLabel,via:'notch'}]);
 for(const o of orders)moves.push([o,{who:'owner',name:ownerLabel,via:'bunker',execution:o.id.slice(7)}]);
 for(const [e,cls] of moves){
  const id=actionId(e,cls);if(seen.has(id))continue;seen.add(id);
  const at=time(e.at),liveItem=arr(liveItems).find(i=>i?.projectId===e.project)||null,ctx=actionContext(state,e,{liveItem});
  const tz=liveItem?.snapshot?.timezone||arr(state?.snapshots).find(s=>s?.projectId===e.project&&s.timezone)?.timezone||'America/Sao_Paulo';
  const day=localDay(at,tz);if(!day)continue;
  const budget=e.field==='dailyBudget'&&finite(Number(e.before))&&finite(Number(e.after))&&Number(e.before)>0?{before:Number(e.before),after:Number(e.after),step:r3(Number(e.after)/Number(e.before)-1),currency:e.currency||null}:null;
  // The Sombra's own pause point at that spend, only where its rule judges (a new campaign on its 1st or 2nd day), with
  // its today-only check: a sale only before today does not cover today's spend without sale.
  let guard=null;
  if(e.action==='pause'&&ctx&&(ctx.stage==='first-day'||ctx.stage==='second-day')){
   const params=paramsOf(e.project)||{},todaySale=[ctx.today.frontOrders,ctx.today.orders,ctx.today.revenueNet].some(v=>finite(v)&&v>0);
   let g=first24hGuard(ctx.since,params);
   if(g.level==='sold'&&ctx.sinceSpansYesterday&&!todaySale&&finite(ctx.today.spend)&&ctx.today.spend>0)g={...first24hGuard(ctx.today,params),todayOnly:true};
   guard=g.level==='sold'?{sold:true}:g.level==='waiting'?null:{level:g.level,pauseAt:g.pauseAt,limit:g.limit,basis:g.basis,...(g.todayOnly?{todayOnly:true}:{})};
  }
  const info=infoOf(e),person=personId({who:cls.who,name:cls.name,outside:cls.outside,key:info?.kind==='malva'?info.key:null});
  out.push({id,v:teamPolicy.version,day,project:e.project,who:cls.who,name:cls.name,...(cls.outside?{outside:true}:{}),via:cls.via||null,actor:e.origin==='history'?e.actor||null:null,person,role:roleOf(person),...(info?.profile&&cls.outside?{profile:info.profile}:{}),kind:e.action,at:new Date(at).toISOString(),
   adAccountId:e.adAccountId??null,objectId:e.objectId,native:shortId(['native',String(e.objectId),e.action,Math.round(at/teamPolicy.nativeBucketMs)]),
   minute:localMinute(at,tz),budget,ctx,shadow:shadowRelation(byObject,e),guard,grade:null,capturedAt:new Date(now).toISOString()});
 }
 // Self-healing: an order's echo stored by an older pass (as the owner's Malva edit, or by the owner's name before it was
 // known) is removed by its description; moves recorded from an execution or a "Já fiz" are never touched.
 const dropMoves=[];
 for(const {x,p} of index.execs.values()){
  const w=sentWindow(x),kind=orderKind(p);if(!w||!kind||!p?.payload?.objectId)continue;
  dropMoves.push({objectId:String(p.payload.objectId),kind,after:p.payload.action==='budget'?p.payload.after?.dailyBudget??null:null,from:w[0],to:w[1],names:arr(ownerNames).filter(text)});
 }
 return {actions:out,drop:[],aliases,dropMoves,excluded};
}

/** Counts of an exclusion list (teamActions `excluded`): total, per reason and the quarantined ambiguous echoes. */
export function exclusionCounts(list){
 const byReason={};for(const x of arr(list))if(excludeReasons.includes(x?.reason))byReason[x.reason]=(byReason[x.reason]||0)+1;
 const total=Object.values(byReason).reduce((a,b)=>a+b,0);
 return {total,byReason,quarantined:byReason['possible-bunk-echo']||0};
}

/**
 * Reversals among people's moves: a move undone on the same campaign by the opposite move within `windowMs` (48 h by
 * default): pause ↔ activate, increase ↔ reduce. Returns move id → the first undoing move {person, name, kind, at}.
 * Pure; the Bunk is never in this list (its moves are not people's).
 */
export const reversalPolicy=Object.freeze({windowMs:48*3600000,oppositeWindowMs:12*3600000});
const oppositeKind={pause:'activate',activate:'pause',increase:'reduce',reduce:'increase'};
export function teamReversals(actions,{windowMs=reversalPolicy.windowMs}={}){
 const byObj=new Map(),out=new Map();
 for(const a of arr(actions)){if(!a?.id||!kinds.has(a.kind)||!finite(time(a.at)))continue;const k=JSON.stringify([a.adAccountId??null,String(a.objectId)]);if(!byObj.has(k))byObj.set(k,[]);byObj.get(k).push(a);}
 for(const list of byObj.values()){
  list.sort((a,b)=>time(a.at)-time(b.at)||String(a.id).localeCompare(String(b.id)));
  for(let i=0;i<list.length;i++){const a=list[i];
   const r=list.slice(i+1).find(b=>b.kind===oppositeKind[a.kind]&&time(b.at)>time(a.at)&&time(b.at)-time(a.at)<=windowMs);
   if(r)out.set(a.id,{person:r.person||null,name:r.name||null,kind:r.kind,at:r.at});
  }
 }
 return out;
}

/**
 * People's moves from the 30-day read-only backfill (Modo Gestor, owner answer Q11; lib/activity-history.mjs
 * backfillTeamHistory), classified with the same exclusions as the live capture: the Bunk and its echo (exact or
 * ambiguous), Meta, automations, launch tools, create/delete/archive, out of scope and no author. They carry only the
 * day and the move (`ctx.source:'backfill-daily'`): intraday numbers are N/D, so they feed steps, counts and hours only.
 * The id is the live capture's (one Malva event = one move), so a day captured live and backfilled counts once.
 * @param {any[]} events stored backfill events (activityEvent shape) @param {{state?:any,ownerNames?:string[],ownerKeys?:string[],timezone?:string}} [options]
 */
export function backfillMoves(events,{state=null,ownerNames=[],ownerKeys=[],timezone='America/Sao_Paulo'}={}){
 const index=actionIndex(state),configured=new Set(Object.keys(state?.config||{})),moves=[],excluded=[],seen=new Set();
 const keys=new Set(arr(ownerKeys).filter(text));
 if(!keys.size)for(const a of arr(events)){const i=infoOf(a);if(i?.kind==='malva'&&text(i.key)&&text(a?.actor)&&isOwnerName(ownerNames,a.actor.trim()))keys.add(i.key);}
 const exclude=(a,reason)=>excluded.push({id:shortId(['ex',a?.project,a?.eventId||a?.key||a?.at]),project:a?.project??null,at:a?.at??null,reason});
 for(const a of arr(events)){
  if(!text(a?.project)||!finite(time(a?.at)))continue;
  if((a.field==='status'||a.field==='effectiveStatus')&&(/^(DELETED|ARCHIVED)$/i.test(String(a.after??''))||a.before==null&&a.after!=null)){exclude(a,'create-delete');continue;}
  const c=describeChange({field:a.field,before:a.before,after:a.after});if(!c)continue;
  const e={origin:'history',id:'attr:'+(a.key||a.eventId||''),eventId:a.eventId||null,project:a.project,adAccountId:a.adAccountId,objectId:a.objectId,name:a.name||null,actor:a.actor??null,automatic:a.automatic===true,at:a.at,currency:a.currency||null,...(infoOf(a)?{actorInfo:infoOf(a)}:{}),...c};
  if(!kinds.has(e.action))continue;
  if(!(fieldOk(e)&&configured.has(e.project)&&text(String(e.objectId??''))&&!isWarmupCampaign(e.name))){exclude(e,'out-of-scope');continue;}
  const cls=classifyActor(e,{ownerNames,index,ownerKeys:keys});
  if(cls.who==='bunk'){exclude(e,'bunk');continue;}if(cls.excluded){exclude(e,cls.excluded);continue;}if(cls.who==='unknown'){exclude(e,'no-author');continue;}
  if(cls.execution||(cls.who!=='owner'&&cls.who!=='team'))continue;
  const id=actionId(e,{});if(seen.has(id))continue;seen.add(id);
  const at=time(e.at),day=localDay(at,timezone);if(!day)continue;
  const info=infoOf(e),person=personId({who:cls.who,name:cls.name,outside:cls.outside,key:info?.kind==='malva'?info.key:null});
  const budget=e.field==='dailyBudget'&&finite(Number(e.before))&&finite(Number(e.after))&&Number(e.before)>0?{before:Number(e.before),after:Number(e.after),step:r3(Number(e.after)/Number(e.before)-1),currency:e.currency||null}:null;
  moves.push({id,v:teamPolicy.version,day,project:e.project,who:cls.who,name:cls.name,...(cls.outside?{outside:true}:{}),via:cls.via||null,person,role:roleOf(person),kind:e.action,at:new Date(at).toISOString(),
   adAccountId:e.adAccountId??null,objectId:e.objectId,campaign:typeof e.name==='string'?e.name.slice(0,60):null,minute:localMinute(at,timezone),budget,ctx:{source:'backfill-daily'},shadow:null,guard:null,grade:null});
 }
 return {moves,excluded};
}

/** Storage key of one day × project shard of people's moves (same `learn:` prefix: same listing and retention). */
export const teamKey=(day,project)=>`learn:${day}:${project}:team`;
/**
 * Keys of the last `days` local days of each project, in its own timezone (grading reads D and D+1 while current).
 * @param {string[]} projects @param {number} [now] @param {number} [days] @param {(project:string)=>string} [timezoneOf]
 */
export function recentTeamKeys(projects,now=Date.now(),days=3,timezoneOf=(_project)=>'America/Sao_Paulo'){
 const out=[];
 for(const p of arr(projects)){const today=localDay(now,timezoneOf(p)||'America/Sao_Paulo');for(let i=0;i<days;i++)out.push(teamKey(shiftDay(today,-i),p));}
 return out;
}

/**
 * Upserts moves into their shards. The numbers, the Sombra relation and the read time of the first sighting stay frozen;
 * the author may improve (a later trace names him), the next-day grade arrives later, and a move found to be the Bunk's own
 * is removed. `existing`: Map key → stored shard.
 * @param {any} existing Map (any realm) or object @param {any[]} actions
 * @param {{drop?:string[],aliases?:{from:string,to:string,project?:string}[],dropMoves?:any[]}} [options]
 */
export function mergeTeam(existing,actions,{drop=[],aliases=[],dropMoves=[]}={}){
 const shards=new Map(),changed=new Set(),gone=new Set(arr(drop));
 const shard=(day,project)=>{const k=teamKey(day,project);if(!shards.has(k)){const old=getFrom(existing,k);shards.set(k,{day,project,kind:'team',actions:{...(old?.actions||{})},...(old?.full?{full:true}:{})});}return [k,shards.get(k)];};
 // An echo is only a record that came from a Malva edit by the owner's connection; never one from an execution or a report.
 const echoable=(a,m)=>a.via==='malva'||a.who==='team'&&arr(m.names).length>0&&arr(m.names).includes(a.actor);
 const echo=a=>a.via!=='bunker'&&a.via!=='notch'&&arr(dropMoves).some(m=>echoable(a,m)&&m.objectId===String(a.objectId)&&m.kind===a.kind&&time(a.at)>=m.from&&time(a.at)<=m.to&&(m.after===null||finite(a.budget?.after)&&Math.abs(a.budget.after-m.after)<0.01));
 const alias=new Map(arr(aliases).map(x=>[`${x.project||''}|${x.from}`,x.to]));
 for(const [,old] of entriesOf(existing)){
  if(!old?.actions||old.kind!=='team')continue;
  const ids=Object.keys(old.actions),hit=ids.filter(id=>gone.has(id)||echo(old.actions[id])),moved=ids.filter(id=>alias.has(`${old.project}|${id}`));if(!hit.length&&!moved.length)continue;
  const [key,s]=shard(old.day,old.project);
  for(const id of hit)delete s.actions[id];
  // A "Já fiz" stored alone moves onto its trace's id, keeping the numbers of its first sighting.
  for(const id of moved){const to=alias.get(`${old.project}|${id}`),rec=s.actions[id];if(!rec)continue;delete s.actions[id];if(!s.actions[to])s.actions[to]={...rec,id:to};}
  changed.add(key);
 }
 for(const a of arr(actions)){
  if(!text(a?.day)||!dayRe.test(a.day)||!text(a.project)||echo(a))continue;
  const [k,s]=shard(a.day,a.project),old=s.actions[a.id];
  if(!old){if(Object.keys(s.actions).length>=teamPolicy.maxActionsPerShard){if(!s.full){s.full=true;changed.add(k);}continue;}s.actions[a.id]=a;changed.add(k);continue;}
  // A later trace may name the owner (his Malva name learned, a "Já fiz" folded in): never the other way around.
  const better=old.who==='team'&&a.who==='owner';
  const next={...old,...(better?{who:a.who,name:a.name,via:a.via,outside:a.outside}:{}),grade:old.grade?.verdict?old.grade:a.grade||old.grade||null};
  if(JSON.stringify(next)!==JSON.stringify(old)){s.actions[a.id]=next;changed.add(k);}
 }
 return {put:Object.fromEntries([...changed].map(k=>[k,shards.get(k)]))};
}

/**
 * Next-day grade of a budget move or an activation, with the Sombra's verdict: a raise or an activation is right when the day
 * it acts on made money, a cut when it lost. A move up to 00:30 acts on that same day; later ones on the next. Spend N/D stays
 * open; no spend is "parou". Read only while that day is the current closed "yesterday" (Malva complete windows).
 * @param {any} shard team shard @param {any[]} snapshots @returns {any|null} the updated shard, or null when nothing changed
 */
export function gradeTeamShard(shard,snapshots){
 if(!shard?.actions)return null;
 const closed=arr(snapshots).filter(s=>s?.period==='yesterday'&&s.level==='campaign'&&s.complete===true&&s.source==='Malva MCP');
 let changed=false;const actions={...shard.actions};
 // D+3 (Modo Gestor, W3): the closed 3 days starting on the day the move acts on, once Malva's ~72 h attribution has
 // settled. Kept apart (`grade.d3`): the D+1 verdict above and every counter that reads it are unchanged.
 const d3s=arr(snapshots).filter(s=>s?.period==='3d'&&s.level==='campaign'&&s.complete===true&&s.source==='Malva MCP');
 for(const [id,a] of Object.entries(actions)){
  if(a.grade?.d3||!['increase','reduce','activate'].includes(a.kind))continue;
  const target=finite(a.minute)&&a.minute<=teamPolicy.nightEndMinute?a.day:shiftDay(a.day,1);
  const s=d3s.find(x=>x.projectId===a.project&&localDay(time(x.from),x.timezone)===target&&Math.abs(time(x.to)-time(x.from)-3*86400000)<=3600000);if(!s)continue;
  const row=arr(s.rows).find(r=>r?.adAccountId===a.adAccountId&&r?.externalId===a.objectId),m=row?sum([row]):null;
  let verdict;
  if(!m)verdict='parou';else if(!finite(m.spend))continue;else if(!(m.spend>0))verdict='parou';else if(!finite(m.result))continue;
  else verdict=(a.kind==='reduce'?m.result<0:m.result>0)?'acertou':'errou';
  actions[id]={...a,grade:{...(a.grade||{}),d3:{target,verdict,roi:m?r3(m.roi):null,spend:m?r2(m.spend):0,result:m?r2(m.result):null}}};changed=true;
 }
 for(const [id,a] of Object.entries(actions)){
  if(a.grade?.verdict||!['increase','reduce','activate'].includes(a.kind))continue;
  const target=finite(a.minute)&&a.minute<=teamPolicy.nightEndMinute?a.day:shiftDay(a.day,1);
  const s=closed.find(x=>x.projectId===a.project&&localDay(time(x.from),x.timezone)===target);if(!s)continue;
  const row=arr(s.rows).find(r=>r?.adAccountId===a.adAccountId&&r?.externalId===a.objectId),m=row?sum([row]):null;
  let verdict;
  if(!m)verdict='parou';else if(!finite(m.spend))continue;else if(!(m.spend>0))verdict='parou';else if(!finite(m.result))continue;
  else verdict=(a.kind==='reduce'?m.result<0:m.result>0)?'acertou':'errou';
  actions[id]={...a,grade:{target,verdict,roi:m?r3(m.roi):null,spend:m?r2(m.spend):0,...(a.grade?.d3?{d3:a.grade.d3}:{})}};changed=true;
 }
 return changed?{...shard,actions}:null;
}

function lineList(items,max){return items.filter(Boolean).slice(0,max);}
/**
 * Patterns of people, the Bunk's anticipation and threshold proposals, overall and per project.
 * @param {any[]} shards stored `learn:…:team` values
 * @param {{now?:number,names?:Record<string,string>,coverage?:Record<string,string[]>,paramsOf?:(project:string)=>any}} [options]
 *   names: project id → name; coverage: project id → hour stamps with a Sombra pass; paramsOf: current private params
 */
export function teamStats(shards,{now=Date.now(),names={},coverage={},paramsOf=()=>({}),bases=null}={}){
 // Base of each project-day (lib/shadow-learning.mjs dailyBases): share of campaigns that lost / made money that day.
 const baseOf=new Map(arr(bases).filter(b=>b?.campaigns>0).map(b=>[`${b.project}|${b.day}`,b]));
 const todayIdx=dayIndex(localDay(now,'America/Sao_Paulo')),all=[],seen=new Set();
 for(const s of arr(shards))if(s?.kind==='team')for(const a of Object.values(s.actions||{}))if(!seen.has(a.id)){seen.add(a.id);all.push(a);}
 const age=a=>todayIdx-dayIndex(a.day),inDays=n=>a=>age(a)<n,covered=a=>coveredAt(coverage,a.project,a.at);
 const isCut=a=>isCutKind(a.kind);
 const scope=list=>{
  const profile=list.filter(inDays(teamPolicy.profileDays)),recent=list.filter(inDays(teamPolicy.recentDays));
  // One person per stable id (actor key, W3); an older record without one takes the key-based id of the same name.
  const people=new Map(),personOf=personResolver(list);for(const a of profile){const k=personOf(a);if(!people.has(k))people.set(k,[]);people.get(k).push(a);}
  // A person's move undone by the opposite move on the same campaign within 48 h (by anyone): the disagreement signal.
  const undone=teamReversals(profile);
  const person=[...people].map(([pid,l])=>{
   const latest=[...l].sort((a,b)=>time(b.at)-time(a.at))[0],name=pid==='owner'?ownerLabel:latest?.name||'?';
   const timed=l.filter(a=>finite(a.minute)),hours=timed.length?Array.from({length:24},(_,h)=>timed.filter(a=>Math.floor(a.minute/60)===h).length):null;
   const tests=l.filter(a=>a.kind==='pause'&&a.guard&&!a.guard.sold&&finite(a.ctx?.since?.spend));
   const spendOf=a=>a.guard.todayOnly?a.ctx.today.spend:a.ctx.since.spend;
   const graded=l.filter(a=>a.grade?.verdict==='acertou'||a.grade?.verdict==='errou'),right=graded.filter(a=>a.grade.verdict==='acertou').length;
   const ups=l.filter(a=>a.kind==='increase'&&finite(a.budget?.step)).map(a=>a.budget.step),downs=l.filter(a=>a.kind==='reduce'&&finite(a.budget?.step)).map(a=>a.budget.step);
   // Against picking any campaign that day: a cut is right as often as campaigns lost, a raise as often as they made money.
   const based=graded.map(a=>{const b=baseOf.get(`${a.project}|${a.grade.target}`);return b?(a.kind==='reduce'?b.loss:b.profit)/b.campaigns:null;}).filter(finite);
   const expected=based.length?r3(based.reduce((x,y)=>x+y,0)/based.length):null;
   const base=bases===null?null:{graded:based.length,expected,edge:expected===null||!graded.length?null:r3(right/graded.length-expected)};
   const d3=l.filter(a=>a.grade?.d3?.verdict==='acertou'||a.grade?.d3?.verdict==='errou'),d3right=d3.filter(a=>a.grade.d3.verdict==='acertou').length;
   return {name,person:pid,role:roleOf(pid),hours,reversed:l.filter(a=>undone.has(a.id)).length,actions:l.length,pause:l.filter(a=>a.kind==='pause').length,reduce:l.filter(a=>a.kind==='reduce').length,increase:l.filter(a=>a.kind==='increase').length,activate:l.filter(a=>a.kind==='activate').length,
    testPauses:{n:tests.length,campaigns:new Set(tests.map(a=>String(a.objectId))).size,median:r2(quantile(tests.map(spendOf),0.5)),p25:r2(quantile(tests.map(spendOf),0.25)),p75:r2(quantile(tests.map(spendOf),0.75)),
     medianCheckouts:quantile(tests.map(a=>a.ctx.since.checkouts),0.5),beforePoint:tests.filter(a=>finite(a.guard.pauseAt)&&spendOf(a)<a.guard.pauseAt).length,
     // The Sombra's own pause point on those same tests (median), to compare the person's pause with.
     point:r2(quantile(tests.map(a=>a.guard.pauseAt).filter(finite),0.5))},
    budget:{graded:graded.length,right,accuracy:graded.length?r3(right/graded.length):null,...wilson(right,graded.length),medianUp:r3(quantile(ups,0.5)),medianDown:r3(quantile(downs,0.5)),
     base,d3:{graded:d3.length,right:d3right,accuracy:d3.length?r3(d3right/d3.length):null,...wilson(d3right,d3.length)}}};
  }).sort((a,b)=>b.actions-a.actions||String(a.name).localeCompare(String(b.name)));
  const first=a=>(a.shadow?.flagged||a.shadow?.cutFlagged)&&a.shadow.leadMin>0;
  const cutsCovered=recent.filter(a=>isCut(a)&&covered(a)),ahead=cutsCovered.filter(first);
  const prevCuts=list.filter(a=>age(a)>=teamPolicy.recentDays&&age(a)<2*teamPolicy.recentDays&&isCut(a)&&covered(a)),prevAhead=prevCuts.filter(first);
  const daily=[];for(let i=teamPolicy.trendDays-1;i>=0;i--){const d=localDay(now-i*86400000,'America/Sao_Paulo'),l=list.filter(a=>a.day===d&&isCut(a)&&covered(a));daily.push({day:d,cuts:l.length,ahead:l.filter(first).length});}
  const lead={cuts:cutsCovered.length,ahead:ahead.length,share:cutsCovered.length?r3(ahead.length/cutsCovered.length):null,medianLeadMin:quantile(ahead.map(a=>a.shadow.leadMin),0.5),
   previous:{cuts:prevCuts.length,ahead:prevAhead.length,share:prevCuts.length?r3(prevAhead.length/prevCuts.length):null},daily};
  return {actions:profile.length,from:list.map(a=>a.day).sort()[0]||null,people:person,lead};
 };
 const projects=[...new Set(all.map(a=>a.project))];
 // One native move on a campaign shared by two projects counts once across projects (each project keeps its own copy).
 const nativeSeen=new Set(),unique=all.filter(a=>{const k=a.native||a.id;if(nativeSeen.has(k))return false;nativeSeen.add(k);return true;});
 const out={version:teamPolicy.version,at:new Date(now).toISOString(),memory:{actions:unique.length,from:all.map(a=>a.day).sort()[0]||null,full:arr(shards).filter(s=>s?.full).length},all:scope(unique),projects:Object.fromEntries(projects.map(p=>[p,scope(all.filter(a=>a.project===p))]))};
 out.proposals=teamProposals(all,{now,names,paramsOf});
 return out;
}

/**
 * Threshold proposals for the owner, from the team's own pauses of new campaigns with no sale on their 1st or 2nd day
 * (30 days): when people pause clearly earlier than the Sombra's pause point IN FORCE NOW (recomputed with today's private
 * params, so an accepted proposal stops coming back), propose bringing it closer. One proposal per project and pause
 * basis (0–1 IC vs 2+ IC), from 5+ pauses on 5+ campaigns over 3+ days. A reading for the owner's decision only;
 * retrospective, so an accepted value is measured on the cases that come after it.
 * @param {any[]} actions @param {{now?:number,names?:Record<string,string>,paramsOf?:(project:string)=>any}} [options]
 */
export function teamProposals(actions,{now=Date.now(),names={},paramsOf=()=>({})}={}){
 const todayIdx=dayIndex(localDay(now,'America/Sao_Paulo')),out=[],groups=new Map();
 for(const a of arr(actions)){
  if(a.kind!=='pause'||!a.guard||a.guard.sold||!finite(a.ctx?.since?.spend)||todayIdx-dayIndex(a.day)>=teamPolicy.profileDays)continue;
  const g=first24hGuard(a.guard.todayOnly?a.ctx.today:a.ctx.since,paramsOf(a.project)||{});if(!finite(g.pauseAt)||g.level==='sold'||g.level==='waiting')continue;
  const k=JSON.stringify([a.project,g.basis]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push({a,point:g.pauseAt,basis:g.basis,spend:a.guard.todayOnly?a.ctx.today.spend:a.ctx.since.spend});
 }
 for(const l of groups.values()){
  const {a:{project},basis}=l[0],campaigns=new Set(l.map(x=>String(x.a.objectId))).size,days=new Set(l.map(x=>x.a.day)).size;
  if(l.length<teamPolicy.minProposal||campaigns<teamPolicy.minProposalCampaigns||days<teamPolicy.minProposalDays)continue;
  const spends=l.map(x=>x.spend),median=quantile(spends,0.5),point=quantile(l.map(x=>x.point),0.5),before=l.filter(x=>x.spend<x.point).length;
  if(!(finite(median)&&finite(point))||before<teamPolicy.minBeforePoint||median>point*(1-teamPolicy.proposalGap))continue;
  const value=Math.max(teamPolicy.roundTo,Math.round(median/teamPolicy.roundTo)*teamPolicy.roundTo);if(!(value<point))continue;
  const p25=quantile(spends,0.25),p75=quantile(spends,0.75),ic=basis==='low-ic'?'com 0–1 IC':basis==='project'?'com 2+ IC':'com IC não informado';
  out.push({id:shortId(['proposal','test-pause',project,basis,value]),project,kind:'test-pause',basis,n:l.length,campaigns,days,before,median:r2(median),p25:r2(p25),p75:r2(p75),current:r2(point),value,
   text:`${names[project]||'Projeto'}: em 30 dias, vocês fizeram ${l.length} pausas de campanhas novas sem venda ${ic} (${campaigns} campanhas, ${days} dias), com gasto mediano de ${brl(median)} (metade entre ${brl(p25)} e ${brl(p75)}); ${before} antes do ponto de pausa da Sombra em vigor (${brl(point)}). Proposta: antecipar a pausa para ~${brl(value)}. Só muda com o seu sim; depois a Sombra mede os casos seguintes.`});
 }
 return out.sort((a,b)=>b.n-a.n).slice(0,teamPolicy.maxProposals);
}

/**
 * Pre-rendered pt-BR lines (strings only). For the notch the owner reads "Você"; for the AI analysts pass
 * `owner: 'o dono'` so no line can be read as addressed to the model.
 * @param {any} stats @param {{project?:string,owner?:string}} [options]
 */
export function teamLines(stats,{project='all',owner=ownerLabel}={}){
 const s=project==='all'?stats?.all:stats?.projects?.[project];if(!s)return [];
 const short=n=>n===ownerLabel?owner:n===outsideLabel?'fora da Malva':String(n).split(/\s+/)[0];
 const tests=s.people.filter(p=>p.testPauses.n>0).sort((a,b)=>b.testPauses.n-a.testPauses.n||String(a.name).localeCompare(String(b.name))).slice(0,3);
 const graded=s.people.filter(p=>p.budget.graded>=teamPolicy.minGradedLine).slice(0,3);
 const l=s.lead;
 return lineList([
  tests.length?`Pausas de campanhas novas sem venda (30 dias): ${tests.map(p=>`${short(p.name)} ${p.testPauses.n} · mediana ${brl(p.testPauses.median)}`).join('; ')}.`:null,
  l.cuts?`A Sombra apontou antes ${l.ahead} de ${l.cuts} cortes da equipe em 7 dias${finite(l.medianLeadMin)?` (mediana ${Math.round(l.medianLeadMin)} min antes)`:''}${l.previous.cuts?`; na semana anterior, ${l.previous.ahead} de ${l.previous.cuts}`:''}.`:null,
  graded.length?`Aumentos seguidos de lucro e reduções seguidas de prejuízo no dia seguinte (30 dias): ${graded.map(p=>`${short(p.name)} ${p.budget.right} de ${p.budget.graded}`).join('; ')}.`:null,
 ],teamPolicy.maxLines);
}
