# Google Search Core — Plan

## Goal

Build a reusable core (library) that programmatically performs Google searches using
the user's own Chrome browser + profile on macOS, for personalization and accurate results.

- Language/Runtime: **Bun + TypeScript**
- Browser: **Installed Chrome on macOS** (not bundled Chromium)
- Automation: **Playwright** with `channel: 'chrome'` + `userDataDir`
- Output: (1) Search listings, (2) Listings + fetched page content as Markdown

---

## Architecture

```
google-search-core/
├── src/
│   ├── index.ts              # Public API: init, search, searchWithContent, close
│   ├── browser/
│   │   ├── manager.ts        # BrowserManager — persistent context lifecycle
│   │   └── profile.ts        # macOS Chrome path constants + resolution
│   ├── search/
│   │   ├── filters.ts        # Google operator parser (site:, filetype:, "phrase", -exclude, etc.)
│   │   ├── url-builder.ts    # Construct google.com/search? URLs from parsed filters
│   │   └── serp.ts           # SERP selectors + result extraction
│   └── content/
│       └── extractor.ts      # @mozilla/readability + Turndown → Markdown
├── tests/
│   └── search.test.ts
├── package.json
├── playwright.config.ts
└── tsconfig.json
```

---

## Dependencies

```json
{
  "name": "google-search-core",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "bun tsc --noEmit"
  },
  "dependencies": {
    "playwright": "^1.49.0",
    "turndown": "^7.1.2",
    "@mozilla/readability": "^0.5.0"
  },
  "devDependencies": {
    "@types/turndown": "^5.0.5",
    "@types/bun": "latest"
  }
}
```

---

## Phase 1 — Browser Setup (browser/manager.ts + profile.ts)

### profile.ts

```ts
// macOS Chrome paths
const CHROME_BINARY =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_USER_DATA_DIR =
  "/Users/sifatul/Library/Application Support/Google/Chrome";

export function getChromeBinaryPath(): string {
  return CHROME_BINARY;
}
export function getUserDataDir(): string {
  return DEFAULT_USER_DATA_DIR;
}
```

### manager.ts — Managed mode (tool launches and owns Chrome)

```ts
import { chromium, BrowserContext, Page } from "playwright";

export class BrowserManager {
  private context: BrowserContext | null = null;

  async start(userDataDir: string): Promise<BrowserContext> {
    if (this.context) return this.context;

    this.context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      viewport: { width: 1280, height: 720 },
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
      ],
    });
    return this.context;
  }

  async newPage(): Promise<Page> {
    if (!this.context) throw new Error("BrowserManager not started");
    const [page] = this.context.pages();
    return page || this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
```

**Managed vs Attach mode:**
| | Managed | Attach |
|---|---|---|
| Chrome lifecycle | Tool owns it | User owns it |
| User can browse simultaneously | No | Yes |
| Setup complexity | Low | Medium (user starts Chrome manually) |
| Profile lock risk | None (only one process) | Possible if both running |

**Decision: Start with Managed mode.** Attach mode can be added later by swapping
`launchPersistentContext` for `chromium.connectOverCDP('http://localhost:9222')`.

---

## Phase 2 — Search Filters (search/filters.ts)

### Supported Google Operators

| Operator            | Example             | Description       |
| ------------------- | ------------------- | ----------------- |
| `site:`             | `site:github.com`   | Limit to domain   |
| `filetype:`         | `filetype:pdf`      | Limit file type   |
| `inurl:`            | `inurl:download`    | Keyword in URL    |
| `intitle:`          | `intitle:rust`      | Keyword in title  |
| `"phrase"`          | `"exact match"`     | Phrase match      |
| `-term`             | `-npm`              | Exclude term      |
| `after:YYYY-MM-DD`  | `after:2024-01-01`  | Date range after  |
| `before:YYYY-MM-DD` | `before:2024-12-31` | Date range before |

```ts
export interface ParsedQuery {
  query: string;
  site?: string;
  filetype?: string;
  inurl?: string;
  intitle?: string;
  exactPhrase?: string;
  excludeTerms: string[];
  afterDate?: string;
  beforeDate?: string;
}

export function parseFilters(input: string): ParsedQuery {
  /* ... */
}
```

---

## Phase 3 — URL Builder (search/url-builder.ts)

```ts
export function buildSearchUrl(parsed: ParsedQuery, page = 0): string {
  const params = new URLSearchParams();
  params.set("q", buildQueryString(parsed));
  params.set("num", "10");
  params.set("hl", "en");
  params.set("gl", "us");
  if (page > 0) params.set("start", String(page * 10));
  return `https://www.google.com/search?${params.toString()}`;
}
```

---

## Phase 4 — SERP Extraction (search/serp.ts)

```ts
export interface SearchResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  displayUrl?: string;
}

export async function extractSearchResults(
  page: Page,
): Promise<SearchResult[]> {
  await page.waitForSelector("#search", { timeout: 10000 });

  const results = await page.$$eval("#search .g", (elements) => {
    return elements
      .filter((el) => el.querySelector("h3") && el.querySelector("a[href]"))
      .map((el, i) => ({
        rank: i + 1,
        title: el.querySelector("h3")?.textContent?.trim() || "",
        url: (el.querySelector("a[href]") as HTMLAnchorElement)?.href || "",
        snippet:
          (
            el.querySelector(".VwiC3b") ||
            el.querySelector('div[data-sncf="1"]')
          )?.textContent?.trim() || "",
        displayUrl: el.querySelector(".TbwUpd")?.textContent,
      }));
  });

  return results;
}
```

**SERP Selectors:**
| Element | Selector | Notes |
|---|---|---|
| Results container | `#search` | Main results area |
| Individual result | `#search .g` | Filtered to those with `h3` + `a[href]` |
| Title | `h3` | Always present for organic results |
| URL | `a[href]` | First anchor in result block |
| Snippet | `.VwiC3b` | Primary; fallback `div[data-sncf="1"]` |
| Display URL | `.TbwUpd` | Gray URL above title |

---

## Phase 5 — Page Content Extraction (content/extractor.ts)

```ts
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx" });

export async function extractPageContent(
  page: Page,
  url: string,
): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  const html = await page.evaluate(() => document.documentElement.outerHTML);

  const doc = new DOMParser().parseFromString(html, "text/html");
  const article = new Readability(doc).parse();

  if (!article) return "";
  return turndown.turndown(article.content);
}
```

---

## Phase 6 — Public API (index.ts)

```ts
export interface SearchOptions {
  maxResults?: number; // default 10
  fetchContent?: boolean; // fetch + extract each result page
}

export async function init(userDataDir?: string): Promise<void> {
  /* ... */
}
export async function search(
  query: string,
  opts?: SearchOptions,
): Promise<{ results; url }> {
  /* ... */
}
export async function searchWithContent(
  query: string,
  opts?: SearchOptions,
): Promise<{ results; url }> {
  /* ... */
}
export async function close(): Promise<void> {
  /* ... */
}
```

---

## Phase 7 — Anti-Detection & Edge Cases

| Problem                | Mitigation                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chrome already running | Pre-check `pgrep "Google Chrome"`; error with instructions                                                    |
| Google CAPTCHA         | Real profile + real Chrome usually avoids this; add `--disable-blink-features=AutomationControlled` if needed |
| Slow pages             | 15s timeout per page; configurable                                                                            |
| Google layout changes  | All selectors in one file for quick updates                                                                   |
| Profile corruption     | Managed mode = only one Chrome instance                                                                       |
| JS-rendered pages      | `waitUntil: 'domcontentloaded'` + Readability handles most cases                                              |

---

## Phase 8 — Testing Strategy

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { init, search, searchWithContent, close } from "../src/index";

describe("Google Search Core", () => {
  beforeAll(async () => {
    await init();
  }); // Chrome must be closed
  afterAll(async () => {
    await close();
  });

  test("returns search results for a simple query", async () => {
    const { results } = await search("bun javascript runtime");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("url");
    expect(results[0]).toHaveProperty("snippet");
  });

  test("respects maxResults", async () => {
    const { results } = await search("typescript tutorial", {
      maxResults: 3,
    });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("searchWithContent returns markdown", async () => {
    const { results } = await searchWithContent("bun javascript", {
      maxResults: 1,
    });
    expect(results[0].content.length).toBeGreaterThan(100);
  });

  test("parseFilters handles site: operator", async () => {
    const { results } = await search("site:github.com bun runtime");
    results.forEach((r) => expect(r.url).toContain("github.com"));
  });
});
```

---

## Open Decisions Before Implementation

1. **Managed vs Attach mode?** → Recommending Managed. Attach mode can be layered on later.
2. **Which filters to include in v1?** → Plan includes all 8 listed; can trim to 3–4 most-used.
3. **Hardcoded `userDataDir` or configurable via `init()`?** → Sensible macOS default + `init()` override.
4. **CLI now or core first?** → Core first per user preference. CLI is a thin wrapper on the API.
5. **`num=10` per page?** → Google max is 10 per page; `maxResults` caps at N. Pagination via `start` param for future.
