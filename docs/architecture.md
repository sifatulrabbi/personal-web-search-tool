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

- `search()` creates a fresh page and closes it in a `try/finally` block
- `searchWithContent()` opens one isolated page **per result URL** and closes each
  in a `finally` block — so concurrent extractions never share a page (a shared
  page cannot service concurrent `goto()` calls)
- `newPage()` truly creates a new page each call (it does not reuse a singleton)

`close()` suppresses the expected `"Target closed"` noise from Playwright while
logging any unexpected errors to `console.error`.

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
         createPageContentExtractor(newPage)   // fresh page per URL
              │
              ▼
         extractor.extract(url)
              │   (page.goto → outerHTML)
              ▼
         htmlToMarkdown(html)   // linkedom → Readability → Turndown
              │
              ▼
         SearchResultWithContent[]
```

> **Why `linkedom`?** Mozilla Readability needs a DOM `document`, but the Bun/Node
> runtime has no `DOMParser`. `htmlToMarkdown()` parses the page HTML with
> `linkedom` (a lightweight standards-compliant DOM) rather than a browser global.

---

## Selector Fragility Note

Google's SERP CSS class names change without notice. All selectors are defined
in `src/search/serp.ts` in a single `SELECTORS` constant object for easy updates.

If extraction returns empty results after a Google UI update:

1. Inspect the live SERP in Chrome DevTools
2. Update the selectors in `SELECTORS`
3. No other files need changing

---

## Anti-Detection

Google's bot-detection (reCAPTCHA / "Are you a human?") is triggered by
automation fingerprints in the browser. Three measures are applied:

1. **`navigator.webdriver` patch** — Playwright always sets
   `navigator.webdriver = true`. An init script registered once via
   `context.addInitScript()` redefines the getter to return `undefined` on every
   page (current and future) before any navigation occurs. (Registering per-page
   after the `"page"` event raced with the first navigation.)

2. **`--disable-blink-features=AutomationControlled`** — added to the Chrome
   launch args so Chrome does not expose `AutomationControlled` as an enabled
   blink feature, which is another signal Google inspects.

3. **Removed automation-flagged Chrome switches** — `--disable-background-timer-throttling`,
   `--disable-backgrounding-occluded-windows`, and `--disable-renderer-backgrounding`
   were dropped: they are well-known automation flags that flag the browser
   as non-human.

`--no-sandbox` is also kept out of headful runs — disabling the sandbox on your
real, logged-in profile is a security risk and is unnecessary outside
containers. It is added only when `headless: true` (CI / container use).

The user's real Chrome profile (`userDataDir`) provides cookies, history, and
login state — the strongest CAPTCHA-avoidance signal. Without a real profile
(i.e. using a blank `--user-data-dir`), Google will still challenge the
browser even with these patches.

---

## Profile Lock Strategy

Chrome uses file locking on the `userDataDir` — only one process may hold it at a time.

**Current (Managed mode):** The library launches Chrome with `launchPersistentContext`
which holds the lock exclusively. The user must close Chrome before running.

**Future (Attach mode):** Use `chromium.connectOverCDP('http://localhost:9222')` to
connect to an already-running Chrome instance launched with `--remote-debugging-port=9222`.
This avoids the lock conflict but means the user manages Chrome manually.
