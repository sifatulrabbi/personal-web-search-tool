# sifatul-web-search-tool

A Bun + TypeScript monorepo for programmatic Google search using your own Chrome profile (macOS and Linux).

- **`@sifatul-web-search-tool/core`** — the library (Playwright + Chrome)
- **`@sifatul-web-search-tool/cli`** — terminal interface (`sweb-search`)

## Requirements

|         |                                                      |
| ------- | ---------------------------------------------------- |
| Runtime | [Bun](https://bun.com) v1.0+                         |
| Browser | Google Chrome (located automatically via Playwright) |
| OS      | macOS or Linux (Windows not supported)               |
| Node.js | Not required                                         |

## Install

```bash
git clone <repo-url>
cd personal-web-search
bun install
```

## Quick Start

Use the CLI to smoke-test from your terminal:

```bash
bun run --filter=@sifatul-web-search-tool/cli search "bun runtime"
```

Use the core library in your own scripts:

```ts
import {
  init,
  search,
  searchWithContent,
  close,
} from "@sifatul-web-search-tool/core";

await init();
const { results } = await search("bun runtime");
await close();
```

## Scripts

```bash
# format / typecheck / test every package
bun run format:check
bun run typecheck
bun run test

# workspace-specific
bun run --filter=@sifatul-web-search-tool/cli search "bun runtime"
```

See [`packages/core/README.md`](packages/core/README.md) and [`packages/cli/README.md`](packages/cli/README.md) for package-level docs.

## License

MIT
