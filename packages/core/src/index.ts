/**
 * Public API — `google-search-core`
 *
 * Provides a simple, functional interface:
 *
 * ```ts
 * import { init, search, searchWithContent, close } from "google-search-core";
 *
 * await init();                         // starts Chrome with your profile
 * const { results, url } = await search("bun runtime");
 * const { results: full } = await searchWithContent("bun runtime", { maxResults: 5 });
 * await close();                         // shuts down Chrome
 * ```
 *
 * No classes, no hidden state — just plain functions backed by a browser
 * manager factory for easy DI and testability.
 */

import {
  createBrowserManager,
  type BrowserManager,
  type BrowserManagerDeps,
} from "./browser/manager";
import { parseFilters } from "./search/filters";
import { buildSearchUrl } from "./search/url-builder";
import { extractSearchResults, type SearchResult } from "./search/serp";
import { createPageContentExtractor } from "./content/extractor";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { SearchResult } from "./search/serp";
export type { BrowserManagerDeps } from "./browser/manager";

/** `SearchResult` with the additional `content` field returned by `searchWithContent()`. */
export interface SearchResultWithContent extends SearchResult {
  content: string;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * How many result pages to fetch concurrently during `searchWithContent()`.
 * Each extraction uses its own page, so this bounds open tabs (and memory /
 * network) rather than risking concurrent navigations on a shared page.
 */
const CONTENT_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let browserManager: BrowserManager | null = null;
let initPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options accepted by `search()` and `searchWithContent()`. */
export interface SearchOptions {
  /**
   * Maximum number of results to return. Google returns ~10 organic results
   * per page, so values above 10 are effectively capped at one page's worth —
   * use `page` to fetch later pages.
   */
  maxResults?: number;
  /** 0-based result page to fetch (0 = first page, 1 = second page, …). */
  page?: number;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialise the core and start Chrome.
 *
 * Safe to call concurrently: concurrent callers receive the same promise and
 * only one Chrome instance is ever created.  Subsequent calls after a
 * successful init are a no-op (idempotent).
 *
 * @param deps — optional overrides (Chrome binary path, profile directory).
 *              Pass an empty object `{}` to use the defaults.
 */
export async function init(deps: BrowserManagerDeps = {}): Promise<void> {
  // Fast path: already initialised.
  if (browserManager) return;

  // Slow path: initPromise is assigned BEFORE any async work so that
  // concurrent callers all await the same promise (TOCTOU guard).
  if (!initPromise) {
    initPromise = (async () => {
      const mgr = createBrowserManager(deps);
      await mgr.start();
      browserManager = mgr;
    })();
  }

  await initPromise;
}

/**
 * Shut down Chrome and release all resources.
 * Safe to call even if `init()` was never called, or if it failed partway
 * through.
 */
export async function close(): Promise<void> {
  if (browserManager) {
    const mgr = browserManager;
    browserManager = null;
    initPromise = null; // allow re-init after close()
    await safeClose(mgr, "browser manager");
  }
}

/**
 * Close a browser manager and suppress the "Target closed" error.
 */
async function safeClose(mgr: BrowserManager, label: string): Promise<void> {
  try {
    await mgr.close();
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (!msg.includes("Target closed")) {
      console.error(`[google-search-core] error closing ${label}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map `items` through `fn` with at most `limit` calls in flight at once.
 * Preserves input order in the returned array.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Perform a Google search and return structured result listings.
 *
 * @param query   — raw query string (supports Google operators like `site:`, `filetype:`, …)
 * @param options — `maxResults` to cap results, `page` for pagination
 * @returns Object with `results` array and the `url` that was searched
 *
 * @throws Error if Chrome has not been initialised (call `init()` first).
 * @throws Error if navigation fails — network error, DNS failure, or timeout.
 * @throws Error if `extractSearchResults()` fails — the `#search` container
 *         does not appear within the timeout, or Google returns a CAPTCHA or
 *         consent wall that blocks the results container.
 */
export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; url: string }> {
  if (!browserManager) throw new Error("Call init() before search()");

  const parsed = parseFilters(query);
  const url = buildSearchUrl(parsed, options.page ?? 0);

  // Each search runs on its own fresh page, closed in `finally`. This keeps
  // concurrent searches from clobbering one another's navigation.
  const page = await browserManager.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const results = await extractSearchResults(page);
    const trimmed = results.slice(0, options.maxResults ?? 10);
    return { results: trimmed, url };
  } finally {
    await page.close().catch((e) => {
      const msg = (e as Error)?.message ?? "";
      if (!msg.includes("Target closed")) {
        console.error("[google-search-core] error closing search page:", e);
      }
    });
  }
}

/**
 * Like `search()` but also fetches each result page and extracts its content
 * as Markdown using Mozilla Readability.
 *
 * Result objects carry an additional `content` field. Each result page is
 * fetched on its own isolated page (up to `CONTENT_CONCURRENCY` in parallel),
 * so a single slow or broken page never blocks or breaks the others — failed
 * extractions yield an empty `content` string.
 *
 * @throws Error if Chrome has not been initialised (call `init()` first).
 * @throws Error if the underlying search (see `search()`) fails.
 */
export async function searchWithContent(
  query: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResultWithContent[]; url: string }> {
  if (!browserManager)
    throw new Error("Call init() before searchWithContent()");

  // search() runs and closes its own page before we get here.
  const { results, url } = await search(query, options);

  // Capture the manager locally so a concurrent close() cannot turn the
  // newPage factory into a null dereference mid-flight.
  const mgr = browserManager;
  const extractor = createPageContentExtractor(() => mgr.newPage());

  const enriched = await mapWithConcurrency(
    results,
    CONTENT_CONCURRENCY,
    async (r) => {
      try {
        return { ...r, content: await extractor.extract(r.url) };
      } catch {
        // Defensive: extract() returns "" for navigation/parse failures, but
        // a bad URL (non-http) throws — degrade to empty content either way.
        return { ...r, content: "" };
      }
    },
  );

  return { results: enriched, url };
}
