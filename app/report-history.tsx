'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,FileText,X} from 'lucide-react';
import {safeReportFilename} from '../lib/report-archive.mjs';
import WorkspaceDialog from './workspace-dialog';
import './agent-report.css';
const stamp=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'});
function saveText(report:any){
 const url=URL.createObjectURL(new Blob([report.text||''],{type:'text/plain;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=safeReportFilename(report.title);link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function ReportHistory({project,revision,fallbackReports=[]}:any){
 const [items,setItems]=useState<any[]>([]),[scope,setScope]=useState(''),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<any>(null);
 const generation=useRef(0);
 useEffect(()=>{
  const controller=new AbortController(),token=++generation.current;
  if(!project)return;
  setLoading(true);setError('');setCursor(null);
  fetch('/api/reports?'+new URLSearchParams({project,limit:'20'}),{cache:'no-store',signal:controller.signal}).then(async r=>{const d:any=await r.json();if(!r.ok)throw Error(d.error||'Falha ao carregar o histórico.');if(token===generation.current){setItems(d.items);setScope(project);setCursor(d.nextCursor);}}).catch(e=>{if(e.name!=='AbortError'&&token===generation.current)setError(e.message);}).finally(()=>{if(token===generation.current)setLoading(false);});
  return()=>controller.abort();
 },[project,revision]);
 useEffect(()=>{setSelected(null);},[project]);
 async function more(){
  if(!cursor||loading)return;const token=generation.current;setLoading(true);setError('');
  try{const r=await fetch('/api/reports?'+new URLSearchParams({project,limit:'20',cursor}),{cache:'no-store'}),d:any=await r.json();if(!r.ok)throw Error(d.error||'Falha ao carregar o histórico.');if(token!==generation.current)return;setItems(old=>{const seen=new Set(old.map(x=>x.id));return [...old,...d.items.filter((x:any)=>!seen.has(x.id))];});setCursor(d.nextCursor);}
  catch(e:any){if(token===generation.current)setError(e.message);}finally{if(token===generation.current)setLoading(false);}
 }
 const fallback=fallbackReports.filter((r:any)=>r.project===project||r.project==='all'),visible=scope===project?items:fallback;
 const firstLoad=loading&&!visible.length;
 return <section className="panel ds-card ds-card--lg rh-panel" aria-labelledby="rh-title"><header className="rh-head"><div className="rh-head__text"><span className="ds-eyebrow">Relatórios</span><h2 className="ds-headline" id="rh-title">Entregáveis salvos</h2></div><span className="ds-badge ds-badge--tag" aria-hidden="true"><FileText size={16}/></span></header><p className="ds-caption rh-hint">Histórico por projeto. Abra para ler ou baixar o relatório. Horários em Boa Vista.</p>
 {error&&<div className="ds-banner ds-banner--bad rh-error" role="alert"><div className="ds-banner__body"><p>{error} Os registros já carregados continuam disponíveis.</p></div></div>}
 {visible.length>0&&<ul className="ds-list ds-list--divided rh-list">{visible.map((r:any)=><li key={r.id}><button type="button" className="ds-row rh-row" onClick={()=>setSelected(r)}><span className="ds-row__lead" aria-hidden="true"><span className="ds-badge ds-badge--tag"><FileText size={14}/></span></span><span className="ds-row__main"><small className="rh-row__date">{stamp(r.createdAt)}</small><strong className="ds-row__title rh-row__title" title={r.title}>{r.title}</strong></span><span className="ds-row__trail rh-row__open">Abrir</span><span className="ds-row__chevron" aria-hidden="true"/></button></li>)}</ul>}
 {!visible.length&&!loading&&<p className="ds-empty rh-empty">Nenhum relatório salvo para este projeto.</p>}
 {firstLoad&&<div className="rh-skeleton" role="status"><span className="ds-sr-only">Carregando histórico…</span>{[0,1,2].map(i=><div className="rh-skeleton__row" key={i} aria-hidden="true"><span className="ds-skeleton ds-skeleton--circle"/><span className="rh-skeleton__text"><span className="ds-skeleton ds-skeleton--text" style={{['--ds-skeleton-w' as any]:'28%'}}/><span className="ds-skeleton ds-skeleton--text" style={{['--ds-skeleton-w' as any]:i===1?'52%':'68%'}}/></span></div>)}</div>}
 {loading&&!firstLoad&&<p className="ds-caption rh-loading" role="status"><span className="ds-spinner" aria-hidden="true"/> Carregando histórico…</p>}
 {cursor&&<div className="rh-more"><button type="button" className="ds-btn ds-btn--sm" onClick={more} disabled={loading} aria-busy={loading||undefined}>Carregar anteriores</button></div>}
 {selected&&<WorkspaceDialog title={'Relatório salvo: '+selected.title} description={stamp(selected.createdAt)+' · texto preservado da rodada'} wide onClose={()=>setSelected(null)}><button type="button" className="close" aria-label="Fechar relatório" onClick={()=>setSelected(null)}><X/></button><div className="rh-dialog"><span className="ds-eyebrow">Relatório salvo</span><h2 className="ds-headline rh-dialog__title">{selected.title}</h2><pre className="rh-text" tabIndex={0}>{selected.text}</pre><div className="rh-dialog__actions"><button type="button" className="ds-btn ds-btn--primary" onClick={()=>saveText(selected)}><ArrowDownToLine size={15} aria-hidden="true"/> Baixar texto</button></div></div></WorkspaceDialog>}
 </section>;
}
