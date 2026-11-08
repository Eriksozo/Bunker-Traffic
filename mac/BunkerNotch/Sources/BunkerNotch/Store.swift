import AppKit
import Combine
import Foundation
import UserNotifications

/// Polls the read-only summary (every minute while the island is open, every two at rest, slower after
/// failures, never while the screens sleep) and on demand. Never sends a write.
@MainActor
final class Store: ObservableObject {
    nonisolated static let base = URL(string: "https://bunker-traffic.erik-iplou.workers.dev")!
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
    private var failures = 0
    private var asleep = false
    private var bag = Set<AnyCancellable>()
    /// Alerts and notifications held while the owner is in a call; shown when it ends (at most three).
    private var held: [(String, String, String, IslandAlert.Kind)] = []

    /// Dismissed (until the state changes) and snoozed items: they stop interrupting but stay in the lists.
    @Published private(set) var ledger = AttentionLedger.load()
    func dismiss(_ q: Summary.QueueItem) { ledger.dismiss(q); ledger.save() }
    func snooze(_ key: String, _ choice: AttentionLedger.Snooze) { ledger.snooze(key, until: choice.until(from: Date())); ledger.save() }
    func restore(_ key: String) { ledger.restore(key); ledger.save() }
    func isQuiet(_ q: Summary.QueueItem) -> Bool { ledger.isQuiet(q) }
    var approvalsQuiet: Bool { ledger.isQuiet(key: AttentionLedger.approvalsKey) }

    /// Set by the notch: opening the island refreshes a reading older than a minute and speeds the cadence up.
    var islandOpen = false {
        didSet {
            guard islandOpen != oldValue else { return }
            if islandOpen, (lastFetch.map { Date().timeIntervalSince($0) >= RefreshPolicy.open } ?? true) { Task { await refresh() } } else { schedule() }
        }
    }

    init() {
        project = UserDefaults.standard.string(forKey: "project") ?? "all"
    }

    func start() {
        requestNotifications()
        // Creates the Touch ID approval key once and writes its public half for registration (no prompt here).
        _ = try? OwnerKey.ensure()
        ledger.prune(); ledger.save()
        Task { await refresh() }
        let ws = NSWorkspace.shared.notificationCenter, dnc = DistributedNotificationCenter.default()
        for (center, name, sleeping) in [(ws, NSWorkspace.screensDidSleepNotification, true), (ws, NSWorkspace.screensDidWakeNotification, false)] as [(NotificationCenter, Notification.Name, Bool)] {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.setAsleep(sleeping) } }
        }
        dnc.addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.setAsleep(true) } }
        dnc.addObserver(forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.setAsleep(false) } }
        CallWatch.shared.$inCall.removeDuplicates().dropFirst().receive(on: RunLoop.main).sink { [weak self] inCall in if !inCall { self?.releaseHeld() } }.store(in: &bag)
    }

    /// Screens asleep or locked: no reading; waking up reads at once if the last one is old.
    private func setAsleep(_ value: Bool) {
        asleep = value
        if value { timer?.invalidate(); timer = nil }
        else if lastFetch.map({ Date().timeIntervalSince($0) >= RefreshPolicy.open }) ?? true { Task { await refresh() } } else { schedule() }
    }
    private func schedule() {
        timer?.invalidate(); timer = nil
        guard !asleep else { return }
        timer = Timer.scheduledTimer(withTimeInterval: RefreshPolicy.interval(open: islandOpen, failures: failures), repeats: false) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    /// Attention count shown on the collapsed notch and the menu bar.
    /// Dismissed or snoozed items do not count: the badge only asks for what still needs the owner.
    var attention: Int {
        guard let s = summary else { return 0 }
        return (approvalsQuiet ? 0 : s.approvals.count) + s.queue.filter { $0.kind == "loss" && !isQuiet($0) }.count
    }

    /// `--render-notch` only: a fictional summary, no network call, no credential.
    func showPreview(_ s: Summary) { summary = s; lastFetch = Date().addingTimeInterval(-40); error = nil; preparing = false }

    func refresh() async {
        guard let token = Credential.importIfNeeded() else {
            error = "Credencial do app não encontrada nas Chaves."; return
        }
        loading = true
        var ok = false
        defer { loading = false; failures = ok ? 0 : failures + 1; schedule() }
        var components = URLComponents(url: Store.base.appendingPathComponent("api/companion"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "project", value: project)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                if status == 503, summary == nil || preparing { preparing = true; error = nil; ok = true; return }
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
            ok = true
        } catch {
            self.error = "Sem conexão com o Bunker. A última leitura foi mantida."
        }
    }

    // MARK: - Owner adjustments (Touch ID). Reads use the read-only credential; every write is signed on this Mac.

    enum OwnerResult: Equatable { case done(String), refused(String), unregistered(String), cancelled }
    enum CardsResult { case ok(OwnerCards), failed(String) }

    /// Cards and proposals waiting for the owner, for one campaign or the whole project.
    func fetchCards(_ target: AdjustTarget) async -> CardsResult {
        guard let token = Credential.importIfNeeded() else { return .failed("Credencial do app não encontrada nas Chaves.") }
        var components = URLComponents(url: Store.base.appendingPathComponent("api/companion/cards"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "project", value: target.project ?? project)]
            + (target.adAccountId.map { [URLQueryItem(name: "account", value: $0)] } ?? [])
            + (target.campaignId.map { [URLQueryItem(name: "campaign", value: $0)] } ?? [])
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { return .failed(status == 401 ? "Credencial recusada pelo Bunker." : "Cards indisponíveis agora (\(status)).") }
            return .ok(try JSONDecoder().decode(OwnerCards.self, from: data))
        } catch { return .failed("Sem conexão com o Bunker ou resposta inesperada.") }
    }

    /// Touch ID first (the prompt names the exact change), then one signed POST. A lost answer is not retried blindly.
    func sendOwner(_ input: [String: Any], reason: String) async -> OwnerResult {
        let body: Data
        do { body = try await OwnerKey.sign(input: input, reason: reason) }
        catch OwnerKey.Failure.cancelled { return .cancelled }
        catch { return .refused("Não foi possível assinar neste Mac (Secure Enclave indisponível).") }
        var request = URLRequest(url: Store.base.appendingPathComponent("api/companion/owner"), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = json?["error"] as? String
            if status == 200 { Task { await refresh() }; return .done(json?["status"] as? String ?? "Registrado") }
            if ["OWNER_DEVICE_UNCONFIGURED", "OWNER_DEVICE_UNKNOWN_KEY"].contains(json?["code"] as? String ?? "") { return .unregistered(message ?? "Chave do Mac não registrada.") }
            return .refused(message ?? "O Bunker recusou (\(status)).")
        } catch {
            return .refused("A resposta não chegou. Recarregue e confira se ficou registrado antes de repetir.")
        }
    }

    /// Malva has no per-campaign URL: open the project's campaign list (owner view) and copy the name for its search.
    nonisolated static func malvaCampaignsURL(projectId: String?) -> URL? {
        guard let id = projectId?.lowercased(), id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return nil }
        return URL(string: "https://malvadash.com/tracking/\(id)/campanhas?sales=traffic&preset=today&level=campaign&status=all")
    }
    func openMalva(projectId: String?, campaign: String?) {
        guard let url = Store.malvaCampaignsURL(projectId: projectId) else { return }
        if let campaign, !campaign.isEmpty { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(campaign, forType: .string) }
        NSWorkspace.shared.open(url)
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
        // A loss alerts once. One the owner dismissed alerts once more when its state changed, then the dismissal ends.
        for q in s.queue where q.kind == "loss" {
            let key = AttentionLedger.key(q), came = ledger.cameBack(q)
            if came { ledger.restore(key); ledger.save(); seen.remove("lo:" + q.id) }
            guard !seen.contains("lo:" + q.id) else { continue }
            seen.insert("lo:" + q.id)
            if !isQuiet(q) { fresh.append(("lo:" + q.id, came ? "Perda mudou desde que você dispensou" : "Perda para revisar", (q.campaign ?? "Campanha") + " · " + Format.money(q.amount), .loss)) }
        }
        if approvalsQuiet { fresh.removeAll { $0.3 == .approval } }
        defer { primed = true }
        guard primed, !muted else { return }
        // In a call: hold them (newest three) until it ends.
        if CallWatch.shared.inCall { held = Array((held + fresh).suffix(3)); return }
        deliver(fresh)
    }

    private func releaseHeld() {
        guard !held.isEmpty else { return }
        let items = held; held = []
        if !muted { deliver(items) }
    }

    private func deliver(_ fresh: [(String, String, String, IslandAlert.Kind)]) {
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
