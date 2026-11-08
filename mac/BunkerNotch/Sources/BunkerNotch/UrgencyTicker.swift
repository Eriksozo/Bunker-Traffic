import Foundation

/// The resting island's rotating line, most urgent first. Urgent items take two turns per cycle and a newly
/// urgent item is shown at once. Idea from CodeIsland's compact-bar rotation (MIT, credited in mac/NOTICE.md),
/// rewritten without Swift macros.
enum UrgencyTicker {
    struct Item: Equatable { let key: String; let text: String; let tone: Tone; let urgent: Bool }

    /// Short campaign label for a ~90 pt ear: the last naming segment (e.g. "JHON_A_357_H1" → "A_357_H1").
    static func shortName(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return "campanha" }
        let last = name.components(separatedBy: " - ").last?.trimmingCharacters(in: .whitespaces) ?? name
        let parts = last.split(separator: "_")
        let core = parts.count > 2 ? parts.dropFirst().joined(separator: "_") : last
        return String(core.prefix(10))
    }

    /// `ledger` keeps dismissed and snoozed items out of the rotation; `staleMinutes` adds a data-age line.
    static func items(_ s: Summary?, recentChange: String?, ledger: AttentionLedger = AttentionLedger(), staleMinutes: Int? = nil, now: Date = Date()) -> [Item] {
        guard let s else { return [] }
        var urgent: [Item] = []
        if s.approvals.count > 0, !ledger.isQuiet(key: AttentionLedger.approvalsKey, now: now) { urgent.append(Item(key: "approvals:\(s.approvals.count)", text: "⚑ \(s.approvals.count) p/ aprovar", tone: .warn, urgent: true)) }
        if let loss = s.queue.first(where: { $0.kind == "loss" && !ledger.isQuiet($0, now: now) }) {
            urgent.append(Item(key: "loss:\(loss.id)", text: "↓ \(shortName(loss.campaign)) −\(Format.compactMoney(loss.amount))", tone: .bad, urgent: true))
        }
        if let n = s.accounts?.counts.nearLimit, n > 0, !ledger.isQuiet(key: AttentionLedger.limitKey, now: now) { urgent.append(Item(key: "limit:\(n)", text: "◔ \(n) conta(s) no limite", tone: .bad, urgent: true)) }
        var calm = [Item(key: "roas", text: "ROAS " + Format.ratio(s.today.today?.roas), tone: .neutral, urgent: false),
                    Item(key: "spend", text: "Gasto " + Format.compactMoney(s.today.today?.spend), tone: .neutral, urgent: false)]
        if let p = s.pace, p.status != "nd" { calm.append(Item(key: "pace", text: Format.pace(p), tone: Format.paceTone(p), urgent: false)) }
        if let recentChange { calm.append(Item(key: "change", text: recentChange, tone: .neutral, urgent: false)) }
        if let m = staleMinutes { calm.insert(Item(key: "stale", text: "dados há \(m) min", tone: .warn, urgent: false), at: 0) }
        // Urgent items take two turns per cycle; calm ones one.
        return urgent.isEmpty ? calm : urgent + urgent + calm
    }

    /// When an urgent item that was not there before appears, the index to jump to; otherwise nil.
    static func focus(previousKeys: Set<String>, items: [Item]) -> Int? {
        items.firstIndex { $0.urgent && !previousKeys.contains($0.key) }
    }
}
