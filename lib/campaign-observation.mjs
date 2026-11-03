/** Native campaign changes observed between complete reads. This module never
 * calls an ad provider, attributes an actor, or confirms a Bunker execution. */
export const campaignObservationLimits=Object.freeze({changes:2000});
const fields=Object.freeze(['status','effectiveStatus','dailyBudget','lifetimeBudget','budgetCurrency']);
const array=(value,label)=>{if(value===undefined)return [];if(!Array.isArray(value))throw Error(`${label} inválido.`);return value;};
const text=value=>typeof value==='string'&&value.trim().length>0;
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const iso=value=>new Date(value).toISOString();
const copy=value=>structuredClone(value);
const key=(project,row)=>JSON.stringify([project,'meta','campaign',row.adAccountId,row.externalId]);
const identity=row=>row&&row.level==='campaign'&&text(row.externalId)&&text(row.adAccountId)&&String(row.provider||'').toLowerCase()==='meta';
const known=(field,value)=>['dailyBudget','lifetimeBudget'].includes(field)?typeof value==='number'&&Number.isFinite(value)&&value>=0:field==='budgetCurrency'?typeof value==='string'&&/^[A-Z]{3}$/.test(value):text(value);
const native=row=>Object.fromEntries(fields.filter(field=>known(field,row[field])).map(field=>[field,row[field]]));
export function campaignNativeDrift(beforeRow,afterRow){
 if(!identity(beforeRow)||!identity(afterRow)||key('',beforeRow)!==key('',afterRow))return [];
 return fields.filter(field=>known(field,beforeRow[field])&&known(field,afterRow[field])&&beforeRow[field]!==afterRow[field]).map(field=>({field,before:beforeRow[field],after:afterRow[field]}));
}
function hash(value){const input=JSON.stringify(value);let a=2166136261,b=3335557771;for(let i=0;i<input.length;i++){a=Math.imul(a^input.charCodeAt(i),16777619);b=Math.imul(b^input.charCodeAt(i),2246822519);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
function day(instant,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));}
function snapshotContext(snapshot,now,current){
 if(!snapshot||snapshot.source!=='Malva MCP'||snapshot.period!=='today'||snapshot.level!=='campaign'||snapshot.complete!==true||!text(snapshot.projectId)||!Array.isArray(snapshot.rows))return null;
 const fetched=time(snapshot.fetchedAt),from=time(snapshot.from),to=time(snapshot.to);
 if(![fetched,from,to].every(Number.isFinite)||fetched>now||from>fetched||fetched>=to||from>=to)return null;
 try{
  if(!text(snapshot.timezone)||day(from,snapshot.timezone)!==day(fetched,snapshot.timezone)||current&&(day(fetched,snapshot.timezone)!==day(now,snapshot.timezone)||now<from||now>=to))return null;
 }catch{return null;}
 const rows=new Map(),duplicates=new Set();
 for(const row of snapshot.rows){if(!identity(row))continue;const id=key(snapshot.projectId,row);if(rows.has(id)){duplicates.add(id);rows.delete(id);}else if(!duplicates.has(id))rows.set(id,row);}
 return {snapshot,fetched,rows};
}

/** Call before replacing analysis snapshots. Older, partial, non-current and
 * duplicate reads cannot invent transitions. No absence is interpreted as loss. */
export function reconcileCampaignObservations(state,snapshots,now=Date.now()){
 const at=typeof now==='number'?now:Date.parse(now);if(!Number.isFinite(at))throw Error('Instante da observação inválido.');
 if(!Array.isArray(snapshots))throw Error('Leituras de campanhas inválidas.');
 const prior=array(state.campaignChanges,'Histórico de mudanças'),baselines=new Map(),records=[],ids=new Set(prior.map(change=>change.id));
 for(const snapshot of array(state.snapshots,'Leituras salvas')){
  const context=snapshotContext(snapshot,at,false);if(context&&(!baselines.has(snapshot.projectId)||baselines.get(snapshot.projectId).fetched<context.fetched))baselines.set(snapshot.projectId,context);
 }
 const highwater=new Map();for(const change of prior){const observed=time(change.observedAt);if(text(change.project)&&Number.isFinite(observed))highwater.set(change.project,Math.max(highwater.get(change.project)||-Infinity,observed));}
 for(const snapshot of snapshots){
  const next=snapshotContext(snapshot,at,true);if(!next)continue;
  const project=snapshot.projectId,previous=baselines.get(project),last=Math.max(previous?.fetched??-Infinity,highwater.get(project)??-Infinity);
  if(next.fetched<=last)continue;
  if(previous)for(const [id,row] of next.rows){
   const beforeRow=previous.rows.get(id);if(!beforeRow)continue;
   const changes=fields.filter(field=>known(field,beforeRow[field])&&known(field,row[field])&&beforeRow[field]!==row[field]).map(field=>({field,before:beforeRow[field],after:row[field]}));
   if(!changes.length)continue;
   const before=native(beforeRow),after=native(row),observedAt=iso(next.fetched),previousObservedAt=iso(previous.fetched),recordId='campaign-change:'+hash([project,row.adAccountId,row.externalId,previousObservedAt,observedAt,changes]);
   if(ids.has(recordId))continue;
   const record={id:recordId,project,adAccountId:row.adAccountId,objectId:row.externalId,name:text(row.name)?row.name:null,accountName:text(row.accountName)?row.accountName:null,observedAt,previousObservedAt,changes,before,after,source:'Malva MCP',origin:'observed',actor:null,occurredAt:null,executionByBunker:false};
   records.push(record);ids.add(recordId);
  }
  baselines.set(project,next);highwater.set(project,next.fetched);
 }
 if(prior.length+records.length>campaignObservationLimits.changes)throw Error('Limite de mudanças observadas atingido. Exporte e preserve o histórico; nenhum registro foi apagado.');
 if(records.length)state.campaignChanges=[...prior,...records];
 return {inserted:records.length,changes:copy(records)};
}

const newest=(items,field)=>items.filter(item=>Number.isFinite(time(item[field]))).sort((a,b)=>time(b[field])-time(a[field])||String(b.id||'').localeCompare(String(a.id||'')))[0]||null;
export function latestCampaignChange(state,project,row){
 if(!text(project)||!identity(row))return null;
 return newest(array(state.campaignChanges,'Histórico de mudanças').filter(change=>change.project===project&&change.adAccountId===row.adAccountId&&change.objectId===row.externalId),'observedAt');
}
function incidentApplies(incident,project,row){
 if(!incident||incident.project!==project||!text(incident.id)||!Number.isFinite(time(incident.reportedAt)))return false;
 const scope=incident.scope;if(scope===undefined||scope===null)return true;
 if(typeof scope!=='object'||Array.isArray(scope))return false;
 if(scope.accountIds!==undefined&&(!Array.isArray(scope.accountIds)||!scope.accountIds.every(text)||scope.accountIds.length>0&&!scope.accountIds.includes(row.adAccountId)))return false;
 if(scope.objectIds!==undefined&&(!Array.isArray(scope.objectIds)||!scope.objectIds.every(object=>object&&text(object.adAccountId)&&text(object.objectId))||scope.objectIds.length>0&&!scope.objectIds.some(object=>object.adAccountId===row.adAccountId&&object.objectId===row.externalId)))return false;
 return true;
}
function latestIncident(state,project,row){
 if(!text(project)||!identity(row))return null;
 return newest(array(state.incidents,'Incidentes').filter(item=>incidentApplies(item,project,row)),'reportedAt');
}
/** A project-wide incident is context, not proof that every campaign was paused. */
export function campaignIncident(state,project,row){
 const incident=latestIncident(state,project,row);
 return incident&&['Interrompido','Em retomada'].includes(incident.status)?incident:null;
}
export function campaignReviewMarker(state,project,row){
 const change=latestCampaignChange(state,project,row),incident=latestIncident(state,project,row),markers=[];
 if(change)markers.push({kind:'change',id:change.id,at:change.observedAt,change});
 if(incident&&['Interrompido','Em retomada','Encerrado'].includes(incident.status))markers.push({kind:'incident',id:incident.id,at:incident.reportedAt,incident});
 return newest(markers,'at');
}
