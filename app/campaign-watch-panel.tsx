'use client';
import {useId,useMemo,useState} from 'react';
import {Activity,ChevronDown,ArrowRight} from 'lucide-react';
import {campaignWatchPlan} from '../lib/campaign-watch.mjs';
import {Button} from '@/components/ui/button';
import './campaign-watch-panel.css';

/** Same read-only observation plan used by the executor, recalculated as clocks age. */
export default function CampaignWatchPanel({state,feed,project,now,onOpen}:{state:any;feed:any;project:string;now:number;onOpen:(id:string,project?:string)=>void}){
 const [open,setOpen]=useState(false),detailsId=useId();
 const plan=useMemo(()=>campaignWatchPlan(state,feed||{},now),[state,feed,now]);
 const scopes=project==='all'?plan.projects:plan.projects.filter(p=>p.projectId===project);
 const scope=project==='all'&&scopes.length?{...scopes[0],observed:scopes.reduce((n,p)=>n+p.observed,0),withoutAnalysis:scopes.reduce((n,p)=>n+p.withoutAnalysis,0),needsReview:scopes.reduce((n,p)=>n+p.needsReview,0),missing:scopes.reduce((n,p)=>n+p.missing,0),warmup:scopes.reduce((n,p)=>n+p.warmup,0),signalCount:scopes.reduce((n,p)=>n+p.signalCount,0),preview:scopes.flatMap(p=>p.preview).sort((a,b)=>a.priority-b.priority),collectedAt:null,sourceAt:null,sourceFresh:scopes.every(p=>p.sourceFresh),scopeComplete:scopes.every(p=>p.scopeComplete),scope:'Cobertura e atualização conferidas individualmente por projeto.'}:scopes[0];if(!scope)return null;
 const signals=scope.preview,count=scope.signalCount;
 const stamp=(v:string|null)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'N/D';
 const statusGlyph=state.paused?'waiting':count?'warn':'info',attention=['source','source-clock','coverage','loss'];
 const counts:[number,string][]=[[scope.observed,'campanhas observadas'],[scope.needsReview,'campanhas aguardando revisão'],[scope.withoutAnalysis,'sem análise na base'],[scope.missing,'conhecidas sem retorno'],[scope.warmup,'aquecimentos fora das sugestões']];
 return <section className="panel campaign-watch ds-card ds-card--lg" aria-label="Acompanhamento proativo">
  <div className="watch-heading"><div className="watch-heading-copy"><span className="ds-eyebrow watch-eyebrow"><Activity size={13} aria-hidden="true"/> Acompanhamento proativo</span><h3 className="ds-headline"><span className={'ds-glyph ds-glyph--'+statusGlyph} aria-hidden="true"/>{state.paused?'Acompanhamento pausado':count?`${count} ${count===1?'ponto':'pontos'} para conferir`:'Acompanhando o cenário'}</h3><p className="ds-caption">Sinais para a próxima análise. Ajustes dependem da revisão da equipe e da sua aprovação.</p></div><Button variant="ghost" className="ds-btn ds-btn--sm watch-toggle" onClick={()=>setOpen(!open)} aria-expanded={open} aria-controls={detailsId}>{open?'Recolher':'Ver acompanhamento'}<ChevronDown size={15} className="watch-chevron" aria-hidden="true"/></Button></div>
  <div className="watch-counts">{counts.map(([value,label])=><span className={'watch-count'+(value===0?' is-zero':'')} key={label}><strong>{value}</strong> {label}</span>)}</div>
  {open&&<div id={detailsId} className="watch-details"><p className="ds-caption">{project==='all'?'Atualização por projeto disponível em Detalhes por projeto.':`Coleta: ${stamp(scope.collectedAt)} · Sincronização Malva: ${stamp(scope.sourceAt)}.`} {scope.scope}</p>
   <p className="ds-caption">{scope.sourceFresh?'Origem dentro da janela de acompanhamento.':'Atualidade da origem precisa ser conferida; não interpretar como desempenho em tempo real.'} {scope.scopeComplete?'Cobertura do recorte confirmada.':'Cobertura do recorte ainda requer conciliação.'}</p>
   <div className="watch-list">{signals.slice(0,8).map(s=><article className={'watch-item watch-'+s.kind} key={s.id}><span className={'watch-item-glyph ds-glyph ds-glyph--'+(attention.includes(s.kind)?'warn':'info')} aria-hidden="true"/><div><strong>{s.title}</strong><span>{s.name}</span>{s.accountName&&<small>{project==='all'&&`${s.projectName} · `}{s.accountName} · ID {s.objectId}</small>}<p>{s.reason}</p></div>{s.objectId&&s.kind!=='new'&&<Button variant="ghost" className="ds-btn ds-btn--icon watch-open" onClick={()=>onOpen(s.objectId!,s.projectId)} aria-label={'Abrir campanha '+s.name}><ArrowRight size={16} aria-hidden="true"/></Button>}</article>)}</div>
   {count>signals.slice(0,8).length&&<p className="ds-caption">Mostrando {Math.min(8,signals.length)} de {count} pontos. A equipe recebe a cobertura e a prioridade por projeto; nenhum contador foi reduzido.</p>}
   {!count&&<p className="ds-empty">Nenhuma mudança material sinalizada nesta coleta. Isso não comprova ausência de risco nem substitui as revisões agendadas.</p>}
   <p className="ds-caption">A sincronização é automática enquanto o executor de dados estiver funcionando. A análise dos agentes segue a cadência configurada no painel; não representa presença online contínua.</p>
  </div>}
 </section>;
}
