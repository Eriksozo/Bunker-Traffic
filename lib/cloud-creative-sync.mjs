import {expertBindings,creativeSnapshot} from '../scripts/local-creative-sync.mjs';
import {readCreativeData,creativeDataAction,validateCreativeSnapshot} from './creative-data.mjs';
import {OrbitaError} from './cloud-orbita.mjs';
export const cloudCreativePolicy=Object.freeze({minimumIntervalMs:60000,sourceLimit:100,providerWrites:false});
const states=['BRIEFING','COPY_EM_PRODUCAO','COPY_EM_VALIDACAO','COPY_EM_AJUSTE','AGUARDANDO_GRAVACAO','GRAVADO','NAO_GRAVADO','FILA_EDICAO','EM_EDICAO','EM_REVISAO','AJUSTES_SOLICITADOS','APROVADO','REPROVADO','EM_TRAFEGO','ENCERRADO','BLOQUEADO','USADO','STANDBY'];
/** On-demand refresh only inside an admitted analysis. No model or campaign writes. */
export async function syncCloudCreatives({db,state,projectId,source,malva,expectedEmail,expectedWorkspace,readCurrent,now=Date.now}){
 let data=await readCreativeData(db,state,projectId),item=data.items[0],sent=false;
 if(state.paused)return data;
 const attempted=Date.parse(item.lastAttemptAt||'');
 if(Number.isFinite(attempted)&&attempted<=now()&&now()-attempted<cloudCreativePolicy.minimumIntervalMs)return data;
 try{
  const [who,identity]=await Promise.all([source.read('quem_sou_eu',{}),malva.read('workspace_whoami',{})]);
  if(!expectedEmail||!expectedWorkspace||who.email!==expectedEmail||who.email!==identity.person?.email||identity.workspace?.id!==expectedWorkspace||!Array.isArray(who.squads)||!who.squads.length||who.squads.length>20)throw new OrbitaError('ORBITA_IDENTITY');
  const catalogs=await Promise.all(who.squads.map(async squad=>{if(typeof squad.sigla!=='string'||!squad.sigla)throw new OrbitaError('ORBITA_IDENTITY');return {squad:squad.sigla,catalog:await source.read('listar_cadastros',{squad:squad.sigla})};}));
  const p=data.projects[0],binding=expertBindings([p],catalogs).get(projectId);if(!binding)throw new OrbitaError('ORBITA_IDENTITY');
  const common={squad:binding.squad,siglaExpert:binding.expertSigla,limite:cloudCreativePolicy.sourceLimit};
  const [productions,variants]=await Promise.all([source.read('listar_producoes',{...common,estados:states}),source.read('listar_lateralizacoes',common)]);
  const snapshot=creativeSnapshot(p,binding,productions,variants,now());validateCreativeSnapshot(snapshot,p,now());
  const current=await readCurrent();if(current.paused)return readCreativeData(db,current,projectId);
  const latest=await readCreativeData(db,current,projectId);if(latest.items[0].revision!==item.revision)return latest;
  sent=true;const saved=await creativeDataAction(db,current,{action:'import',projectId,expectedRevision:item.revision,snapshot},now());
  const readback=await readCreativeData(db,current,projectId);if(readback.items[0].revision<saved.revision||JSON.stringify(readback.items[0].snapshot)!==JSON.stringify(snapshot))throw new OrbitaError('ORBITA_WRITE_UNCONFIRMED');
  return readback;
 }catch(error){
  if(sent)throw error;
  const current=await readCurrent();if(current.paused)return readCreativeData(db,current,projectId);
  const latest=await readCreativeData(db,current,projectId);if(latest.items[0].revision!==item.revision)return latest;
  const code=/^ORBITA_[A-Z_]+$/.test(error.code||error.message||'')?error.code||error.message:'ORBITA_UNAVAILABLE';
  await creativeDataAction(db,current,{action:'failure',projectId,expectedRevision:item.revision,error:{code,message:'A leitura independente da Órbita não foi confirmada. Última fonte preservada.'}},now());
  return readCreativeData(db,current,projectId);
 }
}
