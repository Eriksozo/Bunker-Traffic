import CoreGraphics
import Foundation

/// `BunkerNotch --self-test`: the Command Line Tools ship neither XCTest nor the Swift Testing macros,
/// so the checks run inside the app binary and mac/build.sh refuses to install on any failure.
enum SelfTest {
    nonisolated(unsafe) private static var failures = 0
    private static func check(_ condition: Bool, _ line: Int) {
        if !condition { failures += 1; FileHandle.standardError.write(Data("self-test falhou na linha \(line) de SelfTest.swift\n".utf8)) }
    }
    static func run() -> Int32 {
        do { try testDecodesCompanionSummaryWithMissingValues() } catch { failures += 1; FileHandle.standardError.write(Data("decode: \(error)\n".utf8)) }
        testFormattingKeepsMissingAsND(); testCredentialShape(); testIslandSitsAtTheTopCentre()
        print(failures == 0 ? "self-test ok" : "self-test: \(failures) falha(s)")
        return failures == 0 ? 0 : 1
    }

    private static func testDecodesCompanionSummaryWithMissingValues() throws {
        let json = """
        {"version":1,"generatedAt":"2026-11-07T15:00:00.000Z","project":"all","projectName":"Todos os projetos",
         "projects":[{"id":"p","name":"John"}],"paused":false,"analysisAt":null,
         "today":{"today":{"roas":2.14,"roi":2.04,"cpaFront":163.6,"spend":3271.94},"yesterday":null,"week":{"roas":1.37,"roi":null,"cpaFront":null,"spend":1},
                  "deltas":{"roas":{"yesterday":null,"week":0.56},"roi":{"yesterday":null,"week":null},"cpaFront":{"yesterday":null,"week":null}}},
         "queue":[{"kind":"loss","campaign":"C","account":"A","project":"John","adAccountId":"act","campaignId":"1","decision":"Revisar perda","period":"today","basis":"result","amount":420,"spend":1200,"roas":0.65,"roas7d":1.35}],
         "queueSize":453,"approvals":{"count":0,"items":[]},
         "activity":{"hours":24,"summary":{"increase":{"count":1,"actors":{"Ana":1},"unknown":0},"reduce":{"count":0,"actors":{},"unknown":0},"pause":{"count":1,"actors":{},"unknown":1},"activate":{"count":0,"actors":{},"unknown":0}},
                     "recent":[{"action":"reduce","field":"dailyBudget","before":1000,"after":700,"percent":-30,"currency":"BRL","at":"2026-11-07T13:00:00.000Z","from":null,"actor":"Bruno","origin":"history","campaign":"C","account":"A","campaignId":"1"},
                               {"action":"pause","field":"status","before":"ACTIVE","after":"PAUSED","percent":null,"currency":null,"at":"2026-11-07T12:00:00.000Z","from":"2026-11-07T11:45:00.000Z","actor":null,"origin":"observed","campaign":null,"account":null,"campaignId":"2"}]},
         "agents":{"recent":[]},"executor":null,"notice":"Somente leitura."}
        """
        let s = try JSONDecoder().decode(Summary.self, from: Data(json.utf8))
        check(s.queue.first?.amount == 420, #line)
        check(s.today.yesterday == nil, #line)
        check(s.activity.recent[0].before?.number == 1000, #line)
        check(s.activity.recent[1].after?.text == "PAUSED", #line)
        check(Format.change(s.activity.recent[0]) == "−30% · " + Format.money(1000) + " → " + Format.money(700) + "/dia", #line)
        check(Format.money(1000).hasSuffix("1.000"), #line)
        check(Format.change(s.activity.recent[1]) == "ativa → pausada", #line)
        check(Format.who(s.activity.recent[0]) == "Bruno reduziu", #line)
        check(Format.who(s.activity.recent[1]) == "Pausas · autor não informado", #line)
    }

    private static func testFormattingKeepsMissingAsND() {
        check(Format.ratio(nil) == "N/D", #line)
        check(Format.money(nil) == "N/D", #line)
        check(Format.ratio(2.144) == "2,14x", #line)
        check(Format.percent(-30) == "−30%", #line)
        check(Format.percent(42.86) == "+42,9%", #line)
    }

    private static func testCredentialShape() {
        check(Credential.valid(String(repeating: "a", count: 43)), #line)
        check(!Credential.valid("short"), #line)
        check(!Credential.valid(String(repeating: "a", count: 42) + "\""), #line)
    }

    private static func testIslandSitsAtTheTopCentre() {
        let origin = NotchGeometry.panelOrigin(screen: CGRect(x: 0, y: 0, width: 1512, height: 982), panel: CGSize(width: 700, height: 560))
        check(origin == CGPoint(x: 406, y: 422), #line)
        let island = NotchGeometry.islandRect(panel: CGSize(width: 700, height: 560), island: CGSize(width: 340, height: 32))
        check(island == CGRect(x: 180, y: 528, width: 340, height: 32), #line)
    }
}
