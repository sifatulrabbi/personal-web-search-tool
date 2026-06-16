# AGENTS.md

Guidance for AI agents and contributors working in this repo.

## What this is

A Bun + TypeScript monorepo that drives the user's **installed Chrome** (via
Playwright `channel: "chrome"`) to run programmatic Google searches. macOS and
Linux only — **Windows is not supported.**

- `packages/core` — the library (`init`, `search`, `searchWithContent`, `close`).
- `packages/cli` — the `sweb-search` terminal interface.

## Commands

```bash
bun install                 # install (workspace + catalog deps)
bun run typecheck           # tsc --noEmit across packages
bun run test                # all packages (integration tests self-skip)
bun run format:check        # prettier check

# core package (cd packages/core)
bun run test:unit           # fast, no browser
GOOGLE_SEARCH_TEST=1 bun run test:integration   # launches real Chrome; Chrome must be closed
```

## Conventions

- **No classes.** Use factory functions returning plain method records (see
  `createBrowserManager`).
- **Shared dep versions live in the root `package.json` `catalog`.** Reference
  them with `"catalog:"` in package manifests; don't pin versions per-package.
- Keep all SERP CSS selectors in `packages/core/src/search/serp.ts`.
- Browser config (profile dir, binary, launch args) lives in
  `packages/core/src/browser/`. Profile/binary resolution is layered:
  explicit arg > env var (`SWEB_SEARCH_PROFILE`, `SWEB_SEARCH_CHROME_BINARY`) >
  per-OS default.

## Gotchas

- **No `DOMParser` in Bun.** HTML is parsed with `linkedom` server-side
  (`htmlToMarkdown`), not browser globals. Don't reintroduce `new DOMParser()`.
- **`parseOrganicResults` is serialised into the browser by `$$eval`** — keep it
  self-contained (no module-level references, no closures), or in-browser
  extraction breaks.
- Content extraction opens one isolated page per URL; never share a single page
  across concurrent `goto()` calls.
