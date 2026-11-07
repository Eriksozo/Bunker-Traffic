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
    static func who(_ a: Summary.Activity) -> String {
        if let actor = a.actor { return "\(actor) \(verbs[a.action] ?? "alterou")" }
        return (actionLabels[a.action] ?? "Alteração") + " · autor não informado"
    }
}
