/** Small, dependency-free statistics shared by the Sombra memory and the team learning (pure). */
const finite=Number.isFinite;
const round3=x=>finite(x)?Math.round(x*1000)/1000:null;

/** Short stable id (FNV-1a based, 53 bits) so a memory shard stays small. */
export function shortId(value){
 let h1=0x811c9dc5,h2=0x01000193;const s=typeof value==='string'?value:JSON.stringify(value);
 for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,0x01000193)>>>0;h2=Math.imul(h2^c,0x5bd1e995)>>>0;}
 return ((h2&0x1fffff)*0x100000000+h1).toString(36);
}

// Regularized incomplete beta I_x(a,b) (Lanczos log-gamma + Lentz continued fraction, Numerical Recipes 6.4).
function logGamma(z){
 const g=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
 if(z<0.5)return Math.log(Math.PI/Math.sin(Math.PI*z))-logGamma(1-z);
 z-=1;let x=0.99999999999980993;for(let i=0;i<8;i++)x+=g[i]/(z+i+1);const t=z+7.5;
 return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x);
}
function betaFraction(a,b,x){
 const tiny=1e-30;let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<tiny)d=tiny;d=1/d;let h=d;
 for(let m=1;m<=300;m++){
  const m2=2*m;let aa=m*(b-m)*x/((a+m2-1)*(a+m2));
  d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;h*=d*c;
  aa=-(a+m)*(a+b+m)*x/((a+m2)*(a+m2+1));
  d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;const del=d*c;h*=del;
  if(Math.abs(del-1)<1e-12)break;
 }
 return h;
}
/** CDF of Beta(a,b) at x. */
export function betaCdf(x,a,b){
 if(!(a>0&&b>0)||!finite(x))return NaN;if(x<=0)return 0;if(x>=1)return 1;
 const front=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log(1-x));
 return x<(a+1)/(a+b+2)?front*betaFraction(a,b,x)/a:1-front*betaFraction(b,a,1-x)/b;
}
/** Chance that the true hit rate is above `base`, given k hits in n (Jeffreys prior Beta(½,½)). */
export function chanceAbove(k,n,base){
 if(!(n>0)||!finite(base))return null;return round3(1-betaCdf(Math.min(1,Math.max(0,base)),k+0.5,n-k+0.5));
}
/** Wilson score interval for k hits in n (95% by default). */
export function wilson(k,n,z=1.96){
 if(!(n>0))return {low:null,high:null};
 const p=k/n,z2=z*z,den=1+z2/n,center=(p+z2/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
 return {low:round3(Math.max(0,center-half)),high:round3(Math.min(1,center+half))};
}
/** Kind of move of a Sombra entry: pause, activate, increase or reduce. */
export function entryKind(e){
 if(e?.action==='status')return e.after?.status==='PAUSED'?'pause':'activate';
 const b=e?.before?.dailyBudget,a=e?.after?.dailyBudget;return finite(a)&&finite(b)?(a>b?'increase':'reduce'):null;
}
/** Pause and reduce are both cuts: a Sombra cut of either kind covers a person's cut of either kind. */
export const isCutKind=k=>k==='pause'||k==='reduce';
/** Value of a Map-like (Map from any realm, or a plain object) without relying on instanceof. */
export function getFrom(store,key){return store&&typeof store.get==='function'?store.get(key):store?.[key];}
/** Entries of a Map-like (Map from any realm, or a plain object). */
export function entriesOf(store){if(!store)return [];if(typeof store.entries==='function'&&typeof store.get==='function')return [...store.entries()];return Object.entries(store);}

/** UTC hour stamp of an instant ('2026-11-09T15'), the unit of the Sombra's evaluation coverage. */
export const hourStamp=at=>new Date(at).toISOString().slice(0,13);
/**
 * Whether the Sombra was evaluating `project` around `at`: a pass in that UTC hour or the one before it. `coverage` maps
 * project id → list of hour stamps (worker/cloud-executor.ts). No coverage, no claim about blind spots or anticipation.
 */
export function coveredAt(coverage,project,at){
 const list=coverage?.[project],t=Date.parse(at||'');if(!Array.isArray(list)||!Number.isFinite(t))return false;
 return list.includes(hourStamp(t))||list.includes(hourStamp(t-3600000));
}
/** Two-proportion z statistic (pooled): |z| ≥ 1.96 is a difference unlikely to be noise at 95%. */
export function twoProportionZ(k1,n1,k2,n2){
 if(!(n1>0&&n2>0))return null;const p=(k1+k2)/(n1+n2),se=Math.sqrt(p*(1-p)*(1/n1+1/n2));return se>0?(k1/n1-k2/n2)/se:0;
}
