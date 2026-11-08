import CoreGraphics
import Foundation

extension SelfTest {
    /// Packages A–D: dismiss by signature, snooze, call hysteresis, hover intention, cadence, pace, screens by UUID.
    static func testAttention() {
        let json = """
        {"generatedAt":"2026-11-07T15:00:00.000Z","project":"all","projectName":"Todos","projects":[],"paused":false,"analysisAt":null,
         "today":{"today":{"roas":0.8,"roi":null,"cpaFront":null,"spend":100},"yesterday":{"roas":1.2,"roi":null,"cpaFront":null,"spend":1},"week":{"roas":1.5,"roi":null,"cpaFront":null,"spend":1},"recent":null,"deltas":{}},
         "pace":{"project":"all","name":"Todos","currency":"BRL","status":"exhausts","budget":1000,"spend":600,"projected":1200,"elapsedPct":50,"exhaustsAt":"2026-11-07T19:40:00.000Z","leftoverPct":null,"known":3,"unknown":1,"reason":null,"byProject":[]},
         "queue":[{"kind":"loss","campaign":"07/11 - [JOHN] - JHON_A_357_H1","account":"A","project":"John","adAccountId":"act","campaignId":"1","decision":"Revisar perda","period":"today","basis":"result","amount":120,"spend":300,"roas":0.6,"roas7d":1.3,
                   "detail":{"projectId":null,"malvaObjectId":null,"status":"ACTIVE","dailyBudget":100,"budgetCurrency":"BRL","reason":null,"windows":{},"changes":[]}}],
         "queueSize":1,"approvals":{"count":2,"items":[]},
         "activity":{"hours":24,"summary":{},"recent":[]},"agents":{"recent":[]},"executor":null,"notice":""}
        """
        guard let s = try? JSONDecoder().decode(Summary.self, from: Data(json.utf8)), let q = s.queue.first else { expectA(false, #line); return }
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        // Dismissed until its state changes: a bigger loss (≥50%) or another ROAS band brings it back.
        var l = AttentionLedger()
        expectA(!l.isQuiet(q, now: now), #line)
        l.dismiss(q)
        expectA(l.isQuiet(q, now: now), #line)
        let grown = try? JSONDecoder().decode(Summary.self, from: Data(json.replacingOccurrences(of: "\"amount\":120", with: "\"amount\":200").utf8))
        expectA(grown.map { !l.isQuiet($0.queue[0], now: now) } ?? false, #line)
        let band = try? JSONDecoder().decode(Summary.self, from: Data(json.replacingOccurrences(of: "\"roas\":0.6", with: "\"roas\":1.1").utf8))
        expectA(band.map { !l.isQuiet($0.queue[0], now: now) } ?? false, #line)
        let small = try? JSONDecoder().decode(Summary.self, from: Data(json.replacingOccurrences(of: "\"amount\":120", with: "\"amount\":170").utf8))
        expectA(small.map { l.isQuiet($0.queue[0], now: now) && !l.cameBack($0.queue[0]) } ?? false, #line)
        expectA(grown.map { l.cameBack($0.queue[0]) } ?? false, #line)
        // Snooze: quiet until the time, then back; restore clears both.
        l.restore(AttentionLedger.key(q))
        l.snooze(AttentionLedger.approvalsKey, until: now.addingTimeInterval(1800))
        expectA(l.isQuiet(key: AttentionLedger.approvalsKey, now: now) && !l.isQuiet(key: AttentionLedger.approvalsKey, now: now.addingTimeInterval(1801)), #line)
        l.prune(now: now.addingTimeInterval(1801))
        expectA(l.snoozed.isEmpty, #line)
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "America/Boa_Vista")!
        let morning = AttentionLedger.Snooze.tomorrow.until(from: now, calendar: cal)
        expectA(cal.component(.hour, from: morning) == 8 && morning > now && morning.timeIntervalSince(now) < 2 * 86400, #line)
        expectA(AttentionLedger.Snooze.halfHour.until(from: now) == now.addingTimeInterval(1800), #line)
        // The ledger round-trips through UserDefaults.
        let defaults = UserDefaults(suiteName: "bunker.selftest.\(UUID().uuidString)")!
        l.dismiss(q); l.save(defaults)
        expectA(AttentionLedger.load(defaults) == l, #line)

        // Ticker: a dismissed loss and snoozed approvals leave the rotation; pace and stale data join it.
        let quiet = UrgencyTicker.items(s, recentChange: nil, ledger: l, staleMinutes: 14, now: now)
        expectA(!quiet.contains { $0.key.hasPrefix("loss:") } && quiet.contains { $0.key == "approvals:2" }, #line)
        expectA(quiet.first { !$0.urgent }?.text == "dados há 14 min" && quiet.contains { $0.key == "pace" }, #line)
        l.snooze(AttentionLedger.approvalsKey, until: now.addingTimeInterval(60))
        expectA(!UrgencyTicker.items(s, recentChange: nil, ledger: l, now: now).contains { $0.urgent }, #line)
        expectA(!BunkBrain.topics(s, error: nil, preparing: false, ledger: l).contains { $0.text.hasPrefix("De olho") }, #line)
        expectA(BunkBrain.topics(s, error: nil, preparing: false).contains { $0.text.hasPrefix("Ritmo do orçamento") }, #line)

        // Pace wording, with N/D for anything missing.
        expectA(Format.pace(s.pace) == "esgota 15:40", #line)   // 19:40 UTC = 15:40 in Boa Vista
        expectA(Format.pace(nil) == "ritmo N/D", #line)
        expectA(Format.paceBase(s.pace) == "R$ 600 de R$ 1,0 mil orçados · 3 camp. · 1 sem orçamento", #line)
        expectA(Format.compactMoney(1500, currency: "USD") == "US$ 1,5 mil", #line)
        expectA(s.today.roasTrend.count == 4 && s.today.roasTrend[1] == nil && s.today.roasTrend[3] == 0.8, #line)

        // Calls: two readings to enter, six quiet ones to leave.
        var h = CallHysteresis()
        expectA(!h.feed(true) && h.feed(true), #line)
        expectA(h.feed(false) && h.feed(true), #line)
        for _ in 0..<5 { _ = h.feed(false) }
        expectA(h.inCall && !h.feed(false), #line)

        // Hover intention: resting opens after the dwell, a fast sideways pass restarts it, the top edge opens at once.
        var i = HoverIntent(), t = now
        expectA(i.feed(CGPoint(x: 100, y: 10), at: t, inside: true, atTopEdge: false) == .wait(HoverIntent.dwell), #line)
        t = t.addingTimeInterval(0.05)
        if case .wait = i.feed(CGPoint(x: 101, y: 10), at: t, inside: true, atTopEdge: false) {} else { expectA(false, #line) }
        t = t.addingTimeInterval(0.08)
        expectA(i.feed(CGPoint(x: 102, y: 10), at: t, inside: true, atTopEdge: false) == .enter, #line)
        i.reset(); t = now
        _ = i.feed(CGPoint(x: 0, y: 10), at: t, inside: true, atTopEdge: false)
        t = t.addingTimeInterval(0.13)
        expectA(i.feed(CGPoint(x: 300, y: 10), at: t, inside: true, atTopEdge: false) == .wait(HoverIntent.dwell), #line)  // 2300 pt/s sideways
        expectA(i.feed(CGPoint(x: 300, y: 10), at: t, inside: false, atTopEdge: false) == .none && i.enteredAt == nil, #line)
        expectA(i.feed(CGPoint(x: 300, y: 0), at: t, inside: true, atTopEdge: true) == .enter, #line)

        // Cadence: 1 min open, 2 min at rest, doubling after failures up to 15 min.
        expectA(RefreshPolicy.interval(open: true, failures: 0) == 60 && RefreshPolicy.interval(open: false, failures: 0) == 120, #line)
        expectA(RefreshPolicy.interval(open: true, failures: 1) == 240 && RefreshPolicy.interval(open: false, failures: 9) == 900, #line)

        // Screens by UUID: the same rules as before, and the old numeric ids migrate once.
        expectA(BunkScreens.allowed(all: ["A", "B"], saved: ["B"]) == ["B"] && BunkScreens.allowed(all: ["A"], saved: ["Z"]) == ["A"], #line)
        expectA(BunkScreens.toggle("B", all: ["A", "B"], saved: ["B"]) == [], #line)
        expectA(BunkScreens.migrate(oldIDs: [2, 9, 1], uuidOf: { $0 == 9 ? nil : "U\($0)" }) == ["U1", "U2"], #line)
    }
    /// Owner direct order: signed input, what can run now, and the exact line shown on screen and in Touch ID.
    static func testOwnerOrder() {
        let json = """
        {"revision":3,"paused":false,"approvals":[],"cards":[{"id":"k","signature":"s","project":"p","campaign":"C","account":"A","adAccountId":"a","objectId":"o","status":"ACTIVE","dailyBudget":95.1,"currency":"USD","windows":{},
          "suggestion":null,"intentActions":{"increase":true,"reduce":true,"pause":true,"keep":true},"blockedReasons":["Faltam pareceres da equipe para esta campanha ou sua hierarquia.","Leitura de hoje vencida ou com data inválida."],
          "lastChoice":null,"proposal":null,"orderActions":{"increase":false,"reduce":true,"pause":true,"keep":false},"orderBlockers":[]}]}
        """
        guard let card = (try? JSONDecoder().decode(OwnerCards.self, from: Data(json.utf8)))?.cards.first else { expectA(false, #line); return }
        let input = OwnerAdjust.order(card: card, revision: 3, action: "reduce", percent: 20, reason: " ", clientId: "c")
        expectA(input["ownerOrder"] as? Bool == true && input["approveExact"] as? Bool == false && input["applied"] == nil && input["percent"] as? Double == 20, #line)
        expectA(OwnerAdjust.canOrder(card, action: "reduce") && OwnerAdjust.canOrder(card, action: "pause") && !OwnerAdjust.canOrder(card, action: "increase") && !OwnerAdjust.canOrder(card, action: "keep"), #line)
        expectA(OwnerAdjust.orderLine(card, action: "reduce", percent: 20) == "Reduzir 20%: " + Format.money(95.1, currency: "USD") + " → " + Format.money(76.08, currency: "USD") + "/dia", #line)
        expectA(OwnerAdjust.orderLine(card, action: "pause", percent: nil) == "Pausar: ativa → pausada", #line)
        expectA(OwnerAdjust.advisory(card.blockedReasons[0]) && !OwnerAdjust.advisory(card.blockedReasons[1]), #line)
        // Receipts: the notch names the change and colours the stage; only confirmed is green.
        let r = """
        {"id":"p1","project":"p","projectName":"John","campaign":"C","account":"A","action":"budget","currency":"USD","before":{"dailyBudget":120,"status":null},"after":{"dailyBudget":90,"status":null},"stage":"confirmed","label":"Confirmada na Meta","reason":null,"source":"live","at":"2026-11-08T01:00:00.000Z","sentAt":null,"confirmedAt":null}
        """
        if let o = try? JSONDecoder().decode(Summary.OrderReceipt.self, from: Data(r.utf8)) {
            expectA(Format.orderChange(o) == "Reduzir · " + Format.money(120, currency: "USD") + " → " + Format.money(90, currency: "USD") + "/dia", #line)
            expectA(Format.orderTone("confirmed") == .good && Format.orderTone("verify") == .bad && Format.orderTone("sent") == .accent, #line)
        } else { expectA(false, #line) }
    }
    private static func expectA(_ condition: Bool, _ line: Int) {
        if !condition { FileHandle.standardError.write(Data("self-test falhou na linha \(line) de AttentionSelfTest.swift\n".utf8)); bunkFailures += 1 }
    }
}
