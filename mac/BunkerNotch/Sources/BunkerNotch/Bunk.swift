import AppKit
import SwiftUI

/// Bunk: the Bunker's own mascot — a small bunker dome with a visor and an antenna.
/// Original character (name, design, expressions and animations made for the Bunker).
/// Its mood mirrors the real operation; it never decides or executes anything.
enum BunkMood: String, Equatable { case idle, watching, alert, happy, sleeping, thinking, worried }
/// Brief reactions: surprised (something needs you), happy (good news, landing), wink (click),
/// yawn (about to doze off), love (an approval went through).
enum BunkReaction: String, Equatable, CaseIterable { case surprised, happy, wink, yawn, love }

enum BunkBrain {
    static let zone = TimeZone(identifier: "America/Sao_Paulo") ?? .current
    private static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return iso.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
    /// On the resting island only these moods move (CPU stays near zero on a calm day).
    static func animatesAtRest(_ mood: BunkMood) -> Bool { [.alert, .thinking, .worried].contains(mood) }
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
    /// A topic Bunk talks about; `target` opens that campaign's adjustment (or the approvals) when clicked.
    struct Topic: Equatable { let text: String; var target: AdjustTarget? = nil }
    static func lossTarget(_ q: Summary.QueueItem) -> AdjustTarget {
        AdjustTarget(project: q.detail?.projectId, adAccountId: q.adAccountId, campaignId: q.campaignId, name: q.campaign)
    }
    static let approvalsTarget = AdjustTarget(project: nil, adAccountId: nil, campaignId: nil, name: nil)
    static func lines(_ s: Summary?, error: String?, preparing: Bool, ledger: AttentionLedger = AttentionLedger()) -> [String] { topics(s, error: error, preparing: preparing, ledger: ledger).map(\.text) }
    /// `ledger`: dismissed or snoozed items are not brought up (they still show in the island's lists).
    static func topics(_ s: Summary?, error: String?, preparing: Bool, ledger: AttentionLedger = AttentionLedger()) -> [Topic] {
        if let error { return [Topic(text: "Não consegui ler o Bunker agora: \(error)")] }
        guard let s else { return [Topic(text: preparing ? "Estou montando o resumo. Volto em 1 a 2 minutos." : "Lendo o Bunker…")] }
        var out: [Topic] = []
        if s.approvals.count > 0, !ledger.isQuiet(key: AttentionLedger.approvalsKey) { out.append(Topic(text: Format.count(s.approvals.count, "proposta exata esperando", "propostas exatas esperando") + " você no Bunker.", target: approvalsTarget)) }
        if let loss = s.queue.first(where: { $0.kind == "loss" && !ledger.isQuiet($0) }) {
            let account = loss.account.map { " em \($0)" } ?? ""
            out.append(Topic(text: "De olho: \(loss.campaign ?? "uma campanha")\(account) está −\(Format.money(loss.amount)) \(loss.period == "today" ? "hoje" : "em 3 dias").", target: lossTarget(loss)))
        }
        if let a = s.accounts, a.counts.nearLimit > 0, !ledger.isQuiet(key: AttentionLedger.limitKey) { out.append(Topic(text: Format.count(a.counts.nearLimit, "conta", "contas") + " perto do limite diário da Meta.")) }
        if let f = s.first24h, f.counts.attention > 0 {
            out.append(Topic(text: Format.count(f.counts.attention, "campanha nova", "campanhas novas") + " perto do teto de \(Format.money(f.ceiling ?? 110)) sem venda nas primeiras 24h."))
        }
        if let sh = s.shadow, sh.total > 0 {
            let would = sh.byRule.values.reduce(0) { $0 + $1.wouldExecute }, first = sh.byRule.values.reduce(0) { $0 + $1.bunkerFirst }
            out.append(Topic(text: "Na sombra, hoje eu teria agido \(would == 1 ? "1 vez" : "\(would) vezes")\(first > 0 ? ", \(first) antes do gestor" : ""). Ainda não executo nada."))
        }
        out.append(Topic(text: "ROAS hoje \(Format.ratio(s.today.today?.roas)), ontem \(Format.ratio(s.today.yesterday?.roas))."))
        if let p = s.pace, p.status != "nd" { out.append(Topic(text: "Ritmo do orçamento: \(Format.pace(p)) (\(Format.paceBase(p))).")) }
        if let e = s.activity.recent.first { out.append(Topic(text: "Última mudança: \(Format.who(e)) · \(e.campaign ?? "campanha") · \(Format.relative(e.at)).")) }
        if out.count <= 2 && s.approvals.count == 0 { out.append(Topic(text: "Tudo calmo por aqui. Sigo vigiando.")) }
        return out
    }
}

/// The drawing. `look` (−1…1) shifts the eyes toward the pointer.
struct BunkView: View {
    let mood: BunkMood
    var size: CGFloat = 22
    var look: CGFloat = 0
    /// −1 (looking up) … 1 (looking down).
    var lookY: CGFloat = 0
    /// Out of the notch: shows the feet; `walking` steps them.
    var feet = false
    var walking = false
    /// Short reaction on top of the mood (Bunk's own expressions).
    var reaction: BunkReaction? = nil
    /// False freezes the drawing (no frames): used while nothing needs attention.
    var active = true
    /// Calm and still (desktop Bunk breathing): 10 frames per second instead of 30.
    var resting = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // Animation gate: frames only when there is something to watch; asleep at 10 fps.
        TimelineView(.animation(minimumInterval: mood == .sleeping || resting ? 0.1 : 1.0 / 30.0, paused: reduceMotion || !active)) { timeline in
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
        let jumpy = mood == .alert || reaction == .surprised, cheerful = mood == .happy || reaction == .happy || reaction == .love
        // Hop: rate, height and how much the body squashes on contact (BunkMotion: squash and stretch keeps volume).
        let rate: Double = jumpy ? 5 : cheerful ? 3 : walking ? 7 : 0, strength: Double = jumpy ? 1 : cheerful ? 0.7 : walking ? 0.3 : 0
        let height = rate > 0 ? abs(sin(t * rate)) : 0
        let hop: CGFloat = -CGFloat(height) * (jumpy ? 1.4 : cheerful ? 0.9 : 0.5) * u * (rate > 0 ? 1 : 0)
        let squash = BunkMotion.squashStretch(height, strength: strength)
        let bend = BunkMotion.antennaBend(t, hopSpeed: strength, hopRate: rate, walking: walking)
        let breath = 1 + (mood == .sleeping ? 0.04 : 0.022) * CGFloat(sin(t * (mood == .sleeping ? 1.2 : 2.0)))
        // Little feet: only out of the notch, stepping while walking.
        if feet || walking {
            var f = ctx; f.translateBy(x: 0, y: hop)
            for (i, x) in [6.6, 14.4].enumerated() {
                let step: CGFloat = walking ? CGFloat(sin(t * 14 + Double(i) * .pi)) * 0.8 * u : 0
                f.fill(Path(roundedRect: CGRect(x: x * u, y: 21.2 * u - max(0, step), width: 3 * u, height: 2.4 * u), cornerRadius: 1.1 * u), with: .color(DS.Color.accent.opacity(0.55)))
            }
        }
        var c = ctx
        // Breathe from the ground, hop as a whole, squash around the feet.
        let sy = breath * squash.y, sx = squash.x
        c.translateBy(x: 12 * u * (1 - sx), y: hop + 22 * u * (1 - sy))
        c.scaleBy(x: sx, y: sy)

        // Antenna on a spring: the tip lags the body and sways (secondary motion).
        let tip = CGPoint(x: 12 * u + bend * 1.7 * u, y: 2.6 * u + abs(bend) * 0.35 * u)
        var stem = Path(); stem.move(to: CGPoint(x: 12 * u, y: 6.4 * u)); stem.addQuadCurve(to: tip, control: CGPoint(x: 12 * u + bend * 0.5 * u, y: 4.4 * u))
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
        if reaction == .love {
            // A heart on the antenna.
            var heart = Path(), s = 1.7 * u
            heart.move(to: CGPoint(x: tip.x, y: tip.y + s))
            heart.addCurve(to: CGPoint(x: tip.x - s, y: tip.y - 0.2 * s), control1: CGPoint(x: tip.x - 0.4 * s, y: tip.y + 0.6 * s), control2: CGPoint(x: tip.x - s, y: tip.y + 0.3 * s))
            heart.addArc(center: CGPoint(x: tip.x - 0.5 * s, y: tip.y - 0.3 * s), radius: 0.5 * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            heart.addArc(center: CGPoint(x: tip.x + 0.5 * s, y: tip.y - 0.3 * s), radius: 0.5 * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            heart.addCurve(to: CGPoint(x: tip.x, y: tip.y + s), control1: CGPoint(x: tip.x + s, y: tip.y + 0.3 * s), control2: CGPoint(x: tip.x + 0.4 * s, y: tip.y + 0.6 * s))
            c.fill(heart, with: .color(Color(red: 1, green: 0.45, blue: 0.62)))
        } else {
            c.fill(Path(ellipseIn: CGRect(x: tip.x - 1.5 * u, y: tip.y - 1.5 * u, width: 3 * u, height: 3 * u)), with: .color(reaction == .surprised ? DS.Color.warn : light))
        }

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
        if reaction == .surprised {
            c.draw(Text("!").font(.system(size: 6 * u, weight: .heavy, design: .rounded)).foregroundColor(DS.Color.warn), at: CGPoint(x: 20.5 * u, y: 4 * u))
        }
        if reaction == .yawn {
            c.stroke(Path(ellipseIn: CGRect(x: visor.midX - 0.9 * u, y: visor.maxY - 2.1 * u, width: 1.8 * u, height: 1.5 * u)), with: .color(.white.opacity(0.8)), lineWidth: 0.6 * u)
        }
        if mood == .sleeping && reaction == nil {
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
        let lift: CGFloat = (mood == .thinking ? -0.9 * u : mood == .worried ? 0.5 * u : 0) + lookY * 0.8 * u
        // Irregular blinks and small eye jumps (BunkMotion); a strong look at the pointer wins over the jumps.
        let lid: CGFloat = mood != .sleeping && mood != .happy && reaction == nil ? BunkMotion.blink(t) : 0
        let jump = mood == .watching || abs(look) > 0.25 ? CGPoint.zero : BunkMotion.saccade(t)
        let cy = visor.midY + lift + jump.y * u
        for dx in [-3.0, 3.0] {
            let cx = visor.midX + CGFloat(dx) * u + sweep + jump.x * u
            // Reactions (Bunk's own expressions) override the mood's eyes.
            let style: BunkMood = {
                switch reaction {
                case .happy?, .love?: return .happy
                case .yawn?: return .sleeping
                case .wink?: return dx < 0 ? .happy : .idle
                default: return mood
                }
            }()
            if reaction == .surprised {
                let d = 2.8 * u
                c.fill(Path(ellipseIn: CGRect(x: cx - d / 2, y: cy - d / 2, width: d, height: d)), with: .color(.white))
                continue
            }
            switch style {
            case .happy:
                var arc = Path(); arc.move(to: CGPoint(x: cx - 1.3 * u, y: cy + 0.7 * u)); arc.addQuadCurve(to: CGPoint(x: cx + 1.3 * u, y: cy + 0.7 * u), control: CGPoint(x: cx, y: cy - 1.5 * u))
                c.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: 0.9 * u, lineCap: .round))
            case .sleeping:
                var line = Path(); line.move(to: CGPoint(x: cx - 1.2 * u, y: cy)); line.addLine(to: CGPoint(x: cx + 1.2 * u, y: cy))
                c.stroke(line, with: .color(color.opacity(0.7)), style: StrokeStyle(lineWidth: 0.8 * u, lineCap: .round))
            default:
                let full = (style == .alert ? 3.0 : 2.6) * u
                let w = (style == .worried ? 1.4 : 1.8) * u, h = max(0.35 * u, full * (1 - lid))
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
        // Resting island: frozen unless there is something to watch; the open header always animates.
        BunkView(mood: hovering && mood == .idle ? .happy : mood, size: size, look: interactive ? notch.bunkLook : 0,
                 active: interactive || BunkBrain.animatesAtRest(mood))
            .contentShape(Rectangle())
            .onContinuousHover { phase in
                guard interactive else { return }
                switch phase {
                case .active(let p): notch.bunkHovering = true; notch.bunkLook = max(-1, min(1, (p.x - size / 2) / (size / 2)))
                case .ended: notch.bunkHovering = false; withAnimation(DS.Motion.quick) { notch.bunkLook = 0 }
                }
            }
            .onTapGesture { if interactive { notch.bunkSpeak(BunkBrain.topics(store.summary, error: store.error, preparing: store.preparing, ledger: store.ledger)) } }
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
            // The topic is a campaign (or the approvals): open its adjustment, where "Já fiz" lives.
            if let target = notch.bunkTarget {
                Button { withAnimation(DS.Motion.quick) { notch.bunkSays = nil; notch.adjust = target } } label: {
                    Text(target.campaignId == nil ? "Ver propostas" : "Ajustar").font(DS.Font.bodyStrong).foregroundStyle(DS.Color.onAccent)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(DS.Color.accent, in: Capsule())
                }.buttonStyle(.pressable)
            }
            Button { withAnimation(DS.Motion.quick) { notch.bunkSays = nil } } label: { Image(systemName: "xmark").font(DS.Icon.s).foregroundStyle(DS.Color.inkMuted).frame(width: 20, height: 20).contentShape(Rectangle()) }.buttonStyle(.pressable).help("Dispensar").accessibilityLabel("Dispensar a fala do Bunk")
        }
        .padding(.horizontal, DS.Space.m).padding(.vertical, DS.Space.s)
        .background(Tone.accent.fill, in: RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous).strokeBorder(Tone.accent.rim, lineWidth: DS.Size.hairline))
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

/// `Bunker --render-bunk file.png`: a still sheet of every mood, for review without screen capture.
@MainActor enum BunkSheet {
    static let moods: [(BunkMood, String)] = [(.idle, "tranquilo"), (.watching, "vigiando"), (.alert, "alerta"), (.happy, "feliz"), (.sleeping, "dormindo"), (.thinking, "pensando"), (.worried, "preocupado")]
    static func render(to path: String) -> Int32 {
        let reactions: [(BunkReaction?, String, Bool)] = [(.surprised, "surpreso", false), (.happy, "comemora", false), (.wink, "piscadela", false), (.yawn, "bocejo", false), (.love, "carinho", false), (nil, "andando", true)]
        let sheet = VStack(alignment: .leading, spacing: 30) {
            HStack(spacing: 28) {
                ForEach(moods, id: \.1) { m in
                    VStack(spacing: 10) {
                        BunkView(mood: m.0, size: 120)
                        Text(m.1).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundColor(.white.opacity(0.8))
                    }
                }
            }
            HStack(spacing: 28) {
                ForEach(reactions, id: \.1) { r in
                    VStack(spacing: 10) {
                        BunkView(mood: .idle, size: 120, look: r.2 ? 1 : 0, feet: true, walking: r.2, reaction: r.0)
                        Text(r.1).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundColor(.white.opacity(0.8))
                    }
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
