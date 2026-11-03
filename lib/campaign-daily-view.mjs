/** Revisions belong to an exact daily-cache identity, not just a Meta ID.
 * This is display-only and never writes into an analysis or approval. */
const identityFields=['projectId','adAccountId','objectId','internalObjectId','timezone'];
const nonempty=value=>typeof value==='string'&&value.length>0;
const revision=value=>Number.isSafeInteger(value)&&value>=0;

export function sameDailyCache(previous,incoming){
 return !!previous&&!!incoming&&identityFields.every(key=>nonempty(previous.target?.[key])&&previous.target[key]===incoming.target?.[key])&&['from','to'].every(key=>nonempty(previous.range?.[key])&&previous.range[key]===incoming.range?.[key]);
}

export function mergeDailyItem(previous,incoming){
 if(!incoming)return null;
 // A new day, timezone or internal Malva UUID has a different revision stream.
 // Even a pending/null series must replace the old identity immediately.
 if(!sameDailyCache(previous,incoming))return incoming;
 if(revision(previous.revision)&&revision(incoming.revision)&&incoming.revision<previous.revision)return previous;
 const prior=previous.snapshot,next=incoming.snapshot;
 const older=prior&&next&&Number.isFinite(Date.parse(prior.fetchedAt))&&Number.isFinite(Date.parse(next.fetchedAt))&&Date.parse(next.fetchedAt)<Date.parse(prior.fetchedAt);
 return {...incoming,snapshot:older?prior:next||prior||null};
}
