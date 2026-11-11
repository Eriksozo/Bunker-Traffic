'use client';
/* Permissões tab of the Autonomia cockpit (Modo Gestor, Phase 1, 10/11/2026). The controls moved here from
 * app/autonomy-panel.tsx: the same draft, the same validation and the same single owner save (`autonomyConfig`, plus
 * `autonomyKill` on the island), with the CAS check on the saved revision. Deepened with read-only context from the
 * executor's deep view (largest budget today, cap use, mixed currencies), "Preencher como a equipe faz" (fills the draft
 * only, never above the current values) and the draft simulator ("só permissões", the one number computed in the browser).
 * The campaign exceptions picker below is moved untouched (tests/autonomy-campaign-picker.test.mjs reads its block). */
import {memo,useCallback,useDeferredValue,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Archive,Bot,Check,CircleOff,Eye,FingerprintPattern,Pause,Play,Plus,Save,Search,Trash2,Users,X,Zap} from 'lucide-react';
import {autonomyView,autonomyModes,autonomyActions,autonomyLimits,modeLabels,actionLabels,campaignKey} from '../../lib/autonomy-grant.mjs';
import {isWarmupCampaign} from '../../lib/campaign-scope.mjs';
import {simulateGrant} from '../../lib/autonomy-simulate.mjs';

// picker-helpers:start
/* Campaign picker helpers for "Exceções por campanha" (presentation only, 10/11/2026). Pure: no React, no DOM; tested by
 * tests/autonomy-campaign-picker.test.mjs. Nothing here decides permissions: saving still writes {mode:'off',name} under
 * campaignKey through the row's edit(), and lib/autonomy-grant.mjs stays the only judge. Out-of-scope uses the same
 * isWarmupCampaign the policy uses to block warm-up/engagement orders. */
const pickerPageSize=50;
const pickerFinite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
/** Accent- and case-insensitive text for matching. */
const foldText=(v:any)=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const statusLabels:Record<string,string>={ACTIVE:'Ativa',PAUSED:'Pausada',ARCHIVED:'Arquivada',DELETED:'Excluída'};
/** 'active' | 'paused' | 'inactive' (archived, deleted or any other Meta status) | null (no status in the reading). */
function campaignStatusKind(status:any):'active'|'paused'|'inactive'|null{const s=String(status||'').toUpperCase();return !s?null:s==='ACTIVE'?'active':s==='PAUSED'?'paused':'inactive';}
function campaignStatusLabel(status:any):string|null{const s=String(status||'').toUpperCase();return !s?null:statusLabels[s]||'Inativa';}
const pickerCollator=typeof Intl!=='undefined'?new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true}):null;
const pickerCmp=(a:any,b:any)=>pickerCollator?pickerCollator.compare(String(a??''),String(b??'')):String(a??'').localeCompare(String(b??''));
const accountLabel=(e:any)=>e.accountName||e.accountId;
const statusRank:Record<string,number>={active:0,paused:1,inactive:2};
/** Account, then active, paused, inactive (no status with paused), then today's spend (highest first, no reading last), then name. */
function comparePickerRows(a:any,b:any){return pickerCmp(accountLabel(a),accountLabel(b))||pickerCmp(a.accountId,b.accountId)||(statusRank[a.status]??1)-(statusRank[b.status]??1)||(b.spend??-1)-(a.spend??-1)||pickerCmp(a.name,b.name)||pickerCmp(a.key,b.key);}
/** Entries from today's campaign snapshot rows: Meta only, one per campaignKey (same key and name the panel always saved). */
function campaignPickerRows(rows:any){
 const seen=new Set<string>(),out:any[]=[];
 for(const r of Array.isArray(rows)?rows:[]){
  if(!r||String(r.provider||'').toLowerCase()!=='meta')continue;
  const key=campaignKey(r.adAccountId,r.externalId);if(seen.has(key))continue;seen.add(key);
  const name=r.name||r.externalId,accountName=typeof r.accountName==='string'&&r.accountName.trim()?r.accountName.trim():null,accountId=String(r.adAccountId??'');
  out.push({key,id:String(r.externalId??''),name,status:campaignStatusKind(r.status),statusLabel:campaignStatusLabel(r.status),spend:pickerFinite(r.spend)?r.spend:null,accountId,accountName,warmup:isWarmupCampaign(r.name),haystack:foldText([name,r.externalId,accountName,accountId].join(' '))});
 }
 return out.sort(comparePickerRows);
}
const isTaken=(taken:any,key:string)=>!!taken&&(taken instanceof Set?taken.has(key):Object.prototype.hasOwnProperty.call(taken,key));
/** Search (every term must match name, ID or account; accents and case ignored), status chips (OR between them; none = any),
 * "Com gasto hoje" (spend > 0). Already-added campaigns never appear (takenSales counts the sales ones); warm-up/engagement is
 * counted apart and hidden. Chip counts follow the search, not the chips themselves. */
function filterCampaignPicker(entries:any[],{query='',active=false,paused=false,inactive=false,withSpend=false,taken=null}:{query?:string;active?:boolean;paused?:boolean;inactive?:boolean;withSpend?:boolean;taken?:any}={}){
 const terms=foldText(query).split(/\s+/).filter(Boolean),counts:Record<'active'|'paused'|'inactive'|'withSpend',number>={active:0,paused:0,inactive:0,withSpend:0},rows:any[]=[];
 const anyStatus=active||paused||inactive;
 let outOfScope=0,available=0,takenSales=0,matched=0;
 for(const e of entries||[]){
  if(isTaken(taken,e.key)){if(!e.warmup)takenSales++;continue;}
  if(!e.warmup)available++;
  if(terms.length&&!terms.every(t=>e.haystack.includes(t)))continue;
  if(e.warmup){outOfScope++;continue;}
  matched++;
  if(e.status==='active'||e.status==='paused'||e.status==='inactive')counts[e.status as 'active'|'paused'|'inactive']++;
  if(e.spend>0)counts.withSpend++;
  if(anyStatus&&!((active&&e.status==='active')||(paused&&e.status==='paused')||(inactive&&e.status==='inactive')))continue;
  if(withSpend&&!(e.spend>0))continue;
  rows.push(e);
 }
 return {rows,counts,matched,outOfScope,available,takenSales,terms:terms.length};
}
/** Consecutive rows of the same ad account become one group (rows arrive sorted by account). */
function groupPickerRows(rows:any[]){
 const groups:{id:string;label:string;accountId:string;rows:any[]}[]=[];
 for(const e of rows||[]){const last=groups[groups.length-1];if(last&&last.id===e.accountId)last.rows.push(e);else groups.push({id:e.accountId,label:accountLabel(e)||'Conta sem nome',accountId:e.accountId,rows:[e]});}
 return groups;
}
/** Long names like "07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - JHON_A_457_H1": the last segment (the creative code) is the
 * distinctive tail, the rest is the shared head. A trailing "Cópia"/"Copy" keeps the segment before it. No separator: all tail. */
function splitCampaignName(name:any){
 const s=String(name??''),parts=s.split(/(\s+[-–—|]\s+)/);
 if(parts.length<3)return {head:'',tail:s};
 let i=parts.length-1;
 if(i>=2&&/^(?:c[oó]pia|copy)(?:\s*\d+)?$/i.test(parts[i].trim()))i-=2;
 const head=parts.slice(0,i).join(''),tail=parts.slice(i).join('');
 return tail.trim()&&head.trim()?{head,tail}:{head:'',tail:s};
}
/** Today's spend in the reading's currency (ISO code from the snapshot); without one, a bare number, never an invented R$. */
const pickerMoney=(v:number,currency?:string|null)=>currency&&/^[A-Z]{3}$/.test(currency)?v.toLocaleString('pt-BR',{style:'currency',currency,maximumFractionDigits:2}):v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
// picker-helpers:end

export const modeHelp:Record<string,string>={off:'Não mexe e não sugere ação rápida.',shadow:'Só registra o que faria (como hoje).',confirm:'Prepara e avisa; você executa com Touch ID no notch.',auto:'Executa sozinho dentro dos limites abaixo.'};
export const modeIcon:Record<string,typeof Bot>={off:CircleOff,shadow:Eye,confirm:FingerprintPattern,auto:Zap};
const numOrNull=(v:string)=>v.trim()===''?null:Number(v.replace(',','.'));
const fmt=(v:number)=>v.toLocaleString('pt-BR',{maximumFractionDigits:2});
const fin=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Same ranges the central enforces on save (normalizeAutonomyConfig in lib/autonomy-grant.mjs); here they are only shown inline. */
const limitRules:Record<string,{min:number;max:number;int?:boolean}>={maxIncreasePct:{min:1,max:1000},maxReducePct:{min:1,max:99},budgetCap:{min:1,max:1e9},ordersPerDay:{min:1,max:autonomyLimits.maxOrdersPerDay,int:true}};
const limitIssue=(k:string,v:any)=>{if(v===null||v===undefined)return '';const r=limitRules[k];if(!Number.isFinite(v))return 'Use só números.';if(v<r.min||v>r.max||(r.int&&!Number.isInteger(v)))return `Use um número${r.int?' inteiro':''} de ${fmt(r.min)} a ${fmt(r.max)}.`;return '';};
const hasIssue=(p:any)=>Object.keys(limitRules).some(k=>!!limitIssue(k,p.limits?.[k]));
export const autoNames=(list:any[])=>list.filter((p:any)=>p.mode==='auto'||Object.values(p.campaigns||{}).some((c:any)=>c.mode==='auto')).map((p:any)=>p.name);
/** One line with what is enabled for the project (same facts as the controls; a missing limit means that action does not run). */
function permissionSummary(p:any){
 const a=p.actions||{},l=p.limits||{},parts:string[]=[];
 if(a.pause)parts.push('Pausar');
 if(a.reduce)parts.push(fin(l.maxReducePct)?`Reduzir até ${fmt(l.maxReducePct)}%`:'Reduzir (sem redução máxima: não reduz)');
 if(a.increase)parts.push(fin(l.maxIncreasePct)&&fin(l.budgetCap)?`Aumentar até ${fmt(l.maxIncreasePct)}%, teto ${fmt(l.budgetCap)}`:'Aumentar (sem aumento máximo ou teto: não aumenta)');
 if(a.activate)parts.push('Reativar (ainda sem regra)');
 if(!parts.length)return 'Nenhuma ação liberada';
 const n=fin(l.ordersPerDay)?l.ordersPerDay:autonomyLimits.defaultOrdersPerDay;
 return [...parts,`${fmt(n)} ${n===1?'ordem':'ordens'}/dia`].join(' · ');
}
/** Budget in its native currency (code from the reading); without a valid code, a bare number. */
const budgetMoney=(v:any,currency:any)=>!fin(v)?'N/D':typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)?v.toLocaleString('pt-BR',{style:'currency',currency,maximumFractionDigits:2}):fmt(v);

/** The draft of the owner's permissions, the single save and the switch (moved from the panel shell, same bodies). */
export function useAutonomyDraft(state:any,write:(body:any)=>Promise<any>){
 const saved=useMemo(()=>autonomyView(state),[state]),savedKey=JSON.stringify(saved.projects);
 const [draft,setDraft]=useState<{base:string;projects:any[]}|null>(null);
 const projects=draft?.projects||saved.projects,conflict=!!draft&&draft.base!==savedKey;
 const [error,setError]=useState('');
 const [last,setLast]=useState<'saved'|'failed'|null>(null);
 /** Which button started the write in progress (visual only: picks where the spinner goes; `saving` still gates every control). */
 const [busy,setBusy]=useState<'save'|'on'|'kill'|null>(null);
 /** Stable between renders (same body as before) so each ProjectRow is memoized and only the edited project re-renders. */
 const edit=useCallback((id:string,fn:(p:any)=>any)=>{setLast(null);setDraft(prev=>({base:prev?.base||savedKey,projects:(prev?.projects||saved.projects).map((p:any)=>p.id===id?fn(structuredClone(p)):p)}));},[savedKey,saved.projects]);
 const payload=(enabled:boolean)=>({enabled,projects:Object.fromEntries(projects.map((p:any)=>[p.id,{mode:p.mode,actions:p.actions,limits:p.limits,campaigns:p.campaigns}]))});
 async function save(enabled=saved.enabled){
  setError('');if(conflict){setError('As permissões salvas mudaram em outra sessão. Carregue as salvas antes de editar.');return;}
  for(const p of projects){for(const k of ['maxIncreasePct','maxReducePct','budgetCap','ordersPerDay'])if(p.limits[k]!==null&&!Number.isFinite(p.limits[k])){setError(`${p.name}: confira os limites (use só números).`);return;}}
  setBusy(enabled===saved.enabled?'save':'on');let ok;try{ok=await write({op:'autonomyConfig',config:payload(enabled)});}finally{setBusy(null);}if(ok)setDraft(null);setLast(ok?'saved':'failed');
 }
 async function turnOn(){
  const auto=projects.filter((p:any)=>p.mode==='auto'||Object.values(p.campaigns).some((c:any)=>c.mode==='auto')).map((p:any)=>p.name);
  const text=auto.length?`Ligar a autonomia do Bunk?\n\nAutomático em: ${auto.join(', ')}.\nEle vai pausar/ajustar orçamento sozinho dentro dos limites salvos, sempre pelo Malva, uma vez por ordem e com conferência.`:'Ligar a autonomia do Bunk?\n\nNenhum projeto está em Automático: só os projetos em Confirmar vão avisar.';
  if(globalThis.confirm(text))await save(true);
 }
 async function kill(){setError('');setBusy('kill');try{await write({op:'autonomyKill'});}finally{setBusy(null);}}
 const savedById=useMemo(()=>Object.fromEntries(saved.projects.map((p:any)=>[p.id,JSON.stringify(p)])),[saved.projects]);
 const changed=draft?projects.filter((p:any)=>savedById[p.id]!==JSON.stringify(p)).length:0;
 return {saved,draft,discard:()=>setDraft(null),projects,conflict,error,last,busy,edit,payload,save,turnOn,kill,savedById,changed};
}
export type DraftControl=ReturnType<typeof useAutonomyDraft>;

/* ---------- Read-only context for the limits (from the deep view; nothing here is saved) ---------- */
export type LimitContext={count:number;max:number|null;currency:string|null;mixed:boolean;currencies:(string|null)[]}|null;
/** Largest native daily budget among today's campaigns in the reading, and whether the project mixes currencies. */
export function limitContext(campaigns:any):LimitContext{
 if(!Array.isArray(campaigns))return null;
 const withBudget=campaigns.filter((c:any)=>fin(c?.budget?.dailyBudget)).sort((a:any,b:any)=>b.budget.dailyBudget-a.budget.dailyBudget);
 const currencies=[...new Set(withBudget.map((c:any)=>c.budget.currency??null))] as (string|null)[];
 const top=withBudget[0]||null;
 return {count:campaigns.length,max:top?top.budget.dailyBudget:null,currency:top?top.budget.currency??null:null,mixed:currencies.length>1||campaigns.some((c:any)=>c?.guard?.capUse?.mixedCurrency===true),currencies};
}
/** "Maior orçamento hoje R$ 600 → +30% = R$ 780 · teto R$ 1.000". */
export function limitContextLines(limits:any,ctx:LimitContext){
 if(!ctx)return [];
 if(!fin(ctx.max))return [`Sem orçamento diário na leitura de hoje (${ctx.count?'N/D':'nenhuma campanha lida'}).`];
 const l=limits||{},cur=ctx.currency,head=`Maior orçamento hoje ${budgetMoney(ctx.max,cur)}`,out:string[]=[];
 if(fin(l.maxIncreasePct)){const next=Math.round(ctx.max*(1+l.maxIncreasePct/100)*100)/100;out.push(`${head} → +${fmt(l.maxIncreasePct)}% = ${budgetMoney(next,cur)}${fin(l.budgetCap)?` · teto ${budgetMoney(l.budgetCap,cur)}${next>l.budgetCap+0.0005?' (passaria do teto: o Bunk segura)':''}`:' · sem teto: não aumenta'}`);}
 else out.push(`${head} · sem aumento máximo: não aumenta${fin(l.budgetCap)?` · teto ${budgetMoney(l.budgetCap,cur)}`:''}`);
 if(fin(l.maxReducePct))out.push(`Redução máxima: ${budgetMoney(ctx.max,cur)} → −${fmt(l.maxReducePct)}% = ${budgetMoney(Math.round(ctx.max*(1-l.maxReducePct/100)*100)/100,cur)}`);
 return out;
}
/** The team's usual budget steps: the consensus play step when a play is fitted, else the median of each person's median. */
export function teamSteps(team:any,plays:any){
 const fromPlays=(ids:string[],sign:number)=>{for(const p of Array.isArray(plays)?plays:[])if(ids.includes(p?.id)&&p.stage!=='observando'&&fin(p?.step?.median)&&Math.sign(p.step.median)===sign)return {pct:Math.abs(p.step.median)*100,from:'a jogada da equipe'};return null;};
 const fromPeople=(key:'medianUp'|'medianDown')=>{const v=(Array.isArray(team?.people)?team.people:[]).filter((x:any)=>x?.role!=='outside').map((x:any)=>x?.budget?.[key]).filter(fin).map((x:number)=>Math.abs(x)).sort((a:number,b:number)=>a-b);if(!v.length)return null;const m=v.length>>1;return {pct:(v.length%2?v[m]:(v[m-1]+v[m])/2)*100,from:'as pessoas'};};
 return {up:fromPlays(['pb:morning-batch-raise','pb:night-raise'],1)||fromPeople('medianUp'),down:fromPlays(['pb:bad-day-cut'],-1)||fromPeople('medianDown')};
}
/** Draft limits filled like the team does, rounded to 5 pp, never above the current value and never creating a missing limit. */
export function teamPrefill(limits:any,steps:ReturnType<typeof teamSteps>){
 const l={...(limits||{})},notes:string[]=[];
 const cap=(k:'maxIncreasePct'|'maxReducePct',step:{pct:number;from:string}|null,max:number,label:string)=>{
  if(!step)return;if(!fin(l[k])){notes.push(`${label}: sem valor atual, fica como está.`);return;}
  const v=Math.min(max,Math.max(5,Math.round(step.pct/5)*5));
  if(v<l[k]){notes.push(`${label}: ${fmt(l[k])}% → ${fmt(v)}% (${step.from}).`);l[k]=v;}else notes.push(`${label}: a equipe usa ~${fmt(v)}%, igual ou acima do seu ${fmt(l[k])}%; fica ${fmt(l[k])}%.`);
 };
 cap('maxIncreasePct',steps.up,1000,'Aumento máximo');cap('maxReducePct',steps.down,99,'Redução máxima');
 return {limits:l,changed:l.maxIncreasePct!==limits?.maxIncreasePct||l.maxReducePct!==limits?.maxReducePct,notes};
}

/* ---------- Draft simulator (view=sim rows + the pure simulateGrant, W1) ---------- */
type SimState={at:number;data:any|null;error:string|null;pending?:boolean};
const simCache=new Map<string,SimState>();
/** view=sim rows of one project, kept 2 min in memory; a GET, never a write. */
export function useSimRows(projectIds:string[]){
 const key=projectIds.join('|'),[,bump]=useState(0);
 useEffect(()=>{
  let alive=true;
  for(const id of projectIds){
   const c=simCache.get(id);if(c&&(c.pending||Date.now()-c.at<120000))continue;
   simCache.set(id,{at:Date.now(),data:c?.data??null,error:null,pending:true});
   fetch(`/api/autonomy?view=sim&project=${encodeURIComponent(id)}`,{cache:'no-store'}).then(async r=>{const j:any=await r.json().catch(()=>null);simCache.set(id,{at:Date.now(),data:r.ok&&j&&Array.isArray(j.rows)?j:null,error:r.ok&&j&&Array.isArray(j.rows)?null:(j?.error||'Simulação indisponível agora.')});}).catch(()=>simCache.set(id,{at:Date.now(),data:null,error:'Simulação indisponível agora.'})).finally(()=>{if(alive)bump(x=>x+1);});
  }
  return()=>{alive=false;};
 },[key]);// eslint-disable-line react-hooks/exhaustive-deps
 return Object.fromEntries(projectIds.map(id=>[id,simCache.get(id)||null])) as Record<string,SimState|null>;
}
/** Runs simulateGrant safely: a missing or malformed row set gives an error line, never a number. */
export function runSim(sim:any,config:any,projectIds:string[],now=Date.now()){
 try{if(!sim||!Array.isArray(sim.rows))return {ok:false,error:'Sem linhas da Sombra para simular.'};const r=simulateGrant(sim,config,{now,timezone:sim.timezone||undefined,projectIds});return r&&typeof r==='object'?r:{ok:false,error:'Simulação indisponível.'};}
 catch(e:any){return {ok:false,error:`Simulação indisponível: ${String(e?.message||e).slice(0,120)}`};}
}
/** "3 ordens e 1 pedido a você": Automático sends, Confirmar asks (both from simulateGrant). */
export const simCount=(t:any)=>{const o=fin(t?.orders)?t.orders:0,a=fin(t?.asks)?t.asks:0;return `${o} ${o===1?'ordem':'ordens'}${a?` e ${a} ${a===1?'pedido':'pedidos'} a você`:''}`;};
const heldTop=(held:any)=>Object.entries(held||{}).filter(([,n])=>fin(n)&&(n as number)>0).sort((a:any,b:any)=>b[1]-a[1]).slice(0,2);
function SimLine({ctl,projectIds}:{ctl:DraftControl;projectIds:string[]}){
 const changedIds=useMemo(()=>ctl.draft?ctl.projects.filter((p:any)=>ctl.savedById[p.id]!==JSON.stringify(p)).map((p:any)=>p.id).slice(0,3):[],[ctl.draft,ctl.projects,ctl.savedById]);
 const sims=useSimRows(changedIds),config=ctl.payload(ctl.saved.enabled),configKey=JSON.stringify(config);
 /** Replayed only when the draft or the rows change (not on every render). */
 const simKey=changedIds.map((id:string)=>`${id}:${sims[id]?.at??''}:${sims[id]?.pending?1:0}`).join('|');
 const results=useMemo(()=>changedIds.map((id:string)=>({id,name:ctl.projects.find((p:any)=>p.id===id)?.name||id,sim:sims[id],r:sims[id]?.data?runSim(sims[id]!.data,config,projectIds):null})),[simKey,configKey,projectIds]);// eslint-disable-line react-hooks/exhaustive-deps
 if(!ctl.draft||!changedIds.length)return <p className="aut-sim ds-caption"><span className="ds-glyph ds-glyph--info" aria-hidden="true"/>Mude uma permissão para ver, antes de salvar, quantas ordens ela teria gerado nos últimos 7 dias (só permissões).</p>;
 return <div className="aut-sim" role="status" aria-live="polite">
  {results.map(({id,name,sim,r}:any)=><div key={id} className="aut-sim__row">
   <span className="ds-pill ds-pill--neutral aut-sim__label"><span className="ds-glyph ds-glyph--info" aria-hidden="true"/>Simulação · só permissões</span>
   <p className="aut-sim__text"><strong>{name}</strong>{' · '}
    {!sim||(sim.pending&&!sim.data)?<span>calculando com as decisões da Sombra de 7 dias…</span>
     :!r?<span>{sim.error||'Simulação indisponível agora.'}</span>
     :!r.ok?<span>{r.error}</span>
     :<span>7 dias: com o rascunho <strong className="ds-num">{simCount(r.draft.d7)}</strong> ({r.draft.d7.right} certas, {r.draft.d7.wrong} erradas, {r.draft.d7.open} em aberto{r.draft.d7.winnersCut?`, ${r.draft.d7.winnersCut} cortes em vencedoras`:''}) · com as salvas <strong className="ds-num">{simCount(r.saved.d7)}</strong> · hoje {simCount(r.draft.today)} vs {simCount(r.saved.today)}.{heldTop(r.draft.d7.held).length?<> Seguraria: {heldTop(r.draft.d7.held).map(([k,n])=>`${k} (${n})`).join(' · ')}</>:null}</span>}
   </p>
   {r?.ok&&<small className="ds-caption aut-sim__caveat">{[r.assumedSwitchOn?'Simulado com o interruptor geral ligado.':null,...(Array.isArray(r.caveats)?r.caveats:[])].filter(Boolean).join(' ')} Certo/errado vem da nota D+1 da Sombra; não é promessa de lucro.</small>}
  </div>)}
 </div>;
}

export type ProjectCtx={campaigns:any[]|null;team:any|null;plays:any[]|null}|null;
/** Permissões: level legend, one row per project (level, actions, limits with context, exceptions), simulator, savebar. */
export function PermissionsTab({ctl,state,saving,covered,contexts}:{ctl:DraftControl;state:any;saving:boolean;covered:(id:string)=>boolean;contexts:Record<string,ProjectCtx>}){
 const {projects,draft,conflict,last,busy,changed,savedById,edit}=ctl,saveStatusId=useId();
 const draftAuto=autoNames(projects).length;
 const busySave=saving&&busy==='save';
 const projectIds=useMemo(()=>ctl.saved.projects.map((p:any)=>p.id),[ctl.saved.projects]);
 const pendingText=changed===0?'Rascunho aberto, igual às permissões salvas.':changed===1?'1 projeto com alterações não salvas.':`${changed} projetos com alterações não salvas.`;
 const saveStatus=conflict?{tone:'warn',text:'Rascunho preservado, mas as permissões salvas mudaram em outra sessão.'}:busySave?{tone:'busy',text:'Salvando…'}:draft&&last==='failed'?{tone:'bad',text:`Não foi possível salvar. ${pendingText}`}:draft?{tone:'warn',text:pendingText}:last==='saved'?{tone:'good',text:'Permissões salvas na central.'}:last==='failed'?{tone:'bad',text:'Não foi possível salvar as permissões. Tente de novo.'}:{tone:'info',text:'Sem alterações para salvar.'};
 const statusGlyph:Record<string,string>={good:'ds-glyph--good',bad:'ds-glyph--bad',warn:'ds-glyph--warn',info:'ds-glyph--info'};
 return <div className="aut-tab aut-perm">
  <section className="ds-card aut-legend-card" aria-labelledby="aut-legend-title">
   <span className="ds-eyebrow">Como funcionam os níveis</span><h2 id="aut-legend-title" className="ds-title">O nível é o teto do que o Bunk pode fazer</h2>
   <p className="aut-master__how">Você escolhe o nível por projeto e as exceções por campanha. Só o <strong>Automático</strong> envia ordens sozinho, e só quando a Sombra executaria agora, o placar da regra permite e tudo cabe nos seus limites. Cada ordem vai pelo Malva, uma vez, com releitura. Mudar qualquer permissão ou desligar cancela as ordens ainda não enviadas. As jogadas aprendidas com a equipe ainda não enviam nada: só observam.</p>
   <div className="aut-legend" role="list" aria-label="Níveis de autonomia">
    {autonomyModes.map(m=>{const Icon=modeIcon[m];return <div key={m} role="listitem" className={`aut-legend__item mode-${m}`}><span className={`ds-badge ${m==='auto'?'ds-badge--accent':'ds-badge--neutral'}`} aria-hidden="true"><Icon size={14}/></span><span className="aut-legend__text"><strong>{modeLabels[m]}</strong><small>{modeHelp[m]}</small></span></div>;})}
   </div>
  </section>
  <section className="ds-card aut-projects" aria-labelledby="aut-projects-title">
   <header className="aut-projects__head">
    <div><span className="ds-eyebrow">Permissões por projeto</span><h2 id="aut-projects-title" className="ds-title">Nível, ações e limites</h2></div>
    <span className="ds-caption aut-projects__count">{projects.length===1?'1 projeto':`${projects.length} projetos`}{draftAuto?` · ${draftAuto} com Automático`:''}</span>
   </header>
   {!projects.length?<p className="ds-empty aut-projects__empty">Nenhum projeto configurado no Bunker ainda: as permissões aparecem aqui quando houver projeto.</p>:
    <ul className="ds-list ds-list--divided aut-list">{projects.map((p:any)=><ProjectRow key={p.id} p={p} state={state} covered={covered(p.id)} disabled={saving} dirty={!!draft&&savedById[p.id]!==JSON.stringify(p)} editProject={edit} ctx={contexts[p.id]||null}/>)}</ul>}
   <SimLine ctl={ctl} projectIds={projectIds}/>
   <div className="aut-savebar">
    <p className={`aut-savebar__status tone-${saveStatus.tone}`} id={saveStatusId} role="status">{saveStatus.tone==='busy'?<span className="ds-spinner" aria-hidden="true"/>:<span className={`ds-glyph ${statusGlyph[saveStatus.tone]}`} aria-hidden="true"/>}<span>{saveStatus.text}</span></p>
    <div className="aut-savebar__actions">
     {draft&&<button type="button" className="ds-btn ds-btn--ghost" disabled={saving} onClick={ctl.discard}>Descartar alterações</button>}
     <button type="button" className={`ds-btn ${draft?'ds-btn--primary':''}`} disabled={saving||!draft||conflict} aria-busy={busySave||undefined} aria-describedby={saveStatusId} onClick={()=>ctl.save()}>{busySave?<span className="ds-spinner" aria-hidden="true"/>:<Save size={15} aria-hidden="true"/>} Salvar permissões</button>
    </div>
   </div>
  </section>
 </div>;
}

const EMPTY_CAMPAIGNS:Record<string,any>=Object.freeze({}) as Record<string,any>;
const EMPTY_ENTRIES:any[]=[];
const plural=(n:number,one:string,many:string)=>`${n.toLocaleString('pt-BR')} ${n===1?one:many}`;
/** Full name in the tooltip; the shared head (date, tags) muted and the distinctive tail (creative code) in ink, kept visible when narrow. */
function CampaignName({name,className=''}:{name:string;className?:string}){const {head,tail}=splitCampaignName(name);return <span className={`aut-cname ${className}`} title={name}>{head&&<span className="aut-cname__head">{head}</span>}<span className="aut-cname__tail">{tail}</span></span>;}
/** Status as dot + glyph + hidden text (never color alone, never a "(PAUSED)" suffix). */
const statusIcon:Record<string,typeof Play>={active:Play,paused:Pause,inactive:Archive};
function StatusMark({kind,label}:{kind:string|null;label:string|null}){if(!kind)return null;const Icon=statusIcon[kind]||Archive;return <span className={`aut-status is-${kind}`} title={label||undefined}><span className={`ds-dot ds-dot--sm ${kind==='active'?'ds-dot--good':'ds-dot--neutral'}`} aria-hidden="true"/><Icon size={10} aria-hidden="true"/><span className="ds-sr-only">{label}</span></span>;}


const ProjectRow=memo(function ProjectRow({p,state,covered,disabled,dirty,editProject,ctx}:{p:any;state:any;covered:boolean;disabled:boolean;dirty:boolean;editProject:(id:string,fn:(p:any)=>any)=>void;ctx:ProjectCtx}){
 const edit=useCallback((fn:(p:any)=>any)=>editProject(p.id,fn),[editProject,p.id]);
 const [open,setOpen]=useState(false);
 const [picking,setPicking]=useState(false);
 const [prefillNotes,setPrefillNotes]=useState<string[]|null>(null);
 /** Today's Meta campaign reading, built only while the row is open (same source as before: latest campaign/today snapshot of the project). */
 const reading=useMemo(()=>{if(!open)return null;const s=(state.snapshots||[]).filter((x:any)=>x.projectId===p.id&&x.level==='campaign'&&x.period==='today').sort((a:any,b:any)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0];return {at:s?.fetchedAt||null,currency:typeof s?.currency==='string'&&/^[A-Z]{3}$/.test(s.currency)?s.currency:null,entries:campaignPickerRows(s?.rows||[])};},[open,state,p.id]);
 const entries=reading?.entries||EMPTY_ENTRIES;
 const byKey=useMemo(()=>new Map(entries.map((e:any)=>[e.key,e])),[entries]);
 const uid=useId(),detailId=`${uid}-detail`,pickerId=`${uid}-picker`,noReadId=`${uid}-noread`,prefillId=`${uid}-prefill`;
 const trigger=useRef<HTMLButtonElement>(null);
 /** Focus goes back to the trigger only when it can take it (it is disabled while saving or without a reading). */
 const closePicker=useCallback(()=>{setPicking(false);requestAnimationFrame(()=>{const t=trigger.current;if(t&&!t.disabled)t.focus();});},[]);
 const addCampaigns=useCallback((list:any[])=>{for(const r of list)edit(x=>{x.campaigns[r.key]={mode:'off',name:r.name};return x;});closePicker();},[edit,closePicker]);
 const exceptions=Object.entries(p.campaigns||{}) as [string,any][];
 const invalid=hasIssue(p),modeIndex=Math.max(0,autonomyModes.indexOf(p.mode));
 const autoExceptions=exceptions.filter(([,c])=>c.mode==='auto').length;
 /** Read-only context from the executor's deep view: largest budget today, mixed currencies, the team's usual steps. */
 const lctx=useMemo(()=>limitContext(ctx?.campaigns??null),[ctx]);
 const contextLines=limitContextLines(p.limits,lctx);
 const steps=useMemo(()=>teamSteps(ctx?.team,ctx?.plays),[ctx]);
 const prefill=teamPrefill(p.limits,steps),canPrefill=prefill.changed;
 const prefillReason=!ctx?'Sem leitura do executor para este projeto agora.':!steps.up&&!steps.down?'Ainda não há passos da equipe (N/D).':!canPrefill?'Seus limites já estão iguais ou abaixo do jeito da equipe (nunca preenche acima do atual).':'';
 const limit=(k:string,label:string,unit:string,hint:string,placeholder='Não definido')=>{const id=`${uid}-${k}`,issue=limitIssue(k,p.limits[k]);return <div className="ds-form-row aut-limit"><label className="ds-label" htmlFor={id}>{label}</label><div className="aut-limit__input"><input id={id} className="ds-field" type="number" min="0" step="any" inputMode="decimal" value={p.limits[k]??''} placeholder={placeholder} disabled={disabled} aria-invalid={issue?true:undefined} aria-describedby={`${id}-hint${issue?` ${id}-err`:''}`} onChange={e=>edit(x=>{x.limits[k]=numOrNull(e.target.value);return x;})}/><span className="aut-limit__unit" aria-hidden="true">{unit}</span></div><p className="ds-hint" id={`${id}-hint`}>{hint}</p>{issue&&<p className="ds-hint ds-hint--error" id={`${id}-err`}>{issue}</p>}</div>;};
 return <li className={`aut-project autonomy-project mode-${p.mode} ${open?'is-open':''}`}>
  <div className="aut-project__row">
   <button type="button" className="aut-project__toggle" aria-expanded={open} aria-controls={open?detailId:undefined} onClick={()=>{if(open)setPicking(false);setOpen(!open);}}>
    <span className="ds-glyph ds-glyph--chevron aut-project__chevron" aria-hidden="true"/>
    <span className={`ds-monogram ${p.mode==='auto'?'ds-monogram--accent':'ds-monogram--tag'}`} aria-hidden="true">{String(p.name||p.id).trim().charAt(0)}</span>
    <span className="aut-project__main">
     <span className="aut-project__name"><span className="ds-truncate" title={p.name}>{p.name}</span>
      {dirty&&<span className="ds-pill ds-pill--warn"><span className="ds-glyph ds-glyph--warn" aria-hidden="true"/>Não salvo</span>}
      {invalid&&<span className="ds-pill ds-pill--bad"><span className="ds-glyph ds-glyph--bad" aria-hidden="true"/>Limite fora da faixa</span>}
      {!covered&&<span className="ds-pill ds-pill--bad" title="A Sombra não avalia este projeto."><span className="ds-glyph ds-glyph--bad" aria-hidden="true"/>Sem Sombra</span>}
      {lctx?.mixed&&<span className="ds-pill ds-pill--warn" title="Campanhas em moedas diferentes: o teto único é ambíguo."><span className="ds-glyph ds-glyph--warn" aria-hidden="true"/>Moedas mistas</span>}
     </span>
     <span className="aut-project__sub">{permissionSummary(p)}{exceptions.length?` · ${exceptions.length===1?'1 exceção':`${exceptions.length} exceções`}${autoExceptions?` (${autoExceptions} em Automático)`:''}`:''}</span>
    </span>
   </button>
   <div className={`ds-segmented ds-segmented--sliding aut-levels ${p.mode==='auto'?'is-auto':''}`} role="radiogroup" aria-label={`Nível de ${p.name}`} style={{'--ds-seg-count':autonomyModes.length,'--ds-seg-index':modeIndex} as CSSProperties}>
    {autonomyModes.map(m=>{const Icon=modeIcon[m];return <label key={m} className={`mode-${m}`} title={modeHelp[m]}><input type="radio" name={`mode-${p.id}`} checked={p.mode===m} disabled={disabled} onChange={()=>edit(x=>{x.mode=m;return x;})}/><Icon size={13} aria-hidden="true"/><span>{modeLabels[m]}</span></label>;})}
   </div>
  </div>
  {open&&<div className="aut-detail" id={detailId} role="region" aria-label={`Permissões de ${p.name}`}>
   {p.mode==='auto'&&<div className="ds-banner ds-banner--accent"><div className="ds-banner__body"><strong>Automático: executa sozinho dentro destes limites.</strong><p>Só as ações ligadas abaixo, sem pedir sua confirmação, e só com a autonomia ligada.</p></div></div>}
   {!covered&&<div className="ds-banner ds-banner--bad"><div className="ds-banner__body"><strong>A Sombra não avalia este projeto.</strong><p>Sem limiares na política privada, o Bunk não decide nada aqui, em nenhum nível.</p></div></div>}
   <div className="aut-detail__grid">
    <div className="aut-block">
     <h3 className="ds-eyebrow">O que ele pode fazer</h3>
     <div className="aut-actions">{autonomyActions.map(a=>{const noRule=a==='activate',lock=noRule&&!p.actions[a],cap=`${uid}-act-${a}`;return <label className="ds-switch-row" key={a}><span className="aut-actions__text"><span className="ds-body-strong">{actionLabels[a]}</span>{noRule&&<small className="ds-caption" id={cap}>Sem regra ainda: nada é reativado sozinho.</small>}</span><input type="checkbox" role="switch" className="ds-switch" checked={!!p.actions[a]} disabled={disabled||lock} aria-describedby={noRule?cap:undefined} title={lock?'Sem regra ainda':undefined} onChange={e=>edit(x=>{x.actions[a]=e.target.checked;return x;})}/></label>;})}</div>
    </div>
    <div className="aut-block">
     <div className="aut-block__head">
      <h3 className="ds-eyebrow">Limites</h3>
      <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" disabled={disabled||!canPrefill} aria-describedby={prefillReason?prefillId:undefined} title={prefillReason||'Preenche só o rascunho; nada é salvo sem você.'} onClick={()=>{edit(x=>{x.limits=prefill.limits;return x;});setPrefillNotes(prefill.notes);}}><Users size={14} aria-hidden="true"/>Preencher como a equipe faz</button>
     </div>
     {prefillReason&&<p className="ds-disabled-reason" id={prefillId}>{prefillReason}</p>}
     {prefillNotes&&<p className="ds-hint aut-block__lead" role="status">Rascunho preenchido como a equipe faz (nada foi salvo): {prefillNotes.join(' ')}</p>}
     <p className="ds-hint aut-block__lead">Não definido = não faz: sem aumento máximo ou teto, não aumenta; sem redução máxima, não reduz.</p>
     {!!contextLines.length&&<ul className="aut-context" aria-label="Com os números de hoje">{contextLines.map((t,i)=><li key={i}><span className="ds-glyph ds-glyph--info" aria-hidden="true"/>{t}</li>)}</ul>}
     {lctx?.mixed&&<p className="ds-hint ds-hint--warn">Este projeto tem campanhas em moedas diferentes ({lctx.currencies.map(c=>c||'moeda N/D').join(', ')}). O teto único vale na moeda de cada campanha: confira antes de liberar aumentos.</p>}
     <div className="aut-limits">
      {limit('maxIncreasePct','Aumento máximo por ordem','%','Sem valor, não aumenta.')}
      {limit('maxReducePct','Redução máxima por ordem','%','Até 99%. Sem valor, não reduz.')}
      {limit('budgetCap','Teto de orçamento diário','moeda','Na moeda da campanha. Sem valor, não aumenta.')}
      {limit('ordersPerDay','Ordens por campanha por dia','por dia',`De 1 a 10, e no mínimo 1h entre elas. Em branco, vale ${autonomyLimits.defaultOrdersPerDay}.`,`${autonomyLimits.defaultOrdersPerDay} (padrão)`)}
     </div>
    </div>
   </div>
   <div className="aut-block aut-exc">
    <div className="aut-exc__head">
     <h3 className="ds-eyebrow">Exceções por campanha</h3>
     <button ref={trigger} type="button" className="ds-btn ds-btn--ghost ds-btn--sm" aria-expanded={picking} aria-controls={picking?pickerId:undefined} aria-describedby={!entries.length?noReadId:undefined} disabled={disabled||!entries.length} onClick={()=>picking?closePicker():setPicking(true)}><Plus size={14} aria-hidden="true"/>Adicionar campanha</button>
    </div>
    {!entries.length&&<p className="ds-empty ds-empty--waiting" id={noReadId}>Sem leitura de hoje das campanhas. A lista para escolher aparece quando a leitura de hoje chegar.</p>}
    {picking&&!!entries.length&&<CampaignPicker id={pickerId} entries={entries} taken={p.campaigns||EMPTY_CAMPAIGNS} readAt={reading?.at||null} currency={reading?.currency||null} disabled={disabled} onAdd={addCampaigns} onClose={closePicker}/>}
    {!exceptions.length&&<p className="ds-empty">Nenhuma. Todas as campanhas de vendas Meta do projeto seguem o nível acima (aquecimento/engajamento ficam sempre de fora).</p>}
    {!!exceptions.length&&<ul className="ds-list ds-list--divided aut-exceptions">{exceptions.map(([key,c])=>{const e:any=byKey.get(key);return <li className="autonomy-exception" key={key}><StatusMark kind={e?.status||null} label={e?.statusLabel||null}/><CampaignName name={c.name||key} className="autonomy-exception__name"/><select className="ds-field ds-field--sm" aria-label={`Nível de ${c.name||key}`} value={c.mode} disabled={disabled} onChange={ev=>edit(x=>{x.campaigns[key].mode=ev.target.value;return x;})}>{autonomyModes.map(m=><option key={m} value={m}>{modeLabels[m]}</option>)}</select><button type="button" className="ds-btn ds-btn--icon ds-btn--sm" aria-label={`Remover exceção ${c.name||key}`} title="Remover exceção" disabled={disabled} onClick={()=>edit(x=>{delete x.campaigns[key];return x;})}><Trash2 size={14} aria-hidden="true"/></button></li>;})}</ul>}
   </div>
  </div>}
 </li>;
});

type PickerChips={active:boolean;paused:boolean;inactive:boolean;withSpend:boolean};
const NO_CHIPS:PickerChips={active:false,paused:false,inactive:false,withSpend:false};

/** One option row. Memoized with a stable onPick: an arrow move or a toggle re-renders only the 1–2 rows that changed. */
const PickerOption=memo(function PickerOption({entry,optionId,active,selected,currency,onPick}:{entry:any;optionId:string;active:boolean;selected:boolean;currency:string|null;onPick:(key:string)=>void}){
 return <div id={optionId} role="option" aria-selected={selected} className={`aut-pick__opt${active?' is-active':''}${selected?' is-selected':''}`} onMouseDown={ev=>ev.preventDefault()} onClick={()=>onPick(entry.key)}>
  <span className="aut-check" aria-hidden="true">{selected&&<Check size={12}/>}</span>
  <StatusMark kind={entry.status} label={entry.statusLabel}/>
  <CampaignName name={entry.name}/>
  {entry.spend>0&&<span className="aut-pick__spend" title={currency?'Gasto de hoje':'Gasto de hoje (moeda N/D)'}>{pickerMoney(entry.spend,currency)}</span>}
 </div>;
});

/** Inline picker: search, status/spend chips with counts, results grouped by ad account (listbox, several at once),
 * at most pickerPageSize per page. Adding hands the chosen entries back; the row saves each one as {mode:'off',name}. */
const CampaignPicker=memo(function CampaignPicker({id,entries,taken,readAt,currency,disabled,onAdd,onClose}:{id:string;entries:any[];taken:Record<string,any>;readAt:string|null;currency:string|null;disabled:boolean;onAdd:(list:any[])=>void;onClose:()=>void}){
 const uid=useId(),search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const hasStatus=useMemo(()=>entries.some((e:any)=>e.status),[entries]),hasInactive=useMemo(()=>entries.some((e:any)=>e.status==='inactive'),[entries]),hasSpend=useMemo(()=>entries.some((e:any)=>e.spend!==null),[entries]);
 const [query,setQueryState]=useState('');const q=useDeferredValue(query);
 const [chips,setChipsState]=useState<PickerChips>({...NO_CHIPS,active:hasStatus});
 const [selected,setSelected]=useState<ReadonlySet<string>>(()=>new Set());
 const [pageLimit,setPageLimit]=useState(pickerPageSize);
 const [activeKey,setActiveKey]=useState<string|null>(null);
 /** A new search or filter starts again at the first page, in the same update (no extra render with the old large slice). */
 const setQuery=(v:string)=>{setQueryState(v);setPageLimit(pickerPageSize);};
 const setChips=(fn:(c:PickerChips)=>PickerChips)=>{setChipsState(fn);setPageLimit(pickerPageSize);};
 const result=useMemo(()=>filterCampaignPicker(entries,{query:q,...chips,taken}),[entries,q,chips,taken]);
 const visible=useMemo(()=>result.rows.slice(0,pageLimit),[result.rows,pageLimit]);
 const groups=useMemo(()=>groupPickerRows(visible),[visible]);
 const indexOf=useMemo(()=>new Map<string,number>(visible.map((e:any,i:number)=>[e.key,i])),[visible]);
 const byKey=useMemo(()=>new Map(entries.map((e:any)=>[e.key,e])),[entries]);
 const chosen=useMemo(()=>[...selected].map(k=>byKey.get(k)).filter((e:any)=>e&&!Object.prototype.hasOwnProperty.call(taken,e.key)),[selected,byKey,taken]);
 const activeIndex=activeKey!==null&&indexOf.has(activeKey)?indexOf.get(activeKey) as number:-1;
 const optId=(i:number)=>`${uid}-o${i}`;
 useEffect(()=>{search.current?.focus();},[]);
 useEffect(()=>{if(activeIndex>=0)document.getElementById(optId(activeIndex))?.scrollIntoView({block:'nearest'});},[activeIndex]);// eslint-disable-line react-hooks/exhaustive-deps
 const toggle=useCallback((key:string)=>setSelected(prev=>{const next=new Set(prev);if(next.has(key))next.delete(key);else next.add(key);return next;}),[]);
 const onPick=useCallback((key:string)=>{list.current?.focus();setActiveKey(key);toggle(key);},[toggle]);
 const go=(i:number)=>{if(!visible.length)return;setActiveKey(visible[Math.max(0,Math.min(visible.length-1,i))].key);};
 function onListKey(e:ReactKeyboardEvent<HTMLDivElement>){
  const at=activeIndex<0?-1:activeIndex;
  if(e.key==='ArrowDown'){e.preventDefault();go(at+1);}
  else if(e.key==='ArrowUp'){e.preventDefault();if(at<=0){search.current?.focus();setActiveKey(null);}else go(at-1);}
  else if(e.key==='Home'){e.preventDefault();go(0);}
  else if(e.key==='End'){e.preventDefault();go(visible.length-1);}
  else if(e.key===' '||e.key==='Enter'){e.preventDefault();const k=at>=0?visible[at]?.key:visible[0]?.key;if(k){setActiveKey(k);toggle(k);}}
 }
 function onSearchKey(e:ReactKeyboardEvent<HTMLInputElement>){
  if(e.key==='Escape'&&query){e.preventDefault();e.stopPropagation();setQuery('');}
  else if(e.key==='ArrowDown'||e.key==='Enter'){e.preventDefault();if(visible.length){list.current?.focus();go(activeIndex<0?0:activeIndex);}}
 }
 /** The list subtree is rebuilt only when the results, the active row or the selection change, not on every keystroke. */
 const listBody=useMemo(()=>groups.map(g=>{const first=indexOf.get(g.rows[0].key),gid=`${uid}-g-${first}`;return <div key={g.id+':'+first} role="group" aria-labelledby={gid} className="aut-pick__group">
   <div id={gid} className="aut-pick__group-head" title={g.label!==g.accountId?`Conta ${g.accountId}`:undefined}><span className="ds-truncate">{g.label}</span><span className="aut-pick__count">{g.rows.length.toLocaleString('pt-BR')}</span></div>
   {g.rows.map((e:any)=>{const i=indexOf.get(e.key) as number;return <PickerOption key={e.key} entry={e} optionId={`${uid}-o${i}`} active={i===activeIndex} selected={selected.has(e.key)} currency={currency} onPick={onPick}/>;})}
  </div>;}),[groups,indexOf,activeIndex,selected,currency,onPick,uid]);
 const chip=(k:keyof PickerChips,label:string,n:number)=><button type="button" className="ds-chip ds-chip--neutral ds-chip--outlined aut-pick__chip" aria-pressed={chips[k]} onClick={()=>setChips(c=>({...c,[k]:!c[k]}))}>{chips[k]&&<Check aria-hidden="true"/>}{label}<span className="aut-pick__count">{n.toLocaleString('pt-BR')}</span></button>;
 const filtered=chips.active||chips.paused||chips.inactive||chips.withSpend,rest=result.rows.length-visible.length,n=chosen.length;
 const time=readAt?new Date(readAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):null;
 const countText=result.rows.length?plural(result.rows.length,'campanha','campanhas'):'Nenhuma campanha encontrada';
 /** Screen readers hear only the short count, once typing settles; the reading time and the scope note stay plain text. */
 const [announce,setAnnounce]=useState('');
 useEffect(()=>{const t=setTimeout(()=>setAnnounce(countText),600);return()=>clearTimeout(t);},[countText]);
 return <div className="ds-card ds-card--flush aut-pick" id={id} role="group" aria-label="Escolher campanhas para exceção" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}}}>
  <div className="aut-pick__top">
   <div className="aut-pick__search" role="search">
    <Search size={14} aria-hidden="true" className="aut-pick__search-icon"/>
    <input ref={search} type="search" className="ds-field ds-field--sm" placeholder="Buscar por nome ou ID" aria-label="Buscar campanha por nome ou ID" aria-controls={result.rows.length?`${uid}-list`:undefined} autoComplete="off" spellCheck={false} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onSearchKey}/>
    {query&&<button type="button" className="ds-btn ds-btn--icon ds-btn--sm aut-pick__clear" aria-label="Limpar busca" title="Limpar busca" onClick={()=>{setQuery('');search.current?.focus();}}><X size={14} aria-hidden="true"/></button>}
   </div>
   {(hasStatus||hasSpend)&&<div className="aut-pick__chips" role="group" aria-label="Filtros">
    {hasStatus&&chip('active','Ativas',result.counts.active)}
    {hasStatus&&chip('paused','Pausadas',result.counts.paused)}
    {hasInactive&&chip('inactive','Inativas',result.counts.inactive)}
    {hasSpend&&chip('withSpend','Com gasto hoje',result.counts.withSpend)}
   </div>}
   <p className="aut-pick__meta"><span>{countText}</span>{rest>0?` · mostrando ${visible.length.toLocaleString('pt-BR')}`:''}{time?` · leitura de hoje às ${time}`:''}{result.outOfScope?<span className="aut-pick__scope" title="O Bunk não dá ordens de vendas em campanhas de aquecimento ou engajamento, em nenhum nível."> · {result.outOfScope.toLocaleString('pt-BR')} fora do escopo (aquecimento/engajamento)</span>:null}</p>
   <span className="ds-sr-only" role="status">{announce}</span>
  </div>
  {!result.rows.length?<div className="aut-pick__empty">
    {!result.available?(result.takenSales?<p className="ds-empty ds-empty--clear">Todas as campanhas de vendas da leitura de hoje já são exceções deste projeto.</p>
     :<p className="ds-empty">Nenhuma campanha de vendas na leitura de hoje (só aquecimento/engajamento, que ficam sempre de fora).</p>)
    :query.trim()?<p className="ds-empty">Nenhuma campanha encontrada para “{query.trim()}”{filtered?' com os filtros marcados':''}. Confira a grafia ou busque pelo ID.</p>
    :<p className="ds-empty">Nenhuma campanha com os filtros marcados.</p>}
    {!!result.available&&<div className="aut-pick__empty-actions">{query&&<button type="button" className="ds-btn ds-btn--sm" onClick={()=>{setQuery('');search.current?.focus();}}>Limpar busca</button>}{filtered&&<button type="button" className="ds-btn ds-btn--sm" onClick={()=>setChips(()=>NO_CHIPS)}>Tirar filtros</button>}</div>}
   </div>:
   <div ref={list} id={`${uid}-list`} className="aut-pick__list" role="listbox" aria-multiselectable="true" aria-label="Campanhas da leitura de hoje" tabIndex={0} aria-activedescendant={activeIndex>=0?optId(activeIndex):undefined} onKeyDown={onListKey} onFocus={()=>{if(activeIndex<0)go(0);}}>
    {listBody}
   </div>}
  {rest>0&&<button type="button" className="ds-btn ds-btn--ghost ds-btn--sm aut-pick__more" onClick={()=>setPageLimit(l=>l+pickerPageSize)}>Mostrar mais {Math.min(pickerPageSize,rest).toLocaleString('pt-BR')} <span className="aut-pick__count">de {rest.toLocaleString('pt-BR')} restantes</span></button>}
  <div className="aut-pick__foot">
   <p className="aut-pick__sel" aria-live="polite">{n?plural(n,'selecionada','selecionadas'):'Marque uma ou mais campanhas.'}{n?<> <button type="button" className="aut-pick__link" onClick={()=>setSelected(new Set())}>Limpar seleção</button></>:null}</p>
   <div className="aut-pick__foot-actions">
    <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={onClose}>Cancelar</button>
    <button type="button" className="ds-btn ds-btn--primary ds-btn--sm" disabled={disabled||!n} title={!n?'Marque ao menos uma campanha.':undefined} onClick={()=>onAdd(chosen)}>{n===1?'Adicionar 1 (começa Desligado)':n?`Adicionar ${n.toLocaleString('pt-BR')} (começam Desligado)`:'Adicionar (começam Desligado)'}</button>
   </div>
  </div>
 </div>;
});
