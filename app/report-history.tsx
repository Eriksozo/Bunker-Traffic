'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,FileText,Loader2,X} from 'lucide-react';
import {safeReportFilename} from '../lib/report-archive.mjs';
import WorkspaceDialog from './workspace-dialog';
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
 return <section className="panel"><div className="panel-title"><h2>Entregáveis salvos</h2><FileText size={20}/></div><p className="hint">Histórico por projeto. Abra para ler ou baixar o relatório. Horários em Boa Vista.</p>
 {error&&<p role="alert">{error} Os registros já carregados continuam disponíveis.</p>}
 {visible.map((r:any)=><button className="saved-report" key={r.id} onClick={()=>setSelected(r)}><FileText size={18}/><span><strong>{r.title}</strong><small>{stamp(r.createdAt)}</small></span><span>Abrir</span></button>)}
 {!visible.length&&!loading&&<p className="hint">Nenhum relatório salvo para este projeto.</p>}
 {loading&&<p className="hint" role="status"><Loader2 size={15}/> Carregando histórico…</p>}
 {cursor&&<button className="button" onClick={more} disabled={loading}>Carregar anteriores</button>}
 {selected&&<WorkspaceDialog title={'Relatório salvo: '+selected.title} description={stamp(selected.createdAt)+' · texto preservado da rodada'} wide onClose={()=>setSelected(null)}><button type="button" className="close" aria-label="Fechar relatório" onClick={()=>setSelected(null)}><X/></button><h2>{selected.title}</h2><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'60vh',overflow:'auto'}}>{selected.text}</pre><button type="button" className="button primary" onClick={()=>saveText(selected)}><ArrowDownToLine size={15}/> Baixar texto</button></WorkspaceDialog>}
 </section>;
}
