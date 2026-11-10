import AppKit
import SwiftUI

// Bunker design system for the Mac companion (notch island + menu bar).
//
// Three layers, each built only from the one above it:
//   1. Palette  — raw sRGB values (RGBA), with an Increase Contrast twin for every colour.
//   2. Tokens   — semantic roles (surface, ink, stroke, tone) in both contrast modes; `DS.Color` reads the live setting.
//   3. Components — Card, Pill, TintChip, Banner, ActionButton, IconButton… built only from tokens.
//
// The island is always dark on purpose: it continues the black hardware notch, so it never follows Light Mode.
// Windows outside the island (sound settings) use the system's semantic colours and follow the appearance.
// `DSAudit` (run by `--self-test`) checks contrast, the type floor, the spacing grid and concentric radii.
// References: Apple HIG (Live Activities, Typography, Color, Accessibility, Motion) and the open notch projects in
// docs/notch-research.md; summary of what was applied in docs/notch-design-system.md.

/// sRGB colour with alpha, so the self-test can composite tokens and measure contrast without drawing.
struct RGBA: Equatable {
    var r: Double, g: Double, b: Double, a: Double = 1
    static func white(_ a: Double) -> RGBA { RGBA(r: 1, g: 1, b: 1, a: a) }
    static func black(_ a: Double) -> RGBA { RGBA(r: 0, g: 0, b: 0, a: a) }
    var color: SwiftUI.Color { SwiftUI.Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
    func opacity(_ x: Double) -> RGBA { RGBA(r: r, g: g, b: b, a: a * x) }
    /// Source-over in encoded sRGB, the way SwiftUI composites the island.
    func over(_ bg: RGBA) -> RGBA {
        let oa = a + bg.a * (1 - a)
        guard oa > 0 else { return .black(0) }
        func ch(_ f: Double, _ b: Double) -> Double { (f * a + b * bg.a * (1 - a)) / oa }
        return RGBA(r: ch(r, bg.r), g: ch(g, bg.g), b: ch(b, bg.b), a: oa)
    }
    /// WCAG relative luminance.
    var luminance: Double {
        func lin(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    static func contrast(_ x: RGBA, _ y: RGBA) -> Double {
        let a = x.luminance, b = y.luminance
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}

/// 1 · Raw colours. The brand violet plus three status hues tuned for black; each has a brighter Increase Contrast twin.
enum Palette {
    static let canvas = RGBA(r: 0, g: 0, b: 0)
    static let violet = RGBA(r: 0.72, g: 0.61, b: 0.91), violetHC = RGBA(r: 0.82, g: 0.73, b: 1.0)
    static let mint = RGBA(r: 0.24, g: 0.80, b: 0.62), mintHC = RGBA(r: 0.40, g: 0.92, b: 0.74)
    static let coral = RGBA(r: 0.95, g: 0.45, b: 0.48), coralHC = RGBA(r: 1.0, g: 0.60, b: 0.62)
    static let amber = RGBA(r: 0.96, g: 0.74, b: 0.40), amberHC = RGBA(r: 1.0, g: 0.84, b: 0.54)
}

/// 2 · Semantic roles in both contrast modes (`hc` = Increase Contrast). Values are white over the black canvas.
enum Token {
    // Surfaces: one step per level of emphasis. Text tokens below keep ≥ 4.5:1 on every one of them (DSAudit).
    static func surface(_ hc: Bool) -> RGBA { .white(hc ? 0.1 : 0.055) }
    static func surfaceHover(_ hc: Bool) -> RGBA { .white(hc ? 0.15 : 0.09) }
    static func surfaceSelected(_ hc: Bool) -> RGBA { .white(hc ? 0.19 : 0.12) }
    static func stroke(_ hc: Bool) -> RGBA { .white(hc ? 0.24 : 0.08) }
    static func strokeStrong(_ hc: Bool) -> RGBA { .white(hc ? 0.36 : 0.16) }
    /// Light catching the top edge of a card (off with Increase Contrast: the stroke already does the job).
    static func highlight(_ hc: Bool) -> RGBA { .white(hc ? 0 : 0.07) }
    /// Faint rim on the open island so it reads on dark wallpapers; never on the resting notch.
    static func rim(_ hc: Bool) -> RGBA { .white(hc ? 0.22 : 0.08) }
    // Text ladder (primary → secondary → tertiary).
    static func ink(_ hc: Bool) -> RGBA { .white(hc ? 1 : 0.94) }
    static func inkSoft(_ hc: Bool) -> RGBA { .white(hc ? 0.86 : 0.72) }
    static func inkMuted(_ hc: Bool) -> RGBA { .white(hc ? 0.74 : 0.56) }
    static func inkPill(_ hc: Bool) -> RGBA { .white(hc ? 0.82 : 0.64) }
    /// Decorative only (dividers, resting chevrons): never for text that must be read.
    static func inkFaint(_ hc: Bool) -> RGBA { .white(hc ? 0.5 : 0.3) }
    static let onAccent = RGBA.black(0.86)
    static func accent(_ hc: Bool) -> RGBA { hc ? Palette.violetHC : Palette.violet }
    static func good(_ hc: Bool) -> RGBA { hc ? Palette.mintHC : Palette.mint }
    static func bad(_ hc: Bool) -> RGBA { hc ? Palette.coralHC : Palette.coral }
    static func warn(_ hc: Bool) -> RGBA { hc ? Palette.amberHC : Palette.amber }
}

enum DS {
    /// 4-pt grid (2 only for hairline gaps).
    enum Space { static let xxs: CGFloat = 2, xs: CGFloat = 4, s: CGFloat = 8, m: CGFloat = 12, l: CGFloat = 16, xl: CGFloat = 20, xxl: CGFloat = 24 }
    /// Padding of each control family, so the same kind of control is the same size everywhere.
    enum Inset {
        static let pill = EdgeInsets(top: 2, leading: 6, bottom: 2, trailing: 6)
        static let chip = EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8)
        static let control = EdgeInsets(top: 5, leading: 10, bottom: 5, trailing: 10)
        static let tab = EdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
        static let row = EdgeInsets(top: 7, leading: 8, bottom: 7, trailing: 8)
        static let field = EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8)
    }
    enum Radius {
        static let bar: CGFloat = 1, xs: CGFloat = 4, s: CGFloat = 6, m: CGFloat = 10, l: CGFloat = 14, island: CGFloat = 24
        /// Concentric corner for a shape inset inside another (HIG: even margins, concentric corners).
        static func concentric(_ outer: CGFloat, inset: CGFloat) -> CGFloat { max(outer - inset, xs) }
    }
    enum Size {
        static let iconButton: CGFloat = 24, badge: CGFloat = 26, dot: CGFloat = 7, dotSmall: CGFloat = 6
        static let peekRow: CGFloat = 30, hairline: CGFloat = 1, fieldPercent: CGFloat = 54
    }
    /// Shared opacities for states, so "disabled" or "quiet" look the same on every screen.
    enum Opacity { static let disabled: Double = 0.45, quiet: Double = 0.55, switching: Double = 0.4, restingHint: Double = 0.35 }
    enum Color {
        private static var hc: Bool { A11y.increaseContrast }
        static let canvas = Palette.canvas.color
        static var surface: SwiftUI.Color { Token.surface(hc).color }
        static var surfaceHover: SwiftUI.Color { Token.surfaceHover(hc).color }
        static var surfaceSelected: SwiftUI.Color { Token.surfaceSelected(hc).color }
        static var stroke: SwiftUI.Color { Token.stroke(hc).color }
        static var strokeStrong: SwiftUI.Color { Token.strokeStrong(hc).color }
        static var highlight: SwiftUI.Color { Token.highlight(hc).color }
        static var rim: SwiftUI.Color { Token.rim(hc).color }
        static var ink: SwiftUI.Color { Token.ink(hc).color }
        static var inkSoft: SwiftUI.Color { Token.inkSoft(hc).color }
        static var inkMuted: SwiftUI.Color { Token.inkMuted(hc).color }
        static var inkPill: SwiftUI.Color { Token.inkPill(hc).color }
        static var inkFaint: SwiftUI.Color { Token.inkFaint(hc).color }
        static let onAccent = Token.onAccent.color
        static var accent: SwiftUI.Color { Token.accent(hc).color }
        static var good: SwiftUI.Color { Token.good(hc).color }
        static var bad: SwiftUI.Color { Token.bad(hc).color }
        static var warn: SwiftUI.Color { Token.warn(hc).color }
    }
    /// Type ramp. Floor is 10 pt (HIG minimum on macOS) for anything meant to be read; numbers are rounded with
    /// monospaced digits so columns line up and values do not jitter when they change.
    enum Font {
        static let eyebrow = SwiftUI.Font.system(size: 10.5, weight: .semibold)
        static let caption = SwiftUI.Font.system(size: 10.5)
        static let captionStrong = SwiftUI.Font.system(size: 10.5, weight: .semibold)
        static let body = SwiftUI.Font.system(size: 12)
        static let bodyStrong = SwiftUI.Font.system(size: 12, weight: .semibold)
        static let title = SwiftUI.Font.system(size: 13, weight: .semibold)
        static let number = SwiftUI.Font.system(size: 12.5, weight: .semibold, design: .rounded).monospacedDigit()
        static let stat = SwiftUI.Font.system(size: 20, weight: .semibold, design: .rounded).monospacedDigit()
        /// Rotating text on the resting notch.
        static let ticker = SwiftUI.Font.system(size: 10.5, weight: .semibold, design: .rounded).monospacedDigit()
        /// Pill and badge text.
        static let pill = SwiftUI.Font.system(size: 10, weight: .semibold).monospacedDigit()
        /// Secondary lines under a value (bases, captions of captions).
        static let micro = SwiftUI.Font.system(size: 10)
        static let microStrong = SwiftUI.Font.system(size: 10, weight: .semibold)
        static let mark = SwiftUI.Font.system(size: 11, weight: .heavy)
        static let monogram = SwiftUI.Font.system(size: 11, weight: .bold, design: .rounded)
        /// Smallest sizes in the ramp, measured by DSAudit.
        static let readableSizes: [CGFloat] = [10, 10.5, 12, 12.5, 13, 20]
    }
    /// SF Symbol sizes, matched optically to the text beside them.
    enum Icon {
        static let xxs = SwiftUI.Font.system(size: 7.5, weight: .bold)
        static let xs = SwiftUI.Font.system(size: 8.5, weight: .bold)
        static let s = SwiftUI.Font.system(size: 9.5, weight: .bold)
        static let m = SwiftUI.Font.system(size: 10.5, weight: .bold)
        static let l = SwiftUI.Font.system(size: 11, weight: .semibold)
        static let badge = SwiftUI.Font.system(size: 11, weight: .bold)
    }
    /// Shadow under the island: none at rest (it is the bezel), soft when peeking or alerting, deep when open.
    enum Elevation {
        struct Shadow { let opacity: Double; let radius: CGFloat; let y: CGFloat }
        static func island(_ mode: IslandFSM.State) -> Shadow {
            switch mode {
            case .compact: return Shadow(opacity: 0, radius: 0, y: 0)
            case .peek, .alert: return Shadow(opacity: 0.3, radius: 12, y: 5)
            case .open: return Shadow(opacity: 0.5, radius: 24, y: 10)
            }
        }
    }
    /// Opening is lively, closing is firm (no bounce back toward the camera). Values studied in the MIT
    /// projects CodeIsland and DynamicNotchKit (credited in mac/NOTICE.md). Every curve stays under 2 s (HIG).
    enum Motion {
        static let open = Animation.spring(response: 0.42, dampingFraction: 0.8)
        static let close = Animation.spring(response: 0.36, dampingFraction: 1.0)
        static let spring = Animation.spring(response: 0.3, dampingFraction: 0.85)
        static let quick = Animation.easeOut(duration: 0.15)
        static let hover = Animation.easeOut(duration: 0.12)
        static let press = Animation.spring(response: 0.22, dampingFraction: 0.7)
        /// Moving selection (tab indicator): a short spring; a fade-speed ease with Reduce Motion.
        static var select: Animation { A11y.reduceMotion ? .easeInOut(duration: 0.12) : .spring(response: 0.32, dampingFraction: 0.86) }
        /// Changing numbers roll digit by digit (numeric content transition).
        static let number = Animation.spring(response: 0.45, dampingFraction: 0.9)
        /// Island changes: open for growth, close for shrinking; a plain fade when Reduce Motion is on.
        static func island(opening: Bool) -> Animation {
            if A11y.reduceMotion { return .easeInOut(duration: 0.18) }
            return opening ? open : close
        }
    }
}

/// System accessibility display settings, read where they are drawn.
enum A11y {
    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    /// Reduce Transparency: no blur transitions and opaque bubbles over other apps.
    static var reduceTransparency: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency }
    static var increaseContrast: Bool { NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast }
}

enum Tone {
    /// `tag` is for context labels (project, account): readable but quiet, so accent stays for brand and actions.
    case neutral, good, bad, warn, accent, tag
    func rgba(_ hc: Bool) -> RGBA {
        switch self { case .neutral: return Token.inkMuted(hc); case .good: return Token.good(hc); case .bad: return Token.bad(hc); case .warn: return Token.warn(hc); case .accent: return Token.accent(hc); case .tag: return Token.inkSoft(hc) }
    }
    var color: Color { rgba(A11y.increaseContrast).color }
    /// Text on this tone's own tint (neutral uses the brighter pill ink so it still passes AA).
    var text: Color { self == .neutral ? DS.Color.inkPill : color }
    /// Tint behind pills, chips and badges.
    func fillRGBA(_ hc: Bool) -> RGBA { self == .tag ? .white(hc ? 0.12 : 0.07) : rgba(hc).opacity(self == .neutral ? 0.12 : (hc ? 0.22 : 0.15)) }
    var fill: Color { fillRGBA(A11y.increaseContrast).color }
    /// Larger tinted areas (the "what changes" box, blockers).
    var wash: Color { color.opacity(A11y.increaseContrast ? 0.14 : 0.08) }
    /// Hairline in the tone's colour.
    var rim: Color { color.opacity(A11y.increaseContrast ? 0.6 : 0.3) }
    /// Glyph that says the same thing as the colour (HIG: never colour alone).
    var symbol: String {
        switch self { case .good: return "checkmark.circle.fill"; case .bad: return "exclamationmark.octagon.fill"; case .warn: return "exclamationmark.triangle.fill"; case .accent: return "sparkles"; case .neutral, .tag: return "info.circle.fill" }
    }
}

// MARK: - 3 · Components

/// Surface card with the shared radius, hairline stroke and a soft light on its top edge.
struct CardStyle: ViewModifier {
    var selected = false
    var hovered = false
    var radius: CGFloat = DS.Radius.m
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(selected ? DS.Color.surfaceSelected : hovered ? DS.Color.surfaceHover : DS.Color.surface, in: shape)
            .overlay(shape.strokeBorder(selected ? DS.Color.accent.opacity(0.7) : DS.Color.stroke, lineWidth: DS.Size.hairline))
            .overlay(shape.strokeBorder(LinearGradient(colors: [DS.Color.highlight, .clear], startPoint: .top, endPoint: .center), lineWidth: DS.Size.hairline))
    }
}
extension View {
    func card(selected: Bool = false, hovered: Bool = false, radius: CGFloat = DS.Radius.m) -> some View { modifier(CardStyle(selected: selected, hovered: hovered, radius: radius)) }
    /// Inset tile inside a card (concentric with the card's corner).
    func tile() -> some View { background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous)) }
    /// Soft fade where a scroll view meets the island's bottom edge, instead of a hard cut through a row.
    func scrollEdgeFade(bottom: CGFloat = DS.Space.l) -> some View {
        mask(VStack(spacing: 0) {
            Rectangle()
            LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: bottom)
        })
    }
    /// Live values roll digit by digit when they change (fade only with Reduce Motion).
    func numericTransition<V: Equatable>(_ value: V) -> some View {
        contentTransition(A11y.reduceMotion ? .opacity : .numericText()).animation(DS.Motion.number, value: value)
    }
}

/// Press feedback for every custom button: a slight shrink and dim, never a jump (fade only with Reduce Motion).
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !A11y.reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(DS.Motion.press, value: configuration.isPressed)
    }
}
extension ButtonStyle where Self == PressableStyle { static var pressable: PressableStyle { PressableStyle() } }

/// Hover state for small controls without needing @State (the Command Line Tools lack its macro on some setups).
final class HoverFlag: ObservableObject { @Published var on = false }

/// Small rounded label: counts, deltas, project names.
struct Pill: View {
    let text: String
    var tone: Tone = .neutral
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(DS.Icon.xs) }
            Text(text).font(DS.Font.pill)
        }
        .lineLimit(1)
        .padding(DS.Inset.pill)
        .foregroundStyle(tone.text)
        .background(tone.fill, in: Capsule())
    }
}

/// Tinted capsule with a glyph: quick actions, verdicts and "abrir" on alerts. Same size and tint everywhere.
struct TintChip: View {
    let text: String
    var icon: String? = nil
    var trailingIcon: String? = nil
    var tone: Tone = .accent
    var outlined = false
    var font = DS.Font.microStrong
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(DS.Icon.xs) }
            Text(text).font(font).lineLimit(1)
            if let trailingIcon { Image(systemName: trailingIcon).font(DS.Icon.xs) }
        }
        .fixedSize()
        .padding(DS.Inset.chip)
        .foregroundStyle(tone.color)
        .background(tone.fill, in: Capsule())
        .overlay(Capsule().strokeBorder(outlined ? tone.rim : .clear))
        .contentShape(Capsule())
    }
}

struct SectionHeader: View {
    let title: String
    var detail: String? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
            Text(title).font(DS.Font.eyebrow).foregroundStyle(DS.Color.inkSoft)
            if let detail { Text(detail).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1).truncationMode(.tail).help(detail) }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Status dot with a soft halo; `pulse` adds a slow ring for states that need a look (off with Reduce Motion).
struct StatusDot: View {
    let tone: Tone
    var size: CGFloat = DS.Size.dot
    var pulse = false
    var body: some View {
        Circle().fill(tone.color).frame(width: size, height: size)
            .background(Circle().fill(tone.color.opacity(0.25)).frame(width: size + 6, height: size + 6))
            .background {
                if pulse && !A11y.reduceMotion {
                    Circle().stroke(tone.color, lineWidth: 1).frame(width: size, height: size)
                        .phaseAnimator([false, true]) { ring, grown in ring.scaleEffect(grown ? 2.4 : 1).opacity(grown ? 0 : 0.7) } animation: { grown in grown ? .easeOut(duration: 1.6) : .linear(duration: 0) }
                }
            }
            .accessibilityHidden(true)
    }
}

/// Square icon badge used at the start of list rows. Decorative: the row's text says the same.
struct IconBadge: View {
    let symbol: String
    let tone: Tone
    var body: some View {
        Image(systemName: symbol).font(DS.Icon.badge).foregroundStyle(tone.color)
            .frame(width: DS.Size.badge, height: DS.Size.badge)
            .background(tone.fill, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Initial in a tinted circle or rounded square (projects, agents).
struct Monogram: View {
    let text: String
    var tone: Tone = .accent
    var circle = false
    var body: some View {
        Text(String(text.prefix(1)).uppercased()).font(DS.Font.monogram)
            .frame(width: DS.Size.badge, height: DS.Size.badge)
            .foregroundStyle(tone.color)
            .background(tone.fill, in: circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous)))
            .accessibilityHidden(true)
    }
}

/// Capsule action. `prominent` is the one primary action of a screen (accent fill); the rest are quiet.
/// Hover brightens, press shrinks slightly, disabled dims (reads `isEnabled`, so call sites only set `.disabled`).
struct ActionButton: View {
    let title: String; var icon: String? = nil; var leadingIcon = false; var prominent = false; let help: String; let action: () -> Void
    @Environment(\.isEnabled) private var enabled
    @StateObject private var hover = HoverFlag()
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if leadingIcon, let icon { Image(systemName: icon).font(DS.Icon.m) }
                Text(title).font(DS.Font.bodyStrong)
                if !leadingIcon, let icon { Image(systemName: icon).font(DS.Icon.s) }
            }
            .padding(DS.Inset.control)
            .foregroundStyle(prominent ? DS.Color.onAccent : DS.Color.ink)
            .background {
                if prominent {
                    Capsule().fill(DS.Color.accent)
                        .overlay(Capsule().fill(LinearGradient(colors: [.white.opacity(hover.on && enabled ? 0.22 : 0.12), .clear], startPoint: .top, endPoint: .bottom)))
                } else {
                    Capsule().fill(hover.on && enabled ? DS.Color.surfaceHover : DS.Color.surface)
                }
            }
            .overlay(Capsule().strokeBorder(prominent ? SwiftUI.Color.clear : hover.on && enabled ? DS.Color.strokeStrong : DS.Color.stroke))
            .contentShape(Capsule())
            .opacity(enabled ? 1 : DS.Opacity.disabled)
        }
        .buttonStyle(.pressable).help(help)
        .onHover { inside in withAnimation(DS.Motion.hover) { hover.on = inside } }
    }
}

/// Round icon-only control. Hover lifts its surface; `active` marks a toggled state (pin).
struct IconButton: View {
    let symbol: String; let help: String; var spinning = false; var active = false; let action: () -> Void
    @StateObject private var hover = HoverFlag()
    var body: some View {
        Button(action: action) {
            // Reduce Motion: no endless spin; the dimmed icon still says it is working.
            let spin = spinning && !A11y.reduceMotion
            Image(systemName: symbol).font(DS.Icon.l)
                .rotationEffect(.degrees(spin ? 360 : 0))
                .animation(spin ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: spin)
                .opacity(spinning && !spin ? 0.5 : 1)
                .frame(width: DS.Size.iconButton, height: DS.Size.iconButton)
                .foregroundStyle(active ? DS.Color.accent : hover.on ? DS.Color.ink : DS.Color.inkSoft)
                .background(active ? DS.Color.accent.opacity(0.18) : hover.on ? DS.Color.surfaceHover : DS.Color.surface, in: Circle())
                .overlay(Circle().strokeBorder(hover.on && !active ? DS.Color.stroke : .clear))
                .contentShape(Circle())
        }
        .buttonStyle(.pressable).help(help)
        .onHover { inside in withAnimation(DS.Motion.hover) { hover.on = inside } }
        // VoiceOver reads the purpose, not the symbol name ("arrow.clockwise").
        .accessibilityLabel(help)
    }
}

/// Message strip at the top of a screen: the glyph matches the tone (check, info, warning, stop), with a hairline.
struct Banner: View {
    let text: String; let tone: Tone
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
            Image(systemName: tone.symbol).font(DS.Icon.l).foregroundStyle(tone.color)
            Text(text).font(DS.Font.body).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, DS.Space.m).padding(.vertical, DS.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous).strokeBorder(tone.color.opacity(0.22)))
        .accessibilityElement(children: .combine)
    }
}

/// One-line empty or waiting state. `clear` (green check) only when "nothing to do" is good news.
struct EmptyLine: View {
    enum Kind { case clear, info, waiting }
    let text: String
    var kind: Kind = .clear
    var body: some View {
        HStack(spacing: DS.Space.s) {
            Image(systemName: kind == .clear ? "checkmark.circle" : kind == .info ? "info.circle" : "clock")
                .foregroundStyle(kind == .clear ? DS.Color.good : DS.Color.inkMuted)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(DS.Font.body).foregroundStyle(DS.Color.inkMuted).padding(.vertical, DS.Space.s)
        .accessibilityElement(children: .combine)
    }
}

/// Loading placeholder with the shape of the content it stands for (a soft breathing tint, still with Reduce Motion).
struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat = 10
    var body: some View {
        RoundedRectangle(cornerRadius: DS.Radius.xs, style: .continuous).fill(DS.Color.surfaceHover)
            .frame(width: width, height: height)
            .modifier(Breathing())
            .accessibilityHidden(true)
    }
}
private struct Breathing: ViewModifier {
    func body(content: Content) -> some View {
        if A11y.reduceMotion { content } else {
            content.phaseAnimator([false, true]) { v, dim in v.opacity(dim ? 0.45 : 1) } animation: { _ in .easeInOut(duration: 0.9) }
        }
    }
}

/// Text input on the island: same surface, radius and hairline as the cards (the system rounded border reads
/// as a light box on black). Focus brightens the stroke to the accent.
struct IslandFieldStyle: TextFieldStyle {
    @FocusState private var focused: Bool
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .font(DS.Font.body)
            .foregroundStyle(DS.Color.ink)
            .focused($focused)
            .padding(DS.Inset.field)
            .background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous).stroke(focused ? DS.Color.accent.opacity(0.8) : DS.Color.stroke, lineWidth: DS.Size.hairline))
            .animation(DS.Motion.hover, value: focused)
    }
}
extension TextFieldStyle where Self == IslandFieldStyle { static var island: IslandFieldStyle { IslandFieldStyle() } }

// MARK: - Audit (run by --self-test)

/// Design-system checks: every text token keeps WCAG AA (4.5:1) on every surface it sits on, in both contrast modes;
/// tone text keeps AA on its own tint; the type ramp has a 10-pt floor; spacing stays on the 4-pt grid; inner radii are
/// concentric with the island. Returns the number of failures.
enum DSAudit {
    static func run() -> Int {
        var failures = 0
        func check(_ ok: Bool, _ what: String) { if !ok { failures += 1; FileHandle.standardError.write(Data("design-system: \(what)\n".utf8)) } }
        let canvas = Palette.canvas
        for hc in [false, true] {
            let mode = hc ? "alto contraste" : "padrão"
            let surfaces: [(String, RGBA)] = [("canvas", canvas), ("surface", Token.surface(hc).over(canvas)), ("hover", Token.surfaceHover(hc).over(canvas)), ("selected", Token.surfaceSelected(hc).over(canvas))]
            let texts: [(String, RGBA)] = [("ink", Token.ink(hc)), ("inkSoft", Token.inkSoft(hc)), ("inkMuted", Token.inkMuted(hc)), ("inkPill", Token.inkPill(hc))]
            for (sn, s) in surfaces { for (tn, t) in texts {
                let c = RGBA.contrast(t.over(s), s)
                check(c >= 4.5, "\(tn) sobre \(sn) (\(mode)) = \(String(format: "%.2f", c)):1, abaixo de 4,5:1")
            } }
            // Status colours as text on the canvas, on cards, and on their own tint (pills, chips, badges).
            for tone in [Tone.good, .bad, .warn, .accent, .neutral, .tag] {
                let text = tone == .neutral ? Token.inkPill(hc) : tone.rgba(hc)
                for (sn, s) in surfaces.prefix(2) {
                    let tint = tone.fillRGBA(hc).over(s)
                    let c = RGBA.contrast(text.over(tint), tint)
                    check(c >= 4.5, "\(tone) sobre a própria cor em \(sn) (\(mode)) = \(String(format: "%.2f", c)):1")
                }
            }
            // Text on the accent button.
            let onAccent = RGBA.contrast(Token.onAccent.over(Token.accent(hc)), Token.accent(hc))
            check(onAccent >= 4.5, "texto sobre o botão principal (\(mode)) = \(String(format: "%.2f", onAccent)):1")
            // Increase Contrast must never be weaker than the default.
            check(Token.stroke(hc).a >= Token.stroke(false).a && Token.inkMuted(hc).a >= Token.inkMuted(false).a, "alto contraste mais fraco que o padrão")
        }
        check(DS.Font.readableSizes.allSatisfy { $0 >= 10 }, "texto abaixo de 10 pt")
        check(DS.Font.readableSizes == DS.Font.readableSizes.sorted(), "escala tipográfica fora de ordem")
        let grid: [CGFloat] = [DS.Space.xs, DS.Space.s, DS.Space.m, DS.Space.l, DS.Space.xl, DS.Space.xxl]
        check(grid.allSatisfy { $0.truncatingRemainder(dividingBy: 4) == 0 } && grid == grid.sorted(), "espaçamento fora da grade de 4 pt")
        // Cards inside the open island (20 pt side padding) must not have a bigger corner than the island allows.
        check(DS.Radius.m <= DS.Radius.concentric(DS.Radius.island, inset: DS.Space.s) + 0.001, "raio do card não concêntrico com a ilha")
        check(DS.Radius.s < DS.Radius.m && DS.Radius.m < DS.Radius.l && DS.Radius.l < DS.Radius.island, "raios fora de ordem")
        check(DS.Size.iconButton >= 20 && DS.Size.badge >= 20, "alvo de clique abaixo de 20 pt")
        return failures
    }
}
