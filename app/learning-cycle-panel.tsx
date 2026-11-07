import {campaignCoveragePlan} from '../lib/campaign-learning-coverage.mjs';
'use client';
import {useMemo} from 'react';
import {BrainCircuit,ChevronDown} from 'lucide-react';
import {learningCyclePlan} from '../lib/learning-cycle.mjs';
import './learning-cycle.css';
const agentName:Record<string,string>={traffic:'Lia',creative:'Nina',budget:'Theo',ops:'Cai'};
const verdictLabel:Record<string,string>={support:'apoio',challenge:'contestação',inconclusive:'inconclusivo'};
const plural=(n:number,one:string,many:string)=>`${n} ${n===1?one:many}`;
/** Counts of what each role actually recorded; never a quality or profit score. */
function stepActivity(step:any){
 const a=step.activity||{};
 if(step.role==='ops')return [plural(a.hypotheses||0,'hipótese própria','hipóteses próprias'),plural(a.measured||0,'resultado medido','resultados medidos'),...(a.unverifiable?[plural(a.unverifiable,'comparação sem verificação','comparações sem verificação')]:[])].join(' · ');
 const parts=[plural(a.hypotheses||0,'hipótese própria','hipóteses próprias'),plural(a.critiques||0,'crítica feita','críticas feitas')];
 if(a.evidenceReviews)parts.push(plural(a.evidenceReviews,'revisão de resultado','revisões de resultado'));
 parts.push(a.evidenceWaiting?plural(a.evidenceWaiting,'resultado aguarda revisão','resultados aguardam revisão'):a.critiquesWaiting?plural(a.critiquesWaiting,'hipótese a criticar na próxima etapa','hipóteses a criticar nas próximas etapas'):'sem pendência agora');
 return parts.join(' · ');
}
export default function LearningCyclePanel({state,project}:{state:any;project:string}){
 const cycle=useMemo(()=>learningCyclePlan(state,project),[state,project]),stats=cycle.stats,coverage=useMemo(()=>campaignCoveragePlan(state,project),[state,project]);
 return <section className="learning-cycle" aria-label="Ciclo de aprendizado dos agentes">
  <header><BrainCircuit size={22}/><div><h3>Aprender, conferir e melhorar</h3><p>Cada padrão precisa sobreviver a novos resultados e à revisão de outro agente.</p></div><span>Com sua aprovação</span></header>
  <ol className="learning-steps">{cycle.steps.map((step:any,i:number)=><li key={step.role}><b>{i+1}</b><span>{step.label}<small>{stepActivity(step)}</small></span></li>)}</ol>
  <div className="learning-score"><div><strong>{stats.patterns}</strong><span>padrões em estudo</span></div><div><strong>{stats.advisory}</strong><span>com validação para apoiar sugestões</span></div><div><strong>{stats.needsReview}</strong><span>precisam ser revistos</span></div><div><strong>{stats.agreementRate===null?'N/D':`${Math.round(stats.agreementRate*100)}%`}</strong><span>concordância com você · {stats.comparableChoices} comparações</span></div></div>
  <p className="learning-caption">{stats.measuredApplications||0} aplicações com comparação automática conferida. Dias sem exposição, incidentes e alterações concorrentes podem impedir a comparação. Concordar com você não prova lucro. Resultado favorável exige métricas conciliadas; os testes deste fluxo são observacionais.</p>
  <p className="learning-caption"><strong>Cobertura de revisão:</strong> {coverage.reviewed} de {coverage.eligible} campanhas Meta ativas com gasto já receberam parecer numérico dos quatro agentes na mesma rodada. {coverage.waiting} aguardam essa revisão completa. Cada rodada reserva espaço para as menos revisadas; dados coletados sozinhos não contam como análise.</p>
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
   {cycle.items.map((item:any)=><article key={item.id}><div><strong>{item.topic}</strong><span className={'learning-stage '+(item.advisoryEligible?'is-ready':item.stage==='Revisar padrão'?'is-review':'')}>{item.stage}</span></div><p>{item.next}</p><small>{item.counts.independent} campanhas com resultado conferido · {item.counts.prospective} casos posteriores ao registro · {item.counts.adverse} desfavoráveis</small><ul>{item.reasons.map((reason:string)=><li key={reason}>{reason}</li>)}</ul>{item.author&&<small>Hipótese de {agentName[item.author]}</small>}{item.reviews.length>0&&<p>Revisões: {item.reviews.map((r:any)=>agentName[r.agentId]+' · '+verdictLabel[r.verdict]).join('; ')}</p>}{item.critiques?.length>0&&<div className="learning-critiques"><p>Críticas antes da medição (não mudam o estágio):</p><ul>{item.critiques.map((r:any)=><li key={r.id}><strong>{agentName[r.agentId]} · {verdictLabel[r.verdict]}</strong> {r.reason}</li>)}</ul></div>}</article>)}
  </details>
  <p className="learning-caption">Para apoiar sugestões: cinco campanhas distintas após o registro, em pelo menos três dias, sinais favoráveis em 80% dos casos e dois revisores independentes. Qualquer resultado desfavorável exige revisão. Esses mínimos não garantem acerto nem liberam execução automática.</p>
 </section>;
}
