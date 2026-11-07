// swift-tools-version: 5.10
import PackageDescription

// Bunker companion for macOS: notch overlay + menu bar, read-only.
// Built with the Command Line Tools (no Xcode project needed): see mac/build.sh.
let package = Package(
    name: "BunkerNotch",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "BunkerNotch",
            path: "Sources/BunkerNotch"
        )
    ]
)
