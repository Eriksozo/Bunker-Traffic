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

enum Palette {
    static let accent = Color(red: 0.72, green: 0.61, blue: 0.91)
    static let good = Color(red: 0.21, green: 0.79, blue: 0.61)
    static let bad = Color(red: 0.94, green: 0.44, blue: 0.47)
    static let warn = Color(red: 0.95, green: 0.73, blue: 0.38)
    static let muted = Color.white.opacity(0.6)
}

struct NotchRootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                IslandShape(radius: notch.expanded ? 22 : 10).fill(Color.black)
                if notch.expanded { ExpandedView().padding(.top, notch.geometry.height + 6).transition(.opacity) }
                else { CollapsedView() }
            }
            .frame(width: notch.islandSize.width, height: notch.islandSize.height)
            .shadow(color: .black.opacity(notch.expanded ? 0.45 : 0), radius: 18, y: 8)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }
}

/// Resting state: ears on both sides of the camera notch.
struct CollapsedView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 5) {
                Circle().fill(statusColor).frame(width: 7, height: 7)
                Image(systemName: "square.stack.3d.up.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.accent)
            }.frame(width: 75, alignment: .center)
            Spacer(minLength: notch.geometry.width)
            HStack(spacing: 4) {
                if store.attention > 0 {
                    Text("\(store.attention)").font(.system(size: 11, weight: .bold, design: .rounded)).foregroundStyle(Palette.warn)
                } else {
                    Text(Format.ratio(store.summary?.today.today?.roas)).font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(.white.opacity(0.85))
                }
            }.frame(width: 75, alignment: .center)
        }
        .frame(height: notch.geometry.height)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Bunker: \(store.attention) itens pedem atenção")
    }
    var statusColor: Color {
        if store.error != nil { return Palette.bad }
        if store.summary?.paused == true || store.summary?.executor?.paused == true { return Palette.warn }
        return store.attention > 0 ? Palette.warn : Palette.good
    }
}

struct ExpandedView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Header()
            if let error = store.error { Banner(text: error, color: Palette.bad) }
            if let s = store.summary {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 14) {
                        TodaySection(s: s)
                        if s.approvals.count > 0 { ApprovalsSection(s: s) }
                        QueueSection(s: s)
                        ActivitySection(s: s)
                        AgentsSection(s: s)
                        ExecutorLine(s: s)
                        Text(s.notice).font(.system(size: 10)).foregroundStyle(Palette.muted)
                    }.padding(.bottom, 14)
                }
            } else if store.error == nil {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .padding(.horizontal, 18)
        .foregroundStyle(.white)
    }
}

struct Header: View {
    @EnvironmentObject var store: Store
    var body: some View {
        HStack(spacing: 8) {
            Text("BUNKER").font(.system(size: 11, weight: .heavy)).tracking(1.5).foregroundStyle(Palette.accent)
            Picker("Projeto", selection: $store.project) {
                Text("Todos os projetos").tag("all")
                ForEach(store.summary?.projects ?? [], id: \.id) { Text($0.name).tag($0.id) }
            }.labelsHidden().frame(width: 180).controlSize(.small)
            Spacer()
            if let at = store.summary?.analysisAt { Text("Análise \(Format.stamp(at))").font(.system(size: 10)).foregroundStyle(Palette.muted) }
            Button { Task { await store.refresh() } } label: { Image(systemName: store.loading ? "hourglass" : "arrow.clockwise") }
                .buttonStyle(.plain).help("Atualizar agora")
            Button { store.open("#cards") } label: { Label("Abrir Bunker", systemImage: "arrow.up.right.square") }
                .buttonStyle(.borderedProminent).tint(Palette.accent.opacity(0.85)).controlSize(.small)
        }
    }
}

struct Banner: View {
    let text: String; let color: Color
    var body: some View {
        Text(text).font(.system(size: 11)).padding(8).frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(0.4)))
    }
}

struct SectionTitle: View {
    let text: String; var detail: String? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text.uppercased()).font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundStyle(Palette.muted)
            if let detail { Text(detail).font(.system(size: 10)).foregroundStyle(Palette.muted.opacity(0.8)) }
        }
    }
}

struct TodaySection: View {
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "Hoje em 1 minuto", detail: s.projectName)
            HStack(spacing: 8) {
                Metric(label: "ROAS", value: Format.ratio(s.today.today?.roas), base: "Ontem \(Format.ratio(s.today.yesterday?.roas)) · 7d \(Format.ratio(s.today.week?.roas))", delta: s.today.deltas["roas"], higherIsBetter: true)
                Metric(label: "ROI", value: Format.ratio(s.today.today?.roi), base: "Ontem \(Format.ratio(s.today.yesterday?.roi)) · 7d \(Format.ratio(s.today.week?.roi))", delta: s.today.deltas["roi"], higherIsBetter: true)
                Metric(label: "CPA front", value: Format.money(s.today.today?.cpaFront), base: "Ontem \(Format.money(s.today.yesterday?.cpaFront)) · 7d \(Format.money(s.today.week?.cpaFront))", delta: s.today.deltas["cpaFront"], higherIsBetter: false)
            }
        }
    }
}

struct Metric: View {
    let label: String; let value: String; let base: String; let delta: Summary.Delta?; let higherIsBetter: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label + " hoje").font(.system(size: 10)).foregroundStyle(Palette.muted)
            Text(value).font(.system(size: 18, weight: .semibold, design: .rounded))
            Text(base).font(.system(size: 9.5)).foregroundStyle(Palette.muted).lineLimit(1)
            HStack(spacing: 6) { chip(delta?.yesterday, "ontem"); chip(delta?.week, "7d") }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }
    @ViewBuilder func chip(_ value: Double?, _ label: String) -> some View {
        if let value {
            let flat = abs(value) < 0.05, good = (value > 0) == higherIsBetter
            Text("\(Format.percent(value * 100)) \(label)").font(.system(size: 9.5, weight: .medium))
                .foregroundStyle(flat ? Palette.muted : good ? Palette.good : Palette.bad)
        } else {
            Text("N/D \(label)").font(.system(size: 9.5)).foregroundStyle(Palette.muted)
        }
    }
}

struct ApprovalsSection: View {
    @EnvironmentObject var store: Store
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "Aguardando você", detail: "\(s.approvals.count) proposta(s) exata(s)")
            ForEach(s.approvals.items) { a in
                Button { store.open("#cards") } label: {
                    Row(icon: "checkmark.seal", tint: Palette.warn, title: a.title ?? "Proposta exata", detail: (a.project ?? "") + (a.expiresAt.map { " · vence \(Format.stamp($0))" } ?? ""), trailing: "Conferir")
                }.buttonStyle(.plain)
            }
        }
    }
}

struct QueueSection: View {
    @EnvironmentObject var store: Store
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "O que fazer agora", detail: "\(s.queue.count) de \(s.queueSize) na fila")
            if s.queue.isEmpty { Text("Nada pedindo ação agora.").font(.system(size: 11)).foregroundStyle(Palette.muted) }
            ForEach(s.queue) { q in
                let loss = q.kind == "loss"
                Button { store.open("#cards") } label: {
                    Row(icon: loss ? "arrow.down.right" : "arrow.up.right", tint: loss ? Palette.bad : Palette.good,
                        title: q.campaign ?? "Campanha",
                        detail: "\(q.period == "today" ? "Hoje" : "3 dias"): gasto \(Format.money(q.spend)) · ROAS \(Format.ratio(q.roas)) · 7d \(Format.ratio(q.roas7d))",
                        trailing: loss ? (q.basis == "result" ? "−\(Format.money(q.amount))" : "receita −\(Format.money(q.amount))") : "+\(Format.money(q.amount))")
                }.buttonStyle(.plain)
            }
        }
    }
}

struct ActivitySection: View {
    let s: Summary
    @EnvironmentObject var notch: NotchState
    private var open: String? { notch.activityFilter }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "Gestores · últimas \(s.activity.hours)h", detail: "toque numa caixa para ver quem, quando e quanto")
            HStack(spacing: 6) {
                ForEach(["increase", "reduce", "pause", "activate"], id: \.self) { key in
                    let b = s.activity.summary[key]
                    Button { notch.activityFilter = open == key ? nil : key } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Format.actionLabels[key] ?? key).font(.system(size: 10)).foregroundStyle(Palette.muted)
                            Text("\(b?.count ?? 0)").font(.system(size: 16, weight: .semibold, design: .rounded))
                            Text(names(b)).font(.system(size: 9.5)).foregroundStyle(Palette.muted).lineLimit(2)
                        }
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white.opacity(open == key ? 0.12 : 0.06), in: RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(.plain).disabled((b?.count ?? 0) == 0)
                }
            }
            ForEach(s.activity.recent.filter { open == nil || $0.action == open }.prefix(open == nil ? 4 : 12)) { e in
                Row(icon: icon(e.action), tint: ["increase", "activate"].contains(e.action) ? Palette.good : Palette.bad,
                    title: Format.who(e) + " · " + Format.change(e),
                    detail: (e.campaign ?? "Campanha") + " · " + (e.origin == "observed" && e.from != nil ? "entre \(Format.stamp(e.from)) e \(Format.stamp(e.at))" : Format.stamp(e.at)),
                    trailing: nil)
            }
        }
    }
    func names(_ b: Summary.Bucket?) -> String {
        guard let b, b.count > 0 else { return "nenhuma" }
        var parts = b.actors.sorted { $0.value > $1.value }.prefix(2).map { "\($0.key) (\($0.value))" }
        if b.unknown > 0 { parts.append("\(b.unknown) sem autor") }
        return parts.joined(separator: " · ")
    }
    func icon(_ action: String) -> String {
        ["increase": "arrow.up.right", "reduce": "arrow.down.right", "pause": "pause.fill", "activate": "play.fill"][action] ?? "clock.arrow.circlepath"
    }
}

struct AgentsSection: View {
    let s: Summary
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "Agentes", detail: "últimas conclusões e perguntas")
            if s.agents.recent.isEmpty { Text("Sem conversa recente.").font(.system(size: 11)).foregroundStyle(Palette.muted) }
            ForEach(s.agents.recent.prefix(4)) { m in
                Row(icon: m.kind == "message" ? "bubble.left.and.bubble.right" : "person.crop.circle.badge.checkmark", tint: Palette.accent,
                    title: "\(m.agent ?? "Agente")\(m.to.map { " → \($0)" } ?? ""): \(m.decision ?? "")",
                    detail: (m.text ?? "") + " · " + Format.stamp(m.at), trailing: nil)
            }
        }
    }
}

struct ExecutorLine: View {
    let s: Summary
    var body: some View {
        if let e = s.executor {
            HStack(spacing: 6) {
                Circle().fill(!e.enabled || e.paused ? Palette.warn : e.recentFailures > 0 ? Palette.warn : Palette.good).frame(width: 6, height: 6)
                Text("Executor na nuvem: \(e.paused ? "pausado" : e.enabled ? "ativo" : "desligado") · último pulso \(Format.stamp(e.lastPulseAt)) · \(e.recentFailures) falha(s) na última hora")
                    .font(.system(size: 10.5)).foregroundStyle(Palette.muted)
            }
        }
    }
}

struct Row: View {
    let icon: String; let tint: Color; let title: String; let detail: String; let trailing: String?
    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(tint).frame(width: 22, height: 22)
                .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 11.5, weight: .medium)).lineLimit(2)
                Text(detail).font(.system(size: 10)).foregroundStyle(Palette.muted).lineLimit(2)
            }
            Spacer(minLength: 6)
            if let trailing { Text(trailing).font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(tint) }
        }
        .contentShape(Rectangle())
    }
}
