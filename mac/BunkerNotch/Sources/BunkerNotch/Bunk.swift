import AppKit
import SwiftUI

/// Bunk: the Bunker's own mascot — a small bunker dome with a visor and an antenna.
/// Original character (name, design, expressions and animations made for the Bunker).
/// Its mood mirrors the real operation; it never decides or executes anything.
enum BunkMood: String, Equatable { case idle, watching, alert, happy, sleeping, thinking, worried }

enum BunkBrain {
    static let zone = TimeZone(identifier: "America/Sao_Paulo") ?? .current
    private static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return iso.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
    /// Awake inside the operation window (06h–20h, São Paulo).
    static func awake(_ now: Date) -> Bool {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
        let h = cal.component(.hour, from: now)
        return h >= 6 && h < 20
    }

    static func mood(_ s: Summary?, error: String?, preparing: Bool, muted: Bool, now: Date = Date()) -> BunkMood {
        if error != nil { return .worried }
        guard let s else { return .thinking }
        let losses = s.queue.filter { $0.kind == "loss" }.count
        let attention = s.approvals.count + losses + (s.accounts?.counts.nearLimit ?? 0)
        if s.paused || s.executor?.paused == true { return .sleeping }
        if attention > 0 { return muted ? .sleeping : .alert }
        if muted || !awake(now) { return .sleeping }
        if let t = s.today.today?.roas, let y = s.today.yesterday?.roas, y > 0, t >= y * 1.1 { return .happy }
        if let pulse = date(s.executor?.lastPulseAt), now.timeIntervalSince(pulse) < 180 { return .watching }
        return .idle
    }

    /// What Bunk says, most important first. Each click on Bunk moves to the next topic.
    static func lines(_ s: Summary?, error: String?, preparing: Bool) -> [String] {
        if let error { return ["Não consegui ler o Bunker agora: \(error)"] }
        guard let s else { return [preparing ? "Estou montando o resumo. Volto em 1 a 2 minutos." : "Lendo o Bunker…"] }
        var out: [String] = []
        if s.approvals.count > 0 { out.append("\(s.approvals.count) proposta(s) exata(s) esperando você no Bunker.") }
        if let loss = s.queue.first(where: { $0.kind == "loss" }) {
            let account = loss.account.map { " em \($0)" } ?? ""
            out.append("De olho: \(loss.campaign ?? "uma campanha")\(account) está −\(Format.money(loss.amount)) \(loss.period == "today" ? "hoje" : "em 3 dias").")
        }
        if let a = s.accounts, a.counts.nearLimit > 0 { out.append("\(a.counts.nearLimit) conta(s) perto do limite diário da Meta.") }
        if let sh = s.shadow, sh.total > 0 {
            let would = sh.byRule.values.reduce(0) { $0 + $1.wouldExecute }, first = sh.byRule.values.reduce(0) { $0 + $1.bunkerFirst }
            out.append("Na sombra, hoje eu teria agido \(would) vez(es)\(first > 0 ? ", \(first) antes do gestor" : ""). Ainda não executo nada.")
        }
        out.append("ROAS hoje \(Format.ratio(s.today.today?.roas)), ontem \(Format.ratio(s.today.yesterday?.roas)).")
        if let e = s.activity.recent.first { out.append("Última mudança: \(Format.who(e)) · \(e.campaign ?? "campanha") · \(Format.relative(e.at)).") }
        if out.count <= 2 && s.approvals.count == 0 { out.append("Tudo calmo por aqui. Sigo vigiando.") }
        return out
    }
}

/// The drawing. `look` (−1…1) shifts the eyes toward the pointer.
struct BunkView: View {
    let mood: BunkMood
    var size: CGFloat = 22
    var look: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
            let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            Canvas { ctx, canvas in draw(ctx, canvas, t) }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel("Bunk, \(label)")
    }

    var label: String {
        switch mood {
        case .idle: return "tranquilo"; case .watching: return "vigiando"; case .alert: return "em alerta"
        case .happy: return "feliz"; case .sleeping: return "dormindo"; case .thinking: return "pensando"; case .worried: return "preocupado"
        }
    }

    private func draw(_ ctx: GraphicsContext, _ canvas: CGSize, _ t: Double) {
        let u = canvas.width / 24
        let hop: CGFloat = mood == .alert ? -abs(CGFloat(sin(t * 5))) * 1.4 * u : mood == .happy ? -abs(CGFloat(sin(t * 3))) * 0.9 * u : 0
        let breath = 1 + (mood == .sleeping ? 0.04 : 0.022) * CGFloat(sin(t * (mood == .sleeping ? 1.2 : 2.0)))
        var c = ctx
        // Breathe from the ground, hop as a whole.
        c.translateBy(x: 0, y: hop + 22 * u * (1 - breath))
        c.scaleBy(x: 1, y: breath)

        // Antenna and its light.
        let tip = CGPoint(x: 12 * u, y: 2.6 * u)
        var stem = Path(); stem.move(to: CGPoint(x: 12 * u, y: 6.4 * u)); stem.addLine(to: tip)
        c.stroke(stem, with: .color(DS.Color.accent.opacity(0.9)), lineWidth: 1.1 * u)
        let light: Color = {
            switch mood {
            case .alert: return sin(t * 8) > 0 ? DS.Color.bad : DS.Color.bad.opacity(0.35)
            case .watching: return DS.Color.good.opacity(0.55 + 0.45 * (0.5 + 0.5 * sin(t * 3)))
            case .worried: return DS.Color.warn
            case .sleeping: return Color.white.opacity(0.25)
            case .happy: return DS.Color.good
            default: return Color.white.opacity(0.85)
            }
        }()
        c.fill(Path(ellipseIn: CGRect(x: tip.x - 1.5 * u, y: tip.y - 1.5 * u, width: 3 * u, height: 3 * u)), with: .color(light))

        // Dome body with a flat base: the bunker.
        let body = Path(roundedRect: CGRect(x: 2.5 * u, y: 6 * u, width: 19 * u, height: 16 * u), cornerRadii: RectangleCornerRadii(topLeading: 9 * u, bottomLeading: 2.2 * u, bottomTrailing: 2.2 * u, topTrailing: 9 * u))
        c.fill(body, with: .linearGradient(Gradient(colors: [DS.Color.accent, DS.Color.accent.opacity(0.62)]), startPoint: CGPoint(x: 12 * u, y: 6 * u), endPoint: CGPoint(x: 12 * u, y: 22 * u)))
        // Door seam and two bolts.
        c.fill(Path(roundedRect: CGRect(x: 9 * u, y: 17.6 * u, width: 6 * u, height: 4.4 * u), cornerRadius: 1.2 * u), with: .color(.black.opacity(0.28)))
        for x in [5.4, 18.6] { c.fill(Path(ellipseIn: CGRect(x: x * u - 0.7 * u, y: 19.2 * u, width: 1.4 * u, height: 1.4 * u)), with: .color(.black.opacity(0.32))) }

        // Visor.
        let visor = CGRect(x: 5.2 * u, y: 10.2 * u, width: 13.6 * u, height: 5.4 * u)
        c.fill(Path(roundedRect: visor, cornerRadius: 2.7 * u), with: .color(.black.opacity(0.88)))
        drawEyes(c, visor, u, t)

        // Floating extras.
        if mood == .sleeping {
            let rise = CGFloat((t * 0.6).truncatingRemainder(dividingBy: 1))
            c.opacity = Double(1 - rise)
            c.draw(Text("z").font(.system(size: 5 * u, weight: .bold, design: .rounded)).foregroundColor(.white.opacity(0.8)), at: CGPoint(x: 20 * u + rise * 2 * u, y: 6 * u - rise * 5 * u))
        }
        if mood == .thinking {
            for i in 0..<3 {
                let on = Int(t * 3) % 3 >= i
                c.fill(Path(ellipseIn: CGRect(x: (16.5 + Double(i) * 2.2) * u, y: 3.2 * u, width: 1.4 * u, height: 1.4 * u)), with: .color(.white.opacity(on ? 0.85 : 0.25)))
            }
        }
    }

    private func drawEyes(_ c: GraphicsContext, _ visor: CGRect, _ u: CGFloat, _ t: Double) {
        let color: Color = mood == .alert ? DS.Color.bad : mood == .watching ? DS.Color.good : mood == .worried ? DS.Color.warn : .white.opacity(0.95)
        let sweep: CGFloat = mood == .watching ? CGFloat(sin(t * 1.4)) * 2.2 * u : look * 1.8 * u
        let lift: CGFloat = mood == .thinking ? -0.9 * u : mood == .worried ? 0.5 * u : 0
        let blinking = (t.truncatingRemainder(dividingBy: 4.3)) < 0.13 && mood != .sleeping && mood != .happy
        let cy = visor.midY + lift
        for dx in [-3.0, 3.0] {
            let cx = visor.midX + CGFloat(dx) * u + sweep
            switch mood {
            case .happy:
                var arc = Path(); arc.move(to: CGPoint(x: cx - 1.3 * u, y: cy + 0.7 * u)); arc.addQuadCurve(to: CGPoint(x: cx + 1.3 * u, y: cy + 0.7 * u), control: CGPoint(x: cx, y: cy - 1.5 * u))
                c.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: 0.9 * u, lineCap: .round))
            case .sleeping:
                var line = Path(); line.move(to: CGPoint(x: cx - 1.2 * u, y: cy)); line.addLine(to: CGPoint(x: cx + 1.2 * u, y: cy))
                c.stroke(line, with: .color(color.opacity(0.7)), style: StrokeStyle(lineWidth: 0.8 * u, lineCap: .round))
            default:
                let w = (mood == .worried ? 1.4 : 1.8) * u, h = blinking ? 0.35 * u : (mood == .alert ? 3.0 : 2.6) * u
                c.fill(Path(roundedRect: CGRect(x: cx - w / 2, y: cy - h / 2, width: w, height: h), cornerRadius: w / 2), with: .color(color))
            }
        }
    }
}

/// Bunk with interaction: looks at the pointer on hover; a click says the next topic in a bubble.
struct BunkAvatar: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    var size: CGFloat = 22
    var interactive = true
    var mood: BunkMood { BunkBrain.mood(store.summary, error: store.error, preparing: store.preparing, muted: store.muted) }
    var body: some View {
        let hovering = interactive && notch.bunkHovering
        BunkView(mood: hovering && mood == .idle ? .happy : mood, size: size, look: interactive ? notch.bunkLook : 0)
            .contentShape(Rectangle())
            .onContinuousHover { phase in
                guard interactive else { return }
                switch phase {
                case .active(let p): notch.bunkHovering = true; notch.bunkLook = max(-1, min(1, (p.x - size / 2) / (size / 2)))
                case .ended: notch.bunkHovering = false; withAnimation(DS.Motion.quick) { notch.bunkLook = 0 }
                }
            }
            .onTapGesture { if interactive { notch.bunkSpeak(BunkBrain.lines(store.summary, error: store.error, preparing: store.preparing)) } }
            .help(interactive ? "Bunk · clique para ele contar o que importa agora" : "Bunk")
    }
}

/// The speech bubble under the header.
struct BunkBubble: View {
    @EnvironmentObject var notch: NotchState
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.s) {
            Text("Bunk").font(DS.Font.bodyStrong).foregroundStyle(DS.Color.accent)
            Text(text).font(DS.Font.body).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button { withAnimation(DS.Motion.quick) { notch.bunkSays = nil } } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(DS.Color.inkMuted) }.buttonStyle(.plain)
        }
        .padding(.horizontal, DS.Space.m).padding(.vertical, DS.Space.s)
        .background(DS.Color.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous).stroke(DS.Color.accent.opacity(0.35), lineWidth: 1))
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

/// `Bunker --render-bunk file.png`: a still sheet of every mood, for review without screen capture.
@MainActor enum BunkSheet {
    static let moods: [(BunkMood, String)] = [(.idle, "tranquilo"), (.watching, "vigiando"), (.alert, "alerta"), (.happy, "feliz"), (.sleeping, "dormindo"), (.thinking, "pensando"), (.worried, "preocupado")]
    static func render(to path: String) -> Int32 {
        let sheet = HStack(spacing: 28) {
            ForEach(moods, id: \.1) { m in
                VStack(spacing: 10) {
                    BunkView(mood: m.0, size: 120)
                    Text(m.1).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundColor(.white.opacity(0.8))
                }
            }
        }
        .padding(36)
        .background(Color.black)
        .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: sheet)
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return 1 }
        do { try png.write(to: URL(fileURLWithPath: path)); print("Bunk salvo em \(path)"); return 0 } catch { return 1 }
    }
}
