import AppKit
import SwiftUI

/// Bunker design tokens for the Mac companion. One source for colour, type, spacing and shape,
/// aligned with the web dashboard's dark theme (ink / muted / accent / success / danger / warning).
enum DS {
    enum Space { static let xxs: CGFloat = 2, xs: CGFloat = 4, s: CGFloat = 8, m: CGFloat = 12, l: CGFloat = 16, xl: CGFloat = 20 }
    enum Radius { static let s: CGFloat = 6, m: CGFloat = 10, l: CGFloat = 14, island: CGFloat = 24 }
    enum Color {
        static let canvas = SwiftUI.Color.black
        // Increase Contrast: stronger surfaces, strokes and muted text (read at render time).
        static var surface: SwiftUI.Color { SwiftUI.Color.white.opacity(A11y.increaseContrast ? 0.1 : 0.055) }
        static let surfaceHover = SwiftUI.Color.white.opacity(0.09)
        static let surfaceSelected = SwiftUI.Color.white.opacity(0.12)
        static var stroke: SwiftUI.Color { SwiftUI.Color.white.opacity(A11y.increaseContrast ? 0.24 : 0.08) }
        static let ink = SwiftUI.Color.white.opacity(0.94)
        static let inkSoft = SwiftUI.Color.white.opacity(0.72)
        static var inkMuted: SwiftUI.Color { SwiftUI.Color.white.opacity(A11y.increaseContrast ? 0.7 : 0.5) }
        static let accent = SwiftUI.Color(red: 0.72, green: 0.61, blue: 0.91)
        static let good = SwiftUI.Color(red: 0.24, green: 0.80, blue: 0.62)
        static let bad = SwiftUI.Color(red: 0.95, green: 0.45, blue: 0.48)
        static let warn = SwiftUI.Color(red: 0.96, green: 0.74, blue: 0.40)
    }
    enum Font {
        static let eyebrow = SwiftUI.Font.system(size: 10, weight: .semibold)
        static let caption = SwiftUI.Font.system(size: 10.5)
        static let body = SwiftUI.Font.system(size: 12)
        static let bodyStrong = SwiftUI.Font.system(size: 12, weight: .semibold)
        static let number = SwiftUI.Font.system(size: 12.5, weight: .semibold, design: .rounded).monospacedDigit()
        static let stat = SwiftUI.Font.system(size: 20, weight: .semibold, design: .rounded).monospacedDigit()
        /// Secondary lines under a value (bases, captions of captions).
        static let micro = SwiftUI.Font.system(size: 9.5)
        static let microStrong = SwiftUI.Font.system(size: 9.5, weight: .semibold)
        static let mark = SwiftUI.Font.system(size: 11, weight: .heavy)
    }
    /// Opening is lively, closing is firm (no bounce back toward the camera). Values studied in the MIT
    /// projects CodeIsland and DynamicNotchKit (credited in mac/NOTICE.md).
    enum Motion {
        static let open = Animation.spring(response: 0.42, dampingFraction: 0.8)
        static let close = Animation.spring(response: 0.36, dampingFraction: 1.0)
        static let spring = Animation.spring(response: 0.3, dampingFraction: 0.85)
        static let quick = Animation.easeOut(duration: 0.15)
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
    var color: Color {
        switch self { case .neutral: return DS.Color.inkMuted; case .good: return DS.Color.good; case .bad: return DS.Color.bad; case .warn: return DS.Color.warn; case .accent: return DS.Color.accent; case .tag: return DS.Color.inkSoft }
    }
}

/// Surface card with the shared radius and hairline stroke.
struct CardStyle: ViewModifier {
    var selected = false
    var hovered = false
    func body(content: Content) -> some View {
        content
            .background(selected ? DS.Color.surfaceSelected : hovered ? DS.Color.surfaceHover : DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous).stroke(selected ? DS.Color.accent.opacity(0.7) : DS.Color.stroke, lineWidth: 1))
    }
}
extension View {
    func card(selected: Bool = false, hovered: Bool = false) -> some View { modifier(CardStyle(selected: selected, hovered: hovered)) }
}

/// Small rounded label: counts, deltas, project names.
struct Pill: View {
    let text: String
    var tone: Tone = .neutral
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 8.5, weight: .bold)) }
            Text(text).font(.system(size: 10, weight: .semibold)).monospacedDigit()
        }
        .lineLimit(1)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .foregroundStyle(tone.color)
        .background(tone == .tag ? SwiftUI.Color.white.opacity(0.07) : tone.color.opacity(tone == .neutral ? 0.12 : 0.15), in: Capsule())
    }
}

struct SectionHeader: View {
    let title: String
    var detail: String? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
            Text(title).font(DS.Font.eyebrow).foregroundStyle(DS.Color.inkSoft)
            if let detail { Text(detail).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1) }
            Spacer(minLength: 0)
        }
    }
}

/// Status dot with an optional soft halo for attention.
struct StatusDot: View {
    let tone: Tone
    var size: CGFloat = 7
    var body: some View {
        Circle().fill(tone.color).frame(width: size, height: size)
            .background(Circle().fill(tone.color.opacity(0.25)).frame(width: size + 6, height: size + 6))
    }
}

/// Square icon badge used at the start of list rows.
struct IconBadge: View {
    let symbol: String
    let tone: Tone
    var body: some View {
        Image(systemName: symbol).font(.system(size: 11, weight: .bold)).foregroundStyle(tone.color)
            .frame(width: 26, height: 26)
            .background(tone.color.opacity(0.14), in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
    }
}

/// Capsule action. `prominent` is the one primary action of a screen (accent fill); the rest are quiet.
struct ActionButton: View {
    let title: String; var icon: String? = nil; var leadingIcon = false; var prominent = false; let help: String; let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if leadingIcon, let icon { Image(systemName: icon).font(.system(size: 10, weight: .bold)) }
                Text(title).font(DS.Font.bodyStrong)
                if !leadingIcon, let icon { Image(systemName: icon).font(.system(size: 9.5, weight: .bold)) }
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(prominent ? SwiftUI.Color.black.opacity(0.85) : DS.Color.ink)
            .background(prominent ? DS.Color.accent : DS.Color.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(prominent ? SwiftUI.Color.clear : DS.Color.stroke))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain).help(help)
    }
}

/// Text input on the island: same surface, radius and hairline as the cards (the system rounded border reads
/// as a light box on black). Focus brightens the stroke.
struct IslandFieldStyle: TextFieldStyle {
    @FocusState private var focused: Bool
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .font(DS.Font.body)
            .foregroundStyle(DS.Color.ink)
            .focused($focused)
            .padding(.horizontal, DS.Space.s).padding(.vertical, 6)
            .background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous).stroke(focused ? DS.Color.accent.opacity(0.8) : DS.Color.stroke, lineWidth: 1))
    }
}
extension TextFieldStyle where Self == IslandFieldStyle { static var island: IslandFieldStyle { IslandFieldStyle() } }
