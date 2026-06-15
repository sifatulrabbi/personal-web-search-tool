Verification Report
3 sub-agents deployed in parallel — source code, tests, configs — all returned full reports.
🔴 High Severity — Fix Before Testing

# File Issue

1 src/index.ts:132–139 Page leak. searchWithContent() passes a Page to createPageContentExtractor() but close() never calls page.close(). The Playwright Page and its underlying browser context resources leak permanently on every call.
2 src/index.ts:42 Dead option. SearchOptions.fetchContent is declared in the public type but search() never reads it. Consumers who set fetchContent: true get no behavior change — silent no-op.
3 package.json:7 main points to .ts source. "main": "./src/index.ts" but tsconfig.json has noEmit: true and there is no build script. Any consumer importing this package would receive raw TypeScript with no compilation.
4 package.json:20 @types/bun: "latest" — floating tag, silently breaks on new Bun releases.
5 package.json:25–27 playwright in both dependencies and peerDependencies — contradictory. It is a runtime dependency (code calls chromium.launchPersistentContext directly), so the peerDependencies entry should be removed.
🟡 Medium Severity

# File Issue

6 src/search/serp.ts:50–52 Dead code. getTextContent() is defined but never callable — it's a Node-side function inaccessible from the $$eval browser sandbox where all text extraction happens inline.
7	src/search/serp.ts:42	SELECTORS.snippetFallback declared but unused. The fallback selector 'div[data-sncf="1"]' is hard-coded inside the $$eval callback instead of referencing the constant.
8 tests/unit.test.ts:129–150 Weak assertions in buildQueryString test. Uses toContain for every sub-check. The test passes even if the output is structurally garbled.
9 tests/integration.test.ts:94–95 url field of searchWithContent() has zero test coverage. The return value url: enriched[0]?.url ?? "" would silently produce "" on empty results without any test catching it.
10 src/search/serp.ts:93 url: anchor?.href ?? "" — anchor-less blocks produce "" instead of being skipped. Consumers get a result entry with no URL.
11 src/content/extractor.ts:43 page.goto() errors (4xx/5xx/DNS/timeout) are unhandled. A single dead link in searchWithContent fails the entire Promise.all batch. No per-URL try/catch.
🟢 Low Severity

# File Issue

12 src/search/filters.ts:120 Quoted phrases are lowercased before storing in exactPhrase. "Hello World" and "hello world" are treated identically — may or may not be intentional.
13 src/browser/manager.ts:82 this.newPage() inside goto breaks if the method is destructured (const { goto } = mgr; goto(url) → this is undefined in strict mode).
14 src/browser/manager.ts:82–84 newPage() silently reuses the first existing page. Side-effect not reflected in the type signature; concurrent callers can race.
15 src/search/serp.ts:93–96 url uses "" for missing value while displayUrl uses undefined — inconsistent optionality within the same type.
16 package.json No lint or build scripts.
17 .gitignore Lists bun.lockb (binary, does not exist) but the actual file on disk is bun.lock (text, not in the list).
18 README.md:12 Contradicting import examples. Quick Start uses ./src/index (relative, repo-only) while the rest of the README uses google-search-core.
19 README.md displayUrl appears in the type table but is omitted from the prose result-object description.
20 tests/unit.test.ts 12+ untested edge cases in parseFilters: unclosed quotes, empty operator values (site:), duplicate operators, all-caps operators (SITE:X.COM), special characters (c++, #tag), trailing dash (bun -).
Overall Test Quality Assessment
Area Status
Pure function unit coverage ✅ Strong — 20/20 tests pass
SERP extractor (serp.ts) 🔴 Zero tests — core scraping logic entirely untested
Content extractor (extractor.ts) 🔴 Zero unit tests — only integration-tested
Browser manager (manager.ts) 🔴 Zero tests
Integration test isolation 🟡 Weak — 100% real-network, no mocks
CI flakiness risk 🟡 High — Google CAPTCHA, SERP layout changes, IP rate-limits all cause hard or silent failures
False-green CI 🟢 Low — integration tests are fully opt-in via GOOGLE_SEARCH_TEST=1
