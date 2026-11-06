# Referências externas aplicadas ao Bunker

Revisão de 06/11/2026. Fontes primárias consultadas e trechos de código obtidos para comparação. Não são novas dependências nem cópias integrais desses projetos.

| Repositório / revisão consultada | Aplicação nesta entrega |
| --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui/tree/d549251bab2e57dbf72f7c909d6458c02c43f529), MIT | Reutilização do `Alert` já presente no projeto para contexto de análise. Título sem truncamento, texto curto, ação de revisão e contadores responsivos. |
| [TanStack Query](https://github.com/TanStack/query/tree/c34ce05d61408328275f9f49e7cb4e44d63196ae), MIT | Separação entre dados preservados, atualização e erro. Um acompanhamento recente não transforma a análise dos quatro períodos em análise atual. Classificação indisponível aparece como `—`; zero é reservado a uma base atual. Implementação própria em `overviewAnalysisState`, sem adicionar outro cache concorrente. |
| [Cloudflare workers-sdk](https://github.com/cloudflare/workers-sdk/tree/3ef2afd63431cf8e57f94e47501d6be53adcaccc), MIT | Revisão do transporte D1 e seus limites. Fontes volumosas deixam de disputar a mesma linha que o diário operacional; central, fontes e arquivos continuam na mesma transação com CAS. |
| [Supabase](https://github.com/supabase/supabase/tree/597d1ce56ee7905bc1717a94c58a4db8ddcaf2f6), Apache-2.0 | Compatibilidade conferida com o RPC transacional existente, permissões privadas e autorização do bridge financeiro. Não foi aberta nenhuma tabela ao cliente nem criada migração de permissões. |

Documentação de apoio: [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [transações batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [funções Postgres](https://supabase.com/docs/guides/database/functions), [estados de consultas](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).

## Persistência v3

1. Formatos legados continuam legíveis. O estado lógico e seus selos não mudam.
2. Acima de 1,3 MB na linha central, o envelope compactado das fontes é separado em `snapshots:<sha256>`, imutável e reutilizado para conteúdo idêntico.
3. A central guarda a referência. CAS e inserção do envelope são atômicos: escritor vencido não cria arquivo; falha do arquivo reverte a revisão.
4. A leitura valida chave, formato, digest, tamanho, expansão e contagens. Arquivo ausente ou alterado falha explicitamente; nunca retorna fonte vazia.
5. O bridge de execução continua lendo a autorização do núcleo, sem depender da hidratação de fontes. Não há mudança na aprovação ou no envio único.

O teto por registro (1,75 MB), limites dos codecs e limites de expansão permanecem. A separação resolve o teto combinado, não oferece armazenamento ilimitado. Novos cortes geram novos envelopes; sua retenção deverá ser monitorada antes de introduzir limpeza. Esta versão não apaga fontes ou histórico e exige manter o leitor v3 em eventual rollback após a primeira gravação v3.

## Verificação

- Regressões de CAS, rollback, deduplicação, corrupção/ausência de fontes e disponibilidade das provas financeiras para o bridge.
- Regressões de ausência de período, troca de dia, relógio futuro, falha de armazenamento por projeto e recuperação da leitura completa.
- Suíte completa, tipos e build; na publicação, conferir revisão e formato armazenado, saúde e autenticação. Saúde HTTP não comprova conclusão de coleta ou parecer dos agentes.

O controle de campanhas, as metas e a cadência não são alterados por esta entrega.
