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
//   Title       — h3 (inside .yuRUbf > a)
//   URL         — a[href] (inside .yuRUbf)
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
    title: "h3",
    anchor: "a[href]",
    linkContainer: ".yuRUbf",
    /** Snippet description — current layout class names. */
    snippet: ".w8qArf, .ITZIwc",
    /** Legacy snippet class names and data-attribute fallbacks. */
    snippetFallback: ".VwiC3b, div[data-sncf], div[data-sncf='1']",
    /** Display URL — current layout, then legacy. */
    displayUrl: ".V9tjod, .TbwUpd",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the snippet / description text from a result block.
 *
 * Strategy:
 *  1. Try specific description selectors (.w8qArf, .ITZIwc, .VwiC3b …)
 *  2. If nothing matches, fall back to the block's own innerText minus the
 *     title text — this captures whatever descriptive text is visible without
 *     needing to know the exact class name.
 */
function extractSnippet(block: Element, titleText: string): string {
    // Try specific description selectors first.
    const specific =
        block.querySelector(SELECTORS.snippet) ??
        block.querySelector(SELECTORS.snippetFallback);

    if (specific?.textContent?.trim()) {
        return specific.textContent.trim();
    }

    // Fallback: block innerText minus the title.
    const raw = (block as HTMLElement).innerText?.trim() ?? "";
    const withoutTitle = titleText ? raw.replace(titleText, "").trim() : raw;
    return withoutTitle.slice(0, 300);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wait for the Google results container and extract all organic search results.
 *
 * Skips non-result blocks (e.g. "People also ask", knowledge panels) by
 * requiring an `<h3>` title element inside each result block.
 *
 * Blocks with no resolvable URL are skipped entirely.
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

    const results = await page.$$eval(resultSelector, (elements) => {
        // Only keep blocks that look like an organic result (have h3 + anchor)
        const organic = elements.filter(
            (el) => el.querySelector("h3") && el.querySelector("a[href]"),
        );

        return organic
            .map((el, index) => {
                const titleEl = el.querySelector("h3");
                const anchor = el.querySelector(
                    "a[href]",
                ) as HTMLAnchorElement | null;
                const displayUrlEl = el.querySelector(".V9tjod, .TbwUpd");

                const href = anchor?.href?.trim();
                if (!href) return null;

                if (!titleEl?.textContent) return null;

                const titleText = titleEl.textContent.trim();

                return {
                    rank: index + 1,
                    title: titleText,
                    url: href,
                    snippet: (() => {
                        // Inline snippet extraction mirrors extractSnippet() so
                        // the logic is available inside $$eval without passing
                        // function references across the serialisation boundary.
                        const specific =
                            el.querySelector(".w8qArf, .ITZIwc, .VwiC3b") ??
                            el.querySelector(
                                "div[data-sncf], div[data-sncf='1']",
                            );
                        if (specific?.textContent?.trim()) {
                            return specific.textContent.trim();
                        }
                        const raw = (el as HTMLElement).innerText?.trim() ?? "";
                        const withoutTitle = titleText
                            ? raw.replace(titleText, "").trim()
                            : raw;
                        return withoutTitle.slice(0, 300);
                    })(),
                    displayUrl: displayUrlEl?.textContent ?? undefined,
                };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);
    });

    return results;
}
