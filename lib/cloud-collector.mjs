import {bundleSchema} from './snapshot-schema.mjs';
import {CloudError} from './cloud-malva.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const periods=['7d','3d','yesterday','today'];
export function cloudRanges(at,timezone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));const day=`${parts.year}-${parts.month}-${parts.day}`,shift=n=>new Date(Date.parse(day+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
 return Object.fromEntries(periods.map(p=>[p,{from:shift(p==='7d'?7:p==='3d'?3:p==='yesterday'?1:0),to:shift(p==='today'?0:1)}]));
}
const total=r=>{if(!Array.isArray(r?.rows))throw new CloudError('SOURCE_INVALID');if(!r.truncated)return r.rows.length;const n=typeof r.truncated==='number'?r.truncated:r.truncated.total;if(!Number.isInteger(n)||n<r.rows.length)throw new CloudError('SOURCE_INVALID');return n;};
const key=r=>JSON.stringify([r.adAccountId,r.externalId]);
/** Shared identity queue for analysis and live reads; unavailable IDs remain tracked. */
export function trackedCloudCampaigns(state,project){
 const targets=new Map();for(const s of state.snapshots||[])if(s.projectId===project&&s.source==='Malva MCP'&&s.complete===true&&s.period==='today'&&s.level==='campaign')for(const row of [...s.rows.filter(r=>r.provider==='meta'),...(s.analysisScope?.unavailableTracked||[])]){const k=key(row),prior=targets.get(k);if(prior&&prior.id!==row.id)throw new CloudError('SOURCE_TRACKED_IDENTITY');targets.set(k,row);}return [...targets.values()];
}
export async function collectCloudProject(client,project,{now=Date.now,startedAt,concurrency=3,levels=['campaign','adset','ad'],periodsWanted=periods,tracked=/** @type {any[]} */([]),purpose='analysis'}={}){
 if(!uuid.test(project?.id||'')||typeof project.name!=='string')throw new CloudError('SOURCE_IDENTITY');
 const ranges=cloudRanges(now(),project.timezone),accounts=await client.read('tracking_ad_accounts',{projectId:project.id});
 const accountIds=(accounts.items||[]).filter(a=>a.provider==='meta').map(a=>a.id);if(accountIds.some(id=>!uuid.test(id))||new Set(accountIds).size!==accountIds.length)throw new CloudError('SOURCE_IDENTITY');
 let calls=0;const snapshots=[];
 // Provenance of each row (curadoria of 13/11/2026, residual 1): the freshAt of the very response/partition that
 // returned it, kept outside the snapshot (keyed by the parsed snapshot object) so the schema and the seals do not change.
 const rowClocks=new WeakMap(),externalAccount=id=>(accounts.items||[]).find(a=>a.provider==='meta'&&a.id===id)?.accountId;
 // The listing's freshness policy, shared by the detail fallback: a valid time, not in the future, at most 5 minutes old
 // and not older than this collection's start.
 const sane=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now()+1000;
 const fresh=v=>sane(v)&&now()-Date.parse(v)<=300000&&!(startedAt&&Date.parse(v)<Date.parse(startedAt));
 function mergeReads(parts){
  const rows=parts.flatMap(r=>r.rows),keys=new Set(rows.map(key)),count=parts.reduce((n,r)=>n+r.total,0),oldest=xs=>xs.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b);
  if(keys.size!==rows.length||count>3000)throw new CloudError('SOURCE_INCOMPLETE');
  return {...parts[0],rows,total:count,truncated:count>rows.length?{shown:rows.length,total:count}:false,freshAt:oldest(parts.map(r=>r.freshAt)),lastSyncAt:parts.some(r=>!r.lastSyncAt)?null:oldest(parts.map(r=>r.lastSyncAt)),rowAt:new Map(parts.flatMap(r=>[...r.rowAt]))};
 }
 async function read(period,level,ids,parents,statusOverride,q){
  // MCP rejects oversized parent filters. Partition the known, disjoint parent
  // cohort before sending it; every subread still validates its own identity.
  if(parents?.length>25){const parts=[];for(let i=0;i<parents.length;i+=25)parts.push(await read(period,level,ids,parents.slice(i,i+25),statusOverride,q));return mergeReads(parts);}
  if(++calls>350)throw new CloudError('SOURCE_LIMIT');
  const r=await client.read('tracking_campaigns',{projectId:project.id,level,provider:['meta'],sales:'traffic',preset:'custom',...ranges[period],status:statusOverride||(period==='today'?'all':'spent'),accountStatus:'all',limit:100,...(ids?{accountIds:ids}:{}),...(parents?{campaignIds:parents}:{}),...(q?{q}:{})});
  if(r.level!==level||r.salesScope?.kind!=='traffic'||r.currency!==project.currency||r.period?.timezone!==project.timezone||r.period?.days?.[0]!==ranges[period].from||r.period?.days?.at(-1)!==ranges[period].to||!Number.isFinite(Date.parse(r.freshAt))||Date.parse(r.freshAt)>now()+1000||now()-Date.parse(r.freshAt)>300000||startedAt&&Date.parse(r.freshAt)<Date.parse(startedAt))throw new CloudError('SOURCE_STALE_OR_IDENTITY');
  for(const row of r.rows)if(row.projectId!==project.id||row.projectName!==project.name||row.level!==level||row.provider!=='meta'||ids&&!ids.includes(row.adAccountId)||parents&&!parents.includes(row.campaignExternalId))throw new CloudError('SOURCE_IDENTITY');
  const count=total(r);
  if(parents?.length>1&&count>r.rows.length){const mid=Math.ceil(parents.length/2),merged=mergeReads([await read(period,level,ids,parents.slice(0,mid),statusOverride,q),await read(period,level,ids,parents.slice(mid),statusOverride,q)]),keys=new Set(merged.rows.map(key));if(merged.total!==count||r.rows.some(row=>!keys.has(key(row))))throw new CloudError('SOURCE_INCOMPLETE');return merged;}
  return {...r,total:count,rowAt:new Map(r.rows.map(row=>[key(row),r.freshAt]))};
 }
 async function window(period,level,statusOverride){
  const todayParents=period==='today'&&level!=='campaign'?(snapshots.find(s=>s.period===period&&s.level==='campaign')?.rows||[]).filter(r=>statusOverride!=='active'||r.status==='ACTIVE').map(r=>r.externalId):undefined;
  if(todayParents?.length===0){const campaign=snapshots.find(s=>s.period===period&&s.level==='campaign');return {...campaign,level,rows:[]};}
  const first=await read(period,level,undefined,todayParents,statusOverride),parts=[];
  const collect=async(ids,parents)=>{
   const r=await read(period,level,ids,parents,statusOverride);if(r.total===r.rows.length){parts.push(r);return;}
   if(ids.length>1){const mid=Math.ceil(ids.length/2);await collect(ids.slice(0,mid),parents);await collect(ids.slice(mid),parents);return;}
   if(level==='campaign')throw new CloudError('SOURCE_INCOMPLETE');
   const campaigns=parents||(snapshots.find(s=>s.period===period&&s.level==='campaign')?.rows||[]).filter(r=>r.adAccountId===ids[0]).map(r=>r.externalId);
   if(campaigns.length<2)throw new CloudError('SOURCE_INCOMPLETE');const mid=Math.ceil(campaigns.length/2);await collect(ids,campaigns.slice(0,mid));await collect(ids,campaigns.slice(mid));
  };
  if(first.total===first.rows.length)parts.push(first);else{if(!accountIds.length)throw new CloudError('SOURCE_INCOMPLETE');await collect(accountIds,todayParents);}
  const rows=parts.flatMap(r=>r.rows),keys=new Set(rows.map(key));if(rows.length!==keys.size||rows.length!==first.total||first.rows.some(r=>!keys.has(key(r)))||rows.length>3000)throw new CloudError('SOURCE_INCOMPLETE');
  const oldest=xs=>xs.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b),fetchedAt=oldest(parts.map(r=>r.freshAt));
  const snapshot={projectId:project.id,projectName:project.name,source:'Malva MCP',complete:true,period,level,timezone:project.timezone,from:first.period.from,to:first.period.to,fetchedAt,lastSyncAt:parts.some(r=>!r.lastSyncAt)?null:oldest(parts.map(r=>r.lastSyncAt)),rows};
  const parsed=bundleSchema.parse({snapshots:[snapshot]}).snapshots[0];if(new TextEncoder().encode(JSON.stringify(parsed)).length>1450000)throw new CloudError('SOURCE_LIMIT');
  rowClocks.set(parsed,new Map(parts.flatMap(r=>[...r.rowAt])));return parsed;
 }
 /** Today's active and spent reads overlap (an active campaign with spend is in both). The same object must carry the
  * same stable fields in both: a different status or budget means the source changed between the reads, and a hybrid
  * reading is refused (SOURCE_CHANGED: the previous reading stays, nothing is resent). With only metrics different,
  * the whole row of the newer response wins; on the same clock, the spent read (as before). "Newer" compares the clock
  * of the response/partition that returned each row, never the oldest time of the whole window: an unrelated account
  * read earlier must not make an older row win (curadoria of 13/11/2026, residual 1). */
 function overlap(active,spent){
  const stable=['id','name','status','effectiveStatus','dailyBudget','lifetimeBudget','budgetCurrency','adAccountId','campaignExternalId','adsetExternalId','accountStatus'];
  const clock=(s,r)=>Date.parse(rowClocks.get(s)?.get(key(r))??s.fetchedAt),rows=new Map(active.rows.map(r=>[key(r),r]));
  for(const r of spent.rows){
   const prior=rows.get(key(r));
   if(prior&&stable.some(f=>JSON.stringify(prior[f]??null)!==JSON.stringify(r[f]??null)))throw new CloudError('SOURCE_CHANGED');
   if(!prior||!(clock(active,prior)>clock(spent,r)))rows.set(key(r),r);
  }
  return rows;
 }
 // Campaign sources precede hierarchy, so oversized accounts can be partitioned by real parent IDs.
 async function current(level){
  // Today's operative cohort excludes the unbounded archive of dormant campaigns.
  const [active,spent]=await Promise.all([window('today',level,'active'),window('today',level,'spent')]);
  const rows=overlap(active,spent);const times=[active.fetchedAt,spent.fetchedAt],syncs=[active.lastSyncAt,spent.lastSyncAt],accountReads=new Map(),unavailableTracked=[];
  const targets=[...new Map([...tracked,...(purpose==='analysis'?snapshots.filter(s=>s.level==='campaign'&&s.period!=='today').flatMap(s=>s.rows):[])].map(r=>[key(r),r])).values()];
  if(level==='campaign')for(const target of targets){
   if(rows.has(key(target))){if(rows.get(key(target)).id!==target.id)throw new CloudError('SOURCE_TRACKED_IDENTITY');continue;}
   if(!uuid.test(target.id||'')||!target.externalId||!accountIds.includes(target.adAccountId))throw new CloudError('SOURCE_TRACKED_IDENTITY');
   if(!accountReads.has(target.adAccountId))accountReads.set(target.adAccountId,await read('today','campaign',[target.adAccountId],undefined,'all'));
   // Every fallback read that contributes joins both clocks of the cut (curadoria of 13/11/2026, residual 2): its freshAt
   // and its lastSyncAt. A missing lastSyncAt keeps the cut's unknown (null); an older one stays older (oldest wins).
   const contributes=r=>{times.push(r.freshAt);syncs.push(r.lastSyncAt??null);};
   let match=accountReads.get(target.adAccountId).rows.find(r=>key(r)===key(target));
   if(!match&&target.name&&accountReads.get(target.adAccountId).total>accountReads.get(target.adAccountId).rows.length){const cut=await read('today','campaign',[target.adAccountId],undefined,'all',target.name);contributes(cut);match=cut.rows.find(r=>key(r)===key(target));}
   if(match){if(match.id!==target.id)throw new CloudError('SOURCE_TRACKED_IDENTITY');rows.set(key(match),match);contributes(accountReads.get(target.adAccountId));continue;}
   if(++calls>350)throw new CloudError('SOURCE_LIMIT');
   const checkedAt=new Date(now()).toISOString(),detail=await client.read('tracking_ad_detail',{projectId:project.id,objectId:target.id,sales:'traffic',preset:'today'}),r=detail.row;
   const ownAccount=!!detail.accountId&&detail.accountId===externalAccount(target.adAccountId);
   if(r===null&&detail.provider==='meta'&&detail.level==='campaign'&&detail.externalId===target.externalId&&ownAccount&&detail.currency===project.currency&&detail.period?.timezone===project.timezone&&detail.period?.from===spent.from&&detail.period?.to===spent.to){unavailableTracked.push({id:target.id,externalId:target.externalId,adAccountId:target.adAccountId,reason:'no-current-row',checkedAt});continue;}
   // A detail row is validated as it arrives (curadoria of 13/11/2026), before the schema strips its project fields:
   // explicit project/account/object/provider/level identity and the same "today" envelope as this cut; anything else
   // fails explicitly (the previous reading stays). The envelope's external account must be the one tracking_ad_accounts
   // maps to the row's account, as in the null branch (residual 3). Its own freshAt (never the listing's) joins the cut's oldest time
   // under the listing's policy; an invalid one fails. A detail without freshAt (the Malva detail carries none) cannot
   // be dated: its row stays out and the object is declared unavailable ("no-freshness"), never shown as current.
   if(!r||r.id!==target.id||r.externalId!==target.externalId||r.adAccountId!==target.adAccountId||r.provider!=='meta'||r.level!=='campaign'||r.projectId!==project.id||r.projectName!==project.name||!ownAccount||detail.provider!=='meta'||detail.level!=='campaign'||detail.externalId!==target.externalId||detail.currency!==project.currency||detail.period?.timezone!==project.timezone)throw new CloudError('SOURCE_TRACKED_IDENTITY');
   if(detail.period?.from!==spent.from||detail.period?.to!==spent.to)throw new CloudError('SOURCE_STALE_OR_IDENTITY');
   if(detail.freshAt==null){unavailableTracked.push({id:target.id,externalId:target.externalId,adAccountId:target.adAccountId,reason:'no-freshness',checkedAt});continue;}
   if(!fresh(detail.freshAt)||detail.lastSyncAt!=null&&!sane(detail.lastSyncAt))throw new CloudError('SOURCE_STALE_OR_IDENTITY');
   times.push(detail.freshAt);syncs.push(detail.lastSyncAt??null);
   rows.set(key(r),r);
  }
  const snapshot={...spent,fetchedAt:times.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b),lastSyncAt:syncs.some(v=>!v)?null:syncs.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b),rows:[...rows.values()],...(purpose==='analysis'?{analysisScope:{kind:'meta-operating-cohort',activeComplete:true,spentComplete:true,trackedComplete:!unavailableTracked.length,...(unavailableTracked.length?{unavailableTracked}:{}),trackedCount:level==='campaign'?targets.length:0,inactiveArchiveExcluded:true,parentCampaignCount:level==='campaign'?null:snapshots.find(s=>s.period==='today'&&s.level==='campaign')?.rows.length||0}}:level==='campaign'?{coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:!unavailableTracked.length,...(unavailableTracked.length?{unavailableTracked}:{}),trackedCount:targets.length}}:{})};
  if(snapshot.rows.length>3000||new TextEncoder().encode(JSON.stringify(snapshot)).length>1450000)throw new CloudError('SOURCE_LIMIT');return bundleSchema.parse({snapshots:[snapshot]}).snapshots[0];
 }
 for(const level of levels)for(let i=0;i<periodsWanted.length;i+=concurrency){const result=await Promise.all(periodsWanted.slice(i,i+concurrency).map(p=>p==='today'?current(level):window(p,level)));snapshots.push(...result);}

 return {snapshots,sourceCalls:calls,scope:'Campanhas com gasto nos períodos fechados; ativas, com gasto e acompanhadas hoje. Hierarquia nesse recorte; arquivo antigo inativo fora da cobertura atual. Aquecimento fora das sugestões.'};
}
