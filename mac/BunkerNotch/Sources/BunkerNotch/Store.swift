import AppKit
import Combine
import Foundation
import Network
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
    /// Edit pulse from the executor's fast watch: when it moves, a Malva edit just happened; read the summary now.
    private var pulseTimer: Timer?
    private var pulseVersion: Int?
    private var asleep = false
    private var bag = Set<AnyCancellable>()
    /// Counts new sales; Bunk celebrates on each one. Island alert per sale only when the owner turns it on.
    @Published private(set) var saleTick = 0
    static let saleAlertKey = "alertEachSale"
    /// Alerts and notifications held while the owner is in a call; shown when it ends (at most three, the highest priority).
    private var held: [(String, String, String, IslandAlert.Kind)] = []
    /// Adjustment kinds that arrived during a call: their sound plays when it ends, beyond the three held alerts.
    private var heldSounds = Set<String>()
    /// Latest time seen per change key: the same transition later again (pause, reactivate, pause) rings again.
    private var changeAt: [String: Date] = [:]
    /// Last 24h counters per kind that decoded, with their project: a read whose counters did not decode is unknown, never zero.
    private var lastCounts: AdjustSound.Counters?

    /// Dismissed (until the state changes) and snoozed items: they stop interrupting but stay in the lists.
    @Published private(set) var ledger = AttentionLedger.load()
    func dismiss(_ q: Summary.QueueItem) { ledger.dismiss(q); ledger.save() }
    func snooze(_ key: String, _ choice: AttentionLedger.Snooze) { ledger.snooze(key, until: choice.until(from: Date())); ledger.save() }
    func restore(_ key: String) { ledger.restore(key); ledger.save() }
    /// Every dismissed and snoozed item back, with one write.
    func restoreAll() { for k in Array(ledger.dismissed.keys) + Array(ledger.snoozed.keys) { ledger.restore(k) }; ledger.save() }
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
        // Network back after a failed read: read now instead of waiting for the backoff (up to 15 min).
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in guard let self, self.failures > 0, !self.asleep, !self.loading else { return }; await self.refresh() }
        }
        pathMonitor.start(queue: DispatchQueue(label: "bunker.network"))
        pulseTimer = Timer.scheduledTimer(withTimeInterval: Store.pulseSeconds, repeats: true) { [weak self] _ in Task { @MainActor in await self?.checkPulse() } }
        // Tolerance lets macOS group wake-ups (energy); none of these needs to the exact second.
        pulseTimer?.tolerance = 1
        CallWatch.shared.$inCall.removeDuplicates().dropFirst().receive(on: RunLoop.main).sink { [weak self] inCall in if !inCall { self?.releaseHeld() } }.store(in: &bag)
    }

    static let pulseSeconds: TimeInterval = 8
    /// After an owner order or decision: the pulse is checked every 2 s for two minutes, so the receipt (sent,
    /// confirmed) and the campaign's new status show as soon as the executor writes them.
    static let burstSeconds: TimeInterval = 120
    private var burstTimer: Timer?
    func startBurst() {
        burstTimer?.invalidate()
        let until = Date().addingTimeInterval(Store.burstSeconds)
        burstTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if Date() >= until { self.burstTimer?.invalidate(); self.burstTimer = nil; return }
                Task { await self.checkPulse() }
            }
        }
    }
    /// A tiny read (served by the executor object, no central): only the counter and the newest edit.
    func checkPulse() async {
        // Offline (two failed reads in a row): no pulse every 8 s; the network monitor reads again when it comes back.
        guard !asleep, !loading, failures < 2, let token = Credential.current() else { return }
        var request = URLRequest(url: Store.base.appendingPathComponent("api/companion/pulse"), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let pulse = json["pulse"] as? [String: Any],
              let version = pulse["version"] as? Int else { return }
        defer { pulseVersion = version }
        if let previous = pulseVersion, previous != version { await refresh() }
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
        timer?.tolerance = 5
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
        guard let token = Credential.current() else {
            error = "Credencial do app não encontrada nas Chaves."; return
        }
        // Each read carries a generation: a slower answer for a previous project (or an older read) never
        // overwrites the newer one. Only the newest read updates the state, the failure count and the timer.
        refreshGeneration &+= 1
        let generation = refreshGeneration, asked = project
        loading = true
        var ok = false
        defer { if generation == refreshGeneration { loading = false; failures = ok ? 0 : failures + 1; schedule() } }
        var components = URLComponents(url: Store.base.appendingPathComponent("api/companion"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "project", value: asked)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard generation == refreshGeneration, asked == project else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                if status == 503, summary == nil || preparing { preparing = true; error = nil; ok = true; return }
                if status == 401 { Credential.forget() }
                error = status == 401 ? "Credencial recusada pelo Bunker." : status == 404 ? "Projeto não encontrado." : "Bunker indisponível (\(status)). A última leitura foi mantida."
                if status == 404 { project = "all" }
                return
            }
            preparing = false
            // Decode off the main thread: the island keeps drawing while a large summary is parsed.
            let next = try await Task.detached(priority: .userInitiated) { try JSONDecoder().decode(Summary.self, from: data) }.value
            guard generation == refreshGeneration, asked == project else { return }
            notifyNew(next)
            summary = next
            error = nil
            lastFetch = Date()
            ok = true
        } catch is DecodingError {
            guard generation == refreshGeneration else { return }
            // The Bunker answered but this app version cannot read it: a network message would send the owner the wrong way.
            self.error = "O Bunker mandou um resumo que esta versão do app não lê. A última leitura foi mantida; atualize o app."
        } catch {
            guard generation == refreshGeneration else { return }
            self.error = (error as? URLError)?.code == .timedOut ? "O Bunker demorou a responder. A última leitura foi mantida." : "Sem conexão com o Bunker. A última leitura foi mantida."
        }
    }
    private var refreshGeneration = 0
    private let pathMonitor = NWPathMonitor()

    // MARK: - Owner adjustments (Touch ID). Reads use the read-only credential; every write is signed on this Mac.

    enum OwnerResult: Equatable { case done(String), refused(String), unregistered(String), cancelled }
    enum CardsResult { case ok(OwnerCards), failed(String) }

    /// Cards and proposals waiting for the owner, for one campaign or the whole project.
    func fetchCards(_ target: AdjustTarget) async -> CardsResult {
        guard let token = Credential.current() else { return .failed("Credencial do app não encontrada nas Chaves.") }
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
            if status == 200 { startBurst(); Task { await refresh() }; return .done(json?["status"] as? String ?? "Registrado") }
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
        for e in s.activity.recent {
            let k = Store.changeKey(e), at = Format.date(e.at)
            // The same transition again later (paused, reactivated, paused) is a new change: its own alert id.
            let again = seen.contains(k) && AdjustSound.repeats(lastAt: changeAt[k], at: at)
            if let at { changeAt[k] = max(changeAt[k] ?? at, at) }
            guard !seen.contains(k) || again else { continue }
            seen.insert(k); fresh.append((again ? k + "@" + (e.at ?? "") : k, Format.who(e), (e.campaign ?? "Campanha") + " · " + Format.change(e), .manager))
        }
        let step = AdjustSound.counterStep(last: lastCounts, project: s.project, activity: s.activity, alreadyNew: Set(fresh.compactMap { AdjustSound.action(fromKey: $0.0) }))
        let rise = step.rise; lastCounts = step.last
        // A loss alerts once. One the owner dismissed alerts once more when its state changed, then the dismissal ends.
        for q in s.queue where q.kind == "loss" {
            let key = AttentionLedger.key(q), came = ledger.cameBack(q)
            if came { ledger.restore(key); ledger.save(); seen.remove("lo:" + q.id) }
            guard !seen.contains("lo:" + q.id) else { continue }
            seen.insert("lo:" + q.id)
            if !isQuiet(q) { fresh.append(("lo:" + q.id, came ? "Perda mudou desde que você dispensou" : "Perda para revisar", (q.campaign ?? "Campanha") + " · " + Format.money(q.amount), .loss)) }
        }
        if approvalsQuiet { fresh.removeAll { $0.3 == .approval } }
        // Pace warnings, once a day per project and kind (runs out before 18:00, or far below pace).
        // The Bunker's day (Boa Vista), not UTC: at 21:00 in Brazil the UTC date flips and the same warning would ring again.
        let day = Format.bunkerDay(s.generatedAt)
        for p in (s.pace?.byProject ?? []) where p.alert != nil {
            let key = "pace:" + (p.project ?? "") + ":" + (p.alert ?? "") + ":" + day
            guard !seen.contains(key), let w = Format.paceWarning(p) else { continue }
            seen.insert(key); fresh.append((key, w.title, w.detail, .manager))
        }
        // New sales from the Malva webhook: Bunk celebrates; an island alert only if "avisar cada venda" is on.
        var newSales = 0
        for sale in s.sales?.recent ?? [] {
            let key = "sa:" + sale.at + ":" + String(sale.amount)
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            guard primed else { continue }
            newSales += 1
            if UserDefaults.standard.bool(forKey: Store.saleAlertKey) {
                fresh.append((key, "Venda agora · " + Format.money(sale.amount, currency: sale.currency), [sale.product, sale.campaign].compactMap { $0 }.joined(separator: " · "), .sale))
            }
        }
        if newSales > 0 && primed && !muted { saleTick &+= newSales }
        // Receipts of the owner's direct orders and of Bunk autonomy orders: tell once when one ends (confirmed by the reread, failed or to verify).
        for o in s.orders ?? [] where ["confirmed", "failed", "verify"].contains(o.stage) {
            let key = "or:" + o.id + ":" + o.stage
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            let title = Format.orderAlertTitle(o)
            fresh.append((key, title, (o.campaign ?? "Campanha") + " · " + Format.orderChange(o) + (o.reason.map { " · " + $0 } ?? ""), .order))
        }
        defer {
            primed = true; Store.trimSeen(&seen, keep: fresh.map(\.0) + Store.presentKeys(s, day: day))
            if changeAt.count > Store.seenLimit { changeAt = changeAt.filter { seen.contains($0.key) } }
        }
        guard primed, !muted else { return }
        // In a call: hold the three of highest priority (a later read first within a kind) until it ends, so routine
        // changes never push out an order, an approval or a loss; every adjustment kind is kept for its sound.
        if CallWatch.shared.inCall {
            heldSounds.formUnion(AdjustSound.kinds(forKeys: fresh.map(\.0), extra: rise).map(\.rawValue))
            held = Store.keepHeld(held, fresh); return
        }
        deliver(fresh, soundsAlso: rise)
    }

    /// Every alert key the current summary would produce: kept when the memory of seen alerts is trimmed.
    nonisolated static func presentKeys(_ s: Summary, day: String) -> [String] {
        s.approvals.items.map { "ap:" + $0.id } + s.activity.recent.map(changeKey) + s.queue.filter { $0.kind == "loss" }.map { "lo:" + $0.id }
            + (s.pace?.byProject ?? []).compactMap { p in p.alert.map { "pace:" + (p.project ?? "") + ":" + $0 + ":" + day } }
            + (s.sales?.recent ?? []).map { "sa:" + $0.at + ":" + String($0.amount) } + (s.orders ?? []).map { "or:" + $0.id + ":" + $0.stage }
    }
    /// Seen alerts stay bounded over days of uptime: past the limit only what the summary still shows is kept
    /// (anything older cannot come back in the summary, so it cannot ring twice).
    nonisolated static let seenLimit = 2000
    nonisolated static func trimSeen(_ seen: inout Set<String>, keep: [String]) {
        guard seen.count > seenLimit else { return }
        seen = Set(keep).intersection(seen)
    }

    private func releaseHeld() {
        guard !held.isEmpty || !heldSounds.isEmpty else { return }
        let items = held, sounds = heldSounds; held = []; heldSounds = []
        if !muted { deliver(items, soundsAlso: sounds) }
    }

    /// Orders first, then approvals, losses, manager changes and sales; the same kind keeps its arrival order.
    nonisolated static func byPriority<C: Sequence>(_ items: C) -> [(String, String, String, IslandAlert.Kind)] where C.Element == (String, String, String, IslandAlert.Kind) {
        let order: [IslandAlert.Kind: Int] = [.order: 0, .approval: 1, .loss: 2, .manager: 3, .sale: 4]
        return items.enumerated().sorted { (order[$0.1.3] ?? 9, $0.0) < (order[$1.1.3] ?? 9, $1.0) }.map(\.1)
    }

    /// What stays held during a call: the three of highest priority; within a kind a later read goes first, and one
    /// read keeps its own order (the server lists changes newest first), the same three deliver would show for it.
    nonisolated static func keepHeld(_ held: [(String, String, String, IslandAlert.Kind)], _ fresh: [(String, String, String, IslandAlert.Kind)]) -> [(String, String, String, IslandAlert.Kind)] {
        Array(byPriority(fresh + held).prefix(3))   // held is already ranked
    }

    private func deliver(_ fresh: [(String, String, String, IslandAlert.Kind)], soundsAlso extra: Set<String> = []) {
        // Orders, approvals and losses before manager changes: at most three island alerts and four notifications per refresh.
        let ranked = Store.byPriority(fresh)
        for item in ranked.prefix(3) { alert = IslandAlert(id: item.0, kind: item.3, title: item.1, detail: item.2) }
        guard Bundle.main.bundleIdentifier != nil else { return }
        // Increase, reduction and pause have their own sound (every new kind, not only the first alerts); their
        // notifications then go silent so the same change never rings twice. Another notification that rings in
        // the same batch goes first. The app's sound switch in System Settings › Notifications also silences it.
        let sounds = AdjustSound.enabled ? AdjustSound.kinds(forKeys: fresh.map(\.0), extra: extra) : []
        let notes = ranked.prefix(4).map { ($0, AdjustSound.silenced(id: $0.0, isOrder: $0.3 == .order, playing: sounds)) }
        if !sounds.isEmpty {
            let othersRing = notes.contains { !$0.1 }
            Task { @MainActor in
                if await UNUserNotificationCenter.current().notificationSettings().soundSetting == .disabled { return }
                AdjustSound.play(sounds, delay: othersRing ? 1.0 : 0)
            }
        }
        for ((id, title, body, _), quiet) in notes {
            let content = UNMutableNotificationContent()
            content.title = title; content.body = body; content.sound = quiet ? nil : .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}
