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
    /// Lean while airborne (thrown or falling), degrees; back to 0 on landing.
    @Published var tilt: Double = 0
    /// Gaze follows the pointer; a write with the same value would still redraw, so tiny moves are ignored.
    func setGaze(_ x: CGFloat, _ y: CGFloat) {
        if abs(look - x) > 0.03 { look = x }
        if abs(lookY - y) > 0.03 { lookY = y }
    }
    /// Standing still and calm: breathing only, so 10 frames per second are enough (was 30 all day).
    var resting: Bool { BunkStage.restingMoods.contains(mood) && !walking && reaction == nil && !hovered && bubble == nil && squash == 0 && tilt == 0 }
    nonisolated static let restingMoods: Set<BunkMood> = [.idle, .watching, .sleeping]
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
                    .background(Color.black.opacity(A11y.reduceTransparency ? 1 : 0.86), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DS.Color.accent.opacity(0.6), lineWidth: 1))
                    .frame(maxWidth: BunkDesk.panel.width - 16)
                    .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .bottom)))
            }
            BunkView(mood: stage.mood, size: BunkDesk.bunkSize, look: stage.look, lookY: stage.lookY, feet: true, walking: stage.walking, reaction: stage.reaction, resting: stage.resting)
                .scaleEffect(x: 1 + 0.16 * stage.squash, y: 1 - 0.24 * stage.squash, anchor: .bottom)
                .scaleEffect(stage.hovered ? 1.08 : 1, anchor: .bottom)
                .rotationEffect(.degrees(stage.tilt), anchor: .bottom)
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
    /// Campaign (or approvals) the current warning or bubble is about: a click opens its adjustment.
    private var currentTarget: AdjustTarget?
    private var lastActivity = Date(), yawned = false
    private var dragStart: NSPoint?, dragOrigin = NSPoint.zero, dragging = false
    /// Recent drag positions, for the throw speed on release; and the flight in progress after a throw.
    private var dragSamples: [(p: CGPoint, t: Double)] = []
    private var flight: BunkMotion.Flight?
    private var clickWork: DispatchWorkItem?, bubbleWork: DispatchWorkItem?, reactionWork: DispatchWorkItem?
    private var monitors: [Any] = []
    private var bag = Set<AnyCancellable>()
    private var screenAsleep = false
    /// Since when he has been out with nothing to do while not living on the desktop.
    private var strayedAt: Date?

    static let roamKey = "bunkRoam", residentKey = "bunkResident", spotKey = "bunkSpot"
    var roamEnabled: Bool { get { UserDefaults.standard.bool(forKey: Self.roamKey) } set { UserDefaults.standard.set(newValue, forKey: Self.roamKey) } }
    var resident: Bool { UserDefaults.standard.bool(forKey: Self.residentKey) }

    init(store: Store, notch: NotchController) {
        self.store = store; self.notch = notch
        UserDefaults.standard.register(defaults: [Self.roamKey: true, Self.residentKey: false])
        store.$alert.compactMap { $0 }.receive(on: RunLoop.main).sink { [weak self] alert in self?.handle(alert) }.store(in: &bag)
        // A sale: a quick celebration where he is, never a walk across the screens.
        store.$saleTick.dropFirst().receive(on: RunLoop.main).sink { [weak self] _ in self?.react(.happy, for: 1.4) }.store(in: &bag)
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.idleCheck() } }.tolerance = 10
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.screenAsleep = true; self?.stopTimer() } }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.screenAsleep = false; self?.retime() } }
        // Another app came forward: its windows may now be under (or over) Bunk, read them quickly for a few seconds.
        ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.fastReadsUntil = Date().addingTimeInterval(3); self?.windowsReadAt = .distantPast } }
        // Locked screen: same pause as a sleeping display (public distributed notifications).
        let dnc = DistributedNotificationCenter.default()
        dnc.addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.screenAsleep = true; self?.stopTimer() } }
        dnc.addObserver(forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.screenAsleep = false; self?.retime() } }
        // A disconnected monitor never strands him off-screen.
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.relocateIfStranded() } }
        if resident { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.flyOut() } }
    }

    // MARK: - Owner switches (menu bar)

    func setRoam(_ on: Bool) { roamEnabled = on; if !on && roaming && !resident { endRoam(goHome: true) } }
    func setResident(_ on: Bool) { UserDefaults.standard.set(on, forKey: Self.residentKey); on ? flyOut() : goHome() }
    func callNow() {
        let topics = BunkBrain.topics(store.summary, error: store.error, preparing: store.preparing, ledger: store.ledger)
        currentTarget = topics.first?.target
        consider(.demo, lines: topics.map(\.text))
    }

    // MARK: - Triggers

    private func handle(_ alert: IslandAlert) {
        if alert.kind == .sale { return }   // celebrated through saleTick, no walk
        lastActivity = Date()
        let text = alert.detail.isEmpty ? alert.title : alert.title + " · " + alert.detail
        // Which campaign this warning is about (loss id = "lo:<account>:<campaign>"; approvals open the list).
        let target: AdjustTarget? = alert.kind == .approval ? BunkBrain.approvalsTarget
            : alert.kind == .loss ? store.summary?.queue.first(where: { "lo:" + $0.id == alert.id }).map(BunkBrain.lossTarget) : nil
        if target != nil || !roaming { currentTarget = target }
        // A burst becomes one walk: while touring, new attention items join what he is saying.
        if roaming, alert.kind != .manager { lines = RoamPolicy.merge(lines, text); return }
        // An order receipt is a short visit (not a tour): happy when the Meta confirmed it, surprised otherwise.
        consider(alert.kind == .manager || alert.kind == .order ? .manager : .attention(alert.kind), lines: [text])
        if alert.kind == .approval { react(.surprised, for: 1.4) }
        if alert.kind == .order { react(alert.id.hasSuffix(":confirmed") ? .happy : .surprised, for: 1.6) }
    }

    /// True while the main display sleeps or the session is locked (read from the system, not from notifications).
    nonisolated static func displayAsleepOrLocked() -> Bool {
        if CGDisplayIsAsleep(CGMainDisplayID()) != 0 { return true }
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        return (session?["CGSSessionScreenIsLocked"] as? Bool) == true
    }

    private func idleCheck() {
        // A missed wake/unlock notification must never freeze him mid-walk: recheck the real state every minute.
        if screenAsleep && !Self.displayAsleepOrLocked() { screenAsleep = false; retime() }
        guard !roaming else { return }
        let all = BunkBrain.lines(store.summary, error: store.error, preparing: store.preparing, ledger: store.ledger)
        if resident { if BunkBrain.awake(Date()), !CallWatch.shared.inCall, Int.random(in: 0..<4) == 0 { speak(all.first ?? "Sigo vigiando.") }; return }
        consider(.idle, lines: Array(all.prefix(1)))
    }

    private func consider(_ reason: RoamReason, lines: [String]) {
        let now = Date()
        // In a call (camera or microphone in use) he stays home; only "Chamar o Bunk agora" still works.
        let inCall = CallWatch.shared.inCall && reason != .demo
        guard RoamPolicy.allow(reason, memory: memory, now: now, enabled: roamEnabled, muted: store.muted, awake: BunkBrain.awake(now), busy: roaming || dragging || inCall) else { return }
        memory = RoamPolicy.remember(reason, memory, now: now)
        self.lines = lines.isEmpty ? ["Sigo vigiando."] : lines; lineIndex = 0
        startRoam(reason)
    }

    // MARK: - Movement

    static func displayID(_ s: NSScreen) -> UInt32 { (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0 }
    /// Stable name of a screen: its display UUID (falls back to the numeric id if macOS gives none).
    static func screenKey(_ s: NSScreen) -> String { DisplayKey.uuid(displayID(s)) ?? "id:\(displayID(s))" }
    private var savedScreens: [String] {
        let d = UserDefaults.standard
        if d.object(forKey: BunkScreens.uuidKey) == nil, let old = d.array(forKey: BunkScreens.key) as? [Int] {
            d.set(BunkScreens.migrate(oldIDs: old.map { UInt32($0) }, uuidOf: DisplayKey.uuid), forKey: BunkScreens.uuidKey)
            d.removeObject(forKey: BunkScreens.key)
        }
        return d.stringArray(forKey: BunkScreens.uuidKey) ?? []
    }
    /// True when the owner has not picked screens (Bunk may use all of them).
    var allScreensAllowed: Bool { savedScreens.isEmpty }
    /// Screens the owner allowed (all of them when nothing is chosen or the chosen ones are disconnected).
    var allowedScreens: [NSScreen] {
        let ok = BunkScreens.allowed(all: NSScreen.screens.map(Self.screenKey), saved: savedScreens)
        return NSScreen.screens.filter { ok.contains(Self.screenKey($0)) }
    }
    func isAllowed(_ s: NSScreen) -> Bool { allowedScreens.contains { Self.screenKey($0) == Self.screenKey(s) } }
    func toggleScreen(_ s: NSScreen) {
        let next = BunkScreens.toggle(Self.screenKey(s), all: NSScreen.screens.map(Self.screenKey), saved: savedScreens)
        UserDefaults.standard.set(next, forKey: BunkScreens.uuidKey)
        if resident, let p = panel, !allowedScreens.contains(where: { $0.frame.contains(feet) }) { _ = p; run([RoamStop(point: savedSpot(), pause: 0, speak: false)], speed: 600) { [weak self] in self?.land() } }
    }
    func applyCapturePrivacy(_ hidden: Bool) { panel?.sharingType = hidden ? .none : .readOnly }
    func allowAllScreens() { UserDefaults.standard.set([String](), forKey: BunkScreens.uuidKey); UserDefaults.standard.removeObject(forKey: BunkScreens.key) }
    private func nearestAllowed(to p: CGPoint) -> NSScreen? {
        allowedScreens.first { $0.frame.contains(p) } ?? allowedScreens.min { hypot($0.frame.midX - p.x, $0.frame.midY - p.y) < hypot($1.frame.midX - p.x, $1.frame.midY - p.y) }
    }
    /// Allowed screens without a full-screen app (presentations, video). Window bounds/layer only: no Screen Recording permission.
    private func screensInfo() -> [(frame: CGRect, visible: CGRect)] {
        let bounds = readWindows().map(\.frame)
        let free = allowedScreens.filter { s in !bounds.contains { BunkDesk.coversScreen($0, s.frame) } }
        return (free.isEmpty ? [] : free).map { ($0.frame, $0.visibleFrame) }
    }
    private func relocateIfStranded() {
        guard panel != nil, !NSScreen.screens.contains(where: { $0.frame.contains(feet) }) || !allowedScreens.contains(where: { $0.frame.contains(feet) }) else { return }
        if resident { feet = savedSpot(); panel?.setFrameOrigin(BunkDesk.origin(feet: feet)); land() } else { hide() }
    }
    private var notchScreen: NSScreen { notch?.bunkHomeScreen ?? NSScreen.main ?? NSScreen.screens[0] }
    private var homePoint: CGPoint { CGPoint(x: notchScreen.frame.midX, y: notchScreen.visibleFrame.maxY - 70) }

    private func startRoam(_ reason: RoamReason) {
        let pointer = allowedScreens.first { $0.frame.contains(NSEvent.mouseLocation) }?.frame
        let free = screensInfo()
        // Every allowed screen is showing a full-screen app: stay home, the notch alert is enough.
        if free.isEmpty && !(resident && panel != nil) && reason != .demo { return }
        var route = RoamPlanner.route(reason: reason, notchScreen: notchScreen.frame, notchVisible: notchScreen.visibleFrame, screens: free.isEmpty ? allowedScreens.map { ($0.frame, $0.visibleFrame) } : free, pointerScreen: pointer, width: BunkDesk.panel.width)
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
            p.sharingType = UserDefaults.standard.bool(forKey: CapturePrivacy.key) ? .none : .readOnly
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
        let rate: TimeInterval = !stops.isEmpty || falling || flight != nil || wanderTarget != nil ? 1.0 / 60.0 : stage.mood == .sleeping || stage.resting ? 0.1 : 1.0 / 30.0
        guard rate != timerRate || timer == nil else { return }
        stopTimer(); timerRate = rate
        let t = Timer(timeInterval: rate, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.frame() } }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
    private func stopTimer() { timer?.invalidate(); timer = nil; timerRate = 0 }

    private func frame() {
        guard let p = panel else { return }
        // Rest ↔ activity (hover, bubble, reaction) changes the frame rate; retime() is a no-op when it is unchanged.
        defer { retime() }
        // A drag whose mouse-up never arrived (sleep, lock, another app took the event) ends here.
        if dragging && NSEvent.pressedMouseButtons & 1 == 0 { dragging = false; dragStart = nil; dropped(); return }
        // Out of the notch with nothing to do and not living on the desktop: back home after a short grace.
        if BunkDesk.strayed(resident: resident, roaming: roaming, moving: !stops.isEmpty || flight != nil || falling, dragging: dragging) {
            if let since = strayedAt { if Date().timeIntervalSince(since) > BunkDesk.strayGrace { strayedAt = nil; endRoam(goHome: true); return } }
            else { strayedAt = Date() }
        } else { strayedAt = nil }
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
                if stage.walking { stage.walking = false }; stage.setGaze(gaze.x, gaze.y)
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
                        if stop.speak { stage.bubble = lines[lineIndex % lines.count] + (currentTarget != nil ? "\n— clique em mim para ajustar" : ""); lineIndex += 1 }
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
        stage.setGaze(gaze.x, gaze.y)
        if resident && !dragging && !roaming { perch() }
        let distance = ((mouse.x - center.x) * (mouse.x - center.x) + (mouse.y - center.y) * (mouse.y - center.y)).squareRoot()
        let asleep = !roaming && BunkDesk.shouldSleep(idle: Date().timeIntervalSince(lastActivity), mouseDistance: distance)
        let mood: BunkMood = asleep ? .sleeping : BunkBrain.mood(store.summary, error: store.error, preparing: store.preparing, muted: store.muted)
        if mood == .sleeping && stage.mood != .sleeping && !yawned { yawned = true; react(.yawn, for: 1.6) }
        if mood != .sleeping { yawned = false }
        if stage.mood != mood { stage.mood = mood; retime() }
    }

    // MARK: - Standing on windows (gravity, falls, strolls along the edge)

    private var falling = false, fallSpeed: CGFloat = 0, fallStartY: CGFloat = 0
    private var wanderTarget: CGFloat?, nextWander = Date().addingTimeInterval(20)
    private var perchWindows: [PerchWindow] = [], windowsReadAt = Date.distantPast, fastReadsUntil = Date.distantPast

    /// Visible windows of other apps, front to back. Bounds, layer and owner only: no names, no Screen Recording permission.
    private func readWindows() -> [PerchWindow] {
        let me = Int(ProcessInfo.processInfo.processIdentifier), top = NSScreen.screens.first?.frame.maxY ?? 0
        let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
        return list.compactMap { w in
            guard (w[kCGWindowLayer as String] as? Int) == 0, (w[kCGWindowOwnerPID as String] as? Int) != me, ((w[kCGWindowAlpha as String] as? Double) ?? 1) > 0.1,
                  let b = w[kCGWindowBounds as String] as? [String: CGFloat], let x = b["X"], let y = b["Y"], let width = b["Width"], let height = b["Height"],
                  width >= 160, height >= 80 else { return nil }
            return PerchWindow(id: (w[kCGWindowNumber as String] as? Int) ?? 0, frame: CGRect(x: x, y: top - y - height, width: width, height: height))
        }
    }

    private func perch() {
        let now = Date(), busy = falling || wanderTarget != nil || now < fastReadsUntil
        // Adaptive reads: fast while moving or right after an app switch, slow while still, slowest asleep.
        if now.timeIntervalSince(windowsReadAt) >= (busy ? 0.25 : stage.mood == .sleeping ? 3 : 1) { perchWindows = readWindows(); windowsReadAt = now }
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(CGPoint(x: feet.x, y: feet.y + 1)) }) ?? nearestAllowed(to: feet) else { return }
        let v = screen.visibleFrame, half = BunkDesk.bunkSize / 2
        let floor = WindowPerch.Surface(y: v.minY + RoamPlanner.floorInset, windowID: nil, minX: v.minX + BunkDesk.margin + half, maxX: v.maxX - BunkDesk.margin - half)
        let surface = WindowPerch.surface(x: feet.x, feetY: feet.y, windows: perchWindows, floor: floor, ceiling: v.maxY)
        let dt = CGFloat(timerRate)
        if var f = flight {
            // Thrown: integrate the flight; the floor is the highest edge under him right now.
            let out = BunkMotion.fly(f, floorY: surface.y, minX: floor.minX, maxX: floor.maxX, dt: dt)
            f = out.flight; feet = f.p; panel?.setFrameOrigin(BunkDesk.origin(feet: feet))
            stage.tilt = BunkMotion.tilt(vx: f.v.dx, vy: f.v.dy); stage.look = f.v.dx >= 0 ? 1 : -1
            if out.landed {
                flight = nil; withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) { stage.tilt = 0 }
                UserDefaults.standard.set([Double(feet.x), Double(feet.y)], forKey: Self.spotKey)
                land()
            } else { flight = f }
            return
        }
        if feet.y > surface.y + 0.5 {
            // Nothing under him any more (window closed, moved or minimized): fall to the next edge or the floor.
            if !falling { falling = true; fallStartY = feet.y; fallSpeed = 0; wanderTarget = nil; stage.walking = false; retime() }
            let f = WindowPerch.fall(y: feet.y, speed: fallSpeed, floorY: surface.y, dt: dt)
            feet.y = f.y; fallSpeed = f.speed
            // Off an edge: a little arc forward and a tumble that grows with the fall.
            if fallStartY - feet.y > 12 { feet.x = min(max(feet.x + stage.look * 70 * dt, floor.minX), floor.maxX); stage.tilt = BunkMotion.tilt(vx: stage.look * 500, vy: -fallSpeed) }
            panel?.setFrameOrigin(BunkDesk.origin(feet: feet))
            if f.landed { falling = false; withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) { stage.tilt = 0 }; if fallStartY - feet.y > 40 { land() } else { retime() } }
            return
        }
        if feet.y < surface.y - 0.5 && surface.y - feet.y < 14 { feet.y = surface.y; panel?.setFrameOrigin(BunkDesk.origin(feet: feet)) }
        guard stage.mood != .sleeping, stage.bubble == nil else {
            if wanderTarget != nil { wanderTarget = nil; stage.walking = false; retime() }
            return
        }
        if let target = wanderTarget {
            let step = BunkDesk.step(from: feet, to: CGPoint(x: target, y: feet.y), distance: 90 * dt)
            stage.walking = !step.arrived; stage.look = target > feet.x ? 1 : -1
            feet = step.point; panel?.setFrameOrigin(BunkDesk.origin(feet: feet))
            if step.arrived { wanderTarget = nil; stage.walking = false; nextWander = now.addingTimeInterval(.random(in: 20...60)); retime() }
        } else if now >= nextWander, surface.maxX - surface.minX > 60 {
            wanderTarget = .random(in: surface.minX...surface.maxX); retime()
        }
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
        let all = BunkBrain.topics(store.summary, error: store.error, preparing: store.preparing, ledger: store.ledger)
        guard !all.isEmpty else { return }
        let topic = all[topicIndex % all.count]; topicIndex += 1
        currentTarget = topic.target
        speak(topic.text + (topic.target != nil ? "\n— clique de novo para ajustar" : ""))
    }

    // MARK: - Mouse: click (wink + talk / open), double click (home), drag (move), right click (menu)

    private func addMonitors() {
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            MainActor.assumeIsolated { guard let self, event.window === self.panel else { return }; self.dragStart = NSEvent.mouseLocation; self.dragOrigin = self.panel?.frame.origin ?? .zero; self.dragSamples = []; self.flight = nil; self.stage.tilt = 0 }
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
                self.dragSamples.append((f, ProcessInfo.processInfo.systemUptime)); if self.dragSamples.count > 10 { self.dragSamples.removeFirst() }
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
            // Talking about a campaign (or the approvals): open its adjustment, where "Já fiz" is registered.
            if let target = self.currentTarget, self.roaming || self.stage.bubble != nil {
                self.notch?.openAdjust(target); self.currentTarget = nil; self.stage.bubble = nil
                if self.roaming { self.endRoam(goHome: false) }
            } else if self.roaming { self.notch?.openIsland(); self.endRoam(goHome: false) }
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
            // A flick throws him: he flies with the release speed, under gravity, and lands where he falls.
            let v = BunkMotion.throwVelocity(dragSamples); dragSamples = []
            if (v.dx * v.dx + v.dy * v.dy).squareRoot() > 350 && !A11y.reduceMotion {
                flight = BunkMotion.Flight(p: feet, v: v); react(.surprised, for: 0.6); retime(); return
            }
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
        if let target = currentTarget {
            add(target.campaignId == nil ? "Ver propostas aguardando você" : "Ajustar esta campanha (registrar o que fiz)") { [weak self] in self?.notch?.openAdjust(target); self?.stage.bubble = nil }
        }
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
