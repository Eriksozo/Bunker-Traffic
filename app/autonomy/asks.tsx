'use client';
/* "Aguardando você": the open requests of the level Confirmar (owner report of 12/11/2026: campaigns in Confirmar never
 * called him). Read-only: the Bunk never sends these; the owner executes each one himself on the notch, with Touch ID. */
import {FingerprintPattern} from 'lucide-react';
import {waitingText} from '../../lib/autonomy-ui.mjs';
import {DiffRow,stamp,type CampaignRef} from './components';

export type Ask={id:string;at:string|null;ageMinutes:number|null;project:string|null;projectName:string|null;adAccountId:string|null;objectId:string|null;campaign:string|null;account?:string|null;action:string|null;actionLabel:string;percent:number|null;before:any;after:any;ruleLabel:string|null;reason?:string|null};

/** What the card may say about the read behind it (lib/autonomy-remote-read.mjs asksView). The failure itself and the
 * reread button live in the panel banner, which also covers the Registro; this card only never claims a count it does not
 * have. Without `read` the list is taken as a confirmed reading. */
export type AsksRead={status:'off'|'loading'|'unavailable'|'ok';stale:boolean;error:string|null;lastSuccessAt:number|null};
const readStamp=(at:number|null)=>at===null?'N/D':stamp(new Date(at).toISOString());
const title=<h2 id="aut-asks-title" className="ds-header__title"><FingerprintPattern size={15} aria-hidden="true"/> Aguardando você</h2>;

export function AsksCard({asks,showProject,onOpen,read}:{asks:Ask[]|null;showProject:boolean;onOpen:(r:CampaignRef)=>void;read?:AsksRead}){
 if(read?.status==='off')return null;
 if(read?.status==='loading')return <p className="ds-caption aut-asks__how" role="status">Lendo os pedidos do nível Confirmar…</p>;
 // A failed read with no good reading: the number of requests is unknown, never zero.
 if(read?.status==='unavailable'||!asks)return <section className="ds-card aut-asks" aria-labelledby="aut-asks-title" role="status">
  <header className="ds-header">{title}<span className="ds-header__detail">pedidos indisponíveis · nível Confirmar</span></header>
  <p className="aut-asks__how">Não foi possível ler os pedidos do Bunk. Sem uma leitura confirmada, o número de pedidos é desconhecido: confira no notch em “Bunk pede a você” ou leia de novo.</p>
 </section>;
 const since=read?.stale?` · leitura de ${readStamp(read.lastSuccessAt)}`:'';
 if(!asks.length)return read?.stale?<section className="ds-card aut-asks" aria-labelledby="aut-asks-title" role="status"><header className="ds-header">{title}<span className="ds-header__detail">nenhum pedido aberto na última leitura confirmada{since}</span></header></section>:null;
 return <section className="ds-card ds-card--accent aut-asks" aria-labelledby="aut-asks-title">
  <header className="ds-header">{title}<span className="ds-header__detail">{asks.length===1?'1 pedido do Bunk':`${asks.length} pedidos do Bunk`} · nível Confirmar{since}</span></header>
  <p className="aut-asks__how">O Bunk não envia estes pedidos. Para executar, abra o notch em “Bunk pede a você”, confira o valor ao vivo e confirme com Touch ID.</p>
  <ul className="aut-asks__list">{asks.map(a=><li key={a.id} className="aut-ask">
   <span className="aut-ask__main">
    <strong className="ds-truncate" title={a.campaign||undefined}>{a.campaign||'Campanha'}</strong>
    <span className="aut-ask__what"><span className="ds-pill ds-pill--warn">{a.actionLabel}</span>{a.action&&<DiffRow action={a.action==='pause'||a.action==='activate'?'status':'budget'} before={a.before} after={a.after} percent={a.percent===null?null:a.action==='reduce'?-a.percent:a.percent}/>}{a.ruleLabel&&<span>{a.ruleLabel}</span>}<span>{showProject&&a.projectName?`${a.projectName} · `:''}{waitingText(a.ageMinutes)}</span></span>
    {a.reason&&<small className="ds-caption">{a.reason}</small>}
   </span>
   {a.project&&a.adAccountId&&a.objectId&&<button type="button" className="ds-btn ds-btn--sm" onClick={()=>onOpen({project:a.project!,projectName:a.projectName,adAccountId:a.adAccountId!,objectId:a.objectId!,name:a.campaign})}>Ver campanha</button>}
  </li>)}</ul>
 </section>;
}
