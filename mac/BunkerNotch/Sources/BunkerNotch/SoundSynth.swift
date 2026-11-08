import AppKit
import AVFoundation
import Foundation

/// One sound the owner can pick: a macOS system sound or a short tone generated here (no audio file in the repo).
struct SoundOption: Identifiable, Equatable {
    enum Timbre: String { case sine, bell, marimba, softSquare }
    /// One note: frequency, start and length in milliseconds, relative level 0…1.
    struct Note: Equatable { let hz: Double; let startMs: Double; let durationMs: Double; let gain: Double }
    enum Source: Equatable { case system(String); case synth(Timbre, [Note]); case silent }
    let id: String
    let label: String
    let source: Source
    var detail: String {
        switch source { case .system(let name): return "Som do macOS · " + name; case .synth: return "Gerado no Bunker"; case .silent: return "Sem som para este tipo" }
    }
}

/// Renders the generated tones to 16-bit mono WAV in memory. Each note has a 5 ms attack and a release long
/// enough to avoid clicks; partials and their decay give the timbre; partials above 5 kHz are dropped and the
/// 2–5 kHz band (where the ear is most sensitive, ISO 226) is halved; the mix is normalized to a -6 dBFS peak.
/// References: docs/notch-sounds.md.
enum SoundSynth {
    static let sampleRate = 44_100.0
    static let peak = 0.5

    /// (frequency ratio, level, decay per second) for each partial of a timbre.
    static func partials(_ t: SoundOption.Timbre) -> [(ratio: Double, level: Double, decay: Double)] {
        switch t {
        case .sine: return [(1, 1, 3)]
        case .bell: return [(1, 1, 3.5), (2.76, 0.35, 7), (5.4, 0.15, 12)]
        case .marimba: return [(1, 1, 9), (3.93, 0.25, 22), (9.2, 0.06, 40)]
        case .softSquare: return [(1, 1, 4), (3, 1.0 / 9, 6), (5, 1.0 / 25, 8)]
        }
    }

    static func samples(_ timbre: SoundOption.Timbre, _ notes: [SoundOption.Note]) -> [Double] {
        let tail = 30.0
        let totalMs = (notes.map { $0.startMs + $0.durationMs }.max() ?? 0) + tail
        var out = [Double](repeating: 0, count: max(1, Int(totalMs / 1000 * sampleRate)))
        let parts = partials(timbre)
        for n in notes where n.hz > 0 && n.durationMs > 0 {
            let start = Int(n.startMs / 1000 * sampleRate), count = Int((n.durationMs + tail) / 1000 * sampleRate)
            let attack = 0.005 * sampleRate, release = min(0.04, n.durationMs / 1000 / 2) * sampleRate
            let length = n.durationMs / 1000 * sampleRate
            for i in 0..<count where start + i < out.count {
                let t = Double(i) / sampleRate
                // Attack ramp, then the note; after its length a short release fades to zero.
                var env = Double(i) < attack ? Double(i) / attack : 1
                if Double(i) > length { env *= max(0, 1 - (Double(i) - length) / max(1, release)) }
                var v = 0.0
                for p in parts where n.hz * p.ratio <= 5_000 {
                    let f = n.hz * p.ratio, band = f > 2_000 ? 0.5 : 1
                    v += band * p.level * exp(-p.decay * t) * sin(2 * .pi * f * t)
                }
                out[start + i] += n.gain * env * v
            }
        }
        // Same headroom for every tone, scaled by its loudest note (gain 0.6 = full -6 dBFS): the palette's relative
        // levels survive (reductions softer, pauses a little firmer, square timbres lower for the same loudness).
        let top = out.map(abs).max() ?? 0, level = min(1, (notes.map(\.gain).max() ?? 0.6) / 0.6)
        if top > 0 { out = out.map { $0 / top * peak * level } }
        return out
    }

    /// 16-bit PCM WAV; `samples` interleaved when `channels` > 1.
    static func wav(_ samples: [Double], channels: Int = 1, rate: Double = sampleRate) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        let bytes = UInt32(samples.count * 2), ch = UInt16(max(1, channels)), r = UInt32(rate)
        d.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes); d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(ch); u32(r); u32(r * UInt32(ch) * 2); u16(ch * 2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(bytes)
        for s in samples { u16(UInt16(bitPattern: Int16(max(-1, min(1, s)) * 32_767))) }
        return d
    }

    /// A macOS system sound cut to `maxMs` with a fade to zero (long tails such as Funk or Glass would blur the
    /// next kind). Read from /System/Library/Sounds at runtime; nothing is copied to the repo. nil if unreadable.
    static let systemMaxMs = 700.0, systemFadeMs = 80.0
    static func trimmedSystem(_ name: String) -> Data? {
        let url = URL(fileURLWithPath: "/System/Library/Sounds/" + name + ".aiff")
        guard let file = try? AVAudioFile(forReading: url), let format = AVAudioFormat(standardFormatWithSampleRate: file.processingFormat.sampleRate, channels: file.processingFormat.channelCount) else { return nil }
        let rate = format.sampleRate, frames = AVAudioFrameCount(min(Double(file.length), systemMaxMs / 1000 * rate))
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames), (try? file.read(into: buffer, frameCount: frames)) != nil,
              let data = buffer.floatChannelData else { return nil }
        let n = Int(buffer.frameLength), ch = Int(format.channelCount), fade = Int(systemFadeMs / 1000 * rate)
        var out = [Double](repeating: 0, count: n * ch)
        for i in 0..<n {
            let g = Double(file.length) > Double(n) && i >= n - fade ? Double(n - i) / Double(fade) : 1
            for c in 0..<ch { out[i * ch + c] = Double(data[c][i]) * g }
        }
        return wav(out, channels: ch, rate: rate)
    }
}

/// Plays the chosen option at the owner's volume. Players are kept alive until a few newer ones replace them.
@MainActor
final class SoundPlayer {
    static let shared = SoundPlayer()
    private var live: [AnyObject] = []
    private var cache: [String: Data] = [:]

    func play(_ option: SoundOption, volume: Double) {
        let v = Float(max(0, min(1, volume)))
        switch option.source {
        case .silent: return
        case .system(let name):
            // Trimmed copy first; the plain system sound if the file cannot be read.
            if let data = cache[option.id] ?? SoundSynth.trimmedSystem(name), let player = try? AVAudioPlayer(data: data) {
                cache[option.id] = data; player.volume = v; player.play(); keep(player); return
            }
            guard let sound = NSSound(named: NSSound.Name(name))?.copy() as? NSSound else { return }
            sound.volume = v; sound.play(); keep(sound)
        case .synth(let timbre, let notes):
            let data = cache[option.id] ?? SoundSynth.wav(SoundSynth.samples(timbre, notes))
            cache[option.id] = data
            guard let player = try? AVAudioPlayer(data: data) else { return }
            player.volume = v; player.play(); keep(player)
        }
    }
    private func keep(_ o: AnyObject) { live.append(o); if live.count > 8 { live.removeFirst(live.count - 8) } }
}
