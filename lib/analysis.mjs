import {testLaunchContext,verifiedNoSpendPeriods} from './test-launch.mjs';
import {isWarmupCampaign} from './campaign-scope.mjs';
import {decisionContext} from './decision-context.mjs';
export const periods=['7d','3d','yesterday','today'];
/** @type {Record<string,string>} */
export const periodNames={'7d':'7 dias','3d':'3 dias',yesterday:'Ontem',today:'Hoje'};
const ratio=(numerator,denominator,multiplier=1)=>{
 if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||denominator<=0)return null;
 const value=numerator/denominator*multiplier;return Number.isFinite(value)?value:null;
};
export function sum(rows){
 /** @type {Record<string, any>} */
 const o={};for(const k of ['spend','revenue','revenueNet','adCosts','productCost','saleTax','frontOrders','orders','checkouts','impressions','linkClicks','refundedRevenue']){const value=rows.length&&rows.every(r=>Number.isFinite(r[k]))?rows.reduce((s,r)=>s+r[k],0):null;o[k]=Number.isFinite(value)?value:null;}
 o.roas=ratio(o.revenueNet,o.spend);
 const netKnown=o.revenueNet!==null&&o.productCost!==null&&o.saleTax!==null;
 o.roi=o.spend>0&&netKnown&&o.adCosts!==null?ratio(o.revenueNet-o.productCost-o.saleTax,o.spend+o.adCosts):null;
 const result=netKnown&&o.spend!==null&&o.adCosts!==null?o.revenueNet-o.productCost-o.saleTax-o.spend-o.adCosts:null;
 o.result=Number.isFinite(result)?result:null;
 o.cpc=ratio(o.spend,o.linkClicks);o.cpm=ratio(o.spend,o.impressions,1000);
 o.ic=ratio(o.spend,o.checkouts);o.cpaFront=ratio(o.spend,o.frontOrders);return o;
}
export function rowKey(r){return [r.projectId,r.level,r.adAccountId,r.externalId].join(':');}
export function phase(n=''){
 if(isWarmupCampaign(n))return 'Engajamento';
 if(/BID.?CAP|COST.?CAP|ESCALA/i.test(n)&&!/PRE.?ESCALA|PRÉ.?ESCALA/i.test(n))return 'Escala';
 if(/PRE.?ESCALA|PRÉ.?ESCALA/i.test(n))return 'Pré-escala';if(/AVATAR|ATVAR/i.test(n))return 'Avatar';
 if(/TESTE/i.test(n))return 'Teste';return 'Não conciliado';
}
export function rowsFor(state,project,period){return state.snapshots.flatMap(s=>s.period===period&&s.level==='campaign'&&(project==='all'||s.projectId===project)?s.rows.map(r=>({...r,projectId:s.projectId,projectName:s.projectName,sourceAt:s.lastSyncAt||s.fetchedAt})):[]);}
// One comparable daily measure: a measured zero today stays zero; only N/D today falls back to the closed windows' daily average.
const dailySpend=c=>{const t=c.windows.today?.spend;return Number.isFinite(t)?t:Number.isFinite(c.recent?.spend)?c.recent.spend/3:Number.isFinite(c.week?.spend)?c.week.spend/7:0;};
export function candidates(state,project='all',now=Date.now()){
 const all=new Map();for(const p of periods)for(const r of rowsFor(state,project,p)){const id=rowKey(r);if(!all.has(id))all.set(id,{id,row:r,windows:{}});all.get(id).windows[p]=r;if(Date.parse(r.sourceAt||'')>=Date.parse(all.get(id).row.sourceAt||''))all.get(id).row=r;}
 return [...all.values()].map(c=>({...c,row:c.windows.today||c.row})).filter(c=>!isWarmupCampaign(c.row.name)).map(c=>{
  const r=c.row,w=c.windows,cfg=state.config[r.projectId]||{},recent=w['3d']&&sum([w['3d']]),week=w['7d']&&sum([w['7d']]),context=decisionContext({'3d':recent,'7d':week,today:w.today&&sum([w.today])});
  const sourceTime=Date.parse(r.sourceAt||''),fresh=Number.isFinite(sourceTime)&&sourceTime<=now+300000&&now-sourceTime<3600000;let decision='Acompanhar',reason='Comparar aquisição e resultado novo após a última edição.',tone='amber';
  if(!fresh){decision='Investigar';reason='Leitura antiga ou horário de atualização inválido. Atualizar antes de decidir.';tone='gray';}
  else if(r.accountStatus?.active===false||/DISAPPROVED|REJECTED|ISSUE/.test(r.effectiveStatus||'')){decision='Investigar';reason='Conferir restrição ou reprovação antes de interpretar falta de vendas.';tone='red';}
  else if(r.effectiveStatus!=='ACTIVE'){decision='Revisar objeto sem entrega ativa';reason='O status efetivo não está ativo. O histórico serve para revisão, sem propor escala operacional antes de conferir aptidão.';tone='gray';}
  else if(context?.kind==='mixed-return'){decision='Revisar contexto do dia';reason=context.summary+' '+context.limitation;tone='amber';}
  else if(context?.kind==='weak-acquisition'){decision='Avaliar pausa ou redução';reason=context.summary+' '+context.limitation;tone='red';}
  // One single day behind every window (7d equal to today, or to the only closed day): no sequence of results at all.
  else if(week&&Number.isFinite(week.spend)&&week.spend>0&&(week.spend===w.today?.spend||week.spend===w.yesterday?.spend)){decision='Amostra recente';reason='Todo o gasto observado está num único dia. As janelas sobrepostas não representam dias independentes de resultado.';tone='amber';}
  else if(recent&&week&&recent.roi!==null&&week.roi!==null&&recent.roi<1&&week.roi<1){decision='Revisar perda';reason='Abaixo do equilíbrio em 3 e 7 dias. Abrir conjuntos/anúncios e preservar os que vendem antes de cortar o pai.';tone='red';}
  // A loss stays red even on a short sample; the overlap only blocks the green consistency claims below.
  // 7d and 3d are closed windows ending where today starts: the same known spend in both means one sample, never two independent results.
  else if(recent&&week&&Number.isFinite(week.spend)&&week.spend>0&&week.spend===recent.spend){decision='Amostra recente';reason='O gasto de 7 dias é o mesmo dos últimos 3 dias. As janelas sobrepostas não representam dias independentes de resultado.';tone='amber';}
  else if(recent&&week&&recent.roi>=1.8&&week.roi>=1.8&&week.spend>=500&&recent.frontOrders>0){decision='Candidato à escala';reason='Retorno consistente em 3 e 7 dias. Conferir compradores, última edição, hierarquia e teto antes de definir o aumento.';tone='green';}
  else if(recent&&recent.roi>=1.8&&week&&week.roi>=1.8){decision='Retorno consistente com pouca exposição';reason='Bom retorno em 3 e 7 dias, sem o gasto de 7 dias ou a venda front de 3 dias exigidos para escala. Acompanhar; não propor aumento com esta evidência.';tone='green';}
  else if(recent&&recent.roi>=1.8&&week&&week.roi!==null){decision='Sinal de recuperação';reason='Bom retorno recente. Comparar com o histórico e a última edição; não repetir escala usando a mesma evidência.';tone='green';}
  else if(recent&&recent.roi>=1.8){decision='Bom retorno recente';reason='Bom retorno em 3 dias; retorno de 7 dias N/D. Conferir o histórico e a última edição antes de interpretar.';tone='green';}
  const noSpendPeriods=verifiedNoSpendPeriods(state.snapshots,r.projectId,r,state.snapshots.find(s=>s.projectId===r.projectId&&s.period==='today'&&s.level==='campaign')?.from),launch=testLaunchContext(r,w,{now,noSpendPeriods});
  // Malva does not send deliveryStartedAt: an unknown start is young only while no closed window shows spend (isYoungTest's fallback); N/D spend is not a zero.
  const youngDelivery=r.deliveryStartedAt?now-Date.parse(r.deliveryStartedAt)<cfg.testHours*3600000:['7d','3d','yesterday'].every(p=>!w[p]||w[p].spend===0);
  if(fresh&&r.effectiveStatus==='ACTIVE'&&r.accountStatus?.active!==false&&!launch.priority&&cfg.testHours&&phase(r.name)==='Teste'&&youngDelivery){decision='Teste protegido';reason=r.deliveryStartedAt?'Respeitar a janela mínima de entrega do criativo definitivo.':'Início da entrega definitiva não informado. Confirmar antes de cortar por desempenho.';tone='amber';}
  if(fresh&&launch.priority){decision='Revisar teste novo sem vendas';reason=launch.limitation;tone='red';}
  return {...c,noSpendPeriods,testLaunch:launch,decision,reason,tone,phase:phase(r.name),recent,week,context,missing:['Sequência diária e horário comparável','Histórico da última edição e resultado posterior','Conjuntos e anúncios',...(cfg.dailyCap?[]:['Teto autorizado do projeto'])]};
 }).sort((a,b)=>({red:0,green:1,amber:2,gray:3}[a.tone]-{red:0,green:1,amber:2,gray:3}[b.tone])||dailySpend(b)-dailySpend(a));
}
export function budget(rows){const seen=new Set();let active=0,scheduled=0,unknown=0;
 for(const r of rows){const key=rowKey(r);if(seen.has(key))continue;seen.add(key);if(r.effectiveStatus!=='ACTIVE'||r.accountStatus?.active===false)continue;
  // Same rate rule as autonomy-shadow and decision-contingency: a BRL budget needs no conversion rate.
  const rate=String(r.budgetCurrency||'').toUpperCase()==='BRL'?1:r.budgetRate;
  if(!Number.isFinite(r.dailyBudget)||r.dailyBudget<=0||!Number.isFinite(rate)||rate<=0){unknown++;continue;}
  const val=r.dailyBudget*rate;if(!Number.isFinite(val)){unknown++;continue;}
  if(r.startAt&&Date.parse(r.startAt)>Date.now()){const total=scheduled+val;if(Number.isFinite(total))scheduled=total;else unknown++;}
  else if(r.spend>0){const total=active+val;if(Number.isFinite(total))active=total;else unknown++;}else unknown++;
 }return {active,scheduled,unknown};}
