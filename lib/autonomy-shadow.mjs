/**
 * Shadow mode for the autonomy policy (docs/autonomy-policy.md).
 * Computes what the Bunker WOULD do now under each owner-chosen rule and records it.
 * Pure: no provider call, no write to the central, no approval, no dispatch.
 * Thresholds per project come from a private policy (never from the public repository).
 */
import {sum} from './analysis.mjs';
import {isTestCampaign,testLaunchContext,verifiedNoSpendPeriods} from './test-launch.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {newCampaignStage,first24hGuard,first24hReason,nameDateOffset,first24hPolicy,overlayMetaLive} from './first-24h.mjs';
import {pausedAfterAnalysis,objectKey} from './daily-brief.mjs';
import {activityLog} from './campaign-activity.mjs';

export const shadowPolicy=Object.freeze({version:2,maxEntries:3000,retentionDays:7,sourceAgeMs:30*60000,managerEditGuardMs:2*3600000,matchWindowMs:12*3600000});
/** Owner decision of 08/11/2026 ("Aplicar agora"), after the next-day backtest (docs/autonomy-policy.md):
 * 1. bad-day-reduce stays a suggestion (never would-execute) until its own graded accuracy reaches 60% over at least
 *    20 graded decisions; 2. morning-increase requires a 3-day ROI of at least 1.3; 3. a strong day (ROI >= 3) is the
 *    preferred trigger: +50% there, +30% otherwise. */
export const shadowRulePolicy=Object.freeze({version:1,badDayMinAccuracy:0.6,badDayMinGraded:20,increaseMinRecentRoi:1.3,strongDayRoi:3,strongStep:0.5,baseStep:0.3});
export const shadowRules=Object.freeze({
 'test-no-sale':'Pausar campanha nova sem venda (primeiras 24h e 2º dia)',
 'bad-day-reduce':'Reduzir 20% em dia ruim de campanha com histórico bom',
 'no-delivery':'Pausar campanha sem entrega (organização)',
 'morning-increase':'Aumentar por vendas desde a meia-noite',
});
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
const round2=n=>Math.round(n*100)/100;
const localHour=(now,timezone)=>{try{return Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(now));}catch{return null;}};
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};
const snapshot=(state,project,period)=>{const list=arr(state?.snapshots).filter(s=>s.projectId===project&&s.period===period&&s.level==='campaign'&&s.complete===true);return list.length===1?list[0]:null;};
const budgetBrl=row=>finite(row?.dailyBudget)&&row.dailyBudget>0?row.dailyBudget*(String(row.budgetCurrency||'').toUpperCase()==='BRL'?1:finite(row.budgetRate)&&row.budgetRate>0?row.budgetRate:NaN):NaN;

/** Day of first spend: 0 (first day), 1 (started yesterday) or null (older or unknown). */
export function launchDay(row,windows,options){
 if(testLaunchContext(row,windows,options).eligible)return 0;
 const y=windows.yesterday,d3=windows['3d'],d7=windows['7d'];
 if(y&&d3&&d7&&finite(y.spend)&&y.spend>0&&Math.abs(d3.spend-y.spend)<0.01&&Math.abs(d7.spend-y.spend)<0.01)return 1;
 return null;
}

/** Freshest trustworthy today row: live cut when newer and within the age limit, else the analysis cut. */
function todayRows(state,project,liveItem,now){
 const analysis=snapshot(state,project,'today'),live=liveItem?.snapshot;
 const fresh=s=>s&&s.complete===true&&s.projectId===project&&s.period==='today'&&s.level==='campaign'&&finite(time(s.fetchedAt))&&now-time(s.fetchedAt)<=shadowPolicy.sourceAgeMs&&time(s.fetchedAt)<=now+300000&&finite(time(s.lastSyncAt))&&now-time(s.lastSyncAt)<=shadowPolicy.sourceAgeMs;
 const useLive=fresh(live)&&live.from===analysis?.from&&(!analysis||time(live.fetchedAt)>=time(analysis.fetchedAt));
 // After midnight, before the first analysis of the new day: the live cut is today's, the closed windows are not.
 if(fresh(live)&&(!analysis||time(live.from)>time(analysis.from)))return {rows:arr(live.rows),fetchedAt:live.fetchedAt,lastSyncAt:live.lastSyncAt,from:live.from,timezone:live.timezone||analysis?.timezone,kind:'live-only',aligned:false};
 const source=useLive?live:fresh(analysis)?analysis:null;
 return source?{rows:arr(source.rows),fetchedAt:source.fetchedAt,lastSyncAt:source.lastSyncAt,from:source.from,timezone:source.timezone||analysis?.timezone,kind:useLive?'live':'analysis',aligned:true}:null;
}

/**
 * Decisions the rules would take now. Each carries its blocking guards and unchecked limitations;
 * `wouldExecute` is true only when nothing blocks. Nothing here is a proposal or an approval.
 * @param {any} state
 * @param {{project?:string,liveItem?:any,events?:any[],params?:any,now?:number,meta?:any}} [options] `meta`: live Meta read (lib/meta-live.mjs), first-24h only
 * @returns {{decisions:any[],skipped?:string,source?:any,day?:string|null}}
 */
/** Graded accuracy of one rule from stored shadow entries (all projects): right / (right + wrong). */
export function ruleAccuracy(entries,rule){
 const v=arr(entries).filter(e=>e?.rule===rule).map(e=>e.grade?.verdict).filter(x=>x==='acertou'||x==='errou');
 const right=v.filter(x=>x==='acertou').length;
 return {graded:v.length,right,accuracy:v.length?right/v.length:null};
}
export function evaluateShadow(state,{project='',liveItem=null,events=[],params={},now=Date.now(),meta=null,accuracy=null}={}){
 const cfg=state?.config?.[project];if(!cfg)return {decisions:[],skipped:'Projeto não configurado.'};
 const today=todayRows(state,project,liveItem,now);if(!today)return {decisions:[],skipped:'Fonte de hoje vencida ou incompleta: nada avaliado.'};
 const timezone=today.timezone||'America/Sao_Paulo',hour=localHour(now,timezone);
 const closed=today.aligned?Object.fromEntries(['7d','3d','yesterday'].map(p=>[p,snapshot(state,project,p)])):{};
 const closedRow=(p,r)=>arr(closed[p]?.rows).find(x=>key(x)===key(r))||null;
 const edits=arr(events).filter(e=>e.project===project&&e.origin!=='bunker'&&finite(time(e.at))&&now-time(e.at)<=shadowPolicy.managerEditGuardMs);
 // Budget edits of today by anyone (the Bunker's own confirmed executions included): rules 2 and 4 read totals since
 // midnight, mostly earlier than such an edit, so the same evidence must not push the same direction again.
 const todayKey=localDay(now,timezone),budgetEdits=arr(events).filter(e=>e.project===project&&(e.action==='increase'||e.action==='reduce')&&finite(time(e.at))&&time(e.at)<=now+300000&&localDay(time(e.at),timezone)===todayKey);
 const hhmm=at=>{try{return new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(time(at));}catch{return '?';}};
 const decisions=[];
 const common=['Pedidos pendentes não verificados pela fonte de campanhas.','Venda em hora sem gasto não separada nesta leitura (sem detalhe por hora).'];
 for(const row of today.rows){
  if(row?.provider!=='meta'||row.level!=='campaign'||isWarmupCampaign(row.name))continue;
  if(row.status!=='ACTIVE'||row.effectiveStatus!=='ACTIVE'||row.accountStatus?.active===false)continue;
  const windows={'7d':closedRow('7d',row),'3d':closedRow('3d',row),yesterday:closedRow('yesterday',row),today:row};
  const noSpendPeriods=verifiedNoSpendPeriods(state.snapshots,project,row,today.from);
  const t=sum([row]),recent=windows['3d']?sum([windows['3d']]):null,budget=budgetBrl(row);
  const live=overlayMetaLive(row,meta,{now,timezone}),fresh=newCampaignStage(live,{...windows,today:live},{now,timezone,noSpendPeriods});
  let day=fresh?.stage==='first-day'?0:fresh?.stage==='second-day'?1:null;
  if(day===null&&!fresh&&isTestCampaign(row.name))day=launchDay(row,windows,{now,timezone,noSpendPeriods});
  const recentEdit=edits.find(e=>e.adAccountId===row.adAccountId&&e.objectId===row.externalId);
  const editedToday=action=>{const e=budgetEdits.filter(x=>x.adAccountId===row.adAccountId&&x.objectId===row.externalId&&x.action===action).sort((a,b)=>time(b.at)-time(a.at))[0];
   return e?[`Orçamento já ${action==='increase'?'aumentado':'reduzido'} hoje às ${hhmm(e.at)} (${e.origin==='bunker'?'Bunker':e.actor||'gestor não identificado'}): os números desde a meia-noite são anteriores a essa edição.`]:[];};
  const base={project,projectName:cfg.projectName||project,adAccountId:row.adAccountId,accountName:row.accountName||null,objectId:row.externalId,malvaObjectId:typeof row.id==='string'?row.id:null,name:row.name,
   launchDay:day,newCampaign:fresh?{stage:fresh.stage,basis:fresh.basis,startsOn:fresh.startsOn||null,ageHours:fresh.ageHours??null,metaLive:live.metaLive||null}:null,metrics:{spend:t.spend,frontOrders:t.frontOrders,orders:t.orders,revenueNet:t.revenueNet,checkouts:t.checkouts,roi:t.roi,roas:t.roas,cpc:t.cpc,recentRoi:recent?.roi??null},
   source:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt}};
  const add=(rule,action,before,after,reason,blockedBy=[],limitations=[])=>{
   if(recentEdit)blockedBy=[...blockedBy,`Edição de ${recentEdit.actor||'gestor não identificado'} há menos de 2h`];
   decisions.push({...base,rule,ruleLabel:shadowRules[rule],action,before,after,reason,blockedBy,limitations:[...common,...limitations],wouldExecute:blockedBy.length===0});
  };
  const p=params||{};
  // 1. New campaign (test or not) in its first 24h or 2nd day without any sale: the owner's ceiling.
  // With 0–1 IC it must not spend the low-IC ceiling (R$110 by default): pause from 90% so the next pulse does not cross it.
  if(day!==null&&finite(live.spend)&&live.spend>0){
   const withYesterday=day===1||fresh?.spansYesterday===true;
   const since={...(withYesterday&&windows.yesterday?sum([windows.yesterday,live]):sum([live])),metaPurchases:live.metaPurchases},guard=first24hGuard(since,p);
   const partial=fresh?.spansYesterday&&!closed.yesterday?['Começou ontem, mas o gasto de ontem não foi lido nesta leitura: teto conferido só com o gasto de hoje.']:[];
   if(guard.level==='pause'||guard.level==='over'){
    const blocked=guard.basis==='ic-unknown'?['IC não informado pela fonte: confirmar antes de pausar.']:[];
    add('test-no-sale','status',{status:'ACTIVE'},{status:'PAUSED'},first24hReason(fresh||{stage:day===1?'second-day':'first-day'},guard)+(guard.level==='over'?' Teto já ultrapassado.':''),blocked,[...(fresh?.basis==='name'?['Início deduzido pela data do nome e pelo histórico sem gasto: sem início programado da Meta nesta leitura.']:[]),...(live.metaLive?.spendUsed?['Gasto de hoje lido direto da Meta (à frente da Malva), convertido pela taxa da própria campanha.']:[]),...partial]);
   }else if(guard.basis==='project'&&guard.limit===null&&guard.level==='watch'&&guard.spend>=first24hPolicy.lowIcSpendLimitBrl)add('test-no-sale','status',{status:'ACTIVE'},{status:'PAUSED'},first24hReason(fresh||{stage:'first-day'},guard),['Limiar de gasto do projeto para 2+ IC não definido na política privada.'],partial);
  }
  // Rules 2–4 need the closed windows of the same day: before the new day's analysis only the first-24h rule runs.
  if(!today.aligned)continue;
  // 2. Bad day on a campaign with a good recent history: −20% on the real (CBO) budget owner.
  if(day===null&&recent&&finite(recent.roi)&&recent.roi>=1.3&&hour!==null&&hour>=10&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const floor=Math.max(finite(p.ticketFront)?1.5*p.ticketFront:0,finite(budget)?0.3*budget:Infinity);
   const bad=finite(t.spend)&&finite(floor)&&t.spend>=floor&&(t.orders===0||finite(t.roi)&&t.roi<0.7);
   // Owner decision 08/11/2026: a suggestion only, until the rule's own next-day accuracy proves itself.
   const acc=accuracy?.['bad-day-reduce'],proven=!!acc&&acc.graded>=shadowRulePolicy.badDayMinGraded&&acc.accuracy>=shadowRulePolicy.badDayMinAccuracy;
   const gate=proven?[]:[`Só sugestão até o placar desta regra passar de ${shadowRulePolicy.badDayMinAccuracy*100}% de acerto com ${shadowRulePolicy.badDayMinGraded}+ decisões avaliadas (agora: ${acc?.graded?`${acc.right} de ${acc.graded}`:'sem avaliações'}).`];
   if(bad){const after=round2(row.dailyBudget*0.8);add('bad-day-reduce','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`3 dias com ROI ${round2(recent.roi)}, mas hoje ROI ${t.roi===null?'N/D':round2(t.roi)} com R$${round2(t.spend)} gastos.`,[...gate,...(/ESCALA|COST.?CAP|BID.?CAP/i.test(row.name)?['Fase ESCALA/COST-CAP: a política pede só sugestão.']:[]),...editedToday('reduce')]);}
  }
  // 3. No delivery: active, no spend in the verified closed windows and no impressions today after midday.
  // A campaign dated yesterday, today or ahead (scheduled overnight) is never an organizational pause.
  const recentName=!!fresh||(nameDateOffset(row.name,now,timezone)??-99)>=-1;
  if(hour!==null&&hour>=12&&t.spend===0&&!(t.impressions>0)&&!recentName&&noSpendPeriods.includes('yesterday')&&noSpendPeriods.includes('3d')){
   add('no-delivery','status',{status:'ACTIVE'},{status:'PAUSED'},'Ativa sem entrega: nenhum gasto nos últimos 3 dias e nenhuma impressão hoje.',[],['Data de criação não confirmada: pode ser campanha programada.']);
  }
  // 4. Sales since midnight (owner decision 08/11/2026): needs a 3-day ROI of at least 1.3; +50% on a strong day
  // (ROI >= 3), +30% otherwise. Caps are mandatory to execute.
  if(hour!==null&&hour>=9&&finite(t.orders)&&t.orders>=3&&finite(t.frontOrders)&&t.frontOrders>=2&&finite(t.roi)&&t.roi>=2.5&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const floor=Math.max(finite(p.ticketFront)?p.ticketFront:0,finite(budget)?0.25*budget:Infinity);
   if(finite(floor)&&t.spend>=floor){
    const history=!!recent&&finite(recent.roi)&&recent.roi>=shadowRulePolicy.increaseMinRecentRoi,strong=t.roi>=shadowRulePolicy.strongDayRoi&&day===null;
    const step=strong?shadowRulePolicy.strongStep:shadowRulePolicy.baseStep,after=round2(row.dailyBudget*(1+step)),cap=p.budgetCaps?.[row.adAccountId]??p.budgetCap;
    const blocked=finite(cap)?(after>cap?[`Acima do teto do dono (${cap} ${row.budgetCurrency})`]:[]):['Teto de orçamento do dono não definido: aumento não executaria.'];
    const noHistory=history?[]:[`Histórico de 3 dias abaixo de ROI ${shadowRulePolicy.increaseMinRecentRoi} (${recent&&finite(recent.roi)?round2(recent.roi):'N/D'}): aumento exige histórico.`];
    add('morning-increase','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`${t.orders} pedidos (${t.frontOrders} front) hoje, ROI parcial ${round2(t.roi)} com R$${round2(t.spend)} gastos${strong?' (dia forte)':''}: +${step*100}%.`,[...noHistory,...blocked,...editedToday('increase')]);
   }
  }
 }
 return {decisions,source:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt},day:localDay(now,timezone)};
}

const levelRank={over:0,pause:1,alert:2,watch:3,waiting:4,sold:5};
/**
 * "Primeiras 24h" board: every new Meta campaign of the project (scheduled, first 24h, 2nd day) and where it stands
 * against the owner's ceiling. Reading aid for the notch and the MCP read: no proposal, no approval, no dispatch.
 * Works without a private policy (the owner's general ceiling applies); the project threshold for 2+ IC needs it.
 * @param {any} state
 * @param {{project?:string,liveItem?:any,params?:any,now?:number,meta?:any}} [options]
 */
export function first24hWatch(state,{project='',liveItem=null,params={},now=Date.now(),meta=null}={}){
 const cfg=state?.config?.[project];if(!cfg)return null;
 const today=todayRows(state,project,liveItem,now),projectName=cfg.projectName||project;
 if(!today)return {project,projectName,stale:true,items:[],counts:{scheduled:0,firstDay:0,secondDay:0,attention:0}};
 const timezone=today.timezone||'America/Sao_Paulo';
 const closed=today.aligned?Object.fromEntries(['7d','3d','yesterday'].map(p=>[p,snapshot(state,project,p)])):{};
 const closedRow=(p,r)=>arr(closed[p]?.rows).find(x=>key(x)===key(r))||null;
 // Owner report 08/11/2026: a campaign paused from the notch stayed on the board. A pause newer than this cut (a confirmed
 // Bunker execution, the Malva history, an observed change or a newer live row) takes it off at once.
 const cutAt=today.lastSyncAt||today.fetchedAt,liveSnap=liveItem?.snapshot;
 const pausedNow=pausedAfterAnalysis(arr(today.rows).map(r=>({row:{...r,projectId:project,sourceAt:cutAt}})),{events:activityLog(state,{project,now}),
  liveRows:liveSnap?.projectId===project?arr(liveSnap.rows).map(r=>({...r,projectId:project,fetchedAt:liveSnap.fetchedAt,lastSyncAt:liveSnap.lastSyncAt||null})):[]});
 const items=[];
 for(const row of today.rows){
  if(row?.provider!=='meta'||row.level!=='campaign'||isWarmupCampaign(row.name))continue;
  if(row.status!=='ACTIVE'||/^(PAUSED|CAMPAIGN_PAUSED|ARCHIVED|DELETED)$/.test(row.effectiveStatus||'')||row.accountStatus?.active===false)continue;
  if(pausedNow.has(objectKey(project,row.adAccountId,row.externalId)))continue;
  const live=overlayMetaLive(row,meta,{now,timezone}),windows={'7d':closedRow('7d',row),'3d':closedRow('3d',row),yesterday:closedRow('yesterday',row),today:live};
  const fresh=newCampaignStage(live,windows,{now,timezone,noSpendPeriods:verifiedNoSpendPeriods(state.snapshots,project,row,today.from)});
  if(!fresh)continue;
  const since={...((fresh.stage==='second-day'||fresh.spansYesterday===true)&&windows.yesterday?sum([windows.yesterday,live]):sum([live])),metaPurchases:live.metaPurchases};
  const guard=fresh.stage==='scheduled'?null:first24hGuard(since,params);
  items.push({project,projectName,account:row.accountName||null,adAccountId:row.adAccountId,objectId:row.externalId,campaign:row.name,
   stage:fresh.stage,stageLabel:fresh.label,basis:fresh.basis,startsOn:fresh.startsOn||null,startsAt:fresh.startsAt||null,ageHours:fresh.ageHours??null,spansYesterday:!!fresh.spansYesterday,metaLive:!!live.metaLive,awaitingDelivery:!!fresh.awaitingDelivery,effectiveStatus:row.effectiveStatus||null,
   spend:guard?guard.spend:0,checkouts:guard?guard.checkouts:null,frontOrders:since.frontOrders,orders:since.orders,
   level:guard?guard.level:'scheduled',limit:guard?.limit??null,pauseAt:guard?.pauseAt??null,reason:guard&&guard.level!=='waiting'?first24hReason(fresh,guard):null});
 }
 const rank=i=>i.stage==='scheduled'?9:levelRank[i.level]??8;
 items.sort((a,b)=>rank(a)-rank(b)||(b.spend||0)-(a.spend||0)||String(a.campaign).localeCompare(String(b.campaign)));
 const counts={scheduled:items.filter(i=>i.stage==='scheduled').length,firstDay:items.filter(i=>i.stage==='first-day').length,secondDay:items.filter(i=>i.stage==='second-day').length,attention:items.filter(i=>['alert','pause','over'].includes(i.level)).length};
 return {project,projectName,stale:false,aligned:today.aligned,day:localDay(now,timezone),sourceAt:today.lastSyncAt,ceiling:first24hPolicy.lowIcSpendLimitBrl,items,counts};
}

/** Merges per-project boards for the notch ("all" or one project); keeps the most urgent first. */
export function first24hSummary(boards,{project='all',limit=12}={}){
 const list=arr(boards).filter(b=>b&&(project==='all'||b.project===project));
 const items=list.flatMap(b=>b.items).sort((a,b)=>(a.stage==='scheduled'?9:levelRank[a.level]??8)-(b.stage==='scheduled'?9:levelRank[b.level]??8)||(b.spend||0)-(a.spend||0));
 const counts={scheduled:0,firstDay:0,secondDay:0,attention:0};for(const b of list)for(const k of Object.keys(counts))counts[k]+=b.counts?.[k]||0;
 const live=items.filter(i=>i.stage!=='scheduled');
 return {ceiling:first24hPolicy.lowIcSpendLimitBrl,stale:list.filter(b=>b.stale).map(b=>b.projectName),counts,items:live.slice(0,limit),scheduled:items.filter(i=>i.stage==='scheduled').slice(0,limit).map(i=>({campaign:i.campaign,project:i.projectName,account:i.account,startsOn:i.startsOn,startsAt:i.startsAt}))};
}

/**
 * Keeps the first time a decision appeared each day: that instant is what "acting before a manager" is measured against.
 * Once a decision would have executed, its before/after stay those of that moment (a later budget is not the Bunker's act).
 * @param {any[]} prior @param {any[]} decisions @param {{now?:number,day?:string|null}} [options]
 */
export function mergeShadow(prior,decisions,{now=Date.now(),day=null}={}){
 const at=new Date(now).toISOString(),byId=new Map(arr(prior).map(e=>[e.id,e]));
 for(const d of decisions){
  const id=JSON.stringify([day,d.rule,d.project,d.adAccountId,d.objectId,d.action]),old=byId.get(id);
  byId.set(id,old?{...old,...d,...(old.firstWouldExecuteAt?{before:old.before,after:old.after}:{}),id,day,firstAt:old.firstAt,lastAt:at,firstWouldExecuteAt:old.firstWouldExecuteAt||(d.wouldExecute?at:null),seen:(old.seen||1)+1}:{...d,id,day,firstAt:at,lastAt:at,firstWouldExecuteAt:d.wouldExecute?at:null,seen:1});
 }
 const cutoff=now-shadowPolicy.retentionDays*86400000;
 return [...byId.values()].filter(e=>time(e.lastAt)>=cutoff).sort((a,b)=>time(b.firstAt)-time(a.firstAt)).slice(0,shadowPolicy.maxEntries);
}

/** What a manager actually did on the same object after the shadow decision (who, when, minutes later). */
export function shadowOutcomes(entries,events){
 const kinds=['pause','increase','reduce','activate'],all=arr(events).filter(x=>kinds.includes(x.action));
 const relevant=all.filter(x=>x.origin!=='bunker'),mine=all.filter(x=>x.origin==='bunker');
 return arr(entries).map(e=>{
  const kind=e.action==='status'?(e.after?.status==='PAUSED'?'pause':'activate'):(e.after?.dailyBudget>e.before?.dailyBudget?'increase':'reduce');
  const start=time(e.firstAt),first=list=>list.filter(x=>x.project===e.project&&x.adAccountId===e.adAccountId&&x.objectId===e.objectId&&x.action===kind&&time(x.at)>=start-shadowPolicy.managerEditGuardMs&&time(x.at)<=start+shadowPolicy.matchWindowMs).sort((a,b)=>time(a.at)-time(b.at))[0];
  const read=m=>m?{actor:m.actor||null,at:m.at,minutesAfter:Math.round((time(m.at)-start)/60000),before:m.before,after:m.after}:null;
  const found=read(first(relevant)),own=read(first(mine));
  // Events come in a rolling window (26h in the worker): a reaction already read is kept after its event ages out.
  // Owner request 08/11/2026: the same action the owner sent through the Bunker (notch order or approved proposal) is
  // shown as done by the owner. It stays apart from `manager`, so "antes do gestor" and the counters do not change.
  return {...e,manager:e.manager&&(!found||time(e.manager.at)<=time(found.at))?e.manager:found,owner:e.owner&&(!own||time(e.owner.at)<=time(own.at))?e.owner:own};
 });
}

/** Local calendar day of a snapshot's start in its own timezone (the day a closed "yesterday" window covers). */
const windowDay=s=>{const t=time(s?.from);return finite(t)?localDay(t,s.timezone||'America/Sao_Paulo'):null;};
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
/**
 * Grades each shadow decision by what actually happened (nothing was executed, so the real next day is the
 * counterfactual of "doing nothing"). Uses the complete closed "yesterday" window of later readings: on D+1 it covers
 * D (the day of the decision), on D+2 it covers D+1. A grade, once read, is kept. A cut (pause/reduce) is right when
 * D+1 lost money, an increase when D+1 made money; a campaign with no spend on D+1 is "parou" (no grade).
 * Read-only: never a proposal, an approval or a command.
 */
export function shadowGrades(entries,snapshots){
 const closed=arr(snapshots).filter(s=>s?.period==='yesterday'&&s.level==='campaign'&&s.complete===true&&s.source==='Malva MCP');
 return arr(entries).map(e=>{
  if(!e?.day||e.grade?.next)return e;
  const find=d=>{const s=closed.find(x=>x.projectId===e.project&&windowDay(x)===d);if(!s)return undefined;const row=arr(s.rows).find(r=>r.adAccountId===e.adAccountId&&r.externalId===e.objectId);return row?sum([row]):null;};
  const today=find(e.day),next=find(shiftDay(e.day,1));
  if(today===undefined&&next===undefined)return e;
  const grade={...(e.grade||{})};
  if(today!==undefined&&!grade.day)grade.day=today?{spend:today.spend,result:today.result,roi:today.roi}:{spend:0,result:null,roi:null};
  if(next!==undefined){
   const cut=e.action==='status'?e.after?.status==='PAUSED':e.after?.dailyBudget<e.before?.dailyBudget;
   grade.next=next?{spend:next.spend,result:next.result,roi:next.roi}:{spend:0,result:null,roi:null};
   const r=grade.next.result;
   grade.verdict=!(grade.next.spend>0)?'parou':!finite(r)?'N/D':(cut?r<0:r>0)?'acertou':'errou';
   grade.winnerCut=cut&&finite(grade.next.roi)&&grade.next.roi>=1.2;
  }
  return {...e,grade};
 });
}

/**
 * Compact per-project counters for the notch and the MCP read. `bunkerFirst`: the manager acted after the decision
 * could have executed; `anticipatedBlocked`: the manager acted after a decision that was still blocked (never executable then).
 * @param {any[]} entries @param {{project?:string,day?:string|null}} [options]
 */
export function shadowSummary(entries,{project='all',day=null}={}){
 const list=arr(entries).filter(e=>(project==='all'||e.project===project)&&(!day||e.day===day));
 const byRule=Object.fromEntries(Object.keys(shadowRules).map(r=>[r,{total:0,wouldExecute:0,managerDid:0,bunkerFirst:0,anticipatedBlocked:0,graded:0,right:0,wrong:0,winnersCut:0}]));
 for(const e of list){const b=byRule[e.rule];if(!b)continue;b.total++;if(e.firstWouldExecuteAt)b.wouldExecute++;if(e.manager){b.managerDid++;const at=time(e.manager.at),exec=time(e.firstWouldExecuteAt);if(finite(exec)&&at>exec)b.bunkerFirst++;else if(e.manager.minutesAfter>0)b.anticipatedBlocked++;}
  // Assertiveness: graded by the real next day (see shadowGrades).
  const v=e.grade?.verdict;if(v==='acertou'||v==='errou'){b.graded++;if(v==='acertou')b.right++;else b.wrong++;if(e.grade.winnerCut)b.winnersCut++;}}
 // Assertiveness over every retained day of this scope (grades arrive on D+2, after "today" is over).
 const scoped=arr(entries).filter(e=>project==='all'||e.project===project),verdicts=scoped.map(e=>e.grade?.verdict).filter(Boolean);
 const scorecard={days:shadowPolicy.retentionDays,graded:verdicts.filter(v=>v==='acertou'||v==='errou').length,right:verdicts.filter(v=>v==='acertou').length,wrong:verdicts.filter(v=>v==='errou').length,winnersCut:scoped.filter(e=>e.grade?.winnerCut).length,stopped:verdicts.filter(v=>v==='parou').length};
 // Newest first by the latest thing that happened to each decision (made, manager acted, owner acted): a campaign
 // the owner just paused rises to the top instead of hiding behind the storage order.
 const lastAt=e=>Math.max(...[e.firstAt,e.manager?.at,e.owner?.at].map(time).filter(finite),0);
 const newest=[...list].sort((a,b)=>lastAt(b)-lastAt(a));
 return {day:day||null,total:list.length,byRule,scorecard,recent:newest.slice(0,12).map(e=>({rule:e.rule,ruleLabel:e.ruleLabel,project:e.projectName,account:e.accountName,campaign:e.name,action:e.action,before:e.before,after:e.after,reason:e.reason,firstAt:e.firstAt,wouldExecute:!!e.firstWouldExecuteAt,blockedBy:e.blockedBy,manager:e.manager,owner:e.owner||null,grade:e.grade||null}))};
}
