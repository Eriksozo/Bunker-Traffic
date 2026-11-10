'use client';
import CloudExecutorPanel from './cloud-executor-panel';
import {useMemo,useRef,useState} from 'react';
import {Activity,ArrowRight,ChevronDown,RefreshCw,ShieldCheck} from 'lucide-react';
import {reviewPipeline} from '../lib/review-pipeline.mjs';
import './review-pipeline.css';

const stamp=(value:any)=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'Sem registro';
const duration=(seconds:number|null)=>seconds===null?'N/D':seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}min ${seconds%60}s`;
/** Presentation only: picks the glyph and tint for the status text the plan already produced. */
type Tone='running'|'good'|'bad'|'warn'|'waiting'|'info';
const statusTone=(p:any):Tone=>['Falha na coleta','Coleta expirada'].includes(p.status)?'bad':['Releitura necessária','Conferência pendente','Aguardando sua aprovação'].includes(p.status)||p.blocked?'warn':p.status==='Análise concluída'?'good':p.elapsedSeconds!==null?'running':/^(Na fila|Aguardando|Pausado)/.test(p.status)?'waiting':'info';
const toneClass:Record<Tone,string>={running:'ds-pill--neutral',good:'ds-pill--good',bad:'ds-pill--bad',warn:'ds-pill--warn',waiting:'ds-pill--neutral',info:'ds-pill--neutral'};
const glyphClass:Record<Tone,string>={running:'',good:'ds-glyph--good',bad:'ds-glyph--bad',warn:'ds-glyph--warn',waiting:'ds-glyph--waiting',info:'ds-glyph--info'};
export default function ReviewPipeline({state,project,now,write,saving,onOpen}:{state:any;project:string;now:number;write:(input:any)=>Promise<boolean>;saving:boolean;onOpen:(project:string)=>void}){
 const plan=useMemo(()=>reviewPipeline(state,project||'all',now),[state,project,now]);
 const [notice,setNotice]=useState(''),[noticeOk,setNoticeOk]=useState(false),[busy,setBusy]=useState(false),request=useRef<{key:string;id:string}|null>(null),lock=useRef(false);
 async function queue(ids:string[]){
  if(lock.current||saving||state.paused||!ids.length)return;
  lock.current=true;setBusy(true);setNotice('');
  const key=JSON.stringify([...ids].sort());if(request.current?.key!==key)request.current={key,id:'review-'+crypto.randomUUID()};
  const clientId=request.current.id;
  try{
   const ok=await write({op:'reviewBatch',projectIds:ids,clientId});
   if(ok){request.current=null;setNoticeOk(true);setNotice('Pedido registrado. A fila respeita os trabalhos em andamento e as aprovações pendentes. O progresso aparece aqui após cada etapa confirmada.');}
   else{setNoticeOk(false);setNotice('O pedido não foi confirmado. Confira a fila e a mensagem da central antes de tentar novamente.');}
  }finally{lock.current=false;setBusy(false);}
 }
 const eligible=plan.projects.filter(p=>p.canRequest).map(p=>p.id);
 const blockedReason=!state.paused&&!saving&&!busy&&plan.projects.length>0&&!eligible.length;
 return <div className="rp-view"><section className="rp-hub" aria-label="Central de revisões dos agentes">
  <header className="rp-heading"><div className="rp-heading__text"><span className="ds-eyebrow rp-eyebrow"><Activity size={13} aria-hidden="true"/> Revisões dos agentes</span><h2 className="ds-headline">Acompanhe a análise por aqui.</h2><p className="ds-body">Coleta, pareceres, sugestões e aprovação no mesmo lugar.</p></div><div className="rp-heading__action"><button type="button" className="ds-btn ds-btn--primary rp-primary" aria-busy={busy||undefined} aria-describedby={blockedReason?'rp-primary-reason':undefined} disabled={saving||busy||state.paused||!eligible.length} onClick={()=>void queue(eligible)}>{busy?<span className="ds-spinner" aria-hidden="true"/>:<RefreshCw size={15} aria-hidden="true"/>} {plan.projects.length>1?'Revisar projetos disponíveis':'Revisar agora'}</button>{blockedReason&&<p className="ds-disabled-reason" id="rp-primary-reason">Nenhum projeto pode receber um novo pedido agora. O motivo aparece em cada projeto.</p>}</div></header>
  <div className="ds-kpi-grid rp-summary" role="group" aria-label="Resumo das revisões"><div className="ds-kpi"><span className="ds-kpi__label">Em análise</span><strong className="ds-kpi__value">{plan.counts.active}</strong></div><div className="ds-kpi"><span className="ds-kpi__label">Na fila</span><strong className="ds-kpi__value">{plan.counts.queued}</strong></div><div className={'ds-kpi'+(plan.counts.awaitingApproval>0?' rp-kpi--attention':'')}><span className="ds-kpi__label">{plan.counts.awaitingApproval>0&&<span className="ds-glyph ds-glyph--warn" aria-hidden="true"/>}Aguardando você</span><strong className="ds-kpi__value">{plan.counts.awaitingApproval}</strong></div></div>
  <p className="ds-caption rp-method"><ShieldCheck size={14} aria-hidden="true"/> Os resultados aparecem por projeto, assim que registrados. Um pedido de revisão não altera as campanhas.</p>
  {notice&&<p role="status" className={'ds-banner rp-notice '+(noticeOk?'ds-banner--good':'ds-banner--warn')}>{notice}</p>}
  {state.paused&&<p className="ds-banner ds-banner--neutral rp-notice">O painel está pausado. Retome na Agenda de revisão para liberar novos pedidos.</p>}
  <div className="rp-projects">{plan.projects.map(p=>{const tone=statusTone(p);return <article key={p.id} className="ds-card ds-card--lg rp-project" aria-label={'Revisão de '+p.name}>
   <header className="rp-project__head"><div className="rp-project__id"><span className="ds-eyebrow">Projeto</span><h3 className="ds-title">{p.name}</h3></div><div className="rp-project__state"><p className="rp-status"><span className={'ds-pill rp-status__pill '+toneClass[tone]}>{tone==='running'?<span className="ds-spinner" aria-hidden="true"/>:<span className={'ds-glyph '+glyphClass[tone]} aria-hidden="true"/>} {p.status}</span></p>{p.elapsedSeconds!==null&&<span className="rp-elapsed"><span className="ds-num">{duration(p.elapsedSeconds)}</span> decorridos</span>}</div></header>
   <ol className="rp-steps" aria-label={'Etapas de '+p.name}>{p.stages.map(step=>{const done=step.status==='Concluída',running=step.status==='Em análise';return <li className={'rp-step '+(done?'is-done':running?'is-running':'is-pending')} key={step.id}><span className="rp-step__mark" aria-hidden="true">{done?<span className="ds-glyph ds-glyph--good"/>:running?<span className="ds-spinner"/>:<span className="ds-dot ds-dot--sm ds-dot--neutral"/>}</span><span className="rp-step__text"><strong>{step.name}</strong><small>{step.id==='collection'&&p.elapsedSeconds!==null?`${p.collected}/4 períodos`:done?'Concluída':running?'Em andamento':'Pendente'}</small></span></li>;})}</ol>
   {p.stalled&&<p className="ds-banner ds-banner--warn rp-warning">Sem nova etapa registrada há mais de 5 minutos. A coleta ou o agente pode estar demorando; o resultado ainda não foi confirmado.</p>}
   {p.blocked&&<p className="ds-banner ds-banner--warn rp-warning">A base mudou. Uma nova leitura precisa confirmar o cenário.</p>}
   {p.held&&<p className="ds-empty ds-empty--waiting rp-held">{p.held}</p>}
   <div className="rp-results"><span><strong className="ds-num">{p.suggestions}</strong> sugestões registradas</span><span><strong className="ds-num">{p.waitingOwner}</strong> propostas para aprovar</span>{p.durationSeconds!==null&&<span>Rodada concluída em <strong className="ds-num">{duration(p.durationSeconds)}</strong></span>}</div>
   <footer className="rp-project__foot"><small className="ds-caption">Último registro: <span className="ds-tabular">{stamp(p.lastAt)}</span></small><div className="rp-project__actions"><button type="button" className="ds-btn ds-btn--sm" title={!p.canRequest?(p.held||p.status):undefined} disabled={!p.canRequest||saving||busy} onClick={()=>void queue([p.id])}>Solicitar revisão</button><button type="button" className="ds-btn ds-btn--sm ds-btn--ghost" onClick={()=>onOpen(p.id)}>Ver cards <ArrowRight size={14} aria-hidden="true"/></button></div></footer>
  </article>;})}</div>
  {!plan.projects.length&&<div className="ds-card rp-empty"><p className="ds-empty">Configure um projeto para acompanhar suas revisões.</p></div>}
 </section><CloudExecutorPanel/><details className="rp-details"><summary><span>Como a revisão funciona</span><ChevronDown size={14} aria-hidden="true"/></summary><div className="rp-details__body"><p>A dashboard lê os registros salvos e recebe suas decisões. O executor Cloudflare mantém as revisões e as ações aprovadas na nuvem. O processamento segue a cadência configurada. A conexão da Órbita ainda depende do conector enquanto não houver uma credencial própria na nuvem.</p><p>O tempo exibido é o tempo já decorrido. As etapas mostram apenas trabalho registrado; não representam presença online nem previsão de conclusão. Dados insuficientes bloqueiam recomendações. Orçamento e status continuam exigindo sua aprovação exata.</p></div></details></div>;
}
