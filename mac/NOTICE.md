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

O Bunk fora do notch (`BunkDesktop.swift`, `BunkRoamLogic.swift`) usa mecânicas estudadas no mesmo código MIT: painel transparente por cima de tudo que só aceita clique sobre o corpo (verificação periódica do cursor), olhar que acompanha o ponteiro com resposta suave, crescer ao passar o mouse, arrastar com limite de borda, soltar sobre o notch para voltar, clique simples diferido para distinguir do clique duplo, sono por inatividade com taxa de quadros menor e pausa quando a tela dorme. O personagem, o nome "Bunk", o visual, as expressões, as reações e as animações são próprios do Bunker.

Ideias reescritas do zero, sem cópia de código, a partir de outros projetos abertos (ver `docs/notch-research.md`): animação só quando há algo para ver, agrupamento de avisos em rajada e rodízio do notch fechado por urgência (CodeIsland, MIT, github.com/wxtsky/CodeIsland); detecção de app em tela cheia só por limites de janela, sem permissão de Gravação de Tela (CodeIsland); realocação ao desconectar um monitor, pousar e andar sobre a borda das janelas com leitura adaptativa (puck-mac, MIT, github.com/desFernan/puck-mac — sem seus assets); pausa com a tela bloqueada (MewNotch, GPL-3.0 — só a ideia); esconder de gravações e compartilhamento de tela (Atoll, GPL-3.0 — só a ideia).

Nenhum ativo de marca do Coucou é usado aqui: o nome "Coucou", o personagem e o nome "Mochi", ícones, sons e mídias pertencem ao autor e não fazem parte deste app.

## Segurança

- Somente leitura: o app consulta `GET /api/companion` com uma credencial própria (`BUNKER_COMPANION_TOKEN`), aceita só nessa rota. Não aprova, não grava, não chama a Malva.
- A credencial fica nas Chaves do macOS. O arquivo de importação `~/.config/bunker-traffic/companion-token` (modo 600) é lido uma vez e apagado.
- Decidir e aprovar continuam no Bunker, com a confirmação exata e o despacho único.
