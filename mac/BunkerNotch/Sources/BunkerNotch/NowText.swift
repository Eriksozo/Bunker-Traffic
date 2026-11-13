import Foundation

/// Pure text for the expanded panel's honesty about its sources (review of 13/11/2026, owner's photo):
/// - receiving the summary is not the same as every source being current;
/// - an empty queue while campaigns are unread is never "nothing to do";
/// - ROI N/D says what is missing; today's partial numbers say what they are compared with.
/// Presentation only: no number is created, filled or recalculated here.
enum NowText {
    // MARK: Header freshness

    /// Projects whose newest analysis of "today" is not today's (after midnight, before the new day's analysis).
    static func staleAnalysis(_ s: Summary?) -> [Summary.AnalysisCut] { (s?.analysis ?? []).filter { !$0.current } }

    /// "Recebido agora" (when the notch got the summary) plus "· análise parcial" when some project is still on
    /// the previous day's analysis. Older server (no `analysis`): the receipt alone.
    static func freshness(lastFetch: Date?, summary: Summary?, loading: Bool, now: Date = Date()) -> String {
        if loading && summary == nil { return "Atualizando…" }
        guard let lastFetch else { return "Sem leitura" }
        let base = "Recebido " + Format.relative(lastFetch, now: now)
        return staleAnalysis(summary).isEmpty ? base : base + " · análise parcial"
    }

    /// The header's tooltip: each source with its own time, so a fresh receipt never vouches for an old source.
    static func sources(lastFetch: Date?, summary s: Summary?) -> String {
        guard let s else { return "" }
        var lines: [String] = []
        if let lastFetch { lines.append("Recebido pelo notch: " + Format.clock(Format.isoFull.string(from: lastFetch))) }
        if let live = s.liveAt {
            lines.append("Hoje (ROAS, CPA, gasto): Malva ao vivo " + Format.clock(live) + (s.metaLiveAt.map { " · Meta " + Format.clock($0) } ?? ""))
        } else {
            lines.append("Hoje (ROAS, CPA, gasto): sem leitura ao vivo; vem da análise")
        }
        if let cuts = s.analysis, !cuts.isEmpty {
            let fresh = cuts.filter(\.current), old = cuts.filter { !$0.current }
            if !fresh.isEmpty { lines.append("Análise de hoje: " + fresh.map { $0.name + " " + Format.clock($0.at) }.joined(separator: " · ")) }
            if !old.isEmpty { lines.append("Ainda sem análise de hoje: " + old.map { $0.name + ($0.at.map { " (última " + Format.stamp($0) + ")" } ?? " (nunca)") }.joined(separator: " · ")) }
        } else {
            lines.append("Base de análise: " + Format.stamp(s.analysisAt))
        }
        if let v = s.vigia { lines.append("VIGIA: " + (v.at.map { "lido " + Format.clock($0) } ?? "leitura N/D")) }
        return lines.joined(separator: "\n")
    }

    // MARK: "O que fazer agora"

    /// Section detail: what was listed out of what, never "0 de 97 na fila" as if 97 were waiting.
    static func queueDetail(_ s: Summary) -> String {
        guard let info = s.queueInfo, let active = info.active else {
            return "\(s.queue.count) listadas de \(s.queueSize) ativas · ordenado por dinheiro em jogo"
        }
        let stale = info.stale ?? 0
        return "\(s.queue.count) listadas de \(active) ativas" + (stale > 0 ? " · \(stale) sem análise de hoje" : " · ordenado por dinheiro em jogo")
    }

    enum QueueState: Equatable {
        /// Some active campaigns are still on yesterday's analysis: they are out of the list until the new one.
        case waiting(title: String, detail: String, count: Int)
        /// Everything was read and nothing qualifies (a real, stated absence).
        case clear(String)
        /// Older server: no reason available, so no claim either way.
        case unknown(String)
    }

    /// Why the queue shows what it shows. `nil`: the queue has items and every active campaign was read.
    static func queueState(_ s: Summary) -> QueueState? {
        guard let info = s.queueInfo, let active = info.active else {
            return s.queue.isEmpty ? .unknown("Nada listado na fila agora. Sem o motivo nesta versão do servidor; confira no Bunker.") : nil
        }
        let stale = info.stale ?? 0, read = info.read ?? max(0, active - stale)
        if stale > 0 {
            let names = (info.staleProjects ?? []).joined(separator: ", ")
            let who = names.isEmpty ? "" : names + ": "
            let detail = s.queue.isEmpty && read == 0
                ? who + "sem leitura não dá para dizer que nada pede ação. A fila volta com a análise do dia."
                : who + "fora desta lista até a análise do dia" + (s.queue.isEmpty ? "; entre as \(read) lidas, nada listado." : ".")
            return .waiting(title: Format.count(stale, "campanha ativa", "campanhas ativas") + " sem análise de hoje", detail: detail, count: stale)
        }
        guard s.queue.isEmpty else { return nil }
        var text = "Nenhuma perda nem oportunidade clara entre as \(read) ativas lidas hoje."
        if let p = info.protectedTests, p > 0 { text += " " + Format.count(p, "teste em maturação fica", "testes em maturação ficam") + " em Primeiras 24h." }
        return .clear(text)
    }

    // MARK: KPI tiles

    /// Under "ROI hoje" when it is N/D: what is missing, short ("falta custo do produto"). nil when ROI is read or the
    /// server does not say why (older server).
    static func roiNote(_ s: Summary) -> String? {
        guard s.today.today?.roi == nil, let gap = s.todayGaps?.roi else { return nil }
        if gap.rows == 0 { return "sem leitura de hoje" }
        let labels = gap.missing.map(\.label)
        guard !labels.isEmpty else { return "sem gasto lido hoje" }
        return "falta " + (labels.count == 1 ? labels[0] : labels.dropLast().joined(separator: ", ") + " e " + labels.last!)
    }

    /// Tooltip of the ROI note: in how many of today's campaigns each component is missing. Never a value.
    static func roiNoteHelp(_ s: Summary) -> String? {
        guard s.today.today?.roi == nil, let gap = s.todayGaps?.roi, gap.rows > 0, !gap.missing.isEmpty else { return nil }
        return "ROI hoje fica N/D enquanto faltar: " + gap.missing.map { "\($0.label) em \($0.rows) de \(gap.rows) campanhas" }.joined(separator: "; ")
            + ". O Bunker não completa com zero nem com faturamento de outra base."
    }

    /// One line under the tiles: what "hoje", "ontem" and "7d" are, so a partial day is not read as a full one.
    static func periodLine(_ s: Summary) -> String {
        let until = s.liveAt.map { "até " + Format.clock($0) + " (Malva ao vivo)" } ?? (s.analysisAt.map { "pela análise de " + Format.stamp($0) } ?? "sem leitura")
        return "Hoje parcial " + until + " · ontem: dia inteiro · 7d: 7 dias fechados até ontem · compara razões, não totais"
    }

    // MARK: VIGIA

    /// Section detail: read time, and "leitura atrasada" when the server says the read is not fresh.
    static func vigiaDetail(_ v: Summary.Vigia) -> String {
        (v.at.map { "lido " + Format.relative($0) } ?? "leitura N/D") + (v.fresh == false ? " · leitura atrasada" : "") + " · só aviso, nenhuma ação"
    }
}
