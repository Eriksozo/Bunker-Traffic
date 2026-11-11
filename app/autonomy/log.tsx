'use client';
/* Registro: the executor's autonomy log (what the Bunk sent, asked or held back), grouped by campaign with before → after
 * and filters. Same source as before (`/api/autonomy`, plain read). Read-only. */
import {useMemo,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {actionLabels,modeLabels} from '../../lib/autonomy-grant.mjs';
import {DiffRow,Empty,SkeletonRows,fin,fmtSignedPct,stamp,type CampaignRef} from './components';

export type LogEntry={at:string;project?:string;projectName:string|null;adAccountId?:string;objectId?:string;campaign:string|null;rule?:string;ruleLabel:string|null;shadowId?:string|null;mode:string;action:string|null;percent:number|null;before?:any;after?:any;result:{kind:string;blockers?:string[];text?:string};proposalId?:string|null};
const kinds:[string,string][]=[['order','Ordem enviada ao executor'],['confirm','Aguarda você'],['blocked','Segurado']];
const kindTone=(k:string)=>k==='order'?['ds-pill--good','ds-glyph--good']:k==='confirm'?['ds-pill--warn','ds-glyph--waiting']:['ds-pill--neutral','ds-glyph--info'];
const kindLabel=(k:string)=>kinds.find(([x])=>x===k)?.[1]||'Segurado';
const fold=(v:any)=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

/** One group per campaign (project + account + object; the name when the ids are missing), newest group first. */
export function groupLog(log:LogEntry[],{kind=null,project='all',query=''}:{kind?:string|null;project?:string;query?:string}={}){
 const terms=fold(query).split(/\s+/).filter(Boolean),groups=new Map<string,{key:string;campaign:string|null;projectName:string|null;project:string|null;adAccountId:string|null;objectId:string|null;entries:LogEntry[]}>();
 for(const e of Array.isArray(log)?log:[]){
  if(kind&&e?.result?.kind!==kind)continue;
  if(project!=='all'&&e?.project&&e.project!==project)continue;
  if(terms.length){const h=fold([e.campaign,e.projectName,e.ruleLabel,e.objectId].join(' '));if(!terms.every(t=>h.includes(t)))continue;}
  const key=e.adAccountId&&e.objectId?`${e.project||''}|${e.adAccountId}:${e.objectId}`:`name|${e.projectName||''}|${e.campaign||''}`;
  if(!groups.has(key))groups.set(key,{key,campaign:e.campaign,projectName:e.projectName,project:e.project||null,adAccountId:e.adAccountId||null,objectId:e.objectId||null,entries:[]});
  groups.get(key)!.entries.push(e);
 }
 return [...groups.values()];
}

export function LogTab({log,loading,filter,showProject,onOpen}:{log:LogEntry[]|null;loading:boolean;filter:string;showProject:boolean;onOpen:(r:CampaignRef)=>void}){
 const [kind,setKind]=useState<string|null>(null),[query,setQuery]=useState('');
 const groups=useMemo(()=>groupLog(log||[],{kind,project:filter,query}),[log,kind,filter,query]);
 const counts=useMemo(()=>Object.fromEntries(kinds.map(([k])=>[k,(log||[]).filter(e=>e?.result?.kind===k&&(filter==='all'||!e.project||e.project===filter)).length])),[log,filter]);
 return <div className="aut-tab aut-logtab">
  <section className="ds-card" aria-labelledby="aut-log-title">
   <header className="ds-header"><h2 id="aut-log-title" className="ds-header__title">Registro da autonomia</h2><span className="ds-header__detail">o que o Bunk enviou, pediu ou segurou · por campanha</span></header>
   {!!log?.length&&<div className="aut-logtools">
    <div className="aut-filter" role="group" aria-label="Filtrar por resultado">
     <button type="button" className="ds-chip ds-chip--neutral ds-chip--outlined" aria-pressed={!kind} onClick={()=>setKind(null)}>Tudo</button>
     {kinds.map(([k,l])=><button key={k} type="button" className="ds-chip ds-chip--neutral ds-chip--outlined" aria-pressed={kind===k} onClick={()=>setKind(kind===k?null:k)}>{l} <span className="ds-num">{counts[k]}</span></button>)}
    </div>
    <input type="search" className="ds-field ds-field--sm aut-logtools__search" placeholder="Buscar campanha ou regra" aria-label="Buscar no registro" value={query} onChange={e=>setQuery(e.target.value)}/>
   </div>}
   {!log&&loading?<SkeletonRows label="Carregando o registro do executor…"/>:!log?<Empty>Registro do executor indisponível agora.</Empty>:!log.length?<Empty>Nada ainda. Só aparecem decisões da Sombra que executariam agora em campanhas em Confirmar ou Automático.</Empty>:!groups.length?<Empty>Nada com esses filtros.</Empty>:
    <ul className="aut-loggroups">{groups.slice(0,60).map(g=><li key={g.key} className="aut-loggroup">
     <div className="aut-loggroup__head">
      {g.adAccountId&&g.objectId&&g.project?<button type="button" className="aut-dec__name" onClick={()=>onOpen({project:g.project!,projectName:g.projectName,adAccountId:g.adAccountId!,objectId:String(g.objectId),name:g.campaign})}><span className="ds-truncate" title={g.campaign||undefined}>{g.campaign||'Campanha'}</span><ChevronRight size={14} aria-hidden="true"/></button>:<strong className="ds-truncate">{g.campaign||'Campanha'}</strong>}
      <span className="ds-caption">{showProject&&g.projectName?`${g.projectName} · `:''}{g.entries.length===1?'1 registro':`${g.entries.length} registros`}</span>
     </div>
     <ul className="ds-list ds-list--divided aut-entries">{g.entries.slice(0,20).map((e,i)=>{const [pill,glyph]=kindTone(e.result?.kind);return <li className="autonomy-log" key={i}>
      <span className={`ds-pill ${pill}`}><span className={`ds-glyph ${glyph}`} aria-hidden="true"/>{kindLabel(e.result?.kind)}</span>
      <div className="autonomy-log__main">
       <p>{e.action?(actionLabels as any)[e.action]||e.action:'Ação'}{fin(e.percent)&&e.percent?<> <span className="ds-num">{fmtSignedPct(e.action==='reduce'?-Math.abs(e.percent):e.percent)}</span></>:''} · {e.ruleLabel||'Regra da Sombra'} · {(modeLabels as any)[e.mode]||e.mode}</p>
       {(e.before||e.after)&&<DiffRow action={e.before?.status||e.after?.status?'status':'budget'} before={e.before} after={e.after} percent={null}/>}
       {e.result?.kind==='blocked'?<small>{(e.result.blockers||[]).join(' ')}</small>:<small>{e.result?.text}</small>}
      </div>
      <small className="autonomy-log__at">{stamp(e.at)}</small>
     </li>;})}</ul>
    </li>)}</ul>}
  </section>
 </div>;
}
