import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// The owner's approval key. The private key is created inside this Mac's Secure Enclave and
/// never leaves it; every signature needs Touch ID (or the Mac password). Only the encrypted
/// blob (usable by this chip alone) is kept in the Keychain. The Bunker keeps the public key.
enum OwnerKey {
    static let service = "com.eriksozo.bunker.notch"
    static let account = "owner-device-key"
    static let audience = "bunker-traffic/owner-device"
    /// Public key for registration in the Bunker (not a secret).
    static var publicKeyFile: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/bunker-traffic/owner-device-public-key")
    }

    enum Failure: Error, Equatable { case unavailable, cancelled, keychain, signing }

    private static func blob() -> Data? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    private static func save(_ data: Data) -> Bool {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        add[kSecAttrLabel as String] = "Bunker · chave de aprovação do dono (Secure Enclave, Touch ID)"
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    /// Public key of the existing key, creating it on first use. No prompt: only signing asks for Touch ID.
    @discardableResult
    static func ensure() throws -> P256.Signing.PublicKey {
        if let data = blob(), let key = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data) {
            writePublicKey(key.publicKey); return key.publicKey
        }
        guard SecureEnclave.isAvailable else { throw Failure.unavailable }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &error),
              let key = try? SecureEnclave.P256.Signing.PrivateKey(accessControl: access) else { throw Failure.unavailable }
        guard save(key.dataRepresentation) else { throw Failure.keychain }
        writePublicKey(key.publicKey)
        return key.publicKey
    }

    static func publicKeyBase64(_ key: P256.Signing.PublicKey) -> String { key.x963Representation.base64EncodedString() }
    /// Same identifier the server derives: first 16 hex of SHA-256 over the X9.63 bytes.
    static func keyId(_ key: P256.Signing.PublicKey) -> String {
        SHA256.hash(data: key.x963Representation).map { String(format: "%02x", $0) }.joined().prefix(16).description
    }

    private static func writePublicKey(_ key: P256.Signing.PublicKey) {
        let url = publicKeyFile, text = publicKeyBase64(key) + "\n"
        if (try? String(contentsOf: url, encoding: .utf8)) == text { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }

    /// Signed envelope body: {v:1,key,payload,sig}; payload is the exact JSON {aud,iat,input}.
    static func envelope(input: [String: Any], payloadSigner: (Data) throws -> Data, key: P256.Signing.PublicKey, now: Date = Date()) throws -> Data {
        let signed: [String: Any] = ["aud": audience, "iat": Int(now.timeIntervalSince1970 * 1000), "input": input]
        let payload = try JSONSerialization.data(withJSONObject: signed, options: [.sortedKeys])
        let sig = try payloadSigner(payload)
        let body: [String: Any] = ["v": 1, "key": keyId(key), "payload": payload.base64EncodedString(), "sig": sig.base64EncodedString()]
        return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    /// Asks for Touch ID with the exact change in the prompt, then signs once with the authenticated context.
    static func sign(input: [String: Any], reason: String) async throws -> Data {
        let publicKey = try ensure()
        guard let data = blob() else { throw Failure.keychain }
        let context = LAContext()
        context.localizedCancelTitle = "Cancelar"
        do { _ = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) }
        catch { throw Failure.cancelled }
        return try await Task.detached(priority: .userInitiated) {
            guard let key = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data, authenticationContext: context) else { throw Failure.signing }
            return try envelope(input: input, payloadSigner: { payload in
                guard let sig = try? key.signature(for: payload) else { throw Failure.signing }
                return sig.rawRepresentation
            }, key: publicKey)
        }.value
    }
}
