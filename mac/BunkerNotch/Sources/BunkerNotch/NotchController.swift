import AppKit
import Combine
import SwiftUI

enum NotchTab: String, CaseIterable { case now = "Agora", projects = "Projetos", managers = "Gestores", agents = "Agentes", system = "Sistema" }

/// Island geometry for a screen: the real notch when there is one, otherwise a slim bar under the menu bar centre.
struct NotchGeometry: Equatable {
    let hasNotch: Bool
    let width: CGFloat
    let height: CGFloat

    static func measure(_ screen: NSScreen) -> NotchGeometry {
        let top = screen.safeAreaInsets.top
        if top > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            return NotchGeometry(hasNotch: true, width: max(150, screen.frame.width - left.width - right.width), height: top)
        }
        return NotchGeometry(hasNotch: false, width: 200, height: max(24, NSStatusBar.system.thickness))
    }

    /// Pure helpers so the layout can be unit-tested without a screen.
    static func panelOrigin(screen: CGRect, panel: CGSize) -> CGPoint {
        CGPoint(x: screen.midX - panel.width / 2, y: screen.maxY - panel.height)
    }
    static func islandRect(panel: CGSize, island: CGSize) -> CGRect {
        CGRect(x: (panel.width - island.width) / 2, y: panel.height - island.height, width: island.width, height: island.height)
    }
}

/// Transparent panel that may sit over the menu bar and the notch.
final class NotchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

@MainActor
final class NotchState: ObservableObject {
    @Published var mode: IslandFSM.State = .compact
    @Published var activityFilter: String?
    @Published var tab: NotchTab = .now
    @Published var hovered: String?
    /// Campaign opened inside the island (drill-down); nil shows the tabs.
    @Published var selected: Summary.QueueItem?
    /// The Bunker card opened inside the island to adjust a campaign (owner session); nil shows native views.
    @Published var webTarget: URL?
    @Published var webReload = 0
    @Published var webCurrent: URL?
    @Published var pastedLink = ""
    /// Rotating line on the resting island.
    @Published var tick = 0
    @Published var geometry: NotchGeometry
    /// Set by the controller: views call it for clicks on the resting/peek/alert island.
    var onClick: () -> Void = {}
    var onClose: () -> Void = {}
    init(geometry: NotchGeometry) { self.geometry = geometry }

    var expanded: Bool { mode == .open }
    static let openSize = CGSize(width: 660, height: 540)
    static let earWidth: CGFloat = 96
    var islandSize: CGSize {
        let ears = geometry.width + 2 * NotchState.earWidth, top = geometry.height + (geometry.hasNotch ? 0 : 2)
        switch mode {
        case .compact: return CGSize(width: ears, height: top)
        case .peek: return CGSize(width: max(ears + 140, 420), height: top + 30)
        case .alert: return CGSize(width: 500, height: top + 86)
        case .open: return webTarget != nil ? CGSize(width: 700, height: 560) : Self.openSize
        }
    }
}

/// Fixed-size click-through panel; the island inside changes size with the state machine.
/// Hover peeks, click or ⌥⌘B opens, Escape / outside click / inactivity folds, new events show a short alert.
/// Technique studied from the MIT-licensed project credited in mac/NOTICE.md; implementation and look are Bunker's own.
@MainActor
final class NotchController {
    private let panel: NotchPanel
    private let state: NotchState
    private let store: Store
    private var fsm = IslandFSM()
    private var poll: Timer?
    private var pollInterval: TimeInterval = PollRate.far
    private var wasInside = false
    private var alertWork: DispatchWorkItem?
    private var idleWork: DispatchWorkItem?
    private var queue: [IslandAlert] = []
    private var monitors: [Any] = []
    private var bag = Set<AnyCancellable>()
    private static let panelSize = CGSize(width: 700, height: 560)
    static let alertSeconds: TimeInterval = 6
    static let idleSeconds: TimeInterval = 45

    var display: DisplayChoice {
        get { DisplayChoice(rawValue: UserDefaults.standard.string(forKey: "display") ?? "") ?? .notch }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "display"); relocate(force: true) }
    }

    init(store: Store) {
        self.store = store
        let screen = NotchController.screen(for: DisplayChoice(rawValue: UserDefaults.standard.string(forKey: "display") ?? "") ?? .notch)
        state = NotchState(geometry: NotchGeometry.measure(screen))
        panel = NotchPanel(contentRect: NSRect(origin: NotchGeometry.panelOrigin(screen: screen.frame, panel: Self.panelSize), size: Self.panelSize),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.mainMenuWindow)) + 3)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.ignoresMouseEvents = true
        panel.isMovable = false
        let host = NSHostingView(rootView: NotchRootView().environmentObject(store).environmentObject(state))
        host.frame = NSRect(origin: .zero, size: Self.panelSize)
        host.autoresizingMask = [.width, .height]
        panel.contentView = host
        panel.orderFrontRegardless()
        state.onClick = { [weak self] in self?.send(.click) }
        state.onClose = { [weak self] in self?.send(.escape) }
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in Task { @MainActor in guard let self, self.fsm.state == .compact else { return }; withAnimation(DS.Motion.quick) { self.state.tick &+= 1 } } }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.relocate(force: true) }
        }
        // Escape and 1–4 while open; a click anywhere else folds a click-opened island.
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // While the Bunker card is open, every key belongs to it (percent fields, its own Esc).
            guard let self, self.fsm.isOpen, self.state.webTarget == nil else { return event }
            return self.handleKey(event) ? nil : event
        } as Any)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in if self?.fsm.isOpen == true { self?.send(.clickOutside) } }
        } as Any)
        store.$alert.compactMap { $0 }.receive(on: RunLoop.main).sink { [weak self] alert in self?.enqueue(alert) }.store(in: &bag)
        HotKey.register { [weak self] in self?.send(.toggle) }
        schedulePoll(PollRate.far)
    }

    func toggle() { send(.toggle) }

    static func screen(for choice: DisplayChoice) -> NSScreen {
        let screens = NSScreen.screens, mouse = NSEvent.mouseLocation
        guard !screens.isEmpty else { return NSScreen.main! }
        let index = DisplayChoice.resolve(choice, screens: screens.map { ($0.safeAreaInsets.top > 0, $0.frame.contains(mouse)) })
        return screens[min(index, screens.count - 1)]
    }

    private func relocate(force: Bool = false) {
        let screen = Self.screen(for: display)
        let frame = NSRect(origin: NotchGeometry.panelOrigin(screen: screen.frame, panel: Self.panelSize), size: Self.panelSize)
        guard force || frame != panel.frame else { return }
        state.geometry = NotchGeometry.measure(screen)
        panel.setFrame(frame, display: true)
    }

    // MARK: - State machine

    private func send(_ input: IslandFSM.Input) {
        let before = fsm.state
        let after = fsm.handle(input)
        guard after != before else { return }
        withAnimation(DS.Motion.spring) { state.mode = after }
        alertWork?.cancel(); idleWork?.cancel()
        switch after {
        case .open:
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKey()
            scheduleIdle()
        case .alert:
            let work = DispatchWorkItem { [weak self] in Task { @MainActor in self?.send(.alertExpired) } }
            alertWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.alertSeconds, execute: work)
        case .compact:
            state.selected = nil
            state.webTarget = nil
            if panel.isKeyWindow { panel.resignKey() }
            if !queue.isEmpty { let next = queue.removeFirst(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.send(.alert(next)) } }
        case .peek: break
        }
    }

    private func enqueue(_ alert: IslandAlert) {
        if case .compact = fsm.state { send(.alert(alert)) }
        else if case .peek = fsm.state { send(.alert(alert)) }
        else if queue.count < 3, !queue.contains(alert) { queue.append(alert) }
    }

    private func scheduleIdle() {
        let work = DispatchWorkItem { [weak self] in Task { @MainActor in self?.idleCheck() } }
        idleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.idleSeconds, execute: work)
    }
    private func idleCheck() {
        guard fsm.isOpen else { return }
        if wasInside { scheduleIdle() } else { send(.idle) }
    }

    private func handleKey(_ event: NSEvent) -> Bool {
        if event.keyCode == 53 { // Escape: leave the drill-down first, then fold
            if state.selected != nil { withAnimation(DS.Motion.quick) { state.selected = nil } } else { send(.escape) }
            return true
        }
        if let chars = event.charactersIgnoringModifiers, let n = Int(chars), (1...NotchTab.allCases.count).contains(n) {
            withAnimation(DS.Motion.quick) { state.tab = NotchTab.allCases[n - 1] }
            return true
        }
        return false
    }

    // MARK: - Pointer tracking

    private func schedulePoll(_ interval: TimeInterval) {
        pollInterval = interval
        poll?.invalidate()
        poll = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in Task { @MainActor in self?.track() } }
    }

    /// Mouse in panel coordinates (AppKit origin bottom-left) against the current island rect.
    private func track() {
        if display == .followMouse, !fsm.isOpen { relocate() }
        let mouse = NSEvent.mouseLocation, frame = panel.frame
        let island = NotchGeometry.islandRect(panel: frame.size, island: state.islandSize)
        let local = CGPoint(x: mouse.x - frame.minX, y: mouse.y - frame.minY)
        let inside = island.insetBy(dx: -6, dy: -6).contains(local)
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
        if inside != wasInside {
            wasInside = inside
            send(inside ? .mouseEntered : .mouseLeft)
        }
        let next = PollRate.interval(mouse: local, island: island, open: fsm.isOpen)
        if next != pollInterval { schedulePoll(next) }
    }
}
