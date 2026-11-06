/** Shared collection lease. Admission, completion and the cloud preflight use the same clock rule. */
export const collectionLeaseMs=45*60000;
export function liveCollectionLease(job,now=Date.now()){
 const started=Date.parse(job?.startedAt||'');
 return Number.isFinite(now)&&Number.isFinite(started)&&started<=now&&now-started<collectionLeaseMs;
}
