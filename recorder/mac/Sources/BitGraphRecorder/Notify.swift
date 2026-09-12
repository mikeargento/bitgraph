// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import AppKit
import UserNotifications

/// The one thing the app says without being asked: anchors arrived.
///
/// A recording that was waiting on its Ethereum side becomes anchored later,
/// by itself, and until now it did so silently unless the window was open.
/// A notification says it, once per pass, and only while the app is NOT the
/// thing being looked at: with the window up, the snackbar already has it.
/// Nothing else is ever announced this way; a menu bar app that talks is a
/// menu bar app that gets muted.
extension AppState {
    func notifyAnchors(_ pass: AnchorPass) {
        guard pass.landed > 0, !NSApp.isActive else { return }
        let open = pass.open.values.reduce(0, +)
        var body = pass.landed == 1 ? "1 anchor arrived." : "\(pass.landed) anchors arrived."
        if open == 0 && !pass.partial {
            body += " Nothing is waiting."
        } else if open > 0 {
            body += " \(open) side\(open == 1 ? " is" : "s are") still open."
        }
        notify("Anchored", body)
    }

    /// Posts one. Asks for permission the first time; a person who says no
    /// is never asked again by this code, and never nagged.
    func notify(_ title: String, _ body: String) {
        guard live, Self.canNotify else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    /// ⚠️ Only a real app bundle can post one. The test host is not one, and
    /// asking the notification center from a bare executable aborts the
    /// process rather than returning an error.
    static var canNotify: Bool {
        Bundle.main.bundleURL.pathExtension == "app" && Bundle.main.bundleIdentifier != nil
    }
}
