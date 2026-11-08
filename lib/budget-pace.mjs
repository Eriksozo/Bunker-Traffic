/** Today's spend pace against the active daily budgets, per project and in the project currency.
 * Reading aid only: not a forecast of results, not a proposal, never an execution signal.
 * Budgets use the row's own conversion rate (same rule as analysis.budget); a campaign without a known
 * daily budget at campaign level (ABO, lifetime) stays out of the pace and is counted as unknown. */
import {rowKey} from './analysis.mjs';
import {ALL_PROJECTS} from './project-scope.mjs';

const finite=Number.isFinite,time=v=>typeof v==='string'?Date.parse(v):NaN;
export const paceLimits=Object.freeze({minElapsedMs:2*3600000,onPaceLow:0.85,onPaceHigh:1.05,dayMs:86400000,earlyHour:18,underLeftoverPct:40,underElapsedPct:40});
const localHour=(iso,zone)=>{try{return Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date(iso)));}catch{return null;}};

/** Budget currency → project currency: the row's own rate, or 1 when both currencies are the same. */
const rate=(r,currency)=>finite(r?.budgetRate)&&r.budgetRate>0?r.budgetRate:currency&&String(r?.budgetCurrency||'').toUpperCase()===currency.toUpperCase()?1:NaN;

/** One project's pace from its latest today snapshot. */
export function projectPace(state,id,now=Date.now()){
 const cfg=state?.config?.[id]||{},name=cfg.projectName||id,currency=typeof cfg.currency==='string'?cfg.currency:null;
 const snap=(state?.snapshots||[]).filter(s=>s.projectId===id&&s.period==='today'&&s.level==='campaign').sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt))[0];
 const base={project:id,name,currency,status:'nd',budget:null,spend:null,projected:null,elapsedPct:null,exhaustsAt:null,known:0,unknown:0,at:snap?.fetchedAt||null};
 if(!snap||!finite(time(snap.from))||!finite(time(snap.fetchedAt)))return {...base,reason:'Sem leitura de hoje.'};
 // After local midnight the newest "today" source is still yesterday's day until the next analysis.
 if(now-time(snap.from)>=paceLimits.dayMs)return {...base,reason:'A leitura de hoje ainda não chegou; a última é do dia anterior.'};
 const elapsed=Math.min(time(snap.fetchedAt),now)-time(snap.from);
 const seen=new Set();let budget=0,spend=0,known=0,unknown=0;
 for(const r of Array.isArray(snap.rows)?snap.rows:[]){
  const key=rowKey({...r,projectId:id});if(seen.has(key))continue;seen.add(key);
  if(r.effectiveStatus!=='ACTIVE'||r.accountStatus?.active===false)continue;
  const value=finite(r.dailyBudget)&&r.dailyBudget>0?r.dailyBudget*rate(r,currency):NaN;
  if(!finite(value)||!finite(r.spend)){unknown++;continue;}
  budget+=value;spend+=r.spend;known++;
 }
 const out={...base,known,unknown,elapsedPct:elapsed>0?Math.round(Math.min(1,elapsed/paceLimits.dayMs)*1000)/10:null};
 if(!known||budget<=0)return {...out,reason:'Nenhuma campanha ativa com orçamento diário conhecido.'};
 if(elapsed<paceLimits.minElapsedMs)return {...out,budget,spend,reason:'Cedo demais no dia para medir o ritmo.'};
 const projected=spend/(elapsed/paceLimits.dayMs),ratio=projected/budget;
 let status='on',exhaustsAt=null;
 if(spend>=budget)status='spent';
 else if(ratio>=paceLimits.onPaceHigh){status='exhausts';exhaustsAt=new Date(time(snap.from)+budget/spend*elapsed).toISOString();}
 else if(ratio<=paceLimits.onPaceLow)status='under';
 const leftoverPct=status==='under'?Math.round((1-ratio)*100):null,hour=exhaustsAt?localHour(exhaustsAt,snap.timezone):null;
 // Owner-facing warnings: a budget that runs out before 18:00 (project time), or spending far below pace past 40% of the day.
 const alert=status==='exhausts'&&hour!==null&&hour<paceLimits.earlyHour?'early':status==='under'&&leftoverPct>=paceLimits.underLeftoverPct&&(out.elapsedPct??0)>=paceLimits.underElapsedPct?'under':null;
 return {...out,status,budget,spend,projected,exhaustsAt,leftoverPct,alert};
}

/** Scope pace: one project, or every configured project with a combined line only when all share one currency. */
export function budgetPace(state,project=ALL_PROJECTS,now=Date.now()){
 const ids=project===ALL_PROJECTS?Object.keys(state?.config||{}):[project];
 const byProject=ids.map(id=>projectPace(state,id,now));
 if(project!==ALL_PROJECTS)return {...byProject[0],byProject};
 const measured=byProject.filter(p=>['on','under','exhausts','spent'].includes(p.status));
 const currencies=new Set(measured.map(p=>p.currency));
 const combined={project,name:'Todos os projetos',currency:currencies.size===1?[...currencies][0]:null,status:'nd',budget:null,spend:null,projected:null,elapsedPct:null,exhaustsAt:null,
  known:byProject.reduce((s,p)=>s+p.known,0),unknown:byProject.reduce((s,p)=>s+p.unknown,0),at:null,byProject};
 if(!measured.length)return {...combined,reason:byProject[0]?.reason||'Sem leitura de hoje.'};
 if(currencies.size>1)return {...combined,reason:'Projetos em moedas diferentes: veja o ritmo por projeto.'};
 const budget=measured.reduce((s,p)=>s+p.budget,0),spend=measured.reduce((s,p)=>s+p.spend,0),projected=measured.reduce((s,p)=>s+p.projected,0),ratio=projected/budget;
 const status=spend>=budget?'spent':ratio>=paceLimits.onPaceHigh?'exhausts':ratio<=paceLimits.onPaceLow?'under':'on';
 return {...combined,status,budget,spend,projected,leftoverPct:status==='under'?Math.round((1-ratio)*100):null,
  // Earliest project that runs out, so the combined line can still say when the first budget ends.
  exhaustsAt:measured.map(p=>p.exhaustsAt).filter(Boolean).sort()[0]||null};
}
