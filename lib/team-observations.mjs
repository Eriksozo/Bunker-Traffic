/**
 * Modo Gestor (W3), observations: "the team looked and did nothing" (spec §3.2). At most once per hour per project, on a
 * fresh Malva cut (the one the Sombra already reads, no extra reads), one compact positional row per ACTIVE Meta sales
 * campaign (warm-up out) is kept in the executor's storage (`pb:obs:<day>:<project>:<HH>`, 21 days). After 90 min each
 * row is labelled with the first move a person made on that campaign, or `manter` only when one of the people acted in
 * that project within ±90 min (someone was at the desk), otherwise `unlabeled` (never used). When a day closes, its rows
 * fold into daily bins (`pb:bins:<day>:<project>`, 90 days): sparse cells, counts per person and kind, steps, closed
 * results per campaign, the day's base and exclusions. Fitting reads bins only, never raw rows.
 * The Bunk, Meta, automations, launch tools and people outside the Malva Dash are never labels (lib/team-learning.mjs).
 * An N/D feature stays null and never satisfies a condition. Pure: no provider call, no write, no approval, no dispatch.
 */
import {sum} from './analysis.mjs';
import {shortId} from './learning-math.mjs';
import {verifiedNoSpendPeriods} from './test-launch.mjs';
import {projectReading,rowWindows,campaignStage,activeSalesRow,todayBudgetEdits,partialDayOf} from './campaign-context.mjs';
import {outsideLabel} from './team-learning.mjs';

export const observationPolicy=Object.freeze({version:1,everyMs:3600000,everyToleranceMs:5*60000,labelAfterMs:90*60000,presenceMs:90*60000,
 maxRowsPerKey:400,maxCellsPerBin:1500,maxStepsPerKind:60,maxCaseRefs:20,binMaxBytes:100000,nameMax:60,
 // Stored values are measured in UTF-8 bytes (the store facade's unit) with a margin under its 100 KB cap.
 binSafeBytes:95000,obsSafeBytes:95000});
/** Local hour slots (spec §3.2). */
export const hourSlots=Object.freeze(['00-0030','0030-09','09-11','11-13','13-16','16-20','20-24']);
export const obsColumns=Object.freeze(['acct','obj','name','stage','test','hour','minute','spend','ticket','front','orders','ic','roiT','roiY','frontY','resY','spendY','roi3','roi7','roiS',
 'budget','cur','capShare','raised','cut','sinceEdit','pd','numAge','label','person','step','mv','lead']);
export const cellColumns=Object.freeze(['stage','test','hour','slot','spendT','front','ic','roiT','roiY','frontY','roi3','roi7','roiS','bBand','capShare','raised','cut','pd','label','person','step','camp','mv','lead','n']);
export const labelKinds=Object.freeze(['pause','reduce','increase','activate']);

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const r2=n=>finite(n)?Math.round(n*100)/100:null;
const q=(n,step,max=Infinity)=>finite(n)?Math.round(Math.min(max,Math.max(-max,n))/step)*step:null;
const fix=n=>finite(n)?Math.round(n*1000)/1000:null;
const encoder=new TextEncoder();
/** UTF-8 bytes of a JSON value (the unit of the runner's store facade). */
export const utf8Bytes=v=>{try{return encoder.encode(JSON.stringify(v)).length;}catch{return Infinity;}};
const localParts=(at,timezone)=>{try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));return {hour:Number(p.hour),minute:Number(p.hour)*60+Number(p.minute)};}catch{return {hour:null,minute:null};}};
export const localDayOf=(at,timezone)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}catch{return null;}};
export const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
/** Slot of a local minute of the day (0–1439), or null. */
export function hourSlot(minute){
 if(!finite(minute)||minute<0)return null;
 return minute<30?hourSlots[0]:minute<540?hourSlots[1]:minute<660?hourSlots[2]:minute<780?hourSlots[3]:minute<960?hourSlots[4]:minute<1200?hourSlots[5]:hourSlots[6];
}
/** Budget band per currency (native daily budget). Other currencies: N/D. */
export function budgetBand(budget,currency){
 if(!finite(budget)||!(budget>0))return null;const c=String(currency||'').toUpperCase();
 const cuts=c==='BRL'?[200,500,1000,3000]:c==='USD'?[50,100,200,600]:null;if(!cuts)return null;
 const i=cuts.findIndex(x=>budget<x);return c+':'+(i<0?cuts.length:i);
}
/** Short campaign id inside one project (bins, cells, case refs). */
export const campId=(acct,obj)=>shortId(['camp',String(acct??''),String(obj??'')]);

/**
 * Features of one campaign at one reading (shared by observations and the playbook; spec §3.2). Every field missing at
 * the source is null. Money in BRL (Malva), budgets native with `cur`.
 * @param {any} row today's row @param {{windows:any,aligned:boolean,stage:string|null,test:boolean,now:number,timezone:string,ticketFront?:number|null,budgetCap?:number|null,edits?:any[],numbersAt?:string|null,partialDay?:any}} c
 */
export function teamFeatures(row,{windows,aligned,stage,test,now,timezone,ticketFront=null,budgetCap=null,edits=[],numbersAt=null,partialDay=null}){
 const w=windows||{},t=sum([row]),y=w.yesterday?sum([w.yesterday]):null,d3=w['3d']?sum([w['3d']]):null,d7=w['7d']?sum([w['7d']]):null;
 const {hour,minute}=localParts(now,timezone);
 const ticket=finite(partialDay?.ticket)&&partialDay.ticket>0?partialDay.ticket:finite(ticketFront)&&ticketFront>0?ticketFront:null;
 const fresh=stage==='first-day'||stage==='second-day'||stage==='young';
 const since=fresh?(stage==='first-day'?t:aligned&&w['7d']?sum([w['7d'],row]):null):null;
 const budget=finite(row?.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0)?row.dailyBudget:null;
 const raised=edits.find(e=>e.action==='increase')||null,cut=edits.find(e=>e.action==='reduce')||null,last=edits[0]||null;
 return {acct:row?.adAccountId??null,obj:row?.externalId??null,name:typeof row?.name==='string'?row.name.slice(0,observationPolicy.nameMax):null,
  stage:stage||null,test:!!test,hour,minute,
  spend:r2(t.spend),ticket:r2(ticket),front:finite(t.frontOrders)?t.frontOrders:null,orders:finite(t.orders)?t.orders:null,ic:finite(t.checkouts)?t.checkouts:null,
  roiT:fix(t.roi),roiY:y?fix(y.roi):null,frontY:y&&finite(y.frontOrders)?y.frontOrders:null,resY:y?r2(y.result):null,spendY:y?r2(y.spend):null,
  roi3:d3?fix(d3.roi):null,roi7:d7?fix(d7.roi):null,roiS:since?fix(since.roi):null,
  budget,cur:budget?String(row.budgetCurrency||'').toUpperCase()||null:null,
  capShare:budget&&finite(budgetCap)&&budgetCap>0?fix(budget/budgetCap):null,
  raised:edits.length?!!raised:false,cut:edits.length?!!cut:false,sinceEdit:last&&finite(time(last.at))?Math.max(0,Math.round((now-time(last.at))/60000)):null,
  pd:partialDay?partialDay.hold===true:null,numAge:finite(time(numbersAt))?Math.max(0,Math.round((now-time(numbersAt))/60000)):null};
}
/** Spend in tickets (front ticket of the policy, or the campaign's 7-day cost per front), or null. */
export const spendTickets=f=>finite(f?.spend)&&finite(f?.ticket)&&f.ticket>0?f.spend/f.ticket:null;

/**
 * The observation rows of one project at this reading, or null when the trusted today cut is missing or stale (the same
 * freshness as the Sombra: ≤30 min). One row per ACTIVE Meta sales campaign, warm-up out, ≤ maxRowsPerKey.
 * @param {any} state @param {{project:string,liveItem?:any,events?:any[],params?:any,now:number,budgetCap?:number|null}} options
 */
export function buildObservations(state,{project,liveItem=null,events=[],params={},now,budgetCap=null}){
 const reading=projectReading(state,project,liveItem,now);if(!reading)return null;
 const {today,closed,prev,timezone}=reading,day=localDayOf(now,timezone),{hour}=localParts(now,timezone);
 const rows=[];let size=0,truncated=0;
 const value={v:observationPolicy.version,at:new Date(now).toISOString(),day,project,timezone,hour,cut:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt},cols:[...obsColumns],rows};
 // Bounded by rows and by measured UTF-8 bytes (long names and ids): a large project never makes the put fail.
 const room=observationPolicy.obsSafeBytes-utf8Bytes({...value,truncated:9999});
 for(const row of today.rows){
  if(!activeSalesRow(row))continue;
  if(rows.length>=observationPolicy.maxRowsPerKey){truncated++;continue;}
  const f=campaignFeatures(state,{project,row,today,closed,prev,timezone,events,params,now,budgetCap});
  const packed=obsColumns.map(c=>c in f?f[c]:null),b=utf8Bytes(packed)+1;
  if(size+b>room){truncated++;continue;}
  size+=b;rows.push(packed);
 }
 if(truncated)value.truncated=truncated;
 return {key:obsKey(day,project,hour),value};
}
/** Features of one row inside a project reading (observations and playbook decisions read the exact same numbers). */
export function campaignFeatures(state,{project,row,today,closed,prev,timezone,events=[],params={},now,budgetCap=null}){
 const {windows}=rowWindows(state,project,today,closed,prev,row);
 const noSpendPeriods=verifiedNoSpendPeriods(state?.snapshots,project,row,today.from);
 const {stage,test}=campaignStage(row,windows,{now,timezone,noSpendPeriods});
 const partialDay=partialDayOf(windows,{aligned:today.aligned,today:row,ticketFront:params?.ticketFront??null});
 return {...teamFeatures(row,{windows,aligned:today.aligned,stage,test,now,timezone,ticketFront:params?.ticketFront??null,budgetCap,edits:todayBudgetEdits(events,project,row,now,timezone),numbersAt:today.fetchedAt,partialDay}),windows,partialDay};
}
export const obsKey=(day,project,hour)=>`pb:obs:${day}:${project}:${String(hour??0).padStart(2,'0')}`;
export const binsKey=(day,project)=>`pb:bins:${day}:${project}`;
export const backfillDayKey=(day,project)=>`pb:bf:${day}:${project}`;

/** A row as an object (positional → named). */
export function obsRow(cols,row){const o={};arr(cols).forEach((c,i)=>{o[c]=row?.[i]??null;});return o;}

/**
 * People's moves that may label a row or show presence: the owner and named Malva people of this project. The outside
 * label (no attributed profile), the Bunk (never in teamActions), Meta, automations and backfilled day-level moves are out.
 */
export function learnableMoves(actions,project){
 return arr(actions).filter(a=>a&&a.project===project&&labelKinds.includes(a.kind)&&(a.who==='owner'||a.who==='team')&&!a.outside&&a.name!==outsideLabel&&a.ctx?.source!=='backfill-daily'&&finite(time(a.at)))
  .sort((a,b)=>time(a.at)-time(b.at)||String(a.id).localeCompare(String(b.id)));
}
const personOfMove=a=>a.person||(a.who==='owner'?'owner':'p:'+shortId(['person','name',String(a.name||'?')]));

/**
 * Labels the rows of one observation once it is `labelAfterMs` old: the first move a person made on that campaign after
 * the reading (within 90 min), else `manter` when one of the people acted in the project within ±90 min, else
 * `unlabeled`. Rows already labelled keep their label. Returns the new value, or null when not due or unchanged.
 * @param {any} obs stored observation @param {any[]} moves learnable moves of this project (learnableMoves)
 */
export function labelObservation(obs,moves,{now}){
 const at=time(obs?.at);if(!finite(at)||now<at+observationPolicy.labelAfterMs)return null;
 const ci=Object.fromEntries(arr(obs.cols).map((c,i)=>[c,i])),list=arr(moves),end=at+observationPolicy.labelAfterMs;
 const present=list.some(m=>Math.abs(time(m.at)-at)<=observationPolicy.presenceMs);
 let changed=false;
 const rows=arr(obs.rows).map(r=>{
  if(r[ci.label]!=null)return r;
  const m=list.find(x=>String(x.adAccountId??'')===String(r[ci.acct]??'')&&String(x.objectId)===String(r[ci.obj])&&time(x.at)>at&&time(x.at)<=end);
  const next=[...r];changed=true;
  if(m){next[ci.label]=m.kind;next[ci.person]=personOfMove(m);next[ci.step]=finite(m.budget?.step)?m.budget.step:null;next[ci.mv]=shortId(['mv',m.id]);next[ci.lead]=Math.round((time(m.at)-at)/60000);}
  else next[ci.label]=present?'manter':'unlabeled';
  return next;
 });
 return changed?{...obs,rows,labeledAt:new Date(now).toISOString()}:null;
}

/** Quantized cell of one labelled observation row (the unit fitting reads). */
export function cellOf(o){
 const spendT=spendTickets(o);
 return {stage:o.stage,test:o.test?1:0,hour:o.hour,slot:hourSlot(o.minute),spendT:q(spendT,0.25,40),front:finite(o.front)?Math.min(o.front,20):null,ic:finite(o.ic)?Math.min(o.ic,20):null,
  roiT:q(o.roiT,0.05,20),roiY:q(o.roiY,0.05,20),frontY:finite(o.frontY)?Math.min(o.frontY,20):null,roi3:q(o.roi3,0.05,20),roi7:q(o.roi7,0.05,20),roiS:q(o.roiS,0.05,20),
  bBand:budgetBand(o.budget,o.cur),capShare:q(o.capShare,0.05,10),raised:o.raised===true?1:o.raised===false?0:null,cut:o.cut===true?1:o.cut===false?0:null,pd:o.pd===true?1:o.pd===false?0:null,
  label:o.label,person:o.person||null,step:q(o.step,0.05,5),camp:campId(o.acct,o.obj),mv:o.mv||null,lead:finite(o.lead)?o.lead:null};
}

/**
 * Folds one closed day of one project into its bin (spec §3.2): labelled cells (moves first, then `manter`; consecutive
 * identical `manter` states of a campaign merge into one cell with a count), people counts per kind (live moves and
 * backfilled ones, deduplicated by move id), steps, the closed "yesterday" result of each campaign seen that day, the
 * day's base and exclusions. Bounded by maxCellsPerBin and binMaxBytes.
 * @param {{day:string,project:string,observations:any[],moves:any[],backfillMoves?:any[],base?:any,excluded?:Record<string,number>,now:number,names?:Record<string,string>}} input
 */
export function foldDay({day,project,observations=[],moves=[],backfillMoves=[],base=null,excluded={},now}){
 const people={},steps={increase:[],reduce:[]},caseRefs=[],persons=[],pIdx=new Map(),y={},seen=new Set();
 const pi=p=>{if(p==null)return null;if(!pIdx.has(p)){pIdx.set(p,persons.length);persons.push(p);}return pIdx.get(p);};
 const allMoves=[];
 for(const m of [...arr(moves),...arr(backfillMoves)]){if(!m?.id||seen.has(m.id)||m.day!==day||m.project!==project)continue;seen.add(m.id);allMoves.push(m);}
 allMoves.sort((a,b)=>time(a.at)-time(b.at)||String(a.id).localeCompare(String(b.id)));
 let bf=0;
 for(const m of allMoves){
  if(!labelKinds.includes(m.kind)||m.outside||m.name===outsideLabel||(m.who!=='owner'&&m.who!=='team'))continue;
  const p=personOfMove(m);if(!people[p])people[p]={name:m.who==='owner'?'Você':String(m.name||'?').slice(0,60),role:p==='owner'?'owner':'team',pause:0,reduce:0,increase:0,activate:0,hours:Array(24).fill(0)};
  people[p][m.kind]++;if(finite(m.minute))people[p].hours[Math.floor(m.minute/60)]++;
  if(m.ctx?.source==='backfill-daily')bf++;
  // [step, person, backfilled 1|0, local minute | null]: backfilled steps feed the plays' step (lib/manager-playbook.mjs).
  if((m.kind==='increase'||m.kind==='reduce')&&finite(m.budget?.step)&&steps[m.kind].length<observationPolicy.maxStepsPerKind)steps[m.kind].push([m.budget.step,p,m.ctx?.source==='backfill-daily'?1:0,finite(m.minute)?m.minute:null]);
  if(caseRefs.length<observationPolicy.maxCaseRefs)caseRefs.push({day,adAccountId:m.adAccountId??null,objectId:String(m.objectId),campaign:m.campaign||null,person:p,name:people[p].name,kind:m.kind,at:m.at,step:finite(m.budget?.step)?m.budget.step:null});
 }
 const cells=[],keep=new Map(),campaigns=new Set(),ordered=[...arr(observations)].filter(o=>o?.day===day).sort((a,b)=>time(a.at)-time(b.at));
 const names=new Map();
 for(const obs of ordered){
  for(const r of arr(obs.rows)){
   const o=obsRow(obs.cols,r),c=campId(o.acct,o.obj);campaigns.add(c);if(o.name&&!names.has(c))names.set(c,o.name);
   // Only an aligned reading carries the closed yesterday (after midnight the live-only cut reads a partial one).
   if(obs.cut?.kind!=='live-only'&&(finite(o.roiY)||finite(o.resY)))y[c]=[o.roiY,o.resY,o.spendY];
   if(o.label==null||o.label==='unlabeled')continue;
   const cell=cellOf(o),vec=cellColumns.slice(0,18).map(k=>cell[k]);
   // Consecutive identical `manter` states of a campaign in the same slot merge (the hour of the first one is kept).
   if(cell.label==='manter'){const k=c+'|'+JSON.stringify(vec.filter((_,i)=>i!==2)),prevKey=keep.get(c);
    if(prevKey&&prevKey.k===k){prevKey.cell[prevKey.cell.length-1]++;continue;}
    const row=[...vec,'manter',null,null,c,null,null,1];keep.set(c,{k,cell:row});cells.push(row);continue;}
   keep.delete(c);cells.push([...vec,cell.label,pi(cell.person),cell.step,c,cell.mv,cell.lead,1]);
  }
 }
 // Moves first, then `manter`, both in reading order; never more than the caps.
 const li=cellColumns.indexOf('label');
 let out=[...cells.filter(x=>x[li]!=='manter'),...cells.filter(x=>x[li]==='manter')].slice(0,observationPolicy.maxCellsPerBin);
 for(const ref of caseRefs)if(!ref.campaign)ref.campaign=names.get(campId(ref.adAccountId,ref.objectId))||null;
 const bin={v:observationPolicy.version,day,project,at:new Date(now).toISOString(),cols:[...cellColumns],persons,cells:out,people,steps,campaigns:campaigns.size,y,
  base:base&&finite(base.campaigns)&&base.campaigns>0?[base.campaigns,base.loss??0,base.profit??0]:null,excluded:{...excluded},caseRefs,moves:allMoves.length,bf,obs:ordered.length};
 return fitBin(bin);
}
/**
 * Size guard of a bin, in UTF-8 bytes with a margin under the store cap: drop `manter` cells from the end, then move
 * cells, then case refs and steps, until it fits. A bin that fits is returned as is; it never throws.
 */
export function fitBin(bin){
 const max=observationPolicy.binSafeBytes;if(utf8Bytes(bin)<=max)return bin;
 const out={...bin,cells:arr(bin.cells)};
 while(utf8Bytes(out)>max&&out.cells.length){const cut=Math.max(1,Math.ceil(out.cells.length*0.1));out.cells=out.cells.slice(0,out.cells.length-cut);out.truncated=(out.truncated||0)+cut;}
 if(utf8Bytes(out)>max){out.caseRefs=arr(out.caseRefs).slice(0,5);out.steps={increase:arr(out.steps?.increase).slice(0,20),reduce:arr(out.steps?.reduce).slice(0,20)};}
 if(utf8Bytes(out)>max){out.caseRefs=[];out.y={};}
 return out;
}

/**
 * A bin's cells as named objects, with the person id resolved. A caller that reads the same bins many times in one call
 * may decode them once (`decodeBins`); the decoded list lives only on that in-memory object and is never stored.
 */
export function binCells(bin){
 if(Array.isArray(bin?.[decoded]))return bin[decoded];
 const cols=arr(bin?.cols),persons=arr(bin?.persons);
 return arr(bin?.cells).map(r=>{const o=obsRow(cols,r);o.person=finite(o.person)?persons[o.person]??null:o.person;o.day=bin.day;return o;});
}
const decoded=Symbol('decodedCells');
/**
 * Streams the cells of one bin without decoding them: `fn` gets one reused view object per cell (named fields, person
 * resolved, `day`), valid only during that call, so a caller copies what it keeps. Returning false stops the scan.
 * Fitting and replay read bins through this (one bin at a time), so a pass never holds every decoded cell.
 */
export function scanCells(bin,fn){
 const cols=arr(bin?.cols),persons=arr(bin?.persons),n=cols.length,view={};
 for(const r of arr(bin?.cells)){
  for(let i=0;i<n;i++)view[cols[i]]=r?.[i]??null;
  const p=view.person;view.person=finite(p)?persons[p]??null:p;view.day=bin.day;
  if(fn(view)===false)return;
 }
}
/** Decodes the cells of each bin once (a Symbol property: never serialized, never written back). */
export function decodeBins(bins){for(const b of arr(bins))if(b&&typeof b==='object'&&!b[decoded])Object.defineProperty(b,decoded,{value:binCells(b),enumerable:false,configurable:true});return bins;}
