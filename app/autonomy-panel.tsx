'use client';
import {useEffect,useId,useMemo,useState} from 'react';
import type {CSSProperties} from 'react';
import {Bot,CircleOff,Eye,FingerprintPattern,Power,Save,Trash2,Zap} from 'lucide-react';
import {autonomyView,autonomyModes,autonomyActions,autonomyLimits,modeLabels,actionLabels,campaignKey} from '../lib/autonomy-grant.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import './autonomy-panel.css';

/** Autonomy module (owner request of 09/11/2026). The owner sets what the Bunk may do; only "Automático" sends orders,
 * and only within these permissions, through the same executor path as the owner's direct order.
 * Layout (notch design system, 10/11/2026): master card with the general switch and the level legend (explained once),
 * one compact row per project with the level picker, and progressive disclosure for actions, limits and exceptions.
 * Saving, payloads, validation on save and every allowed value are unchanged. */
const modeHelp:Record<string,string>={off:'Não mexe e não sugere ação rápida.',shadow:'Só registra o que faria (como hoje).',confirm:'Prepara e avisa; você executa com Touch ID no notch.',auto:'Executa sozinho dentro dos limites abaixo.'};
const modeIcon:Record<string,typeof Bot>={off:CircleOff,shadow:Eye,confirm:FingerprintPattern,auto:Zap};
const stamp=(v:string|null|undefined)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'N/D';
const numOrNull=(v:string)=>v.trim()===''?null:Number(v.replace(',','.'));
const fmt=(v:number)=>v.toLocaleString('pt-BR',{maximumFractionDigits:2});
const fin=(v:any)=>typeof v==='number'&&Number.isFinite(v);
/** Same ranges the central enforces on save (normalizeAutonomyConfig in lib/autonomy-grant.mjs); here they are only shown inline. */
const limitRules:Record<string,{min:number;max:number;int?:boolean}>={maxIncreasePct:{min:1,max:1000},maxReducePct:{min:1,max:99},budgetCap:{min:1,max:1e9},ordersPerDay:{min:1,max:autonomyLimits.maxOrdersPerDay,int:true}};
const limitIssue=(k:string,v:any)=>{if(v===null||v===undefined)return '';const r=limitRules[k];if(!Number.isFinite(v))return 'Use só números.';if(v<r.min||v>r.max||(r.int&&!Number.isInteger(v)))return `Use um número${r.int?' inteiro':''} de ${fmt(r.min)} a ${fmt(r.max)}.`;return '';};
const hasIssue=(p:any)=>Object.keys(limitRules).some(k=>!!limitIssue(k,p.limits?.[k]));
const autoNames=(list:any[])=>list.filter((p:any)=>p.mode==='auto'||Object.values(p.campaigns||{}).some((c:any)=>c.mode==='auto')).map((p:any)=>p.name);
/** One line with what is enabled for the project (same facts as the controls; a missing limit means that action does not run). */
function permissionSummary(p:any){
 const a=p.actions||{},l=p.limits||{},parts:string[]=[];
 if(a.pause)parts.push('Pausar');
 if(a.reduce)parts.push(fin(l.maxReducePct)?`Reduzir até ${fmt(l.maxReducePct)}%`:'Reduzir (sem redução máxima: não reduz)');
 if(a.increase)parts.push(fin(l.maxIncreasePct)&&fin(l.budgetCap)?`Aumentar até ${fmt(l.maxIncreasePct)}%, teto ${fmt(l.budgetCap)}`:'Aumentar (sem aumento máximo ou teto: não aumenta)');
 if(a.activate)parts.push('Reativar (ainda sem regra)');
 if(!parts.length)return 'Nenhuma ação liberada';
 const n=fin(l.ordersPerDay)?l.ordersPerDay:autonomyLimits.defaultOrdersPerDay;
 return [...parts,`${fmt(n)} ${n===1?'ordem':'ordens'}/dia`].join(' · ');
}
type Log={at:string;projectName:string|null;campaign:string|null;ruleLabel:string|null;mode:string;action:string|null;percent:number|null;result:{kind:string;blockers?:string[];text?:string}};

export default function AutonomyPanel({state,write,saving}:any){
 const saved=useMemo(()=>autonomyView(state),[state]),savedKey=JSON.stringify(saved.projects);
 const [draft,setDraft]=useState<{base:string;projects:any[]}|null>(null);
 const projects=draft?.projects||saved.projects,conflict=!!draft&&draft.base!==savedKey;
 const [error,setError]=useState('');
 const [last,setLast]=useState<'saved'|'failed'|null>(null);
 /** Which button started the write in progress (visual only: picks where the spinner goes; `saving` still gates every control). */
 const [busy,setBusy]=useState<'save'|'on'|'kill'|null>(null);
 const [remote,setRemote]=useState<{log:Log[];shadowProjects:string[]|null;status:any}|null>(null);
 useEffect(()=>{let alive=true;const load=()=>fetch('/api/autonomy',{cache:'no-store'}).then(r=>r.ok?r.json():null).then((d:any)=>{if(alive&&d)setRemote({log:d.log||[],shadowProjects:d.shadowProjects??null,status:d.status||null});}).catch(()=>{});load();const t=setInterval(load,30000);return()=>{alive=false;clearInterval(t);};},[]);
 const orders=useMemo(()=>ownerOrderReceipts(state,{now:Date.now()}).filter((o:any)=>o.by==='bunk'),[state]);
 const edit=(id:string,fn:(p:any)=>any)=>{setLast(null);setDraft(prev=>({base:prev?.base||savedKey,projects:(prev?.projects||saved.projects).map((p:any)=>p.id===id?fn(structuredClone(p)):p)}));};
 const payload=(enabled:boolean)=>({enabled,projects:Object.fromEntries(projects.map((p:any)=>[p.id,{mode:p.mode,actions:p.actions,limits:p.limits,campaigns:p.campaigns}]))});
 async function save(enabled=saved.enabled){
  setError('');if(conflict){setError('As permissões salvas mudaram em outra sessão. Carregue as salvas antes de editar.');return;}
  for(const p of projects){for(const k of ['maxIncreasePct','maxReducePct','budgetCap','ordersPerDay'])if(p.limits[k]!==null&&!Number.isFinite(p.limits[k])){setError(`${p.name}: confira os limites (use só números).`);return;}}
  setBusy(enabled===saved.enabled?'save':'on');let ok;try{ok=await write({op:'autonomyConfig',config:payload(enabled)});}finally{setBusy(null);}if(ok)setDraft(null);setLast(ok?'saved':'failed');
 }
 async function turnOn(){
  const auto=projects.filter((p:any)=>p.mode==='auto'||Object.values(p.campaigns).some((c:any)=>c.mode==='auto')).map((p:any)=>p.name);
  const text=auto.length?`Ligar a autonomia do Bunk?\n\nAutomático em: ${auto.join(', ')}.\nEle vai pausar/ajustar orçamento sozinho dentro dos limites salvos, sempre pelo Malva, uma vez por ordem e com conferência.`:'Ligar a autonomia do Bunk?\n\nNenhum projeto está em Automático: só os projetos em Confirmar vão avisar.';
  if(globalThis.confirm(text))await save(true);
 }
 async function kill(){setError('');setBusy('kill');try{await write({op:'autonomyKill'});}finally{setBusy(null);}}
 const covered=(id:string)=>!remote?.shadowProjects||remote.shadowProjects.includes(id);
 const savedById=useMemo(()=>Object.fromEntries(saved.projects.map((p:any)=>[p.id,JSON.stringify(p)])),[saved.projects]);
 const onReason=useId(),saveStatusId=useId();
 const changed=draft?projects.filter((p:any)=>savedById[p.id]!==JSON.stringify(p)).length:0;
 const savedAuto=autoNames(saved.projects),savedConfirm=saved.projects.some((p:any)=>p.mode==='confirm'||Object.values(p.campaigns||{}).some((c:any)=>c.mode==='confirm')),draftAuto=autoNames(projects).length;
 const now=!saved.enabled?'Agora o Bunk não envia nenhuma ordem sozinho: para isso, a autonomia precisa estar ligada e o projeto (ou a campanha) em Automático.':savedAuto.length?`Agora o Bunk pode enviar ordens sozinho em ${savedAuto.join(', ')}, só dentro das ações e limites salvos.${savedConfirm?' Onde está em Confirmar, ele só prepara e avisa.':''}`:`Agora nenhum projeto está em Automático: o Bunk não envia ordens sozinho.${savedConfirm?' Onde está em Confirmar, ele só prepara e avisa.':''}`;
 const busySave=saving&&busy==='save';
 const pendingText=changed===0?'Rascunho aberto, igual às permissões salvas.':changed===1?'1 projeto com alterações não salvas.':`${changed} projetos com alterações não salvas.`;
 const saveStatus=conflict?{tone:'warn',text:'Rascunho preservado, mas as permissões salvas mudaram em outra sessão.'}:busySave?{tone:'busy',text:'Salvando…'}:draft&&last==='failed'?{tone:'bad',text:`Não foi possível salvar. ${pendingText}`}:draft?{tone:'warn',text:pendingText}:last==='saved'?{tone:'good',text:'Permissões salvas na central.'}:last==='failed'?{tone:'bad',text:'Não foi possível salvar as permissões. Tente de novo.'}:{tone:'info',text:'Sem alterações para salvar.'};
 const statusGlyph:Record<string,string>={good:'ds-glyph--good',bad:'ds-glyph--bad',warn:'ds-glyph--warn',info:'ds-glyph--info'};
 return <div className="autonomy">
  <section className={`ds-card ds-card--lg aut-master ${saved.enabled?'ds-card--accent is-on':''}`} aria-labelledby="aut-master-title">
   <div className="aut-master__head">
    <span className={`ds-badge ${saved.enabled?'ds-badge--accent':'ds-badge--neutral'}`} aria-hidden="true"><Bot size={16}/></span>
    <div className="aut-master__titles">
     <span className="ds-eyebrow">Módulo de autonomia</span>
     <h2 id="aut-master-title" className="ds-headline">{saved.enabled?'O Bunk está no controle onde você permitiu':'Autonomia desligada'}</h2>
    </div>
    <span className={`ds-pill ${saved.enabled?'ds-pill--good':'ds-pill--neutral'} aut-master__state`}><span className={`ds-glyph ${saved.enabled?'ds-glyph--good':'ds-glyph--info'}`} aria-hidden="true"/>{saved.enabled?`Ligada desde ${stamp(saved.enabledAt)}`:saved.disabledAt?`Desligada em ${stamp(saved.disabledAt)}`:'Nunca ligada'}</span>
   </div>
   <p className="aut-master__now">{now}</p>
   <p className="aut-master__how">Você escolhe o nível por projeto e as exceções por campanha. Só o <strong>Automático</strong> envia ordens sozinho, e só quando a Sombra executaria agora, o placar da regra permite e tudo cabe nos seus limites. Cada ordem vai pelo Malva, uma vez, com releitura. Mudar qualquer permissão ou desligar cancela as ordens ainda não enviadas.</p>
   <div className="aut-master__actions">
    {saved.enabled?<button type="button" className="ds-btn ds-btn--danger" disabled={saving} aria-busy={(saving&&busy==='kill')||undefined} onClick={kill}>{saving&&busy==='kill'?<span className="ds-spinner" aria-hidden="true"/>:<Power size={15} aria-hidden="true"/>} Desligar agora</button>:<button type="button" className={`ds-btn ${draft?'':'ds-btn--primary'}`} disabled={saving||!!draft} aria-busy={(saving&&busy==='on')||undefined} aria-describedby={draft?onReason:undefined} onClick={turnOn}>{saving&&busy==='on'?<span className="ds-spinner" aria-hidden="true"/>:<Power size={15} aria-hidden="true"/>} Ligar autonomia</button>}
    {draft&&!saved.enabled&&<p className="ds-disabled-reason" id={onReason}>Salve as permissões antes de ligar.</p>}
   </div>
   <div className="aut-legend" role="list" aria-label="Níveis de autonomia">
    {autonomyModes.map(m=>{const Icon=modeIcon[m];return <div key={m} role="listitem" className={`aut-legend__item mode-${m}`}><span className={`ds-badge ${m==='auto'?'ds-badge--accent':'ds-badge--neutral'}`} aria-hidden="true"><Icon size={14}/></span><span className="aut-legend__text"><strong>{modeLabels[m]}</strong><small>{modeHelp[m]}</small></span></div>;})}
   </div>
  </section>

  {conflict&&<div className="ds-banner ds-banner--warn" role="status"><div className="ds-banner__body"><strong>As permissões salvas mudaram em outra sessão.</strong><p>Seu rascunho foi preservado. Carregue as salvas antes de editar de novo.</p></div><div className="ds-banner__actions"><button type="button" className="ds-btn ds-btn--sm" onClick={()=>setDraft(null)}>Usar as salvas</button></div></div>}
  {error&&<div className="ds-banner ds-banner--bad" role="alert"><div className="ds-banner__body"><strong>{error}</strong></div></div>}

  <section className="ds-card aut-projects" aria-labelledby="aut-projects-title">
   <header className="aut-projects__head">
    <div><span className="ds-eyebrow">Permissões por projeto</span><h2 id="aut-projects-title" className="ds-title">Nível, ações e limites</h2></div>
    <span className="ds-caption aut-projects__count">{projects.length===1?'1 projeto':`${projects.length} projetos`}{draftAuto?` · ${draftAuto} com Automático`:''}</span>
   </header>
   {!projects.length?<p className="ds-empty aut-projects__empty">Nenhum projeto configurado no Bunker ainda: as permissões aparecem aqui quando houver projeto.</p>:
    <ul className="ds-list ds-list--divided aut-list">{projects.map((p:any)=><ProjectRow key={p.id} p={p} state={state} covered={covered(p.id)} disabled={saving} dirty={!!draft&&savedById[p.id]!==JSON.stringify(p)} edit={(fn:any)=>edit(p.id,fn)}/>)}</ul>}
   <div className="aut-savebar">
    <p className={`aut-savebar__status tone-${saveStatus.tone}`} id={saveStatusId} role="status">{saveStatus.tone==='busy'?<span className="ds-spinner" aria-hidden="true"/>:<span className={`ds-glyph ${statusGlyph[saveStatus.tone]}`} aria-hidden="true"/>}<span>{saveStatus.text}</span></p>
    <div className="aut-savebar__actions">
     {draft&&<button type="button" className="ds-btn ds-btn--ghost" disabled={saving} onClick={()=>setDraft(null)}>Descartar alterações</button>}
     <button type="button" className={`ds-btn ${draft?'ds-btn--primary':''}`} disabled={saving||!draft||conflict} aria-busy={busySave||undefined} aria-describedby={saveStatusId} onClick={()=>save()}>{busySave?<span className="ds-spinner" aria-hidden="true"/>:<Save size={15} aria-hidden="true"/>} Salvar permissões</button>
    </div>
   </div>
  </section>

  <div className="aut-history">
   <section className="ds-card aut-log" aria-labelledby="aut-log-title"><span className="ds-eyebrow">O que o Bunk fez ou segurou</span><h2 id="aut-log-title" className="ds-title">Registro da autonomia</h2>
    {!remote?<div className="aut-skeleton" aria-busy="true"><span className="ds-sr-only">Carregando o registro do executor…</span>{[0,1,2].map(i=><div key={i} className="aut-skeleton__row" aria-hidden="true"><span className="ds-skeleton" style={{'--ds-skeleton-w':'96px','--ds-skeleton-h':'18px'} as CSSProperties}/><span className="aut-skeleton__main"><span className="ds-skeleton ds-skeleton--text" style={{'--ds-skeleton-w':'55%'} as CSSProperties}/><span className="ds-skeleton ds-skeleton--text" style={{'--ds-skeleton-w':'80%'} as CSSProperties}/></span></div>)}</div>:!remote.log.length?<p className="ds-empty">Nada ainda. Só aparecem decisões da Sombra que executariam agora em campanhas em Confirmar ou Automático.</p>:
     <ul className="ds-list ds-list--divided aut-entries">{remote.log.slice(0,40).map((e,i)=><li className="autonomy-log" key={i}><span className={`ds-pill ${e.result.kind==='order'?'ds-pill--good':e.result.kind==='confirm'?'ds-pill--warn':'ds-pill--neutral'}`}><span className={`ds-glyph ${e.result.kind==='order'?'ds-glyph--good':e.result.kind==='confirm'?'ds-glyph--waiting':'ds-glyph--info'}`} aria-hidden="true"/>{e.result.kind==='order'?'Ordem enviada ao executor':e.result.kind==='confirm'?'Aguarda você':'Segurado'}</span>
      <div className="autonomy-log__main"><strong>{e.projectName} · {e.campaign||'Campanha'}</strong><p>{e.action?actionLabels[e.action]:'Ação'}{e.percent?<> <span className="ds-num">{e.percent}%</span></>:''} · {e.ruleLabel||'Regra da Sombra'} · {modeLabels[e.mode]||e.mode}</p>{e.result.kind==='blocked'?<small>{(e.result.blockers||[]).join(' ')}</small>:<small>{e.result.text}</small>}</div><small className="autonomy-log__at">{stamp(e.at)}</small></li>)}</ul>}
   </section>
   <section className="ds-card aut-orders" aria-labelledby="aut-orders-title"><span className="ds-eyebrow">Últimas 24h</span><h2 id="aut-orders-title" className="ds-title">Ordens do Bunk</h2>
    {!orders.length?<p className="ds-empty">Nenhuma ordem do Bunk.</p>:<ul className="ds-list ds-list--divided aut-entries">{orders.map((o:any)=><li className="autonomy-order" key={o.id}><strong>{o.projectName} · {o.campaign}</strong><p>{o.action==='status'?'Pausar':<>Orçamento <span className="ds-num">{o.before.dailyBudget} → {o.after.dailyBudget}</span> {o.currency||''}</>}</p><span className={`ds-pill ${o.stage==='confirmed'?'ds-pill--good':o.stage==='failed'||o.stage==='verify'?'ds-pill--bad':'ds-pill--warn'}`}><span className={`ds-glyph ${o.stage==='confirmed'?'ds-glyph--good':o.stage==='failed'||o.stage==='verify'?'ds-glyph--bad':'ds-glyph--waiting'}`} aria-hidden="true"/>{o.label}</span>{o.reason&&<small>{o.reason}</small>}</li>)}</ul>}
    {remote?.status&&!remote.status.ok&&<p className="ds-hint ds-hint--error aut-orders__fail">Última passada com falha: {remote.status.error}</p>}
   </section>
  </div>
 </div>;
}

function ProjectRow({p,state,covered,disabled,dirty,edit}:{p:any;state:any;covered:boolean;disabled:boolean;dirty:boolean;edit:(fn:(p:any)=>any)=>void}){
 const rows=useMemo(()=>{const s=(state.snapshots||[]).filter((x:any)=>x.projectId===p.id&&x.level==='campaign'&&x.period==='today').sort((a:any,b:any)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0];return (s?.rows||[]).filter((r:any)=>String(r.provider||'').toLowerCase()==='meta').map((r:any)=>({key:campaignKey(r.adAccountId,r.externalId),name:r.name||r.externalId,status:r.status})).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name)));},[state,p.id]);
 const [pick,setPick]=useState('');
 const [open,setOpen]=useState(false);
 const uid=useId(),detailId=`${uid}-detail`;
 const exceptions=Object.entries(p.campaigns||{}) as [string,any][];
 const invalid=hasIssue(p),modeIndex=Math.max(0,autonomyModes.indexOf(p.mode));
 const autoExceptions=exceptions.filter(([,c])=>c.mode==='auto').length;
 const limit=(k:string,label:string,unit:string,hint:string)=>{const id=`${uid}-${k}`,issue=limitIssue(k,p.limits[k]);return <div className="ds-form-row aut-limit"><label className="ds-label" htmlFor={id}>{label}</label><div className="aut-limit__input"><input id={id} className="ds-field" type="number" min="0" step="any" inputMode="decimal" value={p.limits[k]??''} placeholder="Não definido" disabled={disabled} aria-invalid={issue?true:undefined} aria-describedby={`${id}-hint${issue?` ${id}-err`:''}`} onChange={e=>edit(x=>{x.limits[k]=numOrNull(e.target.value);return x;})}/><span className="aut-limit__unit" aria-hidden="true">{unit}</span></div><p className="ds-hint" id={`${id}-hint`}>{hint}</p>{issue&&<p className="ds-hint ds-hint--error" id={`${id}-err`}>{issue}</p>}</div>;};
 return <li className={`aut-project autonomy-project mode-${p.mode} ${open?'is-open':''}`}>
  <div className="aut-project__row">
   <button type="button" className="aut-project__toggle" aria-expanded={open} aria-controls={open?detailId:undefined} onClick={()=>setOpen(v=>!v)}>
    <span className="ds-glyph ds-glyph--chevron aut-project__chevron" aria-hidden="true"/>
    <span className={`ds-monogram ${p.mode==='auto'?'ds-monogram--accent':'ds-monogram--tag'}`} aria-hidden="true">{String(p.name||p.id).trim().charAt(0)}</span>
    <span className="aut-project__main">
     <span className="aut-project__name"><span className="ds-truncate" title={p.name}>{p.name}</span>
      {dirty&&<span className="ds-pill ds-pill--warn"><span className="ds-glyph ds-glyph--warn" aria-hidden="true"/>Não salvo</span>}
      {invalid&&<span className="ds-pill ds-pill--bad"><span className="ds-glyph ds-glyph--bad" aria-hidden="true"/>Limite fora da faixa</span>}
      {!covered&&<span className="ds-pill ds-pill--bad" title="A Sombra não avalia este projeto."><span className="ds-glyph ds-glyph--bad" aria-hidden="true"/>Sem Sombra</span>}
     </span>
     <span className="aut-project__sub">{permissionSummary(p)}{exceptions.length?` · ${exceptions.length===1?'1 exceção':`${exceptions.length} exceções`}${autoExceptions?` (${autoExceptions} em Automático)`:''}`:''}</span>
    </span>
   </button>
   <div className={`ds-segmented ds-segmented--sliding aut-levels ${p.mode==='auto'?'is-auto':''}`} role="radiogroup" aria-label={`Nível de ${p.name}`} style={{'--ds-seg-count':autonomyModes.length,'--ds-seg-index':modeIndex} as CSSProperties}>
    {autonomyModes.map(m=>{const Icon=modeIcon[m];return <label key={m} className={`mode-${m}`} title={modeHelp[m]}><input type="radio" name={`mode-${p.id}`} checked={p.mode===m} disabled={disabled} onChange={()=>edit(x=>{x.mode=m;return x;})}/><Icon size={13} aria-hidden="true"/><span>{modeLabels[m]}</span></label>;})}
   </div>
  </div>
  {open&&<div className="aut-detail" id={detailId} role="region" aria-label={`Permissões de ${p.name}`}>
   {p.mode==='auto'&&<div className="ds-banner ds-banner--accent"><div className="ds-banner__body"><strong>Automático: executa sozinho dentro destes limites.</strong><p>Só as ações ligadas abaixo, sem pedir sua confirmação, e só com a autonomia ligada.</p></div></div>}
   {!covered&&<div className="ds-banner ds-banner--bad"><div className="ds-banner__body"><strong>A Sombra não avalia este projeto.</strong><p>Sem limiares na política privada, o Bunk não decide nada aqui, em nenhum nível.</p></div></div>}
   <div className="aut-detail__grid">
    <div className="aut-block">
     <h3 className="ds-eyebrow">O que ele pode fazer</h3>
     <div className="aut-actions">{autonomyActions.map(a=><label className="ds-switch-row" key={a}><span className="aut-actions__text"><span className="ds-body-strong">{actionLabels[a]}</span>{a==='activate'&&<small className="ds-caption">Ainda sem regra da Sombra: nada é reativado sozinho.</small>}</span><input type="checkbox" role="switch" className="ds-switch" checked={!!p.actions[a]} disabled={disabled} onChange={e=>edit(x=>{x.actions[a]=e.target.checked;return x;})}/></label>)}</div>
    </div>
    <div className="aut-block">
     <h3 className="ds-eyebrow">Limites</h3>
     <p className="ds-hint aut-block__lead">Não definido = não faz: sem aumento máximo ou teto, não aumenta; sem redução máxima, não reduz.</p>
     <div className="aut-limits">
      {limit('maxIncreasePct','Aumento máximo por ordem','%','Sem valor, não aumenta.')}
      {limit('maxReducePct','Redução máxima por ordem','%','Até 99%. Sem valor, não reduz.')}
      {limit('budgetCap','Teto de orçamento diário','moeda','Na moeda da campanha. Sem valor, não aumenta.')}
      {limit('ordersPerDay','Ordens por campanha por dia','por dia',`De 1 a 10, e no mínimo 1h entre elas. Em branco, vale ${autonomyLimits.defaultOrdersPerDay}.`)}
     </div>
    </div>
   </div>
   <div className="aut-block">
    <h3 className="ds-eyebrow">Exceções por campanha</h3>
    {!exceptions.length&&<p className="ds-empty">Nenhuma. Todas as campanhas de vendas Meta do projeto seguem o nível acima (aquecimento/engajamento ficam sempre de fora).</p>}
    {!!exceptions.length&&<ul className="ds-list ds-list--divided aut-exceptions">{exceptions.map(([key,c])=><li className="autonomy-exception" key={key}><span className="ds-truncate autonomy-exception__name" title={c.name||key}>{c.name||key}</span><select className="ds-field ds-field--sm" aria-label={`Nível de ${c.name||key}`} value={c.mode} disabled={disabled} onChange={e=>edit(x=>{x.campaigns[key].mode=e.target.value;return x;})}>{autonomyModes.map(m=><option key={m} value={m}>{modeLabels[m]}</option>)}</select><button type="button" className="ds-btn ds-btn--icon ds-btn--sm" aria-label={`Remover exceção ${c.name||key}`} title="Remover exceção" disabled={disabled} onClick={()=>edit(x=>{delete x.campaigns[key];return x;})}><Trash2 size={14} aria-hidden="true"/></button></li>)}</ul>}
    <div className="autonomy-exception add"><select className="ds-field ds-field--sm" aria-label="Campanha para exceção" value={pick} disabled={disabled||!rows.length} onChange={e=>setPick(e.target.value)}><option value="">{rows.length?'Escolha uma campanha…':'Sem leitura de hoje das campanhas'}</option>{rows.filter((r:any)=>!p.campaigns[r.key]).map((r:any)=><option key={r.key} value={r.key}>{r.name}{r.status&&r.status!=='ACTIVE'?` (${r.status})`:''}</option>)}</select>
     <button type="button" className="ds-btn ds-btn--sm" disabled={disabled||!pick} title={!pick?'Escolha uma campanha primeiro.':undefined} onClick={()=>{const r=rows.find((x:any)=>x.key===pick);if(!r)return;edit(x=>{x.campaigns[r.key]={mode:'off',name:r.name};return x;});setPick('');}}>Adicionar (começa Desligado)</button></div>
   </div>
  </div>}
 </li>;
}
