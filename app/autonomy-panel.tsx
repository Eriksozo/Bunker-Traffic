'use client';
import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle,Check,CheckCircle2,ChevronDown,Clock,Hand,Info,Pause,Play,Plus,Power,Save,ShieldAlert,ShieldCheck,Trash2,TrendingDown,TrendingUp} from 'lucide-react';
import {autonomyView,autonomyModes,autonomyActions,modeLabels,actionLabels,campaignKey} from '../lib/autonomy-grant.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import './autonomy-panel.css';

/** Autonomy module (owner request of 09/11/2026). The owner sets what the Bunk may do; only "Automático" sends orders,
 * and only within these permissions, through the same executor path as the owner's direct order.
 * Layout follows the notch: one island with the state and the one prominent action, compact project rows that open
 * for details, and a floating bar for unsaved changes. */
const modeHelp:Record<string,string>={off:'O Bunk não mexe nem sugere ação rápida.',shadow:'Só registra o que faria. Nada é enviado.',confirm:'Ele prepara e avisa; você aprova no notch com Touch ID.',auto:'Ele envia a ordem sozinho, dentro dos limites abaixo.'};
const modeTone:Record<string,string>={off:'neutral',shadow:'neutral',confirm:'warn',auto:'good'};
const actionShort:Record<string,string>={pause:'Pausar',reduce:'Reduzir',increase:'Aumentar',activate:'Reativar'};
const actionIcon:Record<string,any>={pause:Pause,reduce:TrendingDown,increase:TrendingUp,activate:Play};
const stamp=(v:string|null|undefined)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'N/D';
const numOrNull=(v:string)=>v.trim()===''?null:Number(v.replace(',','.'));
const has=(v:any)=>typeof v==='number'&&Number.isFinite(v);
const acts=(p:any)=>p.mode==='confirm'||p.mode==='auto';
type Log={at:string;projectName:string|null;campaign:string|null;ruleLabel:string|null;mode:string;action:string|null;percent:number|null;result:{kind:string;blockers?:string[];text?:string}};

/** What is allowed but cannot happen yet, said before the owner turns it on. */
function gaps(p:any){
 const out:string[]=[];
 if(!acts(p))return out;
 if(!autonomyActions.some(a=>p.actions[a]))out.push('Nenhuma ação marcada');
 if(p.actions.increase&&(!has(p.limits.maxIncreasePct)||!has(p.limits.budgetCap)))out.push('Aumento sem % máximo ou teto');
 if(p.actions.reduce&&!has(p.limits.maxReducePct))out.push('Redução sem % máximo');
 return out;
}
function summary(p:any){
 if(!acts(p))return modeHelp[p.mode];
 const a=autonomyActions.filter(x=>p.actions[x]).map(x=>x==='reduce'&&has(p.limits.maxReducePct)?`Reduzir até ${p.limits.maxReducePct}%`:x==='increase'&&has(p.limits.maxIncreasePct)?`Aumentar até ${p.limits.maxIncreasePct}%`:actionShort[x]);
 const n=Object.keys(p.campaigns||{}).length,per=has(p.limits.ordersPerDay)?p.limits.ordersPerDay:2;
 return [a.length?a.join(' · '):'Nenhuma ação marcada',`${per} ${per===1?'ordem':'ordens'}/dia por campanha`,n?`${n} ${n===1?'exceção':'exceções'}`:null].filter(Boolean).join(' · ');
}

export default function AutonomyPanel({state,write,saving}:any){
 const saved=useMemo(()=>autonomyView(state),[state]),savedKey=JSON.stringify(saved.projects);
 const [draft,setDraft]=useState<{base:string;projects:any[]}|null>(null);
 const projects=draft?.projects||saved.projects,conflict=!!draft&&draft.base!==savedKey;
 const [error,setError]=useState('');
 const [open,setOpen]=useState<string|null>(null);
 const [asking,setAsking]=useState(false);
 const [remote,setRemote]=useState<{log:Log[];shadowProjects:string[]|null;status:any}|null>(null);
 useEffect(()=>{let alive=true;const load=()=>fetch('/api/autonomy',{cache:'no-store'}).then(r=>r.ok?r.json():null).then((d:any)=>{if(alive&&d)setRemote({log:d.log||[],shadowProjects:d.shadowProjects??null,status:d.status||null});}).catch(()=>{});load();const t=setInterval(load,30000);return()=>{alive=false;clearInterval(t);};},[]);
 const orders=useMemo(()=>ownerOrderReceipts(state,{now:Date.now()}).filter((o:any)=>o.by==='bunk'),[state]);
 const edit=(id:string,fn:(p:any)=>any)=>setDraft(prev=>({base:prev?.base||savedKey,projects:(prev?.projects||saved.projects).map((p:any)=>p.id===id?fn(structuredClone(p)):p)}));
 const payload=(enabled:boolean)=>({enabled,projects:Object.fromEntries(projects.map((p:any)=>[p.id,{mode:p.mode,actions:p.actions,limits:p.limits,campaigns:p.campaigns}]))});
 async function save(enabled=saved.enabled){
  setError('');if(conflict){setError('As permissões salvas mudaram em outra sessão. Carregue as salvas antes de editar.');return false;}
  for(const p of projects){for(const k of ['maxIncreasePct','maxReducePct','budgetCap','ordersPerDay'])if(p.limits[k]!==null&&!Number.isFinite(p.limits[k])){setError(`${p.name}: confira os limites (use só números).`);setOpen(p.id);return false;}}
  if(await write({op:'autonomyConfig',config:payload(enabled)})){setDraft(null);return true;}
  return false;
 }
 async function kill(){setError('');setAsking(false);await write({op:'autonomyKill'});}
 const covered=(id:string)=>!remote?.shadowProjects||remote.shadowProjects.includes(id);
 const count=(m:string)=>projects.filter((p:any)=>p.mode===m).length;
 const inMode=(m:string)=>projects.filter((p:any)=>p.mode===m||Object.values(p.campaigns||{}).some((c:any)=>c.mode===m)).map((p:any)=>p.name);
 const auto=inMode('auto'),confirm=inMode('confirm'),on=saved.enabled;
 const pending=projects.filter((p:any)=>gaps(p).length).map((p:any)=>p.name);
 return <div className="autonomy">
  <div className="autonomy-main">
   <section className={`ns-island autonomy-island ${on?'ns-tone-good':'ns-tone-neutral'}`} aria-label="Interruptor geral da autonomia">
    <div className="ns-island-row">
     <span className={`ns-dot ${on?'pulse':''}`} aria-hidden="true"/>
     <div className="ns-island-copy"><h2>{on?'O Bunk está no controle onde você permitiu':'Autonomia desligada'}</h2><p>{on?`Ligada desde ${stamp(saved.enabledAt)}. Desligar cancela na hora as ordens que ainda não saíram.`:saved.disabledAt?`Desligada em ${stamp(saved.disabledAt)}. Nenhum nível age enquanto estiver desligada.`:'Nunca foi ligada. Nenhum nível age enquanto estiver desligada.'}</p></div>
     {on?<button type="button" className="button danger" disabled={saving} onClick={kill}><Power size={15}/> Desligar agora</button>
       :!asking&&<button type="button" className="button primary" disabled={saving||conflict} onClick={()=>{setError('');setAsking(true);}}><Power size={15}/> {draft?'Salvar e ligar':'Ligar autonomia'}</button>}
    </div>
    <div className="ns-chips autonomy-counts" aria-label="Projetos por nível">
     {autonomyModes.slice().reverse().map((m:string)=><span key={m} className={`ns-chip ns-tone-${count(m)?modeTone[m]:'neutral'}`}>{count(m)} em {modeLabels[m]}</span>)}
    </div>
    {asking&&!on&&<div className={`ns-banner autonomy-ask ns-tone-${auto.length?'good':'neutral'}`} role="alertdialog" aria-label="Confirmar ligar a autonomia">
     {auto.length?<ShieldCheck/>:<Info/>}
     <div><strong>{auto.length?`Automático em ${auto.join(', ')}.`:'Nenhum projeto está em Automático.'}</strong> {auto.length?'O Bunk vai pausar e ajustar orçamento sozinho nesses projetos, dentro dos limites salvos, uma ordem por vez e com conferência.':confirm.length?`Só ${confirm.join(', ')} vai avisar e esperar seu Touch ID.`:'Ligar agora não muda nada: escolha Confirmar ou Automático em algum projeto.'}{pending.length>0&&<> Atenção em {pending.join(', ')}: há ação marcada sem limite, e ela não acontece.</>}
      <div className="button-row"><button type="button" className="button primary" disabled={saving} onClick={async()=>{if(await save(true))setAsking(false);}}><Power size={15}/> Confirmar e ligar</button><button type="button" className="button subtle" disabled={saving} onClick={()=>setAsking(false)}>Cancelar</button></div>
     </div>
    </div>}
   </section>

   {conflict&&<div className="ns-banner ns-tone-warn" role="status"><AlertTriangle/><div><strong>As permissões salvas mudaram em outra sessão.</strong> Seu rascunho foi preservado, mas não pode ser salvo por cima. <button type="button" className="link" onClick={()=>setDraft(null)}>Usar as salvas</button></div></div>}
   {error&&<div className="ns-banner ns-tone-bad" role="alert"><AlertTriangle/><div>{error}</div></div>}

   <section>
    <div className="ns-section"><h2>Projetos</h2><span>escolha o nível · abra para ações, limites e exceções</span></div>
    <div className="autonomy-projects">{projects.map((p:any)=><ProjectCard key={p.id} p={p} state={state} covered={covered(p.id)} disabled={saving} open={open===p.id} toggle={()=>setOpen(open===p.id?null:p.id)} reveal={()=>setOpen(p.id)} edit={(fn:any)=>edit(p.id,fn)}/>)}</div>
   </section>

   {draft&&<div className="ns-savebar" role="region" aria-label="Alterações não salvas"><span><span className="ns-dot ns-tone-warn" aria-hidden="true"/> Alterações não salvas</span><button type="button" className="button subtle" disabled={saving} onClick={()=>{setDraft(null);setError('');}}>Descartar</button><button type="button" className="button primary" disabled={saving||conflict} onClick={()=>save()}><Save size={15}/> Salvar permissões</button></div>}
  </div>

  <aside className="autonomy-rail">
   <section>
    <div className="ns-section"><h2>Ordens do Bunk</h2><span>últimas 24h</span></div>
    <div className="ns-card ns-list">
     {!orders.length?<div className="ns-empty autonomy-pad"><Info/> Nenhuma ordem do Bunk.</div>:orders.map((o:any)=>{const tone=o.stage==='confirmed'?'good':o.stage==='failed'||o.stage==='verify'?'bad':'warn';return <div className="ns-row" key={o.id}><span className={`ns-badge ns-tone-${tone}`}>{tone==='good'?<Check/>:tone==='bad'?<AlertTriangle/>:<Clock/>}</span><div className="ns-row-copy"><strong title={o.campaign}>{o.campaign}</strong><small>{o.projectName} · {o.action==='status'?'Pausar':`Orçamento ${o.before.dailyBudget} → ${o.after.dailyBudget} ${o.currency||''}`}</small><small>{o.label}{o.reason?` · ${o.reason}`:''}</small></div></div>;})}
    </div>
   </section>
   <section>
    <div className="ns-section"><h2>Registro</h2><span>o que o Bunk fez ou segurou</span></div>
    {remote?.status&&!remote.status.ok&&<div className="ns-banner ns-tone-bad autonomy-gap"><AlertTriangle/><div>Última passada com falha: {remote.status.error}</div></div>}
    <div className="ns-card ns-list">
     {!remote?<div className="ns-empty autonomy-pad"><Clock/> Carregando o registro do executor…</div>:!remote.log.length?<div className="ns-empty autonomy-pad"><Info/> Nada ainda. Só entram decisões que a Sombra executaria agora, em campanhas em Confirmar ou Automático.</div>:
      remote.log.slice(0,40).map((e,i)=>{const k=e.result.kind,tone=k==='order'?'good':k==='confirm'?'warn':'neutral';return <div className="ns-row autonomy-log" key={i}><span className={`ns-badge ns-tone-${tone}`} title={k==='order'?'Ordem enviada ao executor':k==='confirm'?'Aguarda você':'Segurado'}>{k==='order'?<Check/>:k==='confirm'?<Hand/>:<ShieldAlert/>}</span>
       <div className="ns-row-copy"><strong title={e.campaign||''}>{e.campaign||'Campanha'}</strong><small>{k==='order'?'Ordem enviada':k==='confirm'?'Aguarda você':'Segurado'} · {e.action?actionShort[e.action]:'Ação'}{e.percent?` ${e.percent}%`:''} · {e.projectName}</small><small>{k==='blocked'?(e.result.blockers||[]).join(' '):e.result.text}</small><small><time dateTime={e.at}>{stamp(e.at)}</time></small></div></div>;})}
    </div>
   </section>
  </aside>
 </div>;
}

function ProjectCard({p,state,covered,disabled,open,toggle,reveal,edit}:{p:any;state:any;covered:boolean;disabled:boolean;open:boolean;toggle:()=>void;reveal:()=>void;edit:(fn:(p:any)=>any)=>void}){
 const rows=useMemo(()=>{const s=(state.snapshots||[]).filter((x:any)=>x.projectId===p.id&&x.level==='campaign'&&x.period==='today').sort((a:any,b:any)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0];return (s?.rows||[]).filter((r:any)=>String(r.provider||'').toLowerCase()==='meta').map((r:any)=>({key:campaignKey(r.adAccountId,r.externalId),name:r.name||r.externalId,status:r.status})).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name)));},[state,p.id]);
 const [pick,setPick]=useState('');
 const exceptions=Object.entries(p.campaigns||{}) as [string,any][],missing=gaps(p);
 const limit=(k:string,label:string,unit:string,help:string,need:boolean)=>{const warn=need&&!has(p.limits[k]);return <label className={`ns-field ${warn?'warn':''}`}><span>{label}</span><div className="ns-field-box"><input type="number" min="0" step="any" inputMode="decimal" value={p.limits[k]??''} placeholder="—" disabled={disabled} onChange={e=>edit(x=>{x.limits[k]=numOrNull(e.target.value);return x;})}/><em>{unit}</em></div><small>{warn?'Falta preencher: '+help:help}</small></label>;};
 const segmented=(name:string,value:string,label:string,set:(m:string)=>void)=><div className="ns-seg" role="radiogroup" aria-label={label}>{autonomyModes.map((m:string)=><label key={m} className={`ns-tone-${modeTone[m]}`} title={modeHelp[m]}><input type="radio" name={name} checked={value===m} disabled={disabled} onChange={()=>set(m)}/><span>{modeLabels[m]}</span></label>)}</div>;
 return <article className={`ns-card autonomy-project ${open?'selected':''}`}>
  <div className="ns-row autonomy-project-head">
   <span className={`ns-badge ns-tone-${acts(p)?modeTone[p.mode]:'accent'}`} aria-hidden="true">{String(p.name||'?').slice(0,1).toUpperCase()}</span>
   <button type="button" className="ns-row-copy autonomy-project-open" aria-expanded={open} onClick={toggle}><strong>{p.name}</strong><small>{summary(p)}</small></button>
   {!covered&&<span className="ns-chip ns-tone-bad" title="Sem limiares na política privada da Sombra, o Bunk não decide nada aqui, em nenhum nível."><ShieldAlert/> Sem Sombra</span>}
   {covered&&missing.length>0&&<span className="ns-chip ns-tone-warn" title={missing.join(' · ')}><AlertTriangle/> Falta limite</span>}
   {segmented(`mode-${p.id}`,p.mode,`Nível de ${p.name}`,m=>{edit(x=>{x.mode=m;return x;});if(m==='confirm'||m==='auto')reveal();})}
   <button type="button" className={`ns-icon-button autonomy-chevron ${open?'open':''}`} aria-label={open?`Fechar ${p.name}`:`Abrir ${p.name}`} onClick={toggle}><ChevronDown/></button>
  </div>
  {open&&<div className="autonomy-detail">
   {!covered&&<div className="ns-banner ns-tone-bad"><ShieldAlert/><div><strong>A Sombra não avalia este projeto.</strong> Sem limiares na política privada, o Bunk não decide nada aqui, em nenhum nível.</div></div>}
   <p className="autonomy-mode-help"><span className={`ns-dot ns-tone-${modeTone[p.mode]}`} aria-hidden="true"/> <strong>{modeLabels[p.mode]}:</strong> {modeHelp[p.mode]}</p>
   <div className="autonomy-block">
    <h3>O que ele pode fazer</h3>
    <div className="ns-chips">{autonomyActions.map((a:string)=>{const Icon=actionIcon[a],onNow=!!p.actions[a];return <button type="button" key={a} className="ns-toggle" aria-pressed={onNow} disabled={disabled} onClick={()=>edit(x=>{x.actions[a]=!onNow;return x;})}>{onNow?<Check/>:<Icon/>}{actionLabels[a]}</button>;})}</div>
    {p.actions.activate&&<small className="autonomy-note">Reativar ainda não tem regra da Sombra: nada é reativado sozinho.</small>}
   </div>
   <div className="autonomy-block">
    <h3>Limites</h3>
    <div className="autonomy-limits">
     {limit('maxReducePct','Redução máxima por ordem','%','sem valor, não reduz',acts(p)&&!!p.actions.reduce)}
     {limit('maxIncreasePct','Aumento máximo por ordem','%','sem valor, não aumenta',acts(p)&&!!p.actions.increase)}
     {limit('budgetCap','Teto de orçamento diário','moeda','sem valor, não aumenta',acts(p)&&!!p.actions.increase)}
     {limit('ordersPerDay','Ordens por campanha por dia','1 a 10','mínimo de 1h entre elas',false)}
    </div>
   </div>
   <div className="autonomy-block">
    <h3>Exceções por campanha</h3>
    {!exceptions.length&&<small className="autonomy-note">Nenhuma. Todas as campanhas de vendas Meta seguem o nível do projeto. Aquecimento e engajamento ficam sempre de fora.</small>}
    {exceptions.length>0&&<div className="autonomy-exceptions">{exceptions.map(([key,c])=><div className="autonomy-exception" key={key}><span title={c.name||key}>{c.name||key}</span>{segmented(`ex-${p.id}-${key}`,c.mode,`Nível de ${c.name||key}`,m=>edit(x=>{x.campaigns[key].mode=m;return x;}))}<button type="button" className="ns-icon-button" aria-label={`Remover exceção de ${c.name||key}`} disabled={disabled} onClick={()=>edit(x=>{delete x.campaigns[key];return x;})}><Trash2/></button></div>)}</div>}
    <div className="autonomy-add"><select aria-label="Campanha para exceção" value={pick} disabled={disabled||!rows.length} onChange={e=>setPick(e.target.value)}><option value="">{rows.length?'Escolha uma campanha…':'Sem leitura de hoje das campanhas'}</option>{rows.filter((r:any)=>!p.campaigns[r.key]).map((r:any)=><option key={r.key} value={r.key}>{r.name}{r.status&&r.status!=='ACTIVE'?` (${r.status})`:''}</option>)}</select>
     <button type="button" className="button" disabled={disabled||!pick} title="A exceção começa em Desligado" onClick={()=>{const r=rows.find((x:any)=>x.key===pick);if(!r)return;edit(x=>{x.campaigns[r.key]={mode:'off',name:r.name};return x;});setPick('');}}><Plus size={14}/> Adicionar exceção</button></div>
    <small className="autonomy-note">Toda exceção nova começa em Desligado.</small>
   </div>
  </div>}
 </article>;
}
