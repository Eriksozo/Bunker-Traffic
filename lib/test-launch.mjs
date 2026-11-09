import {isWarmupCampaign} from './campaign-scope.mjs';
// Cycle with first-24h is safe: each side calls the other only at runtime, never at module evaluation.
import {nameDateOffset} from './first-24h.mjs';
const finite=Number.isFinite;
const closed=['7d','3d','yesterday'];
const words=name=>typeof name==='string'?name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' '):'';
/** TESTE as its own word ([TESTE], TESTE01, TESTES), never inside another word (TESTEMUNHO, ATESTADO). */
export function isTestCampaign(name=''){
 return /(?:^| )TESTES?\d*(?: |$)/.test(words(name))&&!isWarmupCampaign(name)&&!/AVATAR|ATVAR|ESCALA|BID.?CAP|COST.?CAP/i.test(name);
}
const localMidnight=(now,timezone)=>{try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));return now-((+p.hour)*3600+(+p.minute)*60+(+p.second))*1000-now%1000;}catch{return NaN;}};
const sameObject=(a,b)=>a?.adAccountId===b?.adAccountId&&a?.externalId===b?.externalId;
/**
 * Closed windows are collected with only the rows that spent. A campaign absent from such a
 * complete Malva source that ends exactly where today starts, read and synced after it closed,
 * had no observed spend there. Any other absence (stale day, incomplete or duplicated cut) stays N/D.
 */
export function verifiedNoSpendPeriods(snapshots,project,row,todayFrom){
 const start=Date.parse(todayFrom||'');
 if(!finite(start)||!project||!row?.adAccountId||!row?.externalId)return [];
 const level=row.level||'campaign',cuts=Array.isArray(snapshots)?snapshots:[];
 return closed.filter(period=>{
  const matches=cuts.filter(s=>s?.projectId===project&&s.period===period&&s.level===level);
  if(matches.length!==1)return false;
  const s=matches[0];
  return s.source==='Malva MCP'&&s.complete===true&&Array.isArray(s.rows)&&Date.parse(s.to)===start&&Date.parse(s.fetchedAt)>=start&&Date.parse(s.lastSyncAt)>=start&&!s.rows.some(r=>sameObject(r,row));
 });
}
/** Early investigation only. A date in a name never proves creation, scheduling or actual delivery. */
export function testLaunchContext(row,windows={},options={}){
 const now=options.now??Date.now(),timezone=options.timezone||'America/Sao_Paulo';
 const base={version:1,eligible:false,priority:false,canExecute:false,automaticPause:false};
 if(!isTestCampaign(row?.name)||row?.provider&&String(row.provider).toLowerCase()!=='meta'||row?.accountStatus?.active===false||row?.effectiveStatus!=='ACTIVE'||row?.status&&row.status!=='ACTIVE')return base;
 const history=closed.map(p=>windows[p]).filter(r=>r&&sameObject(r,row));
 const noSpend=new Set(Array.isArray(options.noSpendPeriods)?options.noSpendPeriods.filter(p=>closed.includes(p)):[]);
 // A row read in the window wins; only a verified absence from a complete spent-only source counts as no spend.
 const historyKnown=closed.every(p=>{const r=windows[p];return r&&sameObject(r,row)?finite(r.spend)&&finite(r.frontOrders):noSpend.has(p);});
 const delivered=Date.parse(row.deliveryStartedAt||''),scheduled=Date.parse(row.startAt||'');
 const ageHours=finite(delivered)&&delivered<=now?(now-delivered)/3600000:null;
 // A test started late yesterday spent in yesterday's closed window: with an observed start under 24h, before today's
 // midnight, and every closed-window spend equal to yesterday's, that spend is the test's own first hours, not history.
 const start=finite(delivered)?delivered:scheduled,midnight=localMidnight(now,timezone),y=windows.yesterday&&sameObject(windows.yesterday,row)?windows.yesterday:null;
 const lateYesterday=finite(start)&&start<=now&&now-start<86400000&&finite(midnight)&&start<midnight&&finite(y?.spend)&&history.every(r=>finite(r.spend)&&Math.abs(r.spend-y.spend)<0.01);
 const priorSpend=!lateYesterday&&history.some(r=>finite(r.spend)&&r.spend>0);
 // Same name-date reading as first-24h ('+DD/MM', any non-digit separator), so both engines agree on day one.
 const namedToday=nameDateOffset(row.name,now,timezone)===0;
 // Old delivery, future scheduling or an actual earlier spend take precedence over a renamed date.
 if(priorSpend||finite(delivered)&&(delivered>now||ageHours>=24)||finite(scheduled)&&scheduled>now)return base;
 const basis=ageHours!==null?'delivery':finite(scheduled)&&now-scheduled<86400000?'schedule-unconfirmed':namedToday?'name-unconfirmed':historyKnown?'first-spend-unconfirmed':null;
 if(!basis)return base;
 const today=windows.today&&sameObject(windows.today,row)?windows.today:row;
 const spend=finite(today.spend)?today.spend:null,front=finite(today.frontOrders)?today.frontOrders:null;
 const orders=finite(today.orders)?today.orders:null,net=finite(today.revenueNet)?today.revenueNet:null;
 const noSales=spend>0&&front===0&&orders===0&&net===0;
 return {...base,eligible:true,priority:noSales,basis,ageHours,historyKnown,...(noSpend.size?{noSpendPeriods:closed.filter(p=>noSpend.has(p)&&!(windows[p]&&sameObject(windows[p],row)))}:{}),spend,frontOrders:front,orders,revenueNet:net,
  label:noSales?'Teste novo sem vendas · revisão prioritária':'Teste novo · acompanhar aquisição',
  limitation:'Conferir início real, programação, atribuição, checkout, filhos e última edição. A nomenclatura não comprova programação; ausência de histórico não é zero. Sem limite universal ou pausa automática. Menos de 24h não dispensa acompanhamento nem impede uma proposta de pausa fundamentada.'};
}
