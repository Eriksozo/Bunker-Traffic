import AppKit
import SwiftUI

/// Native owner adjustment inside the island, confirmed with Touch ID on this Mac.
/// Same rules as the web card: a choice asks the team for an exact proposal; only a proposal
/// the agents already reviewed can be approved, and the Cloudflare executor applies it via Malva.
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
                    Text("Confirmação com Touch ID · executa só proposta exata revisada").font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
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
                            SectionHeader(title: "Aguardando você", detail: "\(data.approvals.count) proposta(s) exata(s) revisada(s) pela equipe")
                            ForEach(data.approvals) { p in approvalCard(p, revision: data.revision) }
                        } else if target.campaignId == nil {
                            EmptyLine(text: "Nenhuma proposta aguardando sua aprovação.")
                        }
                        if target.campaignId != nil {
                            if let card = data.cards.first { decision(card, revision: data.revision) }
                            else { EmptyLine(text: "Campanha fora dos cards atuais (aquecimento, outro provedor ou sem leitura de hoje).") }
                        }
                    } else if m.loading {
                        HStack(spacing: DS.Space.s) { ProgressView().controlSize(.small); Text("Lendo os cards…").font(DS.Font.body).foregroundStyle(DS.Color.inkMuted) }
                    }
                }.padding(.bottom, DS.Space.l)
            }
        }
        .task(id: target) { m.reset(for: target); await load() }
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
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            HStack(spacing: DS.Space.xs) {
                Text(p.campaign ?? p.title ?? "Proposta").font(DS.Font.bodyStrong).lineLimit(1).truncationMode(.middle)
                Spacer()
                if let name = p.projectName { Pill(text: name, tone: .accent) }
            }
            Text((p.account.map { $0 + " · " } ?? "") + "v\(p.version) · vence " + Format.stamp(p.expiresAt)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            Text(OwnerAdjust.change(p)).font(DS.Font.number).foregroundStyle(p.after.status == "PAUSED" || (p.after.dailyBudget ?? 0) < (p.before.dailyBudget ?? 0) ? DS.Color.bad : DS.Color.good)
            if let r = p.reason { Text(r).font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(3).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: DS.Space.s) {
                Button { Task { await review(p, revision: revision, decision: "approve") } } label: {
                    Label("Aprovar com Touch ID", systemImage: "touchid").font(DS.Font.bodyStrong)
                        .padding(.horizontal, 10).padding(.vertical, 5).foregroundStyle(.black.opacity(0.85)).background(DS.Color.accent, in: Capsule())
                }.buttonStyle(.plain).disabled(m.busy || p.expired == true || revision == nil)
                Button("Pedir revisão") { Task { await review(p, revision: revision, decision: "revise") } }.controlSize(.small).disabled(m.busy || revision == nil)
                Button("Recusar") { Task { await review(p, revision: revision, decision: "reject") } }.controlSize(.small).disabled(m.busy || revision == nil)
            }
            Text("Aprovar autoriza só este valor. O executor Cloudflare confere o valor atual, envia uma vez pelo Malva e relê.").font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted)
        }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
    }

    func decision(_ card: OwnerCards.Card, revision: Int?) -> some View {
        let percent = Double(m.percentText.replacingOccurrences(of: ",", with: "."))
        let needsPercent = m.action == "increase" || m.action == "reduce"
        let preview = OwnerAdjust.newBudget(card.dailyBudget, action: m.action, percent: percent)
        let canSend = !m.busy && revision != nil && !m.action.isEmpty && OwnerAdjust.allowed(card.intentActions, m.action) && OwnerAdjust.validPercent(m.action, percent)
        return VStack(alignment: .leading, spacing: DS.Space.s) {
            SectionHeader(title: "Sua decisão", detail: (card.account ?? "") + " · " + Format.statusName(card.status) + " · diário " + Format.money(card.dailyBudget, currency: card.currency))
            if let s = card.suggestion {
                Text(OwnerAdjust.suggestionLine(s))
                    .font(DS.Font.caption).foregroundStyle(DS.Color.inkSoft).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
            if let last = card.lastChoice {
                Banner(text: OwnerAdjust.lastChoiceLine(last) + (last.canReportApplied != nil ? ". Se já fez no Gerenciador, escolha a mesma ação e toque em \"Já fiz\"." : last.reopenable == true ? "" : ". Para decidir de novo, use Rever cenário no Histórico do Bunker."),
                       tone: last.verification == "Divergente" ? .bad : last.verification == "Conferida" ? .good : .neutral)
            }
            HStack(spacing: DS.Space.xs) {
                ForEach(OwnerAdjust.choices, id: \.self) { a in
                    let ok = OwnerAdjust.allowed(card.intentActions, a)
                    Button { m.action = a } label: {
                        Text(OwnerAdjust.label(a)).font(DS.Font.bodyStrong).frame(maxWidth: .infinity).padding(.vertical, 6)
                            .foregroundStyle(ok ? (m.action == a ? Color.black.opacity(0.85) : DS.Color.ink) : DS.Color.inkMuted)
                            .background(m.action == a ? DS.Color.accent : DS.Color.surface, in: RoundedRectangle(cornerRadius: DS.Radius.s, style: .continuous))
                    }.buttonStyle(.plain).disabled(!ok || m.busy)
                }
            }
            if needsPercent {
                HStack(spacing: DS.Space.s) {
                    TextField("%", text: $m.percentText).textFieldStyle(.roundedBorder).controlSize(.small).frame(width: 60)
                    Text("%").font(DS.Font.body)
                    ForEach(["10", "20", "30", "50"], id: \.self) { v in Button(v + "%") { m.percentText = v }.controlSize(.small) }
                    Spacer()
                    Text(Format.money(card.dailyBudget, currency: card.currency) + " → " + Format.money(preview, currency: card.currency)).font(DS.Font.number)
                        .foregroundStyle(m.action == "increase" ? DS.Color.good : DS.Color.bad)
                }
                if !OwnerAdjust.validPercent(m.action, percent) { Text("Aumento até 1000%; redução acima de 0 e abaixo de 100%.").font(DS.Font.caption).foregroundStyle(DS.Color.bad) }
            }
            TextField("Motivo (opcional)", text: $m.reason).textFieldStyle(.roundedBorder).controlSize(.small)
            HStack(spacing: DS.Space.s) {
                Button { Task { await sendIntent(card, revision: revision, percent: needsPercent ? percent : nil) } } label: {
                    Label(m.action == "keep" ? "Registrar manter (Touch ID)" : "Pedir à equipe (Touch ID)", systemImage: "touchid").font(DS.Font.bodyStrong)
                        .padding(.horizontal, 10).padding(.vertical, 5).foregroundStyle(.black.opacity(0.85)).background(canSend ? DS.Color.accent : DS.Color.inkMuted, in: Capsule())
                }.buttonStyle(.plain).disabled(!canSend || !OwnerAdjust.canDecide(card))
                let canApplied = canSend && OwnerAdjust.canReportApplied(card, action: m.action)
                Button { Task { await sendApplied(card, revision: revision, percent: needsPercent ? percent : nil) } } label: {
                    Label("Já fiz no Gerenciador (Touch ID)", systemImage: "checkmark.circle").font(DS.Font.bodyStrong)
                        .padding(.horizontal, 10).padding(.vertical, 5).foregroundStyle(canApplied ? DS.Color.ink : DS.Color.inkMuted)
                        .background(DS.Color.surface, in: Capsule()).overlay(Capsule().stroke(canApplied ? DS.Color.accent : DS.Color.stroke))
                }.buttonStyle(.plain).disabled(!canApplied).help("Avise que você já fez esta ação no Gerenciador da Meta. O Bunker registra e confere na próxima leitura do Malva.")
                if m.busy { ProgressView().controlSize(.small) }
            }
            Text("\"Pedir à equipe\" vira pedido para os agentes prepararem a proposta exata, que volta aqui em \"Aguardando você\". \"Já fiz no Gerenciador\" só registra o que você fez na Meta; o Bunker confere na próxima leitura do Malva. Nenhum dos dois altera a Meta.")
                .font(.system(size: 9.5)).foregroundStyle(DS.Color.inkMuted).fixedSize(horizontal: false, vertical: true)
            if !card.blockedReasons.isEmpty {
                Text("Para executar depois: " + card.blockedReasons.prefix(3).joined(separator: " ")).font(.system(size: 9.5)).foregroundStyle(DS.Color.warn).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(DS.Space.m).frame(maxWidth: .infinity, alignment: .leading).card()
    }

    // MARK: Actions

    func load() async {
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
                     success: decision == "approve" ? "Aprovado. O executor Cloudflare aplica pelo Malva e confere; acompanhe em Atividade." : decision == "reject" ? "Proposta recusada." : "Revisão pedida à equipe.")
    }

    private func submit(_ input: [String: Any], prompt: String, key: String, success: String) async {
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
    /// One clientId per exact request, so a retry of the same decision cannot count twice.
    var requestIds: [String: String] = [:]
    private var target: AdjustTarget?
    /// A new campaign starts clean; reopening the same one keeps the draft.
    func reset(for next: AdjustTarget) {
        guard next != target else { return }
        target = next; data = nil; loadError = nil; action = ""; percentText = "20"; reason = ""; notice = nil; requestIds = [:]
    }
}
