# Acompanhamento proativo

O cache Malva atualizado alimenta uma fila derivada em `plan.watch` no `bunker_ler` e o painel Acompanhamento proativo. A função é pura: não cria mensagens, decisões, aprovações, jobs, histórico ou chamadas a provedores. Órbita continua como contexto editorial separado, nunca prova de entrega ou retorno financeiro.

## Cobertura e prioridade

Cada projeto informa campanhas observadas, novas sem análise, conhecidas que não retornaram e aquecimentos excluídos das sugestões. A cobertura é do recorte `active-spent-tracked`, incluindo campanhas pausadas já acompanhadas. Não representa todo o arquivo histórico. Ausência e duplicidade de identidade exigem conciliação, sem inferir exclusão ou status.

1. Falha, cobertura e relógio da fonte.
2. Mudança de status, orçamento/moeda e campanha nova.
3. Perda de eficiência desde a análise, respeitando teste e incidente.
4. Potencial de escala com novas compras front e apoio de 3/7 dias.
5. Quatro períodos vencidos, incompletos ou de outro dia.

Coleta deve ter até 5 minutos. Sinais de desempenho também exigem sincronização Malva conhecida com até 15 minutos e quatro janelas completas/alinhadas com até 60 minutos. Limites de confiança técnica não são novas metas financeiras dos clientes. Crescimento de upsell sozinho não sinaliza escala; campanha inativa, conta inativa, incidente e teste menor de 24h/idade desconhecida não recebem esse sinal. Ganho ou perda observado não demonstra causa ou efeito futuro.

## Execução dos agentes

O executor local existente consulta `bunker_ler`; `plan.watch` ordena os projetos **já elegíveis** para coleta. Cada projeto fornece `readRequest` paginado, somente leitura, pelo envelope `watch-data`, incluindo `nextOffset`. O limite global de 100 sinais não reduz contagens; previews de até oito sinais por projeto preservam visibilidade entre clientes. Páginas são uma visão móvel, não uma fonte selada; se o cenário mudar, releia e deduplique por identidade.

Execuções aprovadas e conferências pendentes continuam primeiro. A fila não antecipa reservas fora da cadência ou ignora pausa/lease. Após reservar, recolher quatro períodos e hierarquia, consultar edições, produzir pareceres reais e síntese. Proposta financeira só segue o contrato de aprovação exata do dono. A fila não altera o valor aprovado nem o mecanismo de envio único.

O relay de dados não executa modelos. Se a rotina local dos agentes estiver pausada, apenas a observação e os sinais derivados continuarão; não afirmar análise autônoma em andamento. O Mac deve estar ligado e as conexões disponíveis. Não há garantia de latência zero, precisão perfeita ou lucro. Não simular conversas/presença para preencher a interface.
