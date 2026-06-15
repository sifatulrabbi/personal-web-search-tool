/**
 * Fetch an arbitrary page and extract its readable content as Markdown.
 *
 * Uses Mozilla Readability to strip boilerplate (navigation, sidebars,
 * footers, ads) and Turndown to convert the cleaned HTML to Markdown.
 */

import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
});

/**
 * Parse a raw HTML string with the Readability algorithm and return the
 * article content as Markdown.
 *
 * Returns an empty string when Readability cannot produce an article
 * (e.g. an error page or a bare landing page with no main content), or
 * when the HTML is malformed.
 */
function htmlToMarkdown(html: string): string {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const article = new Readability(doc).parse();

        if (!article || !article.content) return "";
        return turndown.turndown(article.content);
    } catch {
        // Readability can throw on malformed HTML (e.g. circular references,
        // script-triggered document.write corruption).  Return empty string
        // — individual extraction failures are already handled per-result
        // inside extractor.extract() so the Promise.all batch continues.
        return "";
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PageContentExtractor {
    /** Navigate to `url` and return its main content as Markdown. */
    extract: (url: string, timeoutMs?: number) => Promise<string>;
    /** Close the underlying Playwright `Page` and release resources. */
    dispose: () => Promise<void>;
}

/**
 * Factory: create a content extractor bound to an existing Playwright `Page`.
 *
 * Reusing the same page across multiple extractions keeps the browser session
 * warm and avoids the cost of creating a fresh context per URL.
 */
export function createPageContentExtractor(page: Page): PageContentExtractor {
    return {
        async extract(
            url: string,
            timeoutMs = DEFAULT_TIMEOUT_MS,
        ): Promise<string> {
            if (!url.startsWith("http")) {
                throw new Error(
                    `extract() requires an http(s) URL, got: "${url}"`,
                );
            }

            if (page.isClosed()) {
                throw new Error(
                    "Cannot extract content: the underlying page has been closed.",
                );
            }

            try {
                await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: timeoutMs,
                });

                const html = await page.evaluate(
                    () => document.documentElement.outerHTML,
                );

                return htmlToMarkdown(html);
            } catch {
                // Navigation or extraction failed (DNS error, 4xx/5xx, timeout,
                // Readability failure).  Return empty string so the caller
                // receives a result object with a defined (but empty) content
                // field rather than the entire Promise.all batch failing.
                return "";
            }
        },

        async dispose(): Promise<void> {
            // If the page is already closed, close() is a no-op — skip the
            // network call entirely rather than relying on the catch block.
            if (page.isClosed()) return;

            try {
                await page.close();
            } catch (e) {
                const msg = (e as Error)?.message ?? "";
                // "Target closed" is expected when the page has already been
                // torn down by the browser context.
                if (!msg.includes("Target closed")) {
                    console.error(
                        "[google-search-core] error closing content extractor page:",
                        e,
                    );
                }
            }
        },
    };
}
