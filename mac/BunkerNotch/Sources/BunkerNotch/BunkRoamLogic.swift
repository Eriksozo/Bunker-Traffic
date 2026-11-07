import CoreGraphics
import Foundation

/// Why Bunk leaves the notch. Pure values: no AppKit, testable in `--self-test`.
enum RoamReason: Equatable {
    case attention(IslandAlert.Kind)   // something needs the owner: tour of every screen
    case manager                       // another manager acted: short visit on the pointer's screen
    case idle                          // calm day: occasional stroll with a summary
    case demo                          // "Chamar o Bunk agora"
    var tour: Bool { if case .attention = self { return true }; return self == .demo }
}

/// How often Bunk may roam. Off, muted or outside the operation window: never (except the manual demo).
enum RoamPolicy {
    static let attentionGap: TimeInterval = 5 * 60, managerGap: TimeInterval = 15 * 60, idleGap: TimeInterval = 40 * 60
    struct Memory: Equatable { var lastAttention: Date?; var lastManager: Date?; var lastAny: Date? }
    static func allow(_ reason: RoamReason, memory m: Memory, now: Date, enabled: Bool, muted: Bool, awake: Bool, busy: Bool) -> Bool {
        if reason == .demo { return !busy }
        guard enabled, !muted, !busy else { return false }
        switch reason {
        case .attention(let kind):
            if kind == .approval { return true }
            return m.lastAttention.map { now.timeIntervalSince($0) >= attentionGap } ?? true
        case .manager:
            guard awake else { return false }
            return m.lastManager.map { now.timeIntervalSince($0) >= managerGap } ?? true
        case .idle:
            guard awake else { return false }
            return m.lastAny.map { now.timeIntervalSince($0) >= idleGap } ?? true
        case .demo: return true
        }
    }
    /// Adds a new item to what Bunk is saying (no repeats, at most 4 topics in one walk).
    static func merge(_ lines: [String], _ text: String) -> [String] {
        lines.contains(text) ? lines : Array((lines + [text]).suffix(4))
    }
    static func remember(_ reason: RoamReason, _ m: Memory, now: Date) -> Memory {
        var m = m; m.lastAny = now
        if case .attention = reason { m.lastAttention = now }
        if reason == .manager { m.lastManager = now }
        return m
    }
}

/// A stop on Bunk's path: where his feet go (screen coordinates, origin bottom-left), how long he stays, whether he talks.
struct RoamStop: Equatable { let point: CGPoint; let pause: TimeInterval; let speak: Bool }

enum RoamPlanner {
    static let floorInset: CGFloat = 6
    /// Tour: out of the notch, centre of the notch screen, then every other screen left to right, back into the notch.
    /// Visit: walks in from the right of the pointer's screen, stops in the middle, leaves to the left.
    /// `screens` are only the screens the owner allowed; the notch screen is a stop only when it is one of them.
    static func route(reason: RoamReason, notchScreen: CGRect, notchVisible: CGRect, screens: [(frame: CGRect, visible: CGRect)], pointerScreen: CGRect?, width: CGFloat) -> [RoamStop] {
        func floor(_ v: CGRect) -> CGFloat { v.minY + floorInset }
        let notchAllowed = screens.contains { $0.frame == notchScreen }
        if reason.tour {
            let start = CGPoint(x: notchScreen.midX, y: notchVisible.maxY - 70)
            var stops = [RoamStop(point: start, pause: 0, speak: false)]
            if notchAllowed { stops.append(RoamStop(point: CGPoint(x: notchVisible.midX, y: floor(notchVisible)), pause: 6, speak: true)) }
            for s in screens.sorted(by: { $0.frame.minX < $1.frame.minX }) where s.frame != notchScreen {
                stops.append(RoamStop(point: CGPoint(x: s.visible.midX, y: floor(s.visible)), pause: stops.count == 1 ? 6 : 3.5, speak: true))
            }
            if notchAllowed && stops.count > 2 { stops.append(RoamStop(point: CGPoint(x: notchVisible.midX, y: floor(notchVisible)), pause: 0.6, speak: false)) }
            stops.append(RoamStop(point: start, pause: 0, speak: false))
            return stops
        }
        let v = screens.first(where: { pointerScreen != nil && $0.frame == pointerScreen! })?.visible ?? screens.first?.visible ?? notchVisible
        let y = floor(v)
        return [RoamStop(point: CGPoint(x: v.maxX + width, y: y), pause: 0, speak: false),
                RoamStop(point: CGPoint(x: v.midX, y: y), pause: reason == .manager ? 4.5 : 5.5, speak: true),
                RoamStop(point: CGPoint(x: v.minX - width, y: y), pause: 0, speak: false)]
    }
}

/// Geometry and rules for Bunk out of the notch. Mechanics studied in the MIT-licensed code credited in
/// mac/NOTICE.md (click-through except over the body, clamped drag, idle sleep, smooth gaze); Bunk's look is his own.
enum BunkDesk {
    static let panel = CGSize(width: 300, height: 170)
    static let bunkSize: CGFloat = 72
    static let footInset: CGFloat = 6
    static let margin: CGFloat = 24
    static let sleepAfter: TimeInterval = 120
    static let sleepMouseDistance: CGFloat = 150

    /// Panel origin for Bunk's feet at `feet` (screen coordinates, origin bottom-left), and back.
    static func origin(feet: CGPoint) -> CGPoint { CGPoint(x: feet.x - panel.width / 2, y: feet.y - footInset) }
    static func feet(origin: CGPoint) -> CGPoint { CGPoint(x: origin.x + panel.width / 2, y: origin.y + footInset) }
    /// Bunk's body inside the panel (AppKit local coordinates, y up).
    static var body: CGRect { CGRect(x: panel.width / 2 - bunkSize / 2, y: footInset, width: bunkSize, height: bunkSize) }
    /// The speech bubble sits above the body.
    static var bubble: CGRect { CGRect(x: 0, y: footInset + bunkSize + 2, width: panel.width, height: panel.height - footInset - bunkSize - 2) }
    static func isOverBody(_ local: CGPoint) -> Bool { body.insetBy(dx: 8, dy: 2).contains(local) }
    /// Keeps the whole body on the visible part of a screen.
    static func clamp(feet p: CGPoint, visible v: CGRect) -> CGPoint {
        CGPoint(x: min(max(p.x, v.minX + margin + bunkSize / 2), v.maxX - margin - bunkSize / 2),
                y: min(max(p.y, v.minY + RoamPlanner.floorInset), v.maxY - panel.height))
    }
    /// A window covering a whole screen (2 pt tolerance) means a full-screen app there.
    static func coversScreen(_ window: CGRect, _ screen: CGRect) -> Bool {
        abs(window.minX - screen.minX) <= 2 && abs(window.minY - screen.minY) <= 2 && abs(window.width - screen.width) <= 2 && abs(window.height - screen.height) <= 2
    }
    static func shouldSleep(idle: TimeInterval, mouseDistance: CGFloat) -> Bool { idle > sleepAfter && mouseDistance >= sleepMouseDistance }
    /// Gaze toward the pointer: x right positive, y down positive (pointer above → looks up).
    static func gaze(dx: CGFloat, dy: CGFloat) -> (x: CGFloat, y: CGFloat) { (CGFloat(tanh(Double(dx / 260))), CGFloat(-tanh(Double(dy / 200)))) }
    /// One frame of walking: moves at most `distance` toward `target`; true when arrived.
    static func step(from p: CGPoint, to target: CGPoint, distance: CGFloat) -> (point: CGPoint, arrived: Bool) {
        let dx = target.x - p.x, dy = target.y - p.y, d = (dx * dx + dy * dy).squareRoot()
        if d <= distance || d == 0 { return (target, true) }
        return (CGPoint(x: p.x + dx / d * distance, y: p.y + dy / d * distance), false)
    }
}

/// Which screens Bunk may walk and talk on. Empty list (or none still connected) = every screen.
enum BunkScreens {
    static let key = "bunkScreens"
    static func allowed(all ids: [UInt32], saved: [UInt32]) -> [UInt32] {
        let kept = ids.filter { saved.contains($0) }
        return saved.isEmpty || kept.isEmpty ? ids : kept
    }
    /// Toggling the last allowed screen off means "every screen" again, never "no screen".
    static func toggle(_ id: UInt32, all ids: [UInt32], saved: [UInt32]) -> [UInt32] {
        var current = allowed(all: ids, saved: saved)
        if current.contains(id) { current.removeAll { $0 == id } } else { current.append(id) }
        return current.isEmpty || Set(current) == Set(ids) ? [] : current.sorted()
    }
}

/// Optional: keep the notch and Bunk out of screen recordings, screenshots and shared screens (off by default,
/// since it also hides them from the owner's own screenshots).
enum CapturePrivacy { static let key = "hideFromCapture" }
