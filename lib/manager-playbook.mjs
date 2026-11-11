/**
 * Modo Gestor (W3), the playbook: fixed play templates whose thresholds and steps are fitted to what the people did
 * (spec §3.3), and the Sombra-shaped decisions they would take now (§3.4). Deterministic and pure: the same bins give the
 * same plays, bit for bit (a seeded PRNG for the bootstrap, stable sorts, no Date.now()).
 *
 * Phase 1 (zero execution risk): a play is only observed. Its decisions are stored apart (`pbs:*`), always with
 * `wouldExecute:false`, and never reach the autonomy grant, a proposal, an order or a dispatch. Stages stop at
 * `candidata`: adopting (`sombra`) and releasing (`pode-enviar`) are owner taps of later phases.
 * Learning is association, never causality: a play imitates the team; the outcome filter only says whether imitating
 * paid, compared with picking any campaign that day.
 */
import {shortId,wilson} from './learning-math.mjs';
import {scanCells,cellOf,hourSlot,campaignFeatures,labelKinds} from './team-observations.mjs';
import {projectReading,activeSalesRow,recentOtherEdit} from './campaign-context.mjs';

export const playbookPolicy=Object.freeze({version:1,windowDays:60,halfLifeDays:21,dormantDays:14,minMoves:8,minCampaigns:4,minDays:3,minPersonMoves:8,
 maxSpread:0.25,bootstrap:50,bootstrapExamples:300,maxExamples:1500,maxPositives:500,hourCautionGain:0.1,shrinkWeight:10,stepRound:0.05,
 divergenceMin:3,minOutcome:5,winnerCutRoi:1.2,winnerCutShare:0.2,maxPlaysPerProject:12,maxCaseRefs:5,sentenceMax:140,
 // Streaming bounds of one example set: positives kept before the final cut, negatives' bottom-k buffer.
 posBuffer:4000,negBuffer:2250});

const arr=v=>Array.isArray(v)?v:[],finite=Number.isFinite,time=v=>Date.parse(v||'');
const r2=n=>finite(n)?Math.round(n*100)/100:null,r3=n=>finite(n)?Math.round(n*1000)/1000:null;
const dayIndex=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
const shiftDay=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const roundTo=(x,res)=>finite(x)?Math.round(x/res)*res:null;
const num=(x,d=2)=>finite(x)?(Math.round(x*10**d)/10**d).toLocaleString('pt-BR',{maximumFractionDigits:d}):'N/D';
const pct=x=>finite(x)?Math.round(Math.abs(x)*100):null;

const cutKinds=new Set(['pause','reduce']),raiseKinds=new Set(['increase','activate']);
const young=new Set(['young','mature']),fresh=new Set(['first-day','second-day']);
/**
 * Play templates (spec §3.3). `fixed`: what must hold for the play to look at a campaign at all (an N/D value never
 * holds). `params`: fitted thresholds, each a condition on one quantized cell feature (lib/team-observations.mjs cellOf).
 * `hour:true` params are subject to the hour caution. `scale`: the size a bootstrap spread is measured against.
 */
export const playTemplates=Object.freeze([
 {id:'pb:test-pause',kind:'pause',step:false,fixed:c=>(fresh.has(c.stage)||c.test===1)&&c.front===0,
  params:[{name:'k',feature:'spendT',op:'>=',res:0.25,scale:1}]},
 {id:'pb:young-loss-pause',kind:'pause',step:false,fixed:c=>c.stage==='young'&&finite(c.front)&&c.front>=1,
  params:[{name:'r',feature:'roiS',op:'<',res:0.05,scale:0.5},{name:'k',feature:'spendT',op:'>=',res:0.25,scale:1}]},
 {id:'pb:bad-day-cut',kind:'reduce',step:true,fixed:c=>young.has(c.stage)&&c.cut===0,
  params:[{name:'h',feature:'hour',op:'>=',res:1,scale:4,hour:true},{name:'r',feature:'roiT',op:'<',res:0.05,scale:0.5},{name:'k',feature:'spendT',op:'>=',res:0.25,scale:1},{name:'r3',feature:'roi3',op:'>=',res:0.05,scale:0.5}]},
 {id:'pb:mature-loss-pause',kind:'pause',step:false,fixed:c=>c.stage==='mature',
  params:[{name:'r3',feature:'roi3',op:'<',res:0.05,scale:0.5},{name:'r',feature:'roiT',op:'<',res:0.05,scale:0.5},{name:'h',feature:'hour',op:'>=',res:1,scale:4,hour:true}]},
 {id:'pb:morning-batch-raise',kind:'increase',step:true,fixed:c=>c.stage!==null&&c.stage!==undefined&&c.raised===0,
  params:[{name:'h1',feature:'hour',op:'>=',res:1,scale:4,hour:true},{name:'h2',feature:'hour',op:'<=',res:1,scale:4,hour:true},{name:'r1',feature:'roiT',op:'>=',res:0.05,scale:0.5},{name:'f',feature:'front',op:'>=',res:1,scale:1},{name:'r3',feature:'roi3',op:'>=',res:0.05,scale:0.5}]},
 {id:'pb:night-raise',kind:'increase',step:true,fixed:c=>c.slot==='00-0030'&&c.raised===0,
  params:[{name:'r',feature:'roiY',op:'>=',res:0.05,scale:0.5},{name:'f',feature:'frontY',op:'>=',res:1,scale:1}]},
]);
export const templateOf=id=>playTemplates.find(t=>t.id===id)||null;

/** Deterministic PRNG (mulberry32) seeded from a string. */
function prng(seed){let a=parseInt(shortId(['seed',seed]).slice(-8),36)>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const quantile=(list,q)=>{const s=list.filter(finite).sort((a,b)=>a-b);if(!s.length)return null;const i=(s.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);};
/** Weighted quantile of [value, weight] pairs. */
function wQuantile(pairs,q){const s=pairs.filter(([v,w])=>finite(v)&&w>0).sort((a,b)=>a[0]-b[0]);if(!s.length)return null;const total=s.reduce((x,[,w])=>x+w,0);let acc=0;for(const [v,w] of s){acc+=w;if(acc>=q*total-1e-12)return v;}return s[s.length-1][0];}
/** A condition on one value: an N/D value never holds; a generalized (null) threshold always holds for a known value. */
export function holds(op,x,theta){
 if(x===null||x===undefined||!finite(Number(x)))return false;if(theta===null||theta===undefined)return true;
 return op==='>='?x>=theta:op==='<'?x<theta:x<=theta;
}
/** Whether a play (template + params) fires on one cell. */
export function matchPlay(template,params,cell){
 if(!template||!cell)return false;let fixed=false;try{fixed=template.fixed(cell)===true;}catch{fixed=false;}if(!fixed)return false;
 for(const p of template.params)if(!holds(p.op,cell[p.feature],params?.[p.name]??null))return false;
 return true;
}

const posOrder=(a,b)=>a.age-b.age||String(a.mv).localeCompare(String(b.mv))||String(a.camp).localeCompare(String(b.camp));
const negOrder=(a,b)=>a.k<b.k?-1:a.k>b.k?1:0;
/**
 * Streaming examples of one template (fitting reads bins only, never raw observations): bins are added one at a time, in
 * day order, and only the cells that pass the template's fixed conditions are kept, as compact examples. Positives are
 * the cells of a person's move of the template's kind (one move weighs 1 even when two readings preceded it), negatives
 * the `manter` cells and the other kinds of move; everything weighted by recency (half-life 21 days, 60-day window).
 * Negatives are bounded by a deterministic bottom-k of a hash (the same sample as sorting them all), whose kept weight
 * stands for all of them. `finish({person})` limits positives to one person (other people's moves of the same kind are
 * left out of that fit). Days before `fitDay` only.
 * @param {any} template @param {{fitDay:string,maxExamples?:number}} options
 */
export function exampleAccumulator(template,{fitDay,maxExamples=playbookPolicy.maxExamples}){
 const P=playbookPolicy,fi=dayIndex(fitDay),K=maxExamples,perMove=new Map(),keep=Math.max(P.posBuffer,P.maxPositives);
 let pos=[],negList=[],negKeyed=null,negIndex=0,negTotal=0;
 const keyOf=(e,i)=>shortId(['neg',e.day,e.camp,e.v])+':'+i;
 const pushNeg=e=>{
  const i=negIndex++;negTotal+=e.w;
  if(!negKeyed){negList.push(e);if(negList.length>K){negKeyed=negList.map((x,j)=>({e:x,k:keyOf(x,j)}));negList=null;}return;}
  negKeyed.push({e,k:keyOf(e,i)});
  if(negKeyed.length>Math.max(P.negBuffer,K)+K){negKeyed.sort(negOrder);negKeyed.length=K;}
 };
 return {
  add(b){
   if(!b?.day)return;const age=fi-dayIndex(b.day);if(!(age>=1&&age<=P.windowDays))return;
   const decay=0.5**(age/P.halfLifeDays),project=b.project;
   scanCells(b,c=>{
    let ok=false;try{ok=template.fixed(c)===true;}catch{ok=false;}if(!ok)return;
    const isPos=c.label===template.kind;
    if(!isPos&&c.label!=='manter'&&!labelKinds.includes(c.label))return;
    const e={v:template.params.map(p=>c[p.feature]??null),pos:isPos,w:isPos?decay:decay*(finite(c.n)?c.n:1),day:c.day,project,camp:c.camp,mv:c.mv||null,person:c.person||null,step:finite(c.step)?c.step:null,roiT:c.roiT,stage:c.stage,slot:c.slot,label:c.label,age};
    if(isPos){if(c.mv)perMove.set(c.mv,(perMove.get(c.mv)||0)+1);pos.push(e);if(pos.length>2*keep){pos.sort(posOrder);pos.length=keep;}}
    else pushNeg(e);
   });
  },
  finish({person=null}={}){
   let p=pos.filter(e=>!person||e.person===person).map(e=>({...e,w:e.w/(e.mv?perMove.get(e.mv)||1:1)}));
   p.sort(posOrder);p=p.slice(0,P.maxPositives);
   const room=Math.max(0,K-p.length);let neg;
   if(negIndex<=room)neg=negList?[...negList]:negKeyed.map(x=>x.e);
   else{const keyed=negKeyed||negList.map((x,j)=>({e:x,k:keyOf(x,j)}));keyed.sort(negOrder);neg=keyed.slice(0,room).map(x=>x.e);const kept=neg.reduce((a,e)=>a+e.w,0);if(kept>0)neg=neg.map(e=>({...e,w:e.w*negTotal/kept}));}
   const ex=[...p,...neg],moves=new Set(p.map(e=>e.mv||(e.day+':'+e.camp))),campaigns=new Set(p.map(e=>e.camp)),days=new Set(p.map(e=>e.day));
   return {ex,moves:moves.size,campaigns:campaigns.size,days:days.size,lastPosAge:p.length?Math.min(...p.map(e=>e.age)):null};
  },
 };
}
/**
 * Examples of one template from daily bins (see exampleAccumulator): the bins are sorted by day and project first.
 * @param {any[]} bins @param {any} template @param {{fitDay:string,person?:string|null,maxExamples?:number}} options
 */
export function examplesFromBins(bins,template,{fitDay,person=null,maxExamples=playbookPolicy.maxExamples}){
 const acc=exampleAccumulator(template,{fitDay,maxExamples});
 for(const b of [...arr(bins)].sort((a,c)=>String(a?.day).localeCompare(String(c?.day))||String(a?.project).localeCompare(String(c?.project))))acc.add(b);
 return acc.finish({person});
}

/**
 * Sorted sweep of one parameter: best threshold by F1 (ties: higher precision, then fires less). A threshold that adds
 * less than half a point of F1 over the most permissive candidate is not informative: the permissive one is kept (stable
 * under resampling; the play then rests on its other conditions).
 */
function sweep(template,i,ex,theta,weights,counter){return evalSweep(prepareSweep(template,i,ex,theta,counter),ex,weights,counter);}
/** The part of a sweep that does not depend on the weights: who passes the other conditions, sorted, and the candidates. */
function prepareSweep(template,i,ex,theta,counter){
 const p=template.params[i],others=[];
 for(let j=0;j<ex.length;j++){let ok=true;for(let k=0;k<template.params.length;k++){if(k===i)continue;const q=template.params[k];if(!holds(q.op,ex[j].v[k],theta[k])){ok=false;break;}}if(ok)others.push(j);}
 counter.n+=ex.length;
 const posVals=others.filter(j=>ex[j].pos&&finite(ex[j].v[i])).map(j=>ex[j].v[i]);
 const qs=[0.05,0.15,0.25,0.35,0.45,0.55,0.65,0.75,0.85,0.95].map(q=>quantile(posVals,q)).filter(finite).map(x=>roundTo(p.op==='<'?x+p.res:x,p.res));
 const cand=[...new Set(qs.map(x=>r3(x)))].sort((a,b)=>a-b);
 const sorted=others.filter(j=>finite(ex[j].v[i])).sort((a,b)=>ex[a].v[i]-ex[b].v[i]||a-b);
 return {p,cand,sorted,xs:sorted.map(j=>ex[j].v[i]),current:theta[i]};
}
/** Best threshold for given weights, by cumulative sums over the prepared order (O(N + C log N)). */
function evalSweep(prep,ex,weights,counter){
 const {p,cand,sorted,xs}=prep;
 let totalPos=0;for(let j=0;j<ex.length;j++)if(ex[j].pos)totalPos+=weights[j];
 counter.n+=sorted.length;
 if(!cand.length||!sorted.length)return {theta:prep.current,f1:null,tp:0,fp:0,totalPos};
 const cp=[0],cn=[0];for(const j of sorted){cp.push(cp[cp.length-1]+(ex[j].pos?weights[j]:0));cn.push(cn[cn.length-1]+(ex[j].pos?0:weights[j]));}
 const N=sorted.length,lower=t=>{let lo=0,hi=N;while(lo<hi){const m=(lo+hi)>>1;if(xs[m]<t)lo=m+1;else hi=m;}return lo;},upper=t=>{let lo=0,hi=N;while(lo<hi){const m=(lo+hi)>>1;if(xs[m]<=t)lo=m+1;else hi=m;}return lo;};
 let best=null,loose=null;
 for(const t of cand){
  let tp,fp;
  if(p.op==='>='){const a=lower(t);tp=cp[N]-cp[a];fp=cn[N]-cn[a];}else if(p.op==='<'){const a=lower(t);tp=cp[a];fp=cn[a];}else{const a=upper(t);tp=cp[a];fp=cn[a];}
  const f1=totalPos>0?2*tp/(tp+fp+totalPos):0,prec=tp+fp>0?tp/(tp+fp):0;
  const firesLess=best&&(p.op==='>='?t>best.theta:t<best.theta),isLoose=p.op==='>='?t===cand[0]:t===cand[cand.length-1];
  if(isLoose)loose={theta:t,f1,prec,tp,fp};
  if(!best||f1>best.f1+1e-12||Math.abs(f1-best.f1)<=1e-12&&(prec>best.prec+1e-12||Math.abs(prec-best.prec)<=1e-12&&firesLess))best={theta:t,f1,prec,tp,fp};
 }
 if(loose&&best&&best.f1-loose.f1<0.005)best=loose;
 return {...best,totalPos};
}
/** Agreement of a set of thresholds over the examples: F1, precision and recall (weighted). */
export function scoreParams(template,ex,theta,weights=null){
 let tp=0,fp=0,totalPos=0;
 for(let j=0;j<ex.length;j++){const w=weights?weights[j]:ex[j].w;if(ex[j].pos)totalPos+=w;if(template.params.every((p,k)=>holds(p.op,ex[j].v[k],theta[k]))){if(ex[j].pos)tp+=w;else fp+=w;}}
 return {f1:totalPos>0?2*tp/(tp+fp+totalPos):0,precision:tp+fp>0?tp/(tp+fp):null,recall:totalPos>0?tp/totalPos:null,tp,fp,totalPos};
}
/** Coordinate ascent from the most permissive thresholds (2 sweeps). `skip`: generalized params (no condition). */
function ascend(template,ex,weights,counter,{skip=new Set(),sweeps=2,start=null}={}){
 const theta=start?[...start]:template.params.map(()=>null);
 for(let s=0;s<sweeps;s++)for(let i=0;i<template.params.length;i++){if(skip.has(i)){theta[i]=null;continue;}const r=sweep(template,i,ex,theta,weights,counter);if(r.theta!==undefined)theta[i]=r.theta??null;}
 return theta;
}

/**
 * Fits one template on one example set (deterministic): thresholds by agreement F1 (moves vs `manter`), the hour
 * caution, bootstrap stability (50 seeded resamples of ≤300 examples, each threshold re-swept with the others fixed),
 * and the people's step (weighted median of the fitted positives, rounded to 5 pp, with p25–p75).
 * @param {any} template @param {{ex:any[]}} set @param {{seed:string,counter?:{n:number},bootstrap?:boolean}} options
 */
export function fitTemplate(template,set,{seed,counter={n:0},bootstrap=true,extraSteps=[]}){
 const P=playbookPolicy,ex=arr(set?.ex),w=ex.map(e=>e.w);
 let theta=ascend(template,ex,w,counter);let score=scoreParams(template,ex,theta);
 // Hour caution (spec §3.3): an hour window stays only when dropping it costs ≥ 10 pp of agreement.
 const hourIdx=template.params.map((p,i)=>p.hour?i:-1).filter(i=>i>=0),generalized=[];
 if(hourIdx.length){const loose=theta.map((t,i)=>hourIdx.includes(i)?null:t),looseScore=scoreParams(template,ex,loose);
  if(score.f1-looseScore.f1<P.hourCautionGain){const skip=new Set(hourIdx);theta=ascend(template,ex,w,counter,{skip,sweeps:1,start:loose});score=scoreParams(template,ex,theta);for(const i of hourIdx)generalized.push(template.params[i].name);}}
 // Bootstrap: spread (p90 − p10) of each fitted threshold relative to its scale.
 const spread={},range={};let stable=true;
 if(bootstrap&&ex.length){
  const rnd=prng(seed),pick=ex.length>P.bootstrapExamples?[...ex.keys()].sort((a,b)=>shortId([seed,a])<shortId([seed,b])?-1:1).slice(0,P.bootstrapExamples).sort((a,b)=>a-b):[...ex.keys()];
  const sub=pick.map(j=>ex[j]),draws=template.params.map(()=>[]);
  // Each threshold is re-swept with the others fixed at the fit: who passes them does not change between resamples.
  const preps=template.params.map((p,i)=>generalized.includes(p.name)?null:prepareSweep(template,i,sub,theta,counter));
  for(let b=0;b<P.bootstrap;b++){
   const counts=new Array(sub.length).fill(0);for(let k=0;k<sub.length;k++)counts[Math.floor(rnd()*sub.length)]++;
   const bw=sub.map((e,j)=>e.w*counts[j]);
   for(let i=0;i<template.params.length;i++){if(!preps[i])continue;const r=evalSweep(preps[i],sub,bw,counter);if(finite(r.theta))draws[i].push(r.theta);}
  }
  template.params.forEach((p,i)=>{if(generalized.includes(p.name))return;const d=draws[i],med=quantile(d,0.5),lo=quantile(d,0.1),hi=quantile(d,0.9);
   range[p.name]=[r3(lo),r3(hi)];const s=finite(med)&&finite(lo)&&finite(hi)?(hi-lo)/Math.max(Math.abs(med),p.scale):null;spread[p.name]=r3(s);if(s===null||s>P.maxSpread)stable=false;});
 }
 const fired=ex.filter(e=>e.pos&&template.params.every((p,k)=>holds(p.op,e.v[k],theta[k])));
 let step=null;
 // The step: the fitted positives' own steps, plus the backfilled moves' steps of the same kind (owner Q11: the 30-day
 // Malva history teaches how big the team's steps are, never when; their intraday numbers are N/D).
 if(template.step){const pairs=[...(fired.length?fired:ex.filter(e=>e.pos)).filter(e=>finite(e.step)).map(e=>[e.step,e.w]),...arr(extraSteps).filter(([v,w])=>finite(v)&&w>0)];
  const med=wQuantile(pairs,0.5);step=finite(med)?{median:r3(roundTo(med,P.stepRound)),p25:r3(wQuantile(pairs,0.25)),p75:r3(wQuantile(pairs,0.75))}:null;}
 return {theta:theta.map(x=>finite(x)?r3(x):null),generalized,score:{f1:r3(score.f1),precision:r3(score.precision),recall:r3(score.recall)},spread,range,stable:bootstrap?stable:null,step,fired:fired.length};
}
const paramsObj=(template,theta)=>Object.fromEntries(template.params.map((p,i)=>[p.name,finite(theta?.[i])?theta[i]:null]));
const thetaOf=(template,params)=>template.params.map(p=>finite(params?.[p.name])?params[p.name]:null);

const stageLabels={'first-day':'1º dia','second-day':'2º dia',young:'3º–4º dia',mature:'madura'};
const slotLabel=s=>s?s.replace(/^00-0030$/,'00h–00h30').replace(/^0030-09$/,'00h30–9h').replace(/^(\d\d)-(\d\d)$/,(_,a,b)=>`${Number(a)}h–${Number(b)}h`):'horário N/D';
/** ROI bucket of a cell (divergence cells and case texts). */
export function roiBucket(x){if(!finite(x))return null;return x<0.5?'<0,5':x<0.8?'0,5-0,8':x<1?'0,8-1':x<1.2?'1-1,2':x<1.5?'1,2-1,5':x<2?'1,5-2':x<3?'2-3':'3+';}
/**
 * Divergence (spec §3.3): in the same cell (stage × hour slot × today's ROI bucket), one person mostly raises and another
 * mostly cuts, with ≥3 cases each. No play is emitted on such a cell: it is shown as a Divergência card. Streaming:
 * `add(bin)` one at a time keeps only the move ids per cell and person.
 */
export function divergenceAccumulator({fitDay}){
 const fi=dayIndex(fitDay),cells=new Map(),P=playbookPolicy;
 return {
  add(b){const age=fi-dayIndex(b?.day);if(!(age>=1&&age<=P.windowDays))return;
   scanCells(b,c=>{if(!labelKinds.includes(c.label)||!c.person)return;const key=JSON.stringify([c.stage??null,c.slot??null,roiBucket(c.roiT)]);
    if(!cells.has(key))cells.set(key,new Map());const m=cells.get(key);if(!m.has(c.person))m.set(c.person,{up:new Set(),down:new Set()});
    (raiseKinds.has(c.label)?m.get(c.person).up:m.get(c.person).down).add(c.mv||(c.day+':'+c.camp));});},
  finish({names={}}={}){
   const out=[];
   for(const [key,m] of [...cells].sort(([a],[b])=>a.localeCompare(b))){
    const ups=[...m].filter(([,x])=>x.up.size>=P.divergenceMin&&x.up.size>x.down.size),downs=[...m].filter(([,x])=>x.down.size>=P.divergenceMin&&x.down.size>x.up.size);
    for(const [pu,u] of ups)for(const [pd,d] of downs){if(pu===pd)continue;const [stage,slot,roi]=JSON.parse(key);
     out.push({id:shortId(['div',key,pu,pd]),cell:{stage,hourSlot:slot,roiBucket:roi},people:[{person:pu,name:names[pu]||'Pessoa da equipe',kind:'increase',n:u.up.size},{person:pd,name:names[pd]||'Pessoa da equipe',kind:'cut',n:d.down.size}],
      text:`Divergência: no mesmo cenário (${stageLabels[stage]||'estágio N/D'}, ${slotLabel(slot)}, ROI de hoje ${roi||'N/D'}), ${names[pu]||'uma pessoa'} costuma aumentar (${u.up.size}) e ${names[pd]||'outra'} costuma cortar (${d.down.size}). O Bunk não aprende uma jogada aqui.`.slice(0,240)});}
   }
   return out.slice(0,10);
  },
 };
}
export function divergences(bins,{fitDay,names={}}={}){const a=divergenceAccumulator({fitDay});for(const b of arr(bins))a.add(b);return a.finish({names});}

/**
 * Everything one fitting or replay pass needs from a project's bins, built one bin at a time (the runner streams them
 * from storage in small chunks and drops each chunk): the examples of each template, the divergences, the case refs,
 * the closed results and bases (outcome), the people's names and the backfilled steps. Add bins in day order.
 * @param {{fitDay:string,templates?:any[],divergence?:boolean,outcome?:boolean}} options
 */
export function playCorpus({fitDay,templates=playTemplates,divergence=true,outcome=true}){
 const P=playbookPolicy,fi=dayIndex(fitDay),accs=new Map(templates.map(t=>[t.id,exampleAccumulator(t,{fitDay})])),div=divergence?divergenceAccumulator({fitDay}):null;
 const refs=new Map(),index=new Map(),names={},bfSteps={increase:[],reduce:[]};let bins=0;
 const refOrder=(a,b)=>time(b.at)-time(a.at)||String(a.objectId).localeCompare(String(b.objectId));
 return {fitDay,
  add(b){
   if(!b?.day)return;bins++;
   for(const a of accs.values())a.add(b);if(div)div.add(b);
   if(outcome)index.set(b.project+'|'+b.day,{y:b.y||{},base:b.base||null});
   for(const [pid,x] of Object.entries(b.people||{}))if(!names[pid]&&x?.name)names[pid]=x.name;
   if(b.day<fitDay){
    for(const c of arr(b.caseRefs)){if(!c?.kind)continue;if(!refs.has(c.kind))refs.set(c.kind,[]);const l=refs.get(c.kind);l.push(c);if(l.length>50){l.sort(refOrder);l.length=P.maxCaseRefs;}}
    const age=fi-dayIndex(b.day);
    if(age>=1&&age<=P.windowDays)for(const k of ['increase','reduce'])for(const st of arr(b.steps?.[k]))if(Array.isArray(st)&&st[2]===1&&finite(st[0]))bfSteps[k].push({step:st[0],w:0.5**(age/P.halfLifeDays),minute:finite(st[3])?st[3]:null});
   }
  },
  examples(tid,{person=null}={}){return accs.get(tid)?.finish({person})||{ex:[],moves:0,campaigns:0,days:0,lastPosAge:null};},
  divergences({names:n=names}={}){return div?div.finish({names:n}):[];},
  caseRefs(kind){return [...(refs.get(kind)||[])].sort(refOrder).slice(0,P.maxCaseRefs);},
  /** Backfilled steps of a template's kind, as [step, weight] (the night raise only those made 00:00–00:30). */
  extraSteps(template){if(!template?.step)return [];const night=template.id==='pb:night-raise';
   return arr(bfSteps[template.kind]).filter(x=>night?x.minute!==null&&x.minute<30:x.minute===null||x.minute>=30).map(x=>[x.step,x.w]);},
  outcomeIndex:index,personNames:names,get bins(){return bins;}};
}

/**
 * Outcome of the fitted positives (spec §3.3, "imitação sem ganho"): the D+1 (and D+3) closed result of each matched
 * case, read from later bins (`y`: the closed yesterday of each campaign seen that day), against the day's base
 * (share of campaigns that lost / made money). A cut play is right when it lost, a raise when it made money.
 */
export function playOutcome(template,set,theta,bins){
 // `bins`: the bins, or a playCorpus outcome index (project|day → {y, base}).
 const byDay=bins instanceof Map?bins:new Map(arr(bins).map(b=>[b.project+'|'+b.day,b])),cut=cutKinds.has(template.kind);
 const res=(project,day,camp)=>{const v=byDay.get(project+'|'+day)?.y?.[camp];return v&&finite(v[1])?v[1]:null;};
 const seen=new Set();let n1=0,k1=0,n3=0,k3=0,bs=0,bn=0,winners=0,fired=0;
 for(const e of arr(set?.ex)){
  if(!e.pos||!template.params.every((p,k)=>holds(p.op,e.v[k],theta[k])))continue;
  const id=e.mv||(e.day+':'+e.camp);if(seen.has(id))continue;seen.add(id);fired++;
  if(cut&&finite(e.roiT)&&e.roiT>=playbookPolicy.winnerCutRoi)winners++;
  const d1=res(e.project,shiftDay(e.day,2),e.camp);
  if(d1!==null){n1++;if(cut?d1<0:d1>0)k1++;const b=byDay.get(e.project+'|'+shiftDay(e.day,1))?.base;if(b&&b[0]>0){bs+=(cut?b[1]:b[2])/b[0];bn++;}}
  const three=[2,3,4].map(k=>res(e.project,shiftDay(e.day,k),e.camp));
  if(three.every(x=>x!==null)){n3++;const s=three.reduce((a,b)=>a+b,0);if(cut?s<0:s>0)k3++;}
 }
 const rate=(k,n)=>n?{rate:r3(k/n),n,...wilson(k,n)}:null;
 return {d1:rate(k1,n1),d3:rate(k3,n3),base:bn?r3(bs/bn):null,winnersShare:fired?r3(winners/fired):null,fired};
}

/** Stable revision of a fitted play: a hash of its params and step. */
export const playRev=(params,step)=>shortId(['rev',params,step?.median??null]).slice(-8).padStart(8,'0');

/**
 * One play fit for one project (consensus of the people, plus each person with ≥8 moves of that kind), with its stage.
 * @param {any} template @param {any[]} bins this project's bins @param {{project:string,fitDay:string,names?:Record<string,string>,counter?:{n:number},divs?:any[]}} options
 */
export function fitPlay(template,bins,{project,fitDay,names={},counter={n:0},divs=null}){
 const corpus=playCorpus({fitDay,templates:[template],divergence:!divs});
 for(const b of [...arr(bins)].sort((a,c)=>String(a?.day).localeCompare(String(c?.day))||String(a?.project).localeCompare(String(c?.project))))corpus.add(b);
 return fitPlayFrom(template,corpus,{project,fitDay,names,counter,divs});
}
/** fitPlay on a playCorpus already fed with this project's bins (the runner's streaming path). */
export function fitPlayFrom(template,corpus,{project,fitDay,names={},counter={n:0},divs=null}){
 const P=playbookPolicy,set=corpus.examples(template.id);
 const support={moves:set.moves,campaigns:set.campaigns,days:set.days,need:{moves:P.minMoves,campaigns:P.minCampaigns,days:P.minDays},missing:Math.max(0,P.minMoves-set.moves)};
 const enough=set.moves>=P.minMoves&&set.campaigns>=P.minCampaigns&&set.days>=P.minDays;
 // Cases behind the play (newest first, ≤5): the people's moves of its kind kept in the bins.
 const caseRefs=corpus.caseRefs(template.kind);
 const base={id:template.id,project,fitDay,support,flags:[],learnedFrom:[],step:null,params:paramsObj(template,null),raw:null,generalized:[],score:null,spread:{},range:{},outcome:null,stage:'observando',caseRefs};
 // Who taught it: each person's own fit only from 8+ moves of this kind; the others are counted, without params.
 const counts=new Map();for(const e of set.ex)if(e.pos&&e.person)counts.set(e.person,(counts.get(e.person)||new Set()).add(e.mv||(e.day+':'+e.camp)));
 const people=[...counts].map(([person,s])=>({person,name:person==='owner'?'Você':names[person]||'Pessoa da equipe',n:s.size,params:null})).sort((a,b)=>b.n-a.n||a.person.localeCompare(b.person));
 if(!enough)return {...base,learnedFrom:people,reason:'poucos-casos'};
 const extraSteps=corpus.extraSteps(template);
 const fit=fitTemplate(template,set,{seed:[template.id,project,fitDay].join('|'),counter,extraSteps});
 for(const p of people)if(p.n>=P.minPersonMoves){const s=corpus.examples(template.id,{person:p.person});const f=fitTemplate(template,s,{seed:[template.id,project,fitDay,p.person].join('|'),counter,bootstrap:false});p.params=paramsObj(template,f.theta);}
 const outcome=playOutcome(template,set,fit.theta,corpus.outcomeIndex),flags=[];
 if(fit.generalized.length)flags.push('horario-expediente');
 if(set.lastPosAge!==null&&set.lastPosAge>P.dormantDays)flags.push('dormindo');
 const cut=cutKinds.has(template.kind),o=outcome.d1;
 if(o&&o.n>=P.minOutcome&&finite(outcome.base)&&finite(o.high)&&o.high<outcome.base)flags.push('imitacao-sem-ganho');
 if(cut&&finite(outcome.winnersShare)&&outcome.winnersShare>P.winnerCutShare)flags.push('cortes-em-vencedoras');
 const ds=(divs||corpus.divergences({names})).filter(d=>set.ex.some(e=>e.pos&&e.stage===d.cell.stage&&e.slot===d.cell.hourSlot&&roiBucket(e.roiT)===d.cell.roiBucket));
 if(ds.length)flags.push('divergencia');
 const candidate=fit.stable===true&&!flags.includes('dormindo')&&!flags.includes('divergencia')&&finite(fit.score.precision)&&fit.score.precision>0;
 return {...base,params:paramsObj(template,fit.theta),raw:paramsObj(template,fit.theta),generalized:fit.generalized,score:fit.score,spread:fit.spread,range:fit.range,stable:fit.stable,step:fit.step,
  learnedFrom:people,outcome,flags,divergences:ds.map(d=>d.id),stage:candidate?'candidata':'observando',reason:candidate?null:fit.stable!==true?'instavel':flags.includes('divergencia')?'divergencia':flags.includes('dormindo')?'dormindo':'sem-acerto',
  stepFromBackfill:extraSteps.length};
}

/**
 * Consensus shrinkage (spec §3.3): each project's thresholds are pulled toward the cross-project pool (the other
 * projects' fits of the same play, weighted by their moves) with weight 10, then rounded to the param's resolution.
 * @param {any} template @param {any} fit this project's fit @param {any[]} others the other projects' fits of the same template
 */
export function shrinkParams(template,fit,others){
 const out={};
 for(const p of template.params){
  const own=fit?.raw?.[p.name];if(!finite(own)){out[p.name]=fit?.params?.[p.name]??null;continue;}
  const pool=arr(others).filter(o=>finite(o?.raw?.[p.name])&&o.support?.moves>0);const n=pool.reduce((s,o)=>s+o.support.moves,0);
  if(!n){out[p.name]=own;continue;}const pv=pool.reduce((s,o)=>s+o.raw[p.name]*o.support.moves,0)/n,m=fit.support.moves;
  out[p.name]=r3(roundTo((m*own+playbookPolicy.shrinkWeight*pv)/(m+playbookPolicy.shrinkWeight),p.res));
 }
 return out;
}

/**
 * Versions (spec §3.3 identity): `rev = hash(params, step)`. A refit inside the frozen version's bootstrap range keeps
 * it (its live score never resets); outside it, the new fit becomes a challenger next to the frozen one ("a equipe mudou
 * o jeito", flag `drift`). The frozen version is never replaced automatically (owner Q5: every new version waits for
 * "Atualizar", a later phase); meanwhile the challenger runs in the Sombra under its own rev and is scored apart.
 * @param {any} prev stored {current, challenger, versions} or null @param {any} fit fitPlay result (params already shrunk)
 * @param {{now:number}} options
 */
export function versionPlay(prev,fit,{now}){
 const at=new Date(now).toISOString(),rev=playRev(fit.params,fit.step),template=templateOf(fit.id);
 const make=version=>({rev:'v'+version+':'+rev,version,params:fit.params,step:fit.step,range:fit.range,generalized:fit.generalized,fitAt:at,support:fit.support});
 const versions=arr(prev?.versions);
 if(!prev?.current){const v=make(1);return {current:v,challenger:null,versions:[...versions,v].slice(-10),drift:false};}
 const cur=prev.current,inside=template.params.every(p=>{const x=fit.params[p.name],c=cur.params?.[p.name],r=cur.range?.[p.name];if(x===c)return true;if(!finite(x)||!finite(c))return x===c;return Array.isArray(r)&&finite(r[0])&&finite(r[1])&&x>=r[0]-1e-9&&x<=r[1]+1e-9;})
  &&(!fit.step||!cur.step||Math.abs((fit.step.median??0)-(cur.step.median??0))<0.1+1e-9);
 if(inside)return {current:cur,challenger:null,versions,drift:false};
 const ch=prev.challenger&&prev.challenger.rev.endsWith(':'+rev)?prev.challenger:make((Math.max(cur.version,...versions.map(v=>v.version||0)))+1);
 const nextVersions=versions.some(v=>v.rev===ch.rev)?versions:[...versions,ch].slice(-10);
 return {current:cur,challenger:ch,versions:nextVersions,drift:true};
}

/** pt-BR sentence of a play (template text only, ≤140 chars; no LLM). */
export function playSentence(id,params,step,generalized=[]){
 const g=n=>arr(generalized).includes(n),s=step?.median,P=params||{};
 const h=n=>finite(P[n])?`${P[n]}h`:'N/D';
 const t={
  'pb:test-pause':()=>`Pausar campanha nova ou teste sem venda ao passar de ${num(P.k)} tickets gastos.`,
  'pb:young-loss-pause':()=>`Pausar campanha de 3–4 dias com venda e ROI desde o início abaixo de ${num(P.r)} após ${num(P.k)} tickets.`,
  'pb:bad-day-cut':()=>`Reduzir ${pct(s)??'N/D'}%${g('h')?'':` a partir das ${h('h')}`} com ROI de hoje abaixo de ${num(P.r)}, ${num(P.k)}+ tickets e 3 dias com ROI ${num(P.r3)}+.`,
  'pb:mature-loss-pause':()=>`Pausar campanha madura com ROI de 3 dias abaixo de ${num(P.r3)} e de hoje abaixo de ${num(P.r)}${g('h')?'':` após as ${h('h')}`}.`,
  'pb:morning-batch-raise':()=>`Aumentar ${pct(s)??'N/D'}%${g('h1')&&g('h2')?'':` entre ${h('h1')} e ${h('h2')}`} com ROI de hoje ${num(P.r1)}+, ${num(P.f,0)}+ front e 3 dias com ROI ${num(P.r3)}+.`,
  'pb:night-raise':()=>`Aumentar ${pct(s)??'N/D'}% na virada do dia quando ontem fechou com ROI ${num(P.r)}+ e ${num(P.f,0)}+ front.`,
 }[id];
 return (t?t():id).slice(0,playbookPolicy.sentenceMax);
}

const limitationsOf=['Jogada aprendida com a equipe: nesta fase só observa e é avaliada; nunca envia ordem nem pede confirmação.','Associação, não causa: a jogada imita o que a equipe fez em cenários parecidos.'];
const kindAction={pause:'status',reduce:'budget',increase:'budget',activate:'status'};
/**
 * What the candidate plays of one project would do now, in the exact Sombra decision shape (lib/autonomy-shadow.mjs)
 * plus the playbook fields (contract c.9). Common blocks inherited from lib/campaign-context.mjs: the trusted today cut
 * (≤30 min), ACTIVE Meta sales only, warm-up out, the 2 h edit by someone else, the partial day for cuts and pauses.
 * An N/D feature never satisfies a condition: no decision at all. `wouldExecute` is always false (Phase 1).
 * @param {any} state read-only @param {{project:string,liveItem?:any,events?:any[],params?:any,now:number,plays:any[],fixed?:any[],limits?:any,budgetCap?:number|null}} options
 *   plays: model entries of this project (stage 'candidata' only fire); fixed: this pass's fixed-rule decisions
 */
export function evaluatePlaybook(state,{project,liveItem=null,events=[],params={},now,plays=[],fixed=[],limits=null,budgetCap=null}){
 const cfg=state?.config?.[project];if(!cfg)return {decisions:[],skipped:'Projeto não configurado.'};
 const live=arr(plays).filter(p=>p?.stage==='candidata'&&p.project===project&&templateOf(p.id));
 if(!live.length)return {decisions:[],skipped:null};
 const reading=projectReading(state,project,liveItem,now);if(!reading)return {decisions:[],skipped:'Fonte de hoje vencida ou incompleta: nada avaliado.'};
 const {today,closed,prev,timezone}=reading,decisions=[],P=playbookPolicy;
 const fixedHits=arr(fixed).filter(d=>d?.project===project);
 for(const row of today.rows){
  if(!activeSalesRow(row))continue;
  const f=campaignFeatures(state,{project,row,today,closed,prev,timezone,events,params,now,budgetCap}),cell=cellOf(f);
  const recentEdit=recentOtherEdit(events,project,row,now);
  for(const play of live){
   const template=templateOf(play.id);if(!matchPlay(template,play.params,cell))continue;
   const kind=template.kind,action=kindAction[kind];
   let before,after,learnedStep=null,clampedStep=null;const blockedBy=[];
   if(action==='status'){before={status:'ACTIVE'};after={status:kind==='pause'?'PAUSED':'ACTIVE'};}
   else{
    // A budget play needs today's daily budget (N/D or lifetime: no decision) and its currency.
    if(!finite(f.budget))continue;learnedStep=finite(play.step?.median)?play.step.median:null;if(learnedStep===null)continue;
    const max=kind==='increase'?limits?.maxIncreasePct:limits?.maxReducePct;
    clampedStep=finite(max)&&max>0?Math.sign(learnedStep)*Math.min(Math.abs(learnedStep),max/100):null;
    const step=clampedStep??learnedStep,currency=row.budgetCurrency||null;
    before={dailyBudget:row.dailyBudget,currency};after={dailyBudget:r2(row.dailyBudget*(1+step)),currency};
    if(!currency)blockedBy.push('Dado ambíguo: moeda N/D');
    if(kind==='increase'){const cap=params?.budgetCaps?.[row.adAccountId]??budgetCap??params?.budgetCap;blockedBy.push(...(finite(cap)?(after.dailyBudget>cap?[`Acima do teto do dono (${cap} ${currency||'moeda N/D'})`]:[]):['Teto de orçamento do dono não definido: aumento não executaria.']));}
   }
   if(cutKinds.has(kind)&&f.partialDay?.hold)blockedBy.push(f.partialDay.reason);
   if(recentEdit)blockedBy.push(`Edição de ${recentEdit.actor||'gestor não identificado'} há menos de 2h`);
   const t=f,sameAsRule=fixedHits.find(d=>d.adAccountId===row.adAccountId&&d.objectId===row.externalId&&decisionKind(d)===kind)?.rule||null;
   const reason=reasonOf(play,f,{learnedStep,clampedStep});
   decisions.push({project,projectName:cfg.projectName||project,adAccountId:row.adAccountId,accountName:row.accountName||null,objectId:row.externalId,malvaObjectId:typeof row.id==='string'?row.id:null,name:row.name,
    launchDay:f.stage==='first-day'?0:f.stage==='second-day'?1:null,newCampaign:null,
    metrics:{spend:t.spend,frontOrders:t.front,orders:t.orders,revenueNet:finite(row.revenueNet)?r2(row.revenueNet):null,checkouts:t.ic,roi:t.roiT,roas:null,cpc:null,recentRoi:t.roi3},
    source:'playbook',cut:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt},
    rule:play.id,ruleLabel:play.sentence||playSentence(play.id,play.params,play.step,play.generalized),action,before,after,reason,blockedBy:blockedBy.slice(0,6),limitations:[...limitationsOf],
    wouldExecute:false,alertOnly:false,ruleRev:play.rev||null,playKey:`${play.id}@${project}`,role:'challenger',versionRole:play.versionRole==='next'?'next':'current',wouldFire:blockedBy.length===0,
    learnedFrom:arr(play.learnedFrom).map(p=>({person:p.person,n:p.n})).slice(0,8),caseRefs:arr(play.caseRefs).slice(0,P.maxCaseRefs),
    play:{params:{...play.params},learnedStep,clampedStep},sameAsRule});
  }
 }
 return {decisions,source:{kind:today.kind,fetchedAt:today.fetchedAt,lastSyncAt:today.lastSyncAt}};
}
/** Kind of a Sombra-shaped decision (pause, activate, increase, reduce). */
export function decisionKind(d){if(d?.action==='status')return d.after?.status==='PAUSED'?'pause':'activate';const b=d?.before?.dailyBudget,a=d?.after?.dailyBudget;return finite(a)&&finite(b)?(a>b?'increase':'reduce'):null;}
function reasonOf(play,f,{learnedStep,clampedStep}){
 const v=play.version?`v${play.version}`:'',who=arr(play.learnedFrom).filter(p=>p.n>0).slice(0,3).map(p=>`${p.name} ${p.n}`).join(' · ');
 const nums=[`ROI de hoje ${num(f.roiT)}`,finite(f.spend)?`R$${num(f.spend,0)} gastos`:null,finite(f.spend)&&finite(f.ticket)?`${num(f.spend/f.ticket)} tickets`:null,finite(f.roi3)?`3 dias ROI ${num(f.roi3)}`:null,finite(f.roiY)?`ontem ROI ${num(f.roiY)}`:null].filter(Boolean).join(', ');
 const step=finite(learnedStep)?` Passo aprendido ${learnedStep>0?'+':'−'}${pct(learnedStep)}%${finite(clampedStep)&&clampedStep!==learnedStep?`, seu limite ${clampedStep>0?'+':'−'}${pct(clampedStep)}%`:''}.`:'';
 return `Jogada da equipe ${v}${who?` (aprendida com ${who})`:''}: ${nums}.${step}`.slice(0,300);
}

/** Hour slot exported for tests and the view. */
export {hourSlot};
