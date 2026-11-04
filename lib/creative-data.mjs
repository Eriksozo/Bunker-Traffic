/** Órbita metadata cache, strictly separate from ad metrics and approvals. */
const copy=x=>JSON.parse(JSON.stringify(x)),own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k),instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const fail=message=>{throw Error(message);};
export const creativeLimits=Object.freeze({rows:1000,bytes:900000,freshnessMs:600000,pollIntervalSeconds:60});
const empty=projectId=>({projectId,snapshot:null,error:null,lastSuccessAt:null,lastAttemptAt:null,revision:0});
function project(state,id){if(typeof id!=='string'||!own(state.config,id))fail('Projeto de criativos não configurado.');return {projectId:id,projectName:state.config[id].projectName};}
export async function readCreativeData(db,state,id){
 const projects=id?[project(state,id)]:Object.keys(state.config||{}).map(id=>project(state,id));if(projects.length>500)fail('Projetos acima do limite.');
 if(!projects.length)return {projects,items:[],paused:!!state.paused};
 const r=await db.prepare(`SELECT key,payload,revision,updated_at FROM bunker_records WHERE key IN (${projects.map(()=>'?').join(',')})`).bind(...projects.map(p=>'creative:'+p.projectId)).all();
 if(r.success===false||!Array.isArray(r.results))fail('Cache Órbita indisponível.');
 const byKey=new Map(r.results.map(row=>[row.key,row]));
 return {projects,paused:!!state.paused,pollIntervalSeconds:60,items:projects.map(p=>{const row=byKey.get('creative:'+p.projectId);if(!row)return empty(p.projectId);let item;try{item=JSON.parse(row.payload);}catch{fail('Cache Órbita inválido.');}if(item.projectId!==p.projectId||!Number.isSafeInteger(row.revision))fail('Cache Órbita inválido.');return {...item,revision:row.revision};})};
}
export function validateCreativeSnapshot(input,p,now){
 if(input&&Object.keys(input).some(k=>!['source','projectId','projectName','fetchedAt','lastSyncAt','coverage','binding','rows'].includes(k)))fail('Campos Órbita não permitidos.');
 if(!input||input.source!=='Órbita MCP'||input.projectId!==p.projectId||input.projectName!==p.projectName||!instant(input.fetchedAt)||Date.parse(input.fetchedAt)>now||now-Date.parse(input.fetchedAt)>creativeLimits.freshnessMs||input.lastSyncAt!==null||input.coverage!=='returned-items-only'||!Array.isArray(input.rows)||input.rows.length>creativeLimits.rows)fail('Leitura Órbita incompleta ou incompatível.');
 const b=input.binding;if(!b||typeof b.squad!=='string'||typeof b.expertId!=='string'||typeof b.expertName!=='string'||typeof b.expertSigla!=='string')fail('Identidade Órbita ausente.');
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>creativeLimits.bytes)fail('Cache de criativos acima do limite.');
 const keys=new Set();for(const row of input.rows){if(row&&Object.keys(row).some(k=>!['id','kind','name','metaName','status','result','origin','expert','sourceUpdatedAt'].includes(k)))fail('Campos de criativo não permitidos.');if(!row||!['production','variant'].includes(row.kind)||typeof row.id!=='string'||!row.id||typeof row.name!=='string'||!row.name||typeof row.status!=='string'||row.expert!==b.expertSigla||row.sourceUpdatedAt!==null&&(!instant(row.sourceUpdatedAt)||Date.parse(row.sourceUpdatedAt)>Date.parse(input.fetchedAt)))fail('Registro de criativo inválido.');const key=row.kind+':'+row.id;if(keys.has(key))fail('Criativo duplicado.');keys.add(key);}
 return copy(input);
}
export async function creativeDataAction(db,state,input,now=Date.now()){
 if(!input||Object.keys(input).some(k=>!['action','projectId','snapshot','error','expectedRevision'].includes(k))||!['read','import','failure'].includes(input.action))fail('Pedido Órbita inválido.');
 if(input.action==='read')return readCreativeData(db,state,input.projectId);
 if(state.paused)fail('Bunker pausado.');
 const p=project(state,input.projectId),current=(await readCreativeData(db,state,p.projectId)).items[0];
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==current.revision)fail('CONFLICT: releia o cache Órbita.');
 let snapshot=current.snapshot,error=null;
 if(input.action==='import'){
  snapshot=validateCreativeSnapshot(input.snapshot,p,now);
  if(current.snapshot&&Date.parse(snapshot.fetchedAt)<=Date.parse(current.snapshot.fetchedAt))fail('Leitura Órbita anterior à base.');
 }else{if(!input.error||!/^ORBITA_[A-Z_]+$/.test(input.error.code)||typeof input.error.message!=='string'||input.error.message.length>300)fail('Falha Órbita inválida.');error={...input.error,at:new Date(now).toISOString()};}
 const at=new Date(now).toISOString(),record={projectId:p.projectId,snapshot,error,lastAttemptAt:at,lastSuccessAt:input.action==='import'?at:current.lastSuccessAt};
 const payload=JSON.stringify(record),expected=current.revision,stmt=expected===0?db.prepare('INSERT OR IGNORE INTO bunker_records (key,payload,revision,updated_at) VALUES (?,?,?,?)').bind('creative:'+p.projectId,payload,1,at):db.prepare('UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?').bind(payload,expected+1,at,'creative:'+p.projectId,expected);
 const result=await stmt.run();if(!result.meta?.changes)fail('CONFLICT: cache Órbita alterado.');
 return {ok:true,revision:expected+1,item:{...record,revision:expected+1}};
}
