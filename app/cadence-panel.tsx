'use client';
import {useState} from 'react';
import {Clock3,Save,ShieldCheck} from 'lucide-react';
import {cadenceOf,nextWindow,duePlan,cadenceIntervals} from '../lib/cadence.mjs';
import './accounts-panel.css';
const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const zones=[['America/Boa_Vista','Boa Vista · UTC−4'],['America/Sao_Paulo','Brasília · UTC−3']] as const;
const tips=[['30–60 min','rotina de análise.'],['10–15 min','acompanhar uma escala ou mudança recente.'],['5 min','acompanhamento pontual da fila.']] as const;
const date=(v:string|null,tz:string)=>v?new Date(v).toLocaleString('pt-BR',{timeZone:tz,dateStyle:'short',timeStyle:'short'}):'Agenda pausada';
export default function CadencePanel({state,save,saving}:any){
 const savedCadence=cadenceOf(state),savedKey=JSON.stringify(savedCadence);
 const [draft,setDraft]=useState<{base:string;value:typeof savedCadence}|null>(null);
 const c=draft?.value||savedCadence;
 const setC=(value:typeof savedCadence)=>setDraft(previous=>({base:previous?.base||savedKey,value}));
 const [error,setError]=useState('');
 const next=nextWindow(c),plan=duePlan(state);
 const intervals=[...new Set([...cadenceIntervals,90,c.intervalMinutes])].sort((a,b)=>a-b);
 const stale=!!(draft&&draft.base!==savedKey),zone=zones.find(([id])=>id===c.timezone)?.[1]||c.timezone,badRange=c.start>c.end,noDays=c.weekdays.length===0,projects=Object.entries(state.config);
 return <div className="dashboard-grid cdn-layout"><section className="panel ds-card ds-card--lg cdn-panel" aria-labelledby="cdn-title">
  <header className="cdn-head"><div><span className="ds-eyebrow">Sua rotina, do seu jeito</span><h2 id="cdn-title" className="ds-headline">Cadência de revisão</h2></div><span className="ds-badge ds-badge--tag" aria-hidden="true"><Clock3/></span></header>
  <p className="ds-body cdn-lede">Escolha quando revisar os projetos. Os pedidos manuais continuam disponíveis fora da janela automática.</p>
  <form className="cadence-form cdn-form" onSubmit={async e=>{e.preventDefault();setError('');if(draft&&draft.base!==savedKey){setError('Use a agenda salva e revise os horários antes de salvar novamente.');return;}if(c.start>c.end){setError('O fim deve ser após o início, no mesmo dia.');return;}if(c.weekdays.length===0){setError('Selecione pelo menos um dia.');return;}if(await save({op:'cadence',cadence:c}))setDraft(null);}}>
  {stale&&<div className="ds-banner ds-banner--warn cadence-draft-notice" role="status"><div className="ds-banner__body"><p>A agenda salva mudou em outra sessão. Seu rascunho foi preservado; use a agenda salva antes de editar novamente.</p></div><div className="ds-banner__actions"><button type="button" className="ds-btn ds-btn--sm" onClick={()=>setDraft(null)}>Usar agenda salva</button></div></div>}
  <fieldset className="cadence-fields cdn-fields" disabled={saving}>
   <label className="ds-switch-row cdn-switch"><span className="ds-body-strong">Ativar revisões automáticas</span><input type="checkbox" className="ds-switch" role="switch" checked={c.enabled} onChange={e=>setC({...c,enabled:e.target.checked})}/></label>
   <div className="ds-tile cdn-group" role="group" aria-labelledby="cdn-window">
    <span id="cdn-window" className="ds-eyebrow">Janela diária · horário de {zone}</span>
    <div className="cdn-grid">
     <div className="ds-form-row"><label className="ds-label" htmlFor="cdn-start">Começar às</label><input id="cdn-start" className="ds-field ds-tabular" type="time" step="300" required value={c.start} onChange={e=>setC({...c,start:e.target.value})}/></div>
     <div className="ds-form-row"><label className="ds-label" htmlFor="cdn-end">Última revisão até</label><input id="cdn-end" className="ds-field ds-tabular" type="time" step="300" required value={c.end} aria-invalid={badRange||undefined} aria-describedby={badRange?'cdn-range':undefined} onChange={e=>setC({...c,end:e.target.value})}/></div>
     <div className="ds-form-row"><label className="ds-label" htmlFor="cdn-interval">Intervalo entre revisões</label><select id="cdn-interval" className="ds-field" value={String(c.intervalMinutes)} onChange={e=>setC({...c,intervalMinutes:Number(e.target.value)})}><optgroup label="Em minutos">{intervals.filter(n=>n<60).map(n=><option value={n} key={n}>{n} minutos</option>)}</optgroup><optgroup label="Uma hora ou mais">{intervals.filter(n=>n>=60).map(n=><option value={n} key={n}>{n%60===0?`${n/60} ${n===60?'hora':'horas'}`:`${Math.floor(n/60)}h ${n%60}min`}</option>)}</optgroup></select></div>
     <div className="ds-form-row"><label className="ds-label" htmlFor="cdn-zone">Fuso da agenda</label><select id="cdn-zone" className="ds-field" value={c.timezone} onChange={e=>setC({...c,timezone:e.target.value})}>{zones.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div>
    </div>
    {badRange&&<p id="cdn-range" className="ds-hint ds-hint--warn">O fim deve ser após o início, no mesmo dia.</p>}
   </div>
   <fieldset className="cdn-days"><legend className="ds-label">Dias da semana</legend><div className="ds-segmented ds-segmented--block cdn-days__row">{days.map((d,i)=><label key={d}><input type="checkbox" checked={c.weekdays.includes(i)} onChange={e=>setC({...c,weekdays:e.target.checked?[...c.weekdays,i].sort():c.weekdays.filter((n:number)=>n!==i)})}/><span>{d}</span></label>)}</div>
    {noDays&&<p className="ds-hint ds-hint--warn">Selecione pelo menos um dia.</p>}</fieldset>
   <div className="ds-tile cdn-next"><span className="ds-eyebrow">Próximo horário da agenda</span><strong className={'ds-stat cdn-next__value'+(next?'':' is-paused')}>{!next&&<span className="ds-glyph ds-glyph--waiting" aria-hidden="true"/>}{date(next,c.timezone)}</strong><p className="ds-caption">A coleta começa no próximo pulso disponível do executor ativo na nuvem. Análises e aprovações em andamento são preservadas; uma nova rodada aguarda sua conclusão. A revisão pode levar mais tempo que o intervalo escolhido.</p></div>
   {state.paused&&<div className="ds-banner ds-banner--warn"><div className="ds-banner__body"><strong>O escritório está pausado. Retome na aba Escritório para permitir novas rodadas.</strong></div></div>}
   {error&&<p role="alert" className="ds-banner ds-banner--bad">{error}</p>}
   <div className="cdn-actions"><button type="submit" className="ds-btn ds-btn--primary" disabled={saving||!!(draft&&draft.base!==savedKey)} aria-busy={saving||undefined} aria-describedby={stale?'cdn-save-reason':undefined}>{saving?<span className="ds-spinner" aria-hidden="true"/>:<Save aria-hidden="true"/>} Salvar cadência</button>{stale&&<p id="cdn-save-reason" className="ds-disabled-reason">Use a agenda salva antes de editar novamente.</p>}</div>
  </fieldset></form></section>
  <aside className="right-rail cdn-rail">
   <section className="panel compact ds-card cdn-state" aria-labelledby="cdn-state-title"><header className="cdn-head cdn-head--sm"><h3 id="cdn-state-title" className="ds-title">Estado da revisão</h3><ShieldCheck size={16} aria-hidden="true"/></header><p className="ds-caption cdn-reason">{plan.reason}</p><hr className="ds-divider"/><h3 className="ds-eyebrow">Últimas coletas por projeto</h3>
    {projects.length?<ul className="ds-list ds-list--divided cdn-sources">{projects.map(([id,cfg]:any)=>{const a=state.agents?.[id],held=plan.held?.find((item:any)=>item.project===id),tone=held?'warn':a?.lastSuccessAt?'good':'neutral';return <li className="ds-row cdn-source" key={id}><span className="ds-row__lead"><span className={'ds-dot ds-dot--sm ds-dot--'+tone} aria-hidden="true"/></span><span className="ds-row__main"><span className="ds-row__title" title={cfg.projectName}>{cfg.projectName}</span><span className="cdn-source__status">{held?.reason||a?.status||'Sem rodada do agente'}</span><small className="ds-caption ds-tabular">{a?.lastSuccessAt?`Concluída: ${date(a.lastSuccessAt,c.timezone)}`:'Primeira conclusão ainda não registrada'}</small></span></li>;})}</ul>:<p className="ds-empty">Nenhum projeto configurado ainda.</p>}
   </section>
   <section className="ds-card cdn-tips" aria-labelledby="cdn-tips-title"><header className="cdn-head cdn-head--sm"><h3 id="cdn-tips-title" className="ds-title">Sugestão de uso</h3><Clock3 size={16} aria-hidden="true"/></header>
    <dl className="cdn-tips__list">{tips.map(([time,use])=><div key={time}><dt className="ds-num">{time}</dt><dd>{use}</dd></div>)}</dl>
    <p className="ds-caption">Escolha considerando o tempo de cada rodada e a atualização dos dados. Novos ajustes dependem de evidência nova e da sua aprovação.</p></section>
  </aside></div>;
}
