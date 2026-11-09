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
/** Owner approval of 08/11/2026 ("Aplicar as 4"), from the managers' pauses and Jorge's budget edits of 01–08/11
 * (docs/autonomy-policy.md): 1. new-sale-loss: a new campaign (1st/2nd day) that sold today with R$300+ spent pauses
 *    below ROI 0.8 and only alerts from 0.8 to 1.0 (below 0.8 only 2 of 20 recovered the next day);
 * 2. bad-day-reduce also covers campaigns 1–3 days old with yesterday's ROI >= 1.2, triggers below ROI 0.9 and cuts
 *    30% when the budget was raised today (20% otherwise);
 * 3. night-increase: 00:00–00:30, campaigns 1–4 days old with yesterday's ROI >= 1.3 and a front: +100% on a small
 *    budget, +30%/+50% on a large one; 4. morning-increase no longer needs 3 days of history on a new campaign with
 *    2+ fronts and ROI >= 2 today (+30%). Budget rules stay suggestions until their own next-day score proves itself. */
export const shadowRulePolicy=Object.freeze({version:2,badDayMinAccuracy:0.6,badDayMinGraded:20,increaseMinRecentRoi:1.3,strongDayRoi:3,strongStep:0.5,baseStep:0.3,
 newSaleLossMinSpendBrl:300,newSaleLossPauseRoi:0.8,newSaleLossAlertRoi:1,
 badDayRoi:0.9,badDayNewMinYesterdayRoi:1.2,badDayStep:0.2,badDayStepAfterIncrease:0.3,
 nightMinYesterdayRoi:1.3,nightSmallBudgetBrl:1000,nightSmallStep:1,nightLargeStep:0.3,nightLargeStrongStep:0.5,nightStrongRoi:2,nightEndMinute:30,
 newIncreaseMinFronts:2,newIncreaseMinRoi:2,newIncreaseStep:0.3});
export const shadowRules=Object.freeze({
 'test-no-sale':'Pausar campanha nova sem venda (primeiras 24h e 2º dia)',
 'new-sale-loss':'Pausar campanha nova com venda e prejuízo (1º e 2º dia)',
 'bad-day-reduce':'Reduzir 20–30% em dia ruim de campanha com histórico bom',
 'no-delivery':'Pausar campanha sem entrega (organização)',
 'morning-increase':'Aumentar por vendas desde a meia-noite',
 'night-increase':'Aumentar na virada do dia pelo ontem fechado',
});
/** Rules that stay suggestions until their own graded next-day accuracy proves itself. */
export const scoreGatedRules=Object.freeze(['bad-day-reduce','night-increase','morning-increase']);
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
const round2=n=>Math.round(n*100)/100;
const localHour=(now,timezone)=>{try{return Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(now));}catch{return null;}};
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};
const localMinute=(now,timezone)=>{try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);}catch{return null;}};
const snapshot=(state,project,period)=>{const list=arr(state?.snapshots).filter(s=>s.projectId===project&&s.period===period&&s.level==='campaign'&&s.complete===true);return list.length===1?list[0]:null;};
const budgetBrl=row=>finite(row?.dailyBudget)&&row.dailyBudget>0?row.dailyBudget*(String(row.budgetCurrency||'').toUpperCase()==='BRL'?1:finite(row.budgetRate)&&row.budgetRate>0?row.budgetRate:NaN):NaN;

/**
 * Spend and ceiling of a new campaign: today, or since launch (yesterday + today) on the 2nd day and on a first day
 * across midnight. Owner report 08/11/2026: a manager paused day-2 tests that sold yesterday and burned today with no
 * sale, and the shadow had nothing, because yesterday's sale marked them "with sale" all day. A sale before today does
 * not cover today: when today alone has spend and no sale, today is checked against the same ceiling.
 */
function launchGuard(live,yesterday,withYesterday,params){
 const today={...sum([live]),metaPurchases:live.metaPurchases};
 if(!(withYesterday&&yesterday))return {since:today,guard:first24hGuard(today,params)};
 const since={...sum([yesterday,live]),metaPurchases:live.metaPurchases},guard=first24hGuard(since,params);
 if(guard.level!=='sold'||guard.basis!=='sale'){
  // An earlier day's sale field N/D leaves the total unknown ("acompanhar"), but today's own reading may be complete:
  // today with spend and a known zero sale is held to the same ceiling (first-24h-protocol.md, 2nd day).
  if(guard.level==='sold'||guard.salesKnown!==false)return {since,guard};
  const alone=first24hGuard(today,params);
  return alone.salesKnown===true&&['alert','pause','over'].includes(alone.level)?{since:today,guard:{...alone,todayOnly:true,priorSalesNd:true}}:{since,guard};
 }
 const alone=first24hGuard(today,params);
 return alone.level==='sold'||alone.level==='waiting'?{since,guard}:{since:today,guard:{...alone,todayOnly:true}};
}

/**
 * Spend before today that counts toward a new campaign's ceiling: yesterday, plus the day before when a 2nd day by
 * schedule/delivery (under 48h) began then (the closed 3 days, exact while the campaign is younger than 48h).
 * `missing` names what this reading could not include ('yesterday', 'd2' or 'both'). `d2` is only passed in the live-only
 * window after midnight: the previous analysis's closed "yesterday" row, 0 (verified no spend) or null (not read).
 */
function launchPrior(live,fresh,windows,{timezone,todayFrom,d2,yesterdayZero=false}){
 const began=fresh?.basis==='delivery'?time(live.deliveryStartedAt):fresh?.basis==='schedule'?Math.max(time(live.startAt),finite(time(live.createdAt))?time(live.createdAt):-Infinity):NaN;
 const yDay=localDay(time(todayFrom)-1,timezone),early=finite(began)&&!!yDay&&localDay(began,timezone)<yDay,y=windows.yesterday||null,noY=!y&&!yesterdayZero;
 if(!early)return {prior:y,missing:noY?'yesterday':null};
 if(d2===undefined&&windows['3d'])return {prior:windows['3d'],missing:null};
 if(noY)return {prior:null,missing:'both'};
 if(d2===undefined||d2===null)return {prior:y,missing:'d2'};
 return {prior:d2===0?y:y?sum([d2,y]):d2,missing:null};
}
const launchLimitation={yesterday:'Começou ontem, mas o gasto de ontem não foi lido nesta leitura: teto conferido só com o gasto de hoje.',
 d2:'Começou anteontem, mas o gasto de anteontem não foi lido nesta leitura: teto conferido com ontem e hoje.',
 both:'Começou anteontem, mas o gasto de ontem e de anteontem não foi lido nesta leitura: teto conferido só com o gasto de hoje.'};
/** first24hReason, without claiming what this reading did not see (an earlier sale N/D, spend not read). */
function launchReason(stage,guard,missing){
 let r=first24hReason(stage,guard);
 if(guard.priorSalesNd)r=r.replace('vendeu ontem, hoje sem venda','venda de ontem N/D, hoje sem venda');
 if(missing&&!guard.todayOnly)r=r.replace('(gasto desde o início)',missing==='d2'?'(gasto de ontem e hoje; anteontem não lido)':'(só gasto de hoje; ontem não lido)');
 return r;
}

/** Day of first spend: 0 (first day), 1 (started yesterday) or null (older or unknown). */
/**
 * Owner decisions layered over the private policy (secret `AUTONOMY_SHADOW_OWNER`, owner decision of 09/11/2026:
 * "alinhar" the Sombra with his own pauses). `all` holds pause thresholds that apply to every configured project and
 * can only LOWER a project's value, never raise it; `enable` lists configured project ids the Sombra starts evaluating
 * (with the defaults plus `all`). A project disabled in the base policy stays disabled. Values live only in the secrets.
 */
export const ownerLowerOnly=Object.freeze(['first24hLowIcLimit','first24hLowIcPauseAt','pauseTestMinSpendNoCheckout','pauseTestMinSpend']);
export function ownerShadowPolicy(policy,owner,projectIds=[]){
 const base=policy&&typeof policy==='object'?policy:{},projects={...(base.projects&&typeof base.projects==='object'?base.projects:{})};
 const all=owner&&typeof owner.all==='object'&&owner.all?owner.all:{},enable=new Set(arr(owner?.enable).filter(v=>typeof v==='string'));
 for(const id of arr(projectIds)){
  const current=projects[id];
  if(current?.enabled===false||(!current&&!enable.has(id)))continue;
  const p={...(current||{})};
  for(const k of ownerLowerOnly){const v=all[k];if(finite(v)&&v>0)p[k]=finite(p[k])&&p[k]>0?Math.min(p[k],v):v;}
  projects[id]=p;
 }
 return {...base,projects};
}

export function launchDay(row,windows,options){
 if(testLaunchContext(row,windows,options).eligible)return 0;
 const y=windows.yesterday,d3=windows['3d'],d7=windows['7d'];
 if(y&&d3&&d7&&finite(y.spend)&&y.spend>0&&Math.abs(d3.spend-y.spend)<0.01&&Math.abs(d7.spend-y.spend)<0.01)return 1;
 return null;
}

/** Freshest trustworthy today row: live cut when newer and within the age limit, else the analysis cut. */
function todayRows(state,project,liveItem,now){
 const analysis=snapshot(state,project,'today'),live=liveItem?.snapshot;
 // After midnight a cut of the day that just ended is not today's: it would read yesterday's totals as "hoje" and the day
 // before as "ontem". The night pass reads that cut as yesterday (previousCut) once the new day's live cut exists.
 const zone=s=>s.timezone||analysis?.timezone||'America/Sao_Paulo',ofToday=s=>localDay(time(s.from),zone(s))===localDay(now,zone(s));
 const fresh=s=>s&&ofToday(s)&&s.complete===true&&s.projectId===project&&s.period==='today'&&s.level==='campaign'&&finite(time(s.fetchedAt))&&now-time(s.fetchedAt)<=shadowPolicy.sourceAgeMs&&time(s.fetchedAt)<=now+300000&&finite(time(s.lastSyncAt))&&now-time(s.lastSyncAt)<=shadowPolicy.sourceAgeMs;
 const useLive=fresh(live)&&live.from===analysis?.from&&(!analysis||time(live.fetchedAt)>=time(analysis.fetchedAt));
 // After midnight, before the first analysis of the new day: the live cut is today's, the closed windows are not.
 if(fresh(live)&&(!analysis||time(live.from)>time(analysis.from)))return {rows:arr(live.rows),fetchedAt:live.fetchedAt,lastSyncAt:live.lastSyncAt,from:live.from,timezone:live.timezone||analysis?.timezone,kind:'live-only',aligned:false};
 const source=useLive?live:fresh(analysis)?analysis:null;
 return source?{rows:arr(source.rows),fetchedAt:source.fetchedAt,lastSyncAt:source.lastSyncAt,from:source.from,timezone:source.timezone||analysis?.timezone,kind:useLive?'live':'analysis',aligned:true}:null;
}

/** Live-only window after midnight: the last analysis cut of the day that just ended (its "today", read up to its sync
 * time) and the closed windows that analysis carried (they end where that cut starts). */
function previousCut(state,project,today,now){
 const c=snapshot(state,project,'today');
 if(!c||!(Math.abs(time(today.from)-time(c.from)-86400000)<=3600000)||!finite(time(c.lastSyncAt))||now-time(c.lastSyncAt)>7*3600000)return null;
 const old=p=>{const s=snapshot(state,project,p);return s&&Math.abs(time(s.to)-time(c.from))<=60000?s:null;};
 return {rows:arr(c.rows),from:c.from,at:c.lastSyncAt,yesterday:old('yesterday'),'7d':old('7d')};
}
/** Closed rows of one object. Live-only: "yesterday" is the previous analysis cut; 3d/7d only when that analysis proves
 * no earlier spend (they then equal yesterday); `d2` is the day before yesterday (see launchPrior). */
function rowWindows(state,project,today,closed,prev,row){
 const find=s=>arr(s?.rows).find(x=>key(x)===key(row))||null;
 if(today.aligned)return {windows:{'7d':find(closed['7d']),'3d':find(closed['3d']),yesterday:find(closed.yesterday)},d2:undefined};
 if(!prev)return {windows:{'7d':null,'3d':null,yesterday:null},d2:null};
 const y=find(prev),none=verifiedNoSpendPeriods(state.snapshots,project,row,prev.from),r7=find(prev['7d']),d2=find(prev.yesterday);
 const before=y&&(r7?finite(r7.spend)&&r7.spend===0:none.includes('7d'))?y:null;
 return {windows:{'7d':before,'3d':before,yesterday:y},d2:d2||(none.includes('yesterday')?0:null)};
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
 const prev=previousCut(state,project,today,now);
 const edits=arr(events).filter(e=>e.project===project&&e.origin!=='bunker'&&finite(time(e.at))&&now-time(e.at)<=shadowPolicy.managerEditGuardMs);
 // Budget edits of today by anyone (the Bunker's own confirmed executions included): rules 2 and 4 read totals since
 // midnight, mostly earlier than such an edit, so the same evidence must not push the same direction again.
 const todayKey=localDay(now,timezone),budgetEdits=arr(events).filter(e=>e.project===project&&(e.action==='increase'||e.action==='reduce')&&finite(time(e.at))&&time(e.at)<=now+300000&&localDay(time(e.at),timezone)===todayKey);
 const hhmm=at=>{try{return new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(time(at));}catch{return '?';}};
 // Budget rules stay suggestions until their own next-day score proves itself (owner decisions of 08/11/2026).
 const scoreGate=rule=>{const acc=accuracy?.[rule],proven=!!acc&&acc.graded>=shadowRulePolicy.badDayMinGraded&&acc.accuracy>=shadowRulePolicy.badDayMinAccuracy;
  return proven?[]:[`Só sugestão até o placar desta regra passar de ${shadowRulePolicy.badDayMinAccuracy*100}% de acerto com ${shadowRulePolicy.badDayMinGraded}+ decisões avaliadas (agora: ${acc?.graded?`${acc.right} de ${acc.graded}`:'sem avaliações'}).`];};
 const minute=localMinute(now,timezone);
 // Night pass (00:00–00:30): yesterday's numbers. Once the new day's analysis exists, its closed "yesterday" window;
 // before it, the last analysis cut of the day that just ended (its "today", read up to its sync time).
 const yesterdayCut=minute===null||minute>shadowRulePolicy.nightEndMinute?null:closed.yesterday?{rows:arr(closed.yesterday.rows),at:null}:prev?{rows:prev.rows,at:prev.at}:null;
 const decisions=[];
 const common=['Pedidos pendentes não verificados pela fonte de campanhas.','Venda em hora sem gasto não separada nesta leitura (sem detalhe por hora).'];
 for(const row of today.rows){
  if(row?.provider!=='meta'||row.level!=='campaign'||isWarmupCampaign(row.name))continue;
  if(row.status!=='ACTIVE'||row.effectiveStatus!=='ACTIVE'||row.accountStatus?.active===false)continue;
  const {windows:w,d2}=rowWindows(state,project,today,closed,prev,row),windows={...w,today:row};
  const noSpendPeriods=verifiedNoSpendPeriods(state.snapshots,project,row,today.from);
  const t=sum([row]),recent=today.aligned&&windows['3d']?sum([windows['3d']]):null,budget=budgetBrl(row);
  const live=overlayMetaLive(row,meta,{now,timezone}),fresh=newCampaignStage(live,{...windows,today:live},{now,timezone,noSpendPeriods});
  let day=fresh?.stage==='first-day'?0:fresh?.stage==='second-day'?1:null;
  if(day===null&&!fresh&&isTestCampaign(row.name))day=launchDay(row,windows,{now,timezone,noSpendPeriods});
  const recentEdit=edits.find(e=>e.adAccountId===row.adAccountId&&e.objectId===row.externalId);
  const editedToday=action=>{const e=budgetEdits.filter(x=>x.adAccountId===row.adAccountId&&x.objectId===row.externalId&&x.action===action).sort((a,b)=>time(b.at)-time(a.at))[0];
   return e?[`Orçamento já ${action==='increase'?'aumentado':'reduzido'} hoje às ${hhmm(e.at)} (${e.origin==='bunker'?'Bunker':e.actor||'gestor não identificado'}): os números desde a meia-noite são anteriores a essa edição.`]:[];};
  const base={project,projectName:cfg.projectName||project,adAccountId:row.adAccountId,accountName:row.accountName||null,objectId:row.externalId,malvaObjectId:typeof row.id==='string'?row.id:null,name:row.name,
   launchDay:day,newCampaign:fresh?{stage:fresh.stage,basis:fresh.basis,startsOn:fresh.startsOn||null,ageHours:fresh.ageHours??null,metaLive:live.metaLive||null}:null,metrics:{spend:t.spend,frontOrders:t.frontOrders,orders:t.orders,revenueNet:t.revenueNet,checkouts:t.checkouts,roi:t.roi,roas:t.roas,cpc:t.cpc,recentRoi:recent?.roi??null},
   source:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt}};
  const add=(rule,action,before,after,reason,blockedBy=[],limitations=[],extra={})=>{
   if(recentEdit)blockedBy=[...blockedBy,`Edição de ${recentEdit.actor||'gestor não identificado'} há menos de 2h`];
   decisions.push({...base,...extra,rule,ruleLabel:shadowRules[rule],action,before,after,reason,blockedBy,limitations:[...common,...limitations],wouldExecute:blockedBy.length===0});
  };
  const p=params||{};
  // 1. New campaign (test or not) in its first 24h or 2nd day without any sale: the owner's ceiling.
  // With 0–1 IC it must not spend the low-IC ceiling (R$110 by default): pause from 90% so the next pulse does not cross it.
  if(day!==null&&finite(live.spend)&&live.spend>0){
   const withYesterday=day===1||fresh?.spansYesterday===true;
   const lp=withYesterday?launchPrior(live,fresh,windows,{timezone,todayFrom:today.from,d2,yesterdayZero:noSpendPeriods.includes('yesterday')}):{prior:null,missing:null};
   const {guard}=launchGuard(live,lp.prior,withYesterday,p);
   const partial=[...(lp.missing?[launchLimitation[lp.missing]]:[]),...(prev&&lp.prior&&windows.yesterday?[`Ontem lido até ${hhmm(prev.at)} (último corte da análise de ontem), não o dia fechado.`]:[])];
   if(guard.level==='pause'||guard.level==='over'){
    const blocked=guard.basis==='ic-unknown'?['IC não informado pela fonte: confirmar antes de pausar.']:[];
    add('test-no-sale','status',{status:'ACTIVE'},{status:'PAUSED'},launchReason(fresh||{stage:day===1?'second-day':'first-day'},guard,lp.missing)+(guard.level==='over'?' Teto já ultrapassado.':''),blocked,[...(fresh?.basis==='name'?['Início deduzido pela data do nome e pelo histórico sem gasto: sem início programado da Meta nesta leitura.']:[]),...(live.metaLive?.spendUsed?['Gasto de hoje lido direto da Meta (à frente da Malva), convertido pela taxa da própria campanha.']:[]),...partial]);
   }else if(guard.basis==='project'&&guard.limit===null&&guard.level==='watch'&&guard.spend>=first24hPolicy.lowIcSpendLimitBrl)add('test-no-sale','status',{status:'ACTIVE'},{status:'PAUSED'},launchReason(fresh||{stage:'first-day'},guard,lp.missing),['Limiar de gasto do projeto para 2+ IC não definido na política privada.'],partial);
  }
  // 1b. New campaign (1st/2nd day) that sold today but loses money (owner approval 08/11/2026): a sale does not make
  // it safe. Below ROI 0.8 with R$300+ spent it would pause; from 0.8 to 1.0 it only alerts (frequent recovery).
  const tl=sum([live]),R=shadowRulePolicy;let newLossPause=false;
  if(day!==null&&finite(tl.spend)&&tl.spend>=R.newSaleLossMinSpendBrl&&finite(tl.roi)&&tl.roi<R.newSaleLossAlertRoi&&(tl.frontOrders>0||tl.orders>0||tl.revenueNet>0)){
   newLossPause=tl.roi<R.newSaleLossPauseRoi;
   const sales=finite(tl.orders)&&tl.orders>0?tl.orders:finite(tl.frontOrders)&&tl.frontOrders>0?tl.frontOrders:finite(tl.orders)&&finite(tl.frontOrders)?0:null;
   add('new-sale-loss','status',{status:'ACTIVE'},{status:'PAUSED'},`Campanha nova no ${day===1?'2º':'1º'} dia: R$${round2(tl.spend)} gastos hoje, ${sales===null?'vendas N/D':`${sales} venda${sales===1?'':'s'}`}, ROI de hoje ${round2(tl.roi)}.${newLossPause?` Abaixo de ${R.newSaleLossPauseRoi} a recuperação no dia seguinte foi rara.`:''}`,
    newLossPause?[]:[`Só alerta: ROI entre ${R.newSaleLossPauseRoi} e ${R.newSaleLossAlertRoi} se recupera com frequência no dia seguinte.`],live.metaLive?.spendUsed?['Gasto de hoje lido direto da Meta (à frente da Malva), convertido pela taxa da própria campanha.']:[],{alertOnly:!newLossPause});
  }
  // A pause recorded in this pulse for this object wins: an increase on it never executes in the same pulse.
  const pausedHere=decisions.some(d=>d.adAccountId===row.adAccountId&&d.objectId===row.externalId&&d.after?.status==='PAUSED')?['Pausa registrada nesta leitura para a mesma campanha: a pausa prevalece, o aumento não executaria.']:[];
  // 3b. Night pass (owner approval 08/11/2026): 00:00–00:30, campaign 1–4 days old whose closed yesterday had a front
  // and ROI >= 1.3: +100% on a small budget, +30% (+50% from ROI 2) on a large one.
  const offset=nameDateOffset(row.name,now,timezone);
  const yRow=yesterdayCut?yesterdayCut.rows.find(x=>key(x)===key(row)):null,yNight=yRow?sum([yRow]):null;
  if(yNight&&offset!==null&&offset<=-1&&offset>=-4&&yNight.frontOrders>=1&&finite(yNight.roi)&&yNight.roi>=R.nightMinYesterdayRoi&&finite(budget)&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const small=finite(budget)&&budget<R.nightSmallBudgetBrl,step=small?R.nightSmallStep:yNight.roi>=R.nightStrongRoi?R.nightLargeStrongStep:R.nightLargeStep;
   const after=round2(row.dailyBudget*(1+step)),cap=p.budgetCaps?.[row.adAccountId]??p.budgetCap;
   const capBlock=finite(cap)?(after>cap?[`Acima do teto do dono (${cap} ${row.budgetCurrency})`]:[]):['Teto de orçamento do dono não definido: aumento não executaria.'];
   add('night-increase','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`Ontem ${yNight.frontOrders} front, ROI ${round2(yNight.roi)} com R$${round2(yNight.spend)} gastos: +${step*100}% na virada do dia (orçamento ${small?'pequeno':'grande'}).`,
    [...pausedHere,...scoreGate('night-increase'),...capBlock,...editedToday('increase')],yesterdayCut.at?[`Ontem lido até ${hhmm(yesterdayCut.at)} (último corte da análise de ontem), não o dia fechado.`]:[]);
  }
  // Rules 2–4 need the closed windows of the same day: before the new day's analysis only the first-24h rule runs.
  if(!today.aligned)continue;
  // 2. Bad day on a campaign with a good recent history: −20% on the real (CBO) budget owner, −30% when the budget was
  // raised today. Owner approval 08/11/2026: also campaigns 1–3 days old (never the launch day) with yesterday's ROI
  // >= 1.2 and a sale today (no sale is the first-24h ceiling's job), triggered below ROI 0.9.
  const yDay=windows.yesterday?sum([windows.yesterday]):null;
  const oldOk=day===null&&!!recent&&finite(recent.roi)&&recent.roi>=1.3;
  const young=!oldOk&&day!==0&&(day===1||offset!==null&&offset<=-1&&offset>=-3)&&!!yDay&&finite(yDay.roi)&&yDay.roi>=R.badDayNewMinYesterdayRoi&&t.orders>0&&!newLossPause;
  if((oldOk||young)&&hour!==null&&hour>=10&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const floor=Math.max(finite(p.ticketFront)?1.5*p.ticketFront:0,finite(budget)?0.3*budget:Infinity);
   const bad=finite(t.spend)&&finite(floor)&&t.spend>=floor&&(oldOk&&t.orders===0||finite(t.roi)&&t.roi<R.badDayRoi);
   const raised=editedToday('increase').length>0,step=raised?R.badDayStepAfterIncrease:R.badDayStep;
   if(bad){const after=round2(row.dailyBudget*(1-step));add('bad-day-reduce','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`${oldOk?`3 dias com ROI ${round2(recent.roi)}`:`Campanha recente: ontem ROI ${round2(yDay.roi)}`}, mas hoje ROI ${t.roi===null?'N/D':round2(t.roi)} com R$${round2(t.spend)} gastos: −${step*100}%${raised?' (orçamento aumentado hoje)':''}.`,[...scoreGate('bad-day-reduce'),...(/ESCALA|COST.?CAP|BID.?CAP/i.test(row.name)?['Fase ESCALA/COST-CAP: a política pede só sugestão.']:[]),...editedToday('reduce')]);}
  }
  // 3. No delivery: active, no spend in the verified closed windows and no impressions today after midday.
  // A campaign dated yesterday, today or ahead (scheduled overnight) is never an organizational pause.
  const recentName=!!fresh||(nameDateOffset(row.name,now,timezone)??-99)>=-1;
  if(hour!==null&&hour>=12&&t.spend===0&&!(t.impressions>0)&&!recentName&&noSpendPeriods.includes('yesterday')&&noSpendPeriods.includes('3d')){
   add('no-delivery','status',{status:'ACTIVE'},{status:'PAUSED'},'Ativa sem entrega: nenhum gasto nos últimos 3 dias e nenhuma impressão hoje.',[],['Data de criação não confirmada: pode ser campanha programada.']);
  }
  // 4. Sales since midnight (owner decision 08/11/2026): needs a 3-day ROI of at least 1.3; +50% on a strong day
  // (ROI >= 3), +30% otherwise. Caps are mandatory to execute.
  // Owner approval 08/11/2026: a new campaign (1st/2nd day) has no 3-day history; with 2+ fronts and ROI >= 2 today it
  // gets +30% as a suggestion until the rule's own score proves itself.
  const isNew=day!==null;
  const qualifies=isNew?finite(t.frontOrders)&&t.frontOrders>=R.newIncreaseMinFronts&&finite(t.roi)&&t.roi>=R.newIncreaseMinRoi
   :finite(t.orders)&&t.orders>=3&&finite(t.frontOrders)&&t.frontOrders>=2&&finite(t.roi)&&t.roi>=2.5;
  if(hour!==null&&hour>=9&&qualifies&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const floor=Math.max(finite(p.ticketFront)?p.ticketFront:0,finite(budget)?0.25*budget:Infinity);
   if(finite(floor)&&t.spend>=floor){
    const history=!!recent&&finite(recent.roi)&&recent.roi>=shadowRulePolicy.increaseMinRecentRoi,strong=t.roi>=shadowRulePolicy.strongDayRoi&&day===null;
    const step=isNew?R.newIncreaseStep:strong?shadowRulePolicy.strongStep:shadowRulePolicy.baseStep,after=round2(row.dailyBudget*(1+step)),cap=p.budgetCaps?.[row.adAccountId]??p.budgetCap;
    const blocked=finite(cap)?(after>cap?[`Acima do teto do dono (${cap} ${row.budgetCurrency})`]:[]):['Teto de orçamento do dono não definido: aumento não executaria.'];
    const noHistory=isNew?scoreGate('morning-increase'):history?[]:[`Histórico de 3 dias abaixo de ROI ${shadowRulePolicy.increaseMinRecentRoi} (${recent&&finite(recent.roi)?round2(recent.roi):'N/D'}): aumento exige histórico.`];
    add('morning-increase','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`${finite(t.orders)?`${t.orders} pedidos`:'pedidos N/D'} (${finite(t.frontOrders)?t.frontOrders:'N/D'} front) hoje, ROI parcial ${round2(t.roi)} com R$${round2(t.spend)} gastos${strong?' (dia forte)':''}: +${step*100}%.`,[...pausedHere,...noHistory,...blocked,...editedToday('increase')]);
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
 const prev=previousCut(state,project,today,now);
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
  const {windows:w,d2}=rowWindows(state,project,today,closed,prev,row),live=overlayMetaLive(row,meta,{now,timezone}),windows={...w,today:live};
  const noSpendPeriods=verifiedNoSpendPeriods(state.snapshots,project,row,today.from),fresh=newCampaignStage(live,windows,{now,timezone,noSpendPeriods});
  if(!fresh)continue;
  const withYesterday=fresh.stage==='second-day'||fresh.spansYesterday===true;
  const lp=withYesterday?launchPrior(live,fresh,windows,{timezone,todayFrom:today.from,d2,yesterdayZero:noSpendPeriods.includes('yesterday')}):{prior:null,missing:null};
  const {since,guard:g}=launchGuard(live,lp.prior,withYesterday,params);
  const guard=fresh.stage==='scheduled'?null:g;
  items.push({project,projectName,account:row.accountName||null,adAccountId:row.adAccountId,objectId:row.externalId,campaign:row.name,
   stage:fresh.stage,stageLabel:fresh.label,basis:fresh.basis,startsOn:fresh.startsOn||null,startsAt:fresh.startsAt||null,ageHours:fresh.ageHours??null,spansYesterday:!!fresh.spansYesterday,metaLive:!!live.metaLive,awaitingDelivery:!!fresh.awaitingDelivery,effectiveStatus:row.effectiveStatus||null,
   spend:guard?guard.spend:0,checkouts:guard?guard.checkouts:null,frontOrders:since.frontOrders,orders:since.orders,
   level:guard?guard.level:'scheduled',limit:guard?.limit??null,pauseAt:guard?.pauseAt??null,reason:guard&&guard.level!=='waiting'?launchReason(fresh,guard,lp.missing):null});
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
 // The owner's own acts (through the Bunker, or reported with "Já fiz no Gerenciador") are the owner's, never a manager's.
 const ownOrigin=x=>x.origin==='bunker'||x.origin==='owner',relevant=all.filter(x=>!ownOrigin(x)),mine=all.filter(ownOrigin);
 const opposite={pause:'activate',activate:'pause',increase:'reduce',reduce:'increase'};
 return arr(entries).map(e=>{
  const kind=e.action==='status'?(e.after?.status==='PAUSED'?'pause':'activate'):(e.after?.dailyBudget>e.before?.dailyBudget?'increase':'reduce');
  const start=time(e.firstAt),same=x=>x.project===e.project&&x.adAccountId===e.adAccountId&&x.objectId===e.objectId;
  // A move made before the decision and undone before it appeared (paused then reactivated) is not the reaction.
  const undone=m=>!!m&&time(m.at)<start&&all.some(y=>same(y)&&y.action===opposite[kind]&&time(y.at)>time(m.at)&&time(y.at)<=start);
  const first=list=>list.filter(x=>same(x)&&x.action===kind&&time(x.at)>=start-shadowPolicy.managerEditGuardMs&&time(x.at)<=start+shadowPolicy.matchWindowMs&&!undone(x)).sort((a,b)=>time(a.at)-time(b.at))[0];
  const read=m=>m?{actor:m.actor||null,at:m.at,minutesAfter:Math.round((time(m.at)-start)/60000),before:m.before,after:m.after}:null;
  const found=read(first(relevant)),own=read(first(mine));
  // Events come in a rolling window (26h in the worker): a reaction already read is kept after its event ages out.
  // Owner request 08/11/2026: the same action the owner sent through the Bunker (notch order or approved proposal) is
  // shown as done by the owner. It stays apart from `manager`, so "antes do gestor" and the counters do not change.
  return {...e,manager:e.manager&&!undone(e.manager)&&(!found||time(e.manager.at)<=time(found.at))?e.manager:found,owner:e.owner&&(!own||time(e.owner.at)<=time(own.at))?e.owner:own};
 });
}

/** Local calendar day of a snapshot's start in its own timezone (the day a closed "yesterday" window covers). */
const windowDay=s=>{const t=time(s?.from);return finite(t)?localDay(t,s.timezone||'America/Sao_Paulo'):null;};
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
/**
 * Grades each shadow decision by what actually happened (nothing was executed, so the real next day is the
 * counterfactual of "doing nothing"). Uses the complete closed "yesterday" window of later readings: on D+1 it covers
 * D (the day of the decision), on D+2 it covers D+1. A grade, once read, is kept. A cut (pause/reduce) is right when
 * D+1 lost money, an increase when D+1 made money; a campaign with no spend on D+1 is "parou" (no grade). The night
 * increase (00:00–00:30 of D, before any of D's spend) is judged by D itself, the day the raise acts on. A spend N/D is
 * "N/D" and stays open for a later complete reading. An alert-only entry (never a would-execute pause) is not a cut and
 * is not graded. Read-only: never a proposal, an approval or a command.
 */
export function shadowGrades(entries,snapshots){
 const closed=arr(snapshots).filter(s=>s?.period==='yesterday'&&s.level==='campaign'&&s.complete===true&&s.source==='Malva MCP');
 return arr(entries).map(e=>{
  if(!e?.day)return e;
  // Alert-only first: a grade frozen before this rule existed is dropped too.
  if(!e.firstWouldExecuteAt&&(e.alertOnly===true||e.alertOnly===undefined&&arr(e.blockedBy).some(b=>/^Só alerta/.test(String(b))))){if(!e.grade)return e;const {grade:_,...rest}=e;return rest;}
  // Frozen: D+1 read, or for the night increase D read with basis 'day' (a legacy D+1 verdict on it is regraded by D).
  const byDay=e.rule==='night-increase',legacyNight=byDay&&!!e.grade?.verdict&&e.grade.basis!=='day';
  if(byDay?e.grade?.basis==='day'&&e.grade.day:e.grade?.next)return e;
  const find=d=>{const s=closed.find(x=>x.projectId===e.project&&windowDay(x)===d);if(!s)return undefined;const row=arr(s.rows).find(r=>r.adAccountId===e.adAccountId&&r.externalId===e.objectId);return row?sum([row]):null;};
  const today=find(e.day),next=find(shiftDay(e.day,1));
  if(today===undefined&&next===undefined&&!legacyNight)return e;
  const grade={...(e.grade||{})},view=r=>r?{spend:r.spend,result:r.result,roi:r.roi}:{spend:0,result:null,roi:null};
  // A row with spend N/D is not stored as the day's reading: it stays open for a later complete one.
  if(today!==undefined&&!grade.day&&(!today||finite(today.spend)))grade.day=view(today);
  if(next!==undefined&&(!next||finite(next.spend)))grade.next=view(next);
  const basis=byDay?(today!==undefined?view(today):grade.day):next!==undefined?view(next):undefined;
  if(!basis&&legacyNight){delete grade.verdict;delete grade.winnerCut;delete grade.basis;}
  if(basis){
   const cut=e.action==='status'?e.after?.status==='PAUSED':e.after?.dailyBudget<e.before?.dailyBudget,r=basis.result;
   grade.basis=byDay?'day':'next';
   grade.verdict=!finite(basis.spend)?'N/D':!(basis.spend>0)?'parou':!finite(r)?'N/D':(cut?r<0:r>0)?'acertou':'errou';
   grade.winnerCut=cut&&finite(basis.roi)&&basis.roi>=1.2;
  }
  return {...e,grade};
 });
}

/**
 * Compact per-project counters for the notch and the MCP read. `bunkerFirst`: the manager acted after the decision
 * could have executed; `anticipatedBlocked`: the manager acted after a decision that was still blocked (never executable then).
 * @param {any[]} entries @param {{project?:string,day?:string|null,days?:Record<string,string>|null,pulseAt?:string|null}} [options]
 */
export function shadowSummary(entries,{project='all',day=null,days=null,pulseAt=null}={}){
 // `current`: re-emitted by the latest shadow pass (its lastAt is that pass's time); null when the pass time is unknown.
 const pulse=time(pulseAt),current=e=>finite(pulse)?time(e.lastAt)>=pulse:null;
 // `days` (project → local day): each project's "hoje" follows its own timezone in the 'all' view.
 const dayOf=e=>(days&&typeof days[e.project]==='string'?days[e.project]:day);
 const list=arr(entries).filter(e=>(project==='all'||e.project===project)&&(!dayOf(e)||e.day===dayOf(e)));
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
 return {day:day||null,total:list.length,byRule,scorecard,recent:newest.slice(0,12).map(e=>({rule:e.rule,ruleLabel:e.ruleLabel,project:e.projectName,account:e.accountName,campaign:e.name,
  // Ids only so the notch can open the owner's own order for this campaign (Touch ID); the shadow never executes.
  projectId:e.project??null,adAccountId:e.adAccountId??null,objectId:e.objectId??null,action:e.action,before:e.before,after:e.after,reason:e.reason,firstAt:e.firstAt,lastAt:e.lastAt||null,current:current(e),alertOnly:!!e.alertOnly||arr(e.blockedBy).some(b=>/^Só alerta/.test(String(b))),wouldExecute:!!e.firstWouldExecuteAt,blockedBy:e.blockedBy,manager:e.manager,owner:e.owner||null,grade:e.grade||null}))};
}
