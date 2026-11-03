# Sincronização do código

Esta é a cópia pública do código completo do Bunker · Otimização de campanhas, versão 46, publicada em 03/11/2026.

- Origem verificada: commit `8612b7a4a30643160fa5e8538c6d07e85214d2f0` do repositório gerenciado pelo Sites.
- Os 261 arquivos versionados da origem estão presentes; dependências, builds, caches, credenciais e dados de operação não são exportados.
- A primeira sincronização usa um commit inicial limpo. O histórico privado de desenvolvimento contém identificadores reais de workspace/projetos e não foi enviado.
- Nos testes de relay, os IDs reais foram substituídos por fixtures fictícias. A referência visual aponta para a página pública do Malva e os comandos de instalação usam parâmetros explícitos.
- O manifesto `.openai/hosting.json` preserva a identidade do Site deste projeto. Esse ID não é uma credencial e não concede acesso ao banco ou ao painel.

## Desenvolvimento e publicação

As decisões, análises, fontes importadas, aprovações e aprendizados são registros privados no D1. O GitHub versiona código, migrations, componentes, testes e documentação. Um push não confirma implantação nem sincronização de dados Malva.

Antes de cada nova sincronização, concilie o commit do Sites com a `main` deste repositório, preserve alterações dos dois lados e revise o diff. Não copie `.env`, `.dev.vars`, caches locais, dumps, logs ou tokens. Mantenha os IDs fictícios dos testes e informe os IDs reais somente na instalação local autorizada.

Uma publicação do Site deve usar seu fluxo próprio de build, versão e implantação, mantendo a identidade e o acesso privado existentes. Para reutilizar o projeto em outro Site, obtenha a nova identidade pelo fluxo de criação do Sites antes de publicar.
