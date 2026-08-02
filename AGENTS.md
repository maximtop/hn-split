# HN Split contributor guidance

- Keep the MVP limited to Hacker News and Chrome.
- Use React, TypeScript, Manifest V3, Rspack, and minimal permissions.
- Never open, move, or replace a tab without an explicit user action.
- One result selection must open one concrete Hacker News item URL.
- Do not imitate Split View with an iframe or undocumented Chrome API.
- Keep URL matching conservative and covered by tests.
- Do not add telemetry, a backend, credentials, or authenticated HN actions.
- Name project files with lowercase kebab-case except conventional tool files such as `README.md` and `AGENTS.md`.
- Replace repeated or domain-significant literal values with named constants; do not introduce unexplained magic values.
- Write descriptive JSDoc for every interface, each interface property or method, and every function declaration.
- Format every JSDoc comment as a multiline block; single-line JSDoc blocks are prohibited by ESLint.
- Prefer unit and integration tests for application logic; reserve E2E tests for browser-extension boundaries that cannot be verified reliably at a lower level.
- Keep E2E tests minimal and resilient: assert stable user-visible or accessibility contracts, and avoid CSS classes, generated markup, timing assumptions, and other implementation details.
- Run `pnpm verify` before committing.
