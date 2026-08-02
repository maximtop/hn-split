# HN Split contributor guidance

- Keep the MVP limited to Hacker News and Chrome.
- Use React, TypeScript, Manifest V3, and minimal permissions.
- Never open, move, or replace a tab without an explicit user action.
- One result selection must open one concrete Hacker News item URL.
- Do not imitate Split View with an iframe or undocumented Chrome API.
- Keep URL matching conservative and covered by tests.
- Do not add telemetry, a backend, credentials, or authenticated HN actions.
- Run `corepack pnpm check` before committing.
