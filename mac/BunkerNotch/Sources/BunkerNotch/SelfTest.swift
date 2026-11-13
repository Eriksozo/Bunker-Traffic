import CryptoKit
import AppKit
import AVFoundation
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
        testIslandStateMachine(); testDisplayChoice(); testStableChangeKey(); testCompactMoneyAndDetailDecode(); testWebScope(); testMalvaLink(); testOwnerAdjust(); testBunkRoam(); testAttention(); testOwnerOrder(); testAdjustSound(); testAlertPriorityAndCounters(); testAutonomyBlock(); testVigia()
        failures += bunkFailures
        failures += DSAudit.run()
        print(failures == 0 ? "self-test ok" : "self-test: \(failures) falha(s)")
        return failures == 0 ? 0 : 1
    }

    /// VIGIA (lib/funnel-watch.mjs): signals decode with a bad one skipped, alert keys are stable and ranked with losses.
    private static func testVigia() {
        let base = #"{"generatedAt":"2026-11-13T15:00:00.000Z","project":"all","projectName":"Todos","projects":[],"paused":false,"analysisAt":null,"today":{"today":null,"yesterday":null,"week":null,"deltas":{}},"queue":[],"queueSize":0,"approvals":{"count":0,"items":[]},"activity":{"hours":24,"summary":{},"recent":[]},"agents":{"recent":[]},"executor":null,"notice":"","#
        let vigia = #""vigia":{"at":"2026-11-13T14:55:00.000Z","fresh":true,"signals":[{"id":"ns:p1:x:1","kind":"nosale","project":"Alfa","projectId":"p1","tone":"warn","title":"Alfa: sem venda há 4h","lines":["Página no ar ✓ · Checkout abrindo ✓ · Tráfego rodando ✓"],"checks":{"page":true,"checkout":true,"traffic":true}},{"id":7},{"id":"mm:p2:d:0","kind":"mismatch","title":"Beta: as vendas não batem","lines":["O vTurb marcou 8 vendas hoje e o checkout registrou 3 pedidos. Confira o webhook."]}]}}"#
        guard let s = try? JSONDecoder().decode(Summary.self, from: Data((base + vigia).utf8)) else { check(false, #line); return }
        check(s.vigia?.signals.count == 2, #line)
        check(s.vigia?.signals.first?.checks == Summary.VigiaChecks(page: true, checkout: true, traffic: true), #line)
        check(s.vigia?.signals.first?.lines.first == "Página no ar ✓ · Checkout abrindo ✓ · Tráfego rodando ✓", #line)
        // A broken vigia block never costs the rest of the summary; an older server without it decodes to nil.
        check((try? JSONDecoder().decode(Summary.self, from: Data((base + #""vigia":"x"}"#).utf8)))?.vigia == nil, #line)
        check((try? JSONDecoder().decode(Summary.self, from: Data((base.dropLast() + "}").utf8)))?.vigia == nil, #line)
        let keys = Store.presentKeys(s, day: "2026-11-13")
        check(keys.contains("vg:ns:p1:x:1") && keys.contains("vg:mm:p2:d:0"), #line)
        let ranked = Store.byPriority([("m", "x", "", IslandAlert.Kind.manager), ("vg:ns:p1:x:1", "x", "", .funnel), ("o", "x", "", .order)])
        check(ranked.map(\.0) == ["o", "vg:ns:p1:x:1", "m"], #line)
        check(VigiaUI.kind(alertId: "vg:mm:p2:d:0") == "mismatch" && VigiaUI.kind(alertId: "vg:pg:p1:u:d") == "page" && VigiaUI.kind(alertId: "vg:ns:p1:x:1") == "nosale", #line)
        check(VigiaUI.tone(alertId: "vg:ns:p1:x:1") == .warn && VigiaUI.tone(alertId: "vg:mm:p2:d:0") == .bad, #line)
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
        check(s.days == nil, #line)
        // The "Dias" block must survive the section-tolerant decoder of the whole summary (it was dropped once).
        let withDays = json.replacingOccurrences(of: #""notice":"Somente leitura."}"#, with: #""notice":"Somente leitura.","days":{"rows":[{"day":"2026-11-10","spend":100,"orders":2,"cpa":50,"revenueNet":150,"profit":20,"roas":1.5,"roi":1.18}],"currency":"BRL","today":"2026-11-10","at":null,"stale":false,"missing":[],"failing":[],"error":null}}"#)
        let sd = try JSONDecoder().decode(Summary.self, from: Data(withDays.utf8))
        check(sd.days?.rows.first?.cpa == 50 && sd.days?.today == "2026-11-10", #line)
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
        // Bunk mirrors the operation: errors worry it, a loss alerts it (silenced → sleeps), night puts it to sleep.
        let afternoon = BunkBrain.date("2026-11-07T17:00:00.000Z")!, night = BunkBrain.date("2026-11-07T06:00:00.000Z")!
        check(BunkBrain.awake(afternoon) && !BunkBrain.awake(night), #line)
        check(BunkBrain.mood(nil, error: "x", preparing: false, muted: false) == .worried, #line)
        check(BunkBrain.mood(nil, error: nil, preparing: true, muted: false) == .thinking, #line)
        check(BunkBrain.mood(s, error: nil, preparing: false, muted: false, now: afternoon) == .alert, #line)
        check(BunkBrain.mood(s, error: nil, preparing: false, muted: true, now: afternoon) == .sleeping, #line)
        let said = BunkBrain.lines(s, error: nil, preparing: false)
        testBunkTargets(s)
        check(said.first?.hasPrefix("De olho: C em A") == true, #line)
        check(said.contains { $0.hasPrefix("ROAS hoje") }, #line)
        check(BunkBrain.lines(nil, error: nil, preparing: true) == ["Estou montando o resumo. Volto em 1 a 2 minutos."], #line)
        let accRow = Summary.AccountRow(accountId: "1", name: "CA 1", group: "FB Flix", status: "active", statusLabel: "Ativa", runningLabel: "Rodando · John", currency: "USD", dailyLimit: 321.06, todaySpend: 290, usedPct: 90.3, balance: 10, alerts: ["Perto do limite diário"])
        check(Format.accountUse(accRow) == "90%", #line)
        check(Format.accountLimit(accRow).replacingOccurrences(of: "\u{00A0}", with: " ") == "US$ 290,00 de US$ 321,06", #line)
        let noLimit = Summary.AccountRow(accountId: "2", name: nil, group: nil, status: "active", statusLabel: nil, runningLabel: nil, currency: nil, dailyLimit: nil, todaySpend: nil, usedPct: nil, balance: nil, alerts: nil)
        check(Format.accountLimit(noLimit) == "limite N/D" && Format.accountUse(noLimit) == "N/D", #line)
        check(Format.accountMatches(accRow, "ca 1") && Format.accountMatches(accRow, "") && !Format.accountMatches(accRow, "flix 9"), #line)
        check(Format.accountMatches(accRow, "act_1") && !Format.accountMatches(accRow, "act_"), #line)
        check(NotchTab.allCases[1] == .autonomy && NotchTab.allCases[3] == .accounts && NotchTab.allCases.count == 8, #line)
        check(NotchTab.allCases.last == .days && NotchKeys.tab(for: "8", keyCode: 0, current: .now) == .days, #line)
        check(NotchKeys.tab(for: "2", keyCode: 0, current: .now) == .autonomy && NotchKeys.tab(for: "9", keyCode: 0, current: .now) == nil, #line)
        check(NotchKeys.tab(for: nil, keyCode: 124, current: .now) == .autonomy && NotchKeys.tab(for: nil, keyCode: 123, current: .autonomy) == .now, #line)
        // Eight tabs on one line: each density is tighter than the one before, neutral badges give way before the text shrinks.
        let dens = TabBarDensity.all
        check(dens.count >= 3 && zip(dens, dens.dropFirst()).allSatisfy { $0.inset >= $1.inset && $0.spacing >= $1.spacing && $0 != $1 } && dens.first?.neutralBadges == true && dens.last?.shrink == true && dens.dropLast().allSatisfy { !$0.shrink }, #line)
        check(dens.last?.shows(.warn) == true && dens.last?.shows(.bad) == true && dens.last?.shows(.neutral) == false && dens.first?.shows(.neutral) == true, #line)
        // A request of the level Confirmar opens on the Autonomia tab; every other alert keeps the tab the owner was on.
        check(NotchKeys.tab(forAlert: "ask:k1") == .autonomy && NotchKeys.tab(forAlert: "ap:1") == nil && NotchKeys.tab(forAlert: "or:1:confirmed") == nil, #line)
        let daysJSON = #"{"rows":[{"day":"2026-11-10","spend":32519.62,"orders":125,"cpa":260.16,"revenueNet":39794.25,"profit":5973.85,"roas":1.2237,"roi":1.18},{"day":"2026-11-09","spend":null,"orders":null,"cpa":null,"revenueNet":null,"profit":-5,"roas":null,"roi":0.9}],"currency":"BRL","today":"2026-11-10","at":"2026-11-10T13:00:00.000Z","stale":false,"missing":[],"failing":[],"error":null}"#
        let days = try? JSONDecoder().decode(Summary.Days.self, from: Data(daysJSON.utf8))
        check(days?.rows.count == 2 && days?.rows[1].spend == nil, #line)
        check(Format.dayLabel("2026-11-10") == "10/11" && Format.dayLabel("x") == "N/D" && Format.orders(125) == "125" && Format.orders(nil) == "N/D", #line)
        let dailyJSON = #"{"paused":false,"status":"ready","stale":false,"error":null,"range":{"from":"2026-11-04","to":"2026-11-10"},"snapshot":{"currency":"BRL","timezone":"America/Sao_Paulo","fetchedAt":"2026-11-10T14:00:00.000Z","from":"2026-11-04","to":"2026-11-10","rows":[{"day":"2026-11-10","spend":223.1,"orders":1,"cpa":223.1,"revenueNet":190.05,"profit":-41.97,"roas":0.85,"roi":0.82}]}}"#
        let daily = try? JSONDecoder().decode(Store.CampaignDaily.self, from: Data(dailyJSON.utf8))
        check(daily?.snapshot?.rows.first?.profit == -41.97 && daily?.snapshot?.currency == "BRL", #line)
        check(Format.civilDay(Date(timeIntervalSince1970: 1794326400), timeZone: "America/Sao_Paulo") == "2026-11-10" && Format.civilDay(Date(), timeZone: nil) == nil, #line)
        check(Format.signTone(-5) == .bad && Format.signTone(0) == nil && Format.roiTone(1.18) == .good && Format.roiTone(0.9) == .bad && Format.roiTone(nil) == nil, #line)
        check(Format.daysStale(Summary.Days(rows: [], currency: nil, today: nil, at: nil, stale: true, missing: nil, failing: ["Gabe"], error: nil)).contains("Gabe"), #line)
        let shadowJSON = #"{"day":"2026-11-07","total":2,"byRule":{"test-no-sale":{"total":1,"wouldExecute":1,"managerDid":1,"bunkerFirst":1}},"recent":[{"rule":"test-no-sale","ruleLabel":"Pausar teste","project":"P","account":"A","campaign":"C","action":"status","reason":"x","firstAt":"2026-11-07T17:00:00.000Z","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"wouldExecute":true,"blockedBy":[],"manager":{"actor":"Gestor","at":"2026-11-07T17:40:00.000Z","minutesAfter":40}},{"rule":"bad-day-reduce","action":"budget","before":{"dailyBudget":100,"currency":"USD"},"after":{"dailyBudget":80,"currency":"USD"},"wouldExecute":false,"blockedBy":["x"],"manager":null}]}"#
        if let sh = try? JSONDecoder().decode(Summary.Shadow.self, from: Data(shadowJSON.utf8)) {
            check(Format.shadowChange(sh.recent[0]) == "Pausar", #line)
            check(Format.shadowOutcome(sh.recent[0]) == "Gestor fez 40 min depois", #line)
            check(Format.shadowChange(sh.recent[1]) == "-20% · 100 → 80 USD", #line)
            check(Format.shadowOutcome(sh.recent[1]) == "bloqueada", #line)
            check(sh.recent[0].owner == nil, #line)
        } else { check(false, #line) }
        // The owner's own pause through the Bunker reads as done by the owner, ahead of any manager.
        let ownJSON = #"{"rule":"test-no-sale","action":"status","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"wouldExecute":true,"manager":{"actor":"Gestor","minutesAfter":5},"owner":{"actor":"Bunker · aprovado por você","at":"2026-11-08T14:28:46.000Z","minutesAfter":30}}"#
        if let own = try? JSONDecoder().decode(Summary.ShadowItem.self, from: Data(ownJSON.utf8)) {
            check(Format.shadowOutcome(own) == "pausada por você", #line)
            check(AdjustPreset.from(own) == nil, #line)   // already done: no quick action
        } else { check(false, #line) }
        // Quick action from the Bunk's anticipated move: only with the campaign ids and inside the server limits.
        func shadowItem(_ json: String) -> Summary.ShadowItem? { try? JSONDecoder().decode(Summary.ShadowItem.self, from: Data(json.utf8)) }
        let ids = #""projectId":"p","adAccountId":"a","objectId":"1","wouldExecute":true,"current":true"#
        if let pause = shadowItem(#"{"action":"status","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"# + ids + "}"),
           let up = shadowItem(#"{"action":"budget","before":{"dailyBudget":236.24},"after":{"dailyBudget":354.36},"# + ids + "}"),
           let down = shadowItem(#"{"action":"budget","before":{"dailyBudget":100},"after":{"dailyBudget":87.5},"# + ids + "}"),
           let activate = shadowItem(#"{"action":"status","before":{"status":"PAUSED"},"after":{"status":"ACTIVE"},"# + ids + "}"),
           let noIds = shadowItem(#"{"action":"status","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"}}"#),
           let managed = shadowItem(#"{"action":"status","after":{"status":"PAUSED"},"manager":{"actor":"G","minutesAfter":3},"# + ids + "}") {
            check(AdjustPreset.from(pause) == AdjustPreset(action: "pause", percent: nil), #line)
            check(AdjustPreset.from(pause)?.label == "Pausar", #line)
            check(AdjustPreset.from(up) == AdjustPreset(action: "increase", percent: 50), #line)
            check(AdjustPreset.from(up)?.label == "Aumentar 50%" && AdjustPreset.from(up)?.percentText == "50", #line)
            check(AdjustPreset.from(down)?.label == "Reduzir 12,5%" && AdjustPreset.from(down)?.percentText == "12.5", #line)
            check(OwnerAdjust.parsePercent(AdjustPreset.from(down)?.percentText ?? "") == 12.5, #line)
            check(AdjustPreset.from(activate) == nil && AdjustPreset.from(noIds) == nil && AdjustPreset.from(managed) == nil, #line)
        } else { check(false, #line) }
        // Only a move the Bunk would make now: blocked (owner cap, a pause winning), alert-only, stale or unmarked rows get no button.
        let pauseRow = #"{"action":"status","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"projectId":"p","adAccountId":"a","objectId":"1""#
        let upRow = #"{"action":"budget","before":{"dailyBudget":100},"after":{"dailyBudget":150},"projectId":"p","adAccountId":"a","objectId":"1""#
        if let capped = shadowItem(upRow + #","wouldExecute":true,"current":true,"blockedBy":["Acima do teto do dono (120 BRL)"]}"#),
           let alert = shadowItem(pauseRow + #","wouldExecute":true,"current":true,"alertOnly":true}"#),
           let notExec = shadowItem(pauseRow + #","wouldExecute":false,"current":true}"#),
           let stale = shadowItem(pauseRow + #","wouldExecute":true,"current":false}"#),
           let unmarked = shadowItem(pauseRow + #","wouldExecute":true}"#),
           let ok = shadowItem(upRow + #","wouldExecute":true,"current":true,"blockedBy":[]}"#) {
            check(AdjustPreset.from(capped) == nil && AdjustPreset.from(alert) == nil && AdjustPreset.from(notExec) == nil, #line)
            check(AdjustPreset.from(stale) == nil && AdjustPreset.from(unmarked) == nil, #line)
            check(AdjustPreset.from(ok) == AdjustPreset(action: "increase", percent: 50), #line)
        } else { check(false, #line) }
        let f24JSON = #"{"ceiling":110,"counts":{"scheduled":1,"firstDay":2,"secondDay":0,"attention":1},"items":[{"projectName":"P","account":"A","adAccountId":"a","objectId":"1","campaign":"07/11 - [PRE]","stage":"first-day","stageLabel":"Primeiras 24h","level":"pause","spend":100,"checkouts":1,"limit":110,"pauseAt":99,"reason":"x","awaitingDelivery":false},{"campaign":"07/11 - [TESTE]","stage":"first-day","level":"sold","spend":80,"checkouts":3,"limit":null}],"scheduled":[{"campaign":"08/11 - [PRE]","project":"P","account":"A","startsOn":"08/11"}]}"#
        if let f = try? JSONDecoder().decode(Summary.First24h.self, from: Data(f24JSON.utf8)) {
            check(Format.first24hLevel(f.items[0].level) == "pausaria", #line)
            check(Format.first24hLine(f.items[1]) == "1º dia · 3 IC", #line)
            let aged = Summary.First24hItem(projectName: nil, account: nil, adAccountId: nil, objectId: nil, campaign: "x", stage: "first-day", stageLabel: nil, level: "alert", spend: 80, checkouts: 1, limit: 110, pauseAt: 99, reason: nil, awaitingDelivery: false, ageHours: 5.4, metaLive: true)
            check(Format.first24hLine(aged) == "1º dia · há 5h · 1 IC · teto " + Format.money(110) + " · Meta ao vivo", #line)
            check(f.scheduled[0].startsOn == "08/11", #line)
        } else { check(false, #line) }
        check(Format.who(s.activity.recent[1]) == "Pausas · autor não informado", #line)
    }

    /// Autonomia v2 · Modo Gestor (contract (b)): decode with and without the block, a broken block never costs the
    /// summary (nor the "Dias" tab), the quick action is hidden only in Desligado, N/D never reads 0%.
    private static func testAutonomyBlock() {
        let core = #"{"generatedAt":"2026-11-10T15:00:00.000Z","project":"all","projects":[{"id":"p1","name":"John"},{"id":"p2","name":"Gabe"}],"today":{"deltas":{}},"days":{"rows":[{"day":"2026-11-10","spend":100,"orders":2,"cpa":50,"revenueNet":150,"profit":20,"roas":1.5,"roi":1.18}],"currency":"BRL","today":"2026-11-10"}"#
        func summary(_ extra: String) -> Summary? { try? JSONDecoder().decode(Summary.self, from: Data((core + extra + "}").utf8)) }
        let block = #","autonomy":{"v":1,"at":"2026-11-10T15:00:00.000Z","enabled":true,"projects":[{"id":"p1","name":"John","mode":"shadow","exceptions":1,"pilot":null,"today":{"decisions":9,"enviaria":0,"pediria":0,"soSugestao":7,"segurada":2,"ordersCreated":0,"ordersConfirmed":0},"plays":[{"id":"pb:test-pause","label":"Pausar teste sem venda","stage":"candidata","agreement":0.74,"n":12},{"id":"pb:night-raise","label":"Subir à meia-noite","stage":"observando","agreement":null,"n":0}],"people":[{"person":"owner","name":"Você","agreement":0.68,"n":25},{"person":"p:ab12","name":"Jorge","agreement":0.7,"n":10},{"person":"p:cd34","name":"Leonardo","agreement":null,"n":0}]},{"id":"p2","name":"Gabe","mode":"off","exceptions":0,"pilot":null,"today":{"decisions":0,"enviaria":0,"pediria":0,"soSugestao":0,"segurada":0,"ordersCreated":0,"ordersConfirmed":0},"plays":[],"people":[]}],"campaigns":[{"projectId":"p1","adAccountId":"a","objectId":"off1","mode":"off"},{"projectId":"p2","adAccountId":"a","objectId":"sh2","mode":"shadow"}],"island":{"observing":["John","Gabe"],"agreement":0.74,"n":12}}"#
        guard let s = summary(block), let a = s.autonomy else { check(false, #line); return }
        check(a.v == 1 && a.enabled && a.projects.count == 2 && a.campaigns.count == 2, #line)
        check(a.projects[0].mode == "shadow" && a.projects[0].exceptions == 1 && a.projects[0].pilotEnabled == nil, #line)
        check(a.projects[0].today?.decisions == 9 && a.projects[0].today?.segurada == 2, #line)
        check(a.projects[0].plays.count == 2 && a.projects[0].plays[0].agreement == 0.74 && a.projects[0].plays[1].agreement == nil, #line)
        check(a.projects[0].people.first?.isOwner == true && a.island?.observing == ["John", "Gabe"], #line)
        check(s.days?.rows.count == 1, #line)
        // Without the block (older server): nil, the rest unchanged, and today's button and label.
        guard let old = summary("") else { check(false, #line); return }
        check(old.autonomy == nil && old.days?.rows.first?.cpa == 50 && old.projects.count == 2, #line)
        // A broken block: not an object → nil; bad fields inside → defaults, bad items skipped. The summary and "Dias" survive.
        let bad = summary(#","autonomy":"x""#)
        check(bad != nil && bad?.autonomy == nil && bad?.days?.rows.count == 1, #line)
        check(summary(#","autonomy":null"#)?.autonomy == nil, #line)
        let odd = summary(#","autonomy":{"enabled":"sim","projects":[{"name":"sem id"},{"id":"p1","mode":5,"today":"x","plays":[{"id":"x","agreement":74},{"label":"sem id"}],"people":"x"}],"campaigns":[{"projectId":"p1","mode":"off"},7],"island":7}"#)
        check(odd?.days?.rows.count == 1, #line)
        if let o = odd?.autonomy {
            check(!o.enabled && o.projects.count == 1 && o.projects[0].mode == nil && o.projects[0].today == nil, #line)
            check(o.projects[0].plays.count == 1 && o.projects[0].plays[0].agreement == nil && o.projects[0].people.isEmpty, #line)
            check(o.campaigns.isEmpty && o.island == nil, #line)
        } else { check(false, #line) }
        // Effective mode, first match wins: the campaign entry, then the project level, else unknown.
        check(a.mode(projectId: "p1", adAccountId: "a", objectId: "off1") == "off", #line)
        check(a.mode(projectId: "p1", adAccountId: "a", objectId: "other") == "shadow", #line)
        check(a.mode(projectId: "p2", adAccountId: "a", objectId: "sh2") == "shadow" && a.mode(projectId: "p2", adAccountId: nil, objectId: nil) == "off", #line)
        check(a.mode(projectId: "p9", adAccountId: "a", objectId: "1") == nil && a.mode(projectId: nil, adAccountId: "a", objectId: "off1") == nil, #line)
        // ShadowActionButton: hidden only in Desligado; "Fazer eu mesmo" in Sombra/Confirmar/Automático; unknown keeps today's label.
        // Level Confirmar: open requests decode, alert once and open the owner's order prefilled; a broken one is skipped.
        let asking = summary(#","autonomy":{"enabled":true,"projects":[],"campaigns":[],"asksTotal":3,"asks":[{"id":"k1","at":"2026-11-12T10:00:00.000Z","projectId":"p1","projectName":"John","adAccountId":"a1","objectId":"c1","campaign":"12/11 - TESTE","action":"pause","percent":null,"ruleLabel":"Teste sem venda"},{"id":"k2","projectId":"p1","adAccountId":"a1","objectId":"c2","action":"reduce","percent":20},{"id":"k3","projectId":"p1","adAccountId":"a1","objectId":"c3","action":"activate"},{"id":"sem ids"},7]}"#)
        check(asking?.autonomy?.asks.map(\.id) == ["k1", "k2", "k3"] && asking?.autonomy?.asksTotal == 3, #line)
        check(asking?.autonomy?.asks[0].preset == AdjustPreset(action: "pause", percent: nil) && asking?.autonomy?.asks[0].changeText == "Pausar", #line)
        check(asking?.autonomy?.asks[1].preset == AdjustPreset(action: "reduce", percent: 20) && asking?.autonomy?.asks[2].preset == nil, #line)
        check(Summary.AutonomyAsk(id: "x", projectId: "p", adAccountId: "a", objectId: "o", action: "reduce", percent: 100).preset == nil, #line)
        check(Summary.AutonomyAsk(id: "x", projectId: "p", adAccountId: "a", objectId: "o", action: "increase", percent: nil).preset == nil, #line)
        if let a = asking { check(Store.presentKeys(a, day: "2026-11-12").filter { $0.hasPrefix("ask:") } == ["ask:k1", "ask:k2", "ask:k3"], #line) } else { check(false, #line) }
        check(summary(#","autonomy":{"enabled":true,"projects":[],"campaigns":[]}"#)?.autonomy?.asks.isEmpty == true, #line)
        // Autonomia tab (owner request of 12/11/2026): the switch, each level and the requests in plain words.
        if let q = asking?.autonomy {
            check(AutonomyText.asksCount(q) == 3 && AutonomyText.asksDetail(q) == "3 pedidos · nível Confirmar · você executa com Touch ID" && AutonomyText.moreAsks(q) == nil, #line)
            var more = q; more.asksTotal = 7
            check(AutonomyText.asksCount(more) == 7 && AutonomyText.moreAsks(more) == "Mais 4 pedidos no painel Autonomia do Bunk.", #line)
            var fewer = q; fewer.asksTotal = 1   // a total below the rows sent never hides a row from the count
            check(AutonomyText.asksCount(fewer) == 3 && AutonomyText.moreAsks(fewer) == nil, #line)
        } else { check(false, #line) }
        check(AutonomyText.asksCount(a) == 0 && AutonomyText.asksDetail(a) == "nível Confirmar" && AutonomyText.noAsks(a) == "Nenhum pedido aberto agora.", #line)
        check(AutonomyText.switchLine(a) == "interruptor geral ligado", #line)
        var switchedOff = a; switchedOff.enabled = false
        check(AutonomyText.switchLine(switchedOff) == "interruptor geral desligado · o Bunk não envia nem pede nada" && AutonomyText.noAsks(switchedOff) == "Interruptor geral desligado: o Bunk não pede nem envia nada.", #line)
        check(["off", "shadow", "confirm", "auto", "x"].map { AutonomyText.level($0) } == ["Desligado", "Sombra", "Confirmar", "Automático", "N/D"] && AutonomyText.level(nil) == "N/D", #line)
        check(AutonomyText.projectLine(a.projects[0], enabled: true) == "só observa e anota o que faria · 1 campanha com nível próprio", #line)
        check(AutonomyText.projectLine(a.projects[1], enabled: true) == "não age, não pede e não sugere", #line)
        // Confirmar and Automático only act with the general switch on: off, the row says it is stopped and loses its colour.
        check(AutonomyText.levelEffect("confirm", enabled: true) == "pede a você antes de agir" && AutonomyText.levelEffect("auto", enabled: true) == "age sozinho dentro dos limites salvos", #line)
        check(AutonomyText.levelEffect("confirm", enabled: false) == "parado: interruptor geral desligado" && AutonomyText.levelEffect("auto", enabled: false) == "parado: interruptor geral desligado", #line)
        check(AutonomyText.levelTone("auto", enabled: true) == .good && AutonomyText.levelTone("auto", enabled: false) == .neutral && AutonomyText.levelTone("confirm", enabled: true) == .warn && AutonomyText.levelTone("confirm", enabled: false) == .neutral, #line)
        check(AutonomyText.levelEffect(nil, enabled: true) == "nível N/D" && AutonomyText.levelSymbol("confirm") == "hand.raised.fill", #line)
        let pause = AdjustPreset(action: "pause", percent: nil)
        check(ShadowActionButton.label(mode: "off", preset: pause) == nil, #line)
        check(ShadowActionButton.label(mode: "shadow", preset: pause) == "Fazer eu mesmo", #line)
        check(ShadowActionButton.label(mode: "confirm", preset: pause) == "Fazer eu mesmo" && ShadowActionButton.label(mode: "auto", preset: pause) == "Fazer eu mesmo", #line)
        check(ShadowActionButton.label(mode: nil, preset: pause) == "Pausar" && ShadowActionButton.label(mode: "team", preset: pause) == "Pausar", #line)
        let row = #"{"action":"status","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"wouldExecute":true,"current":true,"blockedBy":[],"adAccountId":"a","#
        if let offItem = try? JSONDecoder().decode(Summary.ShadowItem.self, from: Data((row + #""projectId":"p2","objectId":"x"}"#).utf8)),
           let offCampaign = try? JSONDecoder().decode(Summary.ShadowItem.self, from: Data((row + #""projectId":"p1","objectId":"off1"}"#).utf8)),
           let shadowItem = try? JSONDecoder().decode(Summary.ShadowItem.self, from: Data((row + #""projectId":"p1","objectId":"y"}"#).utf8)),
           let preset = AdjustPreset.from(shadowItem) {
            check(ShadowActionButton.label(mode: a.mode(for: offItem), preset: preset) == nil, #line)
            check(ShadowActionButton.label(mode: a.mode(for: offCampaign), preset: preset) == nil, #line)
            check(ShadowActionButton.label(mode: a.mode(for: shadowItem), preset: preset) == "Fazer eu mesmo", #line)
            check(ShadowActionButton.label(mode: old.autonomy?.mode(for: shadowItem), preset: preset) == "Pausar", #line)
        } else { check(false, #line) }
        // Island row and today's counts.
        check(AutonomyText.islandLine(a) == "Bunk · observando · John, Gabe · concordância 74%", #line)
        var noAgreement = a; noAgreement.island?.agreement = nil
        check(AutonomyText.islandLine(noAgreement) == "Bunk · observando · John, Gabe", #line)
        var zeroCases = a; zeroCases.island = Summary.AutonomyIsland(observing: ["John"], agreement: 0, n: 0)
        check(AutonomyText.islandLine(zeroCases) == "Bunk · observando · John", #line)
        var auto = a; auto.projects[0].mode = "auto"
        check(AutonomyText.islandLine(auto).hasPrefix("Bunk · pode enviar · "), #line)
        auto.enabled = false
        check(AutonomyText.islandLine(auto).hasPrefix("Bunk · observando · "), #line)
        let allOff = Summary.Autonomy(enabled: true, projects: [Summary.AutonomyProject(id: "p", name: "John", mode: "off")], island: Summary.AutonomyIsland(observing: [], agreement: nil, n: 0))
        check(AutonomyText.islandLine(allOff) == "Bunk · desligado nos projetos", #line)
        check(AutonomyText.todayLine(a.projects) == "Hoje: 9 decisões · 7 só sugestão · 2 seguradas", #line)
        check(AutonomyText.todayLine([a.projects[1]]) == "Hoje: nenhuma decisão da Sombra ainda", #line)
        check(AutonomyText.todayLine([a.projects[0], Summary.AutonomyProject(id: "p3")]) == nil, #line)   // a missing count is N/D, not a partial sum
        // Gestores tab lines: N/D is never 0%.
        check(AutonomyText.playLine(a.projects[0].plays[0]) == "candidata · concorda 74% em 12 casos", #line)
        check(AutonomyText.playLine(a.projects[0].plays[1]) == "observando · concordância N/D", #line)
        check(AutonomyText.percent(nil) == "N/D" && AutonomyText.percent(0, n: 0) == "N/D" && AutonomyText.percent(0, n: 5) == "0%", #line)
        check(AutonomyText.ownerLine(a.projects[0].people[0]) == "O Bunk pegou 68% dos seus movimentos (25 movimentos)", #line)
        check(AutonomyText.ownerLine(a.projects[0].people[0], project: "John") == "John · o Bunk pegou 68% dos seus movimentos (25 movimentos)", #line)
        check(AutonomyText.ownerLine(Summary.AutonomyPerson(person: "owner")) == "O Bunk pegou dos seus movimentos: N/D (sem casos ainda)", #line)
        check(AutonomyText.othersLine(a.projects[0].people) == "Jorge 70% · Leonardo N/D" && AutonomyText.othersLine([]) == nil, #line)
        check(AutonomyText.stage("pode-pedir") == "pode pedir" && AutonomyText.stage("x") == "estágio N/D", #line)
    }

    private static func testFormattingKeepsMissingAsND() {
        check(Format.ratio(nil) == "N/D", #line)
        check(Format.money(nil) == "N/D", #line)
        check(Format.ratio(2.144) == "2,14x", #line)
        check(Format.percent(-30) == "−30%", #line)
        check(Format.percent(42.86) == "+42,9%", #line)
        // Notch batteries 2026-11-08: separators, US$, unit boundaries, plurals.
        let nb = "\u{00A0}"
        check(Format.exactMoney(1780, currency: "BRL").replacingOccurrences(of: nb, with: " ") == "R$ 1.780,00", #line)
        check(Format.exactMoney(180, currency: "usd").replacingOccurrences(of: nb, with: " ") == "US$ 180,00", #line)
        check(Format.money(120, currency: "USD").replacingOccurrences(of: nb, with: " ") == "US$ 120,00", #line)
        check(Format.money(32_000).replacingOccurrences(of: nb, with: " ") == "R$ 32.000", #line)
        check(Format.compactMoney(999.6) == "R$ 1,0 mil", #line)
        check(Format.compactMoney(999.4) == "R$ 999", #line)
        check(Format.compactMoney(999_960) == "R$ 1,0 mi", #line)
        check(Format.compactMoney(9_960) == "R$ 10 mil", #line)
        check(Format.compactMoney(-1_500, currency: "USD") == "−US$ 1,5 mil", #line)
        check(Format.count(1, "perda", "perdas") == "1 perda" && Format.count(0, "perda", "perdas") == "0 perdas" && Format.count(3, "perda", "perdas") == "3 perdas", #line)
        check(NotchKeys.tab(for: "4", keyCode: 21, current: .now) == .accounts && NotchKeys.tab(for: nil, keyCode: 123, current: .now) == .days && NotchKeys.tab(for: nil, keyCode: 124, current: .system) == .days && NotchKeys.tab(for: nil, keyCode: 124, current: .days) == .now, #line)
        check(NotchKeys.tab(for: "9", keyCode: 25, current: .now) == nil && NotchKeys.tab(for: "a", keyCode: 0, current: .now) == nil, #line)
        check(OwnerAdjust.parsePercent(" 20% ") == 20 && OwnerAdjust.parsePercent("12,5") == 12.5 && OwnerAdjust.parsePercent("1e2") == nil && OwnerAdjust.parsePercent("") == nil && OwnerAdjust.parsePercent("1.2.3") == nil, #line)
        check(OwnerAdjust.percentProblem("reduce", 0.001, current: 100) != nil && OwnerAdjust.percentProblem("reduce", 100, current: 100) != nil && OwnerAdjust.percentProblem("increase", 1001, current: 100) != nil, #line)
        check(OwnerAdjust.percentProblem("reduce", 20, current: 100) == nil && OwnerAdjust.percentProblem("pause", nil, current: 100) == nil && OwnerAdjust.percentProblem("increase", nil, current: 100) != nil, #line)
        // Section-tolerant decode: a broken accessory section never hides the rest of the reading.
        let broken = #"{"generatedAt":"2026-11-08T05:00:00.000Z","project":"all","projectName":"Todos","projects":[{"id":"p","name":"P"},{"id":7}],"paused":false,"analysisAt":null,"today":{"today":{"roas":1.2},"deltas":{"roas":null}},"queue":[{"kind":"loss","campaign":"C"},{"campaign":"sem kind"}],"queueSize":2,"approvals":{"items":[{"id":"a"}]},"activity":{"hours":24,"summary":{"pause":null,"reduce":{"count":2,"actors":{"Ana":null},"unknown":0}},"recent":[{"action":"pause"},{"x":1}]},"agents":null,"executor":{"enabled":true,"paused":false,"recentFailures":null},"notice":null,"accounts":{"rows":[]},"orders":[{"id":"o","stage":"sent"},{"id":"bad"}],"board":"oops"}"#
        if let b = try? JSONDecoder().decode(Summary.self, from: Data(broken.utf8)) {
            check(b.projects.count == 1 && b.queue.count == 1 && b.approvals.count == 1 && b.activity.summary.keys.sorted() == ["reduce"] && b.activity.recent.count == 1, #line)
            check(b.executor?.recentFailures == 0 && b.accounts == nil && b.board == nil && b.agents.recent.isEmpty && b.notice == "" && b.today.deltas.isEmpty, #line)
        } else { check(false, #line) }
        check(Format.bunkerDay("2026-11-09T01:30:00.000Z") == "2026-11-08" && Format.bunkerDay("2026-11-09T05:00:00Z") == "2026-11-09" && Format.bunkerDay("x") == "x", #line)
        var seenSet = Set((0..<2500).map { "k\($0)" }); Store.trimSeen(&seenSet, keep: ["k1", "k2", "novo"])
        check(seenSet == ["k1", "k2"], #line)
        var small: Set<String> = ["a"]; Store.trimSeen(&small, keep: []); check(small == ["a"], #line)
        func receiptLine(_ b: String, _ a: String) -> String? {
            let json = #"{"id":"o","stage":"sent","action":"budget","currency":"BRL","before":{"dailyBudget":"# + b + #"},"after":{"dailyBudget":"# + a + "}}"
            guard let r = try? JSONDecoder().decode(Summary.OrderReceipt.self, from: Data(json.utf8)) else { return nil }
            return Format.orderChange(r)
        }
        check(receiptLine("100", "80")?.hasPrefix("Reduzir") == true, #line)
        check(receiptLine("100", "120")?.hasPrefix("Aumentar") == true, #line)
        check(receiptLine("null", "80")?.hasPrefix("Orçamento") == true, #line)
        if let mine = try? JSONDecoder().decode(Summary.OrderReceipt.self, from: Data(#"{"id":"a","stage":"confirmed"}"#.utf8)),
           let bunk = try? JSONDecoder().decode(Summary.OrderReceipt.self, from: Data(#"{"id":"b","stage":"failed","by":"bunk","rule":"Pausar campanha nova sem venda"}"#.utf8)) {
            check(!mine.isBunk && Format.orderAlertTitle(mine) == "Ordem confirmada na Meta", #line)
            check(bunk.isBunk && Format.orderAlertTitle(bunk) == "Bunk (autonomia): ordem não enviada", #line)
        } else { check(false, #line) }
        let panelRect = CGRect(x: 500, y: 1000, width: 600, height: 80)
        check(NotchHover.near(CGPoint(x: 800, y: 1050), panel: panelRect) && NotchHover.near(CGPoint(x: 460, y: 960), panel: panelRect) && !NotchHover.near(CGPoint(x: 800, y: 500), panel: panelRect), #line)
        let scJSON = #"{"day":"2026-11-08","total":1,"byRule":{},"recent":[],"scorecard":{"days":7,"graded":14,"right":9,"wrong":5,"winnersCut":3,"stopped":2}}"#
        if let sh = try? JSONDecoder().decode(Summary.Shadow.self, from: Data(scJSON.utf8)), let sc = sh.scorecard {
            check(Format.shadowScore(sc) == "Placar 7 dias: acertou 9 de 14 (64%) · 3 cortes em vencedores", #line)
        } else { check(false, #line) }
        check((try? JSONDecoder().decode(Summary.Shadow.self, from: Data(#"{"day":null,"total":0,"byRule":{},"recent":[]}"#.utf8)))?.scorecard == nil, #line)
        let memJSON = #"{"day":"2026-11-09","total":1,"byRule":{},"recent":[],"learning":{"at":"2026-11-09T15:00:00Z","days":12,"from":"2026-10-29","graded":58,"right":40,"accuracy":0.69,"low":0.561,"high":0.793,"blindSpots":2,"lessons":["Projeto: 2 cortes"]}}"#
        if let l = (try? JSONDecoder().decode(Summary.Shadow.self, from: Data(memJSON.utf8)))?.learning {
            check(Format.shadowMemory(l) == "Memória 12 dias: acertou 40 de 58 (69%, faixa 56–79%) · 2 pontos cegos em 7 dias", #line)
            check(l.lessons?.first == "Projeto: 2 cortes", #line)
        } else { check(false, #line) }
        check((try? JSONDecoder().decode(Summary.Shadow.self, from: Data(#"{"day":null,"total":0,"byRule":{},"recent":[],"learning":null}"#.utf8)))?.learning == nil, #line)
        // Nothing graded: N/D, never 0%; team lines and proposals decode as text.
        let quietJSON = #"{"day":"2026-11-09","total":0,"byRule":{},"recent":[],"learning":{"days":0,"graded":0,"right":0,"low":null,"high":null,"blindSpots":2,"lessons":[],"team":["Testes sem venda pausados (30 dias): Ana 4 · mediana R$70."],"proposals":["Projeto: proposta"],"ownerLabel":"Você"}}"#
        if let q = (try? JSONDecoder().decode(Summary.Shadow.self, from: Data(quietJSON.utf8)))?.learning {
            check(Format.shadowMemory(q) == "Memória: nenhuma decisão avaliada ainda · 2 pontos cegos em 7 dias", #line)
            check(q.team?.first?.hasPrefix("Testes sem venda") == true && q.proposals?.count == 1, #line)
        } else { check(false, #line) }
        check(Format.money(Double.nan) == "N/D" && Format.exactMoney(nil) == "N/D" && Format.compactMoney(.infinity) == "N/D", #line)
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
        check(q?.balance == nil, #line)
        let withBalance = json.replacingOccurrences(of: #""roas7d":1.2,"#, with: #""roas7d":1.2,"balance":{"today":{"basis":"result","value":-1083},"yesterday":null,"3d":{"basis":"result","value":3500},"7d":{"basis":"result","value":6600},"with7d":{"basis":"result","value":5517},"with3d":null,"verdict":"recovers"},"#)
        let b = (try? JSONDecoder().decode(Summary.QueueItem.self, from: Data(withBalance.utf8)))?.balance
        check(b?.d7?.value == 6600 && b?.window("3d")?.value == 3500 && b?.yesterday == nil && b?.verdict == "recovers", #line)
        check(Format.balance(b?.with7d) == "+R$ 5,5 mil" && Format.balance(b?.today) == "−R$ 1,1 mil" && Format.balance(nil) == "N/D", #line)
        check(Format.balanceVerdict("recovers")?.tone == .warn && Format.balanceVerdict(nil) == nil, #line)
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
        _ = f.handle(.fix); check(f.fixed, #line)                     // pin button
        check(f.handle(.clickOutside) == .open && f.handle(.idle) == .open && f.handle(.mouseLeft) == .open, #line)
        check(f.handle(.alert(a)) == .open, #line)
        check(f.handle(.escape) == .compact && !f.fixed, #line)      // closing unpins
        _ = f.handle(.fix); check(!f.fixed, #line)                   // pin only applies to an open island
        _ = f.handle(.click); _ = f.handle(.fix); _ = f.handle(.fix); check(!f.fixed && f.handle(.clickOutside) == .compact, #line)
        _ = f.handle(.click); _ = f.handle(.fix); check(f.handle(.toggle) == .compact && !f.fixed, #line)
    }

    private static func testDisplayChoice() {
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
        // 10/11: four displays; the panel was left at x = 0 of the 1920-pt main screen instead of its centre.
        let main = CGRect(x: 0, y: 0, width: 1920, height: 1080), size = CGSize(width: 700, height: 560)
        let expected = CGRect(origin: NotchGeometry.panelOrigin(screen: main, panel: size), size: size)
        check(expected.origin == CGPoint(x: 610, y: 520), #line)
        // Manager changes show the ad account of the campaign; a blank account adds no empty pill.
        check(Format.queueTag(project: nil, account: "Conta Exemplo 01") == "Conta Exemplo 01", #line)
        check(Format.queueTag(project: nil, account: "  ") == nil && Format.queueTag(project: nil, account: nil) == nil, #line)
        check(NotchGeometry.drifted(panel: CGRect(origin: CGPoint(x: 0, y: 520), size: size), expected: expected), #line)
        check(!NotchGeometry.drifted(panel: expected, expected: expected), #line)
        check(!NotchGeometry.drifted(panel: expected.offsetBy(dx: 0.3, dy: -0.3), expected: expected), #line)
        check(NotchGeometry.drifted(panel: CGRect(origin: expected.origin, size: CGSize(width: 600, height: 560)), expected: expected), #line)
    }
    /// Touch ID adjustments: same limits as the server, intent never approves, signed envelope verifies.
    private static func testOwnerAdjust() {
        check(OwnerAdjust.validPercent("increase", 1000) && !OwnerAdjust.validPercent("increase", 1001), #line)
        check(OwnerAdjust.validPercent("reduce", 99.5) && !OwnerAdjust.validPercent("reduce", 100) && !OwnerAdjust.validPercent("reduce", 0), #line)
        check(OwnerAdjust.validPercent("pause", nil), #line)
        check(OwnerAdjust.newBudget(50, action: "increase", percent: 20) == 60, #line)
        check(OwnerAdjust.newBudget(33.33, action: "reduce", percent: 10) == 30, #line)
        check(OwnerAdjust.newBudget(nil, action: "increase", percent: 20) == nil, #line)
        let json = #"{"revision":9,"paused":false,"cards":[{"id":"campaign:p:1:2","signature":"v1-s","project":"p","projectName":"John","campaign":"C","account":"CA 1","adAccountId":"1","objectId":"2","status":"ACTIVE","dailyBudget":50,"currency":"USD","windows":{"today":{"spend":10,"roas":null,"roi":null,"frontOrders":0},"7d":null},"suggestion":{"action":"pause","percent":null,"reason":"x","origin":"team"},"intentActions":{"increase":true,"reduce":true,"pause":true,"keep":true},"blockedReasons":[],"lastChoice":null,"proposal":null}],"approvals":[{"id":"x","version":2,"signature":"s","status":"Aguardando aprovação","project":"p","title":"t","reason":null,"action":"budget","level":"campaign","adAccountId":"1","objectId":"2","campaign":"C","account":"CA 1","currency":"USD","before":{"dailyBudget":50,"status":null},"after":{"dailyBudget":75,"status":null},"expiresAt":"2026-11-08T00:00:00.000Z","expired":false,"projectName":"John"}]}"#
        guard let cards = try? JSONDecoder().decode(OwnerCards.self, from: Data(json.utf8)), let card = cards.cards.first, let p = cards.approvals.first else { check(false, #line); return }
        let intent = OwnerAdjust.intent(card: card, revision: 9, action: "pause", percent: 30, reason: " ok ", clientId: "notch-owner-test1")
        check(intent["approveExact"] as? Bool == false && intent["percent"] == nil && intent["reason"] as? String == "ok" && intent["revision"] as? Int == 9, #line)
        check(Format.statusName("in_process") == "em processamento" && Format.statusName("PENDING_REVIEW") == "em análise", #line)
        let applied = OwnerAdjust.applied(card: card, revision: 9, action: "reduce", percent: 30, reason: "", clientId: "notch-owner-test3")
        check(applied["applied"] as? Bool == true && applied["approveExact"] as? Bool == false && applied["percent"] as? Double == 30, #line)
        check(OwnerAdjust.canDecide(card) && OwnerAdjust.canReportApplied(card, action: "pause") && !OwnerAdjust.canReportApplied(card, action: "keep"), #line)
        let review = OwnerAdjust.review(p, revision: 9, decision: "approve", comment: nil, clientId: "notch-owner-test2")
        check(review["op"] as? String == "proposalReview" && review["version"] as? Int == 2 && review["comment"] == nil, #line)
        check(OwnerAdjust.change(p) == "orçamento diário " + Format.money(50, currency: "USD") + " → " + Format.money(75, currency: "USD"), #line)
        // Direct order: exact values the owner saw, no revision dependency, no card needed.
        let dJson = #"{"revision":9,"paused":false,"cards":[],"approvals":[],"directOrder":{"project":"p","adAccountId":"1","objectId":"2","available":true,"actions":{"increase":true,"reduce":true,"pause":true,"keep":false},"blockers":[],"source":{"kind":"live","at":"2026-11-08T12:00:00.000Z","status":"ACTIVE","dailyBudget":95.1,"currency":"USD"},"campaign":"C","account":"CA 1"}}"#
        guard let dCards = try? JSONDecoder().decode(OwnerCards.self, from: Data(dJson.utf8)), let d = dCards.directOrder else { check(false, #line); return }
        check(dCards.cards.isEmpty && OwnerAdjust.canDirectOrder(d, action: "pause") && !OwnerAdjust.canDirectOrder(d, action: "keep"), #line)
        let order = OwnerAdjust.directOrder(d, action: "reduce", percent: 20, reason: " ", clientId: "notch-owner-test4")
        let exp = order["expected"] as? [String: Any], after = order["after"] as? [String: Any]
        check(order["op"] as? String == "ownerDirectOrder" && order["reason"] == nil && exp?["dailyBudget"] as? Double == 95.1 && exp?["status"] as? String == "ACTIVE" && after?["dailyBudget"] as? Double == 76.08, #line)
        check(OwnerAdjust.newBudget(95.1, action: "reduce", percent: 12.5) == 83.21, #line)
        let pause = OwnerAdjust.directOrder(d, action: "pause", percent: nil, reason: "", clientId: "notch-owner-test5")
        check(pause["percent"] == nil && pause["after"] == nil && OwnerAdjust.directLine(d, action: "pause", percent: nil).hasPrefix("Pausar"), #line)
        let noDirect = try? JSONDecoder().decode(OwnerCards.self, from: Data(#"{"revision":1,"paused":false,"cards":[],"approvals":[]}"#.utf8))
        check(noDirect != nil && noDirect?.directOrder == nil && !OwnerAdjust.canDirectOrder(nil, action: "pause"), #line)
        // Owner's daily-budget ceiling: older servers omit it; past it an increase is not executable, a reduce always is.
        check(d.budgetCap == nil && OwnerAdjust.capProblem("increase", 200, cap: nil, current: 95.1) == nil, #line)
        let cJson = dJson.replacingOccurrences(of: #""campaign":"C""#, with: #""budgetCap":{"dailyBudget":120,"currency":"USD","maxIncreasePercent":26},"campaign":"C""#)
        guard let cd = (try? JSONDecoder().decode(OwnerCards.self, from: Data(cJson.utf8)))?.directOrder, let cap = cd.budgetCap else { check(false, #line); return }
        check(cap.dailyBudget == 120 && OwnerAdjust.capProblem("increase", OwnerAdjust.newBudget(95.1, action: "increase", percent: 26), cap: cap, current: 95.1) == nil, #line)
        check(OwnerAdjust.capProblem("increase", OwnerAdjust.newBudget(95.1, action: "increase", percent: 30), cap: cap, current: 95.1)?.hasSuffix("Aumento máximo agora: 26%.") == true, #line)
        check(OwnerAdjust.capProblem("reduce", 200, cap: cap, current: 95.1) == nil && OwnerAdjust.capProblem("increase", 130, cap: cap, current: 120)?.contains("já está no teto") == true, #line)
        let key = P256.Signing.PrivateKey()
        guard let body = try? OwnerKey.envelope(input: review, payloadSigner: { try key.signature(for: $0).rawRepresentation }, key: key.publicKey),
              let env = try? JSONSerialization.jsonObject(with: body) as? [String: Any], let payload = Data(base64Encoded: env["payload"] as? String ?? ""),
              let sig = Data(base64Encoded: env["sig"] as? String ?? ""), let signature = try? P256.Signing.ECDSASignature(rawRepresentation: sig) else { check(false, #line); return }
        check(key.publicKey.isValidSignature(signature, for: payload) && env["key"] as? String == OwnerKey.keyId(key.publicKey) && OwnerKey.keyId(key.publicKey).count == 16, #line)
    }

    /// Fix battery (09/11/2026): held and notified alerts follow the island priority; counters that did not decode are unknown.
    private static func testAlertPriorityAndCounters() {
        typealias A = (String, String, String, IslandAlert.Kind)
        let m = { (i: Int) -> A in ("ac:pause|m\(i)", "t", "d", .manager) }
        // In a call: an approval held first survives three later manager changes; one read with approval, loss, pace and order keeps the top three.
        var held: [A] = Store.keepHeld([], [("ap:x", "t", "d", .approval)])
        for i in 0..<3 { held = Store.keepHeld(held, [m(i)]) }
        check(held.map(\.0) == ["ap:x", "ac:pause|m2", "ac:pause|m1"], #line)
        let one = Store.keepHeld([], [("ap:y", "t", "d", .approval), ("lo:z", "t", "d", .loss), ("pace:p:under:d", "t", "d", .manager), ("or:o:confirmed", "t", "d", .order)])
        check(one.map(\.0) == ["or:o:confirmed", "ap:y", "lo:z"], #line)
        // One read keeps the server's newest-first order (m0 newest), as deliver shows it; a later read goes before held ones.
        check(Store.keepHeld([("sa:1", "t", "d", .sale)], [m(0), m(1), m(2)]).map(\.0) == ["ac:pause|m0", "ac:pause|m1", "ac:pause|m2"], #line)
        let five = [m(5), m(4), m(3), m(2), m(1)]
        check(Store.keepHeld([], five).map(\.0) == Store.byPriority(five).prefix(3).map(\.0) && Store.keepHeld([], five).map(\.0) == ["ac:pause|m5", "ac:pause|m4", "ac:pause|m3"], #line)
        check(Store.keepHeld([m(1), m(0)], [m(3), m(2)]).map(\.0) == ["ac:pause|m3", "ac:pause|m2", "ac:pause|m1"], #line)
        // Four notifications: a failed order and a loss go before four manager changes; the same kind keeps its arrival order.
        let notes = Store.byPriority([m(0), m(1), m(2), m(3), ("lo:q", "t", "d", .loss), ("or:o:failed", "t", "d", .order)]).prefix(4).map(\.0)
        check(notes == ["or:o:failed", "lo:q", "ac:pause|m0", "ac:pause|m1"], #line)
        // Counters: a malformed bucket or a missing section is unknown, never zero; the next good read compares with the last good one.
        let block = { (raw: String) in (try? JSONDecoder().decode(Summary.ActivityBlock.self, from: Data(raw.utf8))) ?? Summary.ActivityBlock(hours: 24, summary: [:], recent: []) }
        let good = block(#"{"hours":24,"summary":{"increase":{"count":12,"actors":{},"unknown":0},"reduce":{"count":4,"actors":{},"unknown":0},"pause":{"count":7,"actors":{},"unknown":0}},"recent":[]}"#)
        let bad = block(#"{"hours":24,"summary":{"increase":{"count":"12","actors":{},"unknown":0},"reduce":{"count":4,"actors":{},"unknown":0},"pause":{"count":7,"actors":{},"unknown":0}},"recent":[]}"#)
        let more = block(#"{"hours":24,"summary":{"increase":{"count":13,"actors":{},"unknown":0},"reduce":{"count":4,"actors":{},"unknown":0},"pause":{"count":7,"actors":{},"unknown":0}},"recent":[]}"#)
        let missing = Summary.ActivityBlock(hours: 24, summary: [:], recent: [])
        check(AdjustSound.counts(good) == ["increase": 12, "reduce": 4, "pause": 7] && AdjustSound.counts(bad) == nil && AdjustSound.counts(missing) == nil, #line)
        var last: AdjustSound.Counters? = nil, rises: [Set<String>] = []
        for b in [good, bad, good, missing, good, bad, more] { let step = AdjustSound.counterStep(last: last, project: "p", activity: b, alreadyNew: []); rises.append(step.rise); last = step.last }
        check(rises == [[], [], [], [], [], [], ["increase"]], #line)
        check(AdjustSound.counterStep(last: ("p", ["increase": 1]), project: "q", activity: more, alreadyNew: []).rise.isEmpty, #line)
        check(AdjustSound.counterStep(last: ("p", ["increase": 1]), project: "q", activity: bad, alreadyNew: []).last == nil, #line)
        // A null bucket drops only its kind: that kind is unknown (kept, no rise), the others still compare; never zero.
        let nullInc = block(#"{"hours":24,"summary":{"increase":null,"reduce":{"count":4,"actors":{},"unknown":0},"pause":{"count":7,"actors":{},"unknown":0}},"recent":[]}"#)
        let morePause = block(#"{"hours":24,"summary":{"increase":{"count":12,"actors":{},"unknown":0},"reduce":{"count":4,"actors":{},"unknown":0},"pause":{"count":8,"actors":{},"unknown":0}},"recent":[]}"#)
        last = nil; rises = []
        for b in [good, nullInc, good, nullInc, more, nullInc, morePause] { let step = AdjustSound.counterStep(last: last, project: "p", activity: b, alreadyNew: []); rises.append(step.rise); last = step.last }
        check(rises == [[], [], [], [], ["increase"], [], ["pause"]], #line)
        last = nil; rises = []
        for b in [nullInc, good, more] { let step = AdjustSound.counterStep(last: last, project: "p", activity: b, alreadyNew: []); rises.append(step.rise); last = step.last }
        check(rises == [[], [], ["increase"]], #line)
    }

    /// Sound per kind of adjustment: read from the change alert keys, once per kind, pause first; activation is silent.
    private static func testAdjustSound() {
        let e = { (action: String) in Summary.Activity(action: action, field: "dailyBudget", before: nil, after: nil, percent: nil, currency: "BRL", at: nil, from: nil, actor: "Ana", origin: "history", campaign: "C", account: nil, campaignId: "1") }
        let keys = [Store.changeKey(e("increase")), Store.changeKey(e("activate")), "ap:1", "lo:2", Store.changeKey(e("pause")), Store.changeKey(e("increase"))]
        check(AdjustSound.action(fromKey: keys[0]) == "increase", #line)
        check(AdjustSound.action(fromKey: "ap:1") == nil, #line)
        check(AdjustSound.kinds(forKeys: keys) == [.pause, .increase], #line)
        check(AdjustSound.kinds(forKeys: [Store.changeKey(e("reduce"))]) == [.reduce], #line)
        check(AdjustSound.kinds(forKeys: ["ap:1", Store.changeKey(e("activate"))]).isEmpty, #line)
        // Review fixes: counter rise covers changes outside the newest 12 and repeated transitions, never twice.
        check(AdjustSound.countRise(previous: nil, current: ["pause": 3], alreadyNew: []).isEmpty, #line)
        check(AdjustSound.countRise(previous: ["pause": 2, "increase": 4], current: ["pause": 3, "increase": 4, "reduce": 1], alreadyNew: ["reduce"]) == ["pause"], #line)
        check(AdjustSound.kinds(forKeys: ["lo:1"], extra: ["increase", "activate"]) == [.increase], #line)
        // The same transition later again rings; a reread with the same or an earlier time does not.
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        check(AdjustSound.repeats(lastAt: t0, at: t0.addingTimeInterval(3600)), #line)
        check(!AdjustSound.repeats(lastAt: t0, at: t0.addingTimeInterval(-600)) && !AdjustSound.repeats(lastAt: t0, at: t0.addingTimeInterval(60)) && !AdjustSound.repeats(lastAt: nil, at: t0), #line)
        // Notifications already covered by a kind sound stay silent: the change and a confirmed owner order.
        check(AdjustSound.silenced(id: keys[4], isOrder: false, playing: [.pause]), #line)
        check(!AdjustSound.silenced(id: keys[4], isOrder: false, playing: [.increase]), #line)
        check(AdjustSound.silenced(id: "or:9:confirmed", isOrder: true, playing: [.reduce]) && !AdjustSound.silenced(id: "or:9:failed", isOrder: true, playing: [.reduce]), #line)
        check(!AdjustSound.silenced(id: "or:9:confirmed", isOrder: true, playing: []) && !AdjustSound.silenced(id: "ap:1", isOrder: false, playing: [.pause]), #line)
        check(AdjustSound.action(fromKey: keys[4] + "@2026-11-08T15:00:00.000Z") == "pause", #line)
        // At least five choices per kind; ids unique; the default exists; every system sound exists on this Mac.
        let all = AdjustSound.Kind.allCases.flatMap(AdjustSound.options)
        check(Set(all.map(\.id)).count == all.count, #line)
        for k in AdjustSound.Kind.allCases {
            check(AdjustSound.options(k).filter { $0.source != .silent }.count >= 5, #line)
            check(AdjustSound.options(k).contains { $0.source == .silent }, #line)
            check(AdjustSound.options(k).contains { $0.id == AdjustSound.defaultID(k) }, #line)
            check(AdjustSound.selected(k).id == AdjustSound.options(k).first { UserDefaults.standard.string(forKey: AdjustSound.choiceKey(k)) == $0.id }?.id ?? AdjustSound.defaultID(k), #line)
        }
        for o in all {
            switch o.source {
            case .silent: break
            case .system(let name):
                check(NSSound(named: NSSound.Name(name)) != nil, #line)
                // Trimmed to 0.7 s with a fade: valid WAV, never longer than the limit.
                if let d = SoundSynth.trimmedSystem(name) {
                    check(d.prefix(4) == Data("RIFF".utf8) && d.count <= 44 + Int(0.7 * 48_000) * 2 * 2 + 8, #line)
                    check(((try? AVAudioPlayer(data: d))?.duration ?? 9) <= 0.71, #line)
                } else { check(false, #line) }
            case .synth(let timbre, let notes):
                // Generated tones: 120–700 ms, peak at most -6 dBFS, no NaN, valid WAV header.
                let total = (notes.map { $0.startMs + $0.durationMs }.max() ?? 0)
                check(total >= 120 && total <= 700, #line)
                let x = SoundSynth.samples(timbre, notes), peak = x.map(abs).max() ?? 0
                check(!x.contains { $0.isNaN } && peak <= SoundSynth.peak + 0.001 && peak > 0.2, #line)
                let wav = SoundSynth.wav(x)
                check(wav.count == 44 + x.count * 2 && wav.prefix(4) == Data("RIFF".utf8), #line)
                check((try? AVAudioPlayer(data: wav))?.duration ?? 0 > 0.1, #line)
            }
        }
        // Contour follows the meaning: generated increases end higher than they start, reductions and pauses lower or equal.
        func contour(_ o: SoundOption) -> Double? { if case .synth(_, let n) = o.source, let a = n.min(by: { $0.startMs < $1.startMs }), let b = n.max(by: { $0.startMs < $1.startMs }) { return b.hz - a.hz }; return nil }
        check(AdjustSound.options(.increase).compactMap(contour).allSatisfy { $0 > 0 }, #line)
        check(AdjustSound.options(.reduce).compactMap(contour).allSatisfy { $0 < 0 }, #line)
        check(AdjustSound.options(.pause).compactMap(contour).allSatisfy { $0 <= 0 }, #line)
    }
}
