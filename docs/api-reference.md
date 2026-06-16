# Core API Reference

Complete API documentation for `google-search-core`.

---

## Table of Contents

1. [Public API](#public-api)
2. [Browser Layer](#browser-layer)
3. [Search Layer](#search-layer)
4. [Content Layer](#content-layer)

---

## Public API

### `init(deps?)`

Start Chrome with your user profile. Must be called before `search()` or `searchWithContent()`.

```ts
import { init } from "google-search-core";

// Use macOS defaults
await init();

// Override profile path or headless mode
await init({ userDataDir: "/custom/profile/path" });
await init({ headless: true }); // CI / no-display environments
```

Concurrent callers are safe — only one Chrome instance is ever created. Subsequent calls after a successful init are a no-op (idempotent).

**`BrowserManagerDeps`**

| Field          | Type      | Default                                                            | Description                                             |
| -------------- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `chromeBinary` | `string`  | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`     | Path to Chrome binary                                   |
| `userDataDir`  | `string`  | `/Users/sifatul/Library/Application Support/Google/Chrome/Default` | Chrome profile directory                                |
| `headless`     | `boolean` | `false`                                                            | Run Chrome without a visible window (set `true` for CI) |

> **Note**: Managed mode — the library owns Chrome's lifecycle. Only one Chrome instance runs at a time.

---

### `search(query, options?)`

Perform a Google search and return structured result listings.

```ts
import { search } from "google-search-core";

const { results, url } = await search("bun runtime", { maxResults: 5 });
```

**`SearchOptions`**

| Field        | Type     | Default | Description                                                   |
| ------------ | -------- | ------- | ------------------------------------------------------------- |
| `maxResults` | `number` | `10`    | Maximum results to return (capped by Google's per-page limit) |

**Returns**

```ts
{
  results: Array<{
    rank: number; // 1-based rank
    title: string; // Result title
    url: string; // Full URL
    snippet: string; // Description text
    displayUrl?: string; // e.g. "example.com › page"
  }>;
  url: string; // The google.com/search?… URL that was loaded
}
```

**Throws** if Chrome has not been initialised, navigation fails (network error / DNS / timeout), or Google returns a CAPTCHA or consent wall that blocks the results container.

---

### `searchWithContent(query, options?)`

Like `search()` but also fetches each result page and extracts its main content as Markdown using Mozilla Readability + Turndown.

```ts
import { searchWithContent } from "google-search-core";

const { results } = await searchWithContent("typescript tutorial", {
  maxResults: 3,
});

results[0].content; // Markdown string of the landing page
```

Concurrent callers are safe — a single content-extraction page is shared across all callers via a promise-guarded factory.

**`SearchOptions`**

| Field        | Type     | Default | Description                        |
| ------------ | -------- | ------- | ---------------------------------- |
| `maxResults` | `number` | `10`    | Max results AND max pages to fetch |

**Returns**

Same as `search()` but each result carries an additional `content` field:

```ts
Array<{
  rank: number;
  title: string;
  url: string;
  snippet: string;
  displayUrl?: string;
  content: string; // Markdown of the landing page ("" if unreadable)
}>;
```

**Throws** if Chrome has not been initialised, the underlying search fails, the URL is not an `http(s)` URL, or the underlying page has been closed before extraction.

---

### `close()`

Shut down Chrome and release all resources.

```ts
import { close } from "google-search-core";

await close();
```

Safe to call even if `init()` was never called, or if `init()` failed partway through. After `close()`, `init()` can be called again to start a fresh Chrome instance.

---

## Browser Layer

### `createBrowserManager(deps?)`

Factory function — returns a plain object with browser lifecycle methods. No classes.

```ts
import { createBrowserManager } from "google-search-core/src/browser/manager";

const manager = createBrowserManager();
await manager.start();
const page = await manager.newPage();
await manager.goto("https://www.google.com");
await manager.close();
```

**Returns**

```ts
type BrowserManager = {
  start: () => Promise<BrowserContext>;
  newPage: () => Promise<Page>;
  goto: (url: string, timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
};
```

**Launch arguments used:**

```
--no-first-run
--no-default-browser-check
--disable-popup-blocking
--disable-blink-features=AutomationControlled
```

> **Note on anti-detection:** Playwright sets `navigator.webdriver = true` in all pages, which is one of Google's strongest automation signals. The manager patches this via `context.on("page")` + `page.addInitScript()` so the property returns `undefined`. Combined with `--disable-blink-features=AutomationControlled` and the user's real Chrome profile (cookies, history, login state), this avoids the "Are you a human?" CAPTCHA in normal usage.

---

## Search Layer

### `parseFilters(input: string): ParsedQuery`

Parse a raw Google search string into a structured object.

```ts
import { parseFilters } from "google-search-core/src/search/filters";

const parsed = parseFilters(
  'bun runtime site:github.com -outdated "stable release"',
);
// {
//   query: "bun runtime",
//   site: "github.com",
//   filetype: undefined,
//   inurl: undefined,
//   intitle: undefined,
//   exactPhrase: "stable release",
//   excludeTerms: ["outdated"],
//   afterDate: undefined,
//   beforeDate: undefined
// }
```

> **Note**: `excludeTerms` preserves the original casing of the term. Invalid calendar dates for `after:` / `before:` (e.g. `2024-13-01`, `2024-02-30`) are silently dropped. Bare operators with no value (`site:`, `filetype:`) are ignored. Operator order is normalised to a canonical sequence when reassembled via `buildQueryString()`.

**`ParsedQuery`**

| Field          | Type       | Description                     |
| -------------- | ---------- | ------------------------------- |
| `query`        | `string`   | Core search terms               |
| `site`         | `string?`  | `site:` operator value          |
| `filetype`     | `string?`  | `filetype:` operator value      |
| `inurl`        | `string?`  | `inurl:` operator value         |
| `intitle`      | `string?`  | `intitle:` operator value       |
| `exactPhrase`  | `string?`  | `"exact phrase"` without quotes |
| `excludeTerms` | `string[]` | `-excluded` terms               |
| `afterDate`    | `string?`  | `after:YYYY-MM-DD`              |
| `beforeDate`   | `string?`  | `before:YYYY-MM-DD`             |

---

### `buildQueryString(parsed: ParsedQuery): string`

Reassemble a `ParsedQuery` back into a `q=` parameter value.

```ts
import { buildQueryString } from "google-search-core/src/search/filters";

buildQueryString({
  query: "bun",
  site: "github.com",
  excludeTerms: ["npm"],
  exactPhrase: "fast runtime",
});
// 'bun "fast runtime" -npm site:github.com'
```

> **Note**: The output is a plain string with unencoded spaces and special characters. It is safe to pass directly to `buildSearchUrl()` which handles encoding via `URLSearchParams`. Do **not** embed the raw output in an `<a href>` or server-side redirect without first URL-encoding it.

---

### `buildSearchUrl(parsed: ParsedQuery, page?: number): string`

Build a fully-formed `https://www.google.com/search?…` URL.

```ts
import { buildSearchUrl } from "google-search-core/src/search/url-builder";

buildSearchUrl({ query: "bun", excludeTerms: [] });
// 'https://www.google.com/search?q=bun&num=10&hl=en&gl=us'

buildSearchUrl({ query: "bun", excludeTerms: [] }, 1);
// 'https://www.google.com/search?q=bun&num=10&hl=en&gl=us&start=10'
```

**Parameters**

| Field    | Type          | Default  | Description                                                                     |
| -------- | ------------- | -------- | ------------------------------------------------------------------------------- |
| `parsed` | `ParsedQuery` | required | Structured query                                                                |
| `page`   | `number`      | `0`      | 0-based page index (each page = 10 results); negative values are clamped to `0` |

---

### `extractSearchResults(page, timeoutMs?): SearchResult[]`

Wait for the Google results container and extract organic search results from the current page.

```ts
import { extractSearchResults } from "google-search-core/src/search/serp";

await page.goto("https://www.google.com/search?q=bun");
const results = await extractSearchResults(page);
```

**SERP Selectors used**

| Element           | Selector                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Results container | `#search`                                                                                 |
| Individual block  | `#search .MjjYud` (current layout, fallback: `#search .g`) — filtered to `h3` + `a[href]` |
| Title             | `h3`                                                                                      |
| URL               | `a[href]` (inside `.yuRUbf`)                                                              |
| Snippet           | `.w8qArf, .ITZIwc` (current layout), `.VwiC3b` (legacy), fallback: `div[data-sncf]`       |
| Display URL       | `.V9tjod` (current layout), `.TbwUpd` (legacy)                                            |

> **Note**: Google changes its SERP DOM structure regularly (class names, layout per locale). If extraction returns fewer results than expected, inspect the live SERP in Chrome DevTools and update the selectors in `SELECTORS` in `src/search/serp.ts`. The selector for `resultBlock` tries `.MjjYud` first and falls back to `.g` automatically.

---

## Content Layer

### `createPageContentExtractor(page): PageContentExtractor`

Factory — bind a content extractor to an existing Playwright `Page` for reuse across multiple URLs.

```ts
import { createPageContentExtractor } from "google-search-core/src/content/extractor";

const extractor = createPageContentExtractor(page);
const markdown = await extractor.extract("https://example.com/article");
```

**`PageContentExtractor`**

```ts
type PageContentExtractor = {
  /** Navigate to `url` and return its main content as Markdown. Returns "" on failure. */
  extract: (url: string, timeoutMs?: number) => Promise<string>;
  /** Close the underlying Playwright Page and release resources. */
  dispose: () => Promise<void>;
};
```

**Pipeline**

1. Navigate to URL → `waitUntil: "domcontentloaded"`
2. Extract `document.documentElement.outerHTML`
3. Parse with **Mozilla Readability** → extract `<article>` content
4. Convert to **Markdown** with **Turndown** (`headingStyle: "atx"`, `codeBlockStyle: "fenced"`)

Returns `""` if Readability cannot find a readable article (e.g. 404 page, bare landing page, or malformed HTML).

---

## Type Index

| Type                      | Location                   |
| ------------------------- | -------------------------- |
| `SearchResult`            | `src/search/serp.ts`       |
| `SearchResultWithContent` | `src/index.ts`             |
| `SearchOptions`           | `src/index.ts`             |
| `ParsedQuery`             | `src/search/filters.ts`    |
| `BrowserManagerDeps`      | `src/browser/manager.ts`   |
| `BrowserManager`          | `src/browser/manager.ts`   |
| `PageContentExtractor`    | `src/content/extractor.ts` |
