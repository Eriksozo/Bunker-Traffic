# Conexões e publicação

O destino principal é Cloudflare Workers + Supabase Postgres. GitHub versiona o código; A Malva usa uma chave MCP de servidor dedicada; o executor e o modelo rodam na Cloudflare. A Órbita usa a Edge Function de servidor `orbita-mcp`, sem depender da sessão do Mac. Conexão técnica não concede autorização para mudar anúncios.

## Caminhos

- Interface: `https://bunker-traffic.erik-iplou.workers.dev`.
- Login: Supabase Auth, link de e-mail, proprietário definido em `BUNKER_OWNER_EMAIL`. Cookies HttpOnly, Secure e SameSite; cabeçalhos de identidade recebidos do visitante são removidos antes da autenticação.
- Entrada direta opcional: `BUNKER_DIRECT_ACCESS_URL` aponta para a raiz HTTPS do Site privado já autenticado no ChatGPT. Visitantes sem sessão Supabase que chegam ao login são encaminhados para essa interface, ligada à mesma base. Isso não transfere cookies, não cria uma sessão Supabase nem libera APIs anônimas. Preserve o Site com acesso exclusivo do proprietário. O login Supabase por e-mail continua disponível em `/auth/login?email=1`.
- Banco: Postgres, tabelas `bunker_records` e `bunker_reports`, com RLS e sem concessões a anon/authenticated. A função `bunker_store` é SECURITY INVOKER e exclusiva do backend service_role.
- Agentes: o MCP privado existente no Sites permanece como compatibilidade autenticada. Seu armazenamento usa o gateway privado `/internal/storage` do Worker, portanto a interface nova e os agentes acessam a mesma base Supabase.
- Malva: secret `MALVA_MCP` no Supabase, Edge Function `malva-mcp` com autenticação de serviço. Somente ferramentas explicitamente permitidas. Chave pessoal MCP, não a chave REST de relatórios.
- Órbita: secret `Orbita_token` no Supabase e função `orbita-mcp` com autenticação de serviço. Somente identidade, cadastros, produções e lateralizações. Durante etapas elegíveis de análise, o executor atualiza metadados do projeto no máximo uma vez por minuto; exige mesmo e-mail proprietário/Malva, workspace esperado e expert único. Nenhum token do desktop é copiado. Cobertura é somente dos registros retornados (até 100 produções e 100 lateralizações); a consulta não prova entrega Meta nem resultado financeiro. Falha preserva a fonte anterior e fica explícita nos pacotes dos agentes.

## Segredos

Configure em produção: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret de backend), `BUNKER_OWNER_EMAIL`, `BUNKER_AGENT_TOKEN` e `BUNKER_STORAGE_TOKEN`. Os dois últimos são distintos: o token de agente acessa apenas `/mcp`; o de armazenamento é reservado ao backend de compatibilidade. Nunca publique esses valores.

O backend do Sites usa `BUNKER_STORAGE_GATEWAY` e `BUNKER_STORAGE_TOKEN`. Sem essas variáveis, a compatibilidade antiga continua usando o D1; isso é uma alternativa de recuperação, não replicação automática. Após o corte, restaurar D1 sem conciliar novas gravações perderia atualizações.

## Deploy

`npm ci` → `npm test` → `npm run typecheck` → `npm run build` → `npx wrangler deploy --config dist/server/wrangler.json`.

O build define o nome `bunker-traffic`, não inclui o banco D1 fictício e ativa a autenticação externa. A integração GitHub da Cloudflare executa o build e o deploy da main. Aplique migrations Supabase pelo fluxo autenticado antes de publicar código que dependa delas.

No Supabase Auth, configure o Site URL para a interface acima e autorize somente seu callback `/auth/callback`. A primeira entrada precisa ser validada pelo proprietário no e-mail; envio aceito não comprova entrega ou sessão iniciada.

## Migração e conferência

A cópia de D1 preserva payloads, revisões, horários e arquivos imutáveis. `bunker_import_rows` recusa conflitos e só é executável pelo backend. Confira cada linha após importar e confira que a revisão de origem não mudou antes de direcionar os agentes. Mantenha a origem preservada; não a trate como espelho depois do corte.

As verificações de saúde não provam que uma campanha entregou, que uma aprovação foi executada ou que a coleta está fresca. Permanecem obrigatórios claim/prepare/submit único/confirm, fontes por projeto, cadência e aprovação exata do dono.

## Atualização do fluxo

Uma única rotina da interface confere a revisão da central a cada dez segundos enquanto a aba está visível, e também quando ela volta ao foco. O Supabase retorna apenas revisão e horário nessa checagem; o estado completo é lido quando há uma revisão nova. A checagem é suspensa durante uma gravação e respostas atrasadas não substituem confirmações mais recentes.

Falha de rede, revisão inválida ou regressiva e sessão expirada não são tratadas como atualização concluída. O painel conserva a última base válida e os rascunhos, mostra a limitação e tenta conferir novamente. O horário dessa conferência fica nos detalhes da sincronização, separado dos horários da coleta e da atualização Malva.

Em conflito de edição, a interface tenta reler a central e pede que o operador confira os novos valores. A gravação não é reenviada automaticamente. Uma escolha só sai da fila após sua confirmação exata no histórico; uma execução financeira continua exigindo a autorização e a verificação próprias.
