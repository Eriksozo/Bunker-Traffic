const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
/** Saved reads and source synchronization are separate clocks, never presence. */
export function dataFreshness(snapshot,now=Date.now()){
 const fetched=time(snapshot?.fetchedAt),synced=time(snapshot?.lastSyncAt);
 const valid=timestamp=>timestamp!==null&&timestamp<=now+300000;
 return {
  fetchedAt:valid(fetched)?snapshot.fetchedAt:null,
  sourceUpdatedAt:valid(synced)?snapshot.lastSyncAt:null,
  stale:!valid(fetched)||!valid(synced)||now-fetched>3600000||now-synced>3600000,
 };
}
