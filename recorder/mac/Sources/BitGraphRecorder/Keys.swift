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
            chooseFilesToMake()
        case (_, "f") where cmd:
            if !onCalendar { showCalendar() }
            focusSearch = true
        case (_, "t") where cmd || (plain && !typing):
            if !onCalendar { showCalendar() }
            goToday()
        case (123, _) where cmd || (plain && !typing && onCalendar):
            jumpMonth(-1)
        case (124, _) where cmd || (plain && !typing && onCalendar):
            jumpMonth(1)
        default:
            return false
        }
        return true
    }

    /// The month list is what is showing: not a proof page, not a listing.
    private var onCalendar: Bool {
        surface == .calendar
    }

    /// The keys, for the README and the popover.
    static let shortcuts: [(keys: String, does: String)] = [
        ("⌘N", "Record a BitGraph…"),
        ("← → or ⌘← ⌘→", "The month before / after"),
        ("T or ⌘T", "Today"),
        ("⌘F", "Search recordings"),
        ("Esc", "Put away what is up"),
    ]
}
