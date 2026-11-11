'use client';
/* Island of the Autonomia cockpit: what is on, today's four numbers, the executor's health, the people's-move memory,
 * the project filter and the general switch (kill / ligar with the same bodies as before). Read-only except the switch. */
import {useId} from 'react';
import {Bot,Power} from 'lucide-react';
import {fin,firedOf,fmtInt,fmtShare,fmtRange,healthLine,memoryLine,stamp,ND,joinNames} from './components';
import {autoNames,type DraftControl} from './permissions';

/** "Ligada · 2 projetos podem enviar sozinhos" / "Desligada · o Bunk só observa e aprende". */
export function islandStateLine(enabled:boolean,paused:boolean,savedProjects:any[]){
 if(!enabled)return 'Desligada · o Bunk só observa e aprende';
 const auto=autoNames(savedProjects);
 const head=auto.length?`Ligada · ${auto.length===1?'1 projeto pode':`${auto.length} projetos podem`} enviar sozinho${auto.length===1?'':'s'}`:'Ligada · nenhum projeto em Automático: o Bunk não envia nada sozinho';
 return paused?`${head} · escritório pausado`:head;
}
function Tile({label,value,foot,tone}:{label:string;value:string;foot:string;tone?:'good'|'warn'|'neutral'}){
 return <div className="ds-kpi ds-kpi--tile aut-tile"><span className="ds-kpi__label">{label}</span><strong className={`ds-kpi__value${value===ND?' is-nd':''}`}>{tone&&value!==ND&&value!=='0'?<span className={`ds-glyph ds-glyph--${tone==='warn'?'waiting':tone==='good'?'good':'info'}`} aria-hidden="true"/>:null}{value}</strong><span className="ds-kpi__foot">{foot}</span></div>;
}
export function Island({deep,deepError,ctl,saving,now,filter,setFilter}:{deep:any;deepError:string|null;ctl:DraftControl;saving:boolean;now:number;filter:string;setFilter:(id:string)=>void}){
 const {saved,draft,busy}=ctl,onReason=useId();
 const savedAuto=autoNames(saved.projects),savedConfirm=saved.projects.some((p:any)=>p.mode==='confirm'||Object.values(p.campaigns||{}).some((c:any)=>c.mode==='confirm'));
 const nowText=!saved.enabled?'Agora o Bunk não envia nenhuma ordem sozinho: para isso, a autonomia precisa estar ligada e o projeto (ou a campanha) em Automático.':savedAuto.length?`Agora o Bunk pode enviar ordens sozinho em ${savedAuto.join(', ')}, só dentro das ações e limites salvos.${savedConfirm?' Onde está em Confirmar, ele só prepara e avisa.':''}`:`Agora nenhum projeto está em Automático: o Bunk não envia ordens sozinho.${savedConfirm?' Onde está em Confirmar, ele só prepara e avisa.':''}`;
 const t=deep?.totals,a=t?.agreement,fired=firedOf(a),hasA=!!a&&fin(a.precision)&&fired>0,observing=saved.projects.filter((p:any)=>p.mode!=='off').map((p:any)=>p.name);
 return <section className={`ds-card ds-card--lg aut-master aut-island ${saved.enabled?'ds-card--accent is-on':''}`} aria-labelledby="aut-master-title">
  <div className="aut-master__head">
   <span className={`ds-badge ${saved.enabled?'ds-badge--accent':'ds-badge--neutral'}`} aria-hidden="true"><Bot size={16}/></span>
   <div className="aut-master__titles">
    <span className="ds-eyebrow">Autonomia do Bunk · Modo Gestor</span>
    <h2 id="aut-master-title" className="ds-headline">{islandStateLine(saved.enabled,!!deep?.paused,saved.projects)}</h2>
   </div>
   <span className={`ds-pill ${saved.enabled?'ds-pill--good':'ds-pill--neutral'} aut-master__state`}><span className={`ds-glyph ${saved.enabled?'ds-glyph--good':'ds-glyph--info'}`} aria-hidden="true"/>{saved.enabled?`Ligada desde ${stamp(saved.enabledAt)}`:saved.disabledAt?`Desligada em ${stamp(saved.disabledAt)}`:'Nunca ligada'}</span>
  </div>
  <p className="aut-master__now">{nowText}</p>
  <div className="aut-master__actions">
   {saved.enabled?<button type="button" className="ds-btn ds-btn--danger" disabled={saving} aria-busy={(saving&&busy==='kill')||undefined} onClick={ctl.kill}>{saving&&busy==='kill'?<span className="ds-spinner" aria-hidden="true"/>:<Power size={15} aria-hidden="true"/>} Desligar agora</button>:<button type="button" className={`ds-btn ${draft?'':'ds-btn--primary'}`} disabled={saving||!!draft} aria-busy={(saving&&busy==='on')||undefined} aria-describedby={draft?onReason:undefined} onClick={ctl.turnOn}>{saving&&busy==='on'?<span className="ds-spinner" aria-hidden="true"/>:<Power size={15} aria-hidden="true"/>} Ligar autonomia</button>}
   {draft&&!saved.enabled&&<p className="ds-disabled-reason" id={onReason}>Salve as permissões antes de ligar.</p>}
  </div>
  <div className="aut-tiles" role="group" aria-label="Hoje">
   <Tile label="Enviadas hoje" value={t?fmtInt(t.orders?.sent):ND} foot={t?`${fmtInt(t.orders?.confirmed)} confirmadas · ${fmtInt(t.orders?.failed)} com falha`:'Leitura do executor N/D'} tone="good"/>
   <Tile label="Seguradas" value={t?fmtInt(t.decisions?.segurada):ND} foot="decisões travadas por um limite ou dado" tone="neutral"/>
   <Tile label="Aguardam você" value={t?fmtInt(t.decisions?.pediria):ND} foot="no Confirmar, você executa com Touch ID" tone="warn"/>
   <Tile label="Concordância com a equipe" value={hasA?fmtShare(a.precision):ND} foot={!t?'Leitura do executor N/D':!hasA?'Sem casos comparáveis ainda':`${fmtRange(a.low,a.high)?`faixa ${fmtRange(a.low,a.high)} · `:''}${fmtInt(fin(a.agree)?a.agree:Math.round(a.precision*fired))} de ${fmtInt(fired)} vezes em que o Bunk agiria${fired<15?' · amostra pequena':''}`}/>
  </div>
  <ul className="aut-island__lines">
   <li><span className={`ds-dot ds-dot--sm ${deepError?'ds-dot--warn':deep?.shadowStatus?.failed?'ds-dot--bad ds-dot--pulse':deep?.shadowStatus?.skipped?.length?'ds-dot--warn':'ds-dot--good'}`} aria-hidden="true"/>{deepError?deepError:deep?healthLine(deep,now):'Lendo o executor…'}</li>
   <li><span className="ds-dot ds-dot--sm ds-dot--neutral" aria-hidden="true"/>{deep?memoryLine(deep.memory,deep.playbookStatus):'Memória: lendo…'}</li>
   {observing.length>0&&<li><span className="ds-dot ds-dot--sm ds-dot--neutral" aria-hidden="true"/>Observando: {joinNames(observing.slice(0,6))}{observing.length>6?` e mais ${observing.length-6}`:''}</li>}
  </ul>
  {saved.projects.length>1&&<div className="aut-filter" role="group" aria-label="Projeto">
   {[{id:'all',name:'Todos os projetos'},...saved.projects].map((p:any)=><button key={p.id} type="button" className="ds-chip ds-chip--neutral ds-chip--outlined" aria-pressed={filter===p.id} onClick={()=>setFilter(p.id)}>{p.name}</button>)}
  </div>}
 </section>;
}
