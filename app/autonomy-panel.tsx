'use client';
import {useEffect,useMemo,useState} from 'react';
import {Bot,Power,Save,ShieldAlert,Trash2} from 'lucide-react';
import {autonomyView,autonomyModes,autonomyActions,modeLabels,actionLabels,campaignKey} from '../lib/autonomy-grant.mjs';
import {ownerOrderReceipts} from '../lib/owner-orders.mjs';
import './autonomy-panel.css';

/** Autonomy module (owner request of 09/11/2026). The owner sets what the Bunk may do; only "Automático" sends orders,
 * and only within these permissions, through the same executor path as the owner's direct order. */
const modeHelp:Record<string,string>={off:'Não mexe e não sugere ação rápida.',shadow:'Só registra o que faria (como hoje).',confirm:'Prepara e avisa; você executa com Touch ID no notch.',auto:'Executa sozinho dentro dos limites abaixo.'};
const stamp=(v:string|null|undefined)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'N/D';
const numOrNull=(v:string)=>v.trim()===''?null:Number(v.replace(',','.'));
type Log={at:string;projectName:string|null;campaign:string|null;ruleLabel:string|null;mode:string;action:string|null;percent:number|null;result:{kind:string;blockers?:string[];text?:string}};

export default function AutonomyPanel({state,write,saving}:any){
 const saved=useMemo(()=>autonomyView(state),[state]),savedKey=JSON.stringify(saved.projects);
 const [draft,setDraft]=useState<{base:string;projects:any[]}|null>(null);
 const projects=draft?.projects||saved.projects,conflict=!!draft&&draft.base!==savedKey;
 const [error,setError]=useState('');
 const [remote,setRemote]=useState<{log:Log[];shadowProjects:string[]|null;status:any}|null>(null);
 useEffect(()=>{let alive=true;const load=()=>fetch('/api/autonomy',{cache:'no-store'}).then(r=>r.ok?r.json():null).then((d:any)=>{if(alive&&d)setRemote({log:d.log||[],shadowProjects:d.shadowProjects??null,status:d.status||null});}).catch(()=>{});load();const t=setInterval(load,30000);return()=>{alive=false;clearInterval(t);};},[]);
 const orders=useMemo(()=>ownerOrderReceipts(state,{now:Date.now()}).filter((o:any)=>o.by==='bunk'),[state]);
 const edit=(id:string,fn:(p:any)=>any)=>setDraft(prev=>({base:prev?.base||savedKey,projects:(prev?.projects||saved.projects).map((p:any)=>p.id===id?fn(structuredClone(p)):p)}));
 const payload=(enabled:boolean)=>({enabled,projects:Object.fromEntries(projects.map((p:any)=>[p.id,{mode:p.mode,actions:p.actions,limits:p.limits,campaigns:p.campaigns}]))});
 async function save(enabled=saved.enabled){
  setError('');if(conflict){setError('As permissões salvas mudaram em outra sessão. Carregue as salvas antes de editar.');return;}
  for(const p of projects){for(const k of ['maxIncreasePct','maxReducePct','budgetCap','ordersPerDay'])if(p.limits[k]!==null&&!Number.isFinite(p.limits[k])){setError(`${p.name}: confira os limites (use só números).`);return;}}
  if(await write({op:'autonomyConfig',config:payload(enabled)}))setDraft(null);
 }
 async function turnOn(){
  const auto=projects.filter((p:any)=>p.mode==='auto'||Object.values(p.campaigns).some((c:any)=>c.mode==='auto')).map((p:any)=>p.name);
  const text=auto.length?`Ligar a autonomia do Bunk?\n\nAutomático em: ${auto.join(', ')}.\nEle vai pausar/ajustar orçamento sozinho dentro dos limites salvos, sempre pelo Malva, uma vez por ordem e com conferência.`:'Ligar a autonomia do Bunk?\n\nNenhum projeto está em Automático: só os projetos em Confirmar vão avisar.';
  if(globalThis.confirm(text))await save(true);
 }
 async function kill(){setError('');await write({op:'autonomyKill'});}
 const covered=(id:string)=>!remote?.shadowProjects||remote.shadowProjects.includes(id);
 return <div className="autonomy">
  <section className={`panel autonomy-master ${saved.enabled?'on':''}`}>
   <div className="panel-title"><div><span className="eyebrow">MÓDULO DE AUTONOMIA</span><h2>{saved.enabled?'O Bunk está no controle onde você permitiu':'Autonomia desligada'}</h2></div><Bot size={22}/></div>
   <p>Você escolhe o nível por projeto e as exceções por campanha. Só o <strong>Automático</strong> envia ordens sozinho, e só quando a Sombra executaria agora, o placar da regra permite e tudo cabe nos seus limites. Cada ordem vai pelo Malva, uma vez, com releitura. Mudar qualquer permissão ou desligar cancela as ordens ainda não enviadas.</p>
   <div className="button-row autonomy-switch">
    {saved.enabled?<button type="button" className="button danger" disabled={saving} onClick={kill}><Power size={15}/> Desligar agora</button>:<button type="button" className="button primary" disabled={saving||!!draft} onClick={turnOn}><Power size={15}/> Ligar autonomia</button>}
    <span className={`pill ${saved.enabled?'green':'gray'}`}>{saved.enabled?`Ligada desde ${stamp(saved.enabledAt)}`:saved.disabledAt?`Desligada em ${stamp(saved.disabledAt)}`:'Nunca ligada'}</span>
    {draft&&!saved.enabled&&<small>Salve as permissões antes de ligar.</small>}
   </div>
  </section>

  {conflict&&<div className="notice" role="status"><div><strong>As permissões salvas mudaram em outra sessão.</strong><p>Seu rascunho foi preservado. Carregue as salvas antes de editar de novo.</p></div><button type="button" className="button" onClick={()=>setDraft(null)}>Usar as salvas</button></div>}
  {error&&<div className="notice red" role="alert"><strong>{error}</strong></div>}

  <div className="autonomy-projects">{projects.map((p:any)=><ProjectCard key={p.id} p={p} state={state} covered={covered(p.id)} disabled={saving} edit={(fn:any)=>edit(p.id,fn)}/>)}</div>
  <div className="button-row autonomy-save"><button type="button" className="button primary" disabled={saving||!draft||conflict} onClick={()=>save()}><Save size={15}/> Salvar permissões</button>{draft&&<button type="button" className="button subtle" disabled={saving} onClick={()=>setDraft(null)}>Descartar alterações</button>}</div>

  <div className="dashboard-grid autonomy-history">
   <section className="panel"><div className="panel-title"><div><span className="eyebrow">O QUE O BUNK FEZ OU SEGUROU</span><h2>Registro da autonomia</h2></div></div>
    {!remote?<p className="hint">Carregando o registro do executor…</p>:!remote.log.length?<p className="hint">Nada ainda. Só aparecem decisões da Sombra que executariam agora em campanhas em Confirmar ou Automático.</p>:
     remote.log.slice(0,40).map((e,i)=><div className="autonomy-log" key={i}><span className={`pill ${e.result.kind==='order'?'green':e.result.kind==='confirm'?'amber':'gray'}`}>{e.result.kind==='order'?'Ordem enviada ao executor':e.result.kind==='confirm'?'Aguarda você':'Segurado'}</span>
      <div><strong>{e.projectName} · {e.campaign||'Campanha'}</strong><p>{e.action?actionLabels[e.action]:'Ação'}{e.percent?` ${e.percent}%`:''} · {e.ruleLabel||'Regra da Sombra'} · {modeLabels[e.mode]||e.mode}</p>{e.result.kind==='blocked'?<small>{(e.result.blockers||[]).join(' ')}</small>:<small>{e.result.text}</small>}</div><small>{stamp(e.at)}</small></div>)}
   </section>
   <section className="panel compact"><div className="panel-title"><div><span className="eyebrow">ÚLTIMAS 24H</span><h2>Ordens do Bunk</h2></div></div>
    {!orders.length?<p className="hint">Nenhuma ordem do Bunk.</p>:orders.map((o:any)=><div className="autonomy-order" key={o.id}><strong>{o.projectName} · {o.campaign}</strong><p>{o.action==='status'?'Pausar':`Orçamento ${o.before.dailyBudget} → ${o.after.dailyBudget} ${o.currency||''}`}</p><span className={`pill ${o.stage==='confirmed'?'green':o.stage==='failed'||o.stage==='verify'?'red':'amber'}`}>{o.label}</span>{o.reason&&<small>{o.reason}</small>}</div>)}
    {remote?.status&&!remote.status.ok&&<p className="hint">Última passada com falha: {remote.status.error}</p>}
   </section>
  </div>
 </div>;
}

function ProjectCard({p,state,covered,disabled,edit}:{p:any;state:any;covered:boolean;disabled:boolean;edit:(fn:(p:any)=>any)=>void}){
 const rows=useMemo(()=>{const s=(state.snapshots||[]).filter((x:any)=>x.projectId===p.id&&x.level==='campaign'&&x.period==='today').sort((a:any,b:any)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0];return (s?.rows||[]).filter((r:any)=>String(r.provider||'').toLowerCase()==='meta').map((r:any)=>({key:campaignKey(r.adAccountId,r.externalId),name:r.name||r.externalId,status:r.status})).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name)));},[state,p.id]);
 const [pick,setPick]=useState('');
 const exceptions=Object.entries(p.campaigns||{}) as [string,any][];
 const limit=(k:string,label:string,suffix:string,help?:string)=><label>{label}<input type="number" min="0" step="any" inputMode="decimal" value={p.limits[k]??''} placeholder="Não definido" disabled={disabled} onChange={e=>edit(x=>{x.limits[k]=numOrNull(e.target.value);return x;})}/><small>{suffix}{help?` · ${help}`:''}</small></label>;
 return <section className={`panel autonomy-project mode-${p.mode}`}>
  <div className="panel-title"><div><span className="eyebrow">PROJETO</span><h2>{p.name}</h2></div><span className={`pill ${p.mode==='auto'?'green':p.mode==='confirm'?'amber':'gray'}`}>{modeLabels[p.mode]}</span></div>
  {!covered&&<div className="notice red"><ShieldAlert size={16}/><div><strong>A Sombra não avalia este projeto.</strong><p>Sem limiares na política privada, o Bunk não decide nada aqui, em nenhum nível.</p></div></div>}
  <div className="autonomy-modes" role="radiogroup" aria-label={`Nível de ${p.name}`}>{autonomyModes.map(m=><label key={m} className={p.mode===m?'selected':''}><input type="radio" name={`mode-${p.id}`} checked={p.mode===m} disabled={disabled} onChange={()=>edit(x=>{x.mode=m;return x;})}/><strong>{modeLabels[m]}</strong><small>{modeHelp[m]}</small></label>)}</div>
  <h3>O que ele pode fazer</h3>
  <div className="autonomy-actions">{autonomyActions.map(a=><label className="checkbox" key={a}><input type="checkbox" checked={!!p.actions[a]} disabled={disabled} onChange={e=>edit(x=>{x.actions[a]=e.target.checked;return x;})}/><span>{actionLabels[a]}{a==='activate'&&<small> · ainda sem regra da Sombra: nada é reativado sozinho</small>}</span></label>)}</div>
  <h3>Limites</h3>
  <div className="form-grid autonomy-limits">
   {limit('maxIncreasePct','Aumento máximo por ordem','%','sem valor, não aumenta')}
   {limit('maxReducePct','Redução máxima por ordem','% (até 99)','sem valor, não reduz')}
   {limit('budgetCap','Teto de orçamento diário','na moeda da campanha','sem valor, não aumenta')}
   {limit('ordersPerDay','Ordens por campanha por dia','1 a 10','e no mínimo 1h entre elas')}
  </div>
  <h3>Exceções por campanha</h3>
  {!exceptions.length&&<p className="hint">Nenhuma. Todas as campanhas de vendas Meta do projeto seguem o nível acima (aquecimento/engajamento ficam sempre de fora).</p>}
  {exceptions.map(([key,c])=><div className="autonomy-exception" key={key}><span>{c.name||key}</span><select aria-label={`Nível de ${c.name||key}`} value={c.mode} disabled={disabled} onChange={e=>edit(x=>{x.campaigns[key].mode=e.target.value;return x;})}>{autonomyModes.map(m=><option key={m} value={m}>{modeLabels[m]}</option>)}</select><button type="button" className="button subtle" aria-label="Remover exceção" disabled={disabled} onClick={()=>edit(x=>{delete x.campaigns[key];return x;})}><Trash2 size={14}/></button></div>)}
  <div className="autonomy-exception add"><select aria-label="Campanha para exceção" value={pick} disabled={disabled||!rows.length} onChange={e=>setPick(e.target.value)}><option value="">{rows.length?'Escolha uma campanha…':'Sem leitura de hoje das campanhas'}</option>{rows.filter((r:any)=>!p.campaigns[r.key]).map((r:any)=><option key={r.key} value={r.key}>{r.name}{r.status&&r.status!=='ACTIVE'?` (${r.status})`:''}</option>)}</select>
   <button type="button" className="button" disabled={disabled||!pick} onClick={()=>{const r=rows.find((x:any)=>x.key===pick);if(!r)return;edit(x=>{x.campaigns[r.key]={mode:'off',name:r.name};return x;});setPick('');}}>Adicionar (começa Desligado)</button></div>
 </section>;
}
