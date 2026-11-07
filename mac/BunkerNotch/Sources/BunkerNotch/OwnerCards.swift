import Foundation

/// Mirror of GET /api/companion/cards (lib/companion-cards.mjs): the same decision cards and
/// exact proposals as the web, with the seals an owner request must echo back.
struct OwnerCards: Decodable, Equatable {
    struct Window: Decodable, Equatable { let spend: Double?; let roas: Double?; let roi: Double?; let frontOrders: Double? }
    struct Suggestion: Decodable, Equatable { let action: String; let percent: Double?; let reason: String?; let origin: String? }
    struct Actions: Decodable, Equatable { let increase: Bool; let reduce: Bool; let pause: Bool; let keep: Bool }
    struct Choice: Decodable, Equatable { let action: String?; let percent: Double?; let status: String?; let createdAt: String?; let reopenable: Bool? }
    struct Values: Decodable, Equatable { let dailyBudget: Double?; let status: String? }
    struct Proposal: Decodable, Equatable, Identifiable {
        let id: String; let version: Int; let signature: String; let status: String; let project: String
        let title: String?; let reason: String?; let action: String; let level: String?
        let adAccountId: String?; let objectId: String?; let campaign: String?; let account: String?; let currency: String?
        let before: Values; let after: Values; let expiresAt: String?; let expired: Bool?; let projectName: String?
    }
    struct Card: Decodable, Equatable, Identifiable {
        let id: String; let signature: String; let project: String; let projectName: String?
        let campaign: String?; let account: String?; let adAccountId: String; let objectId: String
        let status: String?; let dailyBudget: Double?; let currency: String?
        let windows: [String: Window?]
        let suggestion: Suggestion?; let intentActions: Actions; let blockedReasons: [String]
        let lastChoice: Choice?; let proposal: Proposal?
    }
    let revision: Int?
    let paused: Bool
    let cards: [Card]
    let approvals: [Proposal]
}

/// Which campaign (or the approvals list when campaignId is nil) the adjust view is about.
struct AdjustTarget: Equatable {
    let project: String?; let adAccountId: String?; let campaignId: String?; let name: String?
}

/// Pure rules shared by the view and the self-test.
enum OwnerAdjust {
    static let choices = ["increase", "reduce", "pause", "keep"]
    static func label(_ action: String) -> String {
        ["increase": "Aumentar", "reduce": "Reduzir", "pause": "Pausar", "keep": "Manter", "budget": "Orçamento", "status": "Status"][action] ?? action
    }
    static func allowed(_ a: OwnerCards.Actions, _ action: String) -> Bool {
        switch action { case "increase": return a.increase; case "reduce": return a.reduce; case "pause": return a.pause; case "keep": return a.keep; default: return false }
    }
    /// Same limits as the server: increase up to 1000%, reduce above 0 and below 100%.
    static func validPercent(_ action: String, _ p: Double?) -> Bool {
        guard action == "increase" || action == "reduce" else { return true }
        guard let p, p.isFinite, p > 0 else { return false }
        return action == "increase" ? p <= 1000 : p < 100
    }
    /// Preview of the new daily budget, rounded to cents like the server.
    static func newBudget(_ current: Double?, action: String, percent: Double?) -> Double? {
        guard let current, current > 0, let percent, action == "increase" || action == "reduce" else { return nil }
        let v = current * (1 + (action == "increase" ? 1 : -1) * percent / 100)
        return (v * 100 + .ulpOfOne).rounded() / 100
    }
    /// Owner feedback for the team: never an execution approval (approveExact false).
    static func intent(card: OwnerCards.Card, revision: Int, action: String, percent: Double?, reason: String, clientId: String) -> [String: Any] {
        var input: [String: Any] = ["op": "cardDecision", "revision": revision, "clientId": clientId, "project": card.project,
                                    "cardId": card.id, "signature": card.signature, "choice": action, "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines), "approveExact": false]
        if action == "increase" || action == "reduce", let percent { input["percent"] = percent }
        return input
    }
    /// The owner's decision on an exact proposal already reviewed by the agents.
    static func review(_ p: OwnerCards.Proposal, revision: Int, decision: String, comment: String?, clientId: String) -> [String: Any] {
        var input: [String: Any] = ["op": "proposalReview", "revision": revision, "clientId": clientId, "id": p.id, "version": p.version, "signature": p.signature, "decision": decision]
        if let comment, !comment.isEmpty { input["comment"] = comment }
        return input
    }
    /// What changes, in one line: used on screen and in the Touch ID prompt.
    static func change(_ p: OwnerCards.Proposal) -> String {
        if p.action == "budget" {
            return "orçamento diário " + Format.money(p.before.dailyBudget, currency: p.currency) + " → " + Format.money(p.after.dailyBudget, currency: p.currency)
        }
        return Format.statusName(p.before.status) + " → " + Format.statusName(p.after.status)
    }
    static func suggestionLine(_ s: OwnerCards.Suggestion) -> String {
        var line = "Equipe: " + label(s.action)
        if let p = s.percent { line += " " + Format.percent(p, signed: false) }
        if let r = s.reason { line += " · " + r }
        return line
    }
    static func clientId() -> String { "notch-owner-" + UUID().uuidString.lowercased() }
}
