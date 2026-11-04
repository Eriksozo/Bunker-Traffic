import {CloudError} from './cloud-malva.mjs';
const hour=3600000,finite=x=>typeof x==='number'&&Number.isFinite(x);
export function validateResearchDetail(detail,row,project){
 const r=detail?.row;
 if(!r||r.id!==row.id||r.externalId!==row.externalId||r.adAccountId!==row.adAccountId||r.projectId!==project.id||r.provider!=='meta'||r.level!=='campaign'||detail.currency!==project.currency||detail.period?.timezone!==project.timezone)throw new CloudError('SOURCE_RESEARCH_IDENTITY');
 return detail;
}
/** An observed subset, not a causal before/after comparison or a financial gate. */
export function postEditObservation(research,row){
 const unavailable=(reason,extra={})=>({available:false,reason,...extra}),intraday=research?.detail?.intraday,period=intraday?.period;
 if(!period||period.days?.length!==1||!Array.isArray(intraday.hourly)||!/^[A-Z]{3}$/.test(intraday.currency||''))return unavailable('Sem série horária confirmada de um único dia e moeda conhecida.');
 const from=Date.parse(period.from),to=Date.parse(period.to),at=Date.parse(intraday.fetchedAt);
 if(![from,to,at].every(Number.isFinite)||to-from!==24*hour||at<from||at>=to)return unavailable('Janela horária ou instante da consulta incompatível.');
 try{const day=new Intl.DateTimeFormat('en-CA',{timeZone:period.timezone}).format(at);if(day!==period.days[0])return unavailable('A consulta horária não corresponde ao dia informado.');}catch{return unavailable('Fuso horário não confirmado.');}
 const edits=(research.history?.items||[]).filter(e=>['budget','status','creative'].includes(e.category)&&e.object?.level==='campaign'&&e.object.externalId===row.externalId&&Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)<=at).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const edit=edits[0];if(!edit)return unavailable('Última edição do objeto não confirmada no histórico observado.');
 const extra={lastObservedEditAt:edit.at,historyIncomplete:!!research.history?.truncated||!!research.history?.nextCursor};
 const first=Math.max(0,Math.ceil((Date.parse(edit.at)-from)/hour)),end=Math.min(24,Math.floor((at-from)/hour));
 if(first>=end)return unavailable('Ainda não há uma hora inteira encerrada após a edição observada.',extra);
 const rows=intraday.hourly.filter(h=>Number.isInteger(h.hour)&&h.hour>=first&&h.hour<end),ids=new Set(rows.map(h=>h.hour));
 if(rows.length!==end-first||ids.size!==rows.length||rows.some(h=>!finite(h.spend)||h.spend<0||!Number.isInteger(h.orders)||h.orders<0))return unavailable('Há horas ausentes, duplicadas ou métricas não confirmadas.',extra);
 const total=k=>rows.every(h=>finite(h[k]))?Math.round(rows.reduce((n,h)=>n+h[k],0)*100)/100:null;
 return {available:true,...extra,from:new Date(from+first*hour).toISOString(),to:new Date(from+end*hour).toISOString(),timezone:period.timezone,fetchedAt:intraday.fetchedAt,currency:intraday.currency,scope:'closed-hours-today-only',hours:rows.length,spend:total('spend'),orders:total('orders'),revenueNet:total('revenueNet'),profit:total('profit'),frontOrders:null,causality:'Não demonstrada',limitation:'Somente horas fechadas de hoje após a edição observada. Atribuição pode atrasar; pedidos incluem upsells e não comprovam novas vendas front.'};
}
