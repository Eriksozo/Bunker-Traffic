'use client';
import {ArrowUpRight,Clock3,Database,ArrowRight} from 'lucide-react';
const tones:Record<string,string>={red:'bad',green:'good',amber:'warn',gray:'neutral'};
import {Alert,AlertTitle,AlertDescription} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {overviewAnalysisState} from '../lib/overview-view.mjs';
import './overview-analysis-status.css';

export default function OverviewAnalysisStatus({state,project,signals,now,onFilter,onReview}:{state:any;project:string;signals:any[];now:number;onFilter:(tone:string)=>void;onReview:()=>void}){
 const view=overviewAnalysisState(state,project,signals,now);
 // Banner tone: storage failure = error (⛔), analysis still renewing = waiting (clock on amber), ready = good (✓).
 const tone=view.storageFailure?'bad':view.incomplete?'warn':'good';
 return <div className="analysis-status">
  <Alert role="status" className={'analysis-status-banner ds-banner ds-banner--'+tone+' '+(view.incomplete?'pending':'ready')}>
   {view.storageFailure?<Database size={17} aria-hidden="true"/>:view.incomplete?<Clock3 size={17} aria-hidden="true"/>:null}
   <div className="ds-banner__body"><AlertTitle>{view.title}</AlertTitle>
   <AlertDescription><p>{view.message}</p>{view.incomplete&&<p>{view.ready} de {view.total} projetos com os quatro períodos atuais. “—” significa classificação ainda indisponível.</p>}<Button variant="ghost" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={onReview}>Ver andamento da revisão <ArrowRight size={14} aria-hidden="true"/></Button></AlertDescription></div>
  </Alert>
  <div className="signal-grid">{view.groups.map(group=>{const t=group.value===null?'neutral':tones[group.tone]||'neutral';return <Button className={'signal signal--'+t+' '+(group.value===null?'gray':group.tone)} key={group.tone} onClick={()=>onFilter(group.tone)} aria-label={`${group.label}: ${group.value===null?'classificação indisponível':group.value}`}><span className="signal-label"><span className={'ds-glyph ds-glyph--'+(group.value===null?'waiting':t==='neutral'?'info':t)} aria-hidden="true"/><span className="signal-name">{group.label}</span><ArrowUpRight size={15} aria-hidden="true" className="signal-arrow"/></span><strong>{group.value??'—'}</strong><small>{group.value===null?'Aguardando análise atual para classificar.':group.text}</small></Button>;})}</div>
 </div>;
}
