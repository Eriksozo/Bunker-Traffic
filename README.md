# Bunker · Central de tráfego

Central privada com React/Vinext, Cloudflare D1 e MCP próprio. Sem credenciais de plataformas no código e sem ferramentas de mutação externa.

## Repositório

Código completo da versão 46, sincronizado em [Eriksozo/Bunker-Traffic](https://github.com/Eriksozo/Bunker-Traffic). Os dados operacionais continuam no D1 privado. Fixtures usam identificadores fictícios; credenciais, bancos locais e histórico com identificadores reais não fazem parte desta cópia pública. A origem e as diferenças estão em [docs/source-sync.md](docs/source-sync.md).

Para verificar o código: `npm ci`, `npm test`, `npm run typecheck` e `npm run build`. O relay local exige os IDs explícitos de workspace e Site, conforme [docs/local-live-sync.md](docs/local-live-sync.md). Não execute o instalador para apenas desenvolver a interface.

## O que funciona

- Importação validada de leituras Malva por projeto, janela e nível; 7d, 3d, ontem, hoje.
- Métricas ponderadas, fonte e sincronização, dia parcial e sinalização de leitura antiga.
- Campanhas, contas, propostas, aprovação interna e conferência manual na plataforma.
- Demandas em kanban, perguntas e rodadas pendentes, parâmetros por projeto, pausa do escritório.
- Relatório direto com apenas aplicações registradas, exportação e impressão/PDF.
- Base D1 compartilhada com controle de revisão contra sobrescrita concorrente.
- MCP para agentes lerem resumos compactos, reservarem rodadas elegíveis, gravarem leituras, responderem perguntas e concluírem rodadas com relatório.
- Cadência personalizada por intervalo, horários, dias e fuso; pausa, janela concluída, respiro após falha e proteção contra sobreposição.

## Limites explícitos

O app não acessa Malva diretamente: a elegibilidade de conectores dentro de Sites não está disponível nesta sessão. A primeira rodada foi coletada pelo MCP nesta conversa e importada em tempo de execução. A sincronização ocorre pelo agente conectado ao Malva e ao MCP do Bunker, sem credenciais no navegador. O executor local deste Mac verifica a agenda; só coleta quando `plan.due` indicar projeto elegível. A tarefa antiga da nuvem permanece desativada. A agenda é personalizada pelo usuário. O botão de nova rodada cria pedido prioritário para a próxima verificação. As perguntas são assíncronas. Execução externa exige proposta exata aprovada pelo dono, pré-conferência e confirmação no Malva; conversa ou sugestão não é autorização. O estado e a última conclusão por projeto são persistidos.

O classificador é triagem por regras, não substitui o método completo nem faz alteração de orçamento/status. Campanhas pausadas não recebem proposta operacional de escala. Dados de conjuntos/anúncios, criativos, última edição e atraso de conversão são conferências obrigatórias ainda não automatizadas. Fases são inferidas da nomenclatura da campanha, sem alegar conciliação Órbita.

Orçamento inicial cobre CBO ativo com gasto na coleta. ABO, programado, preparando e restrições requerem inventário próprio. O valor é parcial; orçamento não é gasto nem limite da conta. O app não afirma lucro final da empresa.

## Uso

1. Entrar no Site com ChatGPT.
2. Escolher projeto e período; abrir campanhas e comparar janelas.
3. Registrar uma proposta interna com motivo e valores na moeda nativa.
4. Fazer a alteração na plataforma por conta própria, reabrir o objeto e só então registrar a conferência.
5. Criar demandas, solicitar coleta ao agente e salvar/copiar o relatório.
6. Em Dados, importar um bundle verificado ou exportar o estado para consulta.

## Desenvolvimento

`npm run dev -- --port 5177` inicia a prévia local. O starter simula login apenas em loopback. `npm run db:generate` gera migrations; aplicar migrations locais antes de usar o banco. `node --test tests/analysis.test.mjs` verifica os casos críticos de triagem. `npx tsc --noEmit` verifica os tipos.

Dados privados importados ficam no D1, fora dos arquivos de código e do pacote de publicação. Acesso é privado ao proprietário; não mudar a audiência sem revisar as regras de isolamento.

## Cadência e executor

O executor é a tarefa local já existente neste Mac; a tarefa antiga da nuvem está desativada. A configuração no painel não comprova que a tarefa local esteja ativa. Cada pulso lê a cadência salva, que aceita passos de 5 minutos, horários, dias, fuso e pausa. `plan.autonomous` prioriza conferências, aprovações exatas, perguntas, discussão, pareceres e coleta elegível. A primeira conclusão por projeto comprova a rodada; o agendamento sozinho não comprova execução. O Mac deve permanecer ligado, com rede e Codex disponível. Contrato e etapas em AGENT-RUNBOOK.md.

Métricas atribuídas: ROAS Malva usa receita líquida do checkout / mídia. ROI subtrai productCost e saleTax e divide por mídia + adCosts. Componentes ausentes permanecem N/D.

Clientes MCP com catálogo antigo podem reservar usando startRequest de plan.due via bunker_atualizar_rodada. A reserva retorna o UUID real; uma rodada expirada não pode concluir com dados de outra. Relatórios filtram aplicações por appliedAt dentro da janela selecionada, sem reclassificar registros antigos.

## Histórico e avisos ao vivo

Relatórios também são preservados na tabela bunker_reports, além do buffer recente da central. A gravação condicional da central e o arquivamento do estado aprovado usam um único batch D1. O histórico pode ser aberto/baixado por projeto, com paginação, e consultado pelo MCP bunker_relatorios. O GET de histórico também reúne relatórios legados ainda presentes na central; a próxima gravação aceita os arquiva sem duplicar.

A aba visível confere somente a revisão da central a cada minuto e ao recuperar foco. Se houver dados novos, avisa sem substituir formulários ou rascunhos. Atualizar dados recarrega a central explicitamente. No escritório, a revisão salva é conferida a cada dez segundos e respostas novas atualizam a conversa automaticamente, mantendo os rascunhos; a consulta pausa com a página oculta ou uma gravação em andamento. Isso lê a central, sem solicitar novas coletas Malva. A sincronização Malva exibida pertence à janela selecionada, separada da data da consulta. A conclusão da coleta não comprova auditoria individual de cada função.

## Escritório virtual

Na aba Escritório, o usuário caminha pelo mapa com clique, setas ou WASD, aproxima-se de Lia/Tráfego, Theo/Orçamento, Nina/Criativos ou Cai/Gestão e pressiona E ou clica no personagem. A lista de agentes e os controles de direção fornecem alternativas acessíveis. O escritório ilustrado usa pixel art própria com referência visual no Gather 2.0: madeira maple, carpetes estampados, móveis e personagens detalhados. A composição Canvas2D mantém a geometria compartilhada da navegação, com portas e obstáculos; arrastar move a câmera, com zoom e restauração. A opção 3D abre o diorama Three.js e permite orbitar a arquitetura. Dispositivos sem WebGL continuam no modo ilustrado, e ambos respeitam movimento reduzido. O atalho /#office abre direto no escritório. Referência de acabamento: https://www.gather.town/blog/behind-the-fix-audio-2026 ; as ilustrações do mapa são originais, sem carregar assets do Gather em produção.

Perguntas vão à fila real com projeto e função endereçada, são respondidas pelo agente conectado e ficam separadas por conversa. Rascunhos são mantidos por projeto/agente inclusive ao navegar entre abas da central, e só se limpam após confirmação de gravação. Eles não são preservados após fechar ou recarregar a página. Estado de coleta é coletivo e não representa auditoria de cada personagem. Não há chamada de voz/vídeo ou colaboração multiusuário; as respostas são assíncronas. O mapa não altera anúncios diretamente; a mesa de decisão alimenta o executor local após aprovação explícita do dono.

## Mesa de decisão e aprendizado

O escritório também mostra uma conversa persistida entre as funções da equipe, propostas aguardando o dono e aprendizados com fontes. A coleta completa cria uma rodada com evidências congeladas; trabalhadores conectados registram seus próprios pareceres e respostas. Tráfego → criativos → orçamento → gestão, seguido por revisão independente e aprovação do dono. A interface não fabrica mensagens ou status de atividade.

Aprovação/recusa/revisão são vinculadas ao objeto, conta, moeda, valores, versão e validade exatos. O MCP dos agentes não pode aprovar pelo dono. Alterações externas continuam separadas da aprovação; o executor local pode aplicar somente orçamento diário/status exatos após aprovação do dono, com pré-conferência e readback pelo MCP Malva. Sem executor local conectado, a aprovação permanece aguardando execução. A agenda horária existente recebe as instruções novas em `bunker_ler.runbook`, e a execução deve registrar referências reais para ser comprovada.

A base de aprendizado é por projeto, com casos Malva e identidade de produção Órbita, histórico e sinalização de evidências antigas/hipóteses. Novos resultados podem corroborar ou invalidar observações, sem mudar metas ou proteções automaticamente. Histórico de rodadas é arquivado na mesma base, atomicamente com a revisão da central, e consultável no painel.

A reserva de revisão usa um lote atômico para todos os projetos elegíveis do pulso, preservando o último horário da agenda e a validade de45min das reservas. Reativações vinculam o orçamento nativo e o proprietário financeiro à aprovação; o pai CBO/ABO é relido quando necessário. Pré-conferência vencida pode ser renovada antes do envio, com tentativas limitadas e isolamento do worker antigo. Nenhuma retomada libera reenvio após despacho.
