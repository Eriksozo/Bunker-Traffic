import AppKit
import SwiftUI

/// Native owner adjustment inside the island, confirmed with Touch ID on this Mac.
/// "Executar agora" is the owner's direct order (decided 2026-11-07): an exact change that the Cloudflare
/// executor applies once via Malva, checking the current value before and rereading after. "Pedir à equipe"
/// asks the agents for a proposal; "Já fiz no Gerenciador" only records a change made in Meta.
struct OwnerAdjustView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var notch: NotchState
    let target: AdjustTarget
    @ObservedObject var m: OwnerAdjustModel

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            HStack(spacing: DS.Space.s) {
                IconButton(symbol: "chevron.left", help: "Voltar (Esc)") { withAnimation(DS.Motion.quick) { notch.adjust = nil } }
                VStack(alignment: .leading, spacing: 1) {
                    Text(target.campaignId == nil ? "Aprovar propostas" : (target.name ?? "Ajustar campanha")).font(DS.Font.bodyStrong).lineLimit(1).truncationMode(.middle)
                    Text(target.campaignId == nil ? "Propostas revisadas pela equipe · aprovar com Touch ID" : "Sua ordem com Touch ID · o executor aplica uma vez pela Malva e confere").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                }
                Pill(text: "Touch ID", tone: .accent, icon: "touchid")
                Spacer()
                IconButton(symbol: "arrow.clockwise", help: "Recarregar", spinning: m.loading) { Task { await load() } }
            }
            if let unregistered = m.unregistered { registration(unregistered) }
            if let notice = m.notice { Banner(text: notice.0, tone: notice.1) }
            if let loadError = m.loadError { Banner(text: loadError, tone: .bad) }
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: DS.Space.m) {
                    if let data = m.data {
                        if data.paused { Banner(text: "Escritório pausado: retome no Bunker para decidir.", tone: .warn) }
                        if !data.approvals.isEmpty {
                            SectionHeader(title: "Aguardando você", detail: Format.count(data.approvals.count, "proposta exata revisada", "propostas exatas revisadas") + " pela equipe")
                            ForEach(data.approvals) { p in approvalCard(p, revision: data.revision) }
                        } else if target.campaignId == nil {
                            EmptyLine(text: "Nenhuma proposta aguardando sua aprovação.")
                        }
                        if target.campaignId != nil {
                            if data.cards.first != nil || data.directOrder != nil { decision(data.cards.first, direct: data.directOrder, revision: data.revision) }
                            else { EmptyLine(text: "Campanha sem leitura de hoje no Bunker (aquecimento, outro provedor ou fora dos projetos).") }
                        }
                    } else if m.loading {
                        HStack(spacing: DS.Space.s) { ProgressView().controlSize(.small); Text("Lendo os cards…").font(DS.Font.body).foregroundStyle(DS.Color.inkMuted) }
                    }
                }.padding(.bottom, DS.Space.l)
            }
        }
        .task(id: target) { if !m.preview { m.reset(for: target) }; await load() }
        // The reload right after "Executar" comes before the executor confirms: read again when an order is confirmed,
        // so the status pill and the blockers show the campaign as it is now (e.g. Pausada).
        .onChange(of: (store.summary?.orders ?? []).filter { $0.stage == "confirmed" }.map(\.id)) { _, _ in if !m.preview { Task { await load() } } }
    }

    // MARK: Sections

    func registration(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(message).font(DS.Font.bodyStrong)
            Text("A chave deste Mac fica no chip seguro e só assina com sua digital. Para liberar, o Bunker precisa da parte pública, salva em ~/.config/bunker-traffic/owner-device-public-key. Peça ao Claude: \"registre a chave do Mac no Bunker\".")
                .font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).fixedSize(horizontal: false, vertical: true)
            Button("Copiar chave pública") {
                if let key = try? OwnerKey.ensure() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(OwnerKey.publicKeyBase64(key), forType: .string) }
            }.controlSize(.small)
        }.padding(DS.Space.s).frame(maxWidth: .infinity, alignment: .leading).card()
    }

    func approvalCard(_ p: OwnerCards.Proposal, revision: Int?) -> some View {
        let down = p.after.status == "PAUSED" || (p.after.dailyBudget ?? 0) < (p.before.dailyBudget ?? 0)
        return VStack(alignment: .leading, spacing: DS.Space.s) {
            HStack(spacing: DS.Space.s) {
                IconBadge(symbol: p.action == "status" ? "pause.fill" : down ? "arrow.down.right" : "arrow.up.right", tone: down ? .bad : .good)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.campaign ?? p.title ?? "Proposta").font(DS.Font.bodyStrong).lineLimit(1).truncationMode(.middle)
                    HStack(spacing: DS.Space.xs) {
                        if let name = p.projectName { Pill(text: name, tone: .tag) }
                        Text((p.account.map { $0 + " · " } ?? "") + "v\(p.version) · vence " + Format.stamp(p.expiresAt)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            Text(OwnerAdjust.change(p)).font(DS.Font.stat).foregroundStyle(down ? DS.Color.bad : DS.Color.good).lineLimit(1).minimumScaleFactor(0.7)
            if let r = p.reason { Text(r).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(3).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: DS.Space.s) {
                ActionButton(title: "Aprovar e executar", icon: "touchid", leadingIcon: true, prominent: true, help: "Autoriza só este valor. O executor confere o valor atual, envia uma vez pela Malva e relê.") {
                    Task { await review(p, revision: revision, decision: "approve") }
                }.disabled(m.busy || p.expired == true || revision == nil).opacity(m.busy || p.expired == true || revision == nil ? 0.5 : 1)
                ActionButton(title: "Pedir revisão", help: "Devolve à equipe com seu pedido de revisão") { Task { await review(p, revision: revision, decision: "revise") } }.disabled(m.busy || revision == nil)
                ActionButton(title: "Recusar", help: "Encerra esta proposta") { Task { await review(p, revision: revision, decision: "reject") } }.disabled(m.busy || revision == nil)
                Spacer(minLength: 0)
                if m.busy { ProgressView().controlSize(.small) }
            }
        }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
    }

    /// The four periods at a glance: ROAS large, spend under it; missing stays N/D.
    func periodsStrip(_ card: OwnerCards.Card) -> some View {
        HStack(spacing: DS.Space.xs) {
            ForEach([("today", "Hoje"), ("yesterday", "Ontem"), ("3d", "3 dias"), ("7d", "7 dias")], id: \.0) { key, label in
                let w = card.windows[key] ?? nil
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                    Text(Format.ratio(w?.roas)).font(DS.Font.number).foregroundStyle(w?.roas == nil ? DS.Color.inkMuted : (w?.roas ?? 0) >= 1 ? DS.Color.ink : DS.Color.bad)
                    Text("gasto " + Format.compactMoney(w?.spend) + " · front " + (w?.frontOrders.map { String(Int($0)) } ?? "N/D")).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).lineLimit(1).minimumScaleFactor(0.8)
                }
                .padding(.horizontal, DS.Space.s).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
                .background(DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
            }
        }
        .help("ROAS por janela (hoje é parcial). Gasto na moeda do projeto.")
    }

    /// The owner's decision on one campaign. "Executar agora" is the direct order (live Malva value, Touch ID, executor
    /// via Malva) and works even when the campaign has no analysis card; "Pedir à equipe" and "Já fiz" need the card.
    func decision(_ card: OwnerCards.Card?, direct: OwnerCards.DirectOrder?, revision: Int?) -> some View {
        let percent = OwnerAdjust.parsePercent(m.percentText)
        let needsPercent = m.action == "increase" || m.action == "reduce"
        let budget = direct?.budget ?? card?.orderBudget, status = direct?.status ?? card?.orderStatus, currency = direct?.currency ?? card?.currency
        let preview = OwnerAdjust.newBudget(budget, action: m.action, percent: percent)
        let percentProblem = OwnerAdjust.percentProblem(m.action, percent, current: budget)
        let validInput = !m.busy && !m.action.isEmpty && OwnerAdjust.validPercent(m.action, percent) && percentProblem == nil
        // Older server without the direct order: keep the card-based order.
        let legacy = direct == nil && card != nil
        let canOrder = validInput && (legacy ? revision != nil && OwnerAdjust.canOrder(card!, action: m.action) : OwnerAdjust.canDirectOrder(direct, action: m.action))
        let canAsk = validInput && revision != nil && card.map { OwnerAdjust.allowed($0.intentActions, m.action) && OwnerAdjust.canDecide($0) } == true
        let canApplied = validInput && revision != nil && card.map { OwnerAdjust.allowed($0.intentActions, m.action) && OwnerAdjust.canReportApplied($0, action: m.action) } == true
        let blockers = direct?.blockers ?? card.map { $0.orderBlockers ?? $0.blockedReasons.filter { !OwnerAdjust.advisory($0) } } ?? []
        let info = card?.blockedReasons.filter(OwnerAdjust.advisory) ?? []
        let tone: Tone = m.action == "increase" ? .good : m.action == "keep" || m.action.isEmpty ? .neutral : .bad
        let choices = card == nil ? OwnerAdjust.choices.filter { $0 != "keep" } : OwnerAdjust.choices
        return VStack(alignment: .leading, spacing: DS.Space.m) {
            // Context: where this campaign stands now.
            HStack(spacing: DS.Space.xs) {
                if let card { Pill(text: card.projectName ?? card.project, tone: .tag) }
                if let a = card?.account ?? direct?.account { Pill(text: a, tone: .tag) }
                Pill(text: Format.statusName(status), tone: status == "ACTIVE" ? .good : .neutral)
                Text("diário " + Format.money(budget, currency: currency)).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft)
                Spacer(minLength: 0)
                if let s = direct?.source {
                    Label("valor ao vivo de " + Format.clock(s.at), systemImage: "dot.radiowaves.left.and.right").font(DS.Font.micro).foregroundStyle(DS.Color.good)
                        .help("Valor lido da Malva há poucos minutos. O executor confere de novo na Malva antes de enviar.")
                } else if let card, let line = OwnerAdjust.sourceLine(card) {
                    Label(line, systemImage: card.orderSource?.kind == "live" ? "dot.radiowaves.left.and.right" : "clock").font(DS.Font.micro)
                        .foregroundStyle(card.orderSource?.kind == "live" ? DS.Color.good : DS.Color.inkMuted)
                }
            }
            if let card {
                periodsStrip(card)
                if let s = card.suggestion {
                    HStack(alignment: .top, spacing: DS.Space.s) {
                        Image(systemName: s.origin == "diagnostic" ? "stethoscope" : "person.3.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(DS.Color.inkMuted).frame(width: 14)
                        Text(OwnerAdjust.suggestionLine(s)).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let last = card.lastChoice {
                    Banner(text: OwnerAdjust.lastChoiceLine(last) + ". Você pode executar agora mesmo assim.", tone: last.verification == "Divergente" ? .bad : last.verification == "Conferida" ? .good : .neutral)
                }
            } else {
                Text("Campanha fora da última análise: só a ordem direta está disponível.").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            }
            // 1 · What to do.
            VStack(alignment: .leading, spacing: DS.Space.s) {
                Text("O que fazer").font(DS.Font.eyebrow).foregroundStyle(DS.Color.inkSoft)
                HStack(spacing: DS.Space.xs) {
                    ForEach(choices, id: \.self) { a in
                        let ok = a == "keep" ? card.map { OwnerAdjust.allowed($0.intentActions, a) } == true
                            : (direct.map { OwnerAdjust.allowed($0.actions, a) } == true || card.map { OwnerAdjust.allowed($0.intentActions, a) } == true)
                        let selected = m.action == a
                        Button { withAnimation(DS.Motion.quick) { m.action = a } } label: {
                            HStack(spacing: 5) {
                                Image(systemName: OwnerAdjust.symbols[a] ?? "circle").font(.system(size: 10, weight: .bold))
                                Text(OwnerAdjust.label(a)).font(DS.Font.bodyStrong)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 7)
                            .foregroundStyle(!ok ? DS.Color.inkMuted : selected ? Color.black.opacity(0.85) : DS.Color.ink)
                            .background(selected ? DS.Color.accent : DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous).stroke(selected ? Color.clear : DS.Color.stroke))
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(!ok || m.busy).help(ok ? OwnerAdjust.label(a) : "Indisponível com a leitura atual desta campanha")
                    }
                }
                if needsPercent {
                    HStack(spacing: DS.Space.s) {
                        ForEach(["10", "20", "30", "50"], id: \.self) { v in
                            let on = m.percentText == v
                            Button { m.percentText = v } label: {
                                Text(v + "%").font(DS.Font.caption).monospacedDigit().padding(.horizontal, 8).padding(.vertical, 4)
                                    .foregroundStyle(on ? DS.Color.ink : DS.Color.inkSoft)
                                    .background(on ? DS.Color.surfaceSelected : DS.Color.surface, in: Capsule())
                            }.buttonStyle(.plain)
                        }
                        TextField("%", text: $m.percentText).textFieldStyle(.island).monospacedDigit().frame(width: 54)
                        Text("%").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                        Spacer(minLength: 0)
                    }
                    if let problem = percentProblem { Text(problem).font(DS.Font.caption).foregroundStyle(DS.Color.bad) }
                }
            }
            // 2 · Exactly what changes (the same line Touch ID shows).
            if !m.action.isEmpty && m.action != "keep" {
                HStack(spacing: DS.Space.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Muda na Meta").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                        if m.action == "pause" {
                            Text(Format.statusName(status) + " → pausada").font(DS.Font.stat).foregroundStyle(DS.Color.bad)
                        } else {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(Format.money(budget, currency: currency)).font(DS.Font.number).foregroundStyle(DS.Color.inkMuted).strikethrough()
                                Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(DS.Color.inkMuted)
                                Text(Format.money(preview, currency: currency)).font(DS.Font.stat).foregroundStyle(tone.color)
                                Text("/dia").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    if let b = budget, let a = preview, m.action != "pause" {
                        Pill(text: (a >= b ? "+" : "−") + Format.money(abs(a - b), currency: currency) + "/dia", tone: tone)
                    }
                }
                .padding(DS.Space.m)
                .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: DS.Radius.m, style: .continuous).stroke(tone.color.opacity(0.25)))
            }
            TextField("Motivo (opcional)", text: $m.reason).textFieldStyle(.island)
            // 3 · One primary action: execute when it can run now; otherwise ask the team.
            HStack(spacing: DS.Space.s) {
                if m.action == "keep", let card {
                    ActionButton(title: "Registrar manter", icon: "touchid", leadingIcon: true, prominent: true, help: "Registra sua decisão de manter (Touch ID). Não altera a Meta.") {
                        Task { await sendIntent(card, revision: revision, percent: nil) }
                    }.disabled(!canAsk).opacity(canAsk ? 1 : 0.5)
                } else {
                    ActionButton(title: "Executar agora", icon: "touchid", leadingIcon: true, prominent: canOrder, help: canOrder ? "Touch ID autoriza este valor exato. O executor Cloudflare confere o valor atual na Malva, envia uma vez pela Malva e relê." : "Execução direta indisponível agora: veja o motivo abaixo.") {
                        Task {
                            if let direct { await sendDirect(direct, percent: needsPercent ? percent : nil) }
                            else if let card { await sendOrder(card, revision: revision, percent: needsPercent ? percent : nil) }
                        }
                    }.disabled(!canOrder).opacity(canOrder ? 1 : 0.45)
                    if let card {
                        ActionButton(title: "Pedir à equipe", icon: "person.3", leadingIcon: true, prominent: !canOrder && canAsk, help: "Os agentes preparam a proposta exata, que volta em \"Aguardando você\". Não altera a Meta agora.") {
                            Task { await sendIntent(card, revision: revision, percent: needsPercent ? percent : nil) }
                        }.disabled(!canAsk).opacity(canAsk ? 1 : 0.45)
                    }
                }
                Spacer(minLength: 0)
                if m.busy { ProgressView().controlSize(.small) }
                if m.action != "keep", let card {
                    Button { Task { await sendApplied(card, revision: revision, percent: needsPercent ? percent : nil) } } label: {
                        Label("Já fiz no Gerenciador", systemImage: "checkmark.circle").font(DS.Font.caption)
                            .foregroundStyle(canApplied ? DS.Color.inkSoft : DS.Color.inkMuted)
                    }.buttonStyle(.plain).disabled(!canApplied).help("Avise que você já fez esta ação no Gerenciador da Meta (Touch ID). O Bunker registra e confere na próxima leitura do Malva; nada é enviado à Meta.")
                }
            }
            // Why it cannot run now (blocking), and what is only informative.
            if m.action != "keep" && !m.action.isEmpty && !blockers.isEmpty && !canOrder {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Para executar agora falta:", systemImage: "exclamationmark.triangle.fill").font(DS.Font.microStrong).foregroundStyle(DS.Color.warn)
                    ForEach(blockers.prefix(4), id: \.self) { b in Text("• " + b).font(DS.Font.micro).foregroundStyle(DS.Color.inkSoft).fixedSize(horizontal: false, vertical: true) }
                }
                .padding(DS.Space.s).frame(maxWidth: .infinity, alignment: .leading)
                .background(DS.Color.warn.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
            }
            if !info.isEmpty {
                Text("Informativo (não trava sua ordem): " + info.joined(separator: " ")).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
    }

    // MARK: Actions

    func load() async {
        if m.preview { return }   // `--render-notch`: fictional cards, no network
        m.loading = true; defer { m.loading = false }
        switch await store.fetchCards(target) {
        case .ok(let next): m.data = next; m.loadError = nil
            if m.action.isEmpty, let card = next.cards.first, let s = card.suggestion, s.action != "keep", OwnerAdjust.allowed(card.intentActions, s.action) {
                m.action = s.action; if let p = s.percent { m.percentText = Format.percent(p, signed: false).replacingOccurrences(of: "%", with: "") }
            }
        case .failed(let message): m.loadError = message
        }
    }

    private func clientId(_ key: String) -> String {
        if let id = m.requestIds[key] { return id }
        let id = OwnerAdjust.clientId(); m.requestIds[key] = id; return id
    }

    func sendIntent(_ card: OwnerCards.Card, revision: Int?, percent: Double?) async {
        guard let revision else { return }
        let key = [card.id, card.signature, m.action, percent.map { String($0) } ?? "", m.reason].joined(separator: "|")
        let input = OwnerAdjust.intent(card: card, revision: revision, action: m.action, percent: percent, reason: m.reason, clientId: clientId(key))
        let what = OwnerAdjust.label(m.action) + (percent.map { " " + Format.percent($0, signed: false) } ?? "")
        await submit(input, prompt: "registrar \(what) em \(card.campaign ?? "campanha") (\(card.account ?? card.adAccountId))", key: key,
                     success: m.action == "keep" ? "Decisão de manter registrada." : "Pedido registrado. A equipe vai conferir e preparar a proposta exata; nada foi alterado na Meta.")
    }

    func sendOrder(_ card: OwnerCards.Card, revision: Int?, percent: Double?) async {
        guard let revision else { return }
        let key = ["order", card.id, card.signature, m.action, percent.map { String($0) } ?? "", card.orderBudget.map { String($0) } ?? "", card.orderStatus ?? "", m.reason].joined(separator: "|")
        let input = OwnerAdjust.order(card: card, revision: revision, action: m.action, percent: percent, reason: m.reason, clientId: clientId(key))
        let line = OwnerAdjust.orderLine(card, action: m.action, percent: percent)
        await submit(input, prompt: "executar \(line) em \(card.campaign ?? "campanha") (\(card.account ?? card.adAccountId))", key: key,
                     success: "Ordem autorizada: \(line). O executor aplica uma vez pela Malva em instantes e confere; o recibo aparece em Agora › Suas ordens.")
    }

    func sendDirect(_ d: OwnerCards.DirectOrder, percent: Double?) async {
        let key = ["direct", d.project, d.adAccountId, d.objectId, m.action, percent.map { String($0) } ?? "", d.budget.map { String($0) } ?? "", d.status ?? "", m.reason].joined(separator: "|")
        let input = OwnerAdjust.directOrder(d, action: m.action, percent: percent, reason: m.reason, clientId: clientId(key))
        let line = OwnerAdjust.directLine(d, action: m.action, percent: percent)
        await submit(input, prompt: "executar \(line) em \(d.campaign ?? target.name ?? "campanha") (\(d.account ?? d.adAccountId))", key: key,
                     success: "Ordem enviada ao executor: \(line). Ele confere o valor na Malva, aplica uma vez e relê; o recibo aparece em Agora › Suas ordens.")
    }

    func sendApplied(_ card: OwnerCards.Card, revision: Int?, percent: Double?) async {
        guard let revision else { return }
        let key = ["applied", card.id, card.signature, m.action, percent.map { String($0) } ?? "", m.reason].joined(separator: "|")
        let input = OwnerAdjust.applied(card: card, revision: revision, action: m.action, percent: percent, reason: m.reason, clientId: clientId(key))
        let what = OwnerAdjust.label(m.action) + (percent.map { " " + Format.percent($0, signed: false) } ?? "")
        await submit(input, prompt: "informar que já fez \(what) em \(card.campaign ?? "campanha") (\(card.account ?? card.adAccountId))", key: key,
                     success: "Registrado: você já fez \(what) no Gerenciador. O Bunker confere na próxima leitura do Malva.")
    }

    func review(_ p: OwnerCards.Proposal, revision: Int?, decision: String) async {
        guard let revision else { return }
        let comment = decision == "approve" ? nil : decision == "reject" ? "Recusada pelo dono no notch." : "Revisão pedida pelo dono no notch."
        let key = [p.id, String(p.version), p.signature, decision].joined(separator: "|")
        let input = OwnerAdjust.review(p, revision: revision, decision: decision, comment: comment, clientId: clientId(key))
        let verb = ["approve": "aprovar", "reject": "recusar", "revise": "pedir revisão de"][decision] ?? decision
        await submit(input, prompt: "\(verb): \(p.campaign ?? "campanha") · \(OwnerAdjust.change(p))", key: key,
                     success: decision == "approve" ? "Aprovado. O executor Cloudflare aplica uma vez pela Malva e confere o resultado." : decision == "reject" ? "Proposta recusada." : "Revisão pedida à equipe.")
    }

    private func submit(_ input: [String: Any], prompt: String, key: String, success: String) async {
        // A second click before the first redraw would ask Touch ID twice (the server already dedupes by clientId).
        guard !m.busy else { return }
        m.busy = true; notch.holdOpen = true; m.notice = nil
        let result = await store.sendOwner(input, reason: prompt)
        notch.holdOpen = false; m.busy = false
        switch result {
        case .done: m.notice = (success, .good); m.unregistered = nil; m.requestIds[key] = nil; m.reason = ""
        case .cancelled: m.notice = ("Touch ID cancelado. Nada foi enviado.", .neutral)
        case .unregistered(let msg): m.unregistered = msg; m.requestIds[key] = nil
        case .refused(let msg): m.notice = (msg, .bad)
        }
        await load()
    }
}

/// View state for OwnerAdjustView (kept in NotchState: this toolchain has no SwiftUI @State macro).
@MainActor
final class OwnerAdjustModel: ObservableObject {
    @Published var data: OwnerCards?
    @Published var loadError: String?
    @Published var loading = false
    @Published var action = ""
    @Published var percentText = "20"
    @Published var reason = ""
    @Published var busy = false
    @Published var notice: (String, Tone)?
    @Published var unregistered: String?
    /// Design review only (`--render-notch`): keeps the injected cards and skips the network.
    var preview = false
    /// One clientId per exact request, so a retry of the same decision cannot count twice.
    var requestIds: [String: String] = [:]
    private var target: AdjustTarget?
    /// A new campaign starts clean; reopening the same one keeps the draft.
    func reset(for next: AdjustTarget) {
        guard next != target else { return }
        target = next; data = nil; loadError = nil; action = ""; percentText = "20"; reason = ""; notice = nil; requestIds = [:]
    }
}
