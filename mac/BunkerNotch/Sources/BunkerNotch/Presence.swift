import AppKit
import Combine
import CoreAudio
import CoreMediaIO

/// Is the owner in a call or recording? Camera or microphone in use by any app, read from the hardware
/// (CoreMediaIO / CoreAudio "running somewhere"): no permission prompt, no content read. Idea from Repose (MIT).
enum CallSignals {
    static func microphoneInUse() -> Bool {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 else { return false }
        var devices = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &devices) == noErr else { return false }
        for d in devices {
            var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
            var streamSize: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(d, &streams, 0, nil, &streamSize) == noErr, streamSize > 0 else { continue }
            var running = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            var on: UInt32 = 0, onSize = UInt32(MemoryLayout<UInt32>.size)
            if AudioObjectGetPropertyData(d, &running, 0, nil, &onSize, &on) == noErr, on != 0 { return true }
        }
        return false
    }

    static func cameraInUse() -> Bool {
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var size: UInt32 = 0
        guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 else { return false }
        var devices = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
        var used: UInt32 = 0
        guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, size, &used, &devices) == noErr else { return false }
        for d in devices {
            var running = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeWildcard), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementWildcard))
            var on: UInt32 = 0, got: UInt32 = 0
            if CMIOObjectGetPropertyData(d, &running, 0, nil, UInt32(MemoryLayout<UInt32>.size), &got, &on) == noErr, on != 0 { return true }
        }
        return false
    }
}

/// Call detection with hysteresis: two readings in a row to enter (10 s), six quiet readings to leave (30 s),
/// so a short dictation or a camera blink does not flip the notch. Pure, for the self-test.
struct CallHysteresis: Equatable {
    static let enterAfter = 2, leaveAfter = 6
    private(set) var inCall = false
    private var on = 0, off = 0
    mutating func feed(_ signal: Bool) -> Bool {
        if signal { on += 1; off = 0; if on >= Self.enterAfter { inCall = true } }
        else { off += 1; on = 0; if off >= Self.leaveAfter { inCall = false } }
        return inCall
    }
}

/// While the owner is in a call (and the switch is on), Bunk stays home and island alerts and system
/// notifications wait for the call to end.
@MainActor final class CallWatch: ObservableObject {
    static let shared = CallWatch()
    static let key = "quietInCalls"
    @Published private(set) var inCall = false
    private var hysteresis = CallHysteresis()
    private var timer: Timer?
    @Published var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: Self.key); if !enabled { hysteresis = CallHysteresis(); inCall = false } }
    }
    private init() {
        UserDefaults.standard.register(defaults: [Self.key: true])
        enabled = UserDefaults.standard.bool(forKey: Self.key)
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.check() } }
    }
    private func check() {
        guard enabled else { return }
        let next = hysteresis.feed(CallSignals.cameraInUse() || CallSignals.microphoneInUse())
        if next != inCall { inCall = next }
    }
}

/// VoiceOver hears urgent island alerts (public announcement API; nothing is said when VoiceOver is off).
enum Announce {
    @MainActor static func alert(_ text: String) {
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
    }
}
