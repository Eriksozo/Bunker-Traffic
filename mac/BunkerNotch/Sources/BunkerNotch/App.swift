import AppKit
import Combine
import ServiceManagement
import SwiftUI

@main
enum BunkerNotchMain {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") { exit(SelfTest.run()) }
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
    private var statusItem: NSStatusItem!
    private var bag = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "square.stack.3d.up.fill", accessibilityDescription: "Bunker")
        statusItem.button?.imagePosition = .imageLeading
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        notch = NotchController(store: store)
        store.$summary.combineLatest(store.$error).receive(on: RunLoop.main).sink { [weak self] _ in self?.updateTitle() }.store(in: &bag)
        store.start()
    }

    private func updateTitle() {
        let n = store.attention
        statusItem.button?.title = store.error != nil ? " !" : n > 0 ? " \(n)" : ""
        statusItem.button?.toolTip = store.error ?? "Bunker · \(n) item(ns) pedem atenção"
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
        menu.addItem(item("Mostrar ou esconder o painel do notch", #selector(toggleNotch), "b"))
        menu.addItem(item("Atualizar agora", #selector(refresh), "r"))
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
    @objc private func refresh() { Task { await store.refresh() } }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            let alert = NSAlert(); alert.messageText = "Não foi possível mudar a abertura automática."; alert.informativeText = error.localizedDescription; alert.runModal()
        }
    }
}
