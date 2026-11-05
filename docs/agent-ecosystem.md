# Ecossistema de inteligência do Bunker

## Responsabilidade de cada conexão

- **Malva MCP:** quatro períodos e três níveis Meta, aquisição front, custos, moedas, histórico de edição e leitura posterior à aplicação. O dado contém seu horário de coleta e sincronização. A origem pode atrasar.
- **Órbita MCP:** identidade e situação de produção dos criativos, conciliadas por projeto e nomenclatura exata. Não representa vendas, entrega Meta ou rentabilidade. O executor independente usa `Orbita_token` via função de servidor `orbita-mcp`; a conexão do desktop não a substitui. Sem metadados atuais conciliados, o pacote declara a lacuna.
- **Memória do Bunker:** escolhas do dono, hipóteses individuais, contrapontos, aplicações confirmadas e resultados favoráveis, desfavoráveis ou inconclusivos. Preferência não demonstra eficácia. Casos e metas ficam vinculados ao próprio cliente.
- **Cloudflare:** executa os quatro papéis e conserva a fila, reservas e política de aprovação. A cadência, pausa e horário do painel continuam sendo a autoridade.
- **Supabase:** mantém a ponte e credenciais de servidor já configuradas; nenhuma chave é enviada aos modelos ou publicada no repositório.

## Uma rodada de análise

1. Coletar e validar as fontes elegíveis; preservar a identidade de campanhas indisponíveis, sem lhes atribuir gasto zero ou status presumido.
2. Priorizar até seis campanhas, combinando relevância e rotação. Coleta completa do recorte não equivale a auditoria individual de todos os objetos.
3. Lia confere aquisição; Nina confronta os filhos e identidade dos criativos; Theo verifica exposição e edições; Cai confronta os três pareceres e sintetiza somente o que estiver sustentado.
4. Cada papel seleciona referências de observações. O servidor resolve os números exatos na fonte congelada e valida novamente antes de gravar. Parecer inválido não conclui a etapa.
5. Uma sugestão sustentada aparece no card. Só a proposta exata aprovada pelo dono pode avançar pelo contrato existente de envio único e confirmação. Análise, intenção, aprovação, envio e aplicação são eventos diferentes.
6. Resultados posteriores e revisões independentes alimentam a memória. Ausência de comparação válida permanece inconclusiva; nunca é promovida a sucesso por concordância entre agentes.

## Contexto de análise — atualização de 05/11/2026

A produção Cloudflare seleciona explicitamente `wide` (`@cf/openai/gpt-oss-120b`). O pacote tem limite interno de 160.000 bytes e saída de até 6.400 tokens por etapa. Esses bytes são limites operacionais da aplicação, não uma contagem de tokens. Uma rejeição explícita de contexto permite uma única compactação para 80.000 bytes; a cobertura reduzida é registrada. Não há troca silenciosa de modelo nem reenvio de comando financeiro.

A API do analista mantém a política `legacy` para os chamadores que a utilizam explicitamente ou por compatibilidade. A ponte de produção informa `cloudProductionModelPolicy`, e cada conclusão guarda o modelo real, tamanho entregue e alvos revisados/adiados. O motor deixa a compactação para a política selecionada; não corta previamente o pacote para o limite antigo de 40.000 bytes.

Somente a mensagem final completa do modelo é aceita. Saída truncada, ferramenta, raciocínio interno sem conteúdo final, JSON inválido, conta divergente ou citação ausente não se tornam parecer, sugestão aprovada ou ação.

## Como medir a melhoria

- Campanhas efetivamente revisadas por papel, em relação aos alvos solicitados.
- Tempo observado de coleta e análise; horário da origem separado do horário do Bunker.
- Citações recusadas, lacunas de fonte e discussões materiais pendentes.
- Correções do dono e resultados posteriores comparáveis, sem atribuir causalidade.

O teste de compatibilidade utiliza dados sintéticos, chamadas reais ao binding Workers AI e os validadores da aplicação. Não publica pareceres sintéticos na operação nem altera campanhas. A passagem nesse teste demonstra compatibilidade do protocolo; não demonstra qualidade financeira ou decisões perfeitas. A confirmação operacional depende das rodadas reais após o deploy.

Referências oficiais consultadas: [gpt-oss-120b na Cloudflare](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) e [modelo anterior](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/). Padrões externos já adaptados e suas licenças estão em `docs/references/agent-learning-sources.json`.

## Revisão independente de proposta

A revisão financeira usa o alvo exato da proposta e seu pai, dentro do lote admitido. Mantém os quatro períodos, a hierarquia e os pareceres da equipe referentes à campanha; as leituras dos demais alvos ficam omitidas de forma explícita apenas nesse pacote. Para proposta em conjunto/anúncio, o filho exato é incluído mesmo quando estiver abaixo dos quatro maiores gastos da amostra; períodos sem esse filho continuam desconhecidos.

Alvo ausente, ambíguo, de outra conta ou fora do lote não toma emprestado o contexto de outra campanha. A tentativa é encerrada como falha e permanece rastreável. O parecer guarda modelo, tamanho do pacote e objeto revisado. Ele não altera o estado de aprovação do dono nem envia comandos. A análise inicial do lote continua abrangendo os seis alvos priorizados.
