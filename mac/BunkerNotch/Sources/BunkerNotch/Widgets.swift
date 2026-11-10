import SwiftUI

/// Four tiny ROAS bars, oldest window first (7d, 3d, yesterday, today partial). Height is relative to the
/// largest value; a missing window is an empty dotted slot, never a zero bar. Below 1.0 (revenue under spend)
/// the bar is red. Vocabulary from exelban/stats `Kit/Widgets` (MIT); drawn with SwiftUI shapes.
struct MiniBars: View {
    let values: [Double?]
    var height: CGFloat = 14
    var barWidth: CGFloat = 4
    static let labels = ["7d", "3d", "ontem", "hoje"]
    var body: some View {
        let top = max(values.compactMap { $0 }.filter(\.isFinite).max() ?? 0, 1)
        HStack(alignment: .bottom, spacing: barWidth / 2) {
            ForEach(Array(values.enumerated()), id: \.offset) { i, v in
                if let v, v.isFinite {
                    RoundedRectangle(cornerRadius: DS.Radius.bar, style: .continuous)
                        .fill(v >= 1 ? (i == values.count - 1 ? DS.Color.accent : DS.Color.inkSoft) : DS.Color.bad)
                        .frame(width: barWidth, height: max(2, height * CGFloat(min(v, top) / top)))
                } else {
                    RoundedRectangle(cornerRadius: DS.Radius.bar, style: .continuous)
                        .stroke(DS.Color.inkMuted, style: StrokeStyle(lineWidth: 0.8, dash: [1.5, 1.5]))
                        .frame(width: barWidth, height: height * 0.4)
                }
            }
        }
        .frame(height: height, alignment: .bottom)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ROAS: " + zip(Self.labels, values).map { "\($0) \(Format.ratio($1))" }.joined(separator: ", "))
        .help("ROAS · " + zip(Self.labels, values).map { "\($0) \(Format.ratio($1))" }.joined(separator: " · "))
    }
}

/// "Dispensar" (until the state changes) and the three snooze choices, for one attention key.
struct QuietMenu: View {
    @EnvironmentObject var store: Store
    let key: String
    /// Only queue items can be dismissed by signature; approvals and account limits are only snoozed.
    var item: Summary.QueueItem? = nil
    var compact = false
    var body: some View {
        let until = store.ledger.snoozedUntil(key), dismissed = item.map { store.ledger.isDismissed($0) } ?? false
        Menu {
            if until != nil || dismissed {
                Button("Voltar a avisar") { store.restore(key) }
                Divider()
            }
            if let item, !dismissed { Button("Dispensar até mudar") { store.dismiss(item) } }
            ForEach(AttentionLedger.Snooze.allCases, id: \.self) { choice in Button(choice.label) { store.snooze(key, choice) } }
        } label: {
            HStack(spacing: 3) {
                Image(systemName: until != nil ? "moon.zzz.fill" : dismissed ? "eye.slash" : "bell.slash").font(DS.Icon.s)
                if !compact { Text(until.map { "adiado até " + Format.clock(Format.isoFull.string(from: $0)) } ?? (dismissed ? "dispensado" : "Silenciar")).font(DS.Font.caption) }
            }
            .foregroundStyle(until != nil || dismissed ? DS.Color.inkSoft : DS.Color.inkMuted)
            .padding(.horizontal, compact ? 5 : 8).padding(.vertical, 3)
            // Never below the 20-pt macOS hit-target floor, even when it is only the bell.
            .frame(minWidth: compact ? 24 : nil, minHeight: 20)
            .background(DS.Color.surface, in: Capsule())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .help("Parar de avisar: dispensar até o estado mudar, ou adiar")
        .accessibilityLabel(until != nil ? "Adiado. Abrir opções de aviso" : dismissed ? "Dispensado. Abrir opções de aviso" : "Silenciar este aviso")
    }
}
