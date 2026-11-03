'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,RefreshCw} from 'lucide-react';
import type {LiveData} from './use-live-data';
import {liveDisplayStatus} from '../lib/live-display.mjs';
const stamp=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'N/D';
export default function LiveUpdateNotice({revision,refresh,live,liveError='',projectId='',now}: {revision:number;refresh:()=>Promise<void>;live?:LiveData|null;liveError?:string;projectId?:string;now:number}){
 const current=useRef(revision),checking=useRef(false);
 const [available,setAvailable]=useState<{revision:number;updatedAt:string}|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{current.current=revision;},[revision]);
 useEffect(()=>{
  let disposed=false;
  async function check(){
   if(document.visibilityState!=='visible'||checking.current)return;
   checking.current=true;
   try{const r=await fetch('/api/state?revisionOnly=1',{cache:'no-store'});if(!r.ok)throw Error('Não foi possível conferir novas atualizações.');
    const d:{revision:number;updatedAt:string}=await r.json();if(disposed)return;setError('');if(d.revision>current.current)setAvailable({revision:d.revision,updatedAt:d.updatedAt});
   }catch(e){if(!disposed)setError(e instanceof Error?e.message:'Não foi possível conferir novas atualizações.');}finally{checking.current=false;}
  }
  const visible=()=>{if(document.visibilityState==='visible')void check();};
  const timer=setInterval(check,60000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);void check();
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const item=live?.items.find(entry=>entry.projectId===projectId),status=liveDisplayStatus(item,projectId,{error:liveError,paused:live?.paused,now});
 return <section className={'live-sync-strip'+(status.error||error?' has-error':'')} aria-label="Atualização de dados">
  <div className="live-sync-summary" role="status"><span className={'status-dot'+(status.recent?' green-dot':'')}/><strong>{status.label}</strong>{item?.snapshot?.lastSyncAt&&<small>Malva · {stamp(item.snapshot.lastSyncAt)}</small>}</div>
  <div className="live-sync-actions"><details className="live-sync-details"><summary>Detalhes da sincronização <ChevronDown size={13}/></summary><div className="live-sync-detail-body"><p>O painel verifica os dados a cada 10s. O executor deste Mac consulta o Malva a cada {live?.pollIntervalSeconds||60}s, enquanto estiver funcionando.</p>{item?.snapshot?.coverage?.kind==='active-spent-tracked'&&<p>Escopo do acompanhamento: campanhas ativas, com gasto hoje e já acompanhadas. Inclui as pausadas desse grupo; o arquivo completo de campanhas antigas sem atividade não faz parte deste recorte.</p>}<p className="live-sync-times">Coleta Bunker: {stamp(item?.snapshot?.fetchedAt)} · Sincronização Malva: {stamp(item?.snapshot?.lastSyncAt)}</p>{!status.recent&&!live?.paused&&<p>Aguardando uma nova coleta concluída para confirmar a atualização.</p>}</div></details><button type="button" className="button" onClick={()=>refresh()}><RefreshCw size={14}/> Atualizar dados</button></div>
  {live?.paused&&<p className="live-sync-message">As últimas leituras permanecem visíveis durante a pausa.</p>}
  {status.error&&<p className="live-sync-message is-error" role="alert">{status.error}</p>}
  {available&&available.revision>revision&&<p className="live-sync-message"><strong>Há novas revisões de análise disponíveis.</strong> Salvas em {stamp(available.updatedAt)}. Seus rascunhos em edição são preservados ao atualizar.</p>}
  {error&&<p className="live-sync-message is-error" role="alert"><strong>Conferência da base de análise indisponível.</strong> Use Recarregar central para tentar novamente. Os dados exibidos não foram substituídos.</p>}
 </section>;
}
