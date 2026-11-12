/**
 * Autonomia tab: pure helpers that explain the owner's permissions on screen (owner request of 12/11/2026).
 * Presentation only: no React, no DOM, no fetch, no write. lib/autonomy-grant.mjs stays the only judge of what the
 * Bunk may do; nothing here grants, raises or saves a permission. Every function returns new values and never changes
 * its input.
 */
import {autonomyModes,modeLabels,actionLabels,autonomyLimits,campaignKey} from './autonomy-grant.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {newCampaignStage} from './first-24h.mjs';

const fin=v=>typeof v==='number'&&Number.isFinite(v);
const arr=v=>Array.isArray(v)?v:[];
const fmt=v=>v.toLocaleString('pt-BR',{maximumFractionDigits:2});
const fold=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const plural=(n,one,many)=>`${n.toLocaleString('pt-BR')} ${n===1?one:many}`;
const time=v=>{const t=Date.parse(String(v||''));return Number.isFinite(t)?t:NaN;};
const localDay=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};

/** off < shadow < confirm < auto: how much the Bunk may do. An unknown mode ranks as Sombra, as effectiveMode treats it. */
export const modeRank=mode=>{const i=autonomyModes.indexOf(mode);return i<0?1:i;};

/** One visible line per level (the old tooltip text promised an alert that did not exist). */
export const modeCopy=Object.freeze({
 off:'Não mexe: o Bunk não age, não pede e não sugere atalho nesta campanha.',
 shadow:'Só observa: anota o que faria e confere no dia seguinte. Não envia nem pede.',
 confirm:'Pede a você: mostra o pedido aqui e no notch. Quem executa é você, com Touch ID.',
 auto:'Age sozinho: envia a ordem dentro das ações e limites abaixo, sem pedir.',
});

/** The level that applies to one campaign and where it comes from (same rule as effectiveMode). */
export function effectiveModeOf(project,key){
 const p=project||{},c=p.campaigns?.[key],own=!!c&&autonomyModes.includes(c.mode);
 const projectMode=autonomyModes.includes(p.mode)?p.mode:'shadow',mode=own?c.mode:projectMode;
 return {mode,source:own?'campaign':'project',redundant:own&&c.mode===projectMode};
}

/** Campaigns whose own level repeats the project's: they change nothing today. */
export function redundantExceptions(project){
 return Object.keys(project?.campaigns||{}).filter(key=>effectiveModeOf(project,key).redundant);
}

/** Own levels compared with the project's: `above` may do more than the project, `below` less, `same` nothing new. */
export function exceptionDrift(project){
 const out={above:[],below:[],same:[]},base=modeRank(autonomyModes.includes(project?.mode)?project.mode:'shadow');
 for(const key of Object.keys(project?.campaigns||{})){const r=modeRank(effectiveModeOf(project,key).mode);(r>base?out.above:r<base?out.below:out.same).push(key);}
 return out;
}

/** Actions that can really run with these limits (a missing limit means the action does not run). */
export function usableActions(actions,limits){
 const a=actions||{},l=limits||{},out=[];
 if(a.pause)out.push('pause');
 if(a.reduce&&fin(l.maxReducePct))out.push('reduce');
 if(a.increase&&fin(l.maxIncreasePct)&&fin(l.budgetCap))out.push('increase');
 return out;
}

/** "Pausa; reduz até 20%; não aumenta (falta o teto); até 2 ordens por campanha por dia." */
export function actionsSentence(actions,limits){
 const a=actions||{},l=limits||{},parts=[];
 parts.push(a.pause?'pausa':'não pausa');
 parts.push(!a.reduce?'não reduz':fin(l.maxReducePct)?`reduz até ${fmt(l.maxReducePct)}%`:'não reduz (falta a redução máxima)');
 parts.push(!a.increase?'não aumenta':fin(l.maxIncreasePct)&&fin(l.budgetCap)?`aumenta até ${fmt(l.maxIncreasePct)}% com teto de ${fmt(l.budgetCap)}`
  :`não aumenta (falta ${!fin(l.maxIncreasePct)&&!fin(l.budgetCap)?'o aumento máximo e o teto':!fin(l.maxIncreasePct)?'o aumento máximo':'o teto'})`);
 const n=fin(l.ordersPerDay)?l.ordersPerDay:autonomyLimits.defaultOrdersPerDay;
 const text=parts.join('; ');
 return `${text.charAt(0).toUpperCase()}${text.slice(1)}; até ${plural(n,'ordem','ordens')} por campanha por dia.`;
}

/**
 * What one level does right now with the SAVED switch and permissions.
 * @param {{enabled?:boolean,paused?:boolean,mode?:string,actions?:any,limits?:any,covered?:boolean}} input
 * @returns {{acts:'none'|'asks'|'sends',inForce:boolean,tone:'neutral'|'good'|'warn'|'bad',label:string,reasons:string[]}}
 */
export function levelOutcome({enabled=false,paused=false,mode='shadow',actions=null,limits=null,covered=true}={}){
 if(mode==='off')return {acts:'none',inForce:true,tone:'neutral',label:'Não mexe',reasons:[]};
 if(mode!=='confirm'&&mode!=='auto')return {acts:'none',inForce:true,tone:'neutral',label:'Só observa',reasons:[]};
 const acts=mode==='auto'?'sends':'asks',reasons=[];
 if(!enabled)reasons.push('A autonomia está desligada no interruptor geral.');
 if(paused)reasons.push('O escritório está pausado.');
 if(!covered)reasons.push('O Bunk não avalia este projeto (sem regras configuradas).');
 if(!usableActions(actions,limits).length)reasons.push('Nenhuma ação liberada com limite definido.');
 const inForce=!reasons.length;
 return {acts,inForce,tone:!inForce?'warn':mode==='auto'?'good':'neutral',label:inForce?(mode==='auto'?'Valendo: age sozinho':'Valendo: pede a você'):(mode==='auto'?'Automático parado':'Confirmar parado'),reasons};
}

/** "John" when the whole project is at that level, "Nico (3 campanhas)" when only campaigns of it are. */
function namesAt(projects,mode){
 const out=[];
 for(const p of arr(projects)){
  const own=Object.values(p?.campaigns||{}).filter(c=>c?.mode===mode).length,name=p?.name||p?.id;
  if(p?.mode===mode)out.push(String(name));else if(own)out.push(`${name} (${plural(own,'campanha','campanhas')})`);
 }
 return out;
}

/** Where the Bunk sends alone, asks, only watches or stays out, counting campaigns with their own level. */
export function islandLines(view){
 const projects=arr(view?.projects),enabled=view?.enabled===true;
 const sends=namesAt(projects,'auto'),asks=namesAt(projects,'confirm');
 const observes=projects.filter(p=>!autonomyModes.includes(p?.mode)||p.mode==='shadow').map(p=>String(p?.name||p?.id));
 const off=projects.filter(p=>p?.mode==='off').map(p=>String(p?.name||p?.id));
 const headline=!enabled?(sends.length||asks.length?'Desligada: nada é enviado nem pedido a você':'Desligada: o Bunk só observa e aprende')
  :sends.length?`Ligada: o Bunk age sozinho em ${sends.join(', ')}`:asks.length?`Ligada: o Bunk pede a você em ${asks.join(', ')}`:'Ligada, mas nenhum projeto ou campanha está em Confirmar ou Automático';
 return {enabled,headline,sends,asks,observes,off,stopped:!enabled&&(sends.length>0||asks.length>0)};
}

/** Exact powers that start when the owner turns the switch on, one line per project that would act. */
export function turnOnSummary(view){
 const lines=[];
 for(const p of arr(view?.projects)){
  const own=Object.values(p?.campaigns||{}),auto=p?.mode==='auto'||own.some(c=>c?.mode==='auto'),ask=p?.mode==='confirm'||own.some(c=>c?.mode==='confirm');
  if(!auto&&!ask)continue;
  const scope=level=>p?.mode===level?'o projeto inteiro':plural(own.filter(c=>c?.mode===level).length,'campanha','campanhas');
  const parts=[];if(auto)parts.push(`age sozinho em ${scope('auto')}`);if(ask)parts.push(`pede a você em ${scope('confirm')}`);
  lines.push(`${p?.name||p?.id}: ${parts.join(' e ')}. ${actionsSentence(p?.actions,p?.limits)}`);
 }
 return lines;
}

/** Another configured project named in a bracket tag of the campaign ("[JOHN]" inside the Nico project), or null. */
export function foreignProjectTag(name,project,projects){
 const tags=[...String(name||'').matchAll(/\[([^\]]{2,40})\]/g)].map(m=>fold(m[1]));
 if(!tags.length)return null;
 const mine=fold(project?.name);if(mine&&tags.includes(mine))return null;
 const other=arr(projects).find(p=>p&&p.id!==project?.id&&fold(p.name)&&tags.includes(fold(p.name)));
 return other?String(other.name):null;
}

const statusOrder={active:0,paused:1,inactive:2};
/**
 * Campaigns with their own level, split for the screen: `live` (active, or unknown when today's reading is missing) and
 * `parked` (paused, archived or out of today's reading: the level stays saved, the row leaves the main list).
 * @param {any} project draft project {id,name,mode,campaigns}
 * @param {{known?:boolean,byKey?:Map<string,any>|null}} [reading] today's campaigns by campaignKey
 * @param {{projects?:any[]}} [options]
 */
export function exceptionRows(project,reading={},{projects=[]}={}){
 const known=reading?.known===true,byKey=reading?.byKey instanceof Map?reading.byKey:new Map();
 const base=autonomyModes.includes(project?.mode)?project.mode:'shadow',live=[],parked=[];
 const nameCount=new Map();
 for(const c of Object.values(project?.campaigns||{})){const n=fold(c?.name);if(n)nameCount.set(n,(nameCount.get(n)||0)+1);}
 for(const [key,c] of Object.entries(project?.campaigns||{})){
  const e=byKey.get(key)||null,mode=autonomyModes.includes(c?.mode)?c.mode:'shadow',name=String(c?.name||e?.name||key);
  const status=e?(e.status||null):known?'absent':null;
  const row={key,name,mode,status,statusLabel:e?e.statusLabel||null:known?'Fora da leitura de hoje':null,account:e?.accountName||e?.accountId||String(key).split(':')[0]||null,
   same:mode===base,above:modeRank(mode)>modeRank(base),duplicateName:(nameCount.get(fold(c?.name))||0)>1,foreign:foreignProjectTag(name,project,projects)};
  (status==='paused'||status==='inactive'||status==='absent'?parked:live).push(row);
 }
 const cmp=(a,b)=>(statusOrder[a.status]??0)-(statusOrder[b.status]??0)||String(a.account||'').localeCompare(String(b.account||''),'pt-BR',{numeric:true})||a.name.localeCompare(b.name,'pt-BR',{numeric:true})||a.key.localeCompare(b.key);
 live.sort(cmp);parked.sort(cmp);
 const all=[...live,...parked];
 return {live,parked,known,total:all.length,same:all.filter(r=>r.same).map(r=>r.key),above:all.filter(r=>r.above).map(r=>r.key),foreign:all.filter(r=>r.foreign).map(r=>r.key)};
}

/** The project's campaigns with `keys` set to `mode` (unknown keys and invalid modes are ignored). */
export function setCampaignModes(campaigns,keys,mode){
 const out={...(campaigns||{})};if(!autonomyModes.includes(mode))return out;
 for(const key of arr(keys))if(out[key])out[key]={...out[key],mode};
 return out;
}

/** The project's campaigns without `keys`: those campaigns follow the project's level again. */
export function removeCampaigns(campaigns,keys){
 const drop=new Set(arr(keys));
 return Object.fromEntries(Object.entries(campaigns||{}).filter(([key])=>!drop.has(key)));
}

/** Adds the chosen campaigns with the level the owner picked in the list (default: Desligado, as always). */
export function addCampaigns(campaigns,list,mode='off'){
 const out={...(campaigns||{})},level=autonomyModes.includes(mode)?mode:'off';
 for(const r of arr(list))if(r?.key&&!out[r.key])out[r.key]={mode:level,name:r.name};
 return out;
}

/**
 * Campaign rows for the "add campaign" list: the live reading (the newest, with campaigns created minutes ago and the
 * scheduled ones) over today's analysis reading. A reading from another local day is never shown as today's.
 * @param {{analysis?:any,live?:any,now?:number}} input today/campaign snapshots of ONE project
 */
export function pickerReading({analysis=null,live=null,now=Date.now()}={}){
 const valid=s=>!!s&&s.level==='campaign'&&s.period==='today'&&Array.isArray(s.rows)&&fin(time(s.fetchedAt));
 const sameDay=s=>{const tz=s.timezone||'America/Sao_Paulo',a=localDay(time(s.fetchedAt),tz);return !!a&&a===localDay(now,tz);};
 const a=valid(analysis)&&sameDay(analysis)?analysis:null,l=valid(live)&&sameDay(live)?live:null;
 if(!a&&!l)return {rows:[],at:null,source:null,currency:null,timezone:analysis?.timezone||live?.timezone||null,stale:valid(analysis)||valid(live)};
 const newest=l&&(!a||time(l.fetchedAt)>=time(a.fetchedAt))?l:a,older=newest===l?a:l;
 const rows=new Map();
 for(const s of [older,newest])for(const r of s?.rows||[])if(r&&r.adAccountId&&r.externalId)rows.set(campaignKey(r.adAccountId,r.externalId),r);
 const currency=[newest,older].map(s=>s?.currency).find(c=>typeof c==='string'&&/^[A-Z]{3}$/.test(c))||null;
 return {rows:[...rows.values()],at:newest.fetchedAt,source:newest===l?'live':'analysis',currency,timezone:newest.timezone||null,stale:false};
}

/**
 * Why an active campaign shows no numbers yet: 'scheduled' (dated ahead on Meta or in its name) or 'no-delivery'
 * (active, nothing spent or shown today). Null for campaigns already delivering, paused or out of scope.
 */
export function deliveryNote(row,{now=Date.now(),timezone='America/Sao_Paulo'}={}){
 if(!row||String(row.status||'').toUpperCase()!=='ACTIVE'||isWarmupCampaign(row.name))return null;
 if(fin(row.spend)&&row.spend>0||fin(row.impressions)&&row.impressions>0)return null;
 const startAt=row.startAt||row.metaLive?.startTime||null;
 let stage=null;try{stage=newCampaignStage({...row,startAt},{},{now,timezone});}catch{stage=null;}
 if(stage?.stage==='scheduled')return {kind:'scheduled',label:stage.startsOn?`Programada · começa ${stage.startsOn}`:'Programada'};
 return {kind:'no-delivery',label:'Sem entrega ainda'};
}

/** Budget currencies of today's campaigns; an unknown currency is kept apart and never counts as a second currency. */
export function currencyGroups(campaigns){
 const groups=new Map();
 for(const c of arr(campaigns)){
  const budget=c?.budget?.dailyBudget;if(!fin(budget))continue;
  const code=typeof c.budget.currency==='string'&&/^[A-Z]{3}$/.test(c.budget.currency)?c.budget.currency:null;
  const g=groups.get(code)||{currency:code,count:0,maxBudget:null};g.count++;g.maxBudget=g.maxBudget===null?budget:Math.max(g.maxBudget,budget);groups.set(code,g);
 }
 return [...groups.values()].sort((a,b)=>(a.currency===null?1:0)-(b.currency===null?1:0)||b.count-a.count||String(a.currency).localeCompare(String(b.currency)));
}
export const isMixedCurrency=groups=>arr(groups).filter(g=>g?.currency).length>1;

/** Plain list of what the draft changes, project by project, and whether any change lets the Bunk do more. */
export function draftChanges(savedProjects,draftProjects){
 const saved=new Map(arr(savedProjects).map(p=>[p.id,p])),lines=[];let raises=false;
 for(const d of arr(draftProjects)){
  const s=saved.get(d.id);if(!s||JSON.stringify(s)===JSON.stringify(d))continue;
  const parts=[];
  if(s.mode!==d.mode){parts.push(`nível ${modeLabels[s.mode]||s.mode} → ${modeLabels[d.mode]||d.mode}`);if(modeRank(d.mode)>modeRank(s.mode))raises=true;}
  for(const a of Object.keys(actionLabels)){const was=!!s.actions?.[a],is=!!d.actions?.[a];if(was!==is){parts.push(`${actionLabels[a]} ${is?'ligado':'desligado'}`);if(is)raises=true;}}
  const limitNames={maxIncreasePct:'aumento máximo',maxReducePct:'redução máxima',budgetCap:'teto',ordersPerDay:'ordens por dia'};
  for(const [k,label] of Object.entries(limitNames)){const was=s.limits?.[k]??null,is=d.limits?.[k]??null;if(was!==is){parts.push(`${label} ${was===null?'não definido':fmt(was)} → ${is===null?'não definido':fin(is)?fmt(is):'inválido'}`);if(fin(is)&&(was===null||is>was))raises=true;}}
  const sc=s.campaigns||{},dc=d.campaigns||{},added=Object.keys(dc).filter(k=>!sc[k]),removed=Object.keys(sc).filter(k=>!dc[k]),changed=Object.keys(dc).filter(k=>sc[k]&&sc[k].mode!==dc[k].mode);
  if(added.length)parts.push(`${plural(added.length,'campanha ganha','campanhas ganham')} nível próprio`);
  if(removed.length)parts.push(`${plural(removed.length,'campanha volta','campanhas voltam')} a seguir o projeto`);
  if(changed.length)parts.push(`${plural(changed.length,'campanha muda','campanhas mudam')} de nível`);
  const before=key=>modeRank(sc[key]?sc[key].mode:s.mode),after=key=>modeRank(dc[key]?dc[key].mode:d.mode);
  if([...added,...removed,...changed].some(key=>after(key)>before(key)))raises=true;
  if(parts.length)lines.push(`${d.name||d.id}: ${parts.join('; ')}.`);
 }
 return {lines,raises};
}

/**
 * The save bar: one status, and whether saving is possible. Nothing is in force until it is saved.
 * @param {{draft?:boolean,changed?:number,conflict?:boolean,busy?:boolean,last?:'saved'|'failed'|null,error?:string,invalid?:boolean,enabled?:boolean}} [input]
 * @returns {{tone:'busy'|'warn'|'bad'|'info'|'good',text:string,canSave:boolean}}
 */
export function saveStateView(input={}){
 const {draft=false,changed=0,conflict=false,busy=false,last=null,error='',invalid=false,enabled=false}=input;
 const pending=changed===1?'1 projeto com alterações não salvas':`${changed} projetos com alterações não salvas`;
 if(busy)return {tone:'busy',text:'Salvando…',canSave:false};
 if(conflict)return {tone:'warn',text:'As permissões salvas mudaram em outra sessão. Seu rascunho foi preservado: carregue as salvas antes de salvar.',canSave:false};
 if(draft&&changed>0){
  if(invalid)return {tone:'bad',text:`${pending}. Corrija os limites marcados antes de salvar.`,canSave:false};
  if(last==='failed')return {tone:'bad',text:`Não foi possível salvar${error?`: ${error}`:'.'} ${pending}; o que vale ainda é o que estava salvo.`,canSave:true};
  return {tone:'warn',text:`${pending}. Nada disso vale até você salvar.`,canSave:true};
 }
 if(draft)return {tone:'info',text:'Rascunho igual às permissões salvas: nada para salvar.',canSave:false};
 if(last==='saved')return {tone:'good',text:enabled?'Permissões salvas e valendo agora.':'Permissões salvas. A autonomia está desligada: nada é enviado nem pedido até você ligar.',canSave:false};
 if(last==='failed')return {tone:'bad',text:`Não foi possível salvar as permissões${error?`: ${error}`:'.'} Tente de novo.`,canSave:false};
 return {tone:'info',text:'Sem alterações para salvar.',canSave:false};
}

/**
 * Requests waiting for the owner (level Confirmar): today's `confirm` lines of the executor's log, one per campaign and
 * action, newest first. A request stops waiting when a later line of the same decision became an order, or when the
 * decision is no longer proposed (`decisions`, when given, are the current decisions of the deep view).
 * @param {any[]} log @param {{now?:number,timezone?:string,decisions?:any[]|null}} [options]
 */
export function pendingAsks(log,{now=Date.now(),timezone='America/Sao_Paulo',decisions=null}={}){
 const today=localDay(now,timezone),seen=new Set(),ordered=new Set(),out=[];
 for(const e of arr(log))if(e?.result?.kind==='order'&&e.shadowId)ordered.add(e.shadowId);
 const current=Array.isArray(decisions)?new Map(decisions.filter(d=>d?.id).map(d=>[d.id,d])):null;
 for(const e of arr(log)){
  if(e?.result?.kind!=='confirm')continue;
  const at=time(e.at);if(!fin(at)||localDay(at,timezone)!==today)continue;
  const key=e.shadowId||JSON.stringify([e.project,e.adAccountId,e.objectId,e.action]);if(seen.has(key))continue;seen.add(key);
  if(e.shadowId&&ordered.has(e.shadowId))continue;
  const d=current&&e.shadowId?current.get(e.shadowId):undefined;
  const stillCurrent=!current?null:d?d.status==='pediria':false;
  if(stillCurrent===false)continue;
  out.push({id:key,at:e.at,ageMinutes:Math.max(0,Math.round((now-at)/60000)),project:e.project||null,projectName:e.projectName||null,adAccountId:e.adAccountId||null,objectId:e.objectId||null,
   campaign:e.campaign||null,action:e.action||null,actionLabel:actionLabels[e.action]||'Ação',percent:fin(e.percent)?e.percent:null,before:e.before??null,after:e.after??null,ruleLabel:e.ruleLabel||null,stillCurrent});
 }
 return out.sort((a,b)=>time(b.at)-time(a.at));
}

/**
 * The requests shown in "Aguardando você": the executor's own open list when it sends one (exact: closed as soon as the
 * rule drops the decision, the level changes or the switch goes off), else today's `confirm` lines of the log. With the
 * switch off nothing is asked, so nothing is shown.
 * @param {any} remote the plain `/api/autonomy` read {asks?,log?} @param {{enabled?:boolean,now?:number,timezone?:string,project?:string}} [options]
 */
export function openAsks(remote,{enabled=false,now=Date.now(),timezone='America/Sao_Paulo',project='all'}={}){
 if(!enabled)return [];
 const list=Array.isArray(remote?.asks)?remote.asks.filter(a=>a&&typeof a.id==='string').map(a=>({id:a.id,at:a.at||null,ageMinutes:fin(time(a.at))?Math.max(0,Math.round((now-time(a.at))/60000)):null,project:a.project||null,projectName:a.projectName||null,
  adAccountId:a.adAccountId??null,objectId:a.objectId??null,campaign:a.campaign||null,account:a.account||null,action:a.action||null,actionLabel:actionLabels[a.action]||'Ação',percent:fin(a.percent)?a.percent:null,before:a.before??null,after:a.after??null,
  ruleLabel:a.ruleLabel||null,reason:a.reason||null})):pendingAsks(remote?.log,{now,timezone});
 return list.filter(a=>project==='all'||!a.project||a.project===project).sort((a,b)=>time(b.at)-time(a.at));
}

/** "há 5 min", "há 2 h", "agora": how long a request has been waiting. */
export function waitingText(minutes){
 if(!fin(minutes))return 'horário N/D';
 if(minutes<1)return 'agora';
 if(minutes<60)return `há ${Math.round(minutes)} min`;
 const h=Math.floor(minutes/60);return h<24?`há ${h} h`:`há ${plural(Math.floor(h/24),'dia','dias')}`;
}
