/**
 * Fetch an arbitrary page and extract its readable content as Markdown.
 *
 * Uses Mozilla Readability to strip boilerplate (navigation, sidebars,
 * footers, ads) and Turndown to convert the cleaned HTML to Markdown.
 *
 * Readability needs a DOM `document`. The Bun/Node runtime has no `DOMParser`,
 * so we parse the HTML with `linkedom` (a lightweight standards-compliant DOM)
 * rather than a browser-only global.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { Page } from "playwright-core";

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
 * Pure and runtime-agnostic (no browser globals) so it can be unit-tested
 * against fixed HTML fixtures.
 *
 * Returns an empty string when Readability cannot produce an article
 * (e.g. an error page or a bare landing page with no main content), or
 * when the HTML is malformed.
 */
export function htmlToMarkdown(html: string): string {
  try {
    const { document } = parseHTML(html);
    // linkedom's document is structurally compatible with what Readability
    // needs; the cast bridges the nominal type gap.
    const article = new Readability(document as unknown as Document).parse();

    if (!article?.content) return "";
    return turndown.turndown(article.content).trim();
  } catch {
    // Readability can throw on malformed HTML (e.g. circular references,
    // script-triggered document.write corruption).  Return empty string
    // — individual extraction failures are already handled per-result
    // inside extractor.extract() so the batch continues.
    return "";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PageContentExtractor {
  /** Navigate to `url` and return its main content as Markdown. */
  extract: (url: string, timeoutMs?: number) => Promise<string>;
}

/**
 * Factory: create a content extractor that opens a fresh page per URL.
 *
 * A page is created, navigated, scraped, and closed for each `extract()` call.
 * This keeps every extraction fully isolated, so callers may run many
 * extractions concurrently without navigations interrupting one another (a
 * single shared page cannot service concurrent `goto()` calls).
 *
 * @param newPage — factory that returns a fresh Playwright `Page` (typically
 *                  `browserManager.newPage`).
 */
export function createPageContentExtractor(
  newPage: () => Promise<Page>,
): PageContentExtractor {
  return {
    async extract(
      url: string,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    ): Promise<string> {
      if (!/^https?:\/\//i.test(url)) {
        throw new Error(`extract() requires an http(s) URL, got: "${url}"`);
      }

      const page = await newPage();
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
        // Readability failure).  Return empty string so the caller receives
        // a result object with a defined (but empty) content field rather
        // than rejecting.
        return "";
      } finally {
        await page.close().catch((e) => {
          const msg = (e as Error)?.message ?? "";
          if (!msg.includes("Target closed")) {
            console.error(
              "[google-search-core] error closing content extractor page:",
              e,
            );
          }
        });
      }
    },
  };
}
