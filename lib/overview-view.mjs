import {sum} from './analysis.mjs';
import {dataFreshness} from './data-freshness.mjs';

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

/** A successful today feed is not a successful four-window analysis. A missing
 * classification is unknown, even when the observed investment is current. */
export function overviewAnalysisState(state,project,signals,now=Date.now()){
 const ids=project==='all'?Object.keys(state.config||{}):state.config?.[project]?[project]:[];
 const entries=ids.map(id=>{
  const cuts=['7d','3d','yesterday','today'].map(period=>(state.snapshots||[]).filter(s=>s.projectId===id&&s.level==='campaign'&&s.period===period).sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0]);
  const today=cuts[3],ready=cuts.every(s=>s?.complete===true&&!dataFreshness(s,now).stale)&&Date.parse(today?.from)<=now&&Date.parse(today?.to)>now&&cuts.slice(0,3).every(s=>s.to===today?.from&&s.timezone===today?.timezone);
  const agent=state.agents?.[id],job=(state.jobs||[]).find(j=>j.id===agent?.jobId&&j.project===id);
  const failure=!ready&&agent?.status==='Falhou'&&job?.status==='Falhou'&&Date.parse(job.updatedAt||agent.lastCheckAt||job.startedAt)>Date.parse(today?.fetchedAt||'1970-01-01')?(job.note||agent.failureNote||''):'';
  return {id,ready,storageFailure:failure.includes('STORAGE_LIMIT')};
 });
 const ready=entries.filter(e=>e.ready).length,incomplete=entries.length===0||ready!==entries.length,storageFailure=entries.some(e=>e.storageFailure);
 return {ready,total:entries.length,incomplete,storageFailure,
  title:incomplete?'Aguardando atualização da análise':'Leitura disponível para revisão',
  message:storageFailure?'A última análise não pôde ser salva por limite de armazenamento. Os dados anteriores foram preservados.':incomplete?'O acompanhamento de hoje pode estar atualizado, mas a análise dos quatro períodos precisa ser renovada.':'Os sinais abaixo orientam a revisão; mudanças de verba continuam exigindo sua aprovação.',
  groups:overviewSignals(signals).map(group=>({...group,value:group.n===0&&incomplete&&group.tone!=='gray'?null:group.n,...(group.tone==='gray'?{label:'Aguardando releitura',text:'Campanhas sem classificação atual. Não significa retorno ruim.'}:{})})),
 };
}
