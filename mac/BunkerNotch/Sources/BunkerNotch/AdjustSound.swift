import AppKit
import Foundation

/// Owner request (08/11/2026): a sound on this Mac for every increase, reduction and pause, whoever made it
/// (manager in the Malva/Meta or an order sent by the Bunker), with at least five choices per kind in
/// "Configurações de som". It follows the alerts: never on the first read, never while "Silenciar avisos" is on,
/// held during a call (silêncio em reunião). Read-only: it only listens to what the summary already shows.
/// Design references: docs/notch-sounds.md.
enum AdjustSound {
    static let key = "soundOnAdjust"
    static let volumeKey = "soundVolume"
    static let defaultVolume = 0.7
    enum Kind: String, CaseIterable { case increase, reduce, pause }

    static func label(_ k: Kind) -> String {
        switch k { case .increase: return "Aumento"; case .reduce: return "Redução"; case .pause: return "Pausa" }
    }
    static func symbol(_ k: Kind) -> String {
        switch k { case .increase: return "arrow.up.circle"; case .reduce: return "arrow.down.circle"; case .pause: return "pause.circle" }
    }
    static func hint(_ k: Kind) -> String {
        switch k {
        case .increase: return "Contorno que sobe, timbre claro."
        case .reduce: return "Contorno que desce, mais suave."
        case .pause: return "Grave e curto, como um ponto final."
        }
    }

    // MARK: - Catalog (filled from the research in docs/notch-sounds.md)
    static func options(_ k: Kind) -> [SoundOption] { SoundCatalog.options[k] ?? [] }
    static func defaultID(_ k: Kind) -> String { SoundCatalog.defaults[k] ?? options(k).first?.id ?? "" }

    // MARK: - Owner choices (this Mac)
    /// On by default; the menu switch and the settings window turn it off.
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: key) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
    static var volume: Double {
        get { (UserDefaults.standard.object(forKey: volumeKey) as? Double).map { max(0.1, min(1, $0)) } ?? defaultVolume }
        set { UserDefaults.standard.set(max(0.1, min(1, newValue)), forKey: volumeKey) }
    }
    static func choiceKey(_ k: Kind) -> String { "sound." + k.rawValue }
    /// The chosen option; an unknown or removed id falls back to the default.
    static func selected(_ k: Kind) -> SoundOption {
        let id = UserDefaults.standard.string(forKey: choiceKey(k)) ?? defaultID(k)
        return options(k).first { $0.id == id } ?? options(k).first { $0.id == defaultID(k) } ?? options(k)[0]
    }
    static func select(_ k: Kind, _ id: String) {
        guard options(k).contains(where: { $0.id == id }) else { return }
        UserDefaults.standard.set(id, forKey: choiceKey(k))
    }

    // MARK: - From alerts to sounds
    /// The action inside a change alert key ("ac:<action>|…", see Store.changeKey); nil for any other alert.
    static func action(fromKey key: String) -> String? {
        guard key.hasPrefix("ac:") else { return nil }
        return String(key.dropFirst(3).prefix { $0 != "|" })
    }
    /// Kinds among the new alerts, once each, pause first, then reduction, then increase. "activate" has no sound.
    static func kinds(forKeys keys: [String], extra: Set<String> = []) -> [Kind] {
        let actions = Set(keys.compactMap(action(fromKey:))).union(extra)
        return [Kind.pause, .reduce, .increase].filter { actions.contains($0.rawValue) }
    }
    /// Second signal from the summary counters (24h per kind): a kind whose count went up on the same scope had a
    /// new change even when it is not in the 12 newest or repeats an earlier transition. Kinds already in the new
    /// alerts are left out, so nothing rings twice. No previous reading (first load, other project): nothing.
    static func countRise(previous: [String: Int]?, current: [String: Int], alreadyNew: Set<String>) -> Set<String> {
        guard let previous else { return [] }
        return Set(Kind.allCases.map(\.rawValue).filter { (current[$0] ?? 0) > (previous[$0] ?? 0) && !alreadyNew.contains($0) })
    }
    /// The same transition seen again (paused, reactivated, paused again): new when its time is clearly later than
    /// the last one stored. A reread of one change keeps the same or an earlier time (history replaces observed).
    static func repeats(lastAt: Date?, at: Date?) -> Bool {
        guard let lastAt, let at else { return false }
        return at > lastAt.addingTimeInterval(120)
    }
    /// The notification of an alert whose sound is already played here stays silent: the change itself, and the
    /// confirmed receipt of an owner order (its change comes in the same reading as a Bunker activity).
    static func silenced(id: String, isOrder: Bool, playing: [Kind]) -> Bool {
        if let a = action(fromKey: id), let k = Kind(rawValue: a) { return playing.contains(k) }
        return isOrder && id.hasSuffix(":confirmed") && !playing.isEmpty
    }
    /// Plays each kind once, 1 s apart (at most one sound per second), so two kinds in the same read stay distinguishable; `delay` lets another
    /// notification's own sound finish first. `force` is the owner's own preview (plays even with the switch off).
    @MainActor static func play(_ kinds: [Kind], force: Bool = false, delay: Double = 0) {
        guard force || enabled else { return }
        let v = volume
        for (i, k) in kinds.enumerated() {
            let option = selected(k)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay + Double(i) * 1.0) { MainActor.assumeIsolated { SoundPlayer.shared.play(option, volume: v) } }
        }
    }
}
