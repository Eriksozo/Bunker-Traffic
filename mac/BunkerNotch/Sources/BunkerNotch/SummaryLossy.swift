import Foundation

/// Section-tolerant decoding (notch battery 26, 2026-11-08). One malformed field in an accessory section used to
/// fail the whole summary, so the notch kept an old reading and said "Sem conexão". Now the core (identity,
/// projects, today, queue) stays strict; an accessory section that does not decode becomes nil/empty, a bad list
/// item is skipped, and counts fall back to what the lists show. Values never become invented numbers.

/// Swallows one element of an unkeyed container whatever it is, so a bad item can be skipped.
private struct Skip: Decodable { init(from decoder: Decoder) throws {} }

extension KeyedDecodingContainer {
    /// The list without the items that fail; nil when the key is missing or is not a list.
    func lossyList<T: Decodable>(_ type: T.Type, forKey key: Key) -> [T]? {
        guard var c = try? nestedUnkeyedContainer(forKey: key) else { return nil }
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) } else if (try? c.decode(Skip.self)) == nil { break }
        }
        return out
    }
    func optional<T: Decodable>(_ type: T.Type, forKey key: Key) -> T? { (try? decodeIfPresent(T.self, forKey: key)) ?? nil }
}

extension Summary {
    private enum Keys: String, CodingKey { case generatedAt, project, projectName, projects, paused, analysisAt, liveAt, metaLiveAt, today, pace, orders, sales, queue, queueSize, board, approvals, activity, agents, executor, notice, shadow, first24h, accounts, storage, days, autonomy }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        // Core: without these there is no reading to show.
        generatedAt = try c.decode(String.self, forKey: .generatedAt)
        project = try c.decode(String.self, forKey: .project)
        projectName = c.optional(String.self, forKey: .projectName) ?? project
        projects = c.lossyList(Project.self, forKey: .projects) ?? []
        paused = c.optional(Bool.self, forKey: .paused) ?? false
        analysisAt = c.optional(String.self, forKey: .analysisAt)
        liveAt = c.optional(String.self, forKey: .liveAt)
        metaLiveAt = c.optional(String.self, forKey: .metaLiveAt)
        today = try c.decode(Today.self, forKey: .today)
        queue = c.lossyList(QueueItem.self, forKey: .queue) ?? []
        queueSize = c.optional(Int.self, forKey: .queueSize) ?? queue.count
        // Accessory sections: a broken one is left out, the rest of the notch still updates.
        pace = c.optional(Pace.self, forKey: .pace)
        orders = c.lossyList(OrderReceipt.self, forKey: .orders)
        sales = c.optional(Sales.self, forKey: .sales)
        board = c.lossyList(BoardRow.self, forKey: .board)
        approvals = c.optional(Approvals.self, forKey: .approvals) ?? Approvals(count: 0, items: [])
        activity = c.optional(ActivityBlock.self, forKey: .activity) ?? ActivityBlock(hours: 24, summary: [:], recent: [])
        agents = c.optional(Agents.self, forKey: .agents) ?? Agents(recent: [])
        executor = c.optional(Executor.self, forKey: .executor)
        notice = c.optional(String.self, forKey: .notice) ?? ""
        shadow = c.optional(Shadow.self, forKey: .shadow)
        first24h = c.optional(First24h.self, forKey: .first24h)
        accounts = c.optional(Accounts.self, forKey: .accounts)
        storage = c.optional(Storage.self, forKey: .storage)
        days = c.optional(Days.self, forKey: .days)
        // Autonomia v2 (contract (b)): not an object → nil; a bad field inside → its default, never a failed summary.
        autonomy = c.optional(Autonomy.self, forKey: .autonomy)
    }
}

extension Summary.Approvals {
    private enum Keys: String, CodingKey { case count, items }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let items = c.lossyList(Summary.Approval.self, forKey: .items) ?? []
        self.init(count: c.optional(Int.self, forKey: .count) ?? items.count, items: items)
    }
}

extension Summary.ActivityBlock {
    private enum Keys: String, CodingKey { case hours, summary, recent }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let raw = c.optional([String: Summary.Bucket?].self, forKey: .summary) ?? [:]
        self.init(hours: c.optional(Int.self, forKey: .hours) ?? 24, summary: raw.compactMapValues { $0 }, recent: c.lossyList(Summary.Activity.self, forKey: .recent) ?? [])
    }
}

extension Summary.Bucket {
    private enum Keys: String, CodingKey { case count, actors, unknown }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let actors = (c.optional([String: Int?].self, forKey: .actors) ?? [:]).compactMapValues { $0 }
        self.init(count: try c.decode(Int.self, forKey: .count), actors: actors, unknown: c.optional(Int.self, forKey: .unknown) ?? 0)
    }
}

extension Summary.Agents {
    private enum Keys: String, CodingKey { case recent }
    init(from decoder: Decoder) throws { self.init(recent: (try decoder.container(keyedBy: Keys.self)).lossyList(Summary.Message.self, forKey: .recent) ?? []) }
}

extension Summary.Executor {
    private enum Keys: String, CodingKey { case enabled, paused, lastPulseAt, lastError, recentFailures }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(enabled: try c.decode(Bool.self, forKey: .enabled), paused: c.optional(Bool.self, forKey: .paused) ?? false,
                  lastPulseAt: c.optional(String.self, forKey: .lastPulseAt), lastError: c.optional(String.self, forKey: .lastError),
                  recentFailures: c.optional(Int.self, forKey: .recentFailures) ?? 0)
    }
}

extension Summary.Today {
    private enum Keys: String, CodingKey { case today, yesterday, week, recent, deltas }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let deltas = (c.optional([String: Summary.Delta?].self, forKey: .deltas) ?? [:]).compactMapValues { $0 }
        self.init(today: c.optional(Summary.Ratios.self, forKey: .today), yesterday: c.optional(Summary.Ratios.self, forKey: .yesterday),
                  week: c.optional(Summary.Ratios.self, forKey: .week), recent: c.optional(Summary.Ratios.self, forKey: .recent), deltas: deltas)
    }
}

// MARK: - Autonomia v2 · Modo Gestor (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md (b))
// Every field is optional with a default (lists empty, switch off, numbers nil). An item without its id is skipped.

extension Summary.Autonomy: Decodable {
    private enum Keys: String, CodingKey { case v, at, enabled, projects, campaigns, island }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(v: c.optional(Int.self, forKey: .v), at: c.optional(String.self, forKey: .at),
                  enabled: c.optional(Bool.self, forKey: .enabled) ?? false,
                  projects: c.lossyList(Summary.AutonomyProject.self, forKey: .projects) ?? [],
                  campaigns: c.lossyList(Summary.AutonomyCampaign.self, forKey: .campaigns) ?? [],
                  island: c.optional(Summary.AutonomyIsland.self, forKey: .island))
    }
}

extension Summary.AutonomyProject: Decodable {
    private enum Keys: String, CodingKey { case id, name, mode, exceptions, pilot, today, plays, people }
    private struct Pilot: Decodable { let enabled: Bool? }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(id: try c.decode(String.self, forKey: .id), name: c.optional(String.self, forKey: .name),
                  mode: c.optional(String.self, forKey: .mode), exceptions: c.optional(Int.self, forKey: .exceptions),
                  pilotEnabled: c.optional(Pilot.self, forKey: .pilot)?.enabled, today: c.optional(Summary.AutonomyToday.self, forKey: .today),
                  plays: c.lossyList(Summary.AutonomyPlay.self, forKey: .plays) ?? [],
                  people: c.lossyList(Summary.AutonomyPerson.self, forKey: .people) ?? [])
    }
}

extension Summary.AutonomyToday: Decodable {
    private enum Keys: String, CodingKey { case decisions, enviaria, pediria, soSugestao, segurada, ordersCreated, ordersConfirmed }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(decisions: c.optional(Int.self, forKey: .decisions), enviaria: c.optional(Int.self, forKey: .enviaria),
                  pediria: c.optional(Int.self, forKey: .pediria), soSugestao: c.optional(Int.self, forKey: .soSugestao),
                  segurada: c.optional(Int.self, forKey: .segurada), ordersCreated: c.optional(Int.self, forKey: .ordersCreated),
                  ordersConfirmed: c.optional(Int.self, forKey: .ordersConfirmed))
    }
}

/// A 0–1 fraction or nil: anything else (a percent sent by mistake, NaN) is N/D, never a made-up share.
private func fraction(_ v: Double?) -> Double? { guard let v, v.isFinite, v >= 0, v <= 1 else { return nil }; return v }

extension Summary.AutonomyPlay: Decodable {
    private enum Keys: String, CodingKey { case id, label, stage, agreement, n }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(id: try c.decode(String.self, forKey: .id), label: c.optional(String.self, forKey: .label), stage: c.optional(String.self, forKey: .stage),
                  agreement: fraction(c.optional(Double.self, forKey: .agreement)), n: c.optional(Int.self, forKey: .n))
    }
}

extension Summary.AutonomyPerson: Decodable {
    private enum Keys: String, CodingKey { case person, name, agreement, n }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(person: try c.decode(String.self, forKey: .person), name: c.optional(String.self, forKey: .name),
                  agreement: fraction(c.optional(Double.self, forKey: .agreement)), n: c.optional(Int.self, forKey: .n))
    }
}

extension Summary.AutonomyCampaign: Decodable {
    private enum Keys: String, CodingKey { case projectId, adAccountId, objectId, mode }
    /// All four are required: an entry without its ids or its mode is skipped, and the project level applies.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(projectId: try c.decode(String.self, forKey: .projectId), adAccountId: try c.decode(String.self, forKey: .adAccountId),
                  objectId: try c.decode(String.self, forKey: .objectId), mode: try c.decode(String.self, forKey: .mode))
    }
}

extension Summary.AutonomyIsland: Decodable {
    private enum Keys: String, CodingKey { case observing, agreement, n }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        self.init(observing: c.lossyList(String.self, forKey: .observing) ?? [], agreement: fraction(c.optional(Double.self, forKey: .agreement)),
                  n: c.optional(Int.self, forKey: .n))
    }
}
