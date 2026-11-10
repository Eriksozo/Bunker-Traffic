'use client';
import {useId,useState} from 'react';
import {ChevronDown,RefreshCw} from 'lucide-react';
import {scopeLiveStatus} from '../lib/project-scope.mjs';
import {dataFreshness} from '../lib/data-freshness.mjs';

const stamp=(value:any)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'N/D';
export default function ProjectScopeNotice({projects,scope,feed,error,centralSync,now,refresh}:any){
 const [open,setOpen]=useState(false),id=useId();
 const status=scopeLiveStatus(projects.map((p:any)=>p.id),feed,{error,now});
 const creativeRecent=projects.filter((p:any)=>{
  const entry=feed?.creativeItems?.find((i:any)=>i.projectId===p.id),at=Date.parse(entry?.snapshot?.fetchedAt);
  return !feed?.paused&&!feed?.creativeError&&!entry?.error&&Number.isFinite(at)&&at<=now+300000&&now-at<180000;
 }).length;
 const centralError=['unavailable','signed-out'].includes(centralSync.status);
 const dot=error||centralError?'bad ds-dot--pulse':status.recent?'good':'neutral';
 return <section className={'live-sync-strip'+(error||centralError?' has-error':'')} aria-label="Atualização de todos os projetos">
  <div className="live-sync-summary" role="status"><span className={'status-dot ds-dot ds-dot--'+dot+(status.recent&&!centralError?' green-dot':'')} aria-hidden="true"/><strong>{status.label}</strong></div>
  <small className="live-sync-creative ds-pill ds-pill--tag">Órbita · <span className="ds-tabular">{creativeRecent} de {projects.length}</span> leituras recentes</small>
  <div className="live-sync-actions"><button type="button" className="live-sync-details-toggle ds-btn ds-btn--ghost ds-btn--sm" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>Detalhes por projeto <ChevronDown size={13} aria-hidden="true"/></button><button className="button ds-btn ds-btn--sm" onClick={()=>refresh()}><RefreshCw size={14} aria-hidden="true"/> Atualizar dados</button></div>
  <div id={id} hidden={!open} className="live-sync-detail-body"><p>Os totais usam leituras do mesmo período. Confira abaixo a atualização e a cobertura de cada projeto.</p>
   <div className="table-scroll"><table><thead><tr><th>Projeto</th><th>Malva · acompanhamento</th><th>Base exibida · coleta</th><th>Sincronização Malva</th><th>Cobertura</th></tr></thead><tbody>{scope.entries.map((e:any)=>{const freshness=dataFreshness(e.snapshot,now);return <tr key={e.id}><td>{e.name}</td><td>{status.statuses.find((s:any)=>s.id===e.id)?.label}</td><td>{stamp(freshness.fetchedAt)} · {e.live?'acompanhamento':'análise'}</td><td>{stamp(freshness.sourceUpdatedAt)}</td><td>{!e.included?'Sem leitura comparável':e.snapshot?.complete?'Completa no recorte':'Parcial'}</td></tr>;})}</tbody></table></div>
   <p>As fontes podem ter horários de atualização diferentes. A coleta não elimina atrasos de atribuição da Meta ou do checkout.</p>
  </div>
  {(error||centralError)&&<p role="alert" className="live-sync-message is-error ds-hint ds-hint--error">{error||'A conexão com a central precisa ser restabelecida. As últimas leituras foram preservadas.'}</p>}
  {feed?.paused&&<p className="live-sync-message ds-hint">Acompanhamento pausado. As últimas leituras permanecem visíveis.</p>}
 </section>;
}
