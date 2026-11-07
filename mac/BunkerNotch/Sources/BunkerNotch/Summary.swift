import Foundation

/// Mirror of GET /api/companion (lib/companion-summary.mjs). Every number is optional: missing stays N/D.
struct Summary: Decodable, Equatable {
    struct Project: Decodable, Equatable, Hashable { let id: String; let name: String }
    struct Ratios: Decodable, Equatable { let roas: Double?; let roi: Double?; let cpaFront: Double?; let spend: Double? }
    struct Delta: Decodable, Equatable { let yesterday: Double?; let week: Double? }
    struct Today: Decodable, Equatable {
        let today: Ratios?; let yesterday: Ratios?; let week: Ratios?
        let deltas: [String: Delta]
    }
    struct QueueItem: Decodable, Equatable, Identifiable {
        var id: String { (adAccountId ?? "") + ":" + (campaignId ?? campaign ?? "") }
        let kind: String; let campaign: String?; let account: String?; let project: String?
        let adAccountId: String?; let campaignId: String?; let decision: String?
        let period: String?; let basis: String?; let amount: Double?; let spend: Double?; let roas: Double?; let roas7d: Double?
        let detail: Detail?
    }
    struct Window: Decodable, Equatable { let spend: Double?; let roas: Double?; let roi: Double?; let frontOrders: Double?; let cpaFront: Double?; let noSpend: Bool? }
    struct Detail: Decodable, Equatable {
        let projectId: String?; let malvaObjectId: String?; let status: String?; let dailyBudget: Double?; let budgetCurrency: String?; let reason: String?
        let windows: [String: Window?]
        let changes: [Activity]
    }
    struct BoardRow: Decodable, Equatable, Identifiable {
        let id: String; let name: String; let spend: Double?; let roas: Double?; let roi: Double?; let roasYesterday: Double?
        let approvals: Int; let losses: Int; let changes: Int
    }
    struct Approval: Decodable, Equatable, Identifiable { let id: String; let title: String?; let project: String?; let expiresAt: String? }
    struct Approvals: Decodable, Equatable { let count: Int; let items: [Approval] }
    struct Bucket: Decodable, Equatable { let count: Int; let actors: [String: Int]; let unknown: Int }
    struct Activity: Decodable, Equatable, Identifiable {
        var id: String { [action, campaignId ?? "", at ?? "", String(describing: after)].joined(separator: "|") }
        let action: String; let field: String?; let before: JSONValue?; let after: JSONValue?
        let percent: Double?; let currency: String?; let at: String?; let from: String?
        let actor: String?; let origin: String?; let campaign: String?; let account: String?; let campaignId: String?
    }
    struct ActivityBlock: Decodable, Equatable { let hours: Int; let summary: [String: Bucket]; let recent: [Activity] }
    struct Message: Decodable, Equatable, Identifiable {
        var id: String { (at ?? "") + (agent ?? "") }
        let agent: String?; let role: String?; let to: String?; let kind: String?; let decision: String?; let text: String?; let at: String?; let project: String?
    }
    struct Agents: Decodable, Equatable { let recent: [Message] }
    struct Executor: Decodable, Equatable { let enabled: Bool; let paused: Bool; let lastPulseAt: String?; let lastError: String?; let recentFailures: Int }

    let generatedAt: String
    let project: String
    let projectName: String
    let projects: [Project]
    let paused: Bool
    let analysisAt: String?
    let today: Today
    let queue: [QueueItem]
    let queueSize: Int
    let board: [BoardRow]?
    let approvals: Approvals
    let activity: ActivityBlock
    let agents: Agents
    let executor: Executor?
    let notice: String
    /// Shadow mode: what the Bunker would have done and whether a manager did it later. Observation only.
    let shadow: Shadow?

    struct ShadowManager: Decodable, Equatable { let actor: String?; let at: String?; let minutesAfter: Int? }
    struct ShadowRule: Decodable, Equatable { let total: Int; let wouldExecute: Int; let managerDid: Int; let bunkerFirst: Int }
    struct ShadowItem: Decodable, Equatable, Identifiable {
        var id: String { [rule ?? "", account ?? "", campaign ?? "", firstAt ?? ""].joined(separator: "|") }
        let rule: String?; let ruleLabel: String?; let project: String?; let account: String?; let campaign: String?
        let action: String?; let reason: String?; let firstAt: String?
        let before: [String: JSONValue]?; let after: [String: JSONValue]?
        let wouldExecute: Bool?; let blockedBy: [String]?; let manager: ShadowManager?
    }
    struct Shadow: Decodable, Equatable { let day: String?; let total: Int; let byRule: [String: ShadowRule]; let recent: [ShadowItem] }
    /// Ad-account panel (lib/account-limits.mjs). Limit and today's spend are in the account currency.
    let accounts: Accounts?
    struct AccountCounts: Decodable, Equatable { let total: Int; let active: Int; let running: Int; let disabled: Int; let nearLimit: Int; let withLimit: Int }
    struct AccountRow: Decodable, Equatable, Identifiable {
        var id: String { accountId }
        let accountId: String; let name: String?; let group: String?; let status: String?; let statusLabel: String?; let runningLabel: String?
        let currency: String?; let dailyLimit: Double?; let todaySpend: Double?; let usedPct: Double?; let balance: Double?; let alerts: [String]?
    }
    struct Accounts: Decodable, Equatable { let generatedAt: String?; let metaConnected: Bool; let metaError: String?; let counts: AccountCounts; let rows: [AccountRow] }
}

/// Budgets are numbers, statuses are strings: keep both without guessing.
enum JSONValue: Decodable, Equatable, CustomStringConvertible {
    case number(Double), text(String), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .text(try c.decode(String.self)) }
    }
    var description: String {
        switch self { case .number(let n): return String(n); case .text(let t): return t; case .null: return "null" }
    }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    var text: String? { if case .text(let t) = self { return t }; return nil }
}
