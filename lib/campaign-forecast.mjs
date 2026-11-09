/** Experimental conditional scenarios. Not an approval, calibrated prediction
 * interval, causal estimate, financial promise or replacement for peer review. */
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const recent=(v,now,age)=>finite(time(v))&&time(v)<=now&&now-time(v)<=age;
const median=values=>{const a=values.slice().sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const civil=(v,tz)=>{try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v));return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');}catch{return null;}};
export const campaignForecastLimits=Object.freeze({freshnessMs:300000,minElapsedMs:10800000,editHoldMs:3600000,minHistoryDays:3,minHistoryOrders:10,model:'conditional-pacing-v1'});

/** Compare acquisition in disjoint closed windows: the latest three days vs
 * the four days preceding them. Never sums overlapping 3d/7d windows. */
export function campaignHistoryTrend(card){
 const week=card?.windows?.['7d'],recent=card?.windows?.['3d'];
 const none={kind:'unknown',label:'Tendência em formação',detail:'Faltam janelas fechadas comparáveis com vendas front suficientes.',change:null,through:null};
 if(!week||!recent||week.to!==recent.to||!week.timezone||week.timezone!==recent.timezone||!(time(week.from)<time(recent.from)&&time(recent.from)<time(recent.to)))return none;
 const days=(a,b,tz)=>(time(civil(b,tz)+'T00:00:00Z')-time(civil(a,tz)+'T00:00:00Z'))/86400000;
 if(days(week.from,week.to,week.timezone)!==7||days(recent.from,recent.to,recent.timezone)!==3)return none;
 if(![week.spend,recent.spend,week.frontOrders,recent.frontOrders].every(finite)||week.spend<recent.spend||week.frontOrders<recent.frontOrders)return none;
 const previousSpend=week.spend-recent.spend,previousFront=week.frontOrders-recent.frontOrders;
 if(previousSpend<=0||recent.spend<=0||previousFront<5||recent.frontOrders<5)return none;
 const before=previousSpend/previousFront,after=recent.spend/recent.frontOrders,change=(after/before-1)*100;
 const kind=change<=-15?'improving':change>=15?'weakening':'stable';
 return {kind,label:kind==='improving'?'Aquisição em melhora':kind==='weakening'?'Aquisição mais cara':'Aquisição estável',detail:`CPA Front dos 3 dias fechados comparado ao bloco anterior, sem somar janelas sobrepostas. Não prevê lucro.`,change,through:recent.to};
}

/** exact daily target is required even if a Meta objectId occurs in two accounts.
 * The latest current-day series supplies paired observed totals. History
 * supplies paired efficiency examples; today's pacing supplies remaining spend, capped by a known daily budget in
 * BRL (or converted by the row's own budgetRate). An unknown budget leaves the pace uncapped. No Meta overdelivery
 * assumption is introduced. */
/** @param {any} input */
export function forecastCampaign(input={}){
 const {card,state={},item,now=Date.now(),paused=false,error=null}=input;
 const at=typeof now==='number'?now:time(now),trend=campaignHistoryTrend(card);
 const base={model:campaignForecastLimits.model,status:'unavailable',confidence:'Não calibrada',trend,scenarios:[],currency:null,dailyBudget:null,observedAt:null,closesAt:null,historyDays:0,weightToday:null,observed:null,reason:'Aguardando leitura atual do resultado por dia.',warnings:[],canExecute:false};
 const stop=reason=>({...base,reason});
 if(!finite(at)||!card?.row)return stop('Identidade da campanha não confirmada.');
 if(state.paused||paused)return stop('Acompanhamento pausado. A projeção não será atualizada.');
 const target=item?.target,row=card.observedRow||card.row,s=item?.snapshot;
 if(!target||target.projectId!==card.project||target.adAccountId!==card.row.adAccountId||target.objectId!==card.row.externalId||!s)return stop(base.reason);
 if(target.internalObjectId&&row.id&&target.internalObjectId!==row.id)return stop('O identificador interno da campanha mudou. Solicitar uma nova leitura da série.');
 if(error||item.error||item.stale||card.liveStale||!card.liveToday||!recent(card.liveAt,at,campaignForecastLimits.freshnessMs)||!recent(s.fetchedAt,at,campaignForecastLimits.freshnessMs))return stop('A leitura diária ou o status atual estão desatualizados ou indisponíveis.');
 if(s.source!=='Malva MCP'||s.currency!=='BRL'||!s.timezone||target.timezone!==s.timezone||s.timezone!==card.liveToday.timezone)return stop('Origem, moeda em reais ou fuso da campanha não confirmados.');
 if(row.status!=='ACTIVE'||row.effectiveStatus!=='ACTIVE'||row.accountStatus?.active===false)return stop('Campanha ou conta sem condição ativa confirmada. Não extrapolar a entrega.');
 const from=time(card.liveToday.from),to=time(card.liveToday.to),clock=time(s.fetchedAt),day=civil(clock,s.timezone);
 if(!finite(from)||!finite(to)||from>=clock||clock>=to||from>at||to<=at||civil(at,s.timezone)!==day||civil(from,s.timezone)!==day||s.to!==day)return stop('O dia da série não corresponde ao acompanhamento atual.');
 try{
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:s.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),midnight=n=>formatter.format(new Date(n))==='00:00:00';
  const days=(time(civil(to,s.timezone)+'T00:00:00Z')-time(civil(from,s.timezone)+'T00:00:00Z'))/86400000;
  if(!midnight(from)||!midnight(to)||days!==1)return stop('O horizonte precisa terminar na próxima meia-noite do fuso da campanha.');
 }catch{return stop('Não foi possível confirmar as fronteiras locais do dia.');}
 base.currency=s.currency;base.observedAt=s.fetchedAt;base.closesAt=card.liveToday.to;
 const native=arr(card.liveDrift?.changes);
 const changes=arr(state.campaignChanges).filter(c=>c.project===card.project&&c.adAccountId===card.row.adAccountId&&c.objectId===card.row.externalId&&finite(time(c.observedAt))&&time(c.observedAt)<=at);
 if(native.length||changes.some(c=>at-time(c.observedAt)<campaignForecastLimits.editHoldMs))return stop('Houve mudança de status ou orçamento. Aguardar ao menos 60 minutos de observação e reconciliar a análise antes de extrapolar.');
 const incident=arr(state.incidents).some(i=>i.project===card.project&&!['Resolvido','Encerrado'].includes(i.status)&&(!arr(i.scope?.accountIds).length||i.scope.accountIds.includes(card.row.adAccountId))&&(!arr(i.scope?.objectIds).length||i.scope.objectIds.some(o=>o.adAccountId===card.row.adAccountId&&o.objectId===card.row.externalId)));
 if(incident)return stop('Há um incidente ou uma retomada em acompanhamento. Confirmar o período normal de operação antes de projetar.');
 const elapsed=clock-from,duration=to-from;
 if(elapsed<campaignForecastLimits.minElapsedMs)return stop('Primeiras 3 horas do dia: ainda é cedo para extrapolar o fechamento.');
 const all=arr(s.rows),seen=new Set();
 for(const d of all){if(!/^\d{4}-\d{2}-\d{2}$/.test(d?.day)||!finite(time(d.day+'T00:00:00Z'))||new Date(time(d.day+'T00:00:00Z')).toISOString().slice(0,10)!==d.day||seen.has(d.day))return stop('Série diária com data inválida ou duplicada.');seen.add(d.day);}
 const today=all.find(d=>d.day===day),known=d=>d&&[d.spend,d.orders,d.revenueNet,d.profit].every(finite)&&d.spend>0&&d.orders>=0&&Number.isInteger(d.orders)&&d.revenueNet>=0;
 if(!known(today))return stop('O parcial de hoje não tem gasto, pedidos e valores financeiros confirmados.');
 const history=all.filter(d=>d.day<day&&d.day>=s.from&&known(d));base.historyDays=history.length;
 if(history.length<campaignForecastLimits.minHistoryDays||history.reduce((n,d)=>n+d.orders,0)<campaignForecastLimits.minHistoryOrders)return stop('São necessários ao menos 3 dias fechados com gasto e 10 pedidos no histórico para simular o fechamento.');
 const typicalSpend=median(history.map(d=>d.spend));
 if(today.spend<typicalSpend*.1)return stop('Gasto parcial menor que 10% do dia típico. O sinal ainda é insuficiente.');
 const b=finite(row.dailyBudget)?row:card.row,budgetRate=String(b.budgetCurrency||'').toUpperCase()==='BRL'?1:finite(b.budgetRate)&&b.budgetRate>0?b.budgetRate:NaN;
 const dailyBudget=finite(b.dailyBudget)&&b.dailyBudget>0&&finite(budgetRate)?b.dailyBudget*budgetRate:null,paced=today.spend*(duration/elapsed-1);
 const remainingSpend=dailyBudget===null?paced:Math.min(paced,Math.max(0,dailyBudget-today.spend)),reached=dailyBudget!==null&&today.spend>=dailyBudget,capped=dailyBudget!==null&&remainingSpend<paced,weight=Math.min(.75,Math.max(.25,today.spend/(today.spend+typicalSpend/4)));
 const anchors=history.slice().sort((a,b)=>a.profit/a.spend-b.profit/b.spend||a.day.localeCompare(b.day));
 const scenarios=[['conservative','Conservador',.2],['central','Central',.5],['favorable','Favorável',.8]].map(([id,label,q])=>{
  const anchor=anchors[Math.round((anchors.length-1)*q)],rate=k=>weight*today[k]/today.spend+(1-weight)*anchor[k]/anchor.spend;
  const spend=today.spend+remainingSpend,revenueNet=today.revenueNet+remainingSpend*rate('revenueNet'),profit=today.profit+remainingSpend*rate('profit'),orders=today.orders+remainingSpend*rate('orders');
  return {id,label,spend,revenueNet,profit,orders,roas:revenueNet/spend,referenceDay:anchor.day};
 });
 if(scenarios.some(v=>![v.spend,v.revenueNet,v.profit,v.orders,v.roas].every(finite)))return stop('O cálculo não produziu valores válidos.');
 const money=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
 return {...base,status:'scenario',confidence:'Limitada · modelo experimental',dailyBudget,reason:reached?'Orçamento do dia atingido: a Meta encerra a entrega, então os cenários não somam gasto restante.':'Se o ritmo de gasto observado continuar até o fim do dia, com eficiência entre o parcial atual e os exemplos do histórico.',weightToday:weight,observed:{day,spend:today.spend,revenueNet:today.revenueNet,profit:today.profit,orders:today.orders},scenarios,warnings:['Cenários condicionais, sem probabilidade ou margem de erro calibrada. Não há garantia de entrega ou resultado.','Pedidos incluem upsells; a projeção não estima compradores ou vendas front.','O ritmo pode mudar por horário, atribuição, orçamento, lance ou alterações externas. O diário da Meta não é promessa de entrega.',...(capped&&!reached?[`Gasto restante limitado ao orçamento diário de ${money(dailyBudget)}.`]:[]),...(s.lastSyncAt?[]:['A série diária não informa o relógio de sincronização da origem. A projeção usa o horário da coleta.'])]};
}
