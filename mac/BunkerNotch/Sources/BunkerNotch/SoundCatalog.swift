import Foundation

/// Sound choices per adjustment kind (owner request 08/11/2026: at least five per status). Designed from the
/// references in docs/notch-sounds.md: direction carries meaning (increase rises, reduction falls, pause is flat
/// or comes to rest), each kind has its own register (increase C6–G6, reduction C5–G5, pause C4–G4), one key
/// (C major) with consonant intervals, 300–600 ms, at most about six notes per second, the last note longest.
/// System sounds are read by name from /System/Library/Sounds and trimmed to 0.7 s; none is copied here.
enum SoundCatalog {
    typealias N = SoundOption.Note
    static let options: [AdjustSound.Kind: [SoundOption]] = [
        .increase: [
            SoundOption(id: "inc-subida-suave", label: "Subida suave", source: .synth(.marimba, [N(hz: 1046.5, startMs: 0, durationMs: 140, gain: 0.55), N(hz: 1318.51, startMs: 150, durationMs: 280, gain: 0.5)])),
            SoundOption(id: "inc-sino-quinta", label: "Sino em quinta", source: .synth(.bell, [N(hz: 1046.5, startMs: 0, durationMs: 140, gain: 0.5), N(hz: 1567.98, startMs: 150, durationMs: 350, gain: 0.45)])),
            SoundOption(id: "inc-arpejo-maior", label: "Arpejo maior", source: .synth(.sine, [N(hz: 1046.5, startMs: 0, durationMs: 130, gain: 0.5), N(hz: 1318.51, startMs: 150, durationMs: 130, gain: 0.48), N(hz: 1567.98, startMs: 300, durationMs: 300, gain: 0.45)])),
            SoundOption(id: "inc-degrau-digital", label: "Degrau digital", source: .synth(.softSquare, [N(hz: 1318.51, startMs: 0, durationMs: 100, gain: 0.35), N(hz: 1567.98, startMs: 130, durationMs: 180, gain: 0.32)])),
            SoundOption(id: "inc-sys-glass", label: "Vidro", source: .system("Glass")),
            SoundOption(id: "inc-sys-hero", label: "Herói", source: .system("Hero")),
            SoundOption(id: "inc-sys-tink", label: "Tink", source: .system("Tink")),
            SoundOption(id: "inc-nenhum", label: "Nenhum", source: .silent),
        ],
        .reduce: [
            SoundOption(id: "red-descida-suave", label: "Descida suave", source: .synth(.marimba, [N(hz: 659.26, startMs: 0, durationMs: 140, gain: 0.45), N(hz: 523.25, startMs: 150, durationMs: 300, gain: 0.4)])),
            SoundOption(id: "red-quarta-desce", label: "Quarta descendente", source: .synth(.sine, [N(hz: 783.99, startMs: 0, durationMs: 140, gain: 0.42), N(hz: 587.33, startMs: 150, durationMs: 300, gain: 0.38)])),
            SoundOption(id: "red-sino-descendente", label: "Sino descendente", source: .synth(.bell, [N(hz: 783.99, startMs: 0, durationMs: 130, gain: 0.38), N(hz: 659.26, startMs: 150, durationMs: 130, gain: 0.36), N(hz: 523.25, startMs: 300, durationMs: 300, gain: 0.34)])),
            SoundOption(id: "red-toque-duplo", label: "Toque duplo descendente", source: .synth(.softSquare, [N(hz: 659.26, startMs: 0, durationMs: 90, gain: 0.28), N(hz: 523.25, startMs: 140, durationMs: 160, gain: 0.25)])),
            SoundOption(id: "red-sys-bottle", label: "Garrafa", source: .system("Bottle")),
            SoundOption(id: "red-sys-purr", label: "Ronronar", source: .system("Purr")),
            SoundOption(id: "red-sys-pop", label: "Pop", source: .system("Pop")),
            SoundOption(id: "red-nenhum", label: "Nenhum", source: .silent),
        ],
        .pause: [
            SoundOption(id: "pau-parada-dupla", label: "Parada dupla", source: .synth(.softSquare, [N(hz: 392, startMs: 0, durationMs: 120, gain: 0.42), N(hz: 392, startMs: 180, durationMs: 200, gain: 0.4)])),
            SoundOption(id: "pau-descida-repouso", label: "Descida ao repouso", source: .synth(.marimba, [N(hz: 392, startMs: 0, durationMs: 140, gain: 0.55), N(hz: 261.63, startMs: 160, durationMs: 340, gain: 0.55)])),
            SoundOption(id: "pau-tres-toques", label: "Três toques graves", source: .synth(.bell, [N(hz: 392, startMs: 0, durationMs: 110, gain: 0.5), N(hz: 392, startMs: 170, durationMs: 110, gain: 0.5), N(hz: 392, startMs: 340, durationMs: 200, gain: 0.48)])),
            SoundOption(id: "pau-fechamento-oitava", label: "Fechamento em oitava", source: .synth(.sine, [N(hz: 523.25, startMs: 0, durationMs: 110, gain: 0.5), N(hz: 261.63, startMs: 140, durationMs: 260, gain: 0.6)])),
            SoundOption(id: "pau-sys-submarine", label: "Submarino", source: .system("Submarine")),
            SoundOption(id: "pau-sys-funk", label: "Funk", source: .system("Funk")),
            SoundOption(id: "pau-sys-basso", label: "Grave Basso", source: .system("Basso")),
            SoundOption(id: "pau-nenhum", label: "Nenhum", source: .silent),
        ],
    ]
    static let defaults: [AdjustSound.Kind: String] = [.increase: "inc-subida-suave", .reduce: "red-descida-suave", .pause: "pau-parada-dupla"]
}
