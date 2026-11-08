/**
 * Shadow mode for the autonomy policy (docs/autonomy-policy.md).
 * Computes what the Bunker WOULD do now under each owner-chosen rule and records it.
 * Pure: no provider call, no write to the central, no approval, no dispatch.
 * Thresholds per project come from a private policy (never from the public repository).
 */
import {sum} from './analysis.mjs';
import {isTestCampaign,testLaunchContext,verifiedNoSpendPeriods} from './test-launch.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {newCampaignStage,first24hGuard,first24hReason,nameDateOffset,first24hPolicy} from './first-24h.mjs';

export const shadowPolicy=Object.freeze({version:2,maxEntries:3000,retentionDays:7,sourceAgeMs:30*60000,managerEditGuardMs:2*3600000,matchWindowMs:12*3600000});
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
 const source=useLive?live:fresh(analysis)?analysis:null;
 return source?{rows:arr(source.rows),fetchedAt:source.fetchedAt,lastSyncAt:source.lastSyncAt,from:source.from,timezone:source.timezone||analysis?.timezone,kind:useLive?'live':'analysis'}:null;
}

/**
 * Decisions the rules would take now. Each carries its blocking guards and unchecked limitations;
 * `wouldExecute` is true only when nothing blocks. Nothing here is a proposal or an approval.
 * @param {any} state
 * @param {{project?:string,liveItem?:any,events?:any[],params?:any,now?:number}} [options]
 * @returns {{decisions:any[],skipped?:string,source?:any,day?:string|null}}
 */
export function evaluateShadow(state,{project='',liveItem=null,events=[],params={},now=Date.now()}={}){
 const cfg=state?.config?.[project];if(!cfg)return {decisions:[],skipped:'Projeto não configurado.'};
 const today=todayRows(state,project,liveItem,now);if(!today)return {decisions:[],skipped:'Fonte de hoje vencida ou incompleta: nada avaliado.'};
 const timezone=today.timezone||'America/Sao_Paulo',hour=localHour(now,timezone);
 const closed=Object.fromEntries(['7d','3d','yesterday'].map(p=>[p,snapshot(state,project,p)]));
 const closedRow=(p,r)=>arr(closed[p]?.rows).find(x=>key(x)===key(r))||null;
 const edits=arr(events).filter(e=>e.project===project&&e.origin!=='bunker'&&finite(time(e.at))&&now-time(e.at)<=shadowPolicy.managerEditGuardMs);
 const decisions=[];
 const common=['Pedidos pendentes não verificados pela fonte de campanhas.','Venda em hora sem gasto não separada nesta leitura (sem detalhe por hora).'];
 for(const row of today.rows){
  if(row?.provider!=='meta'||row.level!=='campaign'||isWarmupCampaign(row.name))continue;
  if(row.status!=='ACTIVE'||row.effectiveStatus!=='ACTIVE'||row.accountStatus?.active===false)continue;
  const windows={'7d':closedRow('7d',row),'3d':closedRow('3d',row),yesterday:closedRow('yesterday',row),today:row};
  const noSpendPeriods=verifiedNoSpendPeriods(state.snapshots,project,row,today.from);
  const t=sum([row]),recent=windows['3d']?sum([windows['3d']]):null,budget=budgetBrl(row);
  const fresh=newCampaignStage(row,windows,{now,timezone,noSpendPeriods});
  let day=fresh?.stage==='first-day'?0:fresh?.stage==='second-day'?1:null;
  if(day===null&&!fresh&&isTestCampaign(row.name))day=launchDay(row,windows,{now,timezone,noSpendPeriods});
  const recentEdit=edits.find(e=>e.adAccountId===row.adAccountId&&e.objectId===row.externalId);
  const base={project,projectName:cfg.projectName||project,adAccountId:row.adAccountId,accountName:row.accountName||null,objectId:row.externalId,malvaObjectId:typeof row.id==='string'?row.id:null,name:row.name,
   launchDay:day,newCampaign:fresh?{stage:fresh.stage,basis:fresh.basis,startsOn:fresh.startsOn||null}:null,metrics:{spend:t.spend,frontOrders:t.frontOrders,orders:t.orders,revenueNet:t.revenueNet,checkouts:t.checkouts,roi:t.roi,roas:t.roas,cpc:t.cpc,recentRoi:recent?.roi??null},
   source:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt}};
  const add=(rule,action,before,after,reason,blockedBy=[],limitations=[])=>{
   if(recentEdit)blockedBy=[...blockedBy,`Edição de ${recentEdit.actor||'gestor não identificado'} há menos de 2h`];
   decisions.push({...base,rule,ruleLabel:shadowRules[rule],action,before,after,reason,blockedBy,limitations:[...common,...limitations],wouldExecute:blockedBy.length===0});
  };
  const p=params||{};
  // 1. New campaign (test or not) in its first 24h or 2nd day without any sale: the owner's ceiling.
  // With 0–1 IC it must not spend the low-IC ceiling (R$110 by default): pause from 90% so the next pulse does not cross it.
  if(day!==null&&finite(t.spend)&&t.spend>0){
   const since=day===1&&windows.yesterday?sum([windows.yesterday,row]):t,guard=first24hGuard(since,p);
   if(guard.level==='pause'||guard.level==='over'){
    const blocked=guard.basis==='ic-unknown'?['IC não informado pela fonte: confirmar antes de pausar.']:[];
    add('test-no-sale','status',{status:'ACTIVE'},{status:'PAUSED'},first24hReason(fresh||{stage:day===1?'second-day':'first-day'},guard)+(guard.level==='over'?' Teto já ultrapassado.':''),blocked,fresh?.basis==='name'?['Início deduzido pela data do nome e pelo histórico sem gasto: a Malva não envia o início programado.']:[]);
   }else if(guard.basis==='project'&&guard.limit===null&&guard.level==='watch'&&guard.spend>=first24hPolicy.lowIcSpendLimitBrl)add('test-no-sale','status',{status:'ACTIVE'},{status:'PAUSED'},first24hReason(fresh||{stage:'first-day'},guard),['Limiar de gasto do projeto para 2+ IC não definido na política privada.']);
  }
  // 2. Bad day on a campaign with a good recent history: −20% on the real (CBO) budget owner.
  if(day===null&&recent&&finite(recent.roi)&&recent.roi>=1.3&&hour!==null&&hour>=10&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const floor=Math.max(finite(p.ticketFront)?1.5*p.ticketFront:0,finite(budget)?0.3*budget:Infinity);
   const bad=finite(t.spend)&&finite(floor)&&t.spend>=floor&&(t.orders===0||finite(t.roi)&&t.roi<0.7);
   if(bad){const after=round2(row.dailyBudget*0.8);add('bad-day-reduce','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`3 dias com ROI ${round2(recent.roi)}, mas hoje ROI ${t.roi===null?'N/D':round2(t.roi)} com R$${round2(t.spend)} gastos.`,/ESCALA|COST.?CAP|BID.?CAP/i.test(row.name)?['Fase ESCALA/COST-CAP: a política pede só sugestão.']:[]);}
  }
  // 3. No delivery: active, no spend in the verified closed windows and no impressions today after midday.
  // A campaign dated yesterday, today or ahead (scheduled overnight) is never an organizational pause.
  const recentName=!!fresh||(nameDateOffset(row.name,now,timezone)??-99)>=-1;
  if(hour!==null&&hour>=12&&t.spend===0&&!(t.impressions>0)&&!recentName&&noSpendPeriods.includes('yesterday')&&noSpendPeriods.includes('3d')){
   add('no-delivery','status',{status:'ACTIVE'},{status:'PAUSED'},'Ativa sem entrega: nenhum gasto nos últimos 3 dias e nenhuma impressão hoje.',[],['Data de criação não confirmada: pode ser campanha programada.']);
  }
  // 4. Morning sales since midnight: +30% (+50% with a strong recent history). Caps are mandatory to execute.
  if(hour!==null&&hour>=9&&finite(t.orders)&&t.orders>=3&&finite(t.frontOrders)&&t.frontOrders>=2&&finite(t.roi)&&t.roi>=2.5&&finite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)){
   const floor=Math.max(finite(p.ticketFront)?p.ticketFront:0,finite(budget)?0.25*budget:Infinity);
   if(finite(floor)&&t.spend>=floor){
    const step=recent&&finite(recent.roi)&&recent.roi>=1.3&&day===null?0.5:0.3,after=round2(row.dailyBudget*(1+step)),cap=p.budgetCaps?.[row.adAccountId]??p.budgetCap;
    const blocked=finite(cap)?(after>cap?[`Acima do teto do dono (${cap} ${row.budgetCurrency})`]:[]):['Teto de orçamento do dono não definido: aumento não executaria.'];
    add('morning-increase','budget',{dailyBudget:row.dailyBudget,currency:row.budgetCurrency},{dailyBudget:after,currency:row.budgetCurrency},`${t.orders} pedidos (${t.frontOrders} front) hoje, ROI parcial ${round2(t.roi)} com R$${round2(t.spend)} gastos: +${step*100}%.`,blocked);
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
 * @param {{project?:string,liveItem?:any,params?:any,now?:number}} [options]
 */
export function first24hWatch(state,{project='',liveItem=null,params={},now=Date.now()}={}){
 const cfg=state?.config?.[project];if(!cfg)return null;
 const today=todayRows(state,project,liveItem,now),projectName=cfg.projectName||project;
 if(!today)return {project,projectName,stale:true,items:[],counts:{scheduled:0,firstDay:0,secondDay:0,attention:0}};
 const timezone=today.timezone||'America/Sao_Paulo';
 const closed=Object.fromEntries(['7d','3d','yesterday'].map(p=>[p,snapshot(state,project,p)]));
 const closedRow=(p,r)=>arr(closed[p]?.rows).find(x=>key(x)===key(r))||null;
 const items=[];
 for(const row of today.rows){
  if(row?.provider!=='meta'||row.level!=='campaign'||isWarmupCampaign(row.name))continue;
  if(row.status!=='ACTIVE'||row.accountStatus?.active===false)continue;
  const windows={'7d':closedRow('7d',row),'3d':closedRow('3d',row),yesterday:closedRow('yesterday',row),today:row};
  const fresh=newCampaignStage(row,windows,{now,timezone,noSpendPeriods:verifiedNoSpendPeriods(state.snapshots,project,row,today.from)});
  if(!fresh)continue;
  const since=fresh.stage==='second-day'&&windows.yesterday?sum([windows.yesterday,row]):sum([row]);
  const guard=fresh.stage==='scheduled'?null:first24hGuard(since,params);
  items.push({project,projectName,account:row.accountName||null,adAccountId:row.adAccountId,objectId:row.externalId,campaign:row.name,
   stage:fresh.stage,stageLabel:fresh.label,basis:fresh.basis,startsOn:fresh.startsOn||null,awaitingDelivery:!!fresh.awaitingDelivery,effectiveStatus:row.effectiveStatus||null,
   spend:guard?guard.spend:0,checkouts:guard?guard.checkouts:null,frontOrders:since.frontOrders,orders:since.orders,
   level:guard?guard.level:'scheduled',limit:guard?.limit??null,pauseAt:guard?.pauseAt??null,reason:guard&&guard.level!=='waiting'?first24hReason(fresh,guard):null});
 }
 const rank=i=>i.stage==='scheduled'?9:levelRank[i.level]??8;
 items.sort((a,b)=>rank(a)-rank(b)||(b.spend||0)-(a.spend||0)||String(a.campaign).localeCompare(String(b.campaign)));
 const counts={scheduled:items.filter(i=>i.stage==='scheduled').length,firstDay:items.filter(i=>i.stage==='first-day').length,secondDay:items.filter(i=>i.stage==='second-day').length,attention:items.filter(i=>['alert','pause','over'].includes(i.level)).length};
 return {project,projectName,stale:false,day:localDay(now,timezone),sourceAt:today.lastSyncAt,ceiling:first24hPolicy.lowIcSpendLimitBrl,items,counts};
}

/** Merges per-project boards for the notch ("all" or one project); keeps the most urgent first. */
export function first24hSummary(boards,{project='all',limit=12}={}){
 const list=arr(boards).filter(b=>b&&(project==='all'||b.project===project));
 const items=list.flatMap(b=>b.items).sort((a,b)=>(a.stage==='scheduled'?9:levelRank[a.level]??8)-(b.stage==='scheduled'?9:levelRank[b.level]??8)||(b.spend||0)-(a.spend||0));
 const counts={scheduled:0,firstDay:0,secondDay:0,attention:0};for(const b of list)for(const k of Object.keys(counts))counts[k]+=b.counts?.[k]||0;
 const live=items.filter(i=>i.stage!=='scheduled');
 return {ceiling:first24hPolicy.lowIcSpendLimitBrl,stale:list.filter(b=>b.stale).map(b=>b.projectName),counts,items:live.slice(0,limit),scheduled:items.filter(i=>i.stage==='scheduled').slice(0,limit).map(i=>({campaign:i.campaign,project:i.projectName,account:i.account,startsOn:i.startsOn}))};
}

/**
 * Keeps the first time a decision appeared each day: that instant is what "acting before a manager" is measured against.
 * @param {any[]} prior @param {any[]} decisions @param {{now?:number,day?:string|null}} [options]
 */
export function mergeShadow(prior,decisions,{now=Date.now(),day=null}={}){
 const at=new Date(now).toISOString(),byId=new Map(arr(prior).map(e=>[e.id,e]));
 for(const d of decisions){
  const id=JSON.stringify([day,d.rule,d.project,d.adAccountId,d.objectId,d.action]),old=byId.get(id);
  byId.set(id,old?{...old,...d,id,day,firstAt:old.firstAt,lastAt:at,firstWouldExecuteAt:old.firstWouldExecuteAt||(d.wouldExecute?at:null),seen:(old.seen||1)+1}:{...d,id,day,firstAt:at,lastAt:at,firstWouldExecuteAt:d.wouldExecute?at:null,seen:1});
 }
 const cutoff=now-shadowPolicy.retentionDays*86400000;
 return [...byId.values()].filter(e=>time(e.lastAt)>=cutoff).sort((a,b)=>time(b.firstAt)-time(a.firstAt)).slice(0,shadowPolicy.maxEntries);
}

/** What a manager actually did on the same object after the shadow decision (who, when, minutes later). */
export function shadowOutcomes(entries,events){
 const relevant=arr(events).filter(e=>e.origin!=='bunker'&&['pause','increase','reduce','activate'].includes(e.action));
 return arr(entries).map(e=>{
  const kind=e.action==='status'?(e.after?.status==='PAUSED'?'pause':'activate'):(e.after?.dailyBudget>e.before?.dailyBudget?'increase':'reduce');
  const start=time(e.firstAt),match=relevant.filter(x=>x.project===e.project&&x.adAccountId===e.adAccountId&&x.objectId===e.objectId&&x.action===kind&&time(x.at)>=start-shadowPolicy.managerEditGuardMs&&time(x.at)<=start+shadowPolicy.matchWindowMs).sort((a,b)=>time(a.at)-time(b.at))[0];
  return {...e,manager:match?{actor:match.actor||null,at:match.at,minutesAfter:Math.round((time(match.at)-start)/60000),before:match.before,after:match.after}:null};
 });
}

/**
 * Compact per-project counters for the notch and the MCP read.
 * @param {any[]} entries @param {{project?:string,day?:string|null}} [options]
 */
export function shadowSummary(entries,{project='all',day=null}={}){
 const list=arr(entries).filter(e=>(project==='all'||e.project===project)&&(!day||e.day===day));
 const byRule=Object.fromEntries(Object.keys(shadowRules).map(r=>[r,{total:0,wouldExecute:0,managerDid:0,bunkerFirst:0}]));
 for(const e of list){const b=byRule[e.rule];if(!b)continue;b.total++;if(e.firstWouldExecuteAt)b.wouldExecute++;if(e.manager){b.managerDid++;if(e.manager.minutesAfter>0)b.bunkerFirst++;}}
 return {day:day||null,total:list.length,byRule,recent:list.slice(0,12).map(e=>({rule:e.rule,ruleLabel:e.ruleLabel,project:e.projectName,account:e.accountName,campaign:e.name,action:e.action,before:e.before,after:e.after,reason:e.reason,firstAt:e.firstAt,wouldExecute:!!e.firstWouldExecuteAt,blockedBy:e.blockedBy,manager:e.manager}))};
}
