// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "BitGraphRecorder",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "BitGraphRecorder",
            path: "Sources/BitGraphRecorder"
        ),
        // Checks the decisions the surface makes, and renders it to PNGs so the
        // design can be looked at without a running core. Never shipped:
        // build.sh copies only the BitGraphRecorder executable into the bundle.
        .testTarget(
            name: "RecorderTests",
            dependencies: ["BitGraphRecorder"],
            path: "Tests/RecorderTests"
        ),
    ]
)
