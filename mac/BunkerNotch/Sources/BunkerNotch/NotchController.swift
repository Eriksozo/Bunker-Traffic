import AppKit
import SwiftUI

enum NotchTab: String, CaseIterable { case now = "Agora", managers = "Gestores", agents = "Agentes", system = "Sistema" }

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
    @Published var expanded = false
    @Published var activityFilter: String?
    @Published var tab: NotchTab = .now
    @Published var hovered: String?
    @Published var geometry: NotchGeometry
    init(geometry: NotchGeometry) { self.geometry = geometry }

    static let expandedSize = CGSize(width: 660, height: 540)
    var islandSize: CGSize {
        expanded ? Self.expandedSize : CGSize(width: geometry.width + 150, height: geometry.height + (geometry.hasNotch ? 0 : 2))
    }
}

/// Fixed-size click-through panel; the island inside grows on hover. Mouse polling decides when the
/// panel accepts clicks, so the rest of the menu bar keeps working. Technique studied from the MIT-licensed
/// open-source project credited in mac/NOTICE.md; the implementation and look here are Bunker's own.
@MainActor
final class NotchController {
    private let panel: NotchPanel
    private let state: NotchState
    private var poll: Timer?
    private var collapseWork: DispatchWorkItem?
    private static let panelSize = CGSize(width: 700, height: 560)

    init(store: Store) {
        let screen = NotchController.preferredScreen()
        state = NotchState(geometry: NotchGeometry.measure(screen))
        let origin = NotchGeometry.panelOrigin(screen: screen.frame, panel: Self.panelSize)
        panel = NotchPanel(contentRect: NSRect(origin: origin, size: Self.panelSize), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
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
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.relocate() }
        }
        poll = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.track() }
        }
    }

    static func preferredScreen() -> NSScreen {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main ?? NSScreen.screens[0]
    }

    func toggle() { setExpanded(!state.expanded) }

    private func relocate() {
        let screen = Self.preferredScreen()
        state.geometry = NotchGeometry.measure(screen)
        panel.setFrame(NSRect(origin: NotchGeometry.panelOrigin(screen: screen.frame, panel: Self.panelSize), size: Self.panelSize), display: true)
    }

    private func setExpanded(_ value: Bool) {
        collapseWork?.cancel()
        guard state.expanded != value else { return }
        withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { state.expanded = value }
    }

    /// Mouse in panel coordinates (AppKit origin bottom-left) against the island rect.
    private func track() {
        let mouse = NSEvent.mouseLocation, frame = panel.frame
        let island = NotchGeometry.islandRect(panel: frame.size, island: state.islandSize).insetBy(dx: -6, dy: -6)
        let inside = island.contains(CGPoint(x: mouse.x - frame.minX, y: mouse.y - frame.minY))
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
        if inside {
            collapseWork?.cancel(); collapseWork = nil
            if !state.expanded { setExpanded(true) }
        } else if state.expanded && collapseWork == nil {
            let work = DispatchWorkItem { [weak self] in Task { @MainActor in self?.setExpanded(false) } }
            collapseWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
        }
    }
}
