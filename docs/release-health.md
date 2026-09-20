# Release health

This is a maintainer checklist, not a record of a completed release or a
scheduled monitoring service. The release owner records results in the existing
release task or a dated release note, with evidence links and the next owner/action.
Use **pass**, **fail**, or **not checked**; unknown is never a pass.

## Checkpoints and evidence

Before publication, record the candidate tag/commit, target store, package
checksum, installed version and last verified working version. At first verified
store availability (T0), T+24h, T+48h and T+7d, repeat the health review below.
While a release remains current, review intake weekly and on any credible severe
report. This cadence can share the existing launch-plan checkpoints; do not create
a second baseline or claim that a scheduled review happened without evidence.

- [ ] Link release-readiness/dry-run evidence and the exact commit's required CI
  result, including packaged-extension and accessibility checks. An incomplete
  readiness dependency remains open even if these support docs exist.
- [ ] Record each store's observed published version, observation time and source.
  A GitHub Release, upload or successful submission is not store publication.
  Record inaccessible/pending stores separately; do not infer parity across stores.
- [ ] On the installed candidate, check a safe public article with a known HN
  item, an article without a match, a restricted page, and offline/error recovery.
  Record the fixture and result, without personal browsing data.
- [ ] Check explicit selection opens exactly the selected HN item; adjacent-tab
  reuse and panel/sidebar opening work without unrequested tab movement. Check
  one-shot inspection with following off and tab changes with following on.
- [ ] Confirm automatic preferences are off for a fresh profile; privacy text
  matches behavior and permissions. The HN framing exception must disappear
  after the last panel closes and affect only HN sub-frames while active.
- [ ] Where Diagnostics is present, verify explicit local export, inspect its
  contents against the privacy policy, and clear the log. No automatic upload,
  URLs or raw exceptions may appear. Mark older builds without Diagnostics
  accurately rather than treating the missing control as an export failure.
- [ ] Review new/updated GitHub reports, available store reviews and private
  support reports. Record deduplicated themes, affected versions and severity;
  keep private details out of public notes. Link existing reports instead of
  opening duplicate issues.
- [ ] Check install/support/privacy links and whether store copy describes the
  actually available version. Route publication or listing drift to the existing
  publication task; do not silently submit or publish as a health check.
- [ ] Record a decision: continue observation, investigate, hold publication,
  or prepare rollback/hotfix, with evidence, owner and next checkpoint.

Store review checks are manual or use an already authorized read-only API/export.
Use publisher dashboards only when available and authorized. If access is blocked,
record **not checked** and who must perform the review. Do not scrape accounts,
collect browsing histories or install analytics to fill a gap.

Built-in store aggregates may inform launch work when available: record the
store's own metric name, date range, definition and any reporting delay alongside
the value. Link the existing launch baseline. Installs, uninstalls, active users,
ratings and listing views are different measures; do not turn them into an
invented retention rate or causal claim. No reports means no observed reports,
not proof of a healthy installed population.

## Severity and rollback criteria

These are operational triggers, not measured failure rates. A severe reproducible
defect does not need a minimum user count; store ratings alone are not a trigger.

| Severity | Evidence/threshold | Required response |
| --- | --- | --- |
| Critical | One confirmed privacy boundary violation (for example URL/secret leakage in diagnostics or an unauthorized outbound transfer), framing rule outside its documented scope/lifetime, or opening/moving/replacing tabs without an authorized action | Hold further publication immediately; contain the affected feature/version and prepare rollback or hotfix before resuming. A credible unconfirmed report pauses publication while the owner verifies it. |
| High | One reproducible release regression that selects the wrong HN item or blocks the core article-to-discussion flow on a supported browser with no safe workaround, including an accessibility blocker | Hold publication for the affected target; compare with the known working version and prepare rollback/hotfix. Resume only with reproduction evidence that the defect is fixed. |
| Medium | A confirmed problem with a safe workaround, such as panel framing failure while explicit adjacent-tab opening still works | Document the workaround, affected scope and owner; prioritize a fix. Escalate if privacy/user control or the fallback also fails. |
| Low | Cosmetic/copy defect or an enhancement with the core flow intact | Triage normally and gather evidence; no rollback solely for this finding. |

For an HN/Algolia outage reproduced independently of the release, preserve the
error state and explicit fallback; do not assume an older extension will repair
the service. Reassess severity if the extension handles the outage unsafely.

## Containment and recovery

1. Record the affected version/target, safe reproduction, incident owner,
   candidate cause and last verified working tag. Stop further submissions and
   final publication of the affected candidate. Do not publish a staged build
   just to clear a deployment error.
2. Choose a verified workaround: disable the affected opt-in, use explicit
   adjacent-tab opening for a panel-only failure, or disable the extension for
   a privacy/user-control incident. Export is optional and must not delay
   containment. Any public advisory or reply requires the owner's authorization.
3. If cancellation, pause or withdrawal is available, the authorized publisher
   checks current store capabilities before acting. Removing a listing or
   cancelling a pending update does not fix copies already installed.
4. Prefer reverting the offending change on current master and shipping a new,
   higher patch version through [the normal release process](RELEASE.md).
   Confirm the previous behavior is safe with current dependencies and privacy
   requirements; do not blindly rebuild an old tag or remove unrelated fixes.
   Do not overwrite release assets/tags, lower the package version, assume stores
   permit downgrades, or direct users to sideload an unverified archive.
5. Require a regression test for the incident plus the normal verification and
   package checks. Record independent store approval/publication and installed
   fixed versions. Leave the incident open for targets not yet confirmed fixed.
6. At the next health checkpoint, recheck the failing scenario, remaining reports
   and mitigation. Close with the actual resolution/version and evidence; keep
   release, publication and roadmap tasks separate when their criteria remain open.

## Health record to copy

```text
Checkpoint / UTC time / owner:
Candidate tag + commit / target store / checksum:
Observed published and installed versions (source + time):
Last verified working version:
Readiness and CI evidence:
Smoke/privacy/accessibility results (pass/fail/not checked + evidence):
New report themes and canonical links (private details excluded):
Store reviews/aggregates (source, time range, limits; or not checked):
Severity / workaround / decision and reason:
Remaining blockers / next action / owner / checkpoint:
```
