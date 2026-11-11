'use client';
/* Placar: the 6 fixed rules and the team plays on one table (current version only), the "Bunk antes da equipe" trend and
 * the blind spots. Everything comes from the deep view's score block; small samples say so instead of a percent. */
import {Empty,GateMeter,SkeletonRows,clock,dayLabel,fin,firedOf,fmtInt,fmtRange,fmtShare,fmtSignedPct,minutesText,stageLabels,ND,type CampaignRef} from './components';

const ruleStage=(s:string)=>s==='pode-enviar'?'Pode enviar':s==='sombra'?'Na Sombra':stageLabels[s]||ND;
const kindText:Record<string,string>={pause:'pausa',reduce:'redução',increase:'aumento',activate:'reativação'};
/** "vs campanha qualquer": only when the executor says the edge is claimable (chanceBetter set); otherwise "amostra pequena". */
export function baseText(s:any){
 if(!s?.base)return ND;
 if(!fin(s.chanceBetter))return 'amostra pequena';
 return `${fin(s.base.edge)?fmtSignedPct(Math.round(s.base.edge*1000)/10).replace('%',' p.p.'):ND} vs base ${fmtShare(s.base.expected)} · ${fmtShare(s.chanceBetter)} de chance de ser melhor`;
}
const accText=(s:any)=>s?.graded?`${fmtShare(s.accuracy)}${fmtRange(s.low,s.high)?` (${fmtRange(s.low,s.high)})`:''}`:ND;
const trendText=(t:any)=>t?`${t.recent?.graded?`${fmtShare(t.recent.accuracy)} (${t.recent.graded})`:ND} vs ${t.previous?.graded?`${fmtShare(t.previous.accuracy)} (${t.previous.graded})`:ND}`:ND;

function ScoreRow({name,s,kind,play}:{name:string;s:any;kind:'rule'|'play';play?:any}){
 const a=play?.agreement,gate=kind==='rule'?s.gate:{graded:s.graded,right:s.right,need:15,min:0.5,metric:'low',proven:false};
 return <tr>
  <th scope="row" data-label="Regra ou jogada"><span className="aut-score__name">{name}</span><span className="ds-caption">{kind==='rule'?'Regra fixa':'Jogada da equipe'}{s.rev?` · ${String(s.rev).split(':')[0]}`:''}</span></th>
  <td data-label="Estágio"><span className={`ds-pill ${s.stage==='pode-enviar'?'ds-pill--good':'ds-pill--neutral'}`}><span className={`ds-glyph ds-glyph--${s.stage==='pode-enviar'?'good':'waiting'}`} aria-hidden="true"/>{ruleStage(s.stage)}</span></td>
  <td data-label="Acerto (faixa)" className={s.graded?'':'is-nd'}>{accText(s)}<span className="ds-caption"> · {fmtInt(s.graded)} avaliadas</span></td>
  <td data-label="vs campanha qualquer">{baseText(s)}</td>
  <td data-label="Concordância">{kind==='play'?(a&&fin(a.precision)&&firedOf(a)>0?`${fmtShare(a.precision)} em ${fmtInt(firedOf(a))}${firedOf(a)<15?' · amostra pequena':''}`:ND):<span title="Não se aplica a regra fixa">—</span>}</td>
  <td data-label="Antecedência">{kind==='play'?(a&&a.n&&fin(a.leadMin)?minutesText(a.leadMin):ND):<span title="Não se aplica a regra fixa">—</span>}</td>
  <td data-label="7 dias vs anteriores">{trendText(s.trend)}</td>
  <td data-label="Cortes em vencedoras" className={fin(s.winnersCut)&&s.winnersCut>0?'is-bad':''}>{fmtInt(s.winnersCut)}</td>
  <td data-label="Trava de placar"><GateMeter gate={gate} accuracy={kind==='rule'?s.accuracy:null} low={kind==='play'?s.low:null}/></td>
 </tr>;
}

/** "Bunk antes da equipe": per day, team cuts the Sombra had flagged earlier, as bars. */
export function LeadSpark({lead}:{lead:any}){
 const daily=Array.isArray(lead?.daily)?lead.daily:[];if(!daily.length)return null;
 const max=Math.max(1,...daily.map((d:any)=>fin(d.cuts)?d.cuts:0));
 return <figure className="aut-spark" aria-label="Cortes da equipe por dia e quantos o Bunk apontou antes">
  <div className="aut-spark__bars" aria-hidden="true">{daily.map((d:any)=><span key={d.day} title={`${dayLabel(d.day)}: ${d.ahead} de ${d.cuts}`} style={{'--h':Math.round((d.cuts||0)/max*100),'--a':d.cuts?Math.round((d.ahead||0)/d.cuts*100):0} as any}/>)}</div>
  <figcaption className="ds-caption"><span>{dayLabel(daily[0].day)}</span><span>{dayLabel(daily[daily.length-1].day)}</span></figcaption>
 </figure>;
}

export function ScoreTab({deep,loading,showProject,onOpen}:{deep:any;loading:boolean;showProject:boolean;onOpen:(r:CampaignRef)=>void}){
 if(loading&&!deep)return <div className="aut-tab"><section className="ds-card"><SkeletonRows label="Carregando o placar…"/></section></div>;
 if(!deep)return <div className="aut-tab"><section className="ds-card"><Empty>Sem a leitura do executor agora. O placar aparece aqui quando ela chegar.</Empty></section></div>;
 const projects=Object.entries<any>(deep.projects||{});
 return <div className="aut-tab aut-score-tab">{projects.map(([id,p])=>{
  const sc=p?.score||{},rules=Object.entries<any>(sc.rules||{}),plays=Object.entries<any>(sc.plays||{}),pbPlays=Array.isArray(p?.playbook?.plays)?p.playbook.plays:[];
  const nothing=!rules.some(([,s])=>s?.graded>0)&&!plays.some(([,s])=>s?.graded>0),gated=rules.find(([,s])=>s?.gate)?.[1]?.gate;
  const lead=sc.lead14d,camp=(o:string)=>(p?.now?.campaigns||[]).find((c:any)=>String(c.objectId)===String(o))?.name||null;
  return <section key={id} className="ds-card aut-score-card" aria-label={`Placar de ${p.name||id}`}>
   <header className="ds-header"><h2 className="ds-header__title">{showProject?`Placar · ${p.name||id}`:'Placar da versão atual'}</h2><span className="ds-header__detail">nota do dia seguinte (D+1) de cada decisão da Sombra</span></header>
   {nothing&&<p className="ds-empty ds-empty--waiting">Placar da versão atual: {fmtInt(gated?.graded??0)} de {fmtInt(gated?.need??20)} avaliadas. As primeiras notas chegam amanhã.</p>}
   <div className="aut-score-wrap"><table className="aut-score">
    <thead><tr><th scope="col">Regra ou jogada</th><th scope="col">Estágio</th><th scope="col">Acerto (faixa)</th><th scope="col">vs campanha qualquer</th><th scope="col">Concordância</th><th scope="col">Antecedência</th><th scope="col">7 dias vs anteriores</th><th scope="col">Cortes em vencedoras</th><th scope="col">Trava de placar</th></tr></thead>
    <tbody>
     {rules.map(([r,s])=><ScoreRow key={r} name={s.label||r} s={s} kind="rule"/>)}
     {plays.map(([k,s])=>{const pl=pbPlays.find((x:any)=>x.key===k);return <ScoreRow key={k} name={pl?.sentence||s.label||k} s={{...s,stage:pl?.stage||s.stage}} kind="play" play={pl}/>;})}
     {/* Plays with cases but no graded decision yet: on the table with N/D, never 0%. */}
     {pbPlays.filter((pl:any)=>pl?.key&&!sc.plays?.[pl.key]&&(pl.stage==='candidata'||pl.support?.moves>0)).map((pl:any)=><ScoreRow key={pl.key} name={pl.sentence||pl.id} s={{rev:pl.rev,graded:0,right:0,accuracy:null,low:null,high:null,base:null,chanceBetter:null,trend:null,winnersCut:null,stage:pl.stage}} kind="play" play={pl}/>)}
    </tbody>
   </table></div>
   <div className="aut-score__lead">
    <h3 className="ds-eyebrow">Bunk antes da equipe · 14 dias</h3>
    {!lead?<p className="ds-caption">N/D: sem memória de cortes da equipe neste recorte.</p>:<>
     <p className="ds-body">{lead.cuts?`A Sombra apontou antes ${lead.ahead} de ${lead.cuts} cortes da equipe (${fmtShare(lead.share)})${fin(lead.medianLeadMin)?`, mediana de ${minutesText(lead.medianLeadMin)} antes`:''}.`:'Nenhum corte da equipe com Sombra rodando neste recorte.'}{lead.previous?.cuts?` Na semana anterior: ${lead.previous.ahead} de ${lead.previous.cuts}.`:''}</p>
     <LeadSpark lead={lead}/></>}
   </div>
   <div className="aut-score__blind">
    <h3 className="ds-eyebrow">Pontos cegos · a equipe agiu e o Bunk não</h3>
    {!(sc.blindSpots||[]).length?<p className="ds-caption">Nenhum ponto cego registrado.</p>:<ul className="ds-list ds-list--divided">{sc.blindSpots.slice(0,20).map((b:any,i:number)=><li key={i}><button type="button" className="ds-row" onClick={()=>onOpen({project:id,projectName:p.name,adAccountId:b.adAccountId,objectId:String(b.objectId),name:camp(b.objectId)})}><span className="ds-row__main"><span className="ds-row__title">{camp(b.objectId)||`Campanha ${b.objectId}`}</span><span className="ds-row__sub">{dayLabel(b.day)} {clock(b.at)} · {b.by==='owner'?'você fez':'a equipe fez'} {kindText[b.kind]||b.kind}</span></span><span className="ds-row__chevron" aria-hidden="true"/></button></li>)}</ul>}
   </div>
  </section>;})}
 </div>;
}
