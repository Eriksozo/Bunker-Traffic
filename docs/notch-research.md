# Pesquisa: projetos abertos de notch e mascote (07/11/2026)

Leitura web, sem clonar nem executar. Licenças lidas no arquivo LICENSE quando indicado. Reuso de código só com licença permissiva e atribuição em `mac/NOTICE.md`; GPL e sem licença = só ideias, reescritas do zero. Nenhum asset (sprites, sons, ícones) de nenhum projeto.

| Projeto | Licença | Reuso |
| --- | --- | --- |
| github.com/wxtsky/CodeIsland | MIT | código com atribuição |
| github.com/desFernan/puck-mac | MIT (assets fora: LICENSE-ASSETS.md) | código, sem assets |
| github.com/Lakr233/NotchDrop | MIT | código |
| github.com/MrKai77/DynamicNotchKit | MIT (Copyright 2025 Kai Azim) | código com atribuição |
| github.com/chockenberry/Notchmeister | BSD-3-Clause | código com aviso BSD |
| github.com/TheBoredTeam/boring.notch | GPL-3.0 | só ideias |
| github.com/Ebullioscopic/Atoll | GPL-3.0 | só ideias |
| github.com/monuk7735/mew-notch | GPL-3.0 | só ideias |
| github.com/Louis-CFM/coucou | MIT | código com atribuição (já em uso) |
| github.com/samhenrigold/TopNotch | sem licença | nada |

## Aplicado

- Animação só quando há algo para ver; 10 fps dormindo (CodeIsland `MascotAnimationGate.swift`).
- Avisos em rajada viram um passeio (CodeIsland `AttentionPolicy.swift`).
- Tela cheia por limites de janela via CGWindowList, sem Gravação de Tela, consultado só ao sair (CodeIsland `ScreenDetector.swift`).
- Realocação ao desconectar monitor (puck-mac `Movement/DisplayChangeRelocation.swift`).
- Pausa com tela bloqueada (`com.apple.screenIsLocked`; ideia do MewNotch).
- Opção de esconder em gravações e calls (`sharingType = .none`; ideia do Atoll), desligada por padrão.
- Ombros côncavos na ilha com raios animados por estado (DynamicNotchKit `NotchShape.swift`, MIT, adaptado) — 07/11.
- Molas assimétricas: abrir `spring(0.42, 0.8)`, fechar `spring(0.36, 1.0)`, fade simples com Reduzir movimento (CodeIsland/DynamicNotchKit) — 07/11.
- Conteúdo aberto "derrama" do notch (desfoque 8 + escala 0,96 pelo topo) e rodízio com troca por desfoque (DynamicNotchKit `BlurModifier`, CodeIsland `blurFade`, reescritos) — 07/11.
- Sombra por estado: nenhuma em repouso, suave na espiada/aviso, funda aberta (DynamicNotchKit) — 07/11.

## Próximos candidatos

1. ~~Bunk caindo e andando sobre a borda das janelas~~ — aplicado em 07/11 (`WindowPerch`, `BunkDesktop.perch`).
2. ~~Rodízio do notch fechado por urgência~~ — aplicado em 07/11 (`UrgencyTicker`).
3. Estado de espiada com háptico limitado e debounce de fechamento (NotchDrop `NotchViewModel+Events.swift`).
4. Alerta que não fecha com o mouse em cima e painel flutuante em telas sem notch (DynamicNotchKit `DynamicNotchHoverBehavior.swift`, `NotchlessView.swift`).
5. ~~Molas de abrir/fechar~~ — aplicado em 07/11. Brilho ao aproximar o mouse segue candidato (Notchmeister — BSD).
6. Pré-hover imediato (+7 pt de largura, 0,21 s) antes de abrir, atraso de abrir configurável 0,3–0,5 s (CodeIsland `NotchHoverInteraction`, MIT).
7. Háptico leve ao entrar na ilha e em avisos, limitado a 0,5 s e desligável (NotchDrop/DynamicNotchKit, MIT).
8. Gesto de deslizar para cima para fechar (só a ideia do boring.notch, GPL; implementar do zero).

## Pacotes A–D (aplicados em 07/11)

Pesquisa ampla (cerca de 50 projetos, licenças conferidas). Aplicado: dispensar por assinatura e aviso curto (notchd, Apache-2.0), adiar (Perch, MIT), silêncio em reunião (Repose, MIT), ritmo do orçamento (ILoveNotch, MIT; ideia de claude-notch, licença não comercial, só ideia), minigráfico (exelban/stats, MIT), idade do dado (FEXLY, MIT), hover por intenção (udeck, Apache-2.0; notchi, MIT), cadência com recuo (codex-pacer, MIT), telas por UUID, VoiceOver e Reduzir transparência. Ficou de fora: notificações com botões (exigem app assinado), arrastar link para o notch, código GPL.

## Evitar

APIs privadas (SkyLight/CGS), permissão de Acessibilidade, leitura de `kCGWindowName` ou captura de tela (exige Gravação de Tela), CGWindowList a cada quadro, animação com painel oculto, dependências sem licença conferida, macros Swift (as Command Line Tools não têm).
