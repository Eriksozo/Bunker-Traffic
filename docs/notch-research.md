# Pesquisa: projetos abertos de notch e mascote (07/11/2026)

Leitura web, sem clonar nem executar. Licenças lidas no arquivo LICENSE quando indicado. Reuso de código só com licença permissiva e atribuição em `mac/NOTICE.md`; GPL e sem licença = só ideias, reescritas do zero. Nenhum asset (sprites, sons, ícones) de nenhum projeto.

| Projeto | Licença | Reuso |
| --- | --- | --- |
| github.com/wxtsky/CodeIsland | MIT | código com atribuição |
| github.com/desFernan/puck-mac | MIT (assets fora: LICENSE-ASSETS.md) | código, sem assets |
| github.com/Lakr233/NotchDrop | MIT | código |
| github.com/MrKai77/DynamicNotchKit | MIT | código |
| github.com/chockenberry/Notchmeister | BSD-3-Clause | código com aviso BSD |
| github.com/TheBoredTeam/boring.notch | GPL-3.0 | só ideias |
| github.com/Ebullioscopic/Atoll | GPL-3.0 | só ideias |
| github.com/monuk7735/mew-notch | GPL-3.0 | só ideias |

## Aplicado

- Animação só quando há algo para ver; 10 fps dormindo (CodeIsland `MascotAnimationGate.swift`).
- Avisos em rajada viram um passeio (CodeIsland `AttentionPolicy.swift`).
- Tela cheia por limites de janela via CGWindowList, sem Gravação de Tela, consultado só ao sair (CodeIsland `ScreenDetector.swift`).
- Realocação ao desconectar monitor (puck-mac `Movement/DisplayChangeRelocation.swift`).
- Pausa com tela bloqueada (`com.apple.screenIsLocked`; ideia do MewNotch).
- Opção de esconder em gravações e calls (`sharingType = .none`; ideia do Atoll), desligada por padrão.

## Próximos candidatos

1. ~~Bunk caindo e andando sobre a borda das janelas~~ — aplicado em 07/11 (`WindowPerch`, `BunkDesktop.perch`).
2. ~~Rodízio do notch fechado por urgência~~ — aplicado em 07/11 (`UrgencyTicker`).
3. Estado de espiada com háptico limitado e debounce de fechamento (NotchDrop `NotchViewModel+Events.swift`).
4. Alerta que não fecha com o mouse em cima e painel flutuante em telas sem notch (DynamicNotchKit `DynamicNotchHoverBehavior.swift`, `NotchlessView.swift`).
5. Molas de abrir/fechar e brilho ao aproximar o mouse (boring.notch — ideia; Notchmeister — BSD).

## Evitar

APIs privadas (SkyLight/CGS), permissão de Acessibilidade, leitura de `kCGWindowName` ou captura de tela (exige Gravação de Tela), CGWindowList a cada quadro, animação com painel oculto, dependências sem licença conferida, macros Swift (as Command Line Tools não têm).
