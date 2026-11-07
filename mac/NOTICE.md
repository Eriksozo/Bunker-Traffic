# Bunker para Mac — avisos

O app do notch e da barra de menus (`mac/BunkerNotch`) é do Bunker: nome, ícone, cores e interface próprios.

As técnicas de janela e comportamento do notch — painel transparente fixo acima da barra de menus, medição do notch por `safeAreaInsets`/áreas auxiliares, verificação periódica do cursor (mais rápida só perto da ilha) para alternar a passagem de cliques, máquina de estados repouso/espiada/aberto/aviso, atalho global por `RegisterEventHotKey` (sem permissão de acessibilidade) e escolha de tela (notch, barra de menus ou mouse) — foram estudadas no projeto de código aberto Coucou (`github.com/Louis-CFM/coucou`), cujo **código** é distribuído sob a licença MIT:

> MIT License — Copyright (c) 2026 Louis Raillé
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Nenhum ativo de marca do Coucou é usado aqui: o nome "Coucou", o personagem e o nome "Mochi", ícones, sons e mídias pertencem ao autor e não fazem parte deste app.

## Segurança

- Somente leitura: o app consulta `GET /api/companion` com uma credencial própria (`BUNKER_COMPANION_TOKEN`), aceita só nessa rota. Não aprova, não grava, não chama a Malva.
- A credencial fica nas Chaves do macOS. O arquivo de importação `~/.config/bunker-traffic/companion-token` (modo 600) é lido uma vez e apagado.
- Decidir e aprovar continuam no Bunker, com a confirmação exata e o despacho único.
