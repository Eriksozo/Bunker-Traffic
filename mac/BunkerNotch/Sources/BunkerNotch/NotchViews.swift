import SwiftUI

/// Island attached to the top edge. Concave top "shoulders" flow into the bezel like the hardware notch,
/// rounded bottom corners; both radii animate between states. Path adapted from DynamicNotchKit's
/// NotchShape (MIT, Kai Azim; credited in mac/NOTICE.md). The shoulders sit inside the rect, so hit areas are unchanged.
struct IslandShape: Shape {
    var top: CGFloat
    var bottom: CGFloat
    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(top, bottom) }
        set { top = newValue.first; bottom = newValue.second }
    }
    /// Radii per state: small and tight at rest, softer as the island grows.
    static func radii(_ mode: IslandFSM.State) -> (top: CGFloat, bottom: CGFloat) {
        switch mode { case .compact: return (6, 12); case .peek: return (8, 16); case .alert: return (10, 20); case .open: return (14, DS.Radius.island) }
    }
    func path(in rect: CGRect) -> Path {
        let t = max(0, min(top, rect.width / 4, rect.height / 3)), b = max(0, min(bottom, rect.height - t, (rect.width - 2 * t) / 2))
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addQuadCurve(to: CGPoint(x: rect.minX + t, y: rect.minY + t), control: CGPoint(x: rect.minX + t, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.minX + t, y: rect.maxY - b))
        p.addQuadCurve(to: CGPoint(x: rect.minX + t + b, y: rect.maxY), control: CGPoint(x: rect.minX + t, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX - t - b, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - t, y: rect.maxY - b), control: CGPoint(x: rect.maxX - t, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX - t, y: rect.minY + t))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY), control: CGPoint(x: rect.maxX - t, y: rect.minY))
        p.closeSubpath()
        return p
    }
}

/// Opening content: a short blur + slight scale from the top edge, so it pours out of the notch.
/// Reduce Motion falls back to a plain fade.
private struct PourModifier: ViewModifier {
    let active: Bool
    func body(content: Content) -> some View {
        content.blur(radius: active ? 8 : 0).scaleEffect(active ? 0.96 : 1, anchor: .top).opacity(active ? 0 : 1)
    }
}
extension AnyTransition {
    @MainActor static var pour: AnyTransition {
        A11y.reduceMotion || A11y.reduceTransparency ? .opacity : .modifier(active: PourModifier(active: true), identity: PourModifier(active: false))
    }
    /// Value swaps in small text (ticker): blur-fade instead of a slide. Idea from CodeIsland (MIT).
    @MainActor static var blurFade: AnyTransition {
        A11y.reduceMotion || A11y.reduceTransparency ? .opacity : .modifier(active: BlurFade(active: true), identity: BlurFade(active: false))
    }
}
private struct BlurFade: ViewModifier {
    let active: Bool
    func body(content: Content) -> some View { content.blur(radius: active ? 4 : 0).opacity(active ? 0 : 1) }
}

struct NotchRootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                let radii = IslandShape.radii(notch.mode)
                IslandShape(top: radii.top, bottom: radii.bottom).fill(DS.Color.canvas)
                switch notch.mode {
                case .open: ExpandedView().padding(.top, notch.geometry.height + DS.Space.s).transition(.pour)
                case .alert(let alert): AlertView(alert: alert).transition(.opacity)
                case .peek: PeekView().transition(.opacity)
                case .compact: CollapsedView().transition(.opacity)
                }
            }
            .frame(width: notch.islandSize.width, height: notch.islandSize.height)
            // Depth grows with the island: none at rest (it is the bezel), soft when peeking, deep when open.
            .shadow(color: .black.opacity(notch.expanded ? 0.5 : notch.mode == .compact ? 0 : 0.3), radius: notch.expanded ? 24 : 12, y: notch.expanded ? 10 : 5)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }
}

/// Minutes since the last good reading, only once it is older than 10 minutes (the cadence is 1–2 min).
@MainActor func staleMinutes(_ store: Store, now: Date = Date()) -> Int? {
    guard let at = store.lastFetch else { return nil }
    let m = Int(now.timeIntervalSince(at) / 60)
    return m >= 10 ? m : nil
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
        // One computation per redraw (it used to run three times: text, colour and change detection).
        let items = tickerItems
        let current: UrgencyTicker.Item? = items.isEmpty ? nil : items[notch.tick % items.count]
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                BunkAvatar(size: 20, interactive: false)
                // The bell says what the number counts: items that still need the owner (approvals and losses).
                if store.attention > 0 { Pill(text: "\(store.attention)", tone: .warn, icon: "bell.fill") }
                else if let s = store.summary, !store.muted { MiniBars(values: s.today.roasTrend, height: 11, barWidth: 3) }
                if store.muted { Image(systemName: "moon.fill").font(.system(size: 9)).foregroundStyle(DS.Color.inkMuted).help("Avisos silenciados") }
            }.frame(width: NotchState.earWidth)
            Spacer(minLength: notch.geometry.width)
            Text(current?.text ?? (store.preparing ? "preparando" : "…")).font(.system(size: 10.5, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(current.map { $0.tone == .neutral ? DS.Color.inkSoft : $0.tone.color } ?? DS.Color.inkSoft)
                .lineLimit(1).minimumScaleFactor(0.7).frame(width: NotchState.earWidth - 14).padding(.trailing, 14)
                .id(notch.tick).transition(.blurFade)
        }
        // A newly urgent item (approval, loss, account at its limit) is shown at once.
        .onChange(of: items.map(\.key)) { old, new in
            if let i = UrgencyTicker.focus(previousKeys: Set(old), items: items) { withAnimation(DS.Motion.quick) { notch.tick = i } }
        }
        .frame(height: notch.geometry.height)
        .contentShape(Rectangle())
        .onTapGesture { notch.onClick() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Bunk: " + (store.attention == 0 ? "nada pede atenção" : Format.count(store.attention, "item pede", "itens pedem") + " atenção"))
        .accessibilityAddTraits(.isButton)
    }
    /// Rotates every 5 s, most urgent first (UrgencyTicker): approvals, top loss, accounts at the limit; then ROAS, spend, latest change.
    var tickerItems: [UrgencyTicker.Item] {
        let change = store.summary?.activity.recent.first.map { e -> String in
            let who = e.actor.map { String($0.split(separator: " ").first ?? "") } ?? "Gestor"
            let icon = ["increase": "↑", "reduce": "↓", "pause": "⏸", "activate": "▶︎"][e.action] ?? "•"
            return "\(who) \(icon) \(Format.relative(e.at).replacingOccurrences(of: "há ", with: ""))"
        }
        return UrgencyTicker.items(store.summary, recentChange: change, ledger: store.ledger, staleMinutes: staleMinutes(store))
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
                if let s = store.summary { MiniBars(values: s.today.roasTrend, height: 12, barWidth: 3.5) }
                Text(headline).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(1)
                Spacer(minLength: DS.Space.s)
                Text(age).font(DS.Font.micro).foregroundStyle(staleMinutes(store) != nil ? DS.Color.warn : DS.Color.inkMuted).lineLimit(1)
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
        return PeekLine.text(s)
    }
    /// How old the reading is ("dados há 2 min"); the click hint shows while there is no reading yet.
    var age: String {
        guard let at = store.lastFetch else { return "clique ou \(HotKey.label)" }
        let r = Format.relative(at)
        return r == "agora" ? "dados de agora" : "dados " + r
    }
}

/// The hover line, most urgent first: what waits for the owner, money being lost, then the day's numbers.
enum PeekLine {
    static func text(_ s: Summary) -> String {
        var parts: [String] = []
        if s.approvals.count > 0 { parts.append("\(s.approvals.count) aguardando você") }
        let losses = s.queue.filter { $0.kind == "loss" }.count
        if losses > 0 { parts.append(Format.count(losses, "perda", "perdas")) }
        parts.append("ROAS hoje \(Format.ratio(s.today.today?.roas))")
        if let p = s.pace, p.status != "nd" { parts.append(Format.pace(p)) }
        let changes = s.activity.summary.values.reduce(0) { $0 + $1.count }
        parts.append(Format.count(changes, "mudança", "mudanças") + " em \(s.activity.hours)h")
        return parts.joined(separator: " · ")
    }
}

/// New approval, loss or manager change: expands by itself for a few seconds.
struct AlertView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let alert: IslandAlert
    var tone: Tone { alert.kind == .sale ? .good : alert.kind == .order ? (alert.id.hasSuffix(":confirmed") ? .good : .bad) : alert.kind == .approval ? .warn : alert.kind == .loss ? .bad : .accent }
    var symbol: String { alert.kind == .sale ? "dollarsign.circle.fill" : alert.kind == .order ? (alert.id.hasSuffix(":confirmed") ? "checkmark.seal.fill" : "exclamationmark.triangle.fill") : alert.kind == .approval ? "checkmark.seal.fill" : alert.kind == .loss ? "arrow.down.right" : "person.crop.circle.badge.exclamationmark" }
    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: notch.geometry.height)
            HStack(alignment: .center, spacing: DS.Space.m) {
                BunkView(mood: alert.kind == .manager ? .watching : alert.kind == .sale || alert.kind == .order && alert.id.hasSuffix(":confirmed") ? .happy : .alert, size: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text(alert.title).font(DS.Font.bodyStrong).foregroundStyle(DS.Color.ink).lineLimit(1)
                    Text(alert.detail).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2).truncationMode(.middle)
                }
                Spacer(minLength: DS.Space.s)
                HStack(spacing: 3) { Text("abrir"); Image(systemName: "chevron.right").font(.system(size: 8.5, weight: .bold)) }
                    .font(DS.Font.bodyStrong).foregroundStyle(tone.color)
                    .padding(.horizontal, 9).padding(.vertical, 4).background(tone.color.opacity(0.14), in: Capsule())
            }
            .padding(.horizontal, DS.Space.l + 6)
            .frame(maxHeight: .infinity)
        }
        .contentShape(Rectangle())
        .onTapGesture { notch.onClick() }
        .contextMenu {
            if alert.kind == .loss, let q = store.summary?.queue.first(where: { "lo:" + $0.id == alert.id }) {
                Button("Dispensar até mudar") { store.dismiss(q); notch.onClose() }
                ForEach(AttentionLedger.Snooze.allCases, id: \.self) { c in Button(c.label) { store.snooze(AttentionLedger.key(q), c); notch.onClose() } }
            } else if alert.kind == .approval {
                ForEach(AttentionLedger.Snooze.allCases, id: \.self) { c in Button(c.label) { store.snooze(AttentionLedger.approvalsKey, c); notch.onClose() } }
            }
        }
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
            if let says = notch.bunkSays { BunkBubble(text: says) }
            if let error = store.error { Banner(text: error, tone: .bad) }
            if let st = store.summary?.storage, st.warning == true, let msg = st.message { Banner(text: msg, tone: st.critical == true ? .bad : .warn) }
            if store.preparing && store.summary == nil { Banner(text: "Resumo em preparação pelo executor. Aparece em 1 a 2 minutos.", tone: .neutral) }
            if notch.webTarget != nil {
                AdjustView()
            } else if let target = notch.adjust {
                OwnerAdjustView(target: target, m: notch.ownerAdjust)
            } else if let s = store.summary, let item = notch.selected {
                // The detail follows each new reading (status, budget, changes); a campaign that left the queue (paused
                // from the notch, or no longer losing) says so instead of showing the old copy as current.
                let current = s.queue.first { $0.id == item.id }
                if current == nil { Banner(text: "Saiu de \"O que fazer agora\" na última leitura (pausada ou sem perda). Os números abaixo são de antes. Esc volta à lista.", tone: .good) }
                CampaignDetailView(s: s, item: current ?? item)
            } else if let s = store.summary {
                // Switching projects: the numbers on screen still belong to the previous one until the new reading lands.
                let switching = s.project != store.project
                if switching { Banner(text: "Lendo o projeto escolhido… os números abaixo ainda são de \(s.projectName).", tone: .neutral) }
                Group {
                KPIStrip(s: s)
                TabBar(s: s)
                ScrollView(.vertical, showsIndicators: false) {
                    Group {
                        switch notch.tab {
                        case .now: NowTab(s: s)
                        case .projects: ProjectsTab(s: s)
                        case .accounts: AccountsTab(s: s)
                        case .managers: ManagersTab(s: s)
                        case .agents: AgentsTab(s: s)
                        case .system: SystemTab(s: s)
                        }
                    }
                    .padding(.bottom, DS.Space.l)
                }
                }
                .opacity(switching ? 0.4 : 1).allowsHitTesting(!switching)
            } else if store.error == nil && !store.preparing {
                HStack(spacing: DS.Space.s) { ProgressView().controlSize(.small); Text("Lendo o Bunker…").font(DS.Font.body).foregroundStyle(DS.Color.inkMuted) }
                    .frame(maxWidth: .infinity, alignment: .center).padding(.top, DS.Space.xl)
            }
        }
        .padding(.horizontal, DS.Space.xl)
        .foregroundStyle(DS.Color.ink)
        // Another project: a campaign detail or a filter from the previous one must not stay on screen.
        .onChange(of: store.project) { _, _ in withAnimation(DS.Motion.quick) { notch.selected = nil; notch.activityFilter = nil } }
    }
}

struct Header: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        HStack(spacing: DS.Space.s) {
            HStack(spacing: 6) {
                BunkAvatar(size: 26)
                Text("BUNK").font(DS.Font.mark).tracking(1.6).foregroundStyle(DS.Color.accent)
            }
            ProjectMenu()
            Spacer(minLength: DS.Space.s)
            HStack(spacing: 6) {
                StatusDot(tone: freshnessTone, size: 6)
                Text(freshness).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            .help(store.summary?.analysisAt.map { "Base de análise: " + Format.stamp($0) } ?? "")
            IconButton(symbol: "arrow.clockwise", help: "Atualizar agora", spinning: store.loading) { Task { await store.refresh() } }
            // Quiet on purpose: each screen keeps a single accent action (e.g. "Ajustar aqui").
            ActionButton(title: "Abrir Bunker", icon: "arrow.up.right", help: "Abrir os cards de decisão no navegador") { store.open("#cards") }
            IconButton(symbol: notch.fixed ? "pin.fill" : "pin",
                       help: notch.fixed ? "Fixado: não fecha ao clicar fora · clique para soltar" : "Fixar aberto (não fecha ao clicar fora nem por inatividade)",
                       active: notch.fixed) { notch.onFix() }
            IconButton(symbol: "xmark", help: "Fechar (Esc) · abrir de novo com \(HotKey.label)") { notch.onClose() }
        }
    }
    /// The dot says how fresh the data is (attention already has its own badges): error, paused or stale reads warn.
    var freshnessTone: Tone {
        if store.error != nil { return .bad }
        if store.summary?.paused == true || store.summary?.executor?.paused == true { return .warn }
        guard let at = store.lastFetch else { return .neutral }
        return Date().timeIntervalSince(at) > 600 ? .warn : .good
    }
    var freshness: String {
        if store.loading && store.summary == nil { return "Atualizando…" }
        guard let at = store.lastFetch else { return "Sem leitura" }
        return "Atualizado " + Format.relative(at)
    }
}

struct IconButton: View {
    let symbol: String; let help: String; var spinning = false; var active = false; let action: () -> Void
    var body: some View {
        Button(action: action) {
            // Reduce Motion: no endless spin; the dimmed icon still says it is working.
            let spin = spinning && !A11y.reduceMotion
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
                .rotationEffect(.degrees(spin ? 360 : 0))
                .animation(spin ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: spin)
                .opacity(spinning && !spin ? 0.5 : 1)
                .frame(width: 24, height: 24)
                .foregroundStyle(active ? DS.Color.accent : DS.Color.inkSoft)
                .background(active ? DS.Color.accent.opacity(0.18) : DS.Color.surface, in: Circle())
                .contentShape(Circle())
        }.buttonStyle(.plain).help(help)
        // VoiceOver reads the purpose, not the symbol name ("arrow.clockwise").
        .accessibilityLabel(help)
    }
}

struct ProjectMenu: View {
    @EnvironmentObject var store: Store
    var body: some View {
        Menu {
            Button { store.project = "all" } label: { menuLabel("Todos os projetos", store.project == "all") }
            Divider()
            ForEach(store.summary?.projects ?? [], id: \.id) { p in Button { store.project = p.id } label: { menuLabel(p.name, store.project == p.id) } }
        } label: {
            HStack(spacing: 5) {
                // The chosen project shows at once; the summary for it arrives a moment later.
                Text(selectedName).font(DS.Font.bodyStrong).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 8.5, weight: .bold)).foregroundStyle(DS.Color.inkMuted)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(DS.Color.surface, in: Capsule())
            .overlay(Capsule().stroke(DS.Color.stroke))
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
    }
    var selectedName: String {
        if store.project == "all" { return "Todos os projetos" }
        return store.summary?.projects.first { $0.id == store.project }?.name ?? store.summary?.projectName ?? "Projeto"
    }
    @ViewBuilder func menuLabel(_ name: String, _ current: Bool) -> some View {
        if current { Label(name, systemImage: "checkmark") } else { Text(name) }
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
            StatTile(label: "ROAS hoje", value: Format.ratio(s.today.today?.roas), yesterday: Format.ratio(s.today.yesterday?.roas), week: Format.ratio(s.today.week?.roas), delta: s.today.deltas["roas"], higherIsBetter: true, spark: s.today.roasTrend)
            StatTile(label: "ROI hoje", value: Format.ratio(s.today.today?.roi), yesterday: Format.ratio(s.today.yesterday?.roi), week: Format.ratio(s.today.week?.roi), delta: s.today.deltas["roi"], higherIsBetter: true)
            StatTile(label: "CPA front hoje", value: Format.money(s.today.today?.cpaFront), yesterday: Format.money(s.today.yesterday?.cpaFront), week: Format.money(s.today.week?.cpaFront), delta: s.today.deltas["cpaFront"], higherIsBetter: false)
            PaceTile(pace: s.pace)
        }
        // Same height for the four tiles, whatever wraps inside one of them.
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct PaceTile: View {
    let pace: Summary.Pace?
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text("Ritmo do orçamento").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            Text(Format.pace(pace).replacingOccurrences(of: "ritmo ", with: "")).font(DS.Font.stat).foregroundStyle(pace?.status == "nd" || pace == nil ? DS.Color.inkMuted : Format.paceTone(pace).color == DS.Color.inkMuted ? DS.Color.ink : Format.paceTone(pace).color)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let e = pace?.elapsedPct, pace?.status != "nd" { Pill(text: "\(Int(e))% do dia", tone: .neutral) } else { Pill(text: "N/D") }
            Text(Format.paceTileBase(pace)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).lineLimit(2).minimumScaleFactor(0.85).fixedSize(horizontal: false, vertical: true)
        }
        .padding(DS.Space.m).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).card()
        .help("Projeção simples: gasto de hoje no ritmo atual contra os orçamentos diários ativos. Não é previsão de vendas nem proposta.")
    }
}

/// One KPI: today's value, then each comparison on its own line with its change right beside it
/// ("ontem 1,31x  ↑8%"), so a change is never read without the period it compares to.
struct StatTile: View {
    let label: String; let value: String; let yesterday: String; let week: String; let delta: Summary.Delta?; let higherIsBetter: Bool
    var spark: [Double?]? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            HStack(alignment: .bottom, spacing: DS.Space.xs) {
                Text(label).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                Spacer(minLength: 0)
                if let spark { MiniBars(values: spark, height: 12, barWidth: 3.5) }
            }
            Text(value).font(DS.Font.stat).lineLimit(1).minimumScaleFactor(0.8)
            VStack(alignment: .leading, spacing: 2) {
                compare("ontem", yesterday, delta?.yesterday)
                compare("7d", week, delta?.week)
            }
        }
        .padding(DS.Space.m).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).card()
        .accessibilityElement(children: .combine)
    }
    func compare(_ period: String, _ base: String, _ change: Double?) -> some View {
        HStack(spacing: 4) {
            Text(period).foregroundStyle(DS.Color.inkMuted)
            Text(base).foregroundStyle(DS.Color.inkSoft).monospacedDigit()
            Spacer(minLength: 2)
            DeltaText(change: change, higherIsBetter: higherIsBetter)
        }
        .font(DS.Font.micro).lineLimit(1).minimumScaleFactor(0.8)
    }
}

/// "↑8%" in green when the move is good, red when bad, grey when flat (under 5%) or N/D.
struct DeltaText: View {
    let change: Double?; let higherIsBetter: Bool
    var body: some View {
        if let change, change.isFinite {
            let flat = abs(change) < 0.05, good = (change > 0) == higherIsBetter
            HStack(spacing: 1) {
                if !flat { Image(systemName: change > 0 ? "arrow.up" : "arrow.down").font(.system(size: 7.5, weight: .bold)) }
                Text(Format.percent((change * 100).rounded(), signed: false)).font(DS.Font.microStrong).monospacedDigit()
            }
            .foregroundStyle(flat ? DS.Color.inkMuted : good ? DS.Color.good : DS.Color.bad)
            .accessibilityLabel((change > 0 ? "subiu " : "caiu ") + Format.percent((change * 100).rounded(), signed: false))
        } else {
            Text("N/D").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
        }
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
                .help("\(tab.rawValue) · tecla \((NotchTab.allCases.firstIndex(of: tab) ?? 0) + 1) (← → trocam de aba)")
                .accessibilityAddTraits(selected ? .isSelected : [])
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
        case .accounts:
            let n = s.accounts?.counts.nearLimit ?? 0
            return n > 0 ? ("\(n)", .bad) : nil
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
    /// Optional third line (the balance strip of the queue).
    var footer: AnyView? = nil
    /// Optional trailing control (a quick action button); only on rows without `action`.
    var accessory: AnyView? = nil
    var body: some View {
        let hovered = notch.hovered == id
        let row = HStack(alignment: .center, spacing: DS.Space.m) {
            IconBadge(symbol: symbol, tone: tone)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(DS.Font.bodyStrong).lineLimit(1).truncationMode(.middle)
                HStack(spacing: DS.Space.xs) {
                    if let tag { Pill(text: tag, tone: .tag) }
                    Text(subtitle).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                }
                if let footer { footer }
            }
            Spacer(minLength: DS.Space.s)
            if let value {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(value).font(DS.Font.number).foregroundStyle(tone.color)
                    if let valueCaption { Text(valueCaption).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted) }
                }
            }
            if let accessory { accessory }
            if action != nil { Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(DS.Color.inkMuted).opacity(hovered ? 1 : 0.35) }
        }
        .padding(.horizontal, DS.Space.s).padding(.vertical, 7)
        .background(hovered ? DS.Color.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
        .contentShape(Rectangle())
        .onHover { inside in withAnimation(DS.Motion.quick) { if inside { notch.hovered = id } else if notch.hovered == id { notch.hovered = nil } } }
        if let action { Button(action: action) { row }.buttonStyle(.plain) } else { row }
    }
}

/// Period ladder under a loss: today, yesterday, 3d, 7d and 7d + hoje side by side, each label over its value, so
/// the manager reads at a glance whether the history covers today's loss. A short verdict leads; the full sentence
/// is in the tooltip and for VoiceOver. Missing windows read N/D.
struct BalanceStrip: View {
    let balance: Summary.Balance
    /// Off when the row already shows today's result on the right (no repeated number).
    var showToday = true
    var body: some View {
        HStack(spacing: DS.Space.s) {
            if let v = Format.balanceVerdictShort(balance.verdict) {
                HStack(spacing: 3) {
                    Image(systemName: v.icon).font(.system(size: 8, weight: .bold))
                    Text(v.text).font(DS.Font.microStrong)
                }
                .foregroundStyle(v.tone.color).lineLimit(1).fixedSize()
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(v.tone.color.opacity(0.12), in: Capsule())
            }
            HStack(spacing: 0) {
                if showToday { cell("hoje", balance.today); divider }
                cell("ontem", balance.yesterday)
                divider; cell("3d", balance.d3)
                divider; cell("7d", balance.d7)
                cell("7d+hoje", balance.with7d, emphasis: true).padding(.leading, 4)
            }
            .fixedSize(horizontal: false, vertical: true)
            .background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel((Format.balanceVerdict(balance.verdict).map { $0.text + ". " } ?? "") + "Saldo: hoje \(Format.balance(balance.today)), ontem \(Format.balance(balance.yesterday)), 3 dias \(Format.balance(balance.d3)), 7 dias \(Format.balance(balance.d7)), 7 dias mais hoje \(Format.balance(balance.with7d))")
        .help((Format.balanceVerdict(balance.verdict).map { $0.text.prefix(1).uppercased() + $0.text.dropFirst() + ". " } ?? "") + "Saldo por período (resultado, ou receita menos mídia sem custos). 7 dias termina ontem; 7d+hoje soma dias diferentes.")
    }
    private var divider: some View { Rectangle().fill(DS.Color.stroke).frame(width: 1).padding(.vertical, 4) }
    private func cell(_ label: String, _ w: Summary.BalanceWindow?, emphasis: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 8.5, weight: .medium)).foregroundStyle(DS.Color.inkMuted)
            Text(Format.balance(w)).font(emphasis ? DS.Font.microStrong : DS.Font.micro).monospacedDigit()
                .foregroundStyle(w == nil ? DS.Color.inkMuted : Format.balanceTone(w).color)
                .fixedSize(horizontal: emphasis, vertical: false)
        }
        .lineLimit(1).minimumScaleFactor(emphasis ? 1 : 0.85)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .layoutPriority(emphasis ? 1 : 0)
        .background(emphasis ? Format.balanceTone(w).color.opacity(w == nil ? 0 : 0.12) : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
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
                HStack(spacing: DS.Space.s) {
                    SectionHeader(title: "Aguardando você", detail: Format.count(s.approvals.count, "proposta exata", "propostas exatas") + " · aprovar com Touch ID")
                    QuietMenu(key: AttentionLedger.approvalsKey, compact: true)
                }
                VStack(spacing: 2) {
                    ForEach(s.approvals.items) { a in
                        ListRow(id: "ap:" + a.id, symbol: "checkmark.seal.fill", tone: .warn, title: a.title ?? "Proposta exata",
                                subtitle: a.expiresAt.map { "vence " + Format.stamp($0) } ?? "conferir e aprovar", tag: showProject ? a.project : nil,
                                value: "Conferir", action: { withAnimation(DS.Motion.quick) { notch.adjust = AdjustTarget(project: nil, adAccountId: nil, campaignId: nil, name: nil) } })
                    }
                }
            }
            if let orders = s.orders, !orders.isEmpty {
                SectionHeader(title: "Suas ordens · 24h", detail: "Touch ID → executor → Malva → releitura")
                VStack(spacing: 2) {
                    ForEach(orders) { o in
                        ListRow(id: "or:" + o.id, symbol: Format.orderSymbols[o.stage] ?? "circle", tone: Format.orderTone(o.stage),
                                title: o.campaign ?? "Campanha", subtitle: Format.orderChange(o) + (o.reason.map { " · " + $0 } ?? ""),
                                tag: Format.queueTag(project: showProject ? o.projectName : nil, account: o.account),
                                value: o.label ?? o.stage, valueCaption: Format.relative(o.confirmedAt ?? o.sentAt ?? o.at))
                    }
                }
            }
            SectionHeader(title: "O que fazer agora", detail: "\(s.queue.count) de \(s.queueSize) na fila · ordenado por dinheiro em jogo")
            if s.queue.isEmpty { EmptyLine(text: "Nada pedindo ação agora.") }
            VStack(spacing: 2) {
                ForEach(s.queue) { q in
                    let loss = q.kind == "loss", quiet = store.isQuiet(q)
                    HStack(spacing: DS.Space.xs) {
                    ListRow(id: "q:" + q.id, symbol: loss ? "arrow.down.right" : "arrow.up.right", tone: quiet ? .neutral : loss ? .bad : .good,
                            title: q.campaign ?? "Campanha",
                            subtitle: "\(q.period == "today" ? "Hoje" : "3 dias"): gasto \(Format.money(q.spend)) · ROAS \(Format.ratio(q.roas)) · 7d \(Format.ratio(q.roas7d))",
                            tag: Format.queueTag(project: showProject ? q.project : nil, account: q.account),
                            value: (loss ? "−" : "+") + Format.money(q.amount),
                            valueCaption: loss ? (q.basis == "result" ? (q.period == "today" ? "prejuízo hoje" : "prejuízo em 3 dias") : "receita abaixo da mídia") : "resultado em 3 dias",
                            action: { withAnimation(DS.Motion.quick) { notch.selected = q } },
                            footer: q.balance.flatMap { $0.hasAny ? AnyView(BalanceStrip(balance: $0, showToday: q.period != "today")) : nil })
                        .opacity(quiet ? 0.55 : 1)
                    if loss || quiet { QuietMenu(key: AttentionLedger.key(q), item: q, compact: true) }
                    }
                }
            }
            if let f = s.first24h, f.counts.firstDay + f.counts.secondDay + f.counts.scheduled > 0 {
                SectionHeader(title: "Primeiras 24h", detail: "\(f.counts.firstDay) no 1º dia · \(f.counts.secondDay) no 2º · \(Format.count(f.counts.scheduled, "programada", "programadas")) · teto \(Format.money(f.ceiling ?? 110)) com até 1 IC")
                VStack(spacing: 2) {
                    ForEach(f.items.prefix(6)) { item in
                        ListRow(id: "f24:" + item.id, symbol: item.level == "sold" ? "checkmark.seal.fill" : item.level == "over" || item.level == "pause" ? "exclamationmark.octagon.fill" : "clock.badge",
                                tone: Format.first24hTone(item.level),
                                title: item.campaign ?? "Campanha",
                                subtitle: Format.first24hLine(item),
                                tag: Format.queueTag(project: showProject ? item.projectName : nil, account: item.account),
                                value: Format.money(item.spend), valueCaption: Format.first24hLevel(item.level))
                    }
                    ForEach(f.scheduled.prefix(3)) { item in
                        ListRow(id: "f24s:" + item.id, symbol: "calendar", tone: .neutral,
                                title: item.campaign ?? "Campanha",
                                subtitle: "Programada · começa \(item.startsOn ?? "em breve")",
                                tag: Format.queueTag(project: showProject ? item.project : nil, account: item.account))
                    }
                }
            }
            if let sh = s.shadow, sh.total > 0 {
                let would = sh.byRule.values.reduce(0) { $0 + $1.wouldExecute }, first = sh.byRule.values.reduce(0) { $0 + $1.bunkerFirst }
                SectionHeader(title: "Sombra do Bunk · hoje", detail: "\(would) executaria · \(first) antes do gestor · não executa nada")
                if let sc = sh.scorecard, sc.graded > 0 {
                    // Did the would-be action fit what happened the next day? (nothing was executed)
                    Text(Format.shadowScore(sc)).font(DS.Font.caption).foregroundStyle(sc.right * 10 >= sc.graded * 6 ? DS.Color.good : DS.Color.warn)
                        .help("Cada decisão da sombra é conferida pelo resultado real do dia seguinte: corte acerta se o dia seguinte deu prejuízo; aumento acerta se deu lucro. Campanha que parou não entra.")
                }
                VStack(spacing: 2) {
                    ForEach(sh.recent.prefix(5)) { item in
                        ListRow(id: "sh:" + item.id, symbol: item.action == "status" ? "pause.fill" : "dollarsign.circle", tone: item.manager != nil || item.owner != nil ? .good : (item.wouldExecute == true ? .warn : .neutral),
                                title: item.campaign ?? "Campanha",
                                subtitle: Format.shadowChange(item) + " · " + (item.ruleLabel ?? item.rule ?? ""),
                                tag: Format.queueTag(project: showProject ? item.project : nil, account: item.account),
                                value: Format.stamp(item.firstAt), valueCaption: Format.shadowOutcome(item),
                                accessory: AdjustPreset.from(item).map { preset in AnyView(ShadowActionButton(item: item, preset: preset)) })
                    }
                }
            }
        }
    }
}

/// Opens the owner's order for this campaign with the Bunk's anticipated move already chosen. Nothing runs here:
/// the adjust view shows the live value and blockers, and "Executar agora" still asks Touch ID for the exact change.
struct ShadowActionButton: View {
    @EnvironmentObject var notch: NotchState
    let item: Summary.ShadowItem; let preset: AdjustPreset
    var body: some View {
        let tone: Tone = preset.action == "increase" ? .good : .bad
        Button {
            withAnimation(DS.Motion.quick) {
                notch.adjust = AdjustTarget(project: item.projectId, adAccountId: item.adAccountId, campaignId: item.objectId, name: item.campaign, preset: preset)
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: OwnerAdjust.symbols[preset.action] ?? "slider.horizontal.3").font(.system(size: 9, weight: .bold))
                Text(preset.label).font(DS.Font.microStrong).lineLimit(1)
            }
            .fixedSize()
            .padding(.horizontal, 8).padding(.vertical, 4)
            .foregroundStyle(tone.color)
            .background(tone.color.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.35)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help("Abre sua ordem com \(preset.label.lowercased()) já escolhido. Você confere o valor ao vivo e confirma com Touch ID em \"Executar agora\".")
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
            SectionHeader(title: notch.activityFilter.map { (Format.actionLabels[$0] ?? $0) + " recentes" } ?? "Mais recentes", detail: Format.count(list.count, "registro", "registros") + " no resumo")
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
                    ForEach(people.prefix(2), id: \.key) { p in Text("\(p.key) · \(p.value)").font(DS.Font.micro).foregroundStyle(DS.Color.inkSoft).lineLimit(1) }
                    if let u = b?.unknown, u > 0 { Text("\(u) sem autor").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted) }
                    if count == 0 { Text("nenhuma").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted) }
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
                                if s.project == "all", let p = m.project { Pill(text: p, tone: .tag) }
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

/// Account planning without a manual board: status, project, today's spend vs the Meta daily limit. Read-only.
struct AccountsTab: View {
    @EnvironmentObject var notch: NotchState
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            if let a = s.accounts {
                HStack(spacing: DS.Space.s) {
                    SectionHeader(title: "Contas de anúncio", detail: "\(a.counts.active) ativas · \(a.counts.running) rodando · \(a.counts.nearLimit) perto do limite · atualiza a cada 30 min")
                    if a.counts.nearLimit > 0 { QuietMenu(key: AttentionLedger.limitKey, compact: true) }
                }
                if !a.metaConnected { EmptyLine(text: Format.accountsMetaNotice(a.metaError)) }
                if !a.rows.isEmpty {
                    TextField("Buscar conta por nome ou ID", text: $notch.accountQuery).textFieldStyle(.island)
                }
                let rows = a.rows.filter { Format.accountMatches($0, notch.accountQuery) }
                if a.rows.isEmpty { EmptyLine(text: "Nenhuma conta ativa ou com alerta.") }
                else if rows.isEmpty { EmptyLine(text: "Nenhuma conta com “\(notch.accountQuery.trimmingCharacters(in: .whitespaces))”.") }
                VStack(spacing: 2) {
                    ForEach(rows) { r in
                        let near = (r.usedPct ?? 0) >= 80, bad = r.status != "active"
                        ListRow(id: "acc:" + r.accountId, symbol: bad ? "exclamationmark.triangle.fill" : (near ? "gauge.high" : "creditcard"), tone: bad || near ? .bad : .neutral,
                                title: r.name ?? r.accountId,
                                subtitle: ([r.runningLabel] + (r.alerts ?? [])).compactMap { $0 }.joined(separator: " · "),
                                tag: r.group,
                                value: Format.accountUse(r), valueCaption: Format.accountLimit(r))
                    }
                }
            } else {
                EmptyLine(text: "O painel de contas ainda está sendo montado.")
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
                    Pill(text: (e.recentFailures == 0 ? "nenhuma falha" : Format.count(e.recentFailures, "falha", "falhas")) + " na última hora", tone: e.recentFailures > 0 ? .warn : .neutral)
                    Spacer()
                    Text("último pulso " + Format.relative(e.lastPulseAt)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                }.padding(DS.Space.m).card()
            } else { EmptyLine(text: "Status do executor indisponível nesta leitura.") }
            SectionHeader(title: "Dados")
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text("Base de análise: " + (s.analysisAt.map(Format.stamp) ?? "N/D")).font(DS.Font.body)
                Text("Resumo gerado " + Format.relative(s.generatedAt) + " · atualiza a cada 1 min com a ilha aberta, 2 min recolhida; espera mais após falhas e para com a tela bloqueada").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                if s.paused { Pill(text: "Escritório pausado", tone: .warn) }
            }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
            SectionHeader(title: "Avisos", detail: store.muted ? "silenciados até " + Format.stamp(Format.isoFull.string(from: store.mutedUntil!)) : "ativos no notch e no macOS")
            HStack(spacing: DS.Space.s) {
                if store.muted { ActionButton(title: "Reativar avisos", icon: "bell", leadingIcon: true, prominent: true, help: "Volta a mostrar avisos no notch e no macOS.") { store.unmute() } }
                else {
                    ActionButton(title: "Silenciar 1 hora", icon: "moon", leadingIcon: true, help: "Pausa avisos e notificações por uma hora; as listas continuam atualizando.") { store.mute(hours: 1) }
                    ActionButton(title: "Até amanhã às 8h", icon: "moon.zzz", leadingIcon: true, help: "Pausa avisos até amanhã às 8h.") { store.muteUntilTomorrow() }
                }
            }
            CallQuietRow()
            let quieted = store.ledger.dismissed.count + store.ledger.snoozed.values.filter { $0 > Date().timeIntervalSince1970 }.count
            if quieted > 0 {
                HStack(spacing: DS.Space.s) {
                    Text(Format.count(quieted, "item dispensado ou adiado", "itens dispensados ou adiados")).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                    ActionButton(title: "Voltar a avisar tudo", icon: "bell.badge", leadingIcon: true, help: "Desfaz os itens dispensados e adiados.") { store.restoreAll() }
                }
            }
            Text(s.notice).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
        }
    }
}

/// "Silêncio em reunião": with the camera or microphone in use, Bunk stays home and alerts wait.
struct CallQuietRow: View {
    @ObservedObject var call = CallWatch.shared
    var body: some View {
        HStack(spacing: DS.Space.s) {
            Toggle("Silêncio em reunião (câmera ou microfone em uso)", isOn: $call.enabled)
                .toggleStyle(.switch).controlSize(.mini).font(DS.Font.caption)
            if call.inCall { Pill(text: "em reunião agora", tone: .accent) }
            Spacer(minLength: 0)
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
                                    if p.losses > 0 { Pill(text: Format.count(p.losses, "perda", "perdas"), tone: .bad) }
                                }
                                Text("gasto \(Format.money(p.spend)) · ROI \(Format.ratio(p.roi)) · \(Format.count(p.changes, "mudança", "mudanças")) em 24h").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                                if let pace = s.pace?.byProject?.first(where: { $0.project == p.id }), pace.status != "nd" {
                                    HStack(spacing: DS.Space.xs) {
                                        Pill(text: Format.pace(pace), tone: pace.alert != nil ? .warn : Format.paceTone(pace), icon: pace.alert == "early" ? "hourglass" : pace.alert == "under" ? "tortoise" : "gauge.medium")
                                        Text(Format.paceBase(pace)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                                    }
                                }
                            }
                            Spacer(minLength: DS.Space.s)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(Format.ratio(p.roas)).font(DS.Font.number).foregroundStyle(trend.color)
                                Text("ontem " + Format.ratio(p.roasYesterday)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
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
                        if let p = item.project { Pill(text: p, tone: .tag) }
                        Pill(text: Format.statusName(item.detail?.status), tone: item.detail?.status == "ACTIVE" ? .good : .neutral)
                        Text("diário " + Format.money(item.detail?.dailyBudget, currency: item.detail?.budgetCurrency)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                    }
                }
                Spacer()
                Button { withAnimation(DS.Motion.quick) { notch.adjust = AdjustTarget(project: item.detail?.projectId, adAccountId: item.adAccountId, campaignId: item.campaignId, name: item.campaign) } } label: {
                    HStack(spacing: 5) { Image(systemName: "slider.horizontal.3").font(.system(size: 10, weight: .bold)); Text("Ajustar aqui").font(DS.Font.bodyStrong) }
                        .padding(.horizontal, 10).padding(.vertical, 5).foregroundStyle(.black.opacity(0.85)).background(DS.Color.accent, in: Capsule())
                }.buttonStyle(.plain).help("Pausar, reduzir ou aumentar aqui, confirmando com Touch ID")
                QuietMenu(key: AttentionLedger.key(item), item: item, compact: true)
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
                                HStack(spacing: 4) {
                                    Text(label).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                                    Spacer(minLength: 0)
                                    if w?.noSpend != true { Text("ROAS").font(DS.Font.microStrong).foregroundStyle(DS.Color.inkMuted) }
                                }
                                if w?.noSpend == true {
                                    Text("sem gasto").font(DS.Font.stat).foregroundStyle(DS.Color.inkMuted).lineLimit(1).minimumScaleFactor(0.6)
                                        .help("Fonte completa do período sem esta campanha: não houve gasto. Vendas ficam N/D.")
                                } else {
                                    Text(Format.ratio(w?.roas)).font(DS.Font.stat).foregroundStyle((w?.roi ?? 1) >= 1 ? DS.Color.ink : DS.Color.bad)
                                }
                                if w?.noSpend == true {
                                    // "sem gasto" already says the spend; only what stays unknown is listed.
                                    Text("vendas N/D").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                                } else {
                                    if let b = item.balance?.window(key) { Text("saldo " + Format.balance(b)).font(DS.Font.microStrong).foregroundStyle(Format.balanceTone(b).color) }
                                    Text("ROI " + Format.ratio(w?.roi)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                                    Text("gasto " + Format.compactMoney(w?.spend)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                                    Text("front \(w?.frontOrders.map { String(Int($0)) } ?? "N/D")").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                                }
                            }.padding(DS.Space.m).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).card()
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    if let b = item.balance, b.with7d != nil || b.verdict != nil {
                        HStack(spacing: DS.Space.s) {
                            Image(systemName: b.verdict == "recovers" ? "exclamationmark.triangle.fill" : "sum").foregroundStyle((Format.balanceVerdict(b.verdict)?.tone ?? .neutral).color)
                            Text("7 dias + hoje: " + Format.balance(b.with7d)).font(DS.Font.bodyStrong).foregroundStyle(Format.balanceTone(b.with7d).color)
                            if let v = Format.balanceVerdict(b.verdict) { Text("· " + v.text).font(DS.Font.caption).foregroundStyle(v.tone.color) }
                            Spacer(minLength: 0)
                        }
                        .padding(DS.Space.m).card()
                        .help("Hoje continua em destaque; a soma mostra se o histórico cobre o dia. A decisão é do gestor.")
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
                    Text("Ajustar aqui: execute sua ordem com Touch ID (o executor aplica uma vez pela Malva e confere) ou peça à equipe uma proposta exata.").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
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
                        TextField("Cole aqui o link do e-mail do Bunker", text: $notch.pastedLink).textFieldStyle(.island)
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
                .font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).padding(.bottom, DS.Space.s)
        }
    }
}
