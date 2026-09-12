// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit
import UserNotifications

@main
struct RecorderApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        /* The one window: the box, a batch, or a BitGraph. It is the product's
         * surface; the menu bar is the service behind it. */
        Window("BitGraph", id: "box") {
            MainWindow(state: delegate.state)
        }
        .defaultSize(width: 1180, height: 780)
        .windowResizability(.contentMinSize)

        MenuBarExtra {
            MenuView(state: delegate.state)
        } label: {
            /* The record dot, the same mark as the app icon (Mike, 2026-09-11:
             * "icon doesnt match the top bar icon"; it was the site's dashed
             * frame). The icon changes only when something has something to
             * say: a menu bar that is loud all the time is a menu bar nobody
             * looks at. */
            Image(systemName: delegate.state.everythingIsFine ? "circle.fill" : "exclamationmark.circle.fill")
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
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let state = AppState()
    private var keys: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        /* ⚠️ LIGHT, WHATEVER THE MAC IS SET TO. Every surface here is painted
         * in the site's light palette; only the pieces AppKit draws itself
         * (a menu's label, a checkbox, a text field's caret) followed the
         * system, and on a Mac in dark mode they came out white on white. */
        NSApp.appearance = NSAppearance(named: .aqua)
        /* The window's keys (Keys.swift). Only the titled window's: the menu
         * bar popover is borderless and keeps its keys to itself. */
        keys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [state] event in
            guard let window = event.window, window.styleMask.contains(.titled), window.isKeyWindow else { return event }
            return state.handleKey(event) ? nil : event
        }
        if AppState.canNotify { UNUserNotificationCenter.current().delegate = self }
        state.start()
    }

    /// A notification clicked: the window, on the calendar, at today.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.windows.first(where: { $0.styleMask.contains(.titled) })?.makeKeyAndOrderFront(nil)
            state.showCalendar()
            state.goToday()
        }
    }

    /* A menu bar app has no Dock icon, so clicking the app in Finder or
     * Spotlight is the one way back to the window once it is closed.
     *
     * ⚠️ FALSE, HAVING DONE IT. Returning true told SwiftUI to do its own
     * reopening on top of ours, and with the window closed that opened a
     * SECOND one (Mike, 2026-09-11: two windows stacked after `open`). */
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows visible: Bool) -> Bool {
        if let window = NSApp.windows.first(where: { $0.styleMask.contains(.titled) }) {
            window.makeKeyAndOrderFront(nil)
            return false
        }
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
