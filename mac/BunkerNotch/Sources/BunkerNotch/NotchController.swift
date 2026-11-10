import AppKit
import Combine
import SwiftUI

enum NotchTab: String, CaseIterable { case now = "Agora", projects = "Projetos", accounts = "Contas", managers = "Gestores", agents = "Agentes", system = "Sistema" }

/// Pointer pre-filter for the global mouse monitor: within 60 pt of the island panel.
enum NotchHover {
    static func near(_ p: CGPoint, panel: CGRect) -> Bool { panel.insetBy(dx: -60, dy: -60).contains(p) }
}

/// Keyboard while the island is open: 1–6 pick a tab, ← → move between tabs (wrapping). Pure, for the self-test.
enum NotchKeys {
    static func tab(for chars: String?, keyCode: UInt16, current: NotchTab) -> NotchTab? {
        let all = NotchTab.allCases, i = all.firstIndex(of: current) ?? 0
        if keyCode == 123 { return all[(i + all.count - 1) % all.count] }
        if keyCode == 124 { return all[(i + 1) % all.count] }
        if let chars, let n = Int(chars), (1...all.count).contains(n) { return all[n - 1] }
        return nil
    }
}

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
    /// The panel is somewhere else than it should be (more than half a point off, or a different size).
    static func drifted(panel: CGRect, expected: CGRect) -> Bool {
        abs(panel.minX - expected.minX) > 0.5 || abs(panel.minY - expected.minY) > 0.5 || panel.size != expected.size
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
    /// Accounts tab search (name or account id); kept while the notch stays open.
    @Published var accountQuery = ""
    /// Native owner adjustment (Touch ID) for one campaign, or the approvals list when campaignId is nil.
    @Published var adjust: AdjustTarget?
    /// While Touch ID is asking, clicks on the system prompt or a pause must not fold the island.
    @Published var holdOpen = false
    let ownerAdjust = OwnerAdjustModel()
    /// Rotating line on the resting island.
    @Published var tick = 0
    @Published var geometry: NotchGeometry
    /// What Bunk is saying now (nil hides the bubble) and which topic comes next.
    @Published var bunkSays: String?
    @Published var bunkLook: CGFloat = 0
    @Published var bunkHovering = false
    private var bunkTopic = 0
    private var bunkHide: DispatchWorkItem?
    /// Each call says the next topic; the bubble hides by itself after 8 s.
    /// Campaign (or approvals) the current bubble is about; the bubble's button opens its adjustment.
    @Published var bunkTarget: AdjustTarget?
    func bunkSpeak(_ topics: [BunkBrain.Topic]) {
        guard !topics.isEmpty else { return }
        let topic = topics[bunkTopic % topics.count], text = topic.text; bunkTopic += 1
        withAnimation(DS.Motion.quick) { bunkSays = text; bunkTarget = topic.target }
        bunkHide?.cancel()
        let hide = DispatchWorkItem { [weak self] in withAnimation(DS.Motion.quick) { if self?.bunkSays == text { self?.bunkSays = nil } } }
        bunkHide = hide
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: hide)
    }
    /// Set by the controller: views call it for clicks on the resting/peek/alert island.
    var onClick: () -> Void = {}
    var onClose: () -> Void = {}
    /// Pin: the open island stays open (outside clicks and inactivity no longer fold it).
    @Published var fixed = false
    var onFix: () -> Void = {}
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
        case .open: return webTarget != nil || adjust != nil ? CGSize(width: 700, height: 560) : Self.openSize
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
    /// Pointer: event-driven while far (no polling), a short timer only while inside or open.
    private var poll: Timer?
    private var intent = HoverIntent()
    private var dwellWork: DispatchWorkItem?
    private var wasInside = false
    private var alertWork: DispatchWorkItem?
    private var idleWork: DispatchWorkItem?
    private var queue: [IslandAlert] = []
    private var monitors: [Any] = []
    private var bag = Set<AnyCancellable>()
    private static let panelSize = CGSize(width: 700, height: 560)
    /// Short on purpose: an alert that opens by itself folds back after 4 s (idea from notchd's peek/flash).
    static let alertSeconds: TimeInterval = 4
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
        panel.sharingType = UserDefaults.standard.bool(forKey: CapturePrivacy.key) ? .none : .readOnly
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.mainMenuWindow)) + 3)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.ignoresMouseEvents = true
        panel.acceptsMouseMovedEvents = true
        panel.isMovable = false
        let host = NSHostingView(rootView: NotchRootView().environmentObject(store).environmentObject(state))
        host.frame = NSRect(origin: .zero, size: Self.panelSize)
        host.autoresizingMask = [.width, .height]
        panel.contentView = host
        panel.orderFrontRegardless()
        state.onClick = { [weak self] in self?.send(.click) }
        state.onClose = { [weak self] in self?.send(.escape) }
        state.onFix = { [weak self] in self?.toggleFixed() }
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in Task { @MainActor in guard let self, self.fsm.state == .compact else { return }; withAnimation(DS.Motion.quick) { self.state.tick &+= 1 } } }.tolerance = 0.5
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.relocate(force: true) }
            // The window server may still move windows after the notice (displays waking or being rearranged).
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { MainActor.assumeIsolated { self?.relocate(force: true) } }
        }
        // Escape and 1–4 while open; a click anywhere else folds a click-opened island.
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // While the Bunker card is open, every key belongs to it (percent fields, its own Esc).
            guard let self, self.fsm.isOpen, self.state.webTarget == nil else { return event }
            // Native adjustment: its text fields keep every key; Esc goes back to the summary.
            if self.state.adjust != nil {
                if event.keyCode == 53, !self.state.holdOpen { withAnimation(DS.Motion.quick) { self.state.adjust = nil }; return nil }
                return event
            }
            return self.handleKey(event) ? nil : event
        } as Any)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in if self?.fsm.isOpen == true { self?.send(.clickOutside) } }
        } as Any)
        store.$alert.compactMap { $0 }.receive(on: RunLoop.main).sink { [weak self] alert in self?.enqueue(alert) }.store(in: &bag)
        HotKey.register { [weak self] in self?.send(.toggle) }
        // Mouse moves anywhere (no Accessibility permission for mouse events): the island reacts without polling.
        // Every mouse move on the Mac lands here (tens per second): only moves that can matter reach track().
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in
            MainActor.assumeIsolated { self?.trackIfRelevant() }
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] event in
            self?.track(); return event
        } as Any)
        // Slow safety net (screen changes, follow-the-mouse relocation, a missed event).
        Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.healPosition(); self?.track() } }.tolerance = 0.5
    }

    func toggle() { send(.toggle) }
    /// For Bunk on the desktop: where home is, the drop zone that sends him back, and opening the island.
    var bunkHomeScreen: NSScreen { Self.screen(for: display) }
    var bunkHomeZone: NSRect { let s = Self.screen(for: display).frame; return NSRect(x: s.midX - 180, y: s.maxY - 90, width: 360, height: 90) }
    func openIsland() { if !fsm.isOpen { send(.toggle) } }
    /// Bunk's click: open the island straight on that campaign's adjustment (or the approvals list).
    func openAdjust(_ target: AdjustTarget) { state.adjust = target; openIsland() }
    func applyCapturePrivacy(_ hidden: Bool) { panel.sharingType = hidden ? .none : .readOnly }

    static func screen(for choice: DisplayChoice) -> NSScreen {
        let screens = NSScreen.screens, mouse = NSEvent.mouseLocation
        guard !screens.isEmpty else { return NSScreen.main! }
        let index = DisplayChoice.resolve(choice, screens: screens.map { ($0.safeAreaInsets.top > 0, $0.frame.contains(mouse)) })
        return screens[min(index, screens.count - 1)]
    }

    /// Safety net: with several displays sleeping, waking or being rearranged, macOS can move the panel without a
    /// screen-change notice we can act on (seen 10/11 with four screens: the island sat at x = 0 of the main display,
    /// over the app menus). Every 1.5 s, put it back where the chosen screen says it belongs. Follow-the-mouse is
    /// already handled by `track()` while the island is closed.
    private func healPosition() {
        guard display != .followMouse else { return }
        relocate()
    }

    private func relocate(force: Bool = false) {
        let screen = Self.screen(for: display)
        let frame = NSRect(origin: NotchGeometry.panelOrigin(screen: screen.frame, panel: Self.panelSize), size: Self.panelSize)
        guard force || NotchGeometry.drifted(panel: panel.frame, expected: frame) || NotchGeometry.measure(screen) != state.geometry else { return }
        state.geometry = NotchGeometry.measure(screen)
        panel.setFrame(frame, display: true)
    }

    // MARK: - State machine

    private func send(_ input: IslandFSM.Input) {
        if state.holdOpen, [.clickOutside, .idle, .mouseLeft, .escape].contains(input) { return }
        let before = fsm.state
        let after = fsm.handle(input)
        guard after != before else { return }
        // Growing springs open, shrinking settles firmly (DS.Motion.island).
        let size = { (m: IslandFSM.State) -> Int in switch m { case .compact: return 0; case .peek: return 1; case .alert: return 2; case .open: return 3 } }
        withAnimation(DS.Motion.island(opening: size(after) > size(before))) { state.mode = after }
        alertWork?.cancel(); idleWork?.cancel()
        switch after {
        case .open:
            store.islandOpen = true
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKey()
            if !fsm.fixed { scheduleIdle() }
        case .alert(let a):
            Announce.alert(a.title + ". " + a.detail)
            let work = DispatchWorkItem { [weak self] in Task { @MainActor in self?.send(.alertExpired) } }
            alertWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.alertSeconds, execute: work)
        case .compact:
            store.islandOpen = false
            state.fixed = false
            state.selected = nil
            state.webTarget = nil
            state.adjust = nil
            if panel.isKeyWindow { panel.resignKey() }
            if !queue.isEmpty { let next = queue.removeFirst(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.send(.alert(next)) } }
        case .peek: store.islandOpen = false
        }
        updatePoll()
    }

    private func toggleFixed() {
        guard fsm.isOpen else { return }
        fsm.handle(.fix)
        withAnimation(DS.Motion.quick) { state.fixed = fsm.fixed }
        idleWork?.cancel()
        if !fsm.fixed { scheduleIdle() }
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
        guard fsm.isOpen, !fsm.fixed else { return }
        if wasInside { scheduleIdle() } else { send(.idle) }
    }

    private func handleKey(_ event: NSEvent) -> Bool {
        if event.keyCode == 53 { // Escape: leave the drill-down first, then fold
            if state.selected != nil { withAnimation(DS.Motion.quick) { state.selected = nil } } else { send(.escape) }
            return true
        }
        // Typing in a field (the pasted sign-in link) keeps its digits and arrows.
        if event.window?.firstResponder is NSText { return false }
        guard event.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return false }
        if let tab = NotchKeys.tab(for: event.charactersIgnoringModifiers, keyCode: event.keyCode, current: state.tab) {
            withAnimation(DS.Motion.quick) { state.tab = tab; state.selected = nil }
            return true
        }
        return false
    }

    // MARK: - Pointer tracking

    /// A 20 Hz check runs only while the pointer is on the island or the island is open (to notice leaving).
    private func updatePoll() {
        let needed = wasInside || fsm.state != .compact
        if needed, poll == nil {
            poll = Timer.scheduledTimer(withTimeInterval: 1.0 / 20.0, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.track() } }
        } else if !needed, let p = poll { p.invalidate(); poll = nil }
    }

    /// Mouse in panel coordinates (AppKit origin bottom-left) against the current island rect.
    /// Entering needs intention (HoverIntent); leaving uses a slightly wider margin.
    /// Near the island, while it is in use, or (follow-the-mouse) on another screen: otherwise a move cannot change
    /// anything and is ignored. HoverIntent stays correct: speed is only measured once the pointer is near.
    private func trackIfRelevant() {
        if wasInside || fsm.state != .compact || dwellWork != nil { track(); return }
        let mouse = NSEvent.mouseLocation
        if NotchHover.near(mouse, panel: panel.frame) { track(); return }
        if display == .followMouse, let s = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }), s.frame != panel.screen?.frame { track() }
    }

    private func track() {
        if display == .followMouse, !fsm.isOpen { relocate() }
        let mouse = NSEvent.mouseLocation, frame = panel.frame
        let island = NotchGeometry.islandRect(panel: frame.size, island: state.islandSize)
        let local = CGPoint(x: mouse.x - frame.minX, y: mouse.y - frame.minY)
        let over = island.contains(local)
        let inside = wasInside ? island.insetBy(dx: -HoverIntent.leaveMargin, dy: -HoverIntent.leaveMargin).contains(local) : over
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
        if wasInside && !inside {
            wasInside = false; intent.reset(); dwellWork?.cancel(); dwellWork = nil
            send(.mouseLeft); updatePoll(); return
        }
        guard !wasInside else { return }
        // An open (pinned) island or an alert needs no intention to count the pointer as inside.
        if fsm.state != .compact && fsm.state != .peek, over { wasInside = true; send(.mouseEntered); updatePoll(); return }
        switch intent.feed(mouse, at: Date(), inside: over, atTopEdge: mouse.y >= frame.maxY - 2) {
        case .enter:
            dwellWork?.cancel(); dwellWork = nil
            wasInside = true; send(.mouseEntered); updatePoll()
        case .wait(let seconds):
            dwellWork?.cancel(); dwellWork = nil
            let work = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.track() } }
            dwellWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds + 0.01, execute: work)
        case .none:
            dwellWork?.cancel(); dwellWork = nil
        }
    }
}
