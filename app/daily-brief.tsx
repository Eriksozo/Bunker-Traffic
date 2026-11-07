'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowDownRight,ArrowUpRight,ChevronDown,ChevronRight,Minus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {dailyComparison,actionQueue} from '../lib/daily-brief.mjs';
import './daily-brief.css';
import DecisionCards from './decision-cards';

const money=(n:any)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'N/D';
const ratio=(n:any)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'x':'N/D';
const percent=(n:number)=>`${n>0?'+':''}${Math.round(n*100)}%`;
const metrics=[
 {key:'roas',label:'ROAS',format:ratio,higherIsBetter:true},
 {key:'roi',label:'ROI',format:ratio,higherIsBetter:true},
 {key:'cpaFront',label:'CPA front',format:money,higherIsBetter:false},
] as const;

function Delta({value,higherIsBetter,label}:{value:number|null;higherIsBetter:boolean;label:string}){
 if(value===null)return <span className="brief-delta is-neutral">{label} N/D</span>;
 const flat=Math.abs(value)<0.05,good=flat?null:(value>0)===higherIsBetter;
 const Icon=flat?Minus:value>0?ArrowUpRight:ArrowDownRight;
 return <span className={'brief-delta '+(good===null?'is-neutral':good?'is-good':'is-bad')}><Icon size={13} aria-hidden="true"/>{percent(value)} {label}</span>;
}

function stakeText(item:any){
 if(item.kind==='opportunity')return `${money(item.amount)} de ${item.basis==='result'?'resultado':'receita acima da mídia'} em 3 dias`;
 const when=item.period==='today'?'hoje':'em 3 dias';
 return item.basis==='result'?`${money(item.amount)} de prejuízo ${when}`:`receita ${money(item.amount)} abaixo da mídia ${when}`;
}

/** "Hoje em 1 minuto": how today compares and which few campaigns to open first. Never a proposal or approval. */
export default function DailyBrief({state,project,candidates,showProject,onOpen,write,saving,liveItems=[]}:{state:any;project:string;candidates:any[];showProject:boolean;onOpen:(candidate:any)=>void;write:(input:any)=>Promise<boolean>;saving:boolean;liveItems?:any[]}){
 const [expanded,setExpanded]=useState<string|null>(null);
 useEffect(()=>setExpanded(null),[project]);
 const comparison=useMemo(()=>dailyComparison(state,project),[state,project]);
 const queue=useMemo(()=>actionQueue(candidates),[candidates]);
 return <section className="panel daily-brief" aria-label="Resumo do dia">
  <div className="panel-title"><div><span className="eyebrow">RESUMO DO DIA</span><h2>Hoje em 1 minuto</h2><p className="hint">Hoje parcial comparado com ontem e com 7 dias. Só índices: gasto e faturamento de um dia parcial não se comparam com um dia fechado.</p></div></div>
  <div className="brief-compare">{metrics.map(m=>{const today=comparison.today?.[m.key],d=comparison.deltas[m.key];return <div className="brief-metric" key={m.key}>
   <span className="brief-label">{m.label} hoje</span><strong>{m.format(today)}</strong>
   <span className="brief-base">Ontem {m.format(comparison.yesterday?.[m.key])} · 7 dias {m.format(comparison.week?.[m.key])}</span>
   <span className="brief-deltas"><Delta value={d.yesterday} higherIsBetter={m.higherIsBetter} label="vs ontem"/><Delta value={d.week} higherIsBetter={m.higherIsBetter} label="vs 7 dias"/></span>
  </div>;})}</div>
  <div className="section-divider"/>
  <div className="panel-title"><div><h3>O que fazer agora</h3><p className="hint">{queue.items.length?`Até ${queue.items.length} de ${queue.considered} campanhas ativas, ordenadas pelo dinheiro em jogo. Expanda para manter, aumentar, reduzir ou pausar aqui mesmo.`:'Nenhuma campanha ativa com perda lida ou oportunidade clara agora.'}{queue.protectedTests>0&&` ${queue.protectedTests===1?'1 teste com menos de 24h de entrega ficou fora e segue preservado.':`${queue.protectedTests} testes com menos de 24h de entrega ficaram fora e seguem preservados.`}`}</p></div></div>
  {queue.items.map((item:any)=>{const c=item.candidate,loss=item.kind==='loss',target={project:c.row.projectId,adAccountId:c.row.adAccountId,objectId:c.row.externalId},key=JSON.stringify(target),open=expanded===key;return <div className={'brief-action-item'+(open?' is-open':'')} key={key}><Button type="button" className="priority-row brief-item" onClick={()=>setExpanded(open?null:key)} aria-expanded={open} aria-controls={open?`brief-decision-${encodeURIComponent(key)}`:undefined} aria-label={`${open?'Recolher':'Expandir'} decisão de ${c.row.name}`}>
   <span className={'priority-icon '+(loss?'red':'green')}>{loss?<ArrowDownRight size={17}/>:<ArrowUpRight size={17}/>}</span>
   <span className="priority-copy"><strong>{c.row.name}</strong><small>{showProject&&`${c.row.projectName} · `}{c.row.accountName} · {c.decision}</small><small className="brief-why">{loss?(item.period==='today'?'Hoje':'Últimos 3 dias'):'Últimos 3 dias'}: gasto {money(item.spend)} · ROAS {ratio(item.roas)} · 7 dias {ratio(item.comparison)}</small></span>
   <span className={'priority-metric brief-stake '+(loss?'is-bad':'is-good')}>{loss?'Revisar':'Oportunidade'}<small>{stakeText(item)}</small></span>
   {open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
  </Button>{open&&<div className="brief-inline-decision" id={`brief-decision-${encodeURIComponent(key)}`}>
   <DecisionCards state={state} project={target.project} write={write} saving={saving} liveItems={liveItems} inlineTarget={target}/>
   <Button type="button" variant="ghost" className="brief-analysis-link" onClick={()=>onOpen(c)}>Ver análise completa <ChevronRight size={14}/></Button>
  </div>}</div>;})}
 </section>;
}
