// ============================================================
// AKBARALTheme.swift — AKBARAL! Design System tokens for iOS.
//
// GENERATED from design-system/tokens.json (v3.0.0) —
// run `node design-system/build.mjs` after token edits.
//
// STATUS: prepared design tokens for the FUTURE iOS app. There is
// no iOS application in production yet — this file intentionally
// ships no app, no screens and no fake functionality. When the iOS
// release begins, consume these tokens exactly as the Android app
// consumes mobile/src/theme.ts and the website consumes
// public/tokens.css: one identity, native feel.
//
// Identity: obsidian foundation · indigo/violet atmosphere ·
// glass surfaces · cinematic lighting · technical elegance.
// ============================================================//

import UIKit

enum AKBARALTheme {

    // MARK: - Foundation (obsidian)

    private static func hex(_ value: String) -> UIColor {
        var raw = value.trimmingCharacters(in: .whitespaces)
        if raw.hasPrefix("#") { raw.removeFirst() }
        var rgba: UInt64 = 0
        Scanner(string: raw).scanHexInt64(&rgba)
        let r = CGFloat((rgba & 0xff0000) >> 16) / 255
        let g = CGFloat((rgba & 0x00ff00) >> 8) / 255
        let b = CGFloat(rgba & 0x0000ff) / 255
        return UIColor(red: r, green: g, blue: b, alpha: 1)
    }

    /// Deepest obsidian layer (footers, wells).
    static let bgDeep = hex("#050506")
    /// Base obsidian canvas.
    static let bg = hex("#08080a")
    /// Raised obsidian (cards, bars).
    static let bg2 = hex("#0d0d10")
    /// Highest obsidian (hover, emphasis).
    static let bg3 = hex("#121217")
    /// Card surface.
    static let surface = hex("#101014")
    /// Secondary surface.
    static let surface2 = hex("#17171d")
    /// Strong surface (dialogs, sheets).
    static let surfaceStrong = hex("#15151b")

    // MARK: - Text ramp

    /// Primary text.
    static let text = hex("#f0f0f2")
    /// Secondary text.
    static let text2 = hex("#b8b8c0")
    /// Muted text / labels.
    static let textDim = hex("#87878f")
    /// Faint text / metadata.
    static let textFaint = hex("#5d5d66")

    // MARK: - Atmosphere (the only accent family)

    /// Violet — the AKBARAL! accent.
    static let accent = hex("#9790f2")
    /// Indigo — accent companion.
    static let accent2 = hex("#7378e8")
    /// Text on accent fills.
    static let onAccent = hex("#0b0b0d")
    /// Cyan — live/running telemetry only.
    static let telemetry = hex("#8fc7de")

    // MARK: - Status

    /// Success / completed / active.
    static let statusGreen = hex("#7fc9a4")
    /// Failure / blocked / disabled.
    static let statusRed = hex("#e58a97")
    /// Pending / queued / retrying.
    static let statusAmber = hex("#dcb26a")
    /// Informational.
    static let statusBlue = hex("#9db1e0")

    // MARK: - Spacing (pt)

    enum Spacing {
        static let xs: CGFloat  = 4
        static let sm: CGFloat  = 8
        static let md: CGFloat  = 12
        static let lg: CGFloat  = 16
        static let xl: CGFloat  = 22
        static let xxl: CGFloat = 30
    }

    // MARK: - Radii (pt)

    enum Radius {
        static let sm: CGFloat   = 4
        static let md: CGFloat   = 8
        static let lg: CGFloat   = 12
        static let xl: CGFloat   = 18
    }

    // MARK: - Typography scale

    enum Type {
        static let micro: CGFloat    = 11   // uppercase, tracking +2
        static let xs: CGFloat       = 13
        static let body: CGFloat     = 15
        static let md: CGFloat       = 17
        static let heading: CGFloat  = 19
        static let xl: CGFloat       = 24
        static let xxl: CGFloat      = 30
        static let display: CGFloat  = 34
    }

    // MARK: - Motion (honor UIAccessibility.isReduceMotionEnabled)

    enum Motion {
        static let instant: TimeInterval   = 120.0 / 1000
        static let fast: TimeInterval      = 200.0 / 1000
        static let base: TimeInterval      = 320.0 / 1000
        static let slow: TimeInterval      = 560.0 / 1000
        static let cinematic: TimeInterval = 900.0 / 1000
    }

    // MARK: - Agent identity (sigil)

    /// Deterministic indigo→violet band (222..299) for an agent.
    /// Mirrors agentHue() in mobile/src/theme.ts and public/app.js.
    static func agentHue(name: String, category: String = "") -> CGFloat {
        var hash: UInt32 = 0x811c9dc5
        for byte in (name + "|" + category).utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 0x01000193
        }
        return CGFloat(222 + Int(hash % 78))
    }

    /// Agent monogram: initials of the first two words (or first two chars).
    static func agentMonogram(_ name: String) -> String {
        let words = name.trimmingCharacters(in: .whitespaces)
            .components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        guard let first = words.first else { return "A" }
        if words.count == 1 { return String(first.prefix(2)).uppercased() }
        return String([first.first!, words[1].first!]).uppercased()
    }

    /// Primary gradient: indigo → violet (buttons, marks, emphasis).
    static let accentGradient = [accent2.cgColor, accent.cgColor]
}
