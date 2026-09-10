// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

@main
struct RecorderApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        /* The one window: the box, a batch, or a BitGraph. It is the product's
         * surface; the menu bar is the service behind it. */
        Window("BitGraph Recorder", id: "box") {
            MainWindow(state: delegate.state)
        }
        .defaultSize(width: 1180, height: 780)
        .windowResizability(.contentMinSize)

        MenuBarExtra {
            MenuView(state: delegate.state)
        } label: {
            /* The dashed frame the product is drawn as everywhere else. The
             * icon changes only when something has something to say: a menu
             * bar that is loud all the time is a menu bar nobody looks at. */
            Image(systemName: delegate.state.everythingIsFine ? "square.dashed" : "exclamationmark.square.dashed")
        }
        .menuBarExtraStyle(.window)
    }
}

/// ⚠️ THE CORE STARTS AT LAUNCH, NOT WHEN THE MENU IS OPENED.
///
/// Attaching the start to the menu's `onAppear` made a watcher that only ran
/// while somebody was looking at it: the app sat in the menu bar, the folder
/// looked watched, and nothing was being recorded until the popover was
/// clicked. A folder that looks watched and is not is worse than one that was
/// never added.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let state = AppState()

    func applicationDidFinishLaunching(_ notification: Notification) {
        /* ⚠️ LIGHT, WHATEVER THE MAC IS SET TO. Every surface here is painted
         * in the site's light palette; only the pieces AppKit draws itself
         * (a menu's label, a checkbox, a text field's caret) followed the
         * system, and on a Mac in dark mode they came out white on white. */
        NSApp.appearance = NSAppearance(named: .aqua)
        state.start()
    }

    /* A menu bar app has no Dock icon, so clicking the app in Finder or
     * Spotlight is the one way back to the window once it is closed. */
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows visible: Bool) -> Bool {
        if !visible { NSApp.windows.first?.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        state.stop()
    }

    /// Double-clicking a BitGraph opens it, which is the whole reason the app
    /// claims the file type.
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first(where: { $0.pathExtension == "bitgraph" }) else { return }
        state.openBitGraphFile(url)
    }
}
