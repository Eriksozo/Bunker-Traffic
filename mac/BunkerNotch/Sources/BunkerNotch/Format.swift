import Foundation

/// Portuguese formatting shared by the notch and the menu. Missing values render as N/D.
enum Format {
    // Formatters are expensive to build; the notch formats hundreds of values per render.
    nonisolated(unsafe) private static var currencyCache: [String: NumberFormatter] = [:]
    private static let cacheLock = NSLock()
    private static func currencyFormatter(_ code: String, wholeUnits: Bool) -> NumberFormatter {
        let key = code + (wholeUnits ? ":0" : ":2")
        cacheLock.lock(); defer { cacheLock.unlock() }
        if let f = currencyCache[key] { return f }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: "pt_BR")
        f.currencyCode = code
        // pt_BR prints USD as "US$" already; keep it explicit so accounts and orders read the same.
        if code == "USD" { f.currencySymbol = "US$" }
        f.maximumFractionDigits = wholeUnits ? 0 : 2
        f.minimumFractionDigits = wholeUnits ? 0 : 2
        currencyCache[key] = f
        return f
    }
    static func money(_ value: Double?, currency: String? = "BRL") -> String {
        guard let value, value.isFinite else { return "N/D" }
        let code = (currency?.count == 3 ? currency!.uppercased() : nil) ?? "BRL"
        return currencyFormatter(code, wholeUnits: abs(value) >= 1000).string(from: NSNumber(value: value)) ?? "N/D"
    }
    /// Exact amount with cents (account limits, budgets): "R$ 1.780,00", "US$ 180,00".
    static func exactMoney(_ value: Double?, currency: String? = "BRL") -> String {
        guard let value, value.isFinite else { return "N/D" }
        let code = (currency?.count == 3 ? currency!.uppercased() : nil) ?? "BRL"
        return currencyFormatter(code, wholeUnits: false).string(from: NSNumber(value: value)) ?? "N/D"
    }
    /// "1 perda", "2 perdas", "0 propostas": counts read as Portuguese, never "perda(s)".
    static func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n) " + (n == 1 ? one : many) }
    /// Short money for the resting island: "R$ 870", "R$ 3,2 mil", "R$ 1,4 mi".
    static func compactMoney(_ value: Double?, currency: String? = "BRL") -> String {
        guard let value, value.isFinite else { return "N/D" }
        let sign = value < 0 ? "−" : ""
        let symbol = { () -> String in switch (currency ?? "BRL").uppercased() { case "BRL": return "R$"; case "USD": return "US$"; case "EUR": return "€"; case let c: return c } }()
        func one(_ v: Double) -> String { String(format: v >= 10 ? "%.0f" : "%.1f", v).replacingOccurrences(of: ".", with: ",") }
        // Round to what will be printed before choosing the unit: 999,6 is "R$ 1,0 mil", never "R$ 1000".
        func shown(_ v: Double) -> Double { v >= 10 ? v.rounded() : (v * 10).rounded() / 10 }
        let a = abs(value)
        if shown(a / 1_000_000) >= 1 || shown(a / 1_000) >= 1000 { return sign + symbol + " " + one(shown(a / 1_000_000)) + " mi" }
        if a.rounded() >= 1_000 { return sign + symbol + " " + one(shown(a / 1_000)) + " mil" }
        return sign + symbol + " " + String(format: "%.0f", a)
    }
    /// Signed balance: "+R$ 1,5 mil", "−R$ 1,1 mil", "N/D".
    static func balance(_ w: Summary.BalanceWindow?) -> String {
        guard let w, w.value.isFinite else { return "N/D" }
        return (w.value > 0 ? "+" : "") + compactMoney(w.value)
    }
    static func balanceTone(_ w: Summary.BalanceWindow?) -> Tone { guard let w else { return .neutral }; return w.value < 0 ? .bad : w.value > 0 ? .good : .neutral }
    /// Fits the row: the verdict in two or three words (the full sentence goes to the tooltip).
    static func balanceVerdictShort(_ v: String?) -> (text: String, tone: Tone, icon: String)? {
        switch v { case "recovers": return ("recupera no 7d", .warn, "arrow.uturn.up"); case "negative": return ("negativo no 7d", .bad, "arrow.down"); default: return nil }
    }
    static func balanceVerdict(_ v: String?) -> (text: String, tone: Tone)? {
        switch v { case "recovers": return ("hoje negativo · histórico positivo", .warn); case "negative": return ("negativo também com 7d", .bad); default: return nil }
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
    private static func bunkerClock(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_BR")
        f.timeZone = TimeZone(identifier: "America/Boa_Vista")
        f.dateFormat = format
        return f
    }
    private static let stampFormatter = bunkerClock("dd/MM HH:mm"), clockFormatter = bunkerClock("HH:mm"), dayFormatter = bunkerClock("yyyy-MM-dd")
    /// "2026-11-08" in the Bunker's clock (Boa Vista); the UTC prefix when the instant does not parse.
    static func bunkerDay(_ value: String) -> String { date(value).map { dayFormatter.string(from: $0) } ?? String(value.prefix(10)) }
    static func stamp(_ value: String?) -> String {
        guard let d = date(value) else { return "N/D" }
        return stampFormatter.string(from: d)
    }
    /// "15:40" in the Bunker's clock (Boa Vista), for same-day times.
    static func clock(_ value: String?) -> String {
        guard let d = date(value) else { return "N/D" }
        return clockFormatter.string(from: d)
    }
    /// Short pace line: "no ritmo", "esgota 15:40", "sobra 30%", "orçamento do dia gasto" or "ritmo N/D".
    static func pace(_ p: Summary.Pace?) -> String {
        guard let p else { return "ritmo N/D" }
        switch p.status {
        case "on": return "no ritmo"
        case "under": return p.leftoverPct.map { "sobra \(Int($0))%" } ?? "abaixo do ritmo"
        case "exhausts": return p.exhaustsAt.map { "esgota " + clock($0) } ?? "acima do ritmo"
        case "spent": return "orçamento do dia gasto"
        default: return "ritmo N/D"
        }
    }
    /// Bunk's warning for one project's pace, or nil.
    static func paceWarning(_ p: Summary.Pace) -> (title: String, detail: String)? {
        let name = p.name ?? "Projeto"
        switch p.alert {
        case "early": return ("Orçamento de \(name) acaba às " + clock(p.exhaustsAt), paceBase(p) + " · no ritmo atual")
        case "under": return ("\(name) gastando abaixo do ritmo", pace(p) + " · " + paceBase(p))
        default: return nil
        }
    }
    static func paceTone(_ p: Summary.Pace?) -> Tone {
        switch p?.status { case "exhausts", "spent": return .warn; case "under": return .neutral; case "on": return .good; default: return .neutral }
    }
    /// "R$ 820 de R$ 1.500 orçados · 12 camp." or the reason it is N/D.
    static func paceBase(_ p: Summary.Pace?) -> String {
        guard let p else { return "resumo sem ritmo nesta versão" }
        if p.status == "nd" { return p.reason ?? "sem orçamento diário conhecido" }
        let missing = (p.unknown ?? 0) > 0 ? " · \(p.unknown!) sem orçamento" : ""
        // Not "gasto": the project's total spend shows next to it and differs (campaigns without a budget are left out here).
        return "\(compactMoney(p.spend, currency: p.currency)) de \(compactMoney(p.budget, currency: p.currency)) orçados · \(p.known ?? 0) camp.\(missing)"
    }
    /// Two short lines for the pace tile: "R$ 18 mil de R$ 32 mil" / "14 camp. · 2 sem orçamento".
    static func paceTileBase(_ p: Summary.Pace?) -> String {
        guard let p, p.status != "nd" else { return paceBase(p) }
        let missing = (p.unknown ?? 0) > 0 ? " · \(p.unknown!) sem orçamento" : ""
        return "\(compactMoney(p.spend, currency: p.currency)) de \(compactMoney(p.budget, currency: p.currency)) orçados\n\(p.known ?? 0) camp.\(missing)"
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
        // States only Meta sets (the activity log names Meta as their author).
        case "IN_PROCESS", "PROCESSING": return "em processamento"
        case "PENDING_REVIEW", "IN_REVIEW": return "em análise"
        case "PREAPPROVED": return "pré-aprovada"
        case "DISAPPROVED": return "reprovada"
        case "WITH_ISSUES": return "com problemas"
        case "PENDING_BILLING_INFO": return "aguardando pagamento"
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
    static func accountMoney(_ n: Double?, _ currency: String?) -> String { exactMoney(n, currency: currency) }
    static func accountUse(_ r: Summary.AccountRow) -> String {
        guard let p = r.usedPct else { return accountMoney(r.todaySpend, r.currency) }
        return "\(Int(p.rounded()))%"
    }
    /// Accounts search: name (accents and case ignored) or account id (with or without act_); every word must match.
    static func accountMatches(_ r: Summary.AccountRow, _ query: String) -> Bool {
        let fold: (String) -> String = { $0.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR")).lowercased() }
        let words = fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
        if words.isEmpty { return true }
        let name = fold(r.name ?? "")
        return words.allSatisfy { w in
            if name.contains(w) { return true }
            let digits = w.hasPrefix("act_") ? String(w.dropFirst(4)) : w
            return !digits.isEmpty && digits.allSatisfy(\.isNumber) && r.accountId.contains(digits)
        }
    }

    static func accountLimit(_ r: Summary.AccountRow) -> String {
        r.dailyLimit == nil ? "limite N/D" : "\(accountMoney(r.todaySpend, r.currency)) de \(accountMoney(r.dailyLimit, r.currency))"
    }
    static func accountsMetaNotice(_ code: String?) -> String {
        switch code {
        case "META_TOKEN_MISSING": return "Limite diário: token de leitura da Meta ainda não cadastrado."
        case "META_190": return "Limite diário: token da Meta inválido ou expirado."
        default: return "Limite diário: leitura da Meta indisponível agora."
        }
    }
    /// "Reduzir · US$ 120,00 → US$ 90,00/dia" or "Pausar · ativa → pausada".
    static func orderChange(_ o: Summary.OrderReceipt) -> String {
        if o.action == "status" { return "Pausar · " + statusName(o.before?.status) + " → " + statusName(o.after?.status) }
        let b = o.before?.dailyBudget, a = o.after?.dailyBudget
        // Without both values the direction is unknown: never guess "Aumentar".
        let verb = a == nil || b == nil ? "Orçamento" : a! > b! ? "Aumentar" : a! < b! ? "Reduzir" : "Orçamento"
        return verb + " · " + money(b, currency: o.currency) + " → " + money(a, currency: o.currency) + "/dia"
    }
    static func orderTone(_ stage: String) -> Tone {
        switch stage { case "confirmed": return .good; case "failed", "verify", "expired": return .bad; default: return .accent }
    }
    static let orderSymbols = ["queued": "clock", "checking": "magnifyingglass", "sent": "paperplane.fill", "confirmed": "checkmark.seal.fill", "verify": "exclamationmark.triangle.fill", "failed": "xmark.octagon.fill", "expired": "hourglass"]
    /// "Pausar" or "100 → 80 USD": the shadow's proposed change, never a command.
    static func shadowChange(_ item: Summary.ShadowItem) -> String {
        if item.action == "status" { return item.after?["status"]?.text == "PAUSED" ? "Pausar" : "Ativar" }
        let before = item.before?["dailyBudget"]?.number, after = item.after?["dailyBudget"]?.number
        let currency = item.after?["currency"]?.text ?? ""
        guard let b = before, let a = after else { return "Orçamento" }
        let pct = b > 0 ? Int(((a - b) / b * 100).rounded()) : 0
        return "\(pct > 0 ? "+" : "")\(pct)% · \(number(b)) → \(number(a)) \(currency)".trimmingCharacters(in: .whitespaces)
    }
    /// "Placar 7 dias: acertou 9 de 14 (64%) · 3 cortes em vencedores"
    static func shadowScore(_ sc: Summary.ShadowScorecard) -> String {
        let pct = sc.graded > 0 ? Int((Double(sc.right) / Double(sc.graded) * 100).rounded()) : 0
        let cuts = sc.winnersCut > 0 ? " · " + count(sc.winnersCut, "corte em vencedor", "cortes em vencedores") : ""
        return "Placar \(sc.days ?? 7) dias: acertou \(sc.right) de \(sc.graded) (\(pct)%)" + cuts
    }
    static func shadowOutcome(_ item: Summary.ShadowItem) -> String {
        if item.owner != nil { return item.action == "status" ? (item.after?["status"]?.text == "PAUSED" ? "pausada por você" : "ativada por você") : "ajustada por você" }
        if let m = item.manager { let who = m.actor ?? "gestor"; let mins = m.minutesAfter ?? 0; return mins > 0 ? "\(who) fez \(mins) min depois" : "\(who) fez antes" }
        return item.wouldExecute == true ? "executaria" : "bloqueada"
    }
    private static func number(_ n: Double) -> String { n.rounded() == n ? String(Int(n)) : String(format: "%.2f", n) }
    /// Same campaign name runs in several ad accounts; the account always shows so rows stay distinguishable.
    /// Where a new campaign stands against its first-24h ceiling.
    static func first24hLevel(_ level: String?) -> String {
        switch level {
        case "over": return "teto estourado"
        case "pause": return "pausaria"
        case "alert": return "perto do teto"
        case "sold": return "com venda"
        case "waiting": return "sem entrega"
        default: return "acompanhar"
        }
    }
    static func first24hTone(_ level: String?) -> Tone {
        switch level { case "over", "pause": return .bad; case "alert": return .warn; case "sold": return .good; default: return .neutral }
    }
    /// "1º dia · 1 IC · teto R$ 110,00"
    static func first24hLine(_ item: Summary.First24hItem) -> String {
        let stage = item.stage == "second-day" ? "2º dia" : "1º dia"
        if item.awaitingDelivery == true { return stage + " · aguardando entrega" }
        let ic = item.checkouts.map { "\($0) IC" } ?? "IC N/D"
        let cap = item.level == "sold" ? "" : item.limit.map { " · teto " + money($0) } ?? ""
        let age = item.ageHours.map { $0 < 1 ? " · há menos de 1h" : " · há \(Int($0))h" } ?? ""
        return stage + age + " · " + ic + cap + (item.metaLive == true ? " · Meta ao vivo" : "")
    }
    static func queueTag(project: String?, account: String?) -> String? {
        let parts = [project, account].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
    static func who(_ a: Summary.Activity) -> String {
        if let actor = a.actor { return "\(actor) \(verbs[a.action] ?? "alterou")" }
        return (actionLabels[a.action] ?? "Alteração") + " · autor não informado"
    }
}
