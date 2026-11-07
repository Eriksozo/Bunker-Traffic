# Bunker Traffic — instruções de continuidade

Claude assume a implementação e a operação assistida deste projeto. Codex atua como copiloto para diagnóstico, revisão e validação quando solicitado. Entregue uma etapa concreta, confira o resultado e relate pendências; não inicie um ciclo ilimitado de melhorias.

Leia primeiro `docs/HANDOFF-CLAUDE.md`, `AGENT-RUNBOOK.md`, `docs/connections.md` e `docs/cloud-executor.md`. O código e o runbook publicado prevalecem sobre um resumo antigo. Revalide estado, identidade e conexões antes de operar.

## Limites obrigatórios

- Apenas projetos Meta configurados: Gabe, John, Leandro, Murilo, Nico e Ronald. Kwai fora do escopo. Aquecimento/engajamento fora das recomendações de vendas.
- Compare 7 e 3 dias completos, ontem e hoje parcial; confira sequência diária, hierarquia e últimas edições antes de sugerir. Preserve testes com menos de 24h. Front, pedidos, upsells, ROI e ROAS são medidas diferentes. Ausência permanece N/D.
- Conexão técnica, parecer, aprendizado e intenção do dono não autorizam execução. Apenas orçamento diário/status Meta de proposta atual aprovada pelo dono na interface, com projeto, conta, objeto, versão, moeda e valores exatos.
- Use claim → prepare → submit. Execute uma vez somente quando a primeira resposta de submit conceder `dispatchGranted:true`, usando exclusivamente o comando preparado via Malva MCP. Releia e confirme. Resposta ambígua/timeout exige verificação; jamais reenvio cego. Não aprove pelo dono.
- O executor Cloudflare é o único executor automático. Não crie outro daemon/cron, não ative a automação local e não dispute reservas vivas. Preserve cadência, fuso, pausa, metas e limites configurados.
- Nunca leia/imprima/copie chaves em relatórios, chat, Git ou `.mcp.json`. Autentique cada cliente pelos fluxos próprios. Não copie tokens OAuth do Codex. Não publique dados operacionais no repositório público.
- Não alterar lances, públicos, criativos ou criar campanhas com uma autorização genérica de manutenção do Bunker.

## Desenvolvimento e publicação

Trabalhe no checkout confirmado, confira `git status` e preserve alterações alheias. Rode os testes pertinentes, `npm run typecheck` e `npm run build` antes de publicar mudanças de código. Commit/push não comprovam deploy: confirme a versão Cloudflare, `/health`, autenticação e o resultado funcional. Preserve o Site privado e sua compatibilidade MCP; não altere audiência ou segredos para contornar uma falha de conexão.

As fontes v3 foram separadas da central. Não faça rollback para um leitor incompatível com `bunker-snapshot-reference`. Histórico, fontes congeladas e selos financeiros devem permanecer íntegros.

## Coordenação

O proprietário decide a prioridade. Claude é o escritor principal; Codex revisa e valida sob demanda. Antes de ambos alterarem arquivos ou gravarem no Bunker, combine o escopo. Registre mudanças e pendências no handoff, sem inventar mensagens ou presença de agentes. Relatórios: ação, motivo simples, valores confirmados e próximo acompanhamento. Não prometer perfeição, atualização instantânea da origem ou ganho financeiro sem evidência.
