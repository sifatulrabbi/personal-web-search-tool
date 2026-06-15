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
// These target the stable structural elements of Google's SERP.
// They are deliberately chosen to avoid volatile CSS classes.

const SELECTORS = {
    resultsContainer: "#search",
    resultBlock: "#search .g",
    title: "h3",
    anchor: "a[href]",
    snippet: ".VwiC3b",
    snippetFallback: 'div[data-sncf="1"]',
    displayUrl: ".TbwUpd",
} as const;

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

    const results = await page.$$eval(SELECTORS.resultBlock, (elements) => {
        // Only keep blocks that look like an organic result (have h3 + anchor)
        const organic = elements.filter(
            (el) => el.querySelector("h3") && el.querySelector("a[href]"),
        );

        return organic
            .map((el, index) => {
                // Use destructured selectors so the variable names are checked
                // at write time — a misspelling produces a JS ReferenceError
                // inside $$eval rather than silently becoming undefined.
                const titleEl = el.querySelector("h3");
                const anchor = el.querySelector(
                    "a[href]",
                ) as HTMLAnchorElement | null;
                const snippetEl =
                    el.querySelector(SELECTORS.snippet) ??
                    el.querySelector(SELECTORS.snippetFallback);
                const displayUrlEl = el.querySelector(".TbwUpd");

                const href = anchor?.href?.trim();
                if (!href) return null;

                // Guard against malformed elements — if any required field is
                // missing we skip this block rather than returning a partial
                // object that would silently appear as valid data upstream.
                if (!titleEl?.textContent) return null;

                return {
                    rank: index + 1,
                    title: titleEl.textContent.trim(),
                    url: href,
                    snippet: snippetEl?.textContent?.trim() ?? "",
                    displayUrl: displayUrlEl?.textContent ?? undefined,
                };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);
    });

    return results;
}
