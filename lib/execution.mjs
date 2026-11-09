import {approvedExecutionProposal,isLiveOrder} from './collaboration.mjs';
import {isWarmupTarget} from './campaign-scope.mjs';
import {assertExecutionIsolation,observedPerformance,postActionDelta,contingencyLimits} from './decision-contingency.mjs';

/** Pure execution journal. Only its prepared exact command may be sent by a connected worker. */
export const executionLimits=Object.freeze({leaseMs:10*60000,observationAgeMs:2*60000,max:200,attempts:3,preflightsPerAttempt:20});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy=value=>JSON.parse(JSON.stringify(value));
const uid=()=>globalThis.crypto.randomUUID();
const fail=message=>{throw Error(message);};
const timestamp=value=>{const n=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(n))fail('Data da execução inválida.');return n;};
const iso=value=>new Date(timestamp(value)).toISOString();
const text=(value,label,max=1000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label} inválido.`);return value.trim();};
const seal=value=>JSON.stringify(value);
function init(state){state.executions||=[];if(!Array.isArray(state.executions))fail('Estado do executor inválido.');}
function executionFor(state,id){init(state);const e=state.executions.find(e=>e.id===id);if(!e)fail('Execução não encontrada.');return e;}
function authorization(state,e,now,confirmation=false){return approvedExecutionProposal(state,{proposalId:e.proposalId,version:e.proposalVersion,signature:e.proposalSignature},now,confirmation);}
function lease(e,args,now){if(e.claimId!==args.claimId||e.executionRef!==args.executionRef)fail('Reserva não corresponde ao executor.');if(timestamp(e.leaseUntil)<=now)fail('Reserva do executor expirada.');}
function audit(e,kind,now,detail){e.events.push({kind,at:iso(now),...(detail?{detail}: {})});}
function sync(proposal,e){proposal.execution={...copy(e),events:undefined,prepareFingerprint:undefined,confirmFingerprint:undefined,submitFingerprint:undefined,prepareRequests:undefined};}
function observation(input,proposal,now,afterAt){
 if(!input||input.source!=='Malva MCP'||input.complete!==true||input.projectId!==proposal.project||input.level!==proposal.payload.level||!Array.isArray(input.rows))fail('Leitura completa Malva do projeto e nível exatos é obrigatória.');
 const fetched=timestamp(input.fetchedAt);if(fetched<afterAt||fetched>now+5000||now-fetched>executionLimits.observationAgeMs)fail('Leitura não é recente ou é anterior à etapa obrigatória.');
 const p=proposal.payload,matches=input.rows.filter(r=>r.externalId===p.objectId&&r.adAccountId===p.adAccountId);if(matches.length!==1)fail('Leitura deve conter uma única linha do objeto e conta aprovados.');
 const r=matches[0];if(r.projectId!==undefined&&r.projectId!==proposal.project||r.level!==undefined&&r.level!==p.level)fail('A linha declara outro projeto ou nível.');if(!uuid.test(r.id||'')||!uuid.test(proposal.project))fail('IDs internos UUID do Malva e projeto são obrigatórios; nunca usar externalId no comando.');
 if(r.provider!==p.provider||r.budgetCurrency!==p.currency)fail('Provedor ou moeda nativa não confere com a aprovação.');
 const row={id:r.id,externalId:r.externalId,adAccountId:r.adAccountId,provider:r.provider,budgetCurrency:r.budgetCurrency,dailyBudget:r.dailyBudget??null,lifetimeBudget:r.lifetimeBudget??null,status:r.status??null};
 const performance=observedPerformance(input,r);
 return {source:'Malva MCP',complete:true,projectId:input.projectId,level:input.level,fetchedAt:iso(fetched),...(input.lastSyncAt?{lastSyncAt:iso(input.lastSyncAt)}:{}),row,...(performance?{performance}:{})};
}
function valueMatches(p,observed,expected){
 if(p.action==='budget')return Number.isFinite(observed.row.dailyBudget)&&observed.row.dailyBudget===expected.dailyBudget&&!(observed.row.lifetimeBudget>0);
 return observed.row.status===expected.status;
}
function frozenTarget(state,proposal){const s=(state.snapshots||[]).find(s=>s.projectId===proposal.project&&s.period==='today'&&s.level===proposal.payload.level);const rows=(s?.rows||[]).filter(r=>r.adAccountId===proposal.payload.adAccountId&&r.externalId===proposal.payload.objectId);if(rows.length!==1)fail('Objeto ausente da fonte aprovada.');return rows[0];}
function sameFinancialScope(observed,expected,expectedStatus=expected.status){return observed.row.dailyBudget===(expected.dailyBudget??null)&&observed.row.lifetimeBudget===(expected.lifetimeBudget??null)&&observed.row.status===expectedStatus;}
function activationOwner(input,target,proposal,now,afterAt,after=false){
 const p=proposal.payload;if(p.action!=='status'||p.after.status!=='ACTIVE')return null;
 const expected=p.activationBudget;if(!expected)fail('Ativação sem contexto financeiro selado exige nova proposta e aprovação.');
 const isTarget=expected.level===p.level&&expected.externalId===p.objectId;
 const owner=isTarget?target:observation(input.budgetOwner,{project:proposal.project,payload:{level:expected.level,objectId:expected.externalId,adAccountId:expected.adAccountId,provider:expected.provider,currency:expected.currency}},now,afterAt);
 if(owner.row.id!==expected.id||!sameFinancialScope(owner,expected,after&&isTarget?p.after.status:expected.status))fail('Orçamento ou status do proprietário mudou desde a aprovação da ativação. Exige nova proposta.');
 return copy(owner);
}
function exactCommand(proposal,observed){const p=proposal.payload,args={objectId:observed.row.id,projectId:proposal.project};if(p.action==='budget')return {tool:'tracking_set_ad_budget',arguments:{...args,dailyBudget:p.after.dailyBudget}};if(p.action==='status')return {tool:'tracking_set_ad_status',arguments:{...args,status:p.after.status}};fail('O executor só aceita orçamento diário ou status aprovados.');}

export function claimExecution(state,args,now=Date.now()){
 init(state);now=timestamp(now);const proposal=approvedExecutionProposal(state,args,now),clientId=text(args.clientId,'clientId',150),executionRef=text(args.executionRef,'Referência da execução conectada',500);
 const previous=state.executions.find(e=>e.proposalId===proposal.id);
 if(previous){
  const priorRequest=[...(previous.attemptHistory||[]),previous].find(e=>e.clientId===clientId);
  if(priorRequest){if(priorRequest.executionRef!==executionRef)fail('clientId já usado por outro executor.');if(priorRequest.claimId!==previous.claimId)fail('Tentativa substituída; o trabalhador anterior não pode retomar.');return previous;}
  if(previous.submittedAt||['Enviada','Verificação necessária','Confirmada'].includes(previous.status))fail('Esta proposta já possui despacho. Não repetir a mutação; conferir o registro e a plataforma.');
  assertExecutionIsolation(state,proposal,previous.id,now);
  if(timestamp(previous.leaseUntil)>now)fail('A execução ainda possui reserva válida.');
  if((previous.attempt||1)>=executionLimits.attempts)fail('Limite de tentativas antes do envio atingido. Solicite nova revisão.');
  const prior={};for(const key of ['claimId','executionRef','clientId','claimedAt','leaseUntil','attempt','status','preparedAt','preflight','command','reason','failedAt','prepareRequests'])if(previous[key]!==undefined)prior[key]=copy(previous[key]);
  previous.attemptHistory||=[];previous.attemptHistory.push(prior);
  for(const key of ['preparedAt','preflight','command','commandFingerprint','prepareClientId','prepareFingerprint','prepareRequests','reason','failedAt','failureClientId'])delete previous[key];
  Object.assign(previous,{status:'Reservada',attempt:(previous.attempt||1)+1,claimId:uid(),executionRef,clientId,claimedAt:iso(now),leaseUntil:iso(now+executionLimits.leaseMs)});
  audit(previous,'reclaim-before-dispatch',now,{previousClaimId:prior.claimId,attempt:previous.attempt});sync(proposal,previous);return previous;
 }
 assertExecutionIsolation(state,proposal,null,now);
 if(proposal.appliedAt)fail('Proposta já aplicada.');if(state.executions.length>=executionLimits.max)fail('Limite de execuções atingido. Preserve e arquive o histórico antes de continuar.');
 const e={id:uid(),proposalId:proposal.id,proposalVersion:proposal.version,proposalSignature:proposal.signature,project:proposal.project,currency:proposal.payload.currency,status:'Reservada',attempt:1,attemptHistory:[],claimId:uid(),executionRef,clientId,claimedAt:iso(now),leaseUntil:iso(now+executionLimits.leaseMs),events:[]};
 audit(e,'claim',now);state.executions.unshift(e);sync(proposal,e);return e;
}

export function prepareExecution(state,args,now=Date.now()){
 now=timestamp(now);const e=executionFor(state,args.id),clientId=text(args.clientId,'clientId',150),fingerprint=seal(args.observation);
 lease(e,args,now);const p=authorization(state,e,now);
 const replay=(e.prepareRequests||[]).find(r=>r.clientId===clientId);
 if(replay||e.prepareClientId===clientId){if((replay?.fingerprint||e.prepareFingerprint)!==fingerprint)fail('clientId reutilizado com outra leitura.');return {execution:e,command:copy(e.command)};}
 if(e.submittedAt||!['Reservada','Preparada'].includes(e.status))fail('Esta execução não pode preparar outra mutação.');
 assertExecutionIsolation(state,p,e.id,now);
 if((e.prepareRequests||[]).length>=executionLimits.preflightsPerAttempt)fail('Limite de pré-conferências desta tentativa atingido.');
 const observed=observation(args.observation,p,now,timestamp(e.claimedAt)),frozen=isLiveOrder(p)?p.payload.liveTarget:frozenTarget(state,p);if(frozen.id&&frozen.id!==observed.row.id)fail('ID interno mudou desde a fonte aprovada.');
 const freshRow=args.observation.rows.find(r=>r.externalId===p.payload.objectId&&r.adAccountId===p.payload.adAccountId);
 const increasesExposure=p.payload.action==='budget'&&p.payload.after.dailyBudget>p.payload.before.dailyBudget||p.payload.action==='status'&&p.payload.after.status==='ACTIVE';
 if(increasesExposure&&freshRow?.accountStatus?.active===false)fail('Conta de anúncios sem aptidão ativa. Não aumentar exposição; solicite nova análise.');
 if(isWarmupTarget(state,p.project,p.payload.level,freshRow))fail('Campanha de aquecimento/engajamento fora do fluxo de otimização de vendas.');
 if(!sameFinancialScope(observed,frozen)||!valueMatches(p.payload,observed,p.payload.before))fail('Orçamento ou status nativo anterior mudou. Exige nova proposta e aprovação.');
 if(e.preflight&&timestamp(observed.fetchedAt)<timestamp(e.preflight.fetchedAt))fail('A pré-conferência não pode recuar para uma leitura anterior.');
 const owner=activationOwner(args.observation,observed,p,now,timestamp(e.claimedAt));if(owner)observed.budgetOwner=owner;
 const refreshed=e.status==='Preparada';e.preflight=observed;e.command=exactCommand(p,observed);e.commandFingerprint=seal(e.command);e.preparedAt=iso(now);e.prepareClientId=clientId;e.prepareFingerprint=fingerprint;e.prepareRequests||=[];e.prepareRequests.push({clientId,fingerprint,at:iso(now)});e.status='Preparada';audit(e,refreshed?'refresh-preflight':'prepare',now);sync(p,e);return {execution:e,command:copy(e.command)};
}

/** Persist BEFORE the provider call. An interrupted/ambiguous dispatch is verification-only. */
export function submitExecution(state,args,now=Date.now()){
 now=timestamp(now);const e=executionFor(state,args.id),clientId=text(args.clientId,'clientId',150),fingerprint=seal({claimId:args.claimId,executionRef:args.executionRef});
 if(e.submitClientId===clientId){if(e.submitFingerprint!==fingerprint)fail('clientId reutilizado por outro executor.');return {execution:e,dispatchGranted:false};}
 lease(e,args,now);const p=authorization(state,e,now);if(e.status!=='Preparada')fail('Não reenviar: somente uma execução preparada pode ser despachada uma vez.');
 if(!e.preflight||now-timestamp(e.preflight.fetchedAt)>executionLimits.observationAgeMs||e.preflight.budgetOwner&&now-timestamp(e.preflight.budgetOwner.fetchedAt)>executionLimits.observationAgeMs||e.commandFingerprint!==seal(e.command)||seal(exactCommand(p,e.preflight))!==seal(e.command))fail('Pré-conferência venceu ou comando mudou. Não despachar.');
 assertExecutionIsolation(state,p,e.id,now);
 e.status='Enviada';e.submittedAt=iso(now);e.submitClientId=clientId;e.submitFingerprint=fingerprint;audit(e,'dispatch-reserved',now);sync(p,e);return {execution:e,dispatchGranted:true};
}

export function confirmExecution(state,args,now=Date.now()){
 now=timestamp(now);const e=executionFor(state,args.id),clientId=text(args.clientId,'clientId',150),fingerprint=seal(args.observation),verifier=text(args.executionRef,'Referência da execução de conferência',500);
 if(e.confirmClientId===clientId){if(e.confirmFingerprint!==fingerprint)fail('clientId reutilizado com outro readback.');return e;}
 const p=authorization(state,e,now,true);if(!['Enviada','Verificação necessária'].includes(e.status)||!e.submittedAt)fail('A execução precisa ter despacho registrado antes da confirmação.');
 const observed=observation(args.observation,p,now,timestamp(e.submittedAt));if(observed.row.id!==e.preflight?.row.id)fail('Readback possui outro ID interno.');
 if(!valueMatches(p.payload,observed,p.payload.after))fail('Readback não confirma o valor exato aprovado. Não reenviar a mutação.');
 const expected={...e.preflight.row,...p.payload.after};if(!sameFinancialScope(observed,expected))fail('Readback mudou orçamento ou status fora da alteração aprovada.');
 const owner=activationOwner(args.observation,observed,p,now,timestamp(e.submittedAt),true);if(owner)observed.budgetOwner=owner;
 e.readback=observed;e.status='Confirmada';e.confirmedAt=iso(now);e.verificationExecutionRef=verifier;e.confirmClientId=clientId;e.confirmFingerprint=fingerprint;audit(e,'confirmed',now);
 p.appliedAt=iso(now);p.executionConfirmedAt=iso(now);sync(p,e);return e;
}

export function failExecution(state,args,now=Date.now()){
 now=timestamp(now);const e=executionFor(state,args.id),clientId=text(args.clientId,'clientId',150),reason=text(args.reason,'Motivo da falha',2000);
 if(e.failureClientId===clientId){if(e.reason!==reason)fail('clientId reutilizado com outro motivo.');return e;}
 if(e.status==='Confirmada')fail('Uma confirmação entregue é imutável.');
 if(e.status==='Falhou')fail('Falha já registrada; não repetir automaticamente a mutação.');
 if(e.claimId!==args.claimId||e.executionRef!==args.executionRef)fail('Reserva não corresponde ao executor.');
 e.status=e.submittedAt?'Verificação necessária':'Falhou';e.reason=reason;e.failedAt=iso(now);e.failureClientId=clientId;audit(e,'failure',now,reason);
 const p=authorization(state,e,now,true);sync(p,e);return e;
}

/** Read-only provider observation journal, never an ad write or financial
 * authorization. Missed checkpoints are labelled late; never backdated. */
export function monitorExecution(state,args,now=Date.now()){
 now=timestamp(now);const e=executionFor(state,args.id),clientId=text(args.clientId,'clientId',150),executionRef=text(args.executionRef,'Referência da conferência',500),checkpoint=args.entry?.checkpointMinutes;
 if(e.status!=='Confirmada'||!e.confirmedAt)fail('Acompanhamento requer aplicação já confirmada. Envio ambíguo deve ser conferido primeiro.');
 if(!contingencyLimits.checkpoints.includes(checkpoint))fail('Use a revisão de 15, 30 ou 60 minutos.');
 const raw=args.observation||{},target=e.readback?.row,fields=['id','externalId','adAccountId','projectId','level','provider','budgetCurrency','dailyBudget','lifetimeBudget','status','spend','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','impressions','linkClicks','refundedRevenue'];
 const normalized={...Object.fromEntries(['source','projectId','level','complete','fetchedAt','lastSyncAt','metricsCurrency','from','to','timezone'].map(k=>[k,raw[k]])),rows:(Array.isArray(raw.rows)?raw.rows:[]).filter(r=>r.externalId===target?.externalId&&r.adAccountId===target?.adAccountId).map(r=>Object.fromEntries(fields.map(k=>[k,r[k]])))};
 const fingerprint=seal({checkpoint,observation:normalized,executionRef}),checks=e.monitorChecks||[],replay=checks.find(c=>c.clientId===clientId);
 if(replay){if(replay.fingerprint!==fingerprint)fail('clientId reutilizado com outra conferência.');return replay;}
 if(state.paused)fail('Escritório pausado: preserve a conferência até retomar o acompanhamento.');
 if(checks.some(c=>c.checkpointMinutes===checkpoint))fail('Esta conferência já foi registrada. Preserve o histórico e avance para a próxima.');
 const next=contingencyLimits.checkpoints.find(n=>!checks.some(c=>c.checkpointMinutes===n));if(checkpoint!==next)fail('Registre as conferências em ordem; não simule horários anteriores.');
 const p=authorization(state,e,now,true),due=timestamp(e.confirmedAt)+checkpoint*60000;
 if(now<due||timestamp(args.observation?.fetchedAt)>now)fail('A conferência não pode antecipar o horário devido ou usar leitura futura.');
 const observed=observation(args.observation,p,now,due);
 if(observed.row.id!==e.readback?.row.id)fail('O ID interno não corresponde à aplicação confirmada.');
 if(checks.length&&timestamp(observed.fetchedAt)<=timestamp(checks.at(-1).observation.fetchedAt))fail('A próxima conferência exige uma leitura realmente mais nova.');
 const changed=!sameFinancialScope(observed,e.readback.row),delta=changed?null:postActionDelta(e.readback.performance,observed.performance);
 const record={clientId,fingerprint,executionRef,checkpointMinutes:checkpoint,recordedAt:iso(now),dueAt:iso(due),lateByMs:timestamp(observed.fetchedAt)-due,observation:observed,externalChange:changed,delta,status:changed?'Cenário alterado':delta?'Observado':'Métricas não comparáveis',automaticAction:false};
 e.monitorChecks=[...checks,record];audit(e,'post-action-check',now,{checkpointMinutes:checkpoint,status:record.status});sync(p,e);return record;
}

export function executionPlan(state,now=Date.now()){
 now=timestamp(now);return {executions:(state.executions||[]).map(e=>{
  const beforeDispatch=!e.submittedAt&&!['Enviada','Verificação necessária','Confirmada'].includes(e.status);let eligible=true,blocked=null;
  if(beforeDispatch)try{const p=authorization(state,e,now);assertExecutionIsolation(state,p,e.id,now);}catch(error){eligible=false;blocked=error.message;}
  const leaseValid=timestamp(e.leaseUntil)>now,canReclaim=eligible&&beforeDispatch&&!leaseValid&&(e.attempt||1)<executionLimits.attempts;
  const fresh=!!e.preflight&&now-timestamp(e.preflight.fetchedAt)<=executionLimits.observationAgeMs&&(!e.preflight.budgetOwner||now-timestamp(e.preflight.budgetOwner.fetchedAt)<=executionLimits.observationAgeMs);
  const recoveryReason=blocked||(beforeDispatch&&!leaseValid?canReclaim?'Reserva venceu antes do envio. Reivindique uma nova tentativa com novo clientId.':'Limite de tentativas atingido ou autorização indisponível. Solicite nova revisão.':beforeDispatch&&e.status==='Preparada'&&!fresh?'Pré-conferência venceu. Consulte novamente o objeto e prepare com novo clientId.':null);
  return {id:e.id,proposalId:e.proposalId,project:e.project,status:e.status,executionRef:e.executionRef,attempt:e.attempt||1,leaseUntil:e.leaseUntil,canReclaim,canPrepare:eligible&&beforeDispatch&&leaseValid&&['Reservada','Preparada'].includes(e.status),canSubmit:eligible&&e.status==='Preparada'&&leaseValid&&fresh,verificationOnly:['Enviada','Verificação necessária'].includes(e.status),externalApplied:e.status==='Confirmada',reason:recoveryReason||e.reason||null};
 }),rule:'Antes do envio, a pré-conferência pode ser renovada e uma reserva vencida pode ser retomada até três tentativas. Após despacho, nunca repetir mutação automaticamente. Somente dispatchGranted:true no primeiro commit autoriza a chamada; retries ou resposta perdida são apenas conferência. Isto não garante atomicidade exactly-once no provedor.'};
}
