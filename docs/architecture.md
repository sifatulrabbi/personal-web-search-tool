# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    google-search-core                    │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
│  │  index   │──▶│browser/  │   │   search/         │   │
│  │  (API)   │   │manager.ts│   │ filters.ts        │   │
│  └──────────┘   └──────────┘   └──────────────────┘   │
│       │              │                   │               │
│       │              ▼                   ▼               │
│       │   ┌──────────────────┐  ┌──────────────┐       │
│       │   │  profile.ts      │  │ url-builder  │       │
│       │   └──────────────────┘  └──────────────┘       │
│       │              │                   │               │
│       │              ▼                   ▼               │
│       │    ┌─────────────────────────────────────┐       │
│       │    │   Playwright PersistentContext      │       │
│       │    │   (your Chrome + profile)           │       │
│       │    └─────────────────────────────────────┘       │
│       │                         │                       │
│       │                         ▼                       │
│       │    ┌─────────────────────────────────────┐       │
│       └───▶│   search/serp.ts                    │       │
│            │   (extract results from SERP)       │       │
│            └─────────────────────────────────────┘       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  content/extractor.ts                            │   │
│  │  Readability + Turndown → Markdown               │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Design Principles

### 1. No Classes — Plain Functions & Factory Pattern

All browser lifecycle logic is encapsulated in `createBrowserManager()`, a factory
function that returns a plain object with methods. This avoids `this` binding issues,
is trivially mockable in tests, and composes cleanly.

### 2. Dependency Injection via Factory Arguments

`createBrowserManager(deps)` accepts an optional `BrowserManagerDeps` record,
making it trivial to swap the Chrome binary path, profile directory, or headless
mode in tests or alternative environments.

### 3. Single Responsibility Modules

Each file owns one concern:

- **`browser/`** — Chrome binary and profile resolution, lifecycle management
- **`search/`** — Query parsing, URL construction, SERP scraping
- **`content/`** — Page content extraction and HTML→Markdown conversion

### 4. Idempotent & Concurrent-Safe Lifecycle

`init()` is safe to call multiple times and safe to call concurrently — a
promise guard ensures only one Chrome instance is ever created. `close()` is
safe to call without `init()`, and after `close()` the library can be fully
re-initialised. `start()` on the manager returns the existing context if
already started.

### 5. Managed Chrome Lifecycle

The library owns Chrome — it starts it on `init()` and closes it on `close()`.
Only one Chrome instance is ever created per manager, preventing profile lock
conflicts. Attach mode (connecting to an externally-launched Chrome via CDP)
can be added by replacing `launchPersistentContext` with `chromium.connectOverCDP`.

### 6. Resource Safety

Every Playwright `Page` created by the library is eventually closed:

- `search()` closes its page in a `try/finally` block
- The content-extraction page is closed by `dispose()` called from `close()`
- If page or extractor creation fails, the page is closed before the error propagates

All `close()` and `dispose()` calls suppress the expected `"Target closed"` noise
from Playwright while logging any unexpected errors to `console.error`.

---

## Data Flow

```
User Query (string)
    │
    ▼
parseFilters()          ──►  ParsedQuery
    │
    ▼
buildSearchUrl()        ──►  https://www.google.com/search?…
    │
    ▼
browser.goto(url)       ──►  Chrome navigates to SERP
    │
    ▼
extractSearchResults()  ──►  SearchResult[]
    │
    ├──► returned directly              (search)
    │
    └──► each URL fetched + extracted   (searchWithContent)
              │
              ▼
         createPageContentExtractor(page)
              │
              ▼
         extractor.extract(url)  ──►  Markdown string
              │
              ▼
         SearchResultWithContent[]
```

---

## Selector Fragility Note

Google's SERP CSS class names change without notice. All selectors are defined
in `src/search/serp.ts` in a single `SELECTORS` constant object for easy updates.

If extraction returns empty results after a Google UI update:

1. Inspect the live SERP in Chrome DevTools
2. Update the selectors in `SELECTORS`
3. No other files need changing

---

## Profile Lock Strategy

Chrome uses file locking on the `userDataDir` — only one process may hold it at a time.

**Current (Managed mode):** The library launches Chrome with `launchPersistentContext`
which holds the lock exclusively. The user must close Chrome before running.

**Future (Attach mode):** Use `chromium.connectOverCDP('http://localhost:9222')` to
connect to an already-running Chrome instance launched with `--remote-debugging-port=9222`.
This avoids the lock conflict but means the user manages Chrome manually.
