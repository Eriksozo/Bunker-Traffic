import {bundleSchema} from './snapshot-schema.mjs';

/** Display-only cache. Never imported into analysis snapshots or financial journals. */
export const liveDataLimits=Object.freeze({pollIntervalSeconds:15,freshnessMs:5*60000,maxSnapshotBytes:1450000,maxRecordBytes:1500000,maxProjects:500,maxTrackedTargets:3000});
const encoder=new TextEncoder(),own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
const copy=value=>JSON.parse(JSON.stringify(value));
function requestOf(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','projectId','snapshot','error','expectedRevision'].includes(k)))fail('LIVE_INVALID_REQUEST','Pedido de sincronização inválido.');
 if(!['read','import','failure'].includes(input.action))fail('LIVE_INVALID_REQUEST','Ação de sincronização não permitida.');
 return input;
}
/** Compatibility transport for connector catalogs that do not yet expose the live tool. */
export function parseLiveDataEnvelope(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||args.id!=='live-data'||args.status!=='Pendente'||args.revision!==0||Object.keys(args).some(k=>!['id','status','revision','note'].includes(k))||typeof args.note!=='string')fail('LIVE_INVALID_REQUEST','Envelope de sincronização inválido. Use live-data, Pendente e revisão de transporte zero.');
 if(encoder.encode(args.note).byteLength>liveDataLimits.maxRecordBytes)fail('LIVE_LIMIT','O pedido de sincronização excede o limite de dados.');
 let input;try{input=JSON.parse(args.note);}catch{fail('LIVE_INVALID_REQUEST','A nota da sincronização precisa conter um pedido JSON válido.');}
 return requestOf(input);
}
function clock(now){const time=typeof now==='number'?now:Date.parse(now);if(!Number.isFinite(time))fail('LIVE_INVALID_REQUEST','Horário de sincronização inválido.');return {time,iso:new Date(time).toISOString()};}
function configured(state){
 const projects=Object.entries(state.config||{}).map(([projectId,config])=>({projectId,projectName:config?.projectName}));
 if(projects.length>liveDataLimits.maxProjects)fail('LIVE_LIMIT','Quantidade de projetos acima do limite da sincronização.');
 for(const p of projects)if(!p.projectId||p.projectId.length>2500||typeof p.projectName!=='string'||!p.projectName.trim())fail('LIVE_INVALID_PROJECT','Projeto configurado inválido.');
 return projects;
}
function projectOf(state,projectId){if(typeof projectId!=='string'||!own(state.config,projectId))fail('LIVE_INVALID_PROJECT','Projeto não configurado no Bunker.');return configured(state).find(p=>p.projectId===projectId);}
/** Read-only discovery targets retain paused/no-spend campaigns that would be
 * absent from an active/spent-today listing. They carry identity, not metrics,
 * current delivery status, permission to execute, or a claim of live coverage. */
function trackedTargets(state,projectId){
 const targets=new Map(),knownMeta=new Set(),validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=2500;
 const key=(account,id)=>JSON.stringify([account,id]);
 const add=(adAccountId,externalId)=>{
  if(!validId(adAccountId)||!validId(externalId))return;
  targets.set(key(adAccountId,externalId),{provider:'meta',level:'campaign',adAccountId,externalId});
  if(targets.size>liveDataLimits.maxTrackedTargets)fail('LIVE_LIMIT','Mais de 3000 campanhas acompanhadas neste projeto. Nenhum ID foi truncado; revise o escopo antes de coletar.');
 };
 for(const snapshot of Array.isArray(state.snapshots)?state.snapshots:[]){
  if(snapshot.projectId!==projectId||snapshot.source!=='Malva MCP'||snapshot.complete!==true||snapshot.level!=='campaign'||!['7d','3d','yesterday','today'].includes(snapshot.period)||!Array.isArray(snapshot.rows))continue;
  for(const row of snapshot.rows){
   if(!row||row.level!=='campaign'||String(row.provider||'').toLowerCase()!=='meta'||row.projectId!==undefined&&row.projectId!==projectId||!validId(row.adAccountId)||!validId(row.externalId))continue;
   knownMeta.add(key(row.adAccountId,row.externalId));add(row.adAccountId,row.externalId);
  }
 }
 for(const choice of Array.isArray(state.ownerChoices)?state.ownerChoices:[]){
  if(!choice||choice.project!==projectId||choice.level!==undefined&&choice.level!=='campaign'||!validId(choice.adAccountId)||!validId(choice.objectId))continue;
  const provider=String(choice.provider||'').toLowerCase();
  if(provider==='meta'||!provider&&knownMeta.has(key(choice.adAccountId,choice.objectId)))add(choice.adAccountId,choice.objectId);
 }
 for(const incident of Array.isArray(state.incidents)?state.incidents:[]){
  if(!incident||incident.project!==projectId||!Array.isArray(incident.scope?.objectIds))continue;
  for(const object of incident.scope.objectIds)if(object)add(object.adAccountId,object.objectId);
 }
 return [...targets.values()].sort((a,b)=>a.adAccountId.localeCompare(b.adAccountId)||a.externalId.localeCompare(b.externalId));
}
function expectedTimezone(state,projectId){
 const values=new Set((state.snapshots||[]).filter(s=>s.projectId===projectId&&s.source==='Malva MCP'&&typeof s.timezone==='string').map(s=>s.timezone));
 if(values.size!==1)fail('LIVE_TIMEZONE_UNCONFIRMED','O fuso do projeto ainda precisa ser confirmado por uma leitura do Malva.');
 return [...values][0];
}
function localParts(instant,timezone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));}
const day=p=>`${p.year}-${p.month}-${p.day}`;
const utcInstant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
function snapshotOf(state,projectId,input,now,fresh){
 const project=projectOf(state,projectId);
 if(!input||typeof input!=='object'||Array.isArray(input))fail('LIVE_INVALID_SNAPSHOT','Informe uma leitura atual do Malva.');
 if(encoder.encode(JSON.stringify(input)).byteLength>liveDataLimits.maxSnapshotBytes)fail('LIVE_LIMIT','A leitura atual excede o limite de dados. Nenhuma linha foi descartada.');
 const parsed=bundleSchema.safeParse({snapshots:[input]});if(!parsed.success)fail('LIVE_INVALID_SNAPSHOT','Confira os campos e o período da leitura atual.');
 const s=parsed.data.snapshots[0];
 if(s.projectId!==projectId||s.projectName!==project.projectName||s.period!=='today'||s.level!=='campaign'||s.source!=='Malva MCP'||s.complete!==true)fail('LIVE_INVALID_SNAPSHOT','A sincronização aceita somente campanhas de hoje, completas, do projeto exato e com origem Malva MCP.');
 if(![s.from,s.to,s.fetchedAt].every(utcInstant)||s.lastSyncAt!==null&&!utcInstant(s.lastSyncAt))fail('LIVE_INVALID_SNAPSHOT','As datas da leitura precisam usar instantes UTC explícitos.');
 const fetched=Date.parse(s.fetchedAt),from=Date.parse(s.from),to=Date.parse(s.to);
 if(fetched>now||s.lastSyncAt!==null&&Date.parse(s.lastSyncAt)>fetched)fail('LIVE_INVALID_SNAPSHOT','A leitura ou a sincronização da origem está no futuro.');
 if(fresh){
  if(now-fetched>liveDataLimits.freshnessMs)fail('LIVE_STALE_SNAPSHOT','A leitura atual venceu. Consulte novamente o Malva.');
  if(s.timezone!==expectedTimezone(state,projectId))fail('LIVE_INVALID_SNAPSHOT','O fuso difere do fuso confirmado para este projeto no Malva.');
  const current=localParts(now,s.timezone),start=localParts(from,s.timezone),end=localParts(to,s.timezone),nextDay=new Date(Date.parse(day(current)+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  if(day(start)!==day(current)||day(end)!==nextDay||[start,end].some(p=>p.hour!=='00'||p.minute!=='00'||p.second!=='00')||from>now||to<=now)fail('LIVE_INVALID_SNAPSHOT','A janela precisa ser hoje completo no fuso do Malva, de meia-noite até a próxima meia-noite.');
 }
 const ids=new Set();
 for(let i=0;i<s.rows.length;i++){
  const row=s.rows[i],raw=input.rows[i];
  if(row.level!=='campaign'||!row.externalId.trim()||!row.adAccountId.trim()||raw.projectId!==undefined&&raw.projectId!==projectId||raw.projectName!==undefined&&raw.projectName!==project.projectName)fail('LIVE_INVALID_SNAPSHOT','Uma campanha pertence a outro projeto ou não tem identidade completa.');
  const key=JSON.stringify([row.adAccountId,row.externalId]);if(ids.has(key))fail('LIVE_INVALID_SNAPSHOT','Campanha duplicada na mesma conta e leitura.');ids.add(key);
 }
 return s;
}
function revisionOf(value,required=false){if(value===undefined&&!required)return null;if(!Number.isInteger(value)||value<0)fail('LIVE_INVALID_REQUEST','Informe a revisão atual do cache deste projeto.');return value;}
function emptyItem(projectId){return {projectId,snapshot:null,lastAttemptAt:null,lastSuccessAt:null,error:null,revision:0};}
function decode(row,projectId,state){
 if(!row)return emptyItem(projectId);
 let record;try{record=JSON.parse(row.payload);}catch{fail('LIVE_CACHE_INVALID','O cache atual está inconsistente.');}
 if(!record||record.projectId!==projectId||!Number.isInteger(row.revision)||row.revision<1||!utcInstant(record.lastAttemptAt)||record.lastSuccessAt!==null&&!utcInstant(record.lastSuccessAt))fail('LIVE_CACHE_INVALID','O cache atual está inconsistente.');
 if(record.snapshot!==null){try{snapshotOf(state,projectId,record.snapshot,Infinity,false);}catch{fail('LIVE_CACHE_INVALID','A leitura salva no cache atual está inconsistente.');}}
 if(record.error!==null&&(!record.error||typeof record.error.code!=='string'||typeof record.error.message!=='string'||!utcInstant(record.error.at)))fail('LIVE_CACHE_INVALID','O erro salvo no cache atual está inconsistente.');
 return {...record,revision:row.revision};
}
async function load(db,state,projectId){const row=await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key=?').bind('live:'+projectId).first();return decode(row,projectId,state);}
export async function readLiveData(db,state,projectId){
 const projects=(projectId===undefined?configured(state):[projectOf(state,projectId)]).map(project=>({...project,trackedTargets:trackedTargets(state,project.projectId)})),items=[];
 for(let offset=0;offset<projects.length;offset+=50){
  const part=projects.slice(offset,offset+50),keys=part.map(p=>'live:'+p.projectId);
  const result=await db.prepare(`SELECT key,payload,revision,updated_at FROM bunker_records WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all();
  if(result.success===false||!Array.isArray(result.results))fail('LIVE_READ_FAILED','Não foi possível ler os dados atuais.');
  const rows=new Map(result.results.map(r=>[r.key,r]));
  for(const p of part){const row=rows.get('live:'+p.projectId);try{items.push(decode(row,p.projectId,state));}catch{items.push({...emptyItem(p.projectId),revision:row?.revision||0,error:{code:'LIVE_CACHE_INVALID',message:'O cache deste projeto está inconsistente e precisa de conferência.',at:utcInstant(row?.updated_at)?row.updated_at:null}});}}
 }
 return {projects,paused:state.paused===true,items,pollIntervalSeconds:liveDataLimits.pollIntervalSeconds};
}
async function save(db,item,expected){
 const record={...item};delete record.revision;const payload=JSON.stringify(record);if(encoder.encode(payload).byteLength>liveDataLimits.maxRecordBytes)fail('LIVE_LIMIT','O cache atual excede o limite de armazenamento. Nenhuma linha foi descartada.');
 const stmt=expected===0?db.prepare('INSERT OR IGNORE INTO bunker_records (key,payload,revision,updated_at) VALUES (?,?,?,?)').bind('live:'+item.projectId,payload,1,item.lastAttemptAt):db.prepare('UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?').bind(payload,expected+1,item.lastAttemptAt,'live:'+item.projectId,expected);
 const result=await stmt.run();if(!result.meta?.changes)fail('LIVE_CONFLICT','O cache mudou durante a sincronização. Releia o projeto antes de tentar novamente.');
 return {...record,revision:expected+1};
}
export async function liveDataAction(db,state,input,now=Date.now()){
 requestOf(input);
 if(input.action==='read')return readLiveData(db,state,input.projectId);
 if(state.paused===true)fail('LIVE_PAUSED','O escritório está pausado. A última leitura foi preservada.');
 const project=projectOf(state,input.projectId),at=clock(now),expected=revisionOf(input.expectedRevision,input.action==='failure'),current=await load(db,state,project.projectId);
 if(input.action==='import'){
  const snapshot=snapshotOf(state,project.projectId,input.snapshot,at.time,true),before=current.snapshot&&Date.parse(current.snapshot.fetchedAt),fetched=Date.parse(snapshot.fetchedAt);
  if(before!==null&&before!==undefined&&fetched<=before){
   if(fetched===before&&JSON.stringify(snapshot)===JSON.stringify(current.snapshot))return {ok:true,unchanged:true,item:copy(current),revision:current.revision};
   fail(fetched<before?'LIVE_STALE_SNAPSHOT':'LIVE_CONFLICT',fetched<before?'Uma leitura mais recente já está salva.':'A mesma data de consulta não pode substituir uma leitura diferente.');
  }
  if(expected!==null&&expected!==current.revision)fail('LIVE_CONFLICT','O cache mudou. Releia a revisão deste projeto.');
  const item=await save(db,{projectId:project.projectId,snapshot,lastAttemptAt:at.iso,lastSuccessAt:at.iso,error:null,revision:current.revision},current.revision);return {ok:true,item,revision:item.revision};
 }
 if(expected!==current.revision)fail('LIVE_CONFLICT','O cache mudou. Não registre uma falha antiga sobre uma sincronização nova.');
 const error=input.error;if(!error||typeof error!=='object'||Array.isArray(error)||typeof error.code!=='string'||!error.code.match(/^[A-Z][A-Z0-9_]{0,59}$/)||typeof error.message!=='string'||!error.message.trim()||error.message.length>500)fail('LIVE_INVALID_REQUEST','Informe código e mensagem curta da falha da coleta.');
 const item=await save(db,{projectId:project.projectId,snapshot:current.snapshot,lastAttemptAt:at.iso,lastSuccessAt:current.lastSuccessAt,error:{code:error.code,message:error.message.trim(),at:at.iso},revision:current.revision},current.revision);return {ok:true,item,revision:item.revision};
}
