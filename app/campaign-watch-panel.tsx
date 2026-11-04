'use client';
import {useMemo,useState} from 'react';
import {Activity,ChevronDown,ArrowRight} from 'lucide-react';
import {campaignWatchPlan} from '../lib/campaign-watch.mjs';
import {Button} from '@/components/ui/button';
import './campaign-watch-panel.css';

/** Same read-only observation plan used by the executor, recalculated as clocks age. */
export default function CampaignWatchPanel({state,feed,project,now,onOpen}:{state:any;feed:any;project:string;now:number;onOpen:(id:string)=>void}){
 const [open,setOpen]=useState(false);
 const plan=useMemo(()=>campaignWatchPlan(state,feed||{},now),[state,feed,now]);
 const scope=plan.projects.find(p=>p.projectId===project);if(!scope)return null;
 const signals=scope.preview,count=scope.signalCount;
 const stamp=(v:string|null)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'N/D';
 return <section className="panel campaign-watch" aria-label="Acompanhamento proativo">
  <div className="watch-heading"><div><span className="eyebrow"><Activity size={13}/> ACOMPANHAMENTO PROATIVO</span><h3>{state.paused?'Acompanhamento pausado':count?`${count} pontos para conferir`:'Acompanhando o cenário'}</h3><p className="hint">Sinais para a próxima análise. Ajustes dependem da revisão da equipe e da sua aprovação.</p></div><Button variant="outline" onClick={()=>setOpen(!open)} aria-expanded={open} aria-controls="watch-details">{open?'Recolher':'Ver acompanhamento'}<ChevronDown size={15}/></Button></div>
  <div className="watch-counts"><span><strong>{scope.observed}</strong> campanhas observadas</span><span><strong>{scope.withoutAnalysis}</strong> sem análise na base</span><span><strong>{scope.missing}</strong> conhecidas sem retorno</span><span><strong>{scope.warmup}</strong> aquecimentos fora das sugestões</span></div>
  {open&&<div id="watch-details"><p className="hint">Coleta: {stamp(scope.collectedAt)} · Sincronização Malva: {stamp(scope.sourceAt)}. {scope.scope}</p>
   <p className="hint">{scope.sourceFresh?'Origem dentro da janela de acompanhamento.':'Atualidade da origem precisa ser conferida; não interpretar como desempenho em tempo real.'} {scope.scopeComplete?'Cobertura do recorte confirmada.':'Cobertura do recorte ainda requer conciliação.'}</p>
   <div className="watch-list">{signals.slice(0,8).map(s=><article className={'watch-item watch-'+s.kind} key={s.id}><div><strong>{s.title}</strong><span>{s.name}</span>{s.accountName&&<small>{s.accountName} · ID {s.objectId}</small>}<p>{s.reason}</p></div>{s.objectId&&s.kind!=='new'&&<Button variant="ghost" onClick={()=>onOpen(s.objectId!)} aria-label={'Abrir campanha '+s.name}><ArrowRight size={16}/></Button>}</article>)}</div>
   {count>signals.slice(0,8).length&&<p className="hint">Mostrando {Math.min(8,signals.length)} de {count} pontos. A equipe recebe a cobertura e a prioridade por projeto; nenhum contador foi reduzido.</p>}
   {!count&&<p className="hint">Nenhuma mudança material sinalizada nesta coleta. Isso não comprova ausência de risco nem substitui as revisões agendadas.</p>}
   <p className="hint">A sincronização é automática enquanto o executor de dados estiver funcionando. A análise dos agentes segue a rotina local e a cadência do painel; não representa presença online contínua.</p>
  </div>}
 </section>;
}
