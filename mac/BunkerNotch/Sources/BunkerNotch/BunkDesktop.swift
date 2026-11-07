import AppKit
import Combine
import SwiftUI

/// Observable bridge between the controller and the SwiftUI drawing (no @State: the Command Line Tools lack its macro).
@MainActor final class BunkStage: ObservableObject {
    @Published var mood: BunkMood = .idle
    @Published var reaction: BunkReaction?
    @Published var walking = false
    @Published var look: CGFloat = 0
    @Published var lookY: CGFloat = 0
    @Published var bubble: String?
    @Published var hovered = false
    @Published var squash: CGFloat = 0
}

struct BunkStageView: View {
    @ObservedObject var stage: BunkStage
    var body: some View {
        VStack(spacing: 4) {
            Spacer(minLength: 0)
            if let text = stage.bubble {
                Text(text)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.95))
                    .multilineTextAlignment(.center)
                    .lineLimit(4)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.black.opacity(0.86), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DS.Color.accent.opacity(0.6), lineWidth: 1))
                    .frame(maxWidth: BunkDesk.panel.width - 16)
                    .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .bottom)))
            }
            BunkView(mood: stage.mood, size: BunkDesk.bunkSize, look: stage.look, lookY: stage.lookY, feet: true, walking: stage.walking, reaction: stage.reaction)
                .scaleEffect(x: 1 + 0.16 * stage.squash, y: 1 - 0.24 * stage.squash, anchor: .bottom)
                .scaleEffect(stage.hovered ? 1.08 : 1, anchor: .bottom)
                .animation(.spring(response: 0.25, dampingFraction: 0.6), value: stage.hovered)
        }
        .padding(.bottom, BunkDesk.footInset)
        .frame(width: BunkDesk.panel.width, height: BunkDesk.panel.height, alignment: .bottom)
        .animation(.easeOut(duration: 0.18), value: stage.bubble)
    }
}

/// Bunk out of the notch: tours every screen when something needs the owner, visits the pointer's screen on
/// manager changes and calm days, and can live on the desktop. Read-only: talks and points, never decides.
@MainActor final class BunkDesktopController {
    private let store: Store
    private weak var notch: NotchController?
    private let stage = BunkStage()
    private var panel: NSPanel?
    private var timer: Timer?, timerRate: TimeInterval = 0
    private var feet: CGPoint = .zero
    private var stops: [RoamStop] = [], stopIndex = 0, pauseUntil: Date?, speed: CGFloat = 340, flying = false
    private var finish: (() -> Void)?
    private var roaming = false
    private var memory = RoamPolicy.Memory()
    private var lines: [String] = [], lineIndex = 0
    private var lastActivity = Date(), yawned = false
    private var dragStart: NSPoint?, dragOrigin = NSPoint.zero, dragging = false
    private var clickWork: DispatchWorkItem?, bubbleWork: DispatchWorkItem?, reactionWork: DispatchWorkItem?
    private var monitors: [Any] = []
    private var bag = Set<AnyCancellable>()
    private var screenAsleep = false

    static let roamKey = "bunkRoam", residentKey = "bunkResident", spotKey = "bunkSpot"
    var roamEnabled: Bool { get { UserDefaults.standard.bool(forKey: Self.roamKey) } set { UserDefaults.standard.set(newValue, forKey: Self.roamKey) } }
    var resident: Bool { UserDefaults.standard.bool(forKey: Self.residentKey) }

    init(store: Store, notch: NotchController) {
        self.store = store; self.notch = notch
        UserDefaults.standard.register(defaults: [Self.roamKey: true, Self.residentKey: false])
        store.$alert.compactMap { $0 }.receive(on: RunLoop.main).sink { [weak self] alert in self?.handle(alert) }.store(in: &bag)
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.idleCheck() } }
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.screenAsleep = true; self?.stopTimer() } }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.screenAsleep = false; self?.retime() } }
        if resident { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.flyOut() } }
    }

    // MARK: - Owner switches (menu bar)

    func setRoam(_ on: Bool) { roamEnabled = on; if !on && roaming && !resident { endRoam(goHome: true) } }
    func setResident(_ on: Bool) { UserDefaults.standard.set(on, forKey: Self.residentKey); on ? flyOut() : goHome() }
    func callNow() { consider(.demo, lines: BunkBrain.lines(store.summary, error: store.error, preparing: store.preparing)) }

    // MARK: - Triggers

    private func handle(_ alert: IslandAlert) {
        lastActivity = Date()
        let text = alert.detail.isEmpty ? alert.title : alert.title + " · " + alert.detail
        consider(alert.kind == .manager ? .manager : .attention(alert.kind), lines: [text])
        if alert.kind == .approval { react(.surprised, for: 1.4) }
    }

    private func idleCheck() {
        guard !roaming else { return }
        let all = BunkBrain.lines(store.summary, error: store.error, preparing: store.preparing)
        if resident { if BunkBrain.awake(Date()), Int.random(in: 0..<4) == 0 { speak(all.first ?? "Sigo vigiando.") }; return }
        consider(.idle, lines: Array(all.prefix(1)))
    }

    private func consider(_ reason: RoamReason, lines: [String]) {
        let now = Date()
        guard RoamPolicy.allow(reason, memory: memory, now: now, enabled: roamEnabled, muted: store.muted, awake: BunkBrain.awake(now), busy: roaming || dragging) else { return }
        memory = RoamPolicy.remember(reason, memory, now: now)
        self.lines = lines.isEmpty ? ["Sigo vigiando."] : lines; lineIndex = 0
        startRoam(reason)
    }

    // MARK: - Movement

    static func displayID(_ s: NSScreen) -> UInt32 { (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0 }
    private var savedScreens: [UInt32] { (UserDefaults.standard.array(forKey: BunkScreens.key) as? [Int])?.map { UInt32($0) } ?? [] }
    /// Screens the owner allowed (all of them when nothing is chosen or the chosen ones are disconnected).
    var allowedScreens: [NSScreen] {
        let ok = BunkScreens.allowed(all: NSScreen.screens.map(Self.displayID), saved: savedScreens)
        return NSScreen.screens.filter { ok.contains(Self.displayID($0)) }
    }
    func isAllowed(_ s: NSScreen) -> Bool { allowedScreens.contains { Self.displayID($0) == Self.displayID(s) } }
    func toggleScreen(_ s: NSScreen) {
        let next = BunkScreens.toggle(Self.displayID(s), all: NSScreen.screens.map(Self.displayID), saved: savedScreens)
        UserDefaults.standard.set(next.map { Int($0) }, forKey: BunkScreens.key)
        if resident, let p = panel, !allowedScreens.contains(where: { $0.frame.contains(feet) }) { _ = p; run([RoamStop(point: savedSpot(), pause: 0, speak: false)], speed: 600) { [weak self] in self?.land() } }
    }
    func allowAllScreens() { UserDefaults.standard.removeObject(forKey: BunkScreens.key) }
    private func nearestAllowed(to p: CGPoint) -> NSScreen? {
        allowedScreens.first { $0.frame.contains(p) } ?? allowedScreens.min { hypot($0.frame.midX - p.x, $0.frame.midY - p.y) < hypot($1.frame.midX - p.x, $1.frame.midY - p.y) }
    }
    private func screensInfo() -> [(frame: CGRect, visible: CGRect)] { allowedScreens.map { ($0.frame, $0.visibleFrame) } }
    private var notchScreen: NSScreen { notch?.bunkHomeScreen ?? NSScreen.main ?? NSScreen.screens[0] }
    private var homePoint: CGPoint { CGPoint(x: notchScreen.frame.midX, y: notchScreen.visibleFrame.maxY - 70) }

    private func startRoam(_ reason: RoamReason) {
        let pointer = allowedScreens.first { $0.frame.contains(NSEvent.mouseLocation) }?.frame
        var route = RoamPlanner.route(reason: reason, notchScreen: notchScreen.frame, notchVisible: notchScreen.visibleFrame, screens: screensInfo(), pointerScreen: pointer, width: BunkDesk.panel.width)
        if resident && panel != nil {
            // Living on the desktop: start and end at his spot; a visit is a word in place.
            if reason.tour { route[0] = RoamStop(point: feet, pause: 0, speak: false); route[route.count - 1] = RoamStop(point: feet, pause: 0, speak: false) }
            else { route = [RoamStop(point: feet, pause: reason == .manager ? 4.5 : 5.5, speak: true)] }
        } else {
            show(at: route[0].point)
        }
        switch reason {
        case .attention, .demo: stage.mood = .alert; react(.surprised, for: 1.2)
        case .manager: stage.mood = .watching
        case .idle: stage.mood = BunkBrain.mood(store.summary, error: store.error, preparing: store.preparing, muted: store.muted) == .happy ? .happy : .idle
        }
        roaming = true
        run(route, speed: 340) { [weak self] in self?.endRoam(goHome: false) }
    }

    private func endRoam(goHome home: Bool) {
        roaming = false; stage.bubble = nil
        if resident && !home { settle(); return }
        run([RoamStop(point: homePoint, pause: 0, speak: false)], speed: 900, fly: true) { [weak self] in self?.hide() }
    }

    private func flyOut() {
        guard resident else { return }
        let spot = savedSpot()
        if panel == nil { show(at: homePoint) }
        run([RoamStop(point: spot, pause: 0, speak: false)], speed: 900, fly: true) { [weak self] in self?.land() }
    }

    private func goHome() {
        UserDefaults.standard.set(false, forKey: Self.residentKey)
        roaming = false; stage.bubble = nil
        guard panel != nil else { return }
        run([RoamStop(point: homePoint, pause: 0, speak: false)], speed: 900, fly: true) { [weak self] in self?.hide() }
    }

    private func land() {
        stage.squash = 1
        withAnimation(.spring(response: 0.35, dampingFraction: 0.45)) { stage.squash = 0 }
        react(.happy, for: 0.8)
        settle()
    }

    private func settle() {
        stops = []; finish = nil; stage.walking = false
        stage.mood = BunkBrain.mood(store.summary, error: store.error, preparing: store.preparing, muted: store.muted)
        retime()
    }

    private func run(_ route: [RoamStop], speed: CGFloat, fly: Bool = false, then done: @escaping () -> Void) {
        stops = route; stopIndex = 0; pauseUntil = nil; self.speed = speed; flying = fly; finish = done
        retime()
    }

    // MARK: - Panel

    private func show(at point: CGPoint) {
        if panel == nil {
            let p = NSPanel(contentRect: NSRect(origin: .zero, size: BunkDesk.panel), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.backgroundColor = .clear; p.isOpaque = false; p.hasShadow = false
            p.level = .statusBar
            p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            p.ignoresMouseEvents = true; p.hidesOnDeactivate = false; p.isMovable = false
            let host = NSHostingView(rootView: BunkStageView(stage: stage))
            host.frame = NSRect(origin: .zero, size: BunkDesk.panel)
            p.contentView = host
            panel = p
            addMonitors()
        }
        feet = point
        panel?.setFrameOrigin(BunkDesk.origin(feet: point))
        panel?.orderFrontRegardless()
        retime()
    }

    private func hide() {
        stopTimer(); removeMonitors()
        panel?.orderOut(nil); panel = nil
        stops = []; finish = nil; roaming = false; stage.bubble = nil; stage.walking = false
    }

    // MARK: - Frame loop (60 Hz moving, 30 Hz awake, 10 Hz asleep)

    private func retime() {
        guard panel != nil, !screenAsleep else { stopTimer(); return }
        let rate: TimeInterval = !stops.isEmpty ? 1.0 / 60.0 : stage.mood == .sleeping ? 0.1 : 1.0 / 30.0
        guard rate != timerRate || timer == nil else { return }
        stopTimer(); timerRate = rate
        let t = Timer(timeInterval: rate, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.frame() } }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
    private func stopTimer() { timer?.invalidate(); timer = nil; timerRate = 0 }

    private func frame() {
        guard let p = panel else { return }
        let mouse = NSEvent.mouseLocation, origin = p.frame.origin
        let local = CGPoint(x: mouse.x - origin.x, y: mouse.y - origin.y)
        let over = BunkDesk.isOverBody(local) || (stage.bubble != nil && BunkDesk.bubble.contains(local))
        if p.ignoresMouseEvents == (over || dragging) { p.ignoresMouseEvents = !(over || dragging) }
        let hovering = over && !dragging
        if stage.hovered != hovering { stage.hovered = hovering; if hovering { lastActivity = Date() } }
        let center = CGPoint(x: feet.x, y: feet.y + BunkDesk.bunkSize / 2)
        let gaze = BunkDesk.gaze(dx: mouse.x - center.x, dy: mouse.y - center.y)

        if !stops.isEmpty && !dragging {
            if let until = pauseUntil {
                stage.walking = false; stage.look = gaze.x; stage.lookY = gaze.y
                if Date() >= until && !hovering { pauseUntil = nil; stage.bubble = nil; stopIndex += 1 }
            } else if stopIndex < stops.count {
                let target = stops[stopIndex].point
                let step = BunkDesk.step(from: feet, to: target, distance: speed * CGFloat(timerRate))
                stage.walking = !flying
                stage.look = target.x > feet.x + 1 ? 1 : target.x < feet.x - 1 ? -1 : stage.look; stage.lookY = flying ? -0.4 : 0
                feet = step.point
                p.setFrameOrigin(BunkDesk.origin(feet: feet))
                if step.arrived {
                    let stop = stops[stopIndex]
                    if stop.pause > 0 {
                        pauseUntil = Date().addingTimeInterval(stop.pause)
                        if stop.speak { stage.bubble = lines[lineIndex % lines.count]; lineIndex += 1 }
                    } else { stopIndex += 1 }
                }
            }
            if stopIndex >= stops.count {
                let done = finish; stops = []; finish = nil; stage.walking = false
                retime(); done?()
            }
            return
        }
        // Living on the desktop: follow the pointer with the eyes, doze off when nothing happens.
        stage.look = gaze.x; stage.lookY = gaze.y
        let distance = ((mouse.x - center.x) * (mouse.x - center.x) + (mouse.y - center.y) * (mouse.y - center.y)).squareRoot()
        let asleep = !roaming && BunkDesk.shouldSleep(idle: Date().timeIntervalSince(lastActivity), mouseDistance: distance)
        let mood: BunkMood = asleep ? .sleeping : BunkBrain.mood(store.summary, error: store.error, preparing: store.preparing, muted: store.muted)
        if mood == .sleeping && stage.mood != .sleeping && !yawned { yawned = true; react(.yawn, for: 1.6) }
        if mood != .sleeping { yawned = false }
        if stage.mood != mood { stage.mood = mood; retime() }
    }

    // MARK: - Talking and reactions

    private func speak(_ text: String, for seconds: TimeInterval = 6) {
        stage.bubble = text
        bubbleWork?.cancel()
        let w = DispatchWorkItem { [weak self] in if self?.stage.bubble == text { self?.stage.bubble = nil } }
        bubbleWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: w)
    }
    private func react(_ r: BunkReaction, for seconds: TimeInterval) {
        stage.reaction = r
        reactionWork?.cancel()
        let w = DispatchWorkItem { [weak self] in if self?.stage.reaction == r { self?.stage.reaction = nil } }
        reactionWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: w)
    }
    private var topicIndex = 0
    private func nextTopic() {
        let all = BunkBrain.lines(store.summary, error: store.error, preparing: store.preparing)
        guard !all.isEmpty else { return }
        speak(all[topicIndex % all.count]); topicIndex += 1
    }

    // MARK: - Mouse: click (wink + talk / open), double click (home), drag (move), right click (menu)

    private func addMonitors() {
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            MainActor.assumeIsolated { guard let self, event.window === self.panel else { return }; self.dragStart = NSEvent.mouseLocation; self.dragOrigin = self.panel?.frame.origin ?? .zero }
            return event
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .leftMouseDragged) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, let start = self.dragStart, let p = self.panel else { return }
                let m = NSEvent.mouseLocation
                if !self.dragging { guard hypot(m.x - start.x, m.y - start.y) > 3 else { return }; self.dragging = true; self.stage.bubble = nil }
                var f = BunkDesk.feet(origin: CGPoint(x: self.dragOrigin.x + m.x - start.x, y: self.dragOrigin.y + m.y - start.y))
                // Only allowed screens: dragging onto another one keeps him at the edge of the nearest allowed screen.
                if let v = self.nearestAllowed(to: m)?.visibleFrame { f = BunkDesk.clamp(feet: f, visible: v) }
                self.feet = f; p.setFrameOrigin(BunkDesk.origin(feet: f))
            }
            return event
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .leftMouseUp) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self else { return }
                let was = self.dragging; self.dragging = false; self.dragStart = nil
                if was { self.dropped() } else if event.window === self.panel { self.clicked(event.clickCount) }
            }
            return event
        } as Any)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: .leftMouseUp) { [weak self] _ in
            Task { @MainActor in guard let self, self.dragging else { return }; self.dragging = false; self.dragStart = nil; self.dropped() }
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown) { [weak self] event in
            MainActor.assumeIsolated { guard let self, event.window === self.panel else { return }; self.menu(at: event) }
            return event
        } as Any)
    }
    private func removeMonitors() { monitors.forEach { NSEvent.removeMonitor($0) }; monitors = [] }

    private func clicked(_ count: Int) {
        lastActivity = Date(); clickWork?.cancel()
        if count >= 2 { goHome(); return }
        let w = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if self.roaming { self.notch?.openIsland(); self.endRoam(goHome: false) }
            else { self.react(.wink, for: 0.7); self.nextTopic() }
        }
        clickWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + NSEvent.doubleClickInterval, execute: w)
    }

    private func dropped() {
        lastActivity = Date()
        if notch?.bunkHomeZone.contains(NSEvent.mouseLocation) == true { goHome(); return }
        if roaming { stops = []; finish = nil; roaming = false }
        if resident {
            UserDefaults.standard.set([Double(feet.x), Double(feet.y)], forKey: Self.spotKey)
            react(.happy, for: 0.6); settle()
        } else {
            // Not living on the desktop: thank and go back home.
            react(.happy, for: 0.6)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.endRoam(goHome: true) }
        }
    }

    private func savedSpot() -> CGPoint {
        let main = (isAllowed(notchScreen) ? notchScreen : allowedScreens.first ?? notchScreen).visibleFrame
        if let a = UserDefaults.standard.array(forKey: Self.spotKey) as? [Double], a.count == 2 {
            let p = CGPoint(x: a[0], y: a[1])
            if let s = allowedScreens.first(where: { $0.frame.contains(p) }) { return BunkDesk.clamp(feet: p, visible: s.visibleFrame) }
        }
        return BunkDesk.clamp(feet: CGPoint(x: main.maxX - 140, y: main.minY), visible: main)
    }

    private func menu(at event: NSEvent) {
        let m = NSMenu()
        func add(_ title: String, _ action: @escaping () -> Void) { let i = BunkMenuItem(title: title, action: action); m.addItem(i) }
        add("Abrir no notch") { [weak self] in self?.notch?.openIsland() }
        add("O que está acontecendo?") { [weak self] in self?.nextTopic() }
        if roaming { add("Já vi") { [weak self] in self?.endRoam(goHome: false) } }
        if resident { add("Voltar para o notch") { [weak self] in self?.setResident(false) } }
        else { add("Ficar no desktop") { [weak self] in self?.setResident(true) } }
        m.addItem(.separator())
        add("Silenciar avisos por 1 hora") { [weak self] in self?.store.mute(hours: 1); self?.speak("Tudo bem, fico quieto por 1 hora.", for: 3) }
        add("Guardar o Bunk (sem passeios)") { [weak self] in self?.setRoam(false); self?.setResident(false) }
        if let view = panel?.contentView { NSMenu.popUpContextMenu(m, with: event, for: view) }
    }
}

/// Menu item that runs a closure (keeps the controller free of @objc selectors).
private final class BunkMenuItem: NSMenuItem {
    private let run: () -> Void
    init(title: String, action: @escaping () -> Void) {
        run = action
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }
    required init(coder: NSCoder) { fatalError("unused") }
    @objc private func fire() { run() }
}
