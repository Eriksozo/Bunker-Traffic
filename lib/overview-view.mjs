import {sum} from './analysis.mjs';

/** Display counts never infer spend from an account merely being followed. */
export function accountOverview(rows){
 const grouped=new Map();
 for(const row of rows){
  if(typeof row.adAccountId!=='string'||!row.adAccountId)continue;
  const key=JSON.stringify([row.projectId??null,row.provider??null,row.adAccountId]);
  if(!grouped.has(key))grouped.set(key,{key,id:row.adAccountId,name:row.accountName||'Conta sem nome',rows:[]});
  grouped.get(key).rows.push(row);
 }
 const all=[...grouped.values()].map(account=>({...account,metrics:sum(account.rows)}));
 const withSpend=all.filter(account=>account.rows.some(row=>Number.isFinite(row.spend)&&row.spend>0));
 const unknown=all.filter(account=>!withSpend.includes(account)&&account.rows.some(row=>!Number.isFinite(row.spend)));
 withSpend.sort((a,b)=>(b.metrics.spend??-Infinity)-(a.metrics.spend??-Infinity)||a.name.localeCompare(b.name));
 return {all,withSpend,unknown,withoutSpend:all.length-withSpend.length-unknown.length};
}

const groups=Object.freeze([
 {label:'Revisar perdas',tone:'red',text:'Investigar a causa antes de cortar.'},
 {label:'Oportunidades',tone:'green',text:'Aquisição, retorno e capacidade.'},
 {label:'Em observação',tone:'amber',text:'Preservar teste e evitar pressa.'},
 {label:'Investigar dados',tone:'gray',text:'Conferir atualização e condição de entrega.'},
]);
export function overviewSignals(signals){return groups.map(group=>({...group,n:signals.filter(signal=>signal.tone===group.tone).length}));}
