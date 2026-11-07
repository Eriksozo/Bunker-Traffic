import {isWarmupCampaign} from './campaign-scope.mjs';
const finite=Number.isFinite;
const closed=['7d','3d','yesterday'];
export function isTestCampaign(name=''){
 return /TESTE/i.test(name)&&!isWarmupCampaign(name)&&!/AVATAR|ATVAR|ESCALA|BID.?CAP|COST.?CAP/i.test(name);
}
const localDay=(now,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}catch{return null;}};
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
 if(!isTestCampaign(row?.name)||row?.provider&&row.provider!=='meta'||row?.accountStatus?.active===false||row?.effectiveStatus!=='ACTIVE'||row?.status&&row.status!=='ACTIVE')return base;
 const history=closed.map(p=>windows[p]).filter(r=>r&&sameObject(r,row));
 const noSpend=new Set(Array.isArray(options.noSpendPeriods)?options.noSpendPeriods.filter(p=>closed.includes(p)):[]);
 // A row read in the window wins; only a verified absence from a complete spent-only source counts as no spend.
 const historyKnown=closed.every(p=>{const r=windows[p];return r&&sameObject(r,row)?finite(r.spend)&&finite(r.frontOrders):noSpend.has(p);});
 const priorSpend=history.some(r=>finite(r.spend)&&r.spend>0);
 const delivered=Date.parse(row.deliveryStartedAt||''),scheduled=Date.parse(row.startAt||'');
 const ageHours=finite(delivered)&&delivered<=now?(now-delivered)/3600000:null;
 const day=localDay(now,timezone),nameDate=/^\s*(\d{2})\/(\d{2})(?:\s|$)/.exec(row.name||'');
 const namedToday=!!day&&!!nameDate&&day.slice(5)===`${nameDate[2]}-${nameDate[1]}`;
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
