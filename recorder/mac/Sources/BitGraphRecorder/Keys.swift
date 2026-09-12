// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import AppKit

/// The window's keys.
///
/// ⚠️ ONE PLACE, NOT A MENU. The app is a menu bar item with no menu bar of
/// its own (LSUIElement), so a key equivalent hung on a menu has no menu to
/// hang on. Every key lands here, from one event monitor the delegate
/// installs, and each one asks the state to do what a click would.
///
/// The plain keys (the arrows, T) are Calendar's own, and only while nothing
/// is being typed: with the caret in the search field they are letters.
extension AppState {
    /// True when the key was taken, so the event goes no further.
    func handleKey(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let cmd = flags.contains(.command)
        let shift = flags.contains(.shift)
        let plain = flags.isEmpty
        let typing = NSApp.keyWindow?.firstResponder is NSTextView
        let key = (event.charactersIgnoringModifiers ?? "").lowercased()

        /* Escape first, whatever is up: it is how a dialog goes away. */
        if event.keyCode == 53 { return escape() }
        /* With a dialog up, the keys that move the surface behind it wait. */
        guard !dialogUp else { return false }

        switch (event.keyCode, key) {
        case (_, "n") where cmd && !shift:
            createMenu = false
            chooseFilesToMake()
        case (_, "k") where cmd && shift:
            createMenu = false
            checkOneOff()
        case (_, "1") where cmd:
            showSection(.box)
        case (_, "2") where cmd:
            showSection(.calendar)
        case (_, "f") where cmd:
            showSection(.calendar)
            focusSearch = true
        case (_, "t") where cmd || (plain && !typing):
            showSection(.calendar)
            goToday()
        case (123, _) where cmd || (plain && !typing && onCalendar):
            stepMonth(-1)
        case (124, _) where cmd || (plain && !typing && onCalendar):
            stepMonth(1)
        default:
            return false
        }
        return true
    }

    /// The month list is what is showing: not a proof page, not the box.
    private var onCalendar: Bool {
        section == .calendar && surface == .box
    }

    /// The keys, for the README and the popover.
    static let shortcuts: [(keys: String, does: String)] = [
        ("⌘N", "Record a BitGraph…"),
        ("⇧⌘K", "Check a folder…"),
        ("⌘1 / ⌘2", "Record / Calendar"),
        ("← → or ⌘← ⌘→", "The month before / after"),
        ("T or ⌘T", "Today"),
        ("⌘F", "Search recordings"),
        ("Esc", "Put away what is up"),
    ]
}
