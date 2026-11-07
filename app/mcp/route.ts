import {executorControl} from '@/lib/executor-control';
import {cloudMalvaClient} from '@/lib/cloud-malva.mjs';
import {cloudOrbitaClient} from '@/lib/cloud-orbita.mjs';
import {readMalvaSource} from '@/lib/malva-api-read.mjs';
import {readReviewContext} from '@/lib/review-pipeline.mjs';
import {readState,readReports,readSuggestionHistory,commit,apply} from '@/lib/state';
import {agentView,reserveRequest} from '@/lib/mcp-run';
import {readLiveData} from '@/lib/live-data.mjs';
import {storage} from '@/lib/storage';
import {campaignWatchPlan} from '@/lib/campaign-watch.mjs';
import {contingencyObservation} from '@/lib/decision-contingency.mjs';
import {updateCreativeState} from '@/lib/creative-state';
import {agentAutonomy,collaborationRead} from '@/lib/autonomy';
import {autonomyTools} from '@/lib/autonomy-tools';
import {readDecisionExamples} from '@/lib/decision-learning-view.mjs';
import {updateLiveState,assertCurrentExecutionContingency} from '@/lib/live-state';
import {parseLiveDataEnvelope} from '@/lib/live-data.mjs';
import {updateDailyState} from '@/lib/campaign-daily-state';
import {parseDailyDataEnvelope} from '@/lib/campaign-daily-data.mjs';
export const dynamic='force-dynamic';
const tools=[...autonomyTools,
{name:'bunker_dados_diarios',description:'Cache visual de resultado por dia, separado das análises e aprovações. pending lista apenas pedidos de leitura feitos no modal; read lê uma campanha exata; import/failure exigem expectedRevision próprio e identidade exata. O relay local consulta tracking_ad_detail. Não altera campanhas, estado central ou permissões de execução.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['read','pending','import','failure']},projectId:{type:'string'},adAccountId:{type:'string'},objectId:{type:'string'},snapshot:{type:'object'},error:{type:'object'},expectedRevision:{type:'integer',minimum:0}},required:['action'],additionalProperties:false}},
{name:'bunker_dados_atuais',description:'Lê ou atualiza somente o cache visual de campanhas de hoje, separado das fontes das análises, escolhas e aprovações. read lista projetos configurados e cache com revisão por projeto. import exige leitura Malva MCP completa e fresca, janela de hoje e identidade exata; expectedRevision protege concorrência. failure exige expectedRevision e erro curto, preservando a última leitura válida. Não consulta nem altera campanhas no provedor.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['read','import','failure']},projectId:{type:'string'},snapshot:{type:'object'},error:{type:'object',properties:{code:{type:'string'},message:{type:'string',maxLength:500}},required:['code','message'],additionalProperties:false},expectedRevision:{type:'integer',minimum:0}},required:['action'],additionalProperties:false}},
{name:'bunker_relatorios',description:'Lê o histórico persistido por projeto, incluindo relatórios anteriores ao buffer recente da central. Somente leitura, com paginação.',inputSchema:{type:'object',properties:{projectId:{type:'string'},limit:{type:'integer',minimum:1,maximum:10},cursor:{type:'string'}},required:['projectId'],additionalProperties:false}},
{name:'bunker_ler',description:'Lê resumo, configuração de cadência, projetos elegíveis, perguntas e rodadas. As leituras são resumidas com contagens e totais, sem repetir todas as linhas. Não altera plataformas externas.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
{name:'bunker_importar_leituras',description:'Grava dados Malva coletados e conferidos na central, sem alterar campanhas. Ler bunker_ler antes e usar revision atual. Contrato exportável no app.',inputSchema:{type:'object',properties:{revision:{type:'integer'},bundle:{type:'object',properties:{snapshots:{type:'array',maxItems:40,items:{type:'object'}}},required:['snapshots']}},required:['revision','bundle'],additionalProperties:false}},
{name:'bunker_atualizar_rodada',description:'Atualiza a fila interna. Para reservar sem ferramenta nova, use id project:UUID e Em análise conforme startRequest de bunker_ler; retorna o ID real do job. Só concluir após coletar e conferir o escopo. Compatibilidade de dados atuais: id live-data, status Pendente, revision 0 e note com JSON do pedido bunker_dados_atuais (action read/import/failure e expectedRevision próprio do projeto). Esse envelope acessa somente o cache visual, sem alterar a fila, revisão central, fontes de análise ou campanhas.',inputSchema:{type:'object',properties:{revision:{type:'integer'},id:{type:'string'},status:{type:'string',enum:['Pendente','Em análise','Concluída','Cancelada','Falhou']},note:{type:'string'}},required:['revision','id','status'],additionalProperties:false}},
{name:'bunker_responder',description:'Grava resposta com evidências na central. Não envia mensagens a terceiros.',inputSchema:{type:'object',properties:{revision:{type:'integer'},id:{type:'string'},text:{type:'string'}},required:['revision','id','text'],additionalProperties:false}},
{name:'bunker_iniciar_rodada',description:'Reserva uma revisão elegível conforme cadência salva, pausa e fila manual. Evita sobreposição; retorna ID real para concluir após a coleta. Somente base Bunker.',inputSchema:{type:'object',properties:{revision:{type:'integer'},projectId:{type:'string'},project:{type:'string',description:'Alias compatível de projectId.'}},required:['revision'],anyOf:[{required:['projectId']},{required:['project']}],additionalProperties:false}}
];
export async function POST(req:Request){let id:any=null;const json=(x:any)=>Response.json(x,{headers:{'Cache-Control':'private, no-store'}});
 try{const body=await req.text();if(body.length>1500000)throw new Error('Pedido acima do limite.');const r=JSON.parse(body);id=r.id;let result:any;
 if(r.method==='notifications/initialized')return new Response(null,{status:202});
 if(r.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
 else if(r.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'bunker-trafego',version:'1.2.0'}};
 else if(r.method==='tools/list')result={tools};
 else if(r.method==='tools/call'&&r.params?.name==='bunker_atualizar_rodada'&&r.params?.arguments?.id==='cloud-data'){const a=r.params.arguments;
  // Executor/identity reads never need the central: keep them available while the central is slow.
  if(a.revision!==0||a.status!=='Pendente')throw Error('Envelope inválido.');const input=JSON.parse(a.note||'{}');if(!['status','identity','orbitaIdentity','shadow'].includes(input.action))throw Error('Somente leitura.');result={content:[{type:'text',text:JSON.stringify(input.action==='status'?await executorControl({action:'status'}):input.action==='shadow'?await executorControl({action:'shadow'}):input.action==='orbitaIdentity'?await cloudOrbitaClient(storage()).read('quem_sou_eu',{}):await cloudMalvaClient(storage()).read('workspace_whoami',{}))}]};
 }
 else if(r.method==='tools/call'){const {name,arguments:a={}}=r.params||{};const cur=await readState();
 if(name==='bunker_atualizar_rodada'&&a.id==='source-data'){
  if(a.revision!==0||a.status!=='Pendente')throw Error('Envelope de origem inválido.');
  result={content:[{type:'text',text:JSON.stringify(await readMalvaSource(storage(),cur.state,JSON.parse(a.note||'{}')))}]};
 }
 else if(name==='bunker_atualizar_rodada'&&a.id==='review-data'){
  if(a.revision!==0||a.status!=='Pendente')throw Error('Envelope de revisão inválido.');
  const args=JSON.parse(a.note||'{}');result={content:[{type:'text',text:JSON.stringify({revision:cur.revision,...readReviewContext(cur.state,args)})}]};
 }
 else if(name==='bunker_dados_diarios'){
  if(a.action==='request')throw new Error('Pedidos de diário são feitos pela interface autenticada.');
  result={content:[{type:'text',text:JSON.stringify(await updateDailyState(a,cur.state))}]};
 }
 else if(name==='bunker_atualizar_rodada'&&a.id==='daily-data'){
  const input=parseDailyDataEnvelope(a);if(input.action==='request')throw new Error('Pedidos de diário são feitos pela interface autenticada.');
  result={content:[{type:'text',text:JSON.stringify(await updateDailyState(input,cur.state))}]};
 }
 else if(name==='bunker_dados_atuais')result={content:[{type:'text',text:JSON.stringify(await updateLiveState(a,cur.state))}]};
 else if(name==='bunker_atualizar_rodada'&&a.id==='live-data')result={content:[{type:'text',text:JSON.stringify(await updateLiveState(parseLiveDataEnvelope(a),cur.state))}]};
 else if(name==='bunker_atualizar_rodada'&&a.id==='creative-data'){if(a.revision!==0||a.status!=='Pendente')throw Error('Envelope Órbita inválido.');result={content:[{type:'text',text:JSON.stringify(await updateCreativeState(JSON.parse(a.note||'{}'),cur.state))}]};}
 else if(name==='bunker_relatorios')result={content:[{type:'text',text:JSON.stringify(await readReports(a.projectId,a.limit??5,a.cursor||null))}]};
 else if(name==='bunker_ler'){const live=await readLiveData(storage(),cur.state).catch(()=>({items:[],error:'Leitura de acompanhamento indisponível; análise anterior preservada.'}));result={content:[{type:'text',text:JSON.stringify(agentView(cur,live))}]};}
 else if(name==='bunker_atualizar_rodada'&&a.id==='contingency-data'){
  const input=JSON.parse(a.note||'{}');if(a.revision!==0||a.status!=='Pendente'||input.action!=='read'||typeof input.executionId!=='string'||Object.keys(input).some(k=>!['action','executionId'].includes(k)))throw Error('Envelope de contingência inválido.');
  const execution=(cur.state.executions||[]).find((e:any)=>e.id===input.executionId);if(!execution)throw Error('Execução não encontrada.');
  const live=await readLiveData(storage(),cur.state,execution.project);result={content:[{type:'text',text:JSON.stringify({revision:cur.revision,observation:contingencyObservation(cur.state,live.items,input.executionId)})}]};
 }
 else if(name==='bunker_atualizar_rodada'&&a.id==='watch-data'){
  const input=JSON.parse(a.note||'{}');if(a.revision!==0||a.status!=='Pendente'||input.action!=='read'||Object.keys(input).some(k=>!['action','projectId','offset','limit'].includes(k)))throw Error('Envelope de acompanhamento inválido.');
  const live=await readLiveData(storage(),cur.state);result={content:[{type:'text',text:JSON.stringify({revision:cur.revision,...campaignWatchPlan(cur.state,live,Date.now(),input)})}]};
 }
 else if(name==='bunker_colaboracao'||(name==='bunker_atualizar_rodada'&&a.id==='collaboration')){
  const args=name==='bunker_colaboracao'?a:JSON.parse(a.note||'{}');
  if(args.action==='decisionRead'&&args.entry?.journal==='suggestions'){
   if(!args.projectId||!Object.hasOwn(cur.state.config,args.projectId))throw new Error('Informe um projeto configurado para ler o histórico de sugestões.');
   result={content:[{type:'text',text:JSON.stringify({revision:cur.revision,...await readSuggestionHistory(args.projectId,args.limit??10,args.cursor||null)})}]};
  }
  else if(args.action==='read'||args.action==='learningRead'||args.action==='decisionRead')result={content:[{type:'text',text:JSON.stringify({revision:cur.revision,...(args.action==='decisionRead'?readDecisionExamples(cur.state,args):collaborationRead(cur.state,args))})}]};
  else{if(a.revision!==cur.revision)throw new Error('CONFLICT: releia o estado.');await assertCurrentExecutionContingency(cur.state,args);const record=agentAutonomy(cur.state,args);const saved=await commit(cur.state,cur.revision);result={content:[{type:'text',text:JSON.stringify({ok:true,revision:saved.revision,record})}]};}
 }
 else if(name==='bunker_iniciar_rodada'||(name==='bunker_atualizar_rodada'&&a.status==='Em análise'&&(a.id?.startsWith('project:')||a.id==='projects:due'))){if(a.revision!==cur.revision)throw new Error('CONFLICT: releia o estado.');const c=reserveRequest(cur.state,a);const saved=await commit(c.state,cur.revision);result={content:[{type:'text',text:JSON.stringify({revision:saved.revision,...('jobs' in c?{jobs:c.jobs}:{job:c.job})})}]};}
 else{if(a.revision!==cur.revision)throw new Error('CONFLICT: releia o estado.');const op=name==='bunker_importar_leituras'?'import':name==='bunker_atualizar_rodada'?'jobStatus':name==='bunker_responder'?'answer':null;if(!op)throw new Error('Ferramenta não permitida.');const s=await commit(apply(cur.state,{...a,op}),cur.revision);result={content:[{type:'text',text:JSON.stringify({ok:true,revision:s.revision,updatedAt:s.updatedAt})}]};}}
 else return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Método não disponível.'}});
 return json({jsonrpc:'2.0',id,result});
 }catch(e:any){const message=e.message||'Falha ao processar.',code=typeof e.code==='string'&&(e.code.startsWith('LIVE_')||e.code.startsWith('DAILY_'))?e.code:e.code==='STORAGE_LIMIT'?'STORAGE_LIMIT':e.name==='ZodError'?'VALIDATION_ERROR':message.startsWith('CONFLICT')?'CONFLICT':'REQUEST_FAILED';console.error('Bunker MCP request failed',{code});return json({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:message}],structuredContent:{ok:false,error:{code,message}}}});}}
