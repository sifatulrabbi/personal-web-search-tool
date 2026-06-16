/**
 * Unit tests — pure logic (filters, url-builder).
 * These run with plain `bun test` and do not need a browser.
 */

import { describe, test, expect } from "bun:test";
import { parseFilters, buildQueryString } from "../src/search/filters";
import { buildSearchUrl } from "../src/search/url-builder";

// ---------------------------------------------------------------------------
// parseFilters
// ---------------------------------------------------------------------------

describe("parseFilters", () => {
  test("plain query — no operators", () => {
    const result = parseFilters("bun javascript runtime");
    expect(result.query).toBe("bun javascript runtime");
    expect(result.site).toBeUndefined();
    expect(result.filetype).toBeUndefined();
    expect(result.excludeTerms).toEqual([]);
  });

  test("site: operator", () => {
    const result = parseFilters("bun site:github.com");
    expect(result.site).toBe("github.com");
    expect(result.query).toBe("bun");
  });

  test("filetype: operator", () => {
    const result = parseFilters("report filetype:pdf");
    expect(result.filetype).toBe("pdf");
    expect(result.query).toBe("report");
  });

  test("inurl: operator", () => {
    const result = parseFilters("download inurl:release");
    expect(result.inurl).toBe("release");
    expect(result.query).toBe("download");
  });

  test("intitle: operator", () => {
    const result = parseFilters("guide intitle:rust");
    expect(result.intitle).toBe("rust");
    expect(result.query).toBe("guide");
  });

  test("exact phrase — quoted string", () => {
    const result = parseFilters('"exact match phrase"');
    expect(result.exactPhrase).toBe("exact match phrase");
    expect(result.query).toBe("");
  });

  test("quoted phrase preserves original capitalisation", () => {
    const result = parseFilters('"Hello World"');
    expect(result.exactPhrase).toBe("Hello World");
  });

  test("quoted phrase mixed with other terms", () => {
    const result = parseFilters('bun "javascript runtime" tools');
    expect(result.exactPhrase).toBe("javascript runtime");
    expect(result.query).toBe("bun tools");
  });

  test("exclude term with -", () => {
    const result = parseFilters("bun runtime -npm -yarn");
    expect(result.excludeTerms).toEqual(["npm", "yarn"]);
    expect(result.query).toBe("bun runtime");
  });

  test("after: and before: date operators", () => {
    const result = parseFilters(
      "conference after:2024-01-01 before:2024-12-31",
    );
    expect(result.afterDate).toBe("2024-01-01");
    expect(result.beforeDate).toBe("2024-12-31");
    expect(result.query).toBe("conference");
  });

  test("invalid date for after:/before: is silently dropped", () => {
    const result = parseFilters("news after:not-a-date before:tomorrow");
    expect(result.afterDate).toBeUndefined();
    expect(result.beforeDate).toBeUndefined();
    // Tokens matched the operator prefix but failed the date regex → dropped
    expect(result.query).toBe("news");
  });

  test("complex multi-operator query", () => {
    const result = parseFilters(
      "bun javascript runtime site:github.com filetype:md -outdated after:2024-06-01",
    );
    expect(result.query).toBe("bun javascript runtime");
    expect(result.site).toBe("github.com");
    expect(result.filetype).toBe("md");
    expect(result.excludeTerms).toEqual(["outdated"]);
    expect(result.afterDate).toBe("2024-06-01");
  });

  test("empty string", () => {
    const result = parseFilters("");
    expect(result.query).toBe("");
    expect(result.excludeTerms).toEqual([]);
    expect(result.site).toBeUndefined();
  });

  test("quoted phrase with exclude", () => {
    const result = parseFilters('"react hooks" -class');
    expect(result.exactPhrase).toBe("react hooks");
    expect(result.excludeTerms).toEqual(["class"]);
    expect(result.query).toBe("");
  });

  // ── edge cases ─────────────────────────────────────────────────────────

  test("unclosed quote is treated as a regular term", () => {
    const result = parseFilters('"hello world');
    expect(result.exactPhrase).toBeUndefined();
    expect(result.query).toContain('"hello world');
  });

  test("bare operator with no value is ignored", () => {
    const result = parseFilters("bun site: filetype:");
    expect(result.site).toBeUndefined();
    expect(result.filetype).toBeUndefined();
    expect(result.query).toBe("bun");
  });

  test("all-caps operator is matched case-insensitively", () => {
    const result = parseFilters("bun SITE:GITHUB.COM");
    expect(result.site).toBe("GITHUB.COM");
    expect(result.query).toBe("bun");
  });

  test("special characters in query are preserved", () => {
    const result = parseFilters("c++ node.js #hashtag");
    expect(result.query).toBe("c++ node.js #hashtag");
  });

  test("trailing dash without value is treated as a regular term", () => {
    const result = parseFilters("bun -");
    expect(result.excludeTerms).toEqual([]);
    expect(result.query).toBe("bun -");
  });

  test("duplicate operators — last value wins", () => {
    const result = parseFilters("site:a.com site:b.com");
    expect(result.site).toBe("b.com");
  });

  test("query with only operators produces empty query", () => {
    const result = parseFilters("site:github.com -spam");
    expect(result.query).toBe("");
    expect(result.site).toBe("github.com");
    expect(result.excludeTerms).toEqual(["spam"]);
  });

  test("Unicode and emoji in query are preserved", () => {
    const result = parseFilters("café résumé 🌮 taco");
    expect(result.query).toBe("café résumé 🌮 taco");
  });

  test("tab character is preserved inside a token", () => {
    const result = parseFilters("hello\tworld");
    // \t is not a space separator so it stays in the token
    expect(result.query).toContain("hello");
    expect(result.query).toContain("world");
  });

  test("invalid calendar date for after:/before: is dropped", () => {
    const result = parseFilters("event after:2024-13-01 before:2024-02-30");
    expect(result.afterDate).toBeUndefined();
    expect(result.beforeDate).toBeUndefined();
    expect(result.query).toBe("event");
  });
});

// ---------------------------------------------------------------------------
// buildQueryString
// ---------------------------------------------------------------------------

describe("buildQueryString", () => {
  test("plain query", () => {
    expect(
      buildQueryString({
        query: "bun runtime",
        excludeTerms: [] as string[],
      }),
    ).toBe("bun runtime");
  });

  test("query + site:", () => {
    expect(
      buildQueryString({
        query: "bun",
        site: "github.com",
        excludeTerms: [] as string[],
      }),
    ).toBe("bun site:github.com");
  });

  test("all operators — exact output", () => {
    const result = buildQueryString({
      query: "hello",
      site: "example.com",
      filetype: "pdf",
      inurl: "docs",
      intitle: "guide",
      exactPhrase: "quick start",
      excludeTerms: ["spam"],
      afterDate: "2024-01-01",
      beforeDate: "2024-12-31",
    });
    expect(result).toBe(
      'hello "quick start" -spam site:example.com filetype:pdf inurl:docs intitle:guide after:2024-01-01 before:2024-12-31',
    );
  });

  test("empty query with operators produces operator-only string", () => {
    const result = buildQueryString({
      query: "",
      site: "github.com",
      excludeTerms: [] as string[],
    });
    expect(result).toBe("site:github.com");
  });

  test("only exactPhrase with no query", () => {
    const result = buildQueryString({
      query: "",
      exactPhrase: "hello world",
      excludeTerms: [] as string[],
    });
    expect(result).toBe('"hello world"');
  });

  test("multiple exclude terms", () => {
    const result = buildQueryString({
      query: "bun",
      excludeTerms: ["npm", "yarn", "deno"],
    });
    expect(result).toBe("bun -npm -yarn -deno");
  });
});

// ---------------------------------------------------------------------------
// buildSearchUrl
// ---------------------------------------------------------------------------

describe("buildSearchUrl", () => {
  test("produces a valid google.com/search URL", () => {
    const url = buildSearchUrl({
      query: "bun runtime",
      excludeTerms: [] as string[],
    });
    expect(url).toContain("https://www.google.com/search?");
    expect(url).toContain("q=bun+runtime");
    expect(url).toContain("num=10");
    expect(url).toContain("hl=en");
    expect(url).toContain("gl=us");
  });

  test("does not include start param on page 0", () => {
    const url = buildSearchUrl(
      { query: "test", excludeTerms: [] as string[] },
      0,
    );
    expect(new URL(url).searchParams.has("start")).toBe(false);
  });

  test("includes start param on page > 0", () => {
    const url = buildSearchUrl(
      { query: "test", excludeTerms: [] as string[] },
      2,
    );
    expect(new URL(url).searchParams.get("start")).toBe("20");
  });

  test("no spaces in final URL (all encoded)", () => {
    const url = buildSearchUrl({
      query: "hello world",
      exactPhrase: "foo bar",
      excludeTerms: [] as string[],
    });
    expect(url).not.toContain(" ");
  });

  test("empty query produces URL with no q= param", () => {
    const url = buildSearchUrl({ query: "", excludeTerms: [] as string[] });
    expect(new URL(url).searchParams.has("q")).toBe(false);
  });

  test("special characters in query are URL-encoded in the raw URL", () => {
    const url = buildSearchUrl({
      query: "c++ & node.js",
      excludeTerms: [] as string[],
    });
    // `&` in the raw URL must be percent-encoded to avoid query-string injection
    expect(url).toContain("%26");
    // no literal spaces in the raw URL
    expect(url).not.toContain(" ");
  });

  test("negative page is clamped to 0 — no start param", () => {
    const url = buildSearchUrl(
      { query: "test", excludeTerms: [] as string[] },
      -1,
    );
    expect(new URL(url).searchParams.has("start")).toBe(false);
  });

  test("page = 0 explicitly passed — no start param", () => {
    const url = buildSearchUrl(
      { query: "test", excludeTerms: [] as string[] },
      0,
    );
    expect(new URL(url).searchParams.has("start")).toBe(false);
  });
});
