const finite=n=>typeof n==='number'&&Number.isFinite(n);
/** Descriptive live triage, never an optimizer or a financial approval. */
export function cardLiveScenario(card){
 const current=card?.liveToday;
 if(!current)return {kind:'unknown',title:'Aguardando leitura atual',detail:'Sem dados atuais confirmados para esta conta e campanha.',metrics:null};
 if(card.liveStale||card.liveSourceStale)return {kind:'stale',title:'Leitura atual precisa de atualização',detail:'A última leitura foi preservada; aguardar a origem antes de concluir sobre o cenário.',metrics:current};
 if(!finite(current.spend)||current.spend<0||!finite(current.frontOrders)||current.frontOrders<0)return {kind:'unknown',title:'Aquisição ainda não confirmada',detail:'Gasto ou vendas front não foram informados. Dados ausentes não são zero.',metrics:current};
 if(current.spend===0)return {kind:'idle',title:'Sem gasto observado hoje',detail:'Isso não comprova pausa ou falha de entrega. Conferir status e horário de início.',metrics:current};
 if(current.frontOrders===0)return {kind:'attention',title:'Gasto sem venda front hoje',detail:'Conferir tempo de teste, checkout, histórico e gasto após a última edição antes de propor contenção.',metrics:current};
 if(!finite(current.roi))return {kind:'unknown',title:'Vendas front registradas',detail:'O retorno líquido ainda não pôde ser calculado. Conferir custos e aquisição.',metrics:current};
 if(current.roi<1)return {kind:'attention',title:'Hoje abaixo do equilíbrio',detail:'Conferir o tamanho da perda e a resposta aos últimos ajustes; histórico e teste continuam na decisão.',metrics:current};
 if(current.roi===1)return {kind:'idle',title:'Equilíbrio no recorte atual',detail:'As vendas cobrem os custos informados neste recorte. Conferir histórico e aquisição antes de sugerir.',metrics:current};
 return {kind:'positive',title:'Hoje acima do equilíbrio',detail:'Há vendas front e retorno positivo no recorte atual. A escala depende dos períodos fechados e da resposta à última edição.',metrics:current};
}
