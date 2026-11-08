/**
 * "Já fiz no Gerenciador": the owner reports an adjustment made outside the Bunker.
 * It is only what the owner said. It is not a Bunker execution and does not confirm a value:
 * the next complete Malva reading of today's campaign reconciles it (Conferida) or flags it (Divergente).
 */
const arr=v=>Array.isArray(v)?v:[],time=v=>Date.parse(v||''),finite=Number.isFinite;
export const ownerAppliedPolicy=Object.freeze({graceMs:60000,budgetTolerance:0.02,refreshRequests:20});
export const ownerAppliedStatus='Aplicada pelo dono';

export function isOwnerApplied(choice){return choice?.appliedByOwner===true&&finite(time(choice.appliedAt));}

/** Derived, never stored: reads the newest complete today-campaign source taken after the report.
 * Divergence also needs the source's own sync (lastSyncAt) to be after the report. */
export function ownerAppliedVerification(state,choice){
 if(!isOwnerApplied(choice)||choice.action==='keep')return null;
 const after=time(choice.appliedAt)+ownerAppliedPolicy.graceMs;
 const sources=arr(state?.snapshots).filter(s=>s.projectId===choice.project&&s.period==='today'&&s.level==='campaign'&&s.complete===true&&time(s.fetchedAt)>=after).sort((a,b)=>time(b.fetchedAt)-time(a.fetchedAt));
 const source=sources[0];if(!source)return {status:'A conferir',observedAt:null,observed:null};
 const row=arr(source.rows).find(r=>r.adAccountId===choice.adAccountId&&r.externalId===choice.objectId);
 if(!row)return {status:'A conferir',observedAt:source.fetchedAt,observed:null};
 const observed={status:row.status??null,effectiveStatus:row.effectiveStatus??null,dailyBudget:finite(row.dailyBudget)?row.dailyBudget:null};
 let ok=false;
 if(choice.action==='pause')ok=row.status==='PAUSED'||row.effectiveStatus==='PAUSED';
 else if(['increase','reduce'].includes(choice.action)){
  const want=choice.after?.dailyBudget;
  ok=finite(want)&&finite(observed.dailyBudget)&&Math.abs(observed.dailyBudget-want)<=Math.max(0.5,Math.abs(want)*ownerAppliedPolicy.budgetTolerance);
 }
 // A reading only proves divergence when Malva itself synced after the report; an older origin sync may still
 // carry the value from before the owner's change (N/D, not "Divergente").
 const syncedAfter=time(source.lastSyncAt)>=time(choice.appliedAt);
 return {status:ok?'Conferida':syncedAfter?'Divergente':'A conferir',observedAt:source.fetchedAt,observed};
}

/** A diverging report puts the campaign back in the decision queue. */
export function ownerAppliedDiverges(state,choice){return ownerAppliedVerification(state,choice)?.status==='Divergente';}

/** Activity events for the log, the notch queue and Bunk ("Você · informado no notch"). */
export function ownerAppliedEvents(state){
 return arr(state?.ownerChoices).filter(c=>isOwnerApplied(c)&&c.action!=='keep').map(c=>{
  const status=c.action==='pause',field=status?'status':'dailyBudget',before=status?c.before?.status??'ACTIVE':c.before?.dailyBudget??null,after=status?'PAUSED':c.after?.dailyBudget??null;
  const percent=!status&&finite(before)&&finite(after)&&before>0?Math.round((after-before)/before*1000)/10:null;
  return {id:'owner:'+c.id,project:c.project,adAccountId:c.adAccountId,objectId:c.objectId,name:c.name||null,accountName:c.accountName||null,action:c.action,field,before,after,percent,currency:c.currency||null,at:c.appliedAt,from:null,actor:'Você · informado no notch',origin:'owner',verification:ownerAppliedVerification(state,c)?.status||null};
 });
}

/** Ask the executor to re-read this project's live data next (one pending request per project). */
export function requestLiveRefresh(state,project,now=Date.now()){
 const at=new Date(now).toISOString(),list=arr(state.liveRefreshRequests).filter(r=>r.project!==project);
 state.liveRefreshRequests=[...list,{project,at}].slice(-ownerAppliedPolicy.refreshRequests);
 return state.liveRefreshRequests;
}
/** Projects with a request newer than their last successful live read, oldest request first. */
export function pendingLiveRefresh(state,lastSuccess){
 return arr(state?.liveRefreshRequests).filter(r=>!(time(lastSuccess?.[r.project])>=time(r.at))).sort((a,b)=>time(a.at)-time(b.at)).map(r=>r.project);
}
