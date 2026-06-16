/**
 * Unit tests for `htmlToMarkdown` — pure HTML→Markdown conversion.
 *
 * These run with plain `bun test` and need no browser. They are the regression
 * guard for the `DOMParser is not defined` bug: under Bun there is no global
 * `DOMParser`, so the extractor parses HTML with `linkedom` instead. If that
 * ever regresses, `htmlToMarkdown` returns "" and these tests fail.
 */

import { describe, test, expect } from "bun:test";
import { htmlToMarkdown } from "../src/content/extractor";

const ARTICLE_HTML = `<!doctype html>
<html>
  <head><title>The Bun Runtime</title></head>
  <body>
    <nav>Home About Contact</nav>
    <article>
      <h1>The Bun Runtime</h1>
      <p>Bun is a fast all-in-one JavaScript runtime. It ships with a bundler,
      a test runner, and a Node-compatible package manager, all in a single
      executable that starts in a few milliseconds.</p>
      <h2>Why it is fast</h2>
      <p>Bun is built on JavaScriptCore and written in Zig, which gives it a low
      startup time and high throughput for typical server workloads compared to
      runtimes built on V8.</p>
      <pre><code>console.log("hello");</code></pre>
    </article>
    <footer>Copyright 2026</footer>
  </body>
</html>`;

describe("htmlToMarkdown", () => {
  test("converts article HTML to Markdown (regression guard for DOMParser bug)", () => {
    const md = htmlToMarkdown(ARTICLE_HTML);
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("Bun is a fast all-in-one JavaScript runtime");
    // Boilerplate (nav/footer) is stripped by Readability.
    expect(md).not.toContain("Home About Contact");
  });

  test("preserves fenced code blocks", () => {
    const md = htmlToMarkdown(ARTICLE_HTML);
    expect(md).toContain("```");
    expect(md).toContain('console.log("hello");');
  });

  test("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  test("returns empty string for an empty document body", () => {
    expect(htmlToMarkdown("<html><body></body></html>")).toBe("");
  });

  test("does not throw on malformed HTML", () => {
    expect(() => htmlToMarkdown("<<<not really >html")).not.toThrow();
    expect(typeof htmlToMarkdown("<<<not really >html")).toBe("string");
  });
});
