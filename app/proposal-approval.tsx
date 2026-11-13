'use client';
/* Exact confirmation before approving a proposal in the Escritório: the Cards' "Confirmação da ação exata" presentation
 * (same classes and copy as the approval dialog in app/decision-cards.tsx). Presentation and one confirm step only: the
 * approval still goes through the panel's own review() and the backend's checks. */
import {useRef,useState} from 'react';
import {ArrowRight,Check,ShieldCheck,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {proposalApprovalView} from '../lib/proposal-approval-view.mjs';
import './decision-cards.css';

type View=ReturnType<typeof proposalApprovalView>;
const finite=(value:any):value is number=>typeof value==='number'&&Number.isFinite(value);
const date=(value:any)=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'N/D';};
const money=(value:any,currency:string|null)=>{if(!finite(value)||!currency)return 'N/D';try{return value.toLocaleString('pt-BR',{style:'currency',currency});}catch{return `${value.toLocaleString('pt-BR')} ${currency}`;}};
const levelName=(value:any)=>({campaign:'Campanha',adset:'Conjunto',ad:'Anúncio',account:'Conta'} as Record<string,string>)[value]||'Objeto';
const statusName=(value:any)=>({ACTIVE:'Ativo',PAUSED:'Pausado',ARCHIVED:'Arquivado',DELETED:'Excluído'} as Record<string,string>)[String(value)]||String(value||'Status N/D');

/** The exact rows: campaign and account, before → after in the native currency, version, validity and identification. */
export function ProposalApprovalSummary({view}:{view:View}){
 const budget=view.kind==='budget',pct=view.changePercent;
 return <>
  <p className="dc-modal-campaign">{view.campaign||'Objeto sem nomenclatura registrada'}<small>{view.accountName||'Conta N/D'} · {view.provider||'Plataforma N/D'} {view.objectId||'ID N/D'}</small></p>
  {budget?<div className="dc-preview-wrap"><div className="dc-preview"><span><small>Diário atual · {view.currency||'moeda N/D'}</small><strong>{money(view.before,view.currency)}</strong></span><ArrowRight size={19} aria-hidden="true"/><span><small>Diário proposto</small><strong>{money(view.after,view.currency)}</strong></span>{pct!==null&&<b className={'dc-percent dc-'+(pct<0?'reduce':'increase')}>{pct>0?'+':pct<0?'−':''}{Math.abs(pct).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</b>}</div></div>
   :<div className={'dc-preview'+(view.after==='PAUSED'?' dc-preview-pause':'')}><span><small>Status atual</small><strong>{statusName(view.before)}</strong></span><ArrowRight size={19} aria-hidden="true"/><span><small>Status proposto</small><strong>{statusName(view.after)}</strong></span></div>}
  <div className="dc-approval-scope"><span>Versão {view.version??'N/D'}</span><span>Válida até {date(view.expiresAt)}</span>{budget&&<span>Moeda {view.currency||'N/D'}</span>}</div>
  <dl className="cp-proposal-identity"><div><dt>{levelName(view.level)}</dt><dd className="ds-mono">{view.objectId||'N/D'}</dd></div><div><dt>Conta</dt><dd className="ds-mono">{view.adAccountId||'N/D'}</dd></div><div><dt>Plataforma</dt><dd>{view.provider||'N/D'}</dd></div></dl>
 </>;
}

/** The dialog. `onAuthorize` is the panel's existing approve call; nothing is sent before the owner ticks the box. */
export function ProposalApprovalDialog({view,busy,canAuthorize,onClose,onAuthorize}:{view:View;busy:boolean;canAuthorize:boolean;onClose:()=>void;onAuthorize:()=>void}){
 const [confirmed,setConfirmed]=useState(false),cancel=useRef<HTMLButtonElement>(null);
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="dc-modal" showCloseButton={false} onOpenAutoFocus={event=>{event.preventDefault();cancel.current?.focus();}} onInteractOutside={event=>{if(busy)event.preventDefault();}} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
  <button type="button" className="dc-modal-close ds-btn ds-btn--icon" aria-label="Fechar aprovação" disabled={busy} onClick={onClose}><X size={20}/></button>
  <span className="dc-modal-icon" aria-hidden="true"><ShieldCheck size={27}/></span>
  <span className="dc-eyebrow">Confirmação da ação exata</span>
  <DialogTitle asChild><h2>Autorizar esta execução?</h2></DialogTitle>
  <ProposalApprovalSummary view={view}/>
  <DialogDescription>Você autoriza somente o objeto, a conta, a moeda e os valores desta versão. O executor na nuvem aplica e relê o objeto; autorização ainda não comprova aplicação.</DialogDescription>
  <label className="dc-confirm-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/><span>Conferi o objeto e autorizo a execução exata exibida acima.</span></label>
  <div className="dc-modal-actions"><button ref={cancel} type="button" className="dc-button ds-btn ds-btn--secondary" disabled={busy} onClick={onClose}>Voltar à proposta</button><button type="button" className="dc-button dc-primary ds-btn ds-btn--primary" disabled={!confirmed||busy||!canAuthorize} aria-busy={busy||undefined} onClick={onAuthorize}>{busy?<span className="ds-spinner" aria-hidden="true"/>:<Check size={15} aria-hidden="true"/>}Autorizar execução</button></div>
 </DialogContent></Dialog>;
}
