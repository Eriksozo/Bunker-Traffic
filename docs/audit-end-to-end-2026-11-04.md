# Auditoria ponta a ponta — 04/11/2026

Escopo: sincronização, importação de fontes, acompanhamento, decisão do proprietário, aprovação exata, concorrência, execução única, confirmação, contingência, tendências, persistência, autenticação e navegação. Nenhum teste realizou ajuste real na Meta. Os testes de execução usam SQLite em memória e um provedor isolado.

## Falhas corrigidas

| Ponto | Falha encontrada | Correção e evidência |
| --- | --- | --- |
| Recuperação de leitura | Uma leitura completa falha podia ficar parada se o sinal leve de revisão não mudasse. | Nova tentativa de leitura após 30 s, respeitando visibilidade, descarte e concorrência. Nunca repete escrita. |
| Escopo editorial | O fallback podia conservar criativos de projetos removidos da configuração. | Fallback limitado ao escopo autorizado atual. |
| Integridade do estado | Uma resposta HTTP 200 truncada podia substituir o estado confirmado e quebrar a interface. | Exige os conjuntos centrais e tipos esperados; conserva a base anterior e reconcilia na próxima leitura completa. |
| Importação de análise | Validação parcial e remoção de campos desconhecidos podiam ocultar linhas de outro projeto ou duas versões da mesma janela. | Validação do lote inteiro antes de alterar os registros; rejeita identidade estrangeira, nível divergente, duplicação, regressão e datas futuras. |
| Aprovação envelhecida | Uma aprovação ainda válida podia reutilizar quatro períodos antigos ou do dia anterior. | Antes de aprovar/enviar, exige quatro janelas únicas, completas, recentes e alinhadas ao dia/fuso. A conferência de um envio anterior continua permitida. |
| Exposição financeira | Uma campanha conhecida ausente da coleta podia parecer ausência de gasto/verba. | Cobertura financeira incompleta; não interpreta ausência como zero nem como verba liberada. |
| Reserva e ativação | Reserva em outra moeda/provedor ou alteração do status do pai financeiro podia distorcer a proteção. | Incompatibilidade impede nova exposição; ativação exige orçamento e status exatos do proprietário financeiro. |
| Previsão | Um ID interno reciclado ou horizonte fora das fronteiras civis podia produzir cenário incompatível. | Cenário indisponível para outra identidade ou horizonte inválido; fronteiras respeitam horário de verão. |

## Validação automatizada

- 569 testes passaram na árvore Cloudflare, além da verificação TypeScript e build de produção.
- 420 combinações determinísticas de janelas, fusos, horário de verão, fontes antigas, períodos parciais e virada do dia.
- 4.000 cenários financeiros com semente fixa: cobertura, conversão, reserva, limites e dados incompletos.
- Integração com migrações reais do SQLite: importação → contribuições independentes → proposta → aprovação do proprietário → persistência → disputa de envio → uma única chamada isolada → readback → revisões de 15/30/60 minutos.
- Falha após a aplicação e interrupção antes da chamada: nenhuma segunda chamada automática e nenhuma confirmação inventada.
- Duas instâncias competem pelo mesmo envio: somente o commit vencedor pode despachar; a tentativa perdedora é recusada. O teste não depende de qual instância vence.
- A distribuição Sites não inclui os dez testes exclusivos do adaptador de autenticação Cloudflare. O fluxo comum é testado nas duas árvores.

## Conferências operacionais

- MCP Bunker acessível; Malva e Órbita responderam à consulta de identidade.
- Cloudflare: `/health` respondeu 200; sete superfícies privadas responderam 401 sem sessão, mesmo com cabeçalhos de proprietário forjados.
- Na interface: conferir visão geral, kanban, detalhes, histórico, agenda, relatórios, campanhas e parâmetros sem salvar decisões nem alterar configurações financeiras reais.
- A análise dos quatro períodos e o acompanhamento de hoje têm relógios distintos. Um cache recente não torna uma recomendação antiga válida.

## Limites e dependências preservados

- Esta auditoria não demonstra execução financeira real, causalidade de resultados nem precisão calibrada das projeções.
- A rotina de análise por agentes estava pausada no executor local. Publicar correções não a reativa. Dados de acompanhamento podem continuar chegando sem novos pareceres.
- Tetos financeiros não configurados continuam ausentes; não foram inventados valores de gasto ou prejuízo.
- Atualização depende dos relógios e da disponibilidade do Malva/Órbita, rede e executor. Não existe garantia de atraso zero.
- Contingência não reverte orçamento automaticamente: novo ajuste exige proposta e aprovação exatas.
- O build concluiu com avisos do framework sobre sourcemaps e tamanho de bundle. Eles não foram tratados como erro funcional corrigido nem como prova de desempenho satisfatório.
