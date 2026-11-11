# Autonomia v2 · Modo Gestor — shared contracts (Phase 1, frozen 10/11/2026)

Status: **frozen for Phase 1**. Owner: W1 (spec §6). Source spec: `docs/AUTONOMIA-V2-MODO-GESTOR-SPEC-2026-11-10.md` (§1–6 binding).
Branch `feat/modo-gestor`, base `origin/main` 4eecd7b. Field names below were checked against the code at that base:
`lib/autonomy-shadow.mjs` (decision / `mergeShadow` / `shadowGrades` / `shadowSummary`), `lib/shadow-learning.mjs`
(`learningStats`, `tally`, `gateAccuracy`, `learningBrief`), `lib/team-learning.mjs` (`teamActions`, `teamStats`),
`lib/autonomy-grant.mjs` (`autonomyView`, `autonomyGrant`, `autonomyLogEntry`), `worker/cloud-executor.ts`
(`storeShadow`, `storeLearning`, `storeCompanion`, actions `shadow` / `autonomy` / `companion`),
`mac/BunkerNotch/Sources/BunkerNotch/{Summary,SummaryLossy}.swift`.

This file freezes three things:
- **(a)** the `AutonomyDeepView` JSON, plus the `view=sim` rows the draft simulator runs on;
- **(b)** the companion summary `autonomy` block for the notch;
- **(c)** the `lib/playbook-runner.mjs` interface that W1 calls from the worker, and the `pb:*` / `pbs:*` storage keys.

Nothing here is code. A change to a frozen field needs a new `v` and a note in this file, agreed by W1 with the reader
(W2 for (a), W4 for (b), W3 for (c)).

---

## 0. Rules that apply to all three contracts

### 0.1 Phase 1 invariants (non-negotiable)
1. **Read-only.** No new write op to the central. The only owner save stays `autonomyConfig` / `autonomyKill`
   (`app/api/state/route.ts`). No new route accepts POST. `/api/autonomy` keeps GET only.
2. **Playbook never executes.** Every `pbs:*` entry has `wouldExecute:false`, `firstWouldExecuteAt:null` and
   `source:'playbook'`. Playbook decisions never enter `batches`, `autonomyAct`, `autonomyGrant`,
   `recordAutonomyOrder`, `decisionContingency`, proposals, executions or dispatch. In the deep view and the
   companion block, their status is never `enviaria` or `pediria`.
3. **No change** to the grant, contingency, order-building, claim / prepare / submit / confirm or dispatch code.
4. **Isolation from the executor's health.** Every new hook sits in its own `try{…}catch{}` (and `.catch(()=>{})` on
   its status write). A playbook failure never changes what `storeShadow`, `autonomyAct`, `storeLearning`,
   `storeCompanion` or the alarm do, and never changes `shadowStatus`, `autonomyStatus` or `learningStatus`.
5. **No central hydration in new read paths.** The deep view and the sim view are built only from Durable Object keys.
   They never call `this.read()`, `this.view()` or `readPersistedState`.

### 0.2 Value conventions
- **N/D is `null`, never `0`.** A number field is `null` when its source is missing, stale, not aligned, or not
  computable. `0` means a real, measured zero.
- **Counts.** An integer count (`graded`, `ordersToday`, `moves`, …) may be `0` only when the set it counts is known.
  When the source key itself is missing (no `learningSummary`, no `pb:view`), the object that holds the count is
  `null`, not a block of zeros.
- **Ratios** are fractions in 0–1 (`accuracy: 0.74`), never percents. **Percents** are named `*Pct` or `percent`
  and are signed: `+30` means up and `-20` means down. **Steps** use the `budget.step` convention from
  `team-learning`: a fraction, `+0.3` / `-0.2`.
- **Money.** Performance metrics (`spend`, `revenueNet`, `result`, `cpc`, `ic`) are BRL, as Malva reports them.
  Budgets (`dailyBudget`, `budgetCap`) are in the campaign's native currency, always next to `currency`, a 3-letter
  code or `null`.
- **Times** are ISO-8601 UTC strings. A local day is `YYYY-MM-DD` in the project's own timezone (`shadowStatus.days`).
- **Ids.** `project` is always the Bunker project **id**. The name goes in `projectName`. (The legacy `shadow` read and
  `companion.shadow.recent` use `project` for the name and `projectId` for the id. The new contracts do not.)
  A campaign is identified by `adAccountId` + `objectId`; `key` is `campaignKey(adAccountId, objectId)` =
  `"<adAccountId>:<objectId>"`.
- **People.** A person is `{person, name, role}`:
  - `person` is a stable id: `'owner'` for the owner (Malva connection person, notch, "Já fiz", owner orders);
    `'outside'` for "Fora da Malva Dash" with no attributed profile; otherwise `'p:' + shortId(['person', actor.key])`.
  - `name` is the display name kept in the DO ("Você" for the owner).
  - `role` is `'owner' | 'team' | 'outside'`.
  - Raw Malva member keys never leave the DO and never enter the repository.
- **Strings shown to the owner are Brazilian Portuguese.** Enum values are ASCII, kebab-case, Portuguese
  (`so-sugestao`, `pode-pedir`).
- **Versioning.** Each payload carries `v:1`. Readers ignore unknown fields. A reader that sees a higher `v` it doesn't
  know keeps working on the fields it knows.

---

## (a) AutonomyDeepView

### a.1 Route and executor action
```
GET /api/autonomy                              → unchanged: executor {action:'autonomy'} → {shadowProjects, shadowAt, status, log}
GET /api/autonomy?view=deep&project=<id|all>   → executor {action:'autonomy', view:'deep', project}  → AutonomyDeepView
GET /api/autonomy?view=sim&project=<id>        → executor {action:'autonomy', view:'sim',  project}  → AutonomySimRows (a.7)
```
- **Auth.** The `oai-authenticated-user-id` header is still required (401 without it). For `view=deep|sim`, a request
  that carries `x-bunker-companion` gets **403** `{error:'Somente na sessão do dono.'}`, even when the owner header is
  also there.
- **Validation.** `view` other than `deep`/`sim` → 400 `{error:'Visão desconhecida.'}`. `project` is required: `all`
  or a configured id, at most 80 characters. For `view=sim`, `all` → 400 `{error:'Escolha um projeto.'}`. For an id
  the executor doesn't know (not in `autonomyDeepBase.projects`) → 400 `{error:'Projeto não configurado no Bunker.'}`.
- **Responses.** Always `Cache-Control: private, no-store`.
  - Executor unreachable → 503 `{error:'Executor da nuvem indisponível.'}`.
  - Base not yet written → executor returns `{deep:null}` → route 503
    `{error:'Leitura da autonomia em preparação pelo executor. Tente em 1 a 2 minutos.'}`.
- **Backward compatibility.** The plain action (no `view`) is byte-for-byte unchanged for current callers
  (`app/autonomy-panel.tsx`).

### a.2 Sources (DO keys only)
| Key | Writer | Used for |
|---|---|---|
| `autonomyDeepBase` (**new**, a.3) | W1, end of `storeShadow` | `level`, `now`, `done`, guard data, gate accuracy, grant state |
| `shadow:["<day>",…` (prefix per project-day) | existing `storeShadow` | today's fixed-rule decisions |
| `pbs:["<day>",…` (prefix per project-day) | runner (c) | today's playbook decisions |
| `shadowStatus`, `autonomyStatus`, `autonomyLog`, `learningSummary`, `learningStatus` | existing | status, log, score, team |
| `pb:view`, `pb:view:<project>`, `pb:status` | runner (c) | memory, playbook, people, agreement |

The deep view **lists only today's prefixes**: `shadow:["YYYY-MM-DD"` for each distinct day in `shadowStatus.days`,
plus the same for `pbs:`. It never lists all of `shadow:` or `learn:`.

### a.3 `autonomyDeepBase` (new DO key, written by W1)
- **When.** It is built at the end of `storeShadow`, after `autonomyAct` and after hook A, from the `state` already in
  hand, inside its own try/catch.
- **How often.** At most once per 60 s, and only if its serialized JSON changed.
- **Size.** At most 256 KB serialized. If it would be larger, `now` is cut to 40 campaigns per project and
  `truncated` records it.

```ts
type AutonomyDeepBase = {
  v: 1, at: string,                        // when built
  stateAt: string|null,                    // fetchedAt of the central/live state it was built from
  enabled: boolean, paused: boolean,
  config: ReturnType<typeof autonomyView>, // exactly autonomyView(state) (lib/autonomy-grant.mjs)
  // What autonomyGrant needs about past Bunk orders (autonomyOrder===true, last 8 days), compact:
  orders: {id:string, project:string, createdAt:string, payload:{adAccountId:string, objectId:string, shadowId:string|null}}[], // ≤ 400
  gate: {[rule:string]: {graded:number, right:number, accuracy:number|null, source:'7d'|'memory'|'memory-unavailable'}}, // the `accuracy` map storeShadow just used
  projects: {[project:string]: {
    name: string, timezone: string|null, shadowPolicy: boolean,  // present in the private Sombra policy (and enabled)
    contingency: string[],                                       // ≤3, project-level only (dailyCap / lossCap missing), pt-BR
    now: NowCampaign[],                                          // ≤ 80, by today's spend desc, null spend last
    done: DoneOrder[],                                           // Bunk orders of 7 days, ≤ 50, newest first
  }},
  truncated: {[what:string]: number}
}
```

### a.4 Top level of the response
```ts
type AutonomyDeepView = {
  v: 1,
  at: string,                      // built now
  baseAt: string,                  // autonomyDeepBase.at
  stateAt: string|null,
  project: string,                 // 'all' or the requested id
  enabled: boolean,                // general switch (state.autonomy.enabled)
  paused: boolean,                 // office paused
  status: null | {at:string, ok:boolean, enabled?:boolean, acting?:boolean, created?:number, logged?:number, error?:string}, // autonomyStatus as stored
  shadowStatus: null | {
    at: string|null, failed: boolean, version: number|null,
    days: {[project:string]: string},                         // local "hoje" per project
    skipped: {project:string, projectName:string, reason:string}[],  // from shadowStatus.skipped (object → list)
    evaluated: number|null, ms: number|null
  },
  learningStatus: null | {at:string, ok:boolean, summarized:boolean|null, code?:string},
  playbookStatus: null | PlaybookStatus,                      // pb:status (c.8)
  memory: null | {
    days: number, from: string|null,                          // depth of people's-move memory (team shards + backfill)
    peopleMoves: {person:string, name:string, role:'owner'|'team'|'outside', moves:number}[], // 30 days, ≤ 8
    excluded: {total:number, byReason:{[reason in ExcludeReason]?: number}},
    quarantined: number,                                      // 'possible-bunk-echo'
    backfill: {[project:string]: {complete:boolean, from:string|null, to:string|null, moves:number, at:string|null}}
  },
  totals: {                                                   // over the returned projects, today
    decisions: {enviaria:number, pediria:number, 'so-sugestao':number, segurada:number, desligado:number},
    orders: {created:number, sent:number, confirmed:number, failed:number},  // Bunk orders today (from done)
    agreement: null | Agreement                               // playbook vs team, 7 days, all returned projects
  },
  projects: {[project:string]: ProjectDeep},
  caps: Caps, truncated: {[what:string]: number}              // a.6
}
type ExcludeReason = 'bunk'|'possible-bunk-echo'|'automation'|'meta'|'launch-tool'|'create-delete'|'out-of-scope'|'no-author';
type Agreement = {precision:number|null, recall:number|null, leadMin:number|null, opposite:number|null, low:number|null, high:number|null, n:number};
```
- `memory`: built from `pb:view.memory`. If `pb:view` is missing, it is `{days, from}` from
  `learningSummary.memory` with `peopleMoves: []`, `excluded: {total:0, byReason:{}}`, `quarantined: 0` and
  `backfill: {}`, **and** `playbookStatus: null`, which tells the UI the people figures are N/D. If both are missing,
  `memory` is `null`.
- In `Agreement`, `n` is the number of matched team moves in the denominator. Every rate is `null` when `n === 0`.
  When `n < 15`, the UI says "amostra pequena".

### a.5 `ProjectDeep`
```ts
type ProjectDeep = {
  name: string, timezone: string|null, day: string|null,      // local "hoje"
  level: {
    mode: 'off'|'shadow'|'confirm'|'auto',
    actions: {pause:boolean, reduce:boolean, increase:boolean, activate:boolean},
    limits: {maxIncreasePct:number|null, maxReducePct:number|null, budgetCap:number|null, ordersPerDay:number}, // ordersPerDay defaults to 2, never null
    exceptions: number,              // campaign exceptions saved
    configured: boolean,             // project present in state.autonomy.projects
    shadowPolicy: boolean            // the fixed rules evaluate this project
  },
  pilot: null,                       // Phase 1: always null (P2: {enabled:boolean, patterns:{…}})
  now: {campaigns: NowCampaign[]},
  decisions: Decision[],
  done: DoneOrder[],
  score: Score,
  team: null | Team,                 // null without learningSummary.team
  playbook: null | Playbook          // null without pb:view:<project>
}
```

#### NowCampaign
```ts
type WindowMetrics = {spend:number|null, frontOrders:number|null, orders:number|null, revenueNet:number|null,
                      result:number|null, roi:number|null, roas:number|null, cpc:number|null, ic:number|null}; // sum([row]) subset
type NowCampaign = {
  key: string, adAccountId: string, objectId: string, name: string|null, accountName: string|null,
  stage: 'first-day'|'second-day'|'young'|'mature'|null, test: boolean,       // campaignStage() (c.9)
  mode: 'off'|'shadow'|'confirm'|'auto',                                       // effectiveMode()
  budget: null | {dailyBudget:number, currency:string|null},                   // today's row, native
  windows: {today:WindowMetrics|null, yesterday:WindowMetrics|null, d3:WindowMetrics|null, d7:WindowMetrics|null}, // null = not aligned / no row
  partialDay: null | ReturnType<typeof partialDayHold>,                        // lib/partial-day.mjs, as is
  guard: {
    ordersToday: number, ordersLimit: number,            // Bunk orders on this campaign today vs limits.ordersPerDay ?? 2
    cooldownMin: number,                                 // minutes left of the 1 h cooldown; 0 = none running
    budget: number|null,                                 // = budget.dailyBudget
    capUse: null | {cur:number, cap:number, currency:string|null, share:number|null, mixedCurrency:boolean}, // null without budgetCap
    contingency: string[]                                // = projects[p].contingency (project-level, ≤3)
  }
}
```
- `cur` is the current native daily budget and `cap` is `limits.budgetCap`. `mixedCurrency` is true when the
  project's active campaigns use more than one currency: then the single Teto is ambiguous and the UI shows the warning.
- `test` is a real boolean (`isTestCampaign`). `stage` is `null` when N/D.

#### Decision (today, fixed rules + playbook)
```ts
type DecisionStatus = 'enviaria'|'pediria'|'so-sugestao'|'segurada'|'desligado';
type Decision = {
  id: string,                                 // the storage id (JSON [day,rule,project,acct,obj,action]); same scheme for pbs
  source: 'rules'|'playbook',
  rule: string,                               // 'test-no-sale' … | 'pb:test-pause' …
  ruleLabel: string|null,                     // shadowRules[rule] | play sentence
  rev: string|null,                           // rules: 'rules@<ruleVersion>' (entryRuleVersion; null if unknown); playbook: entry.ruleRev
  project: string, projectName: string|null, adAccountId: string, accountName: string|null, objectId: string, campaign: string|null,
  action: 'status'|'budget', kind: 'pause'|'activate'|'increase'|'reduce',
  before: {status?:string, dailyBudget?:number, currency?:string|null},   // as stored
  after:  {status?:string, dailyBudget?:number, currency?:string|null},
  percent: number|null,                       // signed, budget only (decisionAction)
  reason: string,
  metrics: {spend, frontOrders, orders, revenueNet, checkouts, roi, roas, cpc, recentRoi},   // number|null each (entry.metrics)
  limitations: string[], blockedBy: string[], // ≤6 each, as stored
  status: DecisionStatus,
  suggestionWhy: null|'nivel-sombra'|'placar'|'so-alerta'|'jogada-em-observacao',  // set only when status==='so-sugestao'
  holdReasons: string[],                      // ≤6; set only when status==='segurada' (blockedBy or grant/log blockers)
  mode: 'off'|'shadow'|'confirm'|'auto',      // effective mode of the campaign
  wouldExecute: boolean,                      // rules: firstWouldExecuteAt!==null; playbook: always false
  wouldFire: boolean,                         // the rule/play condition held with nothing blocking (rules: = wouldExecute; playbook: blockedBy.length===0)
  current: boolean|null,                      // re-emitted by the latest pass (lastAt ≥ shadowStatus.at); null if unknown
  gate: null | {graded:number, right:number, need:number, min:number, metric:'accuracy'|'low', proven:boolean, source:string},
  sameAsRule: string|null,                    // playbook only: a fixed rule hit the same campaign+kind today ("regra fixa tem prioridade")
  manager: null | Reaction, owner: null | Reaction,
  grade: {d1: null|Grade, d3: null|Grade, pauseProxy: null|'revertida'|'provavel-acerto', opposite: null|{person:string|null, name:string|null, kind:string, at:string}},
  firstAt: string, lastAt: string, firstWouldExecuteAt: string|null,
  proposalId: string|null,                    // autonomyLog 'order' line for this id
  play: null | {key:string, params:{[name:string]:number|null}, learnedStep:number|null, clampedStep:number|null,
                learnedFrom:{person:string, name:string, n:number}[], caseRefs:CaseRef[]}  // playbook only, caseRefs ≤5
};
type Reaction = {actor:string|null, at:string, minutesAfter:number, before:any, after:any}; // shadowOutcomes, as stored
type Grade = {verdict:'acertou'|'errou'|'parou'|'N/D', basis:'next'|'day'|'d3', winnerCut:boolean, spend:number|null, result:number|null, roi:number|null};
type CaseRef = {day:string, adAccountId:string, objectId:string, campaign:string|null, person:string, name:string, kind:string, at:string, step:number|null};
```
- `grade.d1` comes from the stored `grade` (`verdict`, `basis`, `winnerCut`, and `next` or `day` per `basis`).
  It is `null` while there is no verdict.
- `grade.d3`, `pauseProxy` and `opposite` exist **only on `pbs:*` entries in Phase 1**. For fixed rules they are always
  `null`: `shadowGrades` is not changed in P1.
- **Order.** Newest first by `max(firstAt, manager.at, owner.at)`, the same order as `shadowSummary`. `enviaria` and
  `pediria` always rank first.

**Status derivation.** It is a pure function, `decisionStatus(entry, ctx)`, exported by
`lib/autonomy-deep-view.mjs` and reused by (b). The first match wins:

| # | Applies to | Condition | status | extra |
|---|---|---|---|---|
| 1 | both | `effectiveMode(config, …) === 'off'` | `desligado` | |
| 2 | playbook | `blockedBy.length > 0` | `segurada` | `holdReasons = blockedBy` |
| 3 | playbook | otherwise | `so-sugestao` | `suggestionWhy = 'jogada-em-observacao'` (**Phase 1 never goes further**) |
| 4 | rules | `alertOnly`, or a `blockedBy` line starting "Só alerta" | `so-sugestao` | `'so-alerta'` |
| 5 | rules | a score-gated rule with a `blockedBy` line starting "Só sugestão" | `so-sugestao` | `'placar'`, `gate` filled |
| 6 | rules | `current === false` | `segurada` | `holdReasons = ['A regra não propõe mais esta ação na leitura mais recente.']` |
| 7 | rules | `blockedBy.length > 0` | `segurada` | `holdReasons = blockedBy` |
| 8 | rules | mode `shadow` | `so-sugestao` | `'nivel-sombra'` |
| 9 | rules | latest `autonomyLog` line with `shadowId === id` | `order` → `enviaria` (+`proposalId`) · `confirm` → `pediria` · `blocked` → `segurada` (`holdReasons = result.blockers`) | |
| 10 | rules | otherwise `autonomyGrant({autonomy, paused, proposals: base.orders}, {...entry, wouldExecute:true}, {now, timezone})` | `auto` → `enviaria` · `confirm` → `pediria` · `none` → `segurada` (`holdReasons = blockers`) | |

`gate` for score-gated rules is `base.gate[rule]` with `need: 20`, `min: 0.6`, `metric: 'accuracy'`, and `proven`
meaning the same test as `evaluateShadow`. For the other fixed rules it is `null`. For playbook decisions it is the play
rev's live tally: `need: 15`, `min: 0.5`, `metric: 'low'` (Wilson-low), and `proven` is always `false` in P1.

#### DoneOrder (Bunk orders, 7 days)
```ts
type DoneOrder = {
  proposalId: string, project: string, adAccountId: string, objectId: string, campaign: string|null,
  rule: string|null, shadowId: string|null, at: string,                   // proposal createdAt
  action: 'status'|'budget', kind: 'pause'|'activate'|'increase'|'reduce', percent: number|null,
  before: any, after: any, executionStatus: string|null,                  // lib/execution.mjs status, pt-BR as stored
  steps: {kind:'decidiu'|'aprovada'|'reservada'|'preparada'|'enviada'|'confirmada'|'falhou'|'verificacao', at:string}[], // ≤8
  monitorChecks: {minutes:15|30|60, at:string, status:string, delta:{spend:number|null, roi:number|null, result:number|null}|null}[],
  grade: null                                                             // Phase 1: always null (executed-order score is P3)
};
```

#### Score
```ts
type RuleScore = {
  rev: string|null, label: string|null,
  graded: number, right: number, accuracy: number|null, low: number|null, high: number|null,   // current-version tally
  base: null | {expected:number|null, accuracy:number|null, edge:number|null, graded:number},
  chanceBetter: number|null,                 // only when edgeClaimable (≥10 graded, ≥5 campaigns, ≥3 days), otherwise null
  trend: {recent:{graded:number, accuracy:number|null}, previous:{graded:number, accuracy:number|null}},
  winnersCut: number,
  stage: 'pode-enviar'|'sombra',             // fixed rules: non-gated → 'pode-enviar'; gated → gate proven ? 'pode-enviar' : 'sombra'
  gate: null | {graded:number, right:number, need:20, min:0.6, proven:boolean, source:string}
};
type Score = {
  rules: {[rule:string]: RuleScore},         // the 6 fixed rules, all present (zero-graded rules: graded 0, rates null)
  plays: {[playKey:string]: RuleScore},      // pbs:* graded per (play, rev); stage is the play stage (playbook enum)
  lead14d: null | {cuts:number, ahead:number, share:number|null, medianLeadMin:number|null,
                   previous:{cuts:number, ahead:number, share:number|null}, daily:{day:string, cuts:number, ahead:number}[]}, // team.projects[p].lead
  blindSpots: {day:string, kind:string, by:'owner'|'manager', at:string, adAccountId:string, objectId:string}[]   // ≤20
};
```
- **Source.** The project scope uses `learningSummary.current[rule].projects[p]`; `all` uses `learningSummary.current[rule]`.
  The `rev` of the fixed rules is `'rules@' + learningSummary.ruleVersion`.
- **No memory.** Without `learningSummary`, every `RuleScore` has `graded: 0`, the rates `null`, `base: null`,
  `trend` with `graded: 0` and `stage` from `base.gate` alone. `lead14d` is `null` and `blindSpots` is `[]`.
- Field names follow `tally()` (`accuracy`, `winnersCut`), not the spec shorthand `acc` / `winnerCuts`.

#### Team
```ts
type Team = {
  people: {
    person:string, name:string, role:'owner'|'team'|'outside',
    counts: {actions:number, pause:number, reduce:number, increase:number, activate:number},        // 30 days
    testPauses: {n:number, campaigns:number, median:number|null, p25:number|null, p75:number|null, beforePoint:number},
    budget: {graded:number, right:number, accuracy:number|null, low:number|null, high:number|null, medianUp:number|null, medianDown:number|null},
    hours: number[]|null,                     // 24 local-hour counts (W3 adds to teamStats); null on older memory
    agreement: null | Agreement               // plays vs this person (pb:view:<p>.people), "o Bunk concorda com você"
  }[],                                        // ≤8
  proposals: {id:string, kind:string, n:number, campaigns:number, days:number, median:number|null, p25:number|null, p75:number|null,
              current:number|null, value:number|null, text:string}[]   // teamProposals, ≤5; text only, never applied
};
```
This is `learningSummary.team.projects[p]` (or `.all`). W3 adds `person`, `role` and `hours` to each `teamStats`
person, keyed by the actor key. `name` stays the display name.

#### Playbook (copied from `pb:view:<project>`, written by the runner)
```ts
type PlayStage = 'observando'|'candidata'|'sombra'|'pode-pedir'|'pode-enviar';   // P1 emits only 'observando' | 'candidata'
type PlayFlag = 'imitacao-sem-ganho'|'dormindo'|'horario-expediente'|'drift'|'divergencia'|'cortes-em-vencedoras';
type Play = {
  id: string,                                  // template id, e.g. 'pb:test-pause'
  key: string,                                 // '<id>@<project>'
  rev: string, version: number,                // 'v<n>:<hash8>'; rev = hash(params, step)
  role: 'champion'|'challenger',               // P1: always 'challenger' (no adoption)
  stage: PlayStage,
  sentence: string,                            // pt-BR, ≤140 chars, template-only (no LLM)
  params: {[name:string]: number|null},
  step: null | {median:number, p25:number|null, p75:number|null},   // fraction; null for pause plays
  learnedFrom: {person:string, name:string, n:number, params:{[name:string]:number|null}|null}[],  // each person's own fit when ≥8 moves, else params null
  support: {moves:number, campaigns:number, days:number, need:{moves:8, campaigns:4, days:3}, missing:number},
  agreement: Agreement,                        // forward replay (pb:replay), 30 days
  outcome: {d1:null|Rate, d3:null|Rate, base:number|null},          // matched cases vs dailyBases
  wouldHave7d: null | {total:number, sameAsTeam:number, nobodyDid:number},
  flags: PlayFlag[],
  challenger: null | {rev:string, diff:{param:string, from:number|null, to:number|null}[]},
  caseRefs: CaseRef[],                         // ≤5
  adoptable: false, adoptHint: 'chega na próxima fase'              // Phase 1 constant
};
type Rate = {rate:number|null, n:number, low:number|null, high:number|null};
type Playbook = {
  fitAt: string|null, nextFitAt: string|null,
  state: 'sem-dados'|'observando'|'com-candidatas',
  plays: Play[],                               // ≤12 (project), ≤6 per project when project=all
  divergences: {id:string, playId:string, cell:{stage:string|null, hourSlot:string|null, roiBucket:string|null},
                people:{person:string, name:string, kind:string, n:number}[], text:string}[]   // ≤10
};
```
- `hourSlot` is one of `'00-0030'|'0030-09'|'09-11'|'11-13'|'13-16'|'16-20'|'20-24'`.
- `stage` order is `observando` < `candidata` < `sombra` < `pode-pedir` < `pode-enviar`. `sombra` and the stages above
  it are reserved for P2/P3 and must not appear in P1 (test).

### a.6 Caps, ordering and size
```ts
type Caps = {campaigns:number, decisions:number, done:number, plays:number, caseRefs:5, blindSpots:20, divergences:10, proposals:5, people:8};
```
| | `project=<id>` | `project=all` |
|---|---|---|
| `now.campaigns` per project | 80 | 20 (top by today's spend) |
| `decisions` (response total) | 150 | 150, split newest-first across projects |
| `done` (response total) | 50 | 50 |
| `plays` per project | 12 | 6 |

- **Size.** The hard ceiling is **400,000 bytes** of UTF-8 JSON. If the response is over, it shrinks in this fixed
  order, re-measuring after each step:
  1. drop `decisions[].limitations`;
  2. drop `decisions[].play.caseRefs`;
  3. cut `decisions` to 100;
  4. cut `now.campaigns` to 40 (or 10 for `all`);
  5. cut `plays` to 6 (or 3).
- **Truncation.** Each cut adds `truncated[<path>] = <dropped count>`. `truncated` is `{}` when nothing was cut.
- **Budget.** Building the response reads at most the 2 day-prefix listings + about 12 single keys. It must finish
  under 300 ms CPU on the 60-day fixture.

### a.7 `view=sim` and `simulateGrant` (the draft simulator)
The simulator runs **in the browser** (W2), over rows the executor serves. It is the only number the client computes
itself.
```ts
type AutonomySimRows = {
  v: 1, at: string, project: string, timezone: string|null, today: string|null,
  columns: ['id','day','rule','adAccountId','objectId','campaign','action','beforeBudget','afterBudget','currency',
            'afterStatus','wouldExecute','alertOnly','firstWouldExecuteAt','verdict','winnerCut'],
  rows: (string|number|boolean|null)[][],   // positional per `columns`; 7 days of shadow:* for this project; ≤1500, newest first
  seedOrders: AutonomyDeepBase['orders'],   // this project's real Bunk orders (limits/cooldown start from them)
  saved: ReturnType<typeof autonomyView>,   // base.config, to compare draft vs saved
  truncated: number                         // rows dropped above 1500
};
```
The executor builds the rows from the `shadow:*` entries of this project only. This is a paged listing (≤128 values per
page), and only the 16 columns are kept in memory.

`lib/autonomy-simulate.mjs` (W1) is pure, with no `Date.now()` inside and no I/O:
```ts
simulateGrant(sim: AutonomySimRows, draftConfig: AutonomyConfigInput, opts:{now:number, timezone?:string, projectIds:string[]}) →
 {
  ok: true, label: 'só permissões',
  assumedSwitchOn: boolean,                  // the simulation always assumes the general switch is on; true if the draft has it off
  draft: SimTotals, saved: SimTotals,
  caveats: string[]                          // fixed pt-BR lines: live Malva value, contingency, pending orders can still hold an order
 } | {ok:false, error:string}                // draft invalid per normalizeAutonomyConfig (its message)
type SimTotals = {
  today: {orders:number, held:{[reason:string]:number}},
  d7:    {orders:number, right:number, wrong:number, open:number, winnersCut:number, held:{[reason:string]:number}}
};
```
- **How it works.** It replays the rows in `firstWouldExecuteAt` order through the real `autonomyGrant`, with a
  synthetic state: `{autonomy:{...draft, enabled:true}, paused:false, proposals: seed + the orders simulated so far}`.
  That way, orders per day and the cooldown accumulate the same way they would live.
- **Inputs.** Only rows with `wouldExecute === true` and `alertOnly === false` are candidates.
- **Reasons.** `held` reasons are the grant blocker strings, as is.
- **Labels and limits.** The result is always labelled "só permissões". It never claims profit. `right` / `wrong`
  come from the stored D+1 `verdict`.

---

## (b) Companion summary `autonomy` block (notch)

### b.1 Placement and builder
- **Where.** W1 adds `autonomy` as a top-level key of every `companion:<project>` and `companion:all` value in
  `storeCompanion`, beside `shadow`.
- **Builder.** `autonomyCompanion({base, shadowRecent, log, pbView, project, now})`, exported by
  `lib/autonomy-deep-view.mjs`.
  - `base` is the `autonomyDeepBase` key.
  - `shadowRecent` is the `recent` list this summary already carries.
  - `pbView` is `pb:view:<p>`, read only for the projects included.
- **Errors.** It is built inside a try/catch. On failure, the key is **omitted**: never `null` with partial data.

### b.2 Shape (v1)
```ts
type CompanionAutonomy = {
  v: 1, at: string,
  enabled: boolean,                                   // general switch
  projects: {
    id: string, name: string,
    mode: 'off'|'shadow'|'confirm'|'auto',            // project level (ceiling)
    exceptions: number,
    pilot: null,                                      // P1 constant; P2: {enabled:boolean}
    today: {decisions:number, enviaria:number, pediria:number, soSugestao:number, segurada:number, ordersCreated:number, ordersConfirmed:number},
    plays: {id:string, label:string, stage:PlayStage, agreement:number|null, n:number}[],   // ≤3, label ≤60 chars, agreement = precision 0–1
    people: {person:string, name:string, agreement:number|null, n:number}[]                 // ≤4; "o Bunk concorda com você X%"
  }[],                                                // 'all': every configured project; '<id>': that one only
  campaigns: {projectId:string, adAccountId:string, objectId:string, mode:'off'|'shadow'|'confirm'|'auto'}[], // effective mode of each campaign in this summary's shadow.recent (≤12)
  island: {observing:string[], agreement:number|null, n:number}     // project names with mode≠'off' (≤6); overall play agreement
};
```
- **Counts.** `today.*` uses `decisionStatus` (a.5) over today's fixed-rule entries of that project. Playbook entries
  are **not** counted here in P1.
- **Plays.** `plays` are the top 3 by `support.moves` among `candidata`, then `observando`.
- **Agreement and N/D.** `agreement` is `null` when `n === 0`. The notch shows "N/D", never "0%".
- **Size.** At most **6 KB** serialized per summary. If it is over, `people` then `plays` are cut to 1 per project.

### b.3 Notch behaviour bound to the block (W4)
- **Decoding.** `autonomy` joins the `SummaryLossy.swift` key list and is decoded with `c.optional(...)`.
  - Every field inside is optional in Swift, with a default: `projects`/`campaigns` = `[]`, `enabled` = `false`,
    numbers = `nil`.
  - A malformed block becomes `nil` and never fails the summary (the regression behind "aba Dias vazia").
- **Effective mode of a shadow item.** The first match wins:
  1. the `campaigns` entry with the same `projectId` + `adAccountId` + `objectId`;
  2. the project `mode` found by `projectId`;
  3. unknown.
- **`ShadowActionButton`.**
  - Hidden **only** when the effective mode is exactly `"off"`.
  - Shown with the label "Fazer eu mesmo" when the mode is `shadow` / `confirm` / `auto`.
  - Unknown mode, an unrecognised value, or the block absent (older server) keeps today's behaviour: shown, with the
    current label.
- **Island row:** "Bunk · observando · John, Gabe · concordância 74%". The agreement part is dropped when
  `island.agreement` is `null`.
- **Gestores tab:** per-play lines from `plays` and "o Bunk concorda com você X%" from `people` where
  `person === 'owner'`.
- **No new write, and no ask card, in P1.**
- **Backward compatibility.**
  - An old notch ignores the new key: `Summary` decodes known keys only.
  - A new notch on an old server: `autonomy == nil` gives today's behaviour.
  - Self-tests decode both: with the block, and without it.

---

## (c) `lib/playbook-runner.mjs` interface and storage

### c.1 Module and exports (W3 implements; W1 only calls)
```js
export const playbookRunnerPolicy = Object.freeze({
  version: 1, enabled: true,                 // `enabled:false` turns every hook into a no-op (one-line kill switch)
  shadowBudgetMs: 250, learnBudgetMs: 2500, backfillBudgetMs: 8000,
  maxCampaignsPerPass: 600, maxGroupsPerFit: 2, maxPredicateEvals: 200000, listPage: 128,
  obsEveryMs: 3600000, labelAfterMs: 90*60000, fitEveryMs: 6*3600000, fitLocalHour: 2,
  backfillProjectsPerPulse: 1, backfillPagesPerPulse: 2, backfillDays: 30, backfillRetryMs: 15*60000,
  pbsMaxEntries: 2000, pbsRetentionDays: 7, obsRetentionDays: 21, binsRetentionDays: 90, replayRetentionDays: 30, versionsKept: 10,
  maxValueBytes: 100000, modelMaxBytes: 60000
});
export function playbookStore(storage)                                    // c.2
export async function runPlaybookShadow(store, input, {deadline})        // hook A, c.3
export async function runPlaybookLearning(store, input, {deadline})      // hook B, c.4
export async function runPlaybookBackfill(store, source, input, {deadline}) // hook C, c.5
```
- **Imports.** The runner may import only pure modules: `manager-playbook`, `playbook-eval`, `team-observations`,
  `campaign-context`, `autonomy-shadow` (for `mergeShadow`, `shadowOutcomes`, `shadowGrades`), `shadow-learning`,
  `team-learning`, `learning-math`, `activity-history` (`readHistoryPage`), `analysis`, `partial-day`.
- **Forbidden imports** (static test): `autonomy-grant`, `collaboration`, `execution`, `decision-contingency`,
  `owner-direct-order`, `owner-orders`, `cloud-engine`, `cloud-dispatch-guard`, `persistence`, `storage`,
  `supabase-storage`, `cloud-malva`.

### c.2 Storage facade `playbookStore(storage)`
W1 always passes `playbookStore(this.ctx.storage)`, never the raw storage. The facade:

| Operation | Allowed |
|---|---|
| `get(key \| keys[])`, ≤128 keys | keys starting with `pb:` or `pbs:`, plus read-only `learn:<day>:<p>:team` exact keys |
| `put(entries)`, ≤100 entries per call | only `pb:` / `pbs:` keys; each value ≤ `maxValueBytes` serialized (`pb:model` ≤ `modelMaxBytes`) |
| `delete(keys[])`, ≤128 | only `pb:` / `pbs:` keys |
| `list({prefix, start?, startAfter?, end?, limit})` | `prefix` must start with `pb:` or `pbs:`; `limit` is required and ≤ `listPage` |

Any other call throws `PLAYBOOK_STORE_DENIED`. There is no `transaction`, `deleteAll`, `setAlarm` or `sync`.
`list` without a limit is refused, so a whole prefix is never pulled into memory.

### c.3 Hook A — `runPlaybookShadow` (every shadow pass)
**Call site (W1).** In `storeShadow`, **after** the `this.autonomyAct(...).catch(...)` line and **before** the
`opts.learn===false` guard. That way it runs on every reading and can never feed `batches` / `autonomyAct`.
```ts
try{
  if(playbookRunnerPolicy.enabled) await runPlaybookShadow(playbookStore(this.ctx.storage), {
    state,                      // the same object storeShadow got — read-only, never cloned, never mutated
    liveItems: this.liveItems||[], events, meta, now,
    projects: Object.keys(state.config||{}).map(p=>({project:p, params: policy?.projects?.[p]||{}, day: days[p]||fallbackDay})),
    fixed: batches              // this pass's fixed-rule decisions, read-only (for sameAsRule only)
  }, {deadline: Date.now()+playbookRunnerPolicy.shadowBudgetMs});
}catch{ /* c.7 */ }
```
**Does, in order, stopping at the deadline or the unit caps:**
1. **Observations.** For each project with a fresh today cut (`todayRows`, ≤30 min), at most once per `obsEveryMs`, it
   writes `pb:obs:<day>:<p>:<HH>`: one positional row per ACTIVE Meta sales campaign, warm-up excluded.
2. **Evaluate.** It runs `evaluatePlaybook` over the current candidate models (`pb:model`, read once per call).
3. **Merge and react.** It merges into **today's exact `pbs:` keys only** (`get` by id, never a listing), using the
   `mergeShadow` id scheme. It applies `shadowOutcomes` with `events` to those entries only.

**Returns** (never throws, c.7):
`{ok:true, ms, obs:number, decisions:number, written:number, partial:boolean} | {ok:false, code, error}`.

### c.4 Hook B — `runPlaybookLearning` (each `storeLearning` run)
**Call site (W1).** In `storeLearning`, right **after** the loop that puts `changed` shards and **before** the
summary early return. That way it runs on every learning pass (at most every 5 min between pulses, always on the heavy
pulse).
```ts
try{
  if(playbookRunnerPolicy.enabled) await runPlaybookLearning(playbookStore(this.ctx.storage), {
    state, now, team: team.actions,          // this pass's people moves (with W3's person/actor-key fields)
    teamKeys,                                // the exact learn:<day>:<p>:team keys this pass touched/read
    bases, coverage, ownerNames, zone, projects: configured,
    names: Object.fromEntries(Object.entries(state.config||{}).map(([id,c]:[string,any])=>[id,c?.projectName||id]))  // `names` is only defined after the early return today
  }, {deadline: Date.now()+playbookRunnerPolicy.learnBudgetMs});
}catch{ /* c.7 */ }
```
**Does, resumable through `pb:cursor` and stopping at the deadline or the caps:**
1. Labels obs rows older than `labelAfterMs` (90 min): first human move / `manter` with presence / `unlabeled`.
2. Folds closed days into `pb:bins:<day>:<p>`.
3. Grades `pbs:*` with `shadowGrades` (D+1) and adds `grade.d3`, `pauseProxy` and `opposite`, through a paged listing.
4. Retention deletes oldest-first ranges, using `list({prefix, end:'<prefix><cutoffDay>', limit})`.
5. Fits. This runs only when `fitEveryMs` has elapsed or the local hour is `fitLocalHour`. At most
   `maxGroupsPerFit` (play × project) groups per call; a full refit cycles across calls.
6. Replay (`replayAgreement`): one day per call.
7. Writes `pb:model`, `pb:versions:<p>`, `pb:replay`, `pb:people`, `pb:view`, `pb:view:<p>`.

**Returns:**
`{ok:true, ms, labeled, binned, graded, deleted, fitted:boolean, replayed:boolean, partial:boolean} | {ok:false, code, error}`.

### c.5 Hook C — `runPlaybookBackfill` (heavy pulse only; Q11 = yes)
**Call site (W1).** This is a **third call site**, not listed in the spec (see §d). It runs in the heavy pulse right
after `syncAttribution(liveState)`, in its own `.catch(()=>{})`, only when the executor is still enabled and the office
is not paused.
- It reuses the `tracking_list_projects` result `syncAttribution` already read: W1 keeps it on a private field for that
  pulse. It never issues its own list call.
- When `syncAttribution` made no list call this pulse, hook C is skipped.
```ts
source = { read:(tool,args)=> tool==='tracking_ad_changes' && ++calls<=2 ? malva.read(tool,args) : Promise.reject(Object.assign(Error('PLAYBOOK_SOURCE_DENIED'),{code:'PLAYBOOK_SOURCE_DENIED'})) }
input  = { projects: [{id, name, timezone}] /* configured ∩ listed, identity id+name */, now, stillEnabled: async()=>(await this.setting()).enabled }
```
**Does:**
1. Picks 1 project whose `pb:backfill:<p>` is not `complete` (oldest `at` first; skipped within `backfillRetryMs`
   after a failure).
2. Makes at most 2 `tracking_ad_changes` calls with
   `{projectId, provider:['meta'], who:'people', level:['campaign'], category:['budget','status'], limit:100,
   preset:'custom', from, to, cursor?}`. `from`/`to` cover `backfillDays` local days ending yesterday.
3. Validates each page with `readHistoryPage`.
4. Classifies the moves with the same exclusions as live capture, plus `ctx.source:'backfill-daily'` (intraday
   features N/D).
5. Stores them in `pb:bf:<day>:<p>` and advances the cursor only after the write.
6. Checks `stillEnabled()` before each call.
7. When every project is `complete`, it makes **zero** calls.

**Returns:** `{ok:true, calls:0|1|2, project:string|null, moves:number, complete:boolean, partial:boolean} | {ok:false, code, error}`.
A Malva error keeps the cursor, records `failedAt` and `code` in `pb:backfill:<p>`, and is never retried in the same
pulse.

### c.6 Time and memory budgets
- **The deadline is wall-clock, not CPU.** In Workers, `Date.now()` advances only across I/O, so a synchronous loop
  never sees its deadline move. Every hook is therefore bounded **by unit caps first**, and by the deadline at each
  `await` of the store:
  - hook A: ≤ `maxCampaignsPerPass` campaign evaluations;
  - hook B: ≤ `maxGroupsPerFit` fit groups and ≤ `maxPredicateEvals` predicate evaluations;
  - hook C: ≤ 2 pages.
- **Target CPU per call:** hook A ≤ 50 ms, hook B ≤ 1.5 s, hook C ≤ 300 ms excluding network. Checked by
  `tests/executor-cpu-budget.test.mjs` with the 60-day fixture.
- **Memory.**
  - At most one listing page (≤128 values) is held at a time.
  - `state` is never cloned (no `structuredClone`, no `JSON.parse(JSON.stringify(state))`).
  - No module-level cache other than `pb:model`, keyed by its `fitAt`, ≤ 60 KB.
  - Fitting reads only bins, never raw obs or `learn:` listings.
- **Partial work.** When work is cut short, the call returns `partial:true` and resumes from `pb:cursor` on the next
  call. Cut-short work is never lost and never repeated twice in one call.

### c.7 Error contract
- **Runner functions never throw.** Internal errors are caught and returned as
  `{ok:false, code:/^PLAYBOOK_[A-Z_]{1,40}$/, error:<name: message ≤160 chars>}`. The runner also writes `pb:status`
  (best effort).
- **W1 still wraps every call.** If a call throws anyway (bug, store denial), W1's `catch` writes only
  `pb:status = {at, ok:false, stage:'shadow'|'learning'|'backfill', code:'PLAYBOOK_HOOK_FAILED'}` with
  `.catch(()=>{})`. Nothing else changes: no other key, no rethrow.
- **Never on failure:** a central write; touching `shadow:*`, `learn:*`, `attr:*`, `autonomy*`, `wake` or the alarm;
  retrying in a loop.
- **Codes.** `PLAYBOOK_STORE_DENIED`, `PLAYBOOK_SOURCE_DENIED`, `PLAYBOOK_TIMEOUT`, `PLAYBOOK_BAD_INPUT`,
  `PLAYBOOK_FIT_FAILED`, `PLAYBOOK_BACKFILL_IDENTITY`, `PLAYBOOK_BACKFILL_READ`, `PLAYBOOK_HOOK_FAILED`,
  `PLAYBOOK_DISABLED` (when `enabled:false`; returned with `ok:true, skipped:true`).

### c.8 Storage keys (Durable Object only — never the central, never the repo)
| Key | Value | Retention / cap | Writer | Readers |
|---|---|---|---|---|
| `pbs:` + `JSON.stringify([day, rule, project, adAccountId, objectId, action])` | playbook decision (c.9) | 7 days, ≤2000 entries | A (merge), B (grade, retention) | deep view (today prefix) |
| `pb:obs:<day>:<p>:<HH>` | `{v, at, cols:[…], rows:[[…]]}` positional, ~150 B/row | 21 days, ≤100 KB | A (write), B (label) | B |
| `pb:bins:<day>:<p>` | daily bins: counts per person × kind, steps, campaigns, grades, `excluded:{reason:n}`, ≤20 caseRefs | 90 days, ≤100 KB | B | B (fit, replay) |
| `pb:bf:<day>:<p>` | backfilled moves (`ctx.source:'backfill-daily'`) | 90 days, ≤100 KB | C | B |
| `pb:backfill:<p>` | `{v, complete, from, to, cursor, cursors[], pages, moves, at, failedAt?, code?}` | until complete, then kept as a record | C | B, deep view (`memory.backfill`) |
| `pb:model` | champions/candidates per play × project: params, step, rev, version, fitAt | ≤60 KB | B | A |
| `pb:versions:<p>` | last 10 versions per play: `{rev, version, params, step, fitAt, support}` | 10 per play | B | B, `pb:view:<p>` |
| `pb:replay` | forward replay per play × project × day: precision/recall/lead/opposite, D+1/D+3 | 30 days, ≤100 KB | B | `pb:view` |
| `pb:people` | `{[person]: {name, role, firstAt, lastAt, moves}}` | 90 days since `lastAt` | B | `pb:view` |
| `pb:cursor` | resumable work state of hook B | single key | B | B |
| `pb:view` | `{v, at, memory}` (a.4 `memory` shape) + `agreement` (all projects) | ≤100 KB | B | deep view, companion |
| `pb:view:<p>` | `{v, at, playbook:Playbook, people:{person, name, agreement:Agreement}[], scorePlays:{[playKey]:RuleScore}}` | ≤100 KB | B | deep view, companion |
| `pb:status` | `PlaybookStatus` | single key | A, B, C, W1 catch | deep view |

```ts
type PlaybookStatus = {v:1, at:string, ok:boolean, stage:'shadow'|'learning'|'backfill', code?:string, error?:string, ms?:number, partial?:boolean,
  last:{shadow?:{at:string, ok:boolean}, learning?:{at:string, ok:boolean}, backfill?:{at:string, ok:boolean, calls:number}}};
```
- **Prefix safety.** The executor today lists only `shadow:`, `learn:`, `attr:` and `activity-project:`. `pb:` and
  `pbs:` match none of them, so the existing listings and caps (3000 shadow, 90-day learn) are unaffected. A new
  listing elsewhere must never use a prefix that matches `p`.
- **No mixing.** The runner never writes `shadow:*`, `learn:*`, `attr:*`, `learningSummary`, `shadowStatus` or
  `autonomy*`. `autonomyDeepBase` is W1's.

### c.9 `pbs:*` entry shape
It is exactly the Sombra decision shape (`evaluateShadow` `base` + `add`) plus the `mergeShadow` fields, with these
overrides and additions:
```ts
{
  ...SombraDecision,                         // project, projectName, adAccountId, accountName, objectId, malvaObjectId, name, launchDay,
                                             // newCampaign, metrics, source, rule, ruleLabel, action, before, after, reason, blockedBy, limitations
  id, day, firstAt, lastAt, seen,            // mergeShadow
  wouldExecute: false,                       // FORCED, always
  firstWouldExecuteAt: null,                 // FORCED, always (so shadowGrades still grades it; it is not alert-only)
  ruleVersion: null,                         // never the fixed-rule stamp; scoring keys on (rule, ruleRev)
  source: 'playbook',                        // NOTE: overrides the Sombra `source` object; the read cut moves to `cut`
  cut: {kind, fetchedAt, lastSyncAt},        // the Sombra `source` object, renamed
  rule: 'pb:<template>', ruleLabel: '<sentence>',
  ruleRev: 'v<n>:<hash8>', playKey: '<rule>@<project>', role: 'challenger',   // P1 constant
  wouldFire: boolean, firstFiredAt: string|null,
  learnedFrom: {person, n}[], caseRefs: CaseRef[],                            // ≤5
  play: {params, learnedStep, clampedStep},  // clampedStep uses the owner's saved max %, never upward; null when no limit saved
  sameAsRule: string|null,
  manager, owner,                            // shadowOutcomes, as stored
  grade: {...shadowGradesFields, d3?:{spend, result, roi, verdict}, pauseProxy?:'revertida'|'provavel-acerto'|null, opposite?:{person, kind, at}|null}
}
```
- `blockedBy` carries the common blocks inherited through `campaign-context.mjs` (2 h edit by someone else, partial
  day, freshness). For ambiguous data it adds `"Dado ambíguo: <campo> N/D"`.
- **An N/D feature never satisfies a condition.** It produces no decision at all: no `wouldFire` on a null.

### c.10 W3 exports W1 depends on
| Module | Export | Notes |
|---|---|---|
| `lib/campaign-context.mjs` | `todayRows(state, project, liveItem, now)`, `rowWindows(state, project, today, closed, prev, row)`, `previousCut(state, project, today, now)`, `closedSnapshot(state, project, period)` | Byte-identical extraction from `autonomy-shadow.mjs` (golden test). `autonomy-shadow.mjs` only imports them. |
| `lib/campaign-context.mjs` | `campaignStage(row, windows, {now, timezone, noSpendPeriods}) → {stage:'first-day'\|'second-day'\|'young'\|'mature'\|null, test:boolean}` | Used by W1's `now.campaigns`. |
| `lib/team-learning.mjs` | `teamStats(...).projects[p].people[i]` gains `person`, `role`, `hours:number[24]` | Additive; `name` kept. |
| `lib/playbook-runner.mjs` | c.1 | |

W1 owns `lib/autonomy-deep-view.mjs` (`buildDeepBase`, `buildDeepView`, `buildSimRows`, `decisionStatus`,
`autonomyCompanion`) and `lib/autonomy-simulate.mjs` (`simulateGrant`).

### c.11 Isolation tests (acceptance)
- **`tests/playbook-isolation.test.mjs`:**
  - every `pbs:*` written has `wouldExecute===false`, `firstWouldExecuteAt===null` and `source==='playbook'`;
  - feeding one to `autonomyGrant` / `autonomyAct`'s path yields `act:'none'` and no proposal;
  - `decisionStatus` never returns `enviaria` / `pediria` for `source:'playbook'`;
  - a static scan shows the forbidden imports of c.1 are absent;
  - a static scan of `storeShadow` shows hook A is placed after `this.autonomyAct(` and that `batches` is never
    appended to after the per-project loop.
- **`tests/autonomy-deep-view.test.mjs`:**
  - null vs 0 (missing `learningSummary` → nulls, not zeros);
  - every cap and the 400 KB shrink order;
  - the 403 with `x-bunker-companion`;
  - a spy shows no `read()` / `view()` / `readPersistedState`;
  - the plain `autonomy` action is unchanged.
- **`tests/write-boundary-guards.test.mjs`:** no new central write op; the runner's store facade denies non-`pb:`
  writes.
- **`tests/collaboration-summary.test.mjs`:**
  - `autonomy` present, ≤6 KB, `pilot:null`;
  - the summary builds the same when the block builder throws (the key is omitted).
- **`SelfTest.swift`:**
  - decode with `autonomy`, and without it;
  - the button is hidden for `off`, shown for `shadow`, and keeps today's behaviour when the block is missing.

---

## (d) Deviations from the spec, decided here
1. **Person identity.** The spec writes `peopleMoves:{erik,jorge,leonardo,outside}`. Here it is a list of
   `{person, name, role, moves}` with a stable `person` id (`owner`, `outside`, `p:<shortId(actor.key)>`). Hard-coded
   keys would put Malva member ids in the repository.
   - "A equipe" (consensus, Q2) is every Malva-attributed person in the configured projects. Today that is Erik,
     Jorge and Leonardo Paz.
   - Choosing whom to follow per play is P2.
2. **`autonomyDeepBase`.** Spec §6.0 says "reads `state.autonomy` and `snapshots` from `centralView` / `view()`", but
   the acceptance forbids a central `read()`. `centralView` holds only paused/cadence, and `view()` hydrates on a
   cache miss. So W1 writes a compact `autonomyDeepBase` from the state `storeShadow` already holds, and the deep view
   reads only DO keys.
3. **Third hook (backfill).** Backfill needs a Malva source, and `storeShadow` / `storeLearning` have none. It is a
   separate call after `syncAttribution` in the heavy pulse. It reuses that pulse's project listing and makes ≤2 calls.
4. **`pb:obs` key** is per hour (`pb:obs:<day>:<p>:<HH>`), not per day. This keeps each value ≤100 KB.
   Added keys: `pb:bf:*`, `pb:people`, `pb:cursor`, `pb:view`, `pb:view:<p>`, `pb:status`.
5. **`view=sim`.** The 7-day simulator needs up to 3000 entries, which don't fit in the 400 KB deep view. They are
   served as positional rows by a second GET view, and the browser runs `simulateGrant` on them.
6. **Status enum.** It keeps the spec's 5 values. Sombra-level, score-gated, alert-only and playbook decisions all map
   to `so-sugestao`, and `suggestionWhy` tells them apart. Phase 1 adds stage `candidata` below `sombra`, because
   nothing can be adopted.
7. **Field names follow the code, not the spec shorthand:** `accuracy` (not `acc`), `winnersCut` (not `winnerCuts`),
   `capUse:{cur, cap, currency, share, mixedCurrency}`, and `learnedFrom` as a list.
8. **`grade.d3`, `pauseProxy` and `opposite`** exist only on `pbs:*` in P1. The fixed rules' `shadowGrades` stays
   unchanged (W3 owns only the extraction there).

Open (does not block P1): the per-project fit for Leonardo Paz will mostly be `observando` (9 moves in John in 30 days).
The UI must show "faltam N casos", never a fitted play.

---

## (e) W1 implementation notes (additive only, 10/11/2026; no frozen field changed, `v` stays 1)

Code: `lib/autonomy-deep-view.mjs`, `lib/autonomy-simulate.mjs`, `app/api/autonomy/route.ts`, `worker/cloud-executor.ts`.
1. **`autonomyDeepBase` extras (W1-internal key).** `projects[p]` also carries `configured` (project present in
   `state.autonomy.projects`) and `todayAt` (fetchedAt of the today cut used). In the base, each campaign's
   `guard.contingency` is stored empty and the project's list is kept once in `projects[p].contingency`; the deep view
   fills `guard.contingency` from it, so the a.5 `NowCampaign` shape is exactly as frozen.
2. **Base size.** After the a.3 cut of `now` to 40, if still over 256 KB the base keeps shrinking in this order:
   `done` → 20, `now` → 20, `done` → 10, `now` → 10, each counted in `truncated` (`now.campaigns`, `done`).
   Ratios are rounded (`roi`/`roas` 4 decimals, money and `cpc`/`ic` 2 decimals).
3. **Stage and campaign set.** `NowCampaign.stage` uses `campaignStage` and the list uses `activeSalesRow`
   (`lib/campaign-context.mjs`), the Sombra's own definitions.
4. **Executor answers** (route mapping of a.1): `{deep:AutonomyDeepView|null}`, `{sim:AutonomySimRows|null}` or
   `{invalid:'<pt-BR message>'}` (→ 400). The route also refuses a `project` outside `^[A-Za-z0-9_-]{1,80}$` with 400
   `{error:'Projeto inválido.'}`.
5. **`SimTotals` adds `asks`** (decisions the draft would send to the owner in Confirmar; never orders). `right`,
   `wrong`, `open` and `winnersCut` count orders and asks. Held reasons count each distinct grant blocker once per row;
   a Sombra-level row is held as `'Nível Sombra: só registra o que faria.'`. Each row is replayed against the orders
   that existed at its instant only; a seed order born from a replayed row is replaced by the replay.
6. **`autonomyCompanion` inputs** add `pbViews` (`pb:view:<p>` by project), `entries` (the stored Sombra entries of
   the summary), `days` (project → local day) and `shadowAt`. Names in the block are cut to 80 characters.
7. **Runner wiring.** `import * as playbookRunner from '../lib/playbook-runner.mjs'`; each hook runs only when
   `playbookRunnerPolicy.enabled === true` and the export exists, so a missing runner is a silent no-op (no `pb:status`);
   a thrown call writes only `pb:status = {at, ok:false, stage, code:'PLAYBOOK_HOOK_FAILED'}`.

## (f) Integration notes (additive only, 10/11/2026; no frozen field changed, `v` stays 1)

Found by wiring the real runner into the deep view, the cockpit and the notch (`tests/modo-gestor-integration.test.mjs`).
1. **`pb:view:<p>` adds `agreement`** (same `Agreement` shape as `pb:view.agreement`, over this project's last 7
   replayed days, all templates). Without it, `totals.agreement` under a project filter was always `null`. The companion
   block's `island.agreement` uses it for a project summary and keeps `pb:view.agreement` for `all`.
2. **`Play.reason`** (in `pb:view:<p>` and the deep view): why a play is still `observando`, one of
   `poucos-casos · instavel · divergencia · dormindo · sem-acerto` (`fitPlay`); `null` for a `candidata`. The cockpit
   shows it instead of a blanket "ainda sem casos suficientes" when the minimum support is met.
3. **Person names in decisions.** `Decision.play.learnedFrom[].name` resolves from the stored name, then the names the
   runner's views already resolved (`people`, each play's `learnedFrom`, `memory.peopleMoves`), then `Você` (owner) or
   `Pessoa da equipe`. It never carries the hashed person id.
4. **Placar.** A play with cases but no graded decision is listed with N/D values (never 0%).

---

## Revision of 10/11/2026 (review fixes, additive; readers ignore unknown fields)
- **`Agreement`** gains `fired` and `agree`: the precision, its range and `opposite` are over `fired` (the times the play would have acted); `recall` and `leadMin` are over `n` (team moves). Days whose training set is below the minimum support (8 moves, 4 campaigns, 3 days) are `fit:false` and count in neither.
- **Per-person agreement** (`pb:view:<p>.people[].agreement`) has `precision:null`; `recall`, `low`/`high` (recall's range), `n` (that person's moves) and `caught`. Companion people: `agreement` is that recall, `n` its moves, `metric:'recall'`. Companion plays and island: `n` is `fired` when known.
- **`pbs:*`** entries carry `versionRole:'current'|'next'`. A challenger (`next`) has its own id (`rule+'@next'` inside the key), its own `ruleRev` and score (`scorePlays[k].challenger`, `Play.challenger.score`), and is never listed in `decisions`. The version in use is never replaced automatically.
- **`AutonomyDeepBase`** guard stores `cooldownUntil` (ISO or null); the deep view returns `cooldownMin` computed at read time. The base is rewritten when its slow part changes, otherwise at most every `baseLiveEveryMs` (5 min).
- **`memory`** gains `observedDays` and `observedFrom` (days with folded readings, apart from backfilled days). `excluded` no longer includes `possible-bunk-echo`, which is reported once as `quarantined`.
- **`team.people[].budget`** gains `d3:{graded,right,accuracy,low,high}|null` and `base:{graded,expected,edge}|null`; `testPauses.point` is the Sombra's own pause point (median) on those tests.
- **New keys:** `pb:obs-index` (hours written / labelled per project, last 3 days; read instead of observation values) and `pb:fits:<p>` (fits of the current cycle; the cursor no longer holds them).
- **Hook B input** gains `heavy` (default true): fitting and replay run only when true (the heavy pulse's pass). Bins are streamed 6 at a time and never decoded all at once; every runner write is shrunk to fit or skipped (`oversize` in the result), never thrown.
- **`/api/attribution`** items never carry `actorInfo`.
