# Correção da gravação de leituras — 02/11/2026

O caso real Nico estava com 1.737.796 caracteres / 1.744.257 bytes no registro central. Substituir os três anúncios de ontem pelos 28 anúncios coletados produzia 1.755.759 caracteres e ultrapassava o limite anterior de 1.750.000 caracteres. O schema da leitura era válido. O conector retornava apenas `INVALID_ARGUMENT`.

As leituras (`snapshots`) agora são compactadas com gzip/base64 somente na cópia persistida. O registro contém versão, SHA-256, tamanho e contagens. A leitura restaura o JSON original antes de calcular métricas, validar fontes, revisar ou executar propostas. Histórico, relatórios, escolhas, autorizações e agenda mantêm seu formato. Não há migração de tabela nem descarte de dados.

A guarda do registro central mede bytes UTF-8, com o mesmo teto de 1.750.000 bytes. A descompressão tem limites de expansão, verifica digest, contagens, JSON e UTF-8; conteúdo inconsistente falha sem fabricar leituras vazias. O MCP também inclui código e mensagem estruturados em erros e registra somente o código no log.

Validação:

- 171 testes aprovados, incluindo 15 novos de codec/persistência.
- Testes SQLite exercitam o código usado em produção: concorrência CAS, arquivo de relatórios, rollback e preservação de fontes congeladas.
- A base real restaurada após compactação ficou idêntica ao JSON original.
- O caso real que falhava passou de 1.762.220 bytes para cerca de 994 mil bytes persistidos.
- Na prévia local do runtime, importar os 28 anúncios retornou HTTP 200. Agenda, parâmetros e escolhas ficaram idênticos à cópia anterior.
- TypeScript e revisão independente aprovados. Nenhum comando financeiro usado para testar.

O estado antigo sem envelope continua legível; a compactação acontece na próxima gravação aceita. Downgrade para uma versão anterior ao codec exige restaurar o formato lógico primeiro, preservando a revisão e os dados. O backup lógico continua disponível pelo botão Exportar base.
