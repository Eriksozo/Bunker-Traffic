import SwiftUI

/// Island attached to the top edge: square top, rounded bottom corners.
struct IslandShape: Shape {
    var radius: CGFloat
    var animatableData: CGFloat { get { radius } set { radius = newValue } }
    func path(in rect: CGRect) -> Path {
        let r = min(radius, rect.height / 2, rect.width / 2)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - r), control: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

struct NotchRootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                IslandShape(radius: notch.expanded ? DS.Radius.island : notch.mode == .compact ? 10 : 18).fill(DS.Color.canvas)
                switch notch.mode {
                case .open: ExpandedView().padding(.top, notch.geometry.height + DS.Space.s).transition(.opacity.combined(with: .move(edge: .top)))
                case .alert(let alert): AlertView(alert: alert).transition(.opacity)
                case .peek: PeekView().transition(.opacity)
                case .compact: CollapsedView().transition(.opacity)
                }
            }
            .frame(width: notch.islandSize.width, height: notch.islandSize.height)
            .shadow(color: .black.opacity(notch.expanded ? 0.5 : 0), radius: 24, y: 10)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }
}

/// Health of the companion itself: error, paused, attention, or calm.
@MainActor func healthTone(_ store: Store) -> Tone {
    if store.error != nil { return .bad }
    if store.summary?.paused == true || store.summary?.executor?.paused == true { return .warn }
    return store.attention > 0 ? .warn : .good
}

/// Resting state: ears on both sides of the camera.
struct CollapsedView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                StatusDot(tone: healthTone(store), size: 6)
                Image(systemName: "square.stack.3d.up.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(DS.Color.accent)
                if store.attention > 0 { Pill(text: "\(store.attention)", tone: .warn) }
                if store.muted { Image(systemName: "moon.fill").font(.system(size: 9)).foregroundStyle(DS.Color.inkMuted).help("Avisos silenciados") }
            }.frame(width: NotchState.earWidth)
            Spacer(minLength: notch.geometry.width)
            Text(ticker).font(.system(size: 10.5, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(DS.Color.inkSoft)
                .lineLimit(1).minimumScaleFactor(0.75).frame(width: NotchState.earWidth - 8)
                .id(notch.tick).transition(.push(from: .bottom))
        }
        .frame(height: notch.geometry.height)
        .contentShape(Rectangle())
        .onTapGesture { notch.onClick() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Bunker: \(store.attention) itens pedem atenção")
        .accessibilityAddTraits(.isButton)
    }
    /// Rotates every 5 s: ROAS today, spend today, latest manager change.
    var ticker: String {
        guard let s = store.summary else { return store.preparing ? "preparando" : "…" }
        var items = ["ROAS " + Format.ratio(s.today.today?.roas), "Gasto " + Format.compactMoney(s.today.today?.spend)]
        if let e = s.activity.recent.first {
            let who = e.actor.map { String($0.split(separator: " ").first ?? "") } ?? "Gestor"
            let icon = ["increase": "↑", "reduce": "↓", "pause": "⏸", "activate": "▶︎"][e.action] ?? "•"
            items.append("\(who) \(icon) \(Format.relative(e.at).replacingOccurrences(of: "há ", with: ""))")
        }
        return items[notch.tick % items.count]
    }
}

/// Hover: a one-line glance under the notch. Click (or ⌥⌘B) opens the full island.
struct PeekView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        VStack(spacing: 0) {
            CollapsedView().allowsHitTesting(false)
            HStack(spacing: DS.Space.s) {
                StatusDot(tone: healthTone(store), size: 6)
                Text(headline).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(1)
                Spacer(minLength: DS.Space.s)
                Text("clique ou \(HotKey.label)").font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted)
            }
            .padding(.horizontal, DS.Space.l).frame(height: 30)
        }
        .contentShape(Rectangle())
        .onTapGesture { notch.onClick() }
    }
    var headline: String {
        if store.preparing { return "Resumo em preparação pelo executor…" }
        if let e = store.error { return e }
        guard let s = store.summary else { return "Lendo o Bunker…" }
        let losses = s.queue.filter { $0.kind == "loss" }.count
        var parts = ["ROAS hoje \(Format.ratio(s.today.today?.roas))"]
        if s.approvals.count > 0 { parts.insert("\(s.approvals.count) aguardando você", at: 0) }
        if losses > 0 { parts.append("\(losses) perda(s)") }
        let changes = s.activity.summary.values.reduce(0) { $0 + $1.count }
        parts.append("\(changes) mudança(s) em \(s.activity.hours)h")
        return parts.joined(separator: " · ")
    }
}

/// New approval, loss or manager change: expands by itself for a few seconds.
struct AlertView: View {
    @EnvironmentObject var notch: NotchState
    let alert: IslandAlert
    var tone: Tone { alert.kind == .approval ? .warn : alert.kind == .loss ? .bad : .accent }
    var symbol: String { alert.kind == .approval ? "checkmark.seal.fill" : alert.kind == .loss ? "arrow.down.right" : "person.crop.circle.badge.exclamationmark" }
    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: notch.geometry.height)
            HStack(alignment: .center, spacing: DS.Space.m) {
                IconBadge(symbol: symbol, tone: tone)
                VStack(alignment: .leading, spacing: 3) {
                    Text(alert.title).font(DS.Font.bodyStrong).foregroundStyle(DS.Color.ink).lineLimit(1)
                    Text(alert.detail).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2).truncationMode(.middle)
                }
                Spacer(minLength: DS.Space.s)
                Text("abrir").font(DS.Font.caption).foregroundStyle(DS.Color.accent)
            }
            .padding(.horizontal, DS.Space.l).padding(.vertical, DS.Space.m)
        }
        .contentShape(Rectangle())
        .onTapGesture { notch.onClick() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(alert.title + ". " + alert.detail)
    }
}

struct ExpandedView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            Header()
            if let error = store.error { Banner(text: error, tone: .bad) }
            if store.preparing && store.summary == nil { Banner(text: "Resumo em preparação pelo executor. Aparece em 1 a 2 minutos.", tone: .neutral) }
            if notch.webTarget != nil {
                AdjustView()
            } else if let s = store.summary, let item = notch.selected {
                CampaignDetailView(s: s, item: item)
            } else if let s = store.summary {
                KPIStrip(s: s)
                TabBar(s: s)
                ScrollView(.vertical, showsIndicators: false) {
                    Group {
                        switch notch.tab {
                        case .now: NowTab(s: s)
                        case .projects: ProjectsTab(s: s)
                        case .managers: ManagersTab(s: s)
                        case .agents: AgentsTab(s: s)
                        case .system: SystemTab(s: s)
                        }
                    }
                    .padding(.bottom, DS.Space.l)
                }
            } else if store.error == nil && !store.preparing {
                HStack(spacing: DS.Space.s) { ProgressView().controlSize(.small); Text("Lendo o Bunker…").font(DS.Font.body).foregroundStyle(DS.Color.inkMuted) }
                    .frame(maxWidth: .infinity, alignment: .center).padding(.top, DS.Space.xl)
            }
        }
        .padding(.horizontal, DS.Space.xl)
        .foregroundStyle(DS.Color.ink)
    }
}

struct Header: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        HStack(spacing: DS.Space.s) {
            HStack(spacing: 6) {
                Image(systemName: "square.stack.3d.up.fill").font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.Color.accent)
                Text("BUNKER").font(DS.Font.mark).tracking(1.6).foregroundStyle(DS.Color.accent)
            }
            ProjectMenu()
            Spacer(minLength: DS.Space.s)
            HStack(spacing: 6) {
                StatusDot(tone: healthTone(store), size: 6)
                Text(freshness).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            .help(store.summary?.analysisAt.map { "Base de análise: " + Format.stamp($0) } ?? "")
            IconButton(symbol: "arrow.clockwise", help: "Atualizar agora", spinning: store.loading) { Task { await store.refresh() } }
            Button { store.open("#cards") } label: {
                HStack(spacing: 5) { Text("Abrir Bunker").font(DS.Font.bodyStrong); Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)) }
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .foregroundStyle(.black.opacity(0.85))
                    .background(DS.Color.accent, in: Capsule())
            }.buttonStyle(.plain).help("Abrir os cards de decisão no navegador")
            IconButton(symbol: "xmark", help: "Fechar (Esc) · abrir de novo com \(HotKey.label)") { notch.onClose() }
        }
    }
    var freshness: String {
        if store.loading && store.summary == nil { return "Atualizando…" }
        guard let at = store.lastFetch else { return "Sem leitura" }
        return "Atualizado " + Format.relative(at)
    }
}

struct IconButton: View {
    let symbol: String; let help: String; var spinning = false; let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(spinning ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: spinning)
                .frame(width: 24, height: 24)
                .foregroundStyle(DS.Color.inkSoft)
                .background(DS.Color.surface, in: Circle())
        }.buttonStyle(.plain).help(help)
    }
}

struct ProjectMenu: View {
    @EnvironmentObject var store: Store
    var body: some View {
        Menu {
            Button("Todos os projetos") { store.project = "all" }
            Divider()
            ForEach(store.summary?.projects ?? [], id: \.id) { p in Button(p.name) { store.project = p.id } }
        } label: {
            HStack(spacing: 5) {
                Text(store.summary?.projectName ?? "Projeto").font(DS.Font.bodyStrong).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 8.5, weight: .bold)).foregroundStyle(DS.Color.inkMuted)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(DS.Color.surface, in: Capsule())
            .overlay(Capsule().stroke(DS.Color.stroke))
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
    }
}

struct Banner: View {
    let text: String; let tone: Tone
    var body: some View {
        HStack(spacing: DS.Space.s) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(tone.color)
            Text(text).font(DS.Font.body).foregroundStyle(DS.Color.ink)
        }
        .padding(DS.Space.s).frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
    }
}

// MARK: - KPIs

struct KPIStrip: View {
    let s: Summary
    var body: some View {
        HStack(spacing: DS.Space.s) {
            StatTile(label: "ROAS hoje", value: Format.ratio(s.today.today?.roas), base: "ontem \(Format.ratio(s.today.yesterday?.roas)) · 7d \(Format.ratio(s.today.week?.roas))", delta: s.today.deltas["roas"], higherIsBetter: true)
            StatTile(label: "ROI hoje", value: Format.ratio(s.today.today?.roi), base: "ontem \(Format.ratio(s.today.yesterday?.roi)) · 7d \(Format.ratio(s.today.week?.roi))", delta: s.today.deltas["roi"], higherIsBetter: true)
            StatTile(label: "CPA front hoje", value: Format.money(s.today.today?.cpaFront), base: "ontem \(Format.money(s.today.yesterday?.cpaFront)) · 7d \(Format.money(s.today.week?.cpaFront))", delta: s.today.deltas["cpaFront"], higherIsBetter: false)
        }
    }
}

struct StatTile: View {
    let label: String; let value: String; let base: String; let delta: Summary.Delta?; let higherIsBetter: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(label).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            Text(value).font(DS.Font.stat).lineLimit(1).minimumScaleFactor(0.8)
            HStack(spacing: DS.Space.xs) { pill(delta?.yesterday, "ontem"); pill(delta?.week, "7d") }
            Text(base).font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted).lineLimit(1).minimumScaleFactor(0.85)
        }
        .padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
    }
    func pill(_ value: Double?, _ label: String) -> some View {
        guard let value else { return Pill(text: "N/D \(label)") }
        let flat = abs(value) < 0.05
        return Pill(text: "\(Format.percent(value * 100)) \(label)", tone: flat ? .neutral : (value > 0) == higherIsBetter ? .good : .bad,
                    icon: flat ? nil : value > 0 ? "arrow.up" : "arrow.down")
    }
}

// MARK: - Tabs

struct TabBar: View {
    @EnvironmentObject var notch: NotchState
    let s: Summary
    var body: some View {
        HStack(spacing: DS.Space.xs) {
            ForEach(NotchTab.allCases, id: \.self) { tab in
                let selected = notch.tab == tab
                Button { withAnimation(DS.Motion.quick) { notch.tab = tab } } label: {
                    HStack(spacing: 5) {
                        Text(tab.rawValue).font(DS.Font.bodyStrong)
                        if let badge = badge(tab) { Pill(text: badge.0, tone: badge.1) }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .foregroundStyle(selected ? DS.Color.ink : DS.Color.inkMuted)
                    .background(selected ? DS.Color.surfaceSelected : .clear, in: Capsule())
                    .contentShape(Capsule())
                }.buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(3)
        .background(DS.Color.surface, in: Capsule())
    }
    func badge(_ tab: NotchTab) -> (String, Tone)? {
        switch tab {
        case .now:
            let n = s.approvals.count + s.queue.filter { $0.kind == "loss" }.count
            return n > 0 ? ("\(n)", s.approvals.count > 0 ? .warn : .bad) : nil
        case .managers:
            let n = s.activity.summary.values.reduce(0) { $0 + $1.count }
            return n > 0 ? ("\(n)", .neutral) : nil
        case .projects:
            let n = (s.board ?? []).reduce(0) { $0 + $1.approvals }
            return n > 0 ? ("\(n)", .warn) : nil
        case .agents: return s.agents.recent.isEmpty ? nil : ("\(s.agents.recent.count)", .neutral)
        case .system:
            guard let e = s.executor else { return nil }
            return e.recentFailures > 0 ? ("\(e.recentFailures)", .warn) : nil
        }
    }
}

/// Hoverable row: highlight, trailing value with caption, chevron when it opens something.
struct ListRow: View {
    @EnvironmentObject var notch: NotchState
    let id: String; let symbol: String; let tone: Tone
    let title: String; let subtitle: String; var tag: String? = nil
    var value: String? = nil; var valueCaption: String? = nil
    var action: (() -> Void)? = nil
    var body: some View {
        let hovered = notch.hovered == id
        let row = HStack(alignment: .center, spacing: DS.Space.m) {
            IconBadge(symbol: symbol, tone: tone)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(DS.Font.bodyStrong).lineLimit(1).truncationMode(.middle)
                HStack(spacing: DS.Space.xs) {
                    if let tag { Pill(text: tag, tone: .accent) }
                    Text(subtitle).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                }
            }
            Spacer(minLength: DS.Space.s)
            if let value {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(value).font(DS.Font.number).foregroundStyle(tone.color)
                    if let valueCaption { Text(valueCaption).font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted) }
                }
            }
            if action != nil { Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(DS.Color.inkMuted).opacity(hovered ? 1 : 0.35) }
        }
        .padding(.horizontal, DS.Space.s).padding(.vertical, 7)
        .background(hovered ? DS.Color.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
        .contentShape(Rectangle())
        .onHover { inside in withAnimation(DS.Motion.quick) { if inside { notch.hovered = id } else if notch.hovered == id { notch.hovered = nil } } }
        if let action { Button(action: action) { row }.buttonStyle(.plain) } else { row }
    }
}

struct EmptyLine: View {
    let text: String
    var body: some View {
        HStack(spacing: DS.Space.s) { Image(systemName: "checkmark.circle").foregroundStyle(DS.Color.good); Text(text) }
            .font(DS.Font.body).foregroundStyle(DS.Color.inkMuted).padding(.vertical, DS.Space.s)
    }
}

struct NowTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let s: Summary
    var showProject: Bool { s.project == "all" }
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            if s.approvals.count > 0 {
                SectionHeader(title: "Aguardando você", detail: "\(s.approvals.count) proposta(s) exata(s) · aprovar no Bunker")
                VStack(spacing: 2) {
                    ForEach(s.approvals.items) { a in
                        ListRow(id: "ap:" + a.id, symbol: "checkmark.seal.fill", tone: .warn, title: a.title ?? "Proposta exata",
                                subtitle: a.expiresAt.map { "vence " + Format.stamp($0) } ?? "conferir e aprovar", tag: showProject ? a.project : nil,
                                value: "Conferir", action: { withAnimation(DS.Motion.quick) { notch.webTarget = URL(string: Store.base.absoluteString + "/#cards") } })
                    }
                }
            }
            SectionHeader(title: "O que fazer agora", detail: "\(s.queue.count) de \(s.queueSize) na fila · ordenado por dinheiro em jogo")
            if s.queue.isEmpty { EmptyLine(text: "Nada pedindo ação agora.") }
            VStack(spacing: 2) {
                ForEach(s.queue) { q in
                    let loss = q.kind == "loss"
                    ListRow(id: "q:" + q.id, symbol: loss ? "arrow.down.right" : "arrow.up.right", tone: loss ? .bad : .good,
                            title: q.campaign ?? "Campanha",
                            subtitle: "\(q.period == "today" ? "Hoje" : "3 dias"): gasto \(Format.money(q.spend)) · ROAS \(Format.ratio(q.roas)) · 7d \(Format.ratio(q.roas7d))",
                            tag: Format.queueTag(project: showProject ? q.project : nil, account: q.account),
                            value: (loss ? "−" : "+") + Format.money(q.amount),
                            valueCaption: loss ? (q.basis == "result" ? (q.period == "today" ? "prejuízo hoje" : "prejuízo em 3 dias") : "receita abaixo da mídia") : "resultado em 3 dias",
                            action: { withAnimation(DS.Motion.quick) { notch.selected = q } })
                }
            }
            if let sh = s.shadow, sh.total > 0 {
                let would = sh.byRule.values.reduce(0) { $0 + $1.wouldExecute }, first = sh.byRule.values.reduce(0) { $0 + $1.bunkerFirst }
                SectionHeader(title: "Sombra do Bunker · hoje", detail: "\(would) executaria · \(first) antes do gestor · não executa nada")
                VStack(spacing: 2) {
                    ForEach(sh.recent.prefix(5)) { item in
                        ListRow(id: "sh:" + item.id, symbol: item.action == "status" ? "pause.fill" : "dollarsign.circle", tone: item.manager != nil ? .good : (item.wouldExecute == true ? .warn : .neutral),
                                title: item.campaign ?? "Campanha",
                                subtitle: Format.shadowChange(item) + " · " + (item.ruleLabel ?? item.rule ?? ""),
                                tag: Format.queueTag(project: showProject ? item.project : nil, account: item.account),
                                value: Format.stamp(item.firstAt), valueCaption: Format.shadowOutcome(item))
                    }
                }
            }
        }
    }
}

struct ManagersTab: View {
    @EnvironmentObject var notch: NotchState
    let s: Summary
    let keys = ["increase", "reduce", "pause", "activate"]
    let symbols = ["increase": "arrow.up.right", "reduce": "arrow.down.right", "pause": "pause.fill", "activate": "play.fill"]
    let tones: [String: Tone] = ["increase": .good, "reduce": .bad, "pause": .bad, "activate": .good]
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Gestores · últimas \(s.activity.hours)h", detail: "clique numa caixa para filtrar quem, quando e quanto")
            HStack(alignment: .top, spacing: DS.Space.s) {
                ForEach(keys, id: \.self) { key in box(key) }
            }
            let list = s.activity.recent.filter { notch.activityFilter == nil || $0.action == notch.activityFilter }
            SectionHeader(title: notch.activityFilter.map { (Format.actionLabels[$0] ?? $0) + " recentes" } ?? "Mais recentes", detail: "\(list.count) registro(s) no resumo")
            if list.isEmpty { EmptyLine(text: "Nenhuma mudança neste filtro.") }
            VStack(spacing: 2) {
                ForEach(list) { e in
                    ListRow(id: "a:" + e.id, symbol: symbols[e.action] ?? "clock", tone: tones[e.action] ?? .neutral,
                            title: Format.who(e), subtitle: (e.campaign ?? "Campanha") + " · " + Format.change(e),
                            value: Format.relative(e.at), valueCaption: e.origin == "observed" ? "intervalo da leitura" : Format.stamp(e.at))
                }
            }
        }
    }
    func box(_ key: String) -> some View {
        let b = s.activity.summary[key], selected = notch.activityFilter == key, count = b?.count ?? 0
        let people = (b?.actors ?? [:]).sorted { $0.value > $1.value }
        return Button { withAnimation(DS.Motion.quick) { notch.activityFilter = selected ? nil : key } } label: {
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                HStack(spacing: 5) {
                    Image(systemName: symbols[key] ?? "circle").font(.system(size: 9.5, weight: .bold)).foregroundStyle((tones[key] ?? .neutral).color)
                    Text(Format.actionLabels[key] ?? key).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft)
                }
                Text("\(count)").font(DS.Font.stat)
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(people.prefix(2), id: \.key) { p in Text("\(p.key) · \(p.value)").font(.system(size: 9.5)).foregroundStyle(DS.Color.inkSoft).lineLimit(1) }
                    if let u = b?.unknown, u > 0 { Text("\(u) sem autor").font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted) }
                    if count == 0 { Text("nenhuma").font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted) }
                }
                Spacer(minLength: 0)
            }
            .padding(DS.Space.m).frame(maxWidth: .infinity, minHeight: 104, maxHeight: 104, alignment: .topLeading)
            .card(selected: selected)
            .contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(count == 0)
    }
}

struct AgentsTab: View {
    let s: Summary
    let roleTones: [String: Tone] = ["traffic": .good, "creative": .accent, "budget": .warn, "ops": .neutral]
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Agentes", detail: "últimas conclusões e perguntas entre eles")
            if s.agents.recent.isEmpty { EmptyLine(text: "Sem conversa recente.") }
            VStack(spacing: 2) {
                ForEach(s.agents.recent) { m in
                    HStack(alignment: .top, spacing: DS.Space.m) {
                        Text(String((m.agent ?? "?").prefix(1))).font(.system(size: 11, weight: .bold))
                            .frame(width: 26, height: 26).foregroundStyle((roleTones[m.role ?? ""] ?? .neutral).color)
                            .background((roleTones[m.role ?? ""] ?? .neutral).color.opacity(0.15), in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: DS.Space.xs) {
                                Text(m.agent ?? "Agente").font(DS.Font.bodyStrong)
                                if let to = m.to { Text("→ \(to)").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted) }
                                if s.project == "all", let p = m.project { Pill(text: p, tone: .accent) }
                                Spacer(minLength: 0)
                                Text(Format.relative(m.at)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                            }
                            if let d = m.decision, !d.isEmpty { Text(d).font(DS.Font.body).foregroundStyle(DS.Color.ink).lineLimit(2) }
                            if let t = m.text { Text(t).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2) }
                        }
                    }
                    .padding(.horizontal, DS.Space.s).padding(.vertical, 7)
                }
            }
        }
    }
}

struct SystemTab: View {
    @EnvironmentObject var store: Store
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Executor na nuvem")
            if let e = s.executor {
                HStack(spacing: DS.Space.s) {
                    StatusDot(tone: !e.enabled || e.paused ? .warn : e.recentFailures > 0 ? .warn : .good)
                    Text(e.paused ? "Pausado" : e.enabled ? "Ativo" : "Desligado").font(DS.Font.bodyStrong)
                    Pill(text: "\(e.recentFailures) falha(s) na última hora", tone: e.recentFailures > 0 ? .warn : .neutral)
                    Spacer()
                    Text("último pulso " + Format.relative(e.lastPulseAt)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                }.padding(DS.Space.m).card()
            } else { EmptyLine(text: "Status do executor indisponível nesta leitura.") }
            SectionHeader(title: "Dados")
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text("Base de análise: " + (s.analysisAt.map(Format.stamp) ?? "N/D")).font(DS.Font.body)
                Text("Resumo gerado " + Format.relative(s.generatedAt) + " · atualiza a cada 2 minutos").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                if s.paused { Pill(text: "Escritório pausado", tone: .warn) }
            }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
            SectionHeader(title: "Avisos", detail: store.muted ? "silenciados até " + Format.stamp(Format.isoFull.string(from: store.mutedUntil!)) : "ativos no notch e no macOS")
            HStack(spacing: DS.Space.s) {
                if store.muted { Button("Reativar avisos") { store.unmute() } }
                else {
                    Button("Silenciar 1 hora") { store.mute(hours: 1) }
                    Button("Até amanhã às 8h") { store.muteUntilTomorrow() }
                }
            }.buttonStyle(.bordered).controlSize(.small)
            Text(s.notice).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
        }
    }
}

/// Every project at a glance; clicking one scopes the island to it.
struct ProjectsTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Projetos hoje", detail: "ordenados por gasto · clique para focar")
            if (s.board ?? []).isEmpty { EmptyLine(text: "Placar disponível na próxima atualização do executor.") }
            VStack(spacing: 2) {
                ForEach(s.board ?? []) { p in
                    let selected = store.project == p.id
                    let trend: Tone = {
                        guard let t = p.roas, let y = p.roasYesterday, y > 0 else { return .neutral }
                        return t >= y ? .good : .bad
                    }()
                    Button {
                        store.project = selected ? "all" : p.id
                        withAnimation(DS.Motion.quick) { notch.tab = .now }
                    } label: {
                        HStack(spacing: DS.Space.m) {
                            Text(String(p.name.prefix(1))).font(.system(size: 11, weight: .bold)).frame(width: 26, height: 26)
                                .foregroundStyle(DS.Color.accent).background(DS.Color.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: DS.Radius.s))
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: DS.Space.xs) {
                                    Text(p.name).font(DS.Font.bodyStrong)
                                    if selected { Pill(text: "em foco", tone: .accent) }
                                    if p.approvals > 0 { Pill(text: "\(p.approvals) para aprovar", tone: .warn) }
                                    if p.losses > 0 { Pill(text: "\(p.losses) perda(s)", tone: .bad) }
                                }
                                Text("gasto \(Format.money(p.spend)) · ROI \(Format.ratio(p.roi)) · \(p.changes) mudança(s) em 24h").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                            }
                            Spacer(minLength: DS.Space.s)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(Format.ratio(p.roas)).font(DS.Font.number).foregroundStyle(trend.color)
                                Text("ontem " + Format.ratio(p.roasYesterday)).font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted)
                            }
                        }
                        .padding(.horizontal, DS.Space.s).padding(.vertical, 7)
                        .background(notch.hovered == "p:" + p.id || selected ? DS.Color.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .onHover { inside in if inside { notch.hovered = "p:" + p.id } else if notch.hovered == "p:" + p.id { notch.hovered = nil } }
                }
            }
        }
    }
}

/// Drill-down of one campaign inside the island: windows, budget, status, latest changes with author.
struct CampaignDetailView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let s: Summary
    let item: Summary.QueueItem
    let periods: [(String, String)] = [("today", "Hoje"), ("yesterday", "Ontem"), ("3d", "3 dias"), ("7d", "7 dias")]
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            HStack(spacing: DS.Space.s) {
                IconButton(symbol: "chevron.left", help: "Voltar (Esc)") { withAnimation(DS.Motion.quick) { notch.selected = nil } }
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.campaign ?? "Campanha").font(DS.Font.bodyStrong).lineLimit(1).truncationMode(.middle)
                    HStack(spacing: DS.Space.xs) {
                        if let p = item.project { Pill(text: p, tone: .accent) }
                        Pill(text: Format.statusName(item.detail?.status), tone: item.detail?.status == "ACTIVE" ? .good : .neutral)
                        Text("diário " + Format.money(item.detail?.dailyBudget, currency: item.detail?.budgetCurrency)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                    }
                }
                Spacer()
                Button { withAnimation(DS.Motion.quick) { notch.webTarget = URL(string: Store.base.absoluteString + "/" + deepLink) } } label: {
                    HStack(spacing: 5) { Image(systemName: "slider.horizontal.3").font(.system(size: 10, weight: .bold)); Text("Ajustar aqui").font(DS.Font.bodyStrong) }
                        .padding(.horizontal, 10).padding(.vertical, 5).foregroundStyle(.black.opacity(0.85)).background(DS.Color.accent, in: Capsule())
                }.buttonStyle(.plain).help("Pausar, reduzir ou aumentar pelo card do Bunker, dentro do notch")
                IconButton(symbol: "arrow.up.right.square", help: "Abrir o card no navegador") { store.open(deepLink) }
                if Store.malvaCampaignsURL(projectId: item.detail?.projectId) != nil {
                    IconButton(symbol: "chart.bar.xaxis", help: "Abrir na Malva (lista do projeto) e copiar o nome da campanha para a busca") { store.openMalva(projectId: item.detail?.projectId, campaign: item.campaign) }
                }
            }
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: DS.Space.m) {
                    HStack(spacing: DS.Space.s) {
                        ForEach(periods, id: \.0) { key, label in
                            let w = item.detail?.windows[key] ?? nil
                            VStack(alignment: .leading, spacing: 3) {
                                Text(label).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                                Text(Format.ratio(w?.roas)).font(DS.Font.stat).foregroundStyle((w?.roi ?? 1) >= 1 ? DS.Color.ink : DS.Color.bad)
                                Text("ROI " + Format.ratio(w?.roi)).font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted)
                                Text("gasto " + Format.compactMoney(w?.spend)).font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted)
                                Text("front \(w?.frontOrders.map { String(Int($0)) } ?? "N/D")").font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted)
                            }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
                        }
                    }
                    if let reason = item.detail?.reason {
                        SectionHeader(title: "Sinal", detail: item.decision)
                        Text(reason).font(DS.Font.body).foregroundStyle(DS.Color.inkSoft).fixedSize(horizontal: false, vertical: true)
                    }
                    SectionHeader(title: "Últimas mudanças", detail: "quem, quando e quanto · 24h")
                    if (item.detail?.changes ?? []).isEmpty { EmptyLine(text: "Nenhuma mudança de orçamento ou status nas últimas 24h.") }
                    VStack(spacing: 2) {
                        ForEach(item.detail?.changes ?? []) { e in
                            ListRow(id: "d:" + e.id, symbol: ["increase": "arrow.up.right", "reduce": "arrow.down.right", "pause": "pause.fill", "activate": "play.fill"][e.action] ?? "clock",
                                    tone: ["increase", "activate"].contains(e.action) ? .good : .bad, title: Format.who(e), subtitle: Format.change(e),
                                    value: Format.relative(e.at), valueCaption: Format.stamp(e.at))
                        }
                    }
                    Text("Somente leitura: decidir e aprovar continua no card, com a confirmação exata.").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                }.padding(.bottom, DS.Space.l)
            }
        }
    }
    var deepLink: String {
        var c = URLComponents(); c.queryItems = [URLQueryItem(name: "project", value: item.detail?.projectId ?? ""), URLQueryItem(name: "q", value: item.campaignId ?? "")]
        return "#cards?" + (c.percentEncodedQuery ?? "")
    }
}

/// The real Bunker card inside the island: same buttons, locks and exact confirmation as the web.
/// Signing in is the owner e-mail link, pasted here once; the session stays in this app's web store.
struct AdjustView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var onLogin: Bool { notch.webCurrent?.path.hasPrefix("/auth/") ?? false }
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            HStack(spacing: DS.Space.s) {
                IconButton(symbol: "chevron.left", help: "Voltar ao resumo") { withAnimation(DS.Motion.quick) { notch.webTarget = nil } }
                Text("Ajustar no Bunker").font(DS.Font.bodyStrong)
                Pill(text: "confirmação exata", tone: .accent)
                Spacer()
                IconButton(symbol: "arrow.clockwise", help: "Recarregar o card") { notch.webReload &+= 1 }
                IconButton(symbol: "safari", help: "Abrir no navegador") { if let url = notch.webCurrent ?? notch.webTarget { NSWorkspace.shared.open(url) } }
            }
            if onLogin {
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text("Entre uma vez: peça o link de acesso abaixo, depois copie o link do e-mail (clique com o botão direito › Copiar link) e cole aqui.")
                        .font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: DS.Space.s) {
                        TextField("Cole aqui o link do e-mail do Bunker", text: $notch.pastedLink).textFieldStyle(.roundedBorder).controlSize(.small)
                        Button("Entrar") {
                            if let url = WebScope.signInLink(notch.pastedLink) { notch.webTarget = url; notch.pastedLink = "" }
                        }.controlSize(.small).disabled(WebScope.signInLink(notch.pastedLink) == nil)
                    }
                }
                .padding(DS.Space.s).card()
            }
            if let url = notch.webTarget {
                BunkerWebView(url: url, reloadToken: $notch.webReload, currentURL: $notch.webCurrent)
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous).stroke(DS.Color.stroke))
            }
            Text("Executa só a proposta exata que você aprovar no card, com despacho único. Sem proposta exata, a escolha fica como intenção.")
                .font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted).padding(.bottom, DS.Space.s)
        }
    }
}
