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
 function mergeReads(parts){
  const rows=parts.flatMap(r=>r.rows),keys=new Set(rows.map(key)),count=parts.reduce((n,r)=>n+r.total,0),oldest=xs=>xs.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b);
  if(keys.size!==rows.length||count>3000)throw new CloudError('SOURCE_INCOMPLETE');
  return {...parts[0],rows,total:count,truncated:count>rows.length?{shown:rows.length,total:count}:false,freshAt:oldest(parts.map(r=>r.freshAt)),lastSyncAt:parts.some(r=>!r.lastSyncAt)?null:oldest(parts.map(r=>r.lastSyncAt))};
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
  return {...r,total:count};
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
  const parsed=bundleSchema.parse({snapshots:[snapshot]}).snapshots[0];if(new TextEncoder().encode(JSON.stringify(parsed)).length>1450000)throw new CloudError('SOURCE_LIMIT');return parsed;
 }
 // Campaign sources precede hierarchy, so oversized accounts can be partitioned by real parent IDs.
 async function current(level){
  // Today's operative cohort excludes the unbounded archive of dormant campaigns.
  const [active,spent]=await Promise.all([window('today',level,'active'),window('today',level,'spent')]);
  const rows=new Map([...active.rows,...spent.rows].map(r=>[key(r),r]));const times=[active.fetchedAt,spent.fetchedAt],accountReads=new Map(),unavailableTracked=[];
  const targets=[...new Map([...tracked,...(purpose==='analysis'?snapshots.filter(s=>s.level==='campaign'&&s.period!=='today').flatMap(s=>s.rows):[])].map(r=>[key(r),r])).values()];
  if(level==='campaign')for(const target of targets){
   if(rows.has(key(target))){if(rows.get(key(target)).id!==target.id)throw new CloudError('SOURCE_TRACKED_IDENTITY');continue;}
   if(!uuid.test(target.id||'')||!target.externalId||!accountIds.includes(target.adAccountId))throw new CloudError('SOURCE_TRACKED_IDENTITY');
   if(!accountReads.has(target.adAccountId))accountReads.set(target.adAccountId,await read('today','campaign',[target.adAccountId],undefined,'all'));
   let match=accountReads.get(target.adAccountId).rows.find(r=>key(r)===key(target));
   if(!match&&target.name&&accountReads.get(target.adAccountId).total>accountReads.get(target.adAccountId).rows.length){const cut=await read('today','campaign',[target.adAccountId],undefined,'all',target.name);times.push(cut.freshAt);match=cut.rows.find(r=>key(r)===key(target));}
   if(match){if(match.id!==target.id)throw new CloudError('SOURCE_TRACKED_IDENTITY');rows.set(key(match),match);times.push(accountReads.get(target.adAccountId).freshAt);continue;}
   if(++calls>350)throw new CloudError('SOURCE_LIMIT');
   const checkedAt=new Date(now()).toISOString(),detail=await client.read('tracking_ad_detail',{projectId:project.id,objectId:target.id,sales:'traffic',preset:'today'}),r=detail.row;
   if(r===null&&detail.provider==='meta'&&detail.level==='campaign'&&detail.externalId===target.externalId&&detail.accountId===accounts.items.find(a=>a.id===target.adAccountId)?.accountId&&!!detail.accountId&&detail.currency===project.currency&&detail.period?.timezone===project.timezone&&detail.period?.from===spent.from&&detail.period?.to===spent.to){unavailableTracked.push({id:target.id,externalId:target.externalId,adAccountId:target.adAccountId,reason:'no-current-row',checkedAt});continue;}
   if(!r||r.id!==target.id||r.externalId!==target.externalId||r.adAccountId!==target.adAccountId||r.provider!=='meta'||r.level!=='campaign'||detail.currency!==project.currency||detail.period?.timezone!==project.timezone)throw new CloudError('SOURCE_TRACKED_IDENTITY');
   rows.set(key(r),r);
  }
  const snapshot={...spent,fetchedAt:times.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b),rows:[...rows.values()],...(purpose==='analysis'?{analysisScope:{kind:'meta-operating-cohort',activeComplete:true,spentComplete:true,trackedComplete:!unavailableTracked.length,...(unavailableTracked.length?{unavailableTracked}:{}),trackedCount:level==='campaign'?targets.length:0,inactiveArchiveExcluded:true,parentCampaignCount:level==='campaign'?null:snapshots.find(s=>s.period==='today'&&s.level==='campaign')?.rows.length||0}}:level==='campaign'?{coverage:{kind:'active-spent-tracked',activeComplete:true,spentComplete:true,trackedComplete:!unavailableTracked.length,...(unavailableTracked.length?{unavailableTracked}:{}),trackedCount:targets.length}}:{})};
  if(snapshot.rows.length>3000||new TextEncoder().encode(JSON.stringify(snapshot)).length>1450000)throw new CloudError('SOURCE_LIMIT');return bundleSchema.parse({snapshots:[snapshot]}).snapshots[0];
 }
 for(const level of levels)for(let i=0;i<periodsWanted.length;i+=concurrency){const result=await Promise.all(periodsWanted.slice(i,i+concurrency).map(p=>p==='today'?current(level):window(p,level)));snapshots.push(...result);}

 return {snapshots,sourceCalls:calls,scope:'Campanhas com gasto nos períodos fechados; ativas, com gasto e acompanhadas hoje. Hierarquia nesse recorte; arquivo antigo inativo fora da cobertura atual. Aquecimento fora das sugestões.'};
}
