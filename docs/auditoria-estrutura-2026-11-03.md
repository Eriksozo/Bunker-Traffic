# Auditoria do Bunker · 03/11/2026

Revisão da interface, persistência, autenticação, sincronização, cadência, decisões, execução e dependências. O inventário inicial tinha 273 arquivos versionados. Os resultados abaixo distinguem correções realizadas de melhorias propostas.

## Correções desta revisão

| Ponto | Problema confirmado | Correção |
| --- | --- | --- |
| Contas com gasto | Contas acompanhadas com gasto zero entravam no contador e na tabela intitulados “com gasto”. | Separar contas com gasto positivo confirmado, contas acompanhadas e contas com gasto desconhecido. Valores ausentes continuam N/D. |
| Sinais da visão geral | A triagem tinha quatro categorias, mas apenas três contadores. Quando todos os objetos precisavam de investigação, apareciam três zeros acima de prioridades existentes. | Mostrar também “Investigar dados”, com contador e filtro próprios. |
| Relógio da triagem | Uma atualização muito à frente do relógio podia ser considerada recente. | Rejeitar esse sinal de atualização e encaminhar para investigação. O instante também passa a ser o mesmo na fila e na triagem. |
| Dependências | A auditoria inicial de dependências de produção apontou seis alertas, incluindo um crítico. | Atualizar versões compatíveis e o lockfile; validar também a cadeia de renderização que está declarada como dependência de desenvolvimento. |
| Publicação | O comando de build externo não exigia testes e checagem de tipos. | Fazer `npm run build` executar `npm run verify` antes de empacotar o Worker. |

Atualizações incluem Next 16.4.5, React/React DOM/RSC 19.3.1, Zod 4.6.7, Vinext 1.4.3, Vite 8.3.5 e ferramentas Cloudflare compatíveis. As correções do Next constam na [publicação oficial](https://github.com/vercel/next.js/releases/tag/v16.4.5); a atualização do Zod contempla o [alerta de consumo de memória](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Verificações e evidências

- 473 testes passaram após as alterações, incluindo concorrência, despacho único, confirmação de decisões, arquivamento, retomadas, identificação de campanhas e os novos contadores.
- Checagem TypeScript e build externo concluídos.
- Auditoria de produção: zero alertas no estado final. A auditoria completa ainda aponta 24 alertas moderados, sem altos ou críticos, em ferramentas e dependências transitivas. Algumas soluções automáticas sugeridas pelo npm rebaixariam módulos para versões incompatíveis; não foi usado `--force`.
- O banco recusava leitura anônima, escrita direta pelo papel de navegador e execução anônima da função de armazenamento.
- O acesso do Site continuava exclusivo do proprietário. A entrada direta encaminha para essa sessão privada; não autentica visitantes nas APIs da Cloudflare.
- Os arquivos de credenciais locais permaneciam ignorados pelo Git. A busca nos arquivos versionados não encontrou valores que correspondessem aos padrões de chaves verificados.
- O sincronizador local estava em execução. Foi observada uma leitura incompleta do John, seguida de recuperação no ciclo posterior. A proteção preservou a última leitura válida; uma contagem intermediária não foi aceita como coleta completa.
- A revisão central, os registros e os relatórios permaneceram preservados. Não houve proposta de mudança de metas nem execução financeira nesta auditoria.

## Próximas melhorias, por impacto

| Prioridade | Melhoria | Ganho prático | Critério de conclusão |
| --- | --- | --- | --- |
| 1 | Saúde da operação em um único painel | Distinguir última coleta Malva, última análise completa, sugestões pendentes e aplicações conferidas. Identificar o projeto que precisa de atenção. | Um projeto sem análise recente não aparece como atualizado apenas porque o cache visual atualizou. |
| 1 | Acompanhamento após cada ajuste | Comparar gasto, front, CPA, checkout e retorno novos após a edição, em intervalos comparáveis. | Cada ação confirmada tem acompanhamento posterior; sem atribuir causalidade quando houver outras mudanças. |
| 1 | Consolidar orçamento completo | Mostrar diário ativo e programado, CBO/ABO e moeda nativa por conta, com equivalência em reais e cobertura explícita. | O dono financeiro é contado uma vez; valores ausentes não viram zero. |
| 1 | Alertas detalhados da coleta | Distinguir truncamento, mudança da origem durante a consulta, conta indisponível e limitação da ferramenta. | Falhas mostram causa verificável e próximo passo, preservando o último cache e evitando novas tentativas cegas. |
| 2 | Medir validação por fase e criativo único | Acompanhar Teste → Pré-escala → Escala, Avatar e cópias de metadados; verificar se as fases pagam o investimento total. | Raízes conciliadas com a Órbita; denominadores, receita, custos e taxa de validação auditáveis. |
| 2 | Reduzir o carregamento inicial | Dividir a tela principal e carregar escritório, gráficos e histórico quando forem abertos. | Medir transferência e tempo até uso antes/depois; preservar navegação, estado e acessibilidade. |
| 2 | Reduzir a dependência da hospedagem de compatibilidade | Concluir uma entrada própria simples na Cloudflare/Supabase e reduzir o código mantido em dois destinos. | Login e acesso dos agentes funcionam sem o Site intermediário, mantendo aprovação exata e acesso privado. |
| 2 | Restauração e capacidade | Ensaiar restauração e acompanhar crescimento de histórico, alterações e recibos. | Um backup é restaurado e conciliado em ambiente isolado; arquivamento preserva a auditoria antes dos limites. |
| 2 | Tratar os alertas moderados remanescentes | Atualizar ou substituir a cadeia afetada sem os rebaixamentos incompatíveis sugeridos pelo auditor. | Auditoria completa limpa ou cada exceção justificada com uso, versão, alcance e prazo de revisão. |

As sugestões acima são evolução de produto e infraestrutura. Não alteram automaticamente alvos, proteções ou permissões de execução das campanhas.
