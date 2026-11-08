import AppKit
import SwiftUI

/// Owner choices for the adjustment sounds, saved on this Mac (UserDefaults). Picking an option plays it.
@MainActor
final class SoundSettings: ObservableObject {
    @Published var enabled = AdjustSound.enabled { didSet { AdjustSound.enabled = enabled } }
    @Published var volume = AdjustSound.volume { didSet { AdjustSound.volume = volume } }
    @Published var choice: [AdjustSound.Kind: String] = Dictionary(uniqueKeysWithValues: AdjustSound.Kind.allCases.map { ($0, AdjustSound.selected($0).id) })

    func pick(_ kind: AdjustSound.Kind, _ option: SoundOption) {
        choice[kind] = option.id; AdjustSound.select(kind, option.id)
        SoundPlayer.shared.play(option, volume: volume)
    }
    func preview(_ option: SoundOption) { SoundPlayer.shared.play(option, volume: volume) }
    func playAll() { AdjustSound.play(AdjustSound.Kind.allCases, force: true) }
    func restoreDefaults() {
        for k in AdjustSound.Kind.allCases { AdjustSound.select(k, AdjustSound.defaultID(k)); choice[k] = AdjustSound.defaultID(k) }
        volume = AdjustSound.defaultVolume; enabled = true
    }
}

struct SoundSettingsView: View {
    @ObservedObject var model: SoundSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle("Tocar som quando houver aumento, redução ou pausa", isOn: $model.enabled)
            HStack(spacing: 10) {
                Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                Slider(value: $model.volume, in: 0.1...1)
                Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                Text("\(Int((model.volume * 100).rounded()))%").monospacedDigit().frame(width: 42, alignment: .trailing)
            }
            .disabled(!model.enabled)
            HStack(alignment: .top, spacing: 14) {
                ForEach(AdjustSound.Kind.allCases, id: \.self) { kind in column(kind) }
            }
            .disabled(!model.enabled)
            Text("Segue o \"Silenciar avisos\", o silêncio em reunião e o som do Bunker em Ajustes do Sistema › Notificações. O modo Foco do macOS não cala este som: use \"Silenciar avisos\". O primeiro carregamento nunca toca; cada tipo toca uma vez por leitura, com no máximo um som por segundo. O aviso continua no notch: o som só complementa.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Ouvir os três em sequência") { model.playAll() }.disabled(!model.enabled)
                Spacer()
                Button("Restaurar padrão") { model.restoreDefaults() }
            }
        }
        .padding(18)
        .frame(width: 720)
    }

    private func column(_ kind: AdjustSound.Kind) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(AdjustSound.label(kind), systemImage: AdjustSound.symbol(kind)).font(.headline)
            Text(AdjustSound.hint(kind)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(AdjustSound.options(kind)) { option in
                let chosen = model.choice[kind] == option.id
                HStack(spacing: 6) {
                    Button { model.pick(kind, option) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: chosen ? "largecircle.fill.circle" : "circle").foregroundStyle(chosen ? Color.accentColor : .secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.label + (option.id == AdjustSound.defaultID(kind) ? " · padrão" : ""))
                                Text(option.detail).font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(AdjustSound.label(kind) + ": " + option.label + (chosen ? ", escolhido" : ""))
                    if option.source != .silent {
                        Button { model.preview(option) } label: { Image(systemName: "play.circle") }
                            .buttonStyle(.borderless).help("Ouvir " + option.label)
                    }
                }
                .padding(.vertical, 3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// The settings window: one instance, brought to the front when opened again from the menu.
@MainActor
final class SoundSettingsWindow {
    static let shared = SoundSettingsWindow()
    private var window: NSWindow?

    func show() {
        if window == nil {
            let w = NSWindow(contentViewController: NSHostingController(rootView: SoundSettingsView(model: SoundSettings())))
            w.title = "Configurações de som · Bunker"
            w.styleMask = [.titled, .closable, .miniaturizable]
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}

/// `BunkerNotch --render-sound-settings file.png`: draws the settings window off-screen (visual check, no sound).
enum SoundSettingsPreview {
    @MainActor static func render(to path: String) -> Int32 {
        let host = NSHostingView(rootView: SoundSettingsView(model: SoundSettings()).background(Color(nsColor: .windowBackgroundColor)))
        let size = host.fittingSize
        host.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: CGRect(x: -4000, y: -4000, width: size.width, height: size.height), styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host; window.orderFrontRegardless(); host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return 1 }
        host.cacheDisplay(in: host.bounds, to: rep); window.orderOut(nil)
        guard let png = rep.representation(using: .png, properties: [:]) else { return 1 }
        return (try? png.write(to: URL(fileURLWithPath: path))) != nil ? 0 : 1
    }
}
