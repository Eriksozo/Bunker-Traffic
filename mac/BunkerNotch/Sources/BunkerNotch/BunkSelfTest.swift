import CoreGraphics
import Foundation

extension SelfTest {
    /// Bunk out of the notch: frequency rules, routes across allowed screens, desktop geometry.
    static func testBunkRoam() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var m = RoamPolicy.Memory()
        // Off or muted: never, except the manual call.
        expect(!RoamPolicy.allow(.attention(.loss), memory: m, now: now, enabled: false, muted: false, awake: true, busy: false), #line)
        expect(!RoamPolicy.allow(.attention(.loss), memory: m, now: now, enabled: true, muted: true, awake: true, busy: false), #line)
        expect(RoamPolicy.allow(.demo, memory: m, now: now, enabled: false, muted: true, awake: false, busy: false), #line)
        expect(!RoamPolicy.allow(.demo, memory: m, now: now, enabled: true, muted: false, awake: true, busy: true), #line)
        // A loss waits 5 minutes after the last attention walk; a new approval never waits.
        m = RoamPolicy.remember(.attention(.loss), m, now: now)
        expect(!RoamPolicy.allow(.attention(.loss), memory: m, now: now.addingTimeInterval(120), enabled: true, muted: false, awake: true, busy: false), #line)
        expect(RoamPolicy.allow(.attention(.approval), memory: m, now: now.addingTimeInterval(120), enabled: true, muted: false, awake: true, busy: false), #line)
        expect(RoamPolicy.allow(.attention(.loss), memory: m, now: now.addingTimeInterval(301), enabled: true, muted: false, awake: true, busy: false), #line)
        // Manager visits and calm strolls only while awake, spaced out.
        expect(!RoamPolicy.allow(.manager, memory: m, now: now, enabled: true, muted: false, awake: false, busy: false), #line)
        expect(!RoamPolicy.allow(.idle, memory: m, now: now.addingTimeInterval(600), enabled: true, muted: false, awake: true, busy: false), #line)
        expect(RoamPolicy.allow(.idle, memory: m, now: now.addingTimeInterval(2401), enabled: true, muted: false, awake: true, busy: false), #line)

        // Two screens: notch on the right one (x 1440…), external on the left.
        let notch = CGRect(x: 1440, y: 0, width: 1512, height: 982), notchVis = CGRect(x: 1440, y: 0, width: 1512, height: 944)
        let ext = CGRect(x: -480, y: 0, width: 1920, height: 1080), extVis = CGRect(x: -480, y: 0, width: 1920, height: 1055)
        let both = [(frame: notch, visible: notchVis), (frame: ext, visible: extVis)]
        let tour = RoamPlanner.route(reason: .attention(.approval), notchScreen: notch, notchVisible: notchVis, screens: both, pointerScreen: nil, width: 300)
        expect(tour.first?.point == tour.last?.point && tour.first?.point.x == notch.midX, #line)
        expect(tour.filter(\.speak).count == 2, #line)
        expect(tour.contains { $0.speak && $0.point.x == extVis.midX }, #line)
        // Only the external screen allowed: the notch screen is crossed but never a talking stop.
        let extOnly = RoamPlanner.route(reason: .attention(.loss), notchScreen: notch, notchVisible: notchVis, screens: [(frame: ext, visible: extVis)], pointerScreen: nil, width: 300)
        expect(extOnly.filter(\.speak).map(\.point.x) == [extVis.midX], #line)
        // A visit happens on the pointer's screen if allowed, else on the first allowed one.
        let visit = RoamPlanner.route(reason: .manager, notchScreen: notch, notchVisible: notchVis, screens: [(frame: ext, visible: extVis)], pointerScreen: notch, width: 300)
        expect(visit.count == 3 && visit[1].speak && visit[1].point.x == extVis.midX, #line)

        // Allowed screens: empty = all; disconnected choices fall back to all; the last one off means all again.
        expect(BunkScreens.allowed(all: [1, 2], saved: []) == [1, 2], #line)
        expect(BunkScreens.allowed(all: [1, 2], saved: [2]) == [2], #line)
        expect(BunkScreens.allowed(all: [1, 2], saved: [9]) == [1, 2], #line)
        expect(BunkScreens.toggle(1, all: [1, 2], saved: []) == [2], #line)
        expect(BunkScreens.toggle(2, all: [1, 2], saved: [2]) == [], #line)
        expect(BunkScreens.toggle(1, all: [1, 2], saved: [2]) == [], #line)

        // Desktop geometry: body hit-test, clamping, sleep, gaze, walking steps.
        let feet = CGPoint(x: 500, y: 40), origin = BunkDesk.origin(feet: feet)
        expect(BunkDesk.feet(origin: origin) == feet, #line)
        expect(BunkDesk.isOverBody(CGPoint(x: BunkDesk.panel.width / 2, y: 30)) && !BunkDesk.isOverBody(CGPoint(x: 10, y: 10)), #line)
        let clamped = BunkDesk.clamp(feet: CGPoint(x: -1000, y: -50), visible: extVis)
        expect(clamped.x == extVis.minX + BunkDesk.margin + BunkDesk.bunkSize / 2 && clamped.y == extVis.minY + RoamPlanner.floorInset, #line)
        expect(BunkDesk.shouldSleep(idle: 121, mouseDistance: 200) && !BunkDesk.shouldSleep(idle: 121, mouseDistance: 80) && !BunkDesk.shouldSleep(idle: 60, mouseDistance: 999), #line)
        let g = BunkDesk.gaze(dx: 1000, dy: 1000)
        expect(g.x > 0.9 && g.y < -0.9, #line)
        // Bursts join one walk (no repeats, at most 4 topics); full-screen detection; animation gate at rest.
        expect(RoamPolicy.merge(["a"], "a") == ["a"] && RoamPolicy.merge(["a", "b", "c", "d"], "e") == ["b", "c", "d", "e"], #line)
        expect(BunkDesk.coversScreen(CGRect(x: -480, y: 1, width: 1919, height: 1080), ext) && !BunkDesk.coversScreen(CGRect(x: 0, y: 0, width: 800, height: 600), ext), #line)
        expect(BunkBrain.animatesAtRest(.alert) && !BunkBrain.animatesAtRest(.idle) && !BunkBrain.animatesAtRest(.watching) && !BunkBrain.animatesAtRest(.sleeping), #line)
        // Standing on windows: highest edge below his feet, wide enough, room above, not covered in front; else the floor.
        let floorS = WindowPerch.Surface(y: 6, windowID: nil, minX: 60, maxX: 1400)
        let back = PerchWindow(id: 1, frame: CGRect(x: 100, y: 100, width: 800, height: 400))    // top 500
        let front = PerchWindow(id: 2, frame: CGRect(x: 600, y: 50, width: 600, height: 500))    // top 550, in front, covers x 600…1200
        let maxed = PerchWindow(id: 3, frame: CGRect(x: 0, y: 0, width: 1440, height: 900))      // reaches the menu bar
        let wins = [front, back, maxed]
        expect(WindowPerch.surface(x: 300, feetY: 700, windows: wins, floor: floorS, ceiling: 900).windowID == 1, #line)
        expect(WindowPerch.surface(x: 700, feetY: 700, windows: wins, floor: floorS, ceiling: 900).windowID == 2, #line)
        expect(WindowPerch.surface(x: 700, feetY: 520, windows: [front, back], floor: floorS, ceiling: 900).windowID == nil, #line) // back's edge is covered by front
        expect(WindowPerch.surface(x: 300, feetY: 400, windows: wins, floor: floorS, ceiling: 900).windowID == nil, #line)          // edge above his feet
        expect(WindowPerch.surface(x: 105, feetY: 700, windows: wins, floor: floorS, ceiling: 900).windowID == nil, #line)          // too close to the corner
        expect(WindowPerch.surface(x: 300, feetY: 700, windows: [PerchWindow(id: 4, frame: CGRect(x: 100, y: 100, width: 800, height: 760))], floor: floorS, ceiling: 900).windowID == nil, #line) // no room above
        let f1 = WindowPerch.fall(y: 500, speed: 0, floorY: 6, dt: 1.0 / 60.0)
        expect(f1.y < 500 && !f1.landed && WindowPerch.fall(y: 10, speed: 800, floorY: 6, dt: 1.0 / 60.0).landed, #line)
        // Urgency rotation: short names, urgent first and twice, a new urgent item gets the focus.
        expect(UrgencyTicker.shortName("07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - JHON_A_357_H1") == "A_357_H1", #line)
        expect(UrgencyTicker.shortName(nil) == "campanha", #line)
        let calm = [UrgencyTicker.Item(key: "roas", text: "ROAS", tone: .neutral, urgent: false)]
        let hot = [UrgencyTicker.Item(key: "loss:x", text: "↓", tone: .bad, urgent: true)] + calm
        expect(UrgencyTicker.focus(previousKeys: ["roas"], items: hot) == 0 && UrgencyTicker.focus(previousKeys: ["roas", "loss:x"], items: hot) == nil, #line)
        // Living motion: blinks are brief and irregular, eye jumps are small, squash keeps volume, throws are capped.
        let samples = stride(from: 0.0, to: 120.0, by: 0.01).map { BunkMotion.blink($0) }
        let closedShare = Double(samples.filter { $0 > 0.5 }.count) / Double(samples.count)
        expect(closedShare > 0.005 && closedShare < 0.04 && samples.allSatisfy { $0 >= 0 && $0 <= 1 }, #line)
        expect(BunkMotion.blink(10.0) == BunkMotion.blink(10.0), #line)
        let j = BunkMotion.saccade(42.3); expect(abs(j.x) <= 0.35 && abs(j.y) <= 0.2 && BunkMotion.saccade(42.3) == j, #line)
        let sq = BunkMotion.squashStretch(0, strength: 1); expect(sq.y < 1 && abs(sq.x * sq.y - 1) < 0.0001 && BunkMotion.squashStretch(0.9, strength: 1) == (1, 1), #line)
        expect(BunkMotion.squashStretch(0, strength: 0) == (1, 1), #line)
        expect(abs(BunkMotion.antennaBend(3.1, hopSpeed: 1, hopRate: 5, walking: true)) <= 1, #line)
        let flick = BunkMotion.throwVelocity([(CGPoint(x: 0, y: 0), 0.0), (CGPoint(x: 400, y: 100), 0.05)])
        expect(abs((flick.dx * flick.dx + flick.dy * flick.dy).squareRoot() - 2400) < 1, #line)       // 8,200 pt/s capped to 2,400
        expect(BunkMotion.throwVelocity([(CGPoint.zero, 0)]) == .zero, #line)
        var fl = BunkMotion.Flight(p: CGPoint(x: 100, y: 300), v: CGVector(dx: -900, dy: 400)), landed = false, bounced = false
        for _ in 0..<400 where !landed { let o = BunkMotion.fly(fl, floorY: 10, minX: 50, maxX: 900, dt: 1.0 / 60.0); fl = o.flight; landed = o.landed; bounced = bounced || o.bounced }
        expect(landed && bounced && fl.p.y == 10 && fl.p.x >= 50, #line)
        expect(BunkMotion.tilt(vx: 0, vy: 0) == 0 && abs(BunkMotion.tilt(vx: 5000, vy: -5000)) <= 35 && BunkMotion.tilt(vx: 800, vy: 0) > 0, #line)
        let s1 = BunkDesk.step(from: .zero, to: CGPoint(x: 10, y: 0), distance: 4)
        expect(s1.point == CGPoint(x: 4, y: 0) && !s1.arrived && BunkDesk.step(from: s1.point, to: CGPoint(x: 10, y: 0), distance: 8).arrived, #line)
        // Stored away (not resident) and idle out of the notch: he goes home; never while walking, dragged, touring or living there.
        expect(BunkDesk.strayed(resident: false, roaming: false, moving: false, dragging: false), #line)
        expect(!BunkDesk.strayed(resident: true, roaming: false, moving: false, dragging: false), #line)
        expect(!BunkDesk.strayed(resident: false, roaming: true, moving: false, dragging: false), #line)
        expect(!BunkDesk.strayed(resident: false, roaming: false, moving: true, dragging: false), #line)
        expect(!BunkDesk.strayed(resident: false, roaming: false, moving: false, dragging: true), #line)
        expect(BunkDesk.strayGrace > 0 && BunkDesk.strayGrace <= 5, #line)
    }
    private static func expect(_ condition: Bool, _ line: Int) {
        if !condition { FileHandle.standardError.write(Data("self-test falhou na linha \(line) de BunkSelfTest.swift\n".utf8)); bunkFailures += 1 }
    }
}
nonisolated(unsafe) var bunkFailures = 0

extension SelfTest {
    /// Bunk's topics carry the campaign they are about, so a click opens that adjustment.
    static func testBunkTargets(_ s: Summary) {
        let topics = BunkBrain.topics(s, error: nil, preparing: false)
        let loss = topics.first { $0.text.hasPrefix("De olho:") }
        expect(loss?.target?.campaignId == "1" && loss?.target?.adAccountId == "act", #line)
        expect(topics.first { $0.text.hasPrefix("ROAS hoje") }?.target == nil, #line)
        expect(BunkBrain.lines(s, error: nil, preparing: false) == topics.map(\.text), #line)
        expect(BunkBrain.approvalsTarget.campaignId == nil, #line)
    }
}
