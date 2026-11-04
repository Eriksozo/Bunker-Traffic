'use client';
import {useMemo,useRef,useState} from 'react';
import {Activity,ArrowRight,Check,Clock3,Loader2,RefreshCw,ShieldCheck} from 'lucide-react';
import {reviewPipeline} from '../lib/review-pipeline.mjs';
import {Button} from '@/components/ui/button';
import './review-pipeline.css';

const stamp=(value:any)=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'Sem registro';
const duration=(seconds:number|null)=>seconds===null?'N/D':seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}min ${seconds%60}s`;
export default function ReviewPipeline({state,project,now,write,saving,onOpen}:{state:any;project:string;now:number;write:(input:any)=>Promise<boolean>;saving:boolean;onOpen:(project:string)=>void}){
 const plan=useMemo(()=>reviewPipeline(state,project||'all',now),[state,project,now]);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),request=useRef<{key:string;id:string}|null>(null),lock=useRef(false);
 async function queue(ids:string[]){
  if(lock.current||saving||state.paused||!ids.length)return;
  lock.current=true;setBusy(true);setNotice('');
  const key=JSON.stringify([...ids].sort());if(request.current?.key!==key)request.current={key,id:'review-'+crypto.randomUUID()};
  const clientId=request.current.id;
  try{
   const ok=await write({op:'reviewBatch',projectIds:ids,clientId});
   if(ok){request.current=null;setNotice('Pedido registrado. A fila respeita os trabalhos em andamento e as aprovações pendentes. O progresso aparece aqui após cada etapa confirmada.');}
   else setNotice('O pedido não foi confirmado. Confira a fila e a mensagem da central antes de tentar novamente.');
  }finally{lock.current=false;setBusy(false);}
 }
 const eligible=plan.projects.filter(p=>p.canRequest).map(p=>p.id);
 return <section className="rp-hub" aria-label="Central de revisões dos agentes">
  <header className="rp-heading"><div><span className="eyebrow"><Activity size={13}/> REVISÕES DOS AGENTES</span><h2>Acompanhe a análise por aqui.</h2><p>Coleta, pareceres, sugestões e aprovação no mesmo lugar.</p></div><Button className="button primary" disabled={saving||busy||state.paused||!eligible.length} onClick={()=>void queue(eligible)}>{busy?<Loader2 size={15} className="spin"/>:<RefreshCw size={15}/>} {plan.projects.length>1?'Revisar projetos disponíveis':'Revisar agora'}</Button></header>
  <div className="rp-summary"><span><strong>{plan.counts.active}</strong> em análise</span><span><strong>{plan.counts.queued}</strong> na fila</span><span><strong>{plan.counts.awaitingApproval}</strong> aguardando você</span></div>
  <p className="hint rp-method"><ShieldCheck size={14}/> Os resultados aparecem por projeto, assim que registrados. Um pedido de revisão não altera as campanhas.</p>
  {notice&&<p role="status" className="rp-notice">{notice}</p>}
  {state.paused&&<p className="rp-notice">O painel está pausado. Retome na Agenda de revisão para liberar novos pedidos.</p>}
  <div className="rp-projects">{plan.projects.map(p=><article key={p.id} className="panel rp-project" aria-label={'Revisão de '+p.name}>
   <header><div><h3>{p.name}</h3><p className="rp-status">{p.elapsedSeconds!==null?<Loader2 size={14} className="spin"/>:<Clock3 size={14}/>} {p.status}</p></div>{p.elapsedSeconds!==null&&<span className="rp-elapsed">{duration(p.elapsedSeconds)} decorridos</span>}</header>
   <ol className="rp-steps" aria-label={'Etapas de '+p.name}>{p.stages.map(step=><li className={step.status==='Concluída'?'is-done':step.status==='Em análise'?'is-running':''} key={step.id}><span>{step.status==='Concluída'?<Check size={13}/>:step.status==='Em análise'?<Loader2 size={13} className="spin"/>:<span className="rp-dot"/>}</span><strong>{step.name}</strong><small>{step.id==='collection'&&p.elapsedSeconds!==null?`${p.collected}/4 períodos`:step.status==='Concluída'?'Concluída':step.status==='Em análise'?'Em andamento':'Pendente'}</small></li>)}</ol>
   {p.stalled&&<p className="rp-warning">Sem nova etapa registrada há mais de 5 minutos. A coleta ou o agente pode estar demorando; o resultado ainda não foi confirmado.</p>}
   {p.blocked&&<p className="rp-warning">A base mudou. Uma nova leitura precisa confirmar o cenário.</p>}
   {p.held&&<p className="hint rp-held">{p.held}</p>}
   <div className="rp-results"><span>{p.suggestions} sugestões registradas</span><span>{p.waitingOwner} propostas para aprovar</span>{p.durationSeconds!==null&&<span>Rodada concluída em {duration(p.durationSeconds)}</span>}</div>
   <footer><small>Último registro: {stamp(p.lastAt)}</small><div><Button variant="outline" disabled={!p.canRequest||saving||busy} onClick={()=>void queue([p.id])}>Solicitar revisão</Button><Button variant="ghost" onClick={()=>onOpen(p.id)}>Ver cards <ArrowRight size={14}/></Button></div></footer>
  </article>)}</div>
  {!plan.projects.length&&<p className="rp-notice">Configure um projeto para acompanhar suas revisões.</p>}
  <details className="rp-details"><summary>Como a revisão funciona</summary><p>A dashboard lê os registros salvos e recebe suas decisões. O Mac mantém as conexões autenticadas do Malva e da Órbita e executa os agentes na cadência configurada. Ele precisa estar ligado e disponível.</p><p>O tempo exibido é o tempo já decorrido. As etapas mostram apenas trabalho registrado; não representam presença online nem previsão de conclusão. Dados insuficientes bloqueiam recomendações. Orçamento e status continuam exigindo sua aprovação exata.</p></details>
 </section>;
}
