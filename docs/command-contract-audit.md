# Personal extension command audit

Audit date: 2026-09-20. Changes are based on freshly fetched `origin/master`,
not the older main checkouts. Other repositories use isolated worktrees under
`/Users/maximtop/.codex/worktrees/extension-command-contract/<repository>` on
`fix/developer-command-contract`; the active checkouts were not edited.

## Scope and publication evidence

| Repository | Audited commit | Publication evidence |
| --- | --- | --- |
| HN Split | `4cc6163` | [Chrome listing](https://chromewebstore.google.com/detail/split-for-hacker-news/jmocibcalpebojmljmhlkeackggnkhfm), linked from README and the personal website |
| Kode Injector | `a53cb5b` | [Chrome listing](https://chromewebstore.google.com/detail/kode-injector/fgdehkdkmaiedleekbjpfoicpmodbicg), README and personal website; [Notion Firefox publication record](https://www.notion.so/3a903d59105281858953d7ca8456cfec) |
| Hide Upgrade Button | `feeba1e` | [Chrome listing](https://chromewebstore.google.com/detail/hide-upgrade-button-for-g/flakajdfnklpgiefoffmecgbfbckmpcb), linked from the personal website; [Notion launch record](https://www.notion.so/3ae03d59105281068887c5b0350ef6bb) |
| Extensions Update Tracker | `52490fa` | [Chrome listing](https://chromewebstore.google.com/detail/cdgepknigaiclfdmjckaknepgcighbnh), README and personal website |
| No More Ago | `968babe` | [Notion release audit, 2026-09-19](https://www.notion.so/3c503d59105281a1b72ef89d836a3ed3): Chrome 0.1.0 and Firefox 0.1.1 published; older local README was stale |
| Website Blocker | `11edac1` | [Chrome listing](https://chromewebstore.google.com/detail/website-blocker-by-mt/enffllmgjpgoifnfeljkfhpedcadnpbj), README and personal website; [Notion project](https://www.notion.so/13d03d5910528024bebed19e0740b90c) |
| AI AdBlocker | `61b1312` | [Chrome listing](https://chromewebstore.google.com/detail/ai-adblocker/icmfnmnifkggchbpaikgbpoenjgkkofb), README and personal website |

These are publication records and repository metadata, not a fresh installation
or store-dashboard audit. GitHub metadata confirms these seven repositories are
personal non-forks. The website portfolio identifies the first six products
except No More Ago, whose newer publication is documented in Notion.

Excluded: `extensions-update-notifier-chrome-extension` is a fork of
`beaufortfrancois/extensions-update-notifier-chrome-extension`, with the original
author's store listing; `gmail-conversation-reversal` has a third-party origin;
Phrase Lens still has a placeholder store link. AdGuard repositories, desktop
applications, and unlaunched ideas are outside this change.

## Before the changes

All seven projects already use pnpm. `C/E/F` below means Chrome/Edge/Firefox;
these are build capabilities, not claims of publication in every store.

| Repository | Install | Development / watch | build | Checks | Local package / release | Targets and outputs |
| --- | --- | --- | --- | --- | --- | --- |
| HN Split | `make init`, `pnpm install` | `pnpm dev` once; `make start` called a missing script | production in root `dist` | `check`, browser-inclusive `verify` | `pnpm release` | Rspack C/E/F; `build/release/<browser>` and adjacent ZIPs |
| Kode Injector | `make install` | `dev` built C/E/F; `start` watched Chrome | Make alias for release; no pnpm build | `check` / `validate` | `pnpm release` | Rspack C/E/F, explicit Safari; `build/{dev,release}/<browser>` |
| Hide Upgrade Button | `make install` | `dev` built C/E/F; `start` watched Chrome | pnpm alias for release; Make ignored the selected browser | `check` / `validate` | `pnpm release` | Rspack C/E/F; `build/{dev,release}/<browser>` |
| Extensions Update Tracker | `make init` | `make dev` built Chrome; `start` watched Chrome | development | `pnpm check`; `make test` also ran E2E | `pnpm release` | Rspack C/E/F; `dist/{dev,beta,test,release}/<browser>`; Make exposed Chrome only |
| No More Ago | `pnpm install` | `dev` built C/E/F; watch required explicit browser | absent | `pnpm check` | `pnpm release` | Rspack C/E/F; `dist/{dev,release}/<browser>` |
| Website Blocker | `make init` | `start` watched all default targets | development, all C/E/F | `pnpm check` | `pnpm release` | Webpack C/E/F; `dist/{dev,release}/<browser>` |
| AI AdBlocker | `make init` | `dev` called missing `build:watch` | Rollup plus implicit postbuild ZIP | lint/type-check and test separately | implicit `dist/extension.zip` | Rollup, Chrome only; `dist` |

The newer HN Split master already contains a phony Makefile, but `build` still
selects production and root `dist`, while `start` references a missing script.
It also replaced the old `build/artifacts`, provenance, and source-packaging
implementation with the shared release workflow. Restoring that superseded
pipeline would undo newer work. Release ZIP names, `SHA256SUMS.txt`, source
archives, and deployment calls therefore remain governed by current CI.

## Chosen contract

| Command | Meaning |
| --- | --- |
| `make install` / `pnpm install` | Install dependencies; Make also accepts `setup` and legacy `init` |
| `make build [browser]` / `pnpm build [browser]` | One-shot development build; default Chrome |
| `make dev [browser]` / `pnpm dev [browser]` | Same development build |
| `make start [browser]` / `pnpm start [browser]` | Watch the selected development build; default Chrome |
| `make release [browser]` / `pnpm release [browser]` | Local production bundle and ZIP; default existing store-target set |
| `make package [browser]` / `pnpm package [browser]` | Alias for local release packaging |
| `make check` / `pnpm check` | Existing static checks and unit/integration tests; HN Split also smoke-builds |
| `make lint`, `make typecheck`, `make test` | Corresponding direct pnpm check |

This preserves the existing one-shot meaning of `dev` in the six Rspack/Webpack
projects and the existing local-only meaning of `release`. It fixes ambiguous
`build` and broken `start` commands without introducing a shared framework.
Make defaults to `build`, marks command targets phony, rejects unknown browsers
before recipes run, and propagates command failures. Native CLIs also reject
unknown browser arguments; Website Blocker and Update Tracker previously
accepted extra arguments silently.

Development now defaults to Chrome in the native CLIs as well as Make. Existing
callers that need other development targets select them explicitly. All current
release CI calls keep the same production meaning. Store upload/publish recipes
remain separate and were not executed.

## Changes and retained differences

- HN Split: canonical development output `build/<browser>`, shared validated
  path resolution for Rspack, release, E2E, and screenshot capture; production
  output stays `build/release/<browser>`. Selected builds clean only their own
  directory, and selected release packaging preserves sibling archives.
- Kode Injector and Hide Upgrade Button: development `build` alias, standard
  package/watch/check wrappers, Chrome development default, existing output
  layout retained. Kode's explicit Safari target remains a web-extension build;
  macOS app packaging, signing, and upload remain separate.
- No More Ago: standard wrappers and Chrome development default; adapted
  artifact tests still exercise all browsers explicitly.
- Website Blocker and Update Tracker: standard wrappers, strict argument
  handling, and existing bundlers, channels, output layouts, and ZIP names.
- AI AdBlocker: working one-shot and watch commands; ZIP creation moved from
  implicit postbuild to explicit release/package. It retains the original
  unminified Rollup bundle for both modes and does not gain another bundler.
- Each repository documents the shared commands and its actual output paths.
  Root `dist` is eliminated from HN Split workflows only; moving other projects'
  established `dist` outputs would add churn without improving command meaning.

## Validation

| Repository | `pnpm check` | Build, rebuild, target rejection | Watch startup | Two local package runs |
| --- | --- | --- | --- | --- |
| HN Split | 816 tests passed | Passed | Passed | Identical ZIP bytes |
| Kode Injector | 432 tests passed | Passed | Passed | Identical payloads; timestamps differ |
| Hide Upgrade Button | 164 tests passed | Passed | Passed | Identical ZIP bytes |
| Extensions Update Tracker | 184 tests passed | Passed | Passed | Identical payloads; timestamps differ |
| No More Ago | 1,870 tests passed | Passed | Passed | Identical ZIP bytes |
| Website Blocker | 301 tests passed after rebase | Passed | Passed | Identical payloads; timestamps differ |
| AI AdBlocker | 125 tests passed | Passed | Passed | Identical payloads; timestamps differ |

Each build smoke check invokes `make build` twice with existing output, checks
MV3/version/background in the generated manifest, verifies obsolete output is
removed, and checks Make and pnpm reject an unsupported browser. Multi-target
projects preserve a sibling marker. HN Split additionally has a repository
regression test that recreates a deleted background bundle, preserves markers
in `edge`, `firefox`, `artifacts`, `ci-artifacts`, and `release`, rejects traversal,
and substitutes a failing pnpm executable to verify Make's nonzero exit status.

Each packaging run used `make package` and inspected every emitted store ZIP's
manifest, package version, browser-specific background, and ZIP integrity.
The four nonreproducible packagers retain their existing filesystem/current
ZIP timestamps: a follow-up Chrome comparison found identical decompressed
payloads with differing timestamps. This change does not claim to make those
packagers reproducible. HN Split's selected Chrome package also preserves the
existing Edge ZIP and Firefox output directory.

`make start` produced the initial Chrome artifact and stayed running in all
seven repositories; the test then terminated its own process group. These watch
checks did not launch a browser. Existing No More Ago tests also cover watcher
rebuild behavior.
Final whitespace checks passed, and original checkout status matches the initial
inventory (including Kode's Safari fixture and Update Tracker's `.sdd`).

## Remaining limits and handoff

- HN Split `pnpm verify` passed on 2026-09-20 after browser permission was
  granted: lint, typecheck, locale/store validation, 816 Vitest tests, development
  builds, and all 18 Playwright E2E tests (23.3 seconds), including accessibility.
  Chrome ran headlessly with unique temporary profiles and locally fulfilled
  fixtures; no shared HTTP port or neighbouring worktree was used. The first
  sandboxed attempt could not launch Chrome; the authorized run outside the
  sandbox completed with exit code 0. Log: `build/ci-artifacts/command-contract-verify.log`.
- Store screenshot capture was not rerun. MT-1005 has not been marked Done:
  implementation is submitted for draft review and has not been merged.
- Packaging reproducibility applies to current local browser ZIPs. GitHub source
  archive/checksum generation and store submissions remain in the unchanged
  release workflows; no release workflow, tag, store upload, or release was triggered.
- Safari remains an explicit Kode Injector capability; native app packaging and
  signing were not exercised by this command-only change.
- Changes are maintained on `fix/developer-command-contract` in all seven
  repositories. HN Split lives in the current task worktree; the other six
  worktrees live in the permanent directory listed above. The temporary
  validation directory contains logs only, not the implementation worktrees.


## Review handoff

Each repository has a separate change on `fix/developer-command-contract` for
review against `master`; no branch is authorized for automatic merge. The bases
were fetched again before submission. Website Blocker was rebased onto `11edac1`
(PR #21), preserving its 40-language timer localization; frozen installation,
`pnpm check` (301 tests), `make build`, and `make package` passed after the rebase.
The other six bases were unchanged, so their completed checks were retained.

HN Split's independent [MT-997 product-copy PR](https://github.com/maximtop/hn-split/pull/35)
was merged into `master` as `f892578`. A merge-tree check confirms the command
branch combines without conflicts and preserves its product/privacy/browser
copy. Its worktree, and the other active No More Ago and Update Tracker
worktrees, were not edited. PR links are recorded in MT-1005.

### Article-click E2E diagnosis

The initial [PR #36 CI run](https://github.com/maximtop/hn-split/actions/runs/35500328350)
and its single rerun each passed 17 of 18 E2E tests. The article-click test lost
STORY_TWO: one run failed its final assertion, the other timed out waiting for
the second selection. The retained trace showed the window projection changing
from a discussion for the article tab to `manual_required` for a different tab.

Temporary browser-event and storage diagnostics identified that tab as options.
Playwright clicks do not activate a background page: options remained active
while the test clicked HN. When the native side panel connected, its ordinary
active-tab synchronization replaced the selection with the options projection.
The assertion raced panel startup; changing E2E from production to development
made this existing fixture error visible in CI.

Controlled comparison used exact master `f892578` and PR head `92cd3b4`, the same
installed Chromium/toolchain, development mode, local routes, and fresh profiles.
The original scenario passed five consecutive runs on each. Adding a diagnostic
500 ms pause only before reading the first selection reproduced the failure on
both: the article association still held STORY_ONE, but the window projection
was `manual_required` for the active options tab. No application code or Chrome
API result was replaced by the diagnostic.

The correction activates the intended tab before interaction and checks full
panel content, including its owning tab ID. After disabling article clicks and
navigating away, it expects manual content for the active article tab; the old
expectation incorrectly required a stale STORY_TWO selection from a background
tab. Both corrected scenarios passed ten consecutive development-mode runs.
Both also passed the delayed-observation probe, and the corrected test passed
against master's original production build. The final `pnpm verify` passed
all 816 unit/integration tests and all 18 E2E tests (21.3 seconds), including axe.
Temporary diagnostics are removed; application behavior, retries, and timeouts
are unchanged. Detailed local log: `build/ci-artifacts/article-click-fixed-verify.log`.
