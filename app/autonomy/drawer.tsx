'use client';
/* Campaign drawer: the 4 windows (and the day table on demand), today's verdicts, one timeline (Sombra, people's moves,
 * Bunk orders, checks, grades, log), the guardrails and "simular por nível" (the draft simulator over this campaign's
 * Sombra rows only, "só permissões"). Read-only. */
import {useMemo,useState} from 'react';
import {X} from 'lucide-react';
import {Sheet,SheetClose,SheetContent,SheetDescription,SheetTitle} from '@/components/ui/sheet';
import CampaignDailyResults from '../campaign-daily-results';
import {autonomyModes,campaignKey,modeLabels} from '../../lib/autonomy-grant.mjs';
import {DiffRow,Empty,Guardrails,StatusChip,WindowTable,chipFor,clock,deepDecisions,deepDone,findCampaign,fin,sourceText,stamp,stepNames,type CampaignRef} from './components';
import {OrderTimeline} from './now';
import {runSim,simCount,useSimRows} from './permissions';

const kindText:Record<string,string>={pause:'pausou',reduce:'reduziu',increase:'aumentou',activate:'reativou',cut:'cortou'};
const verdictText:Record<string,string>={acertou:'acertou',errou:'errou',parou:'campanha parou','N/D':'N/D'};
type Item={at:string;text:string;tone:'good'|'bad'|'warn'|'info'|'neutral';who:string};
/** Every dated fact about one campaign the cockpit has, newest first. */
export function campaignTimeline(ref:CampaignRef,{decisions,done,log,plays}:{decisions:any[];done:any[];log:any[];plays:any[]}){
 const items:Item[]=[];const same=(x:any)=>x&&x.adAccountId===ref.adAccountId&&String(x.objectId)===String(ref.objectId);
 for(const d of decisions.filter(same)){
  items.push({at:d.firstAt,who:d.source==='playbook'?'Jogada':'Sombra',tone:'info',text:`${sourceText(d)}: ${chipFor(d).label}`});
  if(d.manager?.at)items.push({at:d.manager.at,who:'Equipe',tone:'neutral',text:`${d.manager.actor||'Alguém da equipe'} mexeu ${fin(d.manager.minutesAfter)?`${d.manager.minutesAfter} min depois`:'depois'}`});
  if(d.owner?.at)items.push({at:d.owner.at,who:'Você',tone:'neutral',text:`Você mexeu ${fin(d.owner.minutesAfter)?`${d.owner.minutesAfter} min depois`:'depois'}`});
  if(d.grade?.d1?.verdict)items.push({at:d.lastAt||d.firstAt,who:'Nota',tone:d.grade.d1.verdict==='acertou'?'good':d.grade.d1.verdict==='errou'?'bad':'neutral',text:`Nota D+1: ${verdictText[d.grade.d1.verdict]||d.grade.d1.verdict}${d.grade.d1.winnerCut?' · corte em vencedora':''}`});
 }
 for(const o of done.filter(same)){
  for(const s of Array.isArray(o.steps)?o.steps:[])items.push({at:s.at,who:'Bunk',tone:s.kind==='falhou'||s.kind==='verificacao'?'bad':s.kind==='confirmada'?'good':'info',text:`Ordem do Bunk: ${stepNames[s.kind]||s.kind}`});
  for(const c of Array.isArray(o.monitorChecks)?o.monitorChecks:[])items.push({at:c.at,who:'Conferência',tone:'neutral',text:`+${c.minutes} min: ${c.status}`});
 }
 for(const e of log.filter(same))items.push({at:e.at,who:'Registro',tone:e.result?.kind==='order'?'good':e.result?.kind==='confirm'?'warn':'neutral',text:`${e.result?.kind==='order'?'Ordem enviada ao executor':e.result?.kind==='confirm'?'Aguarda você':'Segurado'}${e.result?.blockers?.length?`: ${e.result.blockers[0]}`:''}`});
 for(const p of plays)for(const c of Array.isArray(p?.caseRefs)?p.caseRefs:[])if(same(c))items.push({at:c.at,who:c.name||'Equipe',tone:'neutral',text:`${c.name||'Alguém da equipe'} ${kindText[c.kind]||c.kind} (caso da jogada)`});
 const seen=new Set<string>();
 return items.filter(i=>Number.isFinite(Date.parse(i.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).filter(i=>{const k=i.at+i.text;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,60);
}
/** The saved permissions with this campaign forced to one level (an exception), for "simular por nível". */
export function levelConfig(saved:any,ref:CampaignRef,mode:string){
 const projects=Object.fromEntries((saved?.projects||[]).map((p:any)=>[p.id,{mode:p.mode,actions:p.actions,limits:p.limits,campaigns:{...(p.campaigns||{})}}]));
 if(projects[ref.project])(projects[ref.project] as any).campaigns[campaignKey(ref.adAccountId,ref.objectId)]={mode,name:ref.name||ref.objectId};
 return {enabled:!!saved?.enabled,projects};
}
function LevelSim({target:r,saved}:{target:CampaignRef;saved:any}){
 const sims=useSimRows([r.project]),sim=sims[r.project];
 const rows=useMemo(()=>{const d=sim?.data;if(!d||!Array.isArray(d.columns))return null;const ia=d.columns.indexOf('adAccountId'),io=d.columns.indexOf('objectId');return {...d,rows:d.rows.filter((x:any[])=>x[ia]===r.adAccountId&&String(x[io])===String(r.objectId))};},[sim,r.adAccountId,r.objectId]);
 const ids=(saved?.projects||[]).map((p:any)=>p.id);
 if(!sim||(sim.pending&&!sim.data))return <p className="ds-caption">Calculando com as decisões da Sombra de 7 dias desta campanha…</p>;
 if(!rows)return <p className="ds-caption">{sim.error||'Simulação indisponível agora.'}</p>;
 if(!rows.rows.length)return <p className="ds-caption">Sem decisões da Sombra nesta campanha em 7 dias: em qualquer nível, nada teria sido enviado.</p>;
 return <div className="aut-levelsim"><table className="aut-wtable">
  <thead><tr><th scope="col">Nível</th><th scope="col">7 dias</th><th scope="col">Hoje</th><th scope="col">Seguraria</th></tr></thead>
  <tbody>{autonomyModes.map(m=>{const res:any=runSim(rows,levelConfig(saved,r,m),ids);return <tr key={m}><th scope="row">{(modeLabels as any)[m]}</th>{res.ok?<><td>{simCount(res.draft.d7)} ({res.draft.d7.right} certas, {res.draft.d7.wrong} erradas)</td><td>{simCount(res.draft.today)}</td><td className="ds-caption">{Object.entries(res.draft.d7.held||{}).sort((a:any,b:any)=>b[1]-a[1]).slice(0,1).map(([k,n])=>`${k} (${n})`).join('')||'—'}</td></>:<td colSpan={3} className="ds-caption">{res.error}</td>}</tr>;})}</tbody>
 </table><p className="ds-caption">Só permissões, com o interruptor geral ligado e as suas permissões salvas para o resto. Certo/errado vem da nota D+1 da Sombra; não é promessa de lucro.</p></div>;
}

export function DrawerBody({target,deep,log,saved}:{target:CampaignRef;deep:any;log:any[];saved:any}){
 const [daily,setDaily]=useState(false),[sim,setSim]=useState(false);
 const c=findCampaign(deep,target.project,target.adAccountId,target.objectId),p=deep?.projects?.[target.project];
 const decisions=useMemo(()=>deepDecisions(deep).filter(d=>d.project===target.project),[deep,target.project]);
 const mine=decisions.filter(d=>d.adAccountId===target.adAccountId&&String(d.objectId)===String(target.objectId));
 const timeline=useMemo(()=>campaignTimeline(target,{decisions,done:deepDone(deep).filter(o=>o.project===target.project),log:(log||[]).filter((e:any)=>!e.project||e.project===target.project),plays:p?.playbook?.plays||[]}),[target,decisions,deep,log,p]);
 const done=deepDone(deep).filter(o=>o.project===target.project&&o.adAccountId===target.adAccountId&&String(o.objectId)===String(target.objectId));
 const name=c?.name||target.name||`Campanha ${target.objectId}`;
 return <div className="aut-drawer__body">
  <header className="aut-drawer__head">
   <span className="ds-eyebrow">{target.projectName||p?.name||target.project}{c?.accountName?` · ${c.accountName}`:''}</span>
   <h2 className="ds-headline aut-drawer__title" title={name}>{name}</h2>
   <p className="ds-caption">ID {target.objectId}{c?` · nível ${(modeLabels as any)[c.mode]||c.mode}`:''}{c?.test?' · teste':''}</p>
  </header>
  <section className="aut-drawer__sec" aria-label="Janelas"><h3 className="ds-eyebrow">Hoje, ontem, 3 e 7 dias</h3>{c?<WindowTable windows={c.windows} partialDay={c.partialDay}/>:<p className="ds-caption">Sem esta campanha na leitura de hoje do executor (N/D).</p>}
   <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" aria-expanded={daily} onClick={()=>setDaily(!daily)}>{daily?'Esconder dia a dia':'Ver dia a dia'}</button>
   {daily&&<CampaignDailyResults projectId={target.project} adAccountId={target.adAccountId} objectId={target.objectId}/>}
  </section>
  <section className="aut-drawer__sec" aria-label="Veredito de agora"><h3 className="ds-eyebrow">O que o Bunk faria agora</h3>
   {!mine.length?<Empty>Nenhuma decisão da Sombra ou jogada nesta campanha hoje.</Empty>:<ul className="ds-list ds-list--divided">{mine.map(d=><li key={d.id} className="aut-drawer__dec"><StatusChip d={d}/><DiffRow action={d.action} before={d.before} after={d.after} percent={d.percent}/>{d.reason&&<p className="ds-caption">{d.reason}</p>}<p className="ds-caption">{sourceText(d)}</p></li>)}</ul>}
  </section>
  {c&&<section className="aut-drawer__sec" aria-label="Travas"><h3 className="ds-eyebrow">Travas</h3><Guardrails guard={c.guard}/></section>}
  {!!done.length&&<section className="aut-drawer__sec" aria-label="Ordens do Bunk"><h3 className="ds-eyebrow">Ordens do Bunk</h3>{done.map(o=><div key={o.proposalId}><DiffRow action={o.action} before={o.before} after={o.after} percent={o.percent}/><OrderTimeline o={o}/></div>)}</section>}
  <section className="aut-drawer__sec" aria-label="Linha do tempo"><h3 className="ds-eyebrow">Linha do tempo</h3>
   {!timeline.length?<Empty>Nada registrado ainda para esta campanha.</Empty>:<ol className="aut-timeline">{timeline.map((i,k)=><li key={k} className={`tone-${i.tone}`}><span className={`ds-dot ds-dot--sm ds-dot--${i.tone==='info'?'neutral':i.tone}`} aria-hidden="true"/><span className="aut-timeline__when ds-caption">{new Date(Date.parse(i.at)).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} {clock(i.at)}</span><span className="aut-timeline__who ds-caption-strong">{i.who}</span><span className="aut-timeline__text">{i.text}</span></li>)}</ol>}
  </section>
  <section className="aut-drawer__sec" aria-label="Simular por nível"><h3 className="ds-eyebrow">Simular por nível</h3>
   <p className="ds-caption">Quantas ordens esta campanha teria gerado em 7 dias em cada nível, com as suas permissões salvas.</p>
   {!sim?<button type="button" className="ds-btn ds-btn--sm" onClick={()=>setSim(true)}>Simular</button>:<LevelSim target={target} saved={saved}/>}
  </section>
  <p className="ds-caption aut-drawer__foot">Leitura de {stamp(deep?.baseAt)} · só leitura: nada aqui muda a campanha.</p>
 </div>;
}

export function CampaignDrawer({target,deep,log,saved,onClose}:{target:CampaignRef|null;deep:any;log:any[];saved:any;onClose:()=>void}){
 return <Sheet open={!!target} onOpenChange={o=>{if(!o)onClose();}}>
  <SheetContent side="right" className="aut-drawer" showCloseButton={false}>
   <SheetClose className="ds-btn ds-btn--icon aut-drawer__close" aria-label="Fechar detalhe da campanha" title="Fechar"><X size={16} aria-hidden="true"/></SheetClose>
   <SheetTitle className="ds-sr-only">{target?.name||'Campanha'}</SheetTitle>
   <SheetDescription className="ds-sr-only">Detalhe da campanha no painel de autonomia: janelas, decisões, linha do tempo e simulação.</SheetDescription>
   {target&&<DrawerBody target={target} deep={deep} log={log} saved={saved}/>}
  </SheetContent>
 </Sheet>;
}
