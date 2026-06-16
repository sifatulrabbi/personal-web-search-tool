/**
 * CLI entry point for `web-search`.
 *
 * Usage:
 *   web-search [options] <query>
 *
 * Options:
 *   --json                  Output results as JSON (pipeable)
 *   --content, -c           Fetch Markdown content for each result
 *   --max-results, -n N     Max results to return (default: 10)
 *   --headless              Run Chrome in headless mode
 *   --profile DIR           Chrome profile directory
 *   --help, -h              Show this help
 *   --version               Show version
 *
 * Examples:
 *   web-search "bun runtime"
 *   web-search --json "bun runtime" > results.json
 *   web-search -c --max-results 3 "typescript tutorial"
 */

import { readFileSync } from "node:fs";
import {
  init,
  search,
  searchWithContent,
  close,
} from "@sifatul-web-search-tool/core";
import type {
  SearchResult,
  SearchResultWithContent,
} from "@sifatul-web-search-tool/core";

// ---------------------------------------------------------------------------
// CLI metadata (read once at module load)
// ---------------------------------------------------------------------------

const CLI_PKG = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { name: string; version: string };
const CLI_VERSION: string = CLI_PKG.version;

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

/** Flags recognised by the CLI (without the leading `--`). */
const KNOWN_FLAGS = new Set([
  "json",
  "content",
  "c",
  "max-results",
  "n",
  "headless",
  "profile",
  "help",
  "h",
  "version",
]);

/** Shape of parsed CLI options. */
export interface CliOptions {
  json: boolean;
  content: boolean;
  maxResults: number;
  headless: boolean;
  profile: string | undefined;
}

/**
 * Parse `process.argv` into a `{ query, options }` pair.
 *
 * Returns a `signal` field for `--help` / `--version` so the caller decides
 * how to exit — this keeps `parseArgs` free of side effects and unit-testable.
 *
 * Positional argument(s) after flags are joined into the query string.
 * Flags with values consume the next argv entry (`--max-results 5`).
 */
export function parseArgs(argv: string[]): {
  query: string;
  options: CliOptions;
  signal: "help" | "version" | null;
} {
  const args = argv.slice(2);
  const options: CliOptions = {
    json: false,
    content: false,
    maxResults: 10,
    headless: false,
    profile: undefined,
  };

  const queryParts: string[] = [];
  let i = 0;
  let signal: "help" | "version" | null = null;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--json") {
      options.json = true;
      i++;
      continue;
    }

    if (arg === "--content" || arg === "-c") {
      options.content = true;
      i++;
      continue;
    }

    if (arg === "--max-results" || arg === "-n") {
      const raw = args[i + 1];
      const parsed = Number(raw);
      options.maxResults = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
      i += 2;
      continue;
    }

    if (arg === "--headless") {
      options.headless = true;
      i++;
      continue;
    }

    if (arg === "--profile") {
      // Guard against a missing value or a value that is itself a flag.
      const next = args[i + 1];
      if (!next || next.startsWith("--") || KNOWN_FLAGS.has(next)) {
        throw new Error(
          "--profile requires a directory path (got: " +
            JSON.stringify(next ?? "nothing") +
            ")",
        );
      }
      options.profile = next;
      i += 2;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      signal = "help";
      i++;
      continue;
    }

    if (arg === "--version") {
      signal = "version";
      i++;
      continue;
    }

    // Everything that is not a `--flag` is part of the query.
    if (!arg.startsWith("--") && !KNOWN_FLAGS.has(arg)) {
      queryParts.push(arg);
    }
    i++;
  }

  return { query: queryParts.join(" "), options, signal };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`web-search — Google search from your terminal

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

Examples:
  web-search "bun runtime"
  web-search --json "bun runtime" > results.json
  web-search -c -n 3 "typescript tutorial"
  web-search --headless "bun release notes"`);
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

/** Print a single `SearchResult` line for terminal output. */
function printResultTerminal(result: SearchResult): void {
  const title = result.title.replace(/\s+/g, " ").slice(0, 80);
  const urlDisplay = result.displayUrl ?? result.url;
  const snippet = result.snippet.replace(/\s+/g, " ").slice(0, 160);

  console.log();
  console.log(`${result.rank}. ${title}`);
  console.log(`   ${urlDisplay}`);
  if (snippet.length > 0) {
    console.log(`   ${snippet}`);
  }
}

/** Print results in human-readable terminal format. */
function printTerminal(results: SearchResult[]): void {
  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  for (const result of results) {
    printResultTerminal(result);
  }
  console.log();
}

/** Print results as a JSON array on stdout. */
function printJson(results: SearchResult[]): void {
  console.log(JSON.stringify(results, null, 2));
}

/**
 * Print `SearchResultWithContent` entries in terminal format with
 * Markdown content appended under a separator.
 */
function printContentTerminal(results: SearchResultWithContent[]): void {
  for (const result of results) {
    printResultTerminal(result);

    if (result.content.length > 0) {
      console.log(`\n---\n${result.content}\n---`);
    } else {
      console.log("\n(no extractable content)");
    }
  }
  console.log();
}

/** Print `SearchResultWithContent` as JSON. */
function printContentJson(results: SearchResultWithContent[]): void {
  console.log(JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
// Lifecycle wrapper
// ---------------------------------------------------------------------------

/**
 * Wire up init → search → close with proper resource cleanup.
 * `run()` always calls `close()` in `finally` even if the search fails.
 *
 * Handles `signal` (from `--help` / `--version`) before touching Chrome so
 * those paths never trigger a browser lifecycle.
 */
async function run(
  query: string,
  options: CliOptions,
  signal: "help" | "version" | null,
): Promise<void> {
  // Handle informational signals before any browser work.
  if (signal === "help") {
    printHelp();
    return;
  }
  if (signal === "version") {
    console.log(CLI_VERSION);
    return;
  }

  try {
    // Guard before any browser work — throw so `finally → close()` always fires.
    if (!query.trim()) {
      throw new Error("No query provided. Usage: web-search <query>");
    }

    await init(
      options.profile
        ? { userDataDir: options.profile, headless: options.headless }
        : { headless: options.headless },
    );

    if (options.content) {
      const { results } = await searchWithContent(query, {
        maxResults: options.maxResults,
      });

      if (options.json) {
        printContentJson(results);
      } else {
        console.error(
          `✓ Found ${results.length} result${
            results.length === 1 ? "" : "s"
          } for "${query}"`,
        );
        printContentTerminal(results);
      }
      return;
    }

    const { results } = await search(query, {
      maxResults: options.maxResults,
    });

    if (options.json) {
      printJson(results);
    } else {
      console.error(
        `✓ Found ${results.length} result${
          results.length === 1 ? "" : "s"
        } for "${query}"`,
      );
      printTerminal(results);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  } finally {
    await close().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Cleanup error: ${msg}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point — only runs when executed directly, not on import
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { query, options, signal } = parseArgs(process.argv);

  // Handle informational signals (help/version) at the top level so we don't
  // attempt `await run()` when no browser work is needed.
  if (signal === "help") {
    printHelp();
    process.exit(0);
  }
  if (signal === "version") {
    console.log(CLI_VERSION);
    process.exit(0);
  }

  await run(query, options, signal);
}
