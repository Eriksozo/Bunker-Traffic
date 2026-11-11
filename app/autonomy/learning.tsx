'use client';
/* Aprendizado: what the Bunk learned from the team (Erik, Leonardo Paz, Jorge), play by play and person by person.
 * Phase 1 only observes: plays never send, ask or become proposals, and Adotar / Liberar render disabled. */
import {useId,useMemo,useState} from 'react';
import {Sparkles} from 'lucide-react';
import {AgreementBar,Empty,FlagChips,HourBars,NextPhaseButton,PersonChip,SkeletonRows,StageLadder,brl,dayLabel,fin,fmtInt,fmtRange,fmtShare,fmtStep,minutesText,plural,stageLabels,stamp,ND,type CampaignRef} from './components';

const kindText:Record<string,string>={pause:'pausa',reduce:'reduz',increase:'aumenta',activate:'reativa',cut:'corta'};
const paramNames:Record<string,string>={k:'gasto (tickets)',r:'ROI de hoje',r1:'ROI de hoje',r3:'ROI 3 dias',h:'a partir de (h)',h1:'das (h)',h2:'até (h)',f:'front',s:'passo',stage:'estágio'};
const paramText=(params:any)=>Object.entries(params||{}).filter(([,v])=>v!==undefined).slice(0,4).map(([k,v])=>`${paramNames[k]||k} ${fin(v)?(v as number).toLocaleString('pt-BR',{maximumFractionDigits:2}):ND}`).join(' · ');
/** Why a play is still only observed: missing cases first, then the fit's own reason (runner `reason`). */
const reasonText:Record<string,string>={'poucos-casos':'ainda sem casos suficientes',instavel:'o limite ainda muda muito entre as amostras',divergencia:'a equipe faz coisas opostas neste cenário',dormindo:'nenhum caso nos últimos 14 dias',
 'sem-acerto':'ainda não concorda o bastante com a equipe'};
export function observingText(play:any){
 const s=play?.support||{};
 if(fin(s.missing)&&s.missing>0)return `faltam ${plural(s.missing,'caso','casos')}`;
 return reasonText[play?.reason]||'ainda sem casos suficientes';
}
const rateText=(r:any)=>r&&fin(r.rate)?`${fmtShare(r.rate)}${fmtRange(r.low,r.high)?` (${fmtRange(r.low,r.high)})`:''} em ${r.n}`:ND;

export function PlayCard({play,onOpen,project}:{play:any;onOpen:(r:CampaignRef)=>void;project:string}){
 const [cases,setCases]=useState(false),uid=useId(),s=play.support||{},a=play.agreement,w=play.wouldHave7d;
 const v=fin(play.version)?`v${play.version}`:String(play.rev||'').split(':')[0]||'versão N/D';
 return <article className={`ds-card ds-card--sunken aut-play stage-${play.stage}`} aria-labelledby={`${uid}-t`}>
  <header className="aut-play__head">
   <span className={`ds-pill ${play.stage==='candidata'?'ds-pill--accent':'ds-pill--neutral'}`}><span className={`ds-glyph ${play.stage==='candidata'?'ds-glyph--accent':'ds-glyph--waiting'}`} aria-hidden="true"/>{stageLabels[play.stage]||ND}</span>
   <span className="ds-caption">Jogada da equipe {v} · {play.role==='champion'?'adotada':'não adotada'}</span>
  </header>
  <h3 id={`${uid}-t`} className="ds-title aut-play__sentence">{play.sentence||play.id}</h3>
  <StageLadder stage={play.stage}/>
  {play.stage==='observando'&&<p className="ds-empty ds-empty--waiting">Observando: {observingText(play)} ({fmtInt(s.moves)}/{fmtInt(s.need?.moves)} ações, {fmtInt(s.campaigns)}/{fmtInt(s.need?.campaigns)} campanhas, {fmtInt(s.days)}/{fmtInt(s.need?.days)} dias).</p>}
  <div className="aut-play__from"><span className="ds-caption">Aprendida com</span>
   <ul className="aut-people">{(Array.isArray(play.learnedFrom)?play.learnedFrom:[]).map((p:any)=><li key={p.person}><PersonChip name={p.name} n={p.n}/>{p.params?<span className="ds-caption aut-people__params">{paramText(p.params)}</span>:<span className="ds-caption aut-people__params">poucos casos para o jeito próprio</span>}</li>)}</ul>
  </div>
  <dl className="aut-facts">
   <div><dt>Consenso</dt><dd>{paramText(play.params)||ND}</dd></div>
   {play.step&&<div><dt>Passo</dt><dd><span className="ds-num">{fmtStep(play.step.median)}</span>{fin(play.step.p25)&&fin(play.step.p75)?` (metade entre ${fmtStep(play.step.p25)} e ${fmtStep(play.step.p75)})`:''}</dd></div>}
   <div><dt>Base</dt><dd>{fmtInt(s.moves)} ações · {fmtInt(s.campaigns)} campanhas · {fmtInt(s.days)} dias</dd></div>
   <div><dt>Cobertura</dt><dd>{a&&a.n?fmtShare(a.recall):ND}</dd></div>
   <div><dt>Antecedência</dt><dd>{a&&a.n&&fin(a.leadMin)?`${minutesText(a.leadMin)} antes`:ND}</dd></div>
   <div><dt>Ao contrário da equipe</dt><dd>{a&&a.n?fmtShare(a.opposite):ND}</dd></div>
   <div><dt>D+1 nos casos aprendidos</dt><dd>{rateText(play.outcome?.d1)}{fin(play.outcome?.base)?` · campanha qualquer ${fmtShare(play.outcome.base)}`:''}</dd></div>
   <div><dt>D+3 nos casos aprendidos</dt><dd>{rateText(play.outcome?.d3)}</dd></div>
  </dl>
  <AgreementBar a={a}/>
  <p className="aut-play__would">{w?`Teria feito nos últimos 7 dias: ${w.total}, ${w.sameAsTeam} iguais às suas, ${w.nobodyDid} que ninguém fez.`:'Teria feito nos últimos 7 dias: N/D.'}</p>
  <FlagChips flags={play.flags}/>
  {play.challenger&&<p className="ds-hint">Versão nova em teste na Sombra ({String(play.challenger.rev||'').split(':')[0]||'nova'}): {(play.challenger.diff||[]).map((d:any)=>`${paramNames[d.param]||d.param} ${fin(d.from)?d.from.toLocaleString('pt-BR'):ND} → ${fin(d.to)?d.to.toLocaleString('pt-BR'):ND}`).join(' · ')||'parâmetros N/D'}. {play.challenger.score?.graded?`Placar dela: ${fmtInt(play.challenger.score.right)} de ${fmtInt(play.challenger.score.graded)} certas${fmtRange(play.challenger.score.low,play.challenger.score.high)?` (faixa ${fmtRange(play.challenger.score.low,play.challenger.score.high)})`:''}.`:'Placar dela: ainda sem nota.'} A versão em uso não muda sem o seu sim.</p>}
  <div className="aut-play__actions">
   <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" aria-expanded={cases} aria-controls={`${uid}-cases`} disabled={!play.caseRefs?.length} title={!play.caseRefs?.length?'Sem casos de exemplo ainda.':undefined} onClick={()=>setCases(!cases)}>Ver casos{play.caseRefs?.length?` (${play.caseRefs.length})`:''}</button>
   <NextPhaseButton id={`${uid}-adopt`}>Adotar</NextPhaseButton>
   <NextPhaseButton id={`${uid}-release`}>Liberar no Automático</NextPhaseButton>
  </div>
  {cases&&<ul id={`${uid}-cases`} className="ds-list ds-list--divided aut-cases">{play.caseRefs.map((c:any,i:number)=><li key={i}><button type="button" className="ds-row" onClick={()=>onOpen({project,adAccountId:c.adAccountId,objectId:String(c.objectId),name:c.campaign})}><span className="ds-row__main"><span className="ds-row__title" title={c.campaign||undefined}>{c.campaign||`Campanha ${c.objectId}`}</span><span className="ds-row__sub">{dayLabel(c.day)} · {c.name} {kindText[c.kind]||c.kind}{fin(c.step)?` ${fmtStep(c.step)}`:''}</span></span><span className="ds-row__chevron" aria-hidden="true"/></button></li>)}</ul>}
 </article>;
}

export function PersonCard({p}:{p:any}){
 const t=p.testPauses||{},b=p.budget||{},c=p.counts||{},who=p.role==='owner'?'você':p.name,testPoint=t.point;
 return <article className="ds-card ds-card--sunken aut-personcard">
  <header className="aut-personcard__head"><PersonChip name={p.name} role={p.role}/><span className="ds-caption">{fmtInt(c.actions)} ações em 30 dias · {fmtInt(c.pause)} pausas · {fmtInt(c.reduce)} reduções · {fmtInt(c.increase)} aumentos</span></header>
  <dl className="aut-facts">
   <div><dt>Pausa de teste sem venda</dt><dd>{t.n?<>mediana <span className="ds-num">{brl(t.median)}</span>{fin(t.p25)&&fin(t.p75)?` (metade entre ${brl(t.p25)} e ${brl(t.p75)})`:''} · {t.beforePoint} de {t.n} antes do ponto da Sombra{fin(testPoint)?` (${brl(testPoint)})`:''}</>:'Sem pausas de teste em 30 dias.'}</dd></div>
   <div><dt>Passo de aumento</dt><dd className="ds-num">{fmtStep(b.medianUp)}</dd></div>
   <div><dt>Passo de corte</dt><dd className="ds-num">{fmtStep(b.medianDown)}</dd></div>
   <div><dt>Acerto no D+1</dt><dd>{b.graded?`${fmtShare(b.accuracy)}${fmtRange(b.low,b.high)?` (${fmtRange(b.low,b.high)})`:''} em ${b.graded}${b.graded<10?' · amostra pequena':''}`:ND}</dd></div>
   <div><dt>Acerto no D+3</dt><dd>{b.d3?.graded?`${fmtShare(b.d3.accuracy)}${fmtRange(b.d3.low,b.d3.high)?` (${fmtRange(b.d3.low,b.d3.high)})`:''} em ${b.d3.graded}${b.d3.graded<10?' · amostra pequena':''}`:ND}</dd></div>
   <div><dt>vs campanha qualquer</dt><dd>{b.base&&fin(b.base.expected)&&b.base.graded>=10?`${fmtShare(b.base.expected)} acertaria ao acaso${fin(b.base.edge)?` · ${b.base.edge>=0?'+':'−'}${Math.round(Math.abs(b.base.edge)*100)} p.p.`:''}`:b.base&&b.base.graded?'amostra pequena':ND}</dd></div>
  </dl>
  <HourBars hours={p.hours}/>
  <AgreementBar a={p.agreement} mode="recall" label={p.role==='owner'?'Seus movimentos que o Bunk pegou':`Movimentos de ${p.name} que o Bunk pegou`}/>
 </article>;
}

export function LearningTab({deep,loading,showProject,onOpen}:{deep:any;loading:boolean;showProject:boolean;onOpen:(r:CampaignRef)=>void}){
 const heroId=useId();
 const projects=useMemo(()=>Object.entries<any>(deep?.projects||{}),[deep]);
 const plays=projects.flatMap(([,p])=>Array.isArray(p?.playbook?.plays)?p.playbook.plays:[]),ready=plays.filter((x:any)=>x.stage==='candidata').length;
 const people=(Array.isArray(deep?.memory?.peopleMoves)?deep.memory.peopleMoves:[]);
 const fitAt=projects.map(([,p])=>p?.playbook?.fitAt).filter(Boolean).sort().pop()||null,nextFit=projects.map(([,p])=>p?.playbook?.nextFitAt).filter(Boolean).sort()[0]||null;
 const sinGanho=projects.flatMap(([id,p])=>(p?.playbook?.plays||[]).filter((x:any)=>(x.flags||[]).some((f:string)=>f==='imitacao-sem-ganho'||f==='cortes-em-vencedoras')).map((x:any)=>({...x,projectName:p.name||id})));
 if(loading&&!deep)return <div className="aut-tab"><section className="ds-card"><SkeletonRows label="Carregando o que o Bunk aprendeu…"/></section></div>;
 return <div className="aut-tab aut-learn">
  <section className="ds-card ds-card--lg aut-hero" aria-labelledby={`${heroId}-t`}>
   <span className="ds-badge ds-badge--accent" aria-hidden="true"><Sparkles size={16}/></span>
   <div className="aut-hero__body">
    <span className="ds-eyebrow">Modo Gestor · o Bunk cuida como a equipe</span>
    <h2 id={`${heroId}-t`} className="ds-headline">{deep?.memory&&fin(deep.memory.days)&&deep.memory.days>0?`${fin(deep.memory.observedDays)?(deep.memory.observedDays>0?`Observando campanhas há ${plural(deep.memory.observedDays,'dia','dias')}`:'Observando campanhas desde hoje'):`Memória de ${plural(deep.memory.days,'dia','dias')}`} · ${plural(plays.length,'jogada observada','jogadas observadas')} · ${ready} ${ready===1?'pronta':'prontas'}`:`Aprendendo com a equipe · ${deep?.memory?'memória montando':'memória N/D'}`}</h2>
    <p className="aut-master__how">O Bunk observa o que Erik, Leonardo Paz e Jorge fazem e continua aprendendo: todo dia reajusta as jogadas, testa versões novas na Sombra e dá nota a cada uma. Uma jogada nova ou mudada só poderá enviar com o seu toque, na versão exata. Rebaixar é automático; promover, nunca. Nesta fase ele só observa: nenhuma jogada envia, pede ou vira proposta.</p>
    {deep?.memory&&fin(deep.memory.days)&&deep.memory.days>0&&<p className="ds-caption">Memória de ações: {plural(deep.memory.days,'dia','dias')}{Object.values(deep.memory.backfill||{}).some((b:any)=>b?.moves>0)?', com o histórico de 30 dias da Malva':''}. O histórico conta as ações de cada pessoa e o tamanho dos passos, mas ainda não ensina quando agir: as condições das jogadas vêm só das leituras que o Bunk faz de hora em hora.</p>}
    {!!people.length&&<ul className="aut-people" aria-label="Ações por pessoa em 30 dias">{people.map((p:any)=><li key={p.person}><PersonChip name={p.name} n={p.moves} role={p.role}/></li>)}</ul>}
    {!people.length&&<p className="ds-caption">Ações por pessoa: N/D (o Modo Gestor ainda não leu a memória da equipe).</p>}
    <p className="ds-caption">{fitAt?`Último ajuste das jogadas ${stamp(fitAt)}`:'Jogadas ainda não ajustadas'}{nextFit?` · próximo ${stamp(nextFit)}`:''}</p>
    <div className="aut-hero__cta"><NextPhaseButton id={`${heroId}-cta`}>Deixar o Bunk cuidar como a equipe</NextPhaseButton></div>
   </div>
  </section>
  <div className="ds-banner ds-banner--info"><div className="ds-banner__body"><strong>Associação, não causa.</strong><p>As jogadas descrevem o que a equipe costuma fazer em cada situação e como o dia seguinte foi. Isso não prova que o resultado veio da ação.</p></div></div>
  {!deep&&<Empty>Sem a leitura do executor agora. O aprendizado aparece aqui quando ela chegar.</Empty>}
  {projects.map(([id,p])=>{const pb=p?.playbook,team=p?.team;return <section key={id} className="ds-card aut-learn__project" aria-label={`Aprendizado em ${p.name||id}`}>
   <header className="ds-header"><h2 className="ds-header__title">{showProject?p.name||id:'Jogadas da equipe'}</h2><span className="ds-header__detail">{pb?`${plural((pb.plays||[]).length,'jogada','jogadas')}${pb.fitAt?` · ajustadas ${stamp(pb.fitAt)}`:''}`:'Modo Gestor: N/D'}</span></header>
   {!pb?<Empty tone="waiting">O Modo Gestor ainda não montou as jogadas deste projeto. Elas aparecem depois do primeiro ajuste do executor.</Empty>
    :pb.state==='sem-dados'||!(pb.plays||[]).length?<Empty tone="waiting">Ainda sem ações suficientes da equipe neste projeto: cada jogada precisa de 8 ações, 4 campanhas e 3 dias.</Empty>
    :<div className="aut-plays">{pb.plays.map((x:any)=><PlayCard key={x.key||x.id} play={x} project={id} onOpen={onOpen}/>)}</div>}
   {!!pb?.divergences?.length&&<div className="aut-divs"><h3 className="ds-eyebrow">Divergências na equipe</h3>{pb.divergences.map((d:any)=><div key={d.id} className="ds-banner ds-banner--warn"><div className="ds-banner__body"><strong>{d.text}</strong><p>{(d.people||[]).map((x:any)=>`${x.name}: ${kindText[x.kind]||x.kind} (${x.n})`).join(' · ')}. Nenhuma jogada é criada onde a equipe discorda.</p></div></div>)}</div>}
   {team?<div className="aut-team"><h3 className="ds-eyebrow">Cada pessoa</h3>{!(team.people||[]).length?<Empty>Nenhuma ação de pessoa nos últimos 30 dias.</Empty>:<div className="aut-personcards">{team.people.map((x:any)=><PersonCard key={x.person||x.name} p={x}/>)}</div>}
    {!!team.proposals?.length&&<div className="aut-proposals"><h3 className="ds-eyebrow">Ajustes que a equipe sugere com o próprio jeito</h3><ul className="ds-list ds-list--divided">{team.proposals.map((x:any)=><li key={x.id} className="ds-body">{x.text}</li>)}</ul><p className="ds-caption">Só leitura: nada muda sem o seu sim.</p></div>}
   </div>:<Empty>Padrões por pessoa: N/D (sem memória de aprendizado do executor neste projeto).</Empty>}
  </section>;})}
  {!!sinGanho.length&&<section className="ds-card ds-card--warn" aria-labelledby={`${heroId}-sg`}><h2 id={`${heroId}-sg`} className="ds-title">Imitação sem ganho</h2><p className="ds-caption">Jogadas que copiam a equipe sem ganho no dia seguinte (ou com cortes em vencedoras): ficam visíveis, mas nunca passam da Sombra.</p><ul className="ds-list ds-list--divided">{sinGanho.map((x:any)=><li key={x.key||x.id} className="ds-body">{showProject?`${x.projectName}: `:''}{x.sentence}</li>)}</ul></section>}
 </div>;
}
