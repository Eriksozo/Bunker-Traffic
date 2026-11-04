/** Read-only Órbita collector. No source transitions, ads writes or model calls. */
export const CREATIVE_TOOL='bunker_otimiza_o_de_campanhas.bunker_dados_criativos';
export const ORBITA_TOOLS=Object.freeze(['quem_sou_eu','listar_cadastros','listar_producoes','listar_lateralizacoes']);
const arr=x=>Array.isArray(x)?x:[],canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
export function expertBindings(projects,catalogs){
 const result=new Map();
 for(const p of projects){const name=normalize(p.projectName),matches=[];
  for(const {squad,catalog} of catalogs)for(const expert of arr(catalog.experts)){
   const matchesName=normalize(expert.sigla)===name||normalize(expert.nome).split(' ')[0]===name||name==='JOHN'&&normalize(expert.sigla)==='JHON';
   if(matchesName)matches.push({squad,expertId:expert.id,expertName:expert.nome,expertSigla:expert.sigla});
  }
  if(matches.length===1)result.set(p.projectId,matches[0]);
 }
 return result;
}
export function creativeSnapshot(p,b,productions,variants,now){
 if(!Array.isArray(productions)||!Array.isArray(variants)||productions.length+variants.length>1000)throw Error('ORBITA_SOURCE_LIMIT');
 const rows=[];
 for(const [kind,list] of [['production',productions],['variant',variants]])for(const value of list){
  if(kind==='production'?value.expert!==b.expertName:value.expert!==b.expertSigla)throw Error('ORBITA_IDENTITY');
  const updated=kind==='production'?value.ultimaMudanca??null:null;
  rows.push({id:value.id,kind,name:kind==='production'?value.nome:value.nomeCanonico,metaName:kind==='variant'?value.nomeMeta??null:null,status:kind==='production'?value.estado:value.etapa,result:kind==='variant'?value.resultado??null:null,origin:kind==='variant'?value.origemChave??null:null,expert:b.expertSigla,sourceUpdatedAt:updated});
 }
 return {source:'Órbita MCP',projectId:p.projectId,projectName:p.projectName,fetchedAt:new Date(now).toISOString(),lastSyncAt:null,coverage:'returned-items-only',binding:b,rows};
}
export class CreativeRelay{
 constructor({client,workspaceId,siteId,now=Date.now,log=()=>{}}){Object.assign(this,{client,workspaceId,siteId,now,log});this.nextAt=0;this.running=false;}
 async read(projectId){const s=await this.client.callTool('codex_apps',CREATIVE_TOOL,{action:'read',...(projectId?{projectId}:{})});if(s.siteProjectId!==this.siteId||!Array.isArray(s.projects)||!Array.isArray(s.items))throw Error('ORBITA_BUNKER_IDENTITY');return s;}
 async runOnce(){
  if(this.running||this.now()<this.nextAt)return {imported:0,failed:0};this.running=true;this.nextAt=this.now()+60000;
  let state;let imported=0,failed=0;
  try{
   await this.client.ensureReady({source:false});state=await this.read();if(state.paused)return {imported,failed};
   if(!this.client.orbitaReady)throw Error('ORBITA_UNAVAILABLE');
   const who=await this.client.callTool('dashops','quem_sou_eu',{}),malva=await this.client.callTool('malva','workspace_whoami',{});
   if(!who.email||who.email!==malva.person?.email||malva.workspace?.id!==this.workspaceId||!Array.isArray(who.squads))throw Error('ORBITA_IDENTITY');
   const catalogs=[];for(const squad of who.squads){if(typeof squad.sigla!=='string')throw Error('ORBITA_IDENTITY');const catalog=await this.client.callTool('dashops','listar_cadastros',{squad:squad.sigla});catalogs.push({squad:squad.sigla,catalog});}
   const bindings=expertBindings(state.projects,catalogs);
   for(const p of state.projects){
    let expected;
    try{
     const before=await this.read(p.projectId);if(before.paused)break;expected=before.items[0]?.revision;const b=bindings.get(p.projectId);if(!b)throw Error('ORBITA_IDENTITY');
     const common={squad:b.squad,siglaExpert:b.expertSigla,limite:100};
     const productions=await this.client.callTool('dashops','listar_producoes',{...common,estados:['BRIEFING','COPY_EM_PRODUCAO','COPY_EM_VALIDACAO','COPY_EM_AJUSTE','AGUARDANDO_GRAVACAO','GRAVADO','NAO_GRAVADO','FILA_EDICAO','EM_EDICAO','EM_REVISAO','AJUSTES_SOLICITADOS','APROVADO','REPROVADO','EM_TRAFEGO','ENCERRADO','BLOQUEADO','USADO','STANDBY']});
     const variants=await this.client.callTool('dashops','listar_lateralizacoes',common),snapshot=creativeSnapshot(p,b,productions,variants,this.now());
     const latest=await this.read(p.projectId);if(latest.paused||latest.items[0]?.revision!==expected)continue;
     // A sent/ambiguous write is never retried or overwritten with a failure.
     expected=undefined;const result=await this.client.callTool('codex_apps',CREATIVE_TOOL,{action:'import',projectId:p.projectId,expectedRevision:latest.items[0].revision,snapshot});
     const readback=await this.read(p.projectId),saved=readback.items[0];
     if(!result.ok||!Number.isSafeInteger(result.revision)||saved?.revision<result.revision||canonical(saved.snapshot)!==canonical(snapshot))throw Error('ORBITA_WRITE_UNCONFIRMED');
     imported++;this.log({event:'creative_synced',projectId:p.projectId,rows:snapshot.rows.length,fetchedAt:snapshot.fetchedAt,revision:saved.revision});
    }catch(error){failed++;this.log({event:'creative_failed',projectId:p.projectId,code:error.message.startsWith('ORBITA_')?error.message:'ORBITA_UNAVAILABLE'});if(expected!==undefined)await this.failure(p,expected).catch(()=>{});}
   }
  }catch{failed++;this.log({event:'creative_unavailable',code:'ORBITA_UNAVAILABLE'});if(state&&!state.paused)for(const p of state.projects)await this.failure(p,state.items.find(i=>i.projectId===p.projectId)?.revision).catch(()=>{});}
  finally{this.running=false;}
  return {imported,failed};
 }
 async failure(p,revision){const s=await this.read(p.projectId);if(s.paused||s.items[0]?.revision!==revision)return;await this.client.callTool('codex_apps',CREATIVE_TOOL,{action:'failure',projectId:p.projectId,expectedRevision:revision,error:{code:'ORBITA_UNAVAILABLE',message:'A consulta Órbita não foi concluída. A última leitura foi preservada.'}});}
}
