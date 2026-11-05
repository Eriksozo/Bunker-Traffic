'use client';
import {useMemo} from 'react';
import {BrainCircuit,ChevronDown} from 'lucide-react';
import {learningCyclePlan} from '../lib/learning-cycle.mjs';
import './learning-cycle.css';
export default function LearningCyclePanel({state,project}:{state:any;project:string}){
 const cycle=useMemo(()=>learningCyclePlan(state,project),[state,project]),stats=cycle.stats;
 return <section className="learning-cycle" aria-label="Ciclo de aprendizado dos agentes">
  <header><BrainCircuit size={22}/><div><h3>Aprender, conferir e melhorar</h3><p>Cada padrão precisa sobreviver a novos resultados e à revisão de outro agente.</p></div><span>Com sua aprovação</span></header>
  <ol className="learning-steps">{cycle.steps.map((step:any,i:number)=><li key={step.role}><b>{i+1}</b><span>{step.label}</span></li>)}</ol>
  <div className="learning-score"><div><strong>{stats.patterns}</strong><span>padrões em estudo</span></div><div><strong>{stats.advisory}</strong><span>com validação para apoiar sugestões</span></div><div><strong>{stats.needsReview}</strong><span>precisam ser revistos</span></div><div><strong>{stats.agreementRate===null?'N/D':`${Math.round(stats.agreementRate*100)}%`}</strong><span>concordância com você · {stats.comparableChoices} comparações</span></div></div>
  <p className="learning-caption">{stats.measuredApplications||0} aplicações com comparação automática conferida. Dias sem exposição, incidentes e alterações concorrentes podem impedir a comparação. Concordar com você não prova lucro. Resultado favorável exige métricas conciliadas; os testes deste fluxo são observacionais.</p>
  <div className="agent-development" aria-label="Aprendizado individual">{cycle.development.agents.map((agent:any)=><article key={agent.id}>
   <div><strong>{agent.name}</strong><span>{agent.label}</span></div>
   <p>{agent.focus}</p>
   <small>{agent.grounded} reflexões com números conferidos · {agent.peerChecks} contrapontos registrados · {agent.ownerCorrections||0} correções do dono · {agent.measuredTeamCases||0} casos medidos da equipe</small>
   <details><summary>Próximo aprendizado <ChevronDown size={13}/></summary><p>{agent.next}</p>
    {!agent.episodes&&<p>Ainda não há reflexão registrada no recorte recente. Nenhum acerto foi presumido.</p>}
    {agent.recall.map((e:any)=><div className="agent-episode" key={e.messageId}><small>{new Date(e.createdAt).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista'})} · hipótese</small><p>{e.reflection.lesson}</p><p>Falta conferir: {e.reflection.uncertainty}</p></div>)}
    {agent.challengesReceived>0&&<p>{agent.challengesReceived} contraponto(s) recebido(s) para revisar.</p>}
   </details>
  </article>)}</div>
  <p className="learning-caption">Memória separada por agente e projeto. Os números acima medem registros e verificações, não taxa de acerto financeiro.</p>
  <details className="learning-patterns"><summary>Ver padrões e o que falta validar <span>{cycle.items.length}</span><ChevronDown size={15}/></summary>
   {!cycle.items.length&&<p>Ainda não há padrão registrado neste projeto. Nenhum acerto foi presumido.</p>}
   {cycle.items.map((item:any)=><article key={item.id}><div><strong>{item.topic}</strong><span className={'learning-stage '+(item.advisoryEligible?'is-ready':item.stage==='Revisar padrão'?'is-review':'')}>{item.stage}</span></div><p>{item.next}</p><small>{item.counts.independent} campanhas com resultado conferido · {item.counts.prospective} casos posteriores ao registro · {item.counts.adverse} desfavoráveis</small><ul>{item.reasons.map((reason:string)=><li key={reason}>{reason}</li>)}</ul>{item.reviews.length>0&&<p>Revisões: {item.reviews.map((r:any)=>({traffic:'Lia',budget:'Theo',creative:'Nina'}[r.agentId as 'traffic'])+' · '+({support:'apoio',challenge:'contestação',inconclusive:'inconclusivo'}[r.verdict as 'support'])).join('; ')}</p>}</article>)}
  </details>
  <p className="learning-caption">Para apoiar sugestões: cinco campanhas distintas após o registro, em pelo menos três dias, sinais favoráveis em 80% dos casos e dois revisores independentes. Qualquer resultado desfavorável exige revisão. Esses mínimos não garantem acerto nem liberam execução automática.</p>
 </section>;
}
