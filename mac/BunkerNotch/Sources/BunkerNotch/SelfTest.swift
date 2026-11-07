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
        testIslandStateMachine(); testPollRateAndDisplayChoice(); testStableChangeKey(); testCompactMoneyAndDetailDecode(); testWebScope(); testMalvaLink()
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
        check(Format.queueTag(project: nil, account: s.queue.first?.account) == "A", #line)
        check(Format.queueTag(project: "John", account: "CA FbMax 720") == "John · CA FbMax 720", #line)
        check(Format.queueTag(project: "John", account: nil) == "John", #line)
        check(Format.queueTag(project: nil, account: "  ") == nil, #line)
        check(s.shadow == nil, #line)
        check(s.accounts == nil, #line)
        let accRow = Summary.AccountRow(accountId: "1", name: "CA 1", group: "FB Flix", status: "active", statusLabel: "Ativa", runningLabel: "Rodando · John", currency: "USD", dailyLimit: 321.06, todaySpend: 290, usedPct: 90.3, balance: 10, alerts: ["Perto do limite diário"])
        check(Format.accountUse(accRow) == "90%", #line)
        check(Format.accountLimit(accRow) == "$ 290,00 de $ 321,06", #line)
        let noLimit = Summary.AccountRow(accountId: "2", name: nil, group: nil, status: "active", statusLabel: nil, runningLabel: nil, currency: nil, dailyLimit: nil, todaySpend: nil, usedPct: nil, balance: nil, alerts: nil)
        check(Format.accountLimit(noLimit) == "limite N/D" && Format.accountUse(noLimit) == "N/D", #line)
        check(NotchTab.allCases[2] == .accounts, #line)
        let shadowJSON = #"{"day":"2026-11-07","total":2,"byRule":{"test-no-sale":{"total":1,"wouldExecute":1,"managerDid":1,"bunkerFirst":1}},"recent":[{"rule":"test-no-sale","ruleLabel":"Pausar teste","project":"P","account":"A","campaign":"C","action":"status","reason":"x","firstAt":"2026-11-07T17:00:00.000Z","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"wouldExecute":true,"blockedBy":[],"manager":{"actor":"Gestor","at":"2026-11-07T17:40:00.000Z","minutesAfter":40}},{"rule":"bad-day-reduce","action":"budget","before":{"dailyBudget":100,"currency":"USD"},"after":{"dailyBudget":80,"currency":"USD"},"wouldExecute":false,"blockedBy":["x"],"manager":null}]}"#
        if let sh = try? JSONDecoder().decode(Summary.Shadow.self, from: Data(shadowJSON.utf8)) {
            check(Format.shadowChange(sh.recent[0]) == "Pausar", #line)
            check(Format.shadowOutcome(sh.recent[0]) == "Gestor fez 40 min depois", #line)
            check(Format.shadowChange(sh.recent[1]) == "-20% · 100 → 80 USD", #line)
            check(Format.shadowOutcome(sh.recent[1]) == "bloqueada", #line)
        } else { check(false, #line) }
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

    private static func testMalvaLink() {
        check(Store.malvaCampaignsURL(projectId: "72B71A6B-F55A-4563-A456-1B441DEC9851")?.absoluteString == "https://malvadash.com/tracking/72b71a6b-f55a-4563-a456-1b441dec9851/campanhas?sales=traffic&preset=today&level=campaign&status=all", #line)
        check(Store.malvaCampaignsURL(projectId: "all") == nil, #line)
        check(Store.malvaCampaignsURL(projectId: "../x") == nil, #line)
        check(Store.malvaCampaignsURL(projectId: nil) == nil, #line)
    }

    private static func testWebScope() {
        let u = { (s: String) in URL(string: s) }
        check(WebScope.decide(u("https://bunker-traffic.erik-iplou.workers.dev/#cards?project=p&q=1")) == .allow, #line)
        check(WebScope.decide(u("https://enehgnotumknjlmwfcta.supabase.co/auth/v1/verify?token=x")) == .allow, #line)
        check(WebScope.decide(u("https://bunker-trafego-erik.eriksozo.chatgpt.site/")) == .emailLogin, #line)
        check(WebScope.decide(u("https://evil.example/phish")) == .external, #line)
        check(WebScope.decide(u("http://bunker-traffic.erik-iplou.workers.dev/")) == .external, #line)        // never plain http
        check(WebScope.decide(u("https://bunker-traffic.erik-iplou.workers.dev.evil.example/")) == .external, #line)
        check(WebScope.signInLink(" https://bunker-traffic.erik-iplou.workers.dev/auth/callback#access_token=x \n") != nil, #line)
        check(WebScope.signInLink("https://enehgnotumknjlmwfcta.supabase.co/auth/v1/verify?token=x&type=magiclink") != nil, #line)
        check(WebScope.signInLink("https://bunker-traffic.erik-iplou.workers.dev/api/state") == nil, #line)
        check(WebScope.signInLink("https://evil.example/auth/callback#access_token=x") == nil, #line)
        check(WebScope.signInLink("texto qualquer") == nil, #line)
        check(WebScope.signInLink("https://user:pass@bunker-traffic.erik-iplou.workers.dev/auth/callback#access_token=x") == nil, #line)
        check(WebScope.signInLink("https://enehgnotumknjlmwfcta.supabase.co/auth/v1/verify/other?token=x") == nil, #line)
        let card = u("https://bunker-traffic.erik-iplou.workers.dev/#cards?project=p&q=123")
        let root = u("https://bunker-traffic.erik-iplou.workers.dev/")
        check(WebScope.cardToResume(requested: card, finished: root) == card, #line)
        check(WebScope.cardToResume(requested: card, finished: WebScope.emailLogin) == nil, #line)
        check(WebScope.cardToResume(requested: card, finished: card) == nil, #line)
        check(WebScope.cardToResume(requested: u("https://evil.example/#cards?project=p"), finished: root) == nil, #line)
    }

    private static func testCompactMoneyAndDetailDecode() {
        check(Format.compactMoney(870) == "R$ 870", #line)
        check(Format.compactMoney(3271.94) == "R$ 3,3 mil", #line)
        check(Format.compactMoney(63301.23) == "R$ 63 mil", #line)
        check(Format.compactMoney(1_400_000) == "R$ 1,4 mi", #line)
        check(Format.compactMoney(nil) == "N/D", #line)
        let json = #"{"kind":"loss","campaign":"C","account":null,"project":"John","adAccountId":"a","campaignId":"1","decision":"Revisar perda","period":"today","basis":"result","amount":10,"spend":20,"roas":0.5,"roas7d":1.2,"detail":{"projectId":"p","malvaObjectId":"m1","status":"ACTIVE","dailyBudget":100,"budgetCurrency":"USD","reason":"x","windows":{"today":{"spend":20,"roas":0.5,"roi":0.4,"frontOrders":1,"cpaFront":20},"yesterday":null,"3d":null,"7d":null},"changes":[]}}"#
        let q = try? JSONDecoder().decode(Summary.QueueItem.self, from: Data(json.utf8))
        check(q?.detail?.windows["today"]??.roas == 0.5, #line)
        check(q?.detail?.windows["yesterday"] ?? nil == nil, #line)
        check(q?.detail?.malvaObjectId == "m1", #line)
    }

    private static func testIslandStateMachine() {
        var f = IslandFSM()
        let a = IslandAlert(id: "x", kind: .loss, title: "Perda", detail: "C")
        check(f.handle(.mouseEntered) == .peek, #line)               // hover only peeks
        check(f.handle(.mouseLeft) == .compact, #line)
        check(f.handle(.click) == .open && f.pinned, #line)          // click opens and pins
        check(f.handle(.mouseLeft) == .open, #line)                  // visiting a menu outside keeps it open
        check(f.handle(.alert(a)) == .open, #line)                   // an alert never replaces an open island
        check(f.handle(.escape) == .compact && !f.pinned, #line)
        check(f.handle(.alert(a)) == .alert(a), #line)
        check(f.handle(.mouseLeft) == .alert(a), #line)              // leaving never hides an alert early
        check(f.handle(.alertExpired) == .compact, #line)
        check(f.handle(.toggle) == .open, #line)                     // ⌥⌘B
        check(f.handle(.toggle) == .compact, #line)
        _ = f.handle(.click); check(f.handle(.clickOutside) == .compact, #line)
        _ = f.handle(.click); check(f.handle(.idle) == .compact, #line)
        check(f.handle(.alert(a)) == .alert(a) && f.handle(.click) == .open, #line) // clicking an alert opens
    }

    private static func testPollRateAndDisplayChoice() {
        let island = CGRect(x: 180, y: 528, width: 340, height: 32)
        check(PollRate.interval(mouse: CGPoint(x: 300, y: 540), island: island, open: false) == PollRate.near, #line)
        check(PollRate.interval(mouse: CGPoint(x: 300, y: 20), island: island, open: false) == PollRate.far, #line)
        check(PollRate.interval(mouse: CGPoint(x: 300, y: 20), island: island, open: true) == PollRate.near, #line)
        let screens: [(hasNotch: Bool, containsMouse: Bool)] = [(false, false), (true, false)]
        check(DisplayChoice.resolve(.notch, screens: screens) == 1, #line)
        check(DisplayChoice.resolve(.menuBar, screens: screens) == 0, #line)
        check(DisplayChoice.resolve(.followMouse, screens: [(false, true), (true, false)]) == 0, #line)
        check(DisplayChoice.resolve(.followMouse, screens: screens) == 1, #line)
        check(DisplayChoice.resolve(.notch, screens: [(false, false)]) == 0, #line)
    }

    private static func testStableChangeKey() {
        let json = #"[{"action":"pause","field":"status","before":"ACTIVE","after":"PAUSED","percent":null,"currency":null,"at":"2026-11-07T12:00:00.000Z","from":"2026-11-07T11:45:00.000Z","actor":null,"origin":"observed","campaign":"C","account":null,"campaignId":"2"},{"action":"pause","field":"status","before":"ACTIVE","after":"PAUSED","percent":null,"currency":null,"at":"2026-11-07T11:52:00.000Z","from":null,"actor":"Jorge","origin":"history","campaign":"C","account":null,"campaignId":"2"}]"#
        guard let pair = try? JSONDecoder().decode([Summary.Activity].self, from: Data(json.utf8)) else { check(false, #line); return }
        check(Store.changeKey(pair[0]) == Store.changeKey(pair[1]), #line) // the author arriving later is not a new alert
    }

    private static func testIslandSitsAtTheTopCentre() {
        let origin = NotchGeometry.panelOrigin(screen: CGRect(x: 0, y: 0, width: 1512, height: 982), panel: CGSize(width: 700, height: 560))
        check(origin == CGPoint(x: 406, y: 422), #line)
        let island = NotchGeometry.islandRect(panel: CGSize(width: 700, height: 560), island: CGSize(width: 340, height: 32))
        check(island == CGRect(x: 180, y: 528, width: 340, height: 32), #line)
    }
}
