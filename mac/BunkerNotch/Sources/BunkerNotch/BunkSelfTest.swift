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
        let s1 = BunkDesk.step(from: .zero, to: CGPoint(x: 10, y: 0), distance: 4)
        expect(s1.point == CGPoint(x: 4, y: 0) && !s1.arrived && BunkDesk.step(from: s1.point, to: CGPoint(x: 10, y: 0), distance: 8).arrived, #line)
    }
    private static func expect(_ condition: Bool, _ line: Int) {
        if !condition { FileHandle.standardError.write(Data("self-test falhou na linha \(line) de BunkSelfTest.swift\n".utf8)); bunkFailures += 1 }
    }
}
nonisolated(unsafe) var bunkFailures = 0
