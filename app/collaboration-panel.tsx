'use client';
import {systemRoundTitle} from '../lib/system-round-review.mjs';
import LearningCyclePanel from './learning-cycle-panel';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,BookOpen,Check,CheckCheck,ChevronDown,Clock3,FileSearch,GitBranch,MessageSquare,RefreshCw,ShieldCheck,TriangleAlert,Users,X} from 'lucide-react';
import {officeAgents} from '../lib/office.mjs';
import {periodNames,sum} from '../lib/analysis.mjs';
import {isWarmupCampaign,isWarmupTarget} from '../lib/campaign-scope.mjs';
import './collaboration-panel.css';
import './proposal-card.css';
import DecisionCards from './decision-cards';
import AgentReport from './agent-report';
import {agentReportView} from '../lib/agent-report-view.mjs';

type Props={state:any;project:string;write:(input:any)=>Promise<boolean>;saving:boolean;liveItems?:any[];presentationCards?:any[]};
type ReviewChoice='approve'|'reject'|'revise';
const agents=officeAgents as readonly any[];
const array=(value:any):any[]=>Array.isArray(value)?value:[];
const date=(value:any)=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'N/D';};
const shortDate=(value:any)=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleDateString('pt-BR',{timeZone:'America/Boa_Vista'}):'N/D';};
const finite=(value:any):value is number=>typeof value==='number'&&Number.isFinite(value);
const money=(value:any,currency?:string)=>{if(!finite(value))return 'N/D';if(!currency||!/^[A-Z]{3}$/.test(currency))return `${value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} · moeda N/D`;try{return value.toLocaleString('pt-BR',{style:'currency',currency});}catch{return `${value.toLocaleString('pt-BR')} ${currency}`;}};
const numeric=(value:any)=>finite(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:2}):'N/D';
const levelName=(value:string)=>({campaign:'Campanha',adset:'Conjunto',ad:'Anúncio',account:'Conta'}[value]||value||'Objeto');
const statusName=(value:any)=>({ACTIVE:'Ativo',PAUSED:'Pausado',ARCHIVED:'Arquivado',DELETED:'Excluído'}[String(value)]||String(value||'N/D'));
const tone=(status:string)=>/Conclu|Aprovada|Corroborado|Aplicada e conferida/.test(status)?'good':/Recus|Falh|Cancel|Invalidado|Expirada/.test(status)?'bad':/análise|revisão|aprovação|Pendente|Hipótese|fila|execução|Enviada|Conferência|executor/i.test(status)?'wait':'neutral';
const agent=(id:string)=>agents.find(a=>a.id===id);
const roundName=(round:any)=>`Rodada de ${date(round.createdAt)}`;
const textOf=(value:any)=>typeof value==='string'?value:'';
const isActivation=(payload:any)=>payload?.action==='status'&&payload.after?.status==='ACTIVE';
const warmupProposal=(state:any,proposal:any)=>{const p=proposal.payload||{};return p.level==='campaign'&&isWarmupCampaign(p.objectName)||isWarmupTarget(state,proposal.project,p.level,{adAccountId:p.adAccountId,externalId:p.objectId});};
function validActivationBudget(payload:any){
 const b=payload?.activationBudget;
 const daily=finite(b?.dailyBudget)&&b.dailyBudget>0,total=finite(b?.lifetimeBudget)&&b.lifetimeBudget>0;
 const valuesValid=!!b&&[b.dailyBudget,b.lifetimeBudget].every(value=>value===null||finite(value)&&value>=0&&value<=1e9);
 const ownerMatchesTarget=!!b&&(payload.level==='campaign'?b.level==='campaign'&&b.externalId===payload.objectId:payload.level==='adset'?b.level==='campaign'||b.level==='adset'&&b.externalId===payload.objectId:payload.level==='ad');
 return valuesValid&&ownerMatchesTarget&&((b.budgetOwner==='CBO'&&b.level==='campaign')||(b.budgetOwner==='ABO'&&b.level==='adset'))&&typeof b.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id)&&typeof b.externalId==='string'&&!!b.externalId&&b.adAccountId===payload.adAccountId&&b.provider===payload.provider&&b.currency===payload.currency&&/^[A-Z]{3}$/.test(b.currency)&&typeof b.status==='string'&&!!b.status&&daily!==total;
}
function activationBudgetObservation(proposal:any,observation:any,after=false){
 const p=proposal.payload||{},b=p.activationBudget,o=observation?.budgetOwner,r=o?.row;
 if(!validActivationBudget(p)||!o||o.source!=='Malva MCP'||o.complete!==true||o.projectId!==proposal.project||o.level!==b.level||r?.id!==b.id||r.externalId!==b.externalId||r.adAccountId!==b.adAccountId||r.provider!==b.provider||r.budgetCurrency!==b.currency)return null;
 const status=after&&b.level===p.level&&b.externalId===p.objectId?p.after.status:b.status;
 if((r.dailyBudget??null)!==b.dailyBudget||(r.lifetimeBudget??null)!==b.lifetimeBudget||r.status!==status)return null;
 return o;
}
function observedValue(row:any,statusOnly=false){return statusOnly?statusName(row?.status):money(finite(row?.lifetimeBudget)&&row.lifetimeBudget>0?row.lifetimeBudget:row?.dailyBudget,row?.budgetCurrency);}
function observedUnit(row:any,statusOnly=false){return statusOnly?'':finite(row?.lifetimeBudget)&&row.lifetimeBudget>0?' no total (vitalício)':' por dia';}
const unique=(items:any[])=>{const found=new Set();return items.filter(item=>item?.id&&!found.has(item.id)&&found.add(item.id));};
function messageExcerpt(text:string,limit=400){if(text.length<=limit)return text;const fragment=text.slice(0,limit),boundary=fragment.search(/\s+\S*$/);return text.slice(0,boundary>limit/2?boundary:limit).trimEnd()+'…';}

function Badge({status,children}:{status:string;children?:React.ReactNode}){return <span className={'cp-badge cp-'+tone(status)}>{children||status}</span>;}
function Empty({icon:Icon,title,text}:{icon:any;title:string;text:string}){return <div className="cp-empty"><Icon size={25}/><strong>{title}</strong><p>{text}</p></div>;}
function Person({id,small=false}:{id:string;small?:boolean}){const a=agent(id);return <span className={'cp-person'+(small?' cp-person-small':'')} style={{'--cp-person':a?.color||'#a5b4aa'} as React.CSSProperties}><b>{a?.name?.slice(0,1)||'·'}</b><span><strong>{a?.name||'Registro da rodada'}</strong>{!small&&<small>{a?.role||'Origem registrada no histórico'}</small>}</span></span>;}

function SourceCut({cuts}:{cuts:any[]}) {
 if(!cuts.length)return <p className="cp-muted">A fonte desta rodada ainda não foi registrada.</p>;
 return <div className="cp-source-grid">{cuts.map((cut:any,index:number)=><div className="cp-source" key={`${cut.period}:${cut.level}:${index}`}><span>{periodNames[cut.period]||cut.period||'Período N/D'}{cut.period==='today'?' · parcial':''}<small>{levelName(cut.level)}</small></span><p>{shortDate(cut.from)} — {shortDate(cut.to)}</p><small>Limites: início incluído, fim excluído.</small><small>Consulta {date(cut.fetchedAt)} · {cut.timezone||'Fuso N/D'}</small><small>{cut.source||'Fonte N/D'} · {numeric(cut.rowCount)} objetos</small>{cut.lastSyncAt&&<small>Sincronização {date(cut.lastSyncAt)}</small>}</div>)}</div>;
}

function Evidence({refs,state,project}:{refs:any[];state:any;project:string}) {
 if(!refs.length)return <p className="cp-muted">Sem referência de evidência registrada.</p>;
 return <div className="cp-evidence-list">{refs.map((ref:any,index:number)=>{
  const snapshot=array(state.snapshots).find(s=>s.projectId===project&&s.period===ref.period&&s.level===ref.level&&s.fetchedAt===ref.fetchedAt);
  if(ref.empty===true){
   const confirmed=snapshot?.source==='Malva MCP'&&snapshot.complete===true&&Array.isArray(snapshot.rows)&&snapshot.rows.length===0;
   return <div className="cp-evidence" key={`empty:${ref.period}:${ref.level}:${index}`}><div><strong>{periodNames[ref.period]||ref.period||'Período N/D'} · {levelName(ref.level)}</strong><small>Consulta {date(ref.fetchedAt)}</small></div><small className="cp-evidence-note">{confirmed?'Malva MCP · Fonte vazia: consulta completa, sem linhas no recorte deste projeto.':'Referência de leitura vazia preservada. A fonte completa não está no buffer atual.'}</small></div>;
  }
  const row=array(snapshot?.rows).find(r=>r.externalId===ref.externalId&&r.adAccountId===ref.adAccountId);
  const metrics=row?sum([row]):null;
  return <div className="cp-evidence" key={`${ref.externalId}:${ref.period}:${index}`}><div><strong>{periodNames[ref.period]||ref.period||'Período N/D'} · {levelName(ref.level)}</strong><span className="cp-id">Objeto {ref.externalId||'N/D'} · conta {ref.adAccountId||'N/D'}</span><small>Consulta {date(ref.fetchedAt)}</small></div>{metrics?<dl><div><dt>Investido</dt><dd>{money(metrics.spend,'BRL')}</dd></div><div><dt>Front</dt><dd>{numeric(metrics.frontOrders)}</dd></div><div><dt>ROAS Malva</dt><dd>{finite(metrics.roas)?numeric(metrics.roas)+'x':'N/D'}</dd></div></dl>:<small className="cp-evidence-note">Referência preservada. Os valores desta coleta não estão no buffer atual.</small>}</div>;
 })}</div>;
}

function executionView(proposal:any,state:any,now:number) {
 const associated=(execution:any)=>execution?.proposalId===proposal.id&&execution.proposalVersion===proposal.version&&execution.proposalSignature===proposal.signature;
 const stored=array(state.executions).filter(associated).sort((a,b)=>Date.parse(b.claimedAt)-Date.parse(a.claimedAt));
 const execution=associated(proposal.execution)?{...stored.find(item=>item.id===proposal.execution.id),...proposal.execution}:stored[0];
 if(!execution)return null;
 const p=proposal.payload||{},readback=execution.readback,row=readback?.row;
 const identity=readback?.projectId===proposal.project&&readback.level===p.level&&row?.externalId===p.objectId&&row.adAccountId===p.adAccountId&&row.provider===p.provider&&row.budgetCurrency===p.currency;
 const value=identity&&(p.action==='budget'?finite(row.dailyBudget)&&row.dailyBudget===p.after?.dailyBudget:row.status===p.after?.status);
 const sameInternalId=typeof execution.preflight?.row?.id==='string'&&!!execution.preflight.row.id&&row?.id===execution.preflight.row.id;
 const activationOwner=isActivation(p)?activationBudgetObservation(proposal,readback,true):null;
 const activationOwnerConfirmed=!isActivation(p)||!!activationOwner&&Number.isFinite(Date.parse(activationOwner.fetchedAt))&&Date.parse(activationOwner.fetchedAt)>=Date.parse(execution.submittedAt);
 const confirmed=proposal.status==='Aprovada'&&execution.status==='Confirmada'&&value&&sameInternalId&&activationOwnerConfirmed&&readback.source==='Malva MCP'&&readback.complete===true&&[execution.submittedAt,execution.confirmedAt,proposal.appliedAt,proposal.executionConfirmedAt,readback.fetchedAt].every(at=>at&&Number.isFinite(Date.parse(at)));
 const leaseExpired=['Reservada','Preparada'].includes(execution.status)&&(!Number.isFinite(Date.parse(execution.leaseUntil))||Date.parse(execution.leaseUntil)<=now);
 const label=confirmed?'Aplicada e conferida':execution.status==='Confirmada'?'Conferência pendente':leaseExpired?'Reserva expirada':({Reservada:'Em execução',Preparada:'Em execução',Enviada:'Envio registrado','Verificação necessária':'Conferência pendente',Falhou:'Falhou'}[String(execution.status)]||'Execução registrada');
 return {execution,readback,row,identity,confirmed,leaseExpired,label};
}

function ActivationBudget({payload}:{payload:any}){
 if(!isActivation(payload))return null;
 if(!validActivationBudget(payload))return <div className="cp-activation-budget cp-activation-missing" role="note"><strong>Esta ativação precisa de uma nova proposta</strong><p>O orçamento diário ou vitalício e seu proprietário não estão vinculados a esta versão. Peça a revisão antes de aprovar a ativação.</p></div>;
 const b=payload.activationBudget,daily=finite(b.dailyBudget)&&b.dailyBudget>0;
 return <section className="cp-activation-budget" aria-label="Orçamento vinculado à ativação"><header><ShieldCheck size={15}/><strong>Orçamento vinculado à ativação</strong></header><div className="cp-activation-amount"><strong>{money(daily?b.dailyBudget:b.lifetimeBudget,b.currency)}<small>{daily?' por dia':' no total (vitalício)'}</small></strong><span>{levelName(b.level)} · {b.budgetOwner}</span></div><p>A ativação fica vinculada a estes valores. O agente confere o orçamento antes do envio; uma divergência exige nova aprovação.</p><div className="cp-activation-owner"><span>Proprietário do orçamento: {levelName(b.level).toLowerCase()} · {statusName(b.status)}</span><span className="cp-id">ID na plataforma {b.externalId} · conta {b.adAccountId}</span><span className="cp-id">ID Malva {b.id} · moeda nativa {b.currency}</span></div></section>;
}

function ExecutionTrace({proposal,view}:{proposal:any;view:ReturnType<typeof executionView>}) {
 if(!view)return null;
 const {execution:e,readback,row,identity,confirmed,leaseExpired,label}=view,p=proposal.payload||{};
 const preflight=e.preflight,preRow=preflight?.row;
 const preIdentity=preflight?.projectId===proposal.project&&preflight.level===p.level&&preRow?.externalId===p.objectId&&preRow.adAccountId===p.adAccountId&&preRow.provider===p.provider&&preRow.budgetCurrency===p.currency;
 const activating=isActivation(p),statusOnly=p.action==='status'&&!activating;
 const preBudget=activating?activationBudgetObservation(proposal,preflight):preflight,afterBudget=activating?activationBudgetObservation(proposal,readback,true):readback;
 const finalValueRow=afterBudget?.row,preValueRow=preBudget?.row;
 const finalLabel=statusOnly?'Status':finite(finalValueRow?.lifetimeBudget)&&finalValueRow.lifetimeBudget>0?'Orçamento total':'Diário';
 const stages=[{title:'Execução local reservada',at:e.claimedAt},{title:'Objeto conferido antes do envio',at:e.preparedAt},{title:'Despacho reservado para a plataforma',at:e.submittedAt},{title:confirmed?'Aplicada e conferida':'Conferência registrada',at:e.confirmedAt},{title:'Falha registrada',at:e.failedAt}].filter(stage=>stage.at);
 return <section className={'cp-execution'+(confirmed?' is-confirmed':'')} aria-label="Acompanhamento da execução local">
  <header><span><ShieldCheck size={16}/><strong>Execução na plataforma</strong></span><Badge status={label}/></header>
  {confirmed?<p>O orçamento ou status do objeto foi relido e corresponde à alteração autorizada. Isso não comprova entrega dos anúncios.</p>:leaseExpired?<p>A reserva terminou antes do envio. O agente poderá assumir uma nova tentativa após conferir a aprovação e reler o objeto.</p>:e.status==='Enviada'||e.status==='Verificação necessária'?<p>O despacho foi reservado antes da chamada externa. Esse registro não comprova recebimento ou aplicação pela plataforma; falta reler o objeto.</p>:e.status==='Falhou'?<p>A execução registrou uma falha. A aplicação não está confirmada.</p>:<p>Um executor na nuvem conectado assumiu esta alteração. A aprovação permanece separada da aplicação conferida.</p>}
  {e.reason&&<p className="cp-execution-reason">{e.reason}</p>}
  {identity&&afterBudget&&<div className="cp-execution-result"><div><small>{finalLabel} {confirmed?'confirmado na plataforma':'observado na conferência'}</small><strong>{observedValue(finalValueRow,statusOnly)}</strong><span>{statusName(row.status)}{!statusOnly&&` · ${finalValueRow?.budgetCurrency||'Moeda N/D'}`}</span>{activating&&<small>Proprietário: {levelName(afterBudget.level)} · {p.activationBudget?.budgetOwner} · ID {finalValueRow?.externalId}</small>}</div><div><small>{afterBudget.source||'Fonte N/D'}</small><span>{date(afterBudget.fetchedAt)}</span>{!confirmed&&p.action==='budget'&&row.dailyBudget!==p.after?.dailyBudget&&<small className="cp-execution-mismatch">Valor observado diferente do autorizado.</small>}</div></div>}
  {identity&&activating&&!afterBudget&&<p className="cp-execution-reason">O status do objeto foi observado, mas falta conferir o orçamento proprietário desta ativação. A aplicação continua pendente.</p>}
  {readback&&!identity&&<p className="cp-execution-reason">A leitura recebida não identifica o mesmo objeto, conta, moeda e projeto desta proposta. A conferência continua pendente.</p>}
  <ol className="cp-execution-timeline">{stages.map((stage,index)=><li key={stage.title}><i className={confirmed&&index===stages.length-1?'is-confirmed':''}/><span><strong>{stage.title}</strong><small>{date(stage.at)}</small></span></li>)}</ol>
  <details className="cp-detail"><summary><FileSearch size={14}/> Conferências do objeto <ChevronDown size={14}/></summary><div className="cp-execution-checks">{preIdentity&&preBudget?<div><strong>Antes do envio</strong><p>{observedValue(preValueRow,statusOnly)}{observedUnit(preValueRow,statusOnly)}{!statusOnly&&` · ${statusName(preRow.status)}`}</p><small>{preBudget.source||'Fonte N/D'} · {date(preBudget.fetchedAt)}</small></div>:<p className="cp-muted">Leitura anterior ao envio ainda não registrada para este objeto e seu orçamento.</p>}{identity&&afterBudget?<div><strong>Depois do envio</strong><p>{observedValue(finalValueRow,statusOnly)}{observedUnit(finalValueRow,statusOnly)}{!statusOnly&&` · ${statusName(row.status)}`}</p><small>{afterBudget.source||'Fonte N/D'} · {date(afterBudget.fetchedAt)}</small></div>:<p className="cp-muted">Leitura final do objeto e seu orçamento ainda não confirmada.</p>}<span className="cp-id">Objeto {p.objectId} · conta {p.adAccountId} · versão aprovada {proposal.version}</span></div></details>
 </section>;
}

export function ProposalCard({proposal,messages,state,project,saving,onReview,draft,setDraft,choice,setChoice,now}:{proposal:any;messages:any[];state:any;project:string;saving:boolean;onReview:(proposal:any,decision:ReviewChoice,comment:string)=>Promise<void>;draft:string;setDraft:(text:string)=>void;choice:ReviewChoice|null;setChoice:(choice:ReviewChoice|null)=>void;now:number}) {
 const p=proposal.payload||{},before=p.before||{},after=p.after||{},currency=p.currency;
 const budget=p.action==='budget',change=budget&&finite(before.dailyBudget)&&before.dailyBudget>0&&finite(after.dailyBudget)?(after.dailyBudget/before.dailyBudget-1)*100:null;
 const expired=Number.isFinite(Date.parse(proposal.expiresAt))&&Date.parse(proposal.expiresAt)<=now;
 const archived=proposal._archived===true,warmup=warmupProposal(state,proposal),pending=proposal.status==='Aguardando aprovação'&&!expired&&!archived&&!warmup;
 const execution=executionView(proposal,state,now);
 const displayStatus=execution?.label||(warmup?'Aquecimento · fora da otimização':expired&&proposal.status==='Aguardando aprovação'?'Expirada':proposal.status||'Status N/D');
 const opinions=array(p.opinionRefs).map(id=>messages.find(m=>m.id===id)).filter(Boolean);
 const reviews=array(proposal.reviews);
 const conversion=p.conversion||proposal.conversion;
 const validConversion=budget&&conversion&&finite(conversion.rate)&&conversion.rate>0&&conversion.source&&conversion.at;
 const canSend=pending&&!saving&&!!proposal.signature;
 const canApprove=canSend&&!state.paused&&(!isActivation(p)||validActivationBudget(p));
 const unavailable=archived?'Rodada arquivada para consulta. Uma nova decisão precisa de uma rodada atual.':execution?.confirmed?'Alteração aplicada e conferida na plataforma.':execution?'Acompanhe o registro da execução e da conferência.':!pending?expired?'O prazo desta proposta terminou. Peça uma nova revisão.':proposal.status==='Em revisão'?'A equipe ainda está consolidando os pareceres.':proposal.status==='Aprovada'?'Autorização registrada. Aguardando um executor na nuvem conectado para executar esta alteração exata.':proposal.status==='Revisão solicitada'?'Revisão solicitada. A próxima versão terá uma nova conferência.':'Esta versão está encerrada.':!proposal.signature?'Esta versão ainda não tem identificação suficiente para aprovação.':'';
 const actionTitle=budget?change===null?'Ajustar orçamento diário':change<0?`Reduzir orçamento em ${numeric(Math.abs(change))}%`:change>0?`Aumentar orçamento em ${numeric(change)}%`:'Manter orçamento diário':after.status==='PAUSED'?`Pausar ${levelName(p.level).toLowerCase()}`:after.status==='ACTIVE'?`Ativar ${levelName(p.level).toLowerCase()}`:'Alterar status';
 const reason=p.reason||'Motivo ainda não registrado.',risks=array(p.risks);
 return <article className="cp-proposal cp-proposal-readable" aria-label={`Proposta: ${p.title||p.objectName||'Sem título'}`}>
  <header className="cp-proposal-head"><div><span className="cp-overline">{levelName(p.level)} · versão {proposal.version||'N/D'}</span><h3>{actionTitle}</h3><p>{p.accountName||'Conta sem nomenclatura registrada'}</p></div><Badge status={displayStatus}/></header>
  <div className="cp-proposal-main">
   <p className="cp-campaign-name" title={p.objectName}>{p.objectName||'Objeto sem nomenclatura registrada'}</p>
   <section className="cp-budget-summary" aria-label={budget?'Valores exatos da proposta':'Alteração de status proposta'}>
    <div><small>{budget?'Antes · diário':'Status anterior'}</small><strong>{budget?money(before.dailyBudget,currency):statusName(before.status)}</strong></div><ArrowRight size={19}/><div className="cp-proposed-value"><small>{budget?'Proposto · diário':'Status proposto'}</small><strong>{budget?money(after.dailyBudget,currency):statusName(after.status)}</strong></div>
   </section>
   {budget&&<p className="cp-budget-unit">{currency||'Moeda não informada'} · orçamento diário{change!==null&&<span className={'cp-delta'+(change>0?' positive':'')}>{change>0?'+':''}{change.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span>}</p>}
   {validConversion&&currency!=='BRL'&&<p className="cp-budget-equivalent">≈ {money(before.dailyBudget*conversion.rate,'BRL')} → {money(after.dailyBudget*conversion.rate,'BRL')} / dia</p>}
   <section className="cp-reason-block"><h4>Motivo do ajuste</h4>{reason.length>320?<details className="cp-reason-expand"><summary><span>{messageExcerpt(reason,260)}</span><span className="cp-read-more">Ler análise completa <ChevronDown size={13}/></span></summary><p>{reason}</p></details>:<p>{reason}</p>}</section>
  </div>
  <ActivationBudget payload={p}/>
  <div className="cp-supporting-details">
   <details className="cp-detail"><summary><Users size={15}/><span className="cp-detail-label">Pareceres da equipe</span><span className="cp-detail-count">{opinions.length}</span><ChevronDown size={14}/></summary><div className="cp-opinions cp-opinions-compact">{opinions.length?opinions.map((opinion:any)=>{const view=agentReportView(state,opinion,[proposal],now);return <details className="cp-opinion-row" key={opinion.id}><summary><Person id={opinion.fromAgent} small/><span className="cp-opinion-preview" title={view.summary.decision}>{view.summary.reason}</span><ChevronDown size={14}/></summary><div className="cp-opinion-body"><AgentReport message={opinion} state={state} proposals={[proposal]} contextProposalId={proposal.id} compact/><small>{date(opinion.createdAt)}</small></div></details>;}):<p className="cp-muted">Nenhum parecer foi vinculado a esta versão.</p>}</div></details>
   {risks.length>0&&<details className="cp-detail cp-care-details"><summary><TriangleAlert size={15}/><span className="cp-detail-label">Cuidados e limites</span><span className="cp-detail-count">{risks.length}</span><ChevronDown size={14}/></summary><ul className="cp-care-list">{risks.map((risk:any,i:number)=><li key={i}>{textOf(risk)||risk.text||'Observação registrada'}</li>)}</ul></details>}
   <details className="cp-detail"><summary><FileSearch size={15}/><span className="cp-detail-label">Dados e identificação</span><ChevronDown size={14}/></summary><div className="cp-detail-body"><dl className="cp-proposal-identity"><div><dt>Campanha / objeto</dt><dd>{p.objectName||'N/D'}</dd></div><div><dt>ID</dt><dd>{p.objectId||'N/D'}</dd></div><div><dt>Conta</dt><dd>{p.adAccountId||'N/D'}</dd></div><div><dt>Plataforma</dt><dd>{p.provider||'N/D'}</dd></div><div><dt>Registrada</dt><dd>{date(proposal.createdAt)}</dd></div>{budget&&<div><dt>Moeda</dt><dd>{currency||'N/D'}{validConversion?` · cotação ${numeric(conversion.rate)} · ${conversion.source} · ${date(conversion.at)}`:currency!=='BRL'?' · conversão em reais não registrada':''}</dd></div>}{p.title&&<div><dt>Título original</dt><dd>{p.title}</dd></div>}</dl><h4 className="cp-data-heading">Evidências da proposta</h4><Evidence refs={array(p.evidenceRefs)} state={state} project={project}/><h4 className="cp-data-heading">Períodos analisados</h4><SourceCut cuts={array(p.sourceCut)}/></div></details>
   {reviews.length>0&&<details className="cp-detail"><summary><GitBranch size={15}/><span className="cp-detail-label">Histórico da decisão</span><span className="cp-detail-count">{reviews.length}</span><ChevronDown size={14}/></summary><div className="cp-review-history">{reviews.map((review:any)=><div key={review.id}><span><strong>{review.actor==='owner'?'Você':agent(review.agentId)?.name||review.actor||'Revisor'}</strong> · {{approve:'Aprovou',reject:'Recusou',revise:'Pediu revisão'}[review.decision as ReviewChoice]||review.decision}</span>{review.comment&&<p>{review.comment}</p>}<small>Versão {review.version} · {date(review.createdAt)}</small></div>)}</div></details>}
  </div>
  {execution&&<ExecutionTrace proposal={proposal} view={execution}/>}
  <footer className="cp-proposal-foot">
   {proposal.expiresAt&&<div className="cp-validity"><Clock3 size={12}/><span>{expired?'Validade encerrada em':'Válida até'} {date(proposal.expiresAt)}</span></div>}
   {pending&&state.paused&&<p className="cp-muted" role="status">Retome o escritório para aprovar esta proposta. Você pode recusar ou pedir revisão durante a pausa.</p>}
   {pending?<><div className="cp-review-actions"><button className="cp-button cp-primary" disabled={!canApprove} onClick={()=>void onReview(proposal,'approve','Autorizo a execução local dos valores e condições desta versão.')}><Check size={15}/> Aprovar ajuste</button><button className="cp-button" disabled={saving} onClick={()=>setChoice(choice==='revise'?null:'revise')}><RefreshCw size={14}/> Pedir revisão</button><button className="cp-button cp-quiet" disabled={saving} onClick={()=>setChoice(choice==='reject'?null:'reject')}><X size={15}/> Recusar</button></div><p className="cp-approval-confirmation"><ShieldCheck size={12}/> Você autoriza somente este ajuste. A aplicação é confirmada após conferência na plataforma.</p>{choice&&choice!=='approve'&&<form className="cp-review-form" onSubmit={e=>{e.preventDefault();void onReview(proposal,choice,draft.trim());}}><label htmlFor={'proposal-comment-'+proposal.id}>{choice==='revise'?'O que a equipe deve revisar?':'Por que você prefere recusar?'}</label><textarea id={'proposal-comment-'+proposal.id} value={draft} onChange={e=>setDraft(e.target.value)} required maxLength={2500} rows={3} placeholder={choice==='revise'?'Ex.: confira as vendas novas após o último aumento.':'Deixe o motivo para a próxima rodada.'}/><div><small>{draft.length}/2500</small><button className="cp-button" type="button" onClick={()=>setChoice(null)}>Cancelar</button><button className={'cp-button '+(choice==='reject'?'cp-danger':'cp-primary')} disabled={!canSend||!draft.trim()}>{choice==='reject'?'Confirmar recusa':'Enviar para revisão'}</button></div></form>}</>:<p className="cp-settled-note">{unavailable}</p>}
  </footer>
 </article>;
}

function Knowledge({items}:{items:any[]}) {
 return <div className="cp-knowledge">{!items.length?<Empty icon={BookOpen} title="Aprendizados ainda não registrados" text="Conclusões verificáveis e suas fontes aparecerão aqui quando forem salvas pela equipe."/>:items.map(item=>{
  const updated=Date.parse(item.updatedAt||item.createdAt||''),stale=!Number.isFinite(updated)||Date.now()-updated>30*86400000||item.status!=='Corroborado';
  return <article key={item.id}><header><BookOpen size={18}/><div><strong>{item.topic||'Aprendizado do projeto'}</strong><small>Atualizado {date(item.updatedAt||item.createdAt)} · revisão {item.revision||1}</small></div><Badge status={item.status||'Hipótese'}/></header><p>{item.claim}</p>{stale&&<span className="cp-knowledge-warning">Precisa de conferência antes de orientar uma nova decisão.</span>}<details className="cp-detail"><summary>Fontes e casos <span>{array(item.sources).length}</span><ChevronDown size={14}/></summary><div className="cp-knowledge-sources">{array(item.sources).map((source:any,index:number)=><div key={index}><strong>{source.system||'Fonte N/D'}</strong><p>{source.summary}</p><span className="cp-id">{source.reference||'Referência N/D'}</span><small>Observado {date(source.observedAt)}{source.from&&` · ${shortDate(source.from)} — ${shortDate(source.to)}`}</small></div>)}{!array(item.sources).length&&<p className="cp-muted">Sem fonte registrada.</p>}{array(item.supportCases).map((item:any,index:number)=><small key={'case'+index}>Caso {item.objectId} · {shortDate(item.from)} — {shortDate(item.to)} · {item.reference}</small>)}</div></details></article>;
 })}</div>;
}

export default function CollaborationPanel({state,project,write,saving,liveItems=[],presentationCards}:Props) {
 const [tab,setTab]=useState<'cards'|'feed'|'proposals'|'knowledge'>('cards'),[roundsByProject,setRoundsByProject]=useState<Record<string,string>>({});
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[choices,setChoices]=useState<Record<string,ReviewChoice|null>>({}),[busy,setBusy]=useState(false),[notices,setNotices]=useState<Record<string,string>>({}),[now,setNow]=useState(Date.now());
 const [historyByProject,setHistoryByProject]=useState<Record<string,any[]>>({}),[cursors,setCursors]=useState<Record<string,string|null>>({}),[historyLoading,setHistoryLoading]=useState<Record<string,boolean>>({}),[historyErrors,setHistoryErrors]=useState<Record<string,string>>({});
 const lock=useRef(false),requestIds=useRef<Record<string,string>>({});
 const historyRequests=useRef<Record<string,AbortController>>({});
 const notice=notices[project]||'';
 function setNotice(text:string,scope=project){setNotices(old=>({...old,[scope]:text}));}
 const history=useMemo(()=>historyByProject[project]||[],[historyByProject,project]);
 const rounds=useMemo(()=>unique([...array(state.collaborationRounds),...history.map(item=>({...item.round,_archived:true,archivedAt:item.archivedAt}))]).filter(r=>r.project===project).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),[state.collaborationRounds,history,project]);
 const selectedRound=roundsByProject[project],roundId=rounds.some(r=>r.id===selectedRound)?selectedRound:rounds[0]?.id||'',round=rounds.find(r=>r.id===roundId);
 const allMessages=useMemo(()=>unique([...array(state.collaborationMessages),...history.flatMap(item=>array(item.messages))]).filter(m=>m.project===project),[state.collaborationMessages,history,project]);
 const messages=allMessages.filter(m=>m.roundId===roundId).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
 const roundSummary=messages.filter(m=>m.kind==='conclusion'&&m.fromAgent==='ops').at(-1)||messages.filter(m=>m.kind==='conclusion').at(-1)||messages.at(-1);
 const proposals=unique([...array(state.proposals),...history.flatMap(item=>array(item.proposals).map(p=>({...p,_archived:true})))]).filter(p=>p.project===project&&p.roundId===roundId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
 const actionable=proposals.filter(p=>!p._archived&&!warmupProposal(state,p)&&p.status==='Aguardando aprovação'&&(!p.expiresAt||Date.parse(p.expiresAt)>now));
 const knowledge=array(state.knowledge).filter(k=>k.project===project);
 const stages=array(round?.stages),completed=stages.filter(s=>s.status==='Concluída'||s.status==='Concluído').length;
 const queuedJob=array(state.jobs).some(j=>j.project===project&&j.status==='Pendente');
 const runningJob=array(state.jobs).some(j=>j.project===project&&j.status==='Em análise'&&Date.parse(j.startedAt)<=now&&now-Date.parse(j.startedAt)<45*60000);
 const pending=queuedJob||runningJob||array(state.collaborationRounds).some(r=>r.project===project&&!['Concluída','Bloqueada','Cancelada','Falhou','Fonte substituída','Expirada'].includes(r.status));
 useEffect(()=>{const interval=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(interval);},[]);
 useEffect(()=>()=>{Object.values(historyRequests.current).forEach(controller=>controller.abort());},[]);
 async function loadHistory() {
  const scope=project;if(!scope||historyRequests.current[scope]||cursors[scope]===null)return;
  const controller=new AbortController();historyRequests.current[scope]=controller;
  setHistoryLoading(old=>({...old,[scope]:true}));setHistoryErrors(old=>({...old,[scope]:''}));
  try {
   const query=new URLSearchParams({project:scope,limit:'10'});if(cursors[scope])query.set('cursor',cursors[scope]!);
   const response=await fetch('/api/collaboration-history?'+query.toString(),{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw new Error('Não foi possível carregar as rodadas anteriores.');
   const result:any=await response.json();if(!Array.isArray(result.items))throw new Error('O histórico retornou um formato inesperado.');
   const items=result.items.filter((item:any)=>item.round?.id&&item.round.project===scope);
   setHistoryByProject(old=>({...old,[scope]:[...(old[scope]||[]),...items].filter((item,index,all)=>all.findIndex(other=>other.round.id===item.round.id)===index)}));
   setCursors(old=>({...old,[scope]:typeof result.nextCursor==='string'?result.nextCursor:null}));
  } catch(error:any) {if(error.name!=='AbortError')setHistoryErrors(old=>({...old,[scope]:error.message||'Histórico indisponível. Tente novamente.'}));}
  finally {delete historyRequests.current[scope];if(!controller.signal.aborted)setHistoryLoading(old=>({...old,[scope]:false}));}
 }
 function tabKeys(event:React.KeyboardEvent<HTMLDivElement>) {
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index=event.key==='ArrowRight'?(current+1)%buttons.length:event.key==='ArrowLeft'?(current+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
  if(index<0)return;event.preventDefault();buttons[index]?.click();buttons[index]?.focus();
 }
 async function request() {
  if(lock.current||saving||!project)return;const scope=project;lock.current=true;setBusy(true);setNotice('',scope);
  try{const ok=await write({op:'collaborationRun',project:scope});setNotice(ok?'Rodada conjunta solicitada. Os pareceres aparecerão quando forem registrados.':'Não foi possível registrar a rodada. Confira o aviso da central e tente novamente.',scope);}catch{setNotice('Não foi possível registrar a rodada. Tente novamente.',scope);}finally{lock.current=false;setBusy(false);}
 }
 async function review(proposal:any,decision:ReviewChoice,comment:string) {
  if(lock.current||saving||proposal._archived||!proposal.signature||proposal.status!=='Aguardando aprovação')return;
  const scope=proposal.project;
  if(decision==='approve'&&state.paused){setNotice('Retome o escritório para aprovar esta proposta.',scope);return;}
  if(decision==='approve'&&isActivation(proposal.payload)&&!validActivationBudget(proposal.payload)){setNotice('Esta ativação precisa de uma nova proposta com o orçamento e seu proprietário conferidos.',scope);return;}
  const key=proposal.id+':'+proposal.version,requestKey=[key,decision,comment].join('|');
  lock.current=true;setBusy(true);setNotice('',scope);
  const clientId=requestIds.current[requestKey]||(requestIds.current[requestKey]=crypto.randomUUID());
  try{const ok=await write({op:'proposalReview',id:proposal.id,version:proposal.version,signature:proposal.signature,decision,comment,clientId});if(ok){setDrafts(old=>({...old,[key]:''}));setChoices(old=>({...old,[key]:null}));delete requestIds.current[requestKey];setNotice({approve:'Execução autorizada. Um executor na nuvem conectado poderá aplicar esta versão e conferir o resultado na plataforma.',reject:'Proposta recusada. Seu motivo ficou registrado.',revise:'Revisão solicitada. O comentário ficou vinculado a esta versão.'}[decision],scope);}else setNotice('A decisão não foi registrada. A proposta pode ter sido atualizada; confira o aviso da central.',scope);}catch{setNotice('A decisão não foi registrada. Tente novamente após conferir a proposta.',scope);}finally{lock.current=false;setBusy(false);}
 }
 return <section className="cp-hub" aria-label="Colaboração e decisões da equipe">
  <header className="cp-heading"><div><span className="cp-overline">MESA DE DECISÃO</span><h2>O time analisa. Você decide.</h2><p>Leia os pareceres e aprove o próximo passo com o contexto na mão.</p></div><button className="cp-button cp-primary" disabled={saving||busy||!project||state.paused||pending} onClick={()=>void request()}><Users size={16}/>{queuedJob?'Coleta na fila':runningJob?'Coleta em andamento':pending?'Rodada em andamento':'Pedir análise conjunta'}</button></header>
  <div className="cp-toolbar"><div className="cp-tabs" role="tablist" aria-label="Visões da mesa de decisão" onKeyDown={tabKeys}><button role="tab" id="cp-tab-cards" aria-controls="cp-content-cards" aria-selected={tab==='cards'} tabIndex={tab==='cards'?0:-1} onClick={()=>setTab('cards')}><CheckCheck size={15}/> Cards de decisão</button><button role="tab" id="cp-tab-feed" aria-controls="cp-content-feed" aria-selected={tab==='feed'} tabIndex={tab==='feed'?0:-1} onClick={()=>setTab('feed')}><MessageSquare size={15}/> Conversa da rodada <span>{messages.length}</span></button><button role="tab" id="cp-tab-proposals" aria-controls="cp-content-proposals" aria-selected={tab==='proposals'} tabIndex={tab==='proposals'?0:-1} onClick={()=>setTab('proposals')}><CheckCheck size={15}/> Para aprovar <span>{actionable.length}</span></button><button role="tab" id="cp-tab-knowledge" aria-controls="cp-content-knowledge" aria-selected={tab==='knowledge'} tabIndex={tab==='knowledge'?0:-1} onClick={()=>setTab('knowledge')}><BookOpen size={15}/> Aprendizados <span>{knowledge.length}</span></button></div>{tab!=='knowledge'&&tab!=='cards'&&rounds.length>0&&<label className="cp-round-picker"><span>Rodada</span><select aria-label="Selecionar rodada conjunta" value={roundId} onChange={e=>{const id=e.target.value;setRoundsByProject(old=>({...old,[project]:id}));}}>{rounds.map(r=><option key={r.id} value={r.id}>{roundName(r)} · {r.status}</option>)}</select></label>}</div>
  {notice&&<p className="cp-notice" role="status">{notice}</p>}
  {tab!=='knowledge'&&tab!=='cards'&&<div className="cp-history-tools"><span>{round?round._archived?`Rodada arquivada em ${date(round.archivedAt)} · somente consulta`:'Rodada disponível na base atual.':'Consulte as rodadas anteriores do projeto.'}</span><button className="cp-button cp-quiet" disabled={!project||historyLoading[project]||cursors[project]===null} onClick={()=>void loadHistory()}><Clock3 size={13}/>{historyLoading[project]?'Carregando histórico…':cursors[project]===null?'Histórico carregado':history.length?'Carregar mais rodadas':'Rodadas anteriores'}</button>{historyErrors[project]&&<p role="status">{historyErrors[project]}</p>}</div>}
  {tab==='cards'&&<div role="tabpanel" id="cp-content-cards" aria-labelledby="cp-tab-cards"><DecisionCards liveItems={liveItems} state={state} project={project} write={write} saving={saving||busy} compact presentationCards={presentationCards}/></div>}
  {tab==='feed'&&<div role="tabpanel" id="cp-content-feed" aria-labelledby="cp-tab-feed" className="cp-feed-layout">{round?<><aside className="cp-round-summary"><div className="cp-round-summary-title"><Clock3 size={17}/><strong>Esta rodada</strong><Badge status={round.status||'Na fila'}/></div><p>Solicitada {date(round.createdAt)}</p>{!round.systemReview&&<><div className="cp-progress" aria-label={`${completed} de ${stages.length} etapas concluídas`}><span style={{width:stages.length?completed/stages.length*100+'%':'0%'}}/></div><div className="cp-stages">{agents.map(a=>{const stage=stages.find(s=>s.agentId===a.id);return <div key={a.id}><Person id={a.id}/><span><Badge status={stage?.status||'Não registrada'}/><small>{stage?.completedAt?'Concluída '+date(stage.completedAt):stage?.startedAt?'Iniciada '+date(stage.startedAt):'Sem início registrado'}</small></span></div>;})}</div></>}<details className="cp-detail"><summary><FileSearch size={15}/> Base da rodada <ChevronDown size={14}/></summary><SourceCut cuts={array(round.sourceCut)}/></details><p className="cp-audit-note">Horários e etapas vêm dos registros da rodada. Não representam presença online.</p></aside><div className="cp-feed">{round.systemReview&&<section className="cp-round-digest"><h3>{systemRoundTitle(round)}</h3><p>{round.systemReview.reason}</p><p>Triagem registrada pelo sistema em {date(round.systemReview.at)}. Os agentes não geraram pareceres nem decisões para preencher esta rodada.</p></section>}{roundSummary&&<section className="cp-round-digest"><h3>{roundSummary.fromAgent==='ops'?'Resumo da rodada':'Última leitura da equipe'}</h3><AgentReport message={roundSummary} state={state} proposals={proposals}/></section>}<details className="cp-readable-conversation"><summary><Users size={15}/> Ver pareceres e conversa da equipe <span>{messages.length}</span><ChevronDown size={14}/></summary><div role="log" aria-label="Mensagens registradas da equipe" aria-live="polite">{messages.length?messages.map(message=>{
   const from=agent(message.fromAgent),to=agent(message.toAgent),reply=message.replyTo?allMessages.find(m=>m.id===message.replyTo):null;
   return <article key={message.id} className={'cp-message'+(message.kind==='conclusion'?' cp-conclusion':'')}><header><Person id={message.fromAgent}/><div><span>{message.kind==='conclusion'?'Parecer registrado':to?'Para '+to.name:'Mensagem da rodada'}</span><small>{date(message.createdAt)}</small></div></header>{reply&&<blockquote><span>Em resposta a {agent(reply.fromAgent)?.name||'um registro anterior'}</span>{messageExcerpt(textOf(reply.text),200)}</blockquote>}<AgentReport message={message} state={state} proposals={proposals}/>{array(message.evidenceRefs).length>0&&<details className="cp-detail"><summary><FileSearch size={14}/> Referências da mensagem <span>{message.evidenceRefs.length}</span><ChevronDown size={14}/></summary><Evidence refs={message.evidenceRefs} state={state} project={project}/></details>}{from&&<span className="cp-message-role">{from.role}</span>}</article>;
  }):<Empty icon={MessageSquare} title={round.systemReview?"Rodada sem pareceres de agentes":"Os pareceres ainda não chegaram"} text={round.systemReview?(round.systemReview.kind==='unavailable-tracked-only'?"A triagem do sistema está registrada acima. As campanhas sem dados continuam aguardando leitura na próxima coleta elegível.":"Não houve campanha elegível neste recorte. Uma nova coleta poderá abrir outra rodada."):"A rodada está registrada. As mensagens aparecerão aqui após serem gravadas pelo agente conectado."}/>}</div></details></div></>:<Empty icon={Users} title="Vamos reunir as perspectivas do projeto" text="Peça uma análise conjunta. Tráfego, orçamento, criativos e gestão terão seus registros organizados nesta mesa."/>}</div>}
  {tab==='proposals'&&<div role="tabpanel" id="cp-content-proposals" aria-labelledby="cp-tab-proposals" className="cp-proposal-list">{proposals.length?proposals.map(proposal=>{const key=proposal.id+':'+proposal.version;return <ProposalCard key={key} proposal={proposal} messages={allMessages} state={state} project={project} saving={saving||busy} onReview={review} draft={drafts[key]||''} setDraft={text=>setDrafts(old=>({...old,[key]:text}))} choice={choices[key]||null} setChoice={choice=>setChoices(old=>({...old,[key]:choice}))} now={now}/>;}):<Empty icon={ShieldCheck} title="Nenhuma proposta nesta rodada" text="Quando a análise resultar em uma proposta concreta, você verá aqui o objeto, os valores e os motivos para decidir."/>}</div>}
  {tab==='knowledge'&&<div role="tabpanel" id="cp-content-knowledge" aria-labelledby="cp-tab-knowledge"><div className="cp-knowledge-intro"><BookOpen size={18}/><p>Aprendizados deste projeto, com fontes e histórico. Hipóteses e registros antigos precisam de conferência; não mudam as metas do projeto.</p></div><LearningCyclePanel state={state} project={project}/><Knowledge items={knowledge}/></div>}
 </section>;
}
