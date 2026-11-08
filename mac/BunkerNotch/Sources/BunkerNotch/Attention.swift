import ColorSync
import CoreGraphics
import Foundation

/// What the owner chose to stop hearing about. Pure value, saved in UserDefaults; testable in `--self-test`.
/// A dismissed item keeps the signature it had: it comes back only when its state changes (another ROAS band,
/// status or period) or the loss reaches 1.5× what it was when dismissed. A snoozed item stays quiet until the chosen time.
/// Ideas from notchd (Apache-2.0, dismiss by signature) and Perch (MIT, snooze); rewritten for the Bunker.
struct AttentionLedger: Equatable, Codable {
    var dismissed: [String: String] = [:]
    var snoozed: [String: Double] = [:]

    static let storeKey = "attentionLedger"
    static let approvalsKey = "approvals"
    static let limitKey = "accounts-limit"
    static let maxDismissed = 300

    static func key(_ q: Summary.QueueItem) -> String { "q:" + q.id }
    /// ROAS band (break-even and above-target steps), status and period. The amount is kept apart (see `dismissed`).
    static func signature(_ q: Summary.QueueItem) -> String {
        let roas: String = {
            guard let r = q.roas, r.isFinite else { return "nd" }
            return String([0.5, 1, 1.5, 2].filter { r >= $0 }.count)
        }()
        return [q.kind, q.period ?? "", (q.detail?.status ?? "").uppercased(), roas].joined(separator: "|")
    }
    /// What `dismissed` stores: the signature plus the loss amount at that moment ("…#120").
    static func mark(_ q: Summary.QueueItem) -> String { signature(q) + "#" + (q.amount.map { String(abs($0)) } ?? "nd") }
    static let growth = 1.5
    /// Still the dismissed state: same signature and the loss has not grown to 1.5× the dismissed amount.
    static func same(_ q: Summary.QueueItem, as stored: String) -> Bool {
        let parts = stored.split(separator: "#", maxSplits: 1).map(String.init)
        guard parts.first == signature(q) else { return false }
        guard parts.count == 2, let before = Double(parts[1]), let now = q.amount.map(abs) else { return true }
        return now < before * growth
    }

    func isQuiet(key: String, signature: String? = nil, now: Date = Date()) -> Bool {
        if let until = snoozed[key], until > now.timeIntervalSince1970 { return true }
        if let signature, dismissed[key] == signature { return true }
        return false
    }
    func isQuiet(_ q: Summary.QueueItem, now: Date = Date()) -> Bool {
        isQuiet(key: Self.key(q), now: now) || isDismissed(q)
    }
    func isDismissed(_ q: Summary.QueueItem) -> Bool { dismissed[Self.key(q)].map { Self.same(q, as: $0) } ?? false }
    /// Dismissed earlier, and its state has changed since.
    func cameBack(_ q: Summary.QueueItem) -> Bool { dismissed[Self.key(q)].map { !Self.same(q, as: $0) } ?? false }
    func snoozedUntil(_ key: String, now: Date = Date()) -> Date? {
        snoozed[key].map { Date(timeIntervalSince1970: $0) }.flatMap { $0 > now ? $0 : nil }
    }

    mutating func dismiss(_ q: Summary.QueueItem) { dismissed[Self.key(q)] = Self.mark(q); trim() }
    mutating func snooze(_ key: String, until: Date) { snoozed[key] = until.timeIntervalSince1970 }
    mutating func restore(_ key: String) { dismissed[key] = nil; snoozed[key] = nil }
    /// Expired snoozes go away; the oldest dismissals are dropped past the cap (they would only re-alert once).
    mutating func prune(now: Date = Date()) {
        snoozed = snoozed.filter { $0.value > now.timeIntervalSince1970 }
        trim()
    }
    private mutating func trim() {
        if dismissed.count > Self.maxDismissed { dismissed = Dictionary(uniqueKeysWithValues: dismissed.sorted { $0.key < $1.key }.suffix(Self.maxDismissed).map { ($0.key, $0.value) }) }
    }

    /// The three snooze choices: 30 minutes, 2 hours, tomorrow at 08:00 (local time).
    enum Snooze: CaseIterable { case halfHour, twoHours, tomorrow
        var label: String { switch self { case .halfHour: return "Adiar 30 min"; case .twoHours: return "Adiar 2 h"; case .tomorrow: return "Adiar até amanhã 8h" } }
        func until(from now: Date, calendar: Calendar = .current) -> Date {
            switch self {
            case .halfHour: return now.addingTimeInterval(30 * 60)
            case .twoHours: return now.addingTimeInterval(2 * 3600)
            case .tomorrow: return calendar.date(bySettingHour: 8, minute: 0, second: 0, of: calendar.date(byAdding: .day, value: 1, to: now)!)!
            }
        }
    }

    static func load(_ defaults: UserDefaults = .standard) -> AttentionLedger {
        guard let data = defaults.data(forKey: storeKey), let l = try? JSONDecoder().decode(AttentionLedger.self, from: data) else { return AttentionLedger() }
        return l
    }
    func save(_ defaults: UserDefaults = .standard) { if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.storeKey) } }
}

/// Summary refresh cadence: faster while the island is open, slower at rest, doubling back-off after failures.
/// Idea from codex-pacer's refresh policy (MIT); values are the Bunker's.
enum RefreshPolicy {
    static let open: TimeInterval = 60, closed: TimeInterval = 120, ceiling: TimeInterval = 900
    static func interval(open isOpen: Bool, failures: Int) -> TimeInterval {
        guard failures > 0 else { return isOpen ? open : closed }
        return min(ceiling, closed * pow(2, Double(min(failures, 4))))
    }
}

/// Opening by intention: pushing against the top edge opens at once; otherwise the pointer must rest briefly
/// on the island, and a fast sideways pass (heading for a menu) restarts the wait. Leaving uses a wider margin
/// than entering so the edge does not flicker. Ideas from udeck (Apache-2.0) and notchi (MIT); rewritten.
struct HoverIntent: Equatable {
    static let dwell: TimeInterval = 0.12
    static let lateralSpeed: CGFloat = 1100   // pt/s
    static let leaveMargin: CGFloat = 6
    enum Decision: Equatable { case none, enter, wait(TimeInterval) }
    private(set) var enteredAt: Date?
    private var last: (p: CGPoint, t: Date)?

    static func == (a: HoverIntent, b: HoverIntent) -> Bool { a.enteredAt == b.enteredAt }

    mutating func feed(_ p: CGPoint, at t: Date, inside: Bool, atTopEdge: Bool) -> Decision {
        defer { last = (p, t) }
        guard inside else { enteredAt = nil; return .none }
        if atTopEdge { return .enter }
        var speed: CGFloat = 0
        if let last, t > last.t { speed = abs(p.x - last.p.x) / CGFloat(t.timeIntervalSince(last.t)) }
        if enteredAt == nil || speed > Self.lateralSpeed { enteredAt = t; return .wait(Self.dwell) }
        let waited = t.timeIntervalSince(enteredAt!)
        return waited >= Self.dwell ? .enter : .wait(Self.dwell - waited)
    }
    mutating func reset() { enteredAt = nil; last = nil }
}

/// Displays named by their UUID, which survives unplugging and plugging back (the numeric id may change).
enum DisplayKey {
    static func uuid(_ id: CGDirectDisplayID) -> String? {
        guard let u = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return nil }
        return CFUUIDCreateString(nil, u) as String?
    }
}
