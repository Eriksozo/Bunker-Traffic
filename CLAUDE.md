# Bunker Traffic — instruções de continuidade

Claude assume a implementação e a operação assistida deste projeto. Codex atua como copiloto para diagnóstico, revisão e validação quando solicitado. Entregue uma etapa concreta, confira o resultado e relate pendências; não inicie um ciclo ilimitado de melhorias.

Leia primeiro `docs/HANDOFF-CLAUDE.md`, `AGENT-RUNBOOK.md`, `docs/connections.md` e `docs/cloud-executor.md`. O código e o runbook publicado prevalecem sobre um resumo antigo. Revalide estado, identidade e conexões antes de operar.

## Limites obrigatórios

- Apenas projetos Meta configurados: Gabe, John, Leandro, Murilo, Nico e Ronald. Kwai fora do escopo. Aquecimento/engajamento fora das recomendações de vendas.
- Compare 7 e 3 dias completos, ontem e hoje parcial; confira sequência diária, hierarquia e últimas edições antes de sugerir. Preserve a maturação dos testes, mas testes novos com gasto e sem vendas exigem revisão prioritária desde o primeiro dia; menos de 24h não impede proposta fundamentada de contenção. Veja `docs/test-launch-protocol.md`. Front, pedidos, upsells, ROI e ROAS são medidas diferentes. Ausência permanece N/D.
- Conexão técnica, parecer, aprendizado e intenção do dono não autorizam execução. Apenas orçamento diário/status Meta de proposta atual aprovada pelo dono na interface, com projeto, conta, objeto, versão, moeda e valores exatos.
- Use claim → prepare → submit. Execute uma vez somente quando a primeira resposta de submit conceder `dispatchGranted:true`, usando exclusivamente o comando preparado via Malva MCP. Releia e confirme. Resposta ambígua/timeout exige verificação; jamais reenvio cego. Não aprove pelo dono.
- O executor Cloudflare é o único executor automático. Não crie outro daemon/cron, não ative a automação local e não dispute reservas vivas. Preserve cadência, fuso, pausa, metas e limites configurados.
- Nunca leia/imprima/copie chaves em relatórios, chat, Git ou `.mcp.json`. Autentique cada cliente pelos fluxos próprios. Não copie tokens OAuth do Codex. Não publique dados operacionais no repositório público.
- Não alterar lances, públicos, criativos ou criar campanhas com uma autorização genérica de manutenção do Bunker.
- Token Meta `META_ACCOUNTS_TOKEN`: somente leitura do limite diário/status das contas para o painel (`docs/connections.md`). Nunca usar para escrita; ações seguem pelo Malva.
- Token Meta `Meta_Acess_Token` (secret do Supabase, decisões do dono em 08/11 e 09/11/2026): somente leitura (GET), pela função `meta-read`, do início programado, status, orçamento diário e entrega de hoje das campanhas Meta ativas dos projetos configurados, para as primeiras 24h (`docs/first-24h-protocol.md`) e para exibir, no web e no notch, esses números junto da linha do Malva pelo id da campanha (`docs/connections.md`); e do limite diário/status das contas para o painel quando `META_ACCOUNTS_TOKEN` não existe. Só exibição: nunca entra em análise, proposta, aprovação ou conferência de ordem. Nunca usar para escrita nem copiar o valor para fora do Supabase.
- Autonomia em fase sombra (`docs/autonomy-policy.md`): o executor só registra o que faria. Ligar execução automática exige revisão da sombra, tetos definidos pelo dono e registro explícito dele aqui.

## Desenvolvimento e publicação

Trabalhe no checkout confirmado, confira `git status` e preserve alterações alheias. Rode os testes pertinentes, `npm run typecheck` e `npm run build` antes de publicar mudanças de código. Commit/push não comprovam deploy: confirme a versão Cloudflare, `/health`, autenticação e o resultado funcional. Preserve o Site privado e sua compatibilidade MCP; não altere audiência ou segredos para contornar uma falha de conexão.

As fontes v3 foram separadas da central. Não faça rollback para um leitor incompatível com `bunker-snapshot-reference`. Histórico, fontes congeladas e selos financeiros devem permanecer íntegros.

## Coordenação

O proprietário decide a prioridade. Claude é o escritor principal; Codex revisa e valida sob demanda. Antes de ambos alterarem arquivos ou gravarem no Bunker, combine o escopo. Registre mudanças e pendências no handoff, sem inventar mensagens ou presença de agentes. Relatórios: ação, motivo simples, valores confirmados e próximo acompanhamento. Não prometer perfeição, atualização instantânea da origem ou ganho financeiro sem evidência.
