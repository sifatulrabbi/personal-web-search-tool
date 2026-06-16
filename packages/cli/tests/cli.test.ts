/**
 * Unit tests for the CLI argument parser and output formatters.
 *
 * Run: bun test tests/cli.test.ts
 */

import { test, expect } from "bun:test";
import { parseArgs, type CliOptions } from "../src/index";

// ---------------------------------------------------------------------------
// parseArgs — default options
// ---------------------------------------------------------------------------

test("parseArgs — bare query returns default options", () => {
  const { query, options, signal } = parseArgs(["node", "script.ts", "bun"]);
  expect(query).toBe("bun");
  expect(options).toEqual<CliOptions>({
    json: false,
    content: false,
    maxResults: 10,
    headless: false,
    profile: undefined,
  });
  expect(signal).toBeNull();
});

test("parseArgs — no args produces empty query and default options", () => {
  const { query, options, signal } = parseArgs(["node", "script.ts"]);
  expect(query).toBe("");
  expect(options.maxResults).toBe(10);
  expect(signal).toBeNull();
});

// ---------------------------------------------------------------------------
// parseArgs — --json
// ---------------------------------------------------------------------------

test("parseArgs — --json sets json flag", () => {
  const { options } = parseArgs(["node", "script.ts", "--json", "bun"]);
  expect(options.json).toBe(true);
});

// ---------------------------------------------------------------------------
// parseArgs — --content / -c
// ---------------------------------------------------------------------------

test("parseArgs — --content sets content flag", () => {
  const { options } = parseArgs(["node", "script.ts", "--content", "bun"]);
  expect(options.content).toBe(true);
});

test("parseArgs — -c is an alias for --content", () => {
  const { options } = parseArgs(["node", "script.ts", "-c", "bun"]);
  expect(options.content).toBe(true);
});

// ---------------------------------------------------------------------------
// parseArgs — --max-results / -n
// ---------------------------------------------------------------------------

test("parseArgs — --max-results 5 sets maxResults to 5", () => {
  const { options } = parseArgs([
    "node",
    "script.ts",
    "--max-results",
    "5",
    "bun",
  ]);
  expect(options.maxResults).toBe(5);
});

test("parseArgs — -n 3 sets maxResults to 3", () => {
  const { options } = parseArgs(["node", "script.ts", "-n", "3", "bun"]);
  expect(options.maxResults).toBe(3);
});

test("parseArgs — --max-results with non-number falls back to default", () => {
  const { options } = parseArgs([
    "node",
    "script.ts",
    "--max-results",
    "abc",
    "bun",
  ]);
  expect(options.maxResults).toBe(10);
});

test("parseArgs — --max-results 0 falls back to default", () => {
  const { options } = parseArgs([
    "node",
    "script.ts",
    "--max-results",
    "0",
    "bun",
  ]);
  expect(options.maxResults).toBe(10);
});

test("parseArgs — --max-results -5 falls back to default", () => {
  const { options } = parseArgs([
    "node",
    "script.ts",
    "--max-results",
    "-5",
    "bun",
  ]);
  expect(options.maxResults).toBe(10);
});

// ---------------------------------------------------------------------------
// parseArgs — --headless
// ---------------------------------------------------------------------------

test("parseArgs — --headless sets headless flag", () => {
  const { options } = parseArgs(["node", "script.ts", "--headless", "bun"]);
  expect(options.headless).toBe(true);
});

// ---------------------------------------------------------------------------
// parseArgs — --profile
// ---------------------------------------------------------------------------

test("parseArgs — --profile sets profile path", () => {
  const { options } = parseArgs([
    "node",
    "script.ts",
    "--profile",
    "/custom/profile",
    "bun",
  ]);
  expect(options.profile).toBe("/custom/profile");
});

test("parseArgs — --profile with no trailing value throws", () => {
  expect(() => parseArgs(["node", "script.ts", "--profile"])).toThrow(
    "--profile requires a directory path",
  );
});

test("parseArgs — --profile value that is another flag throws", () => {
  expect(() =>
    parseArgs(["node", "script.ts", "--profile", "--headless", "bun"]),
  ).toThrow("--profile requires a directory path");
});

// ---------------------------------------------------------------------------
// parseArgs — --help / --version signal
// ---------------------------------------------------------------------------

test("parseArgs — --help returns signal 'help' without exiting", () => {
  const { signal } = parseArgs(["node", "script.ts", "--help"]);
  expect(signal).toBe("help");
});

test("parseArgs — -h is an alias for --help", () => {
  const { signal } = parseArgs(["node", "script.ts", "-h"]);
  expect(signal).toBe("help");
});

test("parseArgs — --version returns signal 'version' without exiting", () => {
  const { signal } = parseArgs(["node", "script.ts", "--version"]);
  expect(signal).toBe("version");
});

// ---------------------------------------------------------------------------
// parseArgs — positional query
// ---------------------------------------------------------------------------

test("parseArgs — multiple positional args are joined with spaces", () => {
  const { query } = parseArgs(["node", "script.ts", "bun", "runtime", "fast"]);
  expect(query).toBe("bun runtime fast");
});

test("parseArgs — flags before and after query", () => {
  const { query, options } = parseArgs([
    "node",
    "script.ts",
    "--json",
    "bun runtime",
    "--max-results",
    "3",
  ]);
  expect(query).toBe("bun runtime");
  expect(options.json).toBe(true);
  expect(options.maxResults).toBe(3);
});

// ---------------------------------------------------------------------------
// parseArgs — combined flags
// ---------------------------------------------------------------------------

test("parseArgs — --json --content -n 5 --headless", () => {
  const { query, options } = parseArgs([
    "node",
    "script.ts",
    "--json",
    "--content",
    "-n",
    "5",
    "--headless",
    "bun",
  ]);
  expect(query).toBe("bun");
  expect(options.json).toBe(true);
  expect(options.content).toBe(true);
  expect(options.maxResults).toBe(5);
  expect(options.headless).toBe(true);
});

// ---------------------------------------------------------------------------
// parseArgs — query with Google operators preserved
// ---------------------------------------------------------------------------

test("parseArgs — query with operators is treated as a plain query", () => {
  const { query } = parseArgs([
    "node",
    "script.ts",
    "site:github.com bun runtime",
  ]);
  expect(query).toBe("site:github.com bun runtime");
});
