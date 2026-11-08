import Foundation
import Security

/// The companion credential lives only in the macOS Keychain. A one-time private file
/// (~/.config/bunker-traffic/companion-token, mode 600) is imported and then removed.
enum Credential {
    static let service = "com.eriksozo.bunker.notch"
    static let account = "companion"
    static var importFile: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/bunker-traffic/companion-token")
    }

    static func read() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func store(_ token: String) -> Bool {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrLabel as String] = "Bunker · credencial do app do Mac (somente leitura)"
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    /// Valid token shape: base64url, 43–128 characters. Anything else is refused, never sent.
    static func valid(_ token: String) -> Bool {
        token.range(of: "^[A-Za-z0-9_-]{43,128}$", options: .regularExpression) != nil
    }

    /// The credential for requests, read from the Keychain once and kept in memory (the 8 s pulse used to query the
    /// Keychain every time). `forget()` after a 401 so a rotated credential is read again.
    nonisolated(unsafe) private static var cached: String?
    private static let lock = NSLock()
    static func current() -> String? {
        lock.lock(); defer { lock.unlock() }
        if let cached { return cached }
        cached = importIfNeeded()
        return cached
    }
    static func forget() { lock.lock(); cached = nil; lock.unlock() }

    /// Import the private file once: only a regular file owned by this user with mode 600/400.
    static func importIfNeeded() -> String? {
        if let existing = read(), valid(existing) { return existing }
        let url = importFile, fm = FileManager.default
        guard let attrs = try? fm.attributesOfItem(atPath: url.path),
              (attrs[.type] as? FileAttributeType) == .typeRegular,
              (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              let mode = (attrs[.posixPermissions] as? NSNumber)?.intValue, mode == 0o600 || mode == 0o400,
              let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard valid(token), store(token), read() == token else { return nil }
        try? fm.removeItem(at: url)
        return token
    }
}
