'use client';
import {ChevronDown,RefreshCw} from 'lucide-react';
import type {CentralSyncStatus} from './use-office-updates';
import type {LiveData} from './use-live-data';
import {liveDisplayStatus} from '../lib/live-display.mjs';
const stamp=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'N/D';
export default function LiveUpdateNotice({centralSync,refresh,live,liveError='',projectId='',now}: {centralSync:CentralSyncStatus;refresh:()=>Promise<void>;live?:LiveData|null;liveError?:string;projectId?:string;now:number}){
 const item=live?.items.find(entry=>entry.projectId===projectId),status=liveDisplayStatus(item,projectId,{error:liveError,paused:live?.paused,now});
 return <section className={'live-sync-strip'+(status.error||centralSync.status==='unavailable'||centralSync.status==='signed-out'?' has-error':'')} aria-label="Atualização de dados">
  <div className="live-sync-summary" role="status"><span className={'status-dot'+(status.recent?' green-dot':'')}/><strong>{status.label}</strong>{item?.snapshot?.lastSyncAt&&<small>Malva · {stamp(item.snapshot.lastSyncAt)}</small>}</div>
  <div className="live-sync-actions"><details className="live-sync-details"><summary>Detalhes da sincronização <ChevronDown size={13}/></summary><div className="live-sync-detail-body"><p>O painel verifica os dados a cada 10s. O executor deste Mac consulta o Malva a cada {live?.pollIntervalSeconds||60}s, enquanto estiver funcionando.</p>{item?.snapshot?.coverage?.kind==='active-spent-tracked'&&<p>Escopo do acompanhamento: campanhas ativas, com gasto hoje e já acompanhadas. Inclui as pausadas desse grupo; o arquivo completo de campanhas antigas sem atividade não faz parte deste recorte.</p>}<p className="live-sync-times">Última conferência da central: {stamp(centralSync.lastCheckedAt)}. Essa conferência verifica os registros salvos; o horário da coleta Malva aparece abaixo.</p><p className="live-sync-times">Coleta Bunker: {stamp(item?.snapshot?.fetchedAt)} · Sincronização Malva: {stamp(item?.snapshot?.lastSyncAt)}</p>{!status.recent&&!live?.paused&&<p>Aguardando uma nova coleta concluída para confirmar a atualização.</p>}</div></details><button type="button" className="button" onClick={()=>refresh()}><RefreshCw size={14}/> Atualizar dados</button></div>
  {live?.paused&&<p className="live-sync-message">As últimas leituras permanecem visíveis durante a pausa.</p>}
  {status.error&&<p className="live-sync-message is-error" role="alert">{status.error}</p>}
  {centralSync.status==='unavailable'&&<p className="live-sync-message is-error" role="alert"><strong>Conexão com a central indisponível.</strong> Exibindo a última leitura salva. A conferência será repetida automaticamente; seus rascunhos foram preservados.</p>}
  {centralSync.status==='signed-out'&&<p className="live-sync-message is-error" role="alert"><strong>Sua sessão terminou.</strong> <a href="/signin-with-chatgpt" target="_top">Entre novamente</a> para atualizar a central.</p>}
 </section>;
}
