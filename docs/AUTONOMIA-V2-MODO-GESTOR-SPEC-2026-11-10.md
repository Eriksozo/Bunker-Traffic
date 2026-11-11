# Bunk Autonomia v2 + "Modo Gestor": final spec

Status: design only, read-only phase. HEAD `03ea3f1` in `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic`, clean tree.

I checked the following against the code myself:
- CLAUDE.md l.11 and l.18 (the Automático registration of 09/11) and AGENT-RUNBOOK l.56 ("Aprendizados nunca mudam metas, testes, limites ou aprovações automaticamente").
- `/api/autonomy` (`app/api/autonomy/route.ts`) only checks that the `oai-authenticated-user-id` header is present.
- The executor `autonomy` action (`worker/cloud-executor.ts:584`) returns only `{shadowProjects, shadowAt, status, log}`.
- The `shadow` action (l.570) already serves entries, `learningSummary` and `learningStatus`.
- The companion summary (l.461) carries `shadow` + `learning`, with no `autonomy` block.

---

## 1. Verdict: A vs B

| Criterion | A ("Como os gestores", ambitious) | B ("Modo Gestor", trust-first) | Takes |
|---|---|---|---|
| Owner's wish ("ativar uma super inteligência que cuida como a equipe") | Strongest. One named level, a playbook per project, a wizard, a follow-selector per person, plays narrated in one sentence. | Strong. A hero card plus a 3-step sheet, and a ladder per pattern. Exposing levels as "ceilings" is subtler for the owner. | A's framing and copy |
| Safety under CLAUDE.md | Good: owner adoption of exact revisions, automatic demotion only, a circuit breaker, project aggregate limits. A new 5th mode `team` superset of `auto` widens the grant surface. | Better: `effective = min(owner level, earned stage)`. Champion/challenger never mutates. The challenger can never reach the grant. "Imitação sem ganho" means a habit that doesn't pay can never be adopted. | B's semantics + A's breaker and aggregate limits |
| Feasibility with the real data | Template library with fitted thresholds is right for the tiny n (~136 unique team moves in 30 d at 09/11; Leonardo 9 moves in John; John history only from 13/10). | Sequential covering over ~40 predicates × conjunctions ≤3 has a multiple-comparison and overfit risk at this n. B's bins/obs memory discipline fits the 128 MB isolate better. | A's templates, B's storage discipline |
| Manager attribution | Alias table, 3-layer Bunk exclusion, quarantine. | Same, plus keeping `{key, kind, profile, app}` in `historyActor` and `possible-bunk-echo` exclusion. | Merge. Identity comes from `actor.key`, never the display name. |
| UX depth | 8 tabs. Very complete, but heavy. | 5 tabs (Agora / Aprendizado / Placar / Permissões / Registro). Tighter, and "Aguarda você" sits on top. | B's 5-tab skeleton, filled with A's cards (PlayCard, PersonCard, GateMeter, DiffRow, Timeline) |

**Decision: a hybrid.**
- **Semantics from B.** The 4 levels stay and read as a ceiling. A per-project `pilot` layer turns learned plays on as decision sources. Each play's earned stage can only lower what the ceiling allows.
- **Learning engine from A.** Fixed play templates with fitted thresholds and steps. Consensus is the default, and each person's style is shown.
- **From B:** obs rows and daily bins, champion/challenger per version, the outcome filter, and a forward-only backtest.
- **From A:** the breaker, the aggregate project limits, the step clamp, and per-currency caps.
- **The LLM** only narrates. It is never in the decision path.

### Facts from the real data that shape the plan
1. **Budget moves happen in Malva, with a name.** In John over 7 days there were zero campaign-budget edits outside Malva, and the outside status changes were deletions. So a stable `actor.key` covers almost all the training signal. The Meta-profile alias table is Phase 2, not a blocker.
2. **Bunk would write under Erik's own Malva key** (a chave Malva do dono). Today this risk is zero, because the switch is off and no project is configured, so no Bunk orders exist. It becomes real the moment any Bunk order executes. So before Phase 3:
   - the exact `malvaChangeId` match, plus quarantine, is a hard prerequisite;
   - a dedicated Malva member for the Bunk is strongly recommended.
3. **The scoreboard is empty.** v2 was 0/0 on 09/11; the first v2 grades arrived on 10/11. Expect 1–3 weeks of "Observando" and "Na Sombra" with N/D and ranges. The UI must say so plainly, and never show 0% for N/D.
4. **Profiles to filter out.** "Malva" / "Malva Epidemia" / "Eagle Traffic" are launch tools. "Meta" with `automatic:false` is issue-flip noise. `automacao:*` are automations. None of them is a decision.

---

## 2. Concept and level semantics (owner-facing)

**Name:** "Modo Gestor", with the subtitle "o Bunk cuida das campanhas como a equipe cuida". The final name is open question Q14.

**Per project there are two independent owner settings:**
1. **Nível (ceiling).** The existing `mode` and campaign exceptions are unchanged in storage and in the fingerprint:
   - **Desligado:** doesn't act or suggest. The notch quick action is hidden, which fixes the current contradiction.
   - **Sombra:** only observes and scores.
   - **Confirmar · até:** may ask the owner, who executes with Touch ID.
   - **Automático · até:** may send whatever has already proven itself.
2. **Modo Gestor on/off** (`projects[p].pilot.enabled`). When on, adopted plays learned from Erik, Leonardo Paz and Jorge take part as decision sources.

**Runtime rule:** `effectiveAct = min(ceiling for the campaign, play's earned stage)`.
- Earned stages: `observando` < `sombra` < `pode pedir` < `pode enviar`.
- The 6 fixed rules keep their current behaviour: the non-gated rules are already `pode enviar`, and the score-gated rules stay `sombra` until 60% with 20 or more graded.

**Hero card:** "Deixar o Bunk cuidar como a equipe". It is the single entry point the owner asked for. A 3-step sheet sets Modo Gestor, the ceiling and the required limits in one owner save. The ceiling is capped at Confirmar until Phase 3 is registered.

**What "aprendizado constante" means here, stated on screen:**
- Every day the Bunk re-fits the plays, creates challengers, runs them in Sombra and scores them.
- A new or changed play only sends with the owner's tap, on the exact version.
- Demotion is automatic; promotion past "pode pedir" never is.

This is compatible with CLAUDE.md l.11 / l.18 and RUNBOOK l.56, because learning never changes levels, limits or approvals.

**Proposed CLAUDE.md registration, needed before Phase 3, owner's words only:**
> "No Modo Gestor, além das regras da Sombra, o executor pode enviar ordem do Bunk a partir de jogadas aprendidas com Erik, Leonardo Paz e Jorge, somente jogadas que o dono adotou (versão exata) e liberou, que passaram a trava de placar, em campanha que o dono colocou em Automático com o interruptor geral ligado, dentro das ações e limites salvos por ele, pelo mesmo claim → prepare → submit único → confirmação. Reaprender gera versão candidata; nunca troca a versão adotada sem o sim do dono. Rebaixar é automático; promover, nunca."

---

## 3. Learning engine

### 3.1 Capture and attribution
- **`historyActor`** (`lib/activity-history.mjs`) keeps `{key, kind, name, profile, app}`. This is additive. `attr:*` entries gain these fields.
- **`classifyActor`** (`lib/team-learning.mjs`) resolves the person by `actor.key` first, then by the legacy name. The Meta-profile alias table `state.teamAliases` is added in Phase 2 (owner op). Unknown profiles stay "Fora da Malva Dash", and no person is learned from them.
- **Exclusions:**
  - automations (`kind:'automation'` or `automacao:*`);
  - Meta (`kind:'system'`, or profile "Meta");
  - launch tools (profile "Malva", apps "Malva Epidemia" / "Eagle Traffic");
  - create / delete / archive events;
  - warm-up, engagement and Kwai campaigns, and non-configured projects;
  - **the Bunk itself:**
    - the existing `isBunk` / `orderEcho` match;
    - an ambiguous echo becomes `excluded:'possible-bunk-echo'` (fail toward not learning);
    - from Phase 2, an exact `malvaChangeId` match.
  - Excluded and quarantined counts are shown in the UI.
- **Backfill.** A one-time, paged, read-only backfill over 30 days per project, from Malva `tracking_ad_changes`: campaign level, budget + status, `who:'people'`, custom date ranges.
  - Pace: 1 project and at most 2 pages of 100 per heavy pulse. The cursor is `pb:backfill:<p>`.
  - Backfilled moves get `ctx.source:'backfill-daily'`. They carry only closed-day features; intraday features are N/D.
  - They are used for steps and day-level plays only. This depends on Q11, default yes.

### 3.2 Observations ("the team looked and did nothing")
- **`lib/team-observations.mjs`.** At most once per hour per project, on a fresh Malva cut (≤30 min, the one `storeShadow` already reads, so no extra reads), store one compact positional row per ACTIVE Meta sales campaign in `pb:obs:<day>:<p>`, kept 21 days, about 150 B per row.
- **Label after 90 min:**
  - the first human move (kind, person, step);
  - or `manter`, only if one of the three people acted in that project within ±90 min (someone was at the desk);
  - otherwise `unlabeled`, which is not used.
- **Features** (shared `teamFeatures`, also used by `actionContext`, which gains `d7`):
  - stage (D1 / D2 / young 3–4 / mature), test flag;
  - local hour slot: 00–00:30, 00:30–09, 09–11, 11–13, 13–16, 16–20, 20–24;
  - today: spend in tickets (from `ticketFront`, otherwise N/D), front, ROI bucket;
  - yesterday / 3d / 7d ROI buckets;
  - budget bucket per currency, budget ÷ owner cap;
  - raised or cut today and minutes since;
  - `partialDayHold`, `numbersAt` age.
  - **An N/D feature never satisfies a condition.**
- **Daily bins.** When a day closes, it folds into `pb:bins:<day>:<p>` (sparse cells, kept 90 d), holding counts per person and kind, steps, campaigns, grades, and up to 20 case refs. Fitting reads bins only, never raw obs.

### 3.3 Play templates (`lib/manager-playbook.mjs`, pure and deterministic)

| id | Trigger (fitted params) | Action |
|---|---|---|
| `pb:test-pause` | D1–D2 or test, front = 0, spend ≥ k tickets (per stage and IC band) | pause |
| `pb:young-loss-pause` | young, sold, ROI since start < r, spend ≥ k | pause |
| `pb:bad-day-cut` | hour ≥ h, today's ROI < r, spend ≥ k, 3d ROI ≥ r3 | −s% |
| `pb:mature-loss-pause` | mature, 3d ROI < r3, today's ROI < r after hour h | pause |
| `pb:morning-batch-raise` | hour ∈ [h1, h2], today's ROI ≥ r1, front ≥ f, 3d ROI ≥ r3 | +s% (per budget band) |
| `pb:night-raise` | 00:00–00:30, yesterday's ROI ≥ r, front ≥ f | +s% |
| `pb:reactivate` (Phase 4) | paused by a person within 72 h, 3d ROI ≥ r … | activate + `activationBudget` |

**How each play is fitted and labelled:**
- **Thresholds.** A grid search over quantiles maximises agreement F1 against moves vs `manter`, under a minimum support.
- **Steps.** The weighted median of the people's steps, rounded to 5 pp, with p25–p75 shown.
- **Hour caution** (from B). An hour window is kept only if dropping it lowers agreement by ≥10 pp. Otherwise it is generalised, and the card shows the caveat chip "horário pode ser só o expediente".
- **Decay.** 0.5^(age / 21 d), a 60-day window. No supporting case in 14 d means `dormindo`.
- **Per person and consensus.**
  - Fit per person × project when the person has ≥8 moves of that kind. Consensus pools all three, shrunk toward the cross-project pool with weight 10.
  - A style difference (different thresholds or steps) is shown side by side.
  - When the dominant moves conflict in the same cell (one up, one down, ≥3 cases each), no play is emitted and a **Divergência** card is shown.
- **Becoming a candidate** needs ≥8 moves, ≥4 campaigns, ≥3 days, and a bootstrap spread of the threshold ≤25% (50 resamples). Otherwise the play shows "Observando: faltam N casos".
- **Outcome filter** (B), "imitação sem ganho":
  - if a cut play's D+1 loss share, or a raise play's D+1 profit share, has a Wilson-high below the day base (`dailyBases`), the play is visible but can never be adopted beyond Sombra;
  - winner cuts (ROI ≥1.2 before the cut) on more than 20% of cases also block it.
- **Identity.**
  - `playId@project.v<n>`; `rev = hash(params, step)`.
  - A refit beyond the stability range creates a **challenger** next to the frozen champion.
  - "A equipe mudou o jeito" fires when the new fit leaves the champion's bootstrap range, or when 7-day agreement drops ≥15 pp (two-proportion z, p < 0.05).

### 3.4 Decisions and grading
- **`evaluatePlaybook(...)`** returns decisions in exactly the Sombra shape, plus:
  - `{source:'playbook', rule:'pb:*', ruleRev, learnedFrom:{people counts}, caseRefs[≤5], play:{params, learnedStep, clampedStep}}`.
- **Common blocks.** It reuses common blocks extracted, with no behaviour change, into `lib/campaign-context.mjs`: `todayRows`, `rowWindows`, the 2 h non-Bunker edit guard, ACTIVE sales only, warm-up excluded, `partialDayHold`, freshness.
  - Ambiguous data adds `blockedBy:"Dado ambíguo: <campo> N/D"`.
- **Phase 1 storage is separate from the fixed rules.** It uses `pbs:*`: 7 days, cap 2000, the same id scheme as `mergeShadow`.
  - It is graded with the same pure `shadowOutcomes` / `shadowGrades`.
  - Its `wouldExecute` is forced to false.
  - So the fixed-rule scoreboard, its 3000-entry cap and the `autonomyAct` input are untouched.
- **New grading, added as fields; the existing `grade` and the gate are unchanged:**
  - `grade.d3` (final, about 72 h of attribution);
  - a base comparison for team moves;
  - pause proxies: "revertida" (a person reactivated within 48 h) = wrong; "mantida" with pre-pause ROI <1 = "provável acerto", labelled as such; otherwise N/D;
  - opposite-move tally: the play said cut and a person raised within 12 h, or the reverse.
- **Forward-only replay** (`lib/playbook-eval.mjs` `replayAgreement`): fit on days < D, test on D, chained.
  - Metrics: precision ("Concorda com vocês"), recall ("Cobertura"), lead time ("Antecedência"), opposites, and D+1/D+3 of the matched cases vs the base.
  - Stored in `pb:replay`, 30 d.
- **Fitting runs** inside `storeLearning`, at most every 6 h plus 02:00 local. It reads shard by shard and never runs during the analyst model wait. It writes `pb:model` (<60 KB) and `pb:versions:<p>` (the last 10 versions).

### 3.5 Graduation (per play × project × rev)
- **`observando` → `sombra`:** the owner taps "Adotar" (Phase 2). Until then, candidates run as challengers in `pbs:*`, scored but never champions.
- **`sombra` → `pode pedir`:** automatic, because it sends nothing. It needs:
  - ≥15 graded live decisions of this rev;
  - live agreement Wilson-low ≥0.5;
  - D+1 (D+3 when available) ≥ base;
  - winner cuts ≤20%;
  - ≥5 campaigns and ≥3 days.
- **`pode pedir` → `pode enviar`:** the owner taps "Liberar no Automático" (Phase 3). It needs:
  - ≥20 graded at ≥60% of this rev;
  - live agreement ≥60% with ≥15 matched moves;
  - opposites ≤15%;
  - ≥10 owner responses to asks at ≥80% "Executar";
  - 7 days with no demotion;
  - for raise plays, also `chanceBetter` ≥0.9.
- **Demotion (automatic, fail-closed, with an alert):**
  - 2 Bunk orders of the play reverted by the team in 7 d;
  - rolling last-20 accuracy <50%;
  - a cut on a campaign with D+1 ROI ≥2;
  - drift detected;
  - `dormindo`;
  - a stale source.
- **Per-rev stamping** extends to the fixed rules as `rules@2`. `ruleAccuracy` / `gateAccuracy` / `learningStats` key on `(rule, rev)`, so a refit never resets or pollutes the fixed rules' scores.

---

## 4. Safety model (all phases)

**Unchanged and reused:**
- the general switch, `state.paused`, owner-only config;
- fingerprint voiding;
- `decisionContingency`;
- the live Malva value equal to `before`, a confirmed currency;
- 10-min validity, one order per decision, the pending-order fence;
- the 1 h cooldown, orders per campaign per day (default 2);
- `assertAutonomyGrant` at claim / prepare / submit;
- `authorizeCloudDispatch` (Worker and Edge copy);
- no resend on ambiguity.

**Added before any learned play may send (Phase 2–3):**
1. **Exact adoption.** `pilot.patterns[playId] = {rev, adoptedAt, adoptedBy, released}` lives in the central and is covered by the fingerprint, so adopting, retiring or updating voids unsent orders.
   - `assertAutonomyGrant` rechecks the rev.
   - `prepareGuard` (the executor, which has DO access) rechecks that the stage is still `pode enviar`.
2. **Step clamp.** The step is clamped to the owner's `maxIncreasePct` / `maxReducePct` and to the per-currency cap, never upward. The UI shows "aprendido +50%, seu limite +30% → envia +30%".
3. **Per-currency caps** `limits.budgetCaps:{BRL, USD}`. This fixes a current risk: the single "Teto" is compared with native-currency budgets. On a mixed-currency project with only the legacy cap, increases are blocked.
4. **Project aggregate limits** (required in Modo Gestor): budget added per day per currency, Bunk pauses per day, Bunk orders per day. They are checked in the grant from today's Bunk executions and again at claim.
5. **Optional hours window**, suggested from the team's active hours.
6. **Breaker.** 2 failed or verify-only Bunk orders in 24 h, or 2 team reversals in 7 d, make the project behave as Confirmar until the owner taps "Retomar". It is a DO flag `autonomyBreaker[p]`; the saved config is never changed.
7. **Fixed rule beats play.** When a fixed rule and a play hit the same object and action in one pass, the fixed rule orders. Still one order per campaign per pass.
8. **Out of scope by construction:** Kwai, warm-up / engagement, ABO / ad-set budgets, bids, audiences, creatives, non-configured projects.
9. **Never learns from itself:** `malvaChangeId` + echo + quarantine (§3.1). Recommended: a dedicated Malva member for the Bunk (Q7).
10. **Turning things on happens only on the web, by the owner.** The notch (Touch ID) and MCP can only turn off. No agent path writes `state.autonomy`, `pilot` or `teamAliases`.

---

## 5. Phased roadmap

| Phase | Ships | Execution risk |
|---|---|---|
| **P1 · Ver o Bunk pensar + aprender em observação** | The deep read model and route; the 5-tab cockpit; readiness meters; the draft simulator; honest controls; capture by actor key; obs and bins; backfill; play fitting; forward replay; playbook Sombra in `pbs:*` with D+3 and pause proxies; the notch `autonomy` block; `ShadowActionButton` gated by mode. | **Zero.** Reads, plus a stricter notch. No grant, contingency, order-building or dispatch code changes. |
| **P2 · Confirmar de verdade + adoção** | Owner writes: `autonomyPatternAdopt / Retire / Follow / Pause`, `teamAliases`, `autonomyPilot` (pilot + limits atomic, CAS). The ask queue (`ask:*`, 24 h, expires in 30 min or on value change) from the `confirm` branch of `autonomyAct`, with a notch card, an alert "Bunk pede Touch ID" and execution via the existing `recordDirectOrder`. Per-rule switches. Per-currency caps. `(rule, rev)` stamping. `malvaChangeId` recorded on the execution receipt. The Modo Gestor sheet with the ceiling ≤ Confirmar. | Owner-executed only (Touch ID direct order). |
| **P3 · Modo Gestor no Automático** | **Requires the CLAUDE.md registration** (§2). The "Liberar" tap; the grant branch for `source:'playbook'`; the `prepareGuard` stage recheck; aggregate limits; the breaker; demotion alerts; executed-order outcomes (reverted / mantida / D+1 / D+3 / +15/30/60); the notch "Desligar autonomia" (off only). Rollout: **John only, pause + reduce only, 7 days**, then other projects. | Bounded by the owner's ceiling, limits and the gate. |
| **P4** | Raise plays (after ≥2 weeks of P3 with no demotion). The reactivation play: the `recordAutonomyOrder` status branch, `activationBudget`, `liveOrderActions`, lifting the `autonomy-grant.mjs:148` block, behind its own gate. Optional LLM narration (numbers are template-only, the text is capped at 200 characters, and any number not in the facts gets it rejected). | New action, needs an owner decision. |
| P5 (optional) | Bounded automatic adoption of strictly more conservative challengers. | Needs its own registration. Default off. |

Before P2 ships, a phone-width pass. Before P3, three reviewers: security, regression and fidelity.

---

## 6. Phase 1: workstreams (parallel, disjoint file ownership)

**Shared contracts, frozen on day 0 in `docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md`, owned by W1:**
- (a) `AutonomyDeepView` JSON, §6.0;
- (b) the companion `autonomy` block;
- (c) the `lib/playbook-runner.mjs` interface that W1 calls from the worker.

**Rule:** only W1 edits `worker/cloud-executor.ts`. Only W2 edits `app/autonomy*`. Only W4 edits `mac/`.

**Sequencing:** W2 starts after the concurrent campaign-picker change lands in `app/autonomy-panel.tsx`. It then moves the picker, unchanged, into `app/autonomy/permissions.tsx`.

### 6.0 Read model (contract)
```
GET /api/autonomy?view=deep&project=<p|all>   (owner web session; companion credential refused)
{ at, enabled, status, shadowStatus:{at, skipped[], days}, memory:{days, from, peopleMoves:{erik,jorge,leonardo,outside}, excluded, quarantined},
  projects:{[p]:{ level, pilot:null|{…},
    now:{campaigns:[{key, name, stage, windows:{today,yesterday,d3,d7}, partialDay, guard:{ordersToday, ordersLimit, cooldownMin, budget, capUse:{cur,cap}|null, contingency[]}}]},   // ≤80
    decisions:[{id, source:'rules'|'playbook', rule, ruleLabel, rev, before, after, percent, reason, metrics, limitations, blockedBy, status:'enviaria'|'pediria'|'so-sugestao'|'segurada'|'desligado', gate:{graded,right,need:20,min:0.6}, manager, owner, grade:{d1,d3}, firstAt}],  // today, ≤150
    done:[{proposalId, rule, at, steps:[{kind, at}], monitorChecks, grade}],   // Bunk orders 7 d
    score:{rules:{[rule]:{rev, graded, right, acc, low, high, base, chanceBetter|null, trend, winnerCuts, stage}}, lead14d:[…], blindSpots:[…≤20]},
    team:{people:[{person, counts, testPauses, budget:{medianUp, medianDown, acc, low, high}, hours[24]}], proposals:[…]},
    playbook:{fitAt, plays:[{id, rev, stage, sentence, params, step:{median,p25,p75}, learnedFrom, support, agreement:{precision, recall, leadMin, opposite, low, high}, outcome:{d1, d3, base}, flags:['imitacao-sem-ganho'|'dormindo'|'horario-expediente'|'drift'], challenger:{rev, diff}|null, caseRefs[≤5]}], divergences:[…]} }}}
```
- Every field missing at the source becomes `null`, never 0.
- The response is capped at about 400 KB. It is built only from DO keys (no central hydration). It reads `state.autonomy` and `snapshots` from the executor's existing `centralView` / `view()` only.

### W1: Read model, executor wiring, simulator
- **Owns:**
  - `worker/cloud-executor.ts`: the `autonomy` action gains a deep variant; two hook calls into `playbook-runner` inside `storeShadow` (after the per-project loop) and `storeLearning`; the companion `autonomy` block;
  - new `lib/autonomy-deep-view.mjs`;
  - new `lib/autonomy-simulate.mjs`;
  - `app/api/autonomy/route.ts`;
  - the contract doc.
- **Does:**
  - Build the deep view, including readiness meters from `learningSummary.rules[r].currentVersion` and `shadowRulePolicy`.
  - Per-campaign guardrails: orders today vs limit, cooldown left, cap use per currency, contingency warnings.
  - `simulateGrant(entries7d, draftConfig)`: run the pure `autonomyGrant` over today's and 7 days' `shadow:*` entries, giving orders / held by reason / right / wrong / winner cuts. It is labelled "só permissões".
  - The route keeps the owner header check, adds `?view=deep&project=`, refuses `x-bunker-companion`, and sends `Cache-Control: private, no-store`.
- **Acceptance:**
  - no write in any new path;
  - no `read()` of the central in the deep view (spy test, like `shared-view-readonly`);
  - N/D preserved;
  - size caps respected;
  - the existing `autonomy` response is unchanged for current callers;
  - the CPU budget test passes with the hooks enabled on a 60-day fixture;
  - the hooks are wrapped in try/catch: a playbook failure never affects `storeShadow`, `autonomyAct` or the alarm.
- **Tests:**
  - new `tests/autonomy-deep-view.test.mjs` (shape, caps, null vs 0, owner-only route, no central read);
  - new `tests/autonomy-simulate.test.mjs` (draft vs saved, block reasons, purity);
  - extend `tests/collaboration-summary.test.mjs` (the `autonomy` block);
  - extend `tests/executor-cpu-budget.test.mjs`, `tests/write-boundary-guards.test.mjs` (no new write op) and `tests/lean-view.test.mjs`.

### W2: Web cockpit (notch design system)
- **Owns:**
  - `app/autonomy-panel.tsx` (shell only);
  - `app/autonomy-panel.css`;
  - new `app/autonomy/{island,now,learning,score,permissions,log,drawer,components}.tsx`.
  - It may import, but not edit, `app/campaign-daily-results.tsx`, `app/campaign-activity.tsx` and `app/notch-system.css`. New `ns-*` additions go in `app/autonomy-panel.css`.
- **Screen:**
  - **Island:**
    - state line: "Ligada · 2 projetos podem enviar sozinhos" or "Desligada · o Bunk só observa e aprende";
    - tiles: Enviadas / Seguradas / Aguardam você / Concordância com a equipe (with its range);
    - health: "Olhou há 1 min · John pulado: fonte com 42 min";
    - memory: "Memória: 31 dias · 512 ações de Erik, Jorge e Leonardo · 3 excluídas (eco do Bunk)";
    - project filter chips; kill / ligar unchanged.
  - **Agora:**
    - "O que o Bunk faria agora": status chips Enviaria / Pediria a você / Só sugestão · placar 12/20 / Segurada: motivo / Desligado aqui. Each row has a `DiffRow`, the reason, a mini window table, the source ("Regra fixa" / "Jogada da equipe v3 · aprendida com Jorge 14 · Erik 9") and guardrails;
    - "O que o Bunk fez": a timeline per order (decidiu → enviada → confirmada → +15/30/60 → D+1 → D+3);
    - honest empty states, e.g. "Nenhuma ordem do Bunk ainda. No nível Sombra ele só registra o que faria."
  - **Aprendizado:** the answer to the owner's "super inteligência".
    - Person chips with 30-day counts; "Aprendendo há N dias · X jogadas observadas · Y prontas".
    - A `PlayCard` per play: sentence; learned-from chips with each person's own threshold; `AgreementBar`; `GateMeter`; the stage ladder; "Teria feito nos últimos 7 dias: 9, 7 iguais às suas, 2 que ninguém fez"; flags; "Ver casos" (drawer).
    - Divergence cards; "Imitação sem ganho" cards; `PersonCard`s (test pause p25–p50–p75 vs the Bunk's point, raise and cut steps, hour histogram, D+1/D+3 accuracy with its range).
    - The caveat "associação, não causa".
    - **Adopt / Liberar buttons render disabled with "chega na próxima fase" (P1 has no write).**
  - **Placar:**
    - one table for the 6 rules + plays: Estágio · Acerto (faixa) · vs campanha qualquer (only at the minimum sample, otherwise "amostra pequena") · Concordância · Antecedência · 7d vs anteriores · Cortes em vencedoras · `GateMeter`;
    - the "Bunk antes da equipe" sparkline; blind spots linked to the drawer;
    - empty state: "Placar da versão atual: 0 de 20 avaliadas. As primeiras notas chegam amanhã."
  - **Permissões:** the current controls, deepened, using the existing `autonomyConfig` save only.
    - Limits with live context, e.g. "maior orçamento hoje R$ 600 → +30% = R$ 780; teto R$ 1.000".
    - "Ordens por campanha/dia" shows the default 2, never "—".
    - "Reativar" is disabled with "sem regra ainda".
    - A mixed-currency warning on the single Teto.
    - The draft simulator line above the savebar.
    - "Preencher como a equipe faz" pre-fills the draft only, capped by the current values.
    - The exceptions picker, moved untouched.
  - **Registro:** the log grouped by campaign with before→after and filters.
  - **Campaign drawer:** 4 windows + the day table, the current verdict, a unified timeline (Sombra, people's moves with names, Bunk orders, checks, grades), guardrails, and "simular por nível".
- **Acceptance:**
  - all of it works at 390 px with a 16 px gutter and no horizontal scroll;
  - light and dark;
  - the only save remains `autonomyConfig` / `autonomyKill` with the CAS revision;
  - N/D is rendered as "N/D";
  - no number is invented client-side except the simulator's.
- **Tests:**
  - typecheck + build;
  - a browser battery (`tests/browser/autonomy-cockpit.*`, read-only fixtures): tabs render with an empty / partial / full deep view; chips map from `status`; Adopt is disabled; savebar unchanged; phone width.

### W3: Capture, observations, playbook fitting and replay (pure learning)
- **Owns:**
  - `lib/activity-history.mjs` (`historyActor` + `backfillTeamHistory`);
  - `lib/team-learning.mjs` (actor-key identity, `possible-bunk-echo`, exclusions, `ctx.d7`, reversal detection, D+3 for team moves, base comparison, hours histogram in `teamStats`);
  - new `lib/campaign-context.mjs` (an extraction; the `lib/autonomy-shadow.mjs` change is limited to importing it, with no behaviour change);
  - new `lib/team-observations.mjs`, `lib/manager-playbook.mjs`, `lib/playbook-eval.mjs`, `lib/playbook-runner.mjs` (storage orchestration called by W1's hooks: obs write, labelling, bins, fit, replay, `pbs:*` merge and grade, all under a time budget).
- **Acceptance:**
  - `evaluateShadow` output is byte-identical before and after the extraction (golden test on existing fixtures);
  - `wouldExecute===false` on every `pbs:*` entry;
  - `pbs:*` never reaches `autonomyAct`; the `autonomyGrant` input source list stays the fixed rules;
  - fitting is deterministic;
  - no fit below the minimum support;
  - an N/D feature never satisfies a predicate;
  - Bunk echoes and launch-tool / Meta / automation moves are never labels;
  - the replay never uses future rows;
  - bounded memory (fit reads only bins; streamed shard listing);
  - the backfill makes only read calls, at most 2 per heavy pulse;
  - names stay in the DO; nothing operational goes into the repo.
- **Tests:**
  - new `tests/team-observations.test.mjs` (hourly cap, freshness, manter labelling only with presence, Bunk echo excluded, possible-echo quarantined);
  - new `tests/manager-playbook.test.mjs` (determinism, support, bootstrap stability, per person vs consensus shrinkage, conflict → no play, hour caution, decay and dormancy, the "imitação sem ganho" filter, winner-cut block, refit → challenger while the champion is unchanged, Sombra shape, inherited common blocks: 2 h edit / partial day / warm-up / non-ACTIVE / Kwai);
  - new `tests/playbook-eval.test.mjs` (forward-only, precision / recall / lead / opposites on fixtures, D+3 overrides D+1 in reporting, pause proxies with reversal = wrong);
  - new `tests/playbook-isolation.test.mjs` (a `pbs:*` entry fed to `autonomyAct` / `autonomyGrant` → `none`, and no proposal);
  - extend `tests/team-learning.test.mjs` (actor key beats name, exclusions, d7, reversal, hours) and `tests/autonomy-shadow.test.mjs` (golden after the extraction).

### W4: Notch
- **Owns:** `mac/BunkerNotch/Sources/BunkerNotch/{Summary.swift, SummaryLossy.swift, NotchViews.swift, SelfTest.swift}`.
- **Does:**
  - Decode the companion `autonomy` block (contract (b): `enabled`, a level per project, `pilot`, today's counts, top 3 plays per project with stage and agreement). Add its key to the `SummaryLossy.swift` section list.
  - Gate `ShadowActionButton` on the effective mode: hidden when Desligado; elsewhere it reads "Fazer eu mesmo".
  - Island row: "Bunk · observando · John, Gabe · concordância 74%".
  - Gestores tab: per-play agreement lines and "o Bunk concorda com você X%".
  - No new write, no ask card (P2).
- **Acceptance:** an older summary without `autonomy` still decodes, and the "aba Dias vazia" regression can't recur.
- **Tests:** `SelfTest.swift` cases (decode `autonomy`, decode a summary without it, button hidden when off, shown in Sombra).

### Phase 1 done criteria
- All suites green.
- Deployed per the runbook.
- In production, the cockpit shows real Sombra decisions and people's patterns within one pulse.
- The playbook shows "Observando" / candidates with N/D honesty.
- No new proposal or execution appears with `source:'playbook'` (checked via the deep view and the executions ledger).
- HANDOFF entry written.

---

## 7. Later-phase gates (summary)
- **P2 starts** when the owner answers Q2, Q6 and Q9 and P1 has been stable for 7 days.
- **P3 starts** only when all of these hold:
  - the owner has typed the CLAUDE.md registration;
  - `malvaChangeId` exclusion is live, ideally with a dedicated Bunk Malva member;
  - at least one play has reached `pode enviar` criteria in John;
  - the aggregate limits and per-currency caps are saved;
  - the three reviews are done.

---

## 8. Owner's open questions (real decisions, recommended default each)
1. **Registration (before P3).** Do you approve the §2 text for the Modo Gestor as an order source? *Default: yes, but only when P3 is ready. Until then, plays only observe, ask and are executed by you.*
2. **Whom to follow.** *Default: the consensus of the three, with your own moves weighted ×1. Per play, you can pick a person, or "quem acerta mais" once each has ≥10 graded moves.*
3. **Promotion to "pode enviar".** *Default: always one tap per play version ("Liberar"). Never automatic.*
4. **Gate numbers.** *Default:* pode pedir needs ≥15 graded with agreement ≥50% and at least the base. Pode enviar needs ≥20 at ≥60%, live agreement ≥60% (15 or more matched), opposites ≤15%, ≥10 of your ask responses at ≥80%, and 7 calm days. *Also require "vence campanha qualquer com ≥90%"* — yes for raise plays; for cut plays, shown but not required. *Recency:* the last 7 days ≥50%.
5. **Challenger updates.** *Default: every new version waits for your "Atualizar", even when it is more conservative.*
6. **Meta profiles.** Is "Erik Silva" in the Gerenciador you? What are Jorge's and Leonardo's Meta profile names? *Default: confirm yours. Leave theirs unattributed until you pick from the profiles the UI lists. This barely matters for budget, since budget edits happen in Malva.*
7. **A dedicated Malva member or key for the Bunk.** *Default: yes. Create one before P3, so its edits never look like yours.*
8. **Circuit breaker.** *Default: on. 2 team reversals in 7 days, or 2 failed or verify-only orders in 24 h, drop the project to Confirmar until you tap "Retomar".*
9. **Per-currency cap.** *Default: replace the single "Teto" with BRL and USD rows. On mixed-currency projects, leave the new caps empty, so raises stay blocked until you fill them.*
10. **Project ceilings for Modo Gestor.** *Default suggestion:* added budget per day = 1× the project's largest current budget; Bunk pauses per day = 5; Bunk orders per day = 8. You confirm each one.
11. **30-day backfill from Malva (read only).** *Default: yes. Intraday numbers stay N/D for those cases.*
12. **Projects without a private Sombra policy.** *Default: plays may run there in Sombra and ask in Confirmar. Sending needs the project's front ticket, saved by you.*
13. **Hours and alerts.** *Default:* the Bunk acts only during the team's usual hours (suggested from the data, confirmed by you). "Bunk pede Touch ID" alerts on the iPhone are on, with quiet hours 00:30–07:00 (except the 00:00–00:30 night raise, which is ask-only).
14. **Name.** *Default: "Modo Gestor", with the subtitle "o Bunk cuida como a equipe".*
15. **Reactivation (P4).** *Default: deferred. Revisit after 2 weeks of P3 with no demotion.*
16. **First Automático rollout.** *Default: John only, pause + reduce only, for 7 days. Then raises, with caps. Then the other projects.*

---

**Key files:**
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/worker/cloud-executor.ts` (`autonomyAct` ~174, `storeShadow` ~204, `storeLearning` ~278, companion ~461, the `shadow` action 570, the `autonomy` action 584)
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/app/api/autonomy/route.ts`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/app/autonomy-panel.tsx`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/lib/autonomy-grant.mjs`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/lib/autonomy-shadow.mjs`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/lib/team-learning.mjs`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/lib/shadow-learning.mjs`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/lib/activity-history.mjs`
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/app/api/state/route.ts` (P2 owner ops)
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/mac/BunkerNotch/Sources/BunkerNotch/` (`Summary.swift`, `SummaryLossy.swift`, `NotchViews.swift`, `SelfTest.swift`)
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/CLAUDE.md` (l.11, l.18)
- `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic/AGENT-RUNBOOK.md` (l.56)
