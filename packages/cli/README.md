# @sifatul-web-search-tool/cli

Terminal interface for `@sifatul-web-search-tool/core` — smoke-test Google search from your CLI.

```bash
web-search [options] <query>
```

---

## Requirements

- Bun v1.0+
- Google Chrome installed at `/Applications/Google Chrome.app` (macOS)
- Chrome must be **fully closed** before running
- This workspace depends on `@sifatul-web-search-tool/core` (`workspace:*`)

---

## Usage

### Without building

Run the CLI directly from source using Bun — no build step required:

```bash
# From the cli package directory (recommended for clean piped output)
cd packages/cli
bun run src/index.ts "bun runtime"

# From the monorepo root
bun run --filter=@sifatul-web-search-tool/cli search "bun runtime"
```

> **Note on clean output:** `bun run src/index.ts` (no `--filter`) produces clean stdout for piping.
> `bun run --filter=@sifatul-web-search-tool/cli search` prepends `@sifatul-web-search-tool/cli search:`
> to every stdout line — useful for terminal, but avoid `--filter` when redirecting to files.

### Build and install locally

```bash
cd packages/cli

# Compile to dist/
bun run build

# Symlink the binary into your PATH (one-time setup)
bun link
# → "web-search" is now available globally

# Run from anywhere
web-search "bun runtime"
```

---

## Flags

```
Usage:
  web-search [options] <query>

Options:
  --json                  Output results as JSON (pipeable)
  --content, -c           Fetch Markdown content for each result
  --max-results, -n N     Max results to return (default: 10)
  --headless              Run Chrome in headless mode (CI / no display)
  --profile DIR           Chrome user-data-dir (profile directory)
  --help, -h              Show this help
  --version               Show CLI version
```

---

## Examples

```bash
# Basic search (terminal output)
bun run src/index.ts "bun runtime"

# Pipe JSON to a file (run from packages/cli/ for clean output)
bun run src/index.ts --json "bun runtime" > results.json

# Fetch full page content as Markdown
bun run src/index.ts -c -n 3 "typescript tutorial"

# Headless mode (no visible Chrome window)
bun run src/index.ts --headless "bun release notes"

# Use a custom Chrome profile
bun run src/index.ts --profile ~/chrome-profiles/automation "bun runtime"
```

---

## Scripts

| Script                 | Description                      |
| ---------------------- | -------------------------------- |
| `bun run src/index.ts` | Run from source (no build)       |
| `bun run search`       | Alias for `bun run src/index.ts` |
| `bun run build`        | Compile to `dist/`               |
| `bun run test`         | Run unit tests                   |
| `bun run typecheck`    | TypeScript check                 |

---

## Running Tests

```bash
cd packages/cli
bun test
```

---

## Project Structure

```
packages/cli/
├── src/
│   ├── index.ts       # CLI entry point + argument parser + output formatters
│   └── tsconfig.build.json
├── tests/
│   └── cli.test.ts    # 21 unit tests for parseArgs() and run()
├── package.json
└── tsconfig.json
```

---

## License

MIT
