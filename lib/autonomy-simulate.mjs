/**
 * Draft simulator of the autonomy permissions (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, a.7). Runs in the browser over
 * the `view=sim` rows: what the owner's draft (and the saved permissions) would have let the Bunk do with the Sombra's
 * would-execute decisions of today and of the last 7 days. "Só permissões": it replays the real, pure `autonomyGrant`
 * with a synthetic state in which the general switch is on; the live Malva value, the contingency checks and pending
 * orders can still hold an order live. It never claims profit: right / wrong are the stored next-day verdicts.
 *
 * Pure: the instant comes from the caller, no I/O, never an order.
 */
import {autonomyGrant,normalizeAutonomyConfig} from './autonomy-grant.mjs';

export const simulateCaveats=Object.freeze([
 'Só permissões: ao vivo, a ordem ainda confere o valor atual na Malva antes de enviar.',
 'As proteções de contingência (teto diário, perda da rodada, outra execução no mesmo orçamento) podem segurar uma ordem.',
 'Uma ordem aprovada ainda a caminho do executor segura outra na mesma campanha.',
 'Acerto e erro são o dia seguinte de cada decisão: associação, não causa.']);
const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>typeof v==='number'?v:Date.parse(v||'');
const shadowHeld='Nível Sombra: só registra o que faria.';

/** The autonomyView shape (projects as a list) into the config map autonomyGrant reads. */
function savedConfig(view){
 if(!view||typeof view!=='object')return {version:1,enabled:false,projects:{}};
 return {version:1,enabled:view.enabled===true,projects:Object.fromEntries(arr(view.projects).filter(p=>typeof p?.id==='string').map(p=>[p.id,{mode:p.mode,actions:p.actions||{},limits:p.limits||{},campaigns:p.campaigns||{}}]))};
}
const emptyTotals=()=>({today:{orders:0,asks:0,held:{}},d7:{orders:0,asks:0,right:0,wrong:0,open:0,winnersCut:0,held:{}}});

/** Rows as objects, by the column names the executor sent (never by position assumptions). */
function rowsOf(sim){
 const cols=arr(sim?.columns),at=name=>cols.indexOf(name);
 const idx=Object.fromEntries(['id','day','rule','adAccountId','objectId','action','beforeBudget','afterBudget','currency','afterStatus','wouldExecute','alertOnly','firstWouldExecuteAt','verdict','winnerCut'].map(n=>[n,at(n)]));
 return arr(sim?.rows).filter(Array.isArray).map(r=>Object.fromEntries(Object.entries(idx).map(([k,i])=>[k,i>=0?r[i]:undefined])));
}

function run(sim,config,{now,timezone}){
 const project=sim.project,rows=rowsOf(sim).filter(r=>r.wouldExecute===true&&r.alertOnly!==true&&finite(time(r.firstWouldExecuteAt))&&time(r.firstWouldExecuteAt)<=now)
  .sort((a,b)=>time(a.firstWouldExecuteAt)-time(b.firstWouldExecuteAt)||String(a.id).localeCompare(String(b.id)));
 const ids=new Set(rows.map(r=>r.id));
 // A real order born from a row being replayed is replaced by the replay itself (never counted twice).
 const proposals=arr(sim.seedOrders).filter(o=>!ids.has(o?.payload?.shadowId)).map(o=>({...o,autonomyOrder:true}));
 const totals=emptyTotals(),autonomy={...config,enabled:true};
 let n=0;
 for(const r of rows){
  const t=time(r.firstWouldExecuteAt),status=r.action==='status';
  const d={id:r.id,project,adAccountId:r.adAccountId,objectId:r.objectId,rule:r.rule,action:status?'status':'budget',
   before:status?{status:'ACTIVE'}:{dailyBudget:r.beforeBudget,currency:r.currency},after:status?{status:r.afterStatus}:{dailyBudget:r.afterBudget,currency:r.currency},
   wouldExecute:true,blockedBy:[],alertOnly:false};
  // Only the orders that existed at that instant (a real order created later never holds an earlier decision).
  const state={autonomy,paused:false,proposals:proposals.filter(o=>time(o.createdAt)<=t)};
  const g=autonomyGrant(state,d,{now:t,timezone}),scopes=r.day===sim.today?[totals.today,totals.d7]:[totals.d7];
  if(g.act==='auto'||g.act==='confirm'){
   for(const s of scopes)s[g.act==='auto'?'orders':'asks']++;
   if(g.act==='auto')proposals.unshift({id:'sim:'+(n++),project,createdAt:new Date(t).toISOString(),autonomyOrder:true,payload:{adAccountId:r.adAccountId,objectId:r.objectId,shadowId:r.id}});
   const d7=totals.d7;if(r.verdict==='acertou')d7.right++;else if(r.verdict==='errou')d7.wrong++;else d7.open++;if(r.winnerCut===true)d7.winnersCut++;
   continue;
  }
  const reasons=g.blockers.length?g.blockers:[g.mode==='shadow'?shadowHeld:'Sem permissão para esta ação.'];
  for(const s of scopes)for(const reason of new Set(reasons))s.held[reason]=(s.held[reason]||0)+1;
 }
 return totals;
}

/**
 * @param {any} sim the `view=sim` payload (AutonomySimRows)
 * @param {any} draftConfig the owner's draft, in the shape `autonomyConfig` saves
 * @param {{now:number,timezone?:string,projectIds:string[]}} opts
 * @returns {any} {ok:true,label:'só permissões',assumedSwitchOn,draft,saved,caveats} | {ok:false,error}
 *   orders: Automático (the Bunk would send); asks: Confirmar (the Bunk would ask you); right/wrong/open/winnersCut over both.
 */
export function simulateGrant(sim,draftConfig,{now,timezone,projectIds}){
 if(!sim||typeof sim!=='object'||typeof sim.project!=='string')return {ok:false,error:'Leitura do simulador ausente.'};
 if(!finite(now))return {ok:false,error:'Instante da simulação ausente.'};
 let draft;try{draft=normalizeAutonomyConfig(draftConfig,arr(projectIds));}catch(e){return {ok:false,error:String(e?.message||'Configuração inválida.')};}
 const zone=timezone||sim.timezone||'America/Sao_Paulo';
 return {ok:true,label:'só permissões',assumedSwitchOn:draft.enabled===false,draft:run(sim,draft,{now,timezone:zone}),saved:run(sim,savedConfig(sim.saved),{now,timezone:zone}),caveats:[...simulateCaveats]};
}
