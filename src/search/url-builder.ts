/**
 * Build a fully-formed Google search URL from a `ParsedQuery`.
 *
 * Uses `google.com/search` with sensible defaults:
 *  - `num=10`  — 10 organic results per page (Google's per-page max)
 *  - `hl=en`   — interface language
 *  - `gl=us`   — geolocation
 *  - `start=N` — pagination offset (0-based page index × 10)
 */

import type { ParsedQuery } from "./filters";
import { buildQueryString } from "./filters";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Construct a Google search URL.
 *
 * @param parsed  — structured query produced by `parseFilters()`
 * @param page    — 0-based page index (0 = first page, 1 = second page, …)
 * @returns A complete `https://www.google.com/search?…` URL
 */
export function buildSearchUrl(parsed: ParsedQuery, page = 0): string {
    const params = new URLSearchParams();

    const q = buildQueryString(parsed);
    if (q) params.set("q", q);

    params.set("num", "10");
    params.set("hl", "en");
    params.set("gl", "us");

    const safePage = Math.max(0, Math.floor(page));
    if (safePage > 0) {
        params.set("start", String(safePage * 10));
    }

    return `https://www.google.com/search?${params.toString()}`;
}
