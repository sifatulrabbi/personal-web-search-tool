/**
 * Integration tests — require Chrome to be closed before running.
 *
 * Set `GOOGLE_SEARCH_TEST=1` in your environment to opt-in, e.g.:
 *   GOOGLE_SEARCH_TEST=1 bun test tests/integration.test.ts
 *
 * These tests launch your real Chrome profile, perform actual Google searches,
 * and (optionally) fetch live pages. They are tagged `test.serial` so they
 * never run in parallel with each other.
 */

import { test, expect, describe } from "bun:test";
import { init, search, searchWithContent, close } from "../src/index";

const SKIP_REASON =
  "Set GOOGLE_SEARCH_TEST=1 to run integration tests (requires Chrome to be closed)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setup() {
  await init();
}

async function teardown() {
  await close();
}

// Wraps setup + teardown so that teardown is always called even when setup
// throws (e.g. Chrome is already running).
async function withChrome<T>(fn: () => Promise<T>): Promise<T> {
  await setup();
  try {
    return await fn();
  } finally {
    await teardown();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration — Google Search", () => {
  test.serial(
    "search() returns results with title, url, and snippet",
    async () => {
      if (!process.env.GOOGLE_SEARCH_TEST) {
        console.log(`  ⏭  skipped: ${SKIP_REASON}`);
        return;
      }

      await withChrome(async () => {
        const { results } = await search("bun javascript runtime", {
          maxResults: 3,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results.length).toBeLessThanOrEqual(3);

        for (const r of results) {
          expect(r.title.length).toBeGreaterThan(0);
          expect(r.url).toContain("http");
          expect(typeof r.url).toBe("string");
          expect(r.snippet.length).toBeGreaterThan(0);
          expect(r.rank).toBeGreaterThan(0);
        }
      });
    },
  );

  test.serial("search() respects the site: operator", async () => {
    if (!process.env.GOOGLE_SEARCH_TEST) {
      console.log(`  ⏭  skipped: ${SKIP_REASON}`);
      return;
    }

    await withChrome(async () => {
      const { results } = await search("site:github.com bun runtime", {
        maxResults: 3,
      });

      for (const r of results) {
        expect(r.url).toContain("github.com");
      }
    });
  });

  test.serial("search() returns the search URL", async () => {
    if (!process.env.GOOGLE_SEARCH_TEST) {
      console.log(`  ⏭  skipped: ${SKIP_REASON}`);
      return;
    }

    await withChrome(async () => {
      const { url } = await search("typescript");
      expect(url).toContain("google.com/search");
      expect(url).toContain("q=typescript");
    });
  });

  test.serial(
    "searchWithContent() returns markdown for each result",
    async () => {
      if (!process.env.GOOGLE_SEARCH_TEST) {
        console.log(`  ⏭  skipped: ${SKIP_REASON}`);
        return;
      }

      await withChrome(async () => {
        const { results } = await searchWithContent("bun javascript", {
          maxResults: 1,
        });

        expect(results.length).toBe(1);
        expect(results[0].content.length).toBeGreaterThan(100);
        expect(typeof results[0].content).toBe("string");
      });
    },
  );
});
