# Changelog

All notable changes to HN Split are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The `version` field in `package.json` is the single source of truth; packaging injects it into every generated manifest. Before tagging a release, move the Unreleased notes into a `## [X.Y.Z] - YYYY-MM-DD` section — the release workflow uses that section as the GitHub release body and fails if it is missing.

## [Unreleased]

## [0.1.1] - 2026-08-11

### Added

- Optional active-tab following for an already-open side panel, including one-time checks, session-only result reuse, and up to three live Hacker News discussions with best-effort scroll preservation.

### Changed

- Expanded the options, privacy, lifecycle, and store-listing disclosures across all 40 supported languages to cover active-tab following and the exact Hacker News framing boundary.

### Fixed

- Prevented stale side-panel results when opening a discussion from the popup or switching, navigating, moving, replacing, and closing tabs across browser windows.
- Restricted the Hacker News framing exception to authenticated live side-panel documents and removed it after the last panel disconnects.

## [0.1.0] - 2026-08-09

### Added

- Hacker News discussion lookup for the current page from the toolbar popup, with exact-URL matching against the public Algolia API.
- Optional automatic availability badge with comment counts, off by default.
- Chrome side panel that shows the real Hacker News discussion beside the page, including the opt-in article-click flow on news.ycombinator.com and the **Open in Split** link context menu.
- Adjacent discussion tab flow that cooperates with Chrome's native Split View.
- Options page with privacy-first defaults and 40 release-reviewed localizations; English is the authored source, Russian is hand-reviewed, and the other translations receive independent multilingual semantic QA.
- Reproducible multi-browser packaging and release automation: Chrome, Edge, and Firefox store packages, a source archive for add-on review, SHA-256 checksums, provenance, and a signed-tag release workflow with a dry-run mode.
