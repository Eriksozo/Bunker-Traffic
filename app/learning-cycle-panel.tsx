import {campaignCoveragePlan} from '../lib/campaign-learning-coverage.mjs';
'use client';
import {useMemo} from 'react';
import {BrainCircuit,ChevronDown,ShieldCheck} from 'lucide-react';
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
  <header className="lc-head"><span className="ds-badge lc-head__badge" aria-hidden="true"><BrainCircuit size={16}/></span><div className="lc-head__text"><span className="ds-eyebrow">Ciclo de aprendizado</span><h3 className="ds-title">Aprender, conferir e melhorar</h3><p className="ds-body">Cada padrão precisa sobreviver a novos resultados e à revisão de outro agente.</p></div><span className="ds-pill ds-pill--tag lc-head__pill"><ShieldCheck size={12} aria-hidden="true"/>Com sua aprovação</span></header>
  <ol className="learning-steps">{cycle.steps.map((step:any,i:number)=><li key={step.role}><b aria-hidden="true">{i+1}</b><span><strong>{step.label}</strong><small>{stepActivity(step)}</small></span></li>)}</ol>
  <div className="learning-score ds-kpi-grid" role="group" aria-label="Situação dos padrões"><div className="ds-kpi ds-kpi--tile"><span className="ds-kpi__label">Padrões em estudo</span><strong className="ds-kpi__value">{stats.patterns}</strong></div><div className="ds-kpi ds-kpi--tile"><span className="ds-kpi__label">{stats.advisory>0&&<span className="ds-glyph ds-glyph--good" aria-hidden="true"/>}Com validação para apoiar sugestões</span><strong className="ds-kpi__value">{stats.advisory}</strong></div><div className="ds-kpi ds-kpi--tile"><span className="ds-kpi__label">{stats.needsReview>0&&<span className="ds-glyph ds-glyph--warn" aria-hidden="true"/>}Precisam ser revistos</span><strong className="ds-kpi__value">{stats.needsReview}</strong></div><div className="ds-kpi ds-kpi--tile"><span className="ds-kpi__label">Concordância com você</span><strong className="ds-kpi__value">{stats.agreementRate===null?'N/D':`${Math.round(stats.agreementRate*100)}%`}</strong><span className="ds-kpi__foot"><span><span className="ds-tabular">{stats.comparableChoices}</span> comparações</span></span></div></div>
  <p className="learning-caption ds-caption"><span className="ds-num lc-inline-num">{stats.measuredApplications||0}</span> aplicações com comparação automática conferida. Dias sem exposição, incidentes e alterações concorrentes podem impedir a comparação. Concordar com você não prova lucro. Resultado favorável exige métricas conciliadas; os testes deste fluxo são observacionais.</p>
  <div className="ds-tile lc-coverage"><div className="lc-coverage__head"><span className="ds-eyebrow">Cobertura de revisão</span><span className="lc-coverage__ratio" aria-hidden="true"><span className="ds-num">{coverage.reviewed}</span> de <span className="ds-num">{coverage.eligible}</span></span></div><span className="ds-meter ds-meter--neutral" style={{['--ds-meter-value' as any]:coverage.eligible>0?Math.min(100,Math.round(coverage.reviewed/coverage.eligible*100)):0}} aria-hidden="true"/><p className="learning-caption ds-caption">{coverage.reviewed} de {coverage.eligible} campanhas Meta ativas com gasto já receberam parecer numérico dos quatro agentes na mesma rodada. {coverage.waiting} aguardam essa revisão completa. Cada rodada reserva espaço para as menos revisadas; dados coletados sozinhos não contam como análise.</p></div>
  <div className="lc-section-head"><span className="ds-eyebrow">Aprendizado individual</span></div><div className="agent-development" aria-label="Aprendizado individual">{cycle.development.agents.map((agent:any)=><article key={agent.id}>
   <div className="lc-agent__id"><span className="ds-monogram ds-monogram--circle" aria-hidden="true">{String(agent.name||'?').slice(0,1)}</span><span className="lc-agent__name"><strong>{agent.name}</strong><span>{agent.label}</span></span></div>
   <p>{agent.focus}</p>
   <small className="lc-agent__counts">{agent.grounded} reflexões com números conferidos · {agent.peerChecks} contrapontos registrados · {agent.ownerCorrections||0} correções do dono · {agent.measuredTeamCases||0} casos medidos da equipe</small>
   <details><summary><span>Próximo aprendizado</span><ChevronDown size={13} aria-hidden="true"/></summary><p>{agent.next}</p>
    {!agent.episodes&&<p className="ds-empty lc-empty">Ainda não há reflexão registrada no recorte recente. Nenhum acerto foi presumido.</p>}
    {agent.recall.map((e:any)=><div className="agent-episode" key={e.messageId}><small className="agent-episode__date">{new Date(e.createdAt).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista'})} · hipótese</small><p>{e.reflection.lesson}</p><p>Falta conferir: {e.reflection.uncertainty}</p></div>)}
    {agent.challengesReceived>0&&<p>{agent.challengesReceived} contraponto(s) recebido(s) para revisar.</p>}
   </details>
  </article>)}</div>
  <p className="learning-caption ds-caption">Memória separada por agente e projeto. Os números acima medem registros e verificações, não taxa de acerto financeiro.</p>
  <details className="learning-patterns"><summary><span>Ver padrões e o que falta validar</span> <span className="ds-pill">{cycle.items.length}</span><ChevronDown size={15} aria-hidden="true"/></summary>
   {!cycle.items.length&&<p className="ds-empty lc-empty">Ainda não há padrão registrado neste projeto. Nenhum acerto foi presumido.</p>}
   {cycle.items.map((item:any)=><article key={item.id}><div className="lc-pattern__head"><strong>{item.topic}</strong><span className={'ds-pill learning-stage '+(item.advisoryEligible?'ds-pill--good is-ready':item.stage==='Revisar padrão'?'ds-pill--warn is-review':'ds-pill--neutral')}><span className={'ds-glyph '+(item.advisoryEligible?'ds-glyph--good':item.stage==='Revisar padrão'?'ds-glyph--warn':'ds-glyph--waiting')} aria-hidden="true"/>{item.stage}</span></div><p>{item.next}</p><small>{item.counts.independent} campanhas com resultado conferido · {item.counts.prospective} casos posteriores ao registro · {item.counts.adverse} desfavoráveis</small><ul>{item.reasons.map((reason:string)=><li key={reason}>{reason}</li>)}</ul>{item.author&&<small>Hipótese de {agentName[item.author]}</small>}{item.reviews.length>0&&<p>Revisões: {item.reviews.map((r:any)=>agentName[r.agentId]+' · '+verdictLabel[r.verdict]).join('; ')}</p>}{item.critiques?.length>0&&<div className="learning-critiques"><p>Críticas antes da medição (não mudam o estágio):</p><ul>{item.critiques.map((r:any)=><li key={r.id}><strong>{agentName[r.agentId]} · {verdictLabel[r.verdict]}</strong> {r.reason}</li>)}</ul></div>}</article>)}
  </details>
  <p className="learning-caption ds-caption">Para apoiar sugestões: cinco campanhas distintas após o registro, em pelo menos três dias, sinais favoráveis em 80% dos casos e dois revisores independentes. Qualquer resultado desfavorável exige revisão. Esses mínimos não garantem acerto nem liberam execução automática.</p>
 </section>;
}
