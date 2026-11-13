'use client';
/** Autonomia do Bunk · Modo Gestor (owner requests of 09/11 and 10/11/2026), Phase 1 cockpit. Shell only: the island,
 * five tabs (Agora / Aprendizado / Placar / Permissões / Registro) and the campaign drawer live in app/autonomy/.
 * Reads: the plain `/api/autonomy` (log, Sombra coverage, status: unchanged) and the deep read model
 * `/api/autonomy?view=deep&project=` (contract a, docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md), both GET.
 * Writes: only the owner's `autonomyConfig` / `autonomyKill` (useAutonomyDraft in app/autonomy/permissions.tsx), with the
 * CAS check on the saved revision. Learned plays only observe in this phase: nothing here adopts, releases or sends them. */
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import {Island} from './autonomy/island';
import {NowTab} from './autonomy/now';
import {LearningTab} from './autonomy/learning';
import {ScoreTab} from './autonomy/score';
import {PermissionsTab,useAutonomyDraft,type ProjectCtx} from './autonomy/permissions';
import {LogTab,type LogEntry} from './autonomy/log';
import {AsksCard} from './autonomy/asks';
import {asksView,createRemoteReader,remoteReadInitial,remoteReadPolicy} from '../lib/autonomy-remote-read.mjs';
import {CampaignDrawer} from './autonomy/drawer';
import {stamp,type CampaignRef} from './autonomy/components';
import './autonomy-panel.css';

export const cockpitTabs=[['agora','Agora'],['aprendizado','Aprendizado'],['placar','Placar'],['permissoes','Permissões'],['registro','Registro']] as const;
type Tab=typeof cockpitTabs[number][0];
type Remote={log:LogEntry[];shadowProjects:string[]|null;status:any;asks:any[]|null};
type RemoteRead={data:Remote|null;loading:boolean;error:string|null;lastSuccessAt:number|null;failedAt:number|null};
type DeepState={key:string;data:any|null;error:string|null;loading:boolean};

/** The deep read model for the chosen project (or all), every 30 s while the page is visible. A 503 ("em preparação") or a
 * missing route keeps the last good reading and shows the message; it never turns into zeros. */
function useDeepView(project:string):DeepState{
 const [s,setS]=useState<DeepState>({key:project,data:null,error:null,loading:true});
 useEffect(()=>{
  let alive=true;
  const load=()=>{
   if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
   fetch(`/api/autonomy?view=deep&project=${encodeURIComponent(project)}`,{cache:'no-store'}).then(async r=>{
    const j:any=await r.json().catch(()=>null);if(!alive)return;
    if(r.ok&&j&&typeof j==='object'&&j.projects&&typeof j.projects==='object')setS({key:project,data:j,error:null,loading:false});
    else setS(prev=>({key:project,data:prev.key===project?prev.data:null,error:typeof j?.error==='string'?j.error:'Leitura detalhada da autonomia indisponível agora.',loading:false}));
   }).catch(()=>{if(alive)setS(prev=>({key:project,data:prev.key===project?prev.data:null,error:'Executor da nuvem indisponível.',loading:false}));});
  };
  load();const t=setInterval(load,30000);return()=>{alive=false;clearInterval(t);};
 },[project]);
 return s.key===project?s:{key:project,data:null,error:null,loading:true};
}

export default function AutonomyPanel({state,write,saving,liveItems=null,liveNow}:any){
 const ctl=useAutonomyDraft(state,write);
 const [tab,setTab]=useState<Tab>('agora');
 const [filter,setFilter]=useState('all');
 const [open,setOpen]=useState<CampaignRef|null>(null);
 const [now,setNow]=useState(()=>Date.now());
 /** The plain read: loading, failure and the last good reading kept apart (lib/autonomy-remote-read.mjs). A failed read
  * never becomes "no requests" and never wipes a good reading. Single flight with a finite timeout: the 30 s poll never
  * discards a slow valid answer, and a hung request is aborted after 45 s so the next poll or "Ler de novo" retries. */
 const [read,setRead]=useState<RemoteRead>(remoteReadInitial);
 const reader=useRef<ReturnType<typeof createRemoteReader>|null>(null);
 useEffect(()=>{
  const r=createRemoteReader({request:signal=>fetch('/api/autonomy',{cache:'no-store',signal}),update:setRead});reader.current=r;void r.load();
  const t=setInterval(()=>{void r.load();setNow(Date.now());},remoteReadPolicy.pollMs);
  return()=>{clearInterval(t);r.dispose();reader.current=null;};
 },[]);
 const loadRemote=useCallback(()=>{void reader.current?.load();},[]);
 const remote=read.data;
 /** A project removed from the config falls back to all. */
 const projectIds=ctl.saved.projects.map((p:any)=>p.id);
 const scope=filter==='all'||projectIds.includes(filter)?filter:'all';
 const deep=useDeepView(scope);
 const orders=useMemo(()=>ownerOrderReceipts(state,{now:Date.now()}).filter((o:any)=>o.by==='bunk'),[state]);
 const covered=useCallback((id:string)=>!remote?.shadowProjects||remote.shadowProjects.includes(id),[remote]);
 const contexts=useMemo(()=>Object.fromEntries(Object.entries<any>(deep.data?.projects||{}).map(([id,p])=>[id,{campaigns:p?.now?.campaigns??null,team:p?.team??null,plays:p?.playbook?.plays??null} as ProjectCtx])),[deep.data]);
 const showProject=scope==='all'&&ctl.saved.projects.length>1;
 /** Open requests of the level Confirmar: shown above every tab, so a request is never hidden behind one. */
 const asksRead=useMemo(()=>asksView(read,{enabled:ctl.saved.enabled,now,project:scope}),[read,ctl.saved.enabled,now,scope]);
 const tabRefs=useRef<Record<string,HTMLButtonElement|null>>({});
 function onTabKey(e:ReactKeyboardEvent<HTMLDivElement>){
  const i=cockpitTabs.findIndex(([k])=>k===tab),n=cockpitTabs.length;
  const to=e.key==='ArrowRight'?(i+1)%n:e.key==='ArrowLeft'?(i-1+n)%n:e.key==='Home'?0:e.key==='End'?n-1:-1;
  if(to<0)return;e.preventDefault();const k=cockpitTabs[to][0];setTab(k);tabRefs.current[k]?.focus();
 }
 const loading=deep.loading&&!deep.data;
 return <div className="autonomy">
  <Island deep={deep.data} deepError={deep.error} ctl={ctl} saving={saving} now={now} filter={scope} setFilter={setFilter}/>
  {ctl.conflict&&<div className="ds-banner ds-banner--warn" role="status"><div className="ds-banner__body"><strong>As permissões salvas mudaram em outra sessão.</strong><p>Seu rascunho foi preservado. Carregue as salvas antes de editar de novo.</p></div><div className="ds-banner__actions"><button type="button" className="ds-btn ds-btn--sm" onClick={ctl.discard}>Usar as salvas</button></div></div>}
  {ctl.error&&<div className="ds-banner ds-banner--bad" role="alert"><div className="ds-banner__body"><strong>{ctl.error}</strong></div></div>}
  {remote?.status&&!remote.status.ok&&<p className="ds-hint ds-hint--error">Última passada da autonomia com falha: {remote.status.error}</p>}
  {read.error&&<div className="ds-banner ds-banner--warn" role="status"><div className="ds-banner__body"><strong>{remote?'Leitura do executor desatualizada.':'Leitura do executor indisponível.'}</strong><p>{read.error} {remote?`Pedidos e registro mostram a última leitura confirmada, de ${stamp(new Date(read.lastSuccessAt??0).toISOString())}.`:'Pedidos do nível Confirmar e registro ficam sem número até uma leitura confirmar.'}</p></div><div className="ds-banner__actions"><button type="button" className="ds-btn ds-btn--sm" onClick={loadRemote} disabled={read.loading} aria-busy={read.loading||undefined}>{read.loading?'Lendo…':'Ler de novo'}</button></div></div>}
  <AsksCard asks={asksRead.asks as any} read={asksRead as any} showProject={showProject} onOpen={setOpen}/>
  <nav className="ds-tabs ds-tabs--underline aut-tabs" role="tablist" aria-label="Autonomia do Bunk" onKeyDown={onTabKey}>
   {cockpitTabs.map(([k,l])=><button key={k} ref={el=>{tabRefs.current[k]=el;}} type="button" role="tab" id={`aut-tab-${k}`} aria-selected={tab===k} aria-controls={tab===k?`aut-panel-${k}`:undefined} tabIndex={tab===k?0:-1} onClick={()=>setTab(k)}>{l}{k==='permissoes'&&ctl.draft?<span className="aut-tabs__dot" title="Alterações não salvas"><span className="ds-sr-only"> (alterações não salvas)</span></span>:null}</button>)}
  </nav>
  <div role="tabpanel" id={`aut-panel-${tab}`} aria-labelledby={`aut-tab-${tab}`} className="aut-panel">
   {tab==='agora'&&<NowTab deep={deep.data} loading={loading} fallbackOrders={orders} showProject={showProject} onOpen={setOpen}/>}
   {tab==='aprendizado'&&<LearningTab deep={deep.data} loading={loading} showProject={showProject} onOpen={setOpen}/>}
   {tab==='placar'&&<ScoreTab deep={deep.data} loading={loading} showProject={showProject} onOpen={setOpen}/>}
   {tab==='permissoes'&&<PermissionsTab ctl={ctl} state={state} saving={saving} covered={covered} contexts={contexts} liveItems={liveItems} now={liveNow??now}/>}
   {tab==='registro'&&<LogTab log={remote?remote.log:null} loading={read.loading&&!remote} filter={scope} showProject={showProject} onOpen={setOpen}/>}
  </div>
  <CampaignDrawer target={open} deep={deep.data} log={remote?.log||[]} saved={ctl.saved} onClose={()=>setOpen(null)}/>
 </div>;
}
