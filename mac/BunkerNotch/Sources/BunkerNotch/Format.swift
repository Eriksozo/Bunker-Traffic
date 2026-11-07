import Foundation

/// Portuguese formatting shared by the notch and the menu. Missing values render as N/D.
enum Format {
    static func money(_ value: Double?, currency: String? = "BRL") -> String {
        guard let value, value.isFinite else { return "N/D" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: "pt_BR")
        f.currencyCode = (currency?.count == 3 ? currency : nil) ?? "BRL"
        f.maximumFractionDigits = abs(value) >= 1000 ? 0 : 2
        return f.string(from: NSNumber(value: value)) ?? "N/D"
    }
    /// Short money for the resting island: "R$ 870", "R$ 3,2 mil", "R$ 1,4 mi".
    static func compactMoney(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "N/D" }
        let a = abs(value), sign = value < 0 ? "−" : ""
        func one(_ v: Double) -> String { String(format: v >= 10 ? "%.0f" : "%.1f", v).replacingOccurrences(of: ".", with: ",") }
        if a >= 1_000_000 { return sign + "R$ " + one(a / 1_000_000) + " mi" }
        if a >= 1_000 { return sign + "R$ " + one(a / 1_000) + " mil" }
        return sign + "R$ " + String(format: "%.0f", a)
    }
    static func ratio(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "N/D" }
        return String(format: "%.2fx", value).replacingOccurrences(of: ".", with: ",")
    }
    static func percent(_ value: Double?, signed: Bool = true) -> String {
        guard let value, value.isFinite else { return "N/D" }
        let rounded = (value * 10).rounded() / 10
        let body = String(format: rounded == rounded.rounded() ? "%.0f%%" : "%.1f%%", abs(rounded)).replacingOccurrences(of: ".", with: ",")
        return signed ? (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + body : body
    }
    static let isoFull: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    static let isoPlain = ISO8601DateFormatter()
    static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return isoFull.date(from: value) ?? isoPlain.date(from: value)
    }
    /// The Bunker shows times in Boa Vista; keep the same clock in the notch.
    static func stamp(_ value: String?) -> String {
        guard let d = date(value) else { return "N/D" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_BR")
        f.timeZone = TimeZone(identifier: "America/Boa_Vista")
        f.dateFormat = "dd/MM HH:mm"
        return f.string(from: d)
    }
    /// "agora", "há 5 min", "há 2 h"; older than a day falls back to the full stamp.
    static func relative(_ value: Date?, now: Date = Date()) -> String {
        guard let value else { return "N/D" }
        let seconds = max(0, now.timeIntervalSince(value))
        if seconds < 60 { return "agora" }
        if seconds < 3600 { return "há \(Int(seconds / 60)) min" }
        if seconds < 86400 { return "há \(Int(seconds / 3600)) h" }
        return stamp(isoFull.string(from: value))
    }
    static func relative(_ value: String?, now: Date = Date()) -> String { relative(date(value), now: now) }
    static func statusName(_ value: String?) -> String {
        switch (value ?? "").uppercased() {
        case "ACTIVE": return "ativa"
        case "PAUSED", "CAMPAIGN_PAUSED": return "pausada"
        case "ARCHIVED": return "arquivada"
        case "DELETED": return "excluída"
        default: return (value ?? "N/D").lowercased()
        }
    }
    /// "−30% · R$ 1.000 → R$ 700/dia" or "ativa → pausada".
    static func change(_ a: Summary.Activity) -> String {
        if a.action == "increase" || a.action == "reduce" {
            let pct = a.percent.map { percent($0) + " · " } ?? ""
            let unit = a.field == "lifetimeBudget" ? " vitalício" : "/dia"
            return pct + money(a.before?.number, currency: a.currency) + " → " + money(a.after?.number, currency: a.currency) + unit
        }
        return statusName(a.before?.text) + " → " + statusName(a.after?.text)
    }
    static let actionLabels: [String: String] = ["increase": "Aumentos", "reduce": "Reduções", "pause": "Pausas", "activate": "Ativações"]
    static let verbs: [String: String] = ["increase": "aumentou", "reduce": "reduziu", "pause": "pausou", "activate": "ativou"]
    /// "Pausar" or "100 → 80 USD": the shadow's proposed change, never a command.
    static func shadowChange(_ item: Summary.ShadowItem) -> String {
        if item.action == "status" { return item.after?["status"]?.text == "PAUSED" ? "Pausar" : "Ativar" }
        let before = item.before?["dailyBudget"]?.number, after = item.after?["dailyBudget"]?.number
        let currency = item.after?["currency"]?.text ?? ""
        guard let b = before, let a = after else { return "Orçamento" }
        let pct = b > 0 ? Int(((a - b) / b * 100).rounded()) : 0
        return "\(pct > 0 ? "+" : "")\(pct)% · \(number(b)) → \(number(a)) \(currency)".trimmingCharacters(in: .whitespaces)
    }
    static func shadowOutcome(_ item: Summary.ShadowItem) -> String {
        if let m = item.manager { let who = m.actor ?? "gestor"; let mins = m.minutesAfter ?? 0; return mins > 0 ? "\(who) fez \(mins) min depois" : "\(who) fez antes" }
        return item.wouldExecute == true ? "executaria" : "bloqueada"
    }
    private static func number(_ n: Double) -> String { n.rounded() == n ? String(Int(n)) : String(format: "%.2f", n) }
    /// Same campaign name runs in several ad accounts; the account always shows so rows stay distinguishable.
    static func queueTag(project: String?, account: String?) -> String? {
        let parts = [project, account].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
    static func who(_ a: Summary.Activity) -> String {
        if let actor = a.actor { return "\(actor) \(verbs[a.action] ?? "alterou")" }
        return (actionLabels[a.action] ?? "Alteração") + " · autor não informado"
    }
}
