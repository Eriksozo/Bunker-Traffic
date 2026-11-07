'use client';
import {useEffect,useMemo,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import './accounts-panel.css';

const money=(n:any,currency?:string|null)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:currency&&/^[A-Z]{3}$/.test(currency)?currency:'USD',maximumFractionDigits:2}):'N/D';
const brl=(n:any)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'N/D';
const stamp=(v?:string|null)=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'N/D';};
const metaErrors:Record<string,string>={META_TOKEN_MISSING:'Token de leitura da Meta ainda não cadastrado.',META_190:'Token da Meta inválido ou expirado.',META_200:'O token da Meta não tem permissão de leitura dessas contas.',META_NETWORK:'Sem resposta da Meta na última leitura.'};

/** Replaces the manual daily account planning: status, project, today's spend vs Meta's daily limit, balance. Read-only. */
export default function AccountsPanel(){
 const [panel,setPanel]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[group,setGroup]=useState('all'),[onlyActive,setOnlyActive]=useState(true);
 async function load(){setLoading(true);setError('');try{const r=await fetch('/api/accounts',{cache:'no-store'});const d:any=await r.json();if(!r.ok)throw Error(d?.error||'Falha ao ler as contas.');setPanel(d.panel);if(!d.panel)setError(d.unavailable?'Executor indisponível agora.':'O painel ainda está sendo montado. Ele atualiza a cada 30 minutos.');}catch(e:any){setError(e?.message||'Falha ao ler as contas.');}finally{setLoading(false);}}
 useEffect(()=>{load();const t=setInterval(load,5*60000);return ()=>clearInterval(t);},[]);
 const groups=useMemo(()=>[...new Set((panel?.rows||[]).map((r:any)=>r.group))] as string[],[panel]);
 const rows=useMemo(()=>(panel?.rows||[]).filter((r:any)=>(group==='all'||r.group===group)&&(!onlyActive||r.status==='active'||r.alerts?.length)),[panel,group,onlyActive]);
 const c=panel?.counts;
 return <section className="panel accounts-panel" aria-label="Contas de anúncio">
  <div className="panel-title"><div><span className="eyebrow">PLANEJAMENTO DE CONTAS</span><h2>Contas de anúncio</h2>
   <p className="hint">Atualiza sozinho a cada 30 minutos: situação e projeto vêm do Malva; limite diário e gasto de hoje vêm da Meta, na moeda da conta. Somente leitura. {panel&&`Última montagem ${stamp(panel.generatedAt)}.`}</p></div>
   <Button type="button" variant="ghost" onClick={load} disabled={loading} aria-label="Recarregar contas"><RefreshCw size={15}/></Button></div>
  {panel&&!panel.metaConnected&&<p className="ap-notice">Limite diário: {metaErrors[panel.metaError]||'leitura da Meta indisponível.'} O restante do painel funciona; limites aparecem como N/D.</p>}
  {error&&<p className="ap-notice">{error}</p>}
  {c&&<div className="ap-counts"><span><strong>{c.active}</strong> ativas</span><span><strong>{c.running}</strong> rodando</span><span><strong>{c.disabled}</strong> desabilitadas</span><span className={c.nearLimit?'is-bad':''}><strong>{c.nearLimit}</strong> perto do limite</span><span><strong>{c.withLimit}</strong> com limite lido</span></div>}
  {panel&&<div className="ap-filters"><select aria-label="Grupo de contas" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Todos os grupos</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select>
   <label><input type="checkbox" checked={onlyActive} onChange={e=>setOnlyActive(e.target.checked)}/> Só ativas ou com alerta</label></div>}
  {panel&&<div className="table-scroll"><table><thead><tr><th>Conta</th><th>Grupo</th><th>Situação</th><th>Gasto hoje</th><th>Limite diário (Meta)</th><th>Uso</th><th>Saldo</th><th>Alertas</th></tr></thead>
   <tbody>{rows.map((r:any)=><tr key={r.accountId}>
    <td><strong>{r.name||r.accountId}</strong><small className="ap-sub">{r.accountId}</small></td>
    <td>{r.group}</td>
    <td>{r.runningLabel}</td>
    <td>{r.todaySpend===null?<span title="Gasto do Malva, em reais">{brl(r.spendTodayBrl)}</span>:money(r.todaySpend,r.currency)}</td>
    <td>{money(r.dailyLimit,r.currency)}</td>
    <td>{r.usedPct===null?'N/D':<span className={'ap-use'+(r.usedPct>=80?' is-bad':'')}><span className="ap-bar"><span style={{width:Math.min(100,r.usedPct)+'%'}}/></span>{r.usedPct.toLocaleString('pt-BR')}%</span>}</td>
    <td>{money(r.balance,r.currency)}</td>
    <td>{r.alerts?.length?r.alerts.map((a:string)=><span key={a} className="ap-alert">{a}</span>):'—'}</td>
   </tr>)}</tbody></table></div>}
  {panel?.projectErrors&&Object.keys(panel.projectErrors).length>0&&<p className="hint">Sem leitura do Malva nesta montagem: {Object.keys(panel.projectErrors).join(', ')}.</p>}
 </section>;
}
