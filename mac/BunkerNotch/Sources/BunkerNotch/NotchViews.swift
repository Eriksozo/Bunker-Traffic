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
                // A faint rim on the lower edges when the island floats over the desktop; the resting notch stays pure black.
                if notch.mode != .compact {
                    IslandShape(top: radii.top, bottom: radii.bottom).stroke(DS.Color.rim, lineWidth: DS.Size.hairline)
                        .mask(LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.35)))
                        .allowsHitTesting(false)
                }
                switch notch.mode {
                case .open: ExpandedView().padding(.top, notch.geometry.height + DS.Space.s).transition(.pour)
                case .alert(let alert): AlertView(alert: alert).transition(.opacity)
                case .peek: PeekView().transition(.opacity)
                case .compact: CollapsedView().transition(.opacity)
                }
            }
            .frame(width: notch.islandSize.width, height: notch.islandSize.height)
            // Depth grows with the island: none at rest (it is the bezel), soft when peeking, deep when open.
            .shadow(color: .black.opacity(DS.Elevation.island(notch.mode).opacity), radius: DS.Elevation.island(notch.mode).radius, y: DS.Elevation.island(notch.mode).y)
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
                if store.muted { Image(systemName: "moon.fill").font(DS.Icon.s).foregroundStyle(DS.Color.inkMuted).help("Avisos silenciados") }
            }.frame(width: NotchState.earWidth)
            Spacer(minLength: notch.geometry.width)
            Text(current?.text ?? (store.preparing ? "preparando" : "…")).font(DS.Font.ticker)
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
                StatusDot(tone: healthTone(store), size: DS.Size.dotSmall, pulse: store.error != nil)
                if let s = store.summary { MiniBars(values: s.today.roasTrend, height: 12, barWidth: 3.5) }
                Text(headline).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(1).minimumScaleFactor(0.88).help(headline)
                Spacer(minLength: DS.Space.s)
                Text(age).font(DS.Font.micro).foregroundStyle(staleMinutes(store) != nil ? DS.Color.warn : DS.Color.inkMuted).lineLimit(1)
            }
            .padding(.horizontal, DS.Space.l).frame(height: DS.Size.peekRow)
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
                    // A soft glow in the alert's colour says what kind of news this is before the text is read.
                    .background(Circle().fill(tone.color.opacity(0.22)).frame(width: 40, height: 40).blur(radius: A11y.reduceTransparency ? 0 : 14))
                VStack(alignment: .leading, spacing: 3) {
                    Text(alert.title).font(DS.Font.bodyStrong).foregroundStyle(DS.Color.ink).lineLimit(1)
                    Text(alert.detail).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2).truncationMode(.middle)
                }
                Spacer(minLength: DS.Space.s)
                TintChip(text: "abrir", icon: symbol, trailingIcon: "chevron.right", tone: tone, font: DS.Font.bodyStrong)
            }
            .padding(.horizontal, DS.Space.xxl)
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
                        case .autonomy: AutonomyTab(s: s)
                        case .projects: ProjectsTab(s: s)
                        case .accounts: AccountsTab(s: s)
                        case .managers: ManagersTab(s: s)
                        case .agents: AgentsTab(s: s)
                        case .system: SystemTab(s: s)
                        case .days: DaysTab(s: s)
                        }
                    }
                    .padding(.bottom, DS.Space.l)
                }
                .scrollEdgeFade()
                }
                .opacity(switching ? DS.Opacity.switching : 1).allowsHitTesting(!switching)
            } else if store.error == nil && !store.preparing {
                LoadingSkeleton()
            }
        }
        .padding(.horizontal, DS.Space.xl)
        .foregroundStyle(DS.Color.ink)
        // Another project: a campaign detail or a filter from the previous one must not stay on screen.
        .onChange(of: store.project) { _, _ in withAnimation(DS.Motion.quick) { notch.selected = nil; notch.activityFilter = nil } }
    }
}

/// First load: the shape of the KPI strip, tabs and rows instead of a lone spinner, so the island never looks empty.
struct LoadingSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            HStack(spacing: DS.Space.s) {
                ForEach(0..<4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: DS.Space.s) {
                        SkeletonBlock(width: 60, height: 9)
                        SkeletonBlock(width: 84, height: 18)
                        SkeletonBlock(width: 100, height: 8)
                        SkeletonBlock(width: 76, height: 8)
                    }
                    .padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
                }
            }
            SkeletonBlock(height: 30).clipShape(Capsule())
            ForEach(0..<4, id: \.self) { _ in
                HStack(spacing: DS.Space.m) {
                    SkeletonBlock(width: DS.Size.badge, height: DS.Size.badge)
                    VStack(alignment: .leading, spacing: 6) { SkeletonBlock(width: 240, height: 10); SkeletonBlock(width: 320, height: 8) }
                    Spacer(minLength: 0)
                    SkeletonBlock(width: 64, height: 12)
                }
                .padding(DS.Inset.row)
            }
            HStack(spacing: DS.Space.s) { ProgressView().controlSize(.small); Text("Lendo o Bunker…").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted) }
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Lendo o Bunker")
    }
}

struct Header: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        HStack(spacing: DS.Space.s) {
            HStack(spacing: 6) {
                BunkAvatar(size: 26)
                Text("BUNK").font(DS.Font.mark).tracking(1.6)
                    .foregroundStyle(LinearGradient(colors: [DS.Color.accent, Tone.accent.rgba(true).color], startPoint: .leading, endPoint: .trailing))
                    .accessibilityLabel("Bunk")
            }
            ProjectMenu()
            Spacer(minLength: DS.Space.s)
            HStack(spacing: 6) {
                StatusDot(tone: freshnessTone, size: DS.Size.dotSmall, pulse: freshnessTone == .bad || freshnessTone == .warn)
                Text(freshness).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            .help(Format.dataSources(store.summary))
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
                Image(systemName: "chevron.down").font(DS.Icon.xs).foregroundStyle(DS.Color.inkMuted)
            }
            .padding(DS.Inset.control)
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
            Text(Format.pace(pace).replacingOccurrences(of: "ritmo ", with: "")).font(DS.Font.stat).numericTransition(Format.pace(pace)).foregroundStyle(pace?.status == "nd" || pace == nil ? DS.Color.inkMuted : Format.paceTone(pace).color == DS.Color.inkMuted ? DS.Color.ink : Format.paceTone(pace).color)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let e = pace?.elapsedPct, pace?.status != "nd" { Pill(text: "\(Int(e))% do dia", tone: .neutral) } else { Pill(text: "N/D") }
            Text(Format.paceTileBase(pace)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).lineLimit(3).minimumScaleFactor(0.9).fixedSize(horizontal: false, vertical: true)
        }
        .padding(DS.Space.m).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).card()
        .accessibilityElement(children: .combine)
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
            Text(value).font(DS.Font.stat).lineLimit(1).minimumScaleFactor(0.8).numericTransition(value)
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
                if !flat { Image(systemName: change > 0 ? "arrow.up" : "arrow.down").font(DS.Icon.xxs) }
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

/// How tight the tab bar is drawn. Eight tabs since the Autonomia tab: the roomiest density whose labels stay on one
/// line wins (ViewThatFits); the last one may shrink the text instead of wrapping it.
struct TabBarDensity: Equatable {
    let inset: CGFloat; let spacing: CGFloat
    /// Neutral count badges (Gestores, Agentes) give way first; the ones that ask for the owner always stay.
    let neutralBadges: Bool
    let shrink: Bool
    static let all = [TabBarDensity(inset: 10, spacing: 4, neutralBadges: true, shrink: false), TabBarDensity(inset: 8, spacing: 3, neutralBadges: true, shrink: false),
                      TabBarDensity(inset: 6, spacing: 2, neutralBadges: true, shrink: false), TabBarDensity(inset: 5, spacing: 1, neutralBadges: true, shrink: false),
                      TabBarDensity(inset: 5, spacing: 1, neutralBadges: false, shrink: false),
                      TabBarDensity(inset: 4, spacing: 0, neutralBadges: false, shrink: true)]
    func shows(_ tone: Tone) -> Bool { neutralBadges || tone != .neutral }
}

struct TabBar: View {
    @EnvironmentObject var notch: NotchState
    @Namespace private var indicator
    let s: Summary
    var body: some View {
        ViewThatFits(in: .horizontal) {
            ForEach(Array(TabBarDensity.all.enumerated()), id: \.offset) { i, d in bar(d, variant: i) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(3)
        .background(DS.Color.surface, in: Capsule())
    }
    func bar(_ d: TabBarDensity, variant: Int) -> some View {
        HStack(spacing: d.spacing) {
            ForEach(NotchTab.allCases, id: \.self) { tab in
                let selected = notch.tab == tab
                Button { withAnimation(DS.Motion.select) { notch.tab = tab } } label: {
                    HStack(spacing: 5) {
                        Text(tab.rawValue).font(DS.Font.bodyStrong).lineLimit(1).minimumScaleFactor(d.shrink ? 0.8 : 1).fixedSize(horizontal: !d.shrink, vertical: false)
                        if let badge = badge(tab), d.shows(badge.1) { Pill(text: badge.0, tone: badge.1).fixedSize() }
                    }
                    .padding(EdgeInsets(top: DS.Inset.tab.top, leading: d.inset, bottom: DS.Inset.tab.bottom, trailing: d.inset))
                    .foregroundStyle(selected ? DS.Color.ink : notch.hovered == "tab:" + tab.rawValue ? DS.Color.inkSoft : DS.Color.inkMuted)
                    // One indicator that slides between tabs instead of blinking in and out.
                    .background {
                        if selected {
                            Capsule().fill(DS.Color.surfaceSelected)
                                .overlay(Capsule().strokeBorder(LinearGradient(colors: [DS.Color.highlight, .clear], startPoint: .top, endPoint: .bottom)))
                                .matchedGeometryEffect(id: "tab:\(variant)", in: indicator)
                        } else if notch.hovered == "tab:" + tab.rawValue {
                            Capsule().fill(DS.Color.surface)
                        }
                    }
                    .contentShape(Capsule())
                }.buttonStyle(.pressable)
                .onHover { inside in withAnimation(DS.Motion.hover) { if inside { notch.hovered = "tab:" + tab.rawValue } else if notch.hovered == "tab:" + tab.rawValue { notch.hovered = nil } } }
                .help("\(tab.rawValue) · tecla \((NotchTab.allCases.firstIndex(of: tab) ?? 0) + 1) (← → trocam de aba)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
    func badge(_ tab: NotchTab) -> (String, Tone)? {
        switch tab {
        case .now:
            let n = s.approvals.count + s.queue.filter { $0.kind == "loss" }.count
            return n > 0 ? ("\(n)", s.approvals.count > 0 ? .warn : .bad) : nil
        case .autonomy:
            // Open requests of the level Confirmar: what waits for the owner in this tab.
            let n = s.autonomy.map(AutonomyText.asksCount) ?? 0
            return n > 0 ? ("\(n)", .warn) : nil
        case .managers:
            let n = s.activity.summary.values.reduce(0) { $0 + $1.count }
            return n > 0 ? ("\(n)", .neutral) : nil
        case .accounts:
            let n = s.accounts?.counts.nearLimit ?? 0
            return n > 0 ? ("\(n)", .bad) : nil
        case .projects:
            let n = (s.board ?? []).reduce(0) { $0 + $1.approvals }
            return n > 0 ? ("\(n)", .warn) : nil
        case .days: return nil
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
            if action != nil { Image(systemName: "chevron.right").font(DS.Icon.s).foregroundStyle(DS.Color.inkMuted).opacity(hovered ? 1 : DS.Opacity.restingHint).offset(x: hovered && !A11y.reduceMotion ? 2 : 0) }
        }
        .padding(DS.Inset.row)
        .background(hovered ? DS.Color.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
        .help(title + "\n" + subtitle)
        .contentShape(Rectangle())
        .onHover { inside in withAnimation(DS.Motion.quick) { if inside { notch.hovered = id } else if notch.hovered == id { notch.hovered = nil } } }
        if let action { Button(action: action) { row }.buttonStyle(PressableStyle(scale: 0.99)) }
        else if accessory == nil { row.accessibilityElement(children: .combine) } else { row }
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
                    Image(systemName: v.icon).font(DS.Icon.xs)
                    Text(v.text).font(DS.Font.microStrong)
                }
                .foregroundStyle(v.tone.color).lineLimit(1).fixedSize()
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(v.tone.fill, in: Capsule())
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
    private var divider: some View { Rectangle().fill(DS.Color.stroke).frame(width: DS.Size.hairline).padding(.vertical, DS.Space.xs) }
    private func cell(_ label: String, _ w: Summary.BalanceWindow?, emphasis: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
            Text(Format.balance(w)).font(emphasis ? DS.Font.microStrong : DS.Font.micro).monospacedDigit()
                .foregroundStyle(w == nil ? DS.Color.inkMuted : Format.balanceTone(w).color)
                .fixedSize(horizontal: emphasis, vertical: false)
        }
        .lineLimit(1).minimumScaleFactor(emphasis ? 1 : 0.85)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .layoutPriority(emphasis ? 1 : 0)
        .background(emphasis && w != nil ? Format.balanceTone(w).fill : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
    }
}

struct NowTab: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let s: Summary
    var showProject: Bool { s.project == "all" }
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            if let a = s.autonomy, AutonomyText.asksCount(a) > 0 {
                // The requests themselves live in the Autonomia tab (owner request of 12/11/2026); one line here so a request is never missed.
                ListRow(id: "ask:pointer", symbol: "hand.raised.fill", tone: .warn, title: "Bunk pede a você",
                        subtitle: Format.count(AutonomyText.asksCount(a), "pedido", "pedidos") + " no nível Confirmar · ver na aba Autonomia",
                        value: "\(AutonomyText.asksCount(a))", valueCaption: "Autonomia",
                        action: { withAnimation(DS.Motion.quick) { notch.tab = .autonomy } })
            }
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
            // The Bunk's own orders (level Automático) are listed in the Autonomia tab; here only the owner's.
            if let orders = s.orders?.filter({ !$0.isBunk }), !orders.isEmpty {
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
                        .opacity(quiet ? DS.Opacity.quiet : 1)
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
        }
    }
}

/// Opens the owner's order for this campaign with the Bunk's anticipated move already chosen. Nothing runs here:
/// the adjust view shows the live value and blockers, and "Executar agora" still asks Touch ID for the exact change.
struct ShadowActionButton: View {
    @EnvironmentObject var notch: NotchState
    let item: Summary.ShadowItem; let preset: AdjustPreset
    /// Chip text from `label(mode:preset:)`; nil keeps the preset's own label (older server, unknown mode).
    var label: String? = nil
    var body: some View {
        let tone: Tone = preset.action == "increase" ? .good : .bad
        Button {
            withAnimation(DS.Motion.quick) {
                notch.adjust = AdjustTarget(project: item.projectId, adAccountId: item.adAccountId, campaignId: item.objectId, name: item.campaign, preset: preset)
            }
        } label: {
            TintChip(text: label ?? preset.label, icon: OwnerAdjust.symbols[preset.action] ?? "slider.horizontal.3", tone: tone, outlined: true)
        }
        .buttonStyle(.pressable)
        .help("Abre sua ordem com \(preset.label.lowercased()) já escolhido. Você confere o valor ao vivo e confirma com Touch ID em \"Executar agora\". O Bunk não envia nada por este botão.")
    }
    /// Contract b.3 on the campaign's effective mode: hidden (nil) only when it is exactly "off" (Desligado: the Bunk
    /// neither acts nor suggests); "Fazer eu mesmo" in Sombra, Confirmar and Automático; any other value or no
    /// autonomy block (older server) keeps today's button.
    static func label(mode: String?, preset: AdjustPreset) -> String? {
        switch mode {
        case "off": return nil
        case "shadow", "confirm", "auto": return "Fazer eu mesmo"
        default: return preset.label
        }
    }
}

/// Island row of the Autonomia v2 block: "Bunk · observando · John, Gabe · concordância 74%" and today's counts.
/// Reading only: in this phase a learned play never sends anything.
struct AutonomyIslandRow: View {
    let autonomy: Summary.Autonomy
    var body: some View {
        let observing = AutonomyText.observing(autonomy)
        ListRow(id: "autonomy:island", symbol: observing.isEmpty ? "moon.zzz" : "eye", tone: observing.isEmpty ? .neutral : .accent,
                title: AutonomyText.islandLine(autonomy), subtitle: AutonomyText.todayLine(autonomy.projects) ?? AutonomyText.quietLine(autonomy))
            .help(autonomy.enabled
                  ? "Nível por projeto salvo pelo dono no painel Autonomia. Jogadas aprendidas com a equipe só observam nesta fase: nada é enviado por elas."
                  : "Interruptor geral desligado: o Bunk não envia nada sozinho, só observa e aprende. Ligar é só do dono, no painel Autonomia.")
    }
}

/// Pure text for the autonomy block, shared by the views and the self-test. N/D stays N/D, never 0%.
enum AutonomyText {
    /// 0–1 fraction as a whole percent; nil (or no case behind it) is N/D.
    static func percent(_ value: Double?, n: Int? = nil) -> String {
        guard let value, value.isFinite, n != 0 else { return "N/D" }
        return "\(Int((value * 100).rounded()))%"
    }
    static func observing(_ a: Summary.Autonomy) -> [String] {
        if let names = a.island?.observing, !names.isEmpty { return names }
        return a.projects.filter { $0.mode != nil && $0.mode != "off" }.map { $0.name ?? $0.id }
    }
    /// What the Bunk may do at most in the observed projects: sending needs the general switch on.
    static func stateWord(_ a: Summary.Autonomy) -> String {
        let modes = Set(a.projects.compactMap(\.mode))
        guard a.enabled else { return "observando" }
        if modes.contains("auto") { return "pode enviar" }
        if modes.contains("confirm") || !a.asks.isEmpty { return "pode pedir" }
        return "observando"
    }
    static func islandLine(_ a: Summary.Autonomy) -> String {
        let names = observing(a)
        guard !names.isEmpty else { return "Bunk · desligado" + (a.projects.isEmpty ? "" : " nos projetos") }
        var parts = ["Bunk", stateWord(a), names.prefix(3).joined(separator: ", ") + (names.count > 3 ? " +\(names.count - 3)" : "")]
        if let i = a.island, i.agreement != nil, i.n != 0 { parts.append("concordância " + percent(i.agreement, n: i.n)) }
        return parts.joined(separator: " · ")
    }
    /// Today's fixed-rule decisions summed over the projects; nil when any project lacks the count (no partial sum).
    static func todayLine(_ projects: [Summary.AutonomyProject]) -> String? {
        guard !projects.isEmpty else { return nil }
        let todays = projects.compactMap(\.today)
        guard todays.count == projects.count else { return nil }
        func sum(_ k: KeyPath<Summary.AutonomyToday, Int?>) -> Int? {
            let v = todays.map { $0[keyPath: k] }
            return v.contains(where: { $0 == nil }) ? nil : v.reduce(0) { $0 + ($1 ?? 0) }
        }
        guard let total = sum(\.decisions) else { return nil }
        if total == 0 { return "Hoje: nenhuma decisão da Sombra ainda" }
        var parts: [String] = []
        if let n = sum(\.enviaria), n > 0 { parts.append("\(n) enviaria") }
        if let n = sum(\.pediria), n > 0 { parts.append("\(n) pediria a você") }
        if let n = sum(\.soSugestao), n > 0 { parts.append("\(n) só sugestão") }
        if let n = sum(\.segurada), n > 0 { parts.append(Format.count(n, "segurada", "seguradas")) }
        if let n = sum(\.ordersCreated), n > 0 { parts.append(Format.count(n, "ordem do Bunk", "ordens do Bunk") + (sum(\.ordersConfirmed).map { " (\($0) confirmada\($0 == 1 ? "" : "s"))" } ?? "")) }
        return "Hoje: " + Format.count(total, "decisão", "decisões") + (parts.isEmpty ? "" : " · " + parts.joined(separator: " · "))
    }
    static func quietLine(_ a: Summary.Autonomy) -> String {
        a.enabled ? "Jogadas da equipe só observam nesta fase" : "Interruptor geral desligado · o Bunk só observa e aprende"
    }
    static func stage(_ value: String?) -> String {
        switch value {
        case "observando": return "observando"
        case "candidata": return "candidata"
        case "sombra": return "na Sombra"
        case "pode-pedir": return "pode pedir"
        case "pode-enviar": return "pode enviar"
        default: return "estágio N/D"
        }
    }
    static func stageTone(_ value: String?) -> Tone {
        switch value { case "candidata", "sombra": return .accent; case "pode-pedir", "pode-enviar": return .good; default: return .neutral }
    }
    /// "candidata · concorda 74% em 12 casos" (n = the times the play would have acted) or "observando · concordância N/D".
    static func playLine(_ p: Summary.AutonomyPlay) -> String {
        let agreement = p.agreement != nil && p.n != 0
            ? "concorda " + percent(p.agreement, n: p.n) + (p.n.map { " em " + Format.count($0, "caso", "casos") } ?? "")
            : "concordância N/D"
        return stage(p.stage) + " · " + agreement
    }
    /// "O Bunk pegou 68% dos seus movimentos (25)", or "John · o Bunk pegou…" on the all-projects summary; N/D while there is
    /// no case. Per person the executor sends the share of that person's moves a play caught (recall), never a precision.
    static func ownerLine(_ person: Summary.AutonomyPerson, project: String? = nil) -> String {
        let body = person.agreement != nil && person.n != 0
            ? "o Bunk pegou " + percent(person.agreement, n: person.n) + " dos seus movimentos" + (person.n.map { " (" + Format.count($0, "movimento", "movimentos") + ")" } ?? "")
            : "o Bunk pegou dos seus movimentos: N/D (sem casos ainda)"
        return project.map { $0 + " · " + body } ?? "O" + body.dropFirst()
    }
    /// The other people, compact: "Jorge 70% · Leonardo N/D".
    static func othersLine(_ people: [Summary.AutonomyPerson]) -> String? {
        let others = people.filter { !$0.isOwner }
        guard !others.isEmpty else { return nil }
        return others.map { ($0.name ?? "Pessoa") + " " + percent($0.agreement, n: $0.n) }.joined(separator: " · ")
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
            if list.isEmpty { EmptyLine(text: "Nenhuma mudança neste filtro.", kind: .info) }
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
                    Image(systemName: symbols[key] ?? "circle").font(DS.Icon.s).foregroundStyle((tones[key] ?? .neutral).color)
                    Text(Format.actionLabels[key] ?? key).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft)
                }
                Text("\(count)").font(DS.Font.stat).numericTransition(count)
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(people.prefix(2), id: \.key) { p in Text("\(p.key) · \(p.value)").font(DS.Font.micro).foregroundStyle(DS.Color.inkSoft).lineLimit(1) }
                    if let u = b?.unknown, u > 0 { Text("\(u) sem autor").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted) }
                    if count == 0 { Text("nenhuma").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted) }
                }
                Spacer(minLength: 0)
            }
            .padding(DS.Space.m).frame(maxWidth: .infinity, minHeight: 104, maxHeight: 104, alignment: .topLeading)
            .card(selected: selected)
            .opacity(count == 0 ? DS.Opacity.disabled + 0.2 : 1)
            .contentShape(Rectangle())
        }.buttonStyle(.pressable).disabled(count == 0)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Gestores tab: the plays the Bunk learned from the team and how often it agrees with each person (contract b.3).
/// Reading only, no button: adopting a play arrives in the next phase, on the web.
struct ManagerPlays: View {
    let autonomy: Summary.Autonomy
    let showProject: Bool
    var body: some View {
        let projects = autonomy.projects
        // Same play id in two projects ('all' summary): the row key carries the project.
        let plays = projects.flatMap { p in p.plays.map { (key: p.id + ":" + $0.id, project: p, play: $0) } }
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Modo Gestor · jogadas da equipe", detail: "aprendidas com os seus movimentos e os dos gestores · só observação")
                .help("O Bunk compara o que faria com o que você e os gestores fizeram. Concordância da jogada: das vezes em que ela agiria, quantas a equipe fez o mesmo. Por pessoa: quantos dos movimentos dela uma jogada pegou. Associação, não causa. Nenhuma jogada envia ordem nesta fase.")
            VStack(alignment: .leading, spacing: 3) {
                ForEach(projects) { p in
                    if let owner = p.people.first(where: \.isOwner) {
                        Text(AutonomyText.ownerLine(owner, project: showProject ? (p.name ?? p.id) : nil))
                            .font(DS.Font.caption).foregroundStyle(owner.agreement == nil ? DS.Color.inkMuted : DS.Color.inkSoft).lineLimit(1)
                    }
                    if let others = AutonomyText.othersLine(p.people) {
                        Text((showProject ? (p.name ?? p.id) + " · " : "") + "equipe: " + others).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                    }
                }
            }
            if plays.isEmpty {
                EmptyLine(text: "Observando: nenhuma jogada com casos suficientes ainda.", kind: .waiting)
            } else {
                VStack(spacing: 2) {
                    ForEach(plays, id: \.key) { row in
                        ListRow(id: "pb:" + row.key, symbol: "person.2.wave.2", tone: AutonomyText.stageTone(row.play.stage),
                                title: row.play.label ?? "Jogada da equipe", subtitle: AutonomyText.playLine(row.play),
                                tag: showProject ? row.project.name : nil,
                                value: AutonomyText.percent(row.play.agreement, n: row.play.n), valueCaption: "concordância")
                    }
                }
            }
        }
    }
}

struct AgentsTab: View {
    let s: Summary
    let roleTones: [String: Tone] = ["traffic": .good, "creative": .accent, "budget": .warn, "ops": .neutral]
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Agentes", detail: "últimas conclusões e perguntas entre eles")
            if s.agents.recent.isEmpty { EmptyLine(text: "Sem conversa recente.", kind: .info) }
            VStack(spacing: 2) {
                ForEach(s.agents.recent) { m in
                    HStack(alignment: .top, spacing: DS.Space.m) {
                        Monogram(text: m.agent ?? "?", tone: roleTones[m.role ?? ""] ?? .neutral, circle: true)
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
                    .padding(DS.Inset.row)
                    .accessibilityElement(children: .combine)
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
                if !a.metaConnected { EmptyLine(text: Format.accountsMetaNotice(a.metaError), kind: .info) }
                if !a.rows.isEmpty {
                    HStack(spacing: DS.Space.xs) {
                        TextField("Buscar conta por nome ou ID", text: $notch.accountQuery).textFieldStyle(.island)
                        if !notch.accountQuery.isEmpty {
                            IconButton(symbol: "xmark", help: "Limpar a busca") { notch.accountQuery = "" }
                        }
                    }
                }
                let rows = a.rows.filter { Format.accountMatches($0, notch.accountQuery) }
                if a.rows.isEmpty { EmptyLine(text: "Nenhuma conta ativa ou com alerta.") }
                else if rows.isEmpty { EmptyLine(text: "Nenhuma conta com “\(notch.accountQuery.trimmingCharacters(in: .whitespaces))”.", kind: .info) }
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
                EmptyLine(text: "O painel de contas ainda está sendo montado.", kind: .waiting)
            }
        }
    }
}

/// Last 7 days, one row per day (the web daily table, for the whole project or all of them).
/// Vendas count every order (upsells included); CPA = investimento ÷ vendas. Missing numbers stay N/D.
struct DaysTab: View {
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SectionHeader(title: "Resultado por dia", detail: detail)
            if let d = s.days, d.error == nil, !d.rows.isEmpty {
                if d.stale == true { EmptyLine(text: Format.daysStale(d), kind: .info) }
                DayTable(rows: d.rows, currency: d.currency, today: d.today)
                Text("Vendas incluem upsells · CPA = investimento ÷ vendas · Meta, vendas de tráfego · hoje parcial").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
            } else if let e = s.days?.error {
                EmptyLine(text: e + ". Aparece na próxima leitura (a cada 10 min).", kind: .waiting)
            } else {
                EmptyLine(text: "Resultado por dia disponível na próxima leitura do executor (a cada 10 min).", kind: .waiting)
            }
        }
    }
    var detail: String {
        guard let at = s.days?.at else { return "últimos 7 dias · \(s.projectName)" }
        return "últimos 7 dias · \(s.projectName) · lido " + Format.relative(at)
    }
}

/// The web daily table (DIA · INVESTIMENTO · VENDAS · CPA · FAT. LÍQUIDO · LUCRO · ROAS · ROI), newest first.
/// Vendas count every order (upsells included); CPA = investimento ÷ vendas. Missing numbers stay N/D.
struct DayTable: View {
    let rows: [Summary.DayRow]
    let currency: String?
    let today: String?
    private static let widths: [CGFloat] = [62, 82, 50, 70, 86, 82, 50, 50]
    var body: some View {
        VStack(spacing: 0) {
            row(["DIA", "INVEST.", "VENDAS", "CPA", "FAT. LÍQ.", "LUCRO", "ROAS", "ROI"], header: true)
            ForEach(rows) { r in
                Divider().overlay(DS.Color.stroke)
                let c = currency
                row([Format.dayLabel(r.day), Format.money(r.spend, currency: c), Format.orders(r.orders), Format.money(r.cpa, currency: c),
                     Format.money(r.revenueNet, currency: c), Format.money(r.profit, currency: c), Format.ratio(r.roas), Format.ratio(r.roi)],
                    tones: [nil, nil, nil, nil, nil, Format.signTone(r.profit), nil, Format.roiTone(r.roi)], partial: r.day == today)
            }
        }
        .padding(.vertical, DS.Space.xs)
        .background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
    }
    @ViewBuilder func row(_ cells: [String], header: Bool = false, tones: [Tone?] = [], partial: Bool = false) -> some View {
        HStack(spacing: 4) {
            ForEach(cells.indices, id: \.self) { i in
                Group {
                    if i == 0 && partial {
                        HStack(spacing: 3) { Text(cells[i]); Text("parcial").font(DS.Font.micro).foregroundStyle(DS.Color.warn) }
                    } else { Text(cells[i]) }
                }
                .font(header ? DS.Font.microStrong : (i == 0 ? DS.Font.bodyStrong : DS.Font.number))
                .foregroundStyle(header ? DS.Color.inkMuted : (i < tones.count ? tones[i]?.color : nil) ?? DS.Color.ink)
                .lineLimit(1).minimumScaleFactor(0.8)
                .frame(width: Self.widths[i], alignment: i == 0 ? .leading : .trailing)
            }
        }
        .padding(.horizontal, DS.Space.s).padding(.vertical, header ? 5 : 7)
        .accessibilityElement(children: .combine)
    }
}

/// One campaign's day table (DIA · GASTOS · ROAS · VENDAS · IC · CUSTO IC · CPC · CPM), newest first.
/// Vendas count every order (upsells included); IC = checkouts iniciados. Missing numbers stay N/D.
struct CampaignDayTable: View {
    let rows: [Summary.DayRow]
    let currency: String?
    let today: String?
    private static let widths: [CGFloat] = [62, 82, 50, 50, 46, 70, 62, 70]
    var body: some View {
        VStack(spacing: 0) {
            row(["DIA", "GASTOS", "ROAS", "VENDAS", "IC", "CUSTO IC", "CPC", "CPM"], header: true)
            ForEach(rows) { r in
                Divider().overlay(DS.Color.stroke)
                let c = currency
                row([Format.dayLabel(r.day), Format.money(r.spend, currency: c), Format.ratio(r.roas), Format.orders(r.orders), Format.orders(r.checkouts),
                     Format.money(r.costPerCheckout, currency: c), Format.money(r.cpc, currency: c), Format.money(r.cpm, currency: c)], partial: r.day == today)
            }
        }
        .padding(.vertical, DS.Space.xs)
        .background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
    }
    @ViewBuilder func row(_ cells: [String], header: Bool = false, partial: Bool = false) -> some View {
        HStack(spacing: 4) {
            ForEach(cells.indices, id: \.self) { i in
                Group {
                    if i == 0 && partial {
                        HStack(spacing: 3) { Text(cells[i]); Text("parcial").font(DS.Font.micro).foregroundStyle(DS.Color.warn) }
                    } else { Text(cells[i]) }
                }
                .font(header ? DS.Font.microStrong : (i == 0 ? DS.Font.bodyStrong : DS.Font.number))
                .foregroundStyle(header ? DS.Color.inkMuted : DS.Color.ink)
                .lineLimit(1).minimumScaleFactor(0.8)
                .frame(width: Self.widths[i], alignment: i == 0 ? .leading : .trailing)
            }
        }
        .padding(.horizontal, DS.Space.s).padding(.vertical, header ? 5 : 7)
        .accessibilityElement(children: .combine)
    }
}

/// View state of CampaignDaysView (this toolchain has no SwiftUI @State macro).
@MainActor final class DailyLoader: ObservableObject { @Published var result: Store.DailyResult? }

/// One campaign's last 7 days inside its detail: read when the detail opens (same series as the web detail).
struct CampaignDaysView: View {
    @EnvironmentObject var store: Store
    let item: Summary.QueueItem
    @StateObject private var loader = DailyLoader()
    private var result: Store.DailyResult? { loader.result }
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            SectionHeader(title: "Resultado por dia", detail: detail)
            switch result {
            case .none:
                EmptyLine(text: "Consultando a Malva…", kind: .waiting)
            case .some(.failed(let message)):
                EmptyLine(text: message, kind: .info)
            case .some(.ok(let d)):
                if let snap = d.snapshot, !snap.rows.isEmpty {
                    CampaignDayTable(rows: Array(snap.rows.sorted { $0.day > $1.day }.prefix(7)), currency: snap.currency, today: Format.civilDay(Date(), timeZone: snap.timezone))
                    Text("Vendas incluem upsells · IC = checkout iniciado · Custo IC, CPC e CPM = gastos ÷ IC, cliques, mil impressões · hoje parcial").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                } else {
                    EmptyLine(text: d.error.map { $0 + "." } ?? "Aguardando o resultado por dia da Malva.", kind: .waiting)
                }
            }
        }
        .task(id: item.id) { await load() }
    }
    var detail: String {
        if case .some(.ok(let d)) = result, let at = d.snapshot?.fetchedAt { return "últimos 7 dias · lido " + Format.relative(at) + (d.stale == true ? " · atualizando" : "") }
        return "últimos 7 dias"
    }
    func load() async {
        loader.result = nil
        // The first answer may still be "pending" while the Malva read runs: ask again a few times, briefly.
        for attempt in 0..<4 {
            let r = await store.fetchDaily(projectId: item.detail?.projectId, adAccountId: item.adAccountId, objectId: item.campaignId)
            loader.result = r
            guard case .ok(let d) = r, d.snapshot == nil, d.error == nil, attempt < 3 else { return }
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if Task.isCancelled { return }
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
            } else { EmptyLine(text: "Status do executor indisponível nesta leitura.", kind: .info) }
            SectionHeader(title: "Dados")
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text("Base de análise: " + (s.analysisAt.map(Format.stamp) ?? "N/D")).font(DS.Font.body)
                if s.liveAt != nil { Text(Format.dataSources(s)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted) }
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
            if (s.board ?? []).isEmpty { EmptyLine(text: "Placar disponível na próxima atualização do executor.", kind: .waiting) }
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
                            Monogram(text: p.name, tone: .accent)
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
                                Text(Format.ratio(p.roas)).font(DS.Font.number).foregroundStyle(trend.color).numericTransition(p.roas)
                                Text("ontem " + Format.ratio(p.roasYesterday)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                            }
                        }
                        .padding(DS.Inset.row)
                        .background(notch.hovered == "p:" + p.id || selected ? DS.Color.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressableStyle(scale: 0.99))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .onHover { inside in withAnimation(DS.Motion.hover) { if inside { notch.hovered = "p:" + p.id } else if notch.hovered == "p:" + p.id { notch.hovered = nil } } }
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
                    Text(item.campaign ?? "Campanha").font(DS.Font.title).lineLimit(1).truncationMode(.middle).help(item.campaign ?? "")
                    HStack(spacing: DS.Space.xs) {
                        if let p = item.project { Pill(text: p, tone: .tag) }
                        Pill(text: Format.statusName(item.detail?.status), tone: item.detail?.status == "ACTIVE" ? .good : .neutral)
                        Text("diário " + Format.money(item.detail?.dailyBudget, currency: item.detail?.budgetCurrency)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                        if let m = item.detail?.metaLiveAt {
                            Text("Meta ao vivo " + Format.relative(m)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                                .help("Hoje, status e orçamento lidos direto da Meta e juntados à linha do Malva. Vendas e receita continuam do Malva; a ordem confere o valor do Malva.")
                        }
                    }
                }
                Spacer()
                ActionButton(title: "Ajustar aqui", icon: "slider.horizontal.3", leadingIcon: true, prominent: true, help: "Pausar, reduzir ou aumentar aqui, confirmando com Touch ID") {
                    withAnimation(DS.Motion.quick) { notch.adjust = AdjustTarget(project: item.detail?.projectId, adAccountId: item.adAccountId, campaignId: item.campaignId, name: item.campaign) }
                }
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
                                    Text(Format.ratio(w?.roas)).font(DS.Font.stat).foregroundStyle((w?.roi ?? 1) >= 1 ? DS.Color.ink : DS.Color.bad).numericTransition(w?.roas)
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
                    CampaignDaysView(item: item)
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
            .scrollEdgeFade()
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
