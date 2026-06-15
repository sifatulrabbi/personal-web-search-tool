# Testing

## Test Suites

| Suite             | File                        | Browser Required? | Env var                |
| ----------------- | --------------------------- | ----------------- | ---------------------- |
| Unit tests        | `tests/unit.test.ts`        | No                | —                      |
| Integration tests | `tests/integration.test.ts` | Yes               | `GOOGLE_SEARCH_TEST=1` |

---

## Running Unit Tests

Pure logic — no browser, no network. Fast.

```bash
bun test tests/unit.test.ts
```

**Covers:**

- `parseFilters()` — all operators, edge cases, empty input, Unicode, invalid dates
- `buildQueryString()` — all operators, ordering, encoding
- `buildSearchUrl()` — URL construction, pagination, encoding, edge cases (negative page, empty query)

---

## Running Integration Tests

End-to-end tests that launch real Chrome and hit Google.

**Prerequisites:**

1. Chrome must be completely closed (no running instances)
2. Set `GOOGLE_SEARCH_TEST=1` to opt-in

```bash
GOOGLE_SEARCH_TEST=1 bun test tests/integration.test.ts
```

**Covers:**

- `search()` returns non-empty results for a real query
- `search()` respects `maxResults`
- `search()` returns a valid Google URL
- `searchWithContent()` returns Markdown content with `length > 100`
- `site:` operator filters results to the correct domain

**Why the env var gate?**
Integration tests launch your real Chrome profile and perform live Google searches.
The env var prevents accidental runs during `bun test` (e.g. in CI pipelines).

---

## Running All Tests

```bash
# Unit tests only (fast, no browser)
bun test tests/unit.test.ts

# Both unit and integration
GOOGLE_SEARCH_TEST=1 bun test
```

---

## Adding a New Test

### Unit test

Add a `test()` block to `tests/unit.test.ts`:

```ts
test("parseFilters handles a new operator", () => {
    const result = parseFilters("query related:");
    expect(result.related).toBe("");
});
```

### Integration test

Add a `test.serial()` block to `tests/integration.test.ts` inside the `describe` block.
Use the `withChrome()` helper which guarantees `teardown()` runs even if `setup()` throws:

```ts
test.serial("my new integration test", async () => {
    if (!process.env.GOOGLE_SEARCH_TEST) {
        console.log("  ⏭  skipped");
        return;
    }

    await withChrome(async () => {
        // ... test logic
    });
});
```

> **Always use `test.serial`** — integration tests share a single Chrome instance
> and must run one at a time.
>
> **Always use `withChrome()`** — it wraps `setup()` and `teardown()` in a single
> `try/finally`, guaranteeing cleanup even when `init()` fails.

---

## CI Considerations

Integration tests should not run in CI unless you explicitly set up a headless Chrome
profile. For CI pipelines, run only unit tests:

```bash
bun test tests/unit.test.ts
```
