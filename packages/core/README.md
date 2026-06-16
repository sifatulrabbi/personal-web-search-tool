# @sifatul-web-search-tool/core

Programmatic Google search using your own Chrome profile — no API key, no depersonalized results. **macOS and Linux** (Windows is not supported).

Built with **Bun**, **TypeScript**, and **Playwright** (`channel: 'chrome'`).

---

## Why

The Google Search API returns depersonalized results and requires an API key with usage quotas.
This library drives your **real, installed Chrome** with your **real Google account** so you get the same
results you see in your browser.

---

## Requirements

- [Bun](https://bun.com) v1.0+
- Google Chrome installed (located automatically via Playwright's `channel: "chrome"` on macOS/Linux)
- Chrome must be **fully closed** before starting (profile lock)

---

## Install

```bash
# in your project
bun add @sifatul-web-search-tool/core playwright-core turndown @mozilla/readability linkedom
```

> `linkedom` provides a DOM for Mozilla Readability to parse against, since the
> Bun/Node runtime has no global `DOMParser`.

> `playwright-core` (~4 MB) is used instead of the full `playwright` package (~35 MB)
> because this library drives your **installed Chrome** via `channel: 'chrome'` rather
> than Playwright's bundled browsers.

---

## Quick Start

```ts
import {
  init,
  search,
  searchWithContent,
  close,
} from "@sifatul-web-search-tool/core";

// 1. Start Chrome with your real profile
await init();

// 2a. Simple search — returns titles, URLs, and snippets
const { results, url } = await search("bun javascript runtime");
console.log(results);
// [{ rank: 1, title: "…", url: "https://…", snippet: "…" }, …]

// 2b. Search + fetch each result page as Markdown
const { results: full } = await searchWithContent("bun runtime", {
  maxResults: 5,
});
full.forEach((r) => console.log(r.title, r.content.slice(0, 200)));

// 3. Shut down Chrome when done
await close();
```

---

## API Reference

### `init(deps?)`

Starts Chrome with your profile. Safe to call multiple times (idempotent) and safe to call
concurrently — only one Chrome instance is ever created.

```ts
await init(); // macOS defaults
await init({ userDataDir: "/custom/path" }); // override profile path
await init({ headless: true }); // CI / no-display environments
```

### `search(query, options?)`

Performs a Google search and returns structured results.

```ts
const { results, url } = await search("bun runtime site:github.com", {
  maxResults: 5,
});
```

Each result object:

| Field        | Type      | Description                      |
| ------------ | --------- | -------------------------------- |
| `rank`       | `number`  | 1-based rank                     |
| `title`      | `string`  | Result title                     |
| `url`        | `string`  | Full URL                         |
| `snippet`    | `string`  | Description text                 |
| `displayUrl` | `string?` | Human-readable domain (optional) |

### `searchWithContent(query, options?)`

Like `search()` but also fetches each result page and extracts its main content as Markdown using
Mozilla Readability.

```ts
const { results } = await searchWithContent("typescript tutorial", {
  maxResults: 3,
});
// results[0].content  →  Markdown string of the landing page
```

### `close()`

Shuts down Chrome and releases resources. Safe to call even if `init()` was never called,
or if `init()` failed partway through. After `close()`, `init()` can be called again
to start a fresh Chrome instance.

```ts
await close();
```

---

## Supported Google Operators

Pass a raw query string with any of these operators:

| Operator            | Example             | Description                           |
| ------------------- | ------------------- | ------------------------------------- |
| `site:`             | `site:github.com`   | Restrict to a domain                  |
| `filetype:`         | `filetype:pdf`      | Restrict to a file type               |
| `inurl:`            | `inurl:download`    | Keyword must appear in the URL        |
| `intitle:`          | `intitle:rust`      | Keyword must appear in the page title |
| `"phrase"`          | `"exact match"`     | Exact phrase match                    |
| `-term`             | `-npm`              | Exclude a term                        |
| `after:YYYY-MM-DD`  | `after:2024-01-01`  | Results after this date               |
| `before:YYYY-MM-DD` | `before:2024-12-31` | Results before this date              |

---

## ⚠️ Important Notes

### Result limits & pagination

Google returns ~10 organic results per page. `maxResults` only trims that page,
so values above ~10 don't fetch more — pass `page` (0-based) to fetch later pages:

```ts
await search("bun runtime", { page: 1 }); // results 11–20
```

> The underlying URL still sends `num=10`, but Google has largely deprecated the
> `num` parameter, so per-page count is best-effort. Treat `page` as the reliable
> way to go deeper.

### Chrome must be closed before starting

This library launches Chrome with your profile directory. If Chrome is already running,
Chrome will refuse to start (profile lock). **Quit Chrome completely before running.**

### One Chrome instance at a time

Only one process can hold a Chrome profile at once. If you need Chrome open for
manual browsing _and_ automated searches at the same time, use a separate profile
directory for the automated searches:

```ts
import os from "node:os";
import path from "node:path";

await init({
  userDataDir: path.join(
    os.homedir(),
    "Library/Application Support/Google/Chrome/Profile 2", // macOS; Linux: ~/.config/google-chrome/Profile 2
  ),
});
```

You can also set the `SWEB_SEARCH_PROFILE` env var (profile dir) or
`SWEB_SEARCH_CHROME_BINARY` (binary path) instead of passing `deps`.

### Google may show CAPTCHA

Using your real Chrome profile and real browser binary dramatically reduces the
chance of CAPTCHA challenges. If you do encounter one, solve it manually in the
Chrome window that opens, then wait for the script to continue.

### Anti-detection

The library applies the following anti-detection measures automatically:

- `navigator.webdriver` is patched to `undefined` via `context.addInitScript()`
- `--disable-blink-features=AutomationControlled` is added to Chrome launch args
- Well-known automation-flagged flags are omitted from launch args
- `--no-sandbox` is **not** used in headful mode (it weakens the sandbox on your
  real profile); it is added only when `headless: true`

---

## Running Tests

```bash
# Unit tests (no browser required)
bun run test:unit

# Integration tests (requires Chrome to be closed)
GOOGLE_SEARCH_TEST=1 bun run test:integration
```

---

## Project Structure

```
packages/core/
├── src/
│   ├── index.ts             # Public API
│   ├── browser/
│   │   ├── manager.ts       # Browser lifecycle (factory fn, no classes)
│   │   └── profile.ts       # macOS Chrome path constants
│   ├── search/
│   │   ├── filters.ts       # Google operator parser
│   │   ├── url-builder.ts   # Search URL construction
│   │   └── serp.ts          # SERP extraction
│   └── content/
│       └── extractor.ts     # Readability + Turndown → Markdown
├── tests/
│   ├── unit.test.ts         # Pure logic tests
│   └── integration.test.ts  # End-to-end browser tests
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── playwright.config.ts
```

---

## License

MIT
