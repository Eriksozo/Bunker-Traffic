'use client';
import {useId,useState} from 'react';
import {ChevronDown,RefreshCw} from 'lucide-react';
import type {CentralSyncStatus} from './use-office-updates';
import type {LiveData} from './use-live-data';
import {liveDisplayStatus} from '../lib/live-display.mjs';
const stamp=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'N/D';
export default function LiveUpdateNotice({centralSync,refresh,live,liveError='',projectId='',now}: {centralSync:CentralSyncStatus;refresh:()=>Promise<void>;live?:LiveData|null;liveError?:string;projectId?:string;now:number}){
 const [detailsOpen,setDetailsOpen]=useState(false),detailsId=useId();
 const item=live?.items.find(entry=>entry.projectId===projectId),status=liveDisplayStatus(item,projectId,{error:liveError,paused:live?.paused,now});
 const reconciling=!liveError&&item?.error?.code==='SOURCE_CHANGED',centralError=centralSync.status==='unavailable'||centralSync.status==='signed-out';
 return <section className={'live-sync-strip'+((status.error&&!reconciling)||centralError?' has-error':reconciling?' has-warning':'')} aria-label="Atualização de dados">
  <div className="live-sync-summary" role="status"><span className={'status-dot'+(status.recent?' green-dot':'')}/><strong>{status.label}</strong>{item?.snapshot?.lastSyncAt&&<small>Malva · {stamp(item.snapshot.lastSyncAt)}</small>}</div>
  <div className="live-sync-actions"><button type="button" className="live-sync-details-toggle" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={()=>setDetailsOpen(value=>!value)}>Detalhes da sincronização <ChevronDown size={13}/></button><button type="button" className="button" onClick={()=>refresh()}><RefreshCw size={14}/> Atualizar dados</button></div>
  <div className="live-sync-detail-body" id={detailsId} hidden={!detailsOpen}><p>O painel confere a central a cada 10s. O Mac atualiza os projetos em sequência; o intervalo real depende da duração das consultas.</p>{item?.snapshot?.coverage?.kind==='active-spent-tracked'&&<p>Escopo do acompanhamento: campanhas ativas, com gasto hoje e já acompanhadas. Inclui as pausadas desse grupo; o arquivo completo de campanhas antigas sem atividade não faz parte deste recorte.</p>}<p className="live-sync-times">Última conferência da central: {stamp(centralSync.lastCheckedAt)}. Essa conferência verifica os registros salvos; o horário da coleta Malva aparece abaixo.</p><p className="live-sync-times">Coleta Bunker: {stamp(item?.snapshot?.fetchedAt)} · Sincronização Malva: {stamp(item?.snapshot?.lastSyncAt)}</p>{!status.recent&&!live?.paused&&<p>Aguardando uma nova coleta concluída para confirmar a atualização.</p>}</div>
  {live?.paused&&<p className="live-sync-message">As últimas leituras permanecem visíveis durante a pausa.</p>}
  {status.error&&<p className={'live-sync-message '+(reconciling?'is-warning':'is-error')} role={reconciling?'status':'alert'}>{status.error}</p>}
  {centralSync.status==='unavailable'&&<p className="live-sync-message is-error" role="alert"><strong>Conexão com a central indisponível.</strong> Exibindo a última leitura salva. A conferência será repetida automaticamente; seus rascunhos foram preservados.</p>}
  {centralSync.status==='signed-out'&&<p className="live-sync-message is-error" role="alert"><strong>Sua sessão terminou.</strong> <a href="/signin-with-chatgpt" target="_top">Entre novamente</a> para atualizar a central.</p>}
 </section>;
}
