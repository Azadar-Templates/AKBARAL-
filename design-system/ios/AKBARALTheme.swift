// ============================================================
// AKBARALTheme.swift — AKBARAL! Design System tokens for iOS.
//
// GENERATED from design-system/tokens.json (v2.0.0) —
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
    static let bgDeep = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#050506") : hex("#e3e3e8")
    }
    /// Base obsidian canvas.
    static let bg = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#08080a") : hex("#ededf0")
    }
    /// Raised obsidian (cards, bars).
    static let bg2 = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#0d0d10") : hex("#f2f2f5")
    }
    /// Highest obsidian (hover, emphasis).
    static let bg3 = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#121217") : hex("#e6e6ea")
    }
    /// Card surface.
    static let surface = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#101014") : hex("#fcfcfd")
    }
    /// Secondary surface.
    static let surface2 = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#17171d") : hex("#f2f2f5")
    }
    /// Strong surface (dialogs, sheets).
    static let surfaceStrong = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#15151b") : hex("#fcfcfd")
    }

    // MARK: - Text ramp

    /// Primary text.
    static let text = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#f0f0f2") : hex("#16161a")
    }
    /// Secondary text.
    static let text2 = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#b8b8c0") : hex("#3c3c44")
    }
    /// Muted text / labels.
    static let textDim = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#87878f") : hex("#5a5a63")
    }
    /// Faint text / metadata.
    static let textFaint = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#5d5d66") : hex("#7b7b84")
    }

    // MARK: - Atmosphere (the only accent family)

    /// Violet — the AKBARAL! accent.
    static let accent = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#9790f2") : hex("#6f68d8")
    }
    /// Indigo — accent companion.
    static let accent2 = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#7378e8") : hex("#5459cc")
    }
    /// Text on accent fills.
    static let onAccent = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#0b0b0d") : hex("#ffffff")
    }
    /// Cyan — live/running telemetry only.
    static let telemetry = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#8fc7de") : hex("#2e7d9e")
    }

    // MARK: - Status

    /// Success / completed / active.
    static let statusGreen = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#7fc9a4") : hex("#2e7d52")
    }
    /// Failure / blocked / disabled.
    static let statusRed = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#e58a97") : hex("#b0455a")
    }
    /// Pending / queued / retrying.
    static let statusAmber = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#dcb26a") : hex("#96702a")
    }
    /// Informational.
    static let statusBlue = UIColor { trait in
        trait.userInterfaceStyle == .dark ? hex("#9db1e0") : hex("#44599e")
    }

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
