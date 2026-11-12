/**
 * Autonomia v2 · Modo Gestor, Phase 1 read model (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, contracts (a) and (b)).
 *
 * - `buildDeepBase`: the compact `autonomyDeepBase` the executor stores at the end of a Sombra pass, from the state that
 *   pass already holds (owner permissions, the Bunk's own orders, per-campaign guardrails). Never a central read.
 * - `buildDeepView`: the `GET /api/autonomy?view=deep` answer, from Durable Object keys only.
 * - `simRow` / `simRowsView`: the positional rows the browser's draft simulator runs on (lib/autonomy-simulate.mjs).
 * - `decisionStatus`: what the owner's permissions would do with one decision (Enviaria · Pediria · Só sugestão ·
 *   Segurada · Desligado). A playbook decision (`source:'playbook'`) is never "enviaria" or "pediria" in Phase 1.
 * - `autonomyCompanion`: the notch `autonomy` block.
 *
 * Pure and read-only: no provider call, no storage, no proposal, no approval, no dispatch. It calls `autonomyGrant` (pure)
 * only to say what the permissions would do; nothing here records an order. N/D stays null, never 0.
 */
import {sum} from './analysis.mjs';
import {verifiedNoSpendPeriods} from './test-launch.mjs';
import {partialDayHold} from './partial-day.mjs';
import {campaignStage,activeSalesRow} from './campaign-context.mjs';
import {shadowRules,scoreGatedRules,shadowRulePolicy,entryRuleVersion} from './autonomy-shadow.mjs';
import {autonomyGrant,autonomyView,effectiveMode,decisionAction,campaignKey,autonomyLimits} from './autonomy-grant.mjs';
import {shortId} from './learning-math.mjs';

export const deepViewPolicy=Object.freeze({version:1,baseEveryMs:60000,baseLiveEveryMs:5*60000,baseMaxBytes:256000,baseCutCampaigns:40,baseMaxOrders:400,ordersDays:8,doneDays:7,
 maxCampaigns:80,maxCampaignsAll:20,maxDecisions:150,maxDone:50,maxPlays:12,maxPlaysAll:6,caseRefs:5,blindSpots:20,divergences:10,proposals:5,people:8,
 maxBytes:400000,shrinkDecisions:100,shrinkCampaigns:40,shrinkCampaignsAll:10,shrinkPlays:6,shrinkPlaysAll:3,
 simMaxRows:1500,companionMaxBytes:6000,companionPlays:3,companionPeople:4,companionCampaigns:12,companionAsks:5,companionObserving:6,gateNeed:20,gateMin:0.6,playGateNeed:15,playGateMin:0.5});
export const simColumns=Object.freeze(['id','day','rule','adAccountId','objectId','campaign','action','beforeBudget','afterBudget','currency','afterStatus','wouldExecute','alertOnly','firstWouldExecuteAt','verdict','winnerCut']);
export const decisionStatuses=Object.freeze(['enviaria','pediria','so-sugestao','segurada','desligado']);
const playStagesP1=Object.freeze(['observando','candidata']);
const ownerLabel='Você',outsideLabel='Fora da Malva Dash';

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>typeof v==='number'?v:Date.parse(v||'');
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:null;
const num=v=>finite(v)?v:null,int=v=>Number.isInteger(v)&&v>=0?v:0,str=(v,n=200)=>typeof v==='string'&&v?v.slice(0,n):null;
const iso=v=>{const t=time(v);return finite(t)?new Date(t).toISOString():null;};
const round3=n=>finite(n)?Math.round(n*1000)/1000:null;
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const localDay=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};
const rowKey=r=>JSON.stringify([r?.adAccountId,r?.externalId]);
const metricKeys=['spend','frontOrders','orders','revenueNet','checkouts','roi','roas','cpc','recentRoi'];

/** The autonomyView shape (projects as a list) back into the config map autonomyGrant / effectiveMode read. */
export function configFromView(view){
 const v=obj(view);if(!v)return null;
 return {version:1,enabled:v.enabled===true,projects:Object.fromEntries(arr(v.projects).filter(p=>typeof p?.id==='string').map(p=>[p.id,{mode:p.mode,actions:p.actions||{},limits:p.limits||{},campaigns:p.campaigns||{}}]))};
}
/** Compact past Bunk orders back into what autonomyGrant counts (orders per day, cooldown, "já virou ordem"). */
const grantOrders=orders=>arr(orders).map(o=>({...o,autonomyOrder:true}));

// ── Base (written by the executor after each Sombra pass) ──────────────────────────────────────────────────────────
const closedSnapshot=(state,project,period)=>{const l=arr(state?.snapshots).filter(s=>s?.projectId===project&&s.period===period&&s.level==='campaign'&&s.complete===true);return l.length===1?l[0]:null;};
/** The newest complete today cut of the project (live read or analysis), only when it is a cut of the local today. */
function todayCut(state,project,liveItem,now){
 const analysis=closedSnapshot(state,project,'today'),live=liveItem?.snapshot;
 const ok=s=>s&&s.complete===true&&s.projectId===project&&s.period==='today'&&s.level==='campaign'&&localDay(time(s.from),s.timezone||analysis?.timezone)===localDay(now,s.timezone||analysis?.timezone);
 const pick=[ok(live)?live:null,ok(analysis)?analysis:null].filter(Boolean).sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt))[0]||null;
 if(!pick)return null;
 // Closed windows belong to the same day only when the cut starts where the analysis' today starts.
 return {snapshot:pick,aligned:!!analysis&&pick.from===analysis.from,timezone:pick.timezone||analysis?.timezone||null};
}
const r2=n=>finite(n)?Math.round(n*100)/100:null,r4=n=>finite(n)?Math.round(n*10000)/10000:null;
const windowOf=row=>{if(!row)return null;const t=sum([row]);return {spend:r2(t.spend),frontOrders:num(t.frontOrders),orders:num(t.orders),revenueNet:r2(t.revenueNet),result:r2(t.result),roi:r4(t.roi),roas:r4(t.roas),cpc:r2(t.cpc),ic:r2(t.ic)};};
const orderKind=p=>{
 const v=p?.payload||{};
 if(v.action==='status')return v.after?.status==='PAUSED'?{kind:'pause',percent:null}:{kind:'activate',percent:null};
 const b=v.before?.dailyBudget,a=v.after?.dailyBudget;
 if(finite(b)&&b>0&&finite(a)){const pct=Math.round((a/b-1)*10000)/100;return {kind:pct>=0?'increase':'reduce',percent:pct};}
 return {kind:'reduce',percent:null};
};
function doneOrder(p,executions){
 const e=arr(executions).find(x=>x?.proposalId===p.id)||null,{kind,percent}=orderKind(p),steps=[];
 const step=(k,at)=>{const t=iso(at);if(t)steps.push({kind:k,at:t});};
 step('decidiu',p.createdAt);step('aprovada',p.approvedAt);
 if(e){step('reservada',e.claimedAt);step('preparada',e.preparedAt);step('enviada',e.submittedAt);step('confirmada',e.confirmedAt);
  if(e.status==='Falhou')step('falhou',e.failedAt);else if(e.status==='Verificação necessária')step('verificacao',e.failedAt||e.submittedAt);}
 steps.sort((a,b)=>time(a.at)-time(b.at));
 const checks=arr(e?.monitorChecks).filter(c=>[15,30,60].includes(c?.checkpointMinutes)).map(c=>({minutes:c.checkpointMinutes,at:iso(c.recordedAt)||iso(c.observation?.fetchedAt),status:str(c.status,80)||'N/D',
  delta:c.delta&&typeof c.delta==='object'?{spend:num(c.delta.spend),roi:null,result:num(c.delta.result)}:null}));
 const v=p.payload||{};
 return {proposalId:p.id,project:p.project,adAccountId:v.adAccountId,objectId:v.objectId,campaign:str(v.objectName,200),rule:str(v.rule,80),shadowId:str(v.shadowId,400),at:iso(p.createdAt),
  action:v.action==='status'?'status':'budget',kind,percent,before:v.before??null,after:v.after??null,executionStatus:str(e?.status,60),steps:steps.slice(0,8),monitorChecks:checks,grade:null};
}
const projectContingency=(state,project)=>{
 const cfg=state?.config?.[project]||{},out=[];
 if(!(finite(cfg.dailyCap)&&cfg.dailyCap>=0))out.push('Teto diário não definido: não existe bloqueio financeiro por valor configurado.');
 if(!(finite(cfg.lossCap)&&cfg.lossCap>=0))out.push('Limite de perda da rodada não definido.');
 if(arr(state?.incidents).some(i=>i?.project===project&&i.status!=='Encerrado'))out.push('Incidente ou retomada em acompanhamento. Separar o período afetado.');
 return out.slice(0,3);
};

/**
 * `autonomyDeepBase` (contract a.3). `accuracy`: the gate map storeShadow just used; `policy`: the private Sombra policy
 * (which projects it evaluates and their front ticket); `liveItems`: this object's live reads. Never mutates `state`.
 * @param {{state:any,liveItems?:any[],accuracy?:any,policy?:any,now:number}} input
 */
export function buildDeepBase({state,liveItems=[],accuracy={},policy={},now}){
 const config=state?.autonomy,view=autonomyView(state),truncated={},orderCut=now-deepViewPolicy.ordersDays*86400000,doneCut=now-deepViewPolicy.doneDays*86400000;
 const bunk=arr(state?.proposals).filter(p=>p?.autonomyOrder===true&&p.payload&&finite(time(p.createdAt))).sort((a,b)=>time(b.createdAt)-time(a.createdAt));
 const recent=bunk.filter(p=>time(p.createdAt)>=orderCut);
 if(recent.length>deepViewPolicy.baseMaxOrders)truncated.orders=recent.length-deepViewPolicy.baseMaxOrders;
 const orders=recent.slice(0,deepViewPolicy.baseMaxOrders).map(p=>({id:p.id,project:p.project,createdAt:iso(p.createdAt),payload:{adAccountId:p.payload.adAccountId,objectId:p.payload.objectId,shadowId:p.payload.shadowId??null}}));
 const projects={};
 for(const project of Object.keys(state?.config||{})){
  const cfg=state.config[project]||{},liveItem=arr(liveItems).find(i=>i?.projectId===project)||null,cut=todayCut(state,project,liveItem,now);
  const timezone=cut?.timezone||liveItem?.snapshot?.timezone||arr(state.snapshots).find(s=>s?.projectId===project&&s.timezone)?.timezone||null,zone=timezone||'America/Sao_Paulo';
  const p=config?.projects?.[project],limits=p?.limits||{},ordersLimit=finite(limits.ordersPerDay)?limits.ordersPerDay:autonomyLimits.defaultOrdersPerDay;
  const cap=finite(limits.budgetCap)&&limits.budgetCap>0?limits.budgetCap:null,contingency=projectContingency(state,project),today=localDay(now,zone);
  const closed=cut?.aligned?Object.fromEntries(['yesterday','3d','7d'].map(k=>{const s=closedSnapshot(state,project,k);return [k,new Map(arr(s?.rows).map(r=>[rowKey(r),r]))];})):null;
  // The campaigns the Sombra evaluates (lib/campaign-context.mjs activeSalesRow): active Meta sales campaigns, warm-up out.
  const rows=arr(cut?.snapshot?.rows).filter(activeSalesRow);
  const currencies=new Set(rows.map(r=>String(r.budgetCurrency||'').toUpperCase()).filter(c=>/^[A-Z]{3}$/.test(c)));
  const now_=rows.map(r=>{
   const k=rowKey(r),w={yesterday:closed?.yesterday.get(k)||null,'3d':closed?.['3d'].get(k)||null,'7d':closed?.['7d'].get(k)||null};
   const noSpend=cut?verifiedNoSpendPeriods(state.snapshots,project,r,cut.snapshot.from):[];
   const {stage,test}=campaignStage(r,w,{now,timezone:zone,noSpendPeriods:noSpend});
   const mine=bunk.filter(o=>o.payload.adAccountId===r.adAccountId&&o.payload.objectId===r.externalId);
   const last=mine[0],left=last?autonomyLimits.cooldownMs-(now-time(last.createdAt)):0;
   const budget=finite(r.dailyBudget)&&r.dailyBudget>0?{dailyBudget:r.dailyBudget,currency:str(r.budgetCurrency,3)}:null;
   return {key:campaignKey(r.adAccountId,r.externalId),adAccountId:r.adAccountId,objectId:r.externalId,name:str(r.name,200),accountName:str(r.accountName,200),stage,test,
    mode:effectiveMode(config,project,r.adAccountId,r.externalId),budget,
    windows:{today:windowOf(r),yesterday:windowOf(w.yesterday),d3:windowOf(w['3d']),d7:windowOf(w['7d'])},
    partialDay:partialDayHold({yesterday:w.yesterday?sum([w.yesterday]):null,today:sum([r]),week:w['7d']?sum([w['7d']]):null},{ticketFront:num(policy?.projects?.[project]?.ticketFront)}),
    guard:{ordersToday:mine.filter(o=>localDay(time(o.createdAt),zone)===today).length,ordersLimit,cooldownUntil:left>0?new Date(time(last.createdAt)+autonomyLimits.cooldownMs).toISOString():null,budget:budget?budget.dailyBudget:null,
     capUse:cap!==null&&budget?{cur:budget.dailyBudget,cap,currency:budget.currency,share:round3(budget.dailyBudget/cap),mixedCurrency:currencies.size>1}:null,contingency:[]}};
  }).sort((a,b)=>(b.windows.today?.spend??-1)-(a.windows.today?.spend??-1));
  if(now_.length>deepViewPolicy.maxCampaigns)truncated['now.campaigns']=(truncated['now.campaigns']||0)+now_.length-deepViewPolicy.maxCampaigns;
  const done=bunk.filter(o=>o.project===project&&time(o.createdAt)>=doneCut).slice(0,deepViewPolicy.maxDone).map(o=>doneOrder(o,state.executions));
  const base=policy?.projects?.[project];
  projects[project]={name:cfg.projectName||project,timezone,shadowPolicy:!!base&&base.enabled!==false,configured:!!config?.projects?.[project],todayAt:iso(cut?.snapshot?.fetchedAt),
   contingency,now:now_.slice(0,deepViewPolicy.maxCampaigns),done};
 }
 const gate=Object.fromEntries(Object.entries(obj(accuracy)||{}).map(([rule,a])=>[rule,{graded:int(a?.graded),right:int(a?.right),accuracy:num(a?.accuracy),source:['7d','memory','memory-unavailable'].includes(a?.source)?a.source:'7d'}]));
 const fetched=arr(state?.snapshots).map(s=>time(s?.fetchedAt)).filter(finite);
 const out={v:1,at:new Date(now).toISOString(),stateAt:fetched.length?new Date(Math.max(...fetched)).toISOString():null,enabled:!!config?.enabled,paused:!!state?.paused,config:view,orders,gate,projects,truncated};
 // 256 KB ceiling: campaigns to 40 first (contract a.3), then the done list and the campaigns further, re-measuring each time.
 for(const [what,n] of [['now',deepViewPolicy.baseCutCampaigns],['done',20],['now',20],['done',10],['now',10]]){
  if(bytes(out)<=deepViewPolicy.baseMaxBytes)break;
  const k=what==='now'?'now.campaigns':'done';
  for(const p of Object.values(projects))if(p[what].length>n){truncated[k]=(truncated[k]||0)+p[what].length-n;p[what]=p[what].slice(0,n);}
 }
 return out;
}
/**
 * Cheap signature of the slow-changing part of a base (permissions, gate, the Bunk's orders, done list, which campaigns,
 * their mode, stage, budget and guard): the executor rewrites the key when this changes, and otherwise only every
 * `baseLiveEveryMs` for the live numbers (today's windows, partial day, the cut time), which change on every Meta read.
 * The cooldown is stored as an end time (`cooldownUntil`) and turned into minutes at read time, so it never changes it.
 */
export function deepBaseSignature(base){
 const {at:_,stateAt:_s,projects,...rest}=base||{};
 const slow=Object.fromEntries(Object.entries(obj(projects)||{}).map(([p,x])=>{const {todayAt:_t,now:list,...keep}=x||{};
  return [p,{...keep,now:arr(list).map(c=>{const {windows:_w,partialDay:_p,...k}=c||{};return k;}).sort((a,b)=>String(a.key).localeCompare(String(b.key)))}];}));
 const s=JSON.stringify({...rest,projects:slow});let a=2166136261,b=3335557771;
 for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),2246822519);}
 return (a>>>0).toString(16)+(b>>>0).toString(16)+':'+s.length;
}

// ── Decision status (contract a.5) ─────────────────────────────────────────────────────────────────────────────────
const gateOf=(base,rule)=>{
 if(!scoreGatedRules.includes(rule))return null;
 const a=base?.gate?.[rule],graded=int(a?.graded),right=int(a?.right),accuracy=num(a?.accuracy);
 return {graded,right,need:deepViewPolicy.gateNeed,min:deepViewPolicy.gateMin,metric:'accuracy',proven:graded>=shadowRulePolicy.badDayMinGraded&&accuracy!==null&&accuracy>=shadowRulePolicy.badDayMinAccuracy,source:a?.source||'7d'};
};
const playGateOf=(score)=>{const s=obj(score);if(!s)return null;return {graded:int(s.graded),right:int(s.right),need:deepViewPolicy.playGateNeed,min:deepViewPolicy.playGateMin,metric:'low',proven:false,source:'pbs'};};
/**
 * What the owner's permissions would do with one decision. First match wins (contract a.5 table).
 * @param {any} entry a stored `shadow:` or `pbs:` entry
 * @param {{base:any,config?:any,log?:any[],shadowAt?:string|null,now:number,timezone?:string,playScore?:any}} ctx
 */
export function decisionStatus(entry,ctx){
 const e=entry||{},base=ctx?.base||null,config=ctx?.config||configFromView(base?.config),playbook=e.source==='playbook';
 const mode=effectiveMode(config,e.project,e.adAccountId,e.objectId),blocked=arr(e.blockedBy).map(String);
 const out=(status,extra={})=>({status,suggestionWhy:null,holdReasons:[],mode,gate:playbook?playGateOf(ctx?.playScore):gateOf(base,e.rule),proposalId:null,...extra,holdReasons:(extra.holdReasons||[]).slice(0,6)});
 if(mode==='off')return out('desligado');
 if(playbook)return blocked.length?out('segurada',{holdReasons:blocked}):out('so-sugestao',{suggestionWhy:'jogada-em-observacao'});
 if(e.alertOnly===true||blocked.some(b=>/^Só alerta/.test(b)))return out('so-sugestao',{suggestionWhy:'so-alerta'});
 if(scoreGatedRules.includes(e.rule)&&blocked.some(b=>/^Só sugestão/.test(b)))return out('so-sugestao',{suggestionWhy:'placar'});
 const pulse=time(ctx?.shadowAt),current=finite(pulse)?time(e.lastAt)>=pulse:null;
 if(current===false)return out('segurada',{holdReasons:['A regra não propõe mais esta ação na leitura mais recente.']});
 if(blocked.length)return out('segurada',{holdReasons:blocked});
 if(mode==='shadow')return out('so-sugestao',{suggestionWhy:'nivel-sombra'});
 const line=arr(ctx?.log).find(l=>l?.shadowId&&l.shadowId===e.id);
 if(line?.result?.kind==='order')return out('enviaria',{proposalId:line.proposalId||line.result.proposalId||null});
 if(line?.result?.kind==='confirm')return out('pediria');
 if(line?.result?.kind==='blocked')return out('segurada',{holdReasons:arr(line.result.blockers).map(String)});
 const g=autonomyGrant({autonomy:config,paused:!!base?.paused,proposals:grantOrders(base?.orders)},{...e,wouldExecute:true},{now:ctx.now,timezone:ctx?.timezone||'America/Sao_Paulo'});
 return g.act==='auto'?out('enviaria'):g.act==='confirm'?out('pediria'):out('segurada',{holdReasons:g.blockers});
}

const kindOf=e=>{
 const a=decisionAction(e);if(a)return a.action;
 if(e?.action==='status')return e.after?.status==='PAUSED'?'pause':'activate';
 return finite(e?.after?.dailyBudget)&&finite(e?.before?.dailyBudget)&&e.after.dailyBudget>e.before.dailyBudget?'increase':'reduce';
};
const signedPercent=e=>{const a=decisionAction(e);return a&&a.percent!==null?(a.action==='reduce'?-a.percent:a.percent):null;};
const gradeView=(g,basis)=>{const src=basis==='day'?g?.day:basis==='d3'?g:g?.next;return {spend:num(src?.spend),result:num(src?.result),roi:num(src?.roi)};};
function gradeOf(e,playbook){
 const g=obj(e?.grade);
 const d1=g&&['acertou','errou','parou','N/D'].includes(g.verdict)?{verdict:g.verdict,basis:g.basis==='day'?'day':'next',winnerCut:!!g.winnerCut,...gradeView(g,g.basis==='day'?'day':'next')}:null;
 if(!playbook)return {d1,d3:null,pauseProxy:null,opposite:null};
 const d3=obj(g?.d3)&&['acertou','errou','parou','N/D'].includes(g.d3.verdict)?{verdict:g.d3.verdict,basis:'d3',winnerCut:!!g.d3.winnerCut,...gradeView(g.d3,'d3')}:null;
 const o=obj(g?.opposite);
 return {d1,d3,pauseProxy:g?.pauseProxy==='revertida'||g?.pauseProxy==='provavel-acerto'?g.pauseProxy:null,opposite:o?{person:str(o.person,80),name:str(o.name,120),kind:str(o.kind,20)||'N/D',at:iso(o.at)}:null};
}
const caseRef=c=>({day:str(c?.day,10),adAccountId:str(c?.adAccountId,80),objectId:str(c?.objectId,80),campaign:str(c?.campaign,200),person:str(c?.person,80),name:str(c?.name,120),kind:str(c?.kind,20),at:iso(c?.at),step:num(c?.step)});
const reaction=r=>obj(r)?{actor:str(r.actor,120),at:iso(r.at),minutesAfter:num(r.minutesAfter),before:r.before??null,after:r.after??null}:null;
/** One stored entry as a deep-view Decision (contract a.5), with its status. */
export function toDecision(e,ctx){
 const playbook=e?.source==='playbook',s=decisionStatus(e,ctx),rv=entryRuleVersion(e),pulse=time(ctx?.shadowAt);
 const names=ctx?.peopleNames||{};
 return {id:e.id,source:playbook?'playbook':'rules',rule:e.rule,ruleLabel:str(e.ruleLabel,200)||(playbook?null:shadowRules[e.rule]||null),
  rev:playbook?str(e.ruleRev,40):rv!==null?'rules@'+rv:null,project:e.project,projectName:str(e.projectName,200),adAccountId:e.adAccountId,accountName:str(e.accountName,200),objectId:e.objectId,campaign:str(e.name,200),
  action:e.action==='status'?'status':'budget',kind:kindOf(e),before:e.before??{},after:e.after??{},percent:signedPercent(e),reason:String(e.reason||'').slice(0,600),
  metrics:Object.fromEntries(metricKeys.map(k=>[k,num(e.metrics?.[k])])),limitations:arr(e.limitations).map(String).slice(0,6),blockedBy:arr(e.blockedBy).map(String).slice(0,6),
  status:s.status,suggestionWhy:s.suggestionWhy,holdReasons:s.holdReasons,mode:s.mode,
  wouldExecute:playbook?false:!!e.firstWouldExecuteAt,wouldFire:playbook?arr(e.blockedBy).length===0:!!e.firstWouldExecuteAt,current:finite(pulse)?time(e.lastAt)>=pulse:null,
  gate:s.gate,sameAsRule:playbook?str(e.sameAsRule,80):null,manager:reaction(e.manager),owner:reaction(e.owner),grade:gradeOf(e,playbook),
  firstAt:iso(e.firstAt),lastAt:iso(e.lastAt),firstWouldExecuteAt:playbook?null:iso(e.firstWouldExecuteAt),proposalId:s.proposalId,
  play:playbook?{key:str(e.playKey,120)||String(e.rule)+'@'+e.project,params:obj(e.play?.params)||{},learnedStep:num(e.play?.learnedStep),clampedStep:num(e.play?.clampedStep),
   learnedFrom:arr(e.learnedFrom).slice(0,8).map(l=>({person:String(l?.person||'outside'),name:personName(l?.person,str(l?.name,120),names),n:int(l?.n)})),caseRefs:arr(e.caseRefs).slice(0,deepViewPolicy.caseRefs).map(caseRef)}:null};
}
/** A person's display name: the stored one, the one the views know, "Você" for the owner; never the hashed id. */
const personName=(person,name,names={})=>name&&name!==person?name:person==='owner'?'Você':names[person]||(person==='outside'?'Fora da Malva Dash':'Pessoa da equipe');
const lastTouch=d=>Math.max(...[d.firstAt,d.manager?.at,d.owner?.at].map(time).filter(finite),0);
const urgent=d=>d.status==='enviaria'||d.status==='pediria'?1:0;
export const sortDecisions=list=>[...list].sort((a,b)=>urgent(b)-urgent(a)||lastTouch(b)-lastTouch(a));

// ── Score, team and playbook (contract a.5) ────────────────────────────────────────────────────────────────────────
const edgeClaimable=b=>!!b&&b.graded>=10&&b.campaigns>=5&&b.days>=3;
function ruleScore(t,{rev,label,gate,stage}){
 const g=obj(t);
 return {rev,label,graded:int(g?.graded),right:int(g?.right),accuracy:num(g?.accuracy),low:num(g?.low),high:num(g?.high),
  base:g?.base?{expected:num(g.base.expected),accuracy:num(g.base.accuracy),edge:num(g.base.edge),graded:int(g.base.graded)}:null,
  chanceBetter:edgeClaimable(g?.base)?num(g.base.chanceBetter):null,
  trend:{recent:{graded:int(g?.recent?.graded),accuracy:num(g?.recent?.accuracy)},previous:{graded:int(g?.previous?.graded),accuracy:num(g?.previous?.accuracy)}},
  winnersCut:int(g?.winnersCut),stage,gate};
}
const playStage=s=>playStagesP1.includes(s)?s:'candidata';
function playScore(t){const s=ruleScore(t,{rev:str(t?.rev,40),label:str(t?.label,140),gate:null,stage:playStage(t?.stage)});return s;}
function scoreOf({learningSummary:ls,base,project,pbProjects}){
 const rules={};
 for(const rule of Object.keys(shadowRules)){
  const cur=ls?.current?.[rule],t=project==='all'?cur:cur?.projects?.[project],gate=gateOf(base,rule);
  rules[rule]=ruleScore(ls?t:null,{rev:ls&&Number.isInteger(ls.ruleVersion)?'rules@'+ls.ruleVersion:null,label:shadowRules[rule],gate:gate?{graded:gate.graded,right:gate.right,need:20,min:0.6,proven:gate.proven,source:gate.source}:null,stage:!gate||gate.proven?'pode-enviar':'sombra'});
 }
 const plays={};
 for(const v of pbProjects)for(const [k,t] of Object.entries(obj(v?.scorePlays)||{}))plays[k]=playScore(t);
 const scope=project==='all'?ls?.team?.all:ls?.team?.projects?.[project],l=scope?.lead;
 const lead14d=ls&&l?{cuts:int(l.cuts),ahead:int(l.ahead),share:num(l.share),medianLeadMin:num(l.medianLeadMin),previous:{cuts:int(l.previous?.cuts),ahead:int(l.previous?.ahead),share:num(l.previous?.share)},daily:arr(l.daily).slice(-14).map(d=>({day:String(d.day),cuts:int(d.cuts),ahead:int(d.ahead)}))}:null;
 const blindSpots=arr(ls?.blindSpots?.recent).filter(b=>project==='all'||b?.project===project).slice(0,deepViewPolicy.blindSpots).map(b=>({day:String(b.day),kind:String(b.kind),by:b.by==='owner'?'owner':'manager',at:iso(b.at),adAccountId:b.adAccountId,objectId:b.objectId}));
 return {rules,plays,lead14d,blindSpots};
}
/**
 * Agreement (contract a.4) with both sample sizes: `n` (team moves: recall's and lead's denominator) and `fired` (the times
 * the play would have acted: precision's, the range's and opposite's). An older view without `fired` keeps its numbers
 * under `n`. Each rate is null when its own denominator is 0.
 */
const agreementOf=a=>{const x=obj(a);if(!x)return null;const n=int(x.n),hasFired=Number.isInteger(x.fired),fired=hasFired?int(x.fired):n;
 const byN=k=>n?num(x[k]):null,byFired=k=>fired?num(x[k]):null;
 // The range goes with the precision; a per-person agreement has no precision, and its range is the recall's.
 const range=k=>finite(x.precision)?byFired(k):byN(k);
 return {precision:byFired('precision'),recall:byN('recall'),leadMin:byN('leadMin'),opposite:byFired('opposite'),low:range('low'),high:range('high'),n,fired:hasFired?fired:null,agree:Number.isInteger(x.agree)?x.agree:null,caught:Number.isInteger(x.caught)?x.caught:null};};
export const personId=p=>typeof p?.person==='string'&&p.person?p.person:p?.name===ownerLabel?'owner':p?.name===outsideLabel?'outside':'p:'+shortId(['person-name',String(p?.name||'?')]);
const roleOf=p=>['owner','team','outside'].includes(p?.role)?p.role:p?.name===ownerLabel?'owner':p?.name===outsideLabel?'outside':'team';
function teamOf({learningSummary:ls,project,pbProjects}){
 const scope=project==='all'?ls?.team?.all:ls?.team?.projects?.[project];if(!ls?.team||!scope)return null;
 const agreements=new Map();for(const v of pbProjects)for(const p of arr(v?.people))if(p?.person&&!agreements.has(p.person))agreements.set(p.person,agreementOf(p.agreement));
 const people=arr(scope.people).slice(0,deepViewPolicy.people).map(p=>{const person=personId(p),tp=p.testPauses||{},b=p.budget||{};
  return {person,name:p.name===ownerLabel?ownerLabel:String(p.name||'N/D'),role:roleOf(p),counts:{actions:int(p.actions),pause:int(p.pause),reduce:int(p.reduce),increase:int(p.increase),activate:int(p.activate)},
   testPauses:{n:int(tp.n),campaigns:int(tp.campaigns),median:num(tp.median),p25:num(tp.p25),p75:num(tp.p75),beforePoint:int(tp.beforePoint),point:num(tp.point)},
   budget:{graded:int(b.graded),right:int(b.right),accuracy:num(b.accuracy),low:num(b.low),high:num(b.high),medianUp:num(b.medianUp),medianDown:num(b.medianDown),
    // D+3 and "vs campanha qualquer" (lib/team-learning.mjs teamStats), additive; null when the memory has none.
    d3:obj(b.d3)?{graded:int(b.d3.graded),right:int(b.d3.right),accuracy:num(b.d3.accuracy),low:num(b.d3.low),high:num(b.d3.high)}:null,
    base:obj(b.base)?{graded:int(b.base.graded),expected:num(b.base.expected),edge:num(b.base.edge)}:null},
   hours:Array.isArray(p.hours)&&p.hours.length===24&&p.hours.every(x=>Number.isInteger(x)&&x>=0)?p.hours:null,agreement:agreements.get(person)??null};});
 const proposals=arr(ls.team.proposals).filter(p=>project==='all'||p?.project===project).slice(0,deepViewPolicy.proposals).map(p=>({id:String(p.id),kind:String(p.kind),n:int(p.n),campaigns:int(p.campaigns),days:int(p.days),median:num(p.median),p25:num(p.p25),p75:num(p.p75),current:num(p.current),value:num(p.value),text:String(p.text||'').slice(0,600)}));
 return {people,proposals};
}
/** Why a play is still only observed (manager-playbook fitPlay). */
const playReasons=['poucos-casos','instavel','divergencia','dormindo','sem-acerto'];
function playOf(p){
 const ag=agreementOf(p?.agreement)||{precision:null,recall:null,leadMin:null,opposite:null,low:null,high:null,n:0},s=obj(p?.support)||{},rate=r=>obj(r)?{rate:num(r.rate),n:int(r.n),low:num(r.low),high:num(r.high)}:null;
 return {id:String(p?.id||''),key:String(p?.key||''),rev:String(p?.rev||''),version:int(p?.version),role:'challenger',stage:playStage(p?.stage),reason:playStage(p?.stage)==='observando'&&playReasons.includes(p?.reason)?p.reason:null,sentence:String(p?.sentence||'').slice(0,140),params:obj(p?.params)||{},
  step:obj(p?.step)&&finite(p.step.median)?{median:p.step.median,p25:num(p.step.p25),p75:num(p.step.p75)}:null,
  learnedFrom:arr(p?.learnedFrom).slice(0,8).map(l=>({person:String(l?.person||'outside'),name:String(l?.name||'N/D'),n:int(l?.n),params:obj(l?.params)})),
  support:{moves:int(s.moves),campaigns:int(s.campaigns),days:int(s.days),need:{moves:8,campaigns:4,days:3},missing:int(s.missing)},agreement:ag,
  outcome:{d1:rate(p?.outcome?.d1),d3:rate(p?.outcome?.d3),base:num(p?.outcome?.base)},
  wouldHave7d:obj(p?.wouldHave7d)?{total:int(p.wouldHave7d.total),sameAsTeam:int(p.wouldHave7d.sameAsTeam),nobodyDid:int(p.wouldHave7d.nobodyDid)}:null,
  flags:arr(p?.flags).filter(f=>typeof f==='string').slice(0,6),challenger:obj(p?.challenger)?{rev:String(p.challenger.rev||''),diff:arr(p.challenger.diff).slice(0,12).map(d=>({param:String(d?.param||''),from:num(d?.from),to:num(d?.to)})),
   score:obj(p.challenger.score)?{graded:int(p.challenger.score.graded),right:int(p.challenger.score.right),accuracy:num(p.challenger.score.accuracy),low:num(p.challenger.score.low),high:num(p.challenger.score.high)}:null}:null,
  caseRefs:arr(p?.caseRefs).slice(0,deepViewPolicy.caseRefs).map(caseRef),adoptable:false,adoptHint:'chega na próxima fase'};
}
function playbookOf(v,max){
 const pb=obj(v?.playbook);if(!pb)return null;
 return {fitAt:iso(pb.fitAt),nextFitAt:iso(pb.nextFitAt),state:['sem-dados','observando','com-candidatas'].includes(pb.state)?pb.state:'observando',plays:arr(pb.plays).slice(0,max).map(playOf),
  divergences:arr(pb.divergences).slice(0,deepViewPolicy.divergences).map(d=>({id:String(d?.id||''),playId:String(d?.playId||''),cell:{stage:str(d?.cell?.stage,20),hourSlot:str(d?.cell?.hourSlot,10),roiBucket:str(d?.cell?.roiBucket,20)},
   people:arr(d?.people).slice(0,8).map(x=>({person:String(x?.person||''),name:String(x?.name||'N/D'),kind:String(x?.kind||''),n:int(x?.n)})),text:String(d?.text||'').slice(0,300)}))};
}

// ── Deep view (contract a.4) ───────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {{base:any,project:string,now:number,shadowStatus?:any,autonomyStatus?:any,autonomyLog?:any[],learningSummary?:any,learningStatus?:any,
 *   pbStatus?:any,pbView?:any,pbViews?:Record<string,any>,shadowEntries?:any[],pbsEntries?:any[]}} input
 *   shadowEntries / pbsEntries: today's `shadow:` / `pbs:` entries (the executor lists only today's day prefixes).
 */
export function buildDeepView(input){
 const {base,project,now}=input,ss=obj(input.shadowStatus),ls=obj(input.learningSummary),pbViews=obj(input.pbViews)||{},log=arr(input.autonomyLog);
 const scope=project==='all'?Object.keys(base?.projects||{}):[project],config=configFromView(base?.config),truncated={...(obj(base?.truncated)||{})};
 const all=project==='all',maxCampaigns=all?deepViewPolicy.maxCampaignsAll:deepViewPolicy.maxCampaigns,maxPlays=all?deepViewPolicy.maxPlaysAll:deepViewPolicy.maxPlays;
 const dayOf=p=>typeof ss?.days?.[p]==='string'?ss.days[p]:typeof ss?.day==='string'?ss.day:null;
 // Names the runner's views resolved (people, the plays' learned-from, memory), so a decision never shows a hashed id.
 const peopleNames={},known=(person,name)=>{if(typeof person==='string'&&typeof name==='string'&&name&&name!==person&&!peopleNames[person])peopleNames[person]=name;};
 for(const v of Object.values(pbViews)){for(const p of arr(v?.people))known(p?.person,p?.name);for(const pl of arr(v?.playbook?.plays))for(const l of arr(pl?.learnedFrom))known(l?.person,l?.name);}
 for(const m of arr(obj(input.pbView)?.memory?.peopleMoves))known(m?.person,m?.name);
 const ctxOf=p=>({base,config,log,shadowAt:ss?.failed?null:ss?.at||null,now,timezone:base?.projects?.[p]?.timezone||'America/Sao_Paulo',peopleNames});
 const today=e=>scope.includes(e?.project)&&e.day===dayOf(e.project);
 const fixed=arr(input.shadowEntries).filter(today).map(e=>toDecision(e,ctxOf(e.project)));
 // A challenger version's decisions are only scored (its own rev), never listed as what the Bunk would do now.
 const plays=arr(input.pbsEntries).filter(e=>today(e)&&e?.versionRole!=='next').map(e=>{const v=pbViews[e.project];return toDecision({...e,source:'playbook',wouldExecute:false,firstWouldExecuteAt:null},{...ctxOf(e.project),playScore:v?.scorePlays?.[e.playKey||String(e.rule)+'@'+e.project]});});
 const decisions=sortDecisions([...fixed,...plays]);
 const counts={enviaria:0,pediria:0,'so-sugestao':0,segurada:0,desligado:0};for(const d of decisions)counts[d.status]++;
 if(decisions.length>deepViewPolicy.maxDecisions)truncated.decisions=(truncated.decisions||0)+decisions.length-deepViewPolicy.maxDecisions;
 const kept=decisions.slice(0,deepViewPolicy.maxDecisions);
 const doneAll=scope.flatMap(p=>arr(base?.projects?.[p]?.done)).sort((a,b)=>time(b.at)-time(a.at));
 if(doneAll.length>deepViewPolicy.maxDone)truncated.done=(truncated.done||0)+doneAll.length-deepViewPolicy.maxDone;
 const doneKept=doneAll.slice(0,deepViewPolicy.maxDone);
 const orders={created:0,sent:0,confirmed:0,failed:0};
 for(const d of doneKept){const tz=base?.projects?.[d.project]?.timezone||'America/Sao_Paulo';if(localDay(time(d.at),tz)!==localDay(now,tz))continue;orders.created++;const k=new Set(d.steps.map(s=>s.kind));if(k.has('enviada'))orders.sent++;if(k.has('confirmada'))orders.confirmed++;if(k.has('falhou')||k.has('verificacao'))orders.failed++;}
 const projects={};
 for(const p of scope){
  const b=base?.projects?.[p]||{},vp=(base?.config?.projects||[]).find(x=>x.id===p),limits=vp?.limits||{},v=pbViews[p]||null;
  const now_=arr(b.now);if(now_.length>maxCampaigns)truncated['now.campaigns']=(truncated['now.campaigns']||0)+now_.length-maxCampaigns;
  const pb=playbookOf(v,maxPlays);if(pb&&arr(v?.playbook?.plays).length>maxPlays)truncated.plays=(truncated.plays||0)+arr(v.playbook.plays).length-maxPlays;
  projects[p]={name:b.name||p,timezone:b.timezone??null,day:dayOf(p),
   level:{mode:vp?.mode||'shadow',actions:{pause:!!vp?.actions?.pause,reduce:!!vp?.actions?.reduce,increase:!!vp?.actions?.increase,activate:!!vp?.actions?.activate},
    limits:{maxIncreasePct:num(limits.maxIncreasePct),maxReducePct:num(limits.maxReducePct),budgetCap:num(limits.budgetCap),ordersPerDay:finite(limits.ordersPerDay)?limits.ordersPerDay:autonomyLimits.defaultOrdersPerDay},
    exceptions:Object.keys(vp?.campaigns||{}).length,configured:!!b.configured,shadowPolicy:!!b.shadowPolicy},
   pilot:null,now:{campaigns:now_.slice(0,maxCampaigns).map(c=>{const {cooldownUntil,...g}=c.guard||{},left=time(cooldownUntil)-now;return {...c,guard:{...g,cooldownMin:finite(left)?(left>0?Math.ceil(left/60000):0):finite(g.cooldownMin)?g.cooldownMin:0,contingency:arr(b.contingency)}};})},decisions:kept.filter(d=>d.project===p),done:doneKept.filter(d=>d.project===p),
   score:scoreOf({learningSummary:ls,base,project:p,pbProjects:v?[v]:[]}),team:teamOf({learningSummary:ls,project:p,pbProjects:v?[v]:[]}),playbook:pb};
 }
 const pbAll=obj(input.pbView),mem=obj(pbAll?.memory),inScope=k=>project==='all'||k===project;
 const memory=mem?{days:int(mem.days),from:str(mem.from,10),observedDays:Number.isInteger(mem.observedDays)?mem.observedDays:null,observedFrom:str(mem.observedFrom,10),peopleMoves:arr(mem.peopleMoves).slice(0,8).map(m=>({person:String(m?.person||'outside'),name:String(m?.name||'N/D'),role:['owner','team','outside'].includes(m?.role)?m.role:'team',moves:int(m?.moves)})),
   excluded:{total:int(mem.excluded?.total),byReason:Object.fromEntries(Object.entries(obj(mem.excluded?.byReason)||{}).filter(([,n])=>Number.isInteger(n)))},quarantined:int(mem.quarantined),
   backfill:Object.fromEntries(Object.entries(obj(mem.backfill)||{}).filter(([k])=>inScope(k)).map(([k,b])=>[k,{complete:b?.complete===true,from:str(b?.from,10),to:str(b?.to,10),moves:int(b?.moves),at:iso(b?.at)}]))}
  :ls?.memory?{days:int(ls.memory.days),from:str(ls.memory.from,10),peopleMoves:[],excluded:{total:0,byReason:{}},quarantined:0,backfill:{}}:null;
 const skipped=Object.entries(obj(ss?.skipped)||{}).filter(([p])=>inScope(p)).map(([p,reason])=>({project:p,projectName:base?.projects?.[p]?.name||p,reason:String(reason).slice(0,200)}));
 const out={v:1,at:new Date(now).toISOString(),baseAt:base?.at||null,stateAt:base?.stateAt??null,project,enabled:!!base?.enabled,paused:!!base?.paused,
  status:obj(input.autonomyStatus),
  shadowStatus:ss?{at:ss.at||null,failed:ss.failed===true,version:num(ss.version),days:Object.fromEntries(Object.entries(obj(ss.days)||{}).filter(([p])=>inScope(p))),skipped,evaluated:num(ss.evaluated),ms:num(ss.ms)}:null,
  learningStatus:obj(input.learningStatus)?{at:input.learningStatus.at||null,ok:input.learningStatus.ok===true,summarized:typeof input.learningStatus.summarized==='boolean'?input.learningStatus.summarized:null,...(input.learningStatus.code?{code:String(input.learningStatus.code)}:{})}:null,
  playbookStatus:mem?obj(input.pbStatus):null,memory,
  totals:{decisions:counts,orders,agreement:all?agreementOf(pbAll?.agreement):agreementOf(pbViews[project]?.agreement)},
  projects,caps:{campaigns:maxCampaigns,decisions:deepViewPolicy.maxDecisions,done:deepViewPolicy.maxDone,plays:maxPlays,caseRefs:5,blindSpots:20,divergences:10,proposals:5,people:8},truncated};
 return shrinkDeepView(out);
}
/** The 400 KB ceiling, in the contract's fixed order (a.6), re-measuring after each step. */
export function shrinkDeepView(out){
 const over=()=>bytes(out)>deepViewPolicy.maxBytes,add=(k,n)=>{if(n>0)out.truncated[k]=(out.truncated[k]||0)+n;},all=out.project==='all',ps=Object.values(out.projects);
 if(!over())return out;
 let n=0;for(const p of ps)for(const d of p.decisions)if(d.limitations.length){n+=d.limitations.length;d.limitations=[];}add('decisions.limitations',n);if(!over())return out;
 n=0;for(const p of ps)for(const d of p.decisions)if(d.play?.caseRefs?.length){n+=d.play.caseRefs.length;d.play.caseRefs=[];}add('decisions.play.caseRefs',n);if(!over())return out;
 const keep=new Set(sortDecisions(ps.flatMap(p=>p.decisions)).slice(0,deepViewPolicy.shrinkDecisions).map(d=>d.id+'|'+d.source));
 n=0;for(const p of ps){const before=p.decisions.length;p.decisions=p.decisions.filter(d=>keep.has(d.id+'|'+d.source));n+=before-p.decisions.length;}add('decisions',n);if(!over())return out;
 const c=all?deepViewPolicy.shrinkCampaignsAll:deepViewPolicy.shrinkCampaigns;n=0;for(const p of ps)if(p.now.campaigns.length>c){n+=p.now.campaigns.length-c;p.now.campaigns=p.now.campaigns.slice(0,c);}add('now.campaigns',n);if(!over())return out;
 const k=all?deepViewPolicy.shrinkPlaysAll:deepViewPolicy.shrinkPlays;n=0;for(const p of ps)if(p.playbook&&p.playbook.plays.length>k){n+=p.playbook.plays.length-k;p.playbook.plays=p.playbook.plays.slice(0,k);}add('plays',n);
 return out;
}

// ── Draft simulator rows (contract a.7) ────────────────────────────────────────────────────────────────────────────
/** One stored `shadow:` entry as a positional row (simColumns). Only these 16 values are kept. */
export function simRow(e){
 const alertOnly=e?.alertOnly===true||arr(e?.blockedBy).some(b=>/^Só alerta/.test(String(b)));
 return [e.id,e.day??null,e.rule??null,e.adAccountId??null,e.objectId??null,str(e.name,200),e.action==='status'?'status':'budget',num(e.before?.dailyBudget),num(e.after?.dailyBudget),
  str(e.after?.currency||e.before?.currency,3),str(e.after?.status,20),!!e.firstWouldExecuteAt,alertOnly,iso(e.firstWouldExecuteAt),str(e.grade?.verdict,10),!!e.grade?.winnerCut];
}
const firstAtCol=simColumns.indexOf('firstWouldExecuteAt');
/** @param {{base:any,project:string,rows:any[][],now:number,shadowStatus?:any}} input */
export function simRowsView({base,project,rows,now,shadowStatus=null}){
 const sorted=[...arr(rows)].sort((a,b)=>(time(b[firstAtCol])||0)-(time(a[firstAtCol])||0));
 const kept=sorted.slice(0,deepViewPolicy.simMaxRows);
 return {v:1,at:new Date(now).toISOString(),project,timezone:base?.projects?.[project]?.timezone??null,today:typeof shadowStatus?.days?.[project]==='string'?shadowStatus.days[project]:shadowStatus?.day||null,
  columns:[...simColumns],rows:kept,seedOrders:arr(base?.orders).filter(o=>o.project===project),saved:base?.config||null,truncated:sorted.length-kept.length};
}

// ── Notch block (contract b) ───────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {{base:any,shadowRecent?:any[],log?:any[],pbView?:any,pbViews?:Record<string,any>,project:string,now:number,entries?:any[],days?:Record<string,string>|null,shadowAt?:string|null,asks?:any[]}} input
 *   asks: the executor's open requests of the level Confirmar (`autonomyAsks`).
 *   entries: the stored Sombra entries this summary is built from (today's are counted); pbViews: `pb:view:<p>` by project.
 */
export function autonomyCompanion({base,shadowRecent=[],log=[],pbView=null,pbViews={},project,now,entries=[],days=null,shadowAt=null,asks=[]}){
 if(!base?.projects||!base.config)return null;
 const config=configFromView(base.config),ids=project==='all'?Object.keys(base.projects):base.projects[project]?[project]:[];
 const modeOf=p=>config?.projects?.[p]?.mode||'shadow';
 const projects=ids.map(p=>{
  const vp=base.config.projects.find(x=>x.id===p),v=obj(pbViews?.[p]),day=days?.[p]||null,tz=base.projects[p]?.timezone||'America/Sao_Paulo';
  const today={decisions:0,enviaria:0,pediria:0,soSugestao:0,segurada:0,ordersCreated:0,ordersConfirmed:0};
  for(const e of arr(entries)){if(e?.project!==p||e.source==='playbook'||!day||e.day!==day)continue;const s=decisionStatus(e,{base,config,log,shadowAt,now,timezone:tz}).status;today.decisions++;
   if(s==='enviaria')today.enviaria++;else if(s==='pediria')today.pediria++;else if(s==='so-sugestao')today.soSugestao++;else if(s==='segurada')today.segurada++;}
  for(const d of arr(base.projects[p]?.done)){if(localDay(time(d.at),tz)!==localDay(now,tz))continue;today.ordersCreated++;if(arr(d.steps).some(s=>s.kind==='confirmada'))today.ordersConfirmed++;}
  const rank=s=>s==='candidata'?0:s==='observando'?1:2;
  const plays=arr(v?.playbook?.plays).filter(x=>playStagesP1.includes(x?.stage)).sort((a,b)=>rank(a.stage)-rank(b.stage)||int(b?.support?.moves)-int(a?.support?.moves)).slice(0,deepViewPolicy.companionPlays)
   .map(x=>{const ag=agreementOf(x.agreement);return {id:String(x.id||''),label:String(x.sentence||x.id||'').slice(0,60),stage:x.stage,agreement:ag?.precision??null,n:ag?.precision!=null?(ag.fired??ag.n):0};});
  // Per person: the share of that person's moves a play caught (recall, "pegou"), over those moves; never a precision.
  const people=arr(v?.people).slice(0,deepViewPolicy.companionPeople).map(x=>{const ag=agreementOf(x?.agreement);return {person:String(x?.person||'').slice(0,80),name:String(x?.name||'N/D').slice(0,80),agreement:ag?.recall??null,n:ag?.recall!=null?ag.n:0,metric:'recall'};});
  return {id:p,name:String(base.projects[p].name||p).slice(0,80),mode:modeOf(p),exceptions:Object.keys(vp?.campaigns||{}).length,pilot:null,today,plays,people};
 });
 const campaigns=arr(shadowRecent).slice(0,deepViewPolicy.companionCampaigns).filter(r=>typeof r?.projectId==='string'&&r.adAccountId!=null&&r.objectId!=null)
  .map(r=>({projectId:r.projectId,adAccountId:String(r.adAccountId),objectId:String(r.objectId),mode:effectiveMode(config,r.projectId,r.adAccountId,r.objectId)}));
 const ag=agreementOf(project!=='all'&&obj(pbViews?.[project])?.agreement?pbViews[project].agreement:pbView?.agreement);
 const out={v:1,at:new Date(now).toISOString(),enabled:!!base.enabled,projects,campaigns,
  island:{observing:projects.filter(p=>p.mode!=='off').map(p=>p.name).slice(0,deepViewPolicy.companionObserving),agreement:ag?.precision??null,n:ag?.precision!=null?(ag.fired??ag.n):0}};
 // Requests of the level Confirmar still open (the executor's list): what the notch alerts on and opens prefilled.
 // Only with the switch on and the campaign still in Confirmar; never an order by itself.
 const open=!base.enabled?[]:arr(asks).filter(a=>a&&ids.includes(a.project)&&typeof a.id==='string'&&a.adAccountId!=null&&a.objectId!=null&&effectiveMode(config,a.project,a.adAccountId,a.objectId)==='confirm');
 out.asks=open.slice(0,deepViewPolicy.companionAsks).map(a=>({id:a.id.slice(0,300),at:a.at||null,projectId:a.project,projectName:String(base.projects[a.project]?.name||a.projectName||a.project).slice(0,80),adAccountId:String(a.adAccountId),objectId:String(a.objectId),
  campaign:a.campaign?String(a.campaign).slice(0,120):null,action:a.action||null,percent:finite(a.percent)?a.percent:null,ruleLabel:a.ruleLabel?String(a.ruleLabel).slice(0,60):null}));
 out.asksTotal=open.length;
 if(bytes(out)>deepViewPolicy.companionMaxBytes)for(const p of out.projects)p.people=p.people.slice(0,1);
 if(bytes(out)>deepViewPolicy.companionMaxBytes)for(const p of out.projects)p.plays=p.plays.slice(0,1);
 if(bytes(out)>deepViewPolicy.companionMaxBytes)out.asks=out.asks.slice(0,2);
 return out;
}
