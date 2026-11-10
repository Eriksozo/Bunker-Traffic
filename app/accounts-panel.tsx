'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {RefreshCw,Search,X} from 'lucide-react';
import {accountMatches} from '../lib/account-limits.mjs';
import './accounts-panel.css';

// Without the account currency the number is shown bare with "moeda N/D", never under a guessed currency symbol.
const money=(n:any,currency?:string|null)=>typeof n!=='number'||!Number.isFinite(n)?'N/D':currency&&/^[A-Z]{3}$/.test(currency)?n.toLocaleString('pt-BR',{style:'currency',currency,maximumFractionDigits:2}):n.toLocaleString('pt-BR',{maximumFractionDigits:2})+' (moeda N/D)';
const brl=(n:any)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'N/D';
const stamp=(v?:string|null)=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'N/D';};
const metaErrors:Record<string,string>={META_TOKEN_MISSING:'Token de leitura da Meta ainda não cadastrado.',META_190:'Token da Meta inválido ou expirado.',META_200:'O token da Meta não tem permissão de leitura dessas contas.',META_NETWORK:'Sem resposta da Meta na última leitura.'};
const building='O painel ainda está sendo montado. Ele atualiza a cada 30 minutos.';
// Presentation only: the dot repeats, in color, the situation the row already says in text.
const statusTone=(r:any)=>r.status==='active'?(r.projects?.length?'good':'neutral'):r.status==='disabled'||r.status==='closed'||r.status==='pending-closure'?'bad':r.status?'warn':'neutral';
const alertTone=(a:string)=>/atingido|Caiu/.test(a)?'bad':'warn';
const columns=[['Conta',''],['Grupo',''],['Situação',''],['Gasto hoje','is-num'],['Limite diário','is-num'],['Uso',''],['Saldo','is-num'],['Alertas','']] as const;

/** Replaces the manual daily account planning: status, project, today's spend vs Meta's daily limit, balance. Read-only. */
export default function AccountsPanel(){
 const [panel,setPanel]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[group,setGroup]=useState('all'),[onlyActive,setOnlyActive]=useState(true),[query,setQuery]=useState('');
 const search=useRef<HTMLInputElement>(null);
 async function load(){setLoading(true);setError('');try{const r=await fetch('/api/accounts',{cache:'no-store'});const d:any=await r.json();if(!r.ok)throw Error(d?.error||'Falha ao ler as contas.');setPanel(d.panel);if(!d.panel)setError(d.unavailable?'Executor indisponível agora.':building);}catch(e:any){setError(e?.message||'Falha ao ler as contas.');}finally{setLoading(false);}}
 useEffect(()=>{load();const t=setInterval(load,5*60000);return ()=>clearInterval(t);},[]);
 const groups=useMemo(()=>[...new Set((panel?.rows||[]).map((r:any)=>r.group))] as string[],[panel]);
 const rows=useMemo(()=>(panel?.rows||[]).filter((r:any)=>(group==='all'||r.group===group)&&accountMatches(r,query)&&(query.trim()||!onlyActive||r.status==='active'||r.alerts?.length)),[panel,group,onlyActive,query]);
 const c=panel?.counts,q=query.trim(),firstLoad=loading&&!panel&&!error;
 const counts:[string,any,boolean][]=c?[['Ativas',c.active,false],['Rodando',c.running,false],['Desabilitadas',c.disabled,false],['Perto do limite',c.nearLimit,!!c.nearLimit],['Com limite lido',c.withLimit,false]]:[];
 function clear(){setQuery('');search.current?.focus();}
 return <section className="panel ds-card ds-card--lg accounts-panel" aria-label="Contas de anúncio" aria-busy={loading||undefined}>
  <header className="ap-head">
   <div className="ap-head__text"><span className="ds-eyebrow">Planejamento de contas</span><h2 className="ds-headline">Contas de anúncio</h2></div>
   <div className="ap-head__actions">{panel&&<span className="ds-caption ap-stamp">Última montagem <span className="ds-tabular">{stamp(panel.generatedAt)}</span></span>}
    <button type="button" className="ds-btn ds-btn--icon" onClick={load} disabled={loading} aria-label="Recarregar contas" title={loading?'Lendo as contas…':'Recarregar contas'}>{loading?<span className="ds-spinner" aria-hidden="true"/>:<RefreshCw aria-hidden="true"/>}</button></div>
  </header>
  <p className="ds-body ap-lede">Atualiza sozinho a cada 30 minutos: situação e projeto vêm do Malva; limite diário vem da Meta (ou do Malva, quando a Meta não informa) e gasto de hoje vem da Meta, na moeda da conta. Somente leitura.</p>
  <div className="ap-notices">
   {panel&&!panel.metaConnected&&<div className="ds-banner ds-banner--warn"><div className="ds-banner__body"><strong>Limite diário: {metaErrors[panel.metaError]||'leitura da Meta indisponível.'}</strong><p>O restante do painel funciona; limites aparecem como N/D.</p></div></div>}
   {panel?.metaConnected&&panel?.metaDiagnostic?.message&&(panel.counts?.withLimit?<p className="ds-hint ap-note">{panel.metaDiagnostic.message}</p>:<div className="ds-banner ds-banner--warn"><div className="ds-banner__body">{panel.metaDiagnostic.message}</div></div>)}
   {error&&(error===building&&!panel?<div className="ds-empty ds-empty--waiting ds-empty--block ap-waiting"><p>{error}</p></div>:<div className="ds-banner ds-banner--bad" role="alert"><div className="ds-banner__body">{error}</div></div>)}
  </div>
  {firstLoad&&<div className="ap-loading" role="status" aria-label="Carregando contas">
   <div className="ds-kpi-grid ap-counts" aria-hidden="true">{[0,1,2,3,4].map(i=><div key={i} className="ds-kpi ds-kpi--tile"><span className="ds-skeleton ds-skeleton--text" style={{'--ds-skeleton-w':'60%'} as any}/><span className="ds-skeleton ds-skeleton--stat"/></div>)}</div>
   <div className="ap-loading__rows" aria-hidden="true">{[0,1,2,3].map(i=><span key={i} className="ds-skeleton ds-skeleton--block" style={{'--ds-skeleton-h':'44px'} as any}/>)}</div>
  </div>}
  {c&&<ul className="ds-kpi-grid ap-counts" aria-label="Resumo das contas">{counts.map(([label,value,bad])=><li key={label} className={'ds-kpi ds-kpi--tile'+(bad?' is-bad':'')}><span className="ds-kpi__label">{bad&&<span className="ds-glyph ds-glyph--bad" aria-hidden="true"/>}{label}</span><strong className="ds-kpi__value">{value}</strong></li>)}</ul>}
  {panel&&<div className="ap-filters" role="search" aria-label="Filtrar contas">
   <div className="ap-search"><Search size={14} aria-hidden="true" className="ap-search__icon"/><input ref={search} type="search" className="ds-field" placeholder="Buscar conta por nome ou ID" aria-label="Buscar conta por nome ou ID" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&query){e.preventDefault();setQuery('');}}}/>
    {query&&<button type="button" className="ds-btn ds-btn--icon ds-btn--sm ap-search__clear" aria-label="Limpar busca" title="Limpar busca" onClick={clear}><X aria-hidden="true"/></button>}</div>
   <select className="ds-field ap-group" aria-label="Grupo de contas" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Todos os grupos</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select>
   <label className="ap-toggle"><input type="checkbox" className="ds-switch" role="switch" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)}/><span>Só ativas ou com alerta</span></label>
  </div>}
  {panel&&q&&onlyActive&&<p className="ds-hint ap-filter-note">Com busca, o filtro “Só ativas ou com alerta” não se aplica.</p>}
  {panel&&<div className="table-scroll ap-table-wrap"><table className="ap-table"><thead><tr>{columns.map(([h,cls])=><th key={h} scope="col" className={cls||undefined}>{h}</th>)}</tr></thead>
   <tbody>{!rows.length&&<tr className="ap-empty-row"><td colSpan={8}><p className="ds-empty">{q?`Nenhuma conta com “${q}”.`:'Nenhuma conta neste filtro.'}</p></td></tr>}{rows.map((r:any)=>{const tone=statusTone(r),hot=r.usedPct!==null&&r.usedPct>=80;return <tr key={r.accountId}>
    <td data-label="Conta" className="ap-account"><strong className="ap-name" title={r.name||r.accountId}>{r.name||r.accountId}</strong><small className="ap-sub ds-mono">{r.accountId}</small></td>
    <td data-label="Grupo"><span className="ds-pill ds-pill--tag">{r.group}</span></td>
    <td data-label="Situação"><span className="ap-status"><span className={'ds-dot ds-dot--sm ds-dot--'+tone} aria-hidden="true"/>{r.runningLabel}</span></td>
    <td data-label="Gasto hoje" className="is-num">{r.todaySpend===null?<span className="ds-num" title="Gasto do Malva, em reais">{brl(r.spendTodayBrl)}</span>:<span className="ds-num">{money(r.todaySpend,r.currency)}</span>}</td>
    <td data-label="Limite diário" className="is-num">{r.dailyLimit===null?<span className="ap-nd">N/D</span>:<span title={'Limite definido pela Meta, lido via '+r.limitSource}><span className="ds-num">{money(r.dailyLimit,r.currency)}</span>{r.limitSource==='Malva'&&<small className="ap-sub">via Malva</small>}</span>}</td>
    <td data-label="Uso">{r.usedPct===null?<span className="ap-nd">N/D</span>:<span className={'ap-use'+(hot?' is-bad':'')}><span className={'ds-meter ap-bar ds-meter--'+(hot?'bad':'good')} style={{'--ds-meter-value':Math.min(100,r.usedPct)} as any} aria-hidden="true"/>{hot&&<span className="ds-glyph ds-glyph--bad" aria-hidden="true"/>}<span className="ds-num">{r.usedPct.toLocaleString('pt-BR')}%</span></span>}</td>
    <td data-label="Saldo" className="is-num"><span className="ds-num">{money(r.balance,r.currency)}</span></td>
    <td data-label="Alertas" className="ap-alerts">{r.alerts?.length?r.alerts.map((a:string)=>{const t=alertTone(a);return <span key={a} className={'ds-pill ds-pill--'+t+' ap-alert'}><span className={'ds-glyph ds-glyph--'+t} aria-hidden="true"/>{a}</span>;}):<span className="ap-nd">—</span>}</td>
   </tr>;})}</tbody></table></div>}
  {panel?.projectErrors&&Object.keys(panel.projectErrors).length>0&&<p className="ds-hint ds-hint--warn ap-note">Sem leitura do Malva nesta montagem: {Object.keys(panel.projectErrors).join(', ')}.</p>}
 </section>;
}
