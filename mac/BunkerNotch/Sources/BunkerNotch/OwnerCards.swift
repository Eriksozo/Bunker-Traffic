import Foundation

/// Mirror of GET /api/companion/cards (lib/companion-cards.mjs): the same decision cards and
/// exact proposals as the web, with the seals an owner request must echo back.
struct OwnerCards: Decodable, Equatable {
    struct Window: Decodable, Equatable { let spend: Double?; let roas: Double?; let roi: Double?; let frontOrders: Double? }
    struct Suggestion: Decodable, Equatable { let action: String; let percent: Double?; let reason: String?; let origin: String? }
    struct Actions: Decodable, Equatable { let increase: Bool; let reduce: Bool; let pause: Bool; let keep: Bool }
    struct Choice: Decodable, Equatable {
        let action: String?; let percent: Double?; let status: String?; let createdAt: String?; let reopenable: Bool?
        /// "Já fiz no Gerenciador": reported by the owner, checked by the next Malva reading (A conferir / Conferida / Divergente).
        let appliedByOwner: Bool?; let canReportApplied: String?; let verification: String?
    }
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
        /// Owner direct order (Touch ID): which actions run now and what still blocks them. Older servers omit both.
        let orderActions: Actions?; let orderBlockers: [String]?
        /// Where a direct order takes its "before" value: the live reading (minutes old) or the analysis.
        let orderSource: OrderSource?
        /// Current values for a direct order: the live reading when there is one.
        var orderBudget: Double? { orderSource?.dailyBudget ?? dailyBudget }
        var orderStatus: String? { orderSource?.status ?? status }
    }
    struct OrderSource: Decodable, Equatable { let kind: String; let at: String?; let status: String?; let dailyBudget: Double?; let currency: String? }
    /// Owner direct order for one campaign, from the live Malva reading only (works without an analysis card).
    struct DirectOrder: Decodable, Equatable {
        let project: String; let adAccountId: String; let objectId: String
        let available: Bool; let actions: Actions; let blockers: [String]
        let source: OrderSource?; let campaign: String?; let account: String?
        var budget: Double? { source?.dailyBudget }
        var status: String? { source?.status }
        var currency: String? { source?.currency }
    }
    let revision: Int?
    let paused: Bool
    let cards: [Card]
    let approvals: [Proposal]
    /// Older servers omit it.
    var directOrder: DirectOrder? = nil
}

/// Which campaign (or the approvals list when campaignId is nil) the adjust view is about.
struct AdjustTarget: Equatable {
    let project: String?; let adAccountId: String?; let campaignId: String?; let name: String?
    /// Action already chosen when the view opens (from the Bunk's anticipated move). Nothing runs until Touch ID.
    var preset: AdjustPreset? = nil
}

/// A pre-selected owner action: "pause", or "increase"/"reduce" with a percent.
struct AdjustPreset: Equatable {
    let action: String; let percent: Double?

    /// The shadow's anticipated move as the owner's own order, or nil when the notch cannot offer it:
    /// already done (owner or manager), missing ids, activation, or a percent outside the server limits; and only a
    /// move the Bunk would actually make now: would execute, nothing blocking it (owner cap, a pause winning, alert only)
    /// and re-emitted by the latest shadow pass (an older server without that mark gets no button).
    static func from(_ item: Summary.ShadowItem) -> AdjustPreset? {
        guard item.owner == nil, item.manager == nil, item.projectId != nil, item.adAccountId != nil, item.objectId != nil else { return nil }
        guard item.wouldExecute == true, (item.blockedBy ?? []).isEmpty, item.alertOnly != true, item.current == true else { return nil }
        if item.action == "status" { return item.after?["status"]?.text == "PAUSED" ? AdjustPreset(action: "pause", percent: nil) : nil }
        guard item.action == "budget", let b = item.before?["dailyBudget"]?.number, let a = item.after?["dailyBudget"]?.number, b > 0, a != b else { return nil }
        let pct = (abs(a - b) / b * 1000).rounded() / 10
        let action = a > b ? "increase" : "reduce"
        guard OwnerAdjust.percentProblem(action, pct, current: b) == nil, OwnerAdjust.validPercent(action, pct) else { return nil }
        return AdjustPreset(action: action, percent: pct)
    }
    /// Button text: "Pausar", "Aumentar 50%", "Reduzir 20%".
    var label: String { OwnerAdjust.label(action) + (percent.map { " " + Format.percent($0, signed: false) } ?? "") }
    /// The percent field text ("50", "12.5").
    var percentText: String? { percent.map { $0.rounded() == $0 ? String(Int($0)) : String($0) } }
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
    /// "20", "20%", " 12,5 " → number; anything else nil.
    static func parsePercent(_ text: String) -> Double? {
        let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "%", with: "").replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, t.allSatisfy({ $0.isNumber || $0 == "." }), t.filter({ $0 == "." }).count <= 1 else { return nil }
        return Double(t)
    }
    /// Why the percent cannot be sent, in the owner's words, or nil when it is fine (same rules as the server).
    static func percentProblem(_ action: String, _ p: Double?, current: Double?) -> String? {
        guard action == "increase" || action == "reduce" else { return nil }
        guard let p, p.isFinite, p > 0 else { return "Digite um percentual maior que zero." }
        if action == "increase", p > 1000 { return "Aumento vai até 1000%." }
        if action == "reduce", p >= 100 { return "Redução precisa ser menor que 100% (para parar, use Pausar)." }
        if let current, current > 0, newBudget(current, action: action, percent: p) == (current * 100).rounded() / 100 { return "Esse percentual não muda o orçamento em centavos." }
        return nil
    }
    static func validPercent(_ action: String, _ p: Double?) -> Bool {
        guard action == "increase" || action == "reduce" else { return true }
        guard let p, p.isFinite, p > 0 else { return false }
        return action == "increase" ? p <= 1000 : p < 100
    }
    /// Preview of the new daily budget, rounded to cents like the server.
    static func newBudget(_ current: Double?, action: String, percent: Double?) -> Double? {
        guard let current, current > 0, let percent, action == "increase" || action == "reduce" else { return nil }
        let v = current * (1 + (action == "increase" ? 1 : -1) * percent / 100)
        return ((v + .ulpOfOne) * 100).rounded() / 100   // same as the server: Math.round((v+EPSILON)*100)/100
    }
    /// Owner feedback for the team: never an execution approval (approveExact false).
    static func intent(card: OwnerCards.Card, revision: Int, action: String, percent: Double?, reason: String, clientId: String) -> [String: Any] {
        var input: [String: Any] = ["op": "cardDecision", "revision": revision, "clientId": clientId, "project": card.project,
                                    "cardId": card.id, "signature": card.signature, "choice": action, "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines), "approveExact": false]
        if action == "increase" || action == "reduce", let percent { input["percent"] = percent }
        return input
    }
    /// Owner direct order, signed with Touch ID: becomes an approved exact proposal that the Cloudflare executor
    /// applies once via Malva (current value checked before, reread after). Pause, increase or reduce only.
    /// Carries the values the owner saw (expected + after); a drift is refused, never re-priced.
    static func order(card: OwnerCards.Card, revision: Int, action: String, percent: Double?, reason: String, clientId: String) -> [String: Any] {
        var input = intent(card: card, revision: revision, action: action, percent: percent, reason: reason, clientId: clientId)
        input["ownerOrder"] = true
        // The exact values on screen and in the Touch ID prompt: the server refuses the order if the current value moved.
        var expected: [String: Any] = ["status": card.orderStatus ?? NSNull(), "currency": (card.currency ?? card.orderSource?.currency) ?? NSNull()]
        expected["dailyBudget"] = card.orderBudget ?? NSNull()
        input["expected"] = expected
        if action == "increase" || action == "reduce", let after = newBudget(card.orderBudget, action: action, percent: percent) { input["after"] = ["dailyBudget": after] }
        return input
    }
    /// Owner direct order (op ownerDirectOrder): pause / increase % / reduce % of one Meta campaign, with the exact
    /// values the owner saw. The server compares them with the live Malva row; the Cloudflare executor rereads Malva,
    /// sends once and confirms. No analysis round, no card and no central revision involved.
    static func directOrder(_ d: OwnerCards.DirectOrder, action: String, percent: Double?, reason: String, clientId: String) -> [String: Any] {
        var expected: [String: Any] = ["status": d.status ?? NSNull(), "currency": d.currency ?? NSNull()]
        expected["dailyBudget"] = d.budget ?? NSNull()
        var input: [String: Any] = ["op": "ownerDirectOrder", "revision": 0, "clientId": clientId, "project": d.project, "adAccountId": d.adAccountId,
                                    "objectId": d.objectId, "action": action, "expected": expected]
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines); if !r.isEmpty { input["reason"] = r }
        if action == "increase" || action == "reduce", let percent {
            input["percent"] = percent
            if let after = newBudget(d.budget, action: action, percent: percent) { input["after"] = ["dailyBudget": after] }
        }
        return input
    }
    static func canDirectOrder(_ d: OwnerCards.DirectOrder?, action: String) -> Bool {
        guard let d, d.available, action != "keep" else { return false }
        return allowed(d.actions, action)
    }
    /// "Pausar: ativa → pausada" or "Reduzir 20%: US$ 95,10 → US$ 76,08/dia" — screen and Touch ID prompt.
    static func directLine(_ d: OwnerCards.DirectOrder, action: String, percent: Double?) -> String {
        if action == "pause" { return "Pausar: " + Format.statusName(d.status) + " → pausada" }
        let after = newBudget(d.budget, action: action, percent: percent)
        return label(action) + (percent.map { " " + Format.percent($0, signed: false) } ?? "") + ": "
            + Format.money(d.budget, currency: d.currency) + " → " + Format.money(after, currency: d.currency) + "/dia"
    }
    static func canOrder(_ card: OwnerCards.Card, action: String) -> Bool {
        guard action != "keep", let a = card.orderActions else { return false }
        return allowed(a, action) && (canDecide(card) || card.lastChoice?.canReportApplied != nil)
    }
    /// Team gaps, return goal and daily cap inform but do not block a direct order.
    static func advisory(_ reason: String) -> Bool {
        ["Faltam pareceres", "Meta de retorno", "Teto diário"].contains { reason.contains($0) }
    }
    /// "Pausar: ativa → pausada" or "Reduzir 20%: US$ 95,10 → US$ 76,08/dia" — screen and Touch ID prompt.
    static func orderLine(_ card: OwnerCards.Card, action: String, percent: Double?) -> String {
        if action == "pause" { return "Pausar: " + Format.statusName(card.orderStatus) + " → pausada" }
        let after = newBudget(card.orderBudget, action: action, percent: percent)
        return label(action) + (percent.map { " " + Format.percent($0, signed: false) } ?? "") + ": "
            + Format.money(card.orderBudget, currency: card.currency) + " → " + Format.money(after, currency: card.currency) + "/dia"
    }
    /// "valor ao vivo de 21:42" or "valor da análise de 19:05".
    static func sourceLine(_ card: OwnerCards.Card) -> String? {
        guard let s = card.orderSource else { return nil }
        return (s.kind == "live" ? "valor ao vivo de " : "valor da análise de ") + Format.clock(s.at)
    }
    /// "Já fiz no Gerenciador": the owner reports an action already made in Meta. Never approves, never executes.
    static func applied(card: OwnerCards.Card, revision: Int, action: String, percent: Double?, reason: String, clientId: String) -> [String: Any] {
        var input = intent(card: card, revision: revision, action: action, percent: percent, reason: reason, clientId: clientId)
        input["applied"] = true
        return input
    }
    /// A new decision is open when there is none, the scenario was reopened, or (for "Já fiz") it matches the pending intent.
    static func canDecide(_ card: OwnerCards.Card) -> Bool { card.lastChoice == nil || card.lastChoice?.reopenable == true }
    static let symbols = ["increase": "arrow.up.right", "reduce": "arrow.down.right", "pause": "pause.fill", "keep": "equal"]
    static func canReportApplied(_ card: OwnerCards.Card, action: String) -> Bool {
        action != "keep" && (canDecide(card) || card.lastChoice?.canReportApplied == action)
    }
    static func lastChoiceLine(_ last: OwnerCards.Choice) -> String {
        var line = (last.appliedByOwner == true ? "Você informou que já fez: " : "Decisão registrada: ") + label(last.action ?? "")
        if let p = last.percent { line += " " + Format.percent(p, signed: false) }
        line += " · " + (last.status ?? "") + " · " + Format.stamp(last.createdAt)
        if let v = last.verification { line += " · conferência Malva: " + v }
        return line
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
