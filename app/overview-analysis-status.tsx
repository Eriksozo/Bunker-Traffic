'use client';
import {ArrowUpRight,Clock3,Database,ArrowRight} from 'lucide-react';
import {Alert,AlertTitle,AlertDescription} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {overviewAnalysisState} from '../lib/overview-view.mjs';
import './overview-analysis-status.css';

export default function OverviewAnalysisStatus({state,project,signals,now,onFilter,onReview}:{state:any;project:string;signals:any[];now:number;onFilter:(tone:string)=>void;onReview:()=>void}){
 const view=overviewAnalysisState(state,project,signals,now);
 return <div className="analysis-status">
  <Alert role="status" className={'analysis-status-banner '+(view.incomplete?'pending':'ready')}>
   {view.storageFailure?<Database size={17}/>:<Clock3 size={17}/>}
   <AlertTitle>{view.title}</AlertTitle>
   <AlertDescription><p>{view.message}</p>{view.incomplete&&<p>{view.ready} de {view.total} projetos com os quatro períodos atuais. “—” significa classificação ainda indisponível.</p>}<Button variant="ghost" onClick={onReview}>Ver andamento da revisão <ArrowRight size={14}/></Button></AlertDescription>
  </Alert>
  <div className="signal-grid">{view.groups.map(group=><Button className={'signal '+(group.value===null?'gray':group.tone)} key={group.tone} onClick={()=>onFilter(group.tone)} aria-label={`${group.label}: ${group.value===null?'classificação indisponível':group.value}`}><span>{group.label}<ArrowUpRight size={15}/></span><strong>{group.value??'—'}</strong><small>{group.value===null?'Aguardando análise atual para classificar.':group.text}</small></Button>)}</div>
 </div>;
}
