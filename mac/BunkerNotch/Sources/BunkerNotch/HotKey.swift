import AppKit
import Carbon.HIToolbox

// Global shortcut through Carbon RegisterEventHotKey: no Accessibility permission, the key press is consumed.
// Same technique as the MIT-licensed notch app credited in mac/NOTICE.md.
private nonisolated(unsafe) var bunkerHotKeyAction: (() -> Void)?
private nonisolated(unsafe) var bunkerHotKeyRef: EventHotKeyRef?
private nonisolated(unsafe) var bunkerHotKeyHandler: EventHandlerRef?

private func bunkerHotKeyEvent(_: EventHandlerCallRef?, _ event: EventRef?, _: UnsafeMutableRawPointer?) -> OSStatus {
    guard event != nil else { return OSStatus(eventNotHandledErr) }
    MainActor.assumeIsolated { bunkerHotKeyAction?() }
    return noErr
}

@MainActor
enum HotKey {
    /// ⌥⌘B by default. Returns false when the system or another app already owns the combination.
    @discardableResult
    static func register(keyCode: UInt32 = UInt32(kVK_ANSI_B), modifiers: UInt32 = UInt32(cmdKey | optionKey), action: @escaping () -> Void) -> Bool {
        bunkerHotKeyAction = action
        if bunkerHotKeyHandler == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), bunkerHotKeyEvent, 1, &spec, nil, &bunkerHotKeyHandler)
        }
        if let ref = bunkerHotKeyRef { UnregisterEventHotKey(ref); bunkerHotKeyRef = nil }
        let id = EventHotKeyID(signature: OSType(0x424E4B52), id: 1) // "BNKR"
        return RegisterEventHotKey(keyCode, modifiers, id, GetApplicationEventTarget(), 0, &bunkerHotKeyRef) == noErr
    }
    static let label = "⌥⌘B"
}
