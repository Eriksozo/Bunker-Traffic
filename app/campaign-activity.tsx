'use client';
import {useMemo,useState} from 'react';
import {ArrowDownRight,ArrowUpRight,ChevronDown,History,Pause,Play,UserRound} from 'lucide-react';
import {activityActions,activityLog,activitySummary,cardActivity,metricEvolution} from '../lib/campaign-activity.mjs';
import './campaign-activity.css';

const finite=(n:any):n is number=>typeof n==='number'&&Number.isFinite(n);
function money(n:any,currency?:string|null){if(!finite(n))return 'N/D';const code=typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)?currency:'BRL';try{return n.toLocaleString('pt-BR',{style:'currency',currency:code,maximumFractionDigits:2});}catch{return n.toLocaleString('pt-BR');}}
const ratio=(n:any)=>finite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'x':'N/D';
const signed=(n:number,format:(n:number)=>string)=>(n>0?'+':n<0?'−':'')+format(Math.abs(n));
const stamp=(value:string)=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'N/D';};
const statusNames:Record<string,string>={ACTIVE:'ativa',PAUSED:'pausada',CAMPAIGN_PAUSED:'pausada',ARCHIVED:'arquivada',DELETED:'excluída'};
const statusName=(value:any)=>statusNames[String(value)]||String(value||'N/D').toLowerCase();
const icons:Record<string,any>={increase:ArrowUpRight,reduce:ArrowDownRight,pause:Pause,activate:Play,status:History,currency:History};
const verbs:Record<string,string>={increase:'aumentou',reduce:'reduziu',pause:'pausou',activate:'ativou',status:'mudou o status',currency:'mudou a moeda'};
const nouns:Record<string,string>={increase:'Orçamento aumentado',reduce:'Orçamento reduzido',pause:'Campanha pausada',activate:'Campanha ativada',status:'Status alterado',currency:'Moeda alterada'};

/** "de R$ 1.000 para R$ 700 (−30%)" for budgets, "ativa → pausada" for status. */
export function changeDetail(e:any){
 if(e.action==='increase'||e.action==='reduce'){const budget=e.field==='lifetimeBudget'?' vitalício':'/dia';return `${finite(e.percent)?signed(e.percent,n=>n.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%')+' · ':''}${money(e.before,e.currency)} → ${money(e.after,e.currency)}${budget}`;}
 if(e.action==='currency')return `${e.before} → ${e.after}`;
 return `${statusName(e.before)} → ${statusName(e.after)}`;
}
export function changeSentence(e:any){
 const who=e.origin==='bunker'?'Bunker (sua aprovação)':e.actor;
 // The percent and the from/to values live in changeDetail, shown right after this sentence.
 return who?`${who} ${verbs[e.action]||'alterou'}`:`${nouns[e.action]||'Alteração'} · autor não informado`;
}

/** Prominent line when someone changed this campaign after the analysis the card is based on. */
export function ActivityChip({card,state,now}:{card:any;state:any;now:number}){
 const activity=useMemo(()=>cardActivity(state,card,{now}),[state,card,now]),e=activity.latest;
 if(!e)return null;const Icon=icons[e.action]||History;
 return <p className={'ca-chip ca-chip-'+e.action} role="status"><Icon size={13} aria-hidden="true"/><span><strong>Mudou depois da análise: {changeSentence(e)}</strong> · {changeDetail(e)} · {stamp(e.at)}{activity.sinceAnalysis.length>1?` · +${activity.sinceAnalysis.length-1} alteração(ões)`:''}</span></p>;
}

/** Today's numbers now versus the analysis of the same day. */
export function MetricEvolution({card}:{card:any}){
 const m=metricEvolution(card);if(!m)return null;
 const parts=[finite(m.spend)?`gasto ${signed(m.spend,n=>money(n))}`:null,finite(m.frontOrders)?`front ${m.frontOrders>0?'+':''}${m.frontOrders}`:null,finite(m.roas.before)||finite(m.roas.after)?`ROAS ${ratio(m.roas.before)} → ${ratio(m.roas.after)}`:null].filter(Boolean);
 if(!parts.length)return null;
 return <p className="ca-evolution"><span>Desde a análise ({stamp(m.since)} → {stamp(m.at)}):</span> {parts.join(' · ')}</p>;
}

function EventRow({e,showCampaign}:{e:any;showCampaign:boolean}){
 const Icon=icons[e.action]||History;
 return <li className={'ca-event ca-event-'+e.action}>
  <span className="ca-event-icon"><Icon size={14} aria-hidden="true"/></span>
  <span className="ca-event-body">
   <strong>{changeSentence(e)}</strong>
   <span>{changeDetail(e)}</span>
   {showCampaign&&<small>{e.name||'Campanha '+e.objectId}{e.accountName?' · '+e.accountName:''}</small>}
   <small><UserRound size={11} aria-hidden="true"/> {e.origin==='bunker'?'Bunker · aprovado por você':e.actor||'Autor não informado'} · {e.origin==='observed'&&e.from?`entre ${stamp(e.from)} e ${stamp(e.at)}`:stamp(e.at)} · {e.source}{e.confirmedBy?.length?' · confirmado também por: '+e.confirmedBy.join(', '):''}</small>
  </span>
 </li>;
}

/** Full log of one campaign (card detail and campaign analysis). */
export function CampaignActivityLog({card,state,now}:{card:any;state:any;now:number}){
 const activity=useMemo(()=>cardActivity(state,card,{now}),[state,card,now]);
 return <details className="ca-log" open={activity.sinceAnalysis.length>0}><summary><History size={14}/>Atividade na campanha · últimas 72h <span>{activity.events.length}</span><ChevronDown size={13}/></summary>
  {activity.events.length?<ul>{activity.events.map((e:any)=><EventRow key={e.id} e={e} showCampaign={false}/>)}</ul>:<p className="ca-empty">Nenhuma mudança de orçamento ou status registrada nas últimas 72h.</p>}
  <p className="ca-note">Autor e horário exatos vêm do histórico de edições da Malva; mudanças vistas só nas leituras aparecem sem autor e com o intervalo entre as leituras.</p>
 </details>;
}

const ranges={24:'24 horas',168:'7 dias'} as const;
/** Overview: totals per action with who did them; clicking a box opens the log for that action. */
export function ActivityOverview({state,project,now}:{state:any;project:string;now:number}){
 const [hours,setHours]=useState<24|168>(24),[open,setOpen]=useState<string|null>(null);
 const events=useMemo(()=>activityLog(state,{project,since:now-hours*3600000,now}),[state,project,now,hours]);
 const summary=useMemo(()=>activitySummary(events),[events]),shown=open?events.filter((e:any)=>e.action===open):[];
 return <section className="panel ca-overview" aria-label="Atividade recente dos gestores">
  <div className="panel-title"><div><span className="eyebrow">ATIVIDADE DOS GESTORES</span><h2>Mudanças de orçamento e status</h2><p className="hint">Inclui gestores, regras automáticas e o Bunker. Clique numa caixa para ver quem fez, quando e de quanto para quanto.</p></div>
   <div className="ca-range" role="group" aria-label="Período da atividade">{(Object.keys(ranges) as unknown as (keyof typeof ranges)[]).map(h=><button type="button" key={h} className={Number(h)===hours?'is-selected':''} aria-pressed={Number(h)===hours} onClick={()=>setHours(Number(h) as 24|168)}>{ranges[h]}</button>)}</div></div>
  <div className="ca-boxes">{Object.entries(activityActions).map(([action,label])=>{const s=(summary as any)[action],Icon=icons[action],names=Object.entries(s.actors as Record<string,number>).sort((a,b)=>b[1]-a[1]);return <button type="button" key={action} className={'ca-box ca-box-'+action+(open===action?' is-open':'')} aria-expanded={open===action} disabled={!s.count} onClick={()=>setOpen(open===action?null:action)}>
   <span className="ca-box-head"><Icon size={14} aria-hidden="true"/>{label}</span><strong>{s.count}</strong>
   <small>{s.count?[...names.slice(0,3).map(([n,c])=>`${n} (${c})`),...(names.length>3?[`+${names.length-3}`]:[]),...(s.unknown?[`${s.unknown} sem autor informado`]:[])].join(' · '):'Nenhuma no período'}</small>
  </button>;})}</div>
  {open&&<div className="ca-overview-log"><h3>{(activityActions as any)[open]} · {ranges[hours]}</h3><ul>{shown.slice(0,50).map((e:any)=><EventRow key={e.id} e={e} showCampaign/>)}</ul>{shown.length>50&&<p className="ca-note">Mostrando as 50 mais recentes de {shown.length}.</p>}</div>}
  {!events.length&&<p className="ca-empty">Nenhuma mudança de orçamento ou status registrada em {ranges[hours]}.</p>}
 </section>;
}

/** Compact marker for a collapsed list row: visible without opening the card. */
export function ActivityBadge({card,state,now}:{card:any;state:any;now:number}){
 const activity=useMemo(()=>cardActivity(state,card,{now}),[state,card,now]),e=activity.latest;
 if(!e)return null;
 const pct=(e.action==='increase'||e.action==='reduce')&&finite(e.percent)?' '+signed(e.percent,n=>n.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'):'';
 return <em className={'ca-badge ca-badge-'+e.action} title={changeSentence(e)+' · '+changeDetail(e)+' · '+stamp(e.at)}>{({increase:'Aumentada',reduce:'Reduzida',pause:'Pausada',activate:'Ativada'} as Record<string,string>)[e.action]||'Alterada'}{pct} após a análise</em>;
}
