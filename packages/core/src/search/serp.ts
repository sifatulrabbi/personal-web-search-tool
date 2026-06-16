/**
 * Google SERP (Search Engine Results Page) extraction.
 *
 * After navigating to a `google.com/search?…` URL, call `extractSearchResults()`
 * to parse the organic result blocks into structured `SearchResult` objects.
 *
 * Google's SERP CSS class names change occasionally; keep all selectors
 * concentrated here for easy updates.
 */

import type { Page } from "playwright-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  /** 1-based rank among organic results on the page. */
  rank: number;
  /** Clickable title of the result. */
  title: string;
  /** Resolved URL from the anchor's `href`, or `undefined` if absent. */
  url: string;
  /** Plain-text description / snippet shown below the title. */
  snippet: string;
  /** Human-readable domain shown above the title (optional). */
  displayUrl?: string;
}

// ---------------------------------------------------------------------------
// SERP Selectors
// ---------------------------------------------------------------------------
// The SERP is wrapped in #search > div[data-hveid] > .MjjYud (one per result).
// Legacy layout used #search .g — kept as a fallback for older Google versions.
//
// Inside each result block:
//   Title       — h3
//   URL         — a[href]
//   Snippet     — .w8qArf or .ITZIwc (new layout), .VwiC3b (legacy)
//                  fallback: div[data-sncf] or div[data-sncf="1"]
//   Display URL — .V9tjod (new layout), .TbwUpd (legacy)

const SELECTORS = {
  /** Top-level results container injected by Google's server-side renderer. */
  resultsContainer: "#search",
  /**
   * Per-result wrapper in the current Google SERP layout.
   * Falls back to the legacy `.g` class for older layouts.
   */
  resultBlock: "#search .MjjYud",
  resultBlockFallback: "#search .g",
} as const;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse organic result blocks into structured `SearchResult` objects.
 *
 * This function is intentionally **self-contained** (no module-level
 * references, no closures): it is serialised and shipped into the browser by
 * Playwright's `$$eval`, and is also called directly against a `linkedom`
 * document in unit tests. Anything it references must be available in both
 * environments, so all selectors are inlined here.
 *
 * Skips non-result blocks (e.g. "People also ask") by requiring both an `<h3>`
 * title and an anchor. Blocks with no resolvable URL are skipped.
 */
export function parseOrganicResults(elements: Element[]): SearchResult[] {
  return (
    elements
      .map((el, index): SearchResult | null => {
        const anchor = el.querySelector("a[href]") as HTMLAnchorElement | null;
        const href = anchor?.href?.trim();
        if (!href) return null;

        const titleText = el.querySelector("h3")?.textContent?.trim();
        if (!titleText) return null;

        const displayUrlEl = el.querySelector(".V9tjod, .TbwUpd");

        // Snippet: try the specific description selectors first, then fall back
        // to the block's own text minus the title.
        const specificText = (
          el.querySelector(".w8qArf, .ITZIwc, .VwiC3b") ??
          el.querySelector("div[data-sncf], div[data-sncf='1']")
        )?.textContent?.trim();

        let snippet: string;
        if (specificText) {
          snippet = specificText;
        } else {
          const raw = (
            (el as HTMLElement).innerText ??
            el.textContent ??
            ""
          ).trim();
          snippet = raw.replace(titleText, "").trim().slice(0, 300);
        }

        return {
          rank: index + 1,
          title: titleText,
          url: href,
          snippet,
          displayUrl: displayUrlEl?.textContent ?? undefined,
        };
      })
      .filter((r): r is SearchResult => r !== null)
      // Re-rank after filtering so ranks are contiguous (1, 2, 3, …).
      .map((r, index) => ({ ...r, rank: index + 1 }))
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wait for the Google results container and extract all organic search results.
 *
 * @throws Error if the results container does not appear within `timeoutMs`
 */
export async function extractSearchResults(
  page: Page,
  timeoutMs = 10_000,
): Promise<SearchResult[]> {
  await page.waitForSelector(SELECTORS.resultsContainer, {
    timeout: timeoutMs,
  });

  // Try the current layout selector first (.MjjYud), then fall back to
  // the legacy .g class if the page uses an older SERP structure.
  const resultSelector = (await page.$(SELECTORS.resultBlock))
    ? SELECTORS.resultBlock
    : SELECTORS.resultBlockFallback;

  return page.$$eval(resultSelector, parseOrganicResults);
}
