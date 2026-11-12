import SwiftUI

/// Autonomia tab (owner request of 12/11/2026: everything about the Bunk's autonomy in its own tab, to follow the
/// status, what waits for him and how it goes). It gathers what used to sit in Agora and Gestores: the switch and each
/// project's level, the requests of the level Confirmar, the Bunk's own orders, the Sombra and what it learned.
/// Reading only, like the rest of the notch: switch, levels, actions and limits change only on the web panel, by the
/// owner. A request opens the owner's own order already filled; "Executar agora" still asks Touch ID.
struct AutonomyTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let s: Summary
    var showProject: Bool { s.project == "all" }
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            if let a = s.autonomy {
                // What waits for the owner comes first; the status and the history follow.
                // Level Confirmar: the Bunk only asks. The row opens the owner's own order, already filled; Touch ID executes it.
                SectionHeader(title: "Bunk pede a você", detail: AutonomyText.asksDetail(a))
                if a.asks.isEmpty {
                    EmptyLine(text: AutonomyText.noAsks(a), kind: a.enabled ? .clear : .info)
                } else {
                    let asks = a.asks
                    VStack(spacing: 2) {
                        ForEach(asks) { a in
                            ListRow(id: "ask:" + a.id, symbol: a.action == "pause" ? "pause.fill" : "dollarsign.circle", tone: .warn,
                                    title: a.campaign ?? "Campanha",
                                    subtitle: a.changeText + (a.ruleLabel.map { " · " + $0 } ?? ""),
                                    tag: showProject ? a.projectName : nil,
                                    value: a.at.map { Format.stamp($0) }, valueCaption: a.preset == nil ? "abrir no painel" : "Conferir",
                                    action: a.preset.map { preset in { withAnimation(DS.Motion.quick) { notch.adjust = AdjustTarget(project: a.projectId, adAccountId: a.adAccountId, campaignId: a.objectId, name: a.campaign, preset: preset) } } })
                        }
                    }
                    if let more = AutonomyText.moreAsks(a) { Text(more).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted) }
                }
                HStack(spacing: DS.Space.s) {
                    SectionHeader(title: "Status", detail: AutonomyText.switchLine(a))
                    ActionButton(title: "Painel", icon: "arrow.up.right", help: "Abrir o painel Autonomia do Bunk no navegador. Interruptor, níveis, ações e limites só mudam lá, por você.") { store.open("#autonomy") }
                }
                VStack(spacing: 2) {
                    AutonomyIslandRow(autonomy: a)
                    ForEach(a.projects) { p in
                        ListRow(id: "aut:p:" + p.id, symbol: AutonomyText.levelSymbol(p.mode), tone: AutonomyText.levelTone(p.mode, enabled: a.enabled),
                                title: p.name ?? p.id, subtitle: AutonomyText.projectLine(p, enabled: a.enabled),
                                value: AutonomyText.level(p.mode), valueCaption: "nível do projeto",
                                footer: AutonomyText.todayLine([p]).map { AnyView(Text($0).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).lineLimit(1)) })
                    }
                }
            } else {
                EmptyLine(text: "Este resumo veio sem o bloco da autonomia. Nada é enviado nem pedido por aqui.", kind: .info)
            }
            // Orders the Bunk created by itself (level Automático), with the same receipt as the owner's.
            let bunkOrders = (s.orders ?? []).filter(\.isBunk)
            SectionHeader(title: "Ordens do Bunk · 24h", detail: "nível Automático → executor → Malva → releitura")
            if bunkOrders.isEmpty {
                EmptyLine(text: "Nenhuma ordem do Bunk nas últimas 24h.", kind: .info)
            } else {
                VStack(spacing: 2) {
                    ForEach(bunkOrders) { o in
                        ListRow(id: "or:" + o.id, symbol: Format.orderSymbols[o.stage] ?? "circle", tone: Format.orderTone(o.stage),
                                title: o.campaign ?? "Campanha", subtitle: Format.orderChange(o) + (o.rule.map { " · " + $0 } ?? " · autonomia") + (o.reason.map { " · " + $0 } ?? ""),
                                tag: Format.queueTag(project: showProject ? o.projectName : nil, account: o.account),
                                value: o.label ?? o.stage, valueCaption: Format.relative(o.confirmedAt ?? o.sentAt ?? o.at))
                    }
                }
            }
            // Also on a quiet day: the 7-day score and the memory stay visible when there is something to show.
            if let sh = s.shadow, sh.total > 0 || (sh.learning.map { $0.graded > 0 || ($0.blindSpots ?? 0) > 0 } ?? false) {
                let would = sh.byRule.values.reduce(0) { $0 + $1.wouldExecute }, first = sh.byRule.values.reduce(0) { $0 + $1.bunkerFirst }
                SectionHeader(title: "Sombra do Bunk · hoje", detail: "\(would) executaria · \(first) antes do gestor · não executa nada")
                if let sc = sh.scorecard, sc.graded > 0 {
                    // Did the would-be action fit what happened the next day? (nothing was executed)
                    Text(Format.shadowScore(sc)).font(DS.Font.caption).foregroundStyle(sc.right * 10 >= sc.graded * 6 ? DS.Color.good : DS.Color.warn)
                        .help("Cada decisão da sombra é conferida pelo resultado real do dia seguinte: corte acerta se o dia seguinte deu prejuízo; aumento acerta se deu lucro. Campanha que parou não entra.")
                }
                if let l = sh.learning, l.graded > 0 || (l.blindSpots ?? 0) > 0 {
                    // What the Bunk has learned beyond the 7 days: score with an honest range and its top lesson.
                    Text(Format.shadowMemory(l)).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft)
                        .help("Memória de até 90 dias: cada decisão conferida pelo dia seguinte, com a faixa provável de acerto (95%). Ponto cego: corte do gestor ou seu que a Sombra não tinha apontado.")
                    if let lesson = l.lessons?.first {
                        Text(lesson).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(2)
                    }
                }
                VStack(spacing: 2) {
                    ForEach(sh.recent.prefix(5)) { item in
                        ListRow(id: "sh:" + item.id, symbol: item.action == "status" ? "pause.fill" : "dollarsign.circle", tone: item.manager != nil || item.owner != nil ? .good : (item.wouldExecute == true ? .warn : .neutral),
                                title: item.campaign ?? "Campanha",
                                subtitle: Format.shadowChange(item) + " · " + (item.ruleLabel ?? item.rule ?? ""),
                                tag: Format.queueTag(project: showProject ? item.project : nil, account: item.account),
                                value: Format.stamp(item.firstAt), valueCaption: Format.shadowOutcome(item),
                                accessory: AdjustPreset.from(item).flatMap { preset in
                                    // Desligado hides the quick action; Sombra/Confirmar/Automático: "Fazer eu mesmo" (contract b.3).
                                    ShadowActionButton.label(mode: s.autonomy?.mode(for: item), preset: preset).map { AnyView(ShadowActionButton(item: item, preset: preset, label: $0)) }
                                })
                    }
                }
            }
            if let l = s.shadow?.learning, !(l.team ?? []).isEmpty || !(l.proposals ?? []).isEmpty {
                // What the Bunk learned from your moves and the managers' (lib/team-learning.mjs). Readings only.
                SectionHeader(title: "O que o Bunk aprendeu com vocês", detail: "30 dias · só leitura, nada muda sozinho")
                    .help("Cada pausa, aumento ou redução sua e dos gestores fica guardada com os números do momento e com o que a Sombra tinha apontado. Propostas de limiar só valem com o seu sim.")
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array((l.team ?? []).prefix(3).enumerated()), id: \.offset) { _, line in
                        Text(line).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(2)
                    }
                    ForEach(Array((l.proposals ?? []).prefix(2).enumerated()), id: \.offset) { _, line in
                        Text(line).font(DS.Font.caption).foregroundStyle(DS.Color.warn).lineLimit(3)
                    }
                }
            }
            if let a = s.autonomy, !a.projects.isEmpty { ManagerPlays(autonomy: a, showProject: showProject) }
        }
    }
}

/// Pure text of the Autonomia tab, shared with the self-test. Level names follow the web panel.
extension AutonomyText {
    static func level(_ mode: String?) -> String {
        switch mode { case "off": return "Desligado"; case "shadow": return "Sombra"; case "confirm": return "Confirmar"; case "auto": return "Automático"; default: return "N/D" }
    }
    static func switchLine(_ a: Summary.Autonomy) -> String {
        a.enabled ? "interruptor geral ligado" : "interruptor geral desligado · o Bunk não envia nem pede nada"
    }
    /// What a level does right now: Confirmar and Automático only act with the general switch on.
    static func levelEffect(_ mode: String?, enabled: Bool) -> String {
        switch mode {
        case "off": return "não age, não pede e não sugere"
        case "shadow": return "só observa e anota o que faria"
        case "confirm": return enabled ? "pede a você antes de agir" : "parado: interruptor geral desligado"
        case "auto": return enabled ? "age sozinho dentro dos limites salvos" : "parado: interruptor geral desligado"
        default: return "nível N/D"
        }
    }
    static func levelTone(_ mode: String?, enabled: Bool) -> Tone {
        switch mode { case "auto": return enabled ? .good : .neutral; case "confirm": return enabled ? .warn : .neutral; case "shadow": return .accent; default: return .neutral }
    }
    static func levelSymbol(_ mode: String?) -> String {
        switch mode { case "auto": return "bolt.fill"; case "confirm": return "hand.raised.fill"; case "shadow": return "eye"; default: return "moon.zzz" }
    }
    /// "pede a você antes de agir · 2 campanhas com nível próprio"
    static func projectLine(_ p: Summary.AutonomyProject, enabled: Bool) -> String {
        var parts = [levelEffect(p.mode, enabled: enabled)]
        if let n = p.exceptions, n > 0 { parts.append(Format.count(n, "campanha com nível próprio", "campanhas com nível próprio")) }
        return parts.joined(separator: " · ")
    }
    /// Open requests of the level Confirmar: the server's total, or the rows it sent.
    static func asksCount(_ a: Summary.Autonomy) -> Int { max(a.asksTotal ?? 0, a.asks.count) }
    static func asksDetail(_ a: Summary.Autonomy) -> String {
        let n = asksCount(a)
        return n == 0 ? "nível Confirmar" : Format.count(n, "pedido", "pedidos") + " · nível Confirmar · você executa com Touch ID"
    }
    static func noAsks(_ a: Summary.Autonomy) -> String {
        a.enabled ? "Nenhum pedido aberto agora." : "Interruptor geral desligado: o Bunk não pede nem envia nada."
    }
    /// The notch lists at most five requests; the rest stay on the web panel.
    static func moreAsks(_ a: Summary.Autonomy) -> String? {
        let rest = asksCount(a) - a.asks.count
        return rest > 0 ? "Mais " + Format.count(rest, "pedido", "pedidos") + " no painel Autonomia do Bunk." : nil
    }
}
