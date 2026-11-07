/** Activity log of budget/status changes on Meta campaigns, for presentation only.
 * Sources: Malva edit history (actor and exact time), complete Malva reads that observed a change
 * (no actor, time is a read interval) and Bunker executions confirmed after the owner's approval.
 * Nothing here attributes an unknown actor, authorizes a choice or calls a provider. */
const arr=value=>Array.isArray(value)?value:[];
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const budgetFields=['dailyBudget','lifetimeBudget'],statusFields=['status','effectiveStatus'];
const paused=value=>/PAUSED|INACTIVE|ARCHIVED|DELETED/.test(String(value||'').toUpperCase());
const active=value=>String(value||'').toUpperCase()==='ACTIVE';
const mergeWindowMs=3*3600000;
export const activityActions=Object.freeze({increase:'Aumentos',reduce:'Reduções',pause:'Pausas',activate:'Ativações'});

/** Exact transition with percent for budgets. Missing or zero baselines never get an invented percent. */
export function describeChange({field,before,after}){
 if(budgetFields.includes(field)&&finite(before)&&finite(after)&&before!==after){
  const percent=before>0?Math.round((after-before)/before*1000)/10:null;
  return {action:after>before?'increase':'reduce',field,before,after,percent};
 }
 if(statusFields.includes(field)&&text(before)&&text(after)&&before!==after){
  if(paused(after)&&!paused(before))return {action:'pause',field,before,after,percent:null};
  if(active(after)&&!active(before))return {action:'activate',field,before,after,percent:null};
  return {action:'status',field,before,after,percent:null};
 }
 if(field==='budgetCurrency'&&text(before)&&text(after)&&before!==after)return {action:'currency',field,before,after,percent:null};
 return null;
}

function actorName(actor,automatic){
 if(typeof actor==='string'&&actor.trim())return actor.trim();
 if(actor&&typeof actor==='object'){for(const key of ['name','profile','key','id'])if(text(actor[key]))return actor[key].trim();}
 return automatic===true?'Regra automática':null;
}
const projectsOf=record=>[...new Set([record.project,...arr(record.projects)].filter(text))];

function historyEvents(state){
 return arr(state.decisionHistory).flatMap(r=>{
  const change=describeChange(r),at=time(r.occurredAt);if(!change||!Number.isFinite(at)||r.echo===true)return [];
  return projectsOf(r).map(project=>({id:'history:'+(r.id||r.eventKey)+':'+project,project,adAccountId:r.adAccountId,objectId:r.objectId,name:r.name||null,accountName:r.accountName||null,...change,currency:r.currency||null,at:r.occurredAt,from:null,actor:actorName(r.actor,r.automatic),origin:'history',source:'Histórico de edições Malva'}));
 });
}
function observedEvents(state){
 return arr(state.campaignChanges).flatMap(r=>{
  const at=time(r.observedAt);if(!Number.isFinite(at))return [];
  const fields=arr(r.changes).map(c=>c.field),changes=arr(r.changes).filter(c=>!(c.field==='effectiveStatus'&&fields.includes('status')));
  return changes.map(c=>{const change=describeChange(c);return change&&{id:'observed:'+r.id+':'+c.field,project:r.project,adAccountId:r.adAccountId,objectId:r.objectId,name:r.name||null,accountName:r.accountName||null,...change,currency:r.after?.budgetCurrency||r.before?.budgetCurrency||null,at:r.observedAt,from:r.previousObservedAt||null,actor:null,origin:'observed',source:'Leitura Malva (autor não informado)'};}).filter(Boolean);
 });
}
function bunkerEvents(state){
 const proposals=new Map(arr(state.proposals).map(p=>[p.id,p]));
 return arr(state.executions).filter(e=>e.status==='Confirmada'&&Number.isFinite(time(e.confirmedAt))).flatMap(e=>{
  const p=proposals.get(e.proposalId),payload=p?.payload;if(!payload)return [];
  const field=payload.action==='status'?'status':'dailyBudget',change=describeChange({field,before:payload.before?.[field],after:payload.after?.[field]});
  return change?[{id:'bunker:'+e.id,project:e.project||p.project,adAccountId:payload.adAccountId,objectId:payload.objectId,name:null,accountName:null,...change,currency:payload.currency||null,at:e.confirmedAt,from:null,actor:'Bunker · aprovado por você',origin:'bunker',source:'Execução confirmada pelo Bunker'}]:[];
 });
}
const sameTransition=(a,b)=>a.project===b.project&&a.adAccountId===b.adAccountId&&a.objectId===b.objectId&&a.action===b.action&&a.before===b.before&&a.after===b.after&&Math.abs(time(a.at)-time(b.at))<=mergeWindowMs;
const rank={bunker:0,history:1,observed:2,live:3};

/** One entry per real transition, newest first. A richer source (Bunker, then Malva history) wins over a bare read. */
const merged=new WeakMap();
function mergedEvents(state){
 if(state&&typeof state==='object'&&merged.has(state))return merged.get(state);
 const all=[...bunkerEvents(state),...historyEvents(state),...observedEvents(state)];
 all.sort((a,b)=>rank[a.origin]-rank[b.origin]||time(b.at)-time(a.at)||a.id.localeCompare(b.id));
 const kept=[],byObject=new Map();
 for(const e of all){
  const key=JSON.stringify([e.project,e.adAccountId,e.objectId]),peers=byObject.get(key)||[],twin=peers.find(k=>sameTransition(k,e));
  if(twin){twin.confirmedBy=[...new Set([...(twin.confirmedBy||[]),e.source])];if(!twin.name&&e.name)twin.name=e.name;if(!twin.accountName&&e.accountName)twin.accountName=e.accountName;continue;}
  const copy={...e};kept.push(copy);peers.push(copy);byObject.set(key,peers);
 }
 kept.sort((a,b)=>time(b.at)-time(a.at)||a.id.localeCompare(b.id));
 const result={events:kept,byObject};
 if(state&&typeof state==='object')merged.set(state,result);
 return result;
}
export function activityLog(state,{project='all',since=-Infinity,until=Infinity,now=Date.now()}={}){
 return mergedEvents(state).events.filter(e=>(project==='all'||e.project===project)&&time(e.at)>=since&&time(e.at)<=Math.min(until,now+300000)).map(e=>({...e}));
}

/** Calendar-day activity is distinct from rolling hours. Consolidated projects use one explicit display timezone. */
export const activityRanges=Object.freeze({today:'Hoje',day:'24 horas',week:'7 dias'});
export function activityTimezone(state,project='all'){
 const fallback='America/Boa_Vista';
 const zones=new Set(arr(state?.snapshots).filter(s=>project!=='all'&&s.projectId===project&&s.source==='Malva MCP'&&s.complete===true&&text(s.timezone)).map(s=>s.timezone));
 const zone=zones.size===1?[...zones][0]:fallback;
 try{new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(0);return zone;}catch{return fallback;}
}
export function activityForRange(state,{project='all',range='day',now=Date.now()}={}){
 const timezone=activityTimezone(state,project);
 if(!finite(now))return {events:[],timezone};
 const since=now-(range==='week'?168:range==='today'?48:24)*3600000;
 let events=activityLog(state,{project,since,until:now,now});
 if(range==='today'){
  const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}),day=calendar.format(now);
  events=events.filter(e=>calendar.format(time(e.at))===day);
 }
 return {events,timezone};
}

/** Counts per action and who did them. Unknown authors stay "autor não informado", never guessed. */
export function activitySummary(events){
 const out=Object.fromEntries(Object.keys(activityActions).map(action=>[action,{count:0,actors:{},unknown:0}]));
 for(const e of events){const bucket=out[e.action];if(!bucket)continue;bucket.count++;if(e.actor)bucket.actors[e.actor]=(bucket.actors[e.actor]||0)+1;else bucket.unknown++;}
 return out;
}

/** The card's own campaign: recent transitions, plus a live-read change not yet in any log. */
export function cardActivity(state,card,{now=Date.now(),hours=72}={}){
 const row=card?.row;if(!row||!text(card.project))return {events:[],sinceAnalysis:[],latest:null};
 const since=now-hours*3600000,events=arr(mergedEvents(state).byObject.get(JSON.stringify([card.project,row.adAccountId,row.externalId]))).filter(e=>time(e.at)>=since&&time(e.at)<=now+300000).map(e=>({...e}));
 for(const c of arr(card.liveDrift?.changes)){
  const change=describeChange(c);if(!change||!text(card.liveAt))continue;
  const live={id:'live:'+card.project+':'+row.externalId+':'+c.field,project:card.project,adAccountId:row.adAccountId,objectId:row.externalId,name:row.name||null,accountName:row.accountName||null,...change,currency:card.observedRow?.budgetCurrency||row.budgetCurrency||null,at:card.liveAt,from:card.sourceAt||null,actor:null,origin:'live',source:'Acompanhamento ao vivo (autor ainda não informado)'};
  if(!events.some(e=>e.action===live.action&&e.before===live.before&&e.after===live.after))events.unshift(live);
 }
 events.sort((a,b)=>time(b.at)-time(a.at));
 const analysis=time(card.sourceAt),sinceAnalysis=Number.isFinite(analysis)?events.filter(e=>time(e.at)>analysis):[];
 return {events,sinceAnalysis,latest:sinceAnalysis[0]||null};
}

/** Today's numbers now versus the reviewed analysis of the same day. Missing stays null. */
export function metricEvolution(card){
 const before=card?.windows?.today,after=card?.liveToday;
 if(!before||!after||!Number.isFinite(time(card.liveAt))||!Number.isFinite(time(card.sourceAt))||time(card.liveAt)<=time(card.sourceAt))return null;
 if(Number.isFinite(time(before.from))&&Number.isFinite(time(after.from))&&time(before.from)!==time(after.from))return null;
 const diff=key=>finite(before[key])&&finite(after[key])?after[key]-before[key]:null;
 return {since:card.sourceAt,at:card.liveAt,spend:diff('spend'),frontOrders:diff('frontOrders'),revenueNet:diff('revenueNet'),roas:{before:before.roas??null,after:after.roas??null},roi:{before:before.roi??null,after:after.roi??null}};
}
