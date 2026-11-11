'use client';
/* Agora: "O que o Bunk faria agora" (today's decisions of the fixed rules and the team plays, with the status the executor
 * derived), "O que o Bunk fez" (one timeline per Bunk order) and the campaigns in the reading. Read-only. */
import {useMemo,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {chipFor,DiffRow,Empty,Guardrails,SkeletonRows,StatusChip,WindowTable,clock,decisionStatuses,deepCampaigns,deepDecisions,deepDone,findCampaign,fmtInt,fmtX,brl,refOf,sourceText,statusLabels,stepNames,minutesText,type CampaignRef,type DecisionStatus} from './components';

const stageText:Record<string,string>={'first-day':'1º dia','second-day':'2º dia',young:'Nova (3–4 dias)',mature:'Madura'};
const modeText:Record<string,string>={off:'Desligado',shadow:'Sombra',confirm:'Confirmar',auto:'Automático'};

export function DecisionRow({d,deep,showProject,onOpen}:{d:any;deep:any;showProject:boolean;onOpen:(r:CampaignRef)=>void}){
 const c=findCampaign(deep,d.project,d.adAccountId,d.objectId),chip=chipFor(d);
 return <li className={`aut-dec is-${chip.status}`}>
  <div className="aut-dec__top">
   <StatusChip d={d}/>
   {d.source==='playbook'&&<span className="ds-pill ds-pill--tag">Jogada da equipe</span>}
   {d.sameAsRule&&<span className="ds-caption">regra fixa tem prioridade</span>}
   <span className="aut-dec__at ds-caption">{clock(d.firstAt)}</span>
  </div>
  <button type="button" className="aut-dec__name" onClick={()=>onOpen(refOf(d))} aria-label={`Abrir campanha ${d.campaign||d.objectId}`}>
   <span className="ds-truncate" title={d.campaign||undefined}>{d.campaign||`Campanha ${d.objectId}`}</span><ChevronRight size={14} aria-hidden="true"/>
  </button>
  <p className="aut-dec__meta">{showProject?`${d.projectName||d.project} · `:''}{d.accountName||d.adAccountId}{d.mode?` · nível ${modeText[d.mode]||d.mode}`:''}</p>
  <DiffRow action={d.action} before={d.before} after={d.after} percent={d.percent}/>
  {d.reason&&<p className="aut-dec__reason">{d.reason}</p>}
  {chip.status==='segurada'&&Array.isArray(d.holdReasons)&&d.holdReasons.length>1&&<ul className="aut-dec__holds">{d.holdReasons.slice(1,6).map((h:string,i:number)=><li key={i}>{h}</li>)}</ul>}
  {c&&<WindowTable windows={c.windows} partialDay={c.partialDay} compact/>}
  <p className="aut-dec__source"><span className="ds-glyph ds-glyph--info" aria-hidden="true"/>{sourceText(d)}</p>
  {c&&<Guardrails guard={c.guard}/>}
  {(d.manager||d.owner)&&<p className="ds-caption aut-dec__react">{d.manager?`${d.manager.actor||'Alguém da equipe'} mexeu ${fmtInt(d.manager.minutesAfter)} min depois. `:''}{d.owner?`Você mexeu ${fmtInt(d.owner.minutesAfter)} min depois.`:''}</p>}
 </li>;
}

/** decidiu → enviada → confirmada → +15/30/60 → D+1 → D+3; what has not happened (or is N/D) stays open. */
export function OrderTimeline({o}:{o:any}){
 const steps=Array.isArray(o.steps)?o.steps:[],has=(k:string)=>steps.find((s:any)=>s.kind===k),checks=Array.isArray(o.monitorChecks)?o.monitorChecks:[];
 const items:{key:string;label:string;at:string|null;state:'done'|'bad'|'open';note?:string}[]=[
  {key:'decidiu',label:'Decidiu',at:has('decidiu')?.at||o.at||null,state:'done'},
  ...(has('falhou')?[{key:'falhou',label:'Falhou',at:has('falhou').at,state:'bad' as const}]:[]),
  ...(has('verificacao')?[{key:'verificacao',label:'Em verificação',at:has('verificacao').at,state:'bad' as const}]:[]),
  {key:'enviada',label:'Enviada',at:has('enviada')?.at||null,state:has('enviada')?'done':'open'},
  {key:'confirmada',label:'Confirmada',at:has('confirmada')?.at||null,state:has('confirmada')?'done':'open'},
  ...[15,30,60].map(m=>{const c=checks.find((x:any)=>x.minutes===m);return {key:`m${m}`,label:`+${m} min`,at:c?.at||null,state:c?'done' as const:'open' as const,note:c?.delta?`ROI ${fmtX(c.delta.roi)} · gasto ${brl(c.delta.spend)}`:c?c.status:undefined};}),
  {key:'d1',label:'D+1',at:null,state:'open',note:'N/D'},{key:'d3',label:'D+3',at:null,state:'open',note:'N/D'},
 ];
 return <ol className="aut-steps" aria-label="Etapas da ordem">{items.map(s=><li key={s.key} className={`is-${s.state}`}><span className="aut-steps__dot" aria-hidden="true"/><span className="aut-steps__label">{s.label}</span><span className="aut-steps__at ds-caption">{s.at?clock(s.at):s.note||'—'}</span>{s.at&&s.note?<span className="ds-caption">{s.note}</span>:null}<span className="ds-sr-only">{s.state==='done'?'feito':s.state==='bad'?'falhou':'ainda não'}</span></li>)}</ol>;
}

export function NowTab({deep,loading,fallbackOrders,showProject,onOpen}:{deep:any;loading:boolean;fallbackOrders:any[];showProject:boolean;onOpen:(r:CampaignRef)=>void}){
 const [only,setOnly]=useState<DecisionStatus|'all'>('all');
 const decisions=useMemo(()=>deepDecisions(deep),[deep]),done=useMemo(()=>deepDone(deep),[deep]),campaigns=useMemo(()=>deepCampaigns(deep),[deep]);
 const counts=useMemo(()=>Object.fromEntries(decisionStatuses.map(s=>[s,decisions.filter(d=>chipFor(d).status===s).length])) as Record<DecisionStatus,number>,[decisions]);
 const shown=only==='all'?decisions:decisions.filter(d=>chipFor(d).status===only);
 const anyShadow=Object.values<any>(deep?.projects||{}).some(p=>p?.level?.mode==='shadow');
 return <div className="aut-tab aut-now">
  <section className="ds-card" aria-labelledby="aut-now-title">
   <header className="ds-header"><h2 id="aut-now-title" className="ds-header__title">O que o Bunk faria agora</h2><span className="ds-header__detail">{deep?`${decisions.length} ${decisions.length===1?'decisão':'decisões'} hoje · regras fixas e jogadas da equipe`:'hoje'}</span></header>
   {!!decisions.length&&<div className="aut-filter" role="group" aria-label="Filtrar por situação">
    <button type="button" className="ds-chip ds-chip--neutral ds-chip--outlined" aria-pressed={only==='all'} onClick={()=>setOnly('all')}>Todas <span className="ds-num">{decisions.length}</span></button>
    {decisionStatuses.filter(s=>counts[s]).map(s=><button key={s} type="button" className="ds-chip ds-chip--neutral ds-chip--outlined" aria-pressed={only===s} onClick={()=>setOnly(s)}>{statusLabels[s]} <span className="ds-num">{counts[s]}</span></button>)}
   </div>}
   {loading&&!deep?<SkeletonRows label="Carregando as decisões de hoje…"/>:!deep?<Empty>Sem a leitura do executor agora. As decisões aparecem aqui quando ela chegar.</Empty>:!decisions.length?<Empty>Nenhuma decisão da Sombra hoje ainda.{anyShadow?' No nível Sombra ele só registra o que faria.':''}</Empty>:
    <ul className="ds-list ds-list--divided aut-decs">{shown.map(d=><DecisionRow key={d.id} d={d} deep={deep} showProject={showProject} onOpen={onOpen}/>)}</ul>}
  </section>
  <section className="ds-card" aria-labelledby="aut-done-title">
   <header className="ds-header"><h2 id="aut-done-title" className="ds-header__title">O que o Bunk fez</h2><span className="ds-header__detail">ordens do Bunk · 7 dias</span></header>
   {deep?(!done.length?<Empty>Nenhuma ordem do Bunk ainda. No nível Sombra ele só registra o que faria.</Empty>:
    <ul className="ds-list ds-list--divided aut-orders-list">{done.map(o=><li key={o.proposalId} className="aut-order">
     <button type="button" className="aut-dec__name" onClick={()=>onOpen(refOf(o))}><span className="ds-truncate" title={o.campaign||undefined}>{o.campaign||`Campanha ${o.objectId}`}</span><ChevronRight size={14} aria-hidden="true"/></button>
     <p className="aut-dec__meta">{showProject?`${o.projectName} · `:''}{o.rule||'regra N/D'}{o.executionStatus?` · ${o.executionStatus}`:''}</p>
     <DiffRow action={o.action} before={o.before} after={o.after} percent={o.percent}/>
     <OrderTimeline o={o}/>
    </li>)}</ul>)
   :!fallbackOrders.length?<Empty>Nenhuma ordem do Bunk nas últimas 24h.</Empty>:
    <ul className="ds-list ds-list--divided aut-entries">{fallbackOrders.map((o:any)=><li className="autonomy-order" key={o.id}><strong>{o.projectName} · {o.campaign}</strong><p>{o.action==='status'?'Pausar':<>Orçamento <span className="ds-num">{o.before.dailyBudget} → {o.after.dailyBudget}</span> {o.currency||''}</>}</p><span className={`ds-pill ${o.stage==='confirmed'?'ds-pill--good':o.stage==='failed'||o.stage==='verify'?'ds-pill--bad':'ds-pill--warn'}`}><span className={`ds-glyph ${o.stage==='confirmed'?'ds-glyph--good':o.stage==='failed'||o.stage==='verify'?'ds-glyph--bad':'ds-glyph--waiting'}`} aria-hidden="true"/>{o.label}</span>{o.reason&&<small>{o.reason}</small>}</li>)}</ul>}
  </section>
  {!!campaigns.length&&<details className="ds-card aut-camps">
   <summary className="aut-camps__summary"><span className="ds-title">Campanhas na leitura de hoje</span><span className="ds-caption">{campaigns.length} · nível, estágio e travas de cada uma</span></summary>
   <ul className="ds-list ds-list--divided">{campaigns.map((c:any)=><li key={c.project+c.key}><button type="button" className="ds-row aut-camp" onClick={()=>onOpen({project:c.project,projectName:c.projectName,adAccountId:c.adAccountId,objectId:String(c.objectId),name:c.name})}>
    <span className="ds-row__main"><span className="ds-row__title" title={c.name||undefined}>{c.name||`Campanha ${c.objectId}`}</span><span className="ds-row__sub">{showProject?`${c.projectName} · `:''}{modeText[c.mode]||c.mode} · {stageText[c.stage]||'estágio N/D'}{c.test?' · teste':''}{c.guard?.cooldownMin>0?` · espera ${minutesText(c.guard.cooldownMin)}`:''}</span></span>
    <span className="ds-row__trail"><span className="ds-num">{brl(c.windows?.today?.spend)}</span><small className="ds-caption">ROI hoje {fmtX(c.windows?.today?.roi)}</small></span><span className="ds-row__chevron" aria-hidden="true"/>
   </button></li>)}</ul>
  </details>}
 </div>;
}
