import AppKit
import SwiftUI

/// `Bunker --render-notch folder`: one PNG per island state and tab, drawn over a fake desktop with
/// fictional data (no network, no credential, no real campaign). For design review without screen capture.
@MainActor enum NotchPreview {
    static func render(to folder: String) -> Int32 {
        guard let summary = fixture() else { FileHandle.standardError.write(Data("fixture inválida\n".utf8)); return 1 }
        let dir = URL(fileURLWithPath: folder, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let geometry = NotchGeometry(hasNotch: true, width: 186, height: 32)
        let loss = summary.queue.first { $0.kind == "loss" }
        let shots: [(String, (NotchState) -> Void)] = [
            ("01-compact", { $0.mode = .compact }),
            ("02-peek", { $0.mode = .peek }),
            ("03-alert", { $0.mode = .alert(IslandAlert(id: "a", kind: .loss, title: "Perda acima do limite", detail: "TESTE 07 · Criativo C · −R$ 412 hoje")) }),
            ("03b-alert-vigia", { $0.mode = .alert(IslandAlert(id: "vg:ns:p1:x:1", kind: .funnel, title: "Alfa: sem venda aprovada há 4h", detail: "Página no ar ✓ · Checkout abrindo ✓ · Tráfego rodando ✓")) }),
            ("03c-alert-vigia-vendas", { $0.mode = .alert(IslandAlert(id: "vg:mm:p2:2026-11-13:0", kind: .funnel, title: "Beta: as vendas não batem", detail: "O vTurb contou 8 conversões hoje e o checkout registrou 3 pedidos (3 aprovados).")) }),
            ("04-open-agora", { $0.mode = .open; $0.tab = .now }),
            ("04b-open-autonomia", { $0.mode = .open; $0.tab = .autonomy }),
            ("05-open-projetos", { $0.mode = .open; $0.tab = .projects }),
            ("06-open-contas", { $0.mode = .open; $0.tab = .accounts }),
            ("07-open-gestores", { $0.mode = .open; $0.tab = .managers }),
            ("08-open-agentes", { $0.mode = .open; $0.tab = .agents }),
            ("09-open-sistema", { $0.mode = .open; $0.tab = .system }),
            ("10-detalhe", { $0.mode = .open; $0.selected = loss }),
            ("11-ajuste-executar", { adjust($0, cards: ownerCards(fresh: true), action: "reduce") }),
            ("12-ajuste-bloqueado", { adjust($0, cards: ownerCards(fresh: false), action: "pause") }),
            ("13-aprovar", { adjust($0, cards: ownerCards(fresh: true, approvals: true), action: "", campaign: false) }),
            // The queue with its period ladder (no approvals or orders above it, so it is above the fold).
            ("14-fila", { $0.mode = .open; $0.tab = .now }),
            // Direct order on a campaign outside the last analysis (live Malva value only).
            ("15-ordem-direta", { adjust($0, cards: directOnly(), action: "pause") }),
            // Review of 13/11 (owner's photo): two projects still on yesterday's analysis, empty queue, ROI N/D.
            ("16-fila-sem-analise", { $0.mode = .open; $0.tab = .now }),
        ]
        let queueFocus: Summary? = {
            guard var json = (try? JSONSerialization.jsonObject(with: Data(fixtureJSON().utf8))) as? [String: Any] else { return nil }
            json["approvals"] = ["count": 0, "items": [Any]()]; json["orders"] = [Any]()
            guard let data = try? JSONSerialization.data(withJSONObject: json) else { return nil }
            return try? JSONDecoder().decode(Summary.self, from: data)
        }()
        // Mixed sources: fresh receipt, two projects on yesterday's analysis, no queue item, ROI without product cost.
        let mixed: Summary? = {
            guard var json = (try? JSONSerialization.jsonObject(with: Data(fixtureJSON().utf8))) as? [String: Any] else { return nil }
            json["approvals"] = ["count": 0, "items": [Any]()]; json["orders"] = [Any](); json["queue"] = [Any](); json["queueSize"] = 97
            json["queueInfo"] = ["active": 97, "stale": 80, "staleProjects": ["Alfa", "Beta"], "read": 17, "protectedTests": 2]
            json["analysis"] = [["name": "Alfa", "at": ago(1300), "current": false], ["name": "Beta", "at": ago(1250), "current": false], ["name": "Gama", "at": ago(3), "current": true]]
            json["todayGaps"] = ["roi": ["rows": 104, "missing": [["field": "productCost", "label": "custo do produto", "rows": 12]]]]
            if var today = json["today"] as? [String: Any], var t = today["today"] as? [String: Any] { t["roi"] = NSNull(); today["today"] = t; today["deltas"] = [String: Any](); json["today"] = today }
            json.removeValue(forKey: "autonomy")
            guard let data = try? JSONSerialization.data(withJSONObject: json) else { return nil }
            return try? JSONDecoder().decode(Summary.self, from: data)
        }()
        var failures: Int32 = 0
        for (name, setup) in shots {
            let store = Store(), notch = NotchState(geometry: geometry)
            store.showPreview(name == "14-fila" ? queueFocus ?? summary : name == "16-fila-sem-analise" ? mixed ?? summary : summary)
            setup(notch)
            let scene = ZStack(alignment: .top) {
                LinearGradient(colors: [Color(red: 0.20, green: 0.24, blue: 0.33), Color(red: 0.36, green: 0.30, blue: 0.40)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Rectangle().fill(.black.opacity(0.25)).frame(height: geometry.height)
                NotchRootView().environmentObject(store).environmentObject(notch)
            }
            .frame(width: 760, height: 600)
            .environment(\.colorScheme, .dark)
            if !write(scene, to: dir.appendingPathComponent(name + ".png")) { failures += 1 }
        }
        // The queue rows alone (the open panel is fixed height): today in red, the balance strip under it.
        let rows = VStack(spacing: 2) {
            ForEach(summary.queue) { q in
                let l = q.kind == "loss"
                ListRow(id: "q:" + q.id, symbol: l ? "arrow.down.right" : "arrow.up.right", tone: l ? .bad : .good, title: q.campaign ?? "Campanha",
                        subtitle: "\(q.period == "today" ? "Hoje" : "3 dias"): gasto \(Format.money(q.spend)) · ROAS \(Format.ratio(q.roas)) · 7d \(Format.ratio(q.roas7d))",
                        tag: q.account, value: (l ? "−" : "+") + Format.money(q.amount), valueCaption: l ? (q.period == "today" ? "prejuízo hoje" : "prejuízo em 3 dias") : "resultado em 3 dias",
                        footer: q.balance.flatMap { $0.hasAny ? AnyView(BalanceStrip(balance: $0)) : nil })
            }
        }.padding(DS.Space.m).frame(width: 760).background(Color.black).environmentObject(NotchState(geometry: geometry)).environment(\.colorScheme, .dark)
        if !write(rows, to: dir.appendingPathComponent("14-fila-saldo.png")) { failures += 1 }
        // The Bunk's anticipated moves with the owner's quick action (opens the order already chosen; Touch ID still decides).
        let shadowRows = VStack(spacing: 2) {
            ForEach(summary.shadow?.recent ?? []) { item in
                ListRow(id: "sh:" + item.id, symbol: item.action == "status" ? "pause.fill" : "dollarsign.circle", tone: item.manager != nil || item.owner != nil ? .good : (item.wouldExecute == true ? .warn : .neutral),
                        title: item.campaign ?? "Campanha", subtitle: Format.shadowChange(item) + " · " + (item.ruleLabel ?? item.rule ?? ""),
                        tag: Format.queueTag(project: item.project, account: item.account), value: Format.stamp(item.firstAt), valueCaption: Format.shadowOutcome(item),
                        accessory: AdjustPreset.from(item).map { AnyView(ShadowActionButton(item: item, preset: $0)) })
            }
        }.padding(DS.Space.m).frame(width: 760).background(Color.black).environmentObject(NotchState(geometry: geometry)).environment(\.colorScheme, .dark)
        if !write(shadowRows, to: dir.appendingPathComponent("16-sombra-acao.png")) { failures += 1 }
        print(failures == 0 ? "Notch salvo em \(dir.path)" : "\(failures) imagem(ns) falharam")
        return failures == 0 ? 0 : 1
    }

    private static func adjust(_ n: NotchState, cards: OwnerCards?, action: String, campaign: Bool = true) {
        n.mode = .open
        n.ownerAdjust.preview = true; n.ownerAdjust.data = cards; n.ownerAdjust.action = action; n.ownerAdjust.percentText = "20"
        n.adjust = campaign ? AdjustTarget(project: "p2", adAccountId: "a2", campaignId: "c2", name: "07/11 - [CBO] - [AVATAR] - Criativo 009") : AdjustTarget(project: nil, adAccountId: nil, campaignId: nil, name: nil)
    }
    /// Fictional decision card for the adjust screen: runnable now, or blocked by a stale reading.
    private static func ownerCards(fresh: Bool, approvals: Bool = false) -> OwnerCards? {
        let blocked = fresh ? "[\"Faltam pareceres da equipe para esta campanha ou sua hierarquia.\",\"Meta de retorno do projeto não configurada.\"]"
                            : "[\"Leitura de hoje vencida ou com data inválida.\",\"Faltam pareceres da equipe para esta campanha ou sua hierarquia.\"]"
        let order = fresh ? "{\"increase\":true,\"reduce\":true,\"pause\":true,\"keep\":false}" : "{\"increase\":false,\"reduce\":false,\"pause\":false,\"keep\":false}"
        let orderBlockers = fresh ? "[]" : "[\"Leitura de hoje vencida ou com data inválida.\"]"
        let approval = approvals ? "[{\"id\":\"pr1\",\"version\":1,\"signature\":\"s\",\"status\":\"Aguardando aprovação\",\"project\":\"p2\",\"title\":\"Conta Exemplo 02 · Reduzir 20%\",\"reason\":\"ROAS abaixo do equilíbrio em 3 e 7 dias; filhos sem venda.\",\"action\":\"budget\",\"level\":\"campaign\",\"adAccountId\":\"a2\",\"objectId\":\"c9\",\"campaign\":\"[ABO] - [ESCALA] - Criativo A\",\"account\":\"Conta Exemplo 02\",\"currency\":\"USD\",\"before\":{\"dailyBudget\":500},\"after\":{\"dailyBudget\":400},\"expiresAt\":\"\(ago(-120))\",\"expired\":false,\"projectName\":\"Beta\"}]" : "[]"
        let json = """
        {"revision":7,"paused":false,"approvals":\(approval),"cards":[{"id":"k","signature":"s","project":"p2","projectName":"Beta","campaign":"07/11 - [CBO] - [AVATAR] - Criativo 009","account":"Conta Exemplo 02","adAccountId":"a2","objectId":"c2","status":"ACTIVE","dailyBudget":95.1,"currency":"USD",
          "windows":{"today":{"spend":310,"roas":0.62,"roi":0.5,"frontOrders":1},"yesterday":{"spend":480,"roas":1.12,"roi":0.9,"frontOrders":3},"3d":{"spend":1450,"roas":0.94,"roi":0.8,"frontOrders":8},"7d":null},
          "suggestion":{"action":"keep","percent":null,"reason":"Diagnóstico: comparar aquisição, última edição e os quatro períodos.","origin":"diagnostic"},
          "intentActions":{"increase":true,"reduce":true,"pause":true,"keep":true},"blockedReasons":\(blocked),"lastChoice":null,"proposal":null,"orderActions":\(order),"orderBlockers":\(orderBlockers)}],
          "directOrder":{"project":"p2","adAccountId":"a2","objectId":"c2","available":\(fresh),"actions":\(order),"blockers":\(fresh ? "[]" : "[\"Sem leitura ao vivo desta campanha nos últimos 10 minutos. A próxima leitura da Malva chega em poucos minutos: recarregue e tente de novo.\"]"),
            "source":\(fresh ? "{\"kind\":\"live\",\"at\":\"2026-11-08T12:04:00.000Z\",\"status\":\"ACTIVE\",\"dailyBudget\":95.1,\"currency\":\"USD\"}" : "null"),"campaign":"07/11 - [CBO] - [AVATAR] - Criativo 009","account":"Conta Exemplo 02"}}
        """
        return try? JSONDecoder().decode(OwnerCards.self, from: Data(json.utf8))
    }

    /// Fictional campaign that started after the analysis: no card, only the direct order from the live reading.
    private static func directOnly() -> OwnerCards? {
        let json = """
        {"revision":7,"paused":false,"approvals":[],"cards":[],"directOrder":{"project":"p2","adAccountId":"a2","objectId":"c2","available":true,"actions":{"increase":true,"reduce":true,"pause":true,"keep":false},"blockers":[],
          "source":{"kind":"live","at":"2026-11-08T12:04:00.000Z","status":"ACTIVE","dailyBudget":95.1,"currency":"USD"},"campaign":"08/11 - [CBO] - [TESTE] - Criativo 012","account":"Conta Exemplo 02"}}
        """
        return try? JSONDecoder().decode(OwnerCards.self, from: Data(json.utf8))
    }

    /// Hosted in an off-screen window so AppKit-backed controls (scroll views, menus, buttons) draw too.
    private static func write<V: View>(_ view: V, to url: URL) -> Bool {
        let size = CGSize(width: 760, height: 600)
        let host = NSHostingView(rootView: view)
        host.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: CGRect(x: -4000, y: -4000, width: size.width, height: size.height), styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.appearance = NSAppearance(named: .darkAqua)
        window.orderFrontRegardless()
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return false }
        host.cacheDisplay(in: host.bounds, to: rep)
        window.orderOut(nil)
        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: url)) != nil
    }

    private static func ago(_ minutes: Double) -> String { Format.isoFull.string(from: Date().addingTimeInterval(-minutes * 60)) }

    /// Fictional names and values only: this file is in a public repository.
    static func fixture() -> Summary? {
        let json = fixtureJSON()
        do { return try JSONDecoder().decode(Summary.self, from: Data(json.utf8)) }
        catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); return nil }
    }
    /// The fictional summary as JSON (also written by `--dump-preview file` for contract fuzzing).
    static func fixtureJSON() -> String {
        func window(_ spend: Double, _ roas: Double?, _ front: Double?) -> String {
            "{\"spend\":\(spend),\"roas\":\(roas.map { String($0) } ?? "null"),\"roi\":\(roas.map { String($0 * 0.9) } ?? "null"),\"frontOrders\":\(front.map { String($0) } ?? "null"),\"cpaFront\":null}"
        }
        let change = { (action: String, actor: String, before: Double, after: Double, pct: Double, mins: Double, camp: String) in
            "{\"action\":\"\(action)\",\"field\":\"dailyBudget\",\"before\":\(before),\"after\":\(after),\"percent\":\(pct),\"currency\":\"BRL\",\"at\":\"\(ago(mins))\",\"from\":null,\"actor\":\"\(actor)\",\"origin\":\"malva\",\"campaign\":\"\(camp)\",\"account\":\"Conta Exemplo 01\",\"campaignId\":\"c\(Int(mins))\"}"
        }
        let detail = { (reason: String, noSpend: Bool) in
            let closed = noSpend ? "{\"spend\":0,\"roas\":null,\"roi\":null,\"frontOrders\":null,\"cpaFront\":null,\"noSpend\":true}" : window(1240, 0.82, 6)
            return "{\"projectId\":\"p1\",\"malvaObjectId\":null,\"status\":\"ACTIVE\",\"dailyBudget\":250,\"budgetCurrency\":\"BRL\",\"reason\":\"\(reason)\",\"windows\":{\"today\":\(window(412, 0, 0)),\"yesterday\":\(closed),\"3d\":\(closed),\"7d\":\(noSpend ? closed : window(2980, 0.91, 14))},\"changes\":[\(change("reduce", "Ana Souza", 300, 250, -16.7, 95, "TESTE 07 · Criativo C"))]}"
        }
        let json = """
        {"generatedAt":"\(ago(1))","project":"all","projectName":"Todos os projetos",
         "projects":[{"id":"p1","name":"Alfa"},{"id":"p2","name":"Beta"},{"id":"p3","name":"Gama"}],
         "paused":false,"analysisAt":"\(ago(3))",
         "today":{"today":{"roas":1.42,"roi":1.21,"cpaFront":86.4,"spend":18420},"yesterday":{"roas":1.31,"roi":1.12,"cpaFront":92.1,"spend":21030},"week":{"roas":1.55,"roi":1.33,"cpaFront":80.2,"spend":131200},
                  "recent":{"roas":1.21,"roi":1.04,"cpaFront":95.0,"spend":58000},
                  "deltas":{"roas":{"yesterday":0.084,"week":-0.084},"roi":{"yesterday":0.08,"week":-0.09},"cpaFront":{"yesterday":-0.062,"week":0.077}}},
         "pace":{"project":"all","name":"Todos os projetos","currency":"BRL","status":"exhausts","budget":32000,"spend":18420,"projected":36800,"elapsedPct":50,"exhaustsAt":"\(ago(-200))","leftoverPct":null,"known":14,"unknown":2,"reason":null,"alert":null,"byProject":[
           {"project":"p1","name":"Alfa","currency":"BRL","status":"exhausts","budget":9000,"spend":6100,"projected":12200,"elapsedPct":50,"exhaustsAt":"\(ago(-120))","leftoverPct":null,"known":6,"unknown":0,"reason":null,"alert":"early","byProject":null},
           {"project":"p2","name":"Beta","currency":"BRL","status":"under","budget":12000,"spend":2400,"projected":4800,"elapsedPct":50,"exhaustsAt":null,"leftoverPct":60,"known":5,"unknown":1,"reason":null,"alert":"under","byProject":null},
           {"project":"p3","name":"Gama","currency":"BRL","status":"on","budget":8000,"spend":4100,"projected":8200,"elapsedPct":50,"exhaustsAt":null,"leftoverPct":null,"known":3,"unknown":0,"reason":null,"alert":null,"byProject":null}]},
         "orders":[{"id":"o1","project":"p2","projectName":"Beta","campaign":"07/11 - [CBO] - [AVATAR] - Criativo 009","account":"Conta Exemplo 02","action":"budget","currency":"USD","before":{"dailyBudget":120,"status":null},"after":{"dailyBudget":90,"status":null},"stage":"confirmed","label":"Confirmada na Meta","reason":null,"source":"live","at":"\(ago(6))","sentAt":"\(ago(5))","confirmedAt":"\(ago(4))"},
                   {"id":"o2","project":"p1","projectName":"Alfa","campaign":"[CBO] - [TESTE] - Criativo C","account":"Conta Exemplo 01","action":"status","currency":"BRL","before":{"dailyBudget":null,"status":"ACTIVE"},"after":{"dailyBudget":null,"status":"PAUSED"},"stage":"sent","label":"Enviada à Meta · aguardando releitura","reason":null,"source":"analysis","at":"\(ago(1))","sentAt":"\(ago(0.5))","confirmedAt":null}],
         "sales":{"recent":[{"amount":297,"currency":"BRL","product":"Curso X","campaign":"07/11 - JOHN","project":"p1","at":"\(ago(1))"}],"lastHour":3},
         "vigia":{"at":"\(ago(3))","fresh":true,"signals":[{"id":"mm:p2:2026-11-13:0","kind":"mismatch","project":"Beta","projectId":"p2","tone":"warn","title":"Beta: as vendas não batem","lines":["O vTurb contou 8 conversões hoje e o checkout registrou 3 pedidos (3 aprovados).","O checkout avisou às 13:12, então o webhook está recebendo: a diferença pode ser Pix não pago, atraso do vTurb ou pedido que não chegou.","Próximo passo: compare as vendas do vTurb com os pedidos no painel do checkout."]},{"id":"ns:p1:x:1","kind":"nosale","project":"Alfa","projectId":"p1","tone":"warn","title":"Alfa: sem venda aprovada há 4h","lines":["Página no ar ✓ · Checkout abrindo ✓ · Tráfego rodando ✓","Última venda às 10:55 · R$ 40,00 gastos na última hora · 6 checkouts iniciados desde 12:00","Página e checkout responderam, mas isso não explica a falta de venda aprovada: confira campanhas e oferta no Bunker."],"checks":{"page":true,"checkout":true,"traffic":true}}]},
         "queue":[
          {"kind":"loss","balance":{"today":{"basis":"result","value":-1231},"yesterday":{"basis":"result","value":2800},"3d":{"basis":"result","value":10000},"7d":{"basis":"result","value":10000},"with7d":{"basis":"result","value":9200},"with3d":{"basis":"result","value":8800},"verdict":"recovers"},"campaign":"05/11 - [CBO] - [TESTE] - Criativo D","account":"Conta Exemplo 01","project":"Alfa","adAccountId":"a1","campaignId":"c4","decision":"Revisar perda","period":"today","basis":"result","amount":1083,"spend":1906,"roas":0.47,"roas7d":2.5,"balance":{"today":{"basis":"result","value":-1083},"yesterday":{"basis":"result","value":1500},"3d":{"basis":"result","value":3500},"7d":{"basis":"result","value":6600},"with7d":{"basis":"result","value":5517},"with3d":{"basis":"result","value":2417},"verdict":"recovers"},"detail":\(detail("Hoje abaixo do equilíbrio; 3 e 7 dias positivos.", false))},
          {"kind":"loss","campaign":"07/11 - [CBO] - [TESTE] - Criativo C","account":"Conta Exemplo 01","project":"Alfa","adAccountId":"a1","campaignId":"c1","decision":"Revisar teste novo sem vendas","period":"today","basis":"result","amount":412,"spend":412,"roas":0,"roas7d":null,"detail":\(detail("Teste novo com gasto e sem vendas hoje. Conferir início real, checkout e filhos antes de decidir.", true))},
          {"kind":"loss","balance":{"today":{"basis":"result","value":-640},"yesterday":{"basis":"result","value":-210},"3d":null,"7d":{"basis":"result","value":-1900},"with7d":{"basis":"result","value":-2540},"with3d":null,"verdict":"negative"},"campaign":"[ABO] - [ESCALA] - Criativo A - Público amplo","account":"Conta Exemplo 02","project":"Beta","adAccountId":"a2","campaignId":"c2","decision":"Revisar perda","period":"3d","basis":"result","amount":1860,"spend":5320,"roas":0.65,"roas7d":0.78,"balance":{"today":{"basis":"result","value":-240},"yesterday":{"basis":"result","value":-610},"3d":{"basis":"result","value":-1860},"7d":{"basis":"result","value":-2900},"with7d":{"basis":"result","value":-3140},"with3d":{"basis":"result","value":-2100},"verdict":"negative"},"detail":\(detail("Abaixo do equilíbrio em 3 e 7 dias.", false))},
          {"kind":"gain","campaign":"[CBO] - [ESCALA] - Criativo B","account":"Conta Exemplo 03","project":"Gama","adAccountId":"a3","campaignId":"c3","decision":"Candidato à escala","period":"3d","basis":"result","amount":3240,"spend":4100,"roas":1.79,"roas7d":1.92,"detail":\(detail("Retorno consistente em 3 e 7 dias.", false))}
         ],"queueSize":27,"queueInfo":{"active":27,"stale":0,"staleProjects":[],"read":27,"protectedTests":2,"losses":3,"opportunities":1},
         "analysis":[{"name":"Alfa","at":"\(ago(3))","current":true},{"name":"Beta","at":"\(ago(3))","current":true},{"name":"Gama","at":"\(ago(3))","current":true}],
         "board":[
          {"id":"p1","name":"Alfa","spend":8200,"roas":1.62,"roi":1.4,"roasYesterday":1.38,"approvals":1,"losses":1,"changes":6},
          {"id":"p2","name":"Beta","spend":6400,"roas":0.94,"roi":0.81,"roasYesterday":1.21,"approvals":0,"losses":2,"changes":3},
          {"id":"p3","name":"Gama","spend":3820,"roas":1.77,"roi":1.52,"roasYesterday":1.66,"approvals":0,"losses":0,"changes":1}
         ],
         "approvals":{"count":1,"items":[{"id":"pr1","title":"Conta Exemplo 02 · Reduzir 20% · R$ 500 → R$ 400","project":"Beta","expiresAt":"\(ago(-50))"}]},
         "activity":{"hours":24,"summary":{"increase":{"count":4,"actors":{"Ana Souza":3,"Bruno Lima":1},"unknown":0},"reduce":{"count":3,"actors":{"Ana Souza":2},"unknown":1},"pause":{"count":2,"actors":{"Bruno Lima":2},"unknown":0},"activate":{"count":0,"actors":{},"unknown":0}},
           "recent":[\(change("reduce", "Ana Souza", 300, 250, -16.7, 18, "TESTE 07 · Criativo C")),\(change("increase", "Bruno Lima", 400, 480, 20, 62, "[CBO] - [ESCALA] - Criativo B")),\(change("increase", "Ana Souza", 200, 240, 20, 140, "[ABO] - Criativo D"))]},
         "agents":{"recent":[{"agent":"Lia","role":"traffic","to":"Theo","kind":"conclusion","decision":"Segurar escala do Criativo B até fechar o dia","text":"ROAS de 3 dias sustenta, mas o gasto de hoje está 40% acima do ritmo.","at":"\(ago(22))","project":"Gama"},{"agent":"Nina","role":"creative","to":null,"kind":"question","decision":null,"text":"O Criativo C trocou de gancho ontem? A retenção caiu pela metade.","at":"\(ago(75))","project":"Alfa"}]},
         "executor":{"enabled":true,"paused":false,"lastPulseAt":"\(ago(1.5))","lastError":null,"recentFailures":0},
         "autonomy":{"v":1,"at":"\(ago(2))","enabled":true,
           "projects":[{"id":"p1","name":"Alfa","mode":"confirm","exceptions":2,"pilot":null,"today":{"decisions":4,"enviaria":0,"pediria":2,"soSugestao":1,"segurada":1,"ordersCreated":0,"ordersConfirmed":0},"plays":[{"id":"pb:test-pause","label":"Pausar teste sem venda","stage":"candidata","agreement":0.74,"n":12}],"people":[{"person":"owner","name":"Você","agreement":0.68,"n":25}]},
                       {"id":"p2","name":"Beta","mode":"auto","exceptions":0,"pilot":null,"today":{"decisions":2,"enviaria":1,"pediria":0,"soSugestao":1,"segurada":0,"ordersCreated":1,"ordersConfirmed":1},"plays":[],"people":[]},
                       {"id":"p3","name":"Gama","mode":"shadow","exceptions":0,"pilot":null,"today":{"decisions":0,"enviaria":0,"pediria":0,"soSugestao":0,"segurada":0,"ordersCreated":0,"ordersConfirmed":0},"plays":[],"people":[]}],
           "campaigns":[],"island":{"observing":["Alfa","Beta","Gama"],"agreement":0.74,"n":12},"asksTotal":2,
           "asks":[{"id":"k1","at":"\(ago(9))","projectId":"p1","projectName":"Alfa","adAccountId":"a1","objectId":"c1","campaign":"07/11 - [CBO] - [TESTE] - Criativo C","action":"pause","percent":null,"ruleLabel":"Teste sem venda"},
                   {"id":"k2","at":"\(ago(31))","projectId":"p1","projectName":"Alfa","adAccountId":"a1","objectId":"c9","campaign":"[ABO] - [ESCALA] - Criativo A","action":"reduce","percent":20,"ruleLabel":"Perda no dia"}]},
         "notice":"Leitura do Bunker. Ordens suas saem só com Touch ID: o executor aplica uma vez pela Malva e confere; o resto continua no Bunker.",
         "shadow":{"day":"2026-11-07","total":5,"byRule":{"loss":{"total":3,"wouldExecute":2,"managerDid":1,"bunkerFirst":1}},"recent":[{"rule":"loss","ruleLabel":"Perda no dia","project":"Beta","account":"Conta Exemplo 02","campaign":"[ABO] - Criativo E","action":"status","reason":"x","firstAt":"\(ago(130))","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"wouldExecute":true,"blockedBy":[],"manager":{"actor":"Bruno Lima","at":"\(ago(60))","minutesAfter":70}},{"rule":"test-no-sale","ruleLabel":"Pausar campanha nova sem venda","project":"Beta","projectId":"p2","adAccountId":"a2","objectId":"c7","account":"Conta Exemplo 02","campaign":"08/11 - [CBO] - [TESTE] - Criativo F","action":"status","reason":"x","firstAt":"\(ago(40))","before":{"status":"ACTIVE"},"after":{"status":"PAUSED"},"wouldExecute":true,"blockedBy":[],"manager":null},{"rule":"morning-increase","ruleLabel":"Aumentar na virada","project":"Beta","projectId":"p2","adAccountId":"a2","objectId":"c8","account":"Conta Exemplo 02","campaign":"08/11 - [CBO] - [PRE-ESCALA]","action":"budget","reason":"x","firstAt":"\(ago(300))","before":{"dailyBudget":236.24,"currency":"USD"},"after":{"dailyBudget":354.36,"currency":"USD"},"wouldExecute":false,"blockedBy":["x"],"manager":null}]},
         "accounts":{"generatedAt":"\(ago(12))","metaConnected":true,"metaError":null,"counts":{"total":14,"active":11,"running":8,"disabled":1,"nearLimit":2,"withLimit":9},
           "rows":[{"accountId":"ac1","name":"Conta Exemplo 01","group":"Alfa","status":"active","statusLabel":"Ativa","runningLabel":"rodando","currency":"BRL","dailyLimit":2000,"todaySpend":1780,"usedPct":89,"balance":null,"alerts":["perto do limite"]},
                   {"accountId":"ac2","name":"Conta Exemplo 02","group":"Beta","status":"active","statusLabel":"Ativa","runningLabel":"rodando","currency":"USD","dailyLimit":500,"todaySpend":180,"usedPct":36,"balance":null,"alerts":[]},
                   {"accountId":"ac3","name":"Conta Exemplo 04","group":"Gama","status":"disabled","statusLabel":"Desativada","runningLabel":"parada","currency":"BRL","dailyLimit":null,"todaySpend":0,"usedPct":null,"balance":null,"alerts":["conta desativada"]}]}
        }
        """
        return json
    }
}
