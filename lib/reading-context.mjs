import {currentLiveSnapshot,liveDisplayStatus} from './live-display.mjs';
import {dataFreshness} from './data-freshness.mjs';

/** A frozen analysis clock must never stand in for the continuously read feed.
 * This is display-only: no source replacement, proposal renewal or approval. */
export function readingContext({item,project,analysis,error='',paused=false,now=Date.now()}){
 const snapshot=currentLiveSnapshot(item,project,undefined,now),status=liveDisplayStatus(item,project,{error,paused,now});
 const sameProject=item?.projectId===project&&item?.snapshot?.projectId===project;
 const monitoring=snapshot||(sameProject?item.snapshot:null);
 return {monitoring:{...dataFreshness(monitoring,now),recent:status.recent,label:status.label},analysis:{...dataFreshness(analysis?.projectId===project?analysis:null,now),period:analysis?.projectId===project?analysis.period:null}};
}
