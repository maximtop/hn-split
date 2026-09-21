# Post-MVP roadmap criteria

Hacker News remains the only discussion source. This document defines how to
evaluate later work; it does not approve Reddit, Lobsters, keyboard shortcuts
or new layouts. Support procedures can be ready before launch evidence exists.
The evidence-backed ordering of post-MVP work remains pending.

Use the existing launch baseline, reader-validation notes and release-health
checkpoints. Start with unresolved privacy/user-control and core-flow defects;
then compare recurring friction using linked, deduplicated reports. Record
whether a signal is a reader observation, public issue/review, maintainer
dogfood result or hypothesis. A maintainer idea or a repeated cross-post is not
independent user demand. Diagnostic logs are for debugging, not feature analytics.

For each candidate, record the problem, safe evidence links, affected flow,
workaround, confidence and missing evidence, expected benefit, maintenance cost,
permission/privacy impact, and an observable acceptance check. Avoid numerical
scores that pretend unknown reach or retention has been measured.

| Candidate | Evidence needed before choosing work | Feasibility and scope gate |
| --- | --- | --- |
| Reddit discussions | Independent reports that useful article discussions are missing from the HN-only flow, with safe public examples | Verify current documented API/terms, exact URL matching and a sustainable credential-free path; retain explicit selection, minimal permissions and no authenticated actions. If that cannot work, defer. |
| Lobsters discussions | Independent examples of the same unmet reading need on Lobsters | Verify a documented public lookup path and exact matching with realistic duplicates/error cases; no scraping-based promise or backend added by default. |
| Keyboard shortcuts | Observed keyboard friction or an accessibility barrier in a specific existing action | Check documented browser commands, conflicts/discoverability and keyboard/screen-reader behavior; a shortcut must remain an explicit action. Accessibility defects take precedence over convenience requests. |
| Richer layouts | Repeated difficulty in the existing panel or adjacent-tab flow, with a clear reading/accessibility outcome | Use documented browser capabilities; preserve the user's article, explicit tab actions, the real HN page and the disclosed temporary framing boundary. No automatic rearrangement or article-page injection. |

After the launch checkpoints, the product owner chooses one next improvement
or explicitly defers the decision. Link existing issues before creating work.
Record the decision date, supporting and conflicting evidence, expected outcome,
alternatives, owner and review point. A scope expansion also needs an explicit
product decision and updated privacy/permission review before implementation.

If feedback, store access or release-readiness evidence is missing, record that
gap and the next observation needed. Do not mark the roadmap criterion complete
because these criteria or empty templates were written. Market demand, retention,
and feedback conclusions require actual observations.
