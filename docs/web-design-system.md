# Design system do notch na web — 10/11/2026

O painel web agora usa a mesma linguagem visual do notch do Mac. A fonte de verdade continua sendo `mac/BunkerNotch/Sources/BunkerNotch/DesignSystem.swift`, resumida em `docs/notch-design-system.md`. Na web, a camada de tokens e componentes fica em **`app/notch-ds.css`**.

Esta rodada mexe só na apresentação. Dados, chamadas, valores salvos, permissões, aprovações, Touch ID e textos continuam como estavam.

## 1. Arquivos e ordem de carga

| Arquivo | Papel |
| --- | --- |
| `app/notch-ds.css` | Paleta crua, tokens `--ds-*`, Aumentar contraste, Reduzir movimento e transparência, ponte legada e componentes `.ds-*`. Importado em `app/layout.tsx`, logo depois de `globals.css`. |
| `app/globals.css` | Estilos base: `body`, títulos, foco, seleção, rolagem e desabilitado. As classes antigas (`.panel`, `.kpi`, `.pill`, `.notice`…) agora leem os tokens, sem cor fixa fora do bloco de impressão. Também mapeia o `@theme` do Tailwind para os tokens. |
| `app/fonts.css` | Instrument Sans e JetBrains Mono, só como reserva: a fonte principal é a do sistema. |
| `app/malva-theme.css`, `app/uix.css` | Tema antigo, com os mesmos seletores. Na rodada das seções passaram a ler só tokens `--ds-*` (cor, raio, tipo, espaço, movimento), sem paleta própria. As variáveis antigas continuam passando pela ponte (seção 5). |

**Por que a ordem não importa.** O `bunker.tsx` importa `uix.css` e `malva-theme.css` depois do layout, então o tema antigo carrega depois do `notch-ds.css`. Duas travas de especificidade resolvem isso:

- **A ponte** declara as variáveis antigas em `:root:root, :root .app, :root .workspace-dialog, :root .dc-modal, :root .uix-mobile-nav, :root [data-slot=tooltip-content]`. Isso dá especificidade (0,2,0), contra (0,1,0) do `malva-theme.css`, e a ponte vence.
- **Os componentes** usam a trava `:not(#_)`, que dá especificidade (1,1,0). Assim vencem as regras `body .app …` (até 0,3,2) em qualquer ordem.

Para ajustar um componente na sua seção, você tem duas saídas:

1. Use as **variáveis de gancho**: `--ds-card-pad`, `--ds-card-radius`, `--ds-card-bg`, `--ds-card-stroke`, `--ds-btn-h`, `--ds-btn-pad-x`, `--ds-btn-radius`, `--ds-tile-pad`, `--ds-tile-radius`, `--ds-kpi-pad`, `--ds-kpi-min`, `--ds-stack-gap`, `--ds-cluster-gap`, `--ds-list-gap`, `--ds-skeleton-w`, `--ds-skeleton-h`, `--ds-fade`, `--ds-glyph-size`, `--ds-meter-value`, `--ds-seg-index`, `--ds-seg-count`, `--ds-tab-x`, `--ds-tab-w`. Elas valem com qualquer seletor, porque o componente lê a variável mas não a define.
2. Repita a trava no seletor da seção: `.autonomy-panel .ds-card:not(#_) { … }`.

Propriedades que o componente não define (margem, `grid-area`, `order`…) funcionam normalmente, sem trava.

## 2. Tokens de cor (web ↔ notch)

Superfícies opacas são branco sobre o canvas, feitas com `color-mix`. Os preenchimentos translúcidos somam sobre o que estiver embaixo, como no notch.

| Token web | Notch (`Token`/`DS.Color`) | Padrão | Aumentar contraste | Uso |
| --- | --- | --- | --- | --- |
| `--ds-canvas` | `Palette.canvas` | `#0a0a0c` | `#000` | fundo da página |
| `--ds-surface-sunken` | — (web) | branco 3 % → `#111113` | 6 % | campo de busca, faixa recolhida, `th` |
| `--ds-surface` | `surface` | 5,5 % → `#171719` | 10 % | card, painel |
| `--ds-surface-overlay` | — (web) | 7,5 % → `#1c1c1e` | 12 % | diálogo, popover, toast, tooltip |
| `--ds-surface-hover` | `surfaceHover` | 9 % → `#202022` | 15 % | passar o mouse |
| `--ds-surface-selected` | `surfaceSelected` | 12 % → `#272729` | 19 % | item ativo |
| `--ds-fill` · `--ds-fill-hover` · `--ds-fill-selected` | `surface` · `surfaceHover` · `surfaceSelected` (translúcidos) | branco .055 · .09 · .12 | .10 · .15 · .19 | tile no card, botão, campo, segmentado |
| `--ds-stroke` | `stroke` | branco .08 | .24 | fio de card, divisória |
| `--ds-stroke-strong` | `strokeStrong` | .16 | .36 | passar o mouse, campo, popover |
| `--ds-highlight` | `highlight` | .07 | 0 | luz na borda de cima do card |
| `--ds-rim` | `rim` | .08 | .22 | aro de superfície flutuante |
| `--ds-ink` | `ink` | branco .94 | 1 | texto principal |
| `--ds-ink-soft` | `inkSoft` | .72 | .86 | texto secundário, eyebrow |
| `--ds-ink-muted` | `inkMuted` | .56 | .74 | legenda, terciário |
| `--ds-ink-pill` | `inkPill` | .64 | .82 | texto do pill neutro |
| `--ds-ink-faint` | `inkFaint` | .30 | .50 | **só decorativo**: chevron em repouso, divisória |
| `--ds-on-accent` | `onAccent` | preto .86 | igual | texto sobre o violeta |
| `--ds-accent` | `accent` / `Palette.violet` | `#b89ce8` | `#d1baff` | identidade e ação principal, foco |
| `--ds-good` | `good` / `mint` | `#3dcc9e` | `#66ebbd` | bom |
| `--ds-bad` | `bad` / `coral` | `#f2737a` | `#ff999e` | ruim, erro |
| `--ds-warn` | `warn` / `amber` | `#f5bd66` | `#ffd68a` | atenção, dado velho |
| `--ds-neutral` | `Tone.neutral` | = `ink-muted` | igual | info, neutro |
| `--ds-{tom}-fill` | `Tone.fill` | tom a 15 % | 22 % | pill, chip, badge |
| `--ds-{tom}-wash` | `Tone.wash` | tom a 8 % | 14 % | área grande (caixa "Muda na Meta", bloqueio) |
| `--ds-{tom}-rim` | `Tone.rim` | tom a 30 % | 60 % | fio na cor do tom |
| `--ds-neutral-fill` · `--ds-tag-fill` | `Tone.neutral.fill` · `Tone.tag.fill` | ink-muted a 12 % · branco .07 | igual · .12 | pill neutro · rótulo de projeto ou conta |
| `--ds-tint-hover` | — | 20 % | 30 % | chip, perigo e ícone ativo ao passar o mouse |
| `--ds-accent-hover` | brilho do `ActionButton` | violeta + 12 % branco | igual | hover do botão antigo `.button.primary` |
| `--ds-focus` | — | = accent | igual | anel de foco (2 px, recuo 2 px) |
| `--ds-scrim` | — | preto .62 com blur de 6 px | — | véu do diálogo (opaco .88 e sem blur com Reduzir transparência) |

Em `{tom}` entram `accent`, `good`, `bad` e `warn`. A paleta crua fica em `--ds-raw-*`: não use direto numa seção.

## 3. Tipografia

A fonte é a do sistema, como no notch:

```css
--ds-font-text: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", "Instrument Sans Variable", …;
```

- **Números** usam `--ds-font-rounded` (`ui-rounded`, `"SF Pro Rounded"`) com `font-variant-numeric: tabular-nums`.
- **Código e IDs** usam `--ds-font-mono` (`ui-monospace`, `"SF Mono"`, JetBrains como reserva).

A escala mantém as razões do notch, com corpo de 13,5 px e **piso de 11 px** para qualquer texto que precise ser lido:

| Token | px | Notch | Peso | Classe |
| --- | --- | --- | --- | --- |
| `--ds-font-micro` | 11 | micro 10 | 400 / 600 | `.ds-micro` |
| `--ds-font-pill` | 11 | pill 10 | 600, tabular | `.ds-pill` |
| `--ds-font-caption` / `--ds-font-eyebrow` | 12 | caption / eyebrow 10,5 | 400 / 600 | `.ds-caption`, `.ds-caption-strong`, `.ds-eyebrow` |
| `--ds-font-body` | 13,5 | body 12 | 400 / 600 | `.ds-body`, `.ds-body-strong` |
| `--ds-font-number` | 14 | number 12,5 | 600, arredondada, tabular | `.ds-num` |
| `--ds-font-title` | 14,5 | title 13 | 600 | `.ds-title` |
| `--ds-font-headline` | 18 | — (web) | 600 | `.ds-headline` (título de seção, `h2`) |
| `--ds-font-stat` | 22 | stat 20 | 600, arredondada, tabular | `.ds-stat`, `.ds-kpi__value` |
| `--ds-font-display` | 26 | — (web) | 600 | `.ds-display` (título da página, `h1`) |

Entrelinha: `--ds-leading-tight` 1,25 · `--ds-leading-body` 1,5 · `--ds-leading-relaxed` 1,65.

O eyebrow segue o do notch: frase curta em caixa normal, semibold, `ink-soft`, com rastreio de .01em. Os eyebrows antigos (`.eyebrow`, `.vo-kicker`, `.dc-eyebrow`) deixaram de ser monoespaçados.

## 4. Espaço, raio, tamanho, estado, elevação e movimento

**Espaço (grade de 4 px).**

- `--ds-space-xxs` 2 (só para fios) · `xs` 4 · `s` 8 · `m` 12 · `l` 16 · `xl` 20 · `xxl` 24 · `3xl` 32 · `4xl` 40 · `5xl` 48.
- Padding por família de controle: `--ds-inset-pill` 2/8 · `chip` 4/10 · `control` 6/14 · `tab` 6/12 · `row` 8/12 · `field` 7/10 · `card` 16 · `card-lg` 20.

**Raio (contínuo e concêntrico).**

- `--ds-radius-bar` 1 · `xs` 4 · `s` 6 · `m` 10 · `l` 14 · `xl` 20 · `pill` 999.
- Regra concêntrica: **raio interno = raio externo − recuo**, com mínimo `xs`. Exemplos:
  - card `l` (14) com tile a 4 px da borda → tile `m` (10);
  - card `m` (10) com tile a 4 px → `s` (6);
  - diálogo `xl` (20) com card a 8 px → `m` (10) ou menos, nunca `l`.

**Tamanhos.**

- Alvo de clique: mínimo `--ds-size-hit-min` 24 px; o padrão é 28 (`--ds-size-icon-button`, `--ds-size-control-sm`).
- Botão com texto: `--ds-size-control` 32.
- Badge e monograma: `--ds-size-badge` 28.
- Ponto: `--ds-size-dot` 7 e `dot-sm` 6.
- Ícones: `--ds-size-icon-xs` 12 · `s` 14 · `icon` 16 · `l` 18.

**Opacidade de estado.**

- `--ds-opacity-disabled` .45: desabilitado, sempre o mesmo.
- `--ds-opacity-quiet` .55: silenciado (`.ds-quiet`).
- `--ds-opacity-switching` .4: trocando de projeto (`.ds-switching`).
- `--ds-opacity-resting-hint` .35 e `--ds-opacity-pressed` .82.

**Elevação.**

- `--ds-elevation-card`: só a luz no topo, sem sombra.
- `--ds-elevation-peek`: sombra leve.
- `--ds-elevation-overlay`: sombra funda, para diálogos e popovers.
- O `--shadow-surface` antigo agora é a luz no topo, então todos os painéis antigos ganharam o brilho de borda do notch.

**Movimento (toda animação < 2 s).**

| Token | Valor | Notch |
| --- | --- | --- |
| `--ds-dur-hover` | 120 ms ease-out | `Motion.hover` |
| `--ds-dur-quick` | 150 ms | `Motion.quick` |
| `--ds-dur-press` + `--ds-ease-press` | 220 ms, mola com rebote | `Motion.press` |
| `--ds-dur-select` + `--ds-ease-firm` | 320 ms, sem rebote | `Motion.select` |
| `--ds-dur-close` / `--ds-dur-open` + `--ds-ease-spring` | 360 / 420 ms | `Motion.close` / `open` |
| `--ds-dur-number` | 450 ms | `Motion.number` |
| `--ds-dur-breathe` | 900 ms | respiração do `SkeletonBlock` |
| `--ds-dur-pulse` | 1,6 s | pulso do `StatusDot` |
| `--ds-press-scale` / `--ds-row-press-scale` / `--ds-chevron-shift` | .97 / .99 / 2 px | `PressableStyle`, linha, chevron |

**Preferências do sistema.**

- **Reduzir movimento:** a escala e o deslocamento do chevron vão a zero, as molas viram ease-in-out e não há pulso, respiração nem giro. A regra antiga do `globals.css` continua cortando todas as transições e animações nesse modo.
- **Reduzir transparência:** véu opaco e nenhum `backdrop-filter`.
- **Aumentar contraste:** todos os tokens vão para o gêmeo HC.
- **Cores forçadas (Windows):** bordas e glifos na cor do sistema.

## 5. Ponte legada

Cada variável antiga aponta para um token. Assim, as telas que ainda não foram revistas já mudam para o visual do notch.

| Variável antiga (origem) | Token |
| --- | --- |
| `--canvas`, `--bg`, `--background` | `--ds-canvas` |
| `--surface`, `--panel`, `--card`, `--uix-surface` | `--ds-surface` |
| `--surface-subtle`, `--surface-muted`, `--uix-subtle` | `--ds-surface-sunken` |
| `--surface-hover`, `--uix-hover` | `--ds-surface-hover` |
| `--surface-raised`, `--secondary` | `--ds-surface-selected` |
| `--popover` | `--ds-surface-overlay` |
| `--border`, `--line`, `--line-subtle`, `--dc-line`, `--cp-line` | `--ds-stroke` |
| `--line-strong`, `--input` | `--ds-stroke-strong` |
| `--ink`, `--text`, `--foreground`, `--*-foreground`, `--dc-ink`, `--cp-ink` | `--ds-ink` |
| `--ink-soft`, `--muted`, `--muted-foreground`, `--info`, `--dc-muted`, `--cp-muted` | `--ds-ink-soft` |
| `--ink-muted` | `--ds-ink-muted` |
| `--brand`, `--primary`, `--selection`, `--accent`, `--ring`, `--dc-mint`, `--cp-green` | `--ds-accent` (foco: `--ds-focus`) |
| `--brand-hover` · `--brand-soft`, `--accent-soft` | `--ds-accent-hover` · `--ds-accent-fill` |
| `--primary-foreground` | `--ds-on-accent` |
| `--success`, `--green`, `--teal` · `--success-soft` · `--success-line` | `--ds-good` · `--ds-good-wash` · `--ds-good-rim` |
| `--warning`, `--orange`, `--amber`, `--dc-gold` · `--warning-soft` · `--warning-line` | `--ds-warn` · `-wash` · `-rim` |
| `--danger`, `--red`, `--destructive` · `--danger-soft` · `--danger-line` | `--ds-bad` · `-wash` · `-rim` |
| `--radius`, `--radius-control` · `--radius-card` · `--radius-dialog` | `--ds-radius-m` · `l` · `xl` |
| `--shadow-surface` | `--ds-elevation-card` |
| `--font-ui` · `--font-mono` | `--ds-font-text` · `--ds-font-mono` |

O Tailwind/shadcn (`@theme` no `globals.css`) passou a ler direto:

- `--color-accent` → `--ds-surface-hover`. É o fundo de hover dos menus, que não pode ser violeta.
- `--color-popover` → `--ds-surface-overlay`.
- `--color-input` → `--ds-stroke-strong`.
- `--color-ring` → `--ds-focus`.

Com isso, `--accent` ficou livre para ser o violeta, que é o que as seções já esperavam com `var(--accent, #b79ce8)`. Antes, focos e links dessas seções saíam cinza.

O `notch-ds.css` também sobrescreve algumas cores fixas do tema antigo:

- o texto `#fff` no hover do botão principal e no link de pular, que agora usa `--ds-on-accent`;
- os eyebrows monoespaçados, que passam para a fonte do texto em semibold;
- os números de `.kpi`, `.signal`, `.priority-metric`, `.window-row` e `.budget-number`, agora em fonte arredondada e tabular.

## 6. Componentes

Em React, use `className`. Todo componente decorativo leva `aria-hidden="true"`.

### Texto e cabeçalho de seção
```html
<header class="ds-header">
  <h2 class="ds-header__title">Aguardando você</h2>
  <span class="ds-header__detail">3 propostas · atualizado há 2 min</span>
  <div class="ds-header__actions"><button class="ds-btn ds-btn--ghost ds-btn--sm">Ver todas</button></div>
</header>
<span class="ds-eyebrow">Autonomia do Bunk</span>
<h1 class="ds-display">Central de tráfego</h1>
<h3 class="ds-title">Campanha X</h3> <p class="ds-body">…</p> <small class="ds-caption">…</small>
<span class="ds-num">R$ 1.240</span> <strong class="ds-stat">1,31x</strong>
```
Também existem `.ds-headline`, `.ds-micro`, `.ds-body-strong`, `.ds-caption-strong`, `.ds-tabular` e `.ds-mono`. Há utilitários de cor de texto: `.ds-text-ink`, `-soft`, `-muted`, `-good`, `-bad`, `-warn` e `-accent`. Para layout, `.ds-truncate`, `.ds-sr-only`, `.ds-stack`, `.ds-cluster` e `.ds-divider`. `.ds-num-enter` dá a entrada suave de um número que mudou: troque a `key` para repetir.

### Card e tile
```html
<section class="ds-card">
  <span class="ds-eyebrow">Ritmo do orçamento</span>
  <div class="ds-tile">…</div>
</section>
<button class="ds-card ds-card--interactive" aria-current="true">…</button>
```
- Modificadores: `--lg` (padding 20), `--flush` (sem padding), `--sunken`, `--interactive` (hover e pressionar), `--selected` (o mesmo vale para `aria-selected` e `aria-current`, com fio violeta).
- Tons: `--good`, `--bad`, `--warn` e `--accent` aplicam o wash e o fio do tom.
- Superfícies flutuantes usam `.ds-popover`; o véu do diálogo usa `.ds-scrim`.

### KPI
```html
<div class="ds-kpi-grid">
  <div class="ds-kpi">
    <span class="ds-kpi__label">ROAS · 7 dias</span>
    <strong class="ds-kpi__value">1,31x</strong>
    <span class="ds-kpi__foot">ontem <span class="ds-kpi__delta ds-kpi__delta--good">↑ 8%</span></span>
  </div>
</div>
```
`.ds-kpi--tile` é a versão para dentro de um card. O número é sempre o maior texto do bloco. Cada variação traz o período e a seta junto da cor.

### Pill, chip, badge, monograma, glifo e ponto
```html
<span class="ds-pill ds-pill--good">+12%</span>
<span class="ds-pill ds-pill--tag">Projeto Gabe</span>
<button class="ds-chip ds-chip--accent"><svg …/>Abrir</button>
<span class="ds-chip ds-chip--bad ds-chip--outlined">Perda</span>
<span class="ds-badge ds-badge--warn" aria-hidden="true"><svg …/></span>
<span class="ds-monogram ds-monogram--circle" aria-hidden="true">G</span>
<span class="ds-glyph ds-glyph--bad" aria-hidden="true"></span>
<span class="ds-dot ds-dot--warn ds-dot--pulse" aria-hidden="true"></span>
```
- Tons: `--neutral`, `--tag`, `--accent`, `--good`, `--bad` e `--warn`. O pill sem modificador é neutro; chip, badge e monograma sem modificador são violeta.
- Glifos extras: `--clear` (✓ em contorno), `--waiting` (relógio), `--info` e `--chevron`.
- `.ds-dot--sm` é o ponto menor; `.ds-dot--pulse` só serve para dado velho ou erro.

### Botões
```html
<button class="ds-btn ds-btn--primary">Aprovar</button>
<button class="ds-btn">Pedir revisão</button>
<button class="ds-btn ds-btn--ghost">Cancelar</button>
<button class="ds-btn ds-btn--danger">Recusar</button>
<button class="ds-btn ds-btn--icon" aria-label="Atualizar"><svg …/></button>
<button class="ds-btn ds-btn--icon" aria-pressed="true" aria-label="Fixar"><svg …/></button>
<button class="ds-btn ds-btn--primary" disabled aria-describedby="motivo">Executar</button>
<p class="ds-disabled-reason" id="motivo">Falta a leitura de hoje do Malva.</p>
<button class="ds-btn" aria-busy="true"><span class="ds-spinner" aria-hidden="true"></span>Enviando…</button>
```
- Tamanhos: `--sm` tem 28 px, o padrão 32 px e o ícone 28 px.
- `--block` ocupa a largura toda.
- Todo botão tem passar o mouse, pressionar (encolhe 3 % e esmaece), foco visível e desabilitado a .45 (`disabled` ou `aria-disabled="true"`).
- O botão principal tem o brilho de topo do `ActionButton`.

### Segmentado e abas
```html
<div class="ds-segmented ds-segmented--sliding" role="tablist" style="--ds-seg-count:4; --ds-seg-index:1">
  <button role="tab" aria-selected="false">Hoje</button>
  <button role="tab" aria-selected="true">Ontem</button>
  <button role="tab" aria-selected="false">3 dias</button>
  <button role="tab" aria-selected="false">7 dias</button>
</div>
<nav class="ds-tabs" role="tablist">
  <button role="tab" aria-selected="true">Agora</button><button role="tab" aria-selected="false">Projetos</button>
</nav>
```
- Sem `--sliding`, o item marcado recebe o fundo direto. Contam como marcado `aria-selected`, `aria-pressed`, `aria-checked`, `aria-current`, `.is-selected` e um `label` com rádio marcado.
- Com `--sliding`, o indicador desliza pelo índice.
- `.ds-tabs--sliding` desliza com `--ds-tab-x` e `--ds-tab-w`, medidos em JS.
- `.ds-tabs--underline` usa um traço violeta embaixo.
- `.ds-tabs--scroll` rola na horizontal. `.ds-segmented--block` ocupa a largura toda.

### Interruptor
```html
<label class="ds-switch-row">
  <span><span class="ds-body-strong">Pausar campanhas sem venda</span><br><small class="ds-caption">Só depois da sua aprovação.</small></span>
  <input type="checkbox" class="ds-switch" role="switch">
</label>
<button type="button" class="ds-switch" role="switch" aria-checked="true" aria-label="Escritório ligado"></button>
```
O estado ligado aparece pela posição da bolinha e pelo violeta, nunca só pela cor.

### Campos
```html
<div class="ds-form-row">
  <label class="ds-label" for="teto">Teto diário</label>
  <input id="teto" class="ds-field" aria-invalid="true" aria-describedby="teto-dica">
  <p class="ds-hint ds-hint--error" id="teto-dica">Use um valor maior que zero.</p>
</div>
<select class="ds-field">…</select> <textarea class="ds-field"></textarea>
```
- `.ds-field--sm` tem 28 px.
- Foco: fio violeta e anel suave.
- Inválido (`aria-invalid` ou `.is-invalid`): fio coral, e a dica de erro leva o glifo ⛔.
- `.ds-hint--warn` leva ⚠.

### Aviso (banner)
```html
<div class="ds-banner ds-banner--bad" role="alert">
  <div class="ds-banner__body"><strong>Erro de leitura do Malva</strong><p>Os números abaixo são da última leitura boa.</p></div>
  <div class="ds-banner__actions"><button class="ds-btn ds-btn--sm">Tentar de novo</button></div>
</div>
<div class="ds-banner ds-banner--info">Lendo o projeto escolhido…</div>
```
- O glifo sai do tom: `--good` ✓, `--info`/`--neutral` ⓘ (é o padrão), `--warn` ⚠, `--bad` ⛔, `--accent` ✦.
- Um `<svg>` como primeiro filho substitui o glifo automático e herda a cor do tom.

### Vazio, espera e esqueleto
```html
<p class="ds-empty ds-empty--clear">Nada esperando sua aprovação.</p>
<p class="ds-empty">Sem leitura de hoje para esta conta.</p>
<p class="ds-empty ds-empty--waiting">Resumo sendo montado; próxima atualização às 14h.</p>
<div class="ds-empty ds-empty--block"><strong>Nenhuma campanha encontrada</strong><p>Nada corresponde a "black friday" neste projeto.</p></div>
<div aria-busy="true" aria-label="Carregando">
  <span class="ds-skeleton ds-skeleton--title" aria-hidden="true"></span>
  <span class="ds-skeleton ds-skeleton--stat" aria-hidden="true"></span>
  <span class="ds-skeleton ds-skeleton--text" style="--ds-skeleton-w:60%" aria-hidden="true"></span>
</div>
```
Esqueletos: `--text`, `--title`, `--stat`, `--block` e `--circle`.

### Lista e linha
```html
<ul class="ds-list ds-list--divided">
  <li><button class="ds-row">
    <span class="ds-row__lead"><span class="ds-monogram" aria-hidden="true">G</span></span>
    <span class="ds-row__main"><span class="ds-row__title" title="Nome completo">Campanha…</span><span class="ds-row__sub">Conta 2 · ativa</span></span>
    <span class="ds-row__trail"><span class="ds-num">R$ 320</span><small class="ds-caption">hoje</small></span>
    <span class="ds-row__chevron" aria-hidden="true"></span>
  </button></li>
</ul>
```
- Linhas `button`, `a` ou com `tabindex` (ou `.ds-row--interactive`) têm hover e pressionar de 1 %.
- O chevron acende e desliza 2 px ao passar o mouse.
- Uma linha selecionada usa `aria-selected` ou `aria-current`.
- `.ds-row--quiet` é a linha silenciada, a 55 %.

### Medidor e borda de rolagem
```html
<span class="ds-meter ds-meter--warn" style="--ds-meter-value:82" role="img" aria-label="82% do orçamento"></span>
<div class="ds-scroll-fade" style="overflow:auto; max-height:420px">…</div>
```
A borda de rolagem tem as variantes `--both` (topo e base) e `--x` (horizontal). `.ds-switching` esmaece os números antigos enquanto o projeto troca.

## 7. Regras

1. **Uma ação principal por tela.** Só um `.ds-btn--primary` violeta por vista. O resto é secundário ou fantasma.
2. **Violeta só para identidade e ação principal.** Rótulos de contexto (projeto, conta) usam `--tag`; estados usam menta, coral ou âmbar.
3. **Estado nunca só pela cor.** Todo tom vem com glifo (✓ bom, ⓘ info, ⛔ erro, ⚠ atenção, relógio para espera) ou com texto que diga o mesmo. Setas acompanham a cor nas variações.
4. **Grade de 4 px.** Espaço, padding e gap saem de `--ds-space-*` e `--ds-inset-*`. O valor de 2 px é só para fios.
5. **Contraste AA (4,5:1).** Texto que precisa ser lido usa `ink`, `ink-soft`, `ink-muted` ou `ink-pill`, ou o tom sobre a própria tinta. `ink-faint` é só decorativo. Veja a seção 8.
6. **Piso de 11 px.** Nada legível abaixo de `--ds-font-micro`.
7. **Raios concêntricos.** Interno = externo − recuo.
8. **Movimento curto.** Use 120–420 ms com ease-out ou mola, sempre abaixo de 2 s. Não há animação contínua em repouso: só o pulso de erro ou de dado velho e o esqueleto.
9. **Retorno em todo controle.** Passar o mouse, pressionar e foco visível. Alvo de clique ≥ 24 px, com 28 px de preferência.
10. **Carregando.** Use esqueleto com a forma do conteúdo. Spinner só ao lado de uma ação ocupada.
11. **Vazio diz por quê.** `--clear` (✓ verde) só quando "nada a fazer" é boa notícia. Falta de dado usa ⓘ, e o que está sendo montado usa o relógio.
12. **Desabilitado explica o motivo.** Opacidade .45 com `title`, `aria-describedby` ou `.ds-disabled-reason` logo abaixo.
13. **Acessibilidade.** Respeite Reduzir movimento, Reduzir transparência e Aumentar contraste, que já vêm nos tokens. Badges e monogramas levam `aria-hidden`; botões de ícone levam `aria-label` com o propósito, não o nome do ícone.

## 8. Contraste medido (WCAG 2.x)

As razões foram calculadas por script, nada estimado. A conta compõe cada tinta translúcida sobre a superfície opaca em sRGB, como o navegador faz no `color-mix(in srgb)`, e aplica a fórmula de luminância da WCAG. "fill/card" é o preenchimento translúcido (tile, botão, campo) sobre um card.

**Padrão** (canvas `#0a0a0c`):

| texto \ superfície | canvas | surface | sunken | overlay | hover | selected | fill/card | fill-hover/card | fill-selected/card |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ink | 17,41 | 15,80 | 16,62 | 15,06 | 14,48 | 13,26 | 13,79 | 12,44 | 11,30 |
| ink-soft | 10,24 | 9,61 | 9,96 | 9,27 | 8,99 | 8,39 | 8,66 | 7,96 | 7,35 |
| ink-muted | 6,46 | 6,27 | 6,40 | 6,12 | 5,99 | 5,69 | 5,82 | 5,46 | 5,13 |
| ink-pill | 8,21 | 7,82 | 8,05 | 7,59 | 7,39 | 6,95 | 7,15 | 6,63 | 6,17 |
| good | 9,73 | 8,77 | 9,25 | 8,34 | 8,00 | 7,30 | 7,60 | 6,83 | 6,18 |
| bad | 7,07 | 6,37 | 6,73 | 6,06 | 5,81 | 5,30 | 5,53 | 4,96 | **4,49** |
| warn | 11,64 | 10,48 | 11,06 | 9,97 | 9,56 | 8,73 | 9,09 | 8,17 | 7,39 |
| accent | 8,44 | 7,60 | 8,02 | 7,23 | 6,94 | 6,33 | 6,59 | 5,92 | 5,36 |

**Aumentar contraste** (canvas `#000`):

| texto \ superfície | canvas | surface | sunken | overlay | hover | selected | fill/card | fill-hover/card | fill-selected/card |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ink | 21,00 | 17,49 | 19,13 | 16,56 | 15,08 | 13,11 | 13,11 | 11,04 | 9,57 |
| ink-soft | 15,21 | 13,11 | 14,14 | 12,49 | 11,50 | 10,13 | 10,13 | 8,66 | 7,60 |
| ink-muted | 11,14 | 9,96 | 10,59 | 9,56 | 8,89 | 7,94 | 7,94 | 6,90 | 6,12 |
| ink-pill | 13,77 | 12,00 | 12,89 | 11,46 | 10,58 | 9,36 | 9,36 | 8,04 | 7,08 |
| good | 14,18 | 11,81 | 12,92 | 11,18 | 10,19 | 8,86 | 8,86 | 7,46 | 6,46 |
| bad | 10,30 | 8,58 | 9,38 | 8,12 | 7,40 | 6,43 | 6,43 | 5,42 | 4,70 |
| warn | 15,24 | 12,69 | 13,88 | 12,01 | 10,95 | 9,51 | 9,51 | 8,01 | 6,95 |
| accent | 12,18 | 10,14 | 11,09 | 9,60 | 8,75 | 7,60 | 7,60 | 6,40 | 5,55 |

**Tom sobre a própria tinta** (pill, chip, badge), no padrão / com Aumentar contraste:

| tom | sobre canvas | sobre surface | sobre hover | hover do chip (20 % / 30 %) sobre surface |
| --- | --- | --- | --- | --- |
| good | 7,71 / 9,13 | 6,64 / 6,80 | 5,97 / 5,83 | 5,92 / 5,38 |
| bad | 5,90 / 7,27 | 5,12 / 5,48 | 4,62 / 4,70 | 4,68 / 4,51 |
| warn | 8,89 / 9,55 | 7,59 / 7,07 | 6,82 / 6,05 | 6,67 / 5,54 |
| accent | 6,79 / 8,18 | 5,85 / 6,09 | 5,26 / 5,22 | 5,26 / 4,91 |
| neutral (`ink-pill`) | 7,69 / 12,28 | 6,97 / 9,67 | 6,46 / 8,31 | — |
| tag (`ink-soft`) | 9,36 / 12,49 | 8,36 / 9,53 | 7,67 / 8,14 | — |

**Outros pares.**

| Par | Padrão | Aumentar contraste |
| --- | --- | --- |
| `on-accent` sobre violeta | 7,60 | 9,93 |
| `on-accent` sobre o hover do violeta | 8,41 | 10,54 |
| `ink` sobre os avisos (tom a 10 %) | 13,0 a 13,9 | 13,8 a 14,6 |
| `ink-soft` sobre o wash dos tons | 8,6 a 8,9 | 9,6 a 10,3 |
| Foco violeta sobre canvas / surface | 8,44 / 7,60 | 12,18 / 10,14 |

**Únicos pares abaixo de 4,5:1, de propósito:**

- `bad` como texto sobre `fill-selected` num card dá 4,49. Numa linha ou item selecionado, escreva o texto em `ink` e use o glifo ⛔ para o estado.
- `ink-faint` dá 2,71. É decorativo, nunca texto.
- `stroke-strong` dá 1,63, um fio igual ao do notch. Um campo nunca depende só do fio: sempre tem rótulo, e o foco é violeta.

Para refazer a conta depois de mudar um valor, rode o script abaixo com `node contraste.mjs '#0a0a0c'`:

```js
const W=a=>({r:1,g:1,b:1,a}),rgb=(h,a=1)=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255,a});
const over=(f,b)=>{const oa=f.a+b.a*(1-f.a),ch=(x,y)=>(x*f.a+y*b.a*(1-f.a))/oa;return{r:ch(f.r,b.r),g:ch(f.g,b.g),b:ch(f.b,b.b),a:oa}};
const lum=c=>{const l=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;return .2126*l(c.r)+.7152*l(c.g)+.0722*l(c.b)};
const cr=(x,y)=>{const a=lum(x),b=lum(y);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
for(const hc of[false,true]){const cv=rgb(hc?'#000000':process.argv[2]||'#0a0a0c'),sf=over(W(hc?.1:.055),cv);
 const S={canvas:cv,surface:sf,sunken:over(W(hc?.06:.03),cv),overlay:over(W(hc?.12:.075),cv),hover:over(W(hc?.15:.09),cv),selected:over(W(hc?.19:.12),cv),
  'fill/card':over(W(hc?.1:.055),sf),'fill-hover/card':over(W(hc?.15:.09),sf),'fill-selected/card':over(W(hc?.19:.12),sf)};
 const T={ink:W(hc?1:.94),'ink-soft':W(hc?.86:.72),'ink-muted':W(hc?.74:.56),'ink-pill':W(hc?.82:.64),
  good:rgb(hc?'#66ebbd':'#3dcc9e'),bad:rgb(hc?'#ff999e':'#f2737a'),warn:rgb(hc?'#ffd68a':'#f5bd66'),accent:rgb(hc?'#d1baff':'#b89ce8')};
 console.log(hc?'HC':'padrão');for(const[t,c]of Object.entries(T))console.log(t,Object.entries(S).map(([s,b])=>s+' '+cr(over(c,b),b).toFixed(2)).join(' · '))}
```

## 9. Como aplicar numa seção

1. **Leia antes.** Rode `grep` em `tests/` pelas classes e textos que você vai mexer antes de renomear ou remover qualquer um.
2. **Só tokens.** Nada de hex/rgb na CSS da seção: use `var(--ds-*)`. Desenho de pixel art fica de fora dessa regra. Se uma regra antiga do `malva-theme.css` ou do `uix.css` atrapalhar, sobrescreva a partir da sua CSS com um seletor da seção. Não edite o arquivo compartilhado.
3. **Estrutura.** Página com `.ds-display`, ou `h1` com o tamanho de display. Cada bloco num `.ds-card` com um `.ds-header` ou `.ds-eyebrow` acima do `.ds-title`. Caixas internas em `.ds-tile`, com raio concêntrico.
4. **Uma ação principal.** Escolha o único `.ds-btn--primary` da vista. Os outros são `.ds-btn`, `--ghost` ou `--danger`. Ações destrutivas nunca são as principais por padrão.
5. **Números.** Valores em `.ds-num`, `.ds-stat` ou `.ds-kpi__value`. N/D continua N/D, nunca zero. Cada variação traz período, seta e tom.
6. **Estados.** Cada tom com glifo (`.ds-pill--*`, `.ds-banner--*`, `.ds-glyph--*`, `.ds-dot--*`). Erro é ⛔, aviso é ⚠, info é ⓘ, bom é ✓.
7. **Carregando, vazio e desabilitado.**
   - Primeiro carregamento com `.ds-skeleton` no formato do conteúdo.
   - Vazio com `.ds-empty` no tipo certo e uma frase que diga o motivo.
   - Desabilitado com `disabled` e o motivo em `.ds-disabled-reason` ou no `title`.
8. **Controles.**
   - Filtro curto ou período em `.ds-segmented`; navegação entre vistas em `.ds-tabs`.
   - Opção liga/desliga em `.ds-switch` dentro de `.ds-switch-row`.
   - Entrada em `.ds-field` com `.ds-label` e `.ds-hint`.
   - Listas que abrem algo em `.ds-row` com `.ds-row__chevron`.
9. **Progressive disclosure.** Detalhes técnicos em `<details>` ou numa linha que abre. A tela mostra primeiro o que pede decisão.
10. **Acessibilidade.**
    - Foco visível. Não remova o anel; ele já é violeta.
    - Alvos ≥ 24 px.
    - `aria-label` nos botões de ícone e `aria-hidden` nos decorativos.
    - `role="alert"` só para erro.
    - Teste mentalmente com Reduzir movimento: nada pode depender de animação para fazer sentido.
11. **Copy.** Tudo em português do Brasil. Só melhore um rótulo se o sentido continuar idêntico.
12. **Feche a seção.** `npm run -s typecheck` e `npm test` verdes. Confira que a seção não introduziu hex novo.

## 10. Aplicado em (10/11/2026)

Mudou só a apresentação, em todas as telas. Dados, chamadas, payloads, valores salvos, permissões, aprovações, Touch ID, regras e números exibidos continuam iguais.

| Tela | O que mudou |
| --- | --- |
| **Navegação e topo** (`bunker.tsx`, `globals.css`) | Abas verticais do notch: o item ativo tem traço e ícone violeta, e todo item reage a hover, clique e foco. A lateral e o menu do celular usam a mesma lista. O cabeçalho segue eyebrow → título de display → uma linha, com uma só ação violeta por vista. O período virou segmentado deslizante e os avisos viraram banners com glifo. |
| **Visão geral** (`daily-brief`, `overview-analysis-status`, `live-update-notice`, `project-scope-notice`) | KPIs com número arredondado e tabular, com ✓/⛔ em ROI e Lucro. "Hoje em 1 minuto" mostra tiles e uma fila em linhas `.ds-row`. Estado da análise em banner com glifo e quatro cards clicáveis. A primeira carga usa esqueleto. O ponto de atualização tem quatro estados. |
| **Cards de decisão** (`decision-cards`, `-kanban`, `-list`, `-contingency`, `proposal-card`) | O inspetor segue a ordem do OwnerCards: identidade, campanha, sugestão, motivo, números, ação. O "de → para" tem o diário proposto em destaque. As quatro ações têm ícone e tom. Há uma ação principal, e o motivo de cada desabilitado aparece no `aria-describedby`. A proteção da operação usa badge e pill do mesmo tom. |
| **Campanhas** (`campaign-activity`, `-daily-results`, `-forecast`, `-monitor`, `-watch-panel`) | Período em segmentado. Tabela diária com números tabulares, ROI em pill ✓/⛔ e dia parcial com relógio. O gráfico usa as cores dos tokens. Esqueleto e vazios dizem por quê. |
| **Demandas / Mesa de decisão** (`collaboration-panel`) | Abas com indicador deslizante e spinner no botão que está em voo. Mensagens com monograma do agente. Vazios com ⓘ ou relógio. |
| **Revisões e aprendizado** (`review-pipeline`, `learning-cycle-panel`, `agent-report`, `report-history`) | Etapas com tom e glifo. Padrões em KPIs e medidor de cobertura. Histórico de relatórios com esqueleto na primeira carga. |
| **Escritório** (`virtual-office`, `virtual-world`) | Chrome em volta do cenário: pills de estado com glifo e motivo no `title` dos botões desabilitados. O desenho em pixel art não mudou. |
| **Autonomia do Bunk** (`autonomy-panel`) | Mostra primeiro "o que o Bunk pode fazer agora". Modos em segmentado com ícone. Cada projeto vira uma linha que abre e mostra o resumo das permissões salvas. Limites com dica, e aviso inline quando o valor sai da faixa que o servidor aceita. A faixa de salvar diz o que falta. |
| **Dados, Contas, Agenda, Executor** (`accounts-panel`, `config-panel`, `cadence-panel`, `cloud-executor-panel`) | Campos `.ds-field` agrupados em tiles com dica. A busca de contas tem botão de limpar e tecla Esc. A situação das contas aparece em ponto mais texto, e há esqueleto na primeira carga. |
| **Componentes shadcn** (`components/ui/*`, `connector-error`) | Botão, badge, abas, alerta, toggle, campos, menus e diálogos leem os tokens: raio pill, foco violeta e desabilitado a `--ds-opacity-disabled`. |
| **Base antiga** (`globals.css`, primeiras linhas) | Os tamanhos de fonte e raios fixos das classes antigas passaram para `--ds-font-*` e `--ds-radius-*`. |

**Exceções que ficam de propósito:**

- cores fixas só no `@media print`;
- os seletores de atributo do Recharts em `components/ui/chart.tsx`;
- `components/ui/bubble.tsx`, que nenhuma tela usa;
- `font-size:16px` no campo de pergunta do Escritório no celular, para o iOS não dar zoom;
- os arquivos de desenho em pixel art (`world-scene.ts`, `gather-scene.ts`, `pixel-*.ts`).

**Cascata conferida no build.**

- O build gera dois arquivos de CSS:
  - o do layout (`globals.css` + `notch-ds.css`), declarado como recurso do `app/layout.tsx`;
  - o da página (`uix.css`, `malva-theme.css` e as seções), que vem com o `bunker.tsx`.
- A ordem entre esses dois arquivos não está garantida no HTML. Por isso valem as travas de especificidade da seção 1, que não dependem dela.
- Nenhuma regra do tema antigo redeclara variável da ponte com especificidade acima de (0,2,0). As duas exceções são `body .app .dc-hub` e `body .app .cp-hub`, e elas já apontam para os mesmos tokens.
- Os `!important` do tema antigo (`.dc-inline-note`, `.dc-note`, `.dc-conversion`…) são sobrescritos nas seções com `:not(#_)` mais `!important`.
