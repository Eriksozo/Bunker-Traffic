import AppKit
import Combine
import ServiceManagement
import SwiftUI

@main
enum BunkerNotchMain {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") { exit(SelfTest.run()) }
        if let i = CommandLine.arguments.firstIndex(of: "--render-notch"), i + 1 < CommandLine.arguments.count { exit(NotchPreview.render(to: CommandLine.arguments[i + 1])) }
        if let i = CommandLine.arguments.firstIndex(of: "--render-bunk"), i + 1 < CommandLine.arguments.count { exit(BunkSheet.render(to: CommandLine.arguments[i + 1])) }
        if let i = CommandLine.arguments.firstIndex(of: "--dump-preview"), i + 1 < CommandLine.arguments.count {
            exit(FileManager.default.createFile(atPath: CommandLine.arguments[i + 1], contents: Data(NotchPreview.fixtureJSON().utf8)) ? 0 : 1)
        }
        // Contract check: decode summary files written by lib/companion-summary.mjs (no network, no credential).
        if let i = CommandLine.arguments.firstIndex(of: "--decode-summary"), i + 1 < CommandLine.arguments.count { exit(SummaryContract.check(Array(CommandLine.arguments[(i + 1)...]))) }
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let store = Store()
    private var notch: NotchController?
    private var bunk: BunkDesktopController?
    private var statusItem: NSStatusItem!
    private var bag = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "square.stack.3d.up.fill", accessibilityDescription: "Bunk")
        statusItem.button?.imagePosition = .imageLeading
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        _ = CallWatch.shared
        notch = NotchController(store: store)
        if let notch { bunk = BunkDesktopController(store: store, notch: notch) }
        store.$summary.combineLatest(store.$error).receive(on: RunLoop.main).sink { [weak self] _ in self?.updateTitle() }.store(in: &bag)
        store.start()
    }

    private func updateTitle() {
        let n = store.attention
        let title = store.error != nil ? " !" : n > 0 ? " \(n)" : ""
        let tip = store.error ?? (n == 0 ? "Bunk · nada pede atenção" : "Bunk · " + Format.count(n, "item pede", "itens pedem") + " atenção")
        // Writing the same title still relayouts the menu bar item.
        if statusItem.button?.title != title { statusItem.button?.title = title }
        if statusItem.button?.toolTip != tip { statusItem.button?.toolTip = tip }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let s = store.summary
        func info(_ text: String) { let i = NSMenuItem(title: text, action: nil, keyEquivalent: ""); i.isEnabled = false; menu.addItem(i) }
        if let error = store.error { info("⚠︎ " + error) }
        if let s {
            info("\(s.projectName) · ROAS hoje \(Format.ratio(s.today.today?.roas)) · ROI \(Format.ratio(s.today.today?.roi))")
            info("\(s.approvals.count) aguardando você · \(s.queue.filter { $0.kind == "loss" }.count) perdas para revisar")
            let a = s.activity.summary
            info("Gestores \(s.activity.hours)h: ↑\(a["increase"]?.count ?? 0) ↓\(a["reduce"]?.count ?? 0) ⏸\(a["pause"]?.count ?? 0) ▶︎\(a["activate"]?.count ?? 0)")
            if let at = store.lastFetch { info("Atualizado às " + DateFormatter.localizedString(from: at, dateStyle: .none, timeStyle: .short)) }
        } else if store.error == nil { info("Carregando…") }
        menu.addItem(.separator())
        menu.addItem(item("Abrir o Bunker", #selector(openBunker), "o"))
        menu.addItem(item("Abrir ou fechar o notch (\(HotKey.label))", #selector(toggleNotch), ""))
        let screens = NSMenuItem(title: "Mostrar o notch na", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for choice in DisplayChoice.allCases {
            let i = NSMenuItem(title: choice.label, action: #selector(chooseDisplay(_:)), keyEquivalent: "")
            i.target = self; i.representedObject = choice.rawValue; i.state = notch?.display == choice ? .on : .off
            sub.addItem(i)
        }
        screens.submenu = sub
        menu.addItem(screens)
        menu.addItem(item("Atualizar agora", #selector(refresh), "r"))
        // Bunk out of the notch: each switch is the owner's.
        let bunkMenu = NSMenuItem(title: "Bunk", action: nil, keyEquivalent: "")
        let b = NSMenu()
        let roam = item("Bunk solto pelas telas (chama sua atenção)", #selector(toggleBunkRoam), ""); roam.state = bunk?.roamEnabled == true ? .on : .off; b.addItem(roam)
        let home = item("Bunk morando no desktop", #selector(toggleBunkResident), ""); home.state = bunk?.resident == true ? .on : .off; b.addItem(home)
        b.addItem(item("Chamar o Bunk agora", #selector(callBunk), ""))
        b.addItem(.separator())
        let everyScreen = bunk?.allScreensAllowed ?? true
        let all = item("Todas as telas", #selector(bunkAllScreens), ""); all.state = everyScreen ? .on : .off; b.addItem(all)
        for (i, screen) in NSScreen.screens.enumerated() {
            let s = item("Tela: " + screen.localizedName, #selector(toggleBunkScreen(_:)), ""); s.representedObject = i
            s.state = everyScreen ? .off : (bunk?.isAllowed(screen) == true ? .on : .off)
            b.addItem(s)
        }
        bunkMenu.submenu = b
        menu.addItem(bunkMenu)
        let privacy = item("Esconder notch e Bunk em gravações e calls", #selector(toggleCapturePrivacy), ""); privacy.state = UserDefaults.standard.bool(forKey: CapturePrivacy.key) ? .on : .off
        menu.addItem(privacy)
        let sales = item("Avisar cada venda no notch", #selector(toggleSaleAlerts), ""); sales.state = UserDefaults.standard.bool(forKey: Store.saleAlertKey) ? .on : .off
        menu.addItem(sales)
        let calls = item("Silêncio em reunião (câmera ou microfone em uso)", #selector(toggleCallQuiet), ""); calls.state = CallWatch.shared.enabled ? .on : .off
        menu.addItem(calls)
        if store.muted { menu.addItem(item("Reativar avisos", #selector(unmute), "")) }
        else { menu.addItem(item("Silenciar avisos por 1 hora", #selector(muteHour), "")); menu.addItem(item("Silenciar até amanhã às 8h", #selector(muteTomorrow), "")) }
        let login = item("Abrir ao iniciar o Mac", #selector(toggleLogin), "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(item("Sair do Bunker para Mac", #selector(quit), "q"))
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.target = self; return i
    }
    @objc private func openBunker() { store.open("#cards") }
    @objc private func toggleNotch() { notch?.toggle() }
    @objc private func chooseDisplay(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String, let choice = DisplayChoice(rawValue: raw) { notch?.display = choice }
    }
    @objc private func muteHour() { store.mute(hours: 1); updateTitle() }
    @objc private func muteTomorrow() { store.muteUntilTomorrow(); updateTitle() }
    @objc private func unmute() { store.unmute(); updateTitle() }
    @objc private func refresh() { Task { await store.refresh() } }
    @objc private func toggleBunkRoam() { bunk?.setRoam(!(bunk?.roamEnabled ?? true)) }
    @objc private func toggleBunkResident() { bunk?.setResident(!(bunk?.resident ?? false)) }
    @objc private func callBunk() { bunk?.callNow() }
    @objc private func toggleCapturePrivacy() {
        let hidden = !UserDefaults.standard.bool(forKey: CapturePrivacy.key)
        UserDefaults.standard.set(hidden, forKey: CapturePrivacy.key)
        notch?.applyCapturePrivacy(hidden); bunk?.applyCapturePrivacy(hidden)
    }
    @objc private func toggleSaleAlerts() { UserDefaults.standard.set(!UserDefaults.standard.bool(forKey: Store.saleAlertKey), forKey: Store.saleAlertKey) }
    @objc private func toggleCallQuiet() { CallWatch.shared.enabled.toggle() }
    @objc private func bunkAllScreens() { bunk?.allowAllScreens() }
    @objc private func toggleBunkScreen(_ sender: NSMenuItem) {
        if let i = sender.representedObject as? Int, i < NSScreen.screens.count { bunk?.toggleScreen(NSScreen.screens[i]) }
    }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            let alert = NSAlert(); alert.messageText = "Não foi possível mudar a abertura automática."; alert.informativeText = error.localizedDescription; alert.runModal()
        }
    }
}
