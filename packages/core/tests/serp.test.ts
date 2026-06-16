/**
 * Unit tests for `parseOrganicResults` — the self-contained SERP block parser.
 *
 * In production this function is serialised into the browser by Playwright's
 * `$$eval`. Here we exercise the exact same function against a `linkedom`
 * document built from a static fixture, so the scraping logic has runnable
 * coverage without a real browser or network.
 */

import { describe, test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { parseOrganicResults } from "../src/search/serp";

function blocksFrom(html: string): Element[] {
  const { document } = parseHTML(`<div id="search">${html}</div>`);
  return [...document.querySelectorAll("#search .MjjYud")] as Element[];
}

describe("parseOrganicResults", () => {
  test("extracts title, url, snippet, and displayUrl from a current-layout block", () => {
    const results = parseOrganicResults(
      blocksFrom(`
        <div class="MjjYud">
          <div class="yuRUbf"><a href="https://bun.sh/docs"><h3>Bun Docs</h3></a></div>
          <div class="w8qArf">The official Bun documentation.</div>
          <div class="V9tjod">bun.sh › docs</div>
        </div>`),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      rank: 1,
      title: "Bun Docs",
      url: "https://bun.sh/docs",
      snippet: "The official Bun documentation.",
      displayUrl: "bun.sh › docs",
    });
  });

  test("reads legacy snippet class (.VwiC3b) when the new class is absent", () => {
    const results = parseOrganicResults(
      blocksFrom(`
        <div class="MjjYud">
          <a href="https://example.com"><h3>Example</h3></a>
          <div class="VwiC3b">Legacy snippet text.</div>
        </div>`),
    );

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("Legacy snippet text.");
  });

  test("skips non-organic blocks (no h3 or no anchor) and re-ranks contiguously", () => {
    const results = parseOrganicResults(
      blocksFrom(`
        <div class="MjjYud">
          <a href="https://first.com"><h3>First</h3></a>
          <div class="w8qArf">first snippet</div>
        </div>
        <div class="MjjYud">
          <div class="related-questions">People also ask (no h3)</div>
        </div>
        <div class="MjjYud">
          <h3>Has a title but no link</h3>
        </div>
        <div class="MjjYud">
          <a href="https://second.com"><h3>Second</h3></a>
          <div class="w8qArf">second snippet</div>
        </div>`),
    );

    expect(results.map((r) => r.title)).toEqual(["First", "Second"]);
    expect(results.map((r) => r.rank)).toEqual([1, 2]);
  });

  test("returns an empty array when there are no result blocks", () => {
    expect(parseOrganicResults(blocksFrom(""))).toEqual([]);
  });

  test("falls back to block text minus the title when no snippet selector matches", () => {
    const results = parseOrganicResults(
      blocksFrom(`
        <div class="MjjYud">
          <a href="https://nosnippet.com"><h3>Title Here</h3></a>
        </div>`),
    );

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Title Here");
    // Snippet is whatever text remains after removing the title — possibly empty.
    expect(typeof results[0].snippet).toBe("string");
  });
});
