import {reconcileCampaignObservations} from './campaign-observation.mjs';
import {officeMessageTarget,retainOfficeMessages,assertOfficeQueueCapacity,answerOfficeMessage} from './office.mjs';
import {reportsQuery,reportPage} from './report-archive.mjs';
import {suggestionHistoryQuery,suggestionHistoryPage} from './suggestion-history.mjs';
import {verifyDecision} from './reporting.mjs';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {bundleSchema} from './snapshot-schema.mjs';
import {cadenceSchema,updateRun} from './agent-state';
import {readPersistedState,commitPersistedState} from './persistence.mjs';
import {retainKnowledgeMeasurements} from './knowledge.mjs';
const label=z.string().max(2500), number=z.number().finite().min(-1e12).max(1e12).nullable().optional();
export const empty=()=>({snapshots:[],config:{},tasks:[],decisions:[],jobs:[],messages:[],reports:[],events:[],paused:false});
export async function readState(){
 if(!env.DB)throw new Error('Base de dados indisponível.');
 return readPersistedState(env.DB,empty);
}
export async function readRevision(){
 if(!env.DB)throw new Error('Base de dados indisponível.');
 const r=await env.DB.prepare('SELECT revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first<any>();
 return {revision:r?.revision||0,updatedAt:r?.updated_at||null};
}
export async function readReports(project:string,limit=20,cursor:string|null=null){
 if(!env.DB)throw new Error('Base de dados indisponível.');
 const q=reportsQuery(project,limit,cursor);
 const result=await env.DB.prepare(q.sql).bind(...q.params).all<any>();
 return reportPage(result.results||[],q.limit);
}
export async function commit(state:any,revision:number){
 if(!env.DB)throw new Error('Base de dados indisponível.');
 return commitPersistedState(env.DB,state,revision);
}

export async function readCollaborationHistory(project:string,limit=10,cursor:string|null=null){
 if(!project||project.length>250)throw new Error('Projeto inválido.');
 const count=Math.max(1,Math.min(20,Number(limit)||10));let anchor:string|null=null;
 if(cursor){if(cursor.length>100)throw new Error('Cursor inválido.');anchor=cursor;}
 const result=await env.DB!.prepare("SELECT key,payload,updated_at FROM bunker_records WHERE key LIKE 'collaboration:%' AND json_extract(payload,'$.round.project')=? AND (? IS NULL OR updated_at || '|' || key < ?) ORDER BY updated_at DESC,key DESC LIMIT ?").bind(project,anchor,anchor,count+1).all<any>();
 const rows=result.results||[],page=rows.slice(0,count),last=page.at(-1);
 return {items:page.map((r:any)=>JSON.parse(r.payload)),nextCursor:rows.length>count&&last?last.updated_at+'|'+last.key:null};
}
export async function readSuggestionHistory(project:string,limit=10,cursor:string|null=null){
 if(!env.DB)throw new Error('Base de dados indisponível.');
 const current=await readState();
 if(!Object.prototype.hasOwnProperty.call(current.state.config||{},project))throw new Error('Projeto não configurado.');
 const query=suggestionHistoryQuery(project,limit,cursor);
 const result=await env.DB.prepare(query.sql).bind(...query.params).all<any>();
 if(!Array.isArray(result.results))throw new Error('Histórico de sugestões indisponível.');
 return suggestionHistoryPage(result.results||[],query);
}
export function apply(state:any,input:any){
 const now=new Date().toISOString(),uid=()=>crypto.randomUUID();const event=(text:string)=>state.events.unshift({id:uid(),at:now,text});
 switch(input.op){
 case 'import':{
 retainKnowledgeMeasurements(state);
 const {snapshots}=bundleSchema.parse(input.bundle);
 for(const s of snapshots){
 if(s.coverage)throw new Error('O recorte de acompanhamento não pode substituir as fontes completas de análise.');
 const previous=state.snapshots.find((x:any)=>x.projectId===s.projectId&&x.period===s.period&&x.level===s.level);
 if(previous&&Date.parse(s.fetchedAt)<Date.parse(previous.fetchedAt))throw new Error('Leitura anterior à base salva. Consulte novamente o Malva.');
 if(previous&&s.fetchedAt===previous.fetchedAt&&JSON.stringify(previous)!==JSON.stringify(s))throw new Error('A mesma data de consulta possui conteúdo diferente.');
 }
 const observed=reconcileCampaignObservations(state,snapshots);
 for(const s of snapshots){
 if(Date.parse(s.fetchedAt)>Date.now()+300000)throw new Error('Data de consulta no futuro.');
 const ids=new Set();for(const r of s.rows){const k=r.adAccountId+':'+r.externalId;if(ids.has(k))throw new Error('Objeto duplicado na mesma janela.');ids.add(k);}
 state.snapshots=state.snapshots.filter((x:any)=>!(x.projectId===s.projectId&&x.period===s.period&&x.level===s.level));state.snapshots.push(s);
 if(!state.config[s.projectId])state.config[s.projectId]={projectName:s.projectName,targetRoas:s.projectName==='Gabe'?2:null,testHours:s.projectName==='Gabe'?24:null,dailyCap:null,lossCap:null,cpcMax:s.projectName==='Gabe'?6:null,cpmMax:s.projectName==='Gabe'?160:null,icMax:s.projectName==='Gabe'?70:null};
 }if(observed.inserted)event(`${observed.inserted} mudanças de status/orçamento observadas. Nova avaliação necessária; origem não atribuída.`);event(`${snapshots.length} leituras importadas. Nenhuma campanha alterada.`);break;}
 case 'task':state.tasks.unshift({id:uid(),title:z.string().min(1).max(500).parse(input.title),project:label.parse(input.project),owner:z.string().max(200).parse(input.owner||''),due:z.string().max(20).parse(input.due||''),status:'Fila',createdAt:now});event('Demanda interna criada.');break;
 case 'taskStatus':{const t=state.tasks.find((x:any)=>x.id===input.id);if(!t)throw new Error('Demanda não encontrada.');t.status=z.enum(['Fila','Hoje','Em execução','Aguardando','Concluído']).parse(input.status);event(`${t.title}: ${t.status}.`);break;}
 case 'decision':state.decisions.unshift({id:uid(),objectId:label.parse(input.objectId),project:label.parse(input.project),name:label.parse(input.name),account:label.parse(input.account),action:label.parse(input.action),reason:label.parse(input.reason),before:number.parse(input.before)??null,after:number.parse(input.after)??null,note:'',status:'Proposta',createdAt:now});event('Proposta registrada para revisão.');break;
 case 'decisionStatus':{const d=state.decisions.find((x:any)=>x.id===input.id);if(!d)throw new Error('Proposta não encontrada.');const status=z.enum(['Proposta','Aprovada','Recusada','Aplicada pelo operador']).parse(input.status);const note=z.string().max(2500).parse(input.note||'');if(verifyDecision(d,status,input.confirmed,now)){d.note=note;event(`${d.name}: ${d.status}.`);}break;}
 case 'job':{
 if(state.paused)throw new Error('Escritório pausado. Retome para solicitar uma rodada.');
 const project=label.parse(input.project);if(state.jobs.some((j:any)=>j.project===project&&j.status==='Pendente'))throw new Error('Já existe uma rodada pendente para esse projeto.');
 state.jobs.unshift({id:uid(),project,status:'Pendente',createdAt:now,note:'Aguardando coleta por agente conectado. Nenhuma alteração externa permitida.'});event('Rodada solicitada. Aguarda agente conectado.');break;}
 case 'jobStatus':{const j=state.jobs.find((x:any)=>x.id===input.id);if(!j)throw new Error('Rodada não encontrada.');const status=z.enum(['Pendente','Em análise','Concluída','Cancelada','Falhou']).parse(input.status);const note=z.string().max(12000).parse(input.note||j.note||'');updateRun(state,j,status,note);event(`Rodada ${status.toLowerCase()}.`);break;}
 case 'cadence':state.cadence=cadenceSchema.parse(input.cadence);event('Cadência de revisão personalizada salva.');break;
 case 'config':state.config[label.parse(input.project)]=z.object({projectName:label,targetRoas:z.number().min(0).max(100).nullable(),dailyCap:z.number().min(0).max(1e9).nullable(),lossCap:z.number().min(0).max(1e9).nullable(),testHours:z.number().min(0).max(720).nullable(),cpcMax:z.number().min(0).max(1e6).nullable(),cpmMax:z.number().min(0).max(1e6).nullable(),icMax:z.number().min(0).max(1e6).nullable()}).parse(input.config);event('Parâmetros internos atualizados.');break;
 case 'pause':state.paused=z.boolean().parse(input.value);event(state.paused?'Escritório pausado.':'Escritório retomado.');break;
 case 'message':{const project=label.parse(input.project),target=officeMessageTarget(input.agentId,project,state.config);assertOfficeQueueCapacity(state.messages);state.messages.unshift({id:uid(),project,text:z.string().min(1).max(4000).parse(input.text),...target,createdAt:now,status:'Pendente'});event(target.agentName?`Pergunta registrada para ${target.agentName}.`:'Pergunta registrada para o agente.');break;}
 case 'answer':{const m=state.messages.find((x:any)=>x.id===input.id);if(!m)throw new Error('Pergunta não encontrada.');answerOfficeMessage(m,z.string().min(1).max(12000).parse(input.text),now);break;}
 case 'report':state.reports.unshift({id:uid(),project:label.parse(input.project),title:z.string().max(500).parse(input.title),text:z.string().max(50000).parse(input.text),createdAt:now});event('Relatório salvo.');break;
 default:throw new Error('Ação não permitida.');}
 state.events=state.events.slice(0,120);
 const collaborationJobs=new Set((state.collaborationRounds||[]).map((r:any)=>r.jobId));
 const protectedJobs=state.jobs.filter((j:any)=>['Pendente','Em análise'].includes(j.status)||collaborationJobs.has(j.id));
 const settledJobs=state.jobs.filter((j:any)=>!protectedJobs.includes(j)).slice(0,Math.max(0,80-protectedJobs.length));
 const retainedJobs=new Set([...protectedJobs,...settledJobs]);state.jobs=state.jobs.filter((j:any)=>retainedJobs.has(j));
 state.messages=retainOfficeMessages(state.messages);state.reports=state.reports.slice(0,30);state.decisions=state.decisions.slice(0,250);state.tasks=state.tasks.slice(0,250);return state;
}
