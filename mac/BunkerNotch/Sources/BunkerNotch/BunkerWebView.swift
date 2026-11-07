import AppKit
import SwiftUI
import WebKit

/// Only the Bunker Worker and the Supabase sign-in may load inside the island; anything else opens in the browser.
/// The owner session (Supabase cookies) lives in this app's own persistent web store.
enum WebScope {
    static let bunkerHost = Store.base.host ?? "bunker-traffic.erik-iplou.workers.dev"
    static let authHost = "enehgnotumknjlmwfcta.supabase.co"
    enum Decision: Equatable { case allow, emailLogin, external }
    static func decide(_ url: URL?) -> Decision {
        guard let url, let host = url.host?.lowercased() else { return .allow } // about:blank and in-page navigation
        if url.scheme == "about" { return .allow }
        guard url.scheme == "https" else { return .external }
        if host == bunkerHost || host == authHost { return .allow }
        // The Worker sends signed-out visitors to the private ChatGPT Site; in the app use the owner e-mail login instead.
        if host.hasSuffix(".chatgpt.site") { return .emailLogin }
        return .external
    }
    /// Successful sign-in must return to the exact campaign the owner was already viewing.
    static func cardToResume(requested: URL?, finished: URL?) -> URL? {
        guard let requested, let finished, requested.scheme == "https", requested.host == bunkerHost,
              requested.user == nil, requested.password == nil, requested.port == nil,
              requested.path == "/", requested.fragment?.hasPrefix("cards?") == true,
              finished.scheme == "https", finished.host == bunkerHost, finished.path == "/",
              finished.query == nil, finished.fragment == nil else { return nil }
        return requested
    }
    static var emailLogin: URL { URL(string: "https://\(bunkerHost)/auth/login?email=1")! }
    /// A pasted sign-in link must be the Bunker callback or the Supabase verify link, nothing else.
    static func signInLink(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme == "https", url.user == nil, url.password == nil, url.port == nil, let host = url.host?.lowercased() else { return nil }
        if host == bunkerHost && url.path == "/auth/callback" { return url }
        if host == authHost && url.path == "/auth/v1/verify" { return url }
        return nil
    }
}

struct BunkerWebView: NSViewRepresentable {
    let url: URL
    @Binding var reloadToken: Int
    @Binding var currentURL: URL?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        view.load(URLRequest(url: url))
        context.coordinator.lastToken = reloadToken
        context.coordinator.lastURL = url
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        if context.coordinator.lastURL != url {
            context.coordinator.lastURL = url
            context.coordinator.lastToken = reloadToken
            view.load(URLRequest(url: url))
        } else if context.coordinator.lastToken != reloadToken {
            // After sign-in the requested URL may be an already-consumed e-mail link.
            // Refresh the current card, never replay that one-use verification URL.
            context.coordinator.lastToken = reloadToken
            view.reload()
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: BunkerWebView
        var lastToken = 0
        var lastURL: URL?
        var ownerTarget: URL?
        init(_ parent: BunkerWebView) { self.parent = parent; ownerTarget = parent.url }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            switch WebScope.decide(action.request.url) {
            case .allow: decisionHandler(.allow)
            case .emailLogin: decisionHandler(.cancel); webView.load(URLRequest(url: WebScope.emailLogin))
            case .external:
                decisionHandler(.cancel)
                if let url = action.request.url { NSWorkspace.shared.open(url) }
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let url = webView.url
            if let target = WebScope.cardToResume(requested: ownerTarget, finished: url) {
                webView.load(URLRequest(url: target)); return
            }
            Task { @MainActor in self.parent.currentURL = url }
        }
        /// target=_blank links: same scope rules, never a second window.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if WebScope.decide(action.request.url) == .allow { webView.load(action.request) }
            else if let url = action.request.url { NSWorkspace.shared.open(url) }
            return nil
        }
        /// The Bunker approval dialog uses in-page modals; native JS alerts/confirms are shown as sheets on the panel.
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
            let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Confirmar"); alert.addButton(withTitle: "Cancelar")
            completionHandler(alert.runModal() == .alertFirstButtonReturn)
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
            let alert = NSAlert(); alert.messageText = message; alert.runModal(); completionHandler()
        }
    }
}
