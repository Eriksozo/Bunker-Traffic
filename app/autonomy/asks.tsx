'use client';
/* "Aguardando você": the open requests of the level Confirmar (owner report of 12/11/2026: campaigns in Confirmar never
 * called him). Read-only: the Bunk never sends these; the owner executes each one himself on the notch, with Touch ID. */
import {FingerprintPattern} from 'lucide-react';
import {waitingText} from '../../lib/autonomy-ui.mjs';
import {DiffRow,type CampaignRef} from './components';

export type Ask={id:string;at:string|null;ageMinutes:number|null;project:string|null;projectName:string|null;adAccountId:string|null;objectId:string|null;campaign:string|null;account?:string|null;action:string|null;actionLabel:string;percent:number|null;before:any;after:any;ruleLabel:string|null;reason?:string|null};

export function AsksCard({asks,showProject,onOpen}:{asks:Ask[];showProject:boolean;onOpen:(r:CampaignRef)=>void}){
 if(!asks.length)return null;
 return <section className="ds-card ds-card--accent aut-asks" aria-labelledby="aut-asks-title">
  <header className="ds-header"><h2 id="aut-asks-title" className="ds-header__title"><FingerprintPattern size={15} aria-hidden="true"/> Aguardando você</h2><span className="ds-header__detail">{asks.length===1?'1 pedido do Bunk':`${asks.length} pedidos do Bunk`} · nível Confirmar</span></header>
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
