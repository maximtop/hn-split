# Support

Report bugs or suggest improvements in [GitHub Issues](https://github.com/maximtop/hn-split/issues/new/choose).
Search open and closed issues first. If one describes the same problem, add only
new reproduction details there. Questions can use a blank issue. Reports without
logs, screenshots or URLs are welcome; support has no guaranteed response time.

## Before reporting

- Read the installed extension version from your browser's extension details.
  The repository, GitHub Release and store package can be different versions.
- Include browser and OS versions, installation source, steps, expected result
  and actual result. For intermittent problems, say how often they occur and
  whether an earlier version worked.
- Identify the flow: popup, adjacent tab, side panel/Firefox Sidebar, **Check
  this tab**, or **Open in Split**. Mention the relevant automatic badge,
  panel-follow or HN story-click setting. These opt-ins are separate.
- For wrong/missing matches, optionally provide a safe public article and its
  expected `https://news.ycombinator.com/item?id=…` discussion. Do not publish
  private or signed links. Removing tracking parameters does not guarantee
  that a URL contains no personal information.

Chrome requires version 140 or newer. Firefox 140+ uses Sidebar and omits the
HN story-click option and Chrome Split View guidance. The adjacent-tab flow
does not create Chrome Split View; pairing is a separate browser action.
These differences, restricted pages, and best-effort scroll retention are
described in the [README](../README.md) and [privacy policy](../PRIVACY.md).

## Optional local diagnostic export

Diagnostics are collected locally during the browser session; **sharing is
voluntary**, and there is no upload or telemetry switch. Builds without the
Diagnostics section can still be reported normally; do not install an unpacked
build just to provide a log.

1. If safe, reproduce the problem once. Export before restarting the browser,
   reloading, disabling or updating the extension: those actions can discard
   the session log. Avoid repeating actions that unexpectedly replace tabs.
2. Open the extension's **Options → Diagnostics → Export logs**. Labels follow
   the browser language. This saves a local `.txt` file; it does not file a report.
3. Open the file in a text editor before sharing. Its UTC filename is
   `yyyyMMdd_HHmmss_hn_split_v{version}.txt`. It is UTF-8 JSON Lines: a first line
   with `formatVersion`, `extensionVersion`, and `exportedAt`, then one event per
   line. The [developer format reference](development.md#session-diagnostics)
   describes the current version.
4. Decide whether to attach that file to your report. GitHub issues and their
   attachments are public. You may omit the file or remove entries you do not
   want to disclose; mention that it was shortened. Never add raw console logs,
   network captures, profile files or storage dumps as a substitute.
5. **Clear logs** removes only the session diagnostic record. Later activity
   can add entries again. It does not remove downloaded files or attachments
   already shared; delete your local copies separately when no longer needed.

The retained log is capped at 1,000 entries and 1 MiB, with oldest entries
removed first. Background-worker suspension alone does not erase it. Entries
contain timestamps, source context, severity, fixed event names, and limited
details such as numeric tab/window IDs, state/revision or a broad error category.
They reveal event timing and session relationships, so review them even though
they exclude page URLs, titles, content, cookies, credentials and raw error
messages/stacks. Content scripts do not contribute entries. Browser/OS versions
and preferences are not included; report relevant ones separately.

An empty file with only its metadata header is valid. The visible count is a
snapshot, not a live counter; a missing event does not prove an action never
happened. If export fails, include that fact and the visible error in the report
without extracting internal storage. The [privacy policy](../PRIVACY.md#local-diagnostics-and-support-export)
is the full data boundary.

## Private reports

For a suspected security/privacy defect or details unsafe to post publicly,
email [me@maximtop.dev](mailto:me@maximtop.dev), the contact in the privacy policy.
Start with a minimal description, affected version and safe reproduction steps;
do not send credentials, cookies or private browsing history. Ordinary bug
reports belong in GitHub Issues. If sensitive information was accidentally
posted, remove it and contact the maintainer; removal cannot recall copies
already downloaded by others.

## Maintainer triage

The repository maintainer owns intake and assigns an owner to each confirmed
problem. At each [release-health checkpoint](release-health.md), review new and
updated issues and available store reviews. No automated replies, exports or
user tracking are required.

1. Check for sensitive data before reproducing. Keep private reports private;
   put only a sanitized summary in the public tracker with the reporter's consent.
2. Search open/closed issues and PRs. Link duplicates to the canonical report;
   retain distinct affected versions and reproduction evidence. Do not count
   repeated comments or the same report copied across stores as independent users.
3. Separate installed-version defects from expected browser/privacy boundaries,
   store-listing drift, and Hacker News/Algolia availability. Ask for the smallest
   missing reproduction detail; diagnostic export is always optional.
4. Record severity, affected version/browser, reproduction status, workaround,
   owner and next action in the issue. Use the [severity table](release-health.md#severity-and-rollback-criteria)
   immediately for privacy or user-control failures. Labels are optional;
   triage must work without a custom label set or bot.
5. Reproduce on a safe public fixture, compare with the last verified working
   release, and add a behavioral regression test at the closest runtime boundary
   when fixing code. Keep external-service incidents separate from regressions.
6. When resolving a report, state the outcome: fixed with PR and version, duplicate
   with canonical link, expected behavior with explanation, or declined/deferred
   with rationale. A merged fix awaiting release must say so. Read back the saved
   status/comment; do not silently close or claim that a store update has shipped.

Keep support summaries to the minimum useful evidence. Do not copy reporter
identities, attachments or raw private messages into release notes or roadmap
tables. Respect requests to remove shared material where you control it.
