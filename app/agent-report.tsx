'use client';
import {BookOpen,ChevronDown} from 'lucide-react';
import {agentReportView} from '../lib/agent-report-view.mjs';
import './agent-report.css';
const number=(value:any)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:2}):'N/D';
const money=(value:any,currency='BRL')=>typeof value==='number'&&Number.isFinite(value)&&/^[A-Z]{3}$/.test(currency||'')?value.toLocaleString('pt-BR',{style:'currency',currency}):'N/D';
export default function AgentReport({message,state,proposals=[]}:{message:any;state:any;proposals?:any[]}){
 const view=agentReportView(state,message,proposals);
 return <div className="agent-report">
  {view.historical&&<p className="ar-history">Análise anterior · consulte a rodada atual para decidir.</p>}
  {view.plain?<p className="ar-plain">{view.plain}</p>:<><div className="ar-summary"><span>Leitura da equipe</span><strong>{view.summary.decision}</strong><p>{view.summary.reason}</p></div>
   {view.proposals.map((proposal:any)=><section className="ar-proposal" key={proposal.id}><div><strong>{proposal.action}</strong><span>{proposal.status}</span></div><h4>{proposal.name}</h4><p className="ar-account">{proposal.account}</p>{proposal.before?.dailyBudget!==undefined&&proposal.after?.dailyBudget!==undefined&&<p className="ar-change">{money(proposal.before.dailyBudget,proposal.currency)} → {money(proposal.after.dailyBudget,proposal.currency)} / dia</p>}{view.proposals.length>1&&<p>{proposal.reason}</p>}</section>)}
   {view.facts.length>0&&<details className="ar-numbers"><summary>Números que sustentam a análise <ChevronDown size={13}/></summary>{view.facts.map((fact:any)=><div className="ar-fact" key={fact.key}><strong>{fact.name}</strong><small>{fact.account}</small><div className="ar-table-scroll"><table><thead><tr><th>Período</th><th>Gasto</th><th>Front</th><th>ROAS</th></tr></thead><tbody>{fact.windows.map((window:any)=><tr key={window.period}><th scope="row">{window.period==='today'?'Hoje · parcial':'3 dias'}</th><td>{money(window.metrics?.spend)}</td><td>{number(window.metrics?.frontOrders)}</td><td>{window.metrics?.roas==null?'N/D':number(window.metrics.roas)+'x'}</td></tr>)}</tbody></table></div></div>)}</details>}
   <p className="ar-next"><strong>Próximo passo</strong>{view.historical?'Use a rodada atual. Este registro fica disponível para consulta.':view.summary.nextStep}</p></>}
  <details className="ar-technical"><summary><BookOpen size={13}/> Detalhes técnicos e texto original <ChevronDown size={13}/></summary><pre>{message.text||'Sem texto adicional.'}</pre></details>
 </div>;
}
