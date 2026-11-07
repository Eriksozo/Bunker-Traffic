import AppKit
import Foundation
import UserNotifications

/// Polls the read-only summary once a minute (and on demand). Never sends a write.
@MainActor
final class Store: ObservableObject {
    static let base = URL(string: "https://bunker-traffic.erik-iplou.workers.dev")!
    @Published private(set) var summary: Summary?
    @Published private(set) var error: String?
    @Published private(set) var loading = false
    @Published private(set) var lastFetch: Date?
    /// Neutral wait (summary being built by the executor), not an error.
    @Published private(set) var preparing = false
    /// Latest in-island alert; the notch controller queues and shows it briefly.
    @Published private(set) var alert: IslandAlert?
    /// Do not disturb: no island alert and no system notification until this time.
    @Published var mutedUntil: Date? = UserDefaults.standard.object(forKey: "mutedUntil") as? Date {
        didSet { UserDefaults.standard.set(mutedUntil, forKey: "mutedUntil") }
    }
    var muted: Bool { (mutedUntil ?? .distantPast) > Date() }
    func mute(hours: Double) { mutedUntil = Date().addingTimeInterval(hours * 3600) }
    /// Until 08:00 tomorrow, local time.
    func muteUntilTomorrow() {
        let cal = Calendar.current
        mutedUntil = cal.date(bySettingHour: 8, minute: 0, second: 0, of: cal.date(byAdding: .day, value: 1, to: Date())!)
    }
    func unmute() { mutedUntil = nil }
    @Published var project: String {
        didSet { UserDefaults.standard.set(project, forKey: "project"); primed = false; Task { await refresh() } }
    }
    private var timer: Timer?
    private var seen = Set<String>()
    private var primed = false

    init() {
        project = UserDefaults.standard.string(forKey: "project") ?? "all"
    }

    func start() {
        requestNotifications()
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    /// Attention count shown on the collapsed notch and the menu bar.
    var attention: Int {
        guard let s = summary else { return 0 }
        return s.approvals.count + s.queue.filter { $0.kind == "loss" }.count
    }

    func refresh() async {
        guard let token = Credential.importIfNeeded() else {
            error = "Credencial do app não encontrada nas Chaves."; return
        }
        loading = true
        defer { loading = false }
        var components = URLComponents(url: Store.base.appendingPathComponent("api/companion"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "project", value: project)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                if status == 503, summary == nil || preparing { preparing = true; error = nil; return }
                error = status == 401 ? "Credencial recusada pelo Bunker." : status == 404 ? "Projeto não encontrado." : "Bunker indisponível (\(status)). A última leitura foi mantida."
                if status == 404 { project = "all" }
                return
            }
            preparing = false
            let next = try JSONDecoder().decode(Summary.self, from: data)
            notifyNew(next)
            summary = next
            error = nil
            lastFetch = Date()
        } catch {
            self.error = "Sem conexão com o Bunker. A última leitura foi mantida."
        }
    }

    func open(_ path: String = "") {
        NSWorkspace.shared.open(URL(string: Store.base.absoluteString + "/" + path)!)
    }

    // MARK: - Notifications (new approvals, new manager activity, new losses). First load only primes.
    private func requestNotifications() {
        guard Bundle.main.bundleIdentifier != nil else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Stable identity of a change: the author arriving later must not make it look new.
    nonisolated static func changeKey(_ e: Summary.Activity) -> String {
        "ac:" + [e.action, e.campaignId ?? e.campaign ?? "", String(describing: e.before), String(describing: e.after)].joined(separator: "|")
    }

    private func notifyNew(_ s: Summary) {
        var fresh: [(String, String, String, IslandAlert.Kind)] = []
        for a in s.approvals.items where !seen.contains("ap:" + a.id) {
            seen.insert("ap:" + a.id); fresh.append(("ap:" + a.id, "Proposta aguardando você", (a.project.map { $0 + " · " } ?? "") + (a.title ?? "Proposta exata"), .approval))
        }
        for e in s.activity.recent where !seen.contains(Store.changeKey(e)) {
            seen.insert(Store.changeKey(e)); fresh.append((Store.changeKey(e), Format.who(e), (e.campaign ?? "Campanha") + " · " + Format.change(e), .manager))
        }
        for q in s.queue where q.kind == "loss" && !seen.contains("lo:" + q.id) {
            seen.insert("lo:" + q.id); fresh.append(("lo:" + q.id, "Perda para revisar", (q.campaign ?? "Campanha") + " · " + Format.money(q.amount), .loss))
        }
        defer { primed = true }
        guard primed, !muted else { return }
        // Approvals first, then losses, then manager changes; at most three alerts per refresh.
        let order: [IslandAlert.Kind: Int] = [.approval: 0, .loss: 1, .manager: 2]
        for item in fresh.sorted(by: { order[$0.3]! < order[$1.3]! }).prefix(3) { alert = IslandAlert(id: item.0, kind: item.3, title: item.1, detail: item.2) }
        guard Bundle.main.bundleIdentifier != nil else { return }
        for (id, title, body, _) in fresh.prefix(4) {
            let content = UNMutableNotificationContent()
            content.title = title; content.body = body; content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}
