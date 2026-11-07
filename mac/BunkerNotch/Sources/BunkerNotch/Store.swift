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
    @Published var project: String {
        didSet { UserDefaults.standard.set(project, forKey: "project"); Task { await refresh() } }
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
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
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
                error = status == 401 ? "Credencial recusada pelo Bunker." : status == 404 ? "Projeto não encontrado." : "Bunker indisponível (\(status))."
                if status == 404 { project = "all" }
                return
            }
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

    private func notifyNew(_ s: Summary) {
        var fresh: [(String, String, String)] = []
        for a in s.approvals.items where !seen.contains("ap:" + a.id) {
            seen.insert("ap:" + a.id); fresh.append(("ap:" + a.id, "Proposta aguardando você", (a.project.map { $0 + " · " } ?? "") + (a.title ?? "Proposta exata")))
        }
        for e in s.activity.recent where !seen.contains("ac:" + e.id) {
            seen.insert("ac:" + e.id); fresh.append(("ac:" + e.id, Format.who(e), (e.campaign ?? "Campanha") + " · " + Format.change(e)))
        }
        for q in s.queue where q.kind == "loss" && !seen.contains("lo:" + q.id) {
            seen.insert("lo:" + q.id); fresh.append(("lo:" + q.id, "Perda para revisar", (q.campaign ?? "Campanha") + " · " + Format.money(q.amount)))
        }
        defer { primed = true }
        guard primed, Bundle.main.bundleIdentifier != nil else { return }
        for (id, title, body) in fresh.prefix(4) {
            let content = UNMutableNotificationContent()
            content.title = title; content.body = body; content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}
