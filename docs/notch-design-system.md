# Design system do notch (Bunker para Mac) — 09/11/2026

Escopo: só apresentação, em `mac/BunkerNotch/Sources/BunkerNotch/`. Nenhuma regra de negócio, número exibido, fluxo de ordem/Touch ID ou ação de botão mudou. A fonte única dos tokens é `DesignSystem.swift`; o autoteste (`--self-test`) roda `DSAudit` junto com os demais testes, e `mac/build.sh` recusa instalar se algo falhar.

## 1. Referências e o que valeu aplicar

| Fonte | Licença | O que aproveitamos (só ideia, reescrito) |
| --- | --- | --- |
| Apple HIG — Live Activities | — | fundo preto opaco; margens iguais e cantos concêntricos; cor só para identidade e estado; animação < 2 s; transição numérica em valores que mudam; uma ação principal por tela |
| Apple HIG — Typography | — | no macOS, o mínimo é 10 pt; números em SF Rounded com dígitos de largura fixa; peso médio ou maior em texto pequeno |
| Apple HIG — Accessibility/Color | — | contraste 4,5:1 até 17 pt; variante de Aumentar contraste; estado nunca só por cor (glifo junto); alvo de clique ≥ 20 pt (28 pt é o padrão); Reduzir movimento = trocar molas e desfoque por fade |
| DynamicNotchKit (MrKai77) | MIT | raios animados topo/base (já em uso, creditado em `mac/NOTICE.md`); transição desfoque + escala + opacidade; sombra só aberta |
| Boring Notch | GPL-3.0 | só números de referência: abrir 0,42/0,8, fechar sem rebote, raios 6/14 fechado e cerca de 19/24 aberto, sombra só quando aberto |
| NotchNook (lo.cafe) | fechado | a ação que age em nome do dono aparece como um único botão em destaque |
| Alcove | fechado | repouso com uma palavra curta e um valor pequeno de cada lado do notch |

Pesquisa anterior (07/11) segue em `docs/notch-research.md`.

## 2. Inventário antes desta rodada

- **Tokens existentes:** `DS.Space`, `DS.Radius`, `DS.Color`, `DS.Font` e `DS.Motion`, mas aplicados pela metade.
- **Valores soltos no código:**
  - 38 fontes escritas à mão (12 tamanhos diferentes, de 7,5 a 20 pt);
  - cerca de 40 paddings literais;
  - 4 cópias de `black.opacity(0.85)` sobre o violeta;
  - 3 usos de `.secondary` fora da paleta.
- **Texto abaixo de 10 pt:** rótulos da faixa de saldo (8,5 pt) e linhas secundárias (9,5 pt).
- **Contraste:** o cinza terciário (branco a 50%) dava 4,16:1 sobre a superfície selecionada, abaixo do AA.
- **Estados:**
  - todo vazio mostrava um ✓ verde, inclusive "indisponível" e "ainda sendo montado";
  - todo aviso mostrava ⚠️, inclusive os de tom verde ou neutro;
  - o carregamento era só um spinner.
- **Interação:**
  - botões sem estado de passar o mouse nem de pressionar;
  - abas com o fundo piscando de uma aba para outra;
  - lista cortada seco na borda da ilha;
  - o desabilitado era aplicado de fora, com opacidades diferentes (0,45 e 0,5).
- **Modo claro/escuro:** a ilha é sempre escura, de propósito, porque continua o notch físico. A janela de sons usa as cores do sistema.

## 3. Arquitetura dos tokens

1. **`Palette`:** valores sRGB crus (violeta, menta, coral, âmbar), cada um com o gêmeo de Aumentar contraste.
2. **`Token`:** papéis semânticos (superfícies, ink, stroke, rim, highlight, tons) nos dois modos de contraste.
3. **`DS.*`:** o que as telas usam:
   - `Color` lê a configuração ao vivo;
   - `Font` é a escala tipográfica, com piso de 10 pt;
   - `Icon` reúne os 6 tamanhos de SF Symbol;
   - `Space` segue a grade de 4 pt;
   - `Inset` define o padding por família de controle;
   - `Radius` traz o helper `concentric`;
   - `Size`, `Opacity`, `Elevation` e `Motion` completam o conjunto.
4. **Componentes:** `CardStyle`, `Pill`, `TintChip`, `Monogram`, `IconBadge`, `StatusDot` (com pulso), `ActionButton`, `IconButton`, `PressableStyle`, `Banner`, `EmptyLine` (claro/info/espera), `SkeletonBlock`, `IslandFieldStyle` e os modificadores `scrollEdgeFade`, `numericTransition` e `tile`.
5. **`DSAudit`:** confere, nos dois modos de contraste:
   - 4 tons de texto × 4 superfícies;
   - 6 tons sobre a própria cor de fundo;
   - o texto sobre o botão principal;
   - que o alto contraste nunca fique mais fraco que o padrão;
   - o piso de 10 pt e a ordem da escala tipográfica;
   - a grade de 4 pt;
   - os raios concêntricos com a ilha;
   - alvos de clique de pelo menos 20 pt.

## 4. As 100 melhorias do design system (✅ entrou · ⏳ depois)

**Lote A — fundação de tokens (1–20)**
1. ✅ Paleta crua separada dos papéis semânticos.
2. ✅ Gêmeo de Aumentar contraste para cada cor de marca e de estado.
3. ✅ Tipo `RGBA` com composição e luminância (WCAG) para auditar sem desenhar.
4. ✅ `Token` com valores dos dois modos, lidos por `DS.Color` em tempo de desenho.
5. ✅ Terciário de 0,50 para 0,56, passando o AA sobre a superfície selecionada.
6. ✅ Novo papel `inkPill` (o 0,62 que estava solto no Pill).
7. ✅ Novo papel `inkFaint`, só decorativo.
8. ✅ `onAccent` substitui as 4 cópias de `black.opacity(0.85)`.
9. ✅ `strokeStrong` para passar o mouse e para foco.
10. ✅ `highlight`: luz no topo dos cards.
11. ✅ `rim`: aro sutil da ilha aberta.
12. ✅ `surfaceHover` e `surfaceSelected` mais fortes no alto contraste.
13. ✅ `Tone.fill`, `wash`, `rim` e `text`: uma única regra de tinta por tom.
14. ✅ `Tone.symbol`: um glifo por tom, para nunca depender só da cor.
15. ✅ Escala tipográfica com piso de 10 pt (micro de 9,5 para 10, eyebrow de 10 para 10,5).
16. ✅ Novos estilos `title`, `ticker`, `pill`, `captionStrong` e `monogram`.
17. ✅ `DS.Icon` com 6 tamanhos de SF Symbol no lugar de 20 literais.
18. ✅ `DS.Space.xxl` e grade de 4 pt documentada.
19. ✅ `DS.Inset` por família (pill, chip, controle, aba, linha, campo).
20. ✅ `DS.Radius.bar`/`xs` e o helper `concentric`.

**Lote B — forma, profundidade e movimento (21–35)**
21. ✅ `DS.Size` (botão de ícone, badge, pontos, linha da espiada, campo de %).
22. ✅ `DS.Opacity` (desabilitado, silenciado, trocando de projeto, dica em repouso).
23. ✅ `DS.Elevation.island` substitui a sombra calculada inline.
24. ✅ Aro de luz na borda inferior da ilha aberta, para ler sobre papel de parede escuro.
25. ✅ Card com luz no topo (gradiente na borda).
26. ✅ Card com raio parametrizável e concêntrico.
27. ✅ `Motion.hover`, `press`, `select` e `number`.
28. ✅ `Motion.select` vira fade com Reduzir movimento.
29. ✅ `PressableStyle`: encolhe 3% e escurece ao clicar, sem escala com Reduzir movimento.
30. ✅ Indicador de aba único que desliza (matchedGeometry).
31. ✅ Abas com estado de passar o mouse.
32. ✅ Valores de KPI rolam dígito a dígito (`numericText`).
33. ✅ Valores do detalhe, dos projetos, de "Muda na Meta" e das propostas também rolam.
34. ✅ `scrollEdgeFade`: a lista some suave na borda em vez de cortar uma linha ao meio.
35. ✅ O spinner do botão de atualizar não gira com Reduzir movimento (mantido).

**Lote C — componentes (36–60)**
36. ✅ `ActionButton` com estado de passar o mouse (superfície e borda).
37. ✅ `ActionButton` principal com brilho de topo.
38. ✅ `ActionButton` lê `isEnabled`; os chamadores só marcam `.disabled`, e o esmaecido é sempre o mesmo.
39. ✅ `IconButton` com passar o mouse, borda e pressionar.
40. ✅ `TintChip` unifica ação rápida da Sombra, "abrir" do aviso e veredito.
41. ✅ `Monogram` unifica as iniciais de projetos e agentes.
42. ✅ `Banner` com glifo pelo tom (✓, ⓘ, ⚠, ⛔) e fio da cor.
43. ✅ `EmptyLine` com três tipos: claro (✓ verde), info (ⓘ) e espera (relógio).
44. ✅ `SkeletonBlock` e `LoadingSkeleton` no primeiro carregamento.
45. ✅ `StatusDot` com pulso para erro ou dado velho.
46. ✅ `IconBadge` e `Monogram` ocultos do VoiceOver (são decorativos).
47. ✅ `SectionHeader` marcado como cabeçalho para o VoiceOver.
48. ✅ `Pill` usa `Tone.text` e `Tone.fill`.
49. ✅ Campo da ilha com foco animado.
50. ✅ "Ajustar aqui" agora é um `ActionButton` principal, igual aos outros.
51. ✅ Botões "O que fazer" com passar o mouse, pressionar e estado selecionado para o VoiceOver.
52. ✅ Botões de % com borda de destaque quando escolhidos.
53. ✅ Caixa "Muda na Meta" com `wash` e `rim` do tom.
54. ✅ Caixa "Para executar agora falta" com `wash` e fio âmbar.
55. ✅ Períodos da ordem viram `tile()` concêntrico com o card.
56. ✅ Balão do Bunk com tinta e fio de token; "Ajustar" em `onAccent`.
57. ✅ Minigráficos com raio de token.
58. ✅ Bunk fora do notch com raio de token.
59. ✅ Caixas de gestores esmaecidas quando o total é zero.
60. ✅ Faixa de saldo com rótulos a 10 pt e tinta de token.

**Lote D — telas (61–80)**
61. ✅ Repouso: rodízio com fonte `ticker`.
62. ✅ Espiada: ponto de saúde pulsa só com erro.
63. ✅ Aviso: halo na cor do aviso atrás do Bunk.
64. ✅ Aviso: chip "abrir" com o glifo do tipo (perda, venda, ordem).
65. ✅ Cabeçalho: wordmark BUNK com gradiente violeta.
66. ✅ Cabeçalho: ponto de atualização pulsa quando o dado está velho ou com erro.
67. ✅ Menu de projeto com inset de controle.
68. ✅ Detalhe: título da campanha em `title` (13 pt).
69. ✅ Agora: "Sombra" e "memória" saem de `.secondary` para `inkSoft`.
70. ✅ Projetos: linhas com pressionar, passar o mouse animado e raio contínuo.
71. ✅ Agentes: avatar vira `Monogram` circular.
72. ✅ Contas: avisos da Meta como info, não como ✓.
73. ✅ Sistema: executor indisponível como info.
74. ✅ Projetos: placar pendente como espera.
75. ✅ Gestores e agentes: vazio de filtro como info.
76. ✅ Ajuste: campanha sem leitura como info.
77. ✅ Linha de lista: chevron desliza 2 pt ao passar o mouse.
78. ✅ Linha de lista: pressionar sutil (1%).
79. ✅ Bloco "Ritmo do orçamento" com até 3 linhas (o piso de 10 pt não pode esconder "camp. · sem orçamento").
80. ✅ `DSAudit` no autoteste: contraste, piso de tipo, grade e raios.

**Lote E — para depois (81–100)**
81. ⏳ Háptico leve ao abrir ou fechar, desligável.
82. ⏳ Atraso de abertura configurável (100–150 ms) e zona de tolerância de 30 pt.
83. ⏳ Gesto de deslizar para cima para fechar, com botão equivalente.
84. ⏳ Painel flutuante próprio para telas sem notch.
85. ⏳ Alvos de 28 pt nos botões de ícone (hoje 24 pt; mudar exige rever o cabeçalho inteiro).
86. ⏳ Anel de foco de teclado visível em todos os controles customizados.
87. ⏳ Altura da ilha aberta dinâmica pelo conteúdo (HIG), em vez de 540/560 fixos.
88. ⏳ Mover linhas da fila só quando mudam de posição (animação por identidade).
89. ⏳ Visual "vidro" opcional (material) com fallback opaco.
90. ⏳ Tamanho de texto do notch escolhido pelo dono (P/M/G).
91. ⏳ Tokens exportados em JSON para alinhar web e Mac numa só fonte.
92. ⏳ Janela de sons com o mesmo vocabulário de componentes.
93. ⏳ Barra de progresso de auto-fechamento no aviso, só se ele pausar ao passar o mouse.
94. ⏳ Gráfico de ritmo do dia no bloco de orçamento.
95. ⏳ Prévia em modo de alto contraste no `--render-notch`.
96. ⏳ Prévia em Reduzir movimento e Reduzir transparência.
97. ⏳ Auditoria automática de truncamento nas capturas (texto cortado sem dica).
98. ⏳ Ícone de app e de menu redesenhados com a paleta.
99. ⏳ Som e animação sincronizados nas confirmações.
100. ⏳ Documentação visual (folha de componentes) gerada pelo binário.

## 5. As 100 verificações de UX e usabilidade (pedido do dono, 09/11)

Rodada fechada, não um ciclo sem fim. Cada item foi conferido nas capturas do `--render-notch` (16 telas) e na leitura do código. Resultado: ✅ passa · 🔧 corrigido nesta rodada · ⏳ registrado para depois.

**Leitura e hierarquia (1–20)**
1. ✅ O número principal de cada KPI é o maior texto do bloco.
2. ✅ Cada variação traz o período ao lado ("ontem 1,31x ↑8%").
3. ✅ A seta acompanha a cor nas variações.
4. ✅ N/D aparece como N/D, nunca como zero.
5. 🔧 "Ritmo do orçamento" cortava a base com o novo piso de 10 pt; agora usa até 3 linhas.
6. ✅ Títulos longos de campanha truncam no meio, preservando data e criativo.
7. 🔧 Título truncado no detalhe mostra o nome completo ao passar o mouse.
8. 🔧 Linhas de lista mostram título e subtítulo completos ao passar o mouse.
9. 🔧 O detalhe dos cabeçalhos de seção mostra o texto completo ao passar o mouse.
10. 🔧 A frase da espiada encolhe até 88% antes de cortar e mostra o texto completo ao passar o mouse.
11. ✅ Valor à direita alinhado com legenda abaixo.
12. ✅ Rótulos de projeto e conta em tom neutro, sem competir com o violeta.
13. ✅ Uma ação principal violeta por tela.
14. ✅ O texto principal tem contraste ≥ 4,5:1 em todas as superfícies (auditado).
15. 🔧 O terciário sobre a superfície selecionada passou de 4,16:1 para 5,05:1.
16. 🔧 Nenhum texto legível abaixo de 10 pt.
17. ✅ Moeda e dígitos fixos alinham colunas.
18. ✅ A faixa de saldo destaca "7d+hoje".
19. ✅ O veredito da faixa de saldo traz glifo e texto.
20. ✅ O estado executado/enviado da ordem aparece em texto, não só em cor.

**Estados (21–40)**
21. 🔧 O primeiro carregamento mostra o esqueleto da tela, não só um spinner.
22. ✅ "Resumo em preparação" tem um aviso próprio.
23. ✅ Erro de leitura aparece como aviso vermelho no topo.
24. 🔧 O aviso de erro usa o glifo ⛔, e não ⚠.
25. 🔧 O aviso neutro ("lendo o projeto escolhido…") usa ⓘ.
26. 🔧 O aviso verde ("saiu da fila") usa ✓.
27. ✅ A troca de projeto esmaece os números antigos e diz de onde são.
28. 🔧 Vazio "nada a fazer" fica com ✓ verde; "indisponível" passa para ⓘ.
29. 🔧 "Sendo montado" e "próxima atualização" usam o glifo de espera.
30. ✅ A busca sem resultado diz o termo procurado.
31. ✅ O botão desabilitado explica o motivo na dica e abaixo dele.
32. 🔧 O esmaecido do desabilitado agora é igual em todos os botões (0,45).
33. 🔧 "Pedir revisão" e "Recusar" esmaecem durante o envio (antes só travavam).
34. ✅ Ocupado mostra um spinner ao lado das ações.
35. ✅ Touch ID cancelado vira aviso neutro "nada foi enviado".
36. ✅ Itens silenciados ficam a 55% com o menu de aviso visível.
37. 🔧 Caixa de gestores com zero esmaece, além de travar.
38. ✅ Dado velho (> 10 min) muda o ponto para âmbar.
39. 🔧 Dado velho ou erro faz o ponto pulsar devagar (sem pulso com Reduzir movimento).
40. ✅ O escritório pausado aparece no Sistema e no ajuste.

**Interação (41–60)**
41. 🔧 Todos os botões customizados dão retorno ao pressionar.
42. 🔧 Os botões principais e secundários mudam ao passar o mouse.
43. 🔧 Os botões de ícone mudam ao passar o mouse.
44. 🔧 O indicador de aba desliza em vez de piscar.
45. 🔧 As abas mostram estado ao passar o mouse.
46. ✅ As teclas 1–6 e ← → trocam de aba (dica em cada aba).
47. ✅ Esc volta ou fecha.
48. ✅ O alfinete mantém a ilha aberta, com estado ativo visível.
49. 🔧 A busca de contas ganhou o botão de limpar.
50. 🔧 O sino compacto de silenciar tinha cerca de 20×16 pt; agora tem no mínimo 24×20.
51. 🔧 O fechar do balão do Bunk tinha 9 pt de área; agora tem 20×20, com dica.
52. ✅ Os botões de ícone têm 24 pt (acima do mínimo de 20).
53. ⏳ Subir os botões de ícone para 28 pt (padrão HIG).
54. ✅ O clique no aviso abre a ilha; o menu de contexto silencia.
55. ✅ O chevron das linhas só aparece forte ao passar o mouse.
56. 🔧 O chevron desliza ao passar o mouse, deixando claro que a linha abre algo.
57. ✅ As caixas de gestores filtram e mostram a seleção com borda violeta.
58. ✅ Os botões de % e o campo livre ficam sincronizados.
59. ✅ O valor "de → para" aparece antes do Touch ID.
60. ⏳ Gesto de deslizar para fechar e háptico ao abrir.

**Movimento (61–70)**
61. ✅ Abrir com mola viva, fechar sem rebote.
62. ✅ Reduzir movimento troca as molas por fade.
63. ✅ Reduzir transparência desliga desfoques.
64. 🔧 Os números rolam dígito a dígito ao mudar (com Reduzir movimento, só fade).
65. 🔧 A lista some suave na borda inferior.
66. ✅ O rodízio do repouso troca o texto com desfoque.
67. 🔧 O halo do aviso some sem desfoque com Reduzir transparência.
68. ✅ Toda animação dura menos de 2 s.
69. ✅ Sem animação contínua em repouso (só o pulso de erro, e sem ele com Reduzir movimento).
70. ⏳ Animar só a linha que muda de posição na fila.

**Acessibilidade (71–85)**
71. ✅ Os botões de ícone leem o propósito, não o nome do símbolo.
72. 🔧 Os badges e iniciais decorativos ficam ocultos do VoiceOver.
73. 🔧 Os cabeçalhos de seção são anunciados como cabeçalho.
74. 🔧 O bloco de ritmo é lido como um único elemento.
75. ✅ Os blocos de KPI são lidos como um único elemento.
76. 🔧 As linhas sem ação são lidas como um único elemento.
77. 🔧 As mensagens dos agentes são lidas como um único elemento.
78. 🔧 Os botões "O que fazer", de % e as caixas de gestores anunciam "selecionado".
79. 🔧 Os botões de % leem "20 por cento".
80. 🔧 A caixa "Muda na Meta" é lida inteira.
81. 🔧 O wordmark é lido como "Bunk", não letra a letra.
82. ✅ Os minigráficos têm um rótulo com os quatro períodos.
83. 🔧 O Aumentar contraste reforça superfícies, tons, tintas e o aro (auditado).
84. ✅ Os estados sempre têm glifo além de cor.
85. ⏳ Anel de foco de teclado em todos os controles customizados.

**Consistência (86–100)**
86. 🔧 Uma única regra de tinta por tom (pill, chip, badge, aviso).
87. 🔧 Um único botão principal ("Ajustar aqui" deixou de ser um botão à parte).
88. 🔧 Um único estilo de chip para ação rápida, "abrir" e veredito.
89. 🔧 Iniciais de projeto e agente com o mesmo componente.
90. 🔧 Os paddings de controle vêm de `DS.Inset`.
91. 🔧 Os tamanhos de ícone vêm de `DS.Icon`.
92. 🔧 As opacidades de estado vêm de `DS.Opacity`.
93. 🔧 A sombra vem de `DS.Elevation`.
94. 🔧 Os raios são contínuos em todas as linhas.
95. ✅ A ilha sempre escura, coerente com o notch físico.
96. ✅ A janela de sons segue as cores do sistema (claro e escuro).
97. ⏳ A janela de sons ainda não usa os componentes da ilha.
98. ✅ A prévia `--render-notch` cobre 16 telas, sem dados reais.
99. 🔧 O autoteste falha se um token perder contraste ou sair da grade.
100. ⏳ Prévias de alto contraste e Reduzir movimento no renderizador.

Totais da rodada de UX: 45 passavam, 49 foram corrigidas e 6 ficaram registradas para depois.

## Web do Bunker no mesmo sistema (10/11/2026)

Pedido do dono: a web deve seguir o design system e a experiência do notch. Só apresentação; nenhuma regra, número ou fluxo de ordem mudou.

- **Tokens:** o contrato semântico de `app/malva-theme.css` passou a usar os valores do notch: fundo preto, superfícies em branco translúcido, traço fino, um violeta de destaque (`#b89ce8`) e menta/coral/âmbar para estado. Como as telas já liam esses tokens, todas mudaram juntas. Fonte do sistema (SF no Mac) e dígitos de largura fixa.
- **Formas e componentes:** `app/notch-system.css`. Botões e etiquetas em cápsula, um botão de destaque por tela, cartões com traço fino e luz na borda de cima, avisos com tom e glifo, retorno de hover e de clique. Componentes `ns-*`: ilha, ponto de estado, chip, selo, linha de lista, controle segmentado, chip de liga/desliga, campo com unidade, aviso, barra flutuante de alterações.
- **Cores soltas:** os neutros arroxeados que restavam em CSS de componentes foram trocados por tokens. A cena em pixel do Escritório mantém a paleta própria.
- **Autonomia do Bunk (refeita):** uma ilha com o estado e a única ação de destaque (ligar pede confirmação na própria ilha, sem diálogo do navegador); projetos em linhas compactas com o nível num controle segmentado, que abrem para ações, limites e exceções; aviso "Falta limite" quando há ação marcada sem o limite que ela exige; barra flutuante para salvar ou descartar; registro e ordens na lateral. Nessa tela a barra de projeto e período fica oculta.
- **Conferido** no preview local com dados fictícios, em tela larga e em 375 px. O Site `chatgpt.site` só recebe isso quando for republicado.

> **Substituído no mesmo dia (10/11/2026):** a versão acima (`app/notch-system.css`, componentes `ns-*`) foi trocada pela aplicação completa em todas as telas, com a camada `app/notch-ds.css` (tokens `--ds-*`, componentes `.ds-*`), descrita em `docs/web-design-system.md`. Escolha do dono. O commit da versão anterior (`03ea3f1`) continua no histórico.
