/**
 * Modo Gestor (W3) test fixtures. Synthetic only: invented people (Ana Souza, Bruno Lima, Carla Dias), projects,
 * accounts, campaigns and amounts. Hashed people ids come from invented Malva keys; nothing here is operational data.
 */
import {obsColumns,labelObservation,foldDay,obsKey,campId} from '../../lib/team-observations.mjs';
import {shortId} from '../../lib/learning-math.mjs';
import {personId} from '../../lib/team-learning.mjs';

export const TZ='America/Sao_Paulo';
export const iso=ms=>new Date(ms).toISOString();
/** São Paulo local day D starts at 03:00Z. */
export const dayStart=d=>Date.parse(d+'T03:00:00.000Z');
export const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const people={ana:{key:'malva:fake-ana',name:'Ana Souza'},bruno:{key:'malva:fake-bruno',name:'Bruno Lima'},carla:{key:'malva:fake-carla',name:'Carla Dias'}};
export const pid=who=>personId({who:'team',name:people[who].name,key:people[who].key});

/** In-memory Durable Object storage: sorted keys, prefix/start/startAfter/end/limit listings, Map results. */
export function memoryStorage(initial={}){
 const m=new Map(Object.entries(initial));const calls={get:0,put:0,delete:0,list:0,listed:0};
 const clone=v=>v===undefined?undefined:structuredClone(v);
 return {map:m,calls,
  async get(k){calls.get++;if(Array.isArray(k)){const out=new Map();for(const x of k)if(m.has(x))out.set(x,clone(m.get(x)));return out;}return clone(m.get(k));},
  async put(a,b){calls.put++;if(typeof a==='string'){m.set(a,clone(b));return;}for(const [k,v] of Object.entries(a))m.set(k,clone(v));},
  async delete(k){calls.delete++;for(const x of Array.isArray(k)?k:[k])m.delete(x);},
  async list({prefix='',start,startAfter,end,limit}={}){calls.list++;const keys=[...m.keys()].filter(k=>k.startsWith(prefix)&&(start===undefined||k>=start)&&(startAfter===undefined||k>startAfter)&&(end===undefined||k<end)).sort();
   const out=new Map();for(const k of keys.slice(0,limit??keys.length))out.set(k,clone(m.get(k)));calls.listed+=out.size;return out;},
  async transaction(){throw Error('no transactions in tests');},async deleteAll(){throw Error('never');},async setAlarm(){throw Error('never');}};
}

/** Deterministic PRNG. */
export function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}

/**
 * Synthetic days of one project, built through the real pipeline (observation rows → labelObservation → foldDay):
 * - Ana pauses a new test campaign with no sale once it crosses `testPauseTickets` tickets (test-pause);
 * - Bruno cuts 20% of a mature campaign after 14h when today's ROI is below 0.8 and 3 days were ≥ 1.2 (bad-day-cut);
 * - Carla (optional) raises the same cells Bruno cuts (divergence).
 * Readings every hour 08–22; moves 20 min after the reading that crossed the line.
 * @returns {{bins:any[],observations:any[],moves:any[]}}
 */
export function syntheticDays({project='proj-1',from='2026-10-01',days=30,campaigns=10,ticket=100,testPauseTickets=2,seed=7,withCarla=false,withBruno=true,withAna=true,noMovesAfter=null,pauseJitter=0,brunoFromHour=14,brunoCutsWinners=false}={}){
 const r=rng(seed),bins=[],allObs=[],allMoves=[];
 for(let di=0;di<days;di++){
  const day=shift(from,di),moves=[],observations=[],paused=new Set(),cut=new Set();
  // Each day: some fresh tests (first-day) and some mature campaigns with a good 3-day history.
  const camps=Array.from({length:campaigns},(_,i)=>{const test=i<campaigns/2;return {i,acct:'acc-1',obj:`${project}-d${di}-c${i}`,test,stage:test?'first-day':'mature',roi3:test?null:1.2+r()*0.8,cur:'BRL',budget:test?100:400,slope:0.3+r()*0.9,roiBase:test?0:0.3+r()*1.4,pauseAt:testPauseTickets*(pauseJitter?Math.max(0.25,1+(r()-0.5)*2*pauseJitter):1)};});
  for(let h=8;h<=22;h++){
   const at=dayStart(day)+h*3600000,rows=[];
   for(const c of camps){
    if(paused.has(c.obj))continue;
    const spend=Math.round(c.slope*ticket*(h-7)*100)/100,front=c.test?0:Math.floor(c.roiBase*2),roiT=c.test?(spend>0?-1:null):Math.round((c.roiBase+(r()-0.5)*0.1)*1000)/1000;
    const o={acct:c.acct,obj:c.obj,name:(c.test?'[TESTE] ':'')+c.obj,stage:c.stage,test:c.test,hour:h,minute:h*60,spend,ticket,front,orders:front,ic:c.test?0:2,roiT,roiY:c.test?null:1.1,frontY:c.test?null:2,resY:c.test?null:Math.round((r()-0.4)*200),spendY:c.test?null:300,roi3:c.roi3,roi7:c.roi3,roiS:c.test?roiT:null,
     budget:c.budget,cur:c.cur,capShare:null,raised:false,cut:cut.has(c.obj)?true:false,sinceEdit:null,pd:false,numAge:5,label:null,person:null,step:null,mv:null,lead:null};
    rows.push(obsColumns.map(k=>o[k]));
    const crossed=withAna&&c.test&&spend>=c.pauseAt*ticket&&!paused.has(c.obj);
    const bad=withBruno&&!(withCarla&&c.i%2===1)&&!c.test&&h>=brunoFromHour&&(brunoCutsWinners?roiT>=1.3:roiT<0.8)&&c.roi3>=1.2&&!cut.has(c.obj);
    const late=noMovesAfter&&day>noMovesAfter;
    if(crossed&&!late){paused.add(c.obj);moves.push(move('ana','pause',c,at+20*60000,day,project,null));}
    if(bad&&!late){cut.add(c.obj);moves.push(move('bruno','reduce',c,at+20*60000,day,project,-0.2));}
    if(withCarla&&c.i%2===1&&!c.test&&h>=14&&roiT<0.8&&c.roi3>=1.2&&!late&&!cut.has(c.obj)){cut.add(c.obj);moves.push(move('carla','increase',c,at+20*60000,day,project,0.3));}
   }
   observations.push({v:1,at:iso(at),day,project,timezone:TZ,hour:h,cut:{kind:'analysis',fetchedAt:iso(at),lastSyncAt:iso(at)},cols:[...obsColumns],rows});
  }
  const labeled=observations.map(o=>labelObservation(o,moves,{now:Date.parse(o.at)+3*3600000})||o);
  const bin=foldDay({day,project,observations:labeled,moves,base:{campaigns:campaigns,loss:Math.round(campaigns*0.4),profit:Math.round(campaigns*0.5)},excluded:{},now:dayStart(shift(day,1))+2*3600000});
  bins.push(bin);allObs.push(...labeled);allMoves.push(...moves);
 }
 return {bins,observations:allObs,moves:allMoves};
}
function move(who,kind,c,at,day,project,step){
 const p=people[who];
 return {id:shortId(['mv-fixture',who,c.obj,kind,at]),v:1,day,project,who:'team',name:p.name,person:pid(who),role:'team',kind,at:iso(at),adAccountId:c.acct,objectId:c.obj,
  minute:Math.round(((at-dayStart(day))/60000)),budget:step===null?null:{before:c.budget,after:Math.round(c.budget*(1+step)*100)/100,step,currency:'BRL'},ctx:{},shadow:null,guard:null,grade:null,camp:campId(c.acct,c.obj)};
}
export {obsKey};
