import Foundation

/// One in-island alert (new approval, manager change, loss). Shown briefly, then the island folds back.
struct IslandAlert: Equatable, Identifiable {
    let id: String
    let kind: Kind
    let title: String
    let detail: String
    /// `order`: a receipt of the owner's direct order (confirmed, failed or to verify). `funnel`: a VIGIA signal
    /// (no sale for hours, page down, vTurb × checkout); its id starts with "vg:".
    enum Kind: Equatable { case approval, manager, loss, order, sale, funnel }
}

/// Pure island behaviour, no AppKit: hover peeks, click/hotkey opens, Escape/outside click folds,
/// alerts expand for a few seconds. Studied from the MIT-licensed notch app credited in mac/NOTICE.md.
struct IslandFSM: Equatable {
    enum State: Equatable { case compact, peek, open, alert(IslandAlert) }
    enum Input: Equatable { case mouseEntered, mouseLeft, click, toggle, escape, clickOutside, alert(IslandAlert), alertExpired, idle, fix }

    private(set) var state: State = .compact
    /// Open by click/hotkey stays open while the pointer visits menus outside the island.
    private(set) var pinned = false
    /// Owner's pin button: an open island ignores outside clicks and inactivity until closed (X, Esc, hotkey).
    private(set) var fixed = false

    var isOpen: Bool { state == .open }

    @discardableResult
    mutating func handle(_ input: Input) -> State {
        if fixed, state == .open, input == .clickOutside || input == .idle { return state }
        switch (state, input) {
        case (.open, .fix): fixed.toggle()
        case (.compact, .mouseEntered): state = .peek
        case (.peek, .mouseLeft): state = .compact
        case (.compact, .click), (.peek, .click), (.alert, .click): state = .open; pinned = true
        case (.open, .toggle): state = .compact; pinned = false; fixed = false
        case (_, .toggle): state = .open; pinned = true
        case (.open, .escape), (.open, .clickOutside), (.open, .idle): state = .compact; pinned = false; fixed = false
        case (.open, .mouseLeft): if !pinned { state = .compact }
        case (.alert, .escape), (.alert, .alertExpired): state = .compact
        case (.alert, .mouseLeft): break // the expiry timer folds it; leaving never hides an alert early
        case (.compact, .alert(let a)), (.peek, .alert(let a)): state = .alert(a)
        case (.alert, .alert(let a)): state = .alert(a)
        default: break // an open island is never replaced by an alert
        }
        return state
    }
}

/// Which screen hosts the island. The notch screen by default; "follow the mouse" for multi-monitor desks.
enum DisplayChoice: String, CaseIterable {
    case notch, menuBar, followMouse
    var label: String {
        switch self { case .notch: return "Tela com notch"; case .menuBar: return "Tela principal (barra de menus)"; case .followMouse: return "Tela com o mouse" }
    }
    /// Pure resolver over screen descriptors (index into the list), for tests and the controller alike.
    static func resolve(_ choice: DisplayChoice, screens: [(hasNotch: Bool, containsMouse: Bool)]) -> Int {
        guard !screens.isEmpty else { return 0 }
        switch choice {
        case .notch: return screens.firstIndex { $0.hasNotch } ?? 0
        case .menuBar: return 0
        case .followMouse: return screens.firstIndex { $0.containsMouse } ?? (screens.firstIndex { $0.hasNotch } ?? 0)
        }
    }
}
