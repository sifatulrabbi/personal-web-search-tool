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
import { parseFilters, buildQueryString } from "./search/filters";
import { buildSearchUrl } from "./search/url-builder";
import { extractSearchResults, type SearchResult } from "./search/serp";
import {
  createPageContentExtractor,
  type PageContentExtractor,
} from "./content/extractor";
import type { Page } from "playwright-core";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { SearchResult } from "./search/serp";

/** `SearchResult` with the additional `content` field returned by `searchWithContent()`. */
export interface SearchResultWithContent extends SearchResult {
  content: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let browserManager: BrowserManager | null = null;
let contentExtractor: PageContentExtractor | null = null;
let contentExtractorPromise: Promise<PageContentExtractor> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Create a content extractor on `page`, ensuring the page is closed if
 * creation fails.  Used as the TOCTOU-safe factory for `contentExtractorPromise`.
 */
async function createPageContentExtractorSafely(
  page: Page,
): Promise<PageContentExtractor> {
  try {
    return createPageContentExtractor(page);
  } catch (cause) {
    await page.close().catch(() => {});
    throw Object.assign(new Error("Failed to create content extractor"), {
      cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options accepted by `search()` and `searchWithContent()`. */
export interface SearchOptions {
  /** Maximum number of results to return (capped by what Google returns per page). */
  maxResults?: number;
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
 *              Pass an empty object `{}` to use the macOS defaults.
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
      return;
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
  // Dispose the content extractor first — it holds its own page.
  // IMPORTANT: pass the extractor to safeDispose BEFORE nullifying the
  // module-level variable, otherwise safeDispose receives null and the
  // underlying page is never closed (a silent resource leak).
  if (contentExtractor) {
    await safeDispose(contentExtractor, "content extractor");
    contentExtractor = null;
    contentExtractorPromise = null;
  }

  if (browserManager) {
    const mgr = browserManager;
    browserManager = null;
    initPromise = null; // allow re-init after close()
    await safeClose(mgr, "browser manager");
  }
}

/**
 * Close a disposable and suppress the "Target closed" error that occurs when
 * a page or context has already been torn down.
 */
async function safeDispose(
  disposable: { dispose: () => Promise<unknown> } | null,
  label: string,
): Promise<void> {
  if (!disposable) return;
  try {
    await disposable.dispose();
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (!msg.includes("Target closed")) {
      console.error(`[google-search-core] error disposing ${label}:`, e);
    }
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
// Search
// ---------------------------------------------------------------------------

/**
 * Perform a Google search and return structured result listings.
 *
 * @param query   — raw query string (supports Google operators like `site:`, `filetype:`, …)
 * @param options — `maxResults` to cap results
 * @returns Object with `results` array and the `url` that was searched
 *
 * @throws Error if Chrome has not been initialised (call `init()` first).
 * @throws Error if `browserManager.goto()` fails — network error, DNS failure,
 *         or navigation timeout.
 * @throws Error if `extractSearchResults()` fails — the `#search` container
 *         does not appear within `timeoutMs`, or Google returns a CAPTCHA or
 *         consent wall that blocks the results container.
 */
export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; url: string }> {
  if (!browserManager) throw new Error("Call init() before search()");

  const parsed = parseFilters(query);
  const url = buildSearchUrl(parsed);

  await browserManager.goto(url);

  // createBrowserManager returns a new page each time newPage() is called;
  // we must close it after extraction to avoid leaking a page per invocation.
  const page = await browserManager.newPage();
  try {
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
 * Result objects carry an additional `content` field.
 *
 * Safe to call concurrently from multiple callers: a single content-extraction
 * page is shared across all callers, and the creation of that page is guarded
 * by a promise so concurrent first callers never create duplicates.
 *
 * @throws Error if Chrome has not been initialised (call `init()` first).
 * @throws Error if the underlying search (see `search()`) fails.
 * @throws Error if the URL passed to `extract()` is not an http(s) URL.
 * @throws Error if the underlying page has been closed before extraction.
 */
export async function searchWithContent(
  query: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResultWithContent[]; url: string }> {
  if (!browserManager)
    throw new Error("Call init() before searchWithContent()");

  // search() already closes its own page, so there is no page leak here.
  const { results, url } = await search(query, options);

  // --- TOCTOU-safe extractor creation -----------------------------------
  // contentExtractorPromise is set before the async work begins, so any
  // concurrent caller that also enters this block will await the same
  // promise instead of creating a second page.
  if (!contentExtractorPromise) {
    const page = await browserManager.newPage();
    contentExtractorPromise = createPageContentExtractorSafely(page);
  }

  // Capture in a local before the first await so that a concurrent close()
  // that nullifies contentExtractorPromise between the assignment above and
  // the first evaluation below cannot turn this into `await null`.
  const extractorPromise = contentExtractorPromise;
  const extractor = await extractorPromise;
  contentExtractor = extractor; // capture for close()

  // If close() raced in and disposed the extractor before we got here,
  // the promise would have been set to null by close() — but we captured it
  // above, so we proceed with the extractor as-is.  Individual extract
  // failures are handled per-result below.

  try {
    const enriched = await Promise.all(
      results.map(async (r) => ({
        ...r,
        content: await extractor.extract(r.url),
      })),
    );

    // Return the pre-computed url so the caller always gets the actual
    // search URL, even when results is empty.
    return { results: enriched, url };
  } catch (err) {
    // If enrichment fails (e.g. all pages are unreachable), return the
    // raw results with empty content strings so the caller still gets
    // useful data.  Per-result extraction failures are already handled
    // inside extractor.extract() (which returns "" rather than rejecting).
    console.error(
      "[google-search-core] content enrichment failed, returning empty content:",
      err,
    );
    const enriched = results.map((r) => ({ ...r, content: "" }));
    return { results: enriched, url };
  }
}
