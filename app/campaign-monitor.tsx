'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,ChevronDown,Clock3,RefreshCw,ShieldAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import './campaign-monitor.css';

type Props={state:any;project:string;save:(input:any)=>Promise<boolean>;saving:boolean};
type IncidentStatus='Interrompido'|'Em retomada'|'Encerrado';
type IncidentKind='checkout'|'tracking'|'delivery'|'other';
const kinds:Record<IncidentKind,string>={checkout:'Checkout',tracking:'Medição / pixel',delivery:'Entrega dos anúncios',other:'Outro problema interno'};
const fieldNames:Record<string,string>={status:'Status',effectiveStatus:'Entrega',dailyBudget:'Orçamento diário',lifetimeBudget:'Orçamento total',budgetCurrency:'Moeda'};
const statusNames:Record<string,string>={ACTIVE:'Ativa',PAUSED:'Pausada',CAMPAIGN_PAUSED:'Campanha pausada',ADSET_PAUSED:'Conjunto pausado',WITH_ISSUES:'Com restrição',DELETED:'Excluída',ARCHIVED:'Arquivada',IN_PROCESS:'Em processamento',PENDING_REVIEW:'Em análise'};
const list=(value:any)=>Array.isArray(value)?value:[];
const time=(value:any)=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const stamp=(value:any)=>time(value)?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'Horário não informado';
function fieldValue(field:string,value:any,currency:any){
 if(value===null||value===undefined||value==='')return 'N/D';
 if(['dailyBudget','lifetimeBudget'].includes(field)&&typeof value==='number'&&Number.isFinite(value)){
  if(typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)){try{return value.toLocaleString('pt-BR',{style:'currency',currency});}catch{/* Show the amount without inventing a currency. */}}
  return value.toLocaleString('pt-BR')+' · moeda N/D';
 }
 return ['status','effectiveStatus'].includes(field)?statusNames[String(value)]||String(value):String(value);
}

export default function CampaignMonitor({state,project,save,saving}:Props){
 const [kind,setKind]=useState<IncidentKind>('checkout'),[status,setStatus]=useState<IncidentStatus>('Em retomada'),[note,setNote]=useState(''),[accountId,setAccountId]=useState(''),[updateNote,setUpdateNote]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const request=useRef<{key:string;clientId:string}|null>(null),busy=useRef(false),register=useRef<HTMLDetailsElement>(null),updateIncidentId=useRef<string|null>(null);
 useEffect(()=>{setNote('');setAccountId('');setUpdateNote('');setError('');request.current=null;updateIncidentId.current=null;},[project]);
 const incidents=list(state.incidents).filter((item:any)=>item.project===project).slice().sort((a:any,b:any)=>time(b.reportedAt||b.updatedAt||b.createdAt)-time(a.reportedAt||a.updatedAt||a.createdAt));
 const incident=incidents[0],changes=list(state.campaignChanges).filter((item:any)=>item.project===project).slice().sort((a:any,b:any)=>time(b.observedAt)-time(a.observedAt)),recent=changes.slice(0,12);
 const snapshot=list(state.snapshots).filter((item:any)=>item.projectId===project&&item.period==='today'&&item.level==='campaign').sort((a:any,b:any)=>time(b.fetchedAt)-time(a.fetchedAt))[0];
 const accounts=[...new Map<string,string>(list(snapshot?.rows).filter((row:any)=>typeof row.adAccountId==='string'&&row.adAccountId).map((row:any)=>[row.adAccountId,row.accountName||row.adAccountId] as [string,string])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 const disabled=saving||working||!project;
 async function submit(payload:any){
  if(busy.current||saving)return false;
  busy.current=true;setWorking(true);setError('');
  const key=JSON.stringify(payload);if(request.current?.key!==key)request.current={key,clientId:crypto.randomUUID()};
  try{const ok=await save({...payload,clientId:request.current!.clientId});if(ok)request.current=null;else setError('O registro não foi confirmado. Confira a mensagem da central antes de tentar novamente.');return ok;}
  catch(e:any){setError(e?.message||'Não foi possível confirmar o registro.');return false;}
  finally{busy.current=false;setWorking(false);}
 }
 async function update(next:IncidentStatus){
  if(!incident)return;
  if(updateNote.trim()&&updateIncidentId.current!==incident.id){setError('O incidente mudou em outra sessão. Confira o contexto e escreva a atualização novamente.');return;}
  const reason=updateNote.trim()||(next==='Em retomada'?'Retomada informada pelo responsável; conferir a operação na próxima análise.':'Acompanhamento do incidente encerrado pelo responsável.');
  if(await submit({op:'incidentUpdate',id:incident.id,project,status:next,note:reason})){setUpdateNote('');updateIncidentId.current=null;}
 }
 const scopedNames=list(incident?.scope?.accountIds).map((id:string)=>accounts.find(([account])=>account===id)?.[1]||id);
 return <section className="panel campaign-monitor" aria-label="Retomadas e alterações">
  <header className="cm-heading"><div><h2><RefreshCw size={18}/> Retomadas e alterações</h2><p>Mudou algo no Malva ou na Meta? A próxima leitura confere o cenário.</p></div>{incident&&<span className={'cm-status '+(incident.status==='Interrompido'?'cm-interrupted':incident.status==='Em retomada'?'cm-resuming':'cm-closed')}>{incident.status==='Encerrado'?<Check size={12}/>:<Clock3 size={12}/>} {incident.status}</span>}</header>
  {incident?<div className="cm-incident"><div className="cm-incident-copy"><strong>{kinds[incident.kind as IncidentKind]||'Incidente registrado'} · {scopedNames.length?scopedNames.join(', '):list(incident.scope?.objectIds).length?`${list(incident.scope.objectIds).length} campanhas selecionadas`:'Contexto do projeto'}</strong><p>{incident.note||'Contexto registrado para a próxima análise.'}</p><small>Comunicação registrada: {stamp(incident.reportedAt||incident.updatedAt||incident.createdAt)}. Não é o horário exato de início ou fim do problema.</small></div>{incident.status!=='Encerrado'&&<div className="cm-update"><label>Contexto da atualização <span className="cm-optional">opcional</span><Textarea rows={2} maxLength={2000} value={updateNote} onChange={event=>{updateIncidentId.current=incident.id;setUpdateNote(event.target.value);}} disabled={disabled} placeholder="Ex.: checkout voltou; reativei parte das campanhas."/></label><div className="cm-update-actions">{incident.status==='Interrompido'&&<Button type="button" className="button" disabled={disabled} onClick={()=>update('Em retomada')}><RefreshCw size={14}/> Informar retomada</Button>}<Button type="button" className="button" disabled={disabled} onClick={()=>update('Encerrado')}><Check size={14}/> Encerrar acompanhamento</Button></div></div>}</div>:<p className="cm-empty">Nenhum incidente registrado para este projeto.</p>}
  <div className="cm-details-grid">
   <details className="cm-details" ref={register}><summary><span><ShieldAlert size={15}/> Registrar incidente</span><ChevronDown size={15}/></summary><form className="cm-form" onSubmit={async event=>{event.preventDefault();if(!note.trim()){setError('Descreva o que aconteceu.');return;}if(accountId&&!accounts.some(([id])=>id===accountId)){setError('A conta selecionada mudou. Confira o escopo antes de salvar.');return;}if(await submit({op:'incidentReport',project,kind,status,note:note.trim(),scope:{accountIds:accountId?[accountId]:[],objectIds:[]}})){setNote('');setAccountId('');if(register.current)register.current.open=false;}}}>
    <div className="cm-form-row"><label>O que aconteceu?<select value={kind} disabled={disabled} onChange={event=>setKind(event.target.value as IncidentKind)}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Como está agora?<select value={status} disabled={disabled} onChange={event=>setStatus(event.target.value as IncidentStatus)}><option>Interrompido</option><option>Em retomada</option><option>Encerrado</option></select></label></div>
    <label>Escopo<select value={accountId} disabled={disabled} onChange={event=>setAccountId(event.target.value)}><option value="">Projeto · contexto geral</option>{accounts.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label>
    <label>Contexto<Textarea value={note} required minLength={1} maxLength={2000} rows={3} disabled={disabled} onChange={event=>setNote(event.target.value)} placeholder="Ex.: checkout ficou indisponível; voltou e reativei parte das campanhas."/></label><p className="cm-form-help">O escopo informa onde conferir o problema; não atribui o motivo a cada campanha pausada.</p><Button type="submit" className="button primary" disabled={disabled}>Registrar contexto</Button>
   </form></details>
   <details className="cm-details cm-history"><summary><span><Clock3 size={15}/> Alterações observadas <span className="cm-count">{changes.length}</span></span><ChevronDown size={15}/></summary>{recent.length?<div className="cm-change-list">{recent.map((change:any,index:number)=><article className="cm-change" key={change.id||index}><header><div><strong>{change.name||change.objectId||'Campanha'}</strong><span>{change.accountName||change.adAccountId||'Conta N/D'}</span></div><time dateTime={change.observedAt}>{stamp(change.observedAt)}</time></header><dl>{list(change.changes).map((field:any,fieldIndex:number)=><div key={field.field||fieldIndex}><dt>{fieldNames[field.field]||field.field}</dt><dd><span>{fieldValue(field.field,field.before,change.before?.budgetCurrency)}</span><ArrowRight size={12}/><strong>{fieldValue(field.field,field.after,change.after?.budgetCurrency)}</strong></dd></div>)}</dl><small>Diferença entre leituras; autor e horário exato não confirmados.</small></article>)}{changes.length>12&&<p className="cm-history-note">Exibindo as 12 observações mais recentes. O histórico completo permanece na base.</p>}</div>:<p className="cm-empty">As diferenças de status e orçamento aparecem após novas leituras completas. Ausência de uma campanha na leitura não será tratada como pausa.</p>}</details>
  </div>
  {error&&<p className="cm-error" role="alert">{error}</p>}
  <p className="cm-disclaimer">A próxima análise confere status e orçamento na plataforma. O registro não altera campanhas nem comprova recuperação técnica do checkout.</p>
 </section>;
}
