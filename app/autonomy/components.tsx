'use client';
/* Shared pieces of the Autonomia cockpit (Modo Gestor, Phase 1, 10/11/2026). Presentation only: every number shown comes from
 * the executor's AutonomyDeepView (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, contract a) or from the saved config, never
 * invented here. N/D (null) is always "N/D", never 0. The only client-side number is the draft simulator's (permissions.tsx). */
import type {ReactNode} from 'react';

/* ---------- Types (contract a, the fields the cockpit reads; readers ignore unknown fields) ---------- */
export type DecisionStatus='enviaria'|'pediria'|'so-sugestao'|'segurada'|'desligado';
/** `n`: team moves (recall's sample); `fired`: times the play would have acted (precision's and the range's sample). */
export type Agreement={precision:number|null;recall:number|null;leadMin:number|null;opposite:number|null;low:number|null;high:number|null;n:number;fired?:number|null;agree?:number|null;caught?:number|null};
/** The precision's own sample: `fired` when the executor sends it (older views: `n`). */
export const firedOf=(a:Agreement|null|undefined)=>a?(fin(a.fired)?a.fired:a.n):0;
/** Steps of a Bunk order, in Portuguese (timeline and drawer). */
export const stepNames:Record<string,string>={decidiu:'Decidiu',aprovada:'Aprovada',reservada:'Reservada',preparada:'Preparada',enviada:'Enviada',confirmada:'Confirmada',falhou:'Falhou',verificacao:'Em verificação'};
export type Deep=any;export type ProjectDeep=any;export type Decision=any;export type NowCampaign=any;export type Play=any;

/* ---------- Formatting (pt-BR; null/NaN → N/D) ---------- */
export const ND='N/D';
export const fin=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v);
export const fmtInt=(v:any)=>fin(v)?Math.round(v).toLocaleString('pt-BR'):ND;
export const fmtDec=(v:any,d=2)=>fin(v)?v.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}):ND;
/** ROI/ROAS multiplier. */
export const fmtX=(v:any)=>fin(v)?`${fmtDec(v)}x`:ND;
/** A 0–1 fraction as a percent. */
export const fmtShare=(v:any)=>fin(v)?`${Math.round(v*100).toLocaleString('pt-BR')}%`:ND;
/** A signed percent (+30 = up). */
export const fmtSignedPct=(v:any)=>fin(v)?`${v>0?'+':v<0?'−':''}${Math.abs(v).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:ND;
/** A step fraction (+0.3 / −0.2) as a signed percent. */
export const fmtStep=(v:any)=>fin(v)?fmtSignedPct(Math.round(v*1000)/10):ND;
/** Performance money: BRL, as Malva reports it (contract §0.2). */
export const brl=(v:any)=>fin(v)?v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}):ND;
/** BRL in whole reais for the narrow window table. */
export const brl0=(v:any)=>fin(v)?v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:0,maximumFractionDigits:0}):ND;
/** Budgets: native currency next to its code; without a valid code, a bare number (never an invented R$). */
export const nativeMoney=(v:any,currency?:any)=>!fin(v)?ND:typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)?v.toLocaleString('pt-BR',{style:'currency',currency,maximumFractionDigits:2}):v.toLocaleString('pt-BR',{maximumFractionDigits:2});
export const fmtRange=(lo:any,hi:any)=>fin(lo)&&fin(hi)?`${fmtShare(lo)}–${fmtShare(hi)}`:null;
export const stamp=(v:any)=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):ND;};
export const clock=(v:any)=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):ND;};
export const dayLabel=(d:any)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)?`${d.slice(8,10)}/${d.slice(5,7)}`:ND;
export function minutesText(m:any){if(!fin(m))return ND;const v=Math.max(0,Math.round(m));return v<60?`${v} min`:v%60?`${Math.floor(v/60)}h ${v%60}min`:`${v/60}h`;}
/** "há 3 min" from an ISO time, against the caller's clock. */
export function ago(at:any,now:number){const t=Date.parse(at);if(!Number.isFinite(t))return ND;const m=Math.max(0,Math.round((now-t)/60000));return m<1?'agora há pouco':m<60?`há ${m} min`:m<48*60?`há ${Math.round(m/60)}h`:`há ${Math.round(m/1440)} dias`;}
export const plural=(n:number,one:string,many:string)=>`${n.toLocaleString('pt-BR')} ${n===1?one:many}`;
/** "A, B e C". */
export const joinNames=(l:string[])=>l.length<=1?(l[0]||''):`${l.slice(0,-1).join(', ')} e ${l[l.length-1]}`;
export const statusName:Record<string,string>={ACTIVE:'Ativa',PAUSED:'Pausada',ARCHIVED:'Arquivada',DELETED:'Excluída'};

/* ---------- Status chips (contract a.5 status table; the cockpit only maps, never derives) ---------- */
export const decisionStatuses:DecisionStatus[]=['enviaria','pediria','so-sugestao','segurada','desligado'];
export const statusLabels:Record<DecisionStatus,string>={enviaria:'Enviaria',pediria:'Pediria a você','so-sugestao':'Só sugestão',segurada:'Segurada',desligado:'Desligado aqui'};
const statusTone:Record<DecisionStatus,string>={enviaria:'good',pediria:'warn','so-sugestao':'neutral',segurada:'warn',desligado:'neutral'};
const statusGlyph:Record<DecisionStatus,string>={enviaria:'good',pediria:'waiting','so-sugestao':'info',segurada:'warn',desligado:'neutral'};
const whyText:Record<string,string>={'nivel-sombra':'nível Sombra','so-alerta':'só alerta','jogada-em-observacao':'jogada em observação'};
/** Chip for one decision. A playbook decision can never read "Enviaria"/"Pediria" in Phase 1, whatever arrives. */
export function chipFor(d:Decision){
 let status:DecisionStatus=decisionStatuses.includes(d?.status)?d.status:'segurada';
 let why=d?.suggestionWhy||null;
 if(d?.source==='playbook'&&(status==='enviaria'||status==='pediria')){status='so-sugestao';why='jogada-em-observacao';}
 let detail:string|null=null;
 if(status==='so-sugestao')detail=why==='placar'?`placar ${fmtInt(d?.gate?.graded)}/${fmtInt(d?.gate?.need)}`:why?whyText[why]||null:null;
 if(status==='segurada')detail=(Array.isArray(d?.holdReasons)&&d.holdReasons[0])||(Array.isArray(d?.blockedBy)&&d.blockedBy[0])||'motivo N/D';
 const label=status==='segurada'?`Segurada: ${detail}`:detail?`${statusLabels[status]} · ${detail}`:statusLabels[status];
 return {status,label,tone:statusTone[status],glyph:statusGlyph[status],detail};
}
export function StatusChip({d}:{d:Decision}){const c=chipFor(d);return <span className={`ds-pill ds-pill--${c.tone} aut-chip`} title={c.label}><span className={`ds-glyph ds-glyph--${c.glyph}`} aria-hidden="true"/><span className="aut-chip__text">{c.label}</span></span>;}

/* ---------- Decision pieces ---------- */
/** "Regra fixa · …" or "Jogada da equipe v3 · aprendida com Jorge 14 · Erik 9". */
export function sourceText(d:Decision){
 if(d?.source!=='playbook')return `Regra fixa · ${d?.ruleLabel||d?.rule||'regra N/D'}`;
 const v=/^v(\d+)/.exec(String(d?.rev||''))?.[1],from=(Array.isArray(d?.play?.learnedFrom)?d.play.learnedFrom:[]).filter((p:any)=>fin(p?.n)&&p.n>0).map((p:any)=>`${p.name} ${p.n}`);
 return `Jogada da equipe${v?` v${v}`:''}${from.length?` · aprendida com ${from.join(' · ')}`:''}`;
}
/** Before → after: status names, or the native daily budget with its signed percent. */
export function DiffRow({action,before,after,percent}:{action:string;before:any;after:any;percent?:number|null}){
 if(action==='status')return <span className="aut-diff"><span className="aut-diff__from">{statusName[before?.status]||before?.status||ND}</span><span className="aut-diff__arrow" aria-label="para">→</span><strong className="aut-diff__to">{statusName[after?.status]||after?.status||ND}</strong></span>;
 const cur=after?.currency??before?.currency??null,tone=fin(percent)?percent>0?'good':percent<0?'bad':'neutral':'neutral';
 return <span className="aut-diff"><span className="aut-diff__from ds-num">{nativeMoney(before?.dailyBudget,cur)}</span><span className="aut-diff__arrow" aria-label="para">→</span><strong className="aut-diff__to ds-num">{nativeMoney(after?.dailyBudget,cur)}</strong>{fin(percent)&&<span className={`ds-pill ds-pill--${tone} aut-diff__pct`}>{percent>0?'↑':percent<0?'↓':''} {fmtSignedPct(percent)}</span>}{!cur&&<span className="ds-caption">moeda N/D</span>}</span>;
}
const windowCols:[string,string][]=[['today','Hoje'],['yesterday','Ontem'],['d3','3 dias'],['d7','7 dias']];
/** The four windows of one campaign: spend, front sales and ROI (BRL; null window → N/D cells). */
export function WindowTable({windows,partialDay,compact=false}:{windows:any;partialDay?:any;compact?:boolean}){
 const w=windows||{};
 return <table className={`aut-wtable${compact?' is-compact':''}`}>
  <thead><tr><th scope="col"><span className="ds-sr-only">Métrica</span></th>{windowCols.map(([k,l])=><th scope="col" key={k}>{l}{k==='today'&&partialDay?<span className="ds-glyph ds-glyph--waiting aut-wtable__partial" title="Dia parcial" aria-label="parcial"/>:null}</th>)}</tr></thead>
  <tbody>
   <tr><th scope="row">Gasto</th>{windowCols.map(([k])=><td key={k} className={fin(w[k]?.spend)?'':'is-nd'} title={brl(w[k]?.spend)}>{brl0(w[k]?.spend)}</td>)}</tr>
   <tr><th scope="row">Front</th>{windowCols.map(([k])=><td key={k} className={fin(w[k]?.frontOrders)?'':'is-nd'}>{fmtInt(w[k]?.frontOrders)}</td>)}</tr>
   <tr><th scope="row">ROI</th>{windowCols.map(([k])=>{const r=w[k]?.roi;return <td key={k} className={fin(r)?r>=1?'is-good':'is-bad':'is-nd'}>{fin(r)&&<span className={`ds-glyph ds-glyph--${r>=1?'good':'bad'}`} aria-hidden="true"/>}{fmtX(r)}</td>;})}</tr>
  </tbody>
 </table>;
}
/** Guardrail facts of one campaign, as pills (orders today, cooldown, cap use, currencies, project contingency). */
export function guardBits(g:any){
 const out:{text:string;tone:'neutral'|'warn'}[]=[];if(!g)return out;
 const lim=fin(g.ordersLimit)?g.ordersLimit:null;
 out.push({text:`Ordens do Bunk hoje ${fmtInt(g.ordersToday)}/${fmtInt(lim)}`,tone:fin(g.ordersToday)&&fin(lim)&&g.ordersToday>=lim?'warn':'neutral'});
 out.push(fin(g.cooldownMin)&&g.cooldownMin>0?{text:`Espera de 1h: faltam ${minutesText(g.cooldownMin)}`,tone:'warn'}:{text:fin(g.cooldownMin)?'Sem espera':'Espera N/D',tone:'neutral'});
 const c=g.capUse;
 if(c)out.push({text:`Teto: ${nativeMoney(c.cur,c.currency)} de ${nativeMoney(c.cap,c.currency)}${fin(c.share)?` (${fmtShare(c.share)})`:''}`,tone:fin(c.share)&&c.share>=1?'warn':'neutral'});
 else out.push({text:'Sem teto salvo: não aumenta',tone:'neutral'});
 if(c?.mixedCurrency)out.push({text:'Moedas diferentes no projeto: teto único ambíguo',tone:'warn'});
 for(const t of Array.isArray(g.contingency)?g.contingency.slice(0,3):[])out.push({text:String(t),tone:'warn'});
 return out;
}
export function Guardrails({guard}:{guard:any}){const bits=guardBits(guard);if(!bits.length)return null;return <ul className="aut-guards" aria-label="Travas desta campanha">{bits.map((b,i)=><li key={i} className={`aut-guard tone-${b.tone}`}><span className={`ds-glyph ds-glyph--${b.tone==='warn'?'warn':'info'}`} aria-hidden="true"/>{b.text}</li>)}</ul>;}

/* ---------- Learning pieces ---------- */
/**
 * Agreement with the team. Precision ("Concorda com vocês") is shown with its own sample, the times the play would have
 * acted (`fired`), and "amostra pequena" under 15 of them. `recall` mode (per person): the share of that person's moves
 * a play caught, over those moves. N/D without cases.
 */
export function AgreementBar({a,label='Concorda com vocês',mode='precision'}:{a:Agreement|null|undefined;label?:string;mode?:'precision'|'recall'}){
 const recall=mode==='recall',value=recall?a?.recall:a?.precision,sample=recall?(a?.n||0):firedOf(a);
 const has=!!a&&fin(value)&&sample>0,r=has?fmtRange(a!.low,a!.high):null;
 const hits=recall?(fin(a?.caught)?a!.caught:fin(value)?Math.round(value*sample):null):(fin(a?.agree)?a!.agree:fin(value)?Math.round(value*sample):null);
 const foot=!has?'Sem casos comparáveis ainda.':recall?`pegou ${fmtInt(hits)} de ${plural(sample,'movimento','movimentos')}${r?` · faixa ${r}`:''}${sample<15?' · amostra pequena':''}`
  :`${fmtInt(hits)} de ${plural(sample,'vez','vezes')} em que o Bunk agiria${r?` · faixa ${r}`:''}${sample<15?' · amostra pequena':''}`;
 return <div className="aut-agree">
  <div className="aut-agree__head"><span className="ds-caption">{label}</span><strong className="ds-num">{has?fmtShare(value):ND}</strong></div>
  <span className={`ds-meter ${has?'ds-meter--accent':'ds-meter--neutral'}`} style={{'--ds-meter-value':has?Math.round((value as number)*100):0} as any} role="img" aria-label={has?`${label}: ${fmtShare(value)}`:`${label}: N/D`}/>
  <span className="ds-caption aut-agree__foot">{foot}</span>
 </div>;
}
/** Readiness meter: graded vs needed and the accuracy vs the minimum (rules: accuracy ≥ 60% with 20; plays: Wilson-low ≥ 50% with 15). */
export function GateMeter({gate,accuracy=null,low=null}:{gate:any;accuracy?:number|null;low?:number|null}){
 if(!gate)return <span className="ds-caption aut-gate is-na">Sem trava de placar</span>;
 const need=fin(gate.need)?gate.need:null,graded=fin(gate.graded)?gate.graded:null,metricLow=gate.metric==='low';
 const value=need&&graded!==null?Math.min(100,Math.round(graded/need*100)):0,shown=metricLow?low:accuracy??gate.accuracy??null;
 return <div className="aut-gate">
  <span className={`ds-meter ${gate.proven?'ds-meter--good':'ds-meter--warn'}`} style={{'--ds-meter-value':value} as any} role="img" aria-label={`${fmtInt(graded)} de ${fmtInt(need)} avaliadas`}/>
  <span className="ds-caption"><span className="ds-num">{fmtInt(graded)}/{fmtInt(need)}</span> avaliadas · {fin(gate.right)&&fin(graded)?`${fmtInt(gate.right)} certas`:'certas N/D'}{fin(shown)?` · ${metricLow?'piso':'acerto'} ${fmtShare(shown)}`:''} · precisa {metricLow?'piso':'acerto'} ≥ {fmtShare(gate.min)}{gate.proven?<> · <strong className="ds-text-good">liberado pelo placar</strong></>:''}</span>
 </div>;
}
export const playStages=['observando','candidata','sombra','pode-pedir','pode-enviar'] as const;
export const stageLabels:Record<string,string>={observando:'Observando',candidata:'Candidata',sombra:'Na Sombra','pode-pedir':'Pode pedir','pode-enviar':'Pode enviar'};
/** The stage ladder; stages from "Na Sombra" up are the next phases (nothing is adopted in Phase 1). */
export function StageLadder({stage}:{stage:string}){
 const at=playStages.indexOf(stage as any);
 return <ol className="aut-ladder" aria-label={`Estágio: ${stageLabels[stage]||ND}`}>{playStages.map((s,i)=><li key={s} className={i<at?'is-done':i===at?'is-current':i>=2?'is-locked':''} aria-current={i===at?'step':undefined}><span className="aut-ladder__dot" aria-hidden="true"/>{stageLabels[s]}{i>=2&&i>at?<span className="ds-sr-only"> (próxima fase)</span>:null}</li>)}</ol>;
}
export const flagLabels:Record<string,string>={'imitacao-sem-ganho':'Imitação sem ganho',dormindo:'Dormindo: sem caso em 14 dias','horario-expediente':'Horário pode ser só o expediente',drift:'A equipe mudou o jeito',divergencia:'Divergência na equipe','cortes-em-vencedoras':'Cortes em vencedoras'};
export function FlagChips({flags}:{flags:any}){const l=(Array.isArray(flags)?flags:[]).filter((f:string)=>flagLabels[f]);if(!l.length)return null;return <ul className="aut-flags" aria-label="Avisos">{l.map((f:string)=><li key={f} className={`ds-pill ${f==='horario-expediente'||f==='dormindo'?'ds-pill--neutral':'ds-pill--warn'}`}><span className={`ds-glyph ds-glyph--${f==='horario-expediente'||f==='dormindo'?'info':'warn'}`} aria-hidden="true"/>{flagLabels[f]}</li>)}</ul>;}
/** 24 local-hour counts as tiny bars; null (older memory) → N/D. */
export function HourBars({hours}:{hours:any}){
 if(!Array.isArray(hours)||hours.length!==24)return <span className="ds-caption">Horários: N/D</span>;
 const max=Math.max(1,...hours.map((h:any)=>fin(h)?h:0)),peak=hours.reduce((b:number,h:any,i:number)=>fin(h)&&h>(hours[b]??-1)?i:b,0);
 return <figure className="aut-hours" aria-label={`Ações por hora; pico às ${peak}h`}><div className="aut-hours__bars" aria-hidden="true">{hours.map((h:any,i:number)=><span key={i} style={{'--h':fin(h)?Math.round(h/max*100):0} as any} title={`${i}h: ${fmtInt(h)}`}/>)}</div><figcaption className="ds-caption"><span>0h</span><span>12h</span><span>23h</span></figcaption></figure>;
}
/** A person as a chip with a count. */
export function PersonChip({name,n,role}:{name:string;n?:number|null;role?:string}){return <span className={`ds-chip ${role==='outside'?'ds-chip--neutral':'ds-chip--tag'} aut-person`}><span className="ds-monogram ds-monogram--circle ds-monogram--tag" aria-hidden="true">{String(name||'?').trim().charAt(0)}</span>{name}{n!==undefined&&<span className="aut-person__n ds-num">{fmtInt(n)}</span>}</span>;}

/* ---------- Island lines ---------- */
const excludeLabels:Record<string,string>={bunk:'eco do Bunk','possible-bunk-echo':'possível eco do Bunk',automation:'automação',meta:'Meta','launch-tool':'ferramenta de subida','create-delete':'criar/excluir','out-of-scope':'fora do escopo','no-author':'sem autor'};
/** "Memória: 31 dias · 512 ações de você, Jorge e Leonardo Paz · 3 excluídas (eco do Bunk)". */
export function memoryLine(memory:any,playbookStatus:any){
 if(!memory)return 'Memória: N/D (o executor ainda não montou a memória da equipe).';
 // No closed day folded yet (first pulses after the deploy, backfill running): say so instead of "0 dias · 0 ações".
 if(!memory.from&&!(memory.days>0))return 'Memória: montando (o Bunk está lendo os últimos 30 dias da equipe).';
 const days=fin(memory.days)?plural(memory.days,'dia','dias'):'dias N/D',people=(Array.isArray(memory.peopleMoves)?memory.peopleMoves:[]).filter((p:any)=>p.role!=='outside'&&fin(p.moves));
 if(!playbookStatus&&!people.length)return `Memória: ${days} · ações por pessoa N/D (o Modo Gestor ainda não leu a memória).`;
 const total=people.reduce((s:number,p:any)=>s+p.moves,0),names=people.map((p:any)=>p.role==='owner'?'você':p.name);
 const by=Object.entries(memory.excluded?.byReason||{}).filter(([,n])=>fin(n)&&(n as number)>0).sort((a:any,b:any)=>b[1]-a[1]).map(([r])=>excludeLabels[r]||r);
 // A possible Bunk echo is shown once, as quarantine, never also inside the excluded total (older views counted it there).
 const echo=fin(memory.excluded?.byReason?.['possible-bunk-echo'])?memory.excluded.byReason['possible-bunk-echo']:0,exTotal=fin(memory.excluded?.total)?memory.excluded.total-echo:0;
 const byList=by.filter((r)=>r!==excludeLabels['possible-bunk-echo']);
 const ex=exTotal>0?` · ${plural(exTotal,'excluída','excluídas')}${byList.length?` (${byList.slice(0,2).join(', ')})`:''}`:'';
 const q=fin(memory.quarantined)&&memory.quarantined>0?` · ${plural(memory.quarantined,'em quarentena','em quarentena')} (possível eco do Bunk)`:'';
 return `Memória: ${days} · ${plural(total,'ação','ações')}${names.length?` de ${joinNames(names)}`:''}${ex}${q}`;
}
/** "Olhou há 1 min · Projeto Beta pulado: fonte com 42 min". */
export function healthLine(deep:Deep,now:number){
 const s=deep?.shadowStatus;if(!s)return 'Leitura da Sombra: N/D.';
 const skipped=(Array.isArray(s.skipped)?s.skipped:[]).slice(0,3).map((x:any)=>`${x.projectName||x.project} pulado: ${x.reason}`);
 return [s.failed?`Última passada com falha ${ago(s.at,now)}`:`Olhou ${ago(s.at,now)}`,...skipped].join(' · ');
}
export function Empty({tone='info',children}:{tone?:'info'|'waiting'|'clear';children:ReactNode}){return <p className={`ds-empty${tone==='waiting'?' ds-empty--waiting':tone==='clear'?' ds-empty--clear':''}`}>{children}</p>;}
export function SkeletonRows({n=3,label}:{n?:number;label:string}){return <div className="aut-skeleton" aria-busy="true"><span className="ds-sr-only">{label}</span>{Array.from({length:n},(_,i)=><div key={i} className="aut-skeleton__row" aria-hidden="true"><span className="ds-skeleton" style={{'--ds-skeleton-w':'96px','--ds-skeleton-h':'18px'} as any}/><span className="aut-skeleton__main"><span className="ds-skeleton ds-skeleton--text" style={{'--ds-skeleton-w':'55%'} as any}/><span className="ds-skeleton ds-skeleton--text" style={{'--ds-skeleton-w':'80%'} as any}/></span></div>)}</div>;}
/** The one Phase 1 rule for owner-side learning actions: visible, disabled, with the reason. */
export function NextPhaseButton({children,id}:{children:ReactNode;id:string}){return <><button type="button" className="ds-btn ds-btn--sm" disabled aria-describedby={id} title="Chega na próxima fase">{children}</button><span className="ds-disabled-reason" id={id}>chega na próxima fase</span></>;}

/* ---------- Deep view helpers ---------- */
const rank:Record<string,number>={enviaria:0,pediria:1};
const lastTouch=(d:any)=>Math.max(Date.parse(d?.firstAt)||0,Date.parse(d?.manager?.at)||0,Date.parse(d?.owner?.at)||0);
/** Decisions of the projects in view: "enviaria"/"pediria" first, then newest (same order as the contract). */
export function deepDecisions(deep:Deep){
 const out:any[]=[];for(const [id,p] of Object.entries<any>(deep?.projects||{}))for(const d of Array.isArray(p?.decisions)?p.decisions:[])out.push({...d,project:d.project||id,projectName:d.projectName||p.name||id});
 return out.sort((a,b)=>(rank[a.status]??2)-(rank[b.status]??2)||lastTouch(b)-lastTouch(a));
}
export function deepDone(deep:Deep){const out:any[]=[];for(const [id,p] of Object.entries<any>(deep?.projects||{}))for(const o of Array.isArray(p?.done)?p.done:[])out.push({...o,project:o.project||id,projectName:p.name||id});return out.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));}
export function deepCampaigns(deep:Deep){const out:any[]=[];for(const [id,p] of Object.entries<any>(deep?.projects||{}))for(const c of Array.isArray(p?.now?.campaigns)?p.now.campaigns:[])out.push({...c,project:id,projectName:p.name||id});return out;}
export function findCampaign(deep:Deep,project:string,adAccountId:string,objectId:string){return (deep?.projects?.[project]?.now?.campaigns||[]).find((c:any)=>c.adAccountId===adAccountId&&String(c.objectId)===String(objectId))||null;}
export type CampaignRef={project:string;projectName?:string|null;adAccountId:string;objectId:string;name?:string|null};
export const refOf=(x:any):CampaignRef=>({project:x.project,projectName:x.projectName||null,adAccountId:x.adAccountId,objectId:String(x.objectId),name:x.campaign||x.name||null});
