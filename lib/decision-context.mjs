/** Aggregates describe a contrast, never a daily sequence or a trading command. */
export const contextChecks=Object.freeze([
 'Conferir os dias individuais fechados e o horário do dia parcial; comparar períodos de duração equivalente.',
 'Ler a última edição e separar gasto, vendas front e retorno novos depois dela.',
 'Conferir CPA Front, checkout e origem do retorno; pedidos e upsells não são novas vendas front.',
 'Localizar a perda por conjunto e anúncio antes de cortar a campanha que também tem vencedores.',
 'Checar atribuição, checkout, pixel, entrega e limites próprios de perda e orçamento.',
]);
const measured=m=>m&&Number.isFinite(m.spend)&&m.spend>0&&Number.isFinite(m.roi);
export function decisionContext(windows){
 const today=windows?.today,recent=windows?.['3d'],week=windows?.['7d'];
 if(!measured(today)||!measured(recent)||!measured(week))return null;
 const bothProfitable=recent.roi>1&&week.roi>1;
 if(today.roi<1&&(recent.roi>1||week.roi>1))return {
  kind:'mixed-return',tone:'amber',title:bothProfitable?'Hoje fraco, histórico rentável':'Retorno divergente entre períodos',
  summary:bothProfitable?'Hoje está abaixo do equilíbrio, mas as janelas de 3 e 7 dias seguem rentáveis. Rever o contexto antes de cortar ou repetir uma escala.':'Hoje está abaixo do equilíbrio e as janelas fechadas divergem. Conferir recuperação ou deterioração antes da próxima ação.',
  limitation:'Os agregados se sobrepõem: não provam que a queda foi isolada nem que existe uma sequência de dias ruins.',
  checks:[...contextChecks],automaticAction:false,
 };
 if(recent.roi<1&&week.roi<1)return {
  kind:'negative-history',tone:'red',title:'Revisar perdas nas janelas',
  summary:'As janelas de 3 e 7 dias estão abaixo do equilíbrio. Investigar a perda da instância e a aquisição após as últimas edições.',
  limitation:'Janelas sobrepostas não comprovam dias ruins consecutivos e não justificam, sozinhas, pausar o objeto.',
  checks:[...contextChecks],automaticAction:false,
 };
 return null;
}
